"""
activity_details.py — Données détaillées d'activité (time-series)

GET  /api/activity_details?id={activity_id}   → retourne les samples stockés
POST /api/activity_details {"activity_id": X}  → fetch Garmin + stockage Supabase
POST /api/activity_details {"action": "backfill", "type": "run", "limit": 20}
     → backfill des N dernières activités sans details

Table Supabase requise (à créer une seule fois) :
  CREATE TABLE IF NOT EXISTS activity_details (
    activity_id   BIGINT PRIMARY KEY,
    samples       JSONB,   -- [{t, hr, pace, cadence, power, vos, gct, stride, vr, alt}]
    splits        JSONB,   -- [{lap, distance_km, duration_min, hr_avg, pace}]
    sample_rate_s INTEGER, -- intervalle entre samples (secondes)
    fetched_at    TIMESTAMPTZ DEFAULT NOW()
  );
"""

from http.server import BaseHTTPRequestHandler
import json, os, sys
from urllib.parse import urlparse, parse_qs

sys.path.insert(0, os.path.dirname(__file__))
from _auth import check_auth


# ── Mapping clés Garmin → nom court ──────────────────────────────────────────
_METRIC_MAP = {
    'directSpeed':                'pace',       # m/s → converti en min/km
    'directHeartRate':            'hr',
    'directRunCadence':           'cadence',    # steps/min (×2 = SPM)
    'directBikeCadence':          'cadence',
    'directPower':                'power',
    'directVerticalOscillation':  'vos',        # cm
    'directGroundContactTime':    'gct',        # ms
    'directStrideLength':         'stride',     # m
    'directVerticalRatio':        'vr',         # %
    'directAltitude':             'alt',        # m
    'directLatitude':             'lat',
    'directLongitude':            'lon',
    'directDoubleCadence':        'cadence',
    'directFractionalCadence':    'cadence',
    'directEnhancedSpeed':        'pace',
    'directEnhancedAltitude':     'alt',
}

# ── Normalisation d'un sample ─────────────────────────────────────────────────
def _normalize_samples(detail_data: dict, act_type: str = 'run') -> tuple[list, int]:
    """
    Retourne (samples, sample_rate_s).
    Chaque sample : {t, hr, pace, cadence, power, vos, gct, stride, vr, alt, lat, lon}
    """
    descriptors = detail_data.get('metricDescriptors') or []
    raw_metrics  = detail_data.get('activityDetailMetrics') or []

    if not descriptors or not raw_metrics:
        return [], 1

    # Construit l'index : position → nom court
    idx_map = {}
    for d in descriptors:
        key  = d.get('key') or d.get('metricsKey') or ''
        idx  = d.get('metricsIndex')
        name = _METRIC_MAP.get(key)
        if name and idx is not None:
            idx_map[idx] = name

    if not idx_map:
        return [], 1

    samples = []
    t = 0
    sample_rate = None

    for i, point in enumerate(raw_metrics):
        vals = point.get('metrics') or []
        if not vals:
            continue

        s = {'t': t}
        for idx, name in idx_map.items():
            if idx < len(vals) and vals[idx] is not None:
                v = vals[idx]
                if name == 'pace' and v and v > 0:
                    # m/s → min/km (arrondi 1 décimale)
                    v = round(1000 / v / 60, 2)
                elif name == 'cadence':
                    v = int(round(v))
                elif name == 'hr':
                    v = int(round(v))
                elif name in ('vos', 'gct', 'power', 'stride', 'vr'):
                    v = round(v, 1)
                elif name in ('alt', 'lat', 'lon'):
                    v = round(v, 5)
                s[name] = v

        # Déduit le sample_rate depuis les startTimeGMT du point si dispo
        if sample_rate is None and i > 0:
            st = point.get('startTimeGMT') or point.get('startTimeLocal')
            st_prev = raw_metrics[i-1].get('startTimeGMT') or raw_metrics[i-1].get('startTimeLocal')
            if st and st_prev:
                try:
                    from datetime import datetime
                    dt  = datetime.fromisoformat(st.replace('Z',''))
                    dtp = datetime.fromisoformat(st_prev.replace('Z',''))
                    sample_rate = max(1, int((dt - dtp).total_seconds()))
                except Exception:
                    pass

        samples.append(s)
        t += sample_rate or 1

    # Downsample si trop de points (>5000 → garde 1 sur N)
    if len(samples) > 5000:
        step = len(samples) // 2500
        samples = samples[::step]

    return samples, sample_rate or 1


# ── Normalisation des splits (laps) ──────────────────────────────────────────
def _normalize_splits(splits_data: dict) -> list:
    laps = splits_data.get('lapDTOs') or splits_data.get('laps') or []
    result = []
    for i, lap in enumerate(laps):
        dist   = (lap.get('distance') or 0) / 1000
        dur    = (lap.get('duration') or 0) / 60
        speed  = lap.get('averageSpeed') or 0
        pace   = round(1000 / speed / 60, 2) if speed and speed > 0 else None
        result.append({
            'lap':        i + 1,
            'distance_km': round(dist, 2),
            'duration_min': round(dur, 1),
            'hr_avg':     lap.get('averageHR'),
            'pace':       pace,
            'elevation':  lap.get('elevationGain'),
        })
    return result


# ── Fetch depuis Garmin + stockage ────────────────────────────────────────────
def _fetch_and_store(activity_id: int, sb, client) -> dict:
    # Vérifie si déjà en base
    existing = sb.table('activity_details').select('activity_id').eq('activity_id', activity_id).limit(1).execute()
    if existing.data:
        return {'ok': True, 'activity_id': activity_id, 'status': 'already_stored'}

    # Récupère le type depuis activities
    act_row = sb.table('activities').select('type').eq('id', activity_id).limit(1).execute()
    act_type = (act_row.data[0].get('type') if act_row.data else None) or 'run'

    # Fetch details
    try:
        detail = client.get_activity_details(activity_id)
    except Exception as e:
        return {'error': f'Garmin API details: {e}', 'activity_id': activity_id}

    # Fetch splits
    splits = []
    try:
        splits_raw = client.get_activity_splits(activity_id)
        splits = _normalize_splits(splits_raw)
    except Exception:
        pass

    samples, rate = _normalize_samples(detail, act_type)
    if not samples:
        return {'ok': True, 'activity_id': activity_id, 'status': 'no_samples'}

    sb.table('activity_details').upsert({
        'activity_id':   activity_id,
        'samples':       samples,
        'splits':        splits,
        'sample_rate_s': rate,
    }).execute()

    return {'ok': True, 'activity_id': activity_id, 'samples': len(samples), 'splits': len(splits)}


def _get_garmin_client(sb):
    from garminconnect import Garmin
    tok = sb.table('garmin_tokens').select('tokens').eq('id', 1).limit(1).execute()
    if not tok.data or not tok.data[0].get('tokens'):
        raise Exception('Tokens Garmin introuvables')
    token_dir = '/tmp/garth_tokens'
    os.makedirs(token_dir, exist_ok=True)
    with open(os.path.join(token_dir, 'garmin_tokens.json'), 'w') as f:
        json.dump(tok.data[0]['tokens'], f)
    client = Garmin()
    client.login(token_dir)
    return client


# ── Handler HTTP ──────────────────────────────────────────────────────────────
class handler(BaseHTTPRequestHandler):
    def _sb(self):
        from supabase import create_client
        return create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_KEY'])

    def _reply(self, code, body):
        raw = json.dumps(body, default=str).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(raw)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        if not check_auth(self): return
        qs = parse_qs(urlparse(self.path).query)
        activity_id = qs.get('id', [None])[0]
        if not activity_id:
            self._reply(400, {'error': 'Paramètre id requis'})
            return
        try:
            sb   = self._sb()
            rows = sb.table('activity_details').select('*').eq('activity_id', int(activity_id)).limit(1).execute()
            if not rows.data:
                self._reply(404, {'error': 'Détails non disponibles pour cette activité'})
                return
            self._reply(200, rows.data[0])
        except Exception as e:
            self._reply(500, {'error': str(e)})

    def do_POST(self):
        if not check_auth(self): return
        try:
            length = int(self.headers.get('Content-Length', 0))
            body   = json.loads(self.rfile.read(length)) if length else {}
            sb     = self._sb()

            # ── Backfill : fetch les N dernières activités sans details ───────
            if body.get('action') == 'backfill':
                act_type = body.get('type')      # ex: 'run'
                limit    = int(body.get('limit', 10))

                # Récupère les activités sans details
                q = sb.table('activities').select('id,type,date')
                if act_type:
                    q = q.eq('type', act_type)
                acts = q.order('date', desc=True).limit(limit * 3).execute().data or []

                # Filtre celles déjà en base
                existing_ids = {
                    r['activity_id']
                    for r in (sb.table('activity_details').select('activity_id').execute().data or [])
                }
                to_fetch = [a for a in acts if a['id'] not in existing_ids][:limit]

                if not to_fetch:
                    self._reply(200, {'ok': True, 'message': 'Toutes les activités ont déjà leurs détails'})
                    return

                client  = _get_garmin_client(sb)
                results = []
                for act in to_fetch:
                    r = _fetch_and_store(act['id'], sb, client)
                    results.append(r)

                synced = sum(1 for r in results if r.get('ok') and r.get('samples', 0) > 0)
                self._reply(200, {'ok': True, 'synced': synced, 'total': len(to_fetch), 'results': results})

            # ── Diagnostic : dump JSON brut Garmin (résumé + clés détail) ──────
            # Temporaire — pour identifier les champs Garmin non exploités
            # (ex: cadence rameur, puissance) avant de les ajouter à _METRIC_MAP.
            elif body.get('action') == 'raw_dump':
                activity_id = body.get('activity_id')
                if not activity_id and body.get('type'):
                    row = (sb.table('activities').select('id,date,name')
                           .eq('type', body['type']).order('date', desc=True).limit(1).execute())
                    if not row.data:
                        self._reply(404, {'error': f"Aucune activité de type '{body['type']}' trouvée"})
                        return
                    activity_id = row.data[0]['id']

                if not activity_id:
                    self._reply(400, {'error': 'activity_id ou type requis'})
                    return

                client = _get_garmin_client(sb)
                result = {'activity_id': int(activity_id)}
                try:
                    result['summary'] = client.get_activity(int(activity_id))
                except Exception as e:
                    result['summary_error'] = str(e)
                try:
                    detail = client.get_activity_details(int(activity_id))
                    result['detail_metric_keys'] = [
                        d.get('key') or d.get('metricsKey')
                        for d in (detail.get('metricDescriptors') or [])
                    ]
                    raw_metrics = detail.get('activityDetailMetrics') or []
                    result['detail_sample_point'] = raw_metrics[0] if raw_metrics else None
                except Exception as e:
                    result['detail_error'] = str(e)

                self._reply(200, result)

            # ── Fetch une activité spécifique ─────────────────────────────────
            elif body.get('activity_id'):
                activity_id = int(body['activity_id'])
                client = _get_garmin_client(sb)
                result = _fetch_and_store(activity_id, sb, client)
                self._reply(200 if result.get('ok') else 500, result)

            else:
                self._reply(400, {'error': 'activity_id ou action requis'})

        except Exception as e:
            self._reply(500, {'error': str(e)})

    def log_message(self, fmt, *args):
        pass

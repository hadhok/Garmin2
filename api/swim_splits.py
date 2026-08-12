"""
swim_splits.py — Analyse longueur par longueur d'une séance de natation
(découpage en 5 tranches : SWOLF moy., FC moy., durée/25m par tranche)

GET  /api/swim_splits?id={activity_id}   → retourne l'analyse stockée
POST /api/swim_splits {"activity_id": X} → fetch Garmin + calcul + stockage

Table Supabase requise (à créer une seule fois) :
  CREATE TABLE IF NOT EXISTS swim_length_analysis (
    activity_id   BIGINT PRIMARY KEY,
    total_lengths INTEGER,
    buckets       JSONB,   -- [{range, swolf_avg, hr_avg, duration_avg_s}]
    fetched_at    TIMESTAMPTZ DEFAULT NOW()
  );
"""

from http.server import BaseHTTPRequestHandler
import json, os
from urllib.parse import urlparse, parse_qs


def _compute_buckets(splits_data: dict, n_buckets: int = 5) -> dict:
    lengths = []
    for lap in splits_data.get('lapDTOs', []):
        for length in lap.get('lengthDTOs', []):
            if length.get('distance'):
                lengths.append(length)

    if not lengths:
        return {'total_lengths': 0, 'buckets': []}

    n = len(lengths)
    bucket_size = max(1, -(-n // n_buckets))  # ceil
    buckets = []
    for i in range(0, n, bucket_size):
        chunk = lengths[i:i + bucket_size]
        swolf_vals = [c.get('averageSWOLF') for c in chunk if c.get('averageSWOLF')]
        hr_vals    = [c.get('averageHR') for c in chunk if c.get('averageHR')]
        dur_vals   = [c.get('duration') for c in chunk if c.get('duration')]
        first_idx  = chunk[0].get('lengthIndex', i + 1)
        last_idx   = chunk[-1].get('lengthIndex', i + len(chunk))
        buckets.append({
            'range':          f"L{first_idx}–{last_idx}" if first_idx != last_idx else f"L{first_idx}",
            'swolf_avg':      round(sum(swolf_vals) / len(swolf_vals), 1) if swolf_vals else None,
            'hr_avg':         round(sum(hr_vals) / len(hr_vals)) if hr_vals else None,
            'duration_avg_s': round(sum(dur_vals) / len(dur_vals), 1) if dur_vals else None,
        })

    return {'total_lengths': n, 'buckets': buckets}


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


def _fetch_and_store(activity_id: int, sb, client) -> dict:
    existing = sb.table('swim_length_analysis').select('*').eq('activity_id', activity_id).limit(1).execute()
    if existing.data:
        return {'ok': True, **existing.data[0]}

    try:
        splits_raw = client.get_activity_splits(activity_id)
    except Exception as e:
        return {'error': f'Garmin API splits: {e}', 'activity_id': activity_id}

    result = _compute_buckets(splits_raw)
    row = {
        'activity_id':   activity_id,
        'total_lengths': result['total_lengths'],
        'buckets':       result['buckets'],
    }
    sb.table('swim_length_analysis').upsert(row).execute()
    return {'ok': True, **row}


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
        qs = parse_qs(urlparse(self.path).query)
        activity_id = qs.get('id', [None])[0]
        if not activity_id:
            self._reply(400, {'error': 'Paramètre id requis'})
            return
        try:
            sb = self._sb()
            rows = sb.table('swim_length_analysis').select('*').eq('activity_id', int(activity_id)).limit(1).execute()
            if not rows.data:
                self._reply(404, {'error': 'Analyse non disponible pour cette activité'})
                return
            self._reply(200, rows.data[0])
        except Exception as e:
            self._reply(500, {'error': str(e)})

    def do_POST(self):
        try:
            length = int(self.headers.get('Content-Length', 0))
            body   = json.loads(self.rfile.read(length)) if length else {}
            if not body.get('activity_id'):
                self._reply(400, {'error': 'activity_id requis'})
                return
            sb = self._sb()
            client = _get_garmin_client(sb)
            result = _fetch_and_store(int(body['activity_id']), sb, client)
            self._reply(200 if result.get('ok') else 500, result)
        except Exception as e:
            self._reply(500, {'error': str(e)})

    def log_message(self, fmt, *args):
        pass

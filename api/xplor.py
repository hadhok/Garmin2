"""
Xplor Active — import via flux iCal.

GET  /api/xplor               → sessions planifiées depuis Supabase
POST /api/xplor {"action":"sync_ical"}              → sync depuis l'URL iCal stockée
POST /api/xplor {"action":"save_url","url":"..."}   → enregistre l'URL iCal dans Supabase

Setup Supabase (une seule fois) :
  -- Table des séances planifiées
  CREATE TABLE IF NOT EXISTS planned_sessions (
    id              TEXT PRIMARY KEY,
    source          TEXT DEFAULT 'xplor',
    date            TEXT NOT NULL,
    start_time      TEXT,
    end_time        TEXT,
    name            TEXT,
    type            TEXT,
    icon            TEXT,
    duration_min    INTEGER,
    estimated_load  REAL,
    load_confidence TEXT,
    status          TEXT DEFAULT 'planned',
    raw             JSONB,
    synced_at       TIMESTAMPTZ DEFAULT NOW()
  );

  -- Clé de config (réutilise la table sync_meta si elle existe, sinon crée app_settings)
  CREATE TABLE IF NOT EXISTS app_settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

Comment obtenir son URL iCal Xplor Active :
  1. Dans l'app Xplor Active, réserve une séance et utilise "Ajouter au calendrier"
     → choisir Google Calendar ou Apple Calendar
  2. Option A — Google Calendar :
       • Ouvre calendar.google.com → les 3 points à côté du calendrier "Xplor" → Paramètres
       → Adresse secrète au format iCal → copie l'URL
  3. Option B — Apple Calendar :
       • Fichier → Exporter → Export… n'est pas un flux ; utilise plutôt une app tierce
       ou partage le calendrier iCal depuis iCloud
  4. Colle l'URL dans le champ "iCal Xplor" du dashboard (onglet Entraînement → Plan de la semaine)
"""

from http.server import BaseHTTPRequestHandler
import json, os, re
from datetime import datetime, timedelta, timezone
from urllib.request import urlopen, Request

# ── Type mapping depuis le nom de la séance ─────────────────────────────────
_TYPE_RULES = [
    (['spinning', 'cycling', 'vélo', 'indoor cycling', 'rpm', 'biking'],  'bike'),
    (['natation', 'aqua', 'swim', 'nage'],                                 'swim'),
    (['yoga', 'stretching', 'souplesse', 'méditation'],                    'yoga'),
    (['pilates'],                                                           'pilates'),
    (['musculation', 'muscu', 'renforcement', 'pump', 'bodypump',
      'full body', 'force', 'upper', 'lower', 'lbody'],                   'strength'),
    (['hiit', 'cross training', 'bootcamp', 'circuit',
      'cardio boxing', 'boxe', 'tabata', 'crossfit'],                     'hiit'),
    (['running', 'course ', 'endurance', 'fractionné', 'trail'],           'run'),
    (['rameur', 'rowing', 'aviron'],                                        'rowing'),
    (['zumba', 'danse', 'step', 'aérobic', 'fitness',
      'cardio', 'lm10', 'bodyattack', 'body combat', 'body step'],        'cardio'),
]

TYPE_ICONS = {
    'run': '🏃', 'bike': '🚴', 'swim': '🏊', 'strength': '🏋️',
    'hiit': '🔥', 'cardio': '❤️', 'rowing': '🚣', 'yoga': '🧘',
    'pilates': '🧘', 'other': '⚡',
}

_DEFAULT_LOAD_PER_MIN = {
    'run': 1.8, 'bike': 1.4, 'swim': 1.5, 'strength': 0.9,
    'hiit': 2.0, 'cardio': 1.2, 'rowing': 1.6, 'yoga': 0.4,
    'pilates': 0.4, 'other': 1.0,
}


def _classify(name: str) -> str:
    low = (name or '').lower()
    for keywords, t in _TYPE_RULES:
        if any(k in low for k in keywords):
            return t
    return 'other'


def _parse_dt(s: str) -> datetime | None:
    """Parse iCal datetime: 20260520T100000Z, 20260520T100000, 20260520"""
    s = s.strip().split(';')[-1]  # remove TZID= prefix if any
    if ':' in s:
        s = s.split(':')[-1]  # TZID=Europe/Paris:20260520T100000
    s = s.strip()
    fmts = [
        ('%Y%m%dT%H%M%SZ', timezone.utc),
        ('%Y%m%dT%H%M%S',  None),
        ('%Y%m%d',          None),
    ]
    for fmt, tz in fmts:
        try:
            dt = datetime.strptime(s[:len(fmt.replace('%', '').replace('Y','yyyy').replace('m','mm').replace('d','dd').replace('H','hh').replace('M','mm').replace('S','ss'))], fmt)
            return dt.replace(tzinfo=tz) if tz else dt
        except Exception:
            pass
    # Fallback: try common lengths
    for fmt in ('%Y%m%dT%H%M%SZ', '%Y%m%dT%H%M%S', '%Y%m%d'):
        try:
            return datetime.strptime(s[:len(fmt.replace('%Y','1234').replace('%m','12').replace('%d','31').replace('%H','23').replace('%M','59').replace('%S','59').replace('T','T').replace('Z','Z'))], fmt)
        except Exception:
            pass
    return None


def _parse_dt_simple(s: str) -> datetime | None:
    """Simplified parser for common iCal date formats."""
    s = re.sub(r'^.*:', '', s.strip())  # strip TZID= prefix
    s = s.strip().rstrip('Z')
    for fmt in ('%Y%m%dT%H%M%S', '%Y%m%d'):
        try:
            return datetime.strptime(s[:len(fmt.replace('%Y','1234').replace('%m','12').replace('%d','31').replace('%H','23').replace('%M','59').replace('%S','59'))], fmt)
        except Exception:
            pass
    return None


def _parse_ical(text: str) -> list[dict]:
    """Parse iCal text, return list of event dicts."""
    events = []
    blocks = re.split(r'\r?\nBEGIN:VEVENT\r?\n', text, flags=re.IGNORECASE)
    for block in blocks[1:]:
        end_idx = block.upper().find('END:VEVENT')
        if end_idx >= 0:
            block = block[:end_idx]

        # Unfold multi-line values (RFC 5545)
        block = re.sub(r'\r?\n[ \t]', '', block)

        def field(name):
            m = re.search(rf'^{name}[;:][^\r\n]*', block, re.MULTILINE | re.IGNORECASE)
            if not m:
                return ''
            val = m.group(0)
            val = re.sub(rf'^{name}[;][^:]*:', '', val, flags=re.IGNORECASE)
            val = re.sub(rf'^{name}:', '', val, flags=re.IGNORECASE)
            return val.strip()

        dtstart_raw = field('DTSTART')
        dtend_raw   = field('DTEND')
        summary     = field('SUMMARY').replace('\\n', ' ').replace('\\,', ',')
        uid         = field('UID')
        location    = field('LOCATION')
        description = field('DESCRIPTION')

        if not dtstart_raw or not summary:
            continue

        dtstart = _parse_dt_simple(dtstart_raw)
        dtend   = _parse_dt_simple(dtend_raw) if dtend_raw else None
        if not dtstart:
            continue

        dur = int((dtend - dtstart).total_seconds() / 60) if dtend else 60

        events.append({
            'uid':         uid,
            'summary':     summary,
            'dtstart':     dtstart,
            'dtend':       dtend,
            'duration':    dur,
            'location':    location,
            'description': description,
        })
    return events


def _fetch_ical(url: str) -> str:
    req = Request(url, headers={'User-Agent': 'GarminDashboard/1.0'})
    with urlopen(req, timeout=15) as r:
        raw = r.read()
    # Try UTF-8 first, then latin-1
    for enc in ('utf-8', 'latin-1', 'cp1252'):
        try:
            return raw.decode(enc)
        except Exception:
            pass
    return raw.decode('utf-8', errors='replace')


def _estimate_load(act_type: str, duration_min: int, sb) -> tuple:
    try:
        res = (sb.table('activities')
                 .select('training_load,duration_min')
                 .eq('type', act_type)
                 .gt('training_load', 0)
                 .gt('duration_min', 0)
                 .execute())
        acts = res.data or []
    except Exception:
        acts = []

    if not acts:
        return round(_DEFAULT_LOAD_PER_MIN.get(act_type, 1.0) * duration_min, 1), 'low'

    similar = [a for a in acts if abs(a['duration_min'] - duration_min) <= duration_min * 0.4]
    pool = similar if similar else acts
    conf = 'high' if len(pool) >= 5 else ('medium' if len(pool) >= 2 else 'low')
    avg  = sum(a['training_load'] / a['duration_min'] for a in pool) / len(pool)
    return round(avg * duration_min, 1), conf


def _get_setting(sb, key: str) -> str | None:
    try:
        r = sb.table('app_settings').select('value').eq('key', key).limit(1).execute()
        return r.data[0]['value'] if r.data else None
    except Exception:
        return None


def _get_ical_url(sb) -> str | None:
    return _get_setting(sb, 'xplor_ical_url')


def _save_ical_url(sb, url: str) -> None:
    sb.table('app_settings').upsert({'key': 'xplor_ical_url', 'value': url}).execute()


def _location_matches(event_location: str, filter_str: str) -> bool:
    """True si tous les mots du filtre se retrouvent dans la location (insensible à la casse)."""
    if not filter_str:
        return True
    loc = (event_location or '').lower()
    # Match si au moins un "mot clé significatif" du filtre est présent
    words = [w for w in re.split(r'[\s,\-]+', filter_str.lower()) if len(w) >= 4]
    return any(w in loc for w in words)


def _do_sync(sb) -> dict:
    ical_url      = _get_ical_url(sb)
    location_filter = _get_setting(sb, 'xplor_location_filter') or ''

    if not ical_url:
        return {'error': 'Aucune URL iCal configurée. Colle ton URL dans le dashboard.'}

    # Fetch + parse iCal
    try:
        ical_text = _fetch_ical(ical_url)
    except Exception as e:
        return {'error': f'Impossible de charger le flux iCal : {e}'}

    events = _parse_ical(ical_text)
    if not events:
        return {'ok': True, 'synced': 0, 'message': 'Aucun événement trouvé dans le flux iCal'}

    # Keep only future events (next 30 days)
    now    = datetime.now()
    cutoff = now + timedelta(days=30)
    future = [e for e in events if e['dtstart'] >= now and e['dtstart'] <= cutoff]

    # Filter by location if configured
    if location_filter:
        before = len(future)
        future = [e for e in future if _location_matches(e['location'], location_filter)]
        filtered_out = before - len(future)
    else:
        filtered_out = 0

    if not future:
        msg = 'Aucune séance à venir'
        if filtered_out:
            msg += f' (filtre lieu actif : {filtered_out} événement(s) exclus)'
        return {'ok': True, 'synced': 0, 'message': msg}

    # Build sessions with load estimation
    sessions = []
    for e in future:
        act_type = _classify(e['summary'])
        load, conf = _estimate_load(act_type, e['duration'], sb)
        uid = e['uid'] or f"{e['dtstart'].isoformat()}_{e['summary'][:20]}"
        sessions.append({
            'id':              f'xplor_{re.sub(r"[^a-zA-Z0-9]", "_", uid)[:60]}',
            'source':          'xplor',
            'date':            e['dtstart'].strftime('%Y-%m-%d'),
            'start_time':      e['dtstart'].isoformat(),
            'end_time':        e['dtend'].isoformat() if e['dtend'] else None,
            'name':            e['summary'],
            'type':            act_type,
            'icon':            TYPE_ICONS.get(act_type, '⚡'),
            'duration_min':    e['duration'],
            'estimated_load':  load,
            'load_confidence': conf,
            'status':          'planned',
            'raw':             {'location': e['location'], 'description': e['description']},
        })

    # Upsert
    for i in range(0, len(sessions), 50):
        sb.table('planned_sessions').upsert(sessions[i:i+50]).execute()

    # Mark completed: if a Garmin activity exists on same date + same type
    try:
        today = now.strftime('%Y-%m-%d')
        acts  = (sb.table('activities').select('date,type').gte('date', today).execute()).data or []
        done  = {(a['date'], a['type']) for a in acts}
        for s in sessions:
            if (s['date'], s['type']) in done:
                (sb.table('planned_sessions')
                   .update({'status': 'completed'})
                   .eq('id', s['id'])
                   .execute())
    except Exception:
        pass

    return {'ok': True, 'synced': len(sessions)}


def _get_sessions(sb) -> list:
    try:
        today = datetime.now().strftime('%Y-%m-%d')
        end   = (datetime.now() + timedelta(days=14)).strftime('%Y-%m-%d')
        r = (sb.table('planned_sessions')
               .select('*')
               .gte('date', today)
               .lte('date', end)
               .order('start_time')
               .execute())
        return r.data or []
    except Exception:
        return []


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
        try:
            sb              = self._sb()
            sessions        = _get_sessions(sb)
            ical_url        = _get_ical_url(sb) or ''
            location_filter = _get_setting(sb, 'xplor_location_filter') or ''
            self._reply(200, {
                'sessions':         sessions,
                'ical_configured':  bool(ical_url),
                'ical_url_preview': (ical_url[:40] + '…') if len(ical_url) > 40 else ical_url,
                'location_filter':  location_filter,
            })
        except Exception as e:
            self._reply(500, {'error': str(e)})

    def do_POST(self):
        try:
            length = int(self.headers.get('Content-Length', 0))
            body   = json.loads(self.rfile.read(length)) if length else {}
            action = body.get('action', 'sync_ical')
            sb     = self._sb()

            if action == 'sync_ical':
                self._reply(200, _do_sync(sb))

            elif action == 'save_url':
                url = (body.get('url') or '').strip()
                if not url:
                    self._reply(400, {'error': 'URL vide'})
                    return
                _save_ical_url(sb, url)
                self._reply(200, {'ok': True})

            elif action == 'save_filter':
                loc = (body.get('location') or '').strip()
                sb.table('app_settings').upsert({'key': 'xplor_location_filter', 'value': loc}).execute()
                self._reply(200, {'ok': True})

            else:
                self._reply(400, {'error': f'action inconnue: {action}'})

        except Exception as e:
            self._reply(500, {'error': str(e)})

    def log_message(self, fmt, *args):
        pass

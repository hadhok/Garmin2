"""
Xplor Active (Resamania) sync endpoint.

GET  /api/xplor          → planned sessions from Supabase
POST /api/xplor {"action":"sync"}     → authenticate + fetch bookings + estimate load
POST /api/xplor {"action":"discover"} → try to find club slug from credentials

Required env vars:
  XPLOR_EMAIL       e.g. you@example.com
  XPLOR_PASSWORD    your Xplor Active password
  XPLOR_CLUB_SLUG   e.g. "movingbesancon" — find it in your gym's booking URL
                    member.resamania.com/<club_slug>
                    If unset, discovery is attempted automatically.

Supabase table (run once):
  CREATE TABLE planned_sessions (
    id          TEXT PRIMARY KEY,
    source      TEXT DEFAULT 'xplor',
    date        TEXT NOT NULL,
    start_time  TEXT,
    end_time    TEXT,
    name        TEXT,
    type        TEXT,
    icon        TEXT,
    duration_min  INTEGER,
    estimated_load REAL,
    load_confidence TEXT,  -- 'high' | 'medium' | 'low'
    status      TEXT DEFAULT 'planned',
    xplor_id    TEXT,
    raw         JSONB,
    synced_at   TIMESTAMPTZ DEFAULT NOW()
  );
"""

from http.server import BaseHTTPRequestHandler
import json, os, re
from datetime import datetime, timedelta
from urllib.request import urlopen, Request
from urllib.parse import urlencode

RESAMANIA_BASE = 'https://api.resamania.com'

# ── Type mapping: session name keywords → internal type ─────────────────────
_TYPE_RULES = [
    (['spinning', 'cycling', 'vélo', 'indoor cycling', 'rpm'],       'bike'),
    (['natation', 'aqua', 'swim'],                                    'swim'),
    (['yoga', 'stretching', 'souplesse'],                             'yoga'),
    (['pilates'],                                                      'pilates'),
    (['musculation', 'muscu', 'renforcement', 'pump', 'bodypump',
      'lbody', 'upper', 'lower', 'full body', 'force'],               'strength'),
    (['hiit', 'cross training', 'bootcamp', 'circuit',
      'cardio boxing', 'boxe', 'tabata'],                             'hiit'),
    (['running', 'course', 'endurance', 'fractionné'],                'run'),
    (['rameur', 'rowing'],                                             'rowing'),
    (['zumba', 'danse', 'step', 'aérobic', 'fitness',
      'cardio', 'lm10', 'bodyattack', 'body step'],                   'cardio'),
]

TYPE_ICONS = {
    'run': '🏃', 'bike': '🚴', 'swim': '🏊', 'strength': '🏋️',
    'hiit': '🔥', 'cardio': '❤️', 'rowing': '🚣', 'yoga': '🧘',
    'pilates': '🧘', 'other': '⚡',
}

# Default load-per-minute fallback when no Garmin history available
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


def _json_req(url, data=None, headers=None, method=None):
    body = urlencode(data).encode() if data else None
    req = Request(url, data=body, headers=headers or {}, method=method)
    if body and not method:
        req.method = 'POST'
    with urlopen(req, timeout=15) as r:
        return json.loads(r.read())


def _discover_club(email: str) -> str | None:
    """
    Try to find the club slug by scraping the web member portal.
    member.resamania.com redirects to the member's club page after login.
    Returns the slug or None.
    """
    try:
        from urllib.request import HTTPCookieProcessor, build_opener
        from urllib.error import HTTPError
        import http.cookiejar
        cj = http.cookiejar.CookieJar()
        opener = build_opener(HTTPCookieProcessor(cj))

        # Load the login page to get any CSRF tokens / club discovery
        resp = opener.open(f'{RESAMANIA_BASE}/members/discover?email={email}', timeout=10)
        data = json.loads(resp.read())
        clubs = data.get('clubs') or data.get('data') or []
        if clubs:
            return clubs[0].get('slug') or clubs[0].get('token')
    except Exception:
        pass
    return None


def _auth(club_slug: str, email: str, password: str) -> dict:
    """
    OAuth 2.0 password grant for Resamania.
    Returns {'access_token': ..., 'member_id': ...}
    """
    token_url = f'{RESAMANIA_BASE}/{club_slug}/oauth/v2/token'
    payload = {
        'grant_type':    'password',
        'username':       email,
        'password':       password,
        'client_id':     f'{club_slug}_client',
        'client_secret': '',
    }
    try:
        tok = _json_req(token_url, data=payload)
        return tok
    except Exception:
        pass

    # Fallback: try the generic web client id discovered from public URLs
    # (client_id used by member.resamania.com web portal)
    generic_client = '26_2532ba2d23446346e4f83dda1570fdd224ce70c546251c4ce84bd734e0e18811'
    payload['client_id'] = generic_client
    payload['client_secret'] = ''
    return _json_req(token_url, data=payload)


def _fetch_bookings(club_slug: str, token: str, days_ahead=14) -> list:
    """Fetch upcoming member bookings."""
    today = datetime.now().strftime('%Y-%m-%d')
    end   = (datetime.now() + timedelta(days=days_ahead)).strftime('%Y-%m-%d')
    hdrs  = {'Authorization': f'Bearer {token}', 'Accept': 'application/json'}

    # Try several known endpoint patterns
    endpoints = [
        f'{RESAMANIA_BASE}/{club_slug}/v3/members/me/bookings?from={today}&to={end}',
        f'{RESAMANIA_BASE}/{club_slug}/members/me/bookings?dateFrom={today}&dateTo={end}',
        f'{RESAMANIA_BASE}/{club_slug}/bookings?member=me&from={today}&to={end}',
    ]
    for url in endpoints:
        try:
            data = _json_req(url, headers=hdrs, method='GET')
            bookings = data.get('data') or data.get('bookings') or data.get('items') or []
            if isinstance(bookings, list):
                return bookings
        except Exception:
            continue
    return []


def _estimate_load(act_type: str, duration_min: int, sb) -> tuple[float, str]:
    """
    Estimate training load from Garmin history calibration.
    Returns (estimated_load, confidence).
    """
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
        fallback = _DEFAULT_LOAD_PER_MIN.get(act_type, 1.0) * duration_min
        return round(fallback, 1), 'low'

    # Weight similar durations more (±40% of target)
    similar = [a for a in acts if abs(a['duration_min'] - duration_min) <= duration_min * 0.4]
    pool = similar if similar else acts
    confidence = 'high' if len(pool) >= 5 else ('medium' if len(pool) >= 2 else 'low')

    avg_per_min = sum(a['training_load'] / a['duration_min'] for a in pool) / len(pool)
    return round(avg_per_min * duration_min, 1), confidence


def _normalize_booking(raw: dict, sb) -> dict | None:
    """Convert a raw Resamania booking into our planned_session schema."""
    # Handle different field name conventions across API versions
    start_str = (raw.get('startDatetime') or raw.get('startDate')
                 or raw.get('start') or raw.get('datetime') or '')
    if not start_str:
        return None

    try:
        dt = datetime.fromisoformat(start_str.replace('Z', '+00:00'))
    except Exception:
        return None

    event = raw.get('event') or raw.get('activity') or raw.get('planning') or raw
    name  = (event.get('name') or event.get('title') or raw.get('name') or 'Séance')
    dur   = int(event.get('duration') or event.get('durationMin')
                or event.get('durationMinutes') or 60)
    end_str = raw.get('endDatetime') or raw.get('endDate') or ''

    act_type = _classify(name)
    load, conf = _estimate_load(act_type, dur, sb)
    xplor_id = str(raw.get('id') or raw.get('bookingId') or raw.get('attendeeId') or '')

    return {
        'id':              f'xplor_{xplor_id}' if xplor_id else f'xplor_{start_str}_{name[:20]}',
        'source':          'xplor',
        'date':            dt.strftime('%Y-%m-%d'),
        'start_time':      dt.isoformat(),
        'end_time':        end_str or (dt + timedelta(minutes=dur)).isoformat(),
        'name':            name,
        'type':            act_type,
        'icon':            TYPE_ICONS.get(act_type, '⚡'),
        'duration_min':    dur,
        'estimated_load':  load,
        'load_confidence': conf,
        'status':          'planned',
        'xplor_id':        xplor_id,
        'raw':             raw,
    }


def _do_sync(sb) -> dict:
    email    = os.environ.get('XPLOR_EMAIL', '')
    password = os.environ.get('XPLOR_PASSWORD', '')
    slug     = os.environ.get('XPLOR_CLUB_SLUG', '')

    if not email or not password:
        return {'error': 'XPLOR_EMAIL et XPLOR_PASSWORD manquants dans les variables d\'env Vercel'}

    # Discover club slug if not provided
    if not slug:
        slug = _discover_club(email)
    if not slug:
        return {
            'error': 'Club Xplor introuvable. Ajoute XPLOR_CLUB_SLUG dans les env vars Vercel. '
                     'Tu le trouves dans l\'URL de ton espace membre : member.resamania.com/<club_slug>'
        }

    # Authenticate
    try:
        tok = _auth(slug, email, password)
        access_token = tok.get('access_token')
        if not access_token:
            return {'error': f'Auth Xplor échouée : {tok}'}
    except Exception as e:
        return {'error': f'Auth Xplor : {e}'}

    # Fetch bookings
    raw_bookings = _fetch_bookings(slug, access_token)
    if not raw_bookings:
        return {'ok': True, 'synced': 0, 'message': 'Aucune réservation à venir trouvée'}

    # Normalize + estimate load
    sessions = [_normalize_booking(b, sb) for b in raw_bookings]
    sessions = [s for s in sessions if s]

    # Upsert into Supabase
    if sessions:
        try:
            sb.table('planned_sessions').upsert(sessions).execute()
        except Exception as e:
            # Table might not exist yet
            return {
                'error': f'Supabase : {e}. Crée la table planned_sessions (voir commentaire dans api/xplor.py)',
                'sessions_preview': sessions[:3],
            }

    # Update match status: if Garmin activity on same date/type, mark as completed
    try:
        today = datetime.now().strftime('%Y-%m-%d')
        acts  = (sb.table('activities').select('date,type').gte('date', today).execute()).data or []
        done  = {(a['date'], a['type']) for a in acts}
        for s in sessions:
            if (s['date'], s['type']) in done:
                sb.table('planned_sessions').update({'status': 'completed'}).eq('id', s['id']).execute()
    except Exception:
        pass

    return {'ok': True, 'synced': len(sessions), 'club': slug}


def _get_sessions(sb) -> list:
    try:
        today = datetime.now().strftime('%Y-%m-%d')
        end   = (datetime.now() + timedelta(days=14)).strftime('%Y-%m-%d')
        res   = (sb.table('planned_sessions')
                   .select('*')
                   .gte('date', today)
                   .lte('date', end)
                   .order('start_time')
                   .execute())
        return res.data or []
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
            sb = self._sb()
            sessions = _get_sessions(sb)
            self._reply(200, {'sessions': sessions})
        except Exception as e:
            self._reply(500, {'error': str(e)})

    def do_POST(self):
        try:
            length = int(self.headers.get('Content-Length', 0))
            body   = json.loads(self.rfile.read(length)) if length else {}
            action = body.get('action', 'sync')
            sb     = self._sb()

            if action == 'sync':
                result = _do_sync(sb)
                self._reply(200 if 'ok' in result else 500, result)
            elif action == 'discover':
                email = os.environ.get('XPLOR_EMAIL', '')
                slug  = _discover_club(email)
                self._reply(200, {'slug': slug, 'found': bool(slug)})
            else:
                self._reply(400, {'error': f'action inconnue: {action}'})
        except Exception as e:
            self._reply(500, {'error': str(e)})

    def log_message(self, fmt, *args):
        pass

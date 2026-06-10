"""
Xplor Active (Deciplus) — synchronisation via API REST directe.

Variables d'environnement requises :
  DECIPLUS_EMAIL     — email du compte Xplor Active / Deciplus
  DECIPLUS_PASSWORD  — mot de passe

Variables optionnelles :
  DECIPLUS_CLUB_SLUG — slug du club (ex: girondinsfitness). Si absent, le premier
                       club trouvé dans la réponse d'authentification est utilisé.

GET  /api/xplor               → sessions planifiées depuis Supabase
POST /api/xplor {"action":"sync"}          → sync depuis l'API Deciplus
POST /api/xplor {"action":"sync_ical"}     → (legacy) sync depuis iCal si configuré

Setup Supabase (une seule fois) :
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
  CREATE TABLE IF NOT EXISTS app_settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
"""

from http.server import BaseHTTPRequestHandler
import json, os, re, urllib.request, urllib.error
from datetime import datetime, timedelta, timezone

# ── Deciplus API ─────────────────────────────────────────────────────────────
_DECIPLUS_BASE         = 'https://api.deciplus.pro'
_AUTHENTICATE_URL      = f'{_DECIPLUS_BASE}/deciplus-members/v1/authenticate'
_BOOKINGS_UPCOMING_URL = f'{_DECIPLUS_BASE}/members/v1/bookings/upcoming'
_ACTIVITIES_URL        = f'{_DECIPLUS_BASE}/members/v1/activities/upcoming'

# ── Type mapping ─────────────────────────────────────────────────────────────
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


# ── HTTP helpers ──────────────────────────────────────────────────────────────
def _http(url: str, method: str = 'GET', body: dict = None, token: str = None) -> dict:
    data = json.dumps(body).encode() if body else None
    headers = {
        'Content-Type': 'application/json',
        'Accept':       'application/json',
    }
    if token:
        headers['x-access-token'] = token
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())


# ── Deciplus auth ─────────────────────────────────────────────────────────────
def _deciplus_login(email: str, password: str) -> tuple[str, str]:
    """Retourne (token, club_slug). Essaie plusieurs URLs d'authentification."""
    slug_pref = os.environ.get('DECIPLUS_CLUB_SLUG', '').strip()

    # Essaie d'abord l'URL avec le slug du club (pattern vu sur member-app.deciplus.pro/{slug}/signIn)
    auth_urls = []
    if slug_pref:
        auth_urls += [
            f'https://api.deciplus.pro/{slug_pref}/deciplus-members/v1/authenticate',
            f'https://api.deciplus.pro/{slug_pref}/members/v1/authenticate',
        ]
    auth_urls += [
        _AUTHENTICATE_URL,  # https://api.deciplus.pro/deciplus-members/v1/authenticate
    ]

    last_err = None
    resp = None
    for url in auth_urls:
        try:
            resp = _http(url, 'POST', {'email': email, 'password': password})
            if resp.get('tokens'):
                break
        except Exception as e:
            last_err = e
            continue

    if not resp or not resp.get('tokens'):
        raise ValueError(f'Authentification Deciplus échouée : {last_err or resp}')

    clubs = resp.get('tokens', {}).get('clubs', {})
    if not clubs:
        raise ValueError(f'Authentification Deciplus échouée : {resp}')

    if slug_pref and slug_pref in clubs:
        slug = slug_pref
    else:
        slug = next(iter(clubs))

    token_list = clubs[slug]
    token = token_list[0]['token'] if isinstance(token_list, list) else token_list['token']
    return token, slug


# ── Récupération des réservations à venir ────────────────────────────────────
def _get_upcoming_bookings(token: str) -> list[dict]:
    try:
        resp = _http(_BOOKINGS_UPCOMING_URL, token=token)
        return resp.get('bookings', [])
    except Exception:
        return []


# ── Load estimation ───────────────────────────────────────────────────────────
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


# ── Sync principal ────────────────────────────────────────────────────────────
def _process_bookings(raw_bookings: list, slug: str, sb) -> dict:
    """Normalise et stocke les réservations brutes en base."""
    if not raw_bookings:
        return {'ok': True, 'synced': 0, 'message': 'Aucune réservation reçue', 'slug': slug}

    now    = datetime.now()
    cutoff = now + timedelta(days=30)
    sessions = []

    for item in raw_bookings:
        b = item.get('booking') or item
        start_str = b.get('startDate') or b.get('start_date') or b.get('startTime') or ''
        end_str   = b.get('endDate')   or b.get('end_date')   or b.get('endTime')   or ''
        name      = (b.get('activity') or {}).get('name') or b.get('name') or b.get('title') or 'Séance'

        if not start_str:
            continue
        try:
            start_dt = datetime.fromisoformat(start_str.replace('Z', '+00:00')).astimezone().replace(tzinfo=None)
        except Exception:
            continue

        if start_dt < now or start_dt > cutoff:
            continue

        end_dt = None
        if end_str:
            try:
                end_dt = datetime.fromisoformat(end_str.replace('Z', '+00:00')).astimezone().replace(tzinfo=None)
            except Exception:
                pass

        duration = int((end_dt - start_dt).total_seconds() / 60) if end_dt else 60
        act_type = _classify(name)
        load, conf = _estimate_load(act_type, duration, sb)
        uid = b.get('id') or b.get('bookingId') or f"{start_dt.isoformat()}_{name[:20]}"
        sessions.append({
            'id':              f'xplor_{re.sub(r"[^a-zA-Z0-9]", "_", str(uid))[:60]}',
            'source':          'xplor',
            'date':            start_dt.strftime('%Y-%m-%d'),
            'start_time':      start_dt.isoformat(),
            'end_time':        end_dt.isoformat() if end_dt else None,
            'name':            name,
            'type':            act_type,
            'icon':            TYPE_ICONS.get(act_type, '⚡'),
            'duration_min':    duration,
            'estimated_load':  load,
            'load_confidence': conf,
            'status':          'planned',
            'raw':             {k: v for k, v in b.items() if k not in ('activity',)},
        })

    if not sessions:
        return {'ok': True, 'synced': 0, 'message': 'Aucune séance dans les 30 prochains jours', 'slug': slug}

    for i in range(0, len(sessions), 50):
        sb.table('planned_sessions').upsert(sessions[i:i+50]).execute()

    try:
        today = now.strftime('%Y-%m-%d')
        acts  = (sb.table('activities').select('date,type').gte('date', today).execute()).data or []
        done  = {(a['date'], a['type']) for a in acts}
        for s in sessions:
            if (s['date'], s['type']) in done:
                sb.table('planned_sessions').update({'status': 'completed'}).eq('id', s['id']).execute()
    except Exception:
        pass

    return {'ok': True, 'synced': len(sessions), 'slug': slug}


def _do_sync_api(sb) -> dict:
    email    = os.environ.get('DECIPLUS_EMAIL', '').strip()
    password = os.environ.get('DECIPLUS_PASSWORD', '').strip()
    if not email or not password:
        return {'error': 'DECIPLUS_EMAIL / DECIPLUS_PASSWORD non configurés'}

    try:
        token, slug = _deciplus_login(email, password)
    except Exception as e:
        return {'error': f'Login Deciplus échoué : {e}'}

    raw_bookings = _get_upcoming_bookings(token)
    return _process_bookings(raw_bookings, slug, sb)


# ── Legacy iCal sync (conservé pour rétrocompatibilité) ──────────────────────
def _get_setting(sb, key: str) -> str | None:
    try:
        r = sb.table('app_settings').select('value').eq('key', key).limit(1).execute()
        return r.data[0]['value'] if r.data else None
    except Exception:
        return None


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
        try:
            sb       = self._sb()
            sessions = _get_sessions(sb)
            has_creds = bool(os.environ.get('DECIPLUS_EMAIL'))
            self._reply(200, {
                'sessions':        sessions,
                'api_configured':  has_creds,
                'ical_configured': False,  # legacy
            })
        except Exception as e:
            self._reply(500, {'error': str(e)})

    def do_POST(self):
        try:
            length = int(self.headers.get('Content-Length', 0))
            body   = json.loads(self.rfile.read(length)) if length else {}
            action = body.get('action', 'sync')
            sb     = self._sb()

            if action in ('sync', 'sync_ical'):
                self._reply(200, _do_sync_api(sb))

            elif action == 'store_bookings':
                # Reçoit les réservations brutes depuis le navigateur (login côté client)
                raw_bookings = body.get('bookings', [])
                slug         = body.get('slug', 'unknown')
                if not raw_bookings:
                    self._reply(200, {'ok': True, 'synced': 0, 'message': 'Aucune réservation reçue'})
                    return
                self._reply(200, _process_bookings(raw_bookings, slug, sb))

            elif action in ('sync', 'sync_ical'):
                self._reply(200, _do_sync_api(sb))

            elif action == 'debug':
                email    = os.environ.get('DECIPLUS_EMAIL', '').strip()
                password = os.environ.get('DECIPLUS_PASSWORD', '').strip()
                if not email or not password:
                    self._reply(400, {'error': 'DECIPLUS_EMAIL / DECIPLUS_PASSWORD non configurés'})
                    return
                try:
                    token, slug = _deciplus_login(email, password)
                    raw = _get_upcoming_bookings(token)
                    self._reply(200, {'slug': slug, 'raw_count': len(raw), 'sample': raw[:3]})
                except Exception as e:
                    self._reply(500, {'error': str(e)})

            else:
                self._reply(400, {'error': f'action inconnue: {action}'})

        except Exception as e:
            self._reply(500, {'error': str(e)})

    def log_message(self, fmt, *args):
        pass

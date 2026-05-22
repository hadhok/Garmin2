"""
renpho_sync.py — Synchronise les mesures Renpho vers Supabase (table body_metrics).

Variables d'environnement requises :
  RENPHO_EMAIL     — email du compte Renpho
  RENPHO_PASSWORD  — mot de passe du compte Renpho
  SUPABASE_URL     — URL du projet Supabase
  SUPABASE_KEY     — clé service Supabase

Utilisation standalone :
  python3 api/renpho_sync.py
"""
import os, json, hashlib, requests
from datetime import datetime, timezone
from supabase import create_client

RENPHO_BASE    = 'https://renpho.qnclouds.com'
SIGN_IN_PATH   = '/api/v3/users/sign_in.json'
MEASURES_PATH  = '/api/v3/measurements.json'

# ── Authentification ──────────────────────────────────────────────────────────
_RENPHO_HEADERS = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'User-Agent': 'Renpho/5.0 (iPhone; iOS 16.0)',
}

def _renpho_login(email: str, password: str) -> str:
    """Retourne le session_key Renpho."""
    pwd_hash = hashlib.md5(password.encode()).hexdigest()

    # Variantes connues de l'API Renpho
    attempts = [
        {'secure_flag': '1', 'email': email, 'password': pwd_hash},
        {'secure_flag': 1,   'email': email, 'password': pwd_hash},
        {'secure_flag': '1', 'account': email, 'password': pwd_hash},
        {'email': email, 'password': pwd_hash},
    ]

    last_err = None
    for payload in attempts:
        resp = requests.post(
            RENPHO_BASE + SIGN_IN_PATH,
            json=payload,
            headers=_RENPHO_HEADERS,
            timeout=20,
        )
        print(f'[debug] payload={list(payload.keys())} status={resp.status_code} body={resp.text[:300]}')
        if resp.ok:
            data = resp.json()
            token = (data.get('terminal_user_session_key')
                     or data.get('user', {}).get('terminal_user_session_key'))
            if token:
                return token
            raise ValueError(f'Renpho login: token absent dans {data}')
        last_err = resp

    last_err.raise_for_status()

# ── Récupération des mesures ──────────────────────────────────────────────────
def _fetch_measurements(token: str, last_at: str | None = None) -> list[dict]:
    """Retourne la liste des mesures depuis last_at (YYYY-MM-DD) ou tout l'historique."""
    params = {'terminal_user_session_key': token}
    if last_at:
        # Renpho accepte last_at_ymd pour filtrer côté serveur
        params['last_at_ymd'] = last_at.replace('-', '')

    resp = requests.get(RENPHO_BASE + MEASURES_PATH, params=params, timeout=20)
    resp.raise_for_status()
    data = resp.json()
    return data.get('last_ary') or data.get('measurements') or []

# ── Normalisation d'une mesure ─────────────────────────────────────────────────
def _normalize(m: dict) -> dict | None:
    ts = m.get('time_stamp')
    if not ts:
        return None
    try:
        dt   = datetime.fromtimestamp(int(ts), tz=timezone.utc)
        date = dt.strftime('%Y-%m-%d')
    except Exception:
        return None

    def _f(key, divisor=1):
        v = m.get(key)
        return round(float(v) / divisor, 2) if v not in (None, '', '0', 0) else None

    return {
        'date':            date,
        'weight_kg':       _f('weight'),
        'bmi':             _f('bmi'),
        'body_fat_pct':    _f('bodyfat'),
        'muscle_mass_pct': _f('muscle'),
        'bone_mass_kg':    _f('bone'),
        'water_pct':       _f('water'),
        'bmr':             _f('metabolism'),
        'visceral_fat':    _f('physique_rating'),  # some scales use this slot
        'protein_pct':     _f('protein'),
        'body_age':        _f('body_age'),
    }

# ── Sync principal ─────────────────────────────────────────────────────────────
def run_renpho_sync() -> str:
    email    = os.environ.get('RENPHO_EMAIL', '').strip()
    password = os.environ.get('RENPHO_PASSWORD', '').strip()
    if not email or not password:
        return 'RENPHO_EMAIL / RENPHO_PASSWORD non configurés — sync ignoré'

    sb  = create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_KEY'])

    # Date de la dernière mesure connue
    last = sb.table('body_metrics').select('date').order('date', desc=True).limit(1).execute()
    last_at = last.data[0]['date'] if last.data else None

    # Login + fetch
    token    = _renpho_login(email, password)
    raw      = _fetch_measurements(token, last_at)

    rows = [r for m in raw if (r := _normalize(m))]
    if not rows:
        return 'Renpho : aucune nouvelle mesure'

    # Déduplique par date (garde la dernière mesure du jour)
    by_date: dict[str, dict] = {}
    for r in rows:
        by_date[r['date']] = r
    rows = list(by_date.values())

    sb.table('body_metrics').upsert(rows, on_conflict='date').execute()
    return f'Renpho : {len(rows)} mesure(s) synchronisée(s)'


if __name__ == '__main__':
    import sys, pathlib
    # Charger .env si disponible
    env_path = pathlib.Path(__file__).parent.parent / '.env'
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, v = line.split('=', 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"\''))

    try:
        msg = run_renpho_sync()
        print(f'✅ {msg}')
    except Exception as e:
        print(f'❌ Erreur Renpho : {e}')
        import traceback; traceback.print_exc()
        sys.exit(1)

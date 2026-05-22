"""
renpho_sync.py — Synchronise les mesures Renpho Health vers Supabase (table body_metrics).

Variables d'environnement requises :
  RENPHO_EMAIL     — email du compte Renpho Health
  RENPHO_PASSWORD  — mot de passe du compte Renpho Health
  SUPABASE_URL     — URL du projet Supabase
  SUPABASE_KEY     — clé service Supabase

Utilisation standalone :
  python3 api/renpho_sync.py
"""
import os, json, base64, requests
from datetime import datetime, timezone
from Crypto.Cipher import AES
from Crypto.Util.Padding import pad, unpad
from supabase import create_client

RENPHO_BASE  = 'https://cloud.renpho.com'
LOGIN_PATH   = '/renpho-aggregation/user/login'
MEASURE_PATH = '/RenphoHealth/scale/queryAllMeasureDataList'

_AES_KEY = b'ed*wijdi$h6fe3ew'


def _encrypt(data: dict) -> str:
    cipher = AES.new(_AES_KEY, AES.MODE_ECB)
    plaintext = json.dumps(data, separators=(',', ':')).encode()
    return base64.b64encode(cipher.encrypt(pad(plaintext, 16))).decode()


def _decrypt(enc_b64: str) -> dict:
    cipher = AES.new(_AES_KEY, AES.MODE_ECB)
    return json.loads(unpad(cipher.decrypt(base64.b64decode(enc_b64)), 16))


# ── Authentification ──────────────────────────────────────────────────────────
def _renpho_login(email: str, password: str) -> tuple[str, str]:
    """Retourne (token, user_id)."""
    payload = {
        'questionnaire': {},
        'login': {
            'email': email,
            'password': password,
            'areaCode': '',
            'appRevision': '3.0.0',
            'cellphoneType': '0',
            'systemType': '0',
            'platform': 'android',
        },
        'bindingList': {'deviceTypes': ['2']},
    }
    resp = requests.post(
        RENPHO_BASE + LOGIN_PATH,
        json={'encryptData': _encrypt(payload)},
        headers={'Content-Type': 'application/json'},
        timeout=20,
    )
    resp.raise_for_status()
    outer = resp.json()
    if outer.get('code') not in (101, 200, '101', '200', 0, '0'):
        raise ValueError(f'Renpho login failed: {outer}')
    inner   = _decrypt(outer['data'])
    login   = inner.get('login') or inner
    token   = login.get('token') or login.get('accessToken') or ''
    user_id = str(login.get('id') or login.get('userId') or '')
    if not token:
        raise ValueError(f'Token absent dans {inner}')
    return token, user_id


# ── Récupération des mesures ──────────────────────────────────────────────────
def _fetch_measurements(token: str, user_id: str, last_at: str | None = None) -> list[dict]:
    payload = {
        'userId': user_id,
        'lastDate': last_at.replace('-', '') if last_at else '19700101',
    }
    resp = requests.post(
        RENPHO_BASE + MEASURE_PATH,
        json={'encryptData': _encrypt(payload)},
        headers={
            'Content-Type': 'application/json',
            'token': token,
            'userId': user_id,
            'appVersion': '3.0.0',
            'platform': 'android',
        },
        timeout=20,
    )
    resp.raise_for_status()
    outer = resp.json()
    if outer.get('code') not in (101, 200, '101', '200', 0, '0'):
        raise ValueError(f'Renpho mesures error: {outer}')
    inner = _decrypt(outer['data'])
    return (inner.get('measureDataList')
            or inner.get('list')
            or inner.get('data')
            or [])


# ── Normalisation d'une mesure ─────────────────────────────────────────────────
def _normalize(m: dict) -> dict | None:
    # Renpho Health peut utiliser measureTime (ms) ou timeStamp (s)
    ts = m.get('measureTime') or m.get('timeStamp') or m.get('time_stamp')
    if not ts:
        return None
    try:
        ts_int = int(ts)
        # measureTime est en millisecondes si > 1e10
        if ts_int > 1_000_000_000_000:
            ts_int //= 1000
        dt   = datetime.fromtimestamp(ts_int, tz=timezone.utc)
        date = dt.strftime('%Y-%m-%d')
    except Exception:
        return None

    def _f(*keys):
        for k in keys:
            v = m.get(k)
            if v not in (None, '', '0', 0):
                try:
                    return round(float(v), 2)
                except Exception:
                    pass
        return None

    return {
        'date':            date,
        'weight_kg':       _f('weight', 'weightKg'),
        'bmi':             _f('bmi'),
        'body_fat_pct':    _f('bodyFat', 'bodyfat', 'fatRate'),
        'muscle_mass_pct': _f('muscleMass', 'muscle', 'muscleRate'),
        'bone_mass_kg':    _f('boneMass', 'bone'),
        'water_pct':       _f('waterRate', 'water'),
        'bmr':             _f('bmr', 'metabolism'),
        'visceral_fat':    _f('visceralFat', 'physique_rating'),
        'protein_pct':     _f('proteinRate', 'protein'),
        'body_age':        _f('bodyAge', 'body_age'),
    }


# ── Sync principal ─────────────────────────────────────────────────────────────
def run_renpho_sync() -> str:
    email    = os.environ.get('RENPHO_EMAIL', '').strip()
    password = os.environ.get('RENPHO_PASSWORD', '').strip()
    if not email or not password:
        return 'RENPHO_EMAIL / RENPHO_PASSWORD non configurés — sync ignoré'

    sb = create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_KEY'])

    last = sb.table('body_metrics').select('date').order('date', desc=True).limit(1).execute()
    last_at = last.data[0]['date'] if last.data else None

    token, user_id = _renpho_login(email, password)
    raw = _fetch_measurements(token, user_id, last_at)

    rows = [r for m in raw if (r := _normalize(m))]
    if not rows:
        return 'Renpho : aucune nouvelle mesure'

    by_date: dict[str, dict] = {}
    for r in rows:
        by_date[r['date']] = r
    rows = list(by_date.values())

    sb.table('body_metrics').upsert(rows, on_conflict='date').execute()
    return f'Renpho : {len(rows)} mesure(s) synchronisée(s)'


if __name__ == '__main__':
    import sys, pathlib
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

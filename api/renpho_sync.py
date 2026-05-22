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
DEVICE_PATH  = '/renpho-aggregation/device/count'
MEASURE_PATH = '/RenphoHealth/scale/queryAllMeasureDataList'

_AES_KEY = b'ed*wijdi$h6fe3ew'


def _encrypt(data) -> str:
    cipher = AES.new(_AES_KEY, AES.MODE_ECB)
    plaintext = json.dumps(data, separators=(',', ':')).encode()
    return base64.b64encode(cipher.encrypt(pad(plaintext, 16))).decode()


def _decrypt(enc_b64: str) -> dict:
    cipher = AES.new(_AES_KEY, AES.MODE_ECB)
    return json.loads(unpad(cipher.decrypt(base64.b64decode(enc_b64)), 16))


def _headers(token: str, user_id: str) -> dict:
    return {
        'Content-Type': 'application/json',
        'token': token,
        'userId': user_id,
        'appVersion': '7.0.0',
        'platform': 'android',
    }


# ── Authentification ──────────────────────────────────────────────────────────
def _renpho_login(email: str, password: str) -> tuple[str, str]:
    """Retourne (token, user_id)."""
    payload = {
        'questionnaire': {},
        'login': {
            'email': email,
            'password': password,
            'areaCode': 'FR',
            'appRevision': '7.0.0',
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


# ── Récupération des balances ─────────────────────────────────────────────────
def _get_scale_tables(token: str, user_id: str) -> list[dict]:
    """Retourne [{table_name, user_ids}] pour chaque balance."""
    resp = requests.post(
        RENPHO_BASE + DEVICE_PATH,
        json={'encryptData': _encrypt({})},
        headers=_headers(token, user_id),
        timeout=20,
    )
    resp.raise_for_status()
    outer = resp.json()
    if outer.get('code') not in (101, 200, '101', '200', 0, '0'):
        raise ValueError(f'Device info error: {outer}')
    inner  = _decrypt(outer['data'])
    scales = inner.get('scale') or []
    result = [
        {
            'table_name': s['tableName'],
            'user_ids':   [str(uid) for uid in (s.get('userIds') or [user_id])],
        }
        for s in scales if s.get('tableName')
    ]
    return result or [{'table_name': 'scale_users', 'user_ids': [user_id]}]


# ── Récupération des mesures ──────────────────────────────────────────────────
def _fetch_measurements(token: str, user_id: str,
                        table_name: str, user_ids: list[str]) -> list[dict]:
    """Pagine toutes les mesures d'une balance."""
    all_data: list[dict] = []
    page = 1
    while True:
        payload = {
            'pageNum':   page,
            'pageSize':  50,
            'tableName': table_name,
            'userIds':   user_ids,
        }
        resp = requests.post(
            RENPHO_BASE + MEASURE_PATH,
            json={'encryptData': _encrypt(payload)},
            headers=_headers(token, user_id),
            timeout=20,
        )
        resp.raise_for_status()
        outer = resp.json()
        if outer.get('code') not in (101, 200, '101', '200', 0, '0'):
            raise ValueError(f'Renpho mesures error: {outer}')
        inner = _decrypt(outer['data'])
        if isinstance(inner, list):
            data = inner
        else:
            data = (inner.get('measureDataList')
                    or inner.get('list')
                    or inner.get('data')
                    or [])
        if not data:
            break
        all_data.extend(data)
        if len(data) < 50:
            break
        page += 1
    return all_data


# ── Normalisation d'une mesure ─────────────────────────────────────────────────
def _normalize(m: dict) -> dict | None:
    ts = m.get('measureTime') or m.get('timeStamp') or m.get('time_stamp')
    if not ts:
        return None
    try:
        ts_int = int(ts)
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

    token, user_id  = _renpho_login(email, password)
    scale_tables    = _get_scale_tables(token, user_id)

    raw: list[dict] = []
    for st in scale_tables:
        raw.extend(_fetch_measurements(token, user_id, st['table_name'], st['user_ids']))

    rows = [r for m in raw if (r := _normalize(m))]

    # Filtre client-side si on a une date de référence
    if last_at and rows:
        rows = [r for r in rows if r['date'] >= last_at]

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

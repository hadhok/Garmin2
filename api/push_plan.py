from http.server import BaseHTTPRequestHandler
import json as _json
import sys

"""
push_plan.py — Génère le plan de la semaine et l'injecte dans Garmin Connect.

Algorithme miroir de js/running.js :
  1. Calcul CTL/ATL/TSB depuis les activités locales
  2. Lecture HRV + Body Battery depuis wellness
  3. Détermination du type de semaine (récup / normale / charge)
  4. Construction des séances Garmin (étapes avec cibles FC)
  5. Upload + scheduling sur Garmin Connect
"""

import os, json
from datetime import date, timedelta
from math import exp

sys.path.insert(0, os.path.dirname(__file__))
from _auth import check_auth

BASE = os.path.dirname(os.path.abspath(__file__))

# ── Paramètres utilisateur ─────────────────────────────────────────────────────
HR_REST  = 62
HR_MAX   = 177
MIN_DIST = 3.0   # km

# Zones FC (% HRmax) : Z1=49-58, Z2=58-69, Z3=69-80, Z4=80-90, Z5=90-100
HR_ZONES = [
    {'z': 1, 'pct_min': 0.49, 'pct_max': 0.58},
    {'z': 2, 'pct_min': 0.58, 'pct_max': 0.69},
    {'z': 3, 'pct_min': 0.69, 'pct_max': 0.80},
    {'z': 4, 'pct_min': 0.80, 'pct_max': 0.90},
    {'z': 5, 'pct_min': 0.90, 'pct_max': 1.00},
]

def zone_bpm(z):
    """Retourne (hr_min, hr_max) en bpm pour une zone."""
    zn = HR_ZONES[z - 1]
    return int(zn['pct_min'] * HR_MAX), int(zn['pct_max'] * HR_MAX)

_HR_TARGET_TYPE = {
    "workoutTargetTypeId": 4,
    "workoutTargetTypeKey": "heart.rate.zone",
    "displayOrder": 4,
}

def make_step(factory_fn, duration_sec, step_order, zone):
    """
    Crée une étape avec cible FC correctement injectée.
    targetValueOne/Two doivent être des champs extra au niveau du step
    (pas dans targetType), d'où l'injection via __pydantic_extra__.
    """
    mn, mx = zone_bpm(zone)
    step = factory_fn(
        duration_sec,
        step_order=step_order,
        target_type=dict(_HR_TARGET_TYPE),
    )
    step.__pydantic_extra__['targetValueOne'] = mn
    step.__pydantic_extra__['targetValueTwo'] = mx
    return step

def no_target():
    return {"workoutTargetTypeId": 1, "workoutTargetTypeKey": "no.target", "displayOrder": 1}

# ── Calcul TRIMP (Banister) ────────────────────────────────────────────────────
def trimp(dur_min, hr_avg):
    ratio = (hr_avg - HR_REST) / (HR_MAX - HR_REST)
    if ratio <= 0: return 0
    return round(dur_min * ratio * 0.64 * exp(1.92 * ratio))

def trimp_for_session(dur_min, zone, pct_in_zone=0.8):
    z = HR_ZONES[zone - 1]
    hr_avg = ((z['pct_min'] + z['pct_max']) / 2) * HR_MAX
    ratio  = (hr_avg - HR_REST) / (HR_MAX - HR_REST)
    main   = dur_min * pct_in_zone * ratio * 0.64 * exp(1.92 * ratio)
    z2     = HR_ZONES[1]
    hr2    = ((z2['pct_min'] + z2['pct_max']) / 2) * HR_MAX
    r2     = (hr2 - HR_REST) / (HR_MAX - HR_REST)
    warm   = dur_min * (1 - pct_in_zone) * r2 * 0.64 * exp(1.92 * r2)
    return round(main + warm)

# ── CTL / ATL / TSB ───────────────────────────────────────────────────────────
def compute_ctl_atl(activities):
    today = date.today()
    load_by_date = {}
    for a in activities:
        d = (a.get('date') or '')[:10]
        if d:
            load_by_date[d] = load_by_date.get(d, 0) + (a.get('training_load') or 0)

    ctl, atl = 0.0, 0.0
    for i in range(179, -1, -1):
        d    = (today - timedelta(days=i)).isoformat()
        load = load_by_date.get(d, 0)
        ctl  = ctl + (load - ctl) / 42
        atl  = atl + (load - atl) / 7

    return round(ctl, 1), round(atl, 1), round(ctl - atl, 1)

# ── Type de semaine ────────────────────────────────────────────────────────────
def determine_week_type(ctl, atl, tsb, hrv=None, body_battery=None):
    hrv_low = hrv is not None and hrv < 40
    bb_low  = body_battery is not None and body_battery < 30
    fatigue = 'high' if tsb < -20 else ('medium' if tsb < -10 else 'low')

    if fatigue == 'high' or (fatigue == 'medium' and (hrv_low or bb_low)):
        reason = f"TSB {tsb:.1f}"
        if hrv_low: reason += f" + HRV {hrv:.0f}ms basse"
        if bb_low:  reason += f" + Battery {body_battery:.0f}% faible"
        return 'recovery', reason
    elif fatigue == 'medium':
        return 'normal', f"TSB {tsb:.1f} — progression modérée"
    else:
        return 'loading', f"TSB {tsb:.1f} — semaine de charge"

# ── Plan 7 jours ──────────────────────────────────────────────────────────────
SESSION_CATALOG = {
    'rest':      {'label': 'Repos',                'zone': 0,  'dur': 0,   'icon': '😴'},
    'recov':     {'label': 'Footing récupération', 'zone': 1,  'dur': 30,  'icon': '🚶'},
    'easy':      {'label': 'Endurance facile',     'zone': 2,  'dur': 45,  'icon': '🏃'},
    'easy_long': {'label': 'Sortie longue',        'zone': 2,  'dur': 65,  'icon': '🏃'},
    'tempo':     {'label': 'Tempo',                'zone': 3,  'dur': 45,  'icon': '⚡'},
    'threshold': {'label': 'Seuil',               'zone': 4,  'dur': 50,  'icon': '🔥'},
    'interval':  {'label': 'Fractionné',           'zone': 5,  'dur': 55,  'icon': '💥'},
}

WEEK_TEMPLATES = {
    'recovery': ['rest','recov','rest','easy', 'rest','easy',      'rest'],
    'normal':   ['rest','easy', 'tempo','rest','easy','easy_long', 'rest'],
    'loading':  ['rest','easy', 'threshold','easy','rest','easy_long','interval'],
}
DAYS = ['Lun','Mar','Mer','Jeu','Ven','Sam','Dim']

def build_week_plan(week_type, week_type_reason):
    template = WEEK_TEMPLATES[week_type]
    plan = []
    today = date.today()
    # Trouver le prochain lundi
    days_to_monday = (7 - today.weekday()) % 7
    if days_to_monday == 0: days_to_monday = 7   # si on est lundi, semaine prochaine
    next_monday = today + timedelta(days=days_to_monday)

    for i, (day_label, session_id) in enumerate(zip(DAYS, template)):
        s = SESSION_CATALOG[session_id].copy()
        s['id']   = session_id
        s['day']  = day_label
        s['date'] = (next_monday + timedelta(days=i)).isoformat()
        if s['zone']:
            s['trimp'] = trimp_for_session(
                s['dur'],
                s['zone'],
                pct_in_zone=0.8 if s['zone'] <= 2 else 0.5
            )
        else:
            s['trimp'] = 0
        plan.append(s)
    return plan

# ── Construction des workouts Garmin ──────────────────────────────────────────
def build_garmin_workout(session):
    from garminconnect.workout import (
        RunningWorkout, WorkoutSegment,
        create_warmup_step, create_interval_step,
        create_cooldown_step, create_recovery_step, create_repeat_group,
    )

    sid   = session['id']
    label = session['label']
    zone  = session['zone']
    dur   = session['dur']

    # ── Footing récupération : 30 min Z1 continu ──────────────────────────────
    if sid == 'recov':
        steps = [
            make_step(create_interval_step, dur * 60, 1, 1),
        ]

    # ── Endurance facile : 10 éch + 25/45 Z2 + 10 retour ────────────────────
    elif sid in ('easy', 'easy_long'):
        main_dur = dur - 20   # après éch + retour
        steps = [
            make_step(create_warmup_step,  10 * 60,       1, 1),
            make_step(create_interval_step, main_dur * 60, 2, 2),
            make_step(create_cooldown_step, 10 * 60,       3, 1),
        ]

    # ── Tempo : 15 éch + 20 min Z3 + 10 retour ───────────────────────────────
    elif sid == 'tempo':
        steps = [
            make_step(create_warmup_step,   15 * 60, 1, 2),
            make_step(create_interval_step, 20 * 60, 2, 3),
            make_step(create_cooldown_step, 10 * 60, 3, 2),
        ]

    # ── Seuil : 15 éch + 3×8 min Z4 (2 min récup) + 5 retour ────────────────
    elif sid == 'threshold':
        interval_step = make_step(create_interval_step, 8 * 60, 1, 4)
        recov_step    = make_step(create_recovery_step,  2 * 60, 2, 1)
        repeat_block  = create_repeat_group(
            iterations=3,
            workout_steps=[interval_step, recov_step],
            step_order=2,
        )
        steps = [
            make_step(create_warmup_step,   15 * 60, 1, 2),
            repeat_block,
            make_step(create_cooldown_step,  5 * 60, 3, 2),
        ]

    # ── Fractionné : 15 éch + 6×3 min Z5 (90 s récup) + 12 retour ───────────
    elif sid == 'interval':
        interval_step = make_step(create_interval_step, 3 * 60, 1, 5)
        recov_step    = make_step(create_recovery_step,      90, 2, 1)
        repeat_block  = create_repeat_group(
            iterations=6,
            workout_steps=[interval_step, recov_step],
            step_order=2,
        )
        steps = [
            make_step(create_warmup_step,   15 * 60, 1, 2),
            repeat_block,
            make_step(create_cooldown_step, 12 * 60, 3, 2),
        ]

    else:
        return None

    mn, mx = zone_bpm(zone)
    segment = WorkoutSegment(
        segmentOrder=1,
        sportType={"sportTypeId": 1, "sportTypeKey": "running", "displayOrder": 1},
        workoutSteps=steps,
    )
    workout = RunningWorkout(
        workoutName=label,
        description=f"Plan généré auto | Z{zone} ({mn}–{mx} bpm) | {dur} min",
        estimatedDurationInSecs=dur * 60,
        workoutSegments=[segment],
    )
    return workout

# ── Garmin client (depuis tokens Supabase) ────────────────────────────────────
def _get_garmin_client():
    from supabase import create_client
    from garminconnect import Garmin

    sb = create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_KEY'])
    tok = sb.table('garmin_tokens').select('tokens').eq('id', 1).limit(1).execute()
    if not tok.data or not tok.data[0].get('tokens'):
        raise Exception("Tokens Garmin introuvables.")

    token_dir = '/tmp/garth_tokens'
    os.makedirs(token_dir, exist_ok=True)
    with open(os.path.join(token_dir, 'garmin_tokens.json'), 'w') as f:
        json.dump(tok.data[0]['tokens'], f)

    client = Garmin()
    client.login(token_dir)
    return client

# ── Fonction principale ───────────────────────────────────────────────────────
def push_plan_to_garmin():
    print("📋 Génération du plan de la semaine…")

    # 1. Charger les données locales
    acts_file  = os.path.join(BASE, 'data', 'activities.json')
    well_file  = os.path.join(BASE, 'data', 'wellness.json')

    with open(acts_file) as f:
        activities = json.load(f)['activities']
    with open(well_file) as f:
        wellness = json.load(f).get('days', {})

    # 2. CTL / ATL / TSB
    ctl, atl, tsb = compute_ctl_atl(activities)
    print(f"   CTL {ctl}  ATL {atl}  TSB {tsb}")

    # 3. Wellness récent
    sorted_well = sorted(wellness.values(), key=lambda w: w.get('date',''), reverse=True)
    last_hrv = next((w['hrv_weekly_avg'] for w in sorted_well if (w.get('hrv_weekly_avg') or 0) > 0), None)
    last_bb  = sorted_well[0].get('body_battery_end') if sorted_well else None
    if last_hrv: print(f"   HRV {last_hrv:.0f} ms")
    if last_bb:  print(f"   Body Battery {last_bb:.0f}%")

    # 4. Type de semaine
    week_type, reason = determine_week_type(ctl, atl, tsb, last_hrv, last_bb)
    type_labels = {'recovery': '🟢 Récupération', 'normal': '🔵 Normale', 'loading': '🟠 Charge'}
    print(f"\n   → {type_labels[week_type]} — {reason}")

    # 5. Plan 7 jours
    plan = build_week_plan(week_type, reason)
    sessions = [s for s in plan if s['id'] != 'rest']
    print(f"\n   Séances prévues ({len(sessions)}) :")
    for s in sessions:
        print(f"     {s['day']} {s['date']} — {s['label']} ({s['dur']} min, Z{s['zone']}, TRIMP {s['trimp']})")

    # 6. Connexion Garmin
    print("\n🔗 Connexion à Garmin Connect…")
    client = _get_garmin_client()
    print("   ✓ Connecté")

    # 7. Supprimer les anciens workouts générés auto (évite les doublons)
    try:
        existing = client.get_workouts(0, 50)
        for w in existing:
            if 'Plan généré auto' in (w.get('description') or ''):
                client.delete_workout(w['workoutId'])
                print(f"   🗑  Supprimé : {w['workoutName']}")
    except Exception as e:
        print(f"   ⚠️  Nettoyage : {e}")

    # 8. Upload + scheduling
    print("\n📤 Upload des séances…")
    pushed = []
    for s in sessions:
        try:
            garmin_workout = build_garmin_workout(s)
            if garmin_workout is None:
                continue

            result = client.upload_running_workout(garmin_workout)
            wid    = result.get('workoutId')
            if not wid:
                print(f"   ⚠️  {s['label']} — pas d'ID retourné")
                continue

            client.schedule_workout(wid, s['date'])
            print(f"   ✅ {s['day']} {s['date']} — {s['label']} [id={wid}]")
            pushed.append({'id': wid, 'label': s['label'], 'date': s['date']})

        except Exception as e:
            print(f"   ❌ {s['label']} — {e}")

    print(f"\n✅ {len(pushed)}/{len(sessions)} séances injectées dans Garmin Connect")
    return pushed


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if not check_auth(self): return
        try:
            pushed = push_plan_to_garmin()
            body   = _json.dumps({'ok': True, 'pushed': len(pushed), 'sessions': pushed})
            code   = 200
        except Exception as e:
            body = _json.dumps({'ok': False, 'error': str(e)})
            code = 500

        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(body.encode())

    def log_message(self, fmt, *args):
        pass

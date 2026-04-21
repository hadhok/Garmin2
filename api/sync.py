from http.server import BaseHTTPRequestHandler
import json, os
from datetime import datetime, timedelta

# ── Mapping typeKey Garmin → code interne (copie de sync.py racine) ──────────
TYPE_MAP = {
    'running': 'run', 'trail_running': 'run', 'treadmill_running': 'run',
    'track_running': 'run', 'ultra_run': 'run', 'obstacle_run': 'run',
    'cycling': 'bike', 'road_biking': 'bike', 'mountain_biking': 'bike',
    'indoor_cycling': 'bike', 'gravel_cycling': 'bike', 'virtual_ride': 'bike',
    'lap_swimming': 'swim', 'open_water_swimming': 'swim',
    'strength_training': 'strength', 'fitness_equipment': 'strength',
    'hiit_training': 'hiit', 'cross_training': 'hiit',
    'cardio_training': 'cardio',
    'indoor_rowing': 'rowing', 'rowing': 'rowing',
    'jump_rope': 'jump_rope',
    'tennis': 'tennis', 'padel_tennis': 'padel',
    'racquetball': 'tennis', 'squash': 'tennis',
    'rink_hockey': 'hockey', 'ice_hockey': 'hockey', 'floor_hockey': 'hockey',
    'hiking': 'hike', 'walking': 'walk',
    'backcountry_skiing_snowboarding_ws': 'ski',
    'resort_skiing_snowboarding_ws': 'ski', 'skate_skiing_ws': 'ski',
    'stand_up_paddleboarding': 'sup',
    'yoga': 'yoga', 'pilates': 'pilates', 'bouldering': 'other',
}
NAME_MAP = [
    (['hiit', 'hyrox', 'athletx'],                   'hiit'),
    (['rameur', 'rowing'],                            'rowing'),
    (['jump rope', 'corde à sauter'],                 'jump_rope'),
    (['strong', 'muscul', 'force', 'bas du corps',
      'full body', 'haut du corps', 'jambes'],        'strength'),
    (['cardio'],                                      'cardio'),
    (['rink hockey', 'hockey sur patins'],            'hockey'),
    (['hockey sur glace', 'ice hockey'],              'hockey'),
    (['tennis'],                                      'tennis'),
    (['padel'],                                       'padel'),
    (['ski', 'snowboard'],                            'ski'),
    (['stand up paddle', 'sup', 'paddle'],            'sup'),
    (['pilates'],                                     'pilates'),
    (['yoga'],                                        'yoga'),
    (['course', 'running', 'entraînement course',
      'base -', 'seuil -', 'vo2', 'anaérobie'],      'run'),
]
TYPE_LABELS = {
    'run': 'Course à pied', 'bike': 'Vélo', 'swim': 'Natation',
    'strength': 'Musculation', 'hiit': 'HIIT', 'cardio': 'Cardio',
    'rowing': 'Rameur', 'jump_rope': 'Jump Rope', 'hockey': 'Hockey',
    'tennis': 'Tennis', 'padel': 'Padel', 'ski': 'Ski',
    'sup': 'Stand-up Paddle', 'pilates': 'Pilates', 'yoga': 'Yoga',
    'hike': 'Randonnée', 'walk': 'Marche', 'other': 'Autre',
}
TYPE_ICONS = {
    'run': '🏃', 'bike': '🚴', 'swim': '🏊', 'strength': '🏋️',
    'hiit': '🔥', 'cardio': '❤️', 'rowing': '🚣', 'jump_rope': '🪢',
    'hockey': '🏒', 'tennis': '🎾', 'padel': '🎾', 'ski': '⛷️',
    'sup': '🏄', 'pilates': '🧘', 'yoga': '🧘', 'hike': '🥾',
    'walk': '🚶', 'other': '⚡',
}


def _format_pace(speed_ms):
    if not speed_ms or speed_ms <= 0:
        return None
    secs = 1000 / speed_ms
    return f"{int(secs // 60)}:{int(secs % 60):02d}"


def _normalize(raw):
    type_key = raw.get('activityType', {}).get('typeKey', 'other')
    act_type = TYPE_MAP.get(type_key, 'other')
    if act_type == 'other':
        name_lower = (raw.get('activityName') or '').lower()
        for keywords, mapped in NAME_MAP:
            if any(kw in name_lower for kw in keywords):
                act_type = mapped
                break

    dist_m   = raw.get('distance', 0) or 0
    dur_s    = raw.get('duration', 0) or 0
    speed_ms = raw.get('averageSpeed', 0) or 0
    is_run   = act_type in ('run', 'hike', 'walk')
    is_bike  = act_type == 'bike'

    zones_s     = [raw.get(f'hrTimeInZone_{i}', 0) or 0 for i in range(1, 6)]
    zones_total = sum(zones_s)
    hr_zones    = [round(z / zones_total * 100) for z in zones_s] if zones_total > 0 else None

    EFFECT = {
        'RECOVERY': 'Récupération', 'BASE': 'Base', 'IMPROVING': 'Amélioration',
        'TEMPO': 'Tempo', 'THRESHOLD': 'Seuil', 'OVERREACHING': 'Surcharge',
        'NO_AEROBIC_BENEFIT': 'Aucun', 'RECOVERY_5': 'Récupération',
    }
    te = raw.get('trainingEffectLabel') or raw.get('aerobicTrainingEffectMessage', '')
    te = EFFECT.get(te, te.replace('_', ' ').title() if te else None)

    return {
        'id':            raw.get('activityId'),
        'name':          raw.get('activityName', ''),
        'type':          act_type,
        'type_label':    TYPE_LABELS.get(act_type, act_type),
        'icon':          TYPE_ICONS.get(act_type, '⚡'),
        'date':          (raw.get('startTimeLocal') or '')[:10],
        'start_time':    raw.get('startTimeLocal', ''),
        'duration_min':  round(dur_s / 60, 1),
        'distance_km':   round(dist_m / 1000, 2),
        'calories':      int(raw.get('calories', 0) or 0),
        'hr_avg':        int(raw.get('averageHR')) if raw.get('averageHR') is not None else None,
        'hr_max':        int(raw.get('maxHR')) if raw.get('maxHR') is not None else None,
        'elevation_m':   raw.get('elevationGain', 0) or 0,
        'pace_min_km':   _format_pace(speed_ms) if is_run else None,
        'speed_kmh':     round(speed_ms * 3.6, 1) if is_bike else None,
        'training_load': round(raw.get('activityTrainingLoad', 0) or 0, 1),
        'aerobic_te':    round(raw.get('aerobicTrainingEffect', 0) or 0, 1),
        'anaerobic_te':  round(raw.get('anaerobicTrainingEffect', 0) or 0, 1),
        'te_label':      te,
        'intensity_min': (raw.get('moderateIntensityMinutes') or 0) + (raw.get('vigorousIntensityMinutes') or 0) * 2,
        'vo2max':        raw.get('vO2MaxValue'),
        'hr_zones_pct':  hr_zones,
    }


def _run_sync():
    from supabase import create_client
    from garminconnect import Garmin

    sb_url = os.environ['SUPABASE_URL']
    sb_key = os.environ['SUPABASE_KEY']
    sb = create_client(sb_url, sb_key)

    # ── Charger les tokens depuis Supabase ───────────────────────────────────
    tok = sb.table('garmin_tokens').select('tokens').eq('id', 1).limit(1).execute()
    if not tok.data or not tok.data[0].get('tokens'):
        raise Exception("Tokens Garmin introuvables. Lance setup_supabase_tokens.py d'abord.")

    token_dir = '/tmp/garth_tokens'
    os.makedirs(token_dir, exist_ok=True)
    with open(os.path.join(token_dir, 'garmin_tokens.json'), 'w') as f:
        json.dump(tok.data[0]['tokens'], f)

    # ── Connexion ────────────────────────────────────────────────────────────
    client = Garmin()
    client.login(token_dir)

    # ── Activités : récupère depuis la dernière date en DB ───────────────────
    last = sb.table('activities').select('date').order('date', desc=True).limit(1).execute()
    if last.data:
        since = datetime.strptime(last.data[0]['date'], '%Y-%m-%d') - timedelta(days=3)
    else:
        since = datetime.now() - timedelta(days=365)

    now = datetime.now()
    raw_acts = client.get_activities_by_date(since.strftime('%Y-%m-%d'), now.strftime('%Y-%m-%d'))
    normalized = [_normalize(r) for r in raw_acts if r.get('activityId')]

    if normalized:
        # Upsert par batch de 50
        for i in range(0, len(normalized), 50):
            sb.table('activities').upsert(normalized[i:i+50]).execute()

    # ── Poids / composition corporelle : 90 derniers jours (1 seul appel) ──────
    today = now.date()
    weight_by_date = {}
    try:
        since_90 = (today - timedelta(days=90)).strftime('%Y-%m-%d')
        comp = client.get_body_composition(since_90, today.strftime('%Y-%m-%d'))
        for w in (comp.get('dateWeightList') or []):
            cal   = w.get('calendarDate')
            grams = w.get('weight') or 0
            if cal and grams > 0:
                weight_by_date[cal] = {
                    'weight_kg': round(grams / 1000, 1),
                    'bmi':       round(w['bmi'], 1) if w.get('bmi') else None,
                    'body_fat':  round(w['bodyFat'], 1) if w.get('bodyFat') else None,
                }
    except Exception:
        pass

    # ── Wellness : 7 derniers jours ──────────────────────────────────────────
    wellness_records = []
    for i in range(7):
        date_str = (today - timedelta(days=i)).strftime('%Y-%m-%d')
        try:
            sleep_raw = client.get_sleep_data(date_str)
            stats_raw = client.get_stats(date_str)
            dto = sleep_raw.get('dailySleepDTO', {})
            wdata = weight_by_date.get(date_str, {})
            day = {
                'date': date_str,
                'sleep_total_min':        round((dto.get('sleepTimeSeconds') or 0) / 60),
                'sleep_deep_min':         round((dto.get('deepSleepSeconds') or 0) / 60),
                'sleep_light_min':        round((dto.get('lightSleepSeconds') or 0) / 60),
                'sleep_rem_min':          round((dto.get('remSleepSeconds') or 0) / 60),
                'sleep_awake_min':        round((dto.get('awakeSleepSeconds') or 0) / 60),
                'sleep_hr_avg':           dto.get('avgHeartRate'),
                'sleep_stress_avg':       dto.get('avgSleepStress'),
                'sleep_respiration_avg':  dto.get('averageRespirationValue'),
                'hrv_overnight_avg':      sleep_raw.get('avgOvernightHrv'),
                'hrv_status':             sleep_raw.get('hrvStatus'),
                'body_battery_high':      stats_raw.get('bodyBatteryHighestValue'),
                'body_battery_low':       stats_raw.get('bodyBatteryLowestValue'),
                'body_battery_end':       stats_raw.get('bodyBatteryMostRecentValue'),
                'steps':                  stats_raw.get('totalSteps'),
                'steps_goal':             stats_raw.get('dailyStepGoal'),
                'calories_active':        stats_raw.get('activeKilocalories'),
                'stress_avg':             stats_raw.get('averageStressLevel'),
                'stress_pct_rest':        stats_raw.get('restStressPercentage'),
                'stress_pct_low':         stats_raw.get('lowStressPercentage'),
                'stress_pct_medium':      stats_raw.get('activityStressPercentage'),
                'stress_pct_high':        stats_raw.get('highStressPercentage'),
                'resting_hr':             stats_raw.get('restingHeartRate'),
                'intensity_min_moderate': stats_raw.get('moderateIntensityMinutes'),
                'intensity_min_vigorous': stats_raw.get('vigorousIntensityMinutes'),
                # ── Poids ────────────────────────────────────────────────────
                'weight_kg':  wdata.get('weight_kg'),
                'bmi':        wdata.get('bmi'),
                'body_fat':   wdata.get('body_fat'),
            }
            wellness_records.append({'date': date_str, 'data': day})
        except Exception:
            pass

    if wellness_records:
        sb.table('wellness_days').upsert(wellness_records).execute()

    # ── Backfill poids pour les jours > 7 jours déjà en DB ──────────────────
    recent_dates = {(today - timedelta(days=i)).strftime('%Y-%m-%d') for i in range(7)}
    older_weight = {d: w for d, w in weight_by_date.items() if d not in recent_dates}
    for date_old, wdata in older_weight.items():
        try:
            ex = sb.table('wellness_days').select('data').eq('date', date_old).limit(1).execute()
            if ex.data:
                merged = dict(ex.data[0].get('data') or {})
                merged.update(wdata)
                sb.table('wellness_days').update({'data': merged}).eq('date', date_old).execute()
            else:
                sb.table('wellness_days').upsert({
                    'date': date_old,
                    'data': {'date': date_old, **wdata},
                }).execute()
        except Exception:
            pass

    # ── Sauvegarder les tokens rafraîchis ────────────────────────────────────
    try:
        with open(os.path.join(token_dir, 'garmin_tokens.json')) as f:
            new_tokens = json.load(f)
        sb.table('garmin_tokens').upsert({
            'id': 1, 'tokens': new_tokens,
            'updated_at': now.isoformat(),
        }).execute()
    except Exception:
        pass

    # ── Mettre à jour sync_meta ──────────────────────────────────────────────
    total_r = sb.table('activities').select('id', count='exact').execute()
    total   = total_r.count or 0
    sb.table('sync_meta').upsert({
        'id': 1,
        'last_sync': now.isoformat(timespec='seconds'),
        'total_activities': total,
    }).execute()

    return f"{len(normalized)} activités + {len(wellness_records)} jours wellness synchronisés (total : {total} activités)"


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            msg  = _run_sync()
            body = json.dumps({'status': 'ok', 'message': msg})
            code = 200
        except Exception as e:
            body = json.dumps({'status': 'error', 'message': str(e)})
            code = 500

        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(body.encode())

    def log_message(self, fmt, *args):
        pass

#!/usr/bin/env python3
"""
Garmin Connect → activities.json
Nécessite une auth initiale : python3 setup_garmin.py (une seule fois)
Usage :
  python3 sync.py
"""
import os, sys, json, argparse
from datetime import datetime, timedelta
from garminconnect import Garmin

# ── Config ──────────────────────────────────────────────────────────────────
FETCH_LIMIT    = 200  # nb d'activités à récupérer depuis Garmin Connect
WELLNESS_DAYS  = 90   # nb de jours de données sommeil/wellness à récupérer
DATA_FILE      = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'activities.json')
WELLNESS_FILE  = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'wellness.json')
TOKEN_DIR      = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.garth_tokens')

# ── Mapping typeKey Garmin → code interne ───────────────────────────────────
TYPE_MAP = {
    # Course
    'running':                              'run',
    'trail_running':                        'run',
    'treadmill_running':                    'run',
    'track_running':                        'run',
    'ultra_run':                            'run',
    'obstacle_run':                         'run',
    # Vélo
    'cycling':                              'bike',
    'road_biking':                          'bike',
    'mountain_biking':                      'bike',
    'indoor_cycling':                       'bike',
    'gravel_cycling':                       'bike',
    'virtual_ride':                         'bike',
    # Natation
    'lap_swimming':                         'swim',
    'open_water_swimming':                  'swim',
    # Musculation / Force
    'strength_training':                    'strength',
    'fitness_equipment':                    'strength',
    # HIIT / Fonctionnel
    'hiit_training':                        'hiit',
    'cross_training':                       'hiit',
    'cardio_training':                      'cardio',
    # Rameur / Machines
    'indoor_rowing':                        'rowing',
    'rowing':                               'rowing',
    # Jump Rope
    'jump_rope':                            'jump_rope',
    # Sports collectifs / raquette
    'tennis':                               'tennis',
    'padel_tennis':                         'padel',
    'racquetball':                          'tennis',
    'squash':                               'tennis',
    'rink_hockey':                          'hockey',
    'ice_hockey':                           'hockey',
    'floor_hockey':                         'hockey',
    # Plein air
    'hiking':                               'hike',
    'walking':                              'walk',
    'backcountry_skiing_snowboarding_ws':   'ski',
    'resort_skiing_snowboarding_ws':        'ski',
    'skate_skiing_ws':                      'ski',
    'stand_up_paddleboarding':              'sup',
    # Bien-être
    'yoga':                                 'yoga',
    'pilates':                              'pilates',
    'bouldering':                           'other',
}

# ── Fallback : si typeKey inconnu, cherche dans le nom de l'activité ────────
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
    'run':       'Course à pied',
    'bike':      'Vélo',
    'swim':      'Natation',
    'strength':  'Musculation',
    'hiit':      'HIIT',
    'cardio':    'Cardio',
    'rowing':    'Rameur',
    'jump_rope': 'Jump Rope',
    'hockey':    'Hockey',
    'tennis':    'Tennis',
    'padel':     'Padel',
    'ski':       'Ski',
    'sup':       'Stand-up Paddle',
    'pilates':   'Pilates',
    'yoga':      'Yoga',
    'hike':      'Randonnée',
    'walk':      'Marche',
    'other':     'Autre',
}

TYPE_ICONS = {
    'run':       '🏃',
    'bike':      '🚴',
    'swim':      '🏊',
    'strength':  '🏋️',
    'hiit':      '🔥',
    'cardio':    '❤️',
    'rowing':    '🚣',
    'jump_rope': '🪢',
    'hockey':    '🏒',
    'tennis':    '🎾',
    'padel':     '🎾',
    'ski':       '⛷️',
    'sup':       '🏄',
    'pilates':   '🧘',
    'yoga':      '🧘',
    'hike':      '🥾',
    'walk':      '🚶',
    'other':     '⚡',
}

# ── Helpers ──────────────────────────────────────────────────────────────────
def format_pace(speed_ms):
    """m/s → 'mm:ss' /km. Retourne None si pas applicable."""
    if not speed_ms or speed_ms <= 0:
        return None
    secs = 1000 / speed_ms
    return f"{int(secs // 60)}:{int(secs % 60):02d}"

def normalize(raw):
    """Convertit une activité Garmin brute en dict normalisé."""
    type_key = raw.get('activityType', {}).get('typeKey', 'other')
    act_type  = TYPE_MAP.get(type_key, 'other')
    # Fallback : si non reconnu, cherche dans le nom de l'activité
    if act_type == 'other':
        name_lower = (raw.get('activityName') or '').lower()
        for keywords, mapped_type in NAME_MAP:
            if any(kw in name_lower for kw in keywords):
                act_type = mapped_type
                break
    dist_m    = raw.get('distance', 0) or 0
    dur_s     = raw.get('duration', 0) or 0
    speed_ms  = raw.get('averageSpeed', 0) or 0

    is_run  = act_type in ('run', 'hike', 'walk')
    is_bike = act_type == 'bike'

    # ── Zones cardio : secondes → pourcentages ──────────────────────────────
    dur_s_nonzero = dur_s if dur_s > 0 else 1
    zones_s = [raw.get(f'hrTimeInZone_{i}', 0) or 0 for i in range(1, 6)]
    zones_total = sum(zones_s)
    hr_zones_pct = [round(z / zones_total * 100) for z in zones_s] if zones_total > 0 else None

    # ── Effet d'entraînement ─────────────────────────────────────────────────
    EFFECT_LABELS = {
        'RECOVERY': 'Récupération', 'BASE': 'Base', 'IMPROVING': 'Amélioration',
        'TEMPO': 'Tempo', 'THRESHOLD': 'Seuil', 'OVERREACHING': 'Surcharge',
        'NO_AEROBIC_BENEFIT': 'Aucun', 'RECOVERY_5': 'Récupération',
    }
    te_label = raw.get('trainingEffectLabel') or raw.get('aerobicTrainingEffectMessage', '')
    te_label = EFFECT_LABELS.get(te_label, te_label.replace('_', ' ').title() if te_label else None)

    return {
        'id':              raw.get('activityId'),
        'name':            raw.get('activityName', ''),
        'type':            act_type,
        'type_label':      TYPE_LABELS.get(act_type, act_type),
        'icon':            TYPE_ICONS.get(act_type, '⚡'),
        'date':            (raw.get('startTimeLocal') or '')[:10],
        'start_time':      raw.get('startTimeLocal', ''),
        'duration_min':    round(dur_s / 60, 1),
        'distance_km':     round(dist_m / 1000, 2),
        'calories':        raw.get('calories', 0) or 0,
        'hr_avg':          raw.get('averageHR'),
        'hr_max':          raw.get('maxHR'),
        'elevation_m':     raw.get('elevationGain', 0) or 0,
        'pace_min_km':     format_pace(speed_ms) if is_run else None,
        'speed_kmh':       round(speed_ms * 3.6, 1) if is_bike else None,
        # Charge & intensité
        'training_load':   round(raw.get('activityTrainingLoad', 0) or 0, 1),
        'aerobic_te':      round(raw.get('aerobicTrainingEffect', 0) or 0, 1),
        'anaerobic_te':    round(raw.get('anaerobicTrainingEffect', 0) or 0, 1),
        'te_label':        te_label,
        'intensity_min':   (raw.get('moderateIntensityMinutes') or 0) + (raw.get('vigorousIntensityMinutes') or 0) * 2,
        'vo2max':          raw.get('vO2MaxValue'),
        # Zones cardio Z1–Z5 en %
        'hr_zones_pct':    hr_zones_pct,
    }

# ── Main ─────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser()
    parser.parse_args()  # pas d'args requis : on utilise les tokens sauvegardés

    if not os.path.exists(TOKEN_DIR):
        print("Erreur : tokens non trouvés.", file=sys.stderr)
        print("Lance d'abord : python3 setup_garmin.py", file=sys.stderr)
        sys.exit(1)

    os.makedirs(os.path.dirname(DATA_FILE), exist_ok=True)

    # Charger les données existantes pour ne pas écraser
    existing = {}
    if os.path.exists(DATA_FILE):
        with open(DATA_FILE) as f:
            saved = json.load(f)
        existing = {a['id']: a for a in saved.get('activities', []) if a.get('id')}
        print(f"Données existantes : {len(existing)} activités")

    # Connexion via tokens OAuth sauvegardés (pas de mot de passe)
    print("Connexion à Garmin Connect via tokens sauvegardés…")
    client = Garmin()
    client.login(TOKEN_DIR)  # charge les tokens, les renouvelle si besoin
    print("Connecté.")

    print(f"Récupération des {FETCH_LIMIT} dernières activités…")
    raw_activities = client.get_activities(0, FETCH_LIMIT)
    print(f"{len(raw_activities)} activités récupérées.")

    new_count = 0
    for raw in raw_activities:
        normalized = normalize(raw)
        aid = normalized['id']
        if aid and aid not in existing:
            new_count += 1
        if aid:
            existing[aid] = normalized

    # Trier par date décroissante
    activities = sorted(existing.values(), key=lambda a: a.get('start_time', ''), reverse=True)

    payload = {
        'last_sync': datetime.now().isoformat(timespec='seconds'),
        'total':     len(activities),
        'activities': activities,
    }

    with open(DATA_FILE, 'w', encoding='utf-8') as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)

    print(f"OK activités — {new_count} nouvelles, {len(activities)} au total → {DATA_FILE}")

    # ── Wellness & sommeil ────────────────────────────────────────────────────
    print(f"\nRécupération des données bien-être ({WELLNESS_DAYS} derniers jours)…")

    # Charger wellness existant
    existing_w = {}
    if os.path.exists(WELLNESS_FILE):
        with open(WELLNESS_FILE) as f:
            existing_w = json.load(f).get('days', {})

    today = datetime.now().date()
    new_w = 0
    errors = 0

    for i in range(WELLNESS_DAYS):
        date = today - timedelta(days=i)
        date_str = date.strftime('%Y-%m-%d')

        # Ne re-fetch pas les données passées déjà présentes (sauf hier et aujourd'hui)
        if date_str in existing_w and i > 1:
            continue

        try:
            sleep_raw  = client.get_sleep_data(date_str)
            stats_raw  = client.get_stats(date_str)
            dto        = sleep_raw.get('dailySleepDTO', {})

            day = {
                'date': date_str,
                # ── Sommeil ──────────────────────────────────────────────
                'sleep_total_min':       round((dto.get('sleepTimeSeconds') or 0) / 60),
                'sleep_deep_min':        round((dto.get('deepSleepSeconds') or 0) / 60),
                'sleep_light_min':       round((dto.get('lightSleepSeconds') or 0) / 60),
                'sleep_rem_min':         round((dto.get('remSleepSeconds') or 0) / 60),
                'sleep_awake_min':       round((dto.get('awakeSleepSeconds') or 0) / 60),
                'sleep_hr_avg':          dto.get('avgHeartRate'),
                'sleep_stress_avg':      dto.get('avgSleepStress'),
                'sleep_respiration_avg': dto.get('averageRespirationValue'),
                'sleep_score_feedback':  dto.get('sleepScoreFeedback'),
                'sleep_score_insight':   dto.get('sleepScorePersonalizedInsight'),
                # ── HRV ──────────────────────────────────────────────────
                'hrv_overnight_avg':     sleep_raw.get('avgOvernightHrv'),
                'hrv_status':            sleep_raw.get('hrvStatus'),
                # ── Body Battery ─────────────────────────────────────────
                'body_battery_wake':     sleep_raw.get('bodyBatteryChange'),
                'body_battery_charged':  stats_raw.get('bodyBatteryChargedValue'),
                'body_battery_drained':  stats_raw.get('bodyBatteryDrainedValue'),
                'body_battery_high':     stats_raw.get('bodyBatteryHighestValue'),
                'body_battery_low':      stats_raw.get('bodyBatteryLowestValue'),
                'body_battery_end':      stats_raw.get('bodyBatteryMostRecentValue'),
                # ── Activité journalière ─────────────────────────────────
                'steps':                 stats_raw.get('totalSteps'),
                'steps_goal':            stats_raw.get('dailyStepGoal'),
                'calories_total':        stats_raw.get('totalKilocalories'),
                'calories_active':       stats_raw.get('activeKilocalories'),
                'distance_m':            stats_raw.get('totalDistanceMeters'),
                'floors_up':             stats_raw.get('floorsAscended'),
                'intensity_min_moderate': stats_raw.get('moderateIntensityMinutes'),
                'intensity_min_vigorous': stats_raw.get('vigorousIntensityMinutes'),
                'active_seconds':        stats_raw.get('activeSeconds'),
                # ── Stress ───────────────────────────────────────────────
                'stress_avg':            stats_raw.get('averageStressLevel'),
                'stress_max':            stats_raw.get('maxStressLevel'),
                'stress_qualifier':      stats_raw.get('stressQualifier'),
                'stress_pct_rest':       stats_raw.get('restStressPercentage'),
                'stress_pct_low':        stats_raw.get('lowStressPercentage'),
                'stress_pct_medium':     stats_raw.get('activityStressPercentage'),
                'stress_pct_high':       stats_raw.get('highStressPercentage'),
                # ── Cœur & respiration ───────────────────────────────────
                'resting_hr':            stats_raw.get('restingHeartRate'),
                'resting_hr_7d_avg':     stats_raw.get('lastSevenDaysAvgRestingHeartRate'),
                'respiration_avg':       stats_raw.get('avgWakingRespirationValue'),
                'spo2_avg':              stats_raw.get('averageSpo2'),
            }

            if date_str not in existing_w:
                new_w += 1
            existing_w[date_str] = day

        except Exception as e:
            errors += 1
            if errors <= 3:
                print(f"  Avertissement {date_str} : {e}")

    wellness_payload = {
        'last_sync': datetime.now().isoformat(timespec='seconds'),
        'days':      existing_w,
    }
    with open(WELLNESS_FILE, 'w', encoding='utf-8') as f:
        json.dump(wellness_payload, f, indent=2, ensure_ascii=False)

    print(f"OK wellness — {new_w} nouveaux jours, {len(existing_w)} au total → {WELLNESS_FILE}")

if __name__ == '__main__':
    main()

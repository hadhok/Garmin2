#!/usr/bin/env python3
"""
update_coach.py — Coach sportif & analyste de données.

Analyse :
  1. Ratio Effort/Récupération  (training_load × te_label vs HRV + sommeil)
  2. Qualité des séances         (hr_zones_pct → règle 80/20)
  3. Indicateurs de forme        (body_battery_high vs pace/vitesse)
  4. Prescription du jour        (training_readiness + fatigue composite)

Format de sortie (3 cartes fixes) :
  • Statut actuel
  • Points de vigilance
  • Prescription du jour

Usage :
  python3 update_coach.py
"""
import os, json, subprocess
from datetime import datetime, timedelta

BASE       = os.path.dirname(os.path.abspath(__file__))
COACH_FILE = os.path.join(BASE, 'coach.json')

# ── Mapping statuts Garmin ─────────────────────────────────────────────────────
GARMIN_SIGNAL = {
    'PRODUCTIVE': 1, 'PEAKING': 1, 'MAINTAINING': 0,
    'OVERREACHING': -1, 'STRAINED': -1, 'UNPRODUCTIVE': -1,
    'RECOVERY': -1, 'DETRAINING': -1, 'NO_DATA': 0,
    'SOUS TENSION': -1, 'SURCHARGE': -1, 'PRODUCTIF': 1,
    'EN MAINTIEN': 0, 'RÉCUPÉRATION': -1, 'PIC DE FORME': 1,
}

# Poids de l'effort par te_label (Training Effect)
TE_WEIGHT = {
    'Récupération': 0.4, 'Base': 1.0, 'Amélioration': 1.5,
    'Tempo': 2.0, 'Seuil': 2.5, 'Surcharge': 3.5,
    None: 1.0,
}

# ── Utilitaires ────────────────────────────────────────────────────────────────
def _load_env():
    p = os.path.join(BASE, '.env')
    if os.path.exists(p):
        with open(p) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    k, v = line.split('=', 1)
                    os.environ.setdefault(k.strip(), v.strip().strip('"\''))

def _avg(lst, key):
    vals = [d[key] for d in lst if (d.get(key) or 0) > 0]
    return round(sum(vals) / len(vals), 1) if vals else None

def _garmin_signal(s):
    if not s: return 0
    k = s.upper().strip()
    if k in GARMIN_SIGNAL: return GARMIN_SIGNAL[k]
    for pat, v in GARMIN_SIGNAL.items():
        if pat in k: return v
    return 0

def _pace_to_sec(p):
    """'5:30' → 330 s/km"""
    if not p or ':' not in str(p): return None
    parts = str(p).split(':')
    try: return int(parts[0]) * 60 + int(parts[1])
    except: return None

# ── 1. RATIO EFFORT / RÉCUPÉRATION ────────────────────────────────────────────
def analyze_effort_recovery(acts_7d, well_7d, well_prev):
    """
    Croise training_load × te_label avec HRV + sommeil.
    Retourne : phase, effort_index, avg_hrv, hrv_delta, avg_sleep_h
    """
    loads  = [a.get('training_load') or 0 for a in acts_7d]
    total_load = sum(loads)

    # Effort pondéré par la nature de la séance
    weighted = sum(
        (a.get('training_load') or 0) * TE_WEIGHT.get(a.get('te_label'), 1.0)
        for a in acts_7d
    )
    effort_index = weighted / max(total_load, 1)  # > 1.5 = charge intense

    # Récupération
    avg_hrv      = _avg(well_7d,   'hrv_overnight_avg')
    avg_hrv_prev = _avg(well_prev, 'hrv_overnight_avg')
    hrv_delta    = round(avg_hrv - avg_hrv_prev, 1) if (avg_hrv and avg_hrv_prev) else None
    avg_sleep    = _avg(well_7d, 'sleep_total_min')
    avg_sleep_h  = round(avg_sleep / 60, 1) if avg_sleep else None

    sleep_ok = avg_sleep_h and avg_sleep_h >= 7.0

    # Phase
    hrv_bad  = (avg_hrv and avg_hrv < 35) or (hrv_delta is not None and hrv_delta < -4)
    hrv_good = (hrv_delta is not None and hrv_delta > 3) or (avg_hrv and avg_hrv >= 45)

    if effort_index > 2.0 and (hrv_bad or not sleep_ok):
        phase = 'fatigue'
    elif effort_index < 0.8 and hrv_good:
        phase = 'pic_de_forme'
    elif hrv_good and sleep_ok:
        phase = 'progression'
    elif effort_index > 1.8 or hrv_bad:
        phase = 'vigilance'
    else:
        phase = 'maintien'

    return phase, round(effort_index, 2), avg_hrv, hrv_delta, avg_sleep_h

# ── 2. QUALITÉ DES SÉANCES (ZONES) ────────────────────────────────────────────
def analyze_zones(acts_14d):
    """
    Analyse hr_zones_pct sur 14 jours.
    Règle 80/20 : Z1+Z2 ≥ 75%, Z4+Z5 ≤ 25%, Z3 < 20% (zone grise).
    Retourne dict avec distribution, structure et points de vigilance.
    """
    sessions = []
    for a in acts_14d:
        zp  = a.get('hr_zones_pct')
        dur = a.get('duration_min') or 0
        if zp and len(zp) == 5 and dur >= 15:
            sessions.append({'z': zp, 'dur': dur, 'type': a.get('type'), 'te': a.get('te_label')})

    if not sessions:
        return None

    total_dur = sum(s['dur'] for s in sessions)
    avg_z = [0.0] * 5
    for s in sessions:
        w = s['dur'] / total_dur
        for i in range(5): avg_z[i] += s['z'][i] * w

    z12  = avg_z[0] + avg_z[1]
    z3   = avg_z[2]
    z45  = avg_z[3] + avg_z[4]

    issues = []
    if z12 < 60:
        issues.append(f"manque de Zone 1-2 ({z12:.0f}% vs ≥75% recommandé) — cardio de base sous-développé")
    if z3 > 20:
        issues.append(f"Zone 3 trop présente ({z3:.0f}%) — zone piège : trop dure pour récupérer, trop facile pour progresser")
    if z45 > 30:
        issues.append(f"Zone 4-5 élevée ({z45:.0f}%) — surveille la fatigue accumulée")
    if not issues and z12 >= 75 and z45 >= 10:
        issues.append(f"distribution 80/20 respectée ✓ ({z12:.0f}% bas / {z45:.0f}% intense)")

    if z12 >= 70 and z45 >= 10:
        structure = 'polarisée (idéale)'
    elif z3 > 20:
        structure = 'grise (risque stagnation)'
    elif z45 < 5:
        structure = 'basse intensité (manque de stimulus)'
    else:
        structure = 'pyramidale'

    return {
        'z12': round(z12), 'z3': round(z3), 'z45': round(z45),
        'avg_z': [round(x) for x in avg_z],
        'structure': structure, 'issues': issues, 'nb': len(sessions),
    }

# ── 3. INDICATEURS DE FORME ────────────────────────────────────────────────────
def analyze_form(acts_30d, well_7d):
    """
    Corrèle body_battery_high avec performance récente (pace/vitesse).
    Retourne tendance de performance + corrélation BB.
    """
    avg_bb_high = _avg(well_7d, 'body_battery_high')

    # Runs : tendance allure (4 dernières semaines, médiane par semaine)
    runs = sorted(
        [a for a in acts_30d if a.get('type') == 'run' and a.get('pace_min_km') and a.get('distance_km', 0) >= 3],
        key=lambda a: a['date']
    )
    pace_trend = None
    if len(runs) >= 4:
        first_half = runs[:len(runs)//2]
        last_half  = runs[len(runs)//2:]
        avg_pace_old = _avg(first_half, '_pace_sec') if False else None
        # Convertit en secondes
        old_paces = [_pace_to_sec(a['pace_min_km']) for a in first_half if _pace_to_sec(a['pace_min_km'])]
        new_paces = [_pace_to_sec(a['pace_min_km']) for a in last_half  if _pace_to_sec(a['pace_min_km'])]
        if old_paces and new_paces:
            delta = round((sum(new_paces)/len(new_paces) - sum(old_paces)/len(old_paces)) / 60, 2)
            # delta < 0 = plus rapide = progrès
            pace_trend = delta  # en min/km, négatif = progression

    # Vélo : tendance vitesse
    bikes = sorted(
        [a for a in acts_30d if a.get('type') == 'bike' and a.get('speed_kmh') and a.get('duration_min', 0) >= 20],
        key=lambda a: a['date']
    )
    speed_trend = None
    if len(bikes) >= 4:
        old_sp = [a['speed_kmh'] for a in bikes[:len(bikes)//2]]
        new_sp = [a['speed_kmh'] for a in bikes[len(bikes)//2:]]
        if old_sp and new_sp:
            speed_trend = round(sum(new_sp)/len(new_sp) - sum(old_sp)/len(old_sp), 1)

    return avg_bb_high, pace_trend, speed_trend, len(runs), len(bikes)

# ── 4. PRESCRIPTION DU JOUR ───────────────────────────────────────────────────
def prescribe(s):
    """
    Détermine la séance prioritaire du jour.
    Entrées clés : fatigue_level, training_readiness, body_battery_end,
                   dernière séance (hier), tendance poids/fat.
    """
    fl  = s['fatigue_level']
    tr  = s['training_readiness']   # 0-100 ou None
    bb  = s['avg_bb_end']           # body battery fin de journée
    yesterday_te = s.get('yesterday_te')
    yesterday_type = s.get('yesterday_type')

    # Score de fraîcheur 0-100
    freshness = 50
    if tr:
        freshness = tr
    elif bb:
        freshness = bb
    # Ajuste selon fatigue globale
    if fl == 'fatigue':  freshness = min(freshness, 35)
    if fl == 'peak':     freshness = max(freshness, 65)

    # Séance d'hier était-elle intense ?
    hard_yesterday = yesterday_te in ('Seuil', 'Surcharge', 'Tempo')
    recovery_yesterday = yesterday_te in ('Récupération', 'Base')

    # Prescription
    if freshness <= 30 or fl == 'fatigue':
        ptype  = 'Récupération active'
        detail = '20-30 min de marche, mobilité ou yoga. Pas de cardio. Objectif : ne pas aggraver la fatigue.'
        intensity = 'Z1 uniquement — FC < 120 bpm'
    elif freshness <= 50 or hard_yesterday:
        ptype  = 'Séance légère — Zone 2'
        detail = '45-60 min à allure conversationnelle. Course lente, vélo ou natation à faible intensité.'
        intensity = 'Z2 — 60-70% FCmax'
    elif freshness >= 70 and not hard_yesterday:
        if s.get('z45', 0) < 10:
            ptype  = 'Séance de qualité — Fractionné'
            detail = '45 min : 15 min échauffement Z2 + 6×3 min à 90-95% FCmax (récup 90s) + 10 min cool-down.'
            intensity = 'Z4-Z5 — 88-95% FCmax'
        else:
            ptype  = 'Séance longue — Endurance fondamentale'
            detail = '60-90 min à allure modérée. Maintient le volume sans accumuler de fatigue neuro-musculaire.'
            intensity = 'Z2 — 65-75% FCmax'
    else:
        ptype  = 'Séance modérée — Tempo'
        detail = '50 min : 10 min Z2 + 25 min tempo (75-80% FCmax) + 15 min retour au calme.'
        intensity = 'Z3 progressif vers Z4'

    # Ajustement poids/masse grasse
    fat_note = ''
    if s.get('body_fat_trend') and s['body_fat_trend'] > 0.5:
        fat_note = ' (note : masse grasse en hausse — favorise les séances longues Z2 qui oxydent les lipides)'
    elif s.get('weight_trend') and s['weight_trend'] < -1.5:
        fat_note = ' (note : perte de poids rapide — veille à l\'apport calorique autour de la séance)'

    return ptype, detail + fat_note, intensity

# ── ANALYSE PRINCIPALE ────────────────────────────────────────────────────────
def analyze(activities, wellness_by_date):
    today = datetime.now().date()

    # Fenêtres temporelles
    d7   = (today - timedelta(days=7)).isoformat()
    d14  = (today - timedelta(days=14)).isoformat()
    d30  = (today - timedelta(days=30)).isoformat()
    d180 = (today - timedelta(days=180)).isoformat()

    acts_7d  = [a for a in activities if a.get('date','') >= d7]
    acts_14d = [a for a in activities if a.get('date','') >= d14]
    acts_30d = [a for a in activities if a.get('date','') >= d30]

    well_sorted = [wellness_by_date[k] for k in sorted(wellness_by_date)]
    well_7d     = [wellness_by_date[k] for k in sorted(wellness_by_date) if k >= d7]
    well_prev   = [wellness_by_date[k] for k in sorted(wellness_by_date) if d14 <= k < d7]

    # CTL / ATL / TSB
    load_by_date = {}
    for a in activities:
        d = (a.get('date') or '')[:10]
        if d: load_by_date[d] = load_by_date.get(d, 0) + (a.get('training_load') or 0)

    ctl, atl = 0.0, 0.0
    for i in range(179, -1, -1):
        d    = (today - timedelta(days=i)).isoformat()
        load = load_by_date.get(d, 0)
        ctl  = ctl + (load - ctl) / 42
        atl  = atl + (load - atl) / 7
    tsb = ctl - atl

    # Charge semaine
    week_load  = sum(load_by_date.get((today - timedelta(days=i)).isoformat(), 0) for i in range(7))
    month_load = sum(load_by_date.get((today - timedelta(days=i)).isoformat(), 0) for i in range(28))
    avg_wk_load = month_load / 4

    # Signaux wellness récents
    avg_stress   = _avg(well_7d[:3], 'stress_avg')
    avg_bb_end   = _avg(well_7d[:3], 'body_battery_end')
    garmin_status = next((w['training_status'] for w in reversed(well_7d) if w.get('training_status')), None)
    hrv_status    = next((w['hrv_status']       for w in reversed(well_7d) if w.get('hrv_status')), None)
    tr_score      = next((w['training_readiness_score'] for w in reversed(well_7d)
                          if (w.get('training_readiness_score') or 0) > 0), None)

    # Hier
    yesterday = (today - timedelta(days=1)).isoformat()
    yest_acts = [a for a in activities if a.get('date','')[:10] == yesterday]
    yesterday_te   = yest_acts[-1].get('te_label')   if yest_acts else None
    yesterday_type = yest_acts[-1].get('type')       if yest_acts else None

    # Poids & masse grasse
    w_pts  = sorted([(k, v.get('weight_kg'))   for k, v in wellness_by_date.items() if v.get('weight_kg') and v['weight_kg'] > 0])
    bf_pts = sorted([(k, v.get('body_fat'))    for k, v in wellness_by_date.items() if v.get('body_fat')  and v['body_fat']  > 0])
    last_weight    = w_pts[-1][1]  if w_pts  else None
    weight_trend   = round(w_pts[-1][1]  - w_pts[0][1],  1) if len(w_pts)  >= 2 else None
    last_bf        = bf_pts[-1][1] if bf_pts else None
    body_fat_trend = round(bf_pts[-1][1] - bf_pts[0][1], 1) if len(bf_pts) >= 2 else None

    # VO2max
    vo2_pts  = sorted([(a['date'], a['vo2max']) for a in activities if a.get('vo2max') and a['vo2max'] > 0])
    last_vo2  = vo2_pts[-1][1] if vo2_pts else None
    first_vo2 = vo2_pts[0][1]  if len(vo2_pts) >= 3 else None

    # Analyses spécifiques
    phase, effort_idx, avg_hrv, hrv_delta, avg_sleep_h = analyze_effort_recovery(acts_7d, well_7d, well_prev)
    zones = analyze_zones(acts_14d)
    avg_bb_high, pace_trend, speed_trend, nb_runs, nb_bikes = analyze_form(acts_30d, well_7d)

    # ── Score de fatigue composite ───────────────────────────────────────────
    fatigue_score = 0
    if tsb >= 8:    fatigue_score += 1
    elif tsb <= -15: fatigue_score -= 2
    elif tsb <= -5:  fatigue_score -= 1

    gs = _garmin_signal(garmin_status)
    fatigue_score += gs * 2

    if avg_bb_end is not None:
        if avg_bb_end >= 60:   fatigue_score += 1
        elif avg_bb_end <= 30: fatigue_score -= 2
        elif avg_bb_end <= 45: fatigue_score -= 1

    if hrv_status:
        hs = hrv_status.upper()
        if any(k in hs for k in ('LOW', 'POOR', 'UNBALANCED', 'FAIBLE')): fatigue_score -= 1
        elif any(k in hs for k in ('HIGH', 'BALANCED', 'ÉLEVÉ')):          fatigue_score += 1

    if avg_stress and avg_stress >= 60: fatigue_score -= 1
    if tr_score:
        if tr_score >= 70: fatigue_score += 1
        elif tr_score <= 35: fatigue_score -= 1

    if fatigue_score >= 2:    fatigue_level = 'peak'
    elif fatigue_score <= -1: fatigue_level = 'tired'
    else:                     fatigue_level = 'balanced'

    # Niveau athlète
    def level(c):
        if c < 10: return 'Débutant'
        if c < 30: return 'Actif'
        if c < 60: return 'Sportif'
        if c < 110: return 'Athlète'
        return 'Expert'

    # Sports dominants 30j
    type_time = {}; type_label = {}
    for a in acts_30d:
        t = a.get('type', 'other')
        type_time[t] = type_time.get(t, 0) + (a.get('duration_min') or 0)
        if a.get('type_label'): type_label[t] = a['type_label']
    top_sport_key   = max(type_time, key=type_time.get) if type_time else None
    top_sport_label = type_label.get(top_sport_key, top_sport_key or '–')

    return dict(
        # CTL/ATL
        ctl=round(ctl,1), atl=round(atl,1), tsb=round(tsb,1),
        week_load=round(week_load), avg_wk_load=round(avg_wk_load),
        # Fatigue
        fatigue_level=fatigue_level, fatigue_score=fatigue_score,
        garmin_status=garmin_status, hrv_status=hrv_status,
        avg_bb_end=avg_bb_end, avg_stress=avg_stress,
        training_readiness=tr_score,
        # Effort/récupération
        phase=phase, effort_idx=effort_idx,
        avg_hrv=avg_hrv, hrv_delta=hrv_delta, avg_sleep_h=avg_sleep_h,
        # Zones
        zones=zones,
        z45=(zones['z45'] if zones else 0),
        # Forme
        avg_bb_high=avg_bb_high, pace_trend=pace_trend, speed_trend=speed_trend,
        nb_runs=nb_runs, nb_bikes=nb_bikes,
        # Hier
        yesterday_te=yesterday_te, yesterday_type=yesterday_type,
        # Corps
        last_weight=last_weight, weight_trend=weight_trend,
        last_bf=last_bf, body_fat_trend=body_fat_trend,
        # VO2max
        last_vo2=last_vo2, first_vo2=first_vo2,
        # Meta
        total_acts=len(activities),
        total_dist=round(sum(a.get('distance_km') or 0 for a in activities)),
        athlete_level=level(ctl),
        top_sport_label=top_sport_label,
        acts_7d_count=len(acts_7d),
    )

# ── GÉNÉRATION DES 3 CARTES ────────────────────────────────────────────────────
def generate_coach(s):
    """
    Retourne toujours 3 cartes :
      1. Statut actuel
      2. Points de vigilance
      3. Prescription du jour
    """
    items = []

    # ═══════════════════════════════════════════════════════════════════════════
    # CARTE 1 — STATUT ACTUEL
    # ═══════════════════════════════════════════════════════════════════════════
    phase   = s['phase']
    fl      = s['fatigue_level']
    gs      = s['garmin_status']
    ctl, atl, tsb = s['ctl'], s['atl'], s['tsb']
    ei      = s['effort_idx']

    PHASE_LABEL = {
        'fatigue':     ('🔴', 'Fatigué — récupération prioritaire'),
        'vigilance':   ('🟡', 'Sous tension — vigilance requise'),
        'maintien':    ('🟢', 'En maintien — charge stable'),
        'progression': ('💪', 'En progression — adaptation positive'),
        'pic_de_forme':('🚀', 'Pic de forme — moment idéal pour performer'),
    }
    icon, label = PHASE_LABEL.get(phase, ('⚖️', 'Équilibre — charge normale'))

    gs_str    = f" • Garmin : {gs}" if gs else ""
    hrv_str   = (f" • HRV {s['avg_hrv']} ms" + (f" ({s['hrv_delta']:+.0f} ms vs S-1)" if s['hrv_delta'] else "")) if s['avg_hrv'] else ""
    sleep_str = f" • Sommeil {s['avg_sleep_h']}h/nuit" if s['avg_sleep_h'] else ""
    bb_str    = f" • Body Battery fin de journée : {round(s['avg_bb_end'])}%" if s['avg_bb_end'] else ""
    tr_str    = f" • Readiness : {s['training_readiness']}/100" if s['training_readiness'] else ""
    ei_str    = f"Effort pondéré 7j : {ei:.1f}× (1.0 = charge de base, >2 = intense). "
    tsb_str   = f"TSB {tsb:+.0f} pts (CTL {ctl} / ATL {atl})."

    status_text = (
        f"{ei_str}{tsb_str}"
        f"{gs_str}{hrv_str}{sleep_str}{bb_str}{tr_str}"
    ).strip()

    items.append({
        'type':  'warning' if fl == 'tired' else ('focus' if fl == 'peak' else 'tip'),
        'icon':  icon,
        'title': label,
        'text':  status_text,
    })

    # ═══════════════════════════════════════════════════════════════════════════
    # CARTE 2 — POINTS DE VIGILANCE
    # ═══════════════════════════════════════════════════════════════════════════
    vigilance = []

    # Sommeil
    if s['avg_sleep_h']:
        if s['avg_sleep_h'] < 6.5:
            vigilance.append(f"⚠️ Sommeil critique ({s['avg_sleep_h']}h) — récupération musculaire et mémoire motrice compromises")
        elif s['avg_sleep_h'] < 7.5:
            vigilance.append(f"💤 Sommeil limite ({s['avg_sleep_h']}h) — vise 7h30 minimum")

    # HRV status
    if s['hrv_status'] and any(k in s['hrv_status'].upper() for k in ('LOW','POOR','UNBALANCED','FAIBLE')):
        vigilance.append(f"💛 HRV statut {s['hrv_status']} — système nerveux sous pression")

    # Zones d'entraînement
    zones = s.get('zones')
    if zones:
        for issue in zones['issues']:
            if '✓' not in issue:
                vigilance.append(f"📊 {issue}")
        if not [i for i in zones['issues'] if '✓' not in i]:
            vigilance.append(f"✅ Structure d'entraînement {zones['structure']} sur {zones['nb']} séances analysées")

    # Charge hebdo
    if s['avg_wk_load'] > 30:
        ratio = s['week_load'] / max(s['avg_wk_load'], 1)
        if ratio > 1.5:
            vigilance.append(f"📈 Charge semaine +{round((ratio-1)*100)}% au-dessus de la moyenne — risque de surcharge")
        elif ratio < 0.4:
            vigilance.append(f"📉 Semaine très creuse ({s['week_load']} pts vs {s['avg_wk_load']} moy.)")

    # Tendance de performance
    if s['pace_trend'] is not None:
        if s['pace_trend'] < -0.1:
            vigilance.append(f"🏃 Course : allure en progression (+{abs(s['pace_trend']):.1f} min/km plus rapide)")
        elif s['pace_trend'] > 0.15:
            vigilance.append(f"🏃 Course : allure en régression ({s['pace_trend']:.1f} min/km plus lent — peut indiquer fatigue)")
    if s['speed_trend'] is not None:
        if s['speed_trend'] > 0.5:
            vigilance.append(f"🚴 Vélo : vitesse en hausse (+{s['speed_trend']} km/h)")
        elif s['speed_trend'] < -0.5:
            vigilance.append(f"🚴 Vélo : vitesse en baisse ({s['speed_trend']} km/h) — surveille la récupération")

    # Body Battery high
    if s['avg_bb_high'] and s['avg_bb_high'] < 50:
        vigilance.append(f"🔋 Body Battery max à {round(s['avg_bb_high'])}% — tu ne récupères pas complètement la nuit")

    # Poids / masse grasse
    if s['body_fat_trend'] and abs(s['body_fat_trend']) > 0.5:
        sign = '+' if s['body_fat_trend'] > 0 else ''
        vigilance.append(f"⚖️ Masse grasse {sign}{s['body_fat_trend']}% sur la période — {'surveille alimentation' if s['body_fat_trend'] > 0 else 'bonne tendance'}")
    elif s['weight_trend'] and abs(s['weight_trend']) > 1:
        sign = '+' if s['weight_trend'] > 0 else ''
        vigilance.append(f"⚖️ Poids {sign}{s['weight_trend']} kg — {'apport protéiné : ' + str(round((s['last_weight'] or 70)*1.8)) + 'g/j' if s['weight_trend'] < -1 else 'normal si muscle'}")

    if not vigilance:
        vigilance.append("✅ Aucun signal d'alerte majeur cette semaine — continue sur cette lancée")

    items.append({
        'type':  'warning' if any('⚠️' in v or '📈' in v for v in vigilance) else 'tip',
        'icon':  '🔍',
        'title': 'Points de vigilance',
        'text':  '\n'.join(vigilance),
    })

    # ═══════════════════════════════════════════════════════════════════════════
    # CARTE 3 — PRESCRIPTION DU JOUR
    # ═══════════════════════════════════════════════════════════════════════════
    ptype, detail, intensity = prescribe(s)

    yesterday_ctx = ''
    if s['yesterday_te']:
        yesterday_ctx = f"Hier : {s['yesterday_te']} ({s['yesterday_type'] or ''}). "

    items.append({
        'type':  'goal',
        'icon':  '📋',
        'title': f"Prescription : {ptype}",
        'text':  f"{yesterday_ctx}{detail} — {intensity}",
    })

    return items

# ── MAIN ───────────────────────────────────────────────────────────────────────
def main():
    _load_env()
    url = os.environ.get('SUPABASE_URL') or input('SUPABASE_URL : ').strip()
    key = os.environ.get('SUPABASE_KEY') or input('SUPABASE_KEY : ').strip()

    from supabase import create_client
    sb = create_client(url, key)

    print("📊 Récupération des activités…")
    acts_r = sb.table('activities').select(
        'date,type,type_label,duration_min,distance_km,'
        'training_load,te_label,hr_zones_pct,'
        'pace_min_km,speed_kmh,aerobic_te,anaerobic_te,vo2max'
    ).order('date', desc=False).execute()
    activities = acts_r.data or []
    print(f"   → {len(activities)} activités")

    print("🌙 Récupération du wellness (90 jours)…")
    cutoff = (datetime.now() - timedelta(days=90)).strftime('%Y-%m-%d')
    well_r = sb.table('wellness_days').select('date,data').gte('date', cutoff).order('date').execute()
    wellness_by_date = {row['date']: (row['data'] or {}) for row in (well_r.data or [])}
    print(f"   → {len(wellness_by_date)} jours wellness")

    print("🧠 Analyse en cours…")
    stats = analyze(activities, wellness_by_date)

    # Résumé console
    print("\n── Métriques ──────────────────────────────────────────────────────────────")
    print(f"  Phase            : {stats['phase']:20s}  Fatigue level : {stats['fatigue_level']}")
    print(f"  CTL {stats['ctl']}  ATL {stats['atl']}  TSB {stats['tsb']:+.1f}  Effort×7j : {stats['effort_idx']:.2f}×")
    print(f"  Garmin status    : {stats['garmin_status'] or '(non dispo)'}")
    print(f"  Body Battery     : fin {stats['avg_bb_end'] or '–'}%  max {stats['avg_bb_high'] or '–'}%")
    print(f"  HRV              : {stats['avg_hrv'] or '–'} ms  ({stats['hrv_status'] or '–'})  Δ {stats['hrv_delta'] or '–'} ms")
    print(f"  Sommeil          : {stats['avg_sleep_h'] or '–'}h/nuit")
    print(f"  Readiness        : {stats['training_readiness'] or '–'}")
    if stats['zones']:
        z = stats['zones']
        print(f"  Zones 14j        : Z1-2={z['z12']}%  Z3={z['z3']}%  Z4-5={z['z45']}%  → {z['structure']}")
    if stats['pace_trend'] is not None:
        print(f"  Course allure    : {'↗ +' if stats['pace_trend'] > 0 else '↘ '}{abs(stats['pace_trend']):.2f} min/km vs période préc.")
    print("──────────────────────────────────────────────────────────────────────────\n")

    items = generate_coach(stats)
    print(f"✅ {len(items)} cartes générées :")
    for it in items:
        print(f"   {it['icon']} [{it['type']}] {it['title']}")

    coach = {
        "updated_at": datetime.now().strftime('%Y-%m-%d'),
        "coach": "Claude",
        "stats_snapshot": {
            "phase":           stats['phase'],
            "fatigue_level":   stats['fatigue_level'],
            "garmin_status":   stats['garmin_status'],
            "ctl":             stats['ctl'],
            "atl":             stats['atl'],
            "tsb":             stats['tsb'],
            "effort_idx":      stats['effort_idx'],
            "body_battery":    stats['avg_bb_end'],
            "training_readiness": stats['training_readiness'],
            "niveau":          stats['athlete_level'],
            "total_activites": stats['total_acts'],
            "total_km":        stats['total_dist'],
        },
        "items": items,
    }

    with open(COACH_FILE, 'w', encoding='utf-8') as f:
        json.dump(coach, f, ensure_ascii=False, indent=2)
    print(f"\n📝 coach.json mis à jour")

    try:
        subprocess.run(['git', 'add', 'coach.json'], cwd=BASE, check=True)
        msg = f"coach: analyse du {datetime.now().strftime('%d/%m/%Y %H:%M')}"
        result = subprocess.run(['git', 'commit', '-m', msg], cwd=BASE, capture_output=True, text=True)
        if 'nothing to commit' in result.stdout:
            print("ℹ️  Pas de changement (conseils identiques).")
        else:
            subprocess.run(['git', 'push'], cwd=BASE, check=True)
            print("🚀 Poussé sur GitHub — Vercel redéploiera dans ~30 secondes.")
    except subprocess.CalledProcessError as e:
        print(f"⚠️  Erreur git : {e}")

if __name__ == '__main__':
    main()

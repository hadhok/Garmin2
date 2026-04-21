#!/usr/bin/env python3
"""
update_coach.py — Analyse les données Supabase et met à jour coach.json automatiquement.

Usage :
  python3 update_coach.py
  (les variables SUPABASE_URL / SUPABASE_KEY sont lues depuis .env ou l'environnement)
"""
import os, json, subprocess
from datetime import datetime, timedelta

BASE       = os.path.dirname(os.path.abspath(__file__))
COACH_FILE = os.path.join(BASE, 'coach.json')

# ── Chargement .env optionnel ──────────────────────────────────────────────────
def _load_env():
    env_path = os.path.join(BASE, '.env')
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    k, v = line.split('=', 1)
                    os.environ.setdefault(k.strip(), v.strip().strip('"\''))

# ── Utilitaires ────────────────────────────────────────────────────────────────
def _avg(lst, key):
    vals = [d[key] for d in lst if d.get(key) and d[key] > 0]
    return round(sum(vals) / len(vals), 1) if vals else None

def _fmt_dur(mins):
    if mins is None: return '–'
    h, m = int(mins // 60), int(mins % 60)
    return f"{h}h{m:02d}" if h else f"{m} min"

# ── Analyse ────────────────────────────────────────────────────────────────────
def analyze(activities, wellness_by_date):
    today = datetime.now().date()

    # Charge quotidienne
    load_by_date = {}
    for a in activities:
        d = (a.get('date') or '')[:10]
        if d:
            load_by_date[d] = load_by_date.get(d, 0) + (a.get('training_load') or 0)

    # CTL / ATL / TSB sur 180 jours
    ctl, atl = 0.0, 0.0
    for i in range(179, -1, -1):
        d    = (today - timedelta(days=i)).isoformat()
        load = load_by_date.get(d, 0)
        ctl  = ctl + (load - ctl) / 42
        atl  = atl + (load - atl) / 7
    tsb = ctl - atl

    # Charge semaine en cours vs moyenne 4 semaines
    week_load   = sum(load_by_date.get((today - timedelta(days=i)).isoformat(), 0) for i in range(7))
    month_load  = sum(load_by_date.get((today - timedelta(days=i)).isoformat(), 0) for i in range(28))
    avg_wk_load = month_load / 4

    # Activités récentes
    acts_7d  = [a for a in activities if a.get('date','') >= (today - timedelta(days=7)).isoformat()]
    acts_30d = [a for a in activities if a.get('date','') >= (today - timedelta(days=30)).isoformat()]
    acts_prev_7d = [a for a in activities
                    if (today - timedelta(days=14)).isoformat() <= a.get('date','') < (today - timedelta(days=7)).isoformat()]

    # Sports dominants (30j) — par temps cumulé
    type_time = {}
    type_label = {}
    for a in acts_30d:
        t = a.get('type', 'other')
        type_time[t]  = type_time.get(t, 0) + (a.get('duration_min') or 0)
        if a.get('type_label'): type_label[t] = a['type_label']
    top_sport_key   = max(type_time, key=type_time.get) if type_time else None
    top_sport_label = type_label.get(top_sport_key, top_sport_key or '–')
    top_sport_dur   = _fmt_dur(type_time.get(top_sport_key, 0))

    # Records
    runs        = [a for a in activities if a.get('type') == 'run' and (a.get('distance_km') or 0) > 0]
    max_run_km  = max((a['distance_km'] for a in runs), default=0)
    max_load_v  = max((a.get('training_load') or 0 for a in activities), default=0)

    # Totaux all-time
    total_acts  = len(activities)
    total_dist  = round(sum(a.get('distance_km') or 0 for a in activities))
    total_hours = round(sum(a.get('duration_min') or 0 for a in activities) / 60, 1)

    # Régularité 28j (jours distincts avec activité)
    active_days = len({a['date'] for a in acts_30d if a.get('date')})

    # Sommeil 7j vs 7j précédents
    well_7d   = [wellness_by_date[k] for k in sorted(wellness_by_date)
                 if k >= (today - timedelta(days=7)).isoformat()]
    well_prev = [wellness_by_date[k] for k in sorted(wellness_by_date)
                 if (today - timedelta(days=14)).isoformat() <= k < (today - timedelta(days=7)).isoformat()]

    avg_sleep      = _avg(well_7d, 'sleep_total_min')
    avg_hrv_now    = _avg(well_7d,   'hrv_overnight_avg')
    avg_hrv_prev   = _avg(well_prev, 'hrv_overnight_avg')
    avg_rhr_now    = _avg(well_7d,   'resting_hr')

    # Poids (tendance sur toute la période dispo)
    w_pts = sorted([(k, v['weight_kg']) for k, v in wellness_by_date.items()
                    if v.get('weight_kg') and v['weight_kg'] > 0])
    last_weight    = w_pts[-1][1] if w_pts else None
    weight_trend   = round(w_pts[-1][1] - w_pts[0][1], 1) if len(w_pts) >= 2 else None

    # VO2max
    vo2_pts = sorted([(a['date'], a['vo2max']) for a in activities
                      if a.get('vo2max') and a['vo2max'] > 0])
    last_vo2  = vo2_pts[-1][1] if vo2_pts else None
    first_vo2 = vo2_pts[0][1]  if len(vo2_pts) >= 3 else None

    # Niveau athlète
    def level(c):
        if c < 10:  return 'Débutant'
        if c < 30:  return 'Actif'
        if c < 60:  return 'Sportif'
        if c < 110: return 'Athlète'
        return 'Expert'
    next_thresh = {'Débutant':10,'Actif':30,'Sportif':60,'Athlète':110}.get(level(ctl))

    return dict(
        ctl=round(ctl,1), atl=round(atl,1), tsb=round(tsb,1),
        week_load=round(week_load), avg_wk_load=round(avg_wk_load),
        nb_acts_7d=len(acts_7d), nb_acts_prev_7d=len(acts_prev_7d),
        top_sport_label=top_sport_label, top_sport_dur=top_sport_dur,
        max_run_km=round(max_run_km,1), max_load_v=round(max_load_v),
        total_acts=total_acts, total_dist=total_dist, total_hours=total_hours,
        active_days=active_days,
        avg_sleep=avg_sleep,
        avg_hrv_now=avg_hrv_now, avg_hrv_prev=avg_hrv_prev,
        avg_rhr_now=avg_rhr_now,
        last_weight=last_weight, weight_trend=weight_trend,
        last_vo2=last_vo2, first_vo2=first_vo2,
        athlete_level=level(ctl), next_thresh=next_thresh,
    )

# ── Génération des conseils ────────────────────────────────────────────────────
def generate_advice(s):
    items = []

    # 1 — FORME / FATIGUE (TSB)
    ctl, atl, tsb = s['ctl'], s['atl'], s['tsb']
    if atl > 0 and atl / max(ctl, 1) > 1.4:
        items.append({
            'type': 'warning', 'icon': '⚠️',
            'title': 'Fatigue accumulée — décharge conseillée',
            'text': (f"ATL {atl} > CTL {ctl} (TSB {tsb:+.0f} pts). "
                     f"Tu accumules plus de fatigue que ton niveau de forme de fond. "
                     f"2 à 3 jours de récupération active avant ta prochaine séance intense.")
        })
    elif tsb >= 8:
        items.append({
            'type': 'focus', 'icon': '🚀',
            'title': 'Forme optimale — moment idéal pour performer',
            'text': (f"TSB à {tsb:+.0f} pts avec une base solide (CTL {ctl}). "
                     f"Tu es frais et entraîné — profite-en pour une séance de qualité ou un effort clé cette semaine.")
        })
    elif tsb <= -20:
        items.append({
            'type': 'warning', 'icon': '🔴',
            'title': 'Zone de surcharge — semaine de décharge obligatoire',
            'text': (f"TSB à {tsb:+.0f} pts. La fatigue dépasse la récupération depuis trop longtemps. "
                     f"Planifie impérativement une semaine à -40% de volume avant de reprendre l'intensité.")
        })
    else:
        items.append({
            'type': 'focus', 'icon': '⚖️',
            'title': f"Équilibre optimal — CTL {ctl} / ATL {atl}",
            'text': (f"TSB {tsb:+.0f} pts : bonne balance forme/fatigue. "
                     f"Tu peux maintenir ton rythme. Augmente la charge de 5-10% max par semaine pour progresser sans te blesser.")
        })

    # 2 — CHARGE HEBDO
    if s['avg_wk_load'] > 30:
        ratio = s['week_load'] / max(s['avg_wk_load'], 1)
        if ratio < 0.5:
            items.append({
                'type': 'tip', 'icon': '📉',
                'title': 'Semaine creuse',
                'text': (f"Seulement {s['week_load']} pts cette semaine vs {s['avg_wk_load']} pts en moyenne "
                         f"({round((1-ratio)*100)}% en dessous). Si c'est voulu (décharge), parfait. "
                         f"Sinon, relance dès demain avec une séance de ton sport dominant.")
            })
        elif ratio > 1.5:
            items.append({
                'type': 'warning', 'icon': '📈',
                'title': f"Semaine surchargée (+{round((ratio-1)*100)}%)",
                'text': (f"{s['week_load']} pts cette semaine vs {s['avg_wk_load']} pts en moyenne. "
                         f"Une hausse aussi brutale de charge augmente le risque de blessure. "
                         f"Surveille les douleurs inhabituelles et prévoie une séance légère dans 2 jours.")
            })

    # 3 — SOMMEIL
    if s['avg_sleep']:
        h = s['avg_sleep'] / 60
        if h < 6.5:
            items.append({
                'type': 'warning', 'icon': '😴',
                'title': f"Sommeil insuffisant — {h:.1f}h/nuit en moyenne",
                'text': (f"En dessous de 7h, la synthèse protéique, la récupération musculaire et la mémoire motrice "
                         f"sont compromises. Couche-toi 30 min plus tôt cette semaine — c'est ton levier n°1 de progression.")
            })
        elif h >= 7.5:
            items.append({
                'type': 'tip', 'icon': '✨',
                'title': f"Excellent sommeil — {h:.1f}h/nuit",
                'text': (f"Tu récupères bien. Associé à un bon CTL ({ctl}), "
                         f"c'est la combinaison idéale pour progresser. Continue ainsi.")
            })

    # 4 — HRV
    if s['avg_hrv_now'] and s['avg_hrv_prev']:
        delta_hrv = s['avg_hrv_now'] - s['avg_hrv_prev']
        if delta_hrv > 3:
            items.append({
                'type': 'congrats', 'icon': '💚',
                'title': f"HRV en hausse (+{delta_hrv:.0f} ms)",
                'text': (f"Ton système nerveux autonome récupère bien ({s['avg_hrv_now']} ms cette semaine "
                         f"vs {s['avg_hrv_prev']} ms la semaine précédente). Signe d'adaptation positive à l'entraînement.")
            })
        elif delta_hrv < -4:
            items.append({
                'type': 'warning', 'icon': '💛',
                'title': f"HRV en baisse ({delta_hrv:.0f} ms)",
                'text': (f"HRV à {s['avg_hrv_now']} ms cette semaine vs {s['avg_hrv_prev']} ms avant. "
                         f"Peut indiquer fatigue, stress ou début d'infection. Garde un œil sur le score de récupération quotidien.")
            })

    # 5 — OBJECTIF NIVEAU
    if s['next_thresh']:
        gap = s['next_thresh'] - ctl
        items.append({
            'type': 'goal', 'icon': '🎯',
            'title': f"Niveau {s['athlete_level']} — {gap:.0f} pts pour progresser",
            'text': (f"CTL actuel : {ctl} pts. Pour franchir le prochain palier, augmente ta charge hebdomadaire de "
                     f"5 à 10% par semaine sur 3-4 semaines. Priorité : régularité sur {s['top_sport_label']}.")
        })
    else:
        items.append({
            'type': 'congrats', 'icon': '🏆',
            'title': 'Niveau Expert — maintiens le cap',
            'text': (f"CTL à {ctl} pts — tu es au sommet ! Concentre-toi sur la qualité, la périodisation "
                     f"et la prévention des blessures. Le volume seul ne suffit plus à ce niveau.")
        })

    # 6 — VO2MAX
    if s['last_vo2'] and s['first_vo2']:
        delta_vo2 = round(s['last_vo2'] - s['first_vo2'], 1)
        if delta_vo2 > 0:
            items.append({
                'type': 'congrats', 'icon': '❤️',
                'title': f"VO2max en progression (+{delta_vo2} ml/kg/min)",
                'text': (f"De {s['first_vo2']} à {s['last_vo2']} ml/kg/min. "
                         f"Pour continuer : 2 séances/semaine au-dessus de 85% FCmax (fractionné court, côtes, tempo).")
            })
    elif s['last_vo2']:
        qual = ('excellente (niveau national)' if s['last_vo2']>=60 else
                'très bonne' if s['last_vo2']>=55 else
                'bonne' if s['last_vo2']>=48 else
                'correcte' if s['last_vo2']>=42 else 'à développer')
        items.append({
            'type': 'tip', 'icon': '❤️',
            'title': f"VO2max : {s['last_vo2']} ml/kg/min ({qual})",
            'text': "Pour progresser : fractionné 30/30 à 90-95% FCmax, sorties longues à allure modérée, et 8-9h de sommeil."
        })

    # 7 — RECORD COURSE
    if s['max_run_km'] >= 10:
        label = ('Marathon 🎖️' if s['max_run_km']>=42 else
                 'Semi-marathon' if s['max_run_km']>=21 else
                 f"{s['max_run_km']} km")
        items.append({
            'type': 'congrats', 'icon': '🏃',
            'title': f"Record course — {label}",
            'text': (f"{'Tu as couru un marathon — performance remarquable !' if s['max_run_km']>=42 else f'Record de distance en course : {s[chr(109)+chr(97)+chr(120)+chr(95)+chr(114)+chr(117)+chr(110)+chr(95)+chr(107)+chr(109)]} km.'} "
                     f"Continue à travailler le volume de base pour allonger encore la distance sans vous blesser.")
        })

    # 8 — POIDS
    if s['last_weight'] and s['weight_trend'] is not None:
        w, t = s['last_weight'], s['weight_trend']
        if abs(t) > 0.5:
            tend_txt = f"+{t} kg" if t > 0 else f"{t} kg"
            commentaire = (
                "Une légère prise de masse peut être du muscle si tu fais de la musculation." if t > 0
                else "Assure-toi de manger suffisamment pour ne pas perdre de masse musculaire."
            )
            items.append({
                'type': 'tip', 'icon': '⚖️',
                'title': f"Poids : {w} kg ({tend_txt} sur la période)",
                'text': f"{commentaire} Apport protéiné recommandé : {round(w*1.7)}-{round(w*2)} g/jour."
            })

    # Limiter à 5 conseils
    return items[:5]

# ── Main ───────────────────────────────────────────────────────────────────────
def main():
    _load_env()

    url = os.environ.get('SUPABASE_URL') or input('SUPABASE_URL : ').strip()
    key = os.environ.get('SUPABASE_KEY') or input('SUPABASE_KEY (service role) : ').strip()

    from supabase import create_client
    sb = create_client(url, key)

    print("📊 Récupération des activités…")
    acts_r = sb.table('activities').select(
        'date,type,type_label,duration_min,distance_km,training_load,vo2max'
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

    print("\n── Métriques clés ──────────────────────────────────────")
    print(f"  CTL {stats['ctl']}  ATL {stats['atl']}  TSB {stats['tsb']:+.1f}")
    print(f"  Charge semaine : {stats['week_load']} pts  (moy. {stats['avg_wk_load']} pts)")
    print(f"  Sommeil 7j : {stats['avg_sleep'] and round(stats['avg_sleep']/60,1) or '–'}h   HRV : {stats['avg_hrv_now'] or '–'} ms")
    print(f"  Poids : {stats['last_weight'] or '–'} kg   VO2max : {stats['last_vo2'] or '–'}")
    print(f"  Niveau : {stats['athlete_level']}  |  {stats['total_acts']} activités  {stats['total_dist']} km  {stats['total_hours']}h")
    print("──────────────────────────────────────────────────────\n")

    items = generate_advice(stats)
    print(f"✅ {len(items)} conseils générés :")
    for it in items:
        print(f"   {it['icon']} [{it['type']}] {it['title']}")

    coach = {
        "updated_at": datetime.now().strftime('%Y-%m-%d'),
        "coach": "Claude",
        "stats_snapshot": {
            "ctl": stats['ctl'], "atl": stats['atl'], "tsb": stats['tsb'],
            "niveau": stats['athlete_level'],
            "total_activites": stats['total_acts'],
            "total_km": stats['total_dist'],
        },
        "items": items
    }

    with open(COACH_FILE, 'w', encoding='utf-8') as f:
        json.dump(coach, f, ensure_ascii=False, indent=2)
    print(f"\n📝 coach.json mis à jour")

    # Git commit & push
    try:
        subprocess.run(['git', 'add', 'coach.json'], cwd=BASE, check=True)
        msg = f"coach: analyse automatique du {datetime.now().strftime('%d/%m/%Y %H:%M')}"
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

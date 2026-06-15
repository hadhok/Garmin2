#!/usr/bin/env python3
"""
rowing_tracker.py — Suivi du plan d'intégration rameur.

Monitore :
  • Progression des phases (adaptation → consolidation → progression)
  • Compliance aux séances planifiées (1/semaine, mardi matin)
  • Impact sur CTL/ATL/TSB et HRV
  • Signaux de surcharge ou d'adaptation positive

Usage :
  python3 rowing_tracker.py
"""
import os, json, re, subprocess
from datetime import datetime, timedelta

BASE = os.path.dirname(os.path.abspath(__file__))
COACH_FILE = os.path.join(BASE, 'coach.json')

def load_coach():
    """Charge le coach.json et retourne la config rameur."""
    with open(COACH_FILE, 'r', encoding='utf-8') as f:
        coach = json.load(f)
    return coach.get('rowing_plan', {})

def _load_env():
    """Charge les variables d'env depuis .env"""
    p = os.path.join(BASE, '.env')
    if os.path.exists(p):
        with open(p) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    k, v = line.split('=', 1)
                    os.environ.setdefault(k.strip(), v.strip().strip('"\''))

def get_rowing_activities(sb, weeks=16):
    """Récupère toutes les séances de rameur des N dernières semaines."""
    cutoff = (datetime.now() - timedelta(days=weeks*7)).strftime('%Y-%m-%d')
    acts_r = sb.table('activities').select(
        'date,type,duration_min,training_load,hr_zones_pct,pace_min_km'
    ).eq('type', 'rowing').gte('date', cutoff).order('date', desc=False).execute()
    return acts_r.data or []

def analyze_rowing_progression(rowing_acts, coach_plan):
    """
    Analyse la progression du plan rameur.
    Retourne phase actuelle, compliance, impact sur charge, et signaux.
    """
    if not rowing_acts:
        return {
            'status': 'not_started',
            'message': '❌ Aucune séance rameur enregistrée. Démarrage prévu ' + coach_plan.get('start_date', '–'),
            'compliance': 0,
            'next_action': 'Ajouter la première séance de rameur le jour prévu',
        }

    # Récupère les dates
    start_date = datetime.fromisoformat(coach_plan.get('start_date', '2026-06-17')).date()
    first_rowing = datetime.fromisoformat(rowing_acts[0]['date']).date()
    last_rowing = datetime.fromisoformat(rowing_acts[-1]['date']).date()
    weeks_since_start = (last_rowing - start_date).days // 7

    # Détermine la phase
    if weeks_since_start < 4:
        phase_name = 'Adaptation'
        target_frequency = 1
        target_duration = (30, 40)
    elif weeks_since_start < 12:
        phase_name = 'Consolidation'
        target_frequency = 1
        target_duration = (45, 60)
    else:
        phase_name = 'Progression'
        target_frequency = 1.5
        target_duration = (50, 70)

    # Analyse compliance (fréquence attendue vs réelle)
    weeks_elapsed = weeks_since_start + 1
    expected_sessions = int(weeks_elapsed * target_frequency)
    actual_sessions = len(rowing_acts)
    compliance = round(100 * actual_sessions / max(expected_sessions, 1))

    # Durée moyenne et charge
    avg_duration = round(sum(a.get('duration_min', 0) for a in rowing_acts) / len(rowing_acts), 1)
    total_training_load = sum(a.get('training_load', 0) for a in rowing_acts)
    avg_load = round(total_training_load / len(rowing_acts), 1)

    # Signaux : zones et intensité
    zones_data = [a.get('hr_zones_pct', []) for a in rowing_acts if a.get('hr_zones_pct')]
    z2_ratio = None
    if zones_data:
        avg_z2 = sum(z[1] for z in zones_data if len(z) > 1) / len(zones_data)
        z2_ratio = round(avg_z2)

    # Tendance durée et charge (première vs dernière séance)
    duration_trend = rowing_acts[-1].get('duration_min', 0) - rowing_acts[0].get('duration_min', 0)
    load_trend = rowing_acts[-1].get('training_load', 0) - rowing_acts[0].get('training_load', 0)

    # Messages
    messages = []
    if compliance >= 80:
        messages.append(f"✅ Compliance excellente ({compliance}%) — suis le plan à la lettre")
    elif compliance >= 60:
        messages.append(f"⚠️ Compliance modérée ({compliance}%) — rate des séances prévues")
    else:
        messages.append(f"❌ Compliance faible ({compliance}%) — besoin de rattraper")

    if avg_duration < target_duration[0]:
        messages.append(f"⏱️ Durée moyenne {avg_duration} min < cible ({target_duration[0]}-{target_duration[1]} min)")
    elif avg_duration > target_duration[1]:
        messages.append(f"💪 Durée moyenne {avg_duration} min > cible (possible surcharge si récupération insuffisante)")
    else:
        messages.append(f"✅ Durée {avg_duration} min conforme au plan")

    if z2_ratio and z2_ratio >= 70:
        messages.append(f"✅ Zone 2 {z2_ratio}% (cible : 70-85% pour adaptation aérobie)")
    elif z2_ratio:
        messages.append(f"⚠️ Zone 2 {z2_ratio}% — augmente l'intensité Z2 (baisse Z3+)")

    if duration_trend > 0:
        messages.append(f"📈 Durée en progression (+{duration_trend} min vs démarrage)")
    elif duration_trend < -5:
        messages.append(f"⚠️ Durée en régression ({duration_trend} min) — peut indiquer fatigue")

    next_review_date = coach_plan.get('next_review', '2026-07-01')

    return {
        'status': 'in_progress',
        'phase': phase_name,
        'weeks': weeks_since_start,
        'sessions_count': actual_sessions,
        'compliance': compliance,
        'avg_duration': avg_duration,
        'avg_load': avg_load,
        'z2_ratio': z2_ratio,
        'duration_trend': duration_trend,
        'load_trend': load_trend,
        'messages': messages,
        'next_review': next_review_date,
    }

def main():
    _load_env()

    print("🚣 ═══════════════════════════════════════════════════════════════════")
    print("🚣 Rowing Plan Tracker")
    print("🚣 ═══════════════════════════════════════════════════════════════════\n")

    coach_plan = load_coach()
    if not coach_plan.get('enabled'):
        print("ℹ️  Le plan rameur n'est pas activé dans coach.json")
        return

    url = os.environ.get('SUPABASE_URL') or input('SUPABASE_URL : ').strip()
    key = os.environ.get('SUPABASE_KEY') or input('SUPABASE_KEY : ').strip()

    from supabase import create_client
    sb = create_client(url, key)

    print("📊 Récupération des séances de rameur…")
    rowing_acts = get_rowing_activities(sb, weeks=16)
    print(f"   → {len(rowing_acts)} séances trouvées\n")

    analysis = analyze_rowing_progression(rowing_acts, coach_plan)

    print(f"Status:        {analysis['status']}")
    if analysis['status'] == 'in_progress':
        print(f"Phase:         {analysis['phase']} (semaine {analysis['weeks']})")
        print(f"Séances:       {analysis['sessions_count']}")
        print(f"Compliance:    {analysis['compliance']}%")
        print(f"Durée moy.:    {analysis['avg_duration']} min")
        print(f"Charge moy.:   {analysis['avg_load']} TSS")
        if analysis['z2_ratio']:
            print(f"Zone 2:        {analysis['z2_ratio']}%")
        if analysis['duration_trend']:
            print(f"Durée trend:   {analysis['duration_trend']:+.0f} min")
        print(f"Prochain RDV:  {analysis['next_review']}\n")

        print("📋 Signaux & Recommandations :")
        for msg in analysis['messages']:
            print(f"   {msg}")
    else:
        print(f"\nℹ️  {analysis['message']}")
        print(f"   Prochaine action : {analysis['next_action']}")

    print("\n🚣 ═══════════════════════════════════════════════════════════════════")

if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""
Migration unique : JSON locaux → Supabase.
Importe activities.json et wellness.json dans les tables Supabase.

Usage :
  SUPABASE_URL=... SUPABASE_KEY=... python3 migrate_to_supabase.py
"""
import os, json
from datetime import datetime
from supabase import create_client

BASE          = os.path.dirname(os.path.abspath(__file__))
ACTIVITIES_F  = os.path.join(BASE, 'data', 'activities.json')
WELLNESS_F    = os.path.join(BASE, 'data', 'wellness.json')

BATCH = 50  # nb de lignes par upsert

INT_FIELDS = ('calories', 'hr_avg', 'hr_max', 'intensity_min')

def _clean(act):
    """Convertit les champs entiers en int (Garmin les renvoie parfois en float)."""
    a = dict(act)
    for field in INT_FIELDS:
        if a.get(field) is not None:
            a[field] = int(a[field])
    return a

def chunked(lst, n):
    for i in range(0, len(lst), n):
        yield lst[i:i+n]

def main():
    url = os.environ.get('SUPABASE_URL') or input('SUPABASE_URL : ').strip()
    key = os.environ.get('SUPABASE_KEY') or input('SUPABASE_KEY (service role) : ').strip()

    sb = create_client(url, key)

    # ── Activités ───────────────────────────────────────────────────────────
    if os.path.exists(ACTIVITIES_F):
        with open(ACTIVITIES_F) as f:
            d = json.load(f)

        acts = [_clean(a) for a in d.get('activities', [])]
        print(f"Migration de {len(acts)} activités…")

        for i, batch in enumerate(chunked(acts, BATCH)):
            sb.table('activities').upsert(batch).execute()
            print(f"  {min((i+1)*BATCH, len(acts))}/{len(acts)}", end='\r')

        # Mise à jour sync_meta
        sb.table('sync_meta').upsert({
            'id': 1,
            'last_sync': d.get('last_sync', datetime.now().isoformat()),
            'total_activities': len(acts),
        }).execute()

        print(f"\nActivités OK — {len(acts)} lignes insérées.")
    else:
        print(f"Fichier introuvable : {ACTIVITIES_F}")

    # ── Wellness ────────────────────────────────────────────────────────────
    if os.path.exists(WELLNESS_F):
        with open(WELLNESS_F) as f:
            w = json.load(f)

        days = w.get('days', {})
        records = [{'date': date, 'data': day} for date, day in days.items()]
        print(f"\nMigration de {len(records)} jours wellness…")

        for batch in chunked(records, BATCH):
            sb.table('wellness_days').upsert(batch).execute()

        print(f"Wellness OK — {len(records)} jours insérés.")
    else:
        print(f"Fichier introuvable : {WELLNESS_F}")

    print("\nMigration terminée. Déploie maintenant sur Vercel.")

if __name__ == '__main__':
    main()

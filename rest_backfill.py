#!/usr/bin/env python3
"""
Backfill : remplit rest_min (temps de pause cumulé = durée totale - durée en
mouvement) pour les activités existantes en base. Un seul appel Garmin
(get_activities) suffit — ce champ est déjà dans le résumé d'activité.
Usage : python3 rest_backfill.py
"""
import os, json
from garminconnect import Garmin
from supabase import create_client


def main():
    sb = create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_KEY'])

    tok = sb.table('garmin_tokens').select('tokens').eq('id', 1).limit(1).execute()
    token_dir = '/tmp/garth_tokens'
    os.makedirs(token_dir, exist_ok=True)
    with open(os.path.join(token_dir, 'garmin_tokens.json'), 'w') as f:
        json.dump(tok.data[0]['tokens'], f)

    client = Garmin()
    client.login(token_dir)

    res = sb.table('activities').select('id, date, name, rest_min').execute()
    candidates = {a['id'] for a in res.data if a.get('rest_min') is None}
    print(f"{len(candidates)} activités à compléter (sur {len(res.data)} au total).")

    if not candidates:
        return

    raw_acts = client.get_activities(0, 300)
    done = 0
    for raw in raw_acts:
        aid = raw.get('activityId')
        if aid not in candidates:
            continue

        dur_s    = raw.get('duration', 0) or 0
        moving_s = raw.get('movingDuration', 0) or 0
        rest_min = round((dur_s - moving_s) / 60, 1) if moving_s and dur_s > moving_s else None

        sb.table('activities').update({'rest_min': rest_min}).eq('id', aid).execute()
        done += 1
        print(f"  ✅ {raw.get('startTimeLocal','')[:10]} {raw.get('activityName')}: rest_min={rest_min}")

    print(f"\n{done} activités mises à jour.")


if __name__ == '__main__':
    main()

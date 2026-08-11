#!/usr/bin/env python3
"""
Backfill : remplit pace_per_100m/swolf/swim_cadence/pool_lengths pour les
activités de natation existantes en base. Un seul appel Garmin (get_activities)
suffit — ces champs sont déjà dans le résumé d'activité, pas besoin de détails.
Usage : python3 swim_backfill.py
"""
import os, json
from garminconnect import Garmin
from supabase import create_client


def _format_swim_pace(speed_ms):
    if not speed_ms or speed_ms <= 0:
        return None
    secs = 100 / speed_ms
    return f"{int(secs // 60)}:{int(secs % 60):02d}"


def main():
    sb = create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_KEY'])

    tok = sb.table('garmin_tokens').select('tokens').eq('id', 1).limit(1).execute()
    token_dir = '/tmp/garth_tokens'
    os.makedirs(token_dir, exist_ok=True)
    with open(os.path.join(token_dir, 'garmin_tokens.json'), 'w') as f:
        json.dump(tok.data[0]['tokens'], f)

    client = Garmin()
    client.login(token_dir)

    # Récupère les activités natation en base sans pace_per_100m
    res = sb.table('activities') \
        .select('id, date, name, type, pace_per_100m') \
        .eq('type', 'swim') \
        .execute()
    candidates = {a['id'] for a in res.data if a.get('pace_per_100m') is None}
    print(f"{len(candidates)} activités de natation à compléter (sur {len(res.data)} au total).")

    if not candidates:
        return

    raw_acts = client.get_activities(0, 300)
    done = 0
    for raw in raw_acts:
        aid = raw.get('activityId')
        if aid not in candidates:
            continue

        speed_ms = raw.get('averageSpeed', 0) or 0
        update = {
            'pace_per_100m': _format_swim_pace(speed_ms),
            'swolf':         round(raw['averageSwolf']) if raw.get('averageSwolf') else None,
            'swim_cadence':  round(raw['averageSwimCadenceInStrokesPerMinute']) if raw.get('averageSwimCadenceInStrokesPerMinute') else None,
            'pool_lengths':  int(raw['activeLengths']) if raw.get('activeLengths') else None,
        }
        sb.table('activities').update(update).eq('id', aid).execute()
        done += 1
        print(f"  ✅ {raw.get('startTimeLocal','')[:10]} {raw.get('activityName')}: {update}")

    print(f"\n{done} activités de natation mises à jour.")


if __name__ == '__main__':
    main()

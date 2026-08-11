#!/usr/bin/env python3
"""
Backfill : calcule la dérive intra-séance (SWOLF/FC) et la répartition par
style de nage pour les activités de natation existantes.
Usage : python3 swim_drift_backfill.py
"""
import os, json
from garminconnect import Garmin
from supabase import create_client


def compute_swim_drift(client, activity_id):
    try:
        splits = client.get_activity_splits(activity_id)
    except Exception:
        return None, None, None

    lengths = []
    for lap in splits.get('lapDTOs', []):
        for length in lap.get('lengthDTOs', []):
            if length.get('distance'):
                lengths.append(length)

    if len(lengths) < 6:
        return None, None, None

    third = max(1, len(lengths) // 3)
    first, last = lengths[:third], lengths[-third:]

    def avg(key, arr):
        vals = [x.get(key) for x in arr if x.get(key) is not None]
        return sum(vals) / len(vals) if vals else None

    swolf_first, swolf_last = avg('averageSWOLF', first), avg('averageSWOLF', last)
    hr_first, hr_last = avg('averageHR', first), avg('averageHR', last)
    drift_swolf = round(swolf_last - swolf_first, 1) if swolf_first is not None and swolf_last is not None else None
    drift_hr = round(hr_last - hr_first, 1) if hr_first is not None and hr_last is not None else None

    stroke_dur, total_dur = {}, 0
    for l in lengths:
        st = l.get('swimStroke') or 'UNKNOWN'
        d = l.get('duration', 0) or 0
        stroke_dur[st] = stroke_dur.get(st, 0) + d
        total_dur += d
    stroke_pct = {k: round(v / total_dur * 100) for k, v in stroke_dur.items()} if total_dur > 0 else None

    return drift_swolf, drift_hr, stroke_pct


def main():
    sb = create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_KEY'])

    tok = sb.table('garmin_tokens').select('tokens').eq('id', 1).limit(1).execute()
    token_dir = '/tmp/garth_tokens'
    os.makedirs(token_dir, exist_ok=True)
    with open(os.path.join(token_dir, 'garmin_tokens.json'), 'w') as f:
        json.dump(tok.data[0]['tokens'], f)

    client = Garmin()
    client.login(token_dir)

    res = sb.table('activities') \
        .select('id, date, name, type, hr_avg, swim_drift_swolf') \
        .eq('type', 'swim') \
        .execute()
    candidates = [a for a in res.data if a.get('hr_avg') and a.get('swim_drift_swolf') is None]
    print(f"{len(candidates)} activités de natation à traiter (sur {len(res.data)} au total).")

    done = 0
    for a in candidates:
        drift_swolf, drift_hr, stroke_pct = compute_swim_drift(client, a['id'])
        update = {
            'swim_drift_swolf': drift_swolf,
            'swim_drift_hr': drift_hr,
            'swim_stroke_pct': stroke_pct,
        }
        sb.table('activities').update(update).eq('id', a['id']).execute()
        if drift_swolf is not None:
            done += 1
        print(f"  {'✅' if drift_swolf is not None else '⏭️ '} {a['date']} {a['name']}: {update}")

    print(f"\n{done} activités mises à jour avec une dérive exploitable.")


if __name__ == '__main__':
    main()

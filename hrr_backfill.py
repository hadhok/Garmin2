#!/usr/bin/env python3
"""
Backfill : calcule la récupération cardiaque (HRR) pour toutes les activités
existantes en base qui n'ont pas encore hrr_60s/hrr_120s, et met à jour Supabase.
Usage : python3 hrr_backfill.py [--limit 50]
"""
import os, sys, json, argparse, time
from garminconnect import Garmin

HRR_TYPES = {'run', 'hiit', 'cardio', 'bike', 'rowing', 'hike'}


def _get_client_and_sb():
    from supabase import create_client
    sb_url = os.environ['SUPABASE_URL']
    sb_key = os.environ['SUPABASE_KEY']
    sb = create_client(sb_url, sb_key)

    tok = sb.table('garmin_tokens').select('tokens').eq('id', 1).limit(1).execute()
    if not tok.data or not tok.data[0].get('tokens'):
        raise Exception("Tokens Garmin introuvables en base.")

    token_dir = '/tmp/garth_tokens'
    os.makedirs(token_dir, exist_ok=True)
    with open(os.path.join(token_dir, 'garmin_tokens.json'), 'w') as f:
        json.dump(tok.data[0]['tokens'], f)

    client = Garmin()
    client.login(token_dir)
    return client, sb


def compute_hrr(client, activity_id):
    try:
        details = client.get_activity_details(activity_id)
    except Exception as e:
        print(f"    ⚠️  Erreur API pour {activity_id}: {e}")
        return None, None

    metrics = details.get('activityDetailMetrics', [])
    if not metrics:
        return None, None

    metric_names = [d.get('key') for d in details.get('metricDescriptors', [])]
    try:
        hr_idx = metric_names.index('directHeartRate')
        time_idx = metric_names.index('sumElapsedDuration')
    except ValueError:
        return None, None

    points = []
    for m in metrics:
        vals = m.get('metrics', [])
        if len(vals) > max(hr_idx, time_idx) and vals[hr_idx] is not None:
            points.append((vals[time_idx], vals[hr_idx]))
    if not points:
        return None, None

    points.sort(key=lambda p: p[0])
    peak_t, peak_hr = max(points, key=lambda p: p[1])
    end_t = points[-1][0]

    def hr_at(offset_s):
        target = peak_t + offset_s
        candidates = [p for p in points if p[0] >= target]
        return candidates[0][1] if candidates else None

    hrr_60 = hrr_120 = None
    if end_t >= peak_t + 60:
        hr_60 = hr_at(60)
        if hr_60 is not None:
            hrr_60 = round(peak_hr - hr_60, 1)
    if end_t >= peak_t + 120:
        hr_120 = hr_at(120)
        if hr_120 is not None:
            hrr_120 = round(peak_hr - hr_120, 1)
    return hrr_60, hrr_120


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--limit', type=int, default=50, help='Nombre max d\'activités à traiter')
    args = ap.parse_args()

    client, sb = _get_client_and_sb()

    res = sb.table('activities') \
        .select('id, date, type, name, hr_avg, hrr_60s, hrr_120s') \
        .order('date', desc=True) \
        .execute()

    candidates = [
        a for a in res.data
        if a.get('type') in HRR_TYPES and a.get('hr_avg') and a.get('hrr_60s') is None
    ]
    candidates = candidates[:args.limit]

    print(f"{len(candidates)} activités à traiter (sur {len(res.data)} au total).")

    done = 0
    for a in candidates:
        hrr_60, hrr_120 = compute_hrr(client, a['id'])
        if hrr_60 is not None or hrr_120 is not None:
            sb.table('activities').update({
                'hrr_60s': hrr_60,
                'hrr_120s': hrr_120,
            }).eq('id', a['id']).execute()
            done += 1
            print(f"  ✅ {a['date']} {a['name']}: HRR-60s={hrr_60} HRR-120s={hrr_120}")
        else:
            # Marque comme traité avec 0 pour ne pas la re-tenter en boucle si pas de données
            sb.table('activities').update({'hrr_60s': 0, 'hrr_120s': 0}).eq('id', a['id']).execute()
            print(f"  ⏭️  {a['date']} {a['name']}: pas de données FC détaillées disponibles")
        time.sleep(0.3)  # évite le rate-limit Garmin

    print(f"\n{done} activités mises à jour avec des valeurs HRR exploitables.")


if __name__ == '__main__':
    main()

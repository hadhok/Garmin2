#!/usr/bin/env python3
"""
Calcule la récupération cardiaque (HRR) sur les N dernières activités d'un type donné.
Usage : python3 hrr_check.py --type hiit --name-contains hyrox --limit 2
HRR = FC max atteinte pendant l'effort - FC ~60s/120s après la fin de l'enregistrement.
"""
import os, sys, argparse, json
from garminconnect import Garmin


def _get_client():
    """Auth via tokens Supabase (même mécanisme que api/sync.py), avec fallback tokens locaux."""
    token_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.garth_tokens')

    sb_url = os.environ.get('SUPABASE_URL')
    sb_key = os.environ.get('SUPABASE_KEY')
    if sb_url and sb_key:
        from supabase import create_client
        sb = create_client(sb_url, sb_key)
        tok = sb.table('garmin_tokens').select('tokens').eq('id', 1).limit(1).execute()
        if tok.data and tok.data[0].get('tokens'):
            token_dir = '/tmp/garth_tokens'
            os.makedirs(token_dir, exist_ok=True)
            with open(os.path.join(token_dir, 'garmin_tokens.json'), 'w') as f:
                json.dump(tok.data[0]['tokens'], f)

    if not os.path.exists(token_dir):
        print("Pas de tokens Garmin trouvés (ni Supabase ni local).", file=sys.stderr)
        sys.exit(1)

    client = Garmin()
    client.login(token_dir)
    return client


def compute_hrr(client, activity_id, activity_name, activity_date):
    details = client.get_activity_details(activity_id)
    metrics = details.get('activityDetailMetrics', [])
    if not metrics:
        print(f"  ⚠️  Pas de série FC disponible pour cette activité.")
        return

    metric_names = [d.get('key') for d in details.get('metricDescriptors', [])]
    try:
        hr_idx = metric_names.index('directHeartRate')
        time_idx = metric_names.index('sumElapsedDuration')
    except ValueError:
        print(f"  ⚠️  Pas de champ FC/temps dans les métriques.")
        return

    points = []
    for m in metrics:
        vals = m.get('metrics', [])
        if len(vals) > max(hr_idx, time_idx) and vals[hr_idx] is not None:
            points.append((vals[time_idx], vals[hr_idx]))

    if not points:
        print(f"  ⚠️  Aucun point FC exploitable.")
        return

    points.sort(key=lambda p: p[0])
    peak_t, peak_hr = max(points, key=lambda p: p[1])
    end_t = points[-1][0]

    def hr_at(offset_s):
        target = peak_t + offset_s
        candidates = [p for p in points if p[0] >= target]
        return candidates[0][1] if candidates else None

    hr_60 = hr_at(60)
    hr_120 = hr_at(120)

    print(f"  Pic FC : {peak_hr} bpm (à {peak_t/60:.1f} min, fin activité à {end_t/60:.1f} min)")
    if hr_60 is not None and end_t >= peak_t + 60:
        print(f"  FC à +60s : {hr_60} bpm  →  HRR-60s = {peak_hr - hr_60} bpm")
    else:
        print(f"  FC à +60s : non enregistrée (l'activité s'est arrêtée avant +60s après le pic)")
    if hr_120 is not None and end_t >= peak_t + 120:
        print(f"  FC à +120s : {hr_120} bpm  →  HRR-120s = {peak_hr - hr_120} bpm")
    else:
        print(f"  FC à +120s : non enregistrée")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--name-contains', default='hyrox')
    ap.add_argument('--limit', type=int, default=2)
    args = ap.parse_args()

    client = _get_client()

    raw_activities = client.get_activities(0, 200)
    matches = [
        a for a in raw_activities
        if args.name_contains.lower() in (a.get('activityName') or '').lower()
    ]
    matches.sort(key=lambda a: a.get('startTimeLocal', ''), reverse=True)
    matches = matches[:args.limit]

    if not matches:
        print(f"Aucune activité contenant '{args.name_contains}' trouvée.")
        return

    for a in matches:
        print(f"\n=== {a.get('activityName')} — {a.get('startTimeLocal', '')[:10]} ===")
        compute_hrr(client, a.get('activityId'), a.get('activityName'), a.get('startTimeLocal'))


if __name__ == '__main__':
    main()

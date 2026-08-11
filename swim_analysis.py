#!/usr/bin/env python3
"""Exporte toutes les activités de natation en JSON pour analyse."""
import os, json
from supabase import create_client

sb = create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_KEY'])

res = sb.table('activities') \
    .select('id, date, name, duration_min, distance_km, calories, hr_avg, hr_max, '
            'training_load, pace_per_100m, swolf, swim_cadence, pool_lengths, rest_min, hr_zones_pct') \
    .eq('type', 'swim') \
    .order('date') \
    .execute()

print(json.dumps(res.data, ensure_ascii=False))

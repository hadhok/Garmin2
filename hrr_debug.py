#!/usr/bin/env python3
"""Diagnostic : affiche l'état brut des champs HRR pour une activité donnée en base."""
import os
from supabase import create_client

sb = create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_KEY'])

res = sb.table('activities') \
    .select('id, date, name, type, hr_avg, hrr_60s, hrr_120s') \
    .order('date', desc=True) \
    .limit(10) \
    .execute()

for row in res.data:
    print(row)

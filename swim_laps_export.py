#!/usr/bin/env python3
"""Exporte les longueurs (laps) détaillées des 2 dernières séances de natation."""
import os, json
from garminconnect import Garmin
from supabase import create_client

sb = create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_KEY'])
tok = sb.table('garmin_tokens').select('tokens').eq('id', 1).limit(1).execute()
token_dir = '/tmp/garth_tokens'
os.makedirs(token_dir, exist_ok=True)
with open(os.path.join(token_dir, 'garmin_tokens.json'), 'w') as f:
    json.dump(tok.data[0]['tokens'], f)

client = Garmin()
client.login(token_dir)

acts = client.get_activities(0, 200)
swims = [a for a in acts if a.get('activityType', {}).get('typeKey') in ('lap_swimming', 'open_water_swimming')]
swims.sort(key=lambda a: a.get('startTimeLocal', ''), reverse=True)
last2 = swims[:2]

for a in last2:
    aid = a.get('activityId')
    print(f"\n\n=== {a.get('activityName')} — {a.get('startTimeLocal')} (id={aid}) ===")
    try:
        splits = client.get_activity_splits(aid)
        print(json.dumps(splits, ensure_ascii=False, default=str)[:6000])
    except Exception as e:
        print("get_activity_splits error:", e)

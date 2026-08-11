#!/usr/bin/env python3
"""Diagnostic : affiche le payload brut Garmin pour la dernière activité de natation."""
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

if not swims:
    print("Aucune activité de natation trouvée.")
else:
    a = swims[0]
    print(f"=== {a.get('activityName')} — {a.get('startTimeLocal')} ===")
    print(json.dumps(a, indent=2, ensure_ascii=False, default=str))

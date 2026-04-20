#!/usr/bin/env python3
"""
Copie les tokens Garmin (.garth_tokens/garmin_tokens.json) vers Supabase.
À exécuter une seule fois après setup_garmin.py.

Usage :
  SUPABASE_URL=... SUPABASE_KEY=... python3 setup_supabase_tokens.py
"""
import os, json
from datetime import datetime
from supabase import create_client

BASE      = os.path.dirname(os.path.abspath(__file__))
TOKEN_DIR = os.path.join(BASE, '.garth_tokens')
TOKEN_FILE = os.path.join(TOKEN_DIR, 'garmin_tokens.json')

def main():
    url = os.environ.get('SUPABASE_URL') or input('SUPABASE_URL : ').strip()
    key = os.environ.get('SUPABASE_KEY') or input('SUPABASE_KEY (service role) : ').strip()

    if not os.path.exists(TOKEN_FILE):
        print(f"Erreur : token introuvable → {TOKEN_FILE}")
        print("Lance d'abord : python3 setup_garmin.py")
        return

    sb = create_client(url, key)

    with open(TOKEN_FILE) as f:
        tokens = json.load(f)

    sb.table('garmin_tokens').upsert({
        'id': 1,
        'tokens': tokens,
        'updated_at': datetime.now().isoformat(),
    }).execute()

    print(f"Tokens Garmin sauvegardés dans Supabase (client_id: {tokens.get('di_client_id', '?')}).")

if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""
sync_now.py — Équivalent local du bouton "Synchroniser" de l'app.

Usage :
  python3 sync_now.py          # sync Garmin → Supabase
  python3 sync_now.py --coach  # sync + mise à jour coach.json
"""
import os, sys, json, subprocess
from datetime import datetime, timedelta

BASE = os.path.dirname(os.path.abspath(__file__))

# ── Chargement .env ────────────────────────────────────────────────────────────
def _load_env():
    env_path = os.path.join(BASE, '.env')
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    k, v = line.split('=', 1)
                    os.environ.setdefault(k.strip(), v.strip().strip('"\''))

# ── Import du code de sync depuis api/sync.py ──────────────────────────────────
def _import_sync():
    import importlib.util, sys as _sys
    spec = importlib.util.spec_from_file_location(
        'api_sync', os.path.join(BASE, 'api', 'sync.py')
    )
    mod = importlib.util.load_from_spec(spec) if False else None
    # Import direct des fonctions nécessaires
    spec = importlib.util.spec_from_file_location('api_sync', os.path.join(BASE, 'api', 'sync.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

# ── Sync principal ─────────────────────────────────────────────────────────────
def run_sync():
    _load_env()

    url = os.environ.get('SUPABASE_URL') or input('SUPABASE_URL : ').strip()
    key = os.environ.get('SUPABASE_KEY') or input('SUPABASE_KEY : ').strip()
    os.environ['SUPABASE_URL'] = url
    os.environ['SUPABASE_KEY'] = key

    print("🔄 Démarrage de la synchronisation Garmin…\n")

    # Importer et appeler _run_sync() depuis api/sync.py
    mod = _import_sync()
    result = mod._run_sync()

    # Affichage du résultat
    if result:
        print(f"\n✅ {result}")
    else:
        print("\n✅ Synchronisation terminée")

    return result

# ── Main ───────────────────────────────────────────────────────────────────────
def main():
    with_coach = '--coach' in sys.argv

    try:
        result = run_sync()
    except Exception as e:
        print(f"\n❌ Erreur lors de la synchronisation : {e}")
        import traceback; traceback.print_exc()
        sys.exit(1)

    # Mise à jour du coach si demandé
    if with_coach:
        print("\n🧠 Mise à jour du coach…")
        try:
            import importlib.util
            spec = importlib.util.spec_from_file_location(
                'update_coach', os.path.join(BASE, 'update_coach.py')
            )
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            mod.main()
        except Exception as e:
            print(f"⚠️  Erreur coach : {e}")

if __name__ == '__main__':
    main()

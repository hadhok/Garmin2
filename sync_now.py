#!/usr/bin/env python3
"""
sync_now.py — Équivalent local du bouton "Synchroniser" de l'app.

Usage :
  python3 sync_now.py          # sync Garmin → Supabase
  python3 sync_now.py --coach  # sync + mise à jour coach.json
  python3 sync_now.py --plan   # sync + injection du plan d'entraînement dans Garmin Connect
  python3 sync_now.py --coach --plan  # les deux
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

# ── Cache local (data/*.json) ──────────────────────────────────────────────────
def _dump_local_cache():
    """Rafraîchit data/activities.json et data/wellness.json depuis Supabase."""
    from supabase import create_client
    sb = create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_KEY'])

    # Activités
    acts_r = sb.table('activities').select('*').order('start_time', desc=True).execute()
    meta_r = sb.table('sync_meta').select('last_sync, total_activities').eq('id', 1).limit(1).execute()
    last_sync = meta_r.data[0]['last_sync'] if meta_r.data else datetime.now().isoformat(timespec='seconds')
    total     = meta_r.data[0]['total_activities'] if meta_r.data else len(acts_r.data)
    data_dir  = os.path.join(BASE, 'data')
    os.makedirs(data_dir, exist_ok=True)
    with open(os.path.join(data_dir, 'activities.json'), 'w', encoding='utf-8') as f:
        json.dump({'last_sync': last_sync, 'total': total, 'activities': acts_r.data}, f, ensure_ascii=False)

    # Wellness
    well_r = sb.table('wellness_days').select('date, data').order('date', desc=True).execute()
    days   = {row['date']: row['data'] for row in well_r.data}
    with open(os.path.join(data_dir, 'wellness.json'), 'w', encoding='utf-8') as f:
        json.dump({'last_sync': last_sync, 'days': days}, f, ensure_ascii=False)

    print(f"   → Cache local mis à jour ({total} activités, {len(days)} jours wellness)")

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

    # Mettre à jour les fichiers locaux pour le serveur Flask
    try:
        _dump_local_cache()
    except Exception as e:
        print(f"   ⚠️  Cache local non mis à jour : {e}")

    # Affichage du résultat
    if result:
        print(f"\n✅ {result}")
    else:
        print("\n✅ Synchronisation terminée")

    return result

# ── Main ───────────────────────────────────────────────────────────────────────
def main():
    with_coach = '--coach' in sys.argv
    with_plan  = '--plan'  in sys.argv

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

    # Injection du plan d'entraînement si demandé
    if with_plan:
        print("\n📋 Injection du plan d'entraînement dans Garmin Connect…")
        try:
            import importlib.util
            spec = importlib.util.spec_from_file_location(
                'push_plan', os.path.join(BASE, 'push_plan.py')
            )
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            mod.push_plan_to_garmin()
        except Exception as e:
            print(f"⚠️  Erreur plan : {e}")
            import traceback; traceback.print_exc()

if __name__ == '__main__':
    main()

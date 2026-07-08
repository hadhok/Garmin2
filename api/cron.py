from http.server import BaseHTTPRequestHandler
import json, os, sys

sys.path.insert(0, os.path.dirname(__file__))
from sync import _run_sync
from _renpho_sync import run_renpho_sync
from update_coach import run_coach_update


def _sync_recent_details():
    """Fetch les détails des 5 dernières activités sans details (runs en priorité)."""
    from supabase import create_client
    from activity_details import _fetch_and_store, _get_garmin_client

    sb = create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_KEY'])

    existing_ids = {
        r['activity_id']
        for r in (sb.table('activity_details').select('activity_id').execute().data or [])
    }

    # Priorité aux courses, puis les autres
    acts = (sb.table('activities')
              .select('id,type,date')
              .order('date', desc=True)
              .limit(50)
              .execute().data or [])

    to_fetch = [a for a in acts if a['id'] not in existing_ids]
    # Runs en premier
    to_fetch.sort(key=lambda a: (0 if a['type'] == 'run' else 1, a['date']), reverse=False)
    to_fetch = to_fetch[:5]

    if not to_fetch:
        return 'Details: déjà à jour'

    client  = _get_garmin_client(sb)
    synced  = 0
    for act in to_fetch:
        r = _fetch_and_store(act['id'], sb, client)
        if r.get('ok') and r.get('samples', 0) > 0:
            synced += 1

    return f'Details: {synced}/{len(to_fetch)} activités'


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        secret = os.environ.get('CRON_SECRET', '')
        auth   = self.headers.get('Authorization', '')
        if secret and auth != f'Bearer {secret}':
            self.send_response(401)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(b'{"error":"unauthorized"}')
            return

        results = {}
        try:
            results['garmin'] = _run_sync()
        except Exception as e:
            results['garmin'] = f'error: {e}'

        try:
            results['renpho'] = run_renpho_sync()
        except Exception as e:
            results['renpho'] = f'error: {e}'

        try:
            results['details'] = _sync_recent_details()
        except Exception as e:
            results['details'] = f'error: {e}'

        try:
            results['coach'] = run_coach_update()
        except Exception as e:
            results['coach'] = f'error: {e}'

        body = json.dumps({'status': 'ok', 'results': results})
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(body.encode())

    def log_message(self, fmt, *args):
        pass

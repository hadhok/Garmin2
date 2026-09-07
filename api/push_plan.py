from http.server import BaseHTTPRequestHandler
import json as _json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from _auth import check_auth

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from plan_engine import push_plan_to_garmin


def _fetch_data_from_supabase():
    """Pas de disque persistant en serverless : on lit directement Supabase,
    au lieu du cache local data/*.json utilisé par le CLI (sync_now.py)."""
    from supabase import create_client
    sb = create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_KEY'])

    activities = sb.table('activities').select('date,training_load').execute().data or []
    well_r     = sb.table('wellness_days').select('date,data').execute().data or []
    wellness   = {row['date']: (row['data'] or {}) for row in well_r}
    return activities, wellness


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if not check_auth(self): return
        try:
            activities, wellness = _fetch_data_from_supabase()
            pushed = push_plan_to_garmin(activities=activities, wellness=wellness)
            body   = _json.dumps({'ok': True, 'pushed': len(pushed), 'sessions': pushed})
            code   = 200
        except Exception as e:
            body = _json.dumps({'ok': False, 'error': str(e)})
            code = 500

        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(body.encode())

    def log_message(self, fmt, *args):
        pass

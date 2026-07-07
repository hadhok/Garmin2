from http.server import BaseHTTPRequestHandler
import json, os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from _auth import check_auth
from _db import fetch_all_rows


def _sb():
    from supabase import create_client
    return create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_KEY'])


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if not check_auth(self): return
        try:
            sb = _sb()

            activities = fetch_all_rows(lambda a, b:
                sb.table('activities').select('*').order('start_time', desc=True).range(a, b))
            meta = sb.table('sync_meta').select('last_sync, total_activities').eq('id', 1).limit(1).execute()

            last_sync = meta.data[0]['last_sync'] if meta.data else None
            total     = meta.data[0]['total_activities'] if meta.data else len(activities)

            body = json.dumps({
                'total':      total,
                'last_sync':  last_sync,
                'activities': activities,
            })
            code = 200
        except Exception as e:
            body = json.dumps({'error': str(e)})
            code = 500

        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(body.encode())

    def log_message(self, fmt, *args):
        pass

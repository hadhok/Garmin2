from http.server import BaseHTTPRequestHandler
import json, os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from _auth import check_auth


def _sb():
    from supabase import create_client
    return create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_KEY'])


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if not check_auth(self): return
        try:
            sb   = _sb()
            meta = sb.table('sync_meta').select('*').eq('id', 1).limit(1).execute()

            if meta.data and meta.data[0].get('last_sync'):
                body = json.dumps({
                    'synced':    True,
                    'last_sync': meta.data[0]['last_sync'],
                    'total':     meta.data[0].get('total_activities', 0),
                })
            else:
                body = json.dumps({'synced': False})
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

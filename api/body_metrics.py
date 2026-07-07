from http.server import BaseHTTPRequestHandler
import json, os, sys

sys.path.insert(0, os.path.dirname(__file__))
from _auth import check_auth
from _db import fetch_all_rows


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if not check_auth(self): return
        try:
            from supabase import create_client
            sb   = create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_KEY'])
            rows = fetch_all_rows(lambda a, b:
                sb.table('body_metrics').select('*').order('date', desc=False).range(a, b))
            body = json.dumps({'metrics': rows})
            code = 200
        except Exception as e:
            body = json.dumps({'error': str(e)})
            code = 500

        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body.encode())

    def log_message(self, fmt, *args):
        pass

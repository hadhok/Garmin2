from http.server import BaseHTTPRequestHandler
import json, os, sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(__file__))
from _auth import check_auth


def _sb():
    from supabase import create_client
    return create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_KEY'])


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if not check_auth(self): return
        try:
            sb = _sb()
            r = sb.table('race_goal').select('*').eq('id', 1).limit(1).execute()
            row = r.data[0] if r.data else None
            goal = row if row and row.get('date') and row.get('km') else None
            self._respond(200, {'goal': goal})
        except Exception as e:
            self._respond(500, {'error': str(e)})

    def do_POST(self):
        if not check_auth(self): return
        try:
            length  = int(self.headers.get('Content-Length', 0))
            payload = json.loads(self.rfile.read(length)) if length else {}
            sb = _sb()

            if payload.get('clear'):
                sb.table('race_goal').upsert({
                    'id': 1, 'name': None, 'date': None, 'km': None, 'target': None,
                    'updated_at': datetime.now().isoformat(),
                }).execute()
                self._respond(200, {'status': 'ok', 'goal': None})
                return

            date = payload.get('date')
            km   = payload.get('km')
            if not date or not isinstance(km, (int, float)) or km <= 0:
                self._respond(400, {'error': 'date et km (nombre positif) requis'})
                return

            row = {
                'id': 1,
                'name': (payload.get('name') or '').strip() or None,
                'date': date,
                'km': km,
                'target': (payload.get('target') or '').strip() or None,
                'updated_at': datetime.now().isoformat(),
            }
            sb.table('race_goal').upsert(row).execute()
            self._respond(200, {'status': 'ok', 'goal': row})
        except Exception as e:
            self._respond(500, {'error': str(e)})

    def _respond(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        pass

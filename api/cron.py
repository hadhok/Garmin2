from http.server import BaseHTTPRequestHandler
import json, os, sys

# Réutilise la logique de sync
sys.path.insert(0, os.path.dirname(__file__))
from sync import _run_sync


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        # Vercel injecte CRON_SECRET dans l'en-tête Authorization
        secret = os.environ.get('CRON_SECRET', '')
        auth   = self.headers.get('Authorization', '')
        if secret and auth != f'Bearer {secret}':
            self.send_response(401)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(b'{"error":"unauthorized"}')
            return

        try:
            msg  = _run_sync()
            body = json.dumps({'status': 'ok', 'message': msg})
            code = 200
        except Exception as e:
            body = json.dumps({'status': 'error', 'message': str(e)})
            code = 500

        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(body.encode())

    def log_message(self, fmt, *args):
        pass

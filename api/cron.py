from http.server import BaseHTTPRequestHandler
import json, os, sys

# Réutilise la logique de sync
sys.path.insert(0, os.path.dirname(__file__))
from sync import _run_sync
from renpho_sync import run_renpho_sync


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

        results = {}
        try:
            results['garmin'] = _run_sync()
        except Exception as e:
            results['garmin'] = f'error: {e}'

        try:
            results['renpho'] = run_renpho_sync()
        except Exception as e:
            results['renpho'] = f'error: {e}'

        code = 200
        body = json.dumps({'status': 'ok', 'results': results})

        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(body.encode())

    def log_message(self, fmt, *args):
        pass

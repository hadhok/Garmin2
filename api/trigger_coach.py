from http.server import BaseHTTPRequestHandler
import json, os, urllib.request, urllib.error
import sys

sys.path.insert(0, os.path.dirname(__file__))
from _auth import check_auth


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if not check_auth(self): return
        token = os.environ.get('GITHUB_PAT')
        if not token:
            self._respond(500, {'error': 'GITHUB_PAT non configuré'})
            return

        try:
            payload = json.dumps({'ref': 'main'}).encode()
            req = urllib.request.Request(
                'https://api.github.com/repos/hadhok/Garmin2/actions/workflows/daily-coach.yml/dispatches',
                data=payload,
                headers={
                    'Authorization': f'Bearer {token}',
                    'Accept': 'application/vnd.github+json',
                    'Content-Type': 'application/json',
                    'X-GitHub-Api-Version': '2022-11-28',
                },
                method='POST'
            )
            urllib.request.urlopen(req)
            self._respond(200, {'status': 'ok', 'message': 'Workflow déclenché'})
        except urllib.error.HTTPError as e:
            self._respond(e.code, {'error': e.read().decode()})
        except Exception as e:
            self._respond(500, {'error': str(e)})

    def _respond(self, code, data):
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.end_headers()

    def log_message(self, fmt, *args):
        pass

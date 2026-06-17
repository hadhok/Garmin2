from http.server import BaseHTTPRequestHandler
import json, os


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            from supabase import create_client
            sb = create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_KEY'])
            r = sb.table('coach_data').select('data').eq('id', 1).limit(1).execute()
            if r.data:
                body = json.dumps(r.data[0]['data']).encode()
                code = 200
            else:
                body = json.dumps({'error': 'Pas de données coach'}).encode()
                code = 404
        except Exception as e:
            body = json.dumps({'error': str(e)}).encode()
            code = 500

        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        pass

from http.server import BaseHTTPRequestHandler
import json, os


def _sb():
    from supabase import create_client
    return create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_KEY'])


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            sb = _sb()

            result = sb.table('wellness_days').select('date, data').order('date', desc=True).execute()
            meta   = sb.table('sync_meta').select('last_sync').eq('id', 1).limit(1).execute()

            last_sync = meta.data[0]['last_sync'] if meta.data else None
            days = {row['date']: row['data'] for row in result.data}

            body = json.dumps({
                'last_sync': last_sync,
                'days':      days,
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

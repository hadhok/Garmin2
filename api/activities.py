from http.server import BaseHTTPRequestHandler
import json, os


def _sb():
    from supabase import create_client
    return create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_KEY'])


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            sb = _sb()

            result = sb.table('activities').select('*').order('start_time', desc=True).execute()
            meta   = sb.table('sync_meta').select('last_sync, total_activities').eq('id', 1).limit(1).execute()

            last_sync = meta.data[0]['last_sync'] if meta.data else None
            total     = meta.data[0]['total_activities'] if meta.data else len(result.data)

            body = json.dumps({
                'total':      total,
                'last_sync':  last_sync,
                'activities': result.data,
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

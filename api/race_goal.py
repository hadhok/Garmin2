from http.server import BaseHTTPRequestHandler
import json, os, sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(__file__))
from _auth import check_auth


def _sb():
    from supabase import create_client
    return create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_KEY'])


def _migrate_legacy_goal(sb):
    """Bascule une fois l'ancien objectif unique (table race_goal, id=1,
    un seul objectif possible) vers race_goals (plusieurs objectifs) —
    seulement si cette dernière est encore vide, pour ne jamais dupliquer."""
    try:
        existing = sb.table('race_goals').select('id').limit(1).execute()
        if existing.data:
            return
        legacy = sb.table('race_goal').select('*').eq('id', 1).limit(1).execute()
        if legacy.data and legacy.data[0].get('date') and legacy.data[0].get('km'):
            g = legacy.data[0]
            sb.table('race_goals').insert({
                'name': g.get('name'), 'date': g['date'], 'km': g['km'],
                'target': g.get('target'), 'updated_at': datetime.now().isoformat(),
            }).execute()
    except Exception:
        pass  # table race_goals absente (schéma pas encore migré) : ignoré


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if not check_auth(self): return
        try:
            sb = _sb()
            _migrate_legacy_goal(sb)
            r = sb.table('race_goals').select('*').order('date').execute()
            self._respond(200, {'goals': r.data or []})
        except Exception as e:
            self._respond(500, {'error': str(e)})

    def do_POST(self):
        if not check_auth(self): return
        try:
            length  = int(self.headers.get('Content-Length', 0))
            payload = json.loads(self.rfile.read(length)) if length else {}
            sb = _sb()
            action = payload.get('action') or ('update' if payload.get('id') else 'add')

            if action == 'delete':
                gid = payload.get('id')
                if not gid:
                    self._respond(400, {'error': 'id requis'})
                    return
                sb.table('race_goals').delete().eq('id', gid).execute()
                self._respond(200, {'status': 'ok'})
                return

            date = payload.get('date')
            km   = payload.get('km')
            if not date or not isinstance(km, (int, float)) or km <= 0:
                self._respond(400, {'error': 'date et km (nombre positif) requis'})
                return

            row = {
                'name': (payload.get('name') or '').strip() or None,
                'date': date,
                'km': km,
                'target': (payload.get('target') or '').strip() or None,
                'updated_at': datetime.now().isoformat(),
            }

            if action == 'update' and payload.get('id'):
                sb.table('race_goals').update(row).eq('id', payload['id']).execute()
                row['id'] = payload['id']
            else:
                r = sb.table('race_goals').insert(row).execute()
                row['id'] = r.data[0]['id'] if r.data else None

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

from http.server import BaseHTTPRequestHandler
import json, os, sys
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))


def run_coach_update():
    from supabase import create_client
    import update_coach as uc

    sb = create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_KEY'])

    # Activités
    acts_r = sb.table('activities').select(
        'date,type,type_label,duration_min,distance_km,'
        'training_load,te_label,hr_zones_pct,'
        'pace_min_km,speed_kmh,aerobic_te,anaerobic_te,vo2max'
    ).order('date', desc=False).execute()
    activities = acts_r.data or []

    # Wellness 90 jours
    cutoff = (datetime.now() - timedelta(days=90)).strftime('%Y-%m-%d')
    well_r = sb.table('wellness_days').select('date,data').gte('date', cutoff).order('date').execute()
    wellness_by_date = {row['date']: (row['data'] or {}) for row in (well_r.data or [])}

    stats = uc.analyze(activities, wellness_by_date)
    items = uc.generate_coach(stats)

    coach = {
        'updated_at': datetime.now().strftime('%Y-%m-%dT%H:%M:%S'),
        'coach': 'Claude',
        'stats_snapshot': {
            'phase':              stats['phase'],
            'fatigue_level':      stats['fatigue_level'],
            'garmin_status':      stats['garmin_status'],
            'ctl':                stats['ctl'],
            'atl':                stats['atl'],
            'tsb':                stats['tsb'],
            'effort_idx':         stats['effort_idx'],
            'body_battery':       stats['avg_bb_end'],
            'training_readiness': stats['training_readiness'],
            'niveau':             stats['athlete_level'],
            'total_activites':    stats['total_acts'],
            'total_km':           stats['total_dist'],
        },
        'items': items,
    }

    # Sauvegarde dans Supabase (table coach_data, ligne unique id=1)
    sb.table('coach_data').upsert({'id': 1, 'data': coach}).execute()

    return f"Coach mis à jour — phase {stats['phase']}, {len(items)} cartes"


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            msg = run_coach_update()
            self._respond(200, {'status': 'ok', 'message': msg})
        except Exception as e:
            self._respond(500, {'error': str(e)})

    def _respond(self, code, data):
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        pass

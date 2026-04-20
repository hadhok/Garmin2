#!/usr/bin/env python3
"""
Serveur local pour Garmin Dashboard.
Lance avec : python3 server.py
Puis ouvre  : http://localhost:5000
"""
import os, json, subprocess
from flask import Flask, send_from_directory, jsonify, request

BASE = os.path.dirname(os.path.abspath(__file__))
app  = Flask(__name__, static_folder=BASE)

# ── Pages statiques ──────────────────────────────────────────────────────────
@app.route('/')
def index():
    return send_from_directory(BASE, 'index.html')

@app.route('/data/<path:filename>')
def data(filename):
    data_dir = os.path.join(BASE, 'data')
    os.makedirs(data_dir, exist_ok=True)
    return send_from_directory(data_dir, filename)

# ── API : déclencher une synchro Garmin ──────────────────────────────────────
TOKEN_DIR = os.path.join(BASE, '.garth_tokens')

@app.route('/api/sync', methods=['POST'])
def sync():
    if not os.path.exists(TOKEN_DIR):
        return jsonify({
            'status':  'error',
            'message': 'Tokens non trouvés. Lance d\'abord : python3 setup_garmin.py dans le terminal.'
        }), 400

    result = subprocess.run(
        ['python3', 'sync.py'],
        capture_output=True, text=True,
        cwd=BASE, timeout=120
    )

    if result.returncode == 0:
        # Recharger le JSON pour retourner le résumé
        data_file = os.path.join(BASE, 'data', 'activities.json')
        summary = {}
        if os.path.exists(data_file):
            with open(data_file) as f:
                d = json.load(f)
            summary = {'total': d.get('total', 0), 'last_sync': d.get('last_sync')}
        return jsonify({'status': 'ok', 'message': result.stdout.strip(), **summary})

    return jsonify({'status': 'error', 'message': result.stderr.strip() or result.stdout.strip()}), 500

# ── API : infos sur les données en cache ────────────────────────────────────
@app.route('/api/status')
def status():
    data_file = os.path.join(BASE, 'data', 'activities.json')
    if not os.path.exists(data_file):
        return jsonify({'synced': False})
    with open(data_file) as f:
        d = json.load(f)
    return jsonify({
        'synced':    True,
        'last_sync': d.get('last_sync'),
        'total':     d.get('total', 0),
    })

if __name__ == '__main__':
    print("Garmin Dashboard → http://localhost:5000")
    app.run(port=5000, debug=False)

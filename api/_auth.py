"""Protection opt-in des endpoints API.

Si la variable d'environnement APP_API_KEY est définie (Vercel),
tous les endpoints protégés exigent le header `X-App-Key`.
Si elle n'est pas définie, tout passe (comportement historique) —
aucune casse au déploiement tant que la clé n'est pas configurée.

Côté client : la clé se saisit dans Profil → Paramètres et est
injectée automatiquement sur tous les fetch /api/* (js/app.js).
"""
import hmac
import os


def check_auth(handler):
    """Retourne True si autorisé, sinon répond 401 et retourne False."""
    key = os.environ.get('APP_API_KEY', '')
    if not key:
        return True
    provided = handler.headers.get('X-App-Key', '')
    if provided and hmac.compare_digest(provided, key):
        return True
    handler.send_response(401)
    handler.send_header('Content-Type', 'application/json')
    handler.end_headers()
    handler.wfile.write(b'{"error": "unauthorized"}')
    return False

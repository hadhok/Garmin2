#!/usr/bin/env python3
"""
Authentification initiale Garmin Connect (à faire une seule fois).
Sauvegarde les tokens OAuth dans .garth_tokens/ pour les synchros suivantes.

Usage :
  python3 setup_garmin.py
"""
import os, getpass
from garminconnect import Garmin

TOKEN_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.garth_tokens')

def prompt_mfa():
    return input("Code MFA / 2FA (Entrée si pas de 2FA) : ").strip()

def main():
    print("=== Configuration Garmin Connect ===\n")
    email    = input("Email Garmin Connect : ").strip()
    password = getpass.getpass("Mot de passe : ")

    os.makedirs(TOKEN_DIR, exist_ok=True)

    print("\nConnexion en cours…")
    try:
        client = Garmin(email, password, prompt_mfa=prompt_mfa)
        # login(TOKEN_DIR) : connecte ET sauvegarde les tokens dans TOKEN_DIR
        client.login(TOKEN_DIR)
    except Exception as e:
        print(f"\nErreur de connexion : {e}")
        return

    print(f"\nTokens sauvegardés dans : {TOKEN_DIR}")
    print("Tu peux maintenant synchroniser avec : python3 sync.py")

if __name__ == '__main__':
    main()

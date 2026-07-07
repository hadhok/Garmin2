"""Helpers Supabase partagés.

Supabase (PostgREST) plafonne silencieusement les résultats à 1000 lignes
par requête tant qu'on ne pagine pas explicitement via .range() — sans
erreur, sans avertissement. Toute requête susceptible de dépasser ce
volume (activités, jours de bien-être, mesures corporelles…) doit passer
par fetch_all_rows() pour garantir l'historique complet.
"""

PAGE_SIZE = 1000


def fetch_all_rows(query_factory):
    """query_factory(start, end) doit renvoyer une requête Supabase déjà
    filtrée/triée, à laquelle on applique .range(start, end).execute().
    Pagine jusqu'à ce qu'une page renvoie moins de PAGE_SIZE lignes."""
    rows = []
    start = 0
    while True:
        result = query_factory(start, start + PAGE_SIZE - 1).execute()
        batch = result.data or []
        rows.extend(batch)
        if len(batch) < PAGE_SIZE:
            break
        start += PAGE_SIZE
    return rows

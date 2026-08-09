-- ============================================================
-- Garmin Dashboard – Schéma Supabase
-- À exécuter une fois dans l'éditeur SQL de Supabase
-- ============================================================

-- ── Activités ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS activities (
  id              BIGINT  PRIMARY KEY,
  name            TEXT,
  type            TEXT,
  type_label      TEXT,
  icon            TEXT,
  date            TEXT,          -- 'YYYY-MM-DD'
  start_time      TEXT,
  duration_min    FLOAT,
  distance_km     FLOAT,
  calories        INTEGER,
  hr_avg          INTEGER,
  hr_max          INTEGER,
  elevation_m     FLOAT,
  pace_min_km     TEXT,
  speed_kmh       FLOAT,
  training_load   FLOAT,
  aerobic_te      FLOAT,
  anaerobic_te    FLOAT,
  te_label        TEXT,
  intensity_min   INTEGER,
  vo2max          FLOAT,
  hr_zones_pct    JSONB          -- [z1%, z2%, z3%, z4%, z5%]
);

CREATE INDEX IF NOT EXISTS idx_activities_date ON activities(date DESC);
CREATE INDEX IF NOT EXISTS idx_activities_type ON activities(type);

-- ── Données bien-être (1 ligne / jour) ─────────────────────
CREATE TABLE IF NOT EXISTS wellness_days (
  date  TEXT  PRIMARY KEY,       -- 'YYYY-MM-DD'
  data  JSONB NOT NULL           -- objet complet du jour
);

-- ── Tokens Garmin (1 seule ligne, id=1) ───────────────────
CREATE TABLE IF NOT EXISTS garmin_tokens (
  id          INT  PRIMARY KEY DEFAULT 1,
  tokens      JSONB,           -- contenu de garmin_tokens.json
  updated_at  TEXT
);

-- ── Méta-données de synchronisation ────────────────────────
CREATE TABLE IF NOT EXISTS sync_meta (
  id                INT  PRIMARY KEY DEFAULT 1,
  last_sync         TEXT,
  total_activities  INT  DEFAULT 0
);

INSERT INTO sync_meta (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ── Mesures corporelles Renpho (1 ligne / jour) ────────────
CREATE TABLE IF NOT EXISTS body_metrics (
  date            TEXT  PRIMARY KEY,   -- 'YYYY-MM-DD'
  weight_kg       FLOAT,
  bmi             FLOAT,
  body_fat_pct    FLOAT,
  muscle_mass_pct FLOAT,
  bone_mass_kg    FLOAT,
  water_pct       FLOAT,
  bmr             FLOAT,               -- métabolisme basal (kcal)
  visceral_fat    FLOAT,
  protein_pct     FLOAT,
  body_age        FLOAT
);

CREATE INDEX IF NOT EXISTS idx_body_metrics_date ON body_metrics(date DESC);

-- ── Désactiver RLS (données privées, accès via service key) ─
ALTER TABLE activities    DISABLE ROW LEVEL SECURITY;
ALTER TABLE wellness_days DISABLE ROW LEVEL SECURITY;
ALTER TABLE garmin_tokens DISABLE ROW LEVEL SECURITY;
ALTER TABLE sync_meta     DISABLE ROW LEVEL SECURITY;
ALTER TABLE body_metrics  DISABLE ROW LEVEL SECURITY;

-- ── Configuration Runalyze (token + settings) ──────────────
CREATE TABLE IF NOT EXISTS runalyze_config (
  id               INT  PRIMARY KEY DEFAULT 1,
  token            TEXT,                -- API token personnel Runalyze
  enabled          BOOLEAN DEFAULT FALSE,
  last_sync        TEXT,                -- ISO timestamp du dernier sync
  sync_settings    JSONB,               -- { "use_vo2max": true, "use_ctl": true, ... }
  last_athlete     JSONB,               -- données athlete cachées
  last_error       TEXT,                -- dernier message d'erreur API
  updated_at       TEXT
);

ALTER TABLE runalyze_config DISABLE ROW LEVEL SECURITY;

-- ── Objectif de course (1 seule ligne, id=1) ────────────────
CREATE TABLE IF NOT EXISTS race_goal (
  id          INT  PRIMARY KEY DEFAULT 1,
  name        TEXT,
  date        TEXT,          -- 'YYYY-MM-DD'
  km          FLOAT,
  target      TEXT,          -- temps visé "h:mm:ss", optionnel
  updated_at  TEXT
);

ALTER TABLE race_goal DISABLE ROW LEVEL SECURITY;

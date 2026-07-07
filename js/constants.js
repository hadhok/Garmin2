/* CONSTANTS.JS — Centralized application constants */

// Jours en français
const DAYS_FR = ['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'];

// Type labels
const TYPE_LABEL = {
  'run':       'Course à pied',
  'bike':      'Vélo',
  'swim':      'Natation',
  'strength':  'Musculation',
  'hiit':      'HIIT',
  'cardio':    'Cardio',
  'rowing':    'Rameur',
  'jump_rope': 'Jump Rope',
  'hike':      'Randonnée',
  'walk':      'Marche',
  'other':     'Autre',
};

// Type colors
const TYPE_COLOR = {
  run:       '#22c55e',
  swim:      '#3b82f6',
  hiit:      '#f97316',
  rowing:    '#06b6d4',
  jump_rope: '#a855f7',
  strength:  '#ef4444',
  cardio:    '#f43f5e',
  hockey:    '#64748b',
  tennis:    '#84cc16',
  padel:     '#10b981',
  bike:      '#f59e0b',
  walk:      '#06b6d4',
  pilates:   '#e879f9',
  yoga:      '#7c3aed',
  hike:      '#84cc16',
  ski:       '#93c5fd',
  sup:       '#0ea5e9',
  other:     '#64748b',
};

// HR Zone colors
const HR_ZONES_COLORS = ['#22c55e', '#3b82f6', '#f59e0b', '#ef4444', '#991b1b'];

// MIN_DIST for running activities (km)
const MIN_DIST = 3;

// Page sizes
const ACT_PAGE_SIZE = 10;

// Cache TTL (ms)
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

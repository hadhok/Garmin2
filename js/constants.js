/* CONSTANTS.JS — Centralized application constants */

// Mois en français
const MONTHS_FR = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];

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
  'run':       '#ef4444',
  'bike':      '#f59e0b',
  'swim':      '#3b82f6',
  'strength':  '#8b5cf6',
  'hiit':      '#ec4899',
  'cardio':    '#f97316',
  'rowing':    '#06b6d4',
  'jump_rope': '#14b8a6',
  'hike':      '#84cc16',
  'walk':      '#6b7280',
  'other':     '#9ca3af',
};

// HR Zone colors
const HR_ZONES_COLORS = ['#22c55e', '#3b82f6', '#f59e0b', '#ef4444', '#991b1b'];

// HR Zone boundaries (percentage of FCmax)
const HR_ZONES = [
  { name: 'Z1', min:   0, max:  50, color: '#22c55e' },
  { name: 'Z2', min:  50, max:  70, color: '#3b82f6' },
  { name: 'Z3', min:  70, max:  85, color: '#f59e0b' },
  { name: 'Z4', min:  85, max:  95, color: '#ef4444' },
  { name: 'Z5', min:  95, max: 100, color: '#991b1b' },
];

// MIN_DIST for running activities (km)
const MIN_DIST = 3;

// Page sizes
const ACT_PAGE_SIZE = 10;

// Cache TTL (ms)
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

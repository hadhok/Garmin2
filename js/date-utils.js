/* DATE-UTILS.JS — Centralized date manipulation functions */

/**
 * Convert Date to ISO string YYYY-MM-DD without timezone issues
 */
function dateToISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Get start of day for given date
 */
function startOfDay(d) {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

/**
 * Get start of week (Monday) for given date
 */
function startOfWeek(d) {
  const copy = new Date(d);
  const day = copy.getDay();
  const diff = copy.getDate() - day + (day === 0 ? -6 : 1);
  copy.setDate(diff);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

/**
 * Get start of month for given date
 */
function startOfMonth(d) {
  const copy = new Date(d);
  copy.setDate(1);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

/**
 * Format date as "12 juin" (fr-FR long month)
 */
function formatDateFr(d) {
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
}

/**
 * Format date as "12 juin 2026" (full)
 */
function formatDateFullFr(d) {
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * Format date as "jeu. 12 juin" (short with day name)
 */
function formatDateShortFr(d) {
  return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
}

/**
 * Add days to a date
 */
function addDays(d, n) {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}

/**
 * Get difference in days between two dates
 */
function daysDiff(d1, d2) {
  const ms = Math.abs(d1 - d2);
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

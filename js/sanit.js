/* SANIT.JS — Security utilities: HTML escaping, validation */

/**
 * Escape HTML special characters to prevent XSS
 */
function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

/**
 * Validate color hex (#RRGGBB or #RGB)
 */
function isValidColor(color) {
  return /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(color);
}

/**
 * Validate that a string is a valid activity type
 */
function isValidActivityType(type) {
  const valid = ['run', 'bike', 'swim', 'strength', 'hiit', 'cardio', 'rowing', 'jump_rope', 'hike', 'walk', 'other'];
  return valid.includes(type);
}

/**
 * Validate coach item type
 */
function isValidCoachType(type) {
  return /^(tip|warning|goal)$/.test(type);
}

/**
 * Remove HTML tags from string
 */
function stripHTML(str) {
  const div = document.createElement('div');
  div.innerHTML = str || '';
  return div.textContent || div.innerText || '';
}

/**
 * Truncate string to max length with ellipsis
 */
function truncate(str, max = 100) {
  if (!str || str.length <= max) return str;
  return str.substring(0, max - 3) + '...';
}

/**
 * Safe parseInt with fallback
 */
function safeInt(val, fallback = 0) {
  const n = parseInt(val);
  return isNaN(n) ? fallback : n;
}

/**
 * Safe parseFloat with fallback
 */
function safeFloat(val, fallback = 0) {
  const n = parseFloat(val);
  return isNaN(n) ? fallback : n;
}

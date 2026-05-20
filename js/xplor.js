/* ══════════════════════════════════════════════════════════
   XPLOR ACTIVE — intégration séances planifiées
   ══════════════════════════════════════════════════════════ */

let _xplorSessions = [];       // cache séances planifiées
let _xplorLoaded   = false;

/* ── Chargement des séances depuis Supabase (via API) ─────────────────────── */
async function loadXplorSessions() {
  try {
    const r = await fetch('/api/xplor');
    if (!r.ok) return;
    const data = await r.json();
    _xplorSessions = data.sessions || [];
    _xplorLoaded   = true;
  } catch (e) {
    console.warn('[xplor] load', e);
  }
}

function getXplorSessions() { return _xplorSessions; }

/* ── Séances du jour / de la semaine ──────────────────────────────────────── */
function getXplorByDate(dateIso) {
  return _xplorSessions.filter(s => s.date === dateIso);
}

function getXplorByWeek(mondayIso, sundayIso) {
  return _xplorSessions.filter(s => s.date >= mondayIso && s.date <= sundayIso);
}

/* ── Sync manuelle depuis l'UI ────────────────────────────────────────────── */
async function syncXplor(btnEl) {
  const orig = btnEl ? btnEl.innerHTML : '';
  if (btnEl) { btnEl.disabled = true; btnEl.innerHTML = '⏳ Sync…'; }

  try {
    const r = await fetch('/api/xplor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'sync' }),
    });
    const data = await r.json();

    if (data.error) {
      showXplorError(data.error);
    } else {
      await loadXplorSessions();
      if (typeof markAllDirty === 'function') markAllDirty();
      if (typeof renderAll === 'function') renderAll();
      showXplorToast(`✓ ${data.synced} séance${data.synced !== 1 ? 's' : ''} synchronisée${data.synced !== 1 ? 's' : ''}`);
    }
  } catch (e) {
    showXplorError(String(e));
  } finally {
    if (btnEl) { btnEl.disabled = false; btnEl.innerHTML = orig; }
  }
}

function showXplorToast(msg) {
  const t = document.createElement('div');
  t.className = 'xplor-toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

function showXplorError(msg) {
  // Show in the week plan area if visible, else alert
  const el = document.getElementById('xplor-error-banner');
  if (el) {
    el.textContent = msg;
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 8000);
  } else {
    console.error('[xplor]', msg);
  }
}

/* ── Badge charge estimée ─────────────────────────────────────────────────── */
function xplorLoadBadge(session) {
  if (!session.estimated_load) return '';
  const conf = session.load_confidence;
  const color = conf === 'high' ? '#22c55e' : conf === 'medium' ? '#f97316' : '#94a3b8';
  const tilde = conf !== 'high' ? '~' : '';
  return `<span style="font-size:9px;color:${color};font-weight:700">${tilde}${Math.round(session.estimated_load)} pts</span>`;
}

/* ── Carte jour Xplor (dans la grille 7 jours) ────────────────────────────── */
function xplorDayCard(session) {
  const timeStr = session.start_time
    ? new Date(session.start_time).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    : '';
  const isDone = session.status === 'completed';
  return `
    <div class="xplor-session-pill ${isDone ? 'done' : ''}" title="${session.name}">
      <span class="xpl-icon">${session.icon}</span>
      <span class="xpl-name">${session.name}</span>
      ${timeStr ? `<span class="xpl-time">${timeStr}</span>` : ''}
      ${xplorLoadBadge(session)}
      ${isDone ? '<span class="xpl-done">✓</span>' : ''}
    </div>`;
}

/* ── Section Xplor dans le plan de semaine ────────────────────────────────── */
function renderXplorWeekSection(container, mondayDate) {
  const toIso = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const monday = mondayDate || (() => {
    const t = new Date(); const dow = (t.getDay() + 6) % 7;
    const m = new Date(t); m.setDate(t.getDate() - dow); m.setHours(0,0,0,0); return m;
  })();
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);

  const sessions = getXplorByWeek(toIso(monday), toIso(sunday));
  if (!sessions.length) return;

  const byDate = {};
  sessions.forEach(s => { (byDate[s.date] = byDate[s.date] || []).push(s); });

  const totalLoad = sessions.reduce((s, x) => s + (x.estimated_load || 0), 0);
  const totalMin  = sessions.reduce((s, x) => s + (x.duration_min || 0), 0);

  const el = document.createElement('div');
  el.className = 'xplor-week-section';
  el.innerHTML = `
    <div class="xplor-week-header">
      <span class="xplor-logo">𝕏 Xplor Active</span>
      <span class="xplor-week-kpis">
        ${sessions.length} séance${sessions.length > 1 ? 's' : ''}
        · ${Math.round(totalMin / 60)}h${String(totalMin % 60).padStart(2,'0')}
        · ~${Math.round(totalLoad)} pts estimés
      </span>
    </div>
    <div class="xplor-sessions-list">
      ${Object.entries(byDate).sort(([a],[b]) => a.localeCompare(b)).map(([date, sess]) => `
        <div class="xplor-day-row">
          <div class="xplor-day-label">${new Date(date + 'T12:00').toLocaleDateString('fr-FR', { weekday:'short', day:'numeric' })}</div>
          <div class="xplor-day-sessions">${sess.map(xplorDayCard).join('')}</div>
        </div>`).join('')}
    </div>`;

  if (container) container.appendChild(el);
}

/* ── Init : chargement au démarrage ───────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  loadXplorSessions().then(() => {
    if (_xplorSessions.length && typeof markAllDirty === 'function') {
      markAllDirty();
      if (typeof renderAll === 'function') renderAll();
    }
  });
});

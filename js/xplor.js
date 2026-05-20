/* ══════════════════════════════════════════════════════════
   XPLOR ACTIVE — import iCal
   ══════════════════════════════════════════════════════════ */

let _xplorSessions    = [];
let _xplorLoaded      = false;
let _xplorIcalConfigured = false;

async function loadXplorSessions() {
  try {
    const r = await fetch('/api/xplor');
    if (!r.ok) return;
    const data = await r.json();
    _xplorSessions       = data.sessions || [];
    _xplorIcalConfigured = data.ical_configured || false;
    _xplorLoaded         = true;
  } catch (e) {
    console.warn('[xplor] load', e);
  }
}

function getXplorSessions()       { return _xplorSessions; }
function isXplorConfigured()      { return _xplorIcalConfigured; }

function getXplorByDate(dateIso) {
  return _xplorSessions.filter(s => s.date === dateIso);
}

/* ── Sauvegarde de l'URL iCal ─────────────────────────────────────────────── */
async function saveXplorIcalUrl(url) {
  const r = await fetch('/api/xplor', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'save_url', url }),
  });
  const data = await r.json();
  if (data.ok) {
    _xplorIcalConfigured = true;
    return true;
  }
  throw new Error(data.error || 'Erreur lors de la sauvegarde');
}

/* ── Sync manuelle ────────────────────────────────────────────────────────── */
async function syncXplor(btnEl) {
  if (!_xplorIcalConfigured) {
    // Show the URL setup dialog instead
    showXplorSetup();
    return;
  }
  const orig = btnEl ? btnEl.innerHTML : '';
  if (btnEl) { btnEl.disabled = true; btnEl.innerHTML = '⏳'; }

  try {
    const r = await fetch('/api/xplor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'sync_ical' }),
    });
    const data = await r.json();
    if (data.error) {
      _showXplorBanner(data.error, 'error');
    } else {
      await loadXplorSessions();
      if (typeof markAllDirty === 'function') markAllDirty();
      if (typeof renderAll   === 'function') renderAll();
      const msg = data.synced > 0
        ? `✓ ${data.synced} séance${data.synced > 1 ? 's' : ''} importée${data.synced > 1 ? 's' : ''}`
        : (data.message || '✓ Aucune nouvelle séance');
      _showXplorBanner(msg, 'ok');
    }
  } catch (e) {
    _showXplorBanner(String(e), 'error');
  } finally {
    if (btnEl) { btnEl.disabled = false; btnEl.innerHTML = orig; }
  }
}

/* ── Dialog de configuration URL iCal ────────────────────────────────────── */
function showXplorSetup() {
  const existing = document.getElementById('xplor-setup-overlay');
  if (existing) { existing.remove(); return; }

  const overlay = document.createElement('div');
  overlay.id = 'xplor-setup-overlay';
  overlay.style.cssText = `
    position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1000;
    display:flex;align-items:center;justify-content:center;padding:16px`;

  overlay.innerHTML = `
    <div style="background:var(--surface);border-radius:16px;padding:24px;max-width:480px;width:100%;box-shadow:0 24px 48px rgba(0,0,0,.2)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
        <div style="font-size:16px;font-weight:700">𝕏 Connecter Xplor Active</div>
        <button onclick="document.getElementById('xplor-setup-overlay').remove()" style="background:none;border:none;cursor:pointer;font-size:18px;color:var(--muted)">✕</button>
      </div>

      <div style="font-size:13px;color:var(--muted);margin-bottom:16px;line-height:1.6">
        Colle ici l'URL iCal de ton calendrier Xplor Active pour importer automatiquement tes séances planifiées.
      </div>

      <details style="margin-bottom:16px;font-size:12px;color:var(--muted)">
        <summary style="cursor:pointer;font-weight:600;color:var(--text2)">Comment obtenir l'URL iCal ?</summary>
        <div style="margin-top:10px;line-height:1.8;padding:10px;background:var(--surface2);border-radius:8px">
          <b>Google Calendar :</b><br>
          1. Réserve une séance dans Xplor Active → "Ajouter au calendrier" → Google Calendar<br>
          2. Sur calendar.google.com → ⋮ à côté du calendrier Xplor → Paramètres<br>
          3. Descends jusqu'à <i>"Adresse secrète au format iCal"</i> → copie l'URL<br><br>
          <b>Apple Calendar / iCloud :</b><br>
          1. Xplor Active → "Ajouter au calendrier" → Apple Calendar<br>
          2. Sur icloud.com/calendar → partage le calendrier → active le lien public → copie l'URL .ics<br><br>
          <b>URL directe Xplor (si disponible) :</b><br>
          Certaines versions de l'app proposent un lien "Abonnement calendrier" dans les réglages du profil.
        </div>
      </details>

      <input id="xplor-ical-input" type="url" placeholder="https://calendar.google.com/calendar/ical/..."
        style="width:100%;padding:10px 12px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface);
               color:var(--text);font-size:13px;box-sizing:border-box;margin-bottom:12px"
        oninput="document.getElementById('xplor-save-btn').disabled=!this.value.trim()" />

      <div style="display:flex;gap:8px">
        <button onclick="document.getElementById('xplor-setup-overlay').remove()"
          style="flex:1;padding:10px;border:1px solid var(--border);border-radius:8px;background:none;color:var(--muted);cursor:pointer;font-size:13px">
          Annuler
        </button>
        <button id="xplor-save-btn" disabled onclick="_saveAndSyncIcal(this)"
          style="flex:2;padding:10px;border:none;border-radius:8px;background:#6366f1;color:#fff;
                 font-weight:600;cursor:pointer;font-size:13px;opacity:0.5">
          Enregistrer et synchroniser
        </button>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  const input = document.getElementById('xplor-ical-input');
  const btn   = document.getElementById('xplor-save-btn');
  if (input) {
    input.addEventListener('input', () => {
      btn.style.opacity = input.value.trim() ? '1' : '0.5';
    });
  }
}

async function _saveAndSyncIcal(btnEl) {
  const url = document.getElementById('xplor-ical-input')?.value?.trim();
  if (!url) return;
  btnEl.disabled = true;
  btnEl.textContent = '⏳ Enregistrement…';
  try {
    await saveXplorIcalUrl(url);
    document.getElementById('xplor-setup-overlay')?.remove();
    await syncXplor(null);
  } catch (e) {
    btnEl.disabled = false;
    btnEl.textContent = 'Enregistrer et synchroniser';
    _showXplorBanner(String(e), 'error');
  }
}

/* ── Banner d'état inline ─────────────────────────────────────────────────── */
function _showXplorBanner(msg, type) {
  const el = document.getElementById('xplor-error-banner');
  if (!el) return;
  el.textContent = msg;
  el.style.background = type === 'ok' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)';
  el.style.borderColor = type === 'ok' ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)';
  el.style.color       = type === 'ok' ? '#22c55e' : '#ef4444';
  el.style.display     = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 5000);
}

/* ── Badge charge estimée ─────────────────────────────────────────────────── */
function xplorLoadBadge(session) {
  if (!session.estimated_load) return '';
  const c = session.load_confidence;
  const color = c === 'high' ? '#22c55e' : c === 'medium' ? '#f97316' : '#94a3b8';
  return `<span style="font-size:8px;color:${color};font-weight:700">${c!=='high'?'~':''}${Math.round(session.estimated_load)}pts</span>`;
}

/* ── Pills dans les cartes jour ──────────────────────────────────────────── */
function xplorDayPills(dateIso) {
  const sess = getXplorByDate(dateIso);
  if (!sess.length) return '';
  return sess.map(s => {
    const t = s.start_time
      ? new Date(s.start_time).toLocaleTimeString('fr-FR', {hour:'2-digit',minute:'2-digit'})
      : '';
    const conf  = s.load_confidence;
    const confColor = conf === 'high' ? '#22c55e' : conf === 'medium' ? '#f97316' : '#94a3b8';
    const isDone = s.status === 'completed';
    return `<div style="margin-top:4px;padding:3px 5px;border-radius:6px;
      background:rgba(99,102,241,${isDone?'0.06':'0.12'});
      border:1px solid rgba(99,102,241,${isDone?'0.15':'0.25'})">
      <div style="font-size:9px;font-weight:700;color:#6366f1;
        white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
        ${s.icon} ${s.name}${isDone?' ✓':''}
      </div>
      ${t ? `<div style="font-size:8px;color:var(--muted)">${t}${s.estimated_load?` · <span style="color:${confColor}">~${Math.round(s.estimated_load)}pts</span>`:''}</div>` : ''}
    </div>`;
  }).join('');
}

/* ── Init ─────────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  loadXplorSessions().then(() => {
    if (_xplorSessions.length) {
      if (typeof markAllDirty === 'function') markAllDirty();
      if (typeof renderAll   === 'function') renderAll();
    }
  });
});

/* ══════════════════════════════════════════════════════════
   XPLOR ACTIVE — import iCal
   ══════════════════════════════════════════════════════════ */

let _xplorSessions       = [];
let _xplorLoaded         = false;
let _xplorIcalConfigured = false;
let _xplorLocationFilter = '';

async function loadXplorSessions() {
  try {
    const r = await fetch('/api/xplor');
    if (!r.ok) return;
    const data = await r.json();
    _xplorSessions       = data.sessions || [];
    _xplorIcalConfigured = data.ical_configured || false;
    _xplorLocationFilter = data.location_filter || '';
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
    display:flex;align-items:flex-start;justify-content:center;padding:16px;overflow-y:auto`;

  overlay.innerHTML = `
    <div style="background:var(--surface);border-radius:16px;padding:24px;max-width:500px;width:100%;
                box-shadow:0 24px 48px rgba(0,0,0,.2);margin:auto">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
        <div style="font-size:16px;font-weight:700">𝕏 Xplor Active — Réglages</div>
        <button onclick="document.getElementById('xplor-setup-overlay').remove()"
          style="background:none;border:none;cursor:pointer;font-size:18px;color:var(--muted)">✕</button>
      </div>

      <label style="display:block;font-size:12px;font-weight:600;color:var(--text2);margin-bottom:5px">URL iCal</label>
      <input id="xplor-ical-input" type="url" placeholder="https://calendar.google.com/calendar/ical/..."
        style="width:100%;padding:10px 12px;border:1.5px solid var(--border);border-radius:8px;
               background:var(--surface);color:var(--text);font-size:13px;box-sizing:border-box;margin-bottom:6px" />
      <details style="margin-bottom:14px;font-size:11px;color:var(--muted)">
        <summary style="cursor:pointer">Comment obtenir cette URL ?</summary>
        <div style="margin-top:8px;line-height:1.7;padding:8px;background:var(--surface2);border-radius:8px">
          <b>Google Calendar :</b><br>
          1. Réserve une séance → "Ajouter au calendrier" → Google Calendar<br>
          2. calendar.google.com → ⋮ à côté du calendrier → Paramètres<br>
          3. Section <i>"Intégrer l'agenda"</i> → <i>"Adresse secrète au format iCal"</i> → copie
        </div>
      </details>

      <label style="display:block;font-size:12px;font-weight:600;color:var(--text2);margin-bottom:5px">
        Filtre lieu <span style="font-weight:400;color:var(--muted)">(mot-clé dans le champ lieu de l'événement)</span>
      </label>
      <input id="xplor-location-input" type="text"
        placeholder="ex: Girondins, Mérignac…"
        value="${_xplorLocationFilter}"
        style="width:100%;padding:10px 12px;border:1.5px solid var(--border);border-radius:8px;
               background:var(--surface);color:var(--text);font-size:13px;box-sizing:border-box;margin-bottom:14px" />

      <!-- Zone debug -->
      <div id="xplor-debug-zone" style="display:none;margin-bottom:14px;padding:10px;background:var(--surface2);
           border-radius:8px;font-size:11px;font-family:monospace;max-height:200px;overflow-y:auto;
           color:var(--text2);white-space:pre-wrap;word-break:break-all"></div>

      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button onclick="_debugIcal(this)"
          style="padding:8px 12px;border:1px solid var(--border);border-radius:8px;
                 background:none;color:var(--muted);cursor:pointer;font-size:12px">
          🔍 Tester
        </button>
        <button onclick="_syncFromDialog(this)"
          style="padding:8px 12px;border:1px solid var(--border);border-radius:8px;
                 background:none;color:var(--muted);cursor:pointer;font-size:12px">
          ↺ Sync
        </button>
        <button onclick="document.getElementById('xplor-setup-overlay').remove()"
          style="padding:8px 12px;border:1px solid var(--border);border-radius:8px;
                 background:none;color:var(--muted);cursor:pointer;font-size:12px">
          Fermer
        </button>
        <button id="xplor-save-btn"
          style="flex:1;padding:8px 14px;border:none;border-radius:8px;background:#6366f1;
                 color:#fff;font-weight:600;cursor:pointer;font-size:13px"
          onclick="_saveAndSyncIcal(this)">
          Enregistrer
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
  const loc = document.getElementById('xplor-location-input')?.value?.trim() || '';
  if (!url) return;
  btnEl.disabled = true;
  btnEl.textContent = '⏳ Enregistrement…';
  try {
    await saveXplorIcalUrl(url);
    // Save location filter
    await fetch('/api/xplor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'save_filter', location: loc }),
    });
    _xplorLocationFilter = loc;
    document.getElementById('xplor-setup-overlay')?.remove();
    await syncXplor(null);
  } catch (e) {
    btnEl.disabled = false;
    btnEl.textContent = 'Enregistrer et synchroniser';
    _showXplorBanner(String(e), 'error');
  }
}

async function _syncFromDialog(btnEl) {
  const orig = btnEl.innerHTML;
  btnEl.disabled = true; btnEl.innerHTML = '⏳';
  try {
    const r = await fetch('/api/xplor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'sync_ical' }),
    });
    const data = await r.json();
    const zone = document.getElementById('xplor-debug-zone');
    if (zone) {
      zone.style.display = 'block';
      zone.textContent = data.error
        ? '❌ ' + data.error
        : `✓ ${data.synced ?? 0} séance(s) importée(s)${data.message ? ' — ' + data.message : ''}`;
    }
    if (!data.error) {
      await loadXplorSessions();
      if (typeof markAllDirty === 'function') markAllDirty();
      if (typeof renderAll   === 'function') renderAll();
    }
  } catch (e) {
    const zone = document.getElementById('xplor-debug-zone');
    if (zone) { zone.style.display = 'block'; zone.textContent = '❌ ' + e; }
  } finally {
    btnEl.disabled = false; btnEl.innerHTML = orig;
  }
}

/* ── Debug : affiche les événements bruts du flux iCal ───────────────────── */
async function _debugIcal(btnEl) {
  const zone = document.getElementById('xplor-debug-zone');
  if (!zone) return;
  zone.style.display = 'block';
  zone.textContent = '⏳ Chargement…';
  btnEl.disabled = true;

  try {
    const r = await fetch('/api/xplor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'debug_ical' }),
    });
    const data = await r.json();
    if (data.error) {
      zone.textContent = '❌ ' + data.error;
    } else {
      const lines = [`${data.total_future} événements à venir\n`];
      (data.sample || []).forEach((e, i) => {
        lines.push(`── ${i+1}. ${e.dtstart.slice(0,10)} ──`);
        lines.push(`   Nom      : ${e.summary}`);
        lines.push(`   Lieu     : ${e.location || '(vide)'}`);
        lines.push(`   Desc     : ${e.description || '(vide)'}`);
        lines.push(`   Durée    : ${e.duration} min`);
        lines.push(`   Type det.: ${e.classified}`);
        lines.push('');
      });
      zone.textContent = lines.join('\n');
    }
  } catch (e) {
    zone.textContent = '❌ ' + e;
  } finally {
    btnEl.disabled = false;
  }
}

/* ── Banner d'état inline ─────────────────────────────────────────────────── */
function _showXplorBanner(msg, type) {
  const activeView = document.querySelector('.view.active');
  const el = (activeView && activeView.querySelector('.xplor-status-banner'))
    || document.querySelector('.xplor-status-banner');
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

/* loadXplorSessions() is called inside init() in app.js — no separate init needed */

/* ══════════════════════════════════════════════════════════
   XPLOR ACTIVE — API Deciplus directe
   ══════════════════════════════════════════════════════════ */

let _xplorSessions    = [];
let _xplorLoaded      = false;
let _xplorApiConfigured = false;

async function loadXplorSessions() {
  try {
    const r = await fetch('/api/xplor');
    if (!r.ok) return;
    const data = await r.json();
    _xplorSessions     = data.sessions || [];
    _xplorApiConfigured = data.api_configured || false;
    _xplorLoaded       = true;
  } catch (e) {
    console.warn('[xplor] load', e);
  }
}

function getXplorSessions()  { return _xplorSessions; }
function isXplorConfigured() { return _xplorApiConfigured; }

function getXplorByDate(dateIso) {
  return _xplorSessions.filter(s => s.date === dateIso);
}

/* ── Sync manuelle ────────────────────────────────────────────────────────── */
async function syncXplor(btnEl) {
  const orig = btnEl ? btnEl.innerHTML : '';
  if (btnEl) { btnEl.disabled = true; btnEl.innerHTML = '⏳'; }

  try {
    const r = await fetch('/api/xplor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'sync' }),
    });
    const data = await r.json();
    if (data.error) {
      _showXplorBanner(data.error, 'error');
    } else {
      await loadXplorSessions();
      if (typeof markAllDirty === 'function') markAllDirty();
      if (typeof renderAll   === 'function') renderAll();
      const msg = data.synced > 0
        ? `✓ ${data.synced} séance${data.synced > 1 ? 's' : ''} importée${data.synced > 1 ? 's' : ''}${data.slug ? ` (${data.slug})` : ''}`
        : (data.message || '✓ Aucune nouvelle séance');
      _showXplorBanner(msg, 'ok');
    }
  } catch (e) {
    _showXplorBanner(String(e), 'error');
  } finally {
    if (btnEl) { btnEl.disabled = false; btnEl.innerHTML = orig; }
  }
}

/* ── Dialog de debug API ──────────────────────────────────────────────────── */
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

      <div style="font-size:12px;color:var(--muted);margin-bottom:14px;padding:10px;
                  background:var(--surface2);border-radius:8px;line-height:1.6">
        L'authentification utilise les variables d'environnement<br>
        <code style="color:#6366f1">DECIPLUS_EMAIL</code> et <code style="color:#6366f1">DECIPLUS_PASSWORD</code>
        configurées sur le serveur.<br>
        Statut : ${_xplorApiConfigured
          ? '<span style="color:#22c55e">✓ Identifiants configurés</span>'
          : '<span style="color:#ef4444">✗ Variables non configurées</span>'}
      </div>

      <div id="xplor-debug-zone" style="display:none;margin-bottom:14px;padding:10px;background:var(--surface2);
           border-radius:8px;font-size:11px;font-family:monospace;max-height:200px;overflow-y:auto;
           color:var(--text2);white-space:pre-wrap;word-break:break-all"></div>

      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button onclick="_debugDeciplus(this)"
          style="padding:8px 12px;border:1px solid var(--border);border-radius:8px;
                 background:none;color:var(--muted);cursor:pointer;font-size:12px">
          🔍 Tester la connexion
        </button>
        <button onclick="_syncFromDialog(this)"
          style="padding:8px 12px;border:1px solid var(--border);border-radius:8px;
                 background:none;color:var(--muted);cursor:pointer;font-size:12px">
          ↺ Sync
        </button>
        <button onclick="document.getElementById('xplor-setup-overlay').remove()"
          style="flex:1;padding:8px 14px;border:none;border-radius:8px;background:#6366f1;
                 color:#fff;font-weight:600;cursor:pointer;font-size:13px">
          Fermer
        </button>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

async function _syncFromDialog(btnEl) {
  const orig = btnEl.innerHTML;
  btnEl.disabled = true; btnEl.innerHTML = '⏳';
  try {
    const r = await fetch('/api/xplor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'sync' }),
    });
    const data = await r.json();
    const zone = document.getElementById('xplor-debug-zone');
    if (zone) {
      zone.style.display = 'block';
      zone.textContent = data.error
        ? '❌ ' + data.error
        : `✓ ${data.synced ?? 0} séance(s) importée(s)${data.slug ? ` — club: ${data.slug}` : ''}${data.message ? '\n' + data.message : ''}`;
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

/* ── Debug : teste la connexion API et affiche les réservations brutes ──── */
async function _debugDeciplus(btnEl) {
  const zone = document.getElementById('xplor-debug-zone');
  if (!zone) return;
  zone.style.display = 'block';
  zone.textContent = '⏳ Connexion à l\'API Deciplus…';
  btnEl.disabled = true;

  try {
    const r = await fetch('/api/xplor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'debug' }),
    });
    const data = await r.json();
    if (data.error) {
      zone.textContent = '❌ ' + data.error;
    } else {
      const lines = [`✓ Connecté — club: ${data.slug}\n${data.raw_count} réservation(s) à venir\n`];
      (data.sample || []).forEach((item, i) => {
        const b = item.booking || item;
        lines.push(`── ${i+1}. ${b.startDate?.slice(0,10) || '?'} ──`);
        lines.push(`   Activité : ${b.activity?.name || b.name || '?'}`);
        lines.push(`   Durée    : ${b.endDate && b.startDate
          ? Math.round((new Date(b.endDate)-new Date(b.startDate))/60000) + ' min'
          : '?'}`);
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

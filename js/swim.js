/* ══════════════════════════════════════════════════════════
   SWIM.JS — Page dédiée Natation
   ══════════════════════════════════════════════════════════ */

const swimState = { period: 'all' };

function getSwims() {
  return getAll().filter(a => a.type === 'swim');
}

function getSwimsByPeriod() {
  const all = getSwims();
  const now = new Date(TODAY_ISO + 'T12:00:00');
  let cutoff;
  if (swimState.period === 'week') {
    cutoff = new Date(now); cutoff.setDate(now.getDate() - 7);
  } else if (swimState.period === 'month') {
    cutoff = new Date(now.getFullYear(), now.getMonth(), 1);
  } else if (swimState.period === 'year') {
    cutoff = new Date(now.getFullYear(), 0, 1);
  } else {
    return all;
  }
  return all.filter(a => new Date((a.date || '1970-01-01') + 'T12:00:00') >= cutoff);
}

function setSwimPeriod(p, btn) {
  swimState.period = p;
  document.querySelectorAll('.swim-period-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderSwimPage();
}

function _swimPaceToSec(p) {
  if (!p) return null;
  const [m, s] = String(p).split(':').map(Number);
  return m * 60 + (s || 0);
}

function _swimSecToPace(s) {
  if (!s || s <= 0) return '–';
  const m = Math.floor(s / 60), sec = Math.round(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

/* ══════════════════════════════════════════════════════════
   RENDER DISPATCHER
   ══════════════════════════════════════════════════════════ */
function renderSwimPage() {
  const swims = getSwimsByPeriod().sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  _renderSwimKpis(swims);
  _renderSwimPRs(swims);
  _renderSwimCharts(swims);
  _renderSwimZones(swims);
  _renderSwimDrift(swims);
  populateSwimCompareSelectors();
  _renderSwimTable(swims);
}

/* ══════════════════════════════════════════════════════════
   KPI STRIP
   ══════════════════════════════════════════════════════════ */
function _renderSwimKpis(swims) {
  const el = document.getElementById('swim-kpi-strip');
  if (!el) return;

  const totalDist = swims.reduce((s, a) => s + (a.distance_km || 0), 0);
  const totalDur  = swims.reduce((s, a) => s + (a.duration_min || 0), 0);
  const withPace  = swims.filter(a => a.pace_per_100m);
  const avgPaceSec = withPace.length
    ? withPace.reduce((s, a) => s + _swimPaceToSec(a.pace_per_100m), 0) / withPace.length
    : null;
  const withSwolf = swims.filter(a => a.swolf > 0);
  const avgSwolf  = withSwolf.length ? withSwolf.reduce((s, a) => s + a.swolf, 0) / withSwolf.length : null;

  const dur = totalDur >= 60
    ? `${Math.floor(totalDur / 60)}h${String(Math.round(totalDur % 60)).padStart(2, '0')}`
    : `${Math.round(totalDur)}min`;

  el.innerHTML = [
    { label: 'Séances',      val: swims.length,                            unit: '' },
    { label: 'Distance tot.', val: totalDist.toFixed(1),                    unit: 'km' },
    { label: 'Temps actif',  val: dur,                                     unit: '' },
    { label: 'Allure moy.',  val: avgPaceSec ? _swimSecToPace(avgPaceSec) : '–', unit: '/100m' },
    { label: 'SWOLF moy.',   val: avgSwolf ? Math.round(avgSwolf) : '–',    unit: '' },
  ].map(k => `
    <div class="kpi-card" style="padding:12px 16px">
      <div class="kpi-label">${k.label}</div>
      <div class="kpi-value" style="font-size:20px">${k.val}<span class="kpi-unit">${k.unit}</span></div>
    </div>`).join('');
}

/* ══════════════════════════════════════════════════════════
   RECORDS PERSONNELS
   ══════════════════════════════════════════════════════════ */
function _renderSwimPRs(swims) {
  const el = document.getElementById('swim-prs');
  if (!el) return;
  if (!swims.length) { el.innerHTML = '<div style="padding:16px;color:var(--muted);font-size:13px">Aucune séance de natation.</div>'; return; }

  const withPace  = swims.filter(a => a.pace_per_100m);
  const bestPace  = withPace.length ? withPace.reduce((a, b) => _swimPaceToSec(a.pace_per_100m) < _swimPaceToSec(b.pace_per_100m) ? a : b) : null;
  const withSwolf = swims.filter(a => a.swolf > 0);
  const bestSwolf = withSwolf.length ? withSwolf.reduce((a, b) => a.swolf < b.swolf ? a : b) : null;
  const longestDist = swims.reduce((a, b) => (b.distance_km || 0) > (a.distance_km || 0) ? b : a);
  const longestDur  = swims.reduce((a, b) => (b.duration_min || 0) > (a.duration_min || 0) ? b : a);

  const fmt = (d) => d ? new Date(d + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: '2-digit' }) : '–';
  const cards = [
    ['🏆', 'Meilleure allure', bestPace ? `${bestPace.pace_per_100m}/100m` : '–', bestPace],
    ['🏆', 'Meilleur SWOLF',   bestSwolf ? bestSwolf.swolf : '–', bestSwolf],
    ['📏', 'Plus longue distance', longestDist.distance_km ? `${longestDist.distance_km.toFixed(2)} km` : '–', longestDist],
    ['⏱️', 'Plus longue séance',   longestDur.duration_min ? fmt_dur(longestDur.duration_min) : '–', longestDur],
  ].filter(([, , , act]) => act);

  el.innerHTML = `<div class="pr-grid">${cards.map(([icon, label, val, act]) => `
    <div class="pr-card" style="cursor:pointer" onclick="openDetail(${act.id})">
      <div class="pr-badge">${icon}</div>
      <div class="pr-category">${label}</div>
      <div class="pr-pace">${val}</div>
      <div class="pr-meta">${fmt(act.date)}${act.name ? `<br><span style="opacity:.7">${act.name}</span>` : ''}</div>
    </div>`).join('')}</div>`;
}

/* ══════════════════════════════════════════════════════════
   TENDANCE (Chart.js)
   ══════════════════════════════════════════════════════════ */
let _swimChartInstances = {};
function _renderSwimCharts(swims) {
  const canvasPace  = document.getElementById('swim-chart-pace');
  const canvasSwolf = document.getElementById('swim-chart-swolf');
  if (!canvasPace || !canvasSwolf || typeof Chart === 'undefined') return;

  Object.values(_swimChartInstances).forEach(c => { try { c.destroy(); } catch {} });
  _swimChartInstances = {};

  const sorted = swims.filter(a => a.pace_per_100m || a.swolf > 0).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const labels = sorted.map(a => new Date(a.date + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }));

  const onChartClick = (evt, chart) => {
    const points = chart.getElementsAtEventForMode(evt, 'nearest', { intersect: false }, true);
    if (points.length) {
      const act = sorted[points[0].index];
      if (act) openDetail(act.id);
    }
  };

  const paceData = sorted.map(a => a.pace_per_100m ? _swimPaceToSec(a.pace_per_100m) : null);
  _swimChartInstances.pace = new Chart(canvasPace, {
    type: 'line',
    data: { labels, datasets: [{ label: 'Allure (/100m)', data: paceData, borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.1)', fill: true, tension: 0.3, spanGaps: true }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      onClick(evt) { onChartClick(evt, this); },
      onHover(evt, els) { evt.native.target.style.cursor = els.length ? 'pointer' : 'default'; },
      plugins: { legend: { display: false }, title: { display: true, text: 'Allure /100m', color: '#9ca3af' } },
      scales: {
        y: { reverse: true, ticks: { color: '#9ca3af', callback: v => _swimSecToPace(v) }, grid: { color: 'rgba(255,255,255,0.05)' } },
        x: { ticks: { color: '#9ca3af', maxRotation: 0, autoSkip: true }, grid: { display: false } },
      },
    },
  });

  const swolfData = sorted.map(a => a.swolf || null);
  _swimChartInstances.swolf = new Chart(canvasSwolf, {
    type: 'line',
    data: { labels, datasets: [{ label: 'SWOLF', data: swolfData, borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,0.1)', fill: true, tension: 0.3, spanGaps: true }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      onClick(evt) { onChartClick(evt, this); },
      onHover(evt, els) { evt.native.target.style.cursor = els.length ? 'pointer' : 'default'; },
      plugins: { legend: { display: false }, title: { display: true, text: 'SWOLF (plus bas = mieux)', color: '#9ca3af' } },
      scales: {
        y: { ticks: { color: '#9ca3af' }, grid: { color: 'rgba(255,255,255,0.05)' } },
        x: { ticks: { color: '#9ca3af', maxRotation: 0, autoSkip: true }, grid: { display: false } },
      },
    },
  });
}

/* ══════════════════════════════════════════════════════════
   ZONES CARDIO MOYENNES
   ══════════════════════════════════════════════════════════ */
function _renderSwimZones(swims) {
  const el = document.getElementById('swim-zones');
  if (!el) return;
  const withZones = swims.filter(a => a.hr_zones_pct?.length === 5);
  if (!withZones.length) { el.innerHTML = '<div style="padding:16px;color:var(--muted);font-size:13px">Pas de données de zones cardio.</div>'; return; }

  const avgZones = [0, 1, 2, 3, 4].map(i => withZones.reduce((s, a) => s + (a.hr_zones_pct[i] || 0), 0) / withZones.length);
  const colors = ['#3b82f6', '#22c55e', '#f59e0b', '#f97316', '#ef4444'];
  const labels = ['Z1 Récupération', 'Z2 Endurance', 'Z3 Aérobie', 'Z4 Seuil', 'Z5 Maxi'];

  el.innerHTML = avgZones.map((p, i) => `
    <div class="zone-row">
      <div class="zone-label">${labels[i]}</div>
      <div class="zone-bar-bg"><div class="zone-bar-fill" style="width:${p}%;background:${colors[i]}"></div></div>
      <div class="zone-pct">${p.toFixed(0)}%</div>
    </div>`).join('');
}

/* ══════════════════════════════════════════════════════════
   DÉRIVE INTRA-SÉANCE & STYLE DE NAGE
   ══════════════════════════════════════════════════════════ */
function _renderSwimDrift(swims) {
  const el = document.getElementById('swim-drift');
  if (!el) return;

  const withDrift = swims.filter(a => a.swim_drift_swolf != null).slice(0, 10);
  const withStroke = swims.filter(a => a.swim_stroke_pct);

  let driftHtml = '<div style="color:var(--muted);font-size:13px;padding:8px 0">Pas encore de données de dérive (nécessite le backfill).</div>';
  if (withDrift.length) {
    driftHtml = `
      <div style="font-size:11px;color:var(--muted);margin-bottom:10px">Δ = dernier tiers − premier tiers de la séance. Positif = ça se dégrade en cours de séance.</div>
      <table class="compare-table"><tbody>
      ${withDrift.map(a => {
        const dateStr = new Date(a.date + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
        const swolfColor = a.swim_drift_swolf > 5 ? '#ef4444' : a.swim_drift_swolf > 0 ? '#f59e0b' : '#22c55e';
        const hrColor = a.swim_drift_hr > 10 ? '#ef4444' : a.swim_drift_hr > 0 ? '#f59e0b' : '#22c55e';
        return `<tr>
          <td class="compare-metric" style="text-align:left">${dateStr}</td>
          <td class="td-num"><span style="color:${swolfColor};font-weight:600">${a.swim_drift_swolf > 0 ? '+' : ''}${a.swim_drift_swolf}</span> SWOLF</td>
          <td class="td-num"><span style="color:${hrColor};font-weight:600">${a.swim_drift_hr > 0 ? '+' : ''}${a.swim_drift_hr}</span> bpm</td>
        </tr>`;
      }).join('')}
      </tbody></table>`;
  }

  let strokeHtml = '';
  if (withStroke.length) {
    const agg = {};
    withStroke.forEach(a => Object.entries(a.swim_stroke_pct).forEach(([k, v]) => { agg[k] = (agg[k] || 0) + v; }));
    const total = Object.values(agg).reduce((s, v) => s + v, 0);
    const STROKE_LABELS = { FREESTYLE: 'Crawl', BREASTSTROKE: 'Brasse', BACKSTROKE: 'Dos', BUTTERFLY: 'Papillon', UNKNOWN: 'Autre' };
    strokeHtml = `
      <div class="detail-section" style="margin-top:16px">Répartition par style</div>
      ${Object.entries(agg).sort((a, b) => b[1] - a[1]).map(([k, v]) => {
        const pct = Math.round(v / total * 100);
        return `<div class="zone-row">
          <div class="zone-label">${STROKE_LABELS[k] || k}</div>
          <div class="zone-bar-bg"><div class="zone-bar-fill" style="width:${pct}%;background:#3b82f6"></div></div>
          <div class="zone-pct">${pct}%</div>
        </div>`;
      }).join('')}`;
  }

  el.innerHTML = driftHtml + strokeHtml;
}

/* ══════════════════════════════════════════════════════════
   COMPARER DEUX SÉANCES
   ══════════════════════════════════════════════════════════ */
function populateSwimCompareSelectors() {
  const swims = getSwimsByPeriod()
    .sort((a, b) => (b.start_time || b.date || '').localeCompare(a.start_time || a.date || ''));
  const opts = swims.map(s => {
    const dateStr = s.date || (s.start_time || '').slice(0, 10);
    const date = dateStr ? new Date(dateStr + 'T12:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: '2-digit' }) : '–';
    const dist = s.distance_km ? `${s.distance_km.toFixed(2)} km` : '';
    const pace = s.pace_per_100m ? ` · ${s.pace_per_100m}/100m` : '';
    const name = s.name ? ` — ${s.name.slice(0, 28)}` : '';
    return `<option value="${s.id}">${date} ${dist}${pace}${name}</option>`;
  }).join('');

  ['swim-compare-sel-a', 'swim-compare-sel-b'].forEach((id, idx) => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = '<option value="">— Choisir une séance —</option>' + opts;
    if (prev) {
      sel.value = prev;
    } else if (swims.length > idx) {
      sel.value = String(swims[idx].id);
    }
  });
  updateSwimCompare();
}

function updateSwimCompare() {
  const idA = document.getElementById('swim-compare-sel-a')?.value;
  const idB = document.getElementById('swim-compare-sel-b')?.value;
  const el  = document.getElementById('swim-compare-result');
  if (!el) return;

  if (!idA || !idB) { el.innerHTML = ''; return; }
  if (idA === idB) {
    el.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:8px 0">Sélectionne deux séances différentes.</div>';
    return;
  }

  const swims = getSwimsByPeriod();
  const a = swims.find(s => String(s.id) === String(idA));
  const b = swims.find(s => String(s.id) === String(idB));
  if (!a || !b) return;

  const metrics = [
    ['Distance',      a.distance_km?.toFixed(2), b.distance_km?.toFixed(2), 'km', 'km', null],
    ['Durée',         a.duration_min ? (typeof secToTime==='function' ? secToTime(a.duration_min*60) : `${Math.round(a.duration_min)}min`) : null,
                       b.duration_min ? (typeof secToTime==='function' ? secToTime(b.duration_min*60) : `${Math.round(b.duration_min)}min`) : null, '', '', null],
    ['Allure',        a.pace_per_100m, b.pace_per_100m, '/100m', '/100m', true],
    ['SWOLF <span onclick="showSwolfInfo()" style="cursor:pointer;opacity:.6">ⓘ</span>', a.swolf, b.swolf, '', '', true],
    ['Cadence',       a.swim_cadence,  b.swim_cadence,  'coups/min', 'coups/min', null],
    ['Longueurs',     a.pool_lengths,  b.pool_lengths,  '', '', null],
    ['Pause',         a.rest_min>0 ? (typeof fmt_dur==='function'?fmt_dur(a.rest_min):`${Math.round(a.rest_min)}min`) : null,
                       b.rest_min>0 ? (typeof fmt_dur==='function'?fmt_dur(b.rest_min):`${Math.round(b.rest_min)}min`) : null, '', '', true],
    ['FC moy.',       a.hr_avg,        b.hr_avg,        'bpm', 'bpm', true],
    ['FC max',        a.hr_max,        b.hr_max,        'bpm', 'bpm', true],
    ['Dérive SWOLF',  a.swim_drift_swolf, b.swim_drift_swolf, '', '', true],
    ['Charge',        a.training_load ? Math.round(a.training_load) : null, b.training_load ? Math.round(b.training_load) : null, 'pts', 'pts', null],
    ['Calories',      a.calories,      b.calories,      'kcal', 'kcal', null],
  ].filter(([, vA, vB]) => vA != null && vB != null);

  const toNum = (v) => {
    if (typeof v === 'string' && v.includes(':')) {
      const [m, s] = v.split(':').map(Number);
      return m * 60 + (s || 0);
    }
    return parseFloat(v);
  };

  const rows = metrics.map(([label, vA, vB, uA, uB, lowerBetter]) => {
    const nA = toNum(vA), nB = toNum(vB);
    const max = Math.max(Math.abs(nA), Math.abs(nB)) || 1;
    const wA = Math.round((Math.abs(nA) / max) * 100);
    const wB = Math.round((Math.abs(nB) / max) * 100);
    const aWins = lowerBetter === null ? false : (lowerBetter ? nA < nB : nA > nB);
    const bWins = lowerBetter === null ? false : (lowerBetter ? nB < nA : nB > nA);
    const badge = aWins
      ? `<span class="compare-winner compare-win-a">A</span>`
      : bWins ? `<span class="compare-winner compare-win-b">B</span>` : '';

    return `<tr>
      <td class="compare-val-a">
        <div class="compare-bar-wrap" style="justify-content:flex-end">
          ${badge && aWins ? badge : ''}
          <span>${vA}<span style="font-weight:400;font-size:11px;color:var(--muted)"> ${uA}</span></span>
          <div class="compare-bar-a" style="width:${wA}px;max-width:80px"></div>
        </div>
      </td>
      <td class="compare-metric">${label}</td>
      <td class="compare-val-b">
        <div class="compare-bar-wrap">
          <div class="compare-bar-b" style="width:${wB}px;max-width:80px"></div>
          <span>${vB}<span style="font-weight:400;font-size:11px;color:var(--muted)"> ${uB}</span></span>
          ${badge && bWins ? badge : ''}
        </div>
      </td>
    </tr>`;
  }).join('');

  let zonesHtml = '';
  if (a.hr_zones_pct && b.hr_zones_pct) {
    const zColors = ['#94a3b8', '#22c55e', '#3b82f6', '#f97316', '#ef4444'];
    const zLabels = ['Z1', 'Z2', 'Z3', 'Z4', 'Z5'];
    zonesHtml = `
      <div class="compare-zones-title">Zones FC</div>
      <div class="compare-zones-wrap">
        ${zLabels.map((z, i) => {
          const pA = (a.hr_zones_pct[i] || 0).toFixed(1);
          const pB = (b.hr_zones_pct[i] || 0).toFixed(1);
          return `<div class="compare-zones-row">
            <div class="compare-zones-lbl">${z}</div>
            <div style="flex:1">
              <div style="display:flex;align-items:center;gap:6px;font-size:11px">
                <span style="color:#3b82f6;width:34px;text-align:right">${pA}%</span>
                <div style="flex:1;height:8px;background:var(--border);border-radius:4px;overflow:hidden;position:relative">
                  <div style="position:absolute;top:0;left:0;height:50%;width:${pA}%;background:${zColors[i]};opacity:0.9;border-radius:2px"></div>
                  <div style="position:absolute;bottom:0;left:0;height:50%;width:${pB}%;background:${zColors[i]};opacity:0.5;border-radius:2px"></div>
                </div>
                <span style="color:#f97316;width:34px">${pB}%</span>
              </div>
            </div>
          </div>`;
        }).join('')}
        <div style="display:flex;justify-content:center;gap:20px;margin-top:6px;font-size:11px">
          <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#3b82f6;margin-right:4px"></span>Session A</span>
          <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#f97316;opacity:0.6;margin-right:4px"></span>Session B</span>
        </div>
      </div>`;
  }

  const dateA = new Date(a.date + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'long' });
  const dateB = new Date(b.date + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'long' });

  el.innerHTML = `
    <div style="display:flex;gap:12px;margin-bottom:14px;flex-wrap:wrap">
      <div style="flex:1;min-width:140px;padding:10px 12px;border-radius:8px;background:rgba(59,130,246,0.07);border:1px solid rgba(59,130,246,0.2)">
        <div style="font-size:10px;font-weight:700;color:#3b82f6;text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px">A</div>
        <div style="font-size:13px;font-weight:600">${a.name || 'Natation'}</div>
        <div style="font-size:11px;color:var(--muted)">${dateA}</div>
      </div>
      <div style="flex:1;min-width:140px;padding:10px 12px;border-radius:8px;background:rgba(249,115,22,0.07);border:1px solid rgba(249,115,22,0.2)">
        <div style="font-size:10px;font-weight:700;color:#f97316;text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px">B</div>
        <div style="font-size:13px;font-weight:600">${b.name || 'Natation'}</div>
        <div style="font-size:11px;color:var(--muted)">${dateB}</div>
      </div>
    </div>
    <table class="compare-table"><tbody>${rows}</tbody></table>
    ${zonesHtml}`;
}

/* ══════════════════════════════════════════════════════════
   HISTORIQUE (tableau)
   ══════════════════════════════════════════════════════════ */
function _renderSwimTable(swims) {
  const tbody = document.getElementById('swim-table-body');
  if (!tbody) return;
  if (!swims.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:32px;color:var(--muted)">Aucune séance de natation</td></tr>`;
    return;
  }
  tbody.innerHTML = swims.map(a => {
    ACT_MAP[a.id] = a;
    const dateStr = a.date ? new Date(a.date + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '–';
    return `<tr onclick="openDetail(${a.id})">
      <td class="td-date">${dateStr}</td>
      <td class="td-name">${a.name || 'Natation'}</td>
      <td class="td-num">${a.distance_km ? a.distance_km.toFixed(2) + ' km' : '–'}</td>
      <td class="td-num">${fmt_dur(a.duration_min)}</td>
      <td class="td-num">${a.pace_per_100m ? a.pace_per_100m + '/100m' : '–'}</td>
      <td class="td-num">${a.swolf || '–'}</td>
      <td class="td-num col-hr">${a.hr_avg ? a.hr_avg + ' bpm' : '–'}</td>
    </tr>`;
  }).join('');
}

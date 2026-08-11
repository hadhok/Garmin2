/* ══════════════════════════════════════════════════════════
   SWIM.JS — Page dédiée Natation
   ══════════════════════════════════════════════════════════ */

const STROKE_LABELS = { FREESTYLE: 'Crawl', BREASTSTROKE: 'Brasse', BACKSTROKE: 'Dos', BUTTERFLY: 'Papillon', UNKNOWN: 'Autre' };

const swimState = {
  period: 'all',
  effort: '',
  stroke: '',
  sort: { col: 'date', dir: 'desc' },
  selectedId: null,
};
let _swimLastFiltered = [];

function getSwims() {
  return getAll().filter(a => a.type === 'swim');
}

function _swimDominantStroke(a) {
  if (!a.swim_stroke_pct) return null;
  const entries = Object.entries(a.swim_stroke_pct);
  if (!entries.length) return null;
  return entries.reduce((max, e) => e[1] > max[1] ? e : max, entries[0])[0];
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
  }

  return all.filter(a => {
    if (cutoff && new Date((a.date || '1970-01-01') + 'T12:00:00') < cutoff) return false;
    if (swimState.effort && a.te_label !== swimState.effort) return false;
    if (swimState.stroke && _swimDominantStroke(a) !== swimState.stroke) return false;
    return true;
  });
}

function setSwimPeriod(p, btn) {
  swimState.period = p;
  document.querySelectorAll('.swim-period-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderSwimPage();
}

function setSwimFilters() {
  swimState.effort = document.getElementById('swim-filter-effort')?.value || '';
  swimState.stroke = document.getElementById('swim-filter-stroke')?.value || '';
  renderSwimPage();
}

function _populateSwimFilterOptions(allSwims) {
  const effortSel = document.getElementById('swim-filter-effort');
  const strokeSel = document.getElementById('swim-filter-stroke');
  if (!effortSel || !strokeSel) return;

  const efforts = [...new Set(allSwims.map(a => a.te_label).filter(Boolean))].sort();
  const strokes = [...new Set(allSwims.map(_swimDominantStroke).filter(Boolean))];

  if (effortSel.options.length <= 1) {
    effortSel.innerHTML = '<option value="">Tous les efforts</option>' +
      efforts.map(e => `<option value="${e}">${e}</option>`).join('');
    effortSel.value = swimState.effort;
  }
  if (strokeSel.options.length <= 1) {
    strokeSel.innerHTML = '<option value="">Toutes les nages</option>' +
      strokes.map(s => `<option value="${s}">${STROKE_LABELS[s] || s}</option>`).join('');
    strokeSel.value = swimState.stroke;
  }
}

function sortSwimTable(col) {
  if (swimState.sort.col === col) {
    swimState.sort.dir = swimState.sort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    swimState.sort.col = col;
    swimState.sort.dir = col === 'date' ? 'desc' : 'asc';
  }
  _renderSwimTable(_swimLastFiltered);
}

function selectSwimRow(id) {
  swimState.selectedId = id;
  _renderSwimTable(_swimLastFiltered);
  const act = _swimLastFiltered.find(a => String(a.id) === String(id));
  _renderSwimDetailPanel(act);
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
  const allSwims = getSwims();
  _populateSwimFilterOptions(allSwims);

  const swims = getSwimsByPeriod().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  _swimLastFiltered = swims;

  _renderSwimKpis(swims);
  _renderSwimPRs(swims);
  _renderSwimCharts(swims);
  _renderSwimTable(swims);
  populateSwimCompareSelectors();

  const selected = swims.find(a => String(a.id) === String(swimState.selectedId)) || swims[0];
  swimState.selectedId = selected?.id ?? null;
  _renderSwimDetailPanel(selected);
}

/* ══════════════════════════════════════════════════════════
   KPI CARDS
   ══════════════════════════════════════════════════════════ */
function _sparklinePath(values, w, h) {
  if (values.length < 2) return '';
  const min = Math.min(...values), max = Math.max(...values);
  const range = (max - min) || 1;
  const step = w / (values.length - 1);
  return values.map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(h - ((v - min) / range) * h).toFixed(1)}`).join(' ');
}

function _renderSwimKpis(swims) {
  const el = document.getElementById('swim-kpi-strip');
  if (!el) return;

  const totalDist = swims.reduce((s, a) => s + (a.distance_km || 0), 0);
  const withPace  = swims.filter(a => a.pace_per_100m).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const avgPaceSec = withPace.length
    ? withPace.reduce((s, a) => s + _swimPaceToSec(a.pace_per_100m), 0) / withPace.length
    : null;
  const withSwolf = swims.filter(a => a.swolf > 0);
  const avgSwolf  = withSwolf.length ? withSwolf.reduce((s, a) => s + a.swolf, 0) / withSwolf.length : null;
  const bestSwolf = withSwolf.length ? Math.min(...withSwolf.map(a => a.swolf)) : null;

  const sparkVals = withPace.slice(-15).map(a => _swimPaceToSec(a.pace_per_100m));
  const sparkPath = _sparklinePath(sparkVals, 80, 30);

  el.innerHTML = `
    <div class="swim-kpi-card">
      <div>
        <div class="swim-kpi-card-label">Allure Moyenne</div>
        <div class="swim-kpi-card-value">${avgPaceSec ? _swimSecToPace(avgPaceSec) : '–'}<span style="font-size:12px;font-weight:400;color:var(--muted)"> /100m</span></div>
      </div>
      ${sparkPath ? `<svg class="swim-kpi-spark" width="80" height="30" viewBox="0 0 80 30"><path d="${sparkPath}" fill="none" stroke="#f97316" stroke-width="2"/></svg>` : ''}
    </div>
    <div class="swim-kpi-card">
      <div>
        <div class="swim-kpi-card-label">SWOLF Moyen</div>
        <div class="swim-kpi-card-value">${avgSwolf ? Math.round(avgSwolf) : '–'}</div>
        ${bestSwolf != null ? `<div class="swim-kpi-card-sub">Record : ${bestSwolf}</div>` : ''}
      </div>
    </div>
    <div class="swim-kpi-card">
      <div>
        <div class="swim-kpi-card-label">Volume Total</div>
        <div class="swim-kpi-card-value">${totalDist.toFixed(1)}<span style="font-size:12px;font-weight:400;color:var(--muted)"> km</span></div>
        <div class="swim-kpi-card-sub">${swims.length} séance${swims.length > 1 ? 's' : ''}</div>
      </div>
    </div>`;
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
   GRAPHIQUES (Chart.js)
   ══════════════════════════════════════════════════════════ */
let _swimChartInstances = {};

function _swimOpenOnClick(chart, evt, list, mode) {
  const pts = chart.getElementsAtEventForMode(evt, mode || 'nearest', { intersect: mode === 'point' }, true);
  if (pts.length) {
    const act = list[pts[0].index];
    if (act) openDetail(act.id);
  }
}

function _renderSwimCharts(swims) {
  if (typeof Chart === 'undefined') return;
  Object.values(_swimChartInstances).forEach(c => { try { c.destroy(); } catch {} });
  _swimChartInstances = {};

  const sorted = swims.filter(a => a.pace_per_100m || a.distance_km > 0).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const labels = sorted.map(a => new Date(a.date + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }));

  /* Tendance globale : distance (barres) + allure (ligne) */
  const canvasTrend = document.getElementById('swim-chart-trend');
  if (canvasTrend) {
    _swimChartInstances.trend = new Chart(canvasTrend, {
      data: {
        labels,
        datasets: [
          { type: 'bar', label: 'Distance (km)', data: sorted.map(a => a.distance_km || 0), backgroundColor: 'rgba(20,184,166,0.75)', borderRadius: 3, yAxisID: 'y' },
          { type: 'line', label: 'Allure (/100m)', data: sorted.map(a => a.pace_per_100m ? _swimPaceToSec(a.pace_per_100m) : null), borderColor: '#f97316', backgroundColor: 'rgba(249,115,22,0.1)', tension: 0.3, spanGaps: true, yAxisID: 'y1' },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        onClick(evt) { _swimOpenOnClick(this, evt, sorted); },
        onHover(evt, els) { evt.native.target.style.cursor = els.length ? 'pointer' : 'default'; },
        plugins: { legend: { position: 'top', labels: { color: '#9ca3af', boxWidth: 12, font: { size: 11 } } } },
        scales: {
          y:  { position: 'left',  ticks: { color: '#9ca3af' }, grid: { color: 'rgba(255,255,255,0.05)' }, title: { display: true, text: 'km', color: '#9ca3af' } },
          y1: { position: 'right', ticks: { color: '#9ca3af', callback: v => _swimSecToPace(v) }, grid: { display: false }, title: { display: true, text: 'min/100m', color: '#9ca3af' } },
          x:  { ticks: { color: '#9ca3af', maxRotation: 0, autoSkip: true }, grid: { display: false } },
        },
      },
    });
  }

  _renderSwimZoneQuadrant(swims);
  _renderSwimTeQuadrant(swims);
  _renderSwimTechniqueChart(swims);
  _renderSwimCadenceChart(swims);
  _renderSwimActivePause(swims);
  _renderSwimStrokeChart(swims);
  _renderSwimEffortChart(swims);
  _renderSwimDriftChart(swims);
  _renderSwimHrr(swims);
}

/* ── Quadrant 1a : Zones cardio (agrégées sur la période) ── */
function _renderSwimZoneQuadrant(swims) {
  const canvas = document.getElementById('swim-q-zones-chart');
  const tableEl = document.getElementById('swim-q-zones-table');
  if (!canvas || !tableEl) return;

  const withZones = swims.filter(a => a.hr_zones_pct?.length === 5);
  if (!withZones.length) {
    tableEl.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:8px 0">Pas de données.</div>';
    return;
  }

  const zLabels = ['Z1', 'Z2', 'Z3', 'Z4', 'Z5'];
  const colors = ['#3b82f6', '#22c55e', '#f59e0b', '#f97316', '#ef4444'];
  const avgPct = [0, 1, 2, 3, 4].map(i => withZones.reduce((s, a) => s + (a.hr_zones_pct[i] || 0), 0) / withZones.length);
  const totalMin = [0, 1, 2, 3, 4].map(i => withZones.reduce((s, a) => s + (a.hr_zones_pct[i] || 0) / 100 * (a.duration_min || 0), 0));

  _swimChartInstances.zones = new Chart(canvas, {
    type: 'bar',
    data: { labels: zLabels, datasets: [{ data: totalMin.map(m => Math.round(m)), backgroundColor: colors, borderRadius: 3 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { ticks: { color: '#9ca3af' }, grid: { color: 'rgba(255,255,255,0.05)' }, title: { display: true, text: 'min', color: '#9ca3af' } },
        x: { ticks: { color: '#9ca3af' }, grid: { display: false } },
      },
    },
  });

  tableEl.innerHTML = `<table class="compare-table" style="margin-top:8px"><tbody>
    ${zLabels.map((z, i) => `<tr>
      <td class="compare-metric" style="text-align:left"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${colors[i]};margin-right:6px"></span>${z}</td>
      <td class="td-num">${avgPct[i].toFixed(0)}%</td>
      <td class="td-num">${fmt_dur(totalMin[i])}</td>
    </tr>`).join('')}
  </tbody></table>`;
}

/* ── Quadrant 1b : Effet d'entraînement (TE) ── */
function _swimTeLabel(v) {
  if (v == null) return '–';
  if (v < 1) return 'Aucun';
  if (v < 2) return 'Léger';
  if (v < 3) return 'Entretien';
  if (v < 4) return 'Amélioration';
  return 'Très intense';
}

function _renderSwimTeQuadrant(swims) {
  const el = document.getElementById('swim-q-te');
  if (!el) return;
  const withTe = swims.filter(a => a.aerobic_te != null);
  if (!withTe.length) { el.innerHTML = '<div style="color:var(--muted);font-size:12px">Pas de données.</div>'; return; }

  const avgAerobic = withTe.reduce((s, a) => s + a.aerobic_te, 0) / withTe.length;
  const avgAnaerobic = withTe.reduce((s, a) => s + (a.anaerobic_te || 0), 0) / withTe.length;
  const labelCounts = {};
  swims.forEach(a => { if (a.te_label) labelCounts[a.te_label] = (labelCounts[a.te_label] || 0) + 1; });
  const dominant = Object.entries(labelCounts).sort((a, b) => b[1] - a[1])[0]?.[0];

  const gauge = (label, val, color) => `
    <div class="swim-te-gauge-label"><span>${label}</span><span style="font-weight:700">${val.toFixed(1)} / 5 · ${_swimTeLabel(val)}</span></div>
    <div class="swim-te-gauge-bg"><div class="swim-te-gauge-fill" style="width:${Math.min(100, val / 5 * 100)}%;background:${color}"></div></div>`;

  el.innerHTML = gauge('Aérobie', avgAerobic, '#14b8a6') + gauge('Anaérobie', avgAnaerobic, '#f97316') +
    (dominant ? `<div style="font-size:12px;color:var(--muted);margin-top:4px">Type dominant : <strong style="color:var(--text)">${dominant}</strong></div>` : '');
}

/* ── Quadrant 2a : Technique (SWOLF dans le temps) ── */
function _renderSwimTechniqueChart(swims) {
  const canvas = document.getElementById('swim-q-technique-chart');
  if (!canvas) return;
  const sorted = swims.filter(a => a.swolf > 0).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const labels = sorted.map(a => new Date(a.date + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }));

  _swimChartInstances.technique = new Chart(canvas, {
    type: 'line',
    data: { labels, datasets: [{ label: 'SWOLF', data: sorted.map(a => a.swolf), borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,0.1)', fill: true, tension: 0.3 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      onClick(evt) { _swimOpenOnClick(this, evt, sorted); },
      onHover(evt, els) { evt.native.target.style.cursor = els.length ? 'pointer' : 'default'; },
      plugins: { legend: { display: false } },
      scales: {
        y: { ticks: { color: '#9ca3af' }, grid: { color: 'rgba(255,255,255,0.05)' } },
        x: { ticks: { color: '#9ca3af', maxRotation: 0, autoSkip: true, font: { size: 10 } }, grid: { display: false } },
      },
    },
  });
}

/* ── Quadrant 2b : Effort vs Efficacité (SWOLF vs cadence) ── */
function _renderSwimCadenceChart(swims) {
  const canvas = document.getElementById('swim-q-cadence-chart');
  if (!canvas) return;
  const points = swims.filter(a => a.swim_cadence > 0 && a.swolf > 0).map(a => ({ x: a.swim_cadence, y: a.swolf, _act: a }));

  _swimChartInstances.cadence = new Chart(canvas, {
    type: 'scatter',
    data: { datasets: [{ data: points, backgroundColor: 'rgba(20,184,166,0.75)', pointRadius: 5, pointHoverRadius: 7 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      onClick(evt) { _swimOpenOnClick(this, evt, points.map(p => p._act), 'point'); },
      onHover(evt, els) { evt.native.target.style.cursor = els.length ? 'pointer' : 'default'; },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => `${ctx.parsed.x} coups/min · SWOLF ${ctx.parsed.y}` } },
      },
      scales: {
        x: { title: { display: true, text: 'Cadence', color: '#9ca3af' }, ticks: { color: '#9ca3af' }, grid: { color: 'rgba(255,255,255,0.05)' } },
        y: { title: { display: true, text: 'SWOLF', color: '#9ca3af' }, ticks: { color: '#9ca3af' }, grid: { color: 'rgba(255,255,255,0.05)' } },
      },
    },
  });
}

/* ── Quadrant 2c : Temps actif / pause ── */
function _renderSwimActivePause(swims) {
  const el = document.getElementById('swim-q-activepause');
  if (!el) return;
  const withRest = swims.filter(a => a.rest_min != null && a.duration_min);
  if (!withRest.length) { el.innerHTML = '<div style="color:var(--muted);font-size:12px">Pas de données.</div>'; return; }

  const totalDur = withRest.reduce((s, a) => s + a.duration_min, 0);
  const totalRest = withRest.reduce((s, a) => s + a.rest_min, 0);
  const totalActive = Math.max(0, totalDur - totalRest);
  const activePct = totalDur > 0 ? (totalActive / totalDur * 100) : 0;

  el.innerHTML = `
    <div class="swim-activepause-bar">
      <div style="width:${activePct}%;background:#14b8a6"></div>
      <div style="width:${100 - activePct}%;background:#f59e0b"></div>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--muted)">
      <span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#14b8a6;margin-right:4px"></span>Actif : ${fmt_dur(totalActive)}</span>
      <span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#f59e0b;margin-right:4px"></span>Pause : ${fmt_dur(totalRest)}</span>
    </div>`;
}

/* ── Quadrant 3a : Répartition des nages (agrégée) ── */
function _renderSwimStrokeChart(swims) {
  const canvas = document.getElementById('swim-q-stroke-chart');
  if (!canvas) return;
  const withStroke = swims.filter(a => a.swim_stroke_pct);
  if (!withStroke.length) { canvas.parentElement.innerHTML = '<div style="color:var(--muted);font-size:12px">Pas de données.</div>'; return; }

  const agg = {};
  withStroke.forEach(a => Object.entries(a.swim_stroke_pct).forEach(([k, v]) => { agg[k] = (agg[k] || 0) + v; }));
  const entries = Object.entries(agg).sort((a, b) => b[1] - a[1]);
  const palette = ['#14b8a6', '#f97316', '#3b82f6', '#a855f7', '#94a3b8'];

  _swimChartInstances.stroke = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: entries.map(([k]) => STROKE_LABELS[k] || k),
      datasets: [{ data: entries.map(([, v]) => v), backgroundColor: entries.map((_, i) => palette[i % palette.length]), borderWidth: 0 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { color: '#9ca3af', boxWidth: 10, font: { size: 11 } } } },
    },
  });
}

/* ── Quadrant 3b : Type de séance (te_label) ── */
function _renderSwimEffortChart(swims) {
  const canvas = document.getElementById('swim-q-effort-chart');
  if (!canvas) return;
  const counts = {};
  swims.forEach(a => { if (a.te_label) counts[a.te_label] = (counts[a.te_label] || 0) + 1; });
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!entries.length) { canvas.parentElement.innerHTML = '<div style="color:var(--muted);font-size:12px">Pas de données.</div>'; return; }

  _swimChartInstances.effort = new Chart(canvas, {
    type: 'bar',
    data: { labels: entries.map(([k]) => k), datasets: [{ data: entries.map(([, v]) => v), backgroundColor: 'rgba(20,184,166,0.75)', borderRadius: 3 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      indexAxis: 'y',
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#9ca3af', stepSize: 1 }, grid: { color: 'rgba(255,255,255,0.05)' } },
        y: { ticks: { color: '#9ca3af', font: { size: 11 } }, grid: { display: false } },
      },
    },
  });
}

/* ── Quadrant 4a : Dérive intra-séance (graphique + table) ── */
function _renderSwimDriftChart(swims) {
  const canvas = document.getElementById('swim-q-drift-chart');
  const tableEl = document.getElementById('swim-q-drift-table');
  if (!canvas || !tableEl) return;

  const withDrift = swims.filter(a => a.swim_drift_swolf != null).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  if (!withDrift.length) {
    tableEl.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:8px 0">Pas encore de données de dérive.</div>';
    return;
  }
  const labels = withDrift.map(a => new Date(a.date + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }));

  _swimChartInstances.drift = new Chart(canvas, {
    data: {
      labels,
      datasets: [
        { type: 'line', label: 'Δ SWOLF', data: withDrift.map(a => a.swim_drift_swolf), borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,0.1)', tension: 0.3, yAxisID: 'y' },
        { type: 'line', label: 'Δ FC', data: withDrift.map(a => a.swim_drift_hr), borderColor: '#f97316', backgroundColor: 'rgba(249,115,22,0.1)', tension: 0.3, yAxisID: 'y1' },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      onClick(evt) { _swimOpenOnClick(this, evt, withDrift); },
      onHover(evt, els) { evt.native.target.style.cursor = els.length ? 'pointer' : 'default'; },
      plugins: { legend: { position: 'top', labels: { color: '#9ca3af', boxWidth: 12, font: { size: 11 } } } },
      scales: {
        y:  { position: 'left',  ticks: { color: '#9ca3af' }, grid: { color: 'rgba(255,255,255,0.05)' } },
        y1: { position: 'right', ticks: { color: '#9ca3af' }, grid: { display: false } },
        x:  { ticks: { color: '#9ca3af', maxRotation: 0, autoSkip: true, font: { size: 10 } }, grid: { display: false } },
      },
    },
  });

  const rows = withDrift.slice(-8).reverse();
  tableEl.innerHTML = `
    <div style="font-size:11px;color:var(--muted);margin-bottom:6px">Δ = dernier tiers − premier tiers de la séance.</div>
    <table class="compare-table"><tbody>
    ${rows.map(a => {
      const dateStr = new Date(a.date + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
      const swolfColor = _swimDriftColor(a.swim_drift_swolf);
      const hrColor = a.swim_drift_hr > 10 ? '#ef4444' : a.swim_drift_hr > 0 ? '#f59e0b' : '#22c55e';
      return `<tr>
        <td class="compare-metric" style="text-align:left">${dateStr}</td>
        <td class="td-num"><span style="color:${swolfColor};font-weight:600">${a.swim_drift_swolf > 0 ? '+' : ''}${a.swim_drift_swolf}</span> SWOLF</td>
        <td class="td-num"><span style="color:${hrColor};font-weight:600">${a.swim_drift_hr > 0 ? '+' : ''}${a.swim_drift_hr}</span> bpm</td>
      </tr>`;
    }).join('')}
    </tbody></table>`;
}

/* ── Quadrant 4b : Récupération cardiaque (HRR) ── */
function _swimHrrColor(bpm) {
  if (bpm == null) return 'var(--muted)';
  if (bpm > 25) return '#22c55e';
  if (bpm >= 18) return '#84cc16';
  if (bpm >= 12) return '#f59e0b';
  return '#ef4444';
}
function _swimHrrLabel(bpm) {
  if (bpm == null) return '';
  if (bpm > 25) return 'Excellente';
  if (bpm >= 18) return 'Bonne';
  if (bpm >= 12) return 'Moyenne';
  return 'Faible';
}

function _renderSwimHrr(swims) {
  const el = document.getElementById('swim-q-hrr');
  if (!el) return;
  const with60 = swims.filter(a => a.hrr_60s != null);
  const with120 = swims.filter(a => a.hrr_120s != null);
  if (!with60.length && !with120.length) { el.innerHTML = '<div style="color:var(--muted);font-size:12px">Pas de données.</div>'; return; }

  const avg60 = with60.length ? with60.reduce((s, a) => s + a.hrr_60s, 0) / with60.length : null;
  const avg120 = with120.length ? with120.reduce((s, a) => s + a.hrr_120s, 0) / with120.length : null;

  const row = (label, val) => val == null ? '' : `
    <div class="swim-hrr-row">
      <span class="swim-detail-metric-label">${label}</span>
      <span style="font-weight:700;color:${_swimHrrColor(val)}">${Math.round(val)} bpm <span style="font-weight:400;font-size:11px">(${_swimHrrLabel(val)})</span></span>
    </div>`;

  el.innerHTML = row('Récup. moyenne à 60s', avg60) + row('Récup. moyenne à 120s', avg120);
}

/* ══════════════════════════════════════════════════════════
   HISTORIQUE (tableau)
   ══════════════════════════════════════════════════════════ */
function _renderSwimTable(swims) {
  const tbody = document.getElementById('swim-table-body');
  if (!tbody) return;
  if (!swims.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:32px;color:var(--muted)">Aucune séance</td></tr>`;
    return;
  }

  const { col, dir } = swimState.sort;
  const d = dir === 'asc' ? 1 : -1;
  const sorted = [...swims].sort((a, b) => {
    const va = a[col] ?? (col === 'date' ? '' : 0);
    const vb = b[col] ?? (col === 'date' ? '' : 0);
    return typeof va === 'string' ? va.localeCompare(vb) * d : (va - vb) * d;
  });

  tbody.innerHTML = sorted.map(a => {
    ACT_MAP[a.id] = a;
    const dateStr = a.date ? new Date(a.date + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: '2-digit' }) : '–';
    const selected = String(a.id) === String(swimState.selectedId);
    return `<tr onclick="selectSwimRow(${a.id})" class="${selected ? 'swim-table-row-selected' : ''}" style="cursor:pointer">
      <td class="td-date">${dateStr}</td>
      <td class="td-name">${a.name || 'Natation'}</td>
      <td class="td-num">${a.distance_km ? a.distance_km.toFixed(1) + ' km' : '–'}</td>
      <td class="td-num">${a.pace_per_100m ? a.pace_per_100m : '–'}</td>
      <td class="td-num">${a.swolf || '–'}</td>
      <td class="td-num col-hr">${a.hr_avg ? a.hr_avg + ' bpm' : '–'}</td>
      <td class="td-num">${a.training_load ? Math.round(a.training_load) : '–'}</td>
    </tr>`;
  }).join('');
}

/* ══════════════════════════════════════════════════════════
   PANNEAU DE DÉTAIL D'UNE SÉANCE
   ══════════════════════════════════════════════════════════ */
function _renderSwimDetailPanel(act) {
  const el = document.getElementById('swim-detail-panel');
  if (!el) return;
  if (!act) { el.innerHTML = '<div class="swim-detail-empty">Sélectionne une séance dans le tableau.</div>'; return; }

  const dateStr = new Date(act.date + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  el.innerHTML = `
    <div style="margin-bottom:12px">
      <div class="swim-card-title" style="margin-bottom:2px">${act.name || 'Natation'}</div>
      <div style="font-size:12px;color:var(--muted)">${dateStr}</div>
    </div>

    <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin:14px 0 8px">Répartition des nages</div>
    <div style="height:150px;position:relative"><canvas id="swim-detail-stroke-chart"></canvas></div>

    <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin:16px 0 8px">Zones cardio</div>
    <div id="swim-detail-zones">${_swimZonesHtml(act)}</div>

    <div style="margin-top:12px">
      <div class="swim-detail-metric">
        <span class="swim-detail-metric-label">Dérive intra-séance (SWOLF)</span>
        <span class="swim-detail-metric-value" style="color:${_swimDriftColor(act.swim_drift_swolf)}">${act.swim_drift_swolf != null ? (act.swim_drift_swolf > 0 ? '+' : '') + act.swim_drift_swolf : '–'}</span>
      </div>
      <div class="swim-detail-metric">
        <span class="swim-detail-metric-label">Récupération cardiaque (60s)</span>
        <span class="swim-detail-metric-value">${act.hrr_60s != null ? Math.round(act.hrr_60s) + ' bpm' : '–'}</span>
      </div>
      <div class="swim-detail-metric">
        <span class="swim-detail-metric-label">Effet d'entraînement</span>
        <span class="swim-detail-metric-value">${act.aerobic_te != null ? `Aéro ${act.aerobic_te.toFixed(1)} · Anaéro ${(act.anaerobic_te || 0).toFixed(1)}` : '–'}</span>
      </div>
    </div>

    <button onclick="openDetail(${act.id})"
            style="margin-top:14px;width:100%;padding:10px;border-radius:10px;border:1px solid var(--border);background:var(--surface2);color:var(--text);font-weight:600;font-size:13px;cursor:pointer">
      Voir le détail complet →
    </button>`;

  _renderSwimDetailStrokeChart(act);
}

function _swimDriftColor(v) {
  if (v == null) return 'var(--muted)';
  if (v > 5) return '#ef4444';
  if (v > 0) return '#f59e0b';
  return '#22c55e';
}

function _swimZonesHtml(act) {
  if (!act.hr_zones_pct || act.hr_zones_pct.length !== 5) {
    return '<div style="color:var(--muted);font-size:12px">Pas de données.</div>';
  }
  const colors = ['#3b82f6', '#22c55e', '#f59e0b', '#f97316', '#ef4444'];
  const labels = ['Z1', 'Z2', 'Z3', 'Z4', 'Z5'];
  return act.hr_zones_pct.map((p, i) => `
    <div class="zone-row">
      <div class="zone-label">${labels[i]}</div>
      <div class="zone-bar-bg"><div class="zone-bar-fill" style="width:${p}%;background:${colors[i]}"></div></div>
      <div class="zone-pct">${p}%</div>
    </div>`).join('');
}

function _renderSwimDetailStrokeChart(act) {
  const canvas = document.getElementById('swim-detail-stroke-chart');
  if (!canvas || typeof Chart === 'undefined') return;
  try { _swimChartInstances.detailStroke?.destroy(); } catch {}

  if (!act.swim_stroke_pct) {
    canvas.parentElement.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:8px 0">Pas de données de style.</div>';
    return;
  }
  const entries = Object.entries(act.swim_stroke_pct).sort((a, b) => b[1] - a[1]);
  const palette = ['#14b8a6', '#f97316', '#3b82f6', '#a855f7', '#94a3b8'];

  _swimChartInstances.detailStroke = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: entries.map(([k]) => STROKE_LABELS[k] || k),
      datasets: [{ data: entries.map(([, v]) => v), backgroundColor: entries.map((_, i) => palette[i % palette.length]), borderWidth: 0 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { color: '#9ca3af', boxWidth: 10, font: { size: 11 } } } },
    },
  });
}

/* ══════════════════════════════════════════════════════════
   COMPARER DEUX SÉANCES
   ══════════════════════════════════════════════════════════ */
function populateSwimCompareSelectors() {
  const swims = _swimLastFiltered
    .slice()
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

  const swims = getSwims();
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

/* ══════════════════════════════════════════════════════════
   DETAIL_CHARTS.JS — Graphes time-series dans la modale
   ══════════════════════════════════════════════════════════ */

let _detailChartInstances = {};
let _detailActivityId     = null;
let _detailSamples        = null;
let _detailSplits         = null;
let _detailActiveMetrics  = ['pace', 'hr'];  // métriques affichées

const _METRIC_CFG = {
  pace:    { label: 'Allure',          unit: '/km',  color: '#3b82f6', yInvert: true,  fmt: v => { const m=Math.floor(v); return `${m}:${String(Math.round((v-m)*60)).padStart(2,'0')}`; } },
  hr:      { label: 'FC',              unit: 'bpm',  color: '#ef4444', yInvert: false, fmt: v => Math.round(v) + ' bpm' },
  cadence: { label: 'Cadence',         unit: 'spm',  color: '#8b5cf6', yInvert: false, fmt: v => Math.round(v) + ' spm' },
  power:   { label: 'Puissance',       unit: 'W',    color: '#f59e0b', yInvert: false, fmt: v => Math.round(v) + ' W' },
  vos:     { label: 'Osc. verticale',  unit: 'cm',   color: '#06b6d4', yInvert: false, fmt: v => v.toFixed(1) + ' cm' },
  gct:     { label: 'Contact sol',     unit: 'ms',   color: '#f97316', yInvert: false, fmt: v => Math.round(v) + ' ms' },
  stride:  { label: 'Foulée',          unit: 'm',    color: '#22c55e', yInvert: false, fmt: v => v.toFixed(2) + ' m' },
  vr:      { label: 'Rapport vert.',   unit: '%',    color: '#ec4899', yInvert: false, fmt: v => v.toFixed(1) + '%' },
  alt:     { label: 'Altitude',        unit: 'm',    color: '#94a3b8', yInvert: false, fmt: v => Math.round(v) + ' m' },
};

/* ── Charge les détails depuis l'API ──────────────────────────────────────── */
async function loadActivityDetails(activityId) {
  if (_detailActivityId === activityId) return;  // déjà chargé
  _detailActivityId = activityId;
  _detailSamples    = null;
  _detailSplits     = null;

  const el = document.getElementById('detail-charts-wrap');
  if (!el) return;
  el.innerHTML = `<div class="detail-charts-loading">⏳ Chargement des données…</div>`;

  try {
    const r = await fetch(`/api/activity_details?id=${activityId}`);
    if (r.status === 404) {
      // Pas encore en base — déclenche le fetch
      el.innerHTML = `<div class="detail-charts-loading">📡 Récupération depuis Garmin…</div>`;
      const r2 = await fetch('/api/activity_details', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activity_id: activityId }),
      });
      const d2 = await r2.json();
      if (d2.error || !d2.samples) {
        el.innerHTML = `<div class="detail-charts-empty">Données détaillées non disponibles</div>`;
        return;
      }
      _detailSamples = d2.samples;
      _detailSplits  = d2.splits || [];
    } else if (r.ok) {
      const d = await r.json();
      _detailSamples = d.samples;
      _detailSplits  = d.splits || [];
    } else {
      el.innerHTML = `<div class="detail-charts-empty">Données non disponibles</div>`;
      return;
    }
  } catch (e) {
    el.innerHTML = `<div class="detail-charts-empty">Erreur : ${e}</div>`;
    return;
  }

  renderDetailCharts();
}

/* ── Render principal ─────────────────────────────────────────────────────── */
function renderDetailCharts() {
  const el = document.getElementById('detail-charts-wrap');
  if (!el || !_detailSamples?.length) return;

  // Détecte les métriques disponibles
  const available = Object.keys(_METRIC_CFG).filter(k =>
    _detailSamples.some(s => s[k] != null)
  );

  if (!available.length) {
    el.innerHTML = `<div class="detail-charts-empty">Aucune métrique disponible</div>`;
    return;
  }

  // Garde seulement les métriques actives qui sont disponibles
  _detailActiveMetrics = _detailActiveMetrics.filter(m => available.includes(m));
  if (!_detailActiveMetrics.length) _detailActiveMetrics = [available[0]];

  el.innerHTML = `
    <div class="detail-charts-header">
      <div class="detail-metric-pills">
        ${available.map(m => `
          <button class="detail-metric-pill ${_detailActiveMetrics.includes(m) ? 'active' : ''}"
            data-metric="${m}" onclick="_toggleDetailMetric('${m}', this)"
            style="${_detailActiveMetrics.includes(m) ? `background:${_METRIC_CFG[m].color}20;border-color:${_METRIC_CFG[m].color};color:${_METRIC_CFG[m].color}` : ''}">
            ${_METRIC_CFG[m].label}
          </button>`).join('')}
      </div>
    </div>
    <div class="detail-chart-container">
      <canvas id="detail-ts-chart"></canvas>
    </div>
    ${_detailSplits?.length ? `
    <div class="detail-section" style="margin-top:16px">Splits / Laps</div>
    <div class="detail-splits-table">
      <div class="detail-splits-head">
        <span>Lap</span><span>Distance</span><span>Durée</span><span>Allure</span><span>FC moy.</span>
      </div>
      ${_detailSplits.map(s => `
        <div class="detail-splits-row">
          <span>${s.lap}</span>
          <span>${s.distance_km > 0 ? s.distance_km.toFixed(2) + ' km' : '–'}</span>
          <span>${s.duration_min > 0 ? _fmtDurMin(s.duration_min) : '–'}</span>
          <span>${s.pace ? _fmtPace(s.pace) : '–'}</span>
          <span>${s.hr_avg ? Math.round(s.hr_avg) + ' bpm' : '–'}</span>
        </div>`).join('')}
    </div>` : ''}
  `;

  _buildDetailChart();
}

function _fmtPace(v) {
  const m = Math.floor(v);
  return `${m}:${String(Math.round((v - m) * 60)).padStart(2, '0')} /km`;
}
function _fmtDurMin(min) {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h > 0 ? `${h}h${String(m).padStart(2,'0')}` : `${m} min`;
}

/* ── Construit le chart Chart.js ──────────────────────────────────────────── */
function _buildDetailChart() {
  // Détruit les anciens charts
  Object.values(_detailChartInstances).forEach(c => { try { c.destroy(); } catch {} });
  _detailChartInstances = {};

  const canvas = document.getElementById('detail-ts-chart');
  if (!canvas || !_detailSamples?.length) return;

  const samples = _detailSamples;

  // Labels = temps formaté
  const labels = samples.map(s => {
    const t = s.t || 0;
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const sec = t % 60;
    return h > 0 ? `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`
                 : `${m}:${String(sec).padStart(2,'0')}`;
  });

  const datasets = _detailActiveMetrics.map(metric => {
    const cfg  = _METRIC_CFG[metric];
    const data = samples.map(s => s[metric] ?? null);
    return {
      label:           cfg.label,
      data,
      borderColor:     cfg.color,
      backgroundColor: cfg.color + '18',
      borderWidth:     1.5,
      pointRadius:     0,
      fill:            _detailActiveMetrics.length === 1,
      tension:         0.3,
      spanGaps:        true,
      yAxisID:         `y_${metric}`,
    };
  });

  const scales = { x: {
    ticks: { maxTicksLimit: 8, font: { size: 10 }, color: '#94a3b8' },
    grid:  { color: 'rgba(0,0,0,0.04)' },
  }};

  _detailActiveMetrics.forEach((metric, i) => {
    const cfg = _METRIC_CFG[metric];
    scales[`y_${metric}`] = {
      type:     'linear',
      display:  i < 2,  // max 2 axes affichés
      position: i === 0 ? 'left' : 'right',
      reverse:  cfg.yInvert,
      grid:     { display: i === 0, color: 'rgba(0,0,0,0.04)' },
      ticks:    {
        font: { size: 10 }, color: cfg.color,
        callback: v => cfg.fmt ? cfg.fmt(v).replace(/ .*/, '') : v,
      },
    };
  });

  const chart = new Chart(canvas, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => {
              const metric = _detailActiveMetrics[ctx.datasetIndex];
              const cfg    = _METRIC_CFG[metric];
              return ` ${cfg.label} : ${cfg.fmt(ctx.raw)}`;
            },
          },
          backgroundColor: 'rgba(15,23,42,0.9)',
          titleFont: { size: 11 },
          bodyFont:  { size: 11 },
        },
      },
      scales,
    },
  });

  _detailChartInstances['ts'] = chart;
}

/* ── Toggle métrique ──────────────────────────────────────────────────────── */
function _toggleDetailMetric(metric, btn) {
  const idx = _detailActiveMetrics.indexOf(metric);
  if (idx >= 0) {
    if (_detailActiveMetrics.length === 1) return;  // toujours au moins 1
    _detailActiveMetrics.splice(idx, 1);
    btn.classList.remove('active');
    btn.style.background = '';
    btn.style.borderColor = '';
    btn.style.color = '';
  } else {
    _detailActiveMetrics.push(metric);
    const color = _METRIC_CFG[metric].color;
    btn.classList.add('active');
    btn.style.background    = color + '20';
    btn.style.borderColor   = color;
    btn.style.color         = color;
  }
  _buildDetailChart();
}

/* ══════════════════════════════════════════════════════════
   RUNNING ANALYSIS
   ══════════════════════════════════════════════════════════ */

const HR_REST  = 62;
const MIN_DIST = 3;   // km

/* ── Helpers ── */
function getRuns() {
  return getAll().filter(a => a.type === 'run' && (a.distance_km || 0) >= MIN_DIST);
}

function paceToSec(p) {
  if (!p) return null;
  const [m, s] = String(p).split(':').map(Number);
  return m * 60 + (s || 0);
}

function secToPace(s) {
  if (!s || s <= 0) return '–';
  const m = Math.floor(s / 60), sec = Math.round(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function secToTime(s) {
  if (!s || s <= 0) return '–';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.round(s % 60);
  return h > 0
    ? `${h}h${m.toString().padStart(2,'0')}'${sec.toString().padStart(2,'0')}"`
    : `${m}'${sec.toString().padStart(2,'0')}"`;
}

/* ── TRIMP de Banister ── */
function computeTRIMP(run) {
  const hrMax = run.hr_max || 185;
  if (!run.hr_avg || !run.duration_min) return 0;
  const ratio = (run.hr_avg - HR_REST) / (hrMax - HR_REST);
  if (ratio <= 0) return 0;
  return Math.round(run.duration_min * ratio * 0.64 * Math.exp(1.92 * ratio));
}

/* ══════════════════════════════════════════════════════════
   CTL / ATL / TSB — runs only
   ══════════════════════════════════════════════════════════ */
function computeRunForm() {
  const runs = getRuns();
  const loadMap = {};
  runs.forEach(r => {
    const d = (r.date || '').slice(0, 10);
    if (d) loadMap[d] = (loadMap[d] || 0) + (r.training_load || 0);
  });

  const result = [];
  let ctl = 0, atl = 0;
  for (let i = 179; i >= 0; i--) {
    const d = new Date(TODAY); d.setDate(d.getDate() - i);
    const iso = d.toISOString().slice(0, 10);
    const load = loadMap[iso] || 0;
    ctl = ctl + (load - ctl) / 42;
    atl = atl + (load - atl) / 7;
    if (i < 90) result.push({ date: iso, ctl: +ctl.toFixed(1), atl: +atl.toFixed(1), tsb: +(ctl - atl).toFixed(1) });
  }
  return result;
}

/* ══════════════════════════════════════════════════════════
   JACK DANIELS — VDOT → pronostics & allures
   ══════════════════════════════════════════════════════════ */
function vdotToVelocity(vdot, pctVO2) {
  // VO2 at race pace, then solve quadratic for velocity (m/min)
  const vo2 = vdot * pctVO2;
  return (-0.182258 + Math.sqrt(0.033218 + 0.000416 * (vo2 + 4.60))) / 0.000208;
}

function computePronostics(vdot) {
  // % VO2max utilisé par distance (Jack Daniels)
  const races = [
    { label: '1 km',    dist: 1000,   pct: 0.999 },
    { label: '3 km',    dist: 3000,   pct: 0.979 },
    { label: '5 km',    dist: 5000,   pct: 0.955 },
    { label: '10 km',   dist: 10000,  pct: 0.922 },
    { label: 'Semi',    dist: 21097,  pct: 0.884 },
    { label: 'Marathon',dist: 42195,  pct: 0.840 },
  ];
  return races.map(r => {
    const v = vdotToVelocity(vdot, r.pct);       // m/min
    const timeSec = r.dist / v * 60;              // secondes
    const paceSec = timeSec / (r.dist / 1000);   // sec/km
    return { ...r, timeSec, paceSec };
  });
}

function computeTrainingPaces(vdot) {
  // Zones Jack Daniels avec % VO2max min/max
  const zones = [
    { label: 'Récupération (R)', color: '#94a3b8', pctMin: 0.59, pctMax: 0.65 },
    { label: 'Endurance (E)',    color: '#22c55e',  pctMin: 0.65, pctMax: 0.74 },
    { label: 'Marathon (M)',     color: '#3b82f6',  pctMin: 0.75, pctMax: 0.84 },
    { label: 'Seuil (T)',        color: '#f97316',  pctMin: 0.83, pctMax: 0.88 },
    { label: 'Interval (I)',     color: '#ef4444',  pctMin: 0.95, pctMax: 1.00 },
  ];
  return zones.map(z => {
    const vSlow = vdotToVelocity(vdot, z.pctMin);
    const vFast = vdotToVelocity(vdot, z.pctMax);
    const slowSec = 1000 / vSlow * 60;
    const fastSec = 1000 / vFast * 60;
    return { ...z, slowSec, fastSec };
  });
}

/* ══════════════════════════════════════════════════════════
   RENDER : KPIs
   ══════════════════════════════════════════════════════════ */
function renderRunKPIs() {
  const runs = getRuns();
  const el = document.getElementById('run-kpis');
  if (!el) return;

  if (!runs.length) {
    el.innerHTML = '<div class="kpi-card"><div class="kpi-label">Aucune course ≥ 3 km</div></div>';
    return;
  }

  // VO2max le plus récent
  const withVo2 = runs.filter(r => r.vo2max > 0).sort((a, b) => b.date.localeCompare(a.date));
  const vo2 = withVo2[0]?.vo2max || null;
  const vo2Prev = withVo2[1]?.vo2max || null;
  const vo2Delta = vo2 && vo2Prev ? vo2 - vo2Prev : null;

  // CTL/ATL/TSB running (dernière valeur)
  const form = computeRunForm();
  const last = form[form.length - 1] || { ctl: 0, atl: 0, tsb: 0 };

  // Distance 7j
  const d7 = new Date(TODAY); d7.setDate(d7.getDate() - 7);
  const dist7 = runs.filter(r => new Date(r.date) >= d7).reduce((s, r) => s + (r.distance_km || 0), 0);

  // Allure marathon estimée
  const marathonTime = vo2 ? computePronostics(vo2).find(p => p.label === 'Marathon') : null;

  const kd = (v, u) => v !== null ? `${v}<span class="kpi-unit">${u}</span>` : '–';

  el.innerHTML = [
    { label: 'VO2max', val: vo2 ? `${vo2}<span class="kpi-unit"> ml/kg/min</span>` : '–',
      sub: vo2Delta !== null ? `<div class="kpi-delta ${vo2Delta >= 0 ? 'up' : 'down'}">${vo2Delta >= 0 ? '▲' : '▼'} ${Math.abs(vo2Delta)}</div>` : '' },
    { label: 'Allure Marathon', val: marathonTime ? secToPace(marathonTime.paceSec) : '–', sub: '<div class="kpi-delta">estimé VDOT</div>' },
    { label: 'CTL run', val: kd(last.ctl.toFixed(1), ' pts'), sub: '' },
    { label: 'ATL run', val: kd(last.atl.toFixed(1), ' pts'), sub: '' },
    { label: 'TSB run', val: kd(last.tsb.toFixed(1), ' pts'),
      sub: `<div class="kpi-delta ${last.tsb >= 0 ? 'up' : 'down'}">${last.tsb >= 0 ? 'Frais' : 'Fatigué'}</div>` },
    { label: 'Distance 7j', val: kd(dist7.toFixed(1), ' km'), sub: '' },
  ].map(k => `<div class="kpi-card"><div class="kpi-label">${k.label}</div><div class="kpi-value">${k.val}</div>${k.sub}</div>`).join('');
}

/* ══════════════════════════════════════════════════════════
   RENDER : Graphique CTL/ATL/TSB running
   ══════════════════════════════════════════════════════════ */
function renderRunFormChart() {
  const curve = computeRunForm();
  if (!curve.length) return;
  const labels = curve.map(d => new Date(d.date + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }));
  mkChart('chart-run-form', {
    type: 'line',
    data: { labels, datasets: [
      { label: 'CTL', data: curve.map(d => d.ctl), borderColor: '#6366f1', fill: false, tension: 0.4, pointRadius: 0, borderWidth: 2 },
      { label: 'ATL', data: curve.map(d => d.atl), borderColor: '#f97316', fill: false, tension: 0.4, pointRadius: 0, borderWidth: 2 },
      { label: 'TSB', data: curve.map(d => d.tsb), borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,0.08)', fill: 'origin', tension: 0.4, pointRadius: 0, borderWidth: 2, borderDash: [5, 3] },
    ]},
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false },
        annotation: { annotations: { zero: { type: 'line', yMin: 0, yMax: 0, borderColor: 'rgba(0,0,0,0.18)', borderWidth: 1 } } }
      },
      scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } }, y: { grid: { color: '#e5e7eb' } } }
    }
  });
}

/* ══════════════════════════════════════════════════════════
   RENDER : Pronostics
   ══════════════════════════════════════════════════════════ */
function renderRunPronostics() {
  const el = document.getElementById('run-pronostics');
  if (!el) return;
  const runs = getRuns();
  const withVo2 = runs.filter(r => r.vo2max > 0).sort((a, b) => b.date.localeCompare(a.date));
  const vo2 = withVo2[0]?.vo2max;
  if (!vo2) { el.innerHTML = '<p style="color:var(--muted);font-size:13px">VO2max non disponible</p>'; return; }

  const prons = computePronostics(vo2);
  el.innerHTML = `
    <div style="font-size:11px;color:var(--muted);margin-bottom:10px">Base : VDOT ${vo2} (Jack Daniels)</div>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="color:var(--muted);font-size:11px;text-align:left">
        <th style="padding:4px 0">Distance</th>
        <th style="padding:4px 0;text-align:right">Temps</th>
        <th style="padding:4px 0;text-align:right">Allure</th>
      </tr></thead>
      <tbody>
        ${prons.map(p => `<tr style="border-top:1px solid var(--border)">
          <td style="padding:7px 0;font-weight:500">${p.label}</td>
          <td style="padding:7px 0;text-align:right;font-variant-numeric:tabular-nums">${secToTime(p.timeSec)}</td>
          <td style="padding:7px 0;text-align:right;color:var(--muted)">${secToPace(p.paceSec)}/km</td>
        </tr>`).join('')}
      </tbody>
    </table>`;
}

/* ══════════════════════════════════════════════════════════
   RENDER : Allures d'entraînement
   ══════════════════════════════════════════════════════════ */
function renderRunPaces() {
  const el = document.getElementById('run-paces');
  if (!el) return;
  const runs = getRuns();
  const withVo2 = runs.filter(r => r.vo2max > 0).sort((a, b) => b.date.localeCompare(a.date));
  const vo2 = withVo2[0]?.vo2max;
  if (!vo2) { el.innerHTML = '<p style="color:var(--muted);font-size:13px">VO2max non disponible</p>'; return; }

  const zones = computeTrainingPaces(vo2);
  el.innerHTML = zones.map(z => `
    <div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-top:1px solid var(--border);font-size:13px">
      <span style="width:10px;height:10px;border-radius:50%;background:${z.color};flex-shrink:0"></span>
      <span style="flex:1;font-weight:500">${z.label}</span>
      <span style="color:var(--muted);font-variant-numeric:tabular-nums">${secToPace(z.fastSec)} – ${secToPace(z.slowSec)}/km</span>
    </div>`).join('');
}

/* ══════════════════════════════════════════════════════════
   RENDER : VO2max trend
   ══════════════════════════════════════════════════════════ */
function renderRunVO2Chart() {
  const runs = getRuns().filter(r => r.vo2max > 0).sort((a, b) => a.date.localeCompare(b.date));
  if (runs.length < 2) return;
  const labels = runs.map(r => new Date(r.date + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }));
  mkChart('chart-run-vo2', {
    type: 'line',
    data: { labels, datasets: [{
      label: 'VO2max', data: runs.map(r => r.vo2max),
      borderColor: '#8b5cf6', backgroundColor: 'rgba(139,92,246,0.1)',
      fill: true, tension: 0.4, pointRadius: 4, pointBackgroundColor: '#8b5cf6', borderWidth: 2,
    }]},
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `VO2max : ${c.raw} ml/kg/min` } } },
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } },
        y: { grid: { color: '#e5e7eb' }, min: Math.max(0, Math.min(...runs.map(r => r.vo2max)) - 5),
          title: { display: true, text: 'ml/kg/min', color: '#94a3b8', font: { size: 10 } } }
      }
    }
  });
}

/* ══════════════════════════════════════════════════════════
   RENDER : Distribution zones FC (agrégé sur toutes courses)
   ══════════════════════════════════════════════════════════ */
function renderRunZonesChart() {
  const runs = getRuns().filter(r => r.hr_zones_pct && r.duration_min);
  if (!runs.length) return;

  // Moyenne pondérée par durée
  const totDur = runs.reduce((s, r) => s + r.duration_min, 0);
  const zones = [0, 0, 0, 0, 0];
  runs.forEach(r => {
    r.hr_zones_pct.forEach((pct, i) => { zones[i] += (pct * r.duration_min) / totDur; });
  });

  const labels = ['Z1 Récup', 'Z2 Endurance', 'Z3 Tempo', 'Z4 Seuil', 'Z5 VO2max'];
  const colors = ['#94a3b8', '#22c55e', '#3b82f6', '#f97316', '#ef4444'];

  mkChart('chart-run-zones', {
    type: 'bar',
    data: { labels, datasets: [{ data: zones.map(v => +v.toFixed(1)), backgroundColor: colors, borderRadius: 4 }] },
    options: {
      responsive: true, maintainAspectRatio: false, indexAxis: 'y',
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${c.raw.toFixed(1)} %` } } },
      scales: {
        x: { grid: { color: '#e5e7eb' }, ticks: { callback: v => v + '%' } },
        y: { grid: { display: false } }
      }
    }
  });
}

/* ══════════════════════════════════════════════════════════
   RENDER : Efficience allure × FC (scatter)
   ══════════════════════════════════════════════════════════ */
function renderRunEfficiencyChart() {
  const runs = getRuns().filter(r => r.pace_min_km && r.hr_avg);
  if (runs.length < 3) return;

  const data = runs.map(r => ({
    x: paceToSec(r.pace_min_km),
    y: r.hr_avg,
    label: r.date,
  })).filter(p => p.x);

  mkChart('chart-run-efficiency', {
    type: 'scatter',
    data: { datasets: [{ data, backgroundColor: 'rgba(99,102,241,0.6)', pointRadius: 5, pointHoverRadius: 7 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: {
          label: c => `${c.raw.label} — ${secToPace(c.raw.x)}/km @ ${c.raw.y} bpm`
        }}
      },
      scales: {
        x: { title: { display: true, text: 'Allure (sec/km)', color: '#94a3b8', font: { size: 10 } },
          ticks: { callback: v => secToPace(v) }, grid: { color: '#e5e7eb' } },
        y: { title: { display: true, text: 'FC moy (bpm)', color: '#94a3b8', font: { size: 10 } },
          grid: { color: '#e5e7eb' } }
      }
    }
  });
}

/* ══════════════════════════════════════════════════════════
   RENDER : TRIMP & Monotonie
   ══════════════════════════════════════════════════════════ */
function renderRunTRIMP() {
  const el = document.getElementById('run-trimp');
  if (!el) return;
  const runs = getRuns().sort((a, b) => b.date.localeCompare(a.date));

  // TRIMP 7j et 28j
  const d7  = new Date(TODAY); d7.setDate(d7.getDate() - 7);
  const d28 = new Date(TODAY); d28.setDate(d28.getDate() - 28);
  const runs7  = runs.filter(r => new Date(r.date) >= d7);
  const runs28 = runs.filter(r => new Date(r.date) >= d28);

  const trimp7  = runs7.reduce((s, r) => s + computeTRIMP(r), 0);
  const trimp28 = runs28.reduce((s, r) => s + computeTRIMP(r), 0);

  // Charge journalière 7j → monotonie
  const loadMap7 = {};
  runs7.forEach(r => {
    const d = r.date.slice(0, 10);
    loadMap7[d] = (loadMap7[d] || 0) + (r.training_load || 0);
  });
  const loads7 = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(TODAY); d.setDate(d.getDate() - i);
    return loadMap7[d.toISOString().slice(0, 10)] || 0;
  });
  const mean7 = loads7.reduce((s, v) => s + v, 0) / 7;
  const std7  = Math.sqrt(loads7.reduce((s, v) => s + (v - mean7) ** 2, 0) / 7);
  const monotonie = std7 > 0 ? +(mean7 / std7).toFixed(2) : 0;
  const strain = +(trimp7 * monotonie).toFixed(0);

  const row = (label, val, unit = '', note = '') => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-top:1px solid var(--border);font-size:13px">
      <span style="color:var(--muted)">${label}</span>
      <span style="font-weight:600">${val}<span style="font-weight:400;font-size:11px;color:var(--muted)"> ${unit}</span></span>
      ${note ? `<span style="font-size:11px;color:var(--muted);margin-left:8px">${note}</span>` : ''}
    </div>`;

  const monoColor = monotonie < 1.5 ? '#22c55e' : monotonie < 2 ? '#f97316' : '#ef4444';
  const monoNote  = monotonie < 1.5 ? 'OK' : monotonie < 2 ? 'Surveillez' : 'Risque blessure';

  el.innerHTML =
    row('TRIMP 7 jours', trimp7, 'pts') +
    row('TRIMP 28 jours', trimp28, 'pts') +
    row('Charge moy / jour (7j)', mean7.toFixed(1), 'pts') +
    `<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-top:1px solid var(--border);font-size:13px">
      <span style="color:var(--muted)">Monotonie</span>
      <span style="font-weight:600;color:${monoColor}">${monotonie} <span style="font-size:11px;font-weight:400">(${monoNote})</span></span>
    </div>` +
    row('Strain (charge × monotonie)', strain, 'pts');
}

/* ══════════════════════════════════════════════════════════
   RENDER : Tableau des sorties
   ══════════════════════════════════════════════════════════ */
function renderRunTable() {
  const tbody = document.getElementById('run-table-body');
  if (!tbody) return;
  const runs = getRuns().sort((a, b) => b.date.localeCompare(a.date));

  if (!runs.length) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--muted);padding:20px">Aucune course ≥ 3 km</td></tr>';
    return;
  }

  tbody.innerHTML = runs.map(r => {
    const trimp = computeTRIMP(r);
    const vo2   = r.vo2max ? r.vo2max : '–';
    const date  = new Date(r.date + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: '2-digit' });
    return `<tr>
      <td>${date}</td>
      <td style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.name || '–'}</td>
      <td>${r.distance_km?.toFixed(1) || '–'} km</td>
      <td>${fmt_dur(r.duration_min)}</td>
      <td style="font-variant-numeric:tabular-nums">${r.pace_min_km || '–'}/km</td>
      <td>${r.hr_avg || '–'} bpm</td>
      <td>${vo2}</td>
      <td>${trimp}</td>
      <td>${Math.round(r.training_load || 0)}</td>
    </tr>`;
  }).join('');
}

/* ══════════════════════════════════════════════════════════
   ENTRY POINT
   ══════════════════════════════════════════════════════════ */
function renderRunning() {
  renderRunKPIs();
  renderRunFormChart();
  renderRunPronostics();
  renderRunPaces();
  renderRunVO2Chart();
  renderRunZonesChart();
  renderRunEfficiencyChart();
  renderRunTRIMP();
  renderRunTable();
}

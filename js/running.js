/* ══════════════════════════════════════════════════════════
   RUNNING ANALYSIS
   ══════════════════════════════════════════════════════════ */

const HR_REST  = 62;
const HR_MAX   = 177;
const MIN_DIST = 3;   // km

// Zones FC en % HRmax (Z1=49-58, Z2=58-69, Z3=69-80, Z4=80-90, Z5=90-100)
const HR_ZONES = [
  { z:1, label:'Z1 Récup',    pctMin:0.49, pctMax:0.58, color:'#94a3b8' },
  { z:2, label:'Z2 Endurance',pctMin:0.58, pctMax:0.69, color:'#22c55e' },
  { z:3, label:'Z3 Tempo',    pctMin:0.69, pctMax:0.80, color:'#3b82f6' },
  { z:4, label:'Z4 Seuil',    pctMin:0.80, pctMax:0.90, color:'#f97316' },
  { z:5, label:'Z5 VO2max',   pctMin:0.90, pctMax:1.00, color:'#ef4444' },
];

function hrZoneBounds(z) {
  const zone = HR_ZONES[z - 1];
  return { min: Math.round(zone.pctMin * HR_MAX), max: Math.round(zone.pctMax * HR_MAX) };
}

const runState = {
  period: '6m',
  year: new Date().getFullYear(),
};

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

/* ── TRIMP de Banister (zones FC calibrées) ── */
function computeTRIMP(run) {
  if (!run.hr_avg || !run.duration_min) return 0;
  const ratio = (run.hr_avg - HR_REST) / (HR_MAX - HR_REST);
  if (ratio <= 0) return 0;
  return Math.round(run.duration_min * ratio * 0.64 * Math.exp(1.92 * ratio));
}

// TRIMP théorique pour une session définie par zone, durée et % en zone
function trimpForSession(durationMin, zoneNum, pctInZone = 0.8) {
  const zone = HR_ZONES[zoneNum - 1];
  const hrAvg = Math.round(((zone.pctMin + zone.pctMax) / 2) * HR_MAX);
  const ratio  = (hrAvg - HR_REST) / (HR_MAX - HR_REST);
  const mainTrimp = durationMin * pctInZone * ratio * 0.64 * Math.exp(1.92 * ratio);
  // Échauffement/récup en Z2
  const warmRatio  = ((HR_ZONES[1].pctMin + HR_ZONES[1].pctMax) / 2 * HR_MAX - HR_REST) / (HR_MAX - HR_REST);
  const warmTrimp  = durationMin * (1 - pctInZone) * warmRatio * 0.64 * Math.exp(1.92 * warmRatio);
  return Math.round(mainTrimp + warmTrimp);
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
   RENDER : Plan de la semaine
   ══════════════════════════════════════════════════════════ */
function renderWeekPlan() {
  const el = document.getElementById('run-week-plan');
  if (!el) return;

  const p = generateWeekPlan();

  const WEEK_COLORS = { recovery:'#22c55e', normal:'#3b82f6', loading:'#f97316' };
  const WEEK_LABELS = { recovery:'Semaine de récupération', normal:'Semaine normale', loading:'Semaine de charge' };
  const weekColor   = WEEK_COLORS[p.weekType];
  const weekLabel   = WEEK_LABELS[p.weekType];

  const tsbArrow = p.endTSB > p.startTSB
    ? `<span style="color:#22c55e">▲ ${(p.endTSB - p.startTSB).toFixed(1)}</span>`
    : `<span style="color:#ef4444">▼ ${(p.endTSB - p.startTSB).toFixed(1)}</span>`;

  el.innerHTML = `
    <!-- En-tête -->
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap">
      <span style="background:${weekColor};color:#fff;font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;text-transform:uppercase;letter-spacing:.5px">${weekLabel}</span>
      <span style="font-size:12px;color:var(--muted)">${p.reason}</span>
    </div>

    <!-- Jours -->
    <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px;margin-bottom:16px">
      ${p.plan.map(s => `
        <div style="border:1.5px solid ${s.zone ? s.color : 'var(--border)'};border-radius:10px;padding:8px 4px;text-align:center;background:${s.zone ? s.color+'12' : 'var(--surface2)'}">
          <div style="font-size:10px;font-weight:700;color:var(--muted);margin-bottom:4px;text-transform:uppercase">${s.day}</div>
          <div style="font-size:20px;margin-bottom:4px">${s.icon}</div>
          <div style="font-size:10px;font-weight:600;color:${s.zone ? s.color : 'var(--muted)'};line-height:1.3">${s.label}</div>
          ${s.dur ? `<div style="font-size:10px;color:var(--muted);margin-top:3px">${s.dur} min</div>` : ''}
          ${s.trimp ? `<div style="font-size:9px;color:var(--muted)">TRIMP ${s.trimp}</div>` : ''}
        </div>`).join('')}
    </div>

    <!-- Détails des séances -->
    <div style="margin-bottom:14px">
      ${p.plan.filter(s=>s.zone).map(s=>`
        <div style="display:flex;align-items:flex-start;gap:10px;padding:8px 0;border-top:1px solid var(--border);font-size:12px">
          <span style="width:28px;text-align:center;font-size:15px;flex-shrink:0">${s.icon}</span>
          <div style="flex:1">
            <span style="font-weight:600">${s.day} — ${s.label}</span>
            <span style="color:var(--muted);margin-left:8px">${s.desc}</span>
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div style="font-variant-numeric:tabular-nums;font-weight:500">${s.pace}</div>
            <div style="font-size:10px;color:${s.color}">${HR_ZONES[s.zone-1]?.label||''} · ${hrZoneBounds(s.zone).min}–${hrZoneBounds(s.zone).max} bpm</div>
          </div>
        </div>`).join('')}
    </div>

    <!-- Simulation CTL/ATL + Stats -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div style="background:var(--surface2);border-radius:10px;padding:12px;font-size:12px">
        <div style="font-weight:600;margin-bottom:8px;font-size:11px;text-transform:uppercase;color:var(--muted);letter-spacing:.5px">Projection fin de semaine</div>
        <div style="display:flex;justify-content:space-between;margin-bottom:4px"><span>CTL</span><span>${p.startCTL} → <b>${p.endCTL}</b></span></div>
        <div style="display:flex;justify-content:space-between;margin-bottom:4px"><span>ATL</span><span>${p.startATL} → <b>${p.endATL}</b></span></div>
        <div style="display:flex;justify-content:space-between"><span>TSB</span><span>${p.startTSB} → <b>${p.endTSB}</b> ${tsbArrow}</span></div>
      </div>
      <div style="background:var(--surface2);border-radius:10px;padding:12px;font-size:12px">
        <div style="font-weight:600;margin-bottom:8px;font-size:11px;text-transform:uppercase;color:var(--muted);letter-spacing:.5px">Charge &amp; Polarisation</div>
        <div style="display:flex;justify-content:space-between;margin-bottom:4px"><span>TRIMP total</span><span><b>${p.totalTrimp}</b> pts</span></div>
        <div style="display:flex;justify-content:space-between;margin-bottom:4px"><span>Z1-Z2 (base)</span><span style="color:#22c55e"><b>${p.z12pct}%</b></span></div>
        <div style="display:flex;justify-content:space-between"><span>Z4-Z5 (qualité)</span><span style="color:#f97316"><b>${p.z45pct}%</b></span></div>
      </div>
    </div>

    <!-- Bases du calcul -->
    <div style="margin-top:10px;padding:8px 12px;background:var(--surface2);border-radius:8px;font-size:11px;color:var(--muted);display:flex;flex-wrap:wrap;gap:12px">
      <span>VDOT ${p.vdot}</span>
      <span>HRmax ${HR_MAX} bpm · FC repos ${HR_REST} bpm</span>
      ${p.lastHRV ? `<span>HRV ${p.lastHRV} ms</span>` : ''}
      ${p.lastBB  ? `<span>Battery ${p.lastBB}%</span>` : ''}
      <span>TSB cible fin semaine : ${p.tsbTarget}</span>
    </div>`;
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
   DIAGRAMME DE FORME (mixte : CTL/ATL + TRIMP + VO2max)
   ══════════════════════════════════════════════════════════ */
function renderFormeDiagram() {
  const DAYS = 180;

  // --- Charges toutes activités → CTL/ATL ---
  const loadMap = {};
  getAll().forEach(a => {
    const d = (a.date || '').slice(0, 10);
    if (d) loadMap[d] = (loadMap[d] || 0) + (a.training_load || 0);
  });

  // --- TRIMP & VO2max par jour (runs ≥ MIN_DIST) ---
  const trimpMap = {}, vo2Map = {};
  getRuns().forEach(r => {
    const d = r.date.slice(0, 10);
    trimpMap[d] = (trimpMap[d] || 0) + computeTRIMP(r);
    if (r.vo2max > 0) vo2Map[d] = r.vo2max;
  });

  // --- Build series ---
  const labels = [], ctlSeries = [], atlSeries = [], trimpSeries = [];
  const vo2PointSeries = [], vo2AvgSeries = [];
  let ctl = 0, atl = 0, lastVo2 = null;
  const vo2Window = [];

  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date(TODAY); d.setDate(d.getDate() - i);
    const iso = d.toISOString().slice(0, 10);
    const load = loadMap[iso] || 0;
    ctl = ctl + (load - ctl) / 42;
    atl = atl + (load - atl) / 7;

    labels.push(iso);
    ctlSeries.push(+ctl.toFixed(1));
    atlSeries.push(+atl.toFixed(1));
    trimpSeries.push(trimpMap[iso] || null);

    // VO2max: point uniquement les jours de course
    vo2PointSeries.push(vo2Map[iso] ?? null);

    // Moyenne mobile VO2max sur 28j (carry-forward si pas de mesure)
    if (vo2Map[iso]) lastVo2 = vo2Map[iso];
    vo2Window.push(lastVo2);
    if (vo2Window.length > 28) vo2Window.shift();
    const validVo2 = vo2Window.filter(v => v !== null);
    vo2AvgSeries.push(validVo2.length ? +(validVo2.reduce((s, v) => s + v, 0) / validVo2.length).toFixed(1) : null);
  }

  // --- Légende custom ---
  const legendEl = document.getElementById('forme-legend');
  if (legendEl) {
    legendEl.innerHTML = [
      ['#22c55e', 'Aptitude (CTL)'],
      ['#ef4444', 'Fatigue (ATL)'],
      ['rgba(59,130,246,0.7)', 'TRIMP'],
      ['#374151', 'VO2max'],
      ['#1a1a1a', 'Moy. VO2max'],
    ].map(([c, l]) => `<span style="display:flex;align-items:center;gap:4px">
      <span style="width:12px;height:3px;background:${c};border-radius:2px;display:inline-block"></span>${l}
    </span>`).join('');
  }

  // --- Échelles dynamiques ---
  const maxCTL   = Math.max(...ctlSeries, ...atlSeries, 1);
  const maxTrimp = Math.max(...trimpSeries.filter(v => v !== null), 1);
  const vo2Vals  = vo2AvgSeries.filter(v => v !== null);
  const vo2Min   = vo2Vals.length ? Math.floor(Math.min(...vo2Vals)) - 3 : 30;
  const vo2Max   = vo2Vals.length ? Math.ceil(Math.max(...vo2Vals))  + 3 : 55;

  // X labels : afficher 1 label sur ~20 pour lisibilité
  const xLabels = labels.map((iso, idx) => {
    if (idx % 20 !== 0) return '';
    return new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  });

  mkChart('chart-forme-diagram', {
    type: 'bar',
    data: {
      labels: xLabels,
      datasets: [
        {
          type: 'line', label: 'Aptitude (CTL)',
          data: ctlSeries,
          borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,0.25)',
          fill: true, tension: 0.4, pointRadius: 0, borderWidth: 2,
          yAxisID: 'yCTL', order: 3,
        },
        {
          type: 'line', label: 'Fatigue (ATL)',
          data: atlSeries,
          borderColor: '#ef4444', backgroundColor: 'transparent',
          fill: false, tension: 0.4, pointRadius: 0, borderWidth: 1.5,
          yAxisID: 'yCTL', order: 2,
        },
        {
          type: 'bar', label: 'TRIMP',
          data: trimpSeries,
          backgroundColor: 'rgba(59,130,246,0.55)',
          yAxisID: 'yTrimp', order: 4, barPercentage: 0.9,
        },
        {
          type: 'line', label: 'VO2max',
          data: vo2PointSeries,
          borderColor: 'transparent', backgroundColor: '#374151',
          fill: false, tension: 0, spanGaps: false,
          pointRadius: vo2PointSeries.map(v => v !== null ? 5 : 0),
          pointHoverRadius: 7, pointBackgroundColor: '#374151',
          yAxisID: 'yVo2', order: 1,
        },
        {
          type: 'line', label: 'Moy. VO2max',
          data: vo2AvgSeries,
          borderColor: '#111827', backgroundColor: 'transparent',
          fill: false, tension: 0.4, pointRadius: 0, borderWidth: 1.5,
          borderDash: [4, 3],
          yAxisID: 'yVo2', order: 0,
        },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => {
              const idx = items[0]?.dataIndex;
              return labels[idx] ? new Date(labels[idx] + 'T12:00:00')
                .toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
            },
            label: (c) => {
              if (c.dataset.label === 'Aptitude (CTL)')  return `CTL : ${c.raw} pts`;
              if (c.dataset.label === 'Fatigue (ATL)')   return `ATL : ${c.raw} pts`;
              if (c.dataset.label === 'TRIMP' && c.raw)          return `TRIMP : ${c.raw} pts`;
              if (c.dataset.label === 'Moy. VO2max' && c.raw)   return `VO2max moy : ${c.raw}`;
              if (c.dataset.label === 'VO2max' && c.raw !== null) return `VO2max : ${c.raw}`;
              return null;
            },
          }
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { maxRotation: 0, font: { size: 10 } },
        },
        yCTL: {
          type: 'linear', position: 'left',
          min: 0, max: Math.ceil(maxCTL * 1.3),
          grid: { color: 'rgba(0,0,0,0.06)' },
          title: { display: true, text: 'CTL / ATL (pts)', color: '#94a3b8', font: { size: 10 } },
          ticks: { font: { size: 10 } },
        },
        yTrimp: {
          type: 'linear', position: 'right',
          min: 0, max: Math.ceil(maxTrimp * 1.2),
          grid: { display: false },
          title: { display: true, text: 'TRIMP', color: '#3b82f6', font: { size: 10 } },
          ticks: { color: '#3b82f6', font: { size: 10 } },
        },
        yVo2: {
          type: 'linear', position: 'right',
          min: vo2Min, max: vo2Max,
          grid: { display: false },
          title: { display: true, text: 'VO2max', color: '#374151', font: { size: 10 } },
          ticks: { color: '#374151', font: { size: 10 } },
          offset: true,
        },
      },
    },
  });
}

/* ══════════════════════════════════════════════════════════
   GÉNÉRATEUR DE PLAN HEBDOMADAIRE
   ══════════════════════════════════════════════════════════ */

// Catalogue de sessions disponibles (TRIMP via trimpForSession)
function sessionCatalog(vdot) {
  const v = vdot || 43;
  const zones = computeTrainingPaces(v);
  const zPace = (name) => {
    const z = zones.find(z => z.label.startsWith(name));
    return z ? `${secToPace(z.fastSec)}–${secToPace(z.slowSec)}/km` : '';
  };
  return [
    { id:'rest',     label:'Repos',             icon:'😴', zone:0,  dur:0,   trimp:0,
      desc:'Récupération complète',              pace:'–',            color:'#94a3b8' },
    { id:'recov',    label:'Footing récupération', icon:'🚶', zone:1, dur:30,  trimp:trimpForSession(30,1,1),
      desc:'Footing très lent, jambes légères',  pace: zPace('Récup'), color:'#94a3b8' },
    { id:'easy',     label:'Endurance facile',   icon:'🏃', zone:2,  dur:45,  trimp:trimpForSession(45,2,0.85),
      desc:'Conversation possible tout le long', pace: zPace('Endur'), color:'#22c55e' },
    { id:'easy_long',label:'Sortie longue',       icon:'🏃', zone:2,  dur:65,  trimp:trimpForSession(65,2,0.85),
      desc:'Allure endurance, dernier tiers Z3', pace: zPace('Endur'), color:'#22c55e' },
    { id:'tempo',    label:'Tempo',               icon:'⚡', zone:3,  dur:45,  trimp:trimpForSession(45,3,0.55),
      desc:'15 min éch. + 20 min Z3 + 10 min retour', pace: zPace('Marat'), color:'#3b82f6' },
    { id:'threshold',label:'Seuil',               icon:'🔥', zone:4,  dur:50,  trimp:trimpForSession(50,4,0.45),
      desc:'15 min éch. + 3×8 min Z4 (2 min récup)', pace: zPace('Seuil'), color:'#f97316' },
    { id:'interval', label:'Fractionné',          icon:'💥', zone:5,  dur:55,  trimp:trimpForSession(55,5,0.35),
      desc:'15 min éch. + 6×3 min Z5 (90 s récup)', pace: zPace('Inter'), color:'#ef4444' },
  ];
}

function simulateCTL_ATL(ctl0, atl0, loads7) {
  let ctl = ctl0, atl = atl0;
  loads7.forEach(l => {
    ctl = ctl + (l - ctl) / 42;
    atl = atl + (l - atl) / 7;
  });
  return { ctl: +ctl.toFixed(1), atl: +atl.toFixed(1), tsb: +(ctl - atl).toFixed(1) };
}

function generateWeekPlan() {
  // ── État actuel ──────────────────────────────────────────
  const formCurve = computeRunForm();          // CTL/ATL running
  const allLoad   = {};
  getAll().forEach(a => {
    const d = (a.date||'').slice(0,10);
    if (d) allLoad[d] = (allLoad[d]||0) + (a.training_load||0);
  });
  let ctl=0, atl=0;
  for (let i=179; i>=0; i--) {
    const d = new Date(TODAY); d.setDate(d.getDate()-i);
    const iso = d.toISOString().slice(0,10);
    const l = allLoad[iso]||0;
    ctl = ctl + (l-ctl)/42;
    atl = atl + (l-atl)/7;
  }
  const tsb = ctl - atl;

  // ── Wellness récent ──────────────────────────────────────
  const well = state.wellness?.days || {};
  const wellDays = Object.values(well).sort((a,b) => b.date.localeCompare(a.date));
  const lastHRV  = wellDays.find(w => w.hrv_weekly_avg > 0)?.hrv_weekly_avg || null;
  const lastBB   = wellDays[0]?.body_battery_end || null;

  // ── VO2max courant ───────────────────────────────────────
  const runs = getRuns();
  const withVo2 = runs.filter(r=>r.vo2max>0).sort((a,b)=>b.date.localeCompare(a.date));
  const vdot = withVo2[0]?.vo2max || 43;

  // ── TRIMP 7 jours précédents ─────────────────────────────
  const prev7Trimp = runs
    .filter(r => { const d=new Date(r.date); const lim=new Date(TODAY); lim.setDate(lim.getDate()-7); return d>=lim; })
    .reduce((s,r) => s+computeTRIMP(r), 0);

  // ── Type de semaine ──────────────────────────────────────
  let weekType, tsbTarget, loadFactor, qualitySessions, reason;

  const fatigue = tsb < -20 ? 'high' : tsb < -10 ? 'medium' : 'low';
  const hrvLow  = lastHRV && lastHRV < 40;
  const bbLow   = lastBB  && lastBB  < 30;

  if (fatigue === 'high' || (fatigue === 'medium' && (hrvLow || bbLow))) {
    weekType       = 'recovery';
    tsbTarget      = -5;
    loadFactor     = 0.60;
    qualitySessions= 0;
    reason = `TSB ${tsb.toFixed(1)} (surcharge) ${hrvLow?'+ HRV basse':''} ${bbLow?'+ Battery faible':''}`.trim();
  } else if (fatigue === 'medium') {
    weekType       = 'normal';
    tsbTarget      = -15;
    loadFactor     = 1.05;
    qualitySessions= 1;
    reason = `TSB ${tsb.toFixed(1)} — progression modérée`;
  } else {
    weekType       = 'loading';
    tsbTarget      = -20;
    loadFactor     = 1.10;
    qualitySessions= 2;
    reason = `TSB ${tsb.toFixed(1)} — semaine de charge`;
  }

  // ── Catalogue de sessions ────────────────────────────────
  const cat = sessionCatalog(vdot);
  const S   = (id) => cat.find(s=>s.id===id);

  // ── Construction du plan 7 jours ─────────────────────────
  // Modèle polarisé : 80% Z1-Z2 / 20% Z4-Z5
  // Structure type : repos / easy / repos / qualité / repos / long / repos
  let plan;
  if (weekType === 'recovery') {
    plan = [
      { day:'Lun', ...S('rest')     },
      { day:'Mar', ...S('recov')    },
      { day:'Mer', ...S('rest')     },
      { day:'Jeu', ...S('easy')     },
      { day:'Ven', ...S('rest')     },
      { day:'Sam', ...S('easy')     },
      { day:'Dim', ...S('rest')     },
    ];
  } else if (weekType === 'normal') {
    plan = [
      { day:'Lun', ...S('rest')      },
      { day:'Mar', ...S('easy')      },
      { day:'Mer', ...S('tempo')     },
      { day:'Jeu', ...S('rest')      },
      { day:'Ven', ...S('easy')      },
      { day:'Sam', ...S('easy_long') },
      { day:'Dim', ...S('rest')      },
    ];
  } else {
    plan = [
      { day:'Lun', ...S('rest')      },
      { day:'Mar', ...S('easy')      },
      { day:'Mer', ...S('threshold') },
      { day:'Jeu', ...S('easy')      },
      { day:'Ven', ...S('rest')      },
      { day:'Sam', ...S('easy_long') },
      { day:'Dim', ...S('interval')  },
    ];
  }

  // ── Simulation CTL/ATL sur la semaine ────────────────────
  const weekLoads = plan.map(s => s.trimp || 0);
  const endState  = simulateCTL_ATL(ctl, atl, weekLoads);

  // ── Distribution des zones (80/20) ──────────────────────
  const totalTrimp = weekLoads.reduce((s,v)=>s+v, 0);
  const zDist = plan.reduce((acc, s) => {
    if (!s.zone) return acc;
    acc[s.zone] = (acc[s.zone]||0) + s.trimp;
    return acc;
  }, {});
  const z12pct = Math.round(((zDist[1]||0)+(zDist[2]||0)) / Math.max(totalTrimp,1) * 100);
  const z45pct = Math.round(((zDist[4]||0)+(zDist[5]||0)) / Math.max(totalTrimp,1) * 100);

  return {
    weekType, reason, tsbTarget,
    plan,
    startCTL: +ctl.toFixed(1), startATL: +atl.toFixed(1), startTSB: +tsb.toFixed(1),
    endCTL: endState.ctl, endATL: endState.atl, endTSB: endState.tsb,
    totalTrimp, z12pct, z45pct, vdot,
    lastHRV, lastBB,
  };
}

/* ══════════════════════════════════════════════════════════
   CLASSIFICATION DES TYPES DE COURSES
   ══════════════════════════════════════════════════════════ */
function classifyRun(r) {
  const lbl  = r.te_label || '';
  const ate  = r.aerobic_te   || 0;
  const ante = r.anaerobic_te || 0;
  const dist = r.distance_km  || 0;

  if (lbl === 'Vo2Max'            || ante >= 1.5)  return 'Interval Training';
  if (lbl === 'Lactate Threshold' || ate  >= 4.2)  return 'Tempo Run';
  if (lbl === 'Tempo'             || ate  >= 3.5)  return 'Tempo Run';
  if (dist >= 12)                                  return 'Long Run';
  if (lbl === 'Aerobic Base'      || ate  >= 2.8)  return 'Easy Run';
  if (ate < 2.0)                                   return 'Récupération';
  return 'Easy Run';
}

/* ══════════════════════════════════════════════════════════
   FILTRES : période & année
   ══════════════════════════════════════════════════════════ */
function setRunPeriod(p) {
  runState.period = p;
  document.querySelectorAll('[data-rperiod]').forEach(b =>
    b.classList.toggle('active', b.dataset.rperiod === p));
  renderRunStatsTable();
}

function setRunYear(delta) {
  runState.year += delta;
  document.getElementById('run-year-label').textContent = runState.year;
  renderRunTypesGrid();
}

function getRunsForPeriod() {
  const runs = getRuns();
  if (runState.period === 'all') return runs;
  const months = runState.period === '3m' ? 3 : runState.period === '6m' ? 6 : 12;
  const cutoff = new Date(TODAY);
  cutoff.setMonth(cutoff.getMonth() - months);
  return runs.filter(r => new Date(r.date) >= cutoff);
}

/* ══════════════════════════════════════════════════════════
   STATISTIQUES MENSUELLES
   ══════════════════════════════════════════════════════════ */
function renderRunStatsTable() {
  const tbody = document.getElementById('run-stats-body');
  if (!tbody) return;

  const runs = getRunsForPeriod();

  // Grouper par mois YYYY-MM
  const byMonth = {};
  runs.forEach(r => {
    const key = r.date.slice(0, 7);
    if (!byMonth[key]) byMonth[key] = [];
    byMonth[key].push(r);
  });

  // Générer tous les mois dans la période (même vides)
  const months = [];
  const end   = new Date(TODAY);
  const start = new Date(TODAY);
  const nMonths = runState.period === '3m' ? 3 : runState.period === '6m' ? 6 : runState.period === '1y' ? 12 : 24;
  start.setMonth(start.getMonth() - nMonths + 1);
  start.setDate(1);
  const cur = new Date(start);
  while (cur <= end) {
    const key = cur.toISOString().slice(0, 7);
    months.push(key);
    cur.setMonth(cur.getMonth() + 1);
  }

  const MOIS_FR = ['Jan','Fév','Mar','Avr','Mai','Juin','Juil','Août','Sep','Oct','Nov','Déc'];

  tbody.innerHTML = months.reverse().map(key => {
    const [y, m] = key.split('-');
    const label  = `${MOIS_FR[+m - 1]} ${y}`;
    const rs     = byMonth[key] || [];

    if (!rs.length) {
      return `<tr><td style="color:var(--accent);font-weight:500">${label}</td>
        <td colspan="7" style="color:var(--muted);font-style:italic">Pas d'activités</td></tr>`;
    }

    const n    = rs.length;
    const dist = rs.reduce((s, r) => s + (r.distance_km || 0), 0);
    const dur  = rs.reduce((s, r) => s + (r.duration_min || 0), 0);
    const elev = rs.reduce((s, r) => s + (r.elevation_m || 0), 0);
    const trimp= rs.reduce((s, r) => s + computeTRIMP(r), 0);
    const hrAvg= rs.filter(r => r.hr_avg).reduce((s, r) => s + r.hr_avg, 0) / (rs.filter(r => r.hr_avg).length || 1);

    // Allure moyenne pondérée par distance
    const paceRuns = rs.filter(r => r.pace_min_km && r.distance_km);
    let avgPace = '–';
    if (paceRuns.length) {
      const totalDist = paceRuns.reduce((s, r) => s + r.distance_km, 0);
      const totalSec  = paceRuns.reduce((s, r) => s + paceToSec(r.pace_min_km) * r.distance_km, 0);
      avgPace = secToPace(totalSec / totalDist);
    }

    const h = Math.floor(dur / 60), mn = Math.round(dur % 60);
    const durStr = h > 0 ? `${h}h${mn.toString().padStart(2,'0')}` : `${mn} min`;

    return `<tr>
      <td style="color:var(--accent);font-weight:500">${label}</td>
      <td>${n}×</td>
      <td>${dist.toFixed(1)} km</td>
      <td>${durStr}</td>
      <td style="font-variant-numeric:tabular-nums">${avgPace}/km</td>
      <td>${hrAvg > 0 ? Math.round(hrAvg) + ' bpm' : '–'}</td>
      <td>${elev > 0 ? '+' + Math.round(elev) + ' m' : '–'}</td>
      <td style="font-weight:600;color:#3b82f6">${trimp}</td>
    </tr>`;
  }).join('');
}

/* ══════════════════════════════════════════════════════════
   GRILLE TYPES DE COURSES PAR MOIS
   ══════════════════════════════════════════════════════════ */
function renderRunTypesGrid() {
  const el = document.getElementById('run-types-grid');
  if (!el) return;

  const yr   = runState.year;
  const runs = getRuns().filter(r => r.date.startsWith(String(yr)));

  const TYPES = ['Easy Run', 'Tempo Run', 'Interval Training', 'Long Run', 'Récupération'];
  const MOIS  = ['Jan','Fév','Mar','Avr','Mai','Juin','Juil','Août','Sep','Oct','Nov','Déc'];

  // Grouper par type × mois
  const grid = {}; // grid[type][month_idx] = { count, dur_min }
  TYPES.forEach(t => { grid[t] = Array.from({length:12}, () => ({ count:0, dur:0 })); });
  const totalByMonth = Array.from({length:12}, () => ({ count:0, dur:0 }));

  runs.forEach(r => {
    const t   = classifyRun(r);
    const mi  = +r.date.slice(5, 7) - 1;
    if (!grid[t]) grid[t] = Array.from({length:12}, () => ({ count:0, dur:0 }));
    grid[t][mi].count++;
    grid[t][mi].dur += r.duration_min || 0;
    totalByMonth[mi].count++;
    totalByMonth[mi].dur += r.duration_min || 0;
  });

  // Totaux par type
  const typeTotal = {};
  TYPES.forEach(t => {
    typeTotal[t] = grid[t].reduce((s, v) => ({ count: s.count+v.count, dur: s.dur+v.dur }), {count:0,dur:0});
  });

  const maxDur = Math.max(...TYPES.map(t => typeTotal[t].dur), 1);

  const fmtDur = (min) => {
    if (!min) return '–';
    const h = Math.floor(min / 60), m = Math.round(min % 60);
    return h > 0 ? `${h}h${m.toString().padStart(2,'0')}` : `${m}m`;
  };

  const cell = (v) => {
    if (!v.count) return `<td style="padding:8px 10px;color:var(--muted);font-size:12px;text-align:center">–</td>`;
    const pct = (v.dur / Math.max(typeTotal[TYPES.find(t=>true)].dur || 1, 1) * 100);
    return `<td style="padding:8px 10px;text-align:center">
      <div style="font-size:12px;font-weight:500">${v.count}×</div>
      <div style="font-size:11px;color:var(--muted)">${fmtDur(v.dur)}</div>
    </td>`;
  };

  // Couleur par type
  const TYPE_COLORS = {
    'Easy Run':         '#22c55e',
    'Tempo Run':        '#f97316',
    'Interval Training':'#ef4444',
    'Long Run':         '#6366f1',
    'Récupération':     '#94a3b8',
  };

  el.innerHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:13px;min-width:600px">
      <thead>
        <tr style="border-bottom:2px solid var(--border)">
          <th style="padding:8px 16px;text-align:left;font-weight:500;color:var(--muted);width:150px">Type</th>
          ${MOIS.map(m => `<th style="padding:8px 6px;text-align:center;font-weight:500;color:var(--muted)">${m}</th>`).join('')}
          <th style="padding:8px 10px;text-align:center;font-weight:600">Total</th>
        </tr>
      </thead>
      <tbody>
        ${TYPES.map((t, ti) => {
          const tot = typeTotal[t];
          if (!tot.count) return '';
          const barW = Math.round((tot.dur / maxDur) * 100);
          return `<tr style="${ti % 2 === 1 ? 'background:var(--surface2)' : ''}">
            <td style="padding:10px 16px;font-weight:500">
              <div style="display:flex;align-items:center;gap:8px">
                <span style="width:8px;height:8px;border-radius:50%;background:${TYPE_COLORS[t]};flex-shrink:0"></span>
                ${t}
              </div>
              <div style="margin-top:4px;height:3px;background:var(--border);border-radius:2px;overflow:hidden">
                <div style="height:100%;width:${barW}%;background:${TYPE_COLORS[t]};border-radius:2px"></div>
              </div>
            </td>
            ${grid[t].map(v => cell(v)).join('')}
            <td style="padding:8px 10px;text-align:center;font-weight:600">
              <div>${tot.count}×</div>
              <div style="font-size:11px;color:var(--muted)">${fmtDur(tot.dur)}</div>
            </td>
          </tr>`;
        }).join('')}
        <tr style="border-top:2px solid var(--border);background:var(--surface2)">
          <td style="padding:10px 16px;font-weight:700">Total</td>
          ${totalByMonth.map(v => `<td style="padding:8px 10px;text-align:center">
            ${v.count ? `<div style="font-size:12px;font-weight:600">${v.count}×</div><div style="font-size:11px;color:var(--muted)">${fmtDur(v.dur)}</div>` : '<span style="color:var(--muted)">–</span>'}
          </td>`).join('')}
          <td style="padding:8px 10px;text-align:center;font-weight:700">
            <div>${runs.length}×</div>
            <div style="font-size:11px;color:var(--muted)">${fmtDur(runs.reduce((s,r)=>s+(r.duration_min||0),0))}</div>
          </td>
        </tr>
      </tbody>
    </table>`;
}

/* ══════════════════════════════════════════════════════════
   ENTRY POINT
   ══════════════════════════════════════════════════════════ */
function renderRunning() {
  renderRunKPIs();
  renderWeekPlan();
  renderRunFormChart();
  renderRunPronostics();
  renderRunPaces();
  renderRunVO2Chart();
  renderRunZonesChart();
  renderRunEfficiencyChart();
  renderRunTRIMP();
  renderRunStatsTable();
  // Init année + grille types
  const yearEl = document.getElementById('run-year-label');
  if (yearEl) yearEl.textContent = runState.year;
  renderRunTypesGrid();
  renderRunTable();
}

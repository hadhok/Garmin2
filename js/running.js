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
  globalPeriod: '6m',
  calendarMonth: new Date().getMonth(),
  calendarYear: new Date().getFullYear(),
  sortCol: 'date',
  sortDir: -1,
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
    </div>

    <div style="margin-top:14px;text-align:right">
      <button class="btn-garmin-push" onclick="pushPlanToGarmin(this)">
        📤 Envoyer vers Garmin Connect
      </button>
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

  const tsbStatus = last.tsb > 5 ? 'Très frais — charge insuffisante' :
                    last.tsb >= -5 ? 'Équilibré — prêt à performer' :
                    last.tsb >= -10 ? 'Légèrement fatigué — progression active' :
                    last.tsb >= -20 ? 'Zone de surcompensation — progression optimale' :
                    'Surcharge — récupération nécessaire';

  // Niveaux CTL (endurance de fond)
  const ctlLevel = last.ctl < 10  ? { label: 'Très faible',   color: '#94a3b8', bg: 'rgba(148,163,184,0.15)' } :
                   last.ctl < 20  ? { label: 'Faible',         color: '#6b7280', bg: 'rgba(107,114,128,0.12)' } :
                   last.ctl < 35  ? { label: 'Correct',        color: '#22c55e', bg: 'rgba(34,197,94,0.12)'   } :
                   last.ctl < 50  ? { label: 'Bonne base',     color: '#3b82f6', bg: 'rgba(59,130,246,0.12)'  } :
                   last.ctl < 65  ? { label: 'Très bon',       color: '#f97316', bg: 'rgba(249,115,22,0.12)'  } :
                                    { label: 'Excellent',       color: '#ef4444', bg: 'rgba(239,68,68,0.12)'   };

  // Niveaux ATL (charge de la semaine)
  const atlLevel = last.atl < 10 ? { label: 'Faible charge',   color: '#22c55e', bg: 'rgba(34,197,94,0.12)'  } :
                   last.atl < 25 ? { label: 'Charge modérée',  color: '#3b82f6', bg: 'rgba(59,130,246,0.12)' } :
                   last.atl < 40 ? { label: 'Charge élevée',   color: '#f97316', bg: 'rgba(249,115,22,0.12)' } :
                                   { label: 'Surcharge',        color: '#ef4444', bg: 'rgba(239,68,68,0.12)'  };

  // Streak : semaines consécutives avec ≥1 course (en remontant depuis aujourd'hui)
  let streak = 0;
  {
    const runDates = new Set(runs.map(r => r.date.slice(0, 10)));
    for (let w = 0; w < 104; w++) {
      const monday = new Date(TODAY);
      monday.setDate(monday.getDate() - monday.getDay() + 1 - w * 7);
      let found = false;
      for (let d = 0; d < 7; d++) {
        const dd = new Date(monday);
        dd.setDate(dd.getDate() + d);
        if (runDates.has(dd.toISOString().slice(0, 10))) { found = true; break; }
      }
      if (!found) break;
      streak++;
    }
  }

  // Séances/semaine : moyenne sur les 12 dernières semaines
  let seancesPerWeek = 0;
  {
    const d12w = new Date(TODAY); d12w.setDate(d12w.getDate() - 84);
    const runs12w = runs.filter(r => new Date(r.date) >= d12w);
    seancesPerWeek = +(runs12w.length / 12).toFixed(1);
  }

  const cards = [
    { label: 'VO2max',
      val: vo2 ? `${vo2}<span class="kpi-unit"> ml/kg/min</span>` : '–',
      sub: vo2Delta !== null ? `<div class="kpi-delta ${vo2Delta >= 0 ? 'up' : 'down'}">${vo2Delta >= 0 ? '▲' : '▼'} ${Math.abs(vo2Delta)}</div>` : '',
      tip: `Consommation maximale d'oxygène mesurée par Garmin. Plus la valeur est élevée, meilleure est votre capacité aérobie. Le delta (▲▼) compare la dernière séance à la précédente.` },
    { label: 'Allure Marathon',
      val: marathonTime ? secToPace(marathonTime.paceSec) : '–',
      sub: '<div class="kpi-delta">estimé VDOT</div>',
      tip: `Allure marathon estimée par la méthode Jack Daniels (VDOT). Calculée depuis votre VO2max actuel. C'est une estimation théorique — les conditions réelles peuvent varier.` },
    { label: 'CTL run',
      val: kd(last.ctl.toFixed(1), ' pts'),
      sub: `<span class="kpi-level" style="color:${ctlLevel.color};background:${ctlLevel.bg}">${ctlLevel.label}</span>`,
      tip: `Endurance de fond (42 jours).\n• &lt; 10 : Très faible\n• 10–20 : Faible\n• 20–35 : Correct\n• 35–50 : Bonne base\n• 50–65 : Très bon\n• 65+ : Excellent\n\nActuellement : ${ctlLevel.label}` },
    { label: 'ATL run',
      val: kd(last.atl.toFixed(1), ' pts'),
      sub: `<span class="kpi-level" style="color:${atlLevel.color};background:${atlLevel.bg}">${atlLevel.label}</span>`,
      tip: `Charge de la semaine (7 jours).\n• &lt; 10 : Faible charge\n• 10–25 : Modérée\n• 25–40 : Élevée\n• 40+ : Surcharge\n\nActuellement : ${atlLevel.label}` },
    { label: 'TSB run',
      val: kd(last.tsb.toFixed(1), ' pts'),
      sub: `<div class="kpi-delta ${last.tsb >= -10 ? 'up' : 'down'}">${last.tsb >= 0 ? 'Frais' : 'Fatigué'}</div>`,
      tip: `Balance (Forme) = CTL − ATL. Positif → Frais. Négatif → Fatigué.\n• > +5 : trop frais, sous-charge\n• −5 à −10 : zone optimale de progression\n• < −20 : surcharge, risque blessure\n\nActuellement : ${tsbStatus}` },
    { label: 'Distance 7j',
      val: kd(dist7.toFixed(1), ' km'),
      sub: '',
      tip: `Distance totale parcourue en course à pied sur les 7 derniers jours (toutes courses ≥ ${MIN_DIST} km).` },
    { label: 'Streak',
      val: `${streak}<span class="kpi-unit"> sem.</span>`,
      sub: '',
      tip: `Nombre de semaines consécutives avec au moins une course, en comptant à rebours depuis aujourd'hui. Indique la régularité de l'entraînement.` },
    { label: 'Séances/sem',
      val: `${seancesPerWeek}<span class="kpi-unit">/sem</span>`,
      sub: '<div class="kpi-delta">12 dernières sem.</div>',
      tip: `Nombre moyen de courses par semaine calculé sur les 12 dernières semaines (84 jours). Mesure la fréquence d'entraînement récente.` },
  ];

  el.innerHTML = cards.map(k => `
    <div class="kpi-card" onclick="kpiTipToggle(this)">
      <div class="kpi-info-btn">i</div>
      <div class="kpi-tooltip">${k.tip.replace(/\n/g, '<br>')}</div>
      <div class="kpi-label">${k.label}</div>
      <div class="kpi-value">${k.val}</div>
      ${k.sub}
    </div>`).join('');
}

function kpiTipToggle(card) {
  // Sur mobile (no-hover) : toggle. Sur desktop le CSS :hover suffit.
  const isTouch = window.matchMedia('(hover: none)').matches;
  if (!isTouch) return;
  const isOpen = card.classList.contains('tip-open');
  document.querySelectorAll('.kpi-card.tip-open').forEach(c => c.classList.remove('tip-open'));
  if (!isOpen) card.classList.add('tip-open');
}

/* ══════════════════════════════════════════════════════════
   RENDER : Graphique CTL/ATL/TSB running
   ══════════════════════════════════════════════════════════ */
function renderRunFormChart() {
  const curve = computeRunForm();
  if (!curve.length) return;

  const labels   = curve.map(d => new Date(d.date + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }));
  const ctlVals  = curve.map(d => d.ctl);
  const atlVals  = curve.map(d => d.atl);
  const tsbVals  = curve.map(d => d.tsb);

  const maxCTLATL = Math.ceil(Math.max(...ctlVals, ...atlVals, 1) * 1.2);
  const tsbMin    = Math.floor(Math.min(...tsbVals, -5)  - 5);
  const tsbMax    = Math.ceil( Math.max(...tsbVals,  5)  + 5);

  mkChart('chart-run-form', {
    type: 'line',
    data: { labels, datasets: [
      { label: 'CTL', data: ctlVals,
        borderColor: '#6366f1', backgroundColor: 'rgba(99,102,241,0.06)',
        fill: true, tension: 0.4, pointRadius: 0, borderWidth: 2.5,
        yAxisID: 'yCTL' },
      { label: 'ATL', data: atlVals,
        borderColor: '#f97316', backgroundColor: 'transparent',
        fill: false, tension: 0.4, pointRadius: 0, borderWidth: 2,
        yAxisID: 'yCTL' },
      { label: 'TSB', data: tsbVals,
        borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,0.08)',
        fill: 'origin', tension: 0.4, pointRadius: 0, borderWidth: 2,
        borderDash: [5, 3], yAxisID: 'yTSB' },
    ]},
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: {
          label: c => {
            if (c.dataset.label === 'CTL') return `CTL (fitness) : ${c.raw} pts`;
            if (c.dataset.label === 'ATL') return `ATL (fatigue) : ${c.raw} pts`;
            if (c.dataset.label === 'TSB') {
              const status = c.raw > 0 ? 'Frais' : c.raw > -10 ? 'Optimal' : c.raw > -20 ? 'En charge' : 'Surcharge';
              return `TSB (forme) : ${c.raw} → ${status}`;
            }
          }
        }},
        annotation: { annotations: {
          zero:      { type:'line', yScaleID:'yTSB', yMin:0,   yMax:0,   borderColor:'rgba(0,0,0,0.25)', borderWidth:1.5 },
          surcharge: { type:'box',  yScaleID:'yTSB', yMin:tsbMin, yMax:-20, backgroundColor:'rgba(239,68,68,0.07)',  borderWidth:0 },
          charge:    { type:'box',  yScaleID:'yTSB', yMin:-20,    yMax:-10, backgroundColor:'rgba(249,115,22,0.07)', borderWidth:0 },
          optimal:   { type:'box',  yScaleID:'yTSB', yMin:-10,    yMax:0,   backgroundColor:'rgba(34,197,94,0.07)',  borderWidth:0 },
          frais:     { type:'box',  yScaleID:'yTSB', yMin:0,      yMax:tsbMax, backgroundColor:'rgba(99,102,241,0.05)', borderWidth:0 },
        }},
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 8, font: { size: 10 } } },
        yCTL: {
          type: 'linear', position: 'left',
          min: 0, max: maxCTLATL,
          grid: { color: 'rgba(0,0,0,0.06)' },
          title: { display: true, text: 'CTL / ATL (pts)', color: '#6366f1', font: { size: 10 } },
          ticks: { font: { size: 10 }, color: '#6366f1' },
        },
        yTSB: {
          type: 'linear', position: 'right',
          min: tsbMin, max: tsbMax,
          grid: { display: false },
          title: { display: true, text: 'TSB (forme)', color: '#22c55e', font: { size: 10 } },
          ticks: { font: { size: 10 }, color: '#22c55e',
            callback: v => v === 0 ? '0' : v > 0 ? `+${v}` : `${v}` },
        },
      },
    }
  });

  // ── Barre de référence CTL ──────────────────────────────────────────────────
  const scaleEl = document.getElementById('run-ctl-scale');
  if (!scaleEl) return;
  const lastCTL = ctlVals[ctlVals.length - 1] || 0;
  const ctlLevels = [
    { max: 20,  label: 'Débutant',      color: '#94a3b8' },
    { max: 40,  label: 'Régulier',      color: '#22c55e' },
    { max: 60,  label: 'Avancé',        color: '#3b82f6' },
    { max: 80,  label: 'Performant',    color: '#f97316' },
    { max: Infinity, label: 'Elite',   color: '#ef4444' },
  ];
  const currentLevel = ctlLevels.find(l => lastCTL < l.max);
  scaleEl.innerHTML = `
    <div style="margin-top:12px;padding:10px 14px;background:var(--surface2);border-radius:10px;font-size:12px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <span style="font-weight:600;color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.5px">Niveau CTL actuel</span>
        <span style="font-weight:700;color:${currentLevel.color}">${currentLevel.label} — ${lastCTL} pts</span>
      </div>
      <div style="display:flex;gap:2px;height:8px;border-radius:6px;overflow:hidden">
        ${ctlLevels.map((l, i) => {
          const prev = i > 0 ? ctlLevels[i-1].max : 0;
          const size = l.max === Infinity ? 20 : l.max - prev;
          const filled = lastCTL >= (l.max === Infinity ? prev : l.max);
          const partial = lastCTL >= prev && lastCTL < l.max;
          const pct = partial ? Math.round((lastCTL - prev) / size * 100) : 0;
          return `<div style="flex:${size === Infinity ? 1 : size};background:var(--border);border-radius:2px;overflow:hidden;position:relative">
            <div style="height:100%;width:${filled ? 100 : pct}%;background:${l.color};border-radius:2px"></div>
          </div>`;
        }).join('')}
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:4px;font-size:10px;color:var(--muted)">
        <span>0</span><span>20</span><span>40</span><span>60</span><span>80</span><span>100+</span>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px">
        ${ctlLevels.map(l => `<span style="font-size:10px;color:var(--muted)"><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${l.color};margin-right:3px"></span>${l.label}</span>`).join('')}
      </div>
    </div>`;
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
  const runs = getRunsForGlobalPeriod().filter(r => r.hr_zones_pct && r.duration_min);
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
  // Si pas assez de données sur la période, on élargit à tout l'historique
  let runs = getRunsForGlobalPeriod().filter(r => r.pace_min_km && r.hr_avg);
  let fallback = false;
  if (runs.length < 5) {
    runs = getRuns().filter(r => r.pace_min_km && r.hr_avg);
    fallback = true;
  }
  const efIndicator = document.getElementById('run-ef-indicator');
  if (runs.length < 3) {
    if (efIndicator) efIndicator.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:6px 0">Pas assez de données (min. 3 courses avec allure + FC)</div>';
    return;
  }

  const data = runs.map(r => ({
    x: paceToSec(r.pace_min_km),
    y: r.hr_avg,
    label: r.date,
    speed: r.distance_km && r.duration_min ? (r.distance_km / r.duration_min * 1000) : null,
  })).filter(p => p.x);

  // Régression linéaire simple
  const n = data.length;
  const sumX  = data.reduce((s, p) => s + p.x, 0);
  const sumY  = data.reduce((s, p) => s + p.y, 0);
  const sumXY = data.reduce((s, p) => s + p.x * p.y, 0);
  const sumX2 = data.reduce((s, p) => s + p.x * p.x, 0);
  const denom = n * sumX2 - sumX * sumX;
  const slope     = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
  const intercept = (sumY - slope * sumX) / n;
  const xMin = Math.min(...data.map(p => p.x));
  const xMax = Math.max(...data.map(p => p.x));
  const regrData = denom !== 0
    ? [{ x: xMin, y: slope * xMin + intercept }, { x: xMax, y: slope * xMax + intercept }]
    : [];

  mkChart('chart-run-efficiency', {
    type: 'scatter',
    data: {
      datasets: [
        { data, backgroundColor: 'rgba(99,102,241,0.6)', pointRadius: 5, pointHoverRadius: 7, label: 'Course' },
        { type: 'line', data: regrData, borderColor: 'rgba(239,68,68,0.8)', backgroundColor: 'transparent',
          borderWidth: 2, pointRadius: 0, label: 'Tendance', tension: 0 },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: {
          label: c => c.dataset.label === 'Course'
            ? `${c.raw.label} — ${secToPace(c.raw.x)}/km @ ${c.raw.y} bpm`
            : null
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

  // Efficience Factor = vitesse (m/min) / FC moy
  const efData = data.filter(p => p.speed && p.y > 0);
  const efIndicator = document.getElementById('run-ef-indicator');
  if (efIndicator && efData.length) {
    const efValues = efData.map(p => p.speed / p.y);
    const efAvg = efValues.reduce((s, v) => s + v, 0) / efValues.length;
    // Tendance : compare 1ère moitié vs 2ème moitié
    const half = Math.floor(efValues.length / 2);
    const efOld = half > 0 ? efValues.slice(0, half).reduce((s,v) => s+v, 0) / half : efAvg;
    const efNew = efValues.slice(half).reduce((s, v) => s + v, 0) / (efValues.length - half);
    const improving = efNew > efOld;
    efIndicator.innerHTML = `
      <div class="ef-indicator">
        <div>
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin-bottom:2px">Efficience Factor</div>
          <div class="ef-value">${efAvg.toFixed(3)}</div>
        </div>
        <div style="font-size:22px">${improving ? '↑' : '↓'}</div>
        <div style="font-size:11px;color:var(--muted)">${improving ? 'En amélioration' : 'En baisse'}<br>sur la période</div>
      </div>
      ${fallback ? '<div style="font-size:10px;color:var(--muted);margin-top:4px">* données élargies à tout l\'historique (période trop courte)</div>' : ''}`;
  }
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
const TYPE_COLORS_TABLE = {
  'Easy Run':         '#22c55e',
  'Tempo Run':        '#f97316',
  'Interval Training':'#ef4444',
  'Long Run':         '#6366f1',
  'Récupération':     '#94a3b8',
};

function sortRunTable(col) {
  if (runState.sortCol === col) {
    runState.sortDir *= -1;
  } else {
    runState.sortCol = col;
    runState.sortDir = -1;
  }
  // Update visual arrows
  document.querySelectorAll('.sort-arrow').forEach(el => el.textContent = '');
  const arrowEl = document.getElementById(`sort-${col}`);
  if (arrowEl) arrowEl.textContent = runState.sortDir === -1 ? '▼' : '▲';
  renderRunTable();
}

function renderRunTable() {
  const tbody = document.getElementById('run-table-body');
  if (!tbody) return;

  const col = runState.sortCol;
  const dir = runState.sortDir;

  const runs = getRuns().map(r => ({ ...r, _trimp: computeTRIMP(r) })).sort((a, b) => {
    let va, vb;
    if (col === 'date')          { va = a.date;              vb = b.date; }
    else if (col === 'distance_km')   { va = a.distance_km || 0;    vb = b.distance_km || 0; }
    else if (col === 'duration_min')  { va = a.duration_min || 0;   vb = b.duration_min || 0; }
    else if (col === 'pace_min_km')   { va = paceToSec(a.pace_min_km) || 9999; vb = paceToSec(b.pace_min_km) || 9999; }
    else if (col === 'hr_avg')        { va = a.hr_avg || 0;          vb = b.hr_avg || 0; }
    else if (col === 'vo2max')        { va = a.vo2max || 0;          vb = b.vo2max || 0; }
    else if (col === 'trimp')         { va = a._trimp;               vb = b._trimp; }
    else if (col === 'training_load') { va = a.training_load || 0;   vb = b.training_load || 0; }
    else { va = a.date; vb = b.date; }
    if (va < vb) return -dir;
    if (va > vb) return dir;
    return 0;
  });

  if (!runs.length) {
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;color:var(--muted);padding:20px">Aucune course ≥ 3 km</td></tr>';
    return;
  }

  tbody.innerHTML = runs.map(r => {
    const trimp = r._trimp;
    const vo2   = r.vo2max ? r.vo2max : '–';
    const date  = new Date(r.date + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: '2-digit' });
    const type  = classifyRun(r);
    const tcolor = TYPE_COLORS_TABLE[type] || '#94a3b8';
    return `<tr>
      <td>${date}</td>
      <td style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.name || '–'}</td>
      <td>${r.distance_km?.toFixed(1) || '–'} km</td>
      <td>${fmt_dur(r.duration_min)}</td>
      <td style="font-variant-numeric:tabular-nums">${r.pace_min_km || '–'}/km</td>
      <td>${r.hr_avg || '–'} bpm</td>
      <td><span style="font-size:11px;font-weight:600;color:${tcolor}">${type}</span></td>
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

/* Helper : runs filtrés selon la période globale */
function getRunsForGlobalPeriod() {
  const runs = getRuns();
  if (runState.globalPeriod === 'all') return runs;
  const months = runState.globalPeriod === '3m' ? 3 : runState.globalPeriod === '6m' ? 6 : 12;
  const cutoff = new Date(TODAY);
  cutoff.setMonth(cutoff.getMonth() - months);
  return runs.filter(r => new Date(r.date) >= cutoff);
}

function setGlobalPeriod(p) {
  runState.globalPeriod = p;
  document.querySelectorAll('[data-gperiod]').forEach(b =>
    b.classList.toggle('active', b.dataset.gperiod === p));
  renderRunning();
}

function toggleSection(header) {
  const body = header.nextElementSibling;
  if (!body || !body.classList.contains('section-body')) return;
  const isClosed = body.classList.toggle('closed');
  const chev = header.querySelector('.chev');
  if (chev) chev.style.transform = isClosed ? 'rotate(-90deg)' : '';
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
   RENDER : Personal Records
   ══════════════════════════════════════════════════════════ */
function renderRunPR() {
  const el = document.getElementById('run-prs');
  if (!el) return;
  const runs = getRuns();
  if (!runs.length) { el.innerHTML = '<p style="color:var(--muted);font-size:13px">Aucune donnée</p>'; return; }

  const categories = [
    { label: '3–5 km',  min: 3,  max: 5  },
    { label: '5–8 km',  min: 5,  max: 8  },
    { label: '8–14 km', min: 8,  max: 14 },
    { label: '14–22 km',min: 14, max: 22 },
    { label: '22 km+',  min: 22, max: Infinity },
  ];

  const prs = categories.map(cat => {
    const bucket = runs.filter(r =>
      r.distance_km >= cat.min && r.distance_km < cat.max && r.pace_min_km
    );
    if (!bucket.length) return null;
    // Meilleur = allure la plus rapide = sec/km le plus bas
    const best = bucket.reduce((best, r) => {
      const s = paceToSec(r.pace_min_km);
      return (s && s < (paceToSec(best.pace_min_km) || 9999)) ? r : best;
    }, bucket[0]);
    return { cat, run: best };
  }).filter(Boolean);

  if (!prs.length) { el.innerHTML = '<p style="color:var(--muted);font-size:13px">Pas encore de records calculables</p>'; return; }

  el.innerHTML = `<div class="pr-grid">${prs.map(({ cat, run }) => {
    const date = new Date(run.date + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: '2-digit' });
    return `<div class="pr-card">
      <div class="pr-badge">🏅</div>
      <div class="pr-category">${cat.label}</div>
      <div class="pr-pace">${run.pace_min_km}/km</div>
      <div class="pr-meta">
        ${run.distance_km?.toFixed(1)} km · ${date}<br>
        ${run.name ? `<span style="opacity:.7">${run.name}</span>` : ''}
      </div>
    </div>`;
  }).join('')}</div>`;
}

/* ══════════════════════════════════════════════════════════
   RENDER : Volume hebdomadaire (bar chart)
   ══════════════════════════════════════════════════════════ */
function renderRunVolumeChart() {
  const WEEKS = 16;
  const labels = [], volumes = [], colors = [];

  for (let w = WEEKS - 1; w >= 0; w--) {
    const monday = new Date(TODAY);
    // Aller au lundi de la semaine courante
    const dow = monday.getDay() === 0 ? 6 : monday.getDay() - 1;
    monday.setDate(monday.getDate() - dow - w * 7);
    const sunday = new Date(monday); sunday.setDate(sunday.getDate() + 6);

    const weekRuns = getRuns().filter(r => {
      const d = new Date(r.date);
      return d >= monday && d <= sunday;
    });
    const km = weekRuns.reduce((s, r) => s + (r.distance_km || 0), 0);

    labels.push(monday.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }));
    volumes.push(+km.toFixed(1));
    colors.push(km === 0 ? 'rgba(148,163,184,0.3)' : km < 30 ? '#22c55e' : km < 50 ? '#f97316' : '#ef4444');
  }

  mkChart('chart-run-volume', {
    type: 'bar',
    data: { labels, datasets: [{ data: volumes, backgroundColor: colors, borderRadius: 4 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => `${c.raw} km` } }
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 8, font: { size: 10 } } },
        y: { grid: { color: '#e5e7eb' }, ticks: { callback: v => v + ' km', font: { size: 10 } }, beginAtZero: true }
      }
    }
  });
}

/* ══════════════════════════════════════════════════════════
   RENDER : Tendance allure mensuelle
   ══════════════════════════════════════════════════════════ */
function renderRunPaceTrend() {
  const MONTHS = 12;
  const labels = [], paces = [];
  const MOIS_FR = ['Jan','Fév','Mar','Avr','Mai','Juin','Juil','Août','Sep','Oct','Nov','Déc'];

  for (let m = MONTHS - 1; m >= 0; m--) {
    const d = new Date(TODAY);
    d.setDate(1);
    d.setMonth(d.getMonth() - m);
    const key = d.toISOString().slice(0, 7);
    const monthRuns = getRuns().filter(r => r.date.startsWith(key) && r.pace_min_km && r.distance_km);

    labels.push(`${MOIS_FR[d.getMonth()]} ${String(d.getFullYear()).slice(-2)}`);
    if (monthRuns.length) {
      const totalDist = monthRuns.reduce((s, r) => s + r.distance_km, 0);
      const totalSec  = monthRuns.reduce((s, r) => s + paceToSec(r.pace_min_km) * r.distance_km, 0);
      paces.push(totalDist > 0 ? +(totalSec / totalDist).toFixed(1) : null);
    } else {
      paces.push(null);
    }
  }

  const validPaces = paces.filter(v => v !== null);
  if (validPaces.length < 2) return;

  // Couleur du point : vert si améliore (pace plus bas = plus rapide)
  const ptColors = paces.map((v, i) => {
    if (v === null) return 'transparent';
    const prev = paces.slice(0, i).reverse().find(x => x !== null);
    if (!prev) return '#6366f1';
    return v <= prev ? '#22c55e' : '#ef4444';
  });

  const minP = Math.min(...validPaces);
  const maxP = Math.max(...validPaces);

  mkChart('chart-run-pace-trend', {
    type: 'line',
    data: { labels, datasets: [{
      label: 'Allure moy.',
      data: paces,
      borderColor: '#6366f1',
      backgroundColor: 'rgba(99,102,241,0.1)',
      fill: true, tension: 0.4,
      pointRadius: paces.map(v => v !== null ? 5 : 0),
      pointBackgroundColor: ptColors,
      spanGaps: true, borderWidth: 2,
    }]},
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => c.raw !== null ? `${secToPace(c.raw)}/km` : '–' } }
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 6, font: { size: 10 } } },
        y: {
          grid: { color: '#e5e7eb' },
          reverse: true,
          min: Math.max(0, minP - 15),
          max: maxP + 15,
          ticks: { callback: v => secToPace(v), font: { size: 10 } },
          title: { display: true, text: 'Allure (min/km)', color: '#94a3b8', font: { size: 10 } }
        }
      }
    }
  });
}

/* ══════════════════════════════════════════════════════════
   RENDER : Calendrier visuel
   ══════════════════════════════════════════════════════════ */
function renderRunCalendar() {
  const el = document.getElementById('run-calendar');
  if (!el) return;

  const year  = runState.calendarYear;
  const month = runState.calendarMonth;

  // Indexer les courses par date
  const runsByDate = {};
  getRuns().forEach(r => {
    const key = r.date.slice(0, 10);
    if (!runsByDate[key]) runsByDate[key] = [];
    runsByDate[key].push(r);
  });

  const MOIS_FR = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
  const JOURS   = ['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'];

  // 1er jour du mois (ISO week : lundi=0)
  const firstDay = new Date(year, month, 1);
  const startDow = (firstDay.getDay() + 6) % 7; // lundi = 0
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  // Cellules (padding avant + jours du mois)
  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const TYPE_COLORS_CAL = {
    'Easy Run':         '#22c55e',
    'Tempo Run':        '#f97316',
    'Interval Training':'#ef4444',
    'Long Run':         '#6366f1',
    'Récupération':     '#94a3b8',
  };

  const cellsHtml = cells.map(d => {
    if (d === null) return `<div class="run-cal-day empty"></div>`;
    const iso = `${year}-${String(month + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const dayRuns = runsByDate[iso] || [];
    if (!dayRuns.length) {
      return `<div class="run-cal-day"><span class="run-cal-day-num">${d}</span></div>`;
    }
    // Prendre la course principale du jour
    const r = dayRuns[0];
    const type  = classifyRun(r);
    const color = TYPE_COLORS_CAL[type] || '#94a3b8';
    const tip   = `${d} — ${r.name || type}\\n${r.distance_km?.toFixed(1)} km · ${r.pace_min_km || '–'}/km`;
    const onclick = `openDetail && openDetail('${r.id}')`;
    return `<div class="run-cal-day has-run" style="background:${color}" data-tip="${tip}" onclick="${onclick}">
      <span class="run-cal-day-num">${d}</span>
    </div>`;
  }).join('');

  el.innerHTML = `
    <div class="run-cal-nav">
      <button onclick="changeCalMonth(-1)">‹</button>
      <span class="run-cal-title">${MOIS_FR[month]} ${year}</span>
      <button onclick="changeCalMonth(+1)">›</button>
    </div>
    <div class="run-cal-grid">
      ${JOURS.map(j => `<div class="run-cal-head">${j}</div>`).join('')}
      ${cellsHtml}
    </div>`;
}

function changeCalMonth(delta) {
  runState.calendarMonth += delta;
  if (runState.calendarMonth < 0)  { runState.calendarMonth = 11; runState.calendarYear--; }
  if (runState.calendarMonth > 11) { runState.calendarMonth = 0;  runState.calendarYear++; }
  renderRunCalendar();
}

/* ══════════════════════════════════════════════════════════
   API : Push plan → Garmin
   ══════════════════════════════════════════════════════════ */
async function pushPlanToGarmin(btn) {
  btn.disabled = true;
  btn.textContent = '⏳ Injection en cours…';
  try {
    const r = await fetch('/api/push-plan', { method: 'POST' });
    const d = await r.json();
    if (r.ok) {
      btn.textContent = `✅ ${d.pushed} séances injectées`;
    } else {
      btn.textContent = `❌ ${d.error}`;
      btn.disabled = false;
    }
  } catch(e) {
    btn.textContent = '❌ Erreur réseau';
    btn.disabled = false;
  }
}

/* ══════════════════════════════════════════════════════════
   ENTRY POINT
   ══════════════════════════════════════════════════════════ */
function renderRunning() {
  const safe = (fn) => { try { fn(); } catch(e) { console.error('[Running]', fn.name, e); } };
  safe(renderRunKPIs);
  safe(renderWeekPlan);
  safe(renderRunPR);
  safe(renderRunFormChart);
  safe(renderRunVolumeChart);
  safe(renderRunPronostics);
  safe(renderRunPaces);
  safe(renderRunVO2Chart);
  safe(renderRunZonesChart);
  safe(renderRunPaceTrend);
  safe(renderRunEfficiencyChart);
  safe(renderRunTRIMP);
  safe(renderRunStatsTable);
  const yearEl = document.getElementById('run-year-label');
  if (yearEl) yearEl.textContent = runState.year;
  safe(renderRunTypesGrid);
  safe(renderRunCalendar);
  safe(renderRunTable);
  const arrowEl = document.getElementById(`sort-${runState.sortCol}`);
  if (arrowEl) arrowEl.textContent = runState.sortDir === -1 ? '▼' : '▲';
}

/* ── Fermer les tooltips KPI en tapant en dehors (mobile) ── */
document.addEventListener('click', e => {
  if (!e.target.closest('.kpi-card')) {
    document.querySelectorAll('.kpi-card.tip-open').forEach(c => c.classList.remove('tip-open'));
  }
});

/* ══════════════════════════════════════════════════════════
   RUNNING ANALYSIS
   ══════════════════════════════════════════════════════════ */

let HR_REST  = parseInt(localStorage.getItem('hr_rest')  || '62');
let HR_MAX   = parseInt(localStorage.getItem('hr_max')   || '177');

function applyHRSettings() {
  HR_REST = parseInt(localStorage.getItem('hr_rest')  || '62');
  HR_MAX  = parseInt(localStorage.getItem('hr_max')   || '177');
}

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
  globalPeriod: '6m', // kept for legacy refs, driven by slicer
  periodFrom: null,   // ISO date string | null = earliest
  periodTo:   null,   // ISO date string | null = today
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

// TRIMP théorique pour une session définie par zone, durée et % en zone
// (computeTRIMP est global dans app.js — toutes activités avec FC)
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
   CTL / ATL / TSB — runs only (délègue à computeFormeCurve, source TRIMP)
   ══════════════════════════════════════════════════════════ */
function computeRunForm() {
  let days = 180;
  if (runState.periodFrom) {
    const from = new Date(runState.periodFrom + 'T12:00:00');
    const to   = runState.periodTo ? new Date(runState.periodTo + 'T12:00:00') : new Date(TODAY);
    days = Math.max(30, Math.ceil((to - from) / 86400000));
  }
  return computeFormeCurve(getRuns(), days);
}

/* ══════════════════════════════════════════════════════════
   CALCULATIONS — 9 métriques (VO2, Marathon Shape, ATL, CTL, TSB, A:C, Rest days, Monotony, Training Strain)
   ══════════════════════════════════════════════════════════ */
function computeCalculations() {
  try {
    const runs = getRuns();
    const form = computeRunForm();
    const lastForm = form?.[form.length - 1];

    if (!runs.length || !lastForm) return null;

  // Effective VO2max — moyenne des VO2max estimés par run
  const effectiveVO2max = (() => {
    const vo2Values = runs.map(r => r.vo2max).filter(v => v > 0);
    return vo2Values.length ? (vo2Values.reduce((s, v) => s + v, 0) / vo2Values.length).toFixed(1) : '–';
  })();

  // Marathon Shape — volume (km/sem × 2/3) + long runs (× 1/3) sur 6m
  const marathonShape = (() => {
    const sixMonthAgo = new Date(TODAY);
    sixMonthAgo.setMonth(sixMonthAgo.getMonth() - 6);
    const runsLast6m = runs.filter(r => new Date(r.start_time) >= sixMonthAgo);
    if (!runsLast6m.length) return '–';

    const weeks = Math.max(1, Math.ceil((TODAY - sixMonthAgo) / 604800000));
    const totalKm = runsLast6m.reduce((s, r) => s + (r.distance_km || 0), 0);
    const weeklyKmAvg = totalKm / weeks;

    const longRuns = runsLast6m
      .sort((a, b) => (b.distance_km || 0) - (a.distance_km || 0))
      .slice(0, Math.ceil(weeks * 0.2))
      .reduce((s, r) => s + (r.distance_km || 0), 0) / Math.max(1, Math.ceil(weeks * 0.2));

    const targetMarathonKm = 42.195;
    const shape = (weeklyKmAvg * 0.667 + longRuns * 0.333) / targetMarathonKm * 100;
    return Math.min(200, shape).toFixed(0);
  })();

  // Fatigue (ATL) et Fitness (CTL) — en % du max historique
  const atlCurrent = lastForm.atl || 0;
  const ctlCurrent = lastForm.ctl || 0;
  const allForm = computeFormeCurve(getRuns(), 365) || [];
  const atlValues = allForm.map(f => f.atl).filter(v => v > 0);
  const ctlValues = allForm.map(f => f.ctl).filter(v => v > 0);
  const maxAtl = atlValues.length ? Math.max(...atlValues) : 1;
  const maxCtl = ctlValues.length ? Math.max(...ctlValues) : 1;
  const atlPct = (atlCurrent / maxAtl * 100).toFixed(0);
  const ctlPct = (ctlCurrent / maxCtl * 100).toFixed(0);

  // Stress Balance (TSB)
  const tsbValue = (ctlCurrent - atlCurrent).toFixed(1);

  // Workload Ratio (A:C)
  const acRatio = ctlCurrent > 0 ? (atlCurrent / ctlCurrent).toFixed(2) : '–';

  // Rest days — jours pour atteindre TSB = 0 (ATL décroît de 1/7 par jour)
  const restDays = (() => {
    if (atlCurrent <= ctlCurrent) return '0';
    if (ctlCurrent === 0) return '–';
    const ln67 = Math.log(6/7);
    const days = Math.log(ctlCurrent / atlCurrent) / ln67;
    return Math.max(0, Math.ceil(days)).toString();
  })();

  // Monotony — variation du TRIMP sur 7 jours
  const monotony = (() => {
    const last7days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(TODAY);
      d.setDate(d.getDate() - i);
      const iso = localIso(d);
      const dayRuns = runs.filter(r => {
        const rDate = new Date(r.start_time);
        return localIso(rDate) === iso;
      });
      const trimp = dayRuns.reduce((s, r) => s + (computeTRIMP(r) || 0), 0);
      last7days.push(trimp);
    }

    const avg = last7days.reduce((s, v) => s + v, 0) / 7;
    if (avg === 0) return '–';
    const variance = last7days.reduce((s, v) => s + (v - avg) ** 2, 0) / 7;
    const stdDev = Math.sqrt(variance);
    const mono = avg / (stdDev + avg);
    return (mono * 100).toFixed(0);
  })();

  // Training Strain — sum(TRIMP) * Monotony / 0.5 sur 7 jours
  const trainingStrain = (() => {
    if (monotony === '–') return '–';
    const last7days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(TODAY);
      d.setDate(d.getDate() - i);
      const iso = localIso(d);
      const dayRuns = runs.filter(r => {
        const rDate = new Date(r.start_time);
        return localIso(rDate) === iso;
      });
      const trimp = dayRuns.reduce((s, r) => s + (computeTRIMP(r) || 0), 0);
      last7days.push(trimp);
    }
    const totalTrimp = last7days.reduce((s, v) => s + v, 0);
    const strain = totalTrimp * (parseInt(monotony) / 100) / 0.5;
    return strain.toFixed(0);
  })();

    return {
      effectiveVO2max,
      marathonShape,
      atl: atlPct,
      ctl: ctlPct,
      tsb: tsbValue,
      acRatio,
      restDays,
      monotony,
      trainingStrain
    };
  } catch (e) {
    console.error('[computeCalculations]', e);
    return null;
  }
}

function renderCalculations() {
  try {
    const target = document.getElementById('run-calculations');
    if (!target) return;

    const calc = computeCalculations();
    if (!calc) {
      target.innerHTML = '<div style="grid-column:1/-1;padding:12px;color:var(--muted);text-align:center">Pas assez de données</div>';
      return;
    }

  const metrics = [
    { key: 'effectiveVO2max', label: 'Effective VO2max', unit: 'ml/kg/min', value: calc.effectiveVO2max },
    { key: 'marathonShape', label: 'Marathon Shape', unit: '%', value: calc.marathonShape },
    { key: 'atl', label: 'Fatigue (ATL)', unit: '%', value: calc.atl },
    { key: 'ctl', label: 'Fitness (CTL)', unit: '%', value: calc.ctl },
    { key: 'tsb', label: 'Stress Balance (TSB)', unit: '', value: calc.tsb },
    { key: 'acRatio', label: 'Workload Ratio (A:C)', unit: '', value: calc.acRatio },
    { key: 'restDays', label: 'Rest days', unit: 'jours', value: calc.restDays },
    { key: 'monotony', label: 'Monotony', unit: '%', value: calc.monotony },
    { key: 'trainingStrain', label: 'Training strain', unit: '', value: calc.trainingStrain }
  ];

    target.innerHTML = metrics.map(m => `
      <div style="padding:12px;background:var(--card-bg);border-radius:var(--radius);border:1px solid var(--border)">
        <div style="font-size:11px;color:var(--muted);margin-bottom:6px">${m.label}</div>
        <div style="font-size:20px;font-weight:600;color:var(--text)">
          ${m.value}<span style="font-size:12px;color:var(--muted);margin-left:4px">${m.unit}</span>
        </div>
      </div>
    `).join('');
  } catch (e) {
    console.error('[renderCalculations]', e);
    const target = document.getElementById('run-calculations');
    if (target) target.innerHTML = '<div style="grid-column:1/-1;padding:12px;color:#ef4444">Erreur lors du calcul</div>';
  }
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
  const targets = ['run-week-plan', 'training-week-plan'].map(id => document.getElementById(id)).filter(Boolean);
  if (!targets.length) return;
  const el = targets[0]; // used for innerHTML build below

  const p = generateWeekPlan();

  // ── Dates réelles de la semaine courante ─────────────────────────────────
  const localIso = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const todayIso = localIso(TODAY);
  const dow = (TODAY.getDay() + 6) % 7; // 0=Lun … 6=Dim
  const monday = new Date(TODAY); monday.setDate(TODAY.getDate() - dow); monday.setHours(0,0,0,0);
  const DAY_OFFSETS = { 'Lun':0,'Mar':1,'Mer':2,'Jeu':3,'Ven':4,'Sam':5,'Dim':6 };

  // ── Courses réelles cette semaine ────────────────────────────────────────
  const weekRuns = getRuns().filter(r => {
    const d = new Date(r.date + 'T12:00:00');
    return d >= monday && d <= TODAY;
  });
  const runsByDate = {};
  weekRuns.forEach(r => { runsByDate[r.date] = (runsByDate[r.date] || []); runsByDate[r.date].push(r); });

  const WEEK_COLORS = { recovery:'#22c55e', normal:'#3b82f6', loading:'#f97316' };
  const WEEK_LABELS = { recovery:'Semaine de récupération', normal:'Semaine normale', loading:'Semaine de charge' };
  const weekColor   = WEEK_COLORS[p.weekType];
  const weekLabel   = WEEK_LABELS[p.weekType];

  // tsbArrow computed after Xplor augmentation below

  // ── Carte jour ───────────────────────────────────────────────────────────
  const dayCard = (s) => {
    const offset   = DAY_OFFSETS[s.day];
    const dayDate  = new Date(monday); dayDate.setDate(monday.getDate() + offset);
    const dateIso  = localIso(dayDate);
    const isPast   = dayDate <= TODAY;
    const isToday  = dateIso === todayIso;
    const actual   = runsByDate[dateIso] || [];
    const hasRun   = actual.length > 0;
    const planRest = !s.zone;

    // Statut
    let statusIcon, statusBg;
    if (!isPast) {
      statusIcon = ''; statusBg = 'transparent';
    } else if (planRest && !hasRun) {
      statusIcon = '✓'; statusBg = 'rgba(34,197,94,0.1)';
    } else if (planRest && hasRun) {
      statusIcon = '+'; statusBg = 'rgba(59,130,246,0.1)';
    } else if (!planRest && hasRun) {
      statusIcon = '✓'; statusBg = 'rgba(34,197,94,0.1)';
    } else {
      statusIcon = '✗'; statusBg = 'rgba(239,68,68,0.08)';
    }

    // Réalité
    let realityHtml = '';
    if (hasRun) {
      const r = actual[0];
      const dist = r.distance_km ? `${r.distance_km.toFixed(1)} km` : '';
      const pace = r.pace_min_km ? `· ${r.pace_min_km}/km` : '';
      const type = classifyRun(r);
      const typeShort = type === 'Easy Run' ? 'Easy' : type === 'Tempo Run' ? 'Tempo' : type === 'Interval Training' ? 'Interval' : type === 'Long Run' ? 'Long' : 'Récup';
      realityHtml = `
        <div style="margin-top:5px;padding-top:5px;border-top:1px dashed var(--border)">
          <div style="font-size:9px;font-weight:700;color:var(--muted);text-transform:uppercase;margin-bottom:2px">Réel</div>
          <div style="font-size:10px;font-weight:600;color:var(--text)">${typeShort}</div>
          <div style="font-size:9px;color:var(--muted)">${dist} ${pace}</div>
        </div>`;
    } else if (isPast && !planRest) {
      realityHtml = `
        <div style="margin-top:5px;padding-top:5px;border-top:1px dashed var(--border)">
          <div style="font-size:9px;color:var(--muted);font-style:italic">Non réalisé</div>
        </div>`;
    }

    const todayRing = isToday ? 'box-shadow:0 0 0 2px var(--accent);' : '';

    return `<div style="border:1.5px solid ${s.zone ? s.color : 'var(--border)'};border-radius:10px;padding:8px 4px;text-align:center;background:${statusBg || (s.zone ? s.color+'12' : 'var(--surface2)')};${todayRing}position:relative">
      ${statusIcon ? `<div style="position:absolute;top:3px;right:4px;font-size:9px;font-weight:700;color:${statusIcon==='✓'?'#22c55e':statusIcon==='✗'?'#ef4444':'#3b82f6'}">${statusIcon}</div>` : ''}
      <div style="font-size:10px;font-weight:700;color:var(--muted);margin-bottom:2px;text-transform:uppercase">${s.day}</div>
      <div style="font-size:18px;margin-bottom:2px">${s.icon}</div>
      <div style="font-size:10px;font-weight:600;color:${s.zone ? s.color : 'var(--muted)'};line-height:1.3">${s.label}</div>
      ${s.dur ? `<div style="font-size:9px;color:var(--muted);margin-top:2px">${s.dur}'</div>` : ''}
      ${realityHtml}
    </div>`;
  };

  // ── Séances Xplor pour la semaine ─────────────────────────────────────────
  const xplorSess = (typeof getXplorSessions === 'function') ? getXplorSessions() : [];
  const xplorTotal = xplorSess.filter(s => {
    const d = new Date(s.date + 'T12:00');
    return d >= monday && d <= new Date(monday.getTime() + 6*86400000);
  });
  const xplorLoadTotal = xplorTotal.reduce((sum, s) => sum + (s.estimated_load || 0), 0);
  const hasXplor       = xplorTotal.length > 0;
  const configured     = typeof isXplorConfigured === 'function' && isXplorConfigured();

  // ── TRIMP réel par jour (toutes activités Garmin) ────────────────────────
  const allTrimpMap = typeof buildTRIMPMap === 'function' ? buildTRIMPMap(getAll()) : {};

  // ── Xplor par jour ───────────────────────────────────────────────────────
  const xplorByDayIso = {};
  xplorTotal.forEach(s => {
    xplorByDayIso[s.date] = (xplorByDayIso[s.date] || 0) + (s.estimated_load || 0);
  });

  // ── CTL/ATL au début de la semaine (lundi matin) ─────────────────────────
  // On recalcule en TRIMP pour être cohérent avec les charges journalières
  let weekStartCTL = 0, weekStartATL = 0;
  for (let i = 270; i >= 1; i--) {
    const d = new Date(monday); d.setDate(monday.getDate() - i);
    const iso = localIso(d);
    const l = allTrimpMap[iso] || 0;
    weekStartCTL = weekStartCTL + (l - weekStartCTL) / 42;
    weekStartATL = weekStartATL + (l - weekStartATL) / 7;
  }
  weekStartCTL = +weekStartCTL.toFixed(1);
  weekStartATL = +weekStartATL.toFixed(1);

  // ── Charge par jour : réel (passé) + prévu (futur) ───────────────────────
  const todayMidnight = new Date(TODAY); todayMidnight.setHours(0, 0, 0, 0);
  let actualTrimpWeek = 0, plannedTrimpWeek = 0;
  const augmentedLoads = [0,1,2,3,4,5,6].map(offset => {
    const dayDate = new Date(monday); dayDate.setDate(monday.getDate() + offset);
    const dateIso = localIso(dayDate);
    const xplor   = xplorByDayIso[dateIso] || 0;
    if (dayDate <= todayMidnight) {
      // jour passé ou aujourd'hui : charge réelle toutes activités + Xplor
      const actual = (allTrimpMap[dateIso] || 0) + xplor;
      actualTrimpWeek += actual;
      return actual;
    } else {
      // jour futur : TRIMP planifié + Xplor
      const planDay = p.plan[offset];
      const planned = (planDay?.trimp || 0) + xplor;
      plannedTrimpWeek += planned;
      return planned;
    }
  });
  const endStateAug = simulateCTL_ATL(weekStartCTL, weekStartATL, augmentedLoads);

  const tsbArrowAug = endStateAug.tsb > (weekStartCTL - weekStartATL)
    ? `<span style="color:#22c55e">▲ ${(endStateAug.tsb - (weekStartCTL - weekStartATL)).toFixed(1)}</span>`
    : `<span style="color:#ef4444">▼ ${(endStateAug.tsb - (weekStartCTL - weekStartATL)).toFixed(1)}</span>`;

  // xplorDayPills() is defined in xplor.js — available at render time
  const _pills = typeof xplorDayPills === 'function' ? xplorDayPills : () => '';

  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap">
      <span style="background:${weekColor};color:#fff;font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;text-transform:uppercase;letter-spacing:.5px">${weekLabel}</span>
      <span style="font-size:12px;color:var(--muted)">${p.reason}</span>
      ${hasXplor ? `<span style="background:rgba(99,102,241,0.12);color:#6366f1;font-size:11px;font-weight:600;padding:3px 10px;border-radius:20px;border:1px solid rgba(99,102,241,0.25)">𝕏 ${xplorTotal.length} séance${xplorTotal.length>1?'s':''}</span>` : ''}
      <button onclick="showXplorSetup()"
        style="margin-left:auto;background:${configured?'none':'rgba(99,102,241,0.08)'};
               border:1px solid ${configured?'var(--border)':'rgba(99,102,241,0.4)'};
               border-radius:8px;padding:4px 10px;font-size:11px;
               color:${configured?'var(--muted)':'#6366f1'};cursor:pointer">
        ${configured ? '⚙ Xplor' : '+ Xplor Active'}
      </button>
    </div>
    <div class="xplor-status-banner" style="display:none;border-radius:8px;padding:8px 12px;font-size:12px;margin-bottom:12px"></div>

    <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px;margin-bottom:16px">
      ${p.plan.map(s => {
        const offset  = DAY_OFFSETS[s.day];
        const dayDate = new Date(monday); dayDate.setDate(monday.getDate() + offset);
        const dateIso = localIso(dayDate);
        return `<div>${dayCard(s)}${_pills(dateIso)}</div>`;
      }).join('')}
    </div>

    <!-- Légende -->
    <div style="display:flex;gap:14px;flex-wrap:wrap;font-size:11px;color:var(--muted);margin-bottom:14px">
      <span><span style="color:#22c55e;font-weight:700">✓</span> Réalisé / Repos respecté</span>
      <span><span style="color:#ef4444;font-weight:700">✗</span> Non réalisé</span>
      <span><span style="color:#3b82f6;font-weight:700">+</span> Bonus non planifié</span>
      ${hasXplor ? `<span><span style="color:#6366f1;font-weight:700">𝕏</span> Xplor Active</span>` : ''}
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

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div style="background:var(--surface2);border-radius:10px;padding:12px;font-size:12px">
        <div style="font-weight:600;margin-bottom:8px;font-size:11px;text-transform:uppercase;color:var(--muted);letter-spacing:.5px">Projection fin de semaine</div>
        <div style="display:flex;justify-content:space-between;margin-bottom:4px"><span>CTL (lun)</span><span>${weekStartCTL} → <b>${endStateAug.ctl}</b></span></div>
        <div style="display:flex;justify-content:space-between;margin-bottom:4px"><span>ATL (lun)</span><span>${weekStartATL} → <b>${endStateAug.atl}</b></span></div>
        <div style="display:flex;justify-content:space-between"><span>TSB</span><span>${+(weekStartCTL-weekStartATL).toFixed(1)} → <b>${endStateAug.tsb}</b> ${tsbArrowAug}</span></div>
      </div>
      <div style="background:var(--surface2);border-radius:10px;padding:12px;font-size:12px">
        <div style="font-weight:600;margin-bottom:8px;font-size:11px;text-transform:uppercase;color:var(--muted);letter-spacing:.5px">Charge totale semaine</div>
        <div style="display:flex;justify-content:space-between;margin-bottom:4px"><span>Réalisé (toutes act.)</span><span><b>${Math.round(actualTrimpWeek)}</b> pts</span></div>
        <div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="color:var(--muted)">Prévu restant</span><span style="color:var(--muted)"><b>${Math.round(plannedTrimpWeek)}</b> pts</span></div>
        ${hasXplor ? `<div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="color:#6366f1">+ Xplor Active</span><span style="color:#6366f1"><b>~${Math.round(xplorLoadTotal)}</b> pts</span></div>` : ''}
        <div style="display:flex;justify-content:space-between;border-top:1px solid var(--border);padding-top:4px;margin-top:4px"><span style="font-weight:600">Total semaine</span><span style="font-weight:600">~${Math.round(actualTrimpWeek + plannedTrimpWeek)} pts</span></div>
      </div>
    </div>

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

  // Sync to all target containers
  targets.forEach(t => { if (t !== el) t.innerHTML = el.innerHTML; });
}

/* ══════════════════════════════════════════════════════════
   RENDER : KPIs
   ══════════════════════════════════════════════════════════ */
function renderRunKPIs() {
  const runs = getRunsForGlobalPeriod();
  const el = document.getElementById('run-kpis');
  if (!el) return;

  if (!runs.length) {
    el.innerHTML = '<div class="kpi-card"><div class="kpi-label">Aucune course ≥ 3 km</div></div>';
    return;
  }

  // VO2max le plus récent — wellness (get_max_metrics) en priorité, activités en fallback
  const wellnessDays = state.wellness?.days || {};
  const vo2Points = [];
  runs.filter(r => r.vo2max > 0).forEach(r => vo2Points.push({ date: r.date, vo2max: r.vo2max }));
  Object.entries(wellnessDays).forEach(([date, day]) => { if (day.vo2max > 0) { const i = vo2Points.findIndex(p => p.date === date); if (i >= 0) vo2Points[i].vo2max = Math.max(vo2Points[i].vo2max, day.vo2max); else vo2Points.push({ date, vo2max: day.vo2max }); } });
  vo2Points.sort((a, b) => b.date.localeCompare(a.date));
  const vo2 = vo2Points[0]?.vo2max || null;
  const vo2Prev = vo2Points[1]?.vo2max || null;
  const vo2Delta = vo2 && vo2Prev ? +(vo2 - vo2Prev).toFixed(1) : null;

  // CTL/ATL/TSB running (dernière valeur)
  const form = computeRunForm();
  const last = form[form.length - 1] || { ctl: 0, atl: 0, tsb: 0 };

  // Distance 7j + calories + intensity OMS
  const d7 = new Date(TODAY); d7.setDate(d7.getDate() - 7);
  const runs7 = runs.filter(r => new Date(r.date) >= d7);
  const dist7  = runs7.reduce((s, r) => s + (r.distance_km || 0), 0);
  const kcal7  = runs7.reduce((s, r) => s + (r.calories || 0), 0);

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
        if (runDates.has(localIso(dd))) { found = true; break; }
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

  // ── Rich modal bodies ──────────────────────────────────────────────────────
  const vo2Body = `
    <h4>Définition</h4>
    <p>Le VO2max est le volume maximal d'oxygène (en ml) que votre corps peut consommer par minute et par kilo de poids. C'est le meilleur indicateur objectif de votre capacité cardiorespiratoire. Garmin l'estime automatiquement via la fréquence cardiaque et la vitesse de course.</p>
    <h4>Échelle de référence (coureurs)</h4>
    ${kpiScaleHtml([
      { range:'< 35',  label:'Très faible', color:'#94a3b8', active: vo2 !== null && vo2 < 35 },
      { range:'35–42', label:'Faible',      color:'#6b7280', active: vo2 !== null && vo2 >= 35 && vo2 < 42 },
      { range:'42–50', label:'Moyen',       color:'#22c55e', active: vo2 !== null && vo2 >= 42 && vo2 < 50 },
      { range:'50–58', label:'Bon',         color:'#3b82f6', active: vo2 !== null && vo2 >= 50 && vo2 < 58 },
      { range:'58–65', label:'Très bon',    color:'#f97316', active: vo2 !== null && vo2 >= 58 && vo2 < 65 },
      { range:'65+',   label:'Élite',       color:'#ef4444', active: vo2 !== null && vo2 >= 65 },
    ])}
    <p style="font-size:12px">▲▼ Le delta affiché sur la carte compare votre dernière course à la précédente.</p>`;

  const marathonBody = `
    <h4>Définition</h4>
    <p>Allure théorique au marathon estimée via la méthode <strong>Jack Daniels VDOT</strong>. À partir de votre VO2max, la formule calcule les allures cibles pour chaque distance standard. C'est une estimation — les conditions réelles (météo, dénivelé, fatigue) peuvent faire varier le résultat.</p>
    <h4>Repères d'allure marathon</h4>
    ${kpiScaleHtml([
      { range:'< 3h00',    label:'Élite / Compétition',  color:'#ef4444', active: marathonTime && marathonTime.paceSec < 256  },
      { range:'3h00–3h30', label:'Très performant',       color:'#f97316', active: marathonTime && marathonTime.paceSec >= 256  && marathonTime.paceSec < 298 },
      { range:'3h30–4h00', label:'Bon niveau',            color:'#3b82f6', active: marathonTime && marathonTime.paceSec >= 298  && marathonTime.paceSec < 341 },
      { range:'4h00–4h30', label:'Niveau intermédiaire',  color:'#22c55e', active: marathonTime && marathonTime.paceSec >= 341  && marathonTime.paceSec < 384 },
      { range:'4h30–5h30', label:'Finisher',              color:'#6b7280', active: marathonTime && marathonTime.paceSec >= 384  && marathonTime.paceSec < 469 },
      { range:'> 5h30',    label:'Marcheur / Débutant',   color:'#94a3b8', active: marathonTime && marathonTime.paceSec >= 469  },
    ])}
    <p style="font-size:12px">Calculé depuis votre VO2max Garmin via la table VDOT de Jack Daniels (Running Formula).</p>`;

  const ctlBody = `
    <h4>Définition</h4>
    <p>Le CTL (Chronic Training Load) représente votre <strong>endurance de fond</strong> : c'est la moyenne exponentielle du TRIMP sur les 42 derniers jours. Plus il est élevé, plus votre organisme est adapté à l'effort prolongé.</p>
    <h4>Niveaux CTL</h4>
    ${kpiScaleHtml([
      { range:'0–10',  label:'Très faible — débutant ou arrêt prolongé', color:'#94a3b8', active: last.ctl < 10 },
      { range:'10–20', label:'Faible — reprise ou entraînement léger',    color:'#6b7280', active: last.ctl >= 10 && last.ctl < 20 },
      { range:'20–35', label:'Correct — pratique régulière',              color:'#22c55e', active: last.ctl >= 20 && last.ctl < 35 },
      { range:'35–50', label:'Bonne base — coureur entraîné',             color:'#3b82f6', active: last.ctl >= 35 && last.ctl < 50 },
      { range:'50–65', label:'Très bon — préparation avancée',            color:'#f97316', active: last.ctl >= 50 && last.ctl < 65 },
      { range:'65+',   label:'Excellent — niveau compétition',            color:'#ef4444', active: last.ctl >= 65 },
    ])}
    <p style="font-size:12px">Calculé via le TRIMP de Banister (durée × intensité FC relative). Constante de décroissance : 42 jours.</p>`;

  const atlBody = `
    <h4>Définition</h4>
    <p>L'ATL (Acute Training Load) mesure votre <strong>charge de la semaine</strong> : moyenne exponentielle du TRIMP sur les 7 derniers jours. Il reflète la fatigue accumulée récemment. Un ATL élevé indique un bloc d'entraînement intense.</p>
    <h4>Niveaux ATL</h4>
    ${kpiScaleHtml([
      { range:'0–10',  label:'Faible charge — semaine légère ou récup',  color:'#22c55e', active: last.atl < 10 },
      { range:'10–25', label:'Charge modérée — entraînement équilibré',  color:'#3b82f6', active: last.atl >= 10 && last.atl < 25 },
      { range:'25–40', label:'Charge élevée — bloc intensif',            color:'#f97316', active: last.atl >= 25 && last.atl < 40 },
      { range:'40+',   label:'Surcharge — surveiller la récupération',   color:'#ef4444', active: last.atl >= 40 },
    ])}
    <p style="font-size:12px">Si l'ATL dépasse largement le CTL pendant plusieurs jours, le risque de blessure augmente.</p>`;

  const tsbSign = last.tsb >= 0 ? '+' : '';
  const tsbBody = `
    <h4>Définition</h4>
    <p>Le TSB (Training Stress Balance), ou <strong>forme du moment</strong>, est la différence CTL − ATL. Un TSB positif signifie que vous êtes reposé (sous-charge récente). Un TSB négatif indique de la fatigue accumulée — c'est normal en période d'entraînement.</p>
    <h4>Interprétation du TSB</h4>
    ${kpiScaleHtml([
      { range:'> +10', label:'Très frais — sous-charge, risque de désentraînement', color:'#94a3b8', active: last.tsb > 10 },
      { range:'+5/+10',label:'Frais — idéal avant compétition',                     color:'#3b82f6', active: last.tsb >= 5 && last.tsb <= 10 },
      { range:'-5/+5', label:'Équilibré — prêt à performer',                        color:'#22c55e', active: last.tsb > -5 && last.tsb < 5 },
      { range:'-10/−5',label:'Légèrement fatigué — progression active',             color:'#f97316', active: last.tsb >= -10 && last.tsb <= -5 },
      { range:'-20/−10',label:'Surcompensation — zone de progression optimale',     color:'#f97316', active: last.tsb >= -20 && last.tsb < -10 },
      { range:'< -20', label:'Surcharge — récupération nécessaire',                 color:'#ef4444', active: last.tsb < -20 },
    ])}
    <p style="font-size:12px">Actuellement : <strong>${tsbSign}${last.tsb.toFixed(1)} pts</strong> — ${tsbStatus}</p>`;

  const dist7Body = `
    <h4>Définition</h4>
    <p>Volume total de course sur les <strong>7 derniers jours glissants</strong> (toutes sorties ≥ ${MIN_DIST} km). C'est un indicateur simple de la charge hebdomadaire en kilomètres.</p>
    <h4>Repères de volume hebdomadaire</h4>
    ${kpiScaleHtml([
      { range:'< 15 km',  label:'Volume faible — entretien ou reprise', color:'#94a3b8', active: dist7 < 15 },
      { range:'15–30 km', label:'Volume modéré — pratique régulière',   color:'#22c55e', active: dist7 >= 15 && dist7 < 30 },
      { range:'30–50 km', label:'Volume élevé — entraînement soutenu',  color:'#3b82f6', active: dist7 >= 30 && dist7 < 50 },
      { range:'50–70 km', label:'Volume très élevé — prépa marathon',   color:'#f97316', active: dist7 >= 50 && dist7 < 70 },
      { range:'70+ km',   label:'Volume compétition / ultra',           color:'#ef4444', active: dist7 >= 70 },
    ])}`;

  const streakBody = `
    <h4>Définition</h4>
    <p>Nombre de <strong>semaines consécutives</strong> avec au moins une course ≥ ${MIN_DIST} km, en remontant depuis aujourd'hui. C'est le meilleur indicateur de régularité à long terme.</p>
    <h4>Interprétation du streak</h4>
    ${kpiScaleHtml([
      { range:'1–3 sem.',   label:'Démarrage — continuez !',            color:'#94a3b8', active: streak >= 1  && streak < 4  },
      { range:'4–8 sem.',   label:'Régularité en cours',                color:'#6b7280', active: streak >= 4  && streak < 9  },
      { range:'9–16 sem.',  label:'Bonne constance — 2+ mois',         color:'#22c55e', active: streak >= 9  && streak < 17 },
      { range:'17–26 sem.', label:'Très régulier — 4+ mois',           color:'#3b82f6', active: streak >= 17 && streak < 27 },
      { range:'27–52 sem.', label:'Remarquable — plus d\'un semestre', color:'#f97316', active: streak >= 27 && streak < 53 },
      { range:'52+ sem.',   label:'Légendaire — plus d\'un an !',      color:'#ef4444', active: streak >= 53 },
    ])}`;

  const freqBody = `
    <h4>Définition</h4>
    <p>Nombre moyen de courses par semaine calculé sur les <strong>12 dernières semaines</strong> (84 jours glissants). Mesure la fréquence d'entraînement récente indépendamment du volume.</p>
    <h4>Fréquence recommandée</h4>
    ${kpiScaleHtml([
      { range:'< 1 /sem',   label:'Occasionnel — < 1 sortie/semaine',    color:'#94a3b8', active: seancesPerWeek < 1   },
      { range:'1–2 /sem',   label:'Régulier — entretien forme',          color:'#6b7280', active: seancesPerWeek >= 1  && seancesPerWeek < 2   },
      { range:'2–3 /sem',   label:'Entraîné — progression possible',     color:'#22c55e', active: seancesPerWeek >= 2  && seancesPerWeek < 3   },
      { range:'3–5 /sem',   label:'Sérieux — plan structuré conseillé',  color:'#3b82f6', active: seancesPerWeek >= 3  && seancesPerWeek < 5   },
      { range:'5+ /sem',    label:'Compétition — surveiller récupération', color:'#f97316',active: seancesPerWeek >= 5   },
    ])}
    <p style="font-size:12px">Au-delà de 5 séances/semaine sans phases de récupération, le risque de blessure augmente significativement.</p>`;

  const caloriesBody = `
    <h4>Définition</h4>
    <p>Dépense calorique totale de vos <strong>courses à pied sur les 7 derniers jours</strong>. Garmin estime les calories brûlées en combinant votre fréquence cardiaque, votre poids et l'intensité de l'effort.</p>
    <h4>Repères de dépense hebdomadaire (running)</h4>
    ${kpiScaleHtml([
      { range:'< 500 kcal',    label:'Faible — 1 sortie légère',          color:'#94a3b8', active: kcal7 > 0   && kcal7 < 500  },
      { range:'500–1 200 kcal',label:'Modéré — 2–3 sorties régulières',   color:'#22c55e', active: kcal7 >= 500  && kcal7 < 1200 },
      { range:'1 200–2 500 kcal',label:'Élevé — entraînement structuré',  color:'#3b82f6', active: kcal7 >= 1200 && kcal7 < 2500 },
      { range:'2 500–4 000 kcal',label:'Très élevé — prépa marathon',     color:'#f97316', active: kcal7 >= 2500 && kcal7 < 4000 },
      { range:'4 000+ kcal',   label:'Compétition / trail longue distance',color:'#ef4444', active: kcal7 >= 4000 },
    ])}
    <p style="font-size:12px">Calories brûlées sur les courses ≥ ${MIN_DIST} km uniquement. Garmin tient compte de la FC et du poids corporel.</p>`;

  // ── Cards ──────────────────────────────────────────────────────────────────
  const cards = [
    { label: 'VO2max',
      val: vo2 ? `${vo2}<span class="kpi-unit"> ml/kg/min</span>` : '–',
      sub: vo2Delta !== null ? `<div class="kpi-delta ${vo2Delta >= 0 ? 'up' : 'down'}">${vo2Delta >= 0 ? '▲' : '▼'} ${Math.abs(vo2Delta)}</div>` : '',
      body: vo2Body },
    { label: 'Allure Marathon',
      val: marathonTime ? `${secToPace(marathonTime.paceSec)}<span class="kpi-unit"> /km</span>` : '–',
      sub: '<div class="kpi-delta">estimé VDOT</div>',
      body: marathonBody },
    { label: 'CTL run',
      val: kd(last.ctl.toFixed(1), ' pts'),
      sub: `<span class="kpi-level" style="color:${ctlLevel.color};background:${ctlLevel.bg}">${ctlLevel.label}</span>`,
      body: ctlBody },
    { label: 'ATL run',
      val: kd(last.atl.toFixed(1), ' pts'),
      sub: `<span class="kpi-level" style="color:${atlLevel.color};background:${atlLevel.bg}">${atlLevel.label}</span>`,
      body: atlBody },
    { label: 'TSB run',
      val: `${tsbSign}${kd(last.tsb.toFixed(1), ' pts')}`,
      sub: `<div class="kpi-delta ${last.tsb >= -10 ? 'up' : 'down'}">${last.tsb >= 0 ? 'Frais' : 'Fatigué'}</div>`,
      body: tsbBody },
    { label: 'Distance 7j',
      val: kd(dist7.toFixed(1), ' km'),
      sub: '',
      body: dist7Body },
    { label: 'Streak',
      val: `${streak}<span class="kpi-unit"> sem.</span>`,
      sub: '',
      body: streakBody },
    { label: 'Séances/sem',
      val: `${seancesPerWeek}<span class="kpi-unit">/sem</span>`,
      sub: '<div class="kpi-delta">12 dernières sem.</div>',
      body: freqBody },
    { label: 'Énergie 7j',
      val: kcal7 ? `${Math.round(kcal7).toLocaleString('fr-FR')}<span class="kpi-unit"> kcal</span>` : '–',
      sub: '',
      body: caloriesBody },
  ];

  // Stocker pour l'accès modal (évite les problèmes de quoting dans onclick)
  runState._kpiCards = cards;

  el.innerHTML = cards.map((k, i) => `
    <div class="kpi-card" onclick="openKpiModal(${i})">
      <div class="kpi-info-btn">i</div>
      <div class="kpi-label">${k.label}</div>
      <div class="kpi-value">${k.val}</div>
      ${k.sub}
    </div>`).join('');
}

/* ── KPI Modal helpers ── */
function kpiScaleHtml(rows) {
  return '<div class="modal-scale">' + rows.map(r => {
    const dot   = `<div class="modal-scale-dot" style="background:${r.color}"></div>`;
    const range = `<div class="modal-scale-range">${r.range}</div>`;
    const lbl   = `<div class="modal-scale-lbl" style="color:${r.active ? r.color : 'var(--text)'}">${r.label}</div>`;
    const you   = r.active ? '<div class="modal-scale-you">vous</div>' : '';
    return `<div class="modal-scale-row${r.active ? ' active' : ''}">${dot}${range}${lbl}${you}</div>`;
  }).join('') + '</div>';
}

function openKpiModal(idx) {
  const data = runState._kpiCards?.[idx];
  if (!data) return;
  const bg = document.getElementById('kpi-modal-bg');
  if (!bg) return;
  document.getElementById('kpi-modal-label').textContent = data.label;
  document.getElementById('kpi-modal-value').innerHTML   = data.val;
  document.getElementById('kpi-modal-body').innerHTML    = data.body;
  bg.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeKpiModal(event) {
  if (event && event.target !== document.getElementById('kpi-modal-bg')) return;
  const bg = document.getElementById('kpi-modal-bg');
  if (bg) bg.classList.remove('open');
  document.body.style.overflow = '';
}

/* ══════════════════════════════════════════════════════════
   RENDER : Graphique CTL/ATL/TSB running
   ══════════════════════════════════════════════════════════ */
function renderRunFormChart() {
  const curve = computeRunForm();
  if (!curve.length) return;

  const days = runState.globalPeriod === '3m' ? 90
             : runState.globalPeriod === '6m' ? 180
             : runState.globalPeriod === '1y' ? 365
             : 730;
  const allCurve = computeFormeCurve(getAll(), days);

  const labels   = curve.map(d => new Date(d.date + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }));
  const ctlVals  = curve.map(d => d.ctl);
  const atlVals  = curve.map(d => d.atl);
  const tsbVals  = curve.map(d => d.tsb);
  const allCtlVals = allCurve.map(d => d.ctl);

  const maxCTLATL = Math.ceil(Math.max(...ctlVals, ...atlVals, ...allCtlVals, 1) * 1.2);
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
      { label: 'CTL (tous sports)', data: allCtlVals,
        borderColor: 'rgba(99,102,241,0.35)', backgroundColor: 'transparent',
        fill: false, tension: 0.4, pointRadius: 0, borderWidth: 1.5,
        borderDash: [4, 3], yAxisID: 'yCTL' },
    ]},
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, labels: { boxWidth: 12, font: { size: 10 } } },
        tooltip: { callbacks: {
          label: c => {
            if (c.dataset.label === 'CTL') return `CTL (fitness) : ${c.raw} pts`;
            if (c.dataset.label === 'ATL') return `ATL (fatigue) : ${c.raw} pts`;
            if (c.dataset.label === 'TSB') {
              const status = c.raw > 0 ? 'Frais' : c.raw > -10 ? 'Optimal' : c.raw > -20 ? 'En charge' : 'Surcharge';
              return `TSB (forme) : ${c.raw} → ${status}`;
            }
            if (c.dataset.label === 'CTL (tous sports)') return `CTL tous sports : ${c.raw} pts`;
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
  // Source principale : wellness_days (données get_max_metrics, plus fréquentes)
  // Complément : activités (fallback si wellness vide)
  const wellnessDays = state.wellness?.days || {};
  const pointMap = {};

  // Depuis les activités
  getRuns().filter(r => r.vo2max > 0).forEach(r => { pointMap[r.date] = r.vo2max; });

  // Depuis wellness — garde le max si activité du même jour
  Object.entries(wellnessDays).forEach(([date, day]) => {
    if (day.vo2max > 0) pointMap[date] = pointMap[date] ? Math.max(pointMap[date], day.vo2max) : day.vo2max;
  });

  // Appliquer le filtre de période globale
  const months = runState.globalPeriod === '3m' ? 3 : runState.globalPeriod === '6m' ? 6 : runState.globalPeriod === '1y' ? 12 : null;
  const cutoff = months ? new Date(TODAY.getTime()) : null;
  if (cutoff) cutoff.setMonth(cutoff.getMonth() - months);

  const points = Object.entries(pointMap)
    .filter(([date]) => !cutoff || new Date(date + 'T12:00:00') >= cutoff)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, vo2max]) => ({ date, vo2max }));

  if (points.length < 2) return;

  const labels = points.map(p => new Date(p.date + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }));
  const values = points.map(p => p.vo2max);

  mkChart('chart-run-vo2', {
    type: 'line',
    data: { labels, datasets: [{
      label: 'VO2max', data: values,
      borderColor: '#8b5cf6', backgroundColor: 'rgba(139,92,246,0.1)',
      fill: true, tension: 0.4, pointRadius: 3, pointBackgroundColor: '#8b5cf6', borderWidth: 2,
    }]},
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `VO2max : ${c.raw} ml/kg/min` } } },
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 10 } },
        y: { grid: { color: '#e5e7eb' }, min: Math.max(0, Math.min(...values) - 3),
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

  /* Toutes activités avec FC — pas seulement les courses */
  const allActs = getAll().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const withHR  = allActs.filter(a => a.hr_avg && a.duration_min);
  const runs    = getRuns();

  const d7  = new Date(TODAY); d7.setDate(d7.getDate() - 7);
  const d28 = new Date(TODAY); d28.setDate(d28.getDate() - 28);

  const acts7  = withHR.filter(a => new Date(a.date) >= d7);
  const acts28 = withHR.filter(a => new Date(a.date) >= d28);
  const runs7  = runs.filter(r => new Date(r.date) >= d7);

  const trimp7All  = acts7.reduce((s, a) => s + computeTRIMP(a), 0);
  const trimp28All = acts28.reduce((s, a) => s + computeTRIMP(a), 0);
  const trimp7Run  = runs7.reduce((s, r) => s + computeTRIMP(r), 0);

  // Monotonie sur TRIMP toutes activités (7j)
  const trimpMap = buildTRIMPMap(allActs);
  const loads7 = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(TODAY); d.setDate(d.getDate() - i);
    return trimpMap[dateToISO(d)] || 0;
  });
  const mean7    = loads7.reduce((s, v) => s + v, 0) / 7;
  const std7     = Math.sqrt(loads7.reduce((s, v) => s + (v - mean7) ** 2, 0) / 7);
  // std7=0 + mean7>0 = charge parfaitement uniforme = monotonie maximale (risque)
  // std7=0 + mean7=0 = aucune activité
  const monotonie = std7 > 0 ? +(mean7 / std7).toFixed(2) : (mean7 > 0 ? 99 : 0);
  const strain    = +(trimp7All * (monotonie >= 99 ? mean7 : monotonie)).toFixed(0);

  const row = (label, val, unit = '', note = '', noteColor = 'var(--muted)') => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-top:1px solid var(--border);font-size:13px">
      <span style="color:var(--muted)">${label}</span>
      <div style="text-align:right">
        <span style="font-weight:600">${val}<span style="font-weight:400;font-size:11px;color:var(--muted)"> ${unit}</span></span>
        ${note ? `<div style="font-size:10px;color:${noteColor}">${note}</div>` : ''}
      </div>
    </div>`;

  const monoColor = monotonie === 0   ? '#94a3b8'
    : monotonie >= 99                 ? '#ef4444'
    : monotonie < 1.5                 ? '#22c55e'
    : monotonie < 2                   ? '#f97316'
    : '#ef4444';
  const monoNote = monotonie === 0    ? 'Aucune charge'
    : monotonie >= 99                 ? 'Charge uniforme — monotonie max ⚠'
    : monotonie < 1.5                 ? 'OK'
    : monotonie < 2                   ? 'Surveillez'
    : 'Risque blessure';
  const monoDisplay = monotonie >= 99 ? '∞' : monotonie;
  const pctRun7   = trimp7All > 0 ? Math.round(trimp7Run / trimp7All * 100) : 0;

  el.innerHTML =
    `<div style="font-size:11px;color:#6366f1;font-weight:600;margin-bottom:6px;padding:4px 8px;background:rgba(99,102,241,0.08);border-radius:6px">
       Toutes activités avec FC (course + natation + HIIT + rameur…)
     </div>` +
    row('TRIMP 7 jours — total', trimp7All, 'pts', `dont course : ${trimp7Run} pts (${pctRun7}%)`) +
    row('TRIMP 28 jours — total', trimp28All, 'pts') +
    row('TRIMP moy / jour (7j)', mean7.toFixed(1), 'pts') +
    `<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-top:1px solid var(--border);font-size:13px">
      <span style="color:var(--muted)">Monotonie</span>
      <span style="font-weight:600;color:${monoColor}">${monoDisplay} <span style="font-size:11px;font-weight:400">(${monoNote})</span></span>
    </div>` +
    row('Strain (charge × monotonie)', strain, 'pts');
}

/* ══════════════════════════════════════════════════════════
   ACWR — Acute:Chronic Workload Ratio
   AL = avg TRIMP/j sur 7j  |  CL = avg TRIMP/j sur 28j
   Zones : <0.8 sous-charge | 0.8–1.3 optimal | 1.3–1.5 vigilance | >1.5 danger
   ══════════════════════════════════════════════════════════ */
function renderRunACWR() {
  const gaugeEl = document.getElementById('run-acwr-gauge');
  const chartEl = document.getElementById('chart-run-acwr');
  if (!gaugeEl || !chartEl) return;

  /* Toutes activités avec FC — charge systémique complète */
  const trimpByDay = buildTRIMPMap();

  /* Helper: sum TRIMP over [date - nDays, date) */
  function trimpSum(endDate, nDays) {
    let sum = 0;
    for (let i = 0; i < nDays; i++) {
      const d = new Date(endDate);
      d.setDate(d.getDate() - i);
      sum += trimpByDay[d.toLocaleDateString('sv-SE')] || 0;
    }
    return sum;
  }

  /* Current ACWR */
  const acute7  = trimpSum(TODAY, 7)  / 7;
  const chronic28 = trimpSum(TODAY, 28) / 28;
  const currentACWR = chronic28 > 0 ? +(acute7 / chronic28).toFixed(2) : null;

  /* Zone info */
  function acwrZone(v) {
    if (v === null) return { label: 'Données insuffisantes', color: '#6b7280', bg: 'var(--surface2)' };
    if (v < 0.8)   return { label: 'Sous-charge', color: '#3b82f6', bg: 'rgba(59,130,246,0.1)' };
    if (v <= 1.3)  return { label: 'Zone optimale', color: '#22c55e', bg: 'rgba(34,197,94,0.1)' };
    if (v <= 1.5)  return { label: 'Vigilance', color: '#f97316', bg: 'rgba(249,115,22,0.1)' };
    return          { label: 'Risque élevé', color: '#ef4444', bg: 'rgba(239,68,68,0.1)' };
  }

  const zone = acwrZone(currentACWR);
  const trimp7val  = trimpSum(TODAY, 7);
  const trimp28val = trimpSum(TODAY, 28);

  /* Gauge block */
  gaugeEl.innerHTML = `
    <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:16px">
      <div style="text-align:center;background:${zone.bg};border:2px solid ${zone.color};border-radius:14px;padding:12px 22px;min-width:90px">
        <div style="font-size:28px;font-weight:800;color:${zone.color}">${currentACWR ?? '–'}</div>
        <div style="font-size:10px;font-weight:700;color:${zone.color};text-transform:uppercase;letter-spacing:.06em;margin-top:2px">${zone.label}</div>
      </div>
      <div style="flex:1;min-width:180px">
        <div style="display:flex;gap:0;border-radius:8px;overflow:hidden;height:10px;margin-bottom:8px">
          <div style="flex:0.8;background:#3b82f6" title="< 0.8 Sous-charge"></div>
          <div style="flex:0.5;background:#22c55e" title="0.8–1.3 Optimal"></div>
          <div style="flex:0.2;background:#f97316" title="1.3–1.5 Vigilance"></div>
          <div style="flex:0.5;background:#ef4444" title="> 1.5 Danger"></div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--muted)">
          <span>0</span><span>0.8</span><span>1.3</span><span>1.5</span><span>2+</span>
        </div>
        <div style="margin-top:10px;font-size:12px;color:var(--muted);line-height:1.5">
          TRIMP 7j : <b style="color:var(--text)">${trimp7val} pts</b> &nbsp;·&nbsp;
          TRIMP 28j : <b style="color:var(--text)">${trimp28val} pts</b><br>
          AL moy/j : <b style="color:var(--text)">${acute7.toFixed(1)}</b> &nbsp;·&nbsp;
          CL moy/j : <b style="color:var(--text)">${chronic28.toFixed(1)}</b><br>
          <span style="color:#6366f1;font-size:10px">Toutes activités avec FC (course, HIIT, rameur…)</span>
        </div>
      </div>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;font-size:11px">
      <span style="padding:3px 9px;border-radius:20px;background:rgba(59,130,246,0.12);color:#3b82f6">🔵 &lt; 0.8 Sous-charge</span>
      <span style="padding:3px 9px;border-radius:20px;background:rgba(34,197,94,0.12);color:#22c55e">🟢 0.8–1.3 Optimal</span>
      <span style="padding:3px 9px;border-radius:20px;background:rgba(249,115,22,0.12);color:#f97316">🟠 1.3–1.5 Vigilance</span>
      <span style="padding:3px 9px;border-radius:20px;background:rgba(239,68,68,0.12);color:#ef4444">🔴 &gt; 1.5 Risque</span>
    </div>`;

  /* Build ACWR time series — one point per day for the selected period */
  const months = runState.globalPeriod === '3m' ? 3 : runState.globalPeriod === '6m' ? 6 : runState.globalPeriod === '1y' ? 12 : 24;
  const nDays  = months * 30;
  const labels = [], values = [], pointColors = [];

  for (let i = nDays - 1; i >= 0; i--) {
    const d = new Date(TODAY);
    d.setDate(d.getDate() - i);
    const al = trimpSum(d, 7)  / 7;
    const cl = trimpSum(d, 28) / 28;
    if (cl < 0.5) { labels.push(null); values.push(null); pointColors.push('transparent'); continue; }
    const ratio = +(al / cl).toFixed(2);
    labels.push(d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }));
    values.push(ratio);
    pointColors.push(acwrZone(ratio).color);
  }

  mkChart('chart-run-acwr', {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'ACWR',
        data: values,
        borderColor: '#6366f1',
        borderWidth: 2,
        pointBackgroundColor: pointColors,
        pointRadius: 3,
        pointHoverRadius: 5,
        tension: 0.3,
        spanGaps: false,
        fill: false,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => {
              const v = ctx.raw;
              if (v === null) return '';
              return `ACWR : ${v}  (${acwrZone(v).label})`;
            }
          }
        },
        annotation: {
          annotations: {
            zoneOptimalFill: {
              type: 'box', yMin: 0.8, yMax: 1.3,
              backgroundColor: 'rgba(34,197,94,0.06)',
              borderWidth: 0,
            },
            zoneVigilanceFill: {
              type: 'box', yMin: 1.3, yMax: 1.5,
              backgroundColor: 'rgba(249,115,22,0.07)',
              borderWidth: 0,
            },
            zoneDangerFill: {
              type: 'box', yMin: 1.5, yMax: 3,
              backgroundColor: 'rgba(239,68,68,0.06)',
              borderWidth: 0,
            },
            line08: {
              type: 'line', yMin: 0.8, yMax: 0.8,
              borderColor: '#3b82f6', borderWidth: 1, borderDash: [4, 3],
              label: { content: '0.8', display: true, position: 'start', color: '#3b82f6', font: { size: 9 }, backgroundColor: 'transparent' }
            },
            line13: {
              type: 'line', yMin: 1.3, yMax: 1.3,
              borderColor: '#f97316', borderWidth: 1, borderDash: [4, 3],
              label: { content: '1.3', display: true, position: 'start', color: '#f97316', font: { size: 9 }, backgroundColor: 'transparent' }
            },
            line15: {
              type: 'line', yMin: 1.5, yMax: 1.5,
              borderColor: '#ef4444', borderWidth: 1, borderDash: [4, 3],
              label: { content: '1.5', display: true, position: 'start', color: '#ef4444', font: { size: 9 }, backgroundColor: 'transparent' }
            },
          }
        }
      },
      scales: {
        x: {
          ticks: {
            maxTicksLimit: 8,
            maxRotation: 0,
            callback: (_, i) => labels[i] || '',
          },
          grid: { display: false },
        },
        y: {
          min: 0,
          suggestedMax: 2,
          title: { display: true, text: 'ACWR', font: { size: 10 }, color: '#6b7280' },
          grid: { color: 'rgba(107,114,128,0.1)' },
        }
      }
    }
  });
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

  const runs = getRunsForGlobalPeriod().map(r => ({ ...r, _trimp: computeTRIMP(r) })).sort((a, b) => {
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
    const iso = localIso(d);
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
    const iso = localIso(d);
    const l = allLoad[iso]||0;
    ctl = ctl + (l-ctl)/42;
    atl = atl + (l-atl)/7;
  }
  const tsb = ctl - atl;

  // ── Wellness récent ──────────────────────────────────────
  const well = state.wellness?.days || {};
  const wellDays = Object.values(well).filter(w => w.date).sort((a,b) => b.date.localeCompare(a.date));
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

/* Helper : runs filtrés selon la plage du slicer */
function getRunsForGlobalPeriod() {
  const runs = getRuns();
  const from = runState.periodFrom;
  const to   = runState.periodTo;
  if (!from && !to) return runs;
  return runs.filter(r => {
    if (from && r.date < from) return false;
    if (to   && r.date > to)   return false;
    return true;
  });
}

/* ══════════════════════════════════════════════════════════
   SLICER DE PÉRIODE — double poignée
   ══════════════════════════════════════════════════════════ */
function initRunSlicer() {
  const runs = getRuns();
  if (!runs.length) return;

  const allSorted = runs.slice().sort((a, b) => a.date.localeCompare(b.date));
  const minDate   = new Date(allSorted[0].date + 'T12:00:00');
  const maxDate   = new Date(TODAY);

  // Granularité : semaines
  const totalWeeks = Math.max(1, Math.ceil((maxDate - minDate) / (7 * 86400000)));

  const inputFrom = document.getElementById('slicer-from');
  const inputTo   = document.getElementById('slicer-to');
  if (!inputFrom || !inputTo) return;

  inputFrom.min = 0; inputFrom.max = totalWeeks;
  inputTo.min   = 0; inputTo.max   = totalWeeks;

  // Restaurer depuis localStorage ou défaut 6 mois
  const saved = JSON.parse(localStorage.getItem('run_slicer') || 'null');
  let fromW, toW;
  if (saved && saved.from != null && saved.to != null) {
    fromW = Math.min(saved.from, totalWeeks);
    toW   = Math.min(saved.to,   totalWeeks);
  } else {
    toW   = totalWeeks;
    fromW = Math.max(0, totalWeeks - 26); // défaut 6 mois
  }

  inputFrom.value = fromW;
  inputTo.value   = toW;

  _applySlider(inputFrom, inputTo, minDate, totalWeeks);

  inputFrom.addEventListener('input', () => {
    if (+inputFrom.value >= +inputTo.value) inputFrom.value = +inputTo.value - 1;
    _applySlider(inputFrom, inputTo, minDate, totalWeeks);
  });
  inputTo.addEventListener('input', () => {
    if (+inputTo.value <= +inputFrom.value) inputTo.value = +inputFrom.value + 1;
    _applySlider(inputFrom, inputTo, minDate, totalWeeks);
  });

  _buildSliderAxis(minDate, totalWeeks);
}

function _weekToDate(minDate, weeks) {
  const d = new Date(minDate);
  d.setDate(d.getDate() + weeks * 7);
  return d;
}

function _applySlider(inputFrom, inputTo, minDate, totalWeeks) {
  const fromW = +inputFrom.value;
  const toW   = +inputTo.value;
  const pct   = v => (v / totalWeeks * 100).toFixed(2);

  // Fill bar
  const fill = document.getElementById('slicer-fill');
  if (fill) {
    fill.style.left  = pct(fromW) + '%';
    fill.style.width = (pct(toW) - pct(fromW)) + '%';
  }

  // Date labels
  const fromDate = _weekToDate(minDate, fromW);
  const toDate   = _weekToDate(minDate, toW);
  const fmt = d => d.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' });
  const isToday = toW >= totalWeeks;
  document.getElementById('slicer-from-lbl').textContent = fmt(fromDate);
  document.getElementById('slicer-to-lbl').textContent   = isToday ? "Aujourd'hui" : fmt(toDate);

  // Duration label
  const diffDays  = Math.round((toDate - fromDate) / 86400000);
  const diffMonths = Math.round(diffDays / 30.4);
  const durLabel  = diffMonths >= 24 ? `${Math.round(diffMonths/12)} ans`
                  : diffMonths >= 2  ? `${diffMonths} mois`
                  : `${diffDays} j`;
  document.getElementById('slicer-dur-lbl').textContent = durLabel;

  // Update state
  runState.periodFrom = fromDate.toLocaleDateString('sv-SE');
  runState.periodTo   = isToday ? null : toDate.toLocaleDateString('sv-SE');

  // Compute globalPeriod approx for legacy refs
  runState.globalPeriod = diffMonths <= 4 ? '3m'
                        : diffMonths <= 8 ? '6m'
                        : diffMonths <= 14 ? '1y' : 'all';

  localStorage.setItem('run_slicer', JSON.stringify({ from: fromW, to: toW }));

  if (typeof markAllDirty === 'function') markAllDirty();
  renderRunning();
}

function _buildSliderAxis(minDate, totalWeeks) {
  const axis = document.getElementById('slicer-axis');
  if (!axis) return;
  // Place a label every ~6 months
  const stepWeeks = totalWeeks <= 52 ? 13 : totalWeeks <= 104 ? 26 : 52;
  let html = '';
  for (let w = 0; w <= totalWeeks; w += stepWeeks) {
    const d = _weekToDate(minDate, w);
    const pct = (w / totalWeeks * 100).toFixed(1);
    const lbl = d.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' });
    html += `<span style="left:${pct}%">${lbl}</span>`;
  }
  axis.innerHTML = html;
}

function toggleRunAdvanced() {
  const view = document.getElementById('view-running');
  if (!view) return;
  const on = view.classList.toggle('run-advanced');
  const btn = document.getElementById('btn-run-advanced');
  if (btn) btn.textContent = on ? '− Avancé' : '+ Avancé';
  localStorage.setItem('run_advanced', on ? '1' : '0');
  if (on) renderRunning();
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
    const key = localIso(cur).slice(0,7);
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
        <td colspan="8" style="color:var(--muted);font-style:italic">Pas d'activités</td></tr>`;
    }

    const n    = rs.length;
    const dist = rs.reduce((s, r) => s + (r.distance_km || 0), 0);
    const dur  = rs.reduce((s, r) => s + (r.duration_min || 0), 0);
    const elev = rs.reduce((s, r) => s + (r.elevation_m || 0), 0);
    const trimp= rs.reduce((s, r) => s + computeTRIMP(r), 0);
    const kcal = rs.reduce((s, r) => s + (r.calories || 0), 0);
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
      <td style="color:var(--muted)">${kcal > 0 ? Math.round(kcal).toLocaleString('fr-FR') + ' kcal' : '–'}</td>
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
  const allRuns = getRunsForGlobalPeriod();
  const labels = [], volumes = [], colors = [];

  // Affichage mensuel pour 1y/all, hebdomadaire sinon
  const useMonthly = runState.globalPeriod === '1y' || runState.globalPeriod === 'all';
  const MOIS_FR = ['Jan','Fév','Mar','Avr','Mai','Juin','Juil','Août','Sep','Oct','Nov','Déc'];

  if (useMonthly) {
    const nMonths = runState.globalPeriod === '1y' ? 12 : 24;
    for (let m = nMonths - 1; m >= 0; m--) {
      const d = new Date(TODAY); d.setDate(1); d.setMonth(d.getMonth() - m);
      const key = localIso(d).slice(0,7);
      const km = allRuns.filter(r => r.date.startsWith(key)).reduce((s, r) => s + (r.distance_km || 0), 0);
      labels.push(`${MOIS_FR[d.getMonth()]} ${String(d.getFullYear()).slice(-2)}`);
      volumes.push(+km.toFixed(1));
      colors.push(km === 0 ? 'rgba(148,163,184,0.3)' : km < 80 ? '#22c55e' : km < 150 ? '#f97316' : '#ef4444');
    }
  } else {
    const WEEKS = runState.globalPeriod === '3m' ? 13 : 26;
    for (let w = WEEKS - 1; w >= 0; w--) {
      const monday = new Date(TODAY);
      const dow = monday.getDay() === 0 ? 6 : monday.getDay() - 1;
      monday.setDate(monday.getDate() - dow - w * 7);
      monday.setHours(0, 0, 0, 0);
      const sunday = new Date(monday); sunday.setDate(sunday.getDate() + 6);
      const monIso = monday.toLocaleDateString('sv-SE');
      const sunIso = sunday.toLocaleDateString('sv-SE');
      const km = allRuns.filter(r => (r.date || '') >= monIso && (r.date || '') <= sunIso)
        .reduce((s, r) => s + (r.distance_km || 0), 0);
      labels.push(monday.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }));
      volumes.push(+km.toFixed(1));
      colors.push(km === 0 ? 'rgba(148,163,184,0.3)' : km < 30 ? '#22c55e' : km < 50 ? '#f97316' : '#ef4444');
    }
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
        x: { grid: { display: false }, ticks: { maxTicksLimit: 13, font: { size: 10 } } },
        y: { grid: { color: '#e5e7eb' }, ticks: { callback: v => v + ' km', font: { size: 10 } }, beginAtZero: true }
      }
    }
  });
}

/* ══════════════════════════════════════════════════════════
   RENDER : Tendance allure mensuelle
   ══════════════════════════════════════════════════════════ */
function renderRunPaceTrend() {
  const MONTHS = runState.globalPeriod === '3m' ? 3 : runState.globalPeriod === '6m' ? 6 : 12;
  const labels = [], paces = [];
  const MOIS_FR = ['Jan','Fév','Mar','Avr','Mai','Juin','Juil','Août','Sep','Oct','Nov','Déc'];
  const allRuns = getRunsForGlobalPeriod();

  for (let m = MONTHS - 1; m >= 0; m--) {
    const d = new Date(TODAY);
    d.setDate(1);
    d.setMonth(d.getMonth() - m);
    const key = localIso(d).slice(0,7);
    const monthRuns = allRuns.filter(r => r.date.startsWith(key) && r.pace_min_km && r.distance_km);

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
   RENDER : Zones FC stacked par semaine (polarisation)
   ══════════════════════════════════════════════════════════ */
function renderRunZonesEvolution() {
  const allRuns = getRunsForGlobalPeriod().filter(r => r.hr_zones_pct && r.duration_min);

  // Nombre de semaines selon la période sélectionnée
  const numWeeks = runState.globalPeriod === '3m' ? 13 : runState.globalPeriod === '6m' ? 26 : runState.globalPeriod === '1y' ? 52 : 12;
  const weekLabels = [];
  const zonesByWeek = Array.from({ length: 5 }, () => []);

  for (let w = numWeeks - 1; w >= 0; w--) {
    const monday = new Date(TODAY);
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7) - w * 7);
    monday.setHours(0, 0, 0, 0);
    const sunday = new Date(monday); sunday.setDate(sunday.getDate() + 6); sunday.setHours(23, 59, 59);

    weekLabels.push(monday.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }));

    const weekRuns = allRuns.filter(r => {
      const d = new Date(r.date + 'T12:00:00');
      return d >= monday && d <= sunday;
    });

    const zones = [0, 0, 0, 0, 0];
    if (weekRuns.length) {
      const totDur = weekRuns.reduce((s, r) => s + r.duration_min, 0);
      weekRuns.forEach(r => r.hr_zones_pct.forEach((pct, i) => { zones[i] += (pct * r.duration_min) / totDur; }));
    }
    zones.forEach((v, i) => zonesByWeek[i].push(+v.toFixed(1)));
  }

  // Indicateur de polarisation sur les 4 dernières semaines
  const polarEl = document.getElementById('run-zones-polar-indicator');
  if (polarEl) {
    const recent = allRuns.filter(r => {
      const cutoff = new Date(TODAY); cutoff.setDate(cutoff.getDate() - 28);
      return new Date(r.date) >= cutoff;
    });
    if (recent.length) {
      const totDur = recent.reduce((s, r) => s + r.duration_min, 0);
      const z = [0, 0, 0, 0, 0];
      recent.forEach(r => r.hr_zones_pct.forEach((pct, i) => { z[i] += (pct * r.duration_min) / totDur; }));
      const endurance = z[0] + z[1];
      const greyZone  = z[2];
      const intense   = z[3] + z[4];
      const isGood    = endurance >= 65 && greyZone <= 20;
      polarEl.innerHTML = `<div style="display:flex;gap:14px;flex-wrap:wrap;font-size:12px">
        <span><span style="color:#22c55e;font-weight:700">${endurance.toFixed(0)}%</span> Z1+Z2</span>
        <span><span style="color:#3b82f6;font-weight:700">${greyZone.toFixed(0)}%</span> Z3</span>
        <span><span style="color:#ef4444;font-weight:700">${intense.toFixed(0)}%</span> Z4+Z5</span>
        <span style="padding:1px 8px;border-radius:4px;font-weight:600;background:${isGood ? 'rgba(34,197,94,0.12)' : 'rgba(249,115,22,0.12)'};color:${isGood ? '#16a34a' : '#ea580c'}">
          ${isGood ? 'Polarisation ✓' : 'Zone grise élevée'}
        </span>
      </div>`;
    }
  }

  const colors = ['#94a3b8', '#22c55e', '#3b82f6', '#f97316', '#ef4444'];
  const zLabels = ['Z1 Récup', 'Z2 Endurance', 'Z3 Tempo', 'Z4 Seuil', 'Z5 VO2max'];

  mkChart('chart-run-zones-evolution', {
    type: 'bar',
    data: {
      labels: weekLabels,
      datasets: zLabels.map((label, i) => ({
        label, data: zonesByWeek[i],
        backgroundColor: colors[i],
        borderWidth: 0,
      })),
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 }, padding: 10 } },
        tooltip: { callbacks: { label: c => `${c.dataset.label} : ${c.raw}%` } },
      },
      scales: {
        x: { stacked: true, grid: { display: false }, ticks: { font: { size: 10 } } },
        y: { stacked: true, max: 100, grid: { color: '#e5e7eb' }, ticks: { callback: v => v + '%', font: { size: 10 } } },
      },
    },
  });
}

/* ══════════════════════════════════════════════════════════
   RENDER : Dénivelé — D+ mensuel + scatter charge
   ══════════════════════════════════════════════════════════ */
function renderRunElevationCharts() {
  const MOIS = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];

  // D+ par mois — 12 derniers mois (tous runs, pas seulement période globale)
  const allRuns = getRuns();
  const months = [];
  for (let m = 11; m >= 0; m--) {
    const d = new Date(TODAY); d.setDate(1); d.setMonth(d.getMonth() - m);
    months.push(localIso(d).slice(0,7));
  }
  const elevByMonth = {};
  allRuns.forEach(r => {
    const key = r.date.slice(0, 7);
    if (elevByMonth[key] !== undefined || months.includes(key))
      elevByMonth[key] = (elevByMonth[key] || 0) + (r.elevation_m || 0);
  });
  const elevData   = months.map(k => Math.round(elevByMonth[k] || 0));
  const elevLabels = months.map(k => {
    const [y, m] = k.split('-');
    return MOIS[+m - 1] + (+y !== TODAY.getFullYear() ? ` ${y.slice(2)}` : '');
  });

  mkChart('chart-run-elev-monthly', {
    type: 'bar',
    data: { labels: elevLabels, datasets: [{
      label: 'D+', data: elevData,
      backgroundColor: elevData.map((_, i) => i === elevData.length - 1 ? '#6366f1' : 'rgba(99,102,241,0.45)'),
      borderRadius: 4,
    }]},
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `+${c.raw} m` } } },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 10 } } },
        y: { grid: { color: '#e5e7eb' }, ticks: { callback: v => `+${v}m`, font: { size: 10 } } },
      },
    },
  });

  // Scatter : dénivelé vs training_load (période globale)
  const periodRuns = getRunsForGlobalPeriod().filter(r => r.elevation_m > 0 && r.training_load > 0);
  if (periodRuns.length >= 3) {
    mkChart('chart-run-elev-scatter', {
      type: 'scatter',
      data: { datasets: [{
        data: periodRuns.map(r => ({ x: Math.round(r.elevation_m), y: r.training_load, label: r.date, name: r.name || '' })),
        backgroundColor: 'rgba(99,102,241,0.55)', pointRadius: 5, pointHoverRadius: 7,
      }]},
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: c => `${c.raw.label} — +${c.raw.x}m / charge ${c.raw.y}` } },
        },
        scales: {
          x: { grid: { color: '#e5e7eb' }, title: { display: true, text: 'Dénivelé (m)', color: '#94a3b8', font: { size: 10 } } },
          y: { grid: { color: '#e5e7eb' }, title: { display: true, text: 'Training Load', color: '#94a3b8', font: { size: 10 } } },
        },
      },
    });
  }

  // Stats textuelles
  const statsEl = document.getElementById('run-elev-stats');
  if (statsEl) {
    const withElev = allRuns.filter(r => r.elevation_m > 0);
    if (!withElev.length) { statsEl.innerHTML = '<p style="color:var(--muted);font-size:13px">Pas de données de dénivelé.</p>'; return; }
    const totalElev = withElev.reduce((s, r) => s + r.elevation_m, 0);
    const avgElev   = Math.round(totalElev / withElev.length);
    const maxRun    = withElev.reduce((best, r) => (r.elevation_m || 0) > (best.elevation_m || 0) ? r : best, withElev[0]);
    const row = (label, val) => `<div style="display:flex;justify-content:space-between;padding:7px 0;border-top:1px solid var(--border);font-size:13px"><span style="color:var(--muted)">${label}</span><span style="font-weight:600">${val}</span></div>`;
    statsEl.innerHTML =
      row('D+ total (tout l\'historique)', `+${Math.round(totalElev).toLocaleString('fr-FR')} m`) +
      row('D+ moyen par sortie', `+${avgElev} m`) +
      row('Record D+ en une sortie', `+${Math.round(maxRun.elevation_m)} m`) +
      `<div style="font-size:11px;color:var(--muted);padding-top:6px;border-top:1px solid var(--border);margin-top:2px">${new Date(maxRun.date + 'T12:00:00').toLocaleDateString('fr-FR')} — ${maxRun.name || '–'}</div>`;
  }
}

/* ══════════════════════════════════════════════════════════
   RENDER : Réserve cardiaque (hr_max − hr_avg) dans le temps
   ══════════════════════════════════════════════════════════ */
function renderRunCardiacReserve() {
  const allRuns = getRunsForGlobalPeriod()
    .filter(r => r.hr_max && r.hr_avg && r.hr_max > r.hr_avg)
    .sort((a, b) => a.date.localeCompare(b.date));

  const totalInPeriod = getRunsForGlobalPeriod().length;
  const infoEl = document.getElementById('run-cardiac-info');

  if (allRuns.length < 5) {
    if (infoEl) infoEl.innerHTML = `<div style="color:var(--muted);font-size:12px;padding:6px 0">
      Pas assez de données (${allRuns.length}/${totalInPeriod} courses ont FC max enregistrée — minimum 5 requis).
    </div>`;
    return;
  }

  const reserves = allRuns.map(r => r.hr_max - r.hr_avg);
  const avg = Math.round(reserves.reduce((s, v) => s + v, 0) / reserves.length);

  // Trend only on last 10 points minimum to avoid outlier bias
  const trendRuns = allRuns.length >= 10 ? allRuns : null;
  let delta = 0, trendLabel = '→ Stable', trendColor = '#94a3b8';
  if (trendRuns) {
    const half   = Math.floor(trendRuns.length / 2);
    const resAll = trendRuns.map(r => r.hr_max - r.hr_avg);
    const avgOld = resAll.slice(0, half).reduce((s, v) => s + v, 0) / half;
    const avgNew = resAll.slice(half).reduce((s, v) => s + v, 0) / (trendRuns.length - half);
    delta = avgNew - avgOld;
    trendLabel = delta < -2 ? '↘ Amélioration' : delta > 2 ? '↗ Dégradation' : '→ Stable';
    trendColor = delta < -2 ? '#22c55e' : delta > 2 ? '#ef4444' : '#94a3b8';
  }

  const coveredPct = Math.round(allRuns.length / totalInPeriod * 100);
  const dataNote = coveredPct < 80
    ? `<span style="color:#f97316;font-size:11px">⚠ ${allRuns.length}/${totalInPeriod} courses avec FC max (${coveredPct}%)</span>`
    : `<span style="color:var(--muted);font-size:11px">${allRuns.length} courses</span>`;

  if (infoEl) {
    infoEl.innerHTML = `<div style="display:flex;gap:16px;flex-wrap:wrap;font-size:12px;margin-bottom:8px;align-items:center">
      <span style="color:var(--muted)">Moy. : <strong style="color:var(--text)">${avg} bpm</strong></span>
      ${trendRuns ? `<span style="color:${trendColor};font-weight:600">${trendLabel}</span>` : '<span style="color:var(--muted);font-size:11px">Tendance : données insuffisantes (&lt;10 pts)</span>'}
      <span style="color:var(--muted);font-size:11px">↘ baisse = meilleure efficience</span>
      ${dataNote}
    </div>`;
  }

  const labels = runs.map(r => new Date(r.date + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }));

  mkChart('chart-run-cardiac-reserve', {
    type: 'line',
    data: { labels, datasets: [
      {
        label: 'Réserve cardiaque', data: reserves,
        borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.08)',
        fill: true, tension: 0.4, pointRadius: 3, pointBackgroundColor: '#ef4444', borderWidth: 2,
      },
      {
        label: 'Moyenne', data: Array(reserves.length).fill(avg),
        borderColor: 'rgba(239,68,68,0.35)', backgroundColor: 'transparent',
        borderDash: [5, 3], pointRadius: 0, borderWidth: 1.5,
      },
    ]},
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => c.dataset.label === 'Moyenne' ? null : `Réserve : ${c.raw} bpm (FC max − FC moy)` } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 8, font: { size: 10 } } },
        y: { grid: { color: '#e5e7eb' }, title: { display: true, text: 'bpm (FC max − FC moy)', color: '#94a3b8', font: { size: 10 } } },
      },
    },
  });
}

/* ══════════════════════════════════════════════════════════
   RENDER : Règle des 10% + Indice de consistance
   ══════════════════════════════════════════════════════════ */
function renderProgressionConsistance() {
  const el = document.getElementById('run-progression-consistance');
  if (!el) return;

  const allActs = getAll().filter(a => a.hr_avg && a.duration_min);

  // Compute weekly TRIMP for last 9 complete weeks + current partial week
  function getWeekMonday(date) {
    const d = new Date(date + 'T12:00:00');
    const dow = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - dow);
    return localIso(d);
  }

  // Current week monday
  const dow = (TODAY.getDay() + 6) % 7;
  const currentMon = new Date(TODAY); currentMon.setDate(TODAY.getDate() - dow); currentMon.setHours(0,0,0,0);
  const currentMonIso = localIso(currentMon);

  // Build weekly TRIMP map
  const weeklyTrimp = {};
  allActs.forEach(a => {
    const wk = getWeekMonday(a.date);
    weeklyTrimp[wk] = (weeklyTrimp[wk] || 0) + computeTRIMP(a);
  });

  // Last 8 complete weeks (exclude current)
  const completeWeeks = [];
  for (let w = 1; w <= 8; w++) {
    const mon = new Date(currentMon); mon.setDate(currentMon.getDate() - w * 7);
    const monIso = localIso(mon);
    completeWeeks.unshift(weeklyTrimp[monIso] || 0);
  }

  // Current week TRIMP (Mon–today)
  const currentWeekTrimp = weeklyTrimp[currentMonIso] || 0;

  // avg of 4 complete weeks before current (weeks 1-4)
  const prev4 = completeWeeks.slice(-4);
  const avg4w = prev4.length > 0 ? prev4.reduce((s, v) => s + v, 0) / prev4.length : 0;
  const ratio = avg4w > 0 ? currentWeekTrimp / avg4w : 0;
  const ratioPct = Math.round(ratio * 100);

  let progressColor, progressLabel;
  if (avg4w === 0) {
    progressColor = '#6b7280'; progressLabel = 'Données insuffisantes';
  } else if (ratioPct < 85) {
    progressColor = '#3b82f6'; progressLabel = 'Sous-charge';
  } else if (ratioPct <= 115) {
    progressColor = '#22c55e'; progressLabel = 'Progression optimale';
  } else if (ratioPct <= 130) {
    progressColor = '#f97316'; progressLabel = `Attention +${ratioPct - 100}%`;
  } else {
    progressColor = '#ef4444'; progressLabel = `Surcharge +${ratioPct - 100}% ⚠`;
  }

  // Consistance : CV sur 8 complete weeks
  const w8 = completeWeeks;
  const w8mean = w8.reduce((s, v) => s + v, 0) / (w8.length || 1);
  const w8std  = w8.length > 1
    ? Math.sqrt(w8.reduce((s, v) => s + (v - w8mean) ** 2, 0) / w8.length)
    : 0;
  const cv = w8mean > 0 ? Math.round(w8std / w8mean * 100) : 0;

  let cvColor, cvLabel;
  if (w8mean === 0) {
    cvColor = '#6b7280'; cvLabel = 'Données insuffisantes';
  } else if (cv < 20) {
    cvColor = '#22c55e'; cvLabel = `Régulier (CV ${cv}%)`;
  } else if (cv <= 35) {
    cvColor = '#f97316'; cvLabel = `Irrégulier (CV ${cv}%)`;
  } else {
    cvColor = '#ef4444'; cvLabel = `Très irrégulier (CV ${cv}%)`;
  }

  el.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div style="background:var(--surface2);border-radius:12px;padding:14px 16px;border-left:4px solid ${progressColor}">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin-bottom:6px">Règle des 10% — Charge progressive</div>
        <div style="font-size:22px;font-weight:800;color:${progressColor};margin-bottom:4px">${avg4w > 0 ? ratioPct + '%' : '–'}</div>
        <div style="font-size:12px;font-weight:600;color:${progressColor};margin-bottom:8px">${progressLabel}</div>
        <div style="font-size:11px;color:var(--muted);line-height:1.6">
          Semaine en cours : <b style="color:var(--text)">${Math.round(currentWeekTrimp)} pts</b><br>
          Moy. 4 sem. préc. : <b style="color:var(--text)">${Math.round(avg4w)} pts</b>
        </div>
      </div>
      <div style="background:var(--surface2);border-radius:12px;padding:14px 16px;border-left:4px solid ${cvColor}">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin-bottom:6px">Indice de consistance</div>
        <div style="font-size:22px;font-weight:800;color:${cvColor};margin-bottom:4px">${w8mean > 0 ? cv + '%' : '–'}</div>
        <div style="font-size:12px;font-weight:600;color:${cvColor};margin-bottom:8px">${cvLabel}</div>
        <div style="font-size:11px;color:var(--muted);line-height:1.6">
          Coeff. variation TRIMP<br>8 dernières semaines complètes
        </div>
      </div>
    </div>`;
}

/* ══════════════════════════════════════════════════════════
   RENDER : Distribution TE aérobie/anaérobie
   ══════════════════════════════════════════════════════════ */
function renderTEDistribution() {
  const el = document.getElementById('run-te-distribution');
  if (!el) return;

  // Last 12 weeks of runs with TE data
  const cutoff = new Date(TODAY); cutoff.setDate(cutoff.getDate() - 84);
  const runs = getRuns().filter(r =>
    new Date(r.date + 'T12:00:00') >= cutoff &&
    ((r.aerobic_te || 0) > 0 || (r.anaerobic_te || 0) > 0)
  );

  if (!runs.length) {
    el.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:12px">Pas de données Training Effect disponibles.</div>';
    return;
  }

  // Get ISO week key (Mon-based)
  function isoWeekKey(dateStr) {
    const d = new Date(dateStr + 'T12:00:00');
    const dow = (d.getDay() + 6) % 7;
    const mon = new Date(d); mon.setDate(d.getDate() - dow);
    return localIso(mon);
  }

  // Group by week
  const byWeek = {};
  runs.forEach(r => {
    const wk = isoWeekKey(r.date);
    if (!byWeek[wk]) byWeek[wk] = [];
    byWeek[wk].push(r);
  });

  const sortedWeeks = Object.keys(byWeek).sort();
  const labels = sortedWeeks.map(wk => {
    const d = new Date(wk + 'T12:00:00');
    const weekNum = Math.ceil((d - new Date(d.getFullYear(), 0, 1)) / 604800000);
    return `S${weekNum}`;
  });

  const aerobicData   = sortedWeeks.map(wk => {
    const arr = byWeek[wk].map(r => r.aerobic_te || 0).filter(v => v > 0);
    return arr.length ? +(arr.reduce((s, v) => s + v, 0) / arr.length).toFixed(2) : 0;
  });
  const anaerobicData = sortedWeeks.map(wk => {
    const arr = byWeek[wk].map(r => r.anaerobic_te || 0).filter(v => v > 0);
    return arr.length ? +(arr.reduce((s, v) => s + v, 0) / arr.length).toFixed(2) : 0;
  });

  // Current week stats
  const curWk = isoWeekKey(localIso(TODAY));
  const curRuns = byWeek[curWk] || [];
  const curAerArr  = curRuns.map(r => r.aerobic_te || 0).filter(v => v > 0);
  const curAnaArr  = curRuns.map(r => r.anaerobic_te || 0).filter(v => v > 0);
  const curAer = curAerArr.length ? (curAerArr.reduce((s, v) => s + v, 0) / curAerArr.length).toFixed(1) : '–';
  const curAna = curAnaArr.length ? (curAnaArr.reduce((s, v) => s + v, 0) / curAnaArr.length).toFixed(1) : '–';

  mkChart('chart-run-te', {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Aérobie', data: aerobicData, backgroundColor: '#3b82f6', borderRadius: 3 },
        { label: 'Anaérobie', data: anaerobicData, backgroundColor: '#f97316', borderRadius: 3 },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: true, labels: { boxWidth: 10, font: { size: 10 } } },
        tooltip: { callbacks: { label: c => `${c.dataset.label} : ${c.raw}` } },
      },
      scales: {
        x: { stacked: true, grid: { display: false }, ticks: { font: { size: 10 } } },
        y: { stacked: true, min: 0, max: 5, grid: { color: 'rgba(0,0,0,0.06)' },
          title: { display: true, text: 'TE (0–5)', font: { size: 10 }, color: '#6b7280' } },
      },
    },
  });

  el.querySelector('.te-stats')?.remove();
  const statsEl = document.createElement('div');
  statsEl.className = 'te-stats';
  statsEl.style.cssText = 'margin-top:10px;font-size:12px;color:var(--muted);display:flex;gap:16px;flex-wrap:wrap';
  statsEl.innerHTML = `
    <span>Semaine en cours — Aérobie : <b style="color:#3b82f6">${curAer}</b></span>
    <span>Anaérobie : <b style="color:#f97316">${curAna}</b></span>`;
  el.appendChild(statsEl);
}

/* ══════════════════════════════════════════════════════════
   RENDER : Cadence de course
   ══════════════════════════════════════════════════════════ */
function renderCadenceTrend() {
  const el = document.getElementById('run-cadence');
  if (!el) return;

  const runs = getRunsForGlobalPeriod().filter(r => (r.avg_cadence || 0) > 0);

  if (!runs.length) {
    el.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:12px;text-align:center">Cadence non disponible — resync requis après ajout de la colonne avg_cadence.</div>';
    return;
  }
  el.innerHTML = '<canvas id="chart-run-cadence" style="max-height:180px"></canvas>';

  const sorted = runs.sort((a, b) => a.date.localeCompare(b.date));
  const labels = sorted.map(r => new Date(r.date + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }));
  const cadences = sorted.map(r => r.avg_cadence);

  const minC = Math.min(...cadences);
  const maxC = Math.max(...cadences);
  const avgC = Math.round(cadences.reduce((s, v) => s + v, 0) / cadences.length);
  const pct175 = Math.round(cadences.filter(v => v >= 175).length / cadences.length * 100);

  mkChart('chart-run-cadence', {
    type: 'line',
    data: { labels, datasets: [{
      label: 'Cadence', data: cadences,
      borderColor: '#8b5cf6', backgroundColor: 'rgba(139,92,246,0.08)',
      fill: true, tension: 0.3, pointRadius: 3, pointBackgroundColor: '#8b5cf6', borderWidth: 2,
    }]},
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => `Cadence : ${c.raw} spm` } },
        annotation: { annotations: {
          line170: { type: 'line', yMin: 170, yMax: 170, borderColor: '#f97316', borderWidth: 1, borderDash: [4, 3],
            label: { content: '170', display: true, position: 'end', color: '#f97316', font: { size: 9 }, backgroundColor: 'transparent' } },
          line180: { type: 'line', yMin: 180, yMax: 180, borderColor: '#22c55e', borderWidth: 1, borderDash: [4, 3],
            label: { content: '180', display: true, position: 'end', color: '#22c55e', font: { size: 9 }, backgroundColor: 'transparent' } },
        }},
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 10, font: { size: 10 } } },
        y: { grid: { color: 'rgba(0,0,0,0.06)' },
          title: { display: true, text: 'spm', font: { size: 10 }, color: '#6b7280' },
          ticks: { font: { size: 10 } } },
      },
    },
  });

  el.querySelector('.cadence-stats')?.remove();
  const statsEl = document.createElement('div');
  statsEl.className = 'cadence-stats';
  statsEl.style.cssText = 'margin-top:10px;font-size:12px;color:var(--muted);display:flex;gap:16px;flex-wrap:wrap';
  statsEl.innerHTML = `
    <span>Min : <b style="color:var(--text)">${minC} spm</b></span>
    <span>Max : <b style="color:var(--text)">${maxC} spm</b></span>
    <span>Moy. : <b style="color:#8b5cf6">${avgC} spm</b></span>
    <span>≥ 175 spm : <b style="color:#22c55e">${pct175}%</b> des sorties</span>`;
  el.appendChild(statsEl);
}

/* ══════════════════════════════════════════════════════════
   RENDER : Prévision de forme — Course cible
   ══════════════════════════════════════════════════════════ */
let _racePredictorResult = null;

function renderRacePredictor() {
  const el = document.getElementById('run-race-predictor');
  if (!el) return;

  const todayIso = localIso(TODAY);
  const maxDate  = new Date(TODAY); maxDate.setMonth(maxDate.getMonth() + 6);
  const maxIso   = localIso(maxDate);

  function simulateToDate(targetIso) {
    // Get current CTL/ATL from all-sport curve
    const allCurve = computeFormeCurve(getAll(), 90);
    const last = allCurve[allCurve.length - 1] || { ctl: 0, atl: 0 };
    let ctl = last.ctl, atl = last.atl;

    // Get weekly plan loads
    const plan = generateWeekPlan();
    const weekLoads = plan.plan.map(s => s.trimp || 0); // 7 values Mon-Sun

    // Day-by-day simulation
    const targetDate = new Date(targetIso + 'T12:00:00');
    const dow = (TODAY.getDay() + 6) % 7; // 0=Mon
    let dayIdx = dow; // which day of week we're in

    let cur = new Date(TODAY);
    while (localIso(cur) < targetIso) {
      const load = weekLoads[dayIdx % 7] || 0;
      ctl = ctl + (load - ctl) / 42;
      atl = atl + (load - atl) / 7;
      dayIdx++;
      cur.setDate(cur.getDate() + 1);
    }

    const tsb = +(ctl - atl).toFixed(1);
    const daysLeft = Math.round((targetDate - TODAY) / 86400000);
    return { ctl: +ctl.toFixed(1), atl: +atl.toFixed(1), tsb, daysLeft };
  }

  function renderResult(res) {
    let tsbColor, tsbLabel;
    if (res.tsb >= 5 && res.tsb <= 20)      { tsbColor = '#22c55e'; tsbLabel = 'Forme optimale pour la course ✓'; }
    else if (res.tsb > 20)                   { tsbColor = '#3b82f6'; tsbLabel = 'Trop frais — envisagez plus de charge'; }
    else if (res.tsb >= 0 && res.tsb < 5)   { tsbColor = '#f97316'; tsbLabel = 'Légèrement sous-optimale'; }
    else                                      { tsbColor = '#ef4444'; tsbLabel = 'Fatigue résiduelle — adaptez le plan'; }

    return `
      <div style="margin-top:14px;background:${tsbColor}12;border:1.5px solid ${tsbColor};border-radius:12px;padding:14px 16px">
        <div style="font-size:13px;font-weight:700;color:${tsbColor};margin-bottom:8px">${tsbLabel}</div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;font-size:12px">
          <div style="background:var(--surface2);border-radius:8px;padding:8px 10px;text-align:center">
            <div style="color:var(--muted);font-size:10px;margin-bottom:2px">CTL projeté</div>
            <b>${res.ctl}</b>
          </div>
          <div style="background:var(--surface2);border-radius:8px;padding:8px 10px;text-align:center">
            <div style="color:var(--muted);font-size:10px;margin-bottom:2px">ATL projeté</div>
            <b>${res.atl}</b>
          </div>
          <div style="background:var(--surface2);border-radius:8px;padding:8px 10px;text-align:center">
            <div style="color:var(--muted);font-size:10px;margin-bottom:2px">TSB projeté</div>
            <b style="color:${tsbColor}">${res.tsb > 0 ? '+' : ''}${res.tsb}</b>
          </div>
        </div>
        <div style="margin-top:8px;font-size:11px;color:var(--muted);text-align:center">${res.daysLeft} jours jusqu'à la course</div>
      </div>`;
  }

  const prevResult = _racePredictorResult ? renderResult(_racePredictorResult) : '';

  el.innerHTML = `
    <div style="font-size:13px;color:var(--muted);margin-bottom:10px">Simulez votre forme à la date d'une course cible en se basant sur le plan hebdomadaire courant.</div>
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <div>
        <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">Date de course cible</label>
        <input type="date" id="race-target-date" min="${todayIso}" max="${maxIso}"
          style="padding:7px 10px;border:1px solid var(--border);border-radius:8px;background:var(--surface2);color:var(--text);font-size:13px"
          value="${_racePredictorResult ? '' : ''}">
      </div>
      <button onclick="(function(){
        const d = document.getElementById('race-target-date').value;
        if (!d) return;
        try { _racePredictorResult = (function simulateToDate(targetIso){
          const allCurve = computeFormeCurve(getAll(), 90);
          const last = allCurve[allCurve.length - 1] || { ctl: 0, atl: 0 };
          let ctl = last.ctl, atl = last.atl;
          const plan = generateWeekPlan();
          const weekLoads = plan.plan.map(s => s.trimp || 0);
          const targetDate = new Date(targetIso + 'T12:00:00');
          const dow = (TODAY.getDay() + 6) % 7;
          let dayIdx = dow;
          let cur = new Date(TODAY);
          while (localIso(cur) < targetIso) {
            const load = weekLoads[dayIdx % 7] || 0;
            ctl = ctl + (load - ctl) / 42;
            atl = atl + (load - atl) / 7;
            dayIdx++;
            cur.setDate(cur.getDate() + 1);
          }
          const tsb = +(ctl - atl).toFixed(1);
          const daysLeft = Math.round((targetDate - TODAY) / 86400000);
          return { ctl: +ctl.toFixed(1), atl: +atl.toFixed(1), tsb, daysLeft };
        })(d);
        } catch(e) { console.error(e); }
        renderRacePredictor();
      })()"
        style="align-self:flex-end;padding:8px 18px;background:var(--accent);color:#000;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">
        Simuler
      </button>
    </div>
    ${prevResult}`;
}

/* ══════════════════════════════════════════════════════════
   ENTRY POINT
   ══════════════════════════════════════════════════════════ */
function renderRunning() {
  const safe = (fn) => { try { fn(); } catch(e) { console.error('[Running]', fn.name, e); } };
  // Restaurer l'état avancé
  const runView = document.getElementById('view-running');
  if (runView && localStorage.getItem('run_advanced') === '1' && !runView.classList.contains('run-advanced')) {
    runView.classList.add('run-advanced');
    const btn = document.getElementById('btn-run-advanced');
    if (btn) btn.textContent = '− Avancé';
  }
  // Initialiser le slicer si pas encore fait
  if (!document.getElementById('slicer-from')?._slicerReady) {
    const el = document.getElementById('slicer-from');
    if (el) { el._slicerReady = true; initRunSlicer(); return; }
  }
  safe(renderRunKPIs);
  safe(renderCalculations);
  safe(renderWeekPlan);
  safe(renderRunPR);
  safe(renderRunFormChart);
  safe(renderRunVolumeChart);
  safe(renderRunPronostics);
  safe(renderRunPaces);
  safe(renderRunVO2Chart);
  safe(renderRunZonesChart);
  safe(renderRunZonesEvolution);
  safe(renderRunPaceTrend);
  safe(renderRunEfficiencyChart);
  safe(renderRunCardiacReserve);
  safe(renderRunTRIMP);
  safe(renderRunACWR);
  safe(renderRunElevationCharts);
  safe(renderRunStatsTable);
  const yearEl = document.getElementById('run-year-label');
  if (yearEl) yearEl.textContent = runState.year;
  safe(renderRunTypesGrid);
  safe(renderRunCalendar);
  safe(renderRunWeekCompare);
  safe(renderRunTable);
  const arrowEl = document.getElementById(`sort-${runState.sortCol}`);
  if (arrowEl) arrowEl.textContent = runState.sortDir === -1 ? '▼' : '▲';
  safe(populateCompareSelectors);
  safe(renderProgressionConsistance);
  safe(renderTEDistribution);
  safe(renderCadenceTrend);
  safe(renderRacePredictor);
}

/* ══════════════════════════════════════════════════════════
   SEMAINE VS SEMAINE PRÉCÉDENTE
   ══════════════════════════════════════════════════════════ */
function renderRunWeekCompare() {
  const el = document.getElementById('run-week-compare');
  if (!el) return;

  const dow    = (TODAY.getDay() + 6) % 7;
  const mon0   = new Date(TODAY); mon0.setDate(TODAY.getDate() - dow);   mon0.setHours(0,0,0,0);
  const mon1   = new Date(mon0);  mon1.setDate(mon0.getDate() - 7);

  const inWeek = (r, monday) => {
    const d = new Date(r.date + 'T12:00:00');
    const sun = new Date(monday); sun.setDate(monday.getDate() + 6); sun.setHours(23,59,59);
    return d >= monday && d <= sun;
  };

  const all    = getRuns();
  const thisW  = all.filter(r => inWeek(r, mon0));
  const prevW  = all.filter(r => inWeek(r, mon1));

  const stat = runs => ({
    n:    runs.length,
    dist: runs.reduce((s,r) => s + (r.distance_km||0), 0),
    dur:  runs.reduce((s,r) => s + (r.duration_min||0), 0),
    load: runs.reduce((s,r) => s + (r.training_load||0), 0),
    trimp:runs.reduce((s,r) => s + computeTRIMP(r), 0),
    elev: runs.reduce((s,r) => s + (r.elevation_m||0), 0),
  });

  const A = stat(thisW), B = stat(prevW);

  if (A.n === 0 && B.n === 0) { el.innerHTML = '<div style="color:var(--muted);font-size:13px">Aucune course ces deux dernières semaines.</div>'; return; }

  const fmtDur = min => { const h = Math.floor(min/60); const m = Math.round(min%60); return h ? `${h}h${String(m).padStart(2,'0')}` : `${m}min`; };
  const fmtDate = d => d.toLocaleDateString('fr-FR', { day:'numeric', month:'short' });
  const sun0 = new Date(mon0); sun0.setDate(mon0.getDate()+6);
  const sun1 = new Date(mon1); sun1.setDate(mon1.getDate()+6);

  const row = (label, vA, vB, unit='', lowerBetter=false) => {
    const nA = parseFloat(vA)||0, nB = parseFloat(vB)||0;
    const max = Math.max(nA, nB, 0.01);
    const pA  = Math.round((nA/max)*100), pB = Math.round((nB/max)*100);
    const aWins = nA > 0 && nB > 0 && (lowerBetter ? nA < nB : nA > nB);
    const bWins = nA > 0 && nB > 0 && (lowerBetter ? nB < nA : nB > nA);
    const diff  = nB > 0 ? ((nA - nB) / nB * 100) : null;
    const diffHtml = diff !== null
      ? `<span style="font-size:11px;font-weight:700;color:${diff>0?'#22c55e':diff<0?'#ef4444':'var(--muted)'}">${diff>0?'+':''}${diff.toFixed(0)}%</span>`
      : '';
    return `<tr>
      <td style="font-size:12px;color:var(--muted);padding:8px 6px;white-space:nowrap">${label}</td>
      <td style="padding:8px 6px">
        <div style="display:flex;align-items:center;gap:6px">
          <div style="flex:1;height:6px;background:var(--border);border-radius:3px;overflow:hidden">
            <div style="height:100%;width:${pA}%;background:#6366f1;border-radius:3px"></div>
          </div>
          <span style="font-size:13px;font-weight:${aWins?700:500};min-width:52px;text-align:right">${vA}<span style="font-size:11px;font-weight:400;color:var(--muted)"> ${unit}</span></span>
        </div>
      </td>
      <td style="padding:8px 6px">
        <div style="display:flex;align-items:center;gap:6px">
          <span style="font-size:13px;font-weight:${bWins?700:500};min-width:52px">${vB}<span style="font-size:11px;font-weight:400;color:var(--muted)"> ${unit}</span></span>
          <div style="flex:1;height:6px;background:var(--border);border-radius:3px;overflow:hidden">
            <div style="height:100%;width:${pB}%;background:#94a3b8;border-radius:3px"></div>
          </div>
        </div>
      </td>
      <td style="padding:8px 6px;text-align:center">${diffHtml}</td>
    </tr>`;
  };

  el.innerHTML = `
    <table style="width:100%;border-collapse:collapse">
      <thead>
        <tr style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)">
          <th style="padding:6px 6px;text-align:left">Métrique</th>
          <th style="padding:6px 6px;text-align:right;color:#6366f1">${fmtDate(mon0)} – ${fmtDate(sun0)}</th>
          <th style="padding:6px 6px;text-align:left;color:var(--muted2)">${fmtDate(mon1)} – ${fmtDate(sun1)}</th>
          <th style="padding:6px 6px;text-align:center">Δ</th>
        </tr>
      </thead>
      <tbody>
        ${row('Sorties',      A.n,                B.n)}
        ${row('Distance',     A.dist.toFixed(1),  B.dist.toFixed(1),  'km')}
        ${row('Durée',        fmtDur(A.dur),       fmtDur(B.dur))}
        ${row('Charge',       Math.round(A.load),  Math.round(B.load), 'pts')}
        ${row('TRIMP',        Math.round(A.trimp), Math.round(B.trimp),'pts')}
        ${row('Dénivelé',     Math.round(A.elev),  Math.round(B.elev), 'm')}
      </tbody>
    </table>`;
}

/* ══════════════════════════════════════════════════════════
   COMPARER DEUX SESSIONS
   ══════════════════════════════════════════════════════════ */
function populateCompareSelectors() {
  const runs = getRuns().sort((a, b) => b.date.localeCompare(a.date));
  const opts = runs.map(r => {
    const date = new Date(r.date + 'T12:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: '2-digit' });
    const dist = r.distance_km ? `${r.distance_km.toFixed(1)} km` : '';
    const pace = r.pace_min_km ? ` · ${r.pace_min_km}/km` : '';
    const name = r.name ? ` — ${r.name.slice(0, 28)}` : '';
    return `<option value="${r.id}">${date} ${dist}${pace}${name}</option>`;
  }).join('');

  ['compare-sel-a', 'compare-sel-b'].forEach((id, idx) => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = '<option value="">— Choisir une course —</option>' + opts;
    if (prev) {
      sel.value = prev;
    } else if (runs.length > idx) {
      sel.value = String(runs[idx].id);
    }
  });
  updateRunCompare();
}

function updateRunCompare() {
  const idA = document.getElementById('compare-sel-a')?.value;
  const idB = document.getElementById('compare-sel-b')?.value;
  const el  = document.getElementById('compare-result');
  if (!el) return;

  if (!idA || !idB) { el.innerHTML = ''; return; }
  if (idA === idB) {
    el.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:8px 0">Sélectionne deux courses différentes.</div>';
    return;
  }

  const runs = getRuns();
  const a = runs.find(r => String(r.id) === String(idA));
  const b = runs.find(r => String(r.id) === String(idB));
  if (!a || !b) return;

  const trimpA = computeTRIMP(a), trimpB = computeTRIMP(b);
  const paceSecA = paceToSec(a.pace_min_km), paceSecB = paceToSec(b.pace_min_km);

  // Métrique : [label, valA, valB, unitA, unitB, lowerIsBetter]
  const metrics = [
    ['Distance',      a.distance_km?.toFixed(2),   b.distance_km?.toFixed(2),   'km', 'km', false],
    ['Durée',         a.duration_min ? secToTime(a.duration_min * 60) : null, b.duration_min ? secToTime(b.duration_min * 60) : null, '', '', true],
    ['Allure moy.',   a.pace_min_km, b.pace_min_km, '/km', '/km', true],
    ['FC moy.',       a.hr_avg,      b.hr_avg,      'bpm', 'bpm', true],
    ['FC max',        a.hr_max,      b.hr_max,      'bpm', 'bpm', true],
    ['Dénivelé +',    a.elevation_m ? `+${Math.round(a.elevation_m)}` : null, b.elevation_m ? `+${Math.round(b.elevation_m)}` : null, 'm', 'm', false],
    ['Vitesse moy.',  a.pace_min_km ? (60 / paceSecA * 60).toFixed(1) : null, b.pace_min_km ? (60 / paceSecB * 60).toFixed(1) : null, 'km/h', 'km/h', false],
    ['Charge',        a.training_load ? Math.round(a.training_load) : null, b.training_load ? Math.round(b.training_load) : null, 'pts', 'pts', false],
    ['TRIMP',         Math.round(trimpA) || null, Math.round(trimpB) || null, 'pts', 'pts', false],
    ['TE aérobie',    a.aerobic_te,  b.aerobic_te,  '', '', false],
    ['Calories',      a.calories,    b.calories,    'kcal', 'kcal', false],
  ].filter(([, vA, vB]) => vA != null && vB != null);

  // Helper : valeur numérique pour comparaison
  const toNum = (v, lowerBetter) => {
    if (typeof v === 'string' && v.includes(':')) return paceToSec(v);
    return parseFloat(v);
  };

  const rows = metrics.map(([label, vA, vB, uA, uB, lowerBetter]) => {
    const nA = toNum(vA, lowerBetter), nB = toNum(vB, lowerBetter);
    const max = Math.max(nA, nB) || 1;
    const wA = Math.round((nA / max) * 100);
    const wB = Math.round((nB / max) * 100);
    const aWins = lowerBetter ? nA < nB : nA > nB;
    const bWins = lowerBetter ? nB < nA : nB > nA;
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

  // Zones FC
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

  // En-tête sessions
  const dateA = new Date(a.date + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'long' });
  const dateB = new Date(b.date + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'long' });

  el.innerHTML = `
    <div style="display:flex;gap:12px;margin-bottom:14px;flex-wrap:wrap">
      <div style="flex:1;min-width:140px;padding:10px 12px;border-radius:8px;background:rgba(59,130,246,0.07);border:1px solid rgba(59,130,246,0.2)">
        <div style="font-size:10px;font-weight:700;color:#3b82f6;text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px">A</div>
        <div style="font-size:13px;font-weight:600">${a.name || 'Course'}</div>
        <div style="font-size:11px;color:var(--muted)">${dateA}</div>
      </div>
      <div style="flex:1;min-width:140px;padding:10px 12px;border-radius:8px;background:rgba(249,115,22,0.07);border:1px solid rgba(249,115,22,0.2)">
        <div style="font-size:10px;font-weight:700;color:#f97316;text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px">B</div>
        <div style="font-size:13px;font-weight:600">${b.name || 'Course'}</div>
        <div style="font-size:11px;color:var(--muted)">${dateB}</div>
      </div>
    </div>
    <table class="compare-table"><tbody>${rows}</tbody></table>
    ${zonesHtml}`;
}

/* ── Fermer le modal KPI avec la touche Escape ── */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeKpiModal();
});

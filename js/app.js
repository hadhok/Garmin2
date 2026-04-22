/* ══════════════════════════════════════════════════════════
   APP.JS — State, constants, data loading, shared utilities
   ══════════════════════════════════════════════════════════ */

/* ── Global activity map for detail modal ── */
const ACT_MAP = {};

/* ── Application state ── */
const state = {
  view:               'dashboard',  // dashboard | activities | health | profile
  tab:                'week',       // day | week | month | year (within dashboard)
  offset:             0,
  filter:             'all',
  data:               null,
  wellness:           null,
  healthDays:         30,
  profileGranularity: 'month',
};

const TODAY = new Date();

/* ── Type colors ── */
const TYPE_COLOR = {
  run:       '#22c55e',
  swim:      '#3b82f6',
  hiit:      '#f97316',
  rowing:    '#06b6d4',
  jump_rope: '#a855f7',
  strength:  '#ef4444',
  cardio:    '#f43f5e',
  hockey:    '#64748b',
  tennis:    '#84cc16',
  padel:     '#10b981',
  bike:      '#f59e0b',
  walk:      '#06b6d4',
  pilates:   '#e879f9',
  yoga:      '#7c3aed',
  hike:      '#84cc16',
  ski:       '#93c5fd',
  sup:       '#0ea5e9',
  other:     '#64748b',
};

const TYPE_LABEL = {
  run:'Course', swim:'Natation', hiit:'HIIT', rowing:'Rameur',
  jump_rope:'Jump Rope', strength:'Muscu', cardio:'Cardio',
  hockey:'Hockey', tennis:'Tennis', padel:'Padel', bike:'Vélo',
  walk:'Marche', pilates:'Pilates', yoga:'Yoga', hike:'Rando',
  ski:'Ski', sup:'SUP', other:'Autre',
};

const MONTHS_FR = ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];
const MONTHS_LONG = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
const DAYS_FR = ['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'];

/* ── Chart.js defaults ── */
Chart.defaults.color        = '#64748b';
Chart.defaults.borderColor  = '#2a2a2a';
Chart.defaults.font.family  = "Inter, system-ui, -apple-system, sans-serif";
Chart.defaults.font.size    = 11;

const CHARTS = {};
function mkChart(id, cfg) {
  if (CHARTS[id]) { CHARTS[id].destroy(); }
  const el = document.getElementById(id);
  if (!el) return;
  CHARTS[id] = new Chart(el, cfg);
}

/* ── Format duration ── */
function fmt_dur(min) {
  if (!min) return '–';
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h > 0 ? `${h}h${m.toString().padStart(2,'0')}` : `${m} min`;
}

/* ══════════════════════════════════════════════════════════
   DATA LOADING
   ══════════════════════════════════════════════════════════ */
async function loadData() {
  try {
    const r = await fetch('/api/activities');
    if (!r.ok) throw new Error('not found');
    state.data = await r.json();
    const ls = state.data.last_sync ? state.data.last_sync.slice(0,16).replace('T',' ') : '–';
    const labelEl = document.getElementById('sync-label');
    if (labelEl) labelEl.textContent = `Synchro : ${ls}`;
    const dotEl = document.getElementById('sync-dot');
    if (dotEl) dotEl.classList.remove('syncing');
  } catch {
    const labelEl = document.getElementById('sync-label');
    if (labelEl) labelEl.textContent = 'Mode démo';
  }
}

async function loadWellness() {
  try {
    const r = await fetch('/api/wellness');
    if (r.ok) state.wellness = await r.json();
  } catch {}
}

async function loadCoach() {
  try {
    const r = await fetch('/coach.json?v=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) return;
    const data = await r.json();
    const section = document.getElementById('coach-section');
    const dateEl  = document.getElementById('coach-date');
    const itemsEl = document.getElementById('coach-items');
    if (!section || !data.items?.length) return;

    if (dateEl && data.updated_at) {
      const d = new Date(data.updated_at + 'T12:00:00');
      dateEl.textContent = 'Mis à jour le ' + d.toLocaleDateString('fr-FR',{day:'numeric',month:'long',year:'numeric'});
    }

    itemsEl.innerHTML = data.items.map(item => `
      <div class="coach-item ${item.type||'tip'}">
        <div class="coach-item-header">
          <span class="coach-item-icon">${item.icon||'💬'}</span>
          <span class="coach-item-title">${item.title||''}</span>
        </div>
        <div class="coach-item-text">${item.text||''}</div>
      </div>`).join('');
    section.style.display = '';
  } catch {}
}

/* ══════════════════════════════════════════════════════════
   PERIOD HELPERS
   ══════════════════════════════════════════════════════════ */
function startOfDay(d)  { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function endOfDay(d)    { return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59); }
function startOfWeek(d) {
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1 - day);
  return startOfDay(new Date(d.getFullYear(), d.getMonth(), d.getDate() + diff));
}
function endOfWeek(d) {
  const s = startOfWeek(d);
  return endOfDay(new Date(s.getFullYear(), s.getMonth(), s.getDate() + 6));
}

function getPeriodBounds() {
  const d = new Date(TODAY);
  if (state.tab === 'day') {
    d.setDate(d.getDate() + state.offset);
    return { start: startOfDay(d), end: endOfDay(d) };
  }
  if (state.tab === 'week') {
    d.setDate(d.getDate() + state.offset * 7);
    return { start: startOfWeek(d), end: endOfWeek(d) };
  }
  if (state.tab === 'month') {
    d.setMonth(d.getMonth() + state.offset);
    return { start: new Date(d.getFullYear(), d.getMonth(), 1), end: new Date(d.getFullYear(), d.getMonth()+1, 0, 23, 59, 59) };
  }
  const y = TODAY.getFullYear() + state.offset;
  return { start: new Date(y, 0, 1), end: new Date(y, 11, 31, 23, 59, 59) };
}

function formatPeriodLabel() {
  const { start, end } = getPeriodBounds();
  const fmt = (d) => `${d.getDate()} ${MONTHS_FR[d.getMonth()]}`;
  if (state.tab === 'day')   return `${DAYS_FR[(start.getDay()+6)%7]} ${fmt(start)} ${start.getFullYear()}`;
  if (state.tab === 'week')  return `${fmt(start)} – ${fmt(end)} ${end.getFullYear()}`;
  if (state.tab === 'month') return `${MONTHS_LONG[start.getMonth()]} ${start.getFullYear()}`;
  return `${start.getFullYear()}`;
}

/* ══════════════════════════════════════════════════════════
   ACTIVITY ACCESS
   ══════════════════════════════════════════════════════════ */
function getAll() {
  if (state.data?.activities) return state.data.activities;
  return MOCK_ACTIVITIES;
}

function getFiltered() {
  const { start, end } = getPeriodBounds();
  return getAll().filter(a => {
    const d = new Date(a.start_time);
    if (d < start || d > end) return false;
    if (state.filter !== 'all' && a.type !== state.filter) return false;
    return true;
  });
}

function getPrevFiltered() {
  const saved = state.offset;
  state.offset = saved - 1;
  const prev = getFiltered();
  state.offset = saved;
  return prev;
}

/* ══════════════════════════════════════════════════════════
   KPI COMPUTATION
   ══════════════════════════════════════════════════════════ */
function computeKPIs(acts) {
  const withHR = acts.filter(a => a.hr_avg);
  return {
    activities:    acts.length,
    distance:      acts.reduce((s,a) => s + (a.distance_km||0), 0),
    duration:      acts.reduce((s,a) => s + (a.duration_min||0), 0),
    calories:      acts.reduce((s,a) => s + (a.calories||0), 0),
    elevation:     acts.reduce((s,a) => s + (a.elevation_m||0), 0),
    training_load: acts.reduce((s,a) => s + (a.training_load||0), 0),
    intensity_min: acts.reduce((s,a) => s + (a.intensity_min||0), 0),
    hr_avg:        withHR.length ? Math.round(withHR.reduce((s,a)=>s+a.hr_avg,0)/withHR.length) : null,
    vo2max:        acts.find(a=>a.vo2max)?.vo2max ?? null,
  };
}

function renderKPIs(containerId, acts, prevActs=null) {
  const k     = computeKPIs(acts);
  const prevK = prevActs ? computeKPIs(prevActs) : null;

  function delta(cur, prev) {
    if (!prevK || !prev || prev === 0) return '';
    const pct = ((cur - prev) / prev) * 100;
    if (Math.abs(pct) < 1) return '<div class="kpi-delta flat">→ =</div>';
    if (pct > 0) return `<div class="kpi-delta up">▲ +${pct.toFixed(0)}%</div>`;
    return `<div class="kpi-delta down">▼ ${pct.toFixed(0)}%</div>`;
  }

  const h = (label, val, unit='', sub='', deltaHtml='') => `
    <div class="kpi-card">
      <div class="kpi-label">${label}</div>
      <div class="kpi-value">${val}<span class="kpi-unit">${unit}</span></div>
      ${sub ? `<div class="kpi-delta">${sub}</div>` : ''}
      ${deltaHtml}
    </div>`;

  const dur  = k.duration >= 60
    ? `${Math.floor(k.duration/60)}h${String(Math.round(k.duration%60)).padStart(2,'0')}`
    : `${Math.round(k.duration)}min`;
  const load = k.training_load > 0 ? Math.round(k.training_load) : '–';
  const iMin = k.intensity_min > 0 ? k.intensity_min : '–';

  document.getElementById(containerId).innerHTML =
    h('Activités',     k.activities,                                   '',    '', delta(k.activities, prevK?.activities)) +
    h('Distance',      k.distance.toFixed(1),                         'km',  '', delta(k.distance, prevK?.distance)) +
    h('Temps actif',   dur,                                            '',    '', delta(k.duration, prevK?.duration)) +
    h('Calories',      Math.round(k.calories).toLocaleString('fr'),   'kcal','', delta(k.calories, prevK?.calories)) +
    h('Charge totale', load,                                           'pts', '', k.training_load > 0 ? delta(k.training_load, prevK?.training_load) : '') +
    h('Min intensité', iMin,                                           'min', '', k.intensity_min > 0 ? delta(k.intensity_min, prevK?.intensity_min) : '') +
    h('Dénivelé +',    Math.round(k.elevation),                       'm',   '', delta(k.elevation, prevK?.elevation)) +
    (k.hr_avg  ? h('FC moy.',  k.hr_avg,  'bpm') : '') +
    (k.vo2max  ? h('VO2max',   k.vo2max,  'ml/kg') : '');
}

/* ── Zones cardio ── */
function computeZones(acts) {
  const withZ = acts.filter(a => a.hr_zones_pct?.length === 5);
  if (!withZ.length) return null;
  const totals = [0,0,0,0,0];
  let totalDur = 0;
  withZ.forEach(a => {
    const dur = a.duration_min || 1;
    a.hr_zones_pct.forEach((pct,i) => { totals[i] += pct * dur; });
    totalDur += dur;
  });
  return totals.map(t => Math.round(t / totalDur));
}

function renderZones(containerId, pcts) {
  const colors = ['#3b82f6','#22c55e','#f59e0b','#f97316','#ef4444'];
  const labels = ['Z1 Récup.','Z2 Endur.','Z3 Aérobie','Z4 Seuil','Z5 Maxi'];
  document.getElementById(containerId).innerHTML = pcts.map((p,i) => `
    <div class="zone-row">
      <div class="zone-label">${labels[i]}</div>
      <div class="zone-bar-bg"><div class="zone-bar-fill" style="width:${p}%;background:${colors[i]}"></div></div>
      <div class="zone-pct">${p}%</div>
    </div>`).join('');
}

/* ── Type badge HTML ── */
function typeBadge(type, label) {
  const lbl = label || TYPE_LABEL[type] || type;
  return `<span class="badge badge-${type||'other'}">${lbl}</span>`;
}

/* ══════════════════════════════════════════════════════════
   ACTIVITY DETAIL MODAL
   ══════════════════════════════════════════════════════════ */
function openDetail(id) {
  const a = ACT_MAP[id]; if (!a) return;
  const dateStr = a.date ? new Date(a.date+'T12:00:00').toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long',year:'numeric'}) : '';

  const icon = document.getElementById('detail-icon');
  icon.textContent = a.icon || '⚡';
  icon.className = `detail-icon act-icon ${a.type||'other'}`;
  document.getElementById('detail-name').textContent = a.name || a.type_label;
  document.getElementById('detail-meta').textContent = [dateStr, a.type_label].filter(Boolean).join(' · ');

  const stats = [];
  if (a.duration_min)  stats.push({l:'Durée',     v: fmt_dur(a.duration_min), u:''});
  if (a.distance_km>0) stats.push({l:'Distance',  v: a.distance_km,           u:'km'});
  if (a.calories)      stats.push({l:'Calories',  v: Math.round(a.calories),  u:'kcal'});
  if (a.hr_avg)        stats.push({l:'FC moy.',   v: a.hr_avg,                u:'bpm'});
  if (a.hr_max)        stats.push({l:'FC max',    v: a.hr_max,                u:'bpm'});
  if (a.elevation_m>0) stats.push({l:'Dénivelé+', v: Math.round(a.elevation_m),u:'m'});
  if (a.pace_min_km)   stats.push({l:'Allure',    v: a.pace_min_km,           u:'/km'});
  if (a.speed_kmh)     stats.push({l:'Vitesse',   v: a.speed_kmh,             u:'km/h'});
  if (a.vo2max)        stats.push({l:'VO2max',    v: a.vo2max,                u:''});

  document.getElementById('detail-stats').innerHTML = stats.map(s =>
    `<div class="detail-stat">
      <div class="detail-stat-label">${s.l}</div>
      <div class="detail-stat-value">${s.v}<span class="detail-stat-unit"> ${s.u}</span></div>
    </div>`).join('');

  const tRows = [];
  if (a.training_load > 0) tRows.push(['Charge totale',   `${Math.round(a.training_load)} pts`]);
  if (a.aerobic_te   > 0) tRows.push(['Effet aérobie',   `${a.aerobic_te.toFixed(1)} / 5`]);
  if (a.anaerobic_te > 0) tRows.push(['Effet anaérobie', `${a.anaerobic_te.toFixed(1)} / 5`]);
  if (a.te_label)          tRows.push(['Catégorie',       a.te_label]);
  if (a.intensity_min > 0) tRows.push(['Min intensité',  `${a.intensity_min} min`]);

  const tWrap = document.getElementById('detail-training');
  if (tRows.length) {
    document.getElementById('detail-training-rows').innerHTML = tRows.map(([l,v]) =>
      `<div class="detail-row"><span class="detail-row-label">${l}</span><span class="detail-row-value">${v}</span></div>`).join('');
    tWrap.style.display = '';
  } else { tWrap.style.display = 'none'; }

  const zWrap = document.getElementById('detail-zones-wrap');
  if (a.hr_zones_pct?.length === 5) {
    const colors = ['#3b82f6','#22c55e','#f59e0b','#f97316','#ef4444'];
    const labels = ['Z1 Récupération','Z2 Endurance','Z3 Aérobie','Z4 Seuil','Z5 Maxi'];
    document.getElementById('detail-zones').innerHTML = a.hr_zones_pct.map((p,i) =>
      `<div class="zone-row">
        <div class="zone-label">${labels[i]}</div>
        <div class="zone-bar-bg"><div class="zone-bar-fill" style="width:${p}%;background:${colors[i]}"></div></div>
        <div class="zone-pct">${p}%</div>
      </div>`).join('');
    zWrap.style.display = '';
  } else { zWrap.style.display = 'none'; }

  document.getElementById('detail-modal').classList.add('open');
}

function closeDetail() {
  document.getElementById('detail-modal').classList.remove('open');
}

/* ══════════════════════════════════════════════════════════
   SYNC MODAL
   ══════════════════════════════════════════════════════════ */
function openSyncModal()  {
  document.getElementById('sync-modal').classList.add('open');
}
function closeSyncModal() {
  document.getElementById('sync-modal').classList.remove('open');
  document.getElementById('sync-log').style.display = 'none';
}

async function runSync() {
  const btn = document.getElementById('sync-submit');
  const log = document.getElementById('sync-log');
  btn.disabled = true;
  btn.textContent = 'Synchro en cours…';
  log.style.display = 'block';
  log.textContent = 'Connexion via tokens sauvegardés…';
  const dots = document.querySelectorAll('.sync-dot');
  dots.forEach(d => d.classList.add('syncing'));

  try {
    const r = await fetch('/api/sync', { method:'POST', headers:{'Content-Type':'application/json'} });
    const data = await r.json();
    if (data.status === 'ok') {
      log.textContent = data.message;
      showToast(`Synchro OK — ${data.total||''} activités`, 'ok');
      closeSyncModal();
      await Promise.all([loadData(), loadWellness()]);
      renderAll();
    } else {
      log.textContent = data.message;
      showToast('Erreur de synchro', 'err');
    }
  } catch {
    log.textContent = 'Serveur inaccessible. Lance : python3 server.py';
    showToast('Serveur non démarré', 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Synchroniser';
    dots.forEach(d => d.classList.remove('syncing'));
  }
}

/* ══════════════════════════════════════════════════════════
   TOAST
   ══════════════════════════════════════════════════════════ */
function showToast(msg, type='ok') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast ${type} show`;
  setTimeout(() => t.classList.remove('show'), 3500);
}

/* ══════════════════════════════════════════════════════════
   NAVIGATION
   ══════════════════════════════════════════════════════════ */
function switchView(view) {
  state.view = view;

  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.view === view);
  });
  document.querySelectorAll('.bottom-nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.view === view);
  });
  document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
  const viewEl = document.getElementById('view-' + view);
  if (viewEl) viewEl.classList.add('active');

  const titles = { dashboard:'Dashboard', activities:'Activités', health:'Santé', profile:'Profil' };
  const titleEl = document.getElementById('topbar-title');
  if (titleEl) titleEl.textContent = titles[view] || view;

  renderAll();
}

function switchSubTab(tab) {
  state.tab = tab;
  state.offset = 0;
  document.querySelectorAll('.subtab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  renderAll();
}

function movePeriod(dir) { state.offset += dir; renderAll(); }
function resetPeriod()   { state.offset = 0;    renderAll(); }

function setFilter(type) {
  state.filter = type;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.toggle('active', b.dataset.type === type));
  renderAll();
}

/* ══════════════════════════════════════════════════════════
   RENDER DISPATCHER
   ══════════════════════════════════════════════════════════ */
function renderAll() {
  if (state.view === 'health')     { renderHealth();     return; }
  if (state.view === 'profile')    { renderProfile();    return; }
  if (state.view === 'activities') { renderActivities(); return; }

  /* Dashboard */
  document.getElementById('period-label').textContent = formatPeriodLabel();
  renderDashboard();
}

/* ══════════════════════════════════════════════════════════
   MOCK ACTIVITIES (fallback when no server)
   ══════════════════════════════════════════════════════════ */
const MOCK_ACTIVITIES = [
  {id:1, name:"Sortie longue",     type:"run",      icon:"🏃", date:"2026-04-19", start_time:"2026-04-19T07:00:00", duration_min:58,  distance_km:12.4, calories:634,  hr_avg:148, hr_max:172, elevation_m:87,  training_load:85,  aerobic_te:3.8, te_label:"Amélioration aérobie", hr_zones_pct:[10,35,28,20,7]},
  {id:2, name:"Muscu haut corps",  type:"strength", icon:"🏋️", date:"2026-04-18", start_time:"2026-04-18T18:30:00", duration_min:55,  distance_km:0,    calories:310,  hr_avg:125, hr_max:148, elevation_m:0,   training_load:42},
  {id:3, name:"Fractionné 10x400m",type:"run",      icon:"🏃", date:"2026-04-17", start_time:"2026-04-17T07:15:00", duration_min:40,  distance_km:8.1,  calories:490,  hr_avg:168, hr_max:185, elevation_m:22,  training_load:95,  aerobic_te:4.5, te_label:"Amélioration VO2max", hr_zones_pct:[5,15,18,32,30]},
  {id:4, name:"Natation endurance",type:"swim",     icon:"🏊", date:"2026-04-16", start_time:"2026-04-16T12:00:00", duration_min:48,  distance_km:2.4,  calories:420,  hr_avg:128, hr_max:145, elevation_m:0,   training_load:55},
  {id:5, name:"Vélo route",        type:"bike",     icon:"🚴", date:"2026-04-15", start_time:"2026-04-15T09:00:00", duration_min:72,  distance_km:38.4, calories:820,  hr_avg:138, hr_max:162, elevation_m:420, training_load:78},
  {id:6, name:"Course facile",     type:"run",      icon:"🏃", date:"2026-04-14", start_time:"2026-04-14T07:00:00", duration_min:52,  distance_km:10.2, calories:580,  hr_avg:138, hr_max:158, elevation_m:55,  training_load:62},
  {id:7, name:"Rando Pyrénées",    type:"hike",     icon:"🥾", date:"2026-04-13", start_time:"2026-04-13T08:00:00", duration_min:195, distance_km:18.6, calories:1180, hr_avg:118, hr_max:145, elevation_m:980, training_load:110},
  {id:8, name:"10km tempo",        type:"run",      icon:"🏃", date:"2026-04-10", start_time:"2026-04-10T07:00:00", duration_min:44,  distance_km:10.0, calories:540,  hr_avg:162, hr_max:178, elevation_m:38,  training_load:88},
  {id:9, name:"Vélo 60km",         type:"bike",     icon:"🚴", date:"2026-04-08", start_time:"2026-04-08T09:00:00", duration_min:95,  distance_km:54.2, calories:1080, hr_avg:142, hr_max:168, elevation_m:610, training_load:102},
  {id:10,name:"Muscu jambes",      type:"strength", icon:"🏋️", date:"2026-04-04", start_time:"2026-04-04T18:30:00", duration_min:52,  distance_km:0,    calories:305,  hr_avg:128, hr_max:150, elevation_m:0,   training_load:40},
];

/* ══════════════════════════════════════════════════════════
   INIT
   ══════════════════════════════════════════════════════════ */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/service-worker.js').catch(() => {});
}

async function init() {
  await Promise.all([loadData(), loadWellness(), loadCoach()]);
  renderAll();
}

init();

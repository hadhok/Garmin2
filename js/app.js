/* ══════════════════════════════════════════════════════════
   APP.JS — State, constants, data loading, shared utilities
   ══════════════════════════════════════════════════════════ */

/* ── Global activity map for detail modal ── */
const ACT_MAP = {};

/* ── Auth API : injecte X-App-Key sur tous les appels /api/*
   (clé saisie dans Profil → Paramètres, doit correspondre à
   la variable d'env APP_API_KEY sur Vercel) ── */
const _origFetch = window.fetch.bind(window);
window.fetch = (url, opts = {}) => {
  if (typeof url === 'string' && url.startsWith('/api/')) {
    const key = localStorage.getItem('app_api_key');
    if (key) opts = { ...opts, headers: { ...(opts.headers || {}), 'X-App-Key': key } };
  }
  return _origFetch(url, opts);
};

/* ── Application state ── */
const state = {
  view:               'today',      // today | training | recovery | history | profile
  tab:                'week',       // day | week | month | year | course (within training)
  offset:             0,
  filter:             'all',
  data:               null,
  wellness:           null,
  healthDays:         30,
  profileGranularity: 'month',
};

const TODAY = new Date();

/* ── Type colors ── */

const MONTHS_FR = ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];
const MONTHS_LONG = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];

/* ── Thème clair / sombre ── */
function isDarkTheme() {
  const t = document.documentElement.dataset.theme;
  if (t === 'dark')  return true;
  if (t === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyChartTheme() {
  /* Chart peut manquer si le CDN n'a pas chargé (offline 1re visite) —
     l'app doit rester utilisable sans graphiques */
  if (typeof Chart !== 'undefined') {
    Chart.defaults.color       = isDarkTheme() ? '#94a3b8' : '#6b7280';
    Chart.defaults.borderColor = isDarkTheme() ? '#2a2f3a' : '#e5e7eb';
  }
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.textContent = isDarkTheme() ? '☀️' : '🌙';
}

function toggleTheme() {
  const next = isDarkTheme() ? 'light' : 'dark';
  localStorage.setItem('theme', next);
  document.documentElement.dataset.theme = next;
  applyChartTheme();
  markAllDirty();
  renderAll();
}

/* Applique le thème sauvegardé le plus tôt possible (avant les renders) */
(() => {
  const saved = localStorage.getItem('theme');
  if (saved === 'dark' || saved === 'light') document.documentElement.dataset.theme = saved;
})();

/* ── Chart.js defaults ── */
if (typeof Chart !== 'undefined') {
  Chart.defaults.font.family = "Inter, system-ui, -apple-system, sans-serif";
  Chart.defaults.font.size   = 11;
}
applyChartTheme();

const CHARTS = {};
function mkChart(id, cfg) {
  if (typeof Chart === 'undefined') return; // CDN non chargé
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
function cacheGet(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL_MS) { localStorage.removeItem(key); return null; }
    return data;
  } catch { return null; }
}

function cacheSet(key, data) {
  try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data })); } catch {}
}

function cacheClear() {
  ['cache_activities','cache_wellness'].forEach(k => localStorage.removeItem(k));
}

async function loadData() {
  try {
    const cached = cacheGet('cache_activities');
    if (cached) {
      state.data = cached;
    } else {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const r = await fetch('/api/activities', { signal: controller.signal });
        clearTimeout(timeout);
        if (!r.ok) throw new Error('not found');
        state.data = await r.json();
        cacheSet('cache_activities', state.data);
      } catch (e) {
        clearTimeout(timeout);
        throw e;
      }
    }
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
    const cached = cacheGet('cache_wellness');
    if (cached) { state.wellness = cached; return; }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const r = await fetch('/api/wellness', { signal: controller.signal });
      clearTimeout(timeout);
      if (r.ok) { state.wellness = await r.json(); cacheSet('cache_wellness', state.wellness); }
    } catch (e) {
      clearTimeout(timeout);
      throw e;
    }
  } catch {}
}

function _renderCoachItems(sectionId, dateId, itemsId, data) {
  try {
    const section = document.getElementById(sectionId);
    if (!section) return;
    if (!data.items?.length) { section.style.display = 'none'; return; }

    const dateEl  = document.getElementById(dateId);
    const itemsEl = document.getElementById(itemsId);
    if (!itemsEl) return;

    if (dateEl && data.updated_at) {
      const d = new Date(data.updated_at);
      const dateStr = d.toLocaleDateString('fr-FR', {day:'numeric', month:'long'});
      const timeStr = d.toLocaleTimeString('fr-FR', {hour:'2-digit', minute:'2-digit'});
      dateEl.textContent = `${dateStr} à ${timeStr}`;
    }

    // Coach name
    const nameEl = section.querySelector('.coach-name');
    if (nameEl && data.coach) nameEl.textContent = 'par ' + data.coach;

    // Snapshot pills
    const snap   = data.stats_snapshot || {};
    const snapEl = document.getElementById(itemsId.replace('coach-items', 'coach-snap'));
    // Sanitize HTML content to prevent XSS
    const escape = escapeHTML; /* sanit.js */

    if (snapEl) {
      const PHASE = { progression:'En progression 📈', recovery:'Récupération 🔄', peak:'Pic de forme 🔥', base:'Construction 💪', maintenance:'Maintien ⚖️' };
      const FATIGUE_LBL   = { fresh:'Frais', normal:'Normal', tired:'Fatigué', very_tired:'Très fatigué' };
      const FATIGUE_COLOR = { fresh:'#22c55e', normal:'#6b7280', tired:'#d97706', very_tired:'#dc2626' };
      const tsbColor = snap.tsb == null ? '#6b7280' : snap.tsb < -20 ? '#dc2626' : snap.tsb < -5 ? '#d97706' : snap.tsb > 5 ? '#3b82f6' : '#22c55e';
      const bbColor  = snap.body_battery == null ? '#6b7280' : snap.body_battery < 25 ? '#dc2626' : snap.body_battery < 50 ? '#d97706' : '#22c55e';

      const pills = [];
      if (snap.phase)           pills.push(['Phase',        PHASE[snap.phase] || snap.phase,                              '#6b7280']);
      if (snap.tsb != null)     pills.push(['TSB',          (snap.tsb > 0 ? '+' : '') + snap.tsb,                        tsbColor]);
      if (snap.fatigue_level)   pills.push(['Fatigue',      FATIGUE_LBL[snap.fatigue_level] || snap.fatigue_level,       FATIGUE_COLOR[snap.fatigue_level] || '#6b7280']);
      if (snap.body_battery != null) pills.push(['Body Battery', Math.round(snap.body_battery) + '%',                    bbColor]);

      snapEl.innerHTML = pills.map(([lbl, val, color]) => {
        const safeLbl = escape(lbl);
        const safeVal = escape(val);
        const safeColor = /^#[0-9a-f]{6}$/i.test(color) ? color : '#6b7280';
        return `<div class="coach-snap-pill"><span class="coach-snap-lbl">${safeLbl}</span><span class="coach-snap-val" style="color:${safeColor}">${safeVal}</span></div>`;
      }).join('');
      snapEl.style.display = pills.length ? 'flex' : 'none';
    }

    itemsEl.innerHTML = data.items.map(item => {
      const safeTitle = escape(item.title || '');
      const safeText = escape(item.text || '').replace(/\n/g, '<br>');
      const safeIcon = escape(item.icon || '💬');
      const safeType = /^(tip|warning|goal)$/.test(item.type) ? item.type : 'tip';
      return `
        <div class="coach-item ${safeType}">
          <div class="coach-item-header">
            <span class="coach-item-icon">${safeIcon}</span>
            <span class="coach-item-title">${safeTitle}</span>
          </div>
          <div class="coach-item-text">${safeText}</div>
        </div>`;
    }).join('');
    section.style.display = '';
  } catch(e) { console.warn('coach render error', sectionId, e); }
}

async function triggerCoachUpdate(btn) {
  if (btn) { btn.textContent = '⏳'; btn.disabled = true; }
  try {
    const r = await fetch('/api/trigger-coach', { method: 'POST' });
    const data = await r.json();
    if (r.ok) {
      showToast('Mise à jour du coach lancée (~1 min)', 'ok');
    } else {
      showToast('Erreur : ' + (data.error || 'inconnue'), 'err');
    }
  } catch(e) {
    showToast('Erreur de connexion', 'err');
  } finally {
    if (btn) { btn.textContent = '🔄'; btn.disabled = false; }
  }
}

async function loadCoach() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const r = await fetch('/api/coach', { cache: 'no-store', signal: controller.signal });
      clearTimeout(timeout);
      if (!r.ok) return;
      const data = await r.json();
      /* Populate both dashboard and profile coach sections independently */
      _renderCoachItems('coach-section-dash', 'coach-date-dash', 'coach-items-dash', data);
      _renderCoachItems('coach-section',      'coach-date',      'coach-items',      data);
    } catch (e) {
      clearTimeout(timeout);
      throw e;
    }
  } catch(e) { console.warn('loadCoach error', e); }
}

/* ══════════════════════════════════════════════════════════
   PERIOD HELPERS
   ══════════════════════════════════════════════════════════ */
function startOfDay(d)  { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function endOfDay(d)    { return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59); }
function localIso(d)    { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
const TODAY_ISO = localIso(TODAY);
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
   FC REPOS / FC MAX — auto-détection depuis les données Garmin
   Priorité : override manuel (Profil) → donnée Garmin → défaut
   ══════════════════════════════════════════════════════════ */
function getHRRest() {
  const manual = parseInt(localStorage.getItem('hr_rest'));
  if (manual >= 30 && manual <= 90) return manual;
  /* Auto : dernière FC repos remontée par Garmin */
  const days = Object.values(state.wellness?.days || {})
    .filter(d => d.date && d.resting_hr >= 30 && d.resting_hr <= 90)
    .sort((a, b) => b.date.localeCompare(a.date));
  if (days.length) return Math.round(days[0].resting_hr);
  return 62;
}

function getHRMax() {
  const manual = parseInt(localStorage.getItem('hr_max'));
  if (manual >= 140 && manual <= 220) return manual;
  /* Auto : FC max observée sur les activités des 12 derniers mois */
  const cutoff = new Date(TODAY);
  cutoff.setFullYear(cutoff.getFullYear() - 1);
  let max = 0;
  getAll().forEach(a => {
    if (a.hr_max > max && new Date(a.start_time || a.date) >= cutoff) max = a.hr_max;
  });
  if (max >= 140 && max <= 220) return Math.round(max);
  return 177;
}

/* ══════════════════════════════════════════════════════════
   TRIMP — global (toutes activités avec FC)
   Banister (1991) : durée × ratio_FC × 0.64 × exp(1.92 × ratio_FC)
   ══════════════════════════════════════════════════════════ */
function computeTRIMP(act) {
  if (!act.hr_avg || !act.duration_min) return 0;
  const HR_REST = getHRRest();
  const HR_MAX  = getHRMax();
  if (HR_MAX <= HR_REST + 20) return 0; // paramètres incohérents — silently bail
  const ratio = (act.hr_avg - HR_REST) / (HR_MAX - HR_REST);
  if (ratio <= 0 || ratio > 1.5) return 0;
  return Math.round(act.duration_min * ratio * 0.64 * Math.exp(1.92 * ratio));
}

/* Daily TRIMP map for all activities with HR data */
function buildTRIMPMap(activities) {
  const map = {};
  (activities || getAll()).forEach(a => {
    const d = (a.date || a.start_time || '').slice(0, 10);
    if (d) map[d] = (map[d] || 0) + computeTRIMP(a);
  });
  return map;
}

/* ══════════════════════════════════════════════════════════
   UNIFIED FORME CURVE — CTL / ATL / TSB
   Même formule partout : EMA k=1/42 (CTL) et k=1/7 (ATL)
   Source de charge : TRIMP (toutes activités avec FC)
   ══════════════════════════════════════════════════════════ */
function computeFormeCurve(acts, nDays = 90) {
  const loadMap = buildTRIMPMap(acts || getAll());
  const result = [];
  let ctl = 0, atl = 0;
  const warmup = nDays + 90;
  for (let i = warmup; i >= 0; i--) {
    const d = new Date(TODAY); d.setDate(d.getDate() - i);
    const iso = localIso(d);
    const load = loadMap[iso] || 0;
    ctl = ctl + (load - ctl) / 42;
    atl = atl + (load - atl) / 7;
    if (i < nDays) result.push({ date: iso, ctl: +ctl.toFixed(1), atl: +atl.toFixed(1), tsb: +(ctl - atl).toFixed(1) });
  }
  return result;
}

/* ══════════════════════════════════════════════════════════
   UNIFIED RECOVERY SCORE (0–100)
   HRV 30% · FC repos 25% · Body Battery 25% · Sommeil 20%
   Chaque composante normalisée vs baseline 28j
   ══════════════════════════════════════════════════════════ */
function computeRecoveryScoreDay(today, last28) {
  if (!today || !last28?.length) return null;
  function avg(fn) {
    const v = last28.map(fn).filter(x => x != null && !isNaN(x));
    return v.length ? v.reduce((s,x)=>s+x,0)/v.length : null;
  }
  const b = { hrv: avg(d=>d.hrv_rmssd||d.hrv_weekly_avg), hr: avg(d=>d.resting_hr), bb: avg(d=>d.body_battery_high), sleep: avg(d=>d.sleep_duration_h) };
  const sc = [];
  if (b.hrv  && b.hrv > 0 && today.hrv_rmssd)       sc.push({ s: Math.min(100,Math.max(0, 50 + (today.hrv_rmssd - b.hrv) / b.hrv * 150)),         w: 0.30 });
  if (b.hr   && b.hr > 0  && today.resting_hr)      sc.push({ s: Math.min(100,Math.max(0, 50 - (today.resting_hr - b.hr)  / b.hr  * 150)),         w: 0.25 });
  if (today.body_battery_high != null) sc.push({ s: today.body_battery_high,                                                            w: 0.25 });
  if (today.sleep_duration_h  != null) sc.push({ s: Math.min(100,Math.max(0, 50 + (today.sleep_duration_h - 7.5) / 1.5 * 50)),         w: 0.20 });
  if (!sc.length) return null;
  const tw = sc.reduce((s,x)=>s+x.w, 0);
  return Math.round(sc.reduce((s,x)=>s+x.s*x.w, 0) / tw);
}

/* ══════════════════════════════════════════════════════════
   UNIFIED DAILY RECOMMENDATION
   Arbitre HRV vs ACWR vs recovery
   Retourne { reco, reasons, conflicts, acwrVal, hrvSignal, hrvDetail, recovScore }
   ══════════════════════════════════════════════════════════ */
function computeDailyReco() {
  const allActs = getAll();
  const well    = state.wellness?.days;

  /* ACWR */
  let acwrVal = null;
  if (allActs.length) {
    const map = buildTRIMPMap(allActs);
    const tSum = (end, n) => { let s=0; for(let i=0;i<n;i++){const d=new Date(end);d.setDate(d.getDate()-i);s+=map[localIso(d)]||0;} return s; };
    const al = tSum(TODAY,7)/7, cl = tSum(TODAY,28)/28;
    if (cl > 0.5) acwrVal = +(al/cl).toFixed(2);
  }

  /* HRV signal */
  let hrvSignal = null, hrvDetail = null;
  if (well) {
    const wDays = Object.values(well).filter(d=>d.date&&(d.hrv_rmssd||d.hrv_weekly_avg)).sort((a,b)=>a.date.localeCompare(b.date));
    if (wDays.length >= 14) {
      const hrv = d => d.hrv_rmssd||d.hrv_weekly_avg||null;
      const r7 = wDays.slice(-7).map(hrv).filter(v=>v!=null);
      const b28= wDays.slice(-28).map(hrv).filter(v=>v!=null);
      if (r7.length && b28.length) {
        const r7m  = r7.reduce((s,v)=>s+v,0)/r7.length;
        const mean = b28.reduce((s,v)=>s+v,0)/b28.length;
        const sd   = Math.sqrt(b28.reduce((s,v)=>s+(v-mean)**2,0)/b28.length) || 1;
        hrvDetail  = { r7:+r7m.toFixed(1), mean:+mean.toFixed(1), upSD:+(mean+0.5*sd).toFixed(1), downSD:+(mean-0.5*sd).toFixed(1) };
        hrvSignal  = r7m >= mean+0.5*sd ? 'green' : r7m <= mean-0.5*sd ? 'red' : 'orange';
      }
    }
  }

  /* Recovery score */
  let recovScore = null;
  if (well) {
    const wDays = Object.values(well).filter(d=>d.date).sort((a,b)=>a.date.localeCompare(b.date));
    recovScore = computeRecoveryScoreDay(wDays[wDays.length-1], wDays.slice(-28));
  }

  /* Arbitrage */
  let reco, reasons = [], conflicts = [];
  if (acwrVal !== null && acwrVal > 1.5) {
    reco = acwrVal > 1.8 ? 'rest' : 'easy';
    reasons.push(`ACWR ${acwrVal} — charge aiguë ${Math.round((acwrVal-1)*100)}% au-dessus de la baseline chronique`);
    if (hrvSignal === 'green') conflicts.push(`HRV favorable (${hrvDetail?.r7} ms) mais ne reflète pas la fatigue structurelle. À ACWR > 1.5 le risque de blessure est 2–5× plus élevé (Gabbett 2016).`);
  } else if (recovScore !== null && recovScore < 35) {
    reco = 'rest'; reasons.push(`Score récupération ${recovScore}/100 — fatigue systémique`);
  } else if (hrvSignal === 'red' && (recovScore === null || recovScore < 55)) {
    reco = 'easy'; reasons.push(`HRV trend 7j (${hrvDetail?.r7} ms) sous la baseline − 0.5 SD (${hrvDetail?.downSD} ms)`);
    if (recovScore != null) reasons.push(`Score récupération ${recovScore}/100`);
  } else if (acwrVal !== null && acwrVal > 1.3) {
    reco = 'moderate'; reasons.push(`ACWR ${acwrVal} en zone vigilance — éviter un volume supplémentaire`);
    if (hrvSignal === 'green') conflicts.push(`HRV favorable mais ACWR élevé : préférez une séance courte.`);
  } else if (hrvSignal === 'green' && (recovScore === null || recovScore >= 60) && (acwrVal === null || acwrVal <= 1.3)) {
    reco = 'hard';
    reasons.push(`HRV trend 7j (${hrvDetail?.r7} ms) au-dessus de la baseline + 0.5 SD (${hrvDetail?.upSD} ms)`);
    if (recovScore != null) reasons.push(`Score récupération ${recovScore}/100`);
    if (acwrVal != null) reasons.push(`ACWR ${acwrVal} en zone optimale`);
  } else {
    reco = 'moderate';
    reasons.push(hrvSignal === 'orange' ? `HRV dans la zone normale (${hrvDetail?.downSD}–${hrvDetail?.upSD} ms)` : 'HRV insuffisant (données manquantes)');
    if (recovScore != null) reasons.push(`Score récupération ${recovScore}/100`);
    if (acwrVal != null) reasons.push(`ACWR ${acwrVal}`);
  }
  return { reco, reasons, conflicts, acwrVal, hrvSignal, hrvDetail, recovScore };
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
    <div class="kpi-card" style="cursor:default">
      <div class="kpi-label">${label}</div>
      <div class="kpi-value">${val}<span class="kpi-unit">${unit}</span></div>
      ${sub ? `<div class="kpi-delta">${sub}</div>` : ''}
      ${deltaHtml}
    </div>`;

  const dur  = k.duration >= 60
    ? `${Math.floor(k.duration/60)}h${String(Math.round(k.duration%60)).padStart(2,'0')}`
    : `${Math.round(k.duration)}min`;
  const load = k.training_load > 0 ? Math.round(k.training_load) : '–';

  // OMS : objectif 150 min/semaine, proratisé selon la période affichée
  const periodDays = state.tab === 'day' ? 1 : state.tab === 'week' ? 7 : state.tab === 'month' ? 30 : 365;
  const omsTarget  = Math.round(150 / 7 * periodDays);
  const omsVal     = Math.round(k.intensity_min);
  const omsPct     = omsVal > 0 ? Math.min(100, Math.round(omsVal / omsTarget * 100)) : 0;
  const omsColor   = omsPct >= 100 ? '#22c55e' : omsPct >= 50 ? '#f97316' : '#ef4444';
  const omsBar     = omsVal > 0
    ? `<div style="margin-top:5px;height:4px;background:var(--surface2);border-radius:2px;overflow:hidden"><div style="height:100%;width:${omsPct}%;background:${omsColor};border-radius:2px"></div></div><div style="font-size:10px;color:${omsColor};margin-top:3px;font-weight:600">${omsPct}% / obj. ${omsTarget} min</div>`
    : '';

  const streak = computeAllActivitiesStreak();

  document.getElementById(containerId).innerHTML =
    h('Activités',     k.activities,                                   '',    '', delta(k.activities, prevK?.activities)) +
    h('Distance',      k.distance.toFixed(1),                         'km',  '', delta(k.distance, prevK?.distance)) +
    h('Temps actif',   dur,                                            '',    '', delta(k.duration, prevK?.duration)) +
    h('Calories',      Math.round(k.calories).toLocaleString('fr'),   'kcal','', delta(k.calories, prevK?.calories)) +
    h('Charge totale', load,                                           'pts', '', k.training_load > 0 ? delta(k.training_load, prevK?.training_load) : '') +
    h('OMS Activité',  omsVal || '–', omsVal ? ' min' : '',           '',    omsBar) +
    h('Dénivelé +',    Math.round(k.elevation),                       'm',   '', delta(k.elevation, prevK?.elevation)) +
    (streak > 0 ? h('Streak',  streak, ' sem.', 'toutes activités') : '') +
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
  if (!totalDur) return null;
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
  const a = ACT_MAP[id] || ACT_MAP[String(id)]; if (!a) return;
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

  // Graphes détaillés
  const chartsWrap = document.getElementById('detail-charts-wrap');
  if (chartsWrap) {
    chartsWrap.style.display = '';
    if (typeof loadActivityDetails === 'function') loadActivityDetails(a.id);
  }

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
      if (data.renpho && data.renpho.includes('error'))
        showToast('Renpho : ' + data.renpho, 'err');
      closeSyncModal();
      cacheClear();
      await Promise.all([loadData(), loadWellness()]);
      if (typeof loadBodyMetrics === 'function') await loadBodyMetrics();
      markAllDirty();
      renderAll();
      /* Détection de nouveaux records sur les activités fraîchement synchronisées */
      if (typeof checkNewPRs === 'function') { try { checkNewPRs(); } catch(e) {} }
      // Mise à jour du coach en arrière-plan
      fetch('/api/update-coach', { method: 'POST' })
        .then(r => r.json())
        .then(d => { if (d.status === 'ok') loadCoach(); })
        .catch(() => {});
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
   EXPORT PDF
   ══════════════════════════════════════════════════════════ */
function exportWeekPDF() {
  const { start, end } = getPeriodBounds();
  const fmt = d => d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
  const periodLabel = `${fmt(start)} – ${fmt(end)} ${end.getFullYear()}`;

  const acts = getFiltered();
  const k = computeKPIs(acts);

  const dur = k.duration >= 60
    ? `${Math.floor(k.duration/60)}h${String(Math.round(k.duration%60)).padStart(2,'0')}`
    : `${Math.round(k.duration)} min`;

  const rows = acts.map(a => {
    const d = a.date ? new Date(a.date + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }) : '';
    const dist = a.distance_km > 0 ? `${a.distance_km} km` : '–';
    const load = a.training_load > 0 ? Math.round(a.training_load) : '–';
    return `<tr>
      <td>${d}</td>
      <td>${a.icon || ''} ${a.type_label || a.type || ''}</td>
      <td>${escapeHTML(a.name || '')}</td>
      <td>${dist}</td>
      <td>${fmt_dur(a.duration_min)}</td>
      <td>${a.calories ? Math.round(a.calories) + ' kcal' : '–'}</td>
      <td>${load}</td>
    </tr>`;
  }).join('');

  const morningSummaryEl = document.getElementById('morning-summary-lines');
  const morningHtml = morningSummaryEl ? morningSummaryEl.innerHTML : '';

  const wellnessEl = document.getElementById('dash-week-banner');
  const wellnessHtml = wellnessEl && wellnessEl.style.display !== 'none' ? wellnessEl.innerHTML : '';

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Résumé semaine — ${periodLabel}</title>
<style>
  body { font-family: system-ui, sans-serif; color: #111; margin: 0; padding: 24px 32px; font-size: 13px; }
  h1 { font-size: 20px; font-weight: 800; margin: 0 0 4px; }
  .sub { color: #6b7280; font-size: 12px; margin-bottom: 20px; }
  .kpi-row { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 24px; }
  .kpi { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 10px; padding: 10px 16px; min-width: 100px; }
  .kpi-label { font-size: 10px; color: #6b7280; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 2px; }
  .kpi-value { font-size: 20px; font-weight: 700; }
  .kpi-unit { font-size: 12px; font-weight: 400; color: #6b7280; }
  .morning { background: #f0f1ff; border-left: 3px solid #6366f1; padding: 10px 14px; border-radius: 6px; margin-bottom: 20px; font-size: 12px; line-height: 1.7; }
  .morning-title { font-size: 10px; font-weight: 700; color: #6366f1; text-transform: uppercase; letter-spacing: .06em; margin-bottom: 6px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th { text-align: left; font-size: 10px; text-transform: uppercase; color: #6b7280; padding: 6px 8px; border-bottom: 2px solid #e5e7eb; }
  td { padding: 7px 8px; border-bottom: 1px solid #f3f4f6; font-size: 12px; }
  tr:last-child td { border-bottom: none; }
  .section-title { font-size: 11px; font-weight: 700; text-transform: uppercase; color: #6b7280; letter-spacing: .06em; margin: 20px 0 8px; }
  .footer { margin-top: 32px; font-size: 10px; color: #9ca3af; text-align: right; border-top: 1px solid #e5e7eb; padding-top: 8px; }
  @media print { body { padding: 8mm 10mm; } }
</style>
</head>
<body>
<h1>Résumé de la semaine</h1>
<div class="sub">${periodLabel}</div>

${morningHtml ? `<div class="morning"><div class="morning-title">☀️ Résumé du matin</div>${morningHtml}</div>` : ''}

<div class="kpi-row">
  <div class="kpi"><div class="kpi-label">Activités</div><div class="kpi-value">${k.activities}</div></div>
  <div class="kpi"><div class="kpi-label">Distance</div><div class="kpi-value">${k.distance.toFixed(1)}<span class="kpi-unit"> km</span></div></div>
  <div class="kpi"><div class="kpi-label">Temps actif</div><div class="kpi-value">${dur}</div></div>
  <div class="kpi"><div class="kpi-label">Calories</div><div class="kpi-value">${Math.round(k.calories).toLocaleString('fr')}<span class="kpi-unit"> kcal</span></div></div>
  <div class="kpi"><div class="kpi-label">Charge</div><div class="kpi-value">${k.training_load > 0 ? Math.round(k.training_load) : '–'}<span class="kpi-unit"> pts</span></div></div>
  <div class="kpi"><div class="kpi-label">Dénivelé +</div><div class="kpi-value">${Math.round(k.elevation)}<span class="kpi-unit"> m</span></div></div>
  ${k.hr_avg ? `<div class="kpi"><div class="kpi-label">FC moy.</div><div class="kpi-value">${k.hr_avg}<span class="kpi-unit"> bpm</span></div></div>` : ''}
</div>

<div class="section-title">Activités de la semaine</div>
<table>
  <thead><tr><th>Date</th><th>Type</th><th>Nom</th><th>Distance</th><th>Durée</th><th>Calories</th><th>Charge</th></tr></thead>
  <tbody>${rows || '<tr><td colspan="7" style="color:#9ca3af;text-align:center;padding:20px">Aucune activité cette semaine</td></tr>'}</tbody>
</table>

<div class="footer">Garmin Dashboard — généré le ${new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
</body>
</html>`;

  const w = window.open('', '_blank');
  if (!w) { showToast('Autorisez les popups pour exporter', 'err'); return; }
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => { w.print(); }, 400);
}

/* ══════════════════════════════════════════════════════════
   NAVIGATION
   ══════════════════════════════════════════════════════════ */

/* Ordre des 5 onglets principaux pour le swipe */
const TAB_ORDER = ['today', 'training', 'recovery', 'history', 'profile'];

function switchView(view, swipeDir) {
  const prev = state.view;
  state.view = view;

  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.view === view);
  });
  document.querySelectorAll('.bottom-nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.view === view);
  });
  document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
  const viewEl = document.getElementById('view-' + view);
  if (viewEl) {
    viewEl.classList.add('active');
    /* Animation de transition directionnelle */
    if (swipeDir && window.innerWidth <= 768) {
      viewEl.classList.remove('slide-in-left', 'slide-in-right');
      void viewEl.offsetWidth; // force reflow
      viewEl.classList.add(swipeDir === 'left' ? 'slide-in-left' : 'slide-in-right');
    }
  }

  const titles = {
    today:    'Aujourd\'hui',
    training: 'Entraînement',
    recovery: 'Récupération',
    history:  'Historique',
    profile:  'Profil',
    runalyze: 'Runalyze',
    poc:      '🔬 Science',
    /* legacy aliases */
    dashboard: 'Dashboard', activities: 'Activités', health: 'Santé',
    running: 'Running', poc: 'Science du sport', help: 'Aide',
  };
  const titleEl = document.getElementById('topbar-title');
  if (titleEl) titleEl.textContent = titles[view] || view;

  renderAll();
}

function switchSubTab(tab) {
  /* Sous-onglet course : switche vers la vue running SANS toucher
     state.tab, sinon le retour sur Entraînement calcule sur l'année */
  if (tab === 'course') {
    switchView('running');
    return;
  }
  state.tab = tab;
  state.offset = 0;
  document.querySelectorAll('.subtab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  renderAll();
}

/* ── Menu "Plus" (bottom nav mobile) ── */
function toggleMoreMenu(e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById('more-menu');
  if (!menu) return;
  const open = menu.classList.toggle('open');
  if (open) {
    const close = (ev) => {
      if (!menu.contains(ev.target)) { menu.classList.remove('open'); document.removeEventListener('click', close); }
    };
    setTimeout(() => document.addEventListener('click', close), 0);
  }
}

function switchViewFromMore(view) {
  const menu = document.getElementById('more-menu');
  if (menu) menu.classList.remove('open');
  switchView(view);
  /* Highlight du bouton "Plus" quand une vue du menu est active */
  const moreBtn = document.querySelector('.bottom-nav-item[data-view="__more"]');
  if (moreBtn) moreBtn.classList.add('active');
}

function movePeriod(dir) { state.offset += dir; renderAll(); }
function resetPeriod()   { state.offset = 0;    renderAll(); }

function setFilter(type) {
  state.filter = type;
  if (typeof actState !== 'undefined') actState.page = 0;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.toggle('active', b.dataset.type === type));
  renderAll();
}

/* ══════════════════════════════════════════════════════════
   RENDER DISPATCHER
   ══════════════════════════════════════════════════════════ */

/* Shorts view removed */


/* ══════════════════════════════════════════════════════════
   TODAY HERO — résumé condensé (récupération + reco + wellness)
   ══════════════════════════════════════════════════════════ */
function renderTodayHero() {
  const el = document.getElementById('today-hero');
  if (!el) return;

  const dr = computeDailyReco();
  const well = state.wellness?.days;
  const todayWell = well ? Object.values(well).sort((a,b) => b.date.localeCompare(a.date))[0] : null;

  const RECO_CFG = {
    rest:     { icon: '😴', label: 'Repos — récupération',       color: '#ef4444' },
    easy:     { icon: '🚶', label: 'Séance légère conseillée',    color: '#f59e0b' },
    moderate: { icon: '🏃', label: 'Entraînement modéré',         color: '#3b82f6' },
    hard:     { icon: '🔥', label: 'Séance intense possible',     color: '#22c55e' },
  };
  const cfg = RECO_CFG[dr.reco] || RECO_CFG.moderate;

  /* Recovery score ring color */
  const score = dr.recovScore;
  const ringColor = score == null ? 'grey' : score >= 65 ? 'green' : score >= 40 ? 'yellow' : 'red';
  const scoreHtml = score != null
    ? `<div class="today-score-val ${ringColor}">${score}</div><div class="today-score-lbl">Récup.</div>`
    : `<div class="today-score-val grey" style="font-size:18px">–</div><div class="today-score-lbl">Récup.</div>`;

  /* Why text : first reason */
  const whyText = dr.reasons[0] || '';

  /* Wellness pills : sommeil, body battery, HRV */
  const pills = [];
  if (todayWell?.sleep_duration_h != null) {
    const h = Math.floor(todayWell.sleep_duration_h), m = Math.round((todayWell.sleep_duration_h - h) * 60);
    const sleepColor = todayWell.sleep_duration_h >= 7 ? '#22c55e' : todayWell.sleep_duration_h >= 6 ? '#f59e0b' : '#ef4444';
    pills.push({ val: `${h}h${m > 0 ? m : ''}`, unit: '', lbl: 'Sommeil', color: sleepColor });
  }
  if (todayWell?.body_battery_high != null) {
    const bb = todayWell.body_battery_high;
    const bbColor = bb >= 70 ? '#22c55e' : bb >= 40 ? '#f59e0b' : '#ef4444';
    pills.push({ val: bb, unit: '%', lbl: 'Body Battery', color: bbColor });
  }
  if (dr.hrvDetail) {
    const hrvColor = dr.hrvSignal === 'green' ? '#22c55e' : dr.hrvSignal === 'red' ? '#ef4444' : '#f59e0b';
    pills.push({ val: dr.hrvDetail.r7, unit: 'ms', lbl: 'HRV 7j', color: hrvColor });
  }

  /* Today's activities (most recent 3) */
  const todayActs = getAll().filter(a => a.date === TODAY_ISO).slice(0, 3);
  const actsHtml = todayActs.length
    ? todayActs.map(a => {
        const dist = a.distance_km > 0 ? `${a.distance_km} km` : '';
        const dur  = a.duration_min ? fmt_dur(a.duration_min) : '';
        const stat = [dist, dur].filter(Boolean).join(' · ') || (a.calories ? `${Math.round(a.calories)} kcal` : '');
        return `<div class="today-act-row" onclick="openDetail(${a.id})">
          <div class="today-act-icon act-icon ${a.type||'other'}">${a.icon||'⚡'}</div>
          <div class="today-act-info">
            <div class="today-act-name">${escapeHTML(a.name || a.type_label || a.type)}</div>
            <div class="today-act-sub">${a.type_label || ''}</div>
          </div>
          <div class="today-act-stat">${stat}</div>
        </div>`;
      }).join('')
    : `<div class="today-no-act">Pas d'activité aujourd'hui</div>`;

  el.innerHTML = `
    <div class="today-hero-top">
      <div class="today-score-ring ${ringColor}">${scoreHtml}</div>
      <div class="today-reco-wrap">
        <div class="today-reco-eyebrow">Recommandation du jour</div>
        <div class="today-reco-main">${cfg.icon} ${cfg.label}</div>
        ${whyText ? `<div class="today-reco-why">${whyText}</div>` : ''}
      </div>
    </div>
    ${pills.length ? `<div class="today-wellness-row">
      ${pills.map(p => `<div class="today-pill">
        <div class="today-pill-val" style="color:${p.color}">${p.val}<span class="today-pill-unit">${p.unit}</span></div>
        <div class="today-pill-lbl">${p.lbl}</div>
      </div>`).join('')}
    </div>` : ''}
    <div class="today-acts-preview">${actsHtml}</div>
  `;
  el.style.display = '';
}

/* ── Wrappers pour la nouvelle navigation ── */
function renderToday() {
  renderTodayHero();
  /* Forcé en mode "day" pour la vue Aujourd'hui */
  const savedTab = state.tab;
  state.tab = 'day';
  const periodLbl = document.getElementById('period-label');
  if (periodLbl) periodLbl.textContent = formatPeriodLabel();
  renderDashboard();
  state.tab = savedTab;
}

function renderTraining() {
  /* Semaine/mois/année : utilise state.tab courant */
  if (!['week','month','year'].includes(state.tab)) state.tab = 'week'; // default
  document.querySelectorAll('.subtab').forEach(b => b.classList.toggle('active', b.dataset.tab === state.tab));
  const periodLbl = document.getElementById('period-label');
  if (periodLbl) periodLbl.textContent = formatPeriodLabel();
  const trainingPeriodLbl = document.getElementById('period-label-training');
  if (trainingPeriodLbl) trainingPeriodLbl.textContent = formatPeriodLabel();
  renderDashboard();
  if (state.tab === 'week' && typeof renderWeekPlan === 'function') {
    try { renderWeekPlan(); } catch(e) { console.warn('[training] week plan', e); }
  }
}

/* Lazy rendering : on ne re-rend une vue que si elle est "dirty"
   (données rechargées, ou state.tab / state.offset / state.filter changé).
   Chaque appel à renderAll() invalide seulement la vue courante.
   Les vues jamais visitées ne sont pas rendues au démarrage.            */
const _viewDirty = new Set();
let   _lastRenderKey = '';

function _renderKey() {
  return `${state.view}|${state.tab}|${state.offset}|${state.filter}|${state.healthDays}`;
}

function markAllDirty() {
  ['today','training','recovery','history','profile','runalyze','running','poc','help'].forEach(v => _viewDirty.add(v));
  _lastRenderKey = '';
}

function renderAll() {
  const key = _renderKey();
  if (key === _lastRenderKey && !_viewDirty.has(state.view)) return; // rien à faire
  _lastRenderKey = key;
  _viewDirty.delete(state.view);

  /* Nouveaux noms de vue */
  if (state.view === 'today')    { renderToday();      return; }
  if (state.view === 'training') { renderTraining();   return; }
  if (state.view === 'recovery') {
    renderHealth();
    if (typeof renderPocSynthesis === 'function') { try { renderPocSynthesis(); } catch(e) { console.warn('[recovery] poc synthesis', e); } }
    if (typeof renderPocRecovery  === 'function') { try { renderPocRecovery();  } catch(e) { console.warn('[recovery] poc recovery', e); } }
    if (typeof renderPocHRV       === 'function') { try { renderPocHRV();       } catch(e) { console.warn('[recovery] poc hrv', e); } }
    if (typeof renderRHRTrend     === 'function') try { renderRHRTrend();     } catch(e) {}
    if (typeof renderBodyMetrics  === 'function') try { renderBodyMetrics();  } catch(e) {}
    if (typeof renderCorrelations === 'function') try { renderCorrelations(); } catch(e) { console.warn('[recovery] correlations', e); }
    return;
  }
  if (state.view === 'history')  { renderActivities(); return; }
  if (state.view === 'runalyze') { if (typeof onSwitchToRunalyze === 'function') onSwitchToRunalyze(); return; }
  /* Aliases legacy */
  if (state.view === 'health')     { renderHealth();     return; }
  if (state.view === 'profile')    { renderProfile();    return; }
  if (state.view === 'activities') { renderActivities(); return; }
  if (state.view === 'running')    { renderRunning();    return; }
  if (state.view === 'poc')        { renderPOC();        return; }
  if (state.view === 'help')       { renderHelp();       return; }

  /* Dashboard (fallback) */
  const periodLbl = document.getElementById('period-label');
  if (periodLbl) periodLbl.textContent = formatPeriodLabel();
  renderDashboard();
}

/* ══════════════════════════════════════════════════════════
   MOCK ACTIVITIES (fallback when no server)
   ══════════════════════════════════════════════════════════ */
const MOCK_ACTIVITIES = [
  {id:1, name:"Sortie longue",     type:"run",      icon:"🏃", date:"2026-04-19", start_time:"2026-04-19T07:00:00", duration_min:58,  distance_km:12.4, calories:634,  hr_avg:148, hr_max:172, elevation_m:87,  training_load:85,  aerobic_te:3.8, te_label:"Amélioration aérobie", hr_zones_pct:[10,35,28,20,7], pace_min_km:"5:50", vo2max:43},
  {id:2, name:"Muscu haut corps",  type:"strength", icon:"🏋️", date:"2026-04-18", start_time:"2026-04-18T18:30:00", duration_min:55,  distance_km:0,    calories:310,  hr_avg:125, hr_max:148, elevation_m:0,   training_load:42},
  {id:3, name:"Fractionné 10x400m",type:"run",      icon:"🏃", date:"2026-04-17", start_time:"2026-04-17T07:15:00", duration_min:40,  distance_km:8.1,  calories:490,  hr_avg:168, hr_max:185, elevation_m:22,  training_load:95,  aerobic_te:4.5, te_label:"Amélioration VO2max", hr_zones_pct:[5,15,18,32,30], pace_min_km:"4:57", vo2max:44},
  {id:4, name:"Natation endurance",type:"swim",     icon:"🏊", date:"2026-04-16", start_time:"2026-04-16T12:00:00", duration_min:48,  distance_km:2.4,  calories:420,  hr_avg:128, hr_max:145, elevation_m:0,   training_load:55},
  {id:5, name:"Vélo route",        type:"bike",     icon:"🚴", date:"2026-04-15", start_time:"2026-04-15T09:00:00", duration_min:72,  distance_km:38.4, calories:820,  hr_avg:138, hr_max:162, elevation_m:420, training_load:78},
  {id:6, name:"Course facile",     type:"run",      icon:"🏃", date:"2026-04-14", start_time:"2026-04-14T07:00:00", duration_min:52,  distance_km:10.2, calories:580,  hr_avg:138, hr_max:158, elevation_m:55,  training_load:62,  pace_min_km:"6:10", vo2max:43},
  {id:7, name:"Rando Pyrénées",    type:"hike",     icon:"🥾", date:"2026-04-13", start_time:"2026-04-13T08:00:00", duration_min:195, distance_km:18.6, calories:1180, hr_avg:118, hr_max:145, elevation_m:980, training_load:110},
  {id:8, name:"10km tempo",        type:"run",      icon:"🏃", date:"2026-04-10", start_time:"2026-04-10T07:00:00", duration_min:44,  distance_km:10.0, calories:540,  hr_avg:162, hr_max:178, elevation_m:38,  training_load:88,  pace_min_km:"5:20", vo2max:42},
  {id:9, name:"Vélo 60km",         type:"bike",     icon:"🚴", date:"2026-04-08", start_time:"2026-04-08T09:00:00", duration_min:95,  distance_km:54.2, calories:1080, hr_avg:142, hr_max:168, elevation_m:610, training_load:102},
  {id:10,name:"Muscu jambes",      type:"strength", icon:"🏋️", date:"2026-04-04", start_time:"2026-04-04T18:30:00", duration_min:52,  distance_km:0,    calories:305,  hr_avg:128, hr_max:150, elevation_m:0,   training_load:40},
];

/* ══════════════════════════════════════════════════════════
   PARAMÈTRES HR
   ══════════════════════════════════════════════════════════ */
function saveHRSettings() {
  const maxRaw  = document.getElementById('set-hr-max')?.value ?? '';
  const restRaw = document.getElementById('set-hr-rest')?.value ?? '';
  const hrMax  = parseInt(maxRaw);
  const hrRest = parseInt(restRaw);
  const vo2Correction = parseFloat(document.getElementById('set-vo2-correction')?.value);
  const apiKey = document.getElementById('set-api-key')?.value;

  /* Champ vide = retour à l'auto-détection Garmin */
  if (!maxRaw.trim())  localStorage.removeItem('hr_max');
  else if (hrMax >= 140 && hrMax <= 220) localStorage.setItem('hr_max', hrMax);

  if (!restRaw.trim()) localStorage.removeItem('hr_rest');
  else if (hrRest >= 30 && hrRest <= 90) localStorage.setItem('hr_rest', hrRest);

  if (vo2Correction >= 0.8 && vo2Correction <= 1.5) localStorage.setItem('vo2_correction', vo2Correction.toFixed(2));
  if (apiKey != null) {
    if (apiKey.trim()) localStorage.setItem('app_api_key', apiKey.trim());
    else localStorage.removeItem('app_api_key');
  }
  if (typeof applyHRSettings === 'function') applyHRSettings();
  initSettingsInputs();
  const msg = document.getElementById('settings-saved');
  if (msg) { msg.style.display = 'block'; setTimeout(() => msg.style.display = 'none', 3000); }
  markAllDirty();
  renderAll();
}

function initSettingsInputs() {
  const maxEl  = document.getElementById('set-hr-max');
  const restEl = document.getElementById('set-hr-rest');
  const vo2El  = document.getElementById('set-vo2-correction');
  const keyEl  = document.getElementById('set-api-key');
  /* Valeur affichée = override manuel uniquement ; sinon champ vide
     avec la valeur auto Garmin en placeholder */
  if (maxEl) {
    maxEl.value = localStorage.getItem('hr_max') || '';
    maxEl.placeholder = `auto : ${getHRMax()} (Garmin)`;
  }
  if (restEl) {
    restEl.value = localStorage.getItem('hr_rest') || '';
    restEl.placeholder = `auto : ${getHRRest()} (Garmin)`;
  }
  if (vo2El)  vo2El.value  = localStorage.getItem('vo2_correction') || '1.00';
  if (keyEl)  keyEl.value  = localStorage.getItem('app_api_key') || '';
  if (typeof updateNotifButton === 'function') updateNotifButton();
}

/* ══════════════════════════════════════════════════════════
   STREAK TOUTES ACTIVITÉS
   ══════════════════════════════════════════════════════════ */
function computeAllActivitiesStreak() {
  const acts = getAll();
  const actDates = new Set(acts.map(a => a.date));
  let streak = 0;
  for (let w = 0; w < 260; w++) {
    const monday = new Date(TODAY);
    const dow = (TODAY.getDay() + 6) % 7;
    monday.setDate(TODAY.getDate() - dow - w * 7);
    let found = false;
    for (let d = 0; d < 7; d++) {
      const dd = new Date(monday); dd.setDate(monday.getDate() + d);
      if (actDates.has(localIso(dd))) { found = true; break; }
    }
    if (!found) break;
    streak++;
  }
  return streak;
}

/* ══════════════════════════════════════════════════════════
   RÉSUMÉ MATINAL (règles)
   ══════════════════════════════════════════════════════════ */
function generateMorningSummary() {
  const well = state.wellness?.days;
  if (!well) return null;
  const days = Object.values(well).sort((a,b) => b.date.localeCompare(a.date));
  const today = days[0];
  if (!today) return null;

  const hrv      = today.hrv_overnight_avg;
  const rhr      = today.resting_hr;
  const bb       = today.body_battery_high || today.body_battery_end;
  const sleep    = today.sleep_total_min;
  const deep     = today.sleep_deep_min;
  const readiness= today.training_readiness_score;
  const stress   = today.sleep_stress_avg;

  // Moyennes 7 jours pour contextualiser
  const last7    = days.slice(0, 7);
  const _avg = (arr) => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null;
  const avgHrv   = _avg(last7.map(d=>d.hrv_overnight_avg).filter(Boolean));
  const avgRhr   = _avg(last7.map(d=>d.resting_hr).filter(Boolean));
  const avgSleep = _avg(last7.map(d=>d.sleep_total_min).filter(Boolean));

  const lines = [];

  // Sommeil
  if (sleep) {
    const h = Math.floor(sleep/60), m = sleep%60;
    const sleepVsAvg = avgSleep ? (sleep - avgSleep) / avgSleep : 0;
    if (sleep >= 420 && deep >= 90) lines.push(`Nuit excellente (${h}h${String(m).padStart(2,'0')} · ${Math.round(deep)}min sommeil profond).`);
    else if (sleep >= 360)          lines.push(`Nuit correcte : ${h}h${String(m).padStart(2,'0')}.`);
    else                            lines.push(`Nuit courte : ${h}h${String(m).padStart(2,'0')} — pense à anticiper la récupération.`);
    if (sleepVsAvg < -0.15)         lines.push(`C'est ${Math.abs(Math.round(sleepVsAvg*100))}% sous ta moyenne habituelle.`);
  }

  // HRV
  if (hrv && avgHrv) {
    const delta = ((hrv - avgHrv) / avgHrv) * 100;
    if (delta > 10)       lines.push(`HRV en hausse (${Math.round(hrv)} ms) — système nerveux bien récupéré.`);
    else if (delta < -10) lines.push(`HRV en baisse (${Math.round(hrv)} ms vs moy. ${Math.round(avgHrv)} ms) — effort intense ou fatigue accumulée.`);
    else                  lines.push(`HRV stable à ${Math.round(hrv)} ms.`);
  }

  // FC repos
  if (rhr && avgRhr) {
    if (rhr > avgRhr + 5) lines.push(`FC repos élevée (${rhr} bpm, +${rhr-Math.round(avgRhr)} vs moy.) — signe de fatigue ou de début de rhume.`);
    else if (rhr <= avgRhr - 3) lines.push(`FC repos basse (${rhr} bpm) — bonne récupération.`);
  }

  // Body Battery
  if (bb) {
    if (bb >= 70)       lines.push(`Body Battery chargée à ${bb}% — énergie disponible pour une bonne séance.`);
    else if (bb >= 40)  lines.push(`Body Battery à ${bb}% — niveau modéré.`);
    else                lines.push(`Body Battery faible (${bb}%) — évite les efforts très intenses aujourd'hui.`);
  }

  // Readiness
  if (readiness) {
    if (readiness >= 70)      lines.push(`Score de forme : ${readiness}/100 — corps prêt pour l'effort.`);
    else if (readiness >= 40) lines.push(`Score de forme modéré (${readiness}/100).`);
    else                      lines.push(`Score de forme bas (${readiness}/100) — journée de récupération conseillée.`);
  }

  // Conseil final — utilise computeDailyReco() pour cohérence
  const reco = computeDailyReco();
  const CONSEIL = { rest:'🔴 Privilégie la récupération active aujourd\'hui.', easy:'🟠 Sortie légère conseillée — pas de séance intense.', moderate:'🟡 Séance modérée ou endurance de base.', hard:'🟢 Conditions idéales pour une séance de qualité.' };
  lines.push(CONSEIL[reco.reco] || '🟡 Écoute ton corps.');

  return lines;
}

/* ══════════════════════════════════════════════════════════
   INIT
   ══════════════════════════════════════════════════════════ */

function toggleSidebar() {
  const collapsed = document.body.classList.toggle('sidebar-collapsed');
  localStorage.setItem('sidebar-collapsed', collapsed ? '1' : '0');
}

/* ══════════════════════════════════════════════════════════
   SWIPE NAVIGATION (mobile)
   Swipe gauche → onglet suivant · Swipe droite → onglet précédent
   Annulé si le geste commence dans un élément scrollable (chart, table, filter-bar)
   ══════════════════════════════════════════════════════════ */
function _initSwipeNav() {
  const mainEl = document.querySelector('main');
  if (!mainEl) return;

  /* Sélecteurs qui ont leur propre scroll horizontal → ne pas intercepter */
  const SCROLL_SELECTORS = '.filter-bar,.subtab-bar,.chart-wrap,.table-container,.health-period-bar,.heatmap-outer,.run-period-bar,.year-all-list,.acts-search-wrap,.compare-select';

  let tx = 0, ty = 0, tracking = false;

  mainEl.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) { tracking = false; return; }
    if (e.target.closest(SCROLL_SELECTORS)) { tracking = false; return; }
    tx = e.touches[0].clientX;
    ty = e.touches[0].clientY;
    tracking = true;
  }, { passive: true });

  mainEl.addEventListener('touchmove', e => {
    if (!tracking) return;
    const dx = Math.abs(e.touches[0].clientX - tx);
    const dy = Math.abs(e.touches[0].clientY - ty);
    /* Si le geste part en vertical → abandon (scroll normal) */
    if (dy > dx && dy > 12) { tracking = false; }
  }, { passive: true });

  mainEl.addEventListener('touchend', e => {
    if (!tracking) return;
    tracking = false;
    const dx = e.changedTouches[0].clientX - tx;
    const dy = Math.abs(e.changedTouches[0].clientY - ty);
    /* Seuil : au moins 60px horizontal, et moins oblique que 45° */
    if (Math.abs(dx) < 60 || dy > Math.abs(dx) * 0.9) return;
    const idx = TAB_ORDER.indexOf(state.view);
    if (idx === -1) return;
    if (dx < 0 && idx < TAB_ORDER.length - 1) {
      switchView(TAB_ORDER[idx + 1], 'left');
    } else if (dx > 0 && idx > 0) {
      switchView(TAB_ORDER[idx - 1], 'right');
    }
  }, { passive: true });
}

async function init() {
  // Restaure l'état sidebar
  if (localStorage.getItem('sidebar-collapsed') === '1') {
    document.body.classList.add('sidebar-collapsed');
  }

  // Restaure les préférences de période par vue
  const savedHealthDays = parseInt(localStorage.getItem('health_days'));
  if (savedHealthDays) state.healthDays = savedHealthDays;
  const savedGranularity = localStorage.getItem('profile_granularity');
  if (savedGranularity) state.profileGranularity = savedGranularity;

  if (window.innerWidth <= 768) {
    _initSwipeNav();
  }

  // Handle PWA deep-link shortcuts (/#recovery, /#training)
  const hash = window.location.hash.replace('#','');
  if (['today','training','recovery','history','profile'].includes(hash)) {
    state.view = hash;
    document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
    const vEl = document.getElementById('view-' + hash);
    if (vEl) vEl.classList.add('active');
    document.querySelectorAll('[data-view]').forEach(el => el.classList.toggle('active', el.dataset.view === hash));
  }

  // Spinner pendant le chargement
  document.body.classList.add('loading');
  const syncDot = document.getElementById('sync-dot');
  if (syncDot) syncDot.classList.add('syncing');

  await Promise.all([loadData(), loadWellness(), loadCoach()]);

  /* FC repos / FC max : recalcule les valeurs auto depuis les données Garmin */
  if (typeof applyHRSettings === 'function') applyHRSettings();

  // Load Xplor after other data so week plan projection includes gym sessions
  if (typeof loadXplorSessions === 'function') await loadXplorSessions();

  // Load Renpho body metrics (non-blocking — silently skipped if not configured)
  if (typeof loadBodyMetrics === 'function') await loadBodyMetrics();

  document.body.classList.remove('loading');
  if (syncDot) syncDot.classList.remove('syncing');

  markAllDirty();
  renderAll();

  /* Records battus depuis la dernière visite (sync cron entre-temps) */
  if (typeof checkNewPRs === 'function') { try { checkNewPRs(); } catch(e) {} }
  /* Conseil du matin (notification locale, 1×/jour) */
  if (typeof maybeMorningNotification === 'function') { try { maybeMorningNotification(); } catch(e) {} }
}

/* PWA laissée ouverte pendant la nuit : TODAY et tous les calculs
   dérivés (streaks, ACWR, plan semaine) seraient figés sur la veille */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && localIso(new Date()) !== TODAY_ISO) {
    location.reload();
  }
});

init();

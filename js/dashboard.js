/* ══════════════════════════════════════════════════════════
   DASHBOARD.JS — Period-based views (Day/Week/Month/Year)
   ══════════════════════════════════════════════════════════ */

/* ── Activity cards (compact horizontal tiles) ── */
function _actCard(a) {
  const id     = String(a.id);
  ACT_MAP[id]  = a;
  const main   = a.distance_km > 0 ? `${a.distance_km} km` : fmt_dur(a.duration_min);
  const sub    = [fmt_dur(a.duration_min), a.calories ? `${Math.round(a.calories)} kcal` : ''].filter(Boolean).join(' · ');
  const dateStr = a.date ? new Date(a.date + 'T12:00:00').toLocaleDateString('fr-FR', {day:'numeric', month:'short'}) : '';
  return `<div class="act-card" onclick="openDetail('${id}')">
    <div class="act-card-top">
      <div class="act-icon ${a.type || 'other'}">${a.icon || '⚡'}</div>
      <span class="act-card-date">${dateStr}</span>
    </div>
    <div class="act-card-name">${escapeHTML(a.name || a.type_label || '')}</div>
    <div class="act-card-main">${main}</div>
    <div class="act-card-sub">${sub}</div>
  </div>`;
}

function renderActivityCards(containerId, acts, limit = 8) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!acts.length) { el.className = ''; el.innerHTML = '<div class="empty">Aucune activité sur cette période</div>'; return; }
  el.className = 'acts-row';
  el.innerHTML = acts.slice(0, limit).map(_actCard).join('');
}

function renderYearActivityList(containerId, acts) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const countEl = document.getElementById('year-count');
  if (countEl) countEl.textContent = `— ${acts.length} activités`;
  if (!acts.length) { el.innerHTML = '<div class="empty">Aucune activité sur cette période</div>'; return; }
  el.innerHTML = acts.map(a => {
    const id     = String(a.id);
    ACT_MAP[id]  = a;
    const main   = a.distance_km > 0 ? `${a.distance_km} km` : fmt_dur(a.duration_min);
    const cal    = a.calories ? `${Math.round(a.calories)} kcal` : '';
    const load   = a.training_load > 0 ? `⚡${Math.round(a.training_load)}` : '';
    const sub    = [fmt_dur(a.duration_min), cal, load, a.te_label].filter(Boolean).join(' · ');
    const dateStr = a.date ? new Date(a.date + 'T12:00:00').toLocaleDateString('fr-FR', {day:'numeric', month:'short'}) : '';
    return `<div class="activity-item" onclick="openDetail('${id}')">
      <div class="act-icon ${a.type || 'other'}">${a.icon || '⚡'}</div>
      <div>
        <div class="act-name">${escapeHTML(a.name)}</div>
        <div class="act-date">${dateStr}</div>
      </div>
      <div class="act-stats">
        <div class="act-main">${main}</div>
        <div class="act-sub">${sub}</div>
      </div>
    </div>`;
  }).join('');
}

function renderTopActivities(containerId, acts, limit = 6) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!acts.length) { el.className = ''; el.innerHTML = '<div class="empty">Aucune activité</div>'; return; }
  const sorted = [...acts].sort((a, b) => (b.training_load || 0) - (a.training_load || 0));
  el.className = 'acts-row';
  el.innerHTML = sorted.slice(0, limit).map(a => {
    const id     = String(a.id);
    ACT_MAP[id]  = a;
    const load   = a.training_load > 0 ? Math.round(a.training_load) : '–';
    const dist   = a.distance_km > 0 ? `${a.distance_km} km` : fmt_dur(a.duration_min);
    const dateStr = a.date ? new Date(a.date + 'T12:00:00').toLocaleDateString('fr-FR', {day:'numeric', month:'short'}) : '';
    return `<div class="act-card" onclick="openDetail('${id}')">
      <div class="act-card-top">
        <div class="act-icon ${a.type || 'other'}">${a.icon || '⚡'}</div>
        <span class="act-card-date">${dateStr}</span>
      </div>
      <div class="act-card-name">${escapeHTML(a.name || a.type_label || '')}</div>
      <div class="act-card-main" style="color:var(--accent)">${load}<span style="font-size:11px;font-weight:400;color:var(--muted)"> pts</span></div>
      <div class="act-card-sub">${dist}${a.te_label ? ' · ' + a.te_label : ''}</div>
    </div>`;
  }).join('');
}

/* ── Week calendar ── */
function renderWeekCells(acts) {
  const { start } = getPeriodBounds();
  const el = document.getElementById('week-cells');
  if (!el) return;
  el.innerHTML = DAYS_FR.map((day, i) => {
    const cellDate = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const iso = localIso(cellDate);
    const allDay  = acts.filter(a => a.date === iso);
    const dayActs = allDay.filter(a => state.filter === 'all' || a.type === state.filter);
    const isToday = iso === TODAY_ISO;
    const dots = dayActs.map(a => `<div class="day-dot" style="background:${TYPE_COLOR[a.type]||'#888'}"></div>`).join('');
    const miniActs = allDay.slice(0,3).map(a => {
      ACT_MAP[a.id] = a;
      return `<div class="day-mini-act" style="color:${TYPE_COLOR[a.type]||'var(--muted)'}" onclick="event.stopPropagation();openDetail(${a.id})" title="${escapeHTML(a.name)}">${a.icon||'⚡'} ${fmt_dur(a.duration_min)}</div>`;
    }).join('');
    return `<div class="day-cell ${dayActs.length ? 'has-act' : ''} ${isToday ? 'today' : ''}">
      <div class="day-name">${day}</div>
      <div class="day-num">${cellDate.getDate()}</div>
      <div class="day-dots">${dots}</div>
      ${miniActs ? `<div class="day-mini-acts">${miniActs}</div>` : ''}
    </div>`;
  }).join('');
}

/* ══════════════════════════════════════════════════════════
   CHARTS
   ══════════════════════════════════════════════════════════ */
function typeDistribution(acts) {
  const counts = {};
  acts.forEach(a => { counts[a.type] = (counts[a.type]||0) + 1; });
  return counts;
}

const CHART_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false } },
};

function renderWeekCharts(acts) {
  const { start } = getPeriodBounds();

  const dists = DAYS_FR.map((_, i) => {
    const iso = localIso(new Date(start.getFullYear(), start.getMonth(), start.getDate()+i));
    return acts.filter(a=>a.date===iso).reduce((s,a)=>s+(a.distance_km||0),0);
  });
  const durs = DAYS_FR.map((_, i) => {
    const iso = localIso(new Date(start.getFullYear(), start.getMonth(), start.getDate()+i));
    return acts.filter(a=>a.date===iso).reduce((s,a)=>s+(a.duration_min||0),0);
  });
  const cols = DAYS_FR.map((_, i) => {
    const iso = localIso(new Date(start.getFullYear(), start.getMonth(), start.getDate()+i));
    const day = acts.filter(a=>a.date===iso);
    if (!day.length) return 'rgba(0,0,0,0.07)';
    return (TYPE_COLOR[day[0].type] || '#888') + 'cc';
  });

  mkChart('chart-week-dist', {
    type: 'bar',
    data: { labels: DAYS_FR, datasets: [{ data: dists, backgroundColor: cols, borderRadius: 6 }] },
    options: { ...CHART_OPTS, scales: { x:{grid:{display:false}}, y:{grid:{color:'#e5e7eb'}} } }
  });

  mkChart('chart-week-dur', {
    type: 'bar',
    data: { labels: DAYS_FR, datasets: [{ data: durs, backgroundColor: cols, borderRadius: 6 }] },
    options: { ...CHART_OPTS, scales: { x:{grid:{display:false}}, y:{grid:{color:'#e5e7eb'}} } }
  });

  const dist = typeDistribution(acts);
  const types = Object.keys(dist);
  mkChart('chart-week-pie', {
    type: 'doughnut',
    data: {
      labels: types.map(t => TYPE_LABEL[t]||t),
      datasets: [{ data: Object.values(dist), backgroundColor: types.map(t=>TYPE_COLOR[t]||'#888'), borderWidth:0, hoverOffset:6 }]
    },
    options: { ...CHART_OPTS, plugins: { legend: { position:'bottom', labels:{color:'#64748b',boxWidth:10} } }, cutout:'60%' }
  });
}

function renderMonthCharts(acts) {
  const { start } = getPeriodBounds();
  const year = start.getFullYear(), month = start.getMonth();
  const weeks = [1,2,3,4].map(w => {
    const wStart = new Date(year, month, (w-1)*7+1);
    const wEnd   = new Date(year, month, w*7);
    return acts.filter(a => { const d = new Date(a.start_time); return d >= wStart && d <= wEnd; });
  });

  const types = Object.keys(TYPE_LABEL);

  mkChart('chart-month-dist', {
    type: 'bar',
    data: {
      labels: ['S1','S2','S3','S4'],
      datasets: types.map(t => ({
        label: TYPE_LABEL[t],
        data: weeks.map(w => w.filter(a=>a.type===t).reduce((s,a)=>s+(a.distance_km||0),0)),
        backgroundColor: TYPE_COLOR[t]+'cc', borderRadius: 5,
      })).filter(ds => ds.data.some(v=>v>0))
    },
    options: { ...CHART_OPTS, plugins: { legend:{position:'bottom',labels:{color:'#64748b',boxWidth:10}} }, scales: { x:{stacked:true,grid:{display:false}}, y:{stacked:true,grid:{color:'#e5e7eb'}} } }
  });

  const dist = typeDistribution(acts);
  const keys = Object.keys(dist);
  mkChart('chart-month-type', {
    type: 'bar',
    data: {
      labels: keys.map(t=>TYPE_LABEL[t]||t),
      datasets: [{ data: Object.values(dist), backgroundColor: keys.map(t=>(TYPE_COLOR[t]||'#888')+'cc'), borderRadius:6 }]
    },
    options: { ...CHART_OPTS, scales: { x:{grid:{display:false}}, y:{grid:{color:'#e5e7eb'}} } }
  });
}

function renderYearCharts(acts) {
  const { start } = getPeriodBounds();
  const year  = start.getFullYear();
  const now   = new Date();
  const types = Object.keys(TYPE_LABEL);

  // Only show months that have data (or up to current month for current year)
  const maxMonth  = year === now.getFullYear() ? now.getMonth() : 11;
  const allMonths = Array.from({length: maxMonth + 1}, (_, i) => i);
  const hasData   = allMonths.filter(m => acts.some(a => new Date(a.start_time).getMonth() === m));
  const months    = hasData.length > 0 ? hasData : allMonths;

  mkChart('chart-year-dist', {
    type: 'bar',
    data: {
      labels: months.map(m => MONTHS_FR[m]),
      datasets: types.map(t => ({
        label: TYPE_LABEL[t],
        data: months.map(m => acts.filter(a=>a.type===t && new Date(a.start_time).getMonth()===m).reduce((s,a)=>s+(a.distance_km||0),0)),
        backgroundColor: TYPE_COLOR[t]+'cc', borderRadius: 4,
      })).filter(ds=>ds.data.some(v=>v>0))
    },
    options: { ...CHART_OPTS, plugins:{legend:{position:'bottom',labels:{color:'#64748b',boxWidth:10}}}, scales:{x:{stacked:true,grid:{display:false}},y:{stacked:true,grid:{color:'#e5e7eb'}}} }
  });

  mkChart('chart-year-type', {
    type: 'bar',
    data: {
      labels: months.map(m => MONTHS_FR[m]),
      datasets: types.map(t => ({
        label: TYPE_LABEL[t],
        data: months.map(m => acts.filter(a=>a.type===t && new Date(a.start_time).getMonth()===m).length),
        backgroundColor: TYPE_COLOR[t]+'cc', borderRadius: 3,
      })).filter(ds=>ds.data.some(v=>v>0))
    },
    options: { ...CHART_OPTS, plugins:{legend:{position:'bottom',labels:{color:'#64748b',boxWidth:10}}}, scales:{x:{stacked:true,grid:{display:false}},y:{stacked:true,grid:{color:'#e5e7eb'}}} }
  });

  const dist = typeDistribution(acts);
  const keys = Object.keys(dist);
  mkChart('chart-year-pie', {
    type: 'doughnut',
    data: {
      labels: keys.map(t=>TYPE_LABEL[t]||t),
      datasets: [{ data: Object.values(dist), backgroundColor: keys.map(t=>TYPE_COLOR[t]||'#888'), borderWidth:0, hoverOffset:6 }]
    },
    options: { ...CHART_OPTS, plugins:{legend:{position:'bottom',labels:{color:'#64748b',boxWidth:10}}}, cutout:'60%' }
  });
}

/* ══════════════════════════════════════════════════════════
   RENDER DASHBOARD
   ══════════════════════════════════════════════════════════ */
function renderDashboard() {
  const acts     = getFiltered();
  const prevActs = getPrevFiltered();
  const zones    = computeZones(acts) || [8, 35, 30, 20, 7];

  /* Show/hide sub-views */
  ['day','week','month','year'].forEach(t => {
    const el = document.getElementById('subview-'+t);
    if (el) el.style.display = state.tab === t ? '' : 'none';
  });

  if (state.tab === 'day') {
    renderKPIs('kpi-day', acts, prevActs);
    renderDayWellnessKPIs();
    renderActivityCards('list-day', acts, 5);
    renderZones('zones-day', zones);
  }
  if (state.tab === 'week') {
    renderKPIs('kpi-week', acts, prevActs);
    renderWeekWellnessBanner();
    renderWeekCells(getAll());
    renderWeekCharts(acts);
    renderActivityCards('list-week', acts, 6);
  }
  if (state.tab === 'month') {
    renderKPIs('kpi-month', acts, prevActs);
    renderWeightKPI('kpi-month-wellness');
    renderMonthCharts(acts);
    renderZones('zones-month', zones);
    renderActivityCards('list-month', acts, 8);
  }
  if (state.tab === 'year') {
    renderKPIs('kpi-year', acts, prevActs);
    renderWeightKPI('kpi-year-wellness');
    renderYearCharts(acts);
    renderTopActivities('list-year', acts, 6);
    renderYearActivityList('list-year-all', acts);
  }

  // Diagramme de forme (toutes vues)
  if (typeof renderFormeDiagram === 'function') renderFormeDiagram();

  // Résumé matinal (vue semaine + jour seulement)
  if (state.tab === 'week' || state.tab === 'day') renderMorningSummary();
}

function renderMorningSummary() {
  const el    = document.getElementById('morning-summary');
  const lines = document.getElementById('morning-summary-lines');
  if (!el || !lines) return;
  const summary = typeof generateMorningSummary === 'function' ? generateMorningSummary() : null;
  if (!summary || !summary.length) { el.style.display = 'none'; return; }
  el.style.display = '';
  lines.innerHTML  = summary.map(l => `<div>${l}</div>`).join('');
}

/* ══════════════════════════════════════════════════════════
   WELLNESS DASHBOARD — helpers
   ══════════════════════════════════════════════════════════ */

function _todayWellness() {
  if (!state.wellness?.days) return null;
  const yest = new Date(TODAY); yest.setDate(yest.getDate() - 1);
  return state.wellness.days[TODAY_ISO] || state.wellness.days[localIso(yest)] || null;
}

const _TRAINING_STATUS = {
  productive:      { label: 'Productif',        color: '#22c55e' },
  peaking:         { label: 'En pic',            color: '#6366f1' },
  recovery:        { label: 'Récupération',      color: '#3b82f6' },
  maintaining:     { label: 'Maintien',          color: '#94a3b8' },
  detraining:      { label: 'Désentraînement',   color: '#f97316' },
  overreaching:    { label: 'Surmenage',         color: '#ef4444' },
  unproductive:    { label: 'Non productif',     color: '#f59e0b' },
  below_goals:     { label: 'En dessous objectif', color: '#f59e0b' },
  no_status:       { label: '–',                 color: '#94a3b8' },
};

function _statusInfo(raw) {
  if (!raw) return null;
  const key = String(raw).toLowerCase().replace(/[\s-]/g, '_');
  return _TRAINING_STATUS[key] || { label: raw, color: '#94a3b8' };
}

/* Bandeau "Forme du jour" retiré : doublonnait le score de récupération
   déjà affiché dans le hero #today-hero (app.js) sur ce même onglet. */

/* ── 2. KPIs wellness du jour : Pas, Cal. actives, Sommeil ── */
function renderDayWellnessKPIs() {
  const el = document.getElementById('kpi-day-wellness');
  if (!el) return;

  const day = _todayWellness();
  if (!day) { el.innerHTML = ''; return; }

  const kpi = (label, val, unit, sub='') => `
    <div class="kpi-card" style="cursor:default">
      <div class="kpi-label">${label}</div>
      <div class="kpi-value">${val}<span class="kpi-unit">${unit ? ' ' + unit : ''}</span></div>
      ${sub}
    </div>`;

  let html = '';

  // Pas du jour
  const steps     = day.steps;
  const stepsGoal = day.steps_goal || 6000;
  if (steps) {
    const pct   = Math.min(100, Math.round(steps / stepsGoal * 100));
    const color = pct >= 100 ? '#22c55e' : pct >= 50 ? '#f97316' : '#ef4444';
    const bar   = `<div style="margin-top:5px;height:4px;background:var(--surface2);border-radius:2px;overflow:hidden"><div style="height:100%;width:${pct}%;background:${color};border-radius:2px"></div></div><div style="font-size:10px;color:${color};margin-top:3px;font-weight:600">${pct}% / obj. ${stepsGoal.toLocaleString('fr-FR')}</div>`;
    html += kpi('Pas du jour', steps.toLocaleString('fr-FR'), '', bar);
  }

  // Calories actives
  if (day.calories_active) {
    html += kpi('Cal. actives', Math.round(day.calories_active).toLocaleString('fr-FR'), 'kcal', '<div class="kpi-delta">mouvement quotidien</div>');
  }

  // Sommeil de la nuit
  const sleepMin = day.sleep_total_min;
  if (sleepMin) {
    const h     = Math.floor(sleepMin / 60);
    const m     = Math.round(sleepMin % 60);
    const deep  = sleepMin && day.sleep_deep_min ? Math.round(day.sleep_deep_min / sleepMin * 100) : null;
    const rem   = sleepMin && day.sleep_rem_min  ? Math.round(day.sleep_rem_min  / sleepMin * 100) : null;
    const sub   = deep != null ? `<div class="kpi-delta">Profond ${deep}% · REM ${rem ?? '–'}%</div>` : '';
    html += kpi('Sommeil nuit', `${h}h${String(m).padStart(2,'0')}`, '', sub);
  }

  el.innerHTML = html;
}

/* ── 3. Bandeau semaine : statut entraînement + stress moyen ── */
function renderWeekWellnessBanner() {
  const el = document.getElementById('dash-week-banner');
  if (!el) return;

  if (!state.wellness?.days) { el.style.display = 'none'; return; }

  const { start, end } = getPeriodBounds();
  const allDays  = Object.values(state.wellness.days);
  const weekDays = allDays.filter(d => { const dt = new Date(d.date + 'T12:00:00'); return dt >= start && dt <= end; });

  if (!weekDays.length) { el.style.display = 'none'; return; }

  // Training status : valeur la plus récente disponible dans la semaine
  const withStatus = [...weekDays].reverse().find(d => d.training_status);
  const status     = _statusInfo(withStatus?.training_status);

  // Stress moyen semaine
  const stressVals = weekDays.map(d => d.stress_avg).filter(v => v != null && v > 0);
  const stressAvg  = stressVals.length ? Math.round(stressVals.reduce((s, v) => s + v, 0) / stressVals.length) : null;

  // Delta stress vs semaine précédente
  const prevStart = new Date(start); prevStart.setDate(prevStart.getDate() - 7);
  const prevEnd   = new Date(end);   prevEnd.setDate(prevEnd.getDate() - 7);
  const prevVals  = allDays.filter(d => { const dt = new Date(d.date + 'T12:00:00'); return dt >= prevStart && dt <= prevEnd; })
                            .map(d => d.stress_avg).filter(v => v != null && v > 0);
  const prevStress = prevVals.length ? Math.round(prevVals.reduce((s, v) => s + v, 0) / prevVals.length) : null;
  const stressDelta = stressAvg != null && prevStress != null ? stressAvg - prevStress : null;

  const stressColor = stressAvg == null ? '#94a3b8' : stressAvg < 26 ? '#22c55e' : stressAvg < 51 ? '#3b82f6' : stressAvg < 76 ? '#f97316' : '#ef4444';
  const stressLabel = stressAvg == null ? '' : stressAvg < 26 ? 'Repos' : stressAvg < 51 ? 'Faible' : stressAvg < 76 ? 'Modéré' : 'Élevé';

  if (!status && stressAvg == null) { el.style.display = 'none'; return; }

  el.style.display = '';
  el.innerHTML = `
    <div class="card" style="padding:12px 16px">
      <div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap">
        ${status ? `
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.4px;color:var(--muted)">Statut Garmin</span>
          <span style="padding:3px 12px;border-radius:20px;font-size:13px;font-weight:700;background:${status.color}20;color:${status.color}">${status.label}</span>
        </div>
        <div style="width:1px;height:30px;background:var(--border);flex-shrink:0"></div>` : ''}
        ${stressAvg != null ? `
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.4px;color:var(--muted)">Stress moy.</span>
          <span style="font-size:20px;font-weight:800;color:${stressColor}">${stressAvg}</span>
          <span style="font-size:11px;font-weight:600;color:${stressColor}">${stressLabel}</span>
          ${stressDelta != null ? `<span style="font-size:11px;font-weight:600;color:${stressDelta <= 0 ? '#22c55e' : '#ef4444'}">${stressDelta > 0 ? '▲' : '▼'} ${Math.abs(stressDelta)} vs sem. préc.</span>` : ''}
        </div>` : ''}
      </div>
    </div>`;
}

/* ── 4. KPI Poids courant (Mois / Année) ── */
function renderWeightKPI(containerId) {
  const el = document.getElementById(containerId);
  if (!el) { return; }

  if (!state.wellness?.days) { el.innerHTML = ''; return; }

  const days       = Object.values(state.wellness.days).sort((a, b) => a.date.localeCompare(b.date));
  const withWeight = days.filter(d => d.weight_kg);
  if (!withWeight.length) { el.innerHTML = ''; return; }

  const last    = withWeight[withWeight.length - 1];
  const prev    = withWeight.length >= 2 ? withWeight[withWeight.length - 2] : null;
  const delta   = prev ? +(last.weight_kg - prev.weight_kg).toFixed(1) : null;
  const bmi     = last.bmi ? last.bmi.toFixed(1) : null;
  const bmiColor = bmi ? (+bmi < 18.5 ? '#3b82f6' : +bmi < 25 ? '#22c55e' : +bmi < 30 ? '#f97316' : '#ef4444') : '';
  const dateStr = new Date(last.date + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

  el.innerHTML = `
    <div class="kpi-card" style="cursor:default">
      <div class="kpi-label">Poids</div>
      <div class="kpi-value">${last.weight_kg.toFixed(1)}<span class="kpi-unit"> kg</span></div>
      ${delta != null ? `<div class="kpi-delta ${delta <= 0 ? 'up' : 'down'}">${delta > 0 ? '▲' : '▼'} ${Math.abs(delta)} kg</div>` : ''}
    </div>
    ${bmi ? `<div class="kpi-card" style="cursor:default">
      <div class="kpi-label">IMC</div>
      <div class="kpi-value" style="color:${bmiColor}">${bmi}</div>
      <div class="kpi-delta" style="font-size:10px">${dateStr}</div>
    </div>` : ''}`;
}

/* ══════════════════════════════════════════════════════════
   DASHBOARD.JS — Period-based views (Day/Week/Month/Year)
   ══════════════════════════════════════════════════════════ */

/* ── Activity list (card style, used in side panels) ── */
function renderActivityList(containerId, acts, limit=8) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!acts.length) { el.innerHTML = '<div class="empty">Aucune activité sur cette période</div>'; return; }
  el.innerHTML = acts.slice(0, limit).map(a => {
    ACT_MAP[a.id] = a;
    const main   = a.distance_km > 0 ? `${a.distance_km} km` : fmt_dur(a.duration_min);
    const cal    = a.calories ? `${Math.round(a.calories)} kcal` : '';
    const load   = a.training_load > 0 ? `⚡${Math.round(a.training_load)}` : '';
    const te     = a.te_label || '';
    const sub    = [fmt_dur(a.duration_min), cal, load, te].filter(Boolean).join(' · ');
    const dateStr = a.date ? new Date(a.date+'T12:00:00').toLocaleDateString('fr-FR',{day:'numeric',month:'short'}) : '';
    return `<div class="activity-item" onclick="openDetail(${a.id})">
      <div class="act-icon ${a.type||'other'}">${a.icon||'⚡'}</div>
      <div>
        <div class="act-name">${a.name}</div>
        <div class="act-date">${dateStr}</div>
      </div>
      <div class="act-stats">
        <div class="act-main">${main}</div>
        <div class="act-sub">${sub}</div>
      </div>
    </div>`;
  }).join('');
}

function renderYearActivityList(containerId, acts) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const countEl = document.getElementById('year-count');
  if (countEl) countEl.textContent = `— ${acts.length} activités`;
  if (!acts.length) { el.innerHTML = '<div class="empty">Aucune activité sur cette période</div>'; return; }

  el.innerHTML = acts.map(a => {
    ACT_MAP[a.id] = a;
    const main   = a.distance_km > 0 ? `${a.distance_km} km` : fmt_dur(a.duration_min);
    const cal    = a.calories ? `${Math.round(a.calories)} kcal` : '';
    const load   = a.training_load > 0 ? `⚡${Math.round(a.training_load)}` : '';
    const sub    = [fmt_dur(a.duration_min), cal, load, a.te_label].filter(Boolean).join(' · ');
    const dateStr = a.date ? new Date(a.date+'T12:00:00').toLocaleDateString('fr-FR',{day:'numeric',month:'short'}) : '';
    return `<div class="activity-item" onclick="openDetail(${a.id})">
      <div class="act-icon ${a.type||'other'}">${a.icon||'⚡'}</div>
      <div>
        <div class="act-name">${a.name}</div>
        <div class="act-date">${dateStr}</div>
      </div>
      <div class="act-stats">
        <div class="act-main">${main}</div>
        <div class="act-sub">${sub}</div>
      </div>
    </div>`;
  }).join('');
}

function renderTopActivities(containerId, acts, limit=6) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!acts.length) { el.innerHTML = '<div class="empty">Aucune activité</div>'; return; }
  const sorted = [...acts].sort((a,b) => (b.training_load||0) - (a.training_load||0));
  el.innerHTML = sorted.slice(0, limit).map(a => {
    ACT_MAP[a.id] = a;
    const load   = a.training_load > 0 ? Math.round(a.training_load) : '–';
    const te     = a.aerobic_te > 0 ? `TE ${a.aerobic_te.toFixed(1)}` : '';
    const dist   = a.distance_km > 0 ? `${a.distance_km} km` : fmt_dur(a.duration_min);
    const cal    = a.calories ? `${Math.round(a.calories)} kcal` : '';
    const dateStr = a.date ? new Date(a.date+'T12:00:00').toLocaleDateString('fr-FR',{day:'numeric',month:'short'}) : '';
    return `<div class="activity-item" onclick="openDetail(${a.id})">
      <div class="act-icon ${a.type||'other'}">${a.icon||'⚡'}</div>
      <div>
        <div class="act-name">${a.name}</div>
        <div class="act-date">${dateStr} · ${dist} · ${cal}</div>
      </div>
      <div class="act-stats">
        <div class="act-main" style="color:var(--accent)">${load}<span style="font-size:11px;font-weight:400;color:var(--muted)"> pts</span></div>
        <div class="act-sub">${te || a.te_label || ''}</div>
      </div>
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
    const iso = cellDate.toISOString().slice(0,10);
    const allDay  = acts.filter(a => a.date === iso);
    const dayActs = allDay.filter(a => state.filter === 'all' || a.type === state.filter);
    const isToday = iso === TODAY.toISOString().slice(0,10);
    const numEl = isToday
      ? `<div class="day-num">${cellDate.getDate()}</div>`
      : `<div class="day-num">${cellDate.getDate()}</div>`;
    const dots = dayActs.map(a => `<div class="day-dot" style="background:${TYPE_COLOR[a.type]||'#888'}"></div>`).join('');
    const miniActs = allDay.slice(0,3).map(a => {
      ACT_MAP[a.id] = a;
      return `<div class="day-mini-act" style="color:${TYPE_COLOR[a.type]||'var(--muted)'}" onclick="event.stopPropagation();openDetail(${a.id})" title="${a.name}">${a.icon||'⚡'} ${fmt_dur(a.duration_min)}</div>`;
    }).join('');
    return `<div class="day-cell ${dayActs.length ? 'has-act' : ''} ${isToday ? 'today' : ''}">
      <div class="day-name">${day}</div>${numEl}
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
    const iso = new Date(start.getFullYear(), start.getMonth(), start.getDate()+i).toISOString().slice(0,10);
    return acts.filter(a=>a.date===iso).reduce((s,a)=>s+(a.distance_km||0),0);
  });
  const durs = DAYS_FR.map((_, i) => {
    const iso = new Date(start.getFullYear(), start.getMonth(), start.getDate()+i).toISOString().slice(0,10);
    return acts.filter(a=>a.date===iso).reduce((s,a)=>s+(a.duration_min||0),0);
  });
  const cols = DAYS_FR.map((_, i) => {
    const iso = new Date(start.getFullYear(), start.getMonth(), start.getDate()+i).toISOString().slice(0,10);
    const day = acts.filter(a=>a.date===iso);
    if (!day.length) return 'rgba(45,49,72,0.4)';
    return (TYPE_COLOR[day[0].type] || '#888') + 'cc';
  });

  mkChart('chart-week-dist', {
    type: 'bar',
    data: { labels: DAYS_FR, datasets: [{ data: dists, backgroundColor: cols, borderRadius: 6 }] },
    options: { ...CHART_OPTS, scales: { x:{grid:{display:false}}, y:{grid:{color:'#2a2a2a'}} } }
  });

  mkChart('chart-week-dur', {
    type: 'bar',
    data: { labels: DAYS_FR, datasets: [{ data: durs, backgroundColor: cols, borderRadius: 6 }] },
    options: { ...CHART_OPTS, scales: { x:{grid:{display:false}}, y:{grid:{color:'#2a2a2a'}} } }
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
    options: { ...CHART_OPTS, plugins: { legend:{position:'bottom',labels:{color:'#64748b',boxWidth:10}} }, scales: { x:{stacked:true,grid:{display:false}}, y:{stacked:true,grid:{color:'#2a2a2a'}} } }
  });

  const dist = typeDistribution(acts);
  const keys = Object.keys(dist);
  mkChart('chart-month-type', {
    type: 'bar',
    data: {
      labels: keys.map(t=>TYPE_LABEL[t]||t),
      datasets: [{ data: Object.values(dist), backgroundColor: keys.map(t=>(TYPE_COLOR[t]||'#888')+'cc'), borderRadius:6 }]
    },
    options: { ...CHART_OPTS, scales: { x:{grid:{display:false}}, y:{grid:{color:'#2a2a2a'}} } }
  });
}

function renderYearCharts(acts) {
  const { start } = getPeriodBounds();
  const year = start.getFullYear();
  const months = Array.from({length:12},(_,i)=>i);
  const types = Object.keys(TYPE_LABEL);

  mkChart('chart-year-dist', {
    type: 'bar',
    data: {
      labels: MONTHS_FR,
      datasets: types.map(t => ({
        label: TYPE_LABEL[t],
        data: months.map(m => acts.filter(a=>a.type===t && new Date(a.start_time).getMonth()===m).reduce((s,a)=>s+(a.distance_km||0),0)),
        backgroundColor: TYPE_COLOR[t]+'cc', borderRadius: 4,
      })).filter(ds=>ds.data.some(v=>v>0))
    },
    options: { ...CHART_OPTS, plugins:{legend:{position:'bottom',labels:{color:'#64748b',boxWidth:10}}}, scales:{x:{stacked:true,grid:{display:false}},y:{stacked:true,grid:{color:'#2a2a2a'}}} }
  });

  mkChart('chart-year-type', {
    type: 'bar',
    data: {
      labels: MONTHS_FR,
      datasets: types.map(t => ({
        label: TYPE_LABEL[t],
        data: months.map(m => acts.filter(a=>a.type===t && new Date(a.start_time).getMonth()===m).length),
        backgroundColor: TYPE_COLOR[t]+'cc', borderRadius: 3,
      })).filter(ds=>ds.data.some(v=>v>0))
    },
    options: { ...CHART_OPTS, plugins:{legend:{position:'bottom',labels:{color:'#64748b',boxWidth:10}}}, scales:{x:{stacked:true,grid:{display:false}},y:{stacked:true,grid:{color:'#2a2a2a'}}} }
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
    renderActivityList('list-day', acts, 5);
    renderZones('zones-day', zones);
  }
  if (state.tab === 'week') {
    renderKPIs('kpi-week', acts, prevActs);
    renderWeekCells(getAll());
    renderWeekCharts(acts);
    renderActivityList('list-week', acts, 6);
  }
  if (state.tab === 'month') {
    renderKPIs('kpi-month', acts, prevActs);
    renderMonthCharts(acts);
    renderZones('zones-month', zones);
    renderActivityList('list-month', acts, 8);
  }
  if (state.tab === 'year') {
    renderKPIs('kpi-year', acts, prevActs);
    renderYearCharts(acts);
    renderTopActivities('list-year', acts, 6);
    renderYearActivityList('list-year-all', acts);
  }
}

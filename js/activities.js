/* ══════════════════════════════════════════════════════════
   ACTIVITIES.JS — Full activities table view
   ══════════════════════════════════════════════════════════ */

/* ── Period filter state for activities view ── */
const actState = {
  period: localStorage.getItem('act_period') || 'month',  // week | month | year | all
  sort:   { col: 'date', dir: 'desc' },
  page:   0,
  view:   localStorage.getItem('act_view') || 'table',    // table | calendar
};
const ACT_PAGE_SIZE = 50;

function sortActBy(col) {
  if (actState.sort.col === col) {
    actState.sort.dir = actState.sort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    actState.sort.col = col;
    actState.sort.dir = 'desc';
  }
  actState.page = 0;
  renderActivities();
}

function setActPeriod(p, btn) {
  actState.period = p;
  actState.page   = 0;
  localStorage.setItem('act_period', p);
  document.querySelectorAll('.act-period-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderActivities();
}

function getActivitiesByPeriod() {
  const all = getAll();
  const now = new Date(TODAY);
  let cutoff;
  if (actState.period === 'week') {
    cutoff = new Date(now); cutoff.setDate(now.getDate() - 7);
  } else if (actState.period === 'month') {
    cutoff = new Date(now.getFullYear(), now.getMonth(), 1);
  } else if (actState.period === 'year') {
    cutoff = new Date(now.getFullYear(), 0, 1);
  } else {
    return state.filter === 'all' ? all : all.filter(a => a.type === state.filter);
  }
  return all.filter(a => {
    const d = new Date(a.start_time || a.date+'T12:00:00');
    if (d < cutoff) return false;
    if (state.filter !== 'all' && a.type !== state.filter) return false;
    return true;
  });
}

/* ══════════════════════════════════════════════════════════
   RENDER ACTIVITIES TABLE or CALENDAR
   ══════════════════════════════════════════════════════════ */
function renderActivities() {
  // Toggle view visibility
  const tableEl = document.getElementById('acts-table-container');
  const calEl = document.getElementById('acts-calendar');
  if (tableEl) tableEl.style.display = actState.view === 'table' ? '' : 'none';
  if (calEl) calEl.style.display = actState.view === 'calendar' ? '' : 'none';

  if (actState.view === 'calendar') {
    renderHistoryCalendar();
    return;
  }

  const raw  = getActivitiesByPeriod();

  /* Search filter */
  const q = (document.getElementById('acts-search')?.value || '').trim().toLowerCase();
  const acts = q ? raw.filter(a => (a.name||'').toLowerCase().includes(q) || (a.type_label||TYPE_LABEL[a.type]||'').toLowerCase().includes(q)) : raw;

  /* KPIs strip (computed on filtered set, not paginated) */
  const kpis = computeKPIs(acts);
  const dur  = kpis.duration >= 60
    ? `${Math.floor(kpis.duration/60)}h${String(Math.round(kpis.duration%60)).padStart(2,'0')}`
    : `${Math.round(kpis.duration)}min`;

  document.getElementById('acts-kpi-strip').innerHTML = [
    { label:'Activités',   val: kpis.activities,                                   unit:'' },
    { label:'Distance',    val: kpis.distance.toFixed(1),                          unit:'km' },
    { label:'Temps actif', val: dur,                                                unit:'' },
    { label:'Calories',    val: Math.round(kpis.calories).toLocaleString('fr'),    unit:'kcal' },
    { label:'Charge tot.', val: kpis.training_load > 0 ? Math.round(kpis.training_load) : '–', unit:'pts' },
  ].map(k => `
    <div class="kpi-card" style="padding:12px 16px">
      <div class="kpi-label">${k.label}</div>
      <div class="kpi-value" style="font-size:20px">${k.val}<span class="kpi-unit">${k.unit}</span></div>
    </div>`).join('');

  /* Sort */
  const { col, dir } = actState.sort;
  const d = dir === 'asc' ? 1 : -1;
  const sorted = [...acts].sort((a, b) => {
    const vals = {
      date:     [a.date || '', b.date || ''],
      type:     [a.type || '', b.type || ''],
      name:     [(a.name || '').toLowerCase(), (b.name || '').toLowerCase()],
      duration: [a.duration_min || 0, b.duration_min || 0],
      distance: [a.distance_km  || 0, b.distance_km  || 0],
      hr:       [a.hr_avg       || 0, b.hr_avg       || 0],
      calories: [a.calories     || 0, b.calories     || 0],
      load:     [a.training_load|| 0, b.training_load|| 0],
    };
    const [va, vb] = vals[col] || vals.date;
    return typeof va === 'string' ? va.localeCompare(vb) * d : (va - vb) * d;
  });

  /* Update th indicators */
  document.querySelectorAll('.th-sort').forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.dataset.col === col) th.classList.add('sort-' + dir);
  });

  /* Pagination */
  const total      = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / ACT_PAGE_SIZE));
  if (actState.page >= totalPages) actState.page = totalPages - 1;
  const start = actState.page * ACT_PAGE_SIZE;
  const page  = sorted.slice(start, start + ACT_PAGE_SIZE);

  /* Table */
  const tbody = document.getElementById('acts-table-body');
  if (!page.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:32px;color:var(--muted)">Aucune activité sur cette période</td></tr>`;
    _renderActsPagination(total, totalPages);
    return;
  }

  tbody.innerHTML = page.map(a => {
    ACT_MAP[a.id] = a;
    const dateStr  = a.date ? new Date(a.date+'T12:00:00').toLocaleDateString('fr-FR',{day:'numeric',month:'short',year:'numeric'}) : '–';
    const label    = a.type_label || TYPE_LABEL[a.type] || a.type;
    const dist     = a.distance_km > 0 ? `${a.distance_km} km` : '–';
    const hr       = a.hr_avg ? `${a.hr_avg} bpm` : '–';
    const cal      = a.calories ? Math.round(a.calories).toLocaleString('fr') : '–';
    const load     = a.training_load > 0 ? Math.round(a.training_load) : '–';
    return `<tr onclick="openDetail(${a.id})">
      <td class="td-date">${dateStr}</td>
      <td>${typeBadge(a.type, label)}</td>
      <td class="td-name">${a.name}</td>
      <td class="td-num">${fmt_dur(a.duration_min)}</td>
      <td class="td-num">${dist}</td>
      <td class="td-num col-hr">${hr}</td>
      <td class="td-num col-cal">${cal}</td>
      <td class="td-num col-elev" style="color:var(--muted)">${load !== '–' ? `⚡${load}` : '–'}</td>
    </tr>`;
  }).join('');

  _renderActsPagination(total, totalPages);
}

function _renderActsPagination(total, totalPages) {
  /* Remove old pagination */
  const old = document.getElementById('acts-pagination');
  if (old) old.remove();

  if (totalPages <= 1) return;

  const wrap = document.createElement('div');
  wrap.id = 'acts-pagination';
  wrap.className = 'acts-pagination';

  const start = actState.page * ACT_PAGE_SIZE + 1;
  const end   = Math.min((actState.page + 1) * ACT_PAGE_SIZE, total);

  wrap.innerHTML = `
    <span class="acts-pag-info">${start}–${end} sur ${total}</span>
    <div style="display:flex;gap:4px">
      <button class="hpb" onclick="actChangePage(-1)" ${actState.page === 0 ? 'disabled' : ''}>‹ Préc.</button>
      <button class="hpb" onclick="actChangePage(1)"  ${actState.page >= totalPages-1 ? 'disabled' : ''}>Suiv. ›</button>
    </div>`;

  document.querySelector('.table-container').insertAdjacentElement('afterend', wrap);
}

function actChangePage(dir) {
  actState.page += dir;
  renderActivities();
  document.querySelector('.table-container')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ══════════════════════════════════════════════════════════
   CALENDAR VIEW
   ══════════════════════════════════════════════════════════ */
function switchHistoryView(mode) {
  actState.view = mode;
  localStorage.setItem('act_view', mode);
  document.querySelectorAll('.history-view-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`history-view-${mode}`)?.classList.add('active');
  renderActivities();
}

function renderHistoryCalendar() {
  const el = document.getElementById('acts-calendar');
  if (!el) return;

  const acts = getActivitiesByPeriod();
  if (!acts.length) {
    el.innerHTML = '<div style="padding:40px;text-align:center;color:var(--muted)">Aucune activité sur cette période</div>';
    return;
  }

  // Déterminer l'intervalle de dates
  const dates = acts.map(a => a.date || new Date(a.start_time).toISOString().split('T')[0]).sort();
  const minDate = new Date(dates[0] + 'T12:00:00');
  const maxDate = new Date(dates[dates.length - 1] + 'T12:00:00');

  // Ajouter mois complet avant/après
  const startDate = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
  const endDate = new Date(maxDate.getFullYear(), maxDate.getMonth() + 1, 0);

  // Grouper activités par date
  const actsByDate = {};
  acts.forEach(a => {
    const d = a.date || new Date(a.start_time).toISOString().split('T')[0];
    actsByDate[d] = (actsByDate[d] || []).concat(a);
  });

  let html = '<div class="calendar-grid">';

  // En-têtes jours semaine
  const dayNames = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
  dayNames.forEach(d => {
    html += `<div class="calendar-header">${d}</div>`;
  });

  // Cellules jour
  let d = new Date(startDate);
  while (d <= endDate) {
    const dayOfWeek = (d.getDay() + 6) % 7; // 0=Lun ... 6=Dim
    const dateStr = d.toISOString().split('T')[0];
    const dayActs = actsByDate[dateStr] || [];
    const isInRange = d >= minDate && d <= maxDate;
    const isToday = dateStr === new Date(TODAY).toISOString().split('T')[0];

    const cellClass = isInRange ? 'calendar-day-active' : 'calendar-day-muted';
    const todayClass = isToday ? ' calendar-day-today' : '';

    const dots = dayActs.map(a => `<div class="calendar-dot" style="background:${TYPE_COLOR[a.type] || '#888'}" title="${a.name}"></div>`).join('');

    html += `<div class="calendar-day ${cellClass}${todayClass}" onclick="${dayActs.length > 0 ? `showDayActivities('${dateStr}')` : ''}">
      <div class="calendar-day-num">${d.getDate()}</div>
      ${dots ? `<div class="calendar-dots">${dots}</div>` : ''}
    </div>`;

    d.setDate(d.getDate() + 1);
  }

  html += '</div>';
  el.innerHTML = html;
}

function showDayActivities(dateStr) {
  const allActs = getActivitiesByPeriod();
  const dayActs = allActs.filter(a => (a.date || new Date(a.start_time).toISOString().split('T')[0]) === dateStr);
  if (!dayActs.length) return;

  const date = new Date(dateStr + 'T12:00:00');
  const dateLabel = date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:1000;display:flex;align-items:center;justify-content:center';
  modal.onclick = (e) => e.target === modal && modal.remove();

  const card = document.createElement('div');
  card.style.cssText = 'background:var(--bg);border-radius:12px;max-width:500px;max-height:80vh;overflow:auto;padding:20px;box-shadow:0 4px 20px rgba(0,0,0,0.3)';

  card.innerHTML = `<div style="font-size:14px;font-weight:700;margin-bottom:16px">${dateLabel}</div>` +
    dayActs.map(a => {
      ACT_MAP[a.id] = a;
      const label = a.type_label || TYPE_LABEL[a.type] || a.type;
      const dist = a.distance_km > 0 ? `${a.distance_km} km` : fmt_dur(a.duration_min);
      return `<div style="padding:12px;background:var(--surface2);border-radius:8px;margin-bottom:8px;cursor:pointer" onclick="openDetail(${a.id}); modal.remove()">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
          <span style="font-size:18px">${a.icon || '⚡'}</span>
          <div>
            <div style="font-weight:600;color:${TYPE_COLOR[a.type]||'var(--text)'}">${label}</div>
            <div style="font-size:12px;color:var(--muted)">${a.name}</div>
          </div>
        </div>
        <div style="font-size:12px;color:var(--text2)">${dist}${a.calories ? ` · ${Math.round(a.calories)} kcal` : ''}${a.training_load > 0 ? ` · ⚡${Math.round(a.training_load)}` : ''}</div>
      </div>`;
    }).join('') +
    `<button onclick="this.closest('div').parentElement.remove()" style="width:100%;margin-top:12px;padding:8px;background:var(--surface);border:1px solid var(--border);border-radius:6px;cursor:pointer;color:var(--muted);font-size:12px">Fermer</button>`;

  modal.appendChild(card);
  document.body.appendChild(modal);
}

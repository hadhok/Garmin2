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

  /* Afficher calendrier ou table */
  if (actState.view === 'calendar') {
    renderHistoryCalendar();
    return;
  }

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

  // Initialiser l'état de navigation du calendrier si pas présent
  if (!window._calendarMonth) {
    window._calendarMonth = startDate.getMonth();
    window._calendarYear = startDate.getFullYear();
  }

  // Grouper activités par date + calculer totaux
  const actsByDate = {};
  acts.forEach(a => {
    const d = a.date || new Date(a.start_time).toISOString().split('T')[0];
    actsByDate[d] = (actsByDate[d] || []).concat(a);
  });

  // Générer les mois visibles
  const currentDate = new Date(window._calendarYear, window._calendarMonth, 1);
  const monthsToShow = [];
  let d = new Date(startDate);
  while (d <= endDate) {
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    if (!monthsToShow.some(m => m.key === key)) {
      monthsToShow.push({ key, year: d.getFullYear(), month: d.getMonth() });
    }
    d.setMonth(d.getMonth() + 1);
  }

  // Header navigation
  const MONTHS_LONG = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
  const monthTitle = MONTHS_LONG[window._calendarMonth];
  const yearTitle = window._calendarYear;
  const canGoPrev = startDate.getFullYear() < window._calendarYear || (startDate.getFullYear() === window._calendarYear && startDate.getMonth() < window._calendarMonth);
  const canGoNext = endDate.getFullYear() > window._calendarYear || (endDate.getFullYear() === window._calendarYear && endDate.getMonth() > window._calendarMonth);

  let html = `
    <div class="calendar-header-nav">
      <button onclick="calendarNavMonth(-1)" ${!canGoPrev ? 'disabled style="opacity:0.3;cursor:not-allowed"' : ''} class="cal-nav-btn">← Préc.</button>
      <div class="calendar-month-title">
        <div style="font-size:24px;font-weight:800">${monthTitle}</div>
        <div style="font-size:14px;color:var(--muted);font-weight:600">${yearTitle}</div>
      </div>
      <button onclick="calendarNavMonth(1)" ${!canGoNext ? 'disabled style="opacity:0.3;cursor:not-allowed"' : ''} class="cal-nav-btn">Suiv. →</button>
    </div>
    <div class="calendar-grid">`;

  // Calculer la plage pour le mois courant
  const monthStart = new Date(window._calendarYear, window._calendarMonth, 1);
  const monthEnd = new Date(window._calendarYear, window._calendarMonth + 1, 0);
  const displayStart = new Date(monthStart);
  displayStart.setDate(displayStart.getDate() - ((displayStart.getDay() + 6) % 7)); // Début lun
  const displayEnd = new Date(monthEnd);
  displayEnd.setDate(displayEnd.getDate() + (7 - ((displayEnd.getDay() + 6) % 7))); // Fin dim

  // En-têtes jours semaine
  const dayNames = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
  dayNames.forEach(d => {
    html += `<div class="calendar-header">${d}</div>`;
  });

  // Cellules jour pour le mois courant
  let d = new Date(displayStart);
  while (d <= displayEnd) {
    const dateStr = d.toISOString().split('T')[0];
    const dayActs = actsByDate[dateStr] || [];
    const isInRange = d >= minDate && d <= maxDate;
    const isToday = dateStr === new Date(TODAY).toISOString().split('T')[0];
    const isCurrentMonth = d.getMonth() === window._calendarMonth && d.getFullYear() === window._calendarYear;

    const totalDur = dayActs.reduce((s, a) => s + (a.duration_min || 0), 0);
    const totalDist = dayActs.reduce((s, a) => s + (a.distance_km || 0), 0);
    const totalLoad = dayActs.reduce((s, a) => s + (a.training_load || 0), 0);

    const cellClass = isCurrentMonth
      ? (isInRange && dayActs.length > 0 ? 'calendar-day-active' : isInRange ? 'calendar-day-empty' : 'calendar-day-muted')
      : 'calendar-day-other-month';
    const todayClass = isToday ? ' calendar-day-today' : '';

    // Afficher les activités avec icônes et couleurs
    const actIcons = dayActs.slice(0, 3).map(a => `<div class="cal-act-icon" style="background:${TYPE_COLOR[a.type]||'#888'};color:white;font-size:11px" title="${a.name}">${a.icon || '⚡'}</div>`).join('');
    const moreCount = dayActs.length > 3 ? dayActs.length - 3 : 0;

    const durStr = totalDur > 0 ? `${Math.round(totalDur/60)}h` : '';
    const distStr = totalDist > 0 ? `${totalDist.toFixed(0)}km` : '';
    const loadStr = totalLoad > 0 ? `⚡${Math.round(totalLoad)}` : '';
    const stats = [durStr, distStr, loadStr].filter(Boolean).join(' · ');

    const cursor = dayActs.length > 0 ? 'cursor:pointer' : '';

    html += `<div class="calendar-day ${cellClass}${todayClass}" style="${cursor}" onclick="${dayActs.length > 0 ? `showDayActivities('${dateStr}')` : ''}">
      <div class="calendar-day-num">${d.getDate()}</div>
      ${dayActs.length > 0 ? `
        <div class="calendar-day-acts">
          <div class="cal-act-icons">${actIcons}${moreCount > 0 ? `<div class="cal-more">+${moreCount}</div>` : ''}</div>
          <div class="calendar-day-stats">${stats}</div>
        </div>
      ` : ''}
    </div>`;

    d.setDate(d.getDate() + 1);
  }

  html += '</div>';
  el.innerHTML = html;
}

function calendarNavMonth(dir) {
  window._calendarMonth += dir;
  // Wrap around years
  if (window._calendarMonth > 11) {
    window._calendarMonth = 0;
    window._calendarYear++;
  } else if (window._calendarMonth < 0) {
    window._calendarMonth = 11;
    window._calendarYear--;
  }
  renderActivities();
}

function showDayActivities(dateStr) {
  const allActs = getActivitiesByPeriod();
  const dayActs = allActs.filter(a => (a.date || new Date(a.start_time).toISOString().split('T')[0]) === dateStr);
  if (!dayActs.length) return;

  const date = new Date(dateStr + 'T12:00:00');
  const dateLabel = date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  // Calculer totaux
  const totalDur = dayActs.reduce((s, a) => s + (a.duration_min || 0), 0);
  const totalDist = dayActs.reduce((s, a) => s + (a.distance_km || 0), 0);
  const totalCal = dayActs.reduce((s, a) => s + (a.calories || 0), 0);
  const totalLoad = dayActs.reduce((s, a) => s + (a.training_load || 0), 0);

  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);z-index:1000;display:flex;align-items:center;justify-content:center;padding:16px;animation:fadeIn .2s';
  modal.onclick = (e) => e.target === modal && modal.remove();

  const card = document.createElement('div');
  card.style.cssText = 'background:var(--bg);border-radius:16px;max-width:520px;width:100%;max-height:85vh;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 10px 40px rgba(0,0,0,0.4);animation:slideUp .3s';

  // Header avec date et stats
  const headerHtml = `
    <div style="background:linear-gradient(135deg, var(--accent) 0%, rgba(163,230,53,0.8) 100%);padding:20px;color:white">
      <div style="font-size:16px;font-weight:700;margin-bottom:12px">${dateLabel}</div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;font-size:12px">
        <div style="opacity:0.95"><div style="font-weight:700;font-size:18px">${Math.round(totalDur/60)}<span style="font-size:11px">h</span></div><div style="opacity:0.8">Durée</div></div>
        <div style="opacity:0.95"><div style="font-weight:700;font-size:18px">${totalDist.toFixed(1)}<span style="font-size:11px">km</span></div><div style="opacity:0.8">Distance</div></div>
        <div style="opacity:0.95"><div style="font-weight:700;font-size:18px">${Math.round(totalCal)}<span style="font-size:11px">kcal</span></div><div style="opacity:0.8">Calories</div></div>
        <div style="opacity:0.95"><div style="font-weight:700;font-size:18px">${Math.round(totalLoad)}</div><div style="opacity:0.8">⚡ Charge</div></div>
      </div>
    </div>
  `;

  // Liste activités
  const activitiesHtml = dayActs.map(a => {
    ACT_MAP[a.id] = a;
    const label = a.type_label || TYPE_LABEL[a.type] || a.type;
    const dist = a.distance_km > 0 ? `${a.distance_km.toFixed(1)} km` : '–';
    const dur = fmt_dur(a.duration_min);
    const color = TYPE_COLOR[a.type] || '#888';
    return `
      <div style="padding:14px 16px;border-bottom:1px solid var(--border);cursor:pointer;transition:all .15s;display:flex;gap:12px"
           onclick="openDetail(${a.id}); modal.remove()"
           onmouseover="this.style.background='var(--surface2)'"
           onmouseout="this.style.background='transparent'">
        <div style="width:48px;height:48px;background:${color}20;border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0;color:${color};font-size:24px;border:2px solid ${color}33">
          ${a.icon || '⚡'}
        </div>
        <div style="flex:1">
          <div style="font-weight:700;color:${color};font-size:13px;margin-bottom:2px">${label}</div>
          <div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:4px">${a.name}</div>
          <div style="display:flex;gap:12px;font-size:11px;color:var(--text2);flex-wrap:wrap">
            <span>⏱️ ${dur}</span>
            <span>📍 ${dist}</span>
            ${a.calories ? `<span>🔥 ${Math.round(a.calories)} kcal</span>` : ''}
            ${a.training_load > 0 ? `<span>⚡ ${Math.round(a.training_load)} pts</span>` : ''}
            ${a.hr_avg ? `<span>❤️ ${a.hr_avg} bpm</span>` : ''}
          </div>
        </div>
        <div style="color:var(--accent);font-size:16px;align-self:center">→</div>
      </div>
    `;
  }).join('');

  // Footer
  const footerHtml = `
    <div style="padding:12px;border-top:1px solid var(--border);background:var(--surface2)">
      <button onclick="this.closest('[style*=fixed]').remove()"
              style="width:100%;padding:10px;background:var(--surface);border:1px solid var(--border);border-radius:8px;cursor:pointer;color:var(--text);font-size:13px;font-weight:600;transition:all .15s"
              onmouseover="this.style.background='var(--surface3)'"
              onmouseout="this.style.background='var(--surface)'">Fermer</button>
    </div>
  `;

  card.innerHTML = headerHtml + `<div style="overflow-y:auto;flex:1">${activitiesHtml}</div>` + footerHtml;

  modal.appendChild(card);
  document.body.appendChild(modal);
}

/* ══════════════════════════════════════════════════════════
   ACTIVITIES.JS — Full activities table view
   ══════════════════════════════════════════════════════════ */

/* ── Period filter state for activities view ── */
const actState = {
  period: localStorage.getItem('act_period') || 'month',  // week | month | year | all
  sort:   { col: 'date', dir: 'desc' },
  page:   0,
};

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
   RENDER ACTIVITIES TABLE
   ══════════════════════════════════════════════════════════ */
function renderActivities() {
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

  const escape = escapeHTML; /* sanit.js */
  tbody.innerHTML = page.map(a => {
    ACT_MAP[a.id] = a;
    const dateStr  = a.date ? new Date(a.date+'T12:00:00').toLocaleDateString('fr-FR',{day:'numeric',month:'short',year:'numeric'}) : '–';
    const label    = a.type_label || TYPE_LABEL[a.type] || a.type;
    const dist     = a.distance_km > 0 ? `${a.distance_km} km` : '–';
    const hr       = a.hr_avg ? `${a.hr_avg} bpm` : '–';
    const cal      = a.calories ? Math.round(a.calories).toLocaleString('fr') : '–';
    const load     = a.training_load > 0 ? Math.round(a.training_load) : '–';
    const safeName = escape(a.name);
    return `<tr onclick="openDetail(${a.id})">
      <td class="td-date">${dateStr}</td>
      <td>${typeBadge(a.type, label)}</td>
      <td class="td-name">${safeName}</td>
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

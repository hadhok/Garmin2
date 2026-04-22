/* ══════════════════════════════════════════════════════════
   ACTIVITIES.JS — Full activities table view
   ══════════════════════════════════════════════════════════ */

/* ── Period filter state for activities view ── */
const actState = {
  period: 'month',  // week | month | year | all
};

function setActPeriod(p, btn) {
  actState.period = p;
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
  const acts = getActivitiesByPeriod();

  /* KPIs strip */
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

  /* Table */
  const tbody = document.getElementById('acts-table-body');
  if (!acts.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:32px;color:var(--muted)">Aucune activité sur cette période</td></tr>`;
    return;
  }

  tbody.innerHTML = acts.map(a => {
    ACT_MAP[a.id] = a;
    const dateStr  = a.date ? new Date(a.date+'T12:00:00').toLocaleDateString('fr-FR',{day:'numeric',month:'short',year:'numeric'}) : '–';
    const label    = a.type_label || TYPE_LABEL[a.type] || a.type;
    const dist     = a.distance_km > 0 ? `${a.distance_km} km` : '–';
    const hr       = a.hr_avg ? `${a.hr_avg} bpm` : '–';
    const cal      = a.calories ? Math.round(a.calories).toLocaleString('fr') : '–';
    const load     = a.training_load > 0 ? Math.round(a.training_load) : '–';
    const elev     = a.elevation_m > 0 ? `${Math.round(a.elevation_m)} m` : '–';
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
}

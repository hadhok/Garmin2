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

/* ── Export CSV de la liste filtrée (période + type + recherche) ── */
function exportActivitiesCSV() {
  const raw = getActivitiesByPeriod();
  const q = (document.getElementById('acts-search')?.value || '').trim().toLowerCase();
  const acts = q ? raw.filter(a => (a.name||'').toLowerCase().includes(q) || (a.type_label||TYPE_LABEL[a.type]||'').toLowerCase().includes(q)) : raw;
  if (!acts.length) { showToast('Aucune activité à exporter', 'err'); return; }

  const cols = [
    ['date',          a => a.date || ''],
    ['nom',           a => a.name || ''],
    ['type',          a => a.type_label || TYPE_LABEL[a.type] || a.type || ''],
    ['duree_min',     a => a.duration_min != null ? Math.round(a.duration_min) : ''],
    ['distance_km',   a => a.distance_km ?? ''],
    ['calories',      a => a.calories != null ? Math.round(a.calories) : ''],
    ['fc_moy',        a => a.hr_avg ?? ''],
    ['fc_max',        a => a.hr_max ?? ''],
    ['denivele_m',    a => a.elevation_m != null ? Math.round(a.elevation_m) : ''],
    ['allure_min_km', a => a.pace_min_km || ''],
    ['charge',        a => a.training_load != null ? Math.round(a.training_load) : ''],
    ['vo2max',        a => a.vo2max ?? ''],
  ];
  const esc = v => {
    const s = String(v);
    return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  /* Séparateur ; + BOM UTF-8 : ouverture directe dans Excel FR */
  const lines = [cols.map(c => c[0]).join(';')]
    .concat(acts.map(a => cols.map(c => esc(c[1](a))).join(';')));
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `activites_${TODAY_ISO}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  showToast(`${acts.length} activités exportées`, 'ok');
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

  /* Comparateur natation */
  if (typeof populateSwimCompareSelectors === 'function') populateSwimCompareSelectors();

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

/* ══════════════════════════════════════════════════════════
   COMPARER DEUX SÉANCES DE NATATION
   ══════════════════════════════════════════════════════════ */
function getSwims() {
  return getAll().filter(a => a.type === 'swim');
}

function populateSwimCompareSelectors() {
  const swims = getSwims()
    .sort((a, b) => (b.start_time || b.date || '').localeCompare(a.start_time || a.date || ''));
  const opts = swims.map(s => {
    const dateStr = s.date || (s.start_time || '').slice(0, 10);
    const date = dateStr ? new Date(dateStr + 'T12:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: '2-digit' }) : '–';
    const dist = s.distance_km ? `${s.distance_km.toFixed(2)} km` : '';
    const pace = s.pace_per_100m ? ` · ${s.pace_per_100m}/100m` : '';
    const name = s.name ? ` — ${s.name.slice(0, 28)}` : '';
    return `<option value="${s.id}">${date} ${dist}${pace}${name}</option>`;
  }).join('');

  ['swim-compare-sel-a', 'swim-compare-sel-b'].forEach((id, idx) => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = '<option value="">— Choisir une séance —</option>' + opts;
    if (prev) {
      sel.value = prev;
    } else if (swims.length > idx) {
      sel.value = String(swims[idx].id);
    }
  });
  updateSwimCompare();
}

function updateSwimCompare() {
  const idA = document.getElementById('swim-compare-sel-a')?.value;
  const idB = document.getElementById('swim-compare-sel-b')?.value;
  const el  = document.getElementById('swim-compare-result');
  if (!el) return;

  if (!idA || !idB) { el.innerHTML = ''; return; }
  if (idA === idB) {
    el.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:8px 0">Sélectionne deux séances différentes.</div>';
    return;
  }

  const swims = getSwims();
  const a = swims.find(s => String(s.id) === String(idA));
  const b = swims.find(s => String(s.id) === String(idB));
  if (!a || !b) return;

  // Métrique : [label, valA, valB, unitA, unitB, lowerIsBetter (null = pas de gagnant)]
  const metrics = [
    ['Distance',      a.distance_km?.toFixed(2), b.distance_km?.toFixed(2), 'km', 'km', null],
    ['Durée',         a.duration_min ? (typeof secToTime==='function' ? secToTime(a.duration_min*60) : `${Math.round(a.duration_min)}min`) : null,
                       b.duration_min ? (typeof secToTime==='function' ? secToTime(b.duration_min*60) : `${Math.round(b.duration_min)}min`) : null, '', '', null],
    ['Allure',        a.pace_per_100m, b.pace_per_100m, '/100m', '/100m', true],
    ['SWOLF',         a.swolf,         b.swolf,         '', '', true],
    ['Cadence',       a.swim_cadence,  b.swim_cadence,  'coups/min', 'coups/min', null],
    ['Longueurs',     a.pool_lengths,  b.pool_lengths,  '', '', null],
    ['Pause',         a.rest_min>0 ? (typeof fmt_dur==='function'?fmt_dur(a.rest_min):`${Math.round(a.rest_min)}min`) : null,
                       b.rest_min>0 ? (typeof fmt_dur==='function'?fmt_dur(b.rest_min):`${Math.round(b.rest_min)}min`) : null, '', '', true],
    ['FC moy.',       a.hr_avg,        b.hr_avg,        'bpm', 'bpm', true],
    ['FC max',        a.hr_max,        b.hr_max,        'bpm', 'bpm', true],
    ['Charge',        a.training_load ? Math.round(a.training_load) : null, b.training_load ? Math.round(b.training_load) : null, 'pts', 'pts', null],
    ['Calories',      a.calories,      b.calories,      'kcal', 'kcal', null],
  ].filter(([, vA, vB]) => vA != null && vB != null);

  const toNum = (v) => {
    if (typeof v === 'string' && v.includes(':')) {
      const [m, s] = v.split(':').map(Number);
      return m * 60 + (s || 0);
    }
    return parseFloat(v);
  };

  const rows = metrics.map(([label, vA, vB, uA, uB, lowerBetter]) => {
    const nA = toNum(vA), nB = toNum(vB);
    const max = Math.max(nA, nB) || 1;
    const wA = Math.round((nA / max) * 100);
    const wB = Math.round((nB / max) * 100);
    const aWins = lowerBetter === null ? false : (lowerBetter ? nA < nB : nA > nB);
    const bWins = lowerBetter === null ? false : (lowerBetter ? nB < nA : nB > nA);
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

  const dateA = new Date(a.date + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'long' });
  const dateB = new Date(b.date + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'long' });

  el.innerHTML = `
    <div style="display:flex;gap:12px;margin-bottom:14px;flex-wrap:wrap">
      <div style="flex:1;min-width:140px;padding:10px 12px;border-radius:8px;background:rgba(59,130,246,0.07);border:1px solid rgba(59,130,246,0.2)">
        <div style="font-size:10px;font-weight:700;color:#3b82f6;text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px">A</div>
        <div style="font-size:13px;font-weight:600">${a.name || 'Natation'}</div>
        <div style="font-size:11px;color:var(--muted)">${dateA}</div>
      </div>
      <div style="flex:1;min-width:140px;padding:10px 12px;border-radius:8px;background:rgba(249,115,22,0.07);border:1px solid rgba(249,115,22,0.2)">
        <div style="font-size:10px;font-weight:700;color:#f97316;text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px">B</div>
        <div style="font-size:13px;font-weight:600">${b.name || 'Natation'}</div>
        <div style="font-size:11px;color:var(--muted)">${dateB}</div>
      </div>
    </div>
    <table class="compare-table"><tbody>${rows}</tbody></table>
    ${zonesHtml}`;
}

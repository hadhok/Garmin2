/* ══════════════════════════════════════════════════════════
   HEALTH.JS — Santé / Wellness view
   ══════════════════════════════════════════════════════════ */

function getWellnessDays() {
  if (!state.wellness?.days) return [];
  return Object.values(state.wellness.days)
    .sort((a,b) => a.date.localeCompare(b.date))
    .slice(-state.healthDays);
}

function avg(days, key) {
  const vals = days.map(d => d[key]).filter(v => v != null && v > 0);
  return vals.length ? vals.reduce((s,v) => s+v, 0) / vals.length : null;
}

function fmtAvg(days, key, decimals=0) {
  const v = avg(days, key);
  return v != null ? v.toFixed(decimals) : '–';
}

function setBadge(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text ? `moy. ${text}` : '';
}

function hlabels(days) {
  return days.map(d => {
    const dt = new Date(d.date + 'T12:00:00');
    return dt.toLocaleDateString('fr-FR', { day:'numeric', month:'short' });
  });
}

/* ══════════════════════════════════════════════════════════
   RECOVERY SCORE
   ══════════════════════════════════════════════════════════ */
function computeRecoveryScore() {
  if (!state.wellness?.days) return null;
  const days = Object.values(state.wellness.days).sort((a,b) => a.date.localeCompare(b.date));
  if (!days.length) return null;

  const todayIso = TODAY.toLocaleDateString("sv-SE");
  const yesterday = new Date(TODAY); yesterday.setDate(yesterday.getDate()-1);
  const yesterdayIso = yesterday.toLocaleDateString("sv-SE");
  let dayData = state.wellness.days[todayIso] || state.wellness.days[yesterdayIso];
  if (!dayData) return null;

  const last30  = days.slice(-30);
  const avgHRV  = avg(last30,'hrv_overnight_avg');
  const avgRHR  = avg(last30,'resting_hr');

  let score = 50;
  const hrv = dayData.hrv_overnight_avg;
  if (hrv && avgHRV) score += Math.max(-25, Math.min(25, ((hrv - avgHRV) / avgHRV) * 100));
  const rhr = dayData.resting_hr;
  if (rhr && avgRHR) score += Math.max(-20, Math.min(20, ((avgRHR - rhr) / avgRHR) * 100));
  const bb = dayData.body_battery_high;
  if (bb != null) score += Math.max(-25, Math.min(25, (bb - 50) * 0.5));

  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, hrv: hrv||null, rhr: rhr||null, bb: bb||null, date: dayData.date };
}

function renderRecoveryCard() {
  const rec     = computeRecoveryScore();
  const section = document.getElementById('recovery-section');
  if (!rec) { if (section) section.style.display = 'none'; return; }
  if (section) section.style.display = '';

  const color  = rec.score >= 70 ? '#22c55e' : rec.score >= 40 ? '#f59e0b' : '#ef4444';
  const deg    = Math.round((rec.score / 100) * 360);
  const last30 = state.wellness?.days
    ? Object.values(state.wellness.days).sort((a,b)=>a.date.localeCompare(b.date)).slice(-30)
    : [];
  const avgHRV  = avg(last30,'hrv_overnight_avg') || 1;
  const avgRHR2 = avg(last30,'resting_hr') || 1;
  const hrvPct  = rec.hrv ? Math.min(100, Math.round((rec.hrv / (avgHRV * 1.5)) * 100)) : 0;
  const rhrPct  = rec.rhr ? Math.min(100, Math.round(((avgRHR2 * 1.2 - rec.rhr) / (avgRHR2 * 0.4)) * 100)) : 0;
  const bbPct   = rec.bb  ? rec.bb : 0;

  const bar = (label, pct, color, val) => `
    <div class="rfactor">
      <span style="min-width:76px;color:var(--muted);font-size:11px">${label}</span>
      <div class="rfactor-bg"><div class="rfactor-fill" style="width:${Math.max(0,Math.min(100,pct))}%;background:${color}"></div></div>
      <span class="rfactor-val">${val}</span>
    </div>`;

  document.getElementById('recovery-card-inner').innerHTML = `
    <div class="recovery-ring" style="background:conic-gradient(${color} 0deg ${deg}deg, var(--surface2) ${deg}deg 360deg)">
      <div class="recovery-inner">
        <div class="recovery-val" style="color:${color}">${rec.score}</div>
        <div class="recovery-lbl">Score</div>
      </div>
    </div>
    <div class="rfactors">
      <div style="font-size:13px;font-weight:700;margin-bottom:10px;color:var(--text)">Récupération du jour</div>
      ${bar('HRV nocturne', hrvPct, '#7c3aed', rec.hrv ? Math.round(rec.hrv)+' ms' : '–')}
      ${bar('FC repos',     rhrPct, '#ef4444', rec.rhr ? Math.round(rec.rhr)+' bpm' : '–')}
      ${bar('Body Battery', bbPct,  '#22c55e', rec.bb  != null ? Math.round(rec.bb) : '–')}
    </div>`;
}

/* ══════════════════════════════════════════════════════════
   SLEEP SCORE
   ══════════════════════════════════════════════════════════ */
function sleepScore(day) {
  if (!day) return null;
  const dur   = day.sleep_total_min || 0;
  const deep  = day.sleep_deep_min  || 0;
  const rem   = day.sleep_rem_min   || 0;
  const awake = day.sleep_awake_min || 0;
  if (!dur) return null;

  let durPts;
  if (dur >= 420 && dur <= 510) durPts = 35;
  else if (dur < 420) durPts = Math.max(0, 35 * (dur / 420));
  else durPts = Math.max(0, 35 * (1 - (dur - 510) / 120));

  const deepPts  = Math.min(30, (deep / 90) * 30);
  const remPts   = Math.min(20, (rem  / 90) * 20);
  const awakePen = Math.min(20, awake / 5);
  return Math.max(0, Math.min(100, Math.round(durPts + deepPts + remPts - awakePen)));
}

function renderSleepScoreChart(days) {
  const scores  = days.map(d => sleepScore(d));
  const hasData = scores.some(s => s !== null);
  const section = document.getElementById('sleep-score-section');
  if (!section) return;
  if (!hasData) { section.style.display = 'none'; return; }
  section.style.display = '';

  const validScores = scores.filter(s => s !== null);
  const mean = validScores.length ? Math.round(validScores.reduce((a,b)=>a+b,0)/validScores.length) : null;
  const badgeEl = document.getElementById('badge-sleep-score');
  if (badgeEl && mean != null) badgeEl.textContent = `moy. ${mean}/100`;

  mkChart('chart-sleep-score', {
    type: 'line',
    data: { labels: hlabels(days), datasets: [{
      label:'Score sommeil', data:scores,
      borderColor:'#7c3aed', backgroundColor:'rgba(124,58,237,0.12)',
      fill:true, tension:0.4, pointRadius:3, borderWidth:2, spanGaps:true,
    }]},
    options: { responsive:true, maintainAspectRatio:false,
      plugins:{legend:{display:false}},
      scales:{ x:{grid:{display:false},ticks:{maxTicksLimit:days.length>30?8:12}}, y:{min:0,max:100,grid:{color:'#e5e7eb'}} }
    }
  });
}

/* ══════════════════════════════════════════════════════════
   SLEEP ↔ PERFORMANCE CORRELATION
   ══════════════════════════════════════════════════════════ */
function renderCorrelationChart(days, acts) {
  const section    = document.getElementById('corr-section');
  const sectionHdr = document.getElementById('corr-section-header');
  if (!section || !sectionHdr) return;

  const wellnessByDate = {};
  days.forEach(d => { wellnessByDate[d.date] = d; });

  const points = [];
  acts.forEach(a => {
    if (!a.training_load || a.training_load <= 0 || !a.date) return;
    const prev = new Date(a.date+'T12:00:00');
    prev.setDate(prev.getDate()-1);
    const wDay = wellnessByDate[prev.toLocaleDateString("sv-SE")];
    if (!wDay) return;
    const ss = sleepScore(wDay);
    if (ss === null) return;
    ACT_MAP[a.id] = a;
    points.push({ x:ss, y:Math.round(a.training_load), label:a.name, type:a.type });
  });

  if (points.length < 5) { section.style.display='none'; sectionHdr.style.display='none'; return; }
  section.style.display=''; sectionHdr.style.display='';

  mkChart('chart-sleep-perf', {
    type:'scatter',
    data:{ datasets:[{
      label:'Activités', data:points,
      backgroundColor: points.map(p=>(TYPE_COLOR[p.type]||'#888')+'aa'),
      pointRadius:6, pointHoverRadius:9,
    }]},
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:false}, tooltip:{callbacks:{label:c=>`${c.raw.label} — Sommeil:${c.raw.x} / Charge:${c.raw.y}`}} },
      scales:{
        x:{title:{display:true,text:'Score sommeil (veille)',color:'#64748b'},min:0,max:100,grid:{color:'#e5e7eb'}},
        y:{title:{display:true,text:'Charge (pts)',color:'#64748b'},grid:{color:'#e5e7eb'}}
      }
    }
  });
}

/* ══════════════════════════════════════════════════════════
   HEALTH KPIs
   ══════════════════════════════════════════════════════════ */
function renderHealthKPIs(days) {
  const h = (label, val, unit='', color='') => `
    <div class="kpi-card" style="cursor:default">
      <div class="kpi-label">${label}</div>
      <div class="kpi-value" style="${color ? 'color:'+color : ''}">${val}<span class="kpi-unit">${unit}</span></div>
    </div>`;

  const sleepAvg  = avg(days,'sleep_total_min');
  const sleepStr  = sleepAvg ? `${Math.floor(sleepAvg/60)}h${String(Math.round(sleepAvg%60)).padStart(2,'0')}` : '–';
  const deepAvg   = avg(days,'sleep_deep_min');
  const remAvg    = avg(days,'sleep_rem_min');
  const hrvAvg    = avg(days,'hrv_overnight_avg');
  const bbHigh    = avg(days,'body_battery_high');
  const bbLow     = avg(days,'body_battery_low');
  const stressA   = avg(days,'stress_avg');
  const stressC   = stressA < 25 ? 'var(--green)' : stressA < 50 ? 'var(--yellow)' : 'var(--red)';
  const rhr       = avg(days,'resting_hr');
  const stepsA    = avg(days,'steps');
  const sleepHR   = avg(days,'sleep_hr_avg');
  const resp      = avg(days,'sleep_respiration_avg');
  const sleepStr2 = avg(days,'sleep_stress_avg');

  const weightDays = days.filter(d => d.weight_kg);
  const lastWeight = weightDays.length ? weightDays[weightDays.length-1].weight_kg : null;
  const lastBmi    = weightDays.length ? weightDays[weightDays.length-1].bmi : null;
  const lastFat    = weightDays.length ? weightDays[weightDays.length-1].body_fat : null;
  const bmiColor   = lastBmi ? (lastBmi < 18.5 ? 'var(--swim)' : lastBmi < 25 ? 'var(--green)' : lastBmi < 30 ? 'var(--yellow)' : 'var(--red)') : '';

  // Most recent readiness
  const withReadiness = [...days].reverse().find(d => d.training_readiness_score);
  const readiness = withReadiness?.training_readiness_score ?? null;
  const readinessColor = readiness == null ? '' : readiness >= 70 ? 'var(--green)' : readiness >= 40 ? 'var(--yellow)' : 'var(--red)';

  document.getElementById('kpi-health').innerHTML =
    (lastWeight ? h('Poids actuel',   lastWeight,          ' kg')              : '') +
    (lastBmi    ? h('IMC',            lastBmi,             '',  bmiColor)       : '') +
    (lastFat    ? h('Masse grasse',   lastFat,             ' %')               : '') +
    h('Sommeil moy.',      sleepStr) +
    h('Profond moy.',      deepAvg   ? Math.round(deepAvg)+'min' : '–') +
    h('REM moy.',          remAvg    ? Math.round(remAvg)+'min'  : '–') +
    (sleepHR    ? h('FC nocturne',    Math.round(sleepHR), ' bpm')             : '') +
    (resp       ? h('Respiration nuit', resp.toFixed(1),   ' r/min')           : '') +
    (sleepStr2  ? h('Stress nuit',    Math.round(sleepStr2), '')               : '') +
    h('HRV nuit moy.',     hrvAvg    ? Math.round(hrvAvg)        : '–', ' ms') +
    h('Body Battery ↑',    bbHigh    ? Math.round(bbHigh)        : '–') +
    h('Body Battery ↓',    bbLow     ? Math.round(bbLow)         : '–') +
    h('Stress moy.',       stressA   ? Math.round(stressA)       : '–', '', stressA ? stressC : '') +
    h('FC repos moy.',     rhr       ? Math.round(rhr)           : '–', ' bpm') +
    h('Pas/jour moy.',     stepsA    ? Math.round(stepsA).toLocaleString('fr') : '–') +
    (readiness  ? h('Readiness',      Math.round(readiness), ' /100', readinessColor) : '');
}

/* ══════════════════════════════════════════════════════════
   HEALTH CHARTS
   ══════════════════════════════════════════════════════════ */
function renderHealthCharts(days) {
  const L     = hlabels(days);
  const xOpts = { grid:{display:false}, ticks:{maxTicksLimit: days.length > 30 ? 8 : 12} };

  /* Sleep phases */
  setBadge('badge-sleep', (() => { const v = avg(days,'sleep_total_min'); return v ? `${Math.floor(v/60)}h${String(Math.round(v%60)).padStart(2,'0')}` : null; })());
  mkChart('chart-sleep', {
    type:'bar',
    data:{ labels:L, datasets:[
      { label:'Profond', data:days.map(d=>d.sleep_deep_min||0),  backgroundColor:'#312e81', borderRadius:2 },
      { label:'REM',     data:days.map(d=>d.sleep_rem_min||0),   backgroundColor:'#7c3aed', borderRadius:2 },
      { label:'Léger',   data:days.map(d=>d.sleep_light_min||0), backgroundColor:'#3b82f6', borderRadius:2 },
      { label:'Éveillé', data:days.map(d=>d.sleep_awake_min||0), backgroundColor:'#475569', borderRadius:2 },
    ]},
    options:{ responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{position:'bottom',labels:{color:'#64748b',boxWidth:10}} },
      scales:{ x:{...xOpts,stacked:true}, y:{stacked:true,grid:{color:'#e5e7eb'},title:{display:true,text:'min',color:'#64748b'}} }
    }
  });

  /* HRV */
  setBadge('badge-hrv', fmtAvg(days,'hrv_overnight_avg') + ' ms');
  mkChart('chart-hrv', {
    type:'line',
    data:{ labels:L, datasets:[{ label:'HRV nocturne', data:days.map(d=>d.hrv_overnight_avg),
      borderColor:'#7c3aed', backgroundColor:'rgba(124,58,237,0.12)', fill:true, tension:0.4, pointRadius:2, borderWidth:2 }]},
    options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}},
      scales:{ x:xOpts, y:{grid:{color:'#e5e7eb'},title:{display:true,text:'ms',color:'#64748b'}} } }
  });

  /* Resting HR */
  setBadge('badge-hr', fmtAvg(days,'resting_hr') + ' bpm');
  mkChart('chart-rhr', {
    type:'line',
    data:{ labels:L, datasets:[{ label:'FC repos', data:days.map(d=>d.resting_hr),
      borderColor:'#ef4444', backgroundColor:'rgba(239,68,68,0.1)', fill:true, tension:0.4, pointRadius:2, borderWidth:2 }]},
    options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}},
      scales:{ x:xOpts, y:{grid:{color:'#e5e7eb'},title:{display:true,text:'bpm',color:'#64748b'}} } }
  });

  /* Body Battery range + end of day */
  const bbHighAvg = avg(days,'body_battery_high');
  const bbLowAvg  = avg(days,'body_battery_low');
  setBadge('badge-bb', bbHighAvg ? `${Math.round(bbLowAvg)}→${Math.round(bbHighAvg)}` : '');
  mkChart('chart-battery', {
    type:'line',
    data:{ labels:L, datasets:[
      { label:'Maximum',         data:days.map(d=>d.body_battery_high), borderColor:'#22c55e', backgroundColor:'rgba(34,197,94,0.15)', fill:'+1', tension:0.3, pointRadius:0, borderWidth:2 },
      { label:'Minimum',         data:days.map(d=>d.body_battery_low),  borderColor:'#ef4444', backgroundColor:'rgba(239,68,68,0.05)', fill:false, tension:0.3, pointRadius:0, borderWidth:2 },
      { label:'Fin de journée',  data:days.map(d=>d.body_battery_end||null), borderColor:'#f97316', borderDash:[4,3], fill:false, tension:0.3, pointRadius:2, borderWidth:2, spanGaps:true },
    ]},
    options:{ responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{position:'bottom',labels:{color:'#64748b',boxWidth:10}} },
      scales:{ x:xOpts, y:{min:0,max:100,grid:{color:'#e5e7eb'}} }
    }
  });

  /* Stress avg */
  setBadge('badge-stress', fmtAvg(days,'stress_avg'));
  mkChart('chart-stress-avg', {
    type:'line',
    data:{ labels:L, datasets:[{ label:'Stress moyen', data:days.map(d=>d.stress_avg),
      borderColor:'#f59e0b', backgroundColor:'rgba(245,158,11,0.1)', fill:true, tension:0.4, pointRadius:2, borderWidth:2 }]},
    options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}},
      scales:{ x:xOpts, y:{min:0,max:100,grid:{color:'#e5e7eb'}} } }
  });

  /* Stress breakdown */
  mkChart('chart-stress-pct', {
    type:'bar',
    data:{ labels:L, datasets:[
      { label:'Repos',  data:days.map(d=>Math.round(d.stress_pct_rest||0)),   backgroundColor:'#3b82f6', borderRadius:2 },
      { label:'Faible', data:days.map(d=>Math.round(d.stress_pct_low||0)),    backgroundColor:'#22c55e', borderRadius:2 },
      { label:'Moyen',  data:days.map(d=>Math.round(d.stress_pct_medium||0)), backgroundColor:'#f59e0b', borderRadius:2 },
      { label:'Élevé',  data:days.map(d=>Math.round(d.stress_pct_high||0)),   backgroundColor:'#ef4444', borderRadius:2 },
    ]},
    options:{ responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{position:'bottom',labels:{color:'#64748b',boxWidth:10}} },
      scales:{ x:{...xOpts,stacked:true}, y:{stacked:true,max:100,grid:{color:'#e5e7eb'}} }
    }
  });

  /* Steps */
  const stepsAvg = avg(days,'steps');
  setBadge('badge-steps', stepsAvg ? Math.round(stepsAvg).toLocaleString('fr') : '');
  mkChart('chart-steps', {
    type:'bar',
    data:{ labels:L, datasets:[{
      label:'Pas', data:days.map(d=>d.steps||0),
      backgroundColor: days.map(d => (d.steps||0) >= (d.steps_goal||6000) ? 'rgba(34,197,94,0.8)' : 'rgba(99,102,241,0.5)'),
      borderRadius:4,
    }]},
    options:{ responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:false},
        annotation:{ annotations:{ goal:{
          type:'line', yMin:avg(days,'steps_goal')||6000, yMax:avg(days,'steps_goal')||6000,
          borderColor:'rgba(0,0,0,0.25)', borderDash:[5,4],
          label:{content:'Objectif',display:true,position:'end',color:'#64748b',font:{size:10}}
        }}}
      },
      scales:{ x:xOpts, y:{grid:{color:'#e5e7eb'}} }
    }
  });

  /* Active calories */
  setBadge('badge-cal', fmtAvg(days,'calories_active') + ' kcal');
  mkChart('chart-cal-active', {
    type:'bar',
    data:{ labels:L, datasets:[{ label:'Cal. actives', data:days.map(d=>Math.round(d.calories_active||0)),
      backgroundColor:'rgba(245,158,11,0.7)', borderRadius:4 }]},
    options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}},
      scales:{ x:xOpts, y:{grid:{color:'#e5e7eb'}} } }
  });

  /* Weight + body fat */
  const weightData = days.map(d => d.weight_kg || null);
  const fatData    = days.map(d => d.body_fat   || null);
  const hasWeight  = weightData.some(v => v !== null);
  const hasFat     = fatData.some(v => v !== null);
  const weightSection = document.getElementById('weight-section');
  if (hasWeight && weightSection) {
    weightSection.style.display = '';
    const lastW = weightData.filter(Boolean);
    const lastF = fatData.filter(Boolean);
    setBadge('badge-weight', lastW.length ? lastW[lastW.length-1]+' kg' + (lastF.length ? ` · ${lastF[lastF.length-1]}% MG` : '') : '');
    const fatMin = hasFat ? Math.max(0, Math.min(...lastF) - 2) : null;
    const fatMax = hasFat ? Math.min(...lastF) + Math.max(...lastF) : null; // rough range
    mkChart('chart-weight', {
      type:'line',
      data:{ labels:L, datasets:[
        { label:'Poids', data:weightData, yAxisID:'y',
          borderColor:'#6366f1', backgroundColor:'rgba(99,102,241,0.1)',
          fill:true, tension:0.3, spanGaps:true,
          pointRadius:weightData.map(v=>v!==null?4:0),
          pointBackgroundColor:'#6366f1', pointBorderColor:'#1a1a1a', pointBorderWidth:2, borderWidth:2,
        },
        ...(hasFat ? [{ label:'Masse grasse', data:fatData, yAxisID:'y1',
          borderColor:'#f97316', backgroundColor:'rgba(249,115,22,0.05)',
          fill:false, tension:0.3, spanGaps:true, borderWidth:2,
          pointRadius:fatData.map(v=>v!==null?3:0), pointBackgroundColor:'#f97316',
        }] : [])
      ]},
      options:{ responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{ display: hasFat, position:'bottom', labels:{color:'#64748b',boxWidth:10} },
          tooltip:{callbacks:{label:c=>c.raw!==null?(c.dataset.yAxisID==='y1'?`${c.raw}% MG`:`${c.raw} kg`):null}}
        },
        scales:{ x:xOpts,
          y:{ min:Math.min(...lastW)-1, max:Math.max(...lastW)+1, grid:{color:'#e5e7eb'}, title:{display:true,text:'kg',color:'#64748b'} },
          ...(hasFat ? { y1:{ position:'right', min:Math.max(0, Math.min(...lastF)-3), max:Math.min(...lastF)+Math.max(...lastF)-Math.min(...lastF)+3, grid:{display:false}, title:{display:true,text:'% MG',color:'#64748b'} } } : {})
        }
      }
    });
  } else if (weightSection) {
    weightSection.style.display = 'none';
  }

  /* Intensity minutes */
  const iModAvg = avg(days,'intensity_min_moderate');
  const iVigAvg = avg(days,'intensity_min_vigorous');
  setBadge('badge-imin', iModAvg != null ? `${Math.round(iModAvg)}mod + ${Math.round(iVigAvg||0)}vig` : '');
  mkChart('chart-intensity-min', {
    type:'bar',
    data:{ labels:L, datasets:[
      { label:'Modérée',    data:days.map(d=>d.intensity_min_moderate||0), backgroundColor:'rgba(59,130,246,0.7)', borderRadius:3 },
      { label:'Vigoureuse', data:days.map(d=>d.intensity_min_vigorous||0), backgroundColor:'rgba(239,68,68,0.7)', borderRadius:3 },
    ]},
    options:{ responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{position:'bottom',labels:{color:'#64748b',boxWidth:10}} },
      scales:{ x:{...xOpts,stacked:true}, y:{stacked:true,grid:{color:'#e5e7eb'}} }
    }
  });
}

/* ══════════════════════════════════════════════════════════
   SLEEP PHYSIOLOGY (FC nocturne, Respiration, Stress nuit)
   ══════════════════════════════════════════════════════════ */
function renderSleepPhysioCharts(days) {
  const L     = hlabels(days);
  const xOpts = { grid:{display:false}, ticks:{maxTicksLimit: days.length > 30 ? 8 : 12} };

  const show = (id, has) => { const el = document.getElementById(id); if (el) el.style.display = has ? '' : 'none'; };

  const hasSleepHR = days.some(d => d.sleep_hr_avg);
  show('sleep-hr-section', hasSleepHR);
  if (hasSleepHR) {
    setBadge('badge-sleep-hr', fmtAvg(days,'sleep_hr_avg') + ' bpm');
    mkChart('chart-sleep-hr', { type:'line',
      data:{ labels:L, datasets:[{ label:'FC nocturne', data:days.map(d=>d.sleep_hr_avg||null),
        borderColor:'#ef4444', backgroundColor:'rgba(239,68,68,0.08)', fill:true, tension:0.4, pointRadius:2, borderWidth:2, spanGaps:true }]},
      options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}},
        scales:{ x:xOpts, y:{grid:{color:'#e5e7eb'},title:{display:true,text:'bpm',color:'#64748b'}} } }
    });
  }

  const hasResp = days.some(d => d.sleep_respiration_avg);
  show('sleep-resp-section', hasResp);
  if (hasResp) {
    setBadge('badge-sleep-resp', fmtAvg(days,'sleep_respiration_avg',1) + ' r/min');
    mkChart('chart-sleep-resp', { type:'line',
      data:{ labels:L, datasets:[{ label:'Respiration', data:days.map(d=>d.sleep_respiration_avg||null),
        borderColor:'#0ea5e9', backgroundColor:'rgba(14,165,233,0.08)', fill:true, tension:0.4, pointRadius:2, borderWidth:2, spanGaps:true }]},
      options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}},
        scales:{ x:xOpts, y:{grid:{color:'#e5e7eb'},title:{display:true,text:'r/min',color:'#64748b'}} } }
    });
  }

  const hasSleepStress = days.some(d => d.sleep_stress_avg);
  show('sleep-stress-section', hasSleepStress);
  if (hasSleepStress) {
    setBadge('badge-sleep-stress', fmtAvg(days,'sleep_stress_avg'));
    mkChart('chart-sleep-stress', { type:'line',
      data:{ labels:L, datasets:[{ label:'Stress nocturne', data:days.map(d=>d.sleep_stress_avg||null),
        borderColor:'#f59e0b', backgroundColor:'rgba(245,158,11,0.08)', fill:true, tension:0.4, pointRadius:2, borderWidth:2, spanGaps:true }]},
      options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}},
        scales:{ x:xOpts, y:{min:0,max:100,grid:{color:'#e5e7eb'}} } }
    });
  }
}

/* ══════════════════════════════════════════════════════════
   HRV STATUS DISTRIBUTION
   ══════════════════════════════════════════════════════════ */
function renderHRVStatus(days) {
  const section = document.getElementById('hrv-status-section');
  const el      = document.getElementById('hrv-status-content');
  if (!section || !el) return;

  const STATUS = {
    'BALANCED':       { label:'Équilibré',    color:'#22c55e' },
    'UNBALANCED':     { label:'Déséquilibré', color:'#f59e0b' },
    'LOW':            { label:'Faible',       color:'#ef4444' },
    'POOR':           { label:'Mauvais',      color:'#dc2626' },
    'GOOD':           { label:'Bon',          color:'#22c55e' },
    'BALANCED_3':     { label:'Équilibré',    color:'#22c55e' },
    'UNBALANCED_3':   { label:'Déséquilibré', color:'#f59e0b' },
  };

  const counts = {};
  days.forEach(d => {
    if (!d.hrv_status) return;
    const key = String(d.hrv_status).toUpperCase();
    counts[key] = (counts[key] || 0) + 1;
  });

  if (!Object.keys(counts).length) { section.style.display = 'none'; return; }
  section.style.display = '';

  const total = Object.values(counts).reduce((s, v) => s + v, 0);
  el.innerHTML = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([key, count]) => {
    const info = STATUS[key] || { label: key.charAt(0) + key.slice(1).toLowerCase(), color: '#6b7280' };
    const pct  = Math.round(count / total * 100);
    return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:9px">
      <span style="font-size:12px;font-weight:700;color:${info.color};min-width:100px">${info.label}</span>
      <div style="flex:1;height:6px;background:var(--surface2);border-radius:3px;overflow:hidden">
        <div style="width:${pct}%;height:100%;background:${info.color};border-radius:3px"></div>
      </div>
      <span style="font-size:11px;color:var(--muted);min-width:70px;text-align:right">${count} j. · ${pct}%</span>
    </div>`;
  }).join('');
}

/* ══════════════════════════════════════════════════════════
   TRAINING READINESS & STATUS
   ══════════════════════════════════════════════════════════ */
function renderReadinessChart(days) {
  const section = document.getElementById('readiness-section');
  if (!section) return;

  const hasReadiness = days.some(d => d.training_readiness_score);
  if (!hasReadiness) { section.style.display = 'none'; return; }
  section.style.display = '';

  // Training status badge (most recent)
  const bannerEl = document.getElementById('training-status-banner');
  if (bannerEl) {
    const withStatus = [...days].reverse().find(d => d.training_status);
    if (withStatus?.training_status) {
      const sInfo = typeof _statusInfo === 'function'
        ? _statusInfo(withStatus.training_status)
        : { label: withStatus.training_status, color: '#6b7280' };
      bannerEl.innerHTML = `<span style="display:inline-flex;align-items:center;padding:4px 14px;border-radius:20px;font-size:12px;font-weight:700;background:${sInfo.color}20;color:${sInfo.color}">Statut actuel : ${sInfo.label}</span>`;
    } else {
      bannerEl.innerHTML = '';
    }
  }

  // Readiness line chart with colored points
  const rAvg = avg(days, 'training_readiness_score');
  setBadge('badge-readiness', rAvg ? Math.round(rAvg) + ' /100' : '');

  const L     = hlabels(days);
  const xOpts = { grid:{display:false}, ticks:{maxTicksLimit: days.length > 30 ? 8 : 12} };

  mkChart('chart-readiness', { type:'line',
    data:{ labels:L, datasets:[{ label:'Readiness', data:days.map(d=>d.training_readiness_score||null),
      borderColor:'#22d3ee', backgroundColor:'rgba(34,211,238,0.1)', fill:true, tension:0.4, borderWidth:2, spanGaps:true,
      pointRadius: days.map(d => d.training_readiness_score ? 3 : 0),
      pointBackgroundColor: days.map(d => {
        const r = d.training_readiness_score;
        return !r ? '#888' : r >= 70 ? '#22c55e' : r >= 40 ? '#f59e0b' : '#ef4444';
      }),
    }]},
    options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}},
      scales:{ x:xOpts, y:{min:0,max:100,grid:{color:'#e5e7eb'},title:{display:true,text:'/100',color:'#64748b'}} } }
  });
}

/* ══════════════════════════════════════════════════════════
   MAIN RENDER
   ══════════════════════════════════════════════════════════ */
function renderHealth() {
  renderRecoveryCard();
  const days = getWellnessDays();
  if (!days.length) {
    document.getElementById('kpi-health').innerHTML =
      '<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--muted)">Aucune donnée. Lance une synchronisation.</div>';
    return;
  }
  renderHealthKPIs(days);
  renderHealthCharts(days);
  renderSleepScoreChart(days);
  renderSleepPhysioCharts(days);
  renderHRVStatus(days);
  renderReadinessChart(days);
  const allActs = getAll().filter(a => {
    const cutoff = new Date(TODAY); cutoff.setDate(cutoff.getDate() - state.healthDays);
    return new Date(a.start_time || a.date) >= cutoff;
  });
  renderCorrelationChart(days, allActs);
}

function setHealthPeriod(n) {
  state.healthDays = n;
  document.querySelectorAll('.hpb').forEach(b => b.classList.toggle('active', +b.dataset.days === n));
  renderHealth();
}

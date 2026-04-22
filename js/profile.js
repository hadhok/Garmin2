/* ══════════════════════════════════════════════════════════
   PROFILE.JS — Profil sportif view
   ══════════════════════════════════════════════════════════ */

const PROFILE_WINDOW = { month:1, quarter:3, semester:6, year:12 };
const PROFILE_PERIOD_LABEL = {
  month:    'Ce mois',
  quarter:  'Ce trimestre (3 mois)',
  semester: 'Ce semestre (6 mois)',
  year:     'Cette année (12 mois)',
};

const BADGES_DEF = [
  { id:'s50',   icon:'🎯', label:'50 séances',      sub:'50 activités',    check:(t)=>t.acts>=50 },
  { id:'s100',  icon:'🏅', label:'100 séances',     sub:'100 activités',   check:(t)=>t.acts>=100 },
  { id:'s500',  icon:'🥇', label:'500 séances',     sub:'500 activités',   check:(t)=>t.acts>=500 },
  { id:'d500',  icon:'🛣️', label:'500 km',          sub:'Distance totale', check:(t)=>t.dist>=500 },
  { id:'d1000', icon:'🌍', label:'1 000 km',         sub:'Distance totale', check:(t)=>t.dist>=1000 },
  { id:'d5000', icon:'🚀', label:'5 000 km',         sub:'Distance totale', check:(t)=>t.dist>=5000 },
  { id:'h100',  icon:'⏱️', label:'100h de sport',   sub:'Temps total',     check:(t)=>t.dur>=6000 },
  { id:'h500',  icon:'🔥', label:'500h de sport',   sub:'Temps total',     check:(t)=>t.dur>=30000 },
  { id:'l50k',  icon:'💪', label:'50k pts charge',  sub:'Charge totale',   check:(t)=>t.load>=50000 },
  { id:'r10',   icon:'🏃', label:'10 km course',    sub:'Run ≥ 10 km',     check:(t,r)=>r.maxRunDist>=10 },
  { id:'r21',   icon:'🥈', label:'Semi-marathon',   sub:'Run ≥ 21 km',     check:(t,r)=>r.maxRunDist>=21 },
  { id:'r42',   icon:'🥇', label:'Marathon',        sub:'Run ≥ 42 km',     check:(t,r)=>r.maxRunDist>=42 },
];

function getFilteredAllTime() {
  const all = getAll();
  return state.filter === 'all' ? all : all.filter(a => a.type === state.filter);
}

function getWindowedActivities() {
  const all     = getFilteredAllTime();
  const nMonths = PROFILE_WINDOW[state.profileGranularity];
  if (!nMonths) return all;
  const cutoff = new Date(TODAY);
  cutoff.setMonth(cutoff.getMonth() - nMonths);
  return all.filter(a => new Date(a.start_time || a.date+'T12:00:00') >= cutoff);
}

function computeProfileData() {
  const all = getWindowedActivities();
  const typeMeta = {};
  all.forEach(a => { if (a.type && !typeMeta[a.type]) typeMeta[a.type] = { label:a.type_label||a.type, icon:a.icon||'⚡' }; });

  const totals = {
    acts: all.length,
    dur:  all.reduce((s,a)=>s+(a.duration_min||0),0),
    dist: all.reduce((s,a)=>s+(a.distance_km||0),0),
    cal:  all.reduce((s,a)=>s+(a.calories||0),0),
    load: all.reduce((s,a)=>s+(a.training_load||0),0),
  };

  const cutoff8w = new Date(TODAY); cutoff8w.setDate(cutoff8w.getDate()-56);
  const weeklyLoad = all.filter(a=>new Date(a.start_time||a.date)>=cutoff8w)
                        .reduce((s,a)=>s+(a.training_load||0),0)/8;

  const typeTime = {};
  all.forEach(a=>{ if(a.type) typeTime[a.type]=(typeTime[a.type]||0)+(a.duration_min||0); });
  const topTypes = Object.entries(typeTime).sort((a,b)=>b[1]-a[1]).slice(0,5)
    .map(([t,mins])=>({ type:t, mins, pct:totals.dur?Math.round(mins/totals.dur*100):0, ...typeMeta[t] }));

  const monthly = {};
  all.forEach(a=>{
    const key=(a.date||'').slice(0,7);
    if(!key||key.length<7) return;
    if(!monthly[key]) monthly[key]={acts:0,dur:0,dist:0,load:0,cal:0,typeTime:{}};
    const m=monthly[key];
    m.acts++; m.dur+=(a.duration_min||0); m.dist+=(a.distance_km||0);
    m.load+=(a.training_load||0); m.cal+=(a.calories||0);
    m.typeTime[a.type]=(m.typeTime[a.type]||0)+(a.duration_min||0);
  });

  const byLoad = [...all].filter(a=>a.training_load>0).sort((a,b)=>b.training_load-a.training_load);
  const byDist = [...all].filter(a=>a.distance_km>0&&a.type==='run').sort((a,b)=>b.distance_km-a.distance_km);
  const byDur  = [...all].sort((a,b)=>(b.duration_min||0)-(a.duration_min||0));
  const byVo2  = [...all].filter(a=>a.vo2max).sort((a,b)=>b.vo2max-a.vo2max);
  const mEntries = Object.entries(monthly);

  return { all, totals, weeklyLoad, topTypes, monthly, typeMeta,
    records:{
      load: byLoad[0], dist: byDist[0], dur: byDur[0], vo2: byVo2[0],
      bestActs: mEntries.sort((a,b)=>b[1].acts-a[1].acts)[0],
      bestLoad: [...mEntries].sort((a,b)=>b[1].load-a[1].load)[0],
    }
  };
}

function athleteLevel(wl) {
  if (wl<10)  return {label:'Débutant', color:'#22c55e', bar:1};
  if (wl<30)  return {label:'Actif',    color:'#3b82f6', bar:2};
  if (wl<60)  return {label:'Sportif',  color:'#f59e0b', bar:3};
  if (wl<110) return {label:'Athlète',  color:'#f97316', bar:4};
  return             {label:'Expert',   color:'#ef4444', bar:5};
}

/* ══════════════════════════════════════════════════════════
   AGGREGATION
   ══════════════════════════════════════════════════════════ */
function aggregateProfile(monthly, granularity) {
  const allKeys = Object.keys(monthly).sort();
  const groups = {}, order = [];
  allKeys.forEach(k=>{
    const[y,m]=k.split('-');
    let gk, label;
    if(granularity==='month')    { gk=k; label=`${MONTHS_FR[+m-1]} ${y.slice(2)}`; }
    else if(granularity==='quarter')  { const q=Math.ceil(+m/3); gk=`${y}-Q${q}`; label=`Q${q} ${y}`; }
    else if(granularity==='semester') { const s=+m<=6?1:2; gk=`${y}-S${s}`; label=`S${s} ${y}`; }
    else { gk=y; label=y; }
    if(!groups[gk]){ groups[gk]={label,load:0,acts:0}; order.push(gk); }
    groups[gk].load+=monthly[k].load;
    groups[gk].acts+=monthly[k].acts;
  });
  return { labels:order.map(k=>groups[k].label), loads:order.map(k=>Math.round(groups[k].load)), acts:order.map(k=>groups[k].acts) };
}

function aggregateProfileTable(monthly, granularity) {
  const allKeys = Object.keys(monthly).sort();
  const groups = {}, order = [];
  allKeys.forEach(k=>{
    const[y,m]=k.split('-');
    let gk, label;
    if(granularity==='month')    { gk=k; label=`${MONTHS_LONG[+m-1]} ${y}`; }
    else if(granularity==='quarter')  { const q=Math.ceil(+m/3); gk=`${y}-Q${q}`; label=`Q${q} ${y}`; }
    else if(granularity==='semester') { const s=+m<=6?1:2; gk=`${y}-S${s}`; label=`S${s} ${y}`; }
    else { gk=y; label=y; }
    if(!groups[gk]){ groups[gk]={id:gk,label,acts:0,dur:0,dist:0,load:0,typeTime:{},monthKeys:[]}; order.push(gk); }
    const g=groups[gk], mo=monthly[k];
    g.acts+=mo.acts; g.dur+=mo.dur; g.dist+=mo.dist; g.load+=mo.load;
    g.monthKeys.push(k);
    Object.entries(mo.typeTime||{}).forEach(([t,mins])=>{ g.typeTime[t]=(g.typeTime[t]||0)+mins; });
  });
  return order.map(k=>groups[k]);
}

/* ══════════════════════════════════════════════════════════
   HEATMAP
   ══════════════════════════════════════════════════════════ */
function renderHeatmap() {
  const container = document.getElementById('heatmap-container');
  if (!container) return;

  const all = getAll();
  const loadMap = {};
  all.forEach(a=>{ if(!a.date) return; loadMap[a.date]=(loadMap[a.date]||0)+(a.training_load||0); });

  const endDate = new Date(TODAY);
  const dow = endDate.getDay();
  endDate.setDate(endDate.getDate() + (dow===0?0:7-dow));

  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate()-52*7+1);
  const sd = startDate.getDay();
  startDate.setDate(startDate.getDate()-(sd===0?6:sd-1));

  const loads = Object.values(loadMap).filter(v=>v>0).sort((a,b)=>a-b);
  const q1=loads[Math.floor(loads.length*.25)]||50;
  const q2=loads[Math.floor(loads.length*.5)]||100;
  const q3=loads[Math.floor(loads.length*.75)]||200;

  function cellColor(load) {
    if (!load) return 'var(--surface2)';
    if (load<=q1) return 'rgba(99,102,241,0.15)';
    if (load<=q2) return 'rgba(99,102,241,0.35)';
    if (load<=q3) return 'rgba(99,102,241,0.6)';
    return 'rgba(99,102,241,0.9)';
  }

  const cols=[], monthsHtml=[];
  let curDate = new Date(startDate);
  while(curDate <= endDate){
    const col=[];
    for(let d=0;d<7;d++){
      const iso=curDate.toISOString().slice(0,10);
      col.push({iso,load:loadMap[iso]||0});
      curDate.setDate(curDate.getDate()+1);
    }
    cols.push(col);
  }
  cols.forEach((col,ci)=>{
    const firstDay=new Date(col[0].iso+'T12:00:00');
    if(firstDay.getDate()<=7){
      monthsHtml.push(`<span style="position:absolute;left:${ci*14}px;font-size:9px;color:var(--muted);white-space:nowrap">${MONTHS_FR[firstDay.getMonth()]}</span>`);
    }
  });

  const gridHtml=cols.map(col=>
    `<div class="heatmap-col">${col.map(cell=>`<div class="heatmap-cell" style="background:${cellColor(cell.load)}" title="${cell.iso}${cell.load?' — '+Math.round(cell.load)+' pts':''}"></div>`).join('')}</div>`
  ).join('');

  const legendCells=['var(--surface2)','rgba(99,102,241,0.15)','rgba(99,102,241,0.35)','rgba(99,102,241,0.6)','rgba(99,102,241,0.9)']
    .map(c=>`<div style="width:11px;height:11px;border-radius:2px;background:${c}"></div>`).join('');

  const yLabels=['Lun','','Mer','','Ven','',''].map(l=>`<div class="heatmap-ylabel">${l}</div>`).join('');

  container.innerHTML=`
    <div class="heatmap-outer">
      <div class="heatmap-ylabels">${yLabels}</div>
      <div class="heatmap-right">
        <div class="heatmap-months" style="position:relative;height:16px;margin-bottom:2px">${monthsHtml.join('')}</div>
        <div class="heatmap-grid">${gridHtml}</div>
        <div class="heatmap-legend">Moins ${legendCells} Plus</div>
      </div>
    </div>`;
}

/* ══════════════════════════════════════════════════════════
   CTL / ATL / TSB (Forme & Fatigue)
   ══════════════════════════════════════════════════════════ */
function computeFormCurve() {
  const all = getAll();
  const loadMap = {};
  all.forEach(a=>{ if(!a.date) return; loadMap[a.date]=(loadMap[a.date]||0)+(a.training_load||0); });

  const result=[];
  let ctl=0, atl=0;
  for(let i=179;i>=0;i--){
    const d=new Date(TODAY); d.setDate(d.getDate()-i);
    const iso=d.toISOString().slice(0,10);
    const load=loadMap[iso]||0;
    ctl=ctl+(load-ctl)/42;
    atl=atl+(load-atl)/7;
    if(i<90) result.push({date:iso,ctl:+ctl.toFixed(1),atl:+atl.toFixed(1),tsb:+(ctl-atl).toFixed(1)});
  }
  return result;
}

function renderFormChart() {
  const curve=computeFormCurve();
  if(!curve.length) return;
  const labels=curve.map(d=>new Date(d.date+'T12:00:00').toLocaleDateString('fr-FR',{day:'numeric',month:'short'}));
  mkChart('chart-form',{
    type:'line',
    data:{ labels, datasets:[
      {label:'CTL',data:curve.map(d=>d.ctl),borderColor:'#6366f1',backgroundColor:'rgba(99,102,241,0.08)',fill:false,tension:0.4,pointRadius:0,borderWidth:2},
      {label:'ATL',data:curve.map(d=>d.atl),borderColor:'#f97316',backgroundColor:'rgba(249,115,22,0.08)',fill:false,tension:0.4,pointRadius:0,borderWidth:2},
      {label:'TSB',data:curve.map(d=>d.tsb),borderColor:'#22c55e',backgroundColor:'rgba(34,197,94,0.08)',fill:'origin',tension:0.4,pointRadius:0,borderWidth:2,borderDash:[5,3]},
    ]},
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:false},
        annotation:{annotations:{zero:{type:'line',yMin:0,yMax:0,borderColor:'rgba(255,255,255,0.12)',borderWidth:1}}}
      },
      scales:{ x:{grid:{display:false},ticks:{maxTicksLimit:10}}, y:{grid:{color:'#2a2a2a'}} }
    }
  });
}

/* ── VO2max evolution ── */
function renderVo2maxChart() {
  const section    = document.getElementById('vo2max-section');
  const sectionHdr = document.getElementById('vo2max-section-header');
  if(!section||!sectionHdr) return;

  const all=getAll().filter(a=>a.vo2max>0&&a.date);
  const byMonth={};
  all.forEach(a=>{ const key=a.date.slice(0,7); if(!byMonth[key]||a.vo2max>byMonth[key]) byMonth[key]=a.vo2max; });
  const sorted=Object.entries(byMonth).sort((a,b)=>a[0].localeCompare(b[0]));
  if(sorted.length<2){section.style.display='none';sectionHdr.style.display='none';return;}
  section.style.display=''; sectionHdr.style.display='';

  const labels=sorted.map(([k])=>{ const[y,m]=k.split('-'); return `${MONTHS_FR[+m-1]} ${y.slice(2)}`; });
  mkChart('chart-vo2max',{
    type:'line',
    data:{labels, datasets:[{label:'VO2max', data:sorted.map(([,v])=>v),
      borderColor:'#ef4444', backgroundColor:'rgba(239,68,68,0.1)', fill:true, tension:0.4, pointRadius:5, borderWidth:2, pointBackgroundColor:'#ef4444'
    }]},
    options:{responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>`VO2max : ${c.raw} ml/kg/min`}}},
      scales:{x:{grid:{display:false}},y:{grid:{color:'#2a2a2a'},title:{display:true,text:'ml/kg/min',color:'#64748b'}}}
    }
  });
}

/* ── Badges ── */
function renderBadges() {
  const container=document.getElementById('profile-badges');
  if(!container) return;
  const all=getAll();
  const totals={acts:all.length,dur:all.reduce((s,a)=>s+(a.duration_min||0),0),dist:all.reduce((s,a)=>s+(a.distance_km||0),0),load:all.reduce((s,a)=>s+(a.training_load||0),0)};
  const runs=all.filter(a=>a.type==='run'&&a.distance_km>0);
  const records={maxRunDist:runs.length?Math.max(...runs.map(a=>a.distance_km)):0};
  container.innerHTML=BADGES_DEF.map(b=>{
    const unlocked=b.check(totals,records,all);
    return `<div class="badge-card ${unlocked?'unlocked':'locked'}" title="${b.sub}">
      <div class="badge-icon">${b.icon}</div>
      <div class="badge-label">${b.label}</div>
      <div class="badge-sub">${b.sub}</div>
    </div>`;
  }).join('');
}

/* ══════════════════════════════════════════════════════════
   ACCORDION (monthly detail rows)
   ══════════════════════════════════════════════════════════ */
function togglePeriod(row, safeKey) {
  const detail=document.getElementById(`mdetail_${safeKey}`);
  const list=document.getElementById(`macts_${safeKey}`);
  if(!detail) return;
  if(detail.classList.contains('open')){ detail.classList.remove('open'); row.classList.remove('open'); return; }

  if(!list.children.length){
    const monthKeys=(row.dataset.months||'').split(',').filter(Boolean);
    const acts=getFilteredAllTime()
      .filter(a=>monthKeys.some(mk=>(a.date||'').startsWith(mk)))
      .sort((a,b)=>(b.start_time||'').localeCompare(a.start_time||''));
    if(!acts.length){
      list.innerHTML='<div style="padding:10px;color:var(--muted);font-size:13px">Aucune activité</div>';
    }else{
      list.innerHTML=acts.map(a=>{
        ACT_MAP[a.id]=a;
        const main=a.distance_km>0?`${a.distance_km} km`:fmt_dur(a.duration_min);
        const sub=[fmt_dur(a.duration_min),a.calories?`${Math.round(a.calories)} kcal`:'',a.training_load>0?`⚡${Math.round(a.training_load)}`:''  ].filter(Boolean).join(' · ');
        const ds=a.date?new Date(a.date+'T12:00:00').toLocaleDateString('fr-FR',{weekday:'short',day:'numeric',month:'short'}):'';
        return `<div class="month-act-item" onclick="event.stopPropagation();openDetail(${a.id})">
          <div class="act-icon ${a.type||'other'}" style="width:30px;height:30px;font-size:14px">${a.icon||'⚡'}</div>
          <div><div style="font-size:13px;font-weight:600;color:var(--text)">${a.name}</div><div style="font-size:11px;color:var(--muted)">${ds}</div></div>
          <div style="text-align:right"><div style="font-size:13px;font-weight:600">${main}</div><div style="font-size:11px;color:var(--muted)">${sub}</div></div>
        </div>`;
      }).join('');
    }
  }
  detail.classList.add('open');
  row.classList.add('open');
}

/* ══════════════════════════════════════════════════════════
   MAIN RENDER
   ══════════════════════════════════════════════════════════ */
function renderProfile() {
  const d  = computeProfileData();
  const lv = athleteLevel(d.weeklyLoad);

  document.getElementById('profile-period-label').textContent = PROFILE_PERIOD_LABEL[state.profileGranularity]||'Depuis le début';

  /* Level badge */
  document.getElementById('profile-main-icon').textContent = d.topTypes[0]?.icon||'🏅';
  document.getElementById('profile-level-name').innerHTML = `<span style="color:${lv.color}">${lv.label}</span>`;
  document.getElementById('profile-level-pips').innerHTML = [1,2,3,4,5].map(i=>
    `<div class="level-pip" style="background:${i<=lv.bar?lv.color:'var(--border)'}"></div>`).join('');
  const wLabel=PROFILE_WINDOW[state.profileGranularity];
  document.getElementById('profile-weekly-load').textContent=`~${Math.round(d.weeklyLoad)} pts / semaine${wLabel?` (${wLabel} mois)`:' (tout)'}`;

  /* Sports */
  document.getElementById('profile-sports-list').innerHTML=d.topTypes.map(t=>
    `<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--border)">
      <span style="font-size:18px">${t.icon||'⚡'}</span>
      <span style="flex:1;font-size:13px;font-weight:500;color:var(--text2)">${t.label||t.type}</span>
      <span style="font-size:11px;color:var(--muted)">${fmt_dur(t.mins)}</span>
      <span style="font-size:13px;font-weight:700;color:${TYPE_COLOR[t.type]||'var(--accent)'};min-width:32px;text-align:right">${t.pct}%</span>
    </div>`).join('');

  /* Totals */
  document.getElementById('profile-totals').innerHTML=[
    ['Activités',   d.totals.acts.toLocaleString('fr-FR'),''],
    ['Heures',      Math.round(d.totals.dur/60).toLocaleString('fr-FR'),'h'],
    ['Distance',    Math.round(d.totals.dist).toLocaleString('fr-FR'),'km'],
    ['Charge tot.', Math.round(d.totals.load).toLocaleString('fr-FR'),'pts'],
  ].map(([l,v,u])=>
    `<div style="padding:14px 12px;border-bottom:1px solid var(--border);border-right:1px solid var(--border)">
      <div style="font-size:20px;font-weight:800;color:var(--text)">${v}<span style="font-size:11px;color:var(--muted);font-weight:400"> ${u}</span></div>
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);margin-top:3px">${l}</div>
    </div>`).join('');

  /* Records */
  const fmt_date=d=>d?new Date(d+'T12:00:00').toLocaleDateString('fr-FR',{day:'numeric',month:'short',year:'numeric'}):'';
  const recItems=[];
  if(d.records.load){const a=d.records.load;recItems.push({i:'⚡',l:'Charge max',v:`${Math.round(a.training_load)} pts`,s:a.name,d:fmt_date(a.date)});}
  if(d.records.dist){const a=d.records.dist;recItems.push({i:'📍',l:'Distance max 🏃',v:`${a.distance_km} km`,s:a.name,d:fmt_date(a.date)});}
  if(d.records.dur) {const a=d.records.dur; recItems.push({i:'⏱',l:'Séance la + longue',v:fmt_dur(a.duration_min),s:a.name,d:fmt_date(a.date)});}
  if(d.records.vo2) {const a=d.records.vo2; recItems.push({i:'❤️',l:'VO2max record',v:`${a.vo2max}`,s:a.name,d:fmt_date(a.date)});}
  if(d.records.bestActs){const[k,m]=d.records.bestActs;const[y,mo]=k.split('-');recItems.push({i:'🏆',l:'Période la + active',v:`${m.acts} séances`,s:`${MONTHS_LONG[+mo-1]} ${y}`,d:''});}
  if(d.records.bestLoad){const[k,m]=d.records.bestLoad;const[y,mo]=k.split('-');recItems.push({i:'🔥',l:'Période la + chargée',v:`${Math.round(m.load)} pts`,s:`${MONTHS_LONG[+mo-1]} ${y}`,d:''});}

  document.getElementById('profile-records').innerHTML=recItems.map(r=>
    `<div class="record-card">
      <div style="font-size:26px;margin-bottom:8px">${r.i}</div>
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);margin-bottom:4px">${r.l}</div>
      <div style="font-size:20px;font-weight:800;color:var(--accent)">${r.v}</div>
      <div style="font-size:11px;color:var(--muted2);margin-top:5px;line-height:1.4">${r.s}</div>
      ${r.d?`<div style="font-size:10px;color:var(--muted2);margin-top:2px">${r.d}</div>`:''}
    </div>`).join('');

  /* Charts */
  const agg=aggregateProfile(d.monthly,state.profileGranularity);
  mkChart('chart-profile-load',{
    type:'bar',
    data:{labels:agg.labels,datasets:[{
      data:agg.loads,
      backgroundColor:agg.loads.map(l=>l>500?'#ef4444cc':l>300?'#f97316cc':l>150?'#6366f1cc':'#6366f1aa'),
      borderRadius:6
    }]},
    options:{responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>`${c.raw} pts`}}},
      scales:{x:{grid:{display:false}},y:{grid:{color:'#2a2a2a'}}}
    }
  });
  mkChart('chart-profile-acts',{
    type:'bar',
    data:{labels:agg.labels,datasets:[{data:agg.acts,backgroundColor:'#6366f1aa',borderRadius:6}]},
    options:{responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false}},
      scales:{x:{grid:{display:false}},y:{ticks:{stepSize:1},grid:{color:'#2a2a2a'}}}
    }
  });

  /* Table */
  const w      =state.wellness?.days||{};
  const periods=aggregateProfileTable(d.monthly,state.profileGranularity).reverse();
  document.getElementById('profile-table-body').innerHTML=periods.map(p=>{
    const dom=Object.entries(p.typeTime||{}).sort((a,b)=>b[1]-a[1])[0];
    const domMeta=dom?d.typeMeta[dom[0]]:null;
    const safeKey=p.id.replace(/[^a-z0-9]/gi,'_');
    const wDays=Object.entries(w).filter(([dk])=>p.monthKeys.some(mk=>dk.startsWith(mk))).map(([,v])=>v);
    const rhrVals=wDays.map(v=>v.resting_hr).filter(Boolean);
    const sleepV =wDays.map(v=>v.sleep_total_min).filter(Boolean);
    const avgRHR=rhrVals.length?Math.round(rhrVals.reduce((a,b)=>a+b,0)/rhrVals.length):null;
    const avgSlp=sleepV.length?Math.round(sleepV.reduce((a,b)=>a+b,0)/sleepV.length):null;
    const sleepFmt=avgSlp?`${Math.floor(avgSlp/60)}h${(avgSlp%60).toString().padStart(2,'0')}`:' –';
    return `<tr class="month-row" data-months="${p.monthKeys.join(',')}" onclick="togglePeriod(this,'${safeKey}')">
      <td style="font-weight:600;white-space:nowrap;color:var(--text)">${p.label}</td>
      <td>${p.acts}</td>
      <td>${fmt_dur(p.dur)}</td>
      <td>${Math.round(p.dist)||'–'}${p.dist>0?' km':''}</td>
      <td style="color:var(--accent);font-weight:700">${Math.round(p.load)||'–'}</td>
      <td>${domMeta?`${domMeta.icon} ${domMeta.label}`:'–'}</td>
      <td class="col-rhr" style="color:var(--green)">${avgRHR?avgRHR+' bpm':'–'}</td>
      <td class="col-sleep">${sleepFmt}</td>
    </tr>
    <tr class="month-detail-row" id="mdetail_${safeKey}">
      <td colspan="8" style="padding:0 8px 8px"><div class="month-acts-list" id="macts_${safeKey}"></div></td>
    </tr>`;
  }).join('');

  renderHeatmap();
  renderFormChart();
  renderVo2maxChart();
  renderBadges();
}

function setProfileGranularity(g, btn) {
  state.profileGranularity = g;
  document.querySelectorAll('.pgran-btn').forEach(b=>b.classList.remove('active'));
  if(btn) btn.classList.add('active');
  renderProfile();
}

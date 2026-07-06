/* ══════════════════════════════════════════════════════════
   RENPHO.JS — Composition corporelle (balance connectée)
   ══════════════════════════════════════════════════════════ */

/* ── Chargement des données ──────────────────────────────── */
async function loadBodyMetrics() {
  try {
    const r = await fetch('/api/body_metrics');
    if (!r.ok) return;
    const json = await r.json();
    state.bodyMetrics = json.metrics || [];
  } catch {
    state.bodyMetrics = [];
  }
}

function getBodyMetrics() {
  return state.bodyMetrics || [];
}

/* ══════════════════════════════════════════════════════════
   RENDER : Composition corporelle Renpho
   Poids/date : source Garmin prioritaire si plus récente
   (Garmin reçoit la balance en continu, la table Renpho ne
   bouge qu'à la synchro) — composition détaillée : Renpho.
   ══════════════════════════════════════════════════════════ */
function getGarminWeightDays() {
  return Object.values(state.wellness?.days || {})
    .filter(d => d.date && d.weight_kg)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function renderBodyMetrics() {
  const el = document.getElementById('renpho-body-metrics');
  if (!el) return;

  const metrics = getBodyMetrics();
  if (!metrics.length) {
    el.innerHTML = `
      <div style="text-align:center;padding:24px;color:var(--muted);font-size:13px">
        <div style="font-size:32px;margin-bottom:8px">⚖️</div>
        <div style="font-weight:600;margin-bottom:4px">Balance Renpho non configurée</div>
        <div style="font-size:12px">Ajoutez RENPHO_EMAIL et RENPHO_PASSWORD dans vos variables Vercel,<br>puis lancez une synchronisation.</div>
      </div>`;
    return;
  }

  const last = metrics[metrics.length - 1];
  const prev = metrics.length >= 2 ? metrics[metrics.length - 2] : null;

  /* Garmin plus frais que Renpho ? → date + poids affichés = Garmin */
  const gDays = getGarminWeightDays();
  const gLast = gDays.length ? gDays[gDays.length - 1] : null;
  const useGarmin = gLast && gLast.date > last.date;
  const headerDate   = useGarmin ? gLast.date : last.date;
  const headerWeight = useGarmin ? gLast.weight_kg : last.weight_kg;
  const compoNote = useGarmin
    ? `<div style="font-size:10px;color:var(--muted2);margin-top:2px">Composition détaillée du ${new Date(last.date + 'T12:00:00').toLocaleDateString('fr-FR', {day:'numeric', month:'long'})} (Renpho)</div>`
    : '';

  // Flèche de tendance
  function delta(key) {
    if (!prev || last[key] == null || prev[key] == null) return '';
    const d = +(last[key] - prev[key]).toFixed(1);
    if (d === 0) return '';
    const up = d > 0;
    // Pour le poids, masse grasse, viscéral : monter = mauvais
    const goodUp = !['weight_kg','body_fat_pct','visceral_fat','bmi','body_age'].includes(key);
    const color = (up === goodUp) ? '#22c55e' : '#ef4444';
    return `<span style="color:${color};font-size:11px;margin-left:4px">${up ? '▲' : '▼'} ${Math.abs(d)}</span>`;
  }

  // Niveaux masse grasse (homme — ajuster si femme)
  const fatPct = last.body_fat_pct;
  const fatColor = fatPct == null ? '#6b7280'
    : fatPct < 15 ? '#22c55e'
    : fatPct < 22 ? '#22c55e'
    : fatPct < 28 ? '#f97316'
    : '#ef4444';
  const fatLabel = fatPct == null ? '–'
    : fatPct < 15 ? 'Athlétique'
    : fatPct < 22 ? 'Forme'
    : fatPct < 28 ? 'Moyen'
    : 'Élevé';

  // Niveaux BMI
  const bmi = last.bmi;
  const bmiColor = bmi == null ? '#6b7280'
    : bmi < 18.5 ? '#f97316'
    : bmi < 25   ? '#22c55e'
    : bmi < 30   ? '#f97316'
    : '#ef4444';
  const bmiLabel = bmi == null ? '–'
    : bmi < 18.5 ? 'Insuffisant'
    : bmi < 25   ? 'Normal'
    : bmi < 30   ? 'Surpoids'
    : 'Obésité';

  const kpiStyle = 'background:var(--surface2);border-radius:10px;padding:12px;text-align:center;';

  el.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:8px">
      <div>
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)">Dernière mesure${useGarmin ? ' <span style="font-weight:400;text-transform:none">(Garmin)</span>' : ''}</div>
        <div style="font-size:12px;color:var(--text)">${new Date(headerDate + 'T12:00:00').toLocaleDateString('fr-FR', {day:'numeric', month:'long', year:'numeric'})}</div>
        ${compoNote}
      </div>
      <div style="font-size:30px;font-weight:800;color:var(--text)">${headerWeight != null ? headerWeight.toFixed(1) + ' kg' : '–'}${delta('weight_kg')}</div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px">
      <div style="${kpiStyle}">
        <div style="font-size:10px;color:var(--muted);margin-bottom:2px">IMC</div>
        <div style="font-size:18px;font-weight:700;color:${bmiColor}">${bmi != null ? bmi.toFixed(1) : '–'}${delta('bmi')}</div>
        <div style="font-size:10px;color:${bmiColor}">${bmiLabel}</div>
      </div>
      <div style="${kpiStyle}">
        <div style="font-size:10px;color:var(--muted);margin-bottom:2px">Masse grasse</div>
        <div style="font-size:18px;font-weight:700;color:${fatColor}">${fatPct != null ? fatPct.toFixed(1) + '%' : '–'}${delta('body_fat_pct')}</div>
        <div style="font-size:10px;color:${fatColor}">${fatLabel}</div>
      </div>
      <div style="${kpiStyle}">
        <div style="font-size:10px;color:var(--muted);margin-bottom:2px">Masse musc.</div>
        <div style="font-size:18px;font-weight:700;color:var(--text)">${last.muscle_mass_pct != null ? last.muscle_mass_pct.toFixed(1) + '%' : '–'}${delta('muscle_mass_pct')}</div>
        <div style="font-size:10px;color:var(--muted)">% masse totale</div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:16px;font-size:11px">
      ${last.water_pct     != null ? `<div style="${kpiStyle}"><div style="color:var(--muted);font-size:9px">Eau</div><b>${last.water_pct.toFixed(1)}%</b>${delta('water_pct')}</div>` : ''}
      ${last.bone_mass_kg  != null ? `<div style="${kpiStyle}"><div style="color:var(--muted);font-size:9px">Os</div><b>${last.bone_mass_kg.toFixed(2)} kg</b></div>` : ''}
      ${last.bmr           != null ? `<div style="${kpiStyle}"><div style="color:var(--muted);font-size:9px">BMR <span style="opacity:.6">(Mifflin)</span></div><b>${Math.round(last.bmr)} kcal</b></div>` : ''}
      ${last.visceral_fat  != null ? `<div style="${kpiStyle}"><div style="color:var(--muted);font-size:9px">Graisse visc.</div><b>${last.visceral_fat.toFixed(0)}</b></div>` : ''}
      ${last.protein_pct   != null ? `<div style="${kpiStyle}"><div style="color:var(--muted);font-size:9px">Protéines</div><b>${last.protein_pct.toFixed(1)}%</b></div>` : ''}
      ${last.body_age      != null ? `<div style="${kpiStyle}"><div style="color:var(--muted);font-size:9px">Âge forme <span style="opacity:.6">(NTNU)</span></div><b>${Math.round(last.body_age)} ans</b></div>` : ''}
    </div>

    <canvas id="chart-body-weight" style="max-height:160px"></canvas>`;

  // Graphique évolution poids + masse grasse
  // Fusion Renpho + Garmin par date (Renpho prioritaire : porte la masse grasse)
  const byDate = {};
  gDays.forEach(d => { byDate[d.date] = { date: d.date, weight_kg: d.weight_kg, body_fat_pct: null }; });
  metrics.forEach(m => { byDate[m.date] = m; });
  const merged = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));

  const LIMIT = 60;
  const slice = merged.slice(-LIMIT);
  const labels  = slice.map(m => new Date(m.date + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }));
  const weights = slice.map(m => m.weight_kg);
  const fats    = slice.map(m => m.body_fat_pct);

  const datasets = [{
    label: 'Poids (kg)',
    data: weights,
    borderColor: '#6366f1', borderWidth: 2,
    pointRadius: 2, tension: 0.4, fill: false,
    yAxisID: 'yW', spanGaps: true,
  }];
  if (fats.some(v => v != null)) {
    datasets.push({
      label: 'Masse grasse (%)',
      data: fats,
      borderColor: '#f97316', borderWidth: 1.5,
      pointRadius: 1, tension: 0.4, fill: false,
      yAxisID: 'yF', spanGaps: true, borderDash: [4, 3],
    });
  }

  mkChart('chart-body-weight', {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: true, labels: { boxWidth: 12, font: { size: 10 } } },
        tooltip: { callbacks: { label: c => c.dataset.yAxisID === 'yW' ? `${c.raw} kg` : `${c.raw}%` } },
      },
      scales: {
        x:  { grid: { display: false }, ticks: { maxTicksLimit: 8, font: { size: 9 } } },
        yW: { position: 'left',  title: { display: true, text: 'kg',  font: { size: 9 }, color: '#6366f1' }, grid: { color: 'rgba(107,114,128,0.1)' } },
        yF: { position: 'right', title: { display: true, text: '%',   font: { size: 9 }, color: '#f97316' }, grid: { display: false } },
      }
    }
  });
}

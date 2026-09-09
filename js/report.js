/* ══════════════════════════════════════════════════════════
   REPORT.JS — Export complet pour analyse externe
   Rassemble toutes les données déjà chargées côté client
   (activités, bien-être, composition corporelle, calculs,
   records, objectif) dans un seul fichier JSON structuré,
   à télécharger et partager (ex. coller/joindre dans une
   conversation avec Claude) pour un rapport détaillé.
   Aucune donnée n'est envoyée nulle part par cette fonction —
   uniquement un fichier local téléchargé par le navigateur.
   ══════════════════════════════════════════════════════════ */

const REPORT_PERIODS = [
  { key: '7d',  label: '7 jours',            days: 7   },
  { key: '30d', label: '30 jours',           days: 30  },
  { key: '3m',  label: '3 mois',             days: 90  },
  { key: '6m',  label: '6 mois',             days: 180 },
  { key: '1y',  label: '1 an',               days: 365 },
  { key: 'all', label: 'Tout l\'historique', days: null },
];

/* periodDays = null → tout l'historique. Ne filtre que les séries
   temporelles (activités, bien-être, poids) ; les sections "état
   actuel" (calculs, records, objectif, reco du jour, réglages)
   restent calculées sur l'historique complet — les tronquer
   fausserait CTL/ATL, la détection de records, etc. */
async function buildFullReport(periodDays = null) {
  const allActs = getAll();
  const allWellDays = state.wellness?.days || {};
  const allBodyMetrics = (typeof getBodyMetrics === 'function') ? getBodyMetrics() : [];

  const cutoffIso = periodDays ? localIso(new Date(Date.now() - periodDays * 86400000)) : null;
  const inPeriod = iso => !cutoffIso || (iso || '') >= cutoffIso;

  const acts = allActs.filter(a => inPeriod(a.date));
  const wellDays = cutoffIso
    ? Object.fromEntries(Object.entries(allWellDays).filter(([d]) => inPeriod(d)))
    : allWellDays;
  const bodyMetrics = allBodyMetrics.filter(m => inPeriod(m.date));

  /* Coach : re-fetch léger (pas stocké dans state) */
  let coach = null;
  try {
    const r = await fetch('/api/coach', { cache: 'no-store' });
    if (r.ok) coach = await r.json();
  } catch {}

  /* Calculs course + calibration — sur l'historique complet (fenêtres CTL/ATL) */
  let calculations = null;
  try { calculations = (typeof computeCalculations === 'function') ? computeCalculations() : null; } catch {}

  /* Records personnels par tranche de distance — sur l'historique complet */
  let personalRecords = null;
  try { personalRecords = (typeof computePRSnapshot === 'function') ? computePRSnapshot() : null; } catch {}

  /* Objectifs de course (plusieurs possibles) */
  let raceGoals = [];
  try { raceGoals = (typeof getRaceGoals === 'function') ? getRaceGoals() : []; } catch {}

  /* Courbe de forme, dimensionnée sur la période choisie (mini 30j pour un EMA lisible, sur historique complet en interne) */
  let formCurve = null;
  const formCurveDays = periodDays ? Math.max(30, Math.min(periodDays, 365)) : 90;
  try { formCurve = (typeof computeFormeCurve === 'function') ? computeFormeCurve(allActs, formCurveDays) : null; } catch {}

  /* Recommandation du jour + signaux (ACWR, HRV, score récup) */
  let dailyReco = null;
  try { dailyReco = (typeof computeDailyReco === 'function') ? computeDailyReco() : null; } catch {}

  /* Score de récupération sur la période choisie (série, plafonné à 1 an) */
  let recoveryScoreHistory = null;
  try {
    if (typeof computeRecoveryScoreDay === 'function') {
      const allDaysSorted = Object.values(allWellDays).filter(d => d.date).sort((a, b) => a.date.localeCompare(b.date));
      const scoreDays = periodDays ? allDaysSorted.filter(d => inPeriod(d.date)) : allDaysSorted;
      const cap = Math.min(scoreDays.length, 365);
      recoveryScoreHistory = scoreDays.slice(-cap).map(d => {
        const idx = allDaysSorted.indexOf(d);
        const window28 = allDaysSorted.slice(Math.max(0, idx - 27), idx + 1);
        return { date: d.date, score: computeRecoveryScoreDay(d, window28) };
      });
    }
  } catch {}

  const dates = acts.map(a => a.date).filter(Boolean).sort();

  return {
    generated_at: new Date().toISOString(),
    app: 'Garmin Dashboard',
    export_period: REPORT_PERIODS.find(p => p.days === periodDays)?.label || 'Tout l\'historique',
    period_covered: {
      activities_from: dates[0] || null,
      activities_to: dates[dates.length - 1] || null,
      last_sync: state.data?.last_sync || null,
    },
    settings: {
      hr_max: (typeof getHRMax === 'function') ? getHRMax() : null,
      hr_max_manual_override: localStorage.getItem('hr_max') || null,
      hr_rest: (typeof getHRRest === 'function') ? getHRRest() : null,
      hr_rest_manual_override: localStorage.getItem('hr_rest') || null,
      vo2_correction_factor: localStorage.getItem('vo2_correction') || '1.00',
      runalyze_calibration_factors: calculations?.factors || null,
    },
    activities: acts,
    wellness_days: wellDays,
    body_metrics_renpho: bodyMetrics,
    running_calculations: calculations ? {
      effective_vo2max: calculations.effectiveVO2max,
      marathon_shape_pct: calculations.marathonShape,
      atl_pct_of_max: calculations.atl,
      ctl_pct_of_max: calculations.ctl,
      tsb: calculations.tsb,
      acute_chronic_ratio: calculations.acRatio,
      rest_days_needed: calculations.restDays,
      monotony_pct: calculations.monotony,
      training_strain: calculations.trainingStrain,
    } : null,
    personal_records: personalRecords,
    race_goals: raceGoals,
    form_curve: formCurve,
    today_recommendation: dailyReco,
    recovery_score_history: recoveryScoreHistory,
    coach_analysis: coach,
  };
}

function initReportPeriodSelect() {
  const sel = document.getElementById('export-report-period');
  if (!sel || sel.options.length) return; // déjà initialisé
  sel.innerHTML = REPORT_PERIODS.map(p => `<option value="${p.key}" ${p.key === '3m' ? 'selected' : ''}>${p.label}</option>`).join('');
}

async function exportFullReport() {
  const btn = document.getElementById('export-report-btn');
  const statusEl = document.getElementById('export-report-status');
  const periodKey = document.getElementById('export-report-period')?.value || '3m';
  const period = REPORT_PERIODS.find(p => p.key === periodKey) || REPORT_PERIODS[2];
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Génération…'; }

  try {
    const report = await buildFullReport(period.days);
    const json = JSON.stringify(report, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `rapport-sante-${period.key}-${TODAY_ISO}.json`;
    link.click();
    URL.revokeObjectURL(url);

    const sizeKb = Math.round(json.length / 1024);
    if (statusEl) {
      statusEl.textContent = `✓ Rapport ${period.label} généré (${sizeKb} Ko, ${report.activities.length} activités, ${Object.keys(report.wellness_days).length} jours de bien-être)`;
      statusEl.style.display = 'block';
      statusEl.style.color = '#16a34a';
    }
    if (typeof showToast === 'function') showToast('Rapport exporté ✓', 'ok');
  } catch (e) {
    console.error('[exportFullReport]', e);
    if (statusEl) {
      statusEl.textContent = `❌ Erreur : ${e.message}`;
      statusEl.style.display = 'block';
      statusEl.style.color = '#dc2626';
    }
    if (typeof showToast === 'function') showToast('Erreur lors de l\'export', 'err');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '📄 Exporter le rapport'; }
  }
}

/* ══════════════════════════════════════════════════════════
   EXPORT PDF (version imprimable) — même contenu que le JSON,
   mis en forme pour impression/sauvegarde PDF navigateur. Pas de
   dépendance externe : window.print() sur une page dédiée, comme
   exportWeekPDF() (app.js) mais sur la période choisie et avec les
   sections bien-être/records/coach en plus des activités.
   ══════════════════════════════════════════════════════════ */
function _reportSectionTable(rows, cols) {
  if (!rows.length) return '<p class="empty">Aucune donnée sur cette période.</p>';
  return `<table><thead><tr>${cols.map(c => `<th>${c.label}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr>${cols.map(c => `<td>${c.fmt ? c.fmt(r) : (r[c.key] ?? '–')}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

async function exportFullReportPDF() {
  const btn = document.getElementById('export-report-pdf-btn');
  const periodKey = document.getElementById('export-report-period')?.value || '3m';
  const period = REPORT_PERIODS.find(p => p.key === periodKey) || REPORT_PERIODS[2];
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Génération…'; }

  try {
    const r = await buildFullReport(period.days);
    const fmtDate = iso => iso ? new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '–';

    const acts = [...r.activities].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const actsRows = _reportSectionTable(acts, [
      { label: 'Date',     fmt: a => a.date ? new Date(a.date + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }) : '–' },
      { label: 'Type',     fmt: a => `${a.icon || ''} ${a.type_label || a.type || ''}` },
      { label: 'Nom',      fmt: a => escapeHTML(a.name || '') },
      { label: 'Distance', fmt: a => a.distance_km > 0 ? `${a.distance_km} km` : '–' },
      { label: 'Durée',    fmt: a => fmt_dur(a.duration_min) },
      { label: 'Charge',   fmt: a => a.training_load > 0 ? Math.round(a.training_load) : '–' },
    ]);

    const wellVals = Object.values(r.wellness_days);
    const avg = key => { const v = wellVals.map(d => d[key]).filter(x => x != null); return v.length ? v.reduce((s,x)=>s+x,0)/v.length : null; };
    const avgSleepH = avg('sleep_total_min'); const avgHrv = avg('hrv_overnight_avg');
    const avgRHR = avg('resting_hr'); const avgStress = avg('stress_avg');

    const bm = r.body_metrics_renpho;
    const firstBM = bm[0], lastBM = bm[bm.length - 1];
    const weightDelta = (firstBM?.weight_kg && lastBM?.weight_kg) ? +(lastBM.weight_kg - firstBM.weight_kg).toFixed(1) : null;

    const prRows = r.personal_records ? Object.entries(r.personal_records).map(([label, rec]) => ({ label, ...rec })) : [];
    const prTable = prRows.length ? _reportSectionTable(prRows, [
      { label: 'Distance', fmt: p => p.label },
      { label: 'Allure',   fmt: p => p.pace ? `${Math.floor(p.pace/60)}:${String(Math.round(p.pace%60)).padStart(2,'0')}/km` : '–' },
      { label: 'Date',     fmt: p => fmtDate(p.date) },
      { label: 'Séance',   fmt: p => escapeHTML(p.name || '') },
    ]) : '<p class="empty">Pas assez de courses pour établir des records.</p>';

    const coachItems = (r.coach_analysis?.items || []).map(it =>
      `<div class="coach-item"><b>${it.icon || ''} ${escapeHTML(it.title || '')}</b><p>${escapeHTML(it.text || '').replace(/\n/g, '<br>')}</p></div>`
    ).join('');

    const goals = [...(r.race_goals || [])].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const goalHtml = goals.length
      ? goals.map(g => `<p><b>${escapeHTML(g.name || 'Objectif')}</b> — ${g.km} km le ${fmtDate(g.date)}${g.target ? ` (visé : ${g.target})` : ''}</p>`).join('')
      : '<p class="empty">Aucun objectif défini.</p>';

    const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Rapport santé — ${period.label}</title>
<style>
  body { font-family: system-ui, sans-serif; color: #111; margin: 0; padding: 24px 32px; font-size: 13px; }
  h1 { font-size: 20px; font-weight: 800; margin: 0 0 4px; }
  .sub { color: #6b7280; font-size: 12px; margin-bottom: 20px; }
  .kpi-row { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 8px; }
  .kpi { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 10px; padding: 10px 16px; min-width: 100px; }
  .kpi-label { font-size: 10px; color: #6b7280; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 2px; }
  .kpi-value { font-size: 20px; font-weight: 700; }
  .kpi-unit { font-size: 12px; font-weight: 400; color: #6b7280; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th { text-align: left; font-size: 10px; text-transform: uppercase; color: #6b7280; padding: 6px 8px; border-bottom: 2px solid #e5e7eb; }
  td { padding: 7px 8px; border-bottom: 1px solid #f3f4f6; font-size: 12px; }
  tr:last-child td { border-bottom: none; }
  .empty { color: #9ca3af; font-size: 12px; padding: 10px 0; }
  .section-title { font-size: 11px; font-weight: 700; text-transform: uppercase; color: #6b7280; letter-spacing: .06em; margin: 22px 0 8px; page-break-after: avoid; }
  .coach-item { background: #f9fafb; border-left: 3px solid #6366f1; border-radius: 6px; padding: 8px 12px; margin-bottom: 8px; font-size: 12px; }
  .coach-item p { margin: 4px 0 0; line-height: 1.6; }
  .footer { margin-top: 32px; font-size: 10px; color: #9ca3af; text-align: right; border-top: 1px solid #e5e7eb; padding-top: 8px; }
  table { page-break-inside: auto; } tr { page-break-inside: avoid; }
  @media print { body { padding: 8mm 10mm; } }
</style>
</head>
<body>
<h1>Rapport santé & entraînement</h1>
<div class="sub">Période : ${period.label} — généré le ${new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>

<div class="kpi-row">
  <div class="kpi"><div class="kpi-label">Activités</div><div class="kpi-value">${acts.length}</div></div>
  <div class="kpi"><div class="kpi-label">Sommeil moy.</div><div class="kpi-value">${avgSleepH ? (avgSleepH/60).toFixed(1) : '–'}<span class="kpi-unit">h</span></div></div>
  <div class="kpi"><div class="kpi-label">HRV moy.</div><div class="kpi-value">${avgHrv ? avgHrv.toFixed(0) : '–'}<span class="kpi-unit"> ms</span></div></div>
  <div class="kpi"><div class="kpi-label">FC repos moy.</div><div class="kpi-value">${avgRHR ? avgRHR.toFixed(0) : '–'}<span class="kpi-unit"> bpm</span></div></div>
  <div class="kpi"><div class="kpi-label">Stress moy.</div><div class="kpi-value">${avgStress ? avgStress.toFixed(0) : '–'}</div></div>
  ${lastBM?.weight_kg ? `<div class="kpi"><div class="kpi-label">Poids</div><div class="kpi-value">${lastBM.weight_kg}<span class="kpi-unit"> kg</span></div></div>` : ''}
  ${weightDelta != null ? `<div class="kpi"><div class="kpi-label">Δ Poids période</div><div class="kpi-value">${weightDelta > 0 ? '+' : ''}${weightDelta}<span class="kpi-unit"> kg</span></div></div>` : ''}
</div>

<div class="section-title">Objectif de course</div>
${goalHtml}

<div class="section-title">Analyse du coach</div>
${coachItems || '<p class="empty">Pas de données coach disponibles.</p>'}

<div class="section-title">Records personnels</div>
${prTable}

<div class="section-title">Activités (${acts.length})</div>
${actsRows}

<div class="footer">Garmin Dashboard — rapport généré automatiquement, aucune donnée transmise à un tiers</div>
</body>
</html>`;

    const w = window.open('', '_blank');
    if (!w) { showToast('Autorise les popups pour exporter', 'err'); return; }
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => { w.print(); }, 400);
    if (typeof showToast === 'function') showToast('Rapport imprimable généré ✓', 'ok');
  } catch (e) {
    console.error('[exportFullReportPDF]', e);
    if (typeof showToast === 'function') showToast('Erreur lors de la génération PDF', 'err');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🖨️ Version imprimable'; }
  }
}

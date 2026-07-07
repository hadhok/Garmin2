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

  /* Objectif de course */
  let raceGoal = null;
  try { raceGoal = (typeof getRaceGoal === 'function') ? getRaceGoal() : null; } catch {}

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
    race_goal: raceGoal,
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

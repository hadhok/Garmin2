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

async function buildFullReport() {
  const acts = getAll();
  const wellDays = state.wellness?.days || {};

  /* Coach : re-fetch léger (pas stocké dans state) */
  let coach = null;
  try {
    const r = await fetch('/api/coach', { cache: 'no-store' });
    if (r.ok) coach = await r.json();
  } catch {}

  /* Calculs course + calibration (si section Course déjà visitée) */
  let calculations = null;
  try { calculations = (typeof computeCalculations === 'function') ? computeCalculations() : null; } catch {}

  /* Records personnels par tranche de distance */
  let personalRecords = null;
  try { personalRecords = (typeof computePRSnapshot === 'function') ? computePRSnapshot() : null; } catch {}

  /* Objectif de course */
  let raceGoal = null;
  try { raceGoal = (typeof getRaceGoal === 'function') ? getRaceGoal() : null; } catch {}

  /* Courbe de forme 90 jours (toutes activités) */
  let formCurve90d = null;
  try { formCurve90d = (typeof computeFormeCurve === 'function') ? computeFormeCurve(acts, 90) : null; } catch {}

  /* Recommandation du jour + signaux (ACWR, HRV, score récup) */
  let dailyReco = null;
  try { dailyReco = (typeof computeDailyReco === 'function') ? computeDailyReco() : null; } catch {}

  /* Score de récupération sur les 30 derniers jours (série) */
  let recoveryScoreHistory = null;
  try {
    if (typeof computeRecoveryScoreDay === 'function') {
      const days = Object.values(wellDays).filter(d => d.date).sort((a, b) => a.date.localeCompare(b.date));
      recoveryScoreHistory = days.slice(-30).map(d => {
        const idx = days.indexOf(d);
        const window28 = days.slice(Math.max(0, idx - 27), idx + 1);
        return { date: d.date, score: computeRecoveryScoreDay(d, window28) };
      });
    }
  } catch {}

  const dates = acts.map(a => a.date).filter(Boolean).sort();
  const bodyMetrics = (typeof getBodyMetrics === 'function') ? getBodyMetrics() : [];

  return {
    generated_at: new Date().toISOString(),
    app: 'Garmin Dashboard',
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
    form_curve_90d: formCurve90d,
    today_recommendation: dailyReco,
    recovery_score_last_30d: recoveryScoreHistory,
    coach_analysis: coach,
  };
}

async function exportFullReport() {
  const btn = document.getElementById('export-report-btn');
  const statusEl = document.getElementById('export-report-status');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Génération…'; }

  try {
    const report = await buildFullReport();
    const json = JSON.stringify(report, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `rapport-sante-${TODAY_ISO}.json`;
    link.click();
    URL.revokeObjectURL(url);

    const sizeKb = Math.round(json.length / 1024);
    if (statusEl) {
      statusEl.textContent = `✓ Rapport généré (${sizeKb} Ko, ${report.activities.length} activités, ${Object.keys(report.wellness_days).length} jours de bien-être)`;
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
    if (btn) { btn.disabled = false; btn.textContent = '📄 Exporter le rapport complet'; }
  }
}

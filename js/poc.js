/* ══════════════════════════════════════════════════════════
   POC.JS — Science du sport : outils validés expérimentaux
   ══════════════════════════════════════════════════════════ */

/* ──────────────────────────────────────────────────────────
   INFO MODALS — explications & niveaux pour chaque graphique
   ────────────────────────────────────────────────────────── */
const INFO_CONTENT = {
  'recovery-score': {
    title: 'Score de Récupération Composite',
    text: 'Score 0–100 calculé chaque jour à partir de 4 signaux biologiques pondérés : HRV (30%), FC repos (25%), Body Battery (25%), Sommeil (20%). Chaque composante est normalisée par rapport à votre baseline personnelle sur 28 jours.',
    levels: [
      { color: '#22c55e', label: '≥ 70 — Bon',    desc: 'Séance intense possible, le corps est bien récupéré' },
      { color: '#f97316', label: '40–69 — Moyen', desc: 'Endurance fondamentale conseillée, évitez les séances dures' },
      { color: '#ef4444', label: '< 40 — Bas',    desc: 'Repos actif recommandé, récupération insuffisante' },
    ]
  },
  'hrv': {
    title: 'HRV-Guided Training',
    text: 'La variabilité de la fréquence cardiaque (HRV) reflète l\'état de votre système nerveux autonome. Une HRV élevée = bonne récupération. On compare le trend 7 jours à votre baseline personnelle sur 28 jours (±0.5 écart-type).',
    levels: [
      { color: '#22c55e', label: 'Au-dessus baseline + 0.5 SD', desc: 'Séance intense possible 🟢' },
      { color: '#f97316', label: 'Dans la zone normale',         desc: 'Endurance fondamentale conseillée 🟠' },
      { color: '#ef4444', label: 'En-dessous baseline − 0.5 SD', desc: 'Repos actif recommandé 🔴' },
    ]
  },
  'rhr': {
    title: 'Tendance FC de repos',
    text: 'La fréquence cardiaque de repos (FCR) est un marqueur de fatigue accumulée. Une augmentation par rapport à votre moyenne 28 jours signale un stress physique ou une mauvaise récupération. Garmin la mesure chaque nuit pendant le sommeil.',
    levels: [
      { color: '#22c55e', label: '≤ baseline',          desc: 'Bien récupéré, FCR normale ou basse' },
      { color: '#f97316', label: '+ 3–5 bpm vs baseline', desc: 'Fatigue modérée — surveillez l\'entraînement' },
      { color: '#ef4444', label: '> + 5 bpm vs baseline', desc: 'Fatigue élevée — repos recommandé' },
    ]
  },
  'longratio': {
    title: 'Ratio Longue Sortie / Volume',
    text: 'Pourcentage du volume hebdomadaire représenté par votre sortie la plus longue. Selon Daniels & Gilbert (Oxygen Power), la longue sortie ne doit pas dépasser 30% du volume total pour éviter une charge asymétrique et le risque de blessure.',
    levels: [
      { color: '#22c55e', label: '25–30% — Optimal',    desc: 'Équilibre idéal entre longue sortie et volume total' },
      { color: '#f97316', label: '< 25% — Sous-optimal', desc: 'Sortie longue trop courte, endurance de fond sous-développée' },
      { color: '#ef4444', label: '> 35% — Trop élevé',  desc: 'Risque de charge asymétrique et surmenage' },
    ]
  },
  'phase': {
    title: 'Phase d\'Entraînement Automatique',
    text: 'La phase est détectée automatiquement à partir de la pente du CTL (fitness trend), du TSB (forme du moment) et de l\'ACWR (ratio charge aiguë/chronique). Elle évolue semaine après semaine.',
    levels: [
      { color: '#3b82f6', label: 'Base',      desc: 'Construction aérobie, CTL en hausse progressive' },
      { color: '#f97316', label: 'Charge',     desc: 'Bloc intensif, TSB négatif contrôlé' },
      { color: '#6366f1', label: 'Pic',        desc: 'CTL élevé, prêt pour une compétition' },
      { color: '#22c55e', label: 'Récupération', desc: 'TSB remonte, fatigue qui se dissipe' },
    ]
  },
  'pacereserve': {
    title: 'Réserve d\'Allure',
    text: 'La réserve d\'allure (Pace Reserve) est l\'écart entre votre allure maximale en sprint court et votre allure d\'endurance fondamentale. Plus la réserve est grande, plus vous avez de marge pour accélérer en course. Elle est calculée sur vos 20 dernières courses ≥ 3 km.',
    levels: [
      { color: '#22c55e', label: '> 3 min/km — Grande réserve',   desc: 'Bonne capacité à changer de rythme, vitesse maximale élevée' },
      { color: '#f97316', label: '1.5–3 min/km — Réserve moyenne', desc: 'Profil équilibré coureur endurance/vitesse' },
      { color: '#ef4444', label: '< 1.5 min/km — Faible réserve', desc: 'Profil spécialisé endurance, peu de vitesse maximale' },
    ]
  },
};

function showInfoModal(key) {
  const info = INFO_CONTENT[key];
  if (!info) return;
  const existing = document.getElementById('info-modal-overlay');
  if (existing) existing.remove();

  const levelsHtml = (info.levels || []).map(l => `
    <div class="info-modal-level">
      <div class="info-modal-level-dot" style="background:${l.color}"></div>
      <div class="info-modal-level-label" style="color:${l.color}">${l.label}</div>
      <div class="info-modal-level-desc">${l.desc}</div>
    </div>`).join('');

  const overlay = document.createElement('div');
  overlay.id = 'info-modal-overlay';
  overlay.className = 'info-modal-overlay';
  overlay.innerHTML = `
    <div class="info-modal">
      <div class="info-modal-title">${info.title}</div>
      <div class="info-modal-text">${info.text}</div>
      ${levelsHtml ? `<div class="info-modal-levels">${levelsHtml}</div>` : ''}
      <button class="info-modal-close" onclick="document.getElementById('info-modal-overlay').remove()">Fermer</button>
    </div>`;
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

/* ──────────────────────────────────────────────────────────
   0. RECOMMANDATION CONSOLIDÉE
   Arbitre entre HRV, ACWR, score récupération et phase.
   Hiérarchie de priorité :
     1. ACWR > 1.5  → risque structurel, prime sur tout
     2. Score récupération < 40 → fatigue systémique
     3. HRV sous baseline − 0.5 SD → SNA non récupéré
     4. Phase "surcharge" → idem ACWR
     5. Sinon → signal HRV favorable autorise la charge
   ────────────────────────────────────────────────────────── */
function renderPocSynthesis() {
  const el = document.getElementById('poc-synthesis');
  if (!el) return;

  /* ── Délègue à computeDailyReco() (app.js) — source unique de vérité ── */
  const dr = computeDailyReco();
  const { reco, reasons, conflicts, acwrVal, hrvSignal, hrvDetail, recovScore } = dr;

  const RECOS = {
    rest: {
      color: '#ef4444', bg: 'rgba(239,68,68,0.08)', border: '#ef4444',
      icon: '🛑', title: 'Repos recommandé',
      badge: 'REPOS',
    },
    easy: {
      color: '#f97316', bg: 'rgba(249,115,22,0.08)', border: '#f97316',
      icon: '🚶', title: 'Sortie légère uniquement',
      badge: 'FACILE',
    },
    moderate: {
      color: '#eab308', bg: 'rgba(234,179,8,0.08)', border: '#eab308',
      icon: '🏃', title: 'Endurance fondamentale',
      badge: 'MODÉRÉ',
    },
    hard: {
      color: '#22c55e', bg: 'rgba(34,197,94,0.08)', border: '#22c55e',
      icon: '⚡', title: 'Séance intense possible',
      badge: 'INTENSE',
    },
  };

  const r = RECOS[reco];

  /* ── Tableau de bord des signaux ── */
  function sigBadge(label, val, color, detail) {
    return `<div style="background:var(--surface2);border-left:3px solid ${color};border-radius:0 8px 8px 0;padding:8px 12px;font-size:12px">
      <div style="color:var(--muted);font-size:10px;margin-bottom:2px">${label}</div>
      <div style="font-weight:700;color:${color}">${val}</div>
      ${detail ? `<div style="font-size:10px;color:var(--muted);margin-top:1px">${detail}</div>` : ''}
    </div>`;
  }

  const acwrColor  = acwrVal === null ? '#6b7280' : acwrVal > 1.5 ? '#ef4444' : acwrVal > 1.3 ? '#f97316' : acwrVal < 0.8 ? '#3b82f6' : '#22c55e';
  const hrvColor   = hrvSignal === 'green' ? '#22c55e' : hrvSignal === 'red' ? '#ef4444' : hrvSignal === 'orange' ? '#f97316' : '#6b7280';
  const recovColor = recovScore === null ? '#6b7280' : recovScore >= 70 ? '#22c55e' : recovScore >= 40 ? '#f97316' : '#ef4444';

  el.innerHTML = `
    <div style="background:${r.bg};border:2px solid ${r.border};border-radius:14px;padding:16px 20px;margin-bottom:16px">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <div style="font-size:32px">${r.icon}</div>
        <div style="flex:1">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px">
            <span style="font-size:16px;font-weight:800;color:${r.color}">${r.title}</span>
            <span style="font-size:10px;font-weight:700;background:${r.color};color:white;padding:2px 8px;border-radius:20px">${r.badge}</span>
          </div>
          <ul style="margin:0;padding:0 0 0 16px;font-size:12px;color:var(--text);line-height:1.7">
            ${reasons.map(s => `<li>${s}</li>`).join('')}
          </ul>
        </div>
      </div>
      ${conflicts.length ? `
        <div style="margin-top:12px;padding:10px 12px;background:rgba(0,0,0,0.06);border-radius:8px;font-size:12px;color:var(--text);line-height:1.6">
          <span style="font-weight:700;color:${r.color}">⚠️ Pourquoi les signaux sont contradictoires :</span><br>
          ${conflicts.join('<br>')}
        </div>` : ''}
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">
      ${sigBadge('ACWR', acwrVal !== null ? acwrVal : '–', acwrColor,
          acwrVal !== null ? (acwrVal > 1.5 ? 'Risque élevé' : acwrVal > 1.3 ? 'Vigilance' : acwrVal < 0.8 ? 'Sous-charge' : 'Optimal') : 'Données insuf.')}
      ${sigBadge('HRV trend 7j', hrvDetail ? hrvDetail.r7 + ' ms' : '–', hrvColor,
          hrvSignal === 'green' ? '↑ au-dessus baseline' : hrvSignal === 'red' ? '↓ sous baseline' : hrvSignal === 'orange' ? 'Zone normale' : 'Données insuf.')}
      ${sigBadge('Score récupération', recovScore !== null ? recovScore + '/100' : '–', recovColor,
          recovScore !== null ? (recovScore >= 70 ? 'Bonne' : recovScore >= 40 ? 'Partielle' : 'Insuffisante') : 'Données insuf.')}
    </div>`;
}

/* ──────────────────────────────────────────────────────────
   1. SCORE DE RÉCUPÉRATION COMPOSITE
   HRV 30% - FC repos 25% - Body Battery 25% - Sommeil 20%
   Ref : Plews et al. (2013) IJSPP
   ────────────────────────────────────────────────────────── */
function renderPocRecovery() {
  const el    = document.getElementById('poc-recovery-score');
  if (!el || !state.wellness?.days) return;

  const days = Object.values(state.wellness.days)
    .filter(d => d.date)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (days.length < 7) { el.innerHTML = '<div class="empty">Données insuffisantes (min 7 jours)</div>'; return; }

  /* baseline 28j pour chaque composante */
  const last28 = days.slice(-28);
  function avg(arr, fn) {
    const vals = arr.map(fn).filter(v => v != null && !isNaN(v));
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
  }
  function std(arr, fn, mean) {
    const vals = arr.map(fn).filter(v => v != null && !isNaN(v));
    if (!vals.length || mean == null) return 1;
    return Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length) || 1;
  }

  const b28 = {
    hrv:     avg(last28, d => d.hrv_rmssd || d.hrv_weekly_avg),
    hr_rest: avg(last28, d => d.resting_hr),
    bb:      avg(last28, d => d.body_battery_high),
    sleep:   avg(last28, d => d.sleep_duration_h),
  };

  /* Score normalisé 0–100 par jour */
  function scoreDay(d) {
    const scores = [];

    if (b28.hrv != null && d.hrv_rmssd != null) {
      // HRV: plus élevé = mieux, normalise autour de baseline
      const s = Math.min(100, Math.max(0, 50 + (d.hrv_rmssd - b28.hrv) / b28.hrv * 150));
      scores.push({ s, w: 0.30 });
    }
    if (b28.hr_rest != null && d.resting_hr != null) {
      // FC repos: plus bas = mieux, inverse
      const s = Math.min(100, Math.max(0, 50 - (d.resting_hr - b28.hr_rest) / b28.hr_rest * 150));
      scores.push({ s, w: 0.25 });
    }
    if (d.body_battery_high != null) {
      scores.push({ s: d.body_battery_high, w: 0.25 });
    }
    if (d.sleep_duration_h != null) {
      // Cible 7.5h, ±1.5h = ±50 pts
      const s = Math.min(100, Math.max(0, 50 + (d.sleep_duration_h - 7.5) / 1.5 * 50));
      scores.push({ s, w: 0.20 });
    }

    if (!scores.length) return null;
    const totalW = scores.reduce((s, x) => s + x.w, 0);
    return Math.round(scores.reduce((s, x) => s + x.s * x.w, 0) / totalW);
  }

  const scored = days.slice(-30).map(d => ({ date: d.date, score: scoreDay(d) })).filter(d => d.score != null);
  if (!scored.length) { el.innerHTML = '<div class="empty">Données HRV / FC repos manquantes</div>'; return; }

  const today = scored[scored.length - 1];
  const score = today.score;

  const color = score >= 70 ? '#22c55e' : score >= 40 ? '#f97316' : '#ef4444';
  const label = score >= 70 ? 'Bonne récupération' : score >= 40 ? 'Récupération partielle' : 'Récupération insuffisante';
  const reco  = score >= 70 ? 'Séance intense possible.' : score >= 40 ? 'Préférez endurance fondamentale ou technique.' : 'Repos actif recommandé.';

  el.innerHTML = `
    <div style="text-align:center;padding:16px 0">
      <div style="position:relative;display:inline-block;width:110px;height:110px">
        <svg width="110" height="110" viewBox="0 0 110 110">
          <circle cx="55" cy="55" r="46" fill="none" stroke="var(--surface2)" stroke-width="10"/>
          <circle cx="55" cy="55" r="46" fill="none" stroke="${color}" stroke-width="10"
            stroke-dasharray="${2 * Math.PI * 46}"
            stroke-dashoffset="${2 * Math.PI * 46 * (1 - score / 100)}"
            stroke-linecap="round" transform="rotate(-90 55 55)"/>
        </svg>
        <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center">
          <div style="font-size:26px;font-weight:800;color:${color}">${score}</div>
          <div style="font-size:10px;color:var(--muted)">/100</div>
        </div>
      </div>
      <div style="font-size:14px;font-weight:700;color:${color};margin-top:6px">${label}</div>
      <div style="font-size:12px;color:var(--muted);margin-top:4px">${reco}</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px;font-size:12px">
      ${b28.hrv     != null ? `<div style="background:var(--surface2);border-radius:8px;padding:8px 10px"><div style="color:var(--muted);font-size:10px">HRV base 28j</div><b>${b28.hrv.toFixed(1)} ms</b></div>` : ''}
      ${b28.hr_rest != null ? `<div style="background:var(--surface2);border-radius:8px;padding:8px 10px"><div style="color:var(--muted);font-size:10px">FC repos base 28j</div><b>${b28.hr_rest.toFixed(0)} bpm</b></div>` : ''}
      ${b28.bb      != null ? `<div style="background:var(--surface2);border-radius:8px;padding:8px 10px"><div style="color:var(--muted);font-size:10px">Body Battery base 28j</div><b>${b28.bb.toFixed(0)}%</b></div>` : ''}
      ${b28.sleep   != null ? `<div style="background:var(--surface2);border-radius:8px;padding:8px 10px"><div style="color:var(--muted);font-size:10px">Sommeil base 28j</div><b>${b28.sleep.toFixed(1)}h</b></div>` : ''}
    </div>`;

  mkChart('chart-poc-recovery', {
    type: 'line',
    data: {
      labels: scored.map(d => new Date(d.date + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })),
      datasets: [{
        label: 'Score récupération',
        data: scored.map(d => d.score),
        borderColor: '#6366f1',
        backgroundColor: ctx => {
          const g = ctx.chart.ctx.createLinearGradient(0, 0, 0, 180);
          g.addColorStop(0, 'rgba(99,102,241,0.25)');
          g.addColorStop(1, 'rgba(99,102,241,0)');
          return g;
        },
        fill: true, borderWidth: 2, tension: 0.4,
        pointBackgroundColor: scored.map(d => d.score >= 70 ? '#22c55e' : d.score >= 40 ? '#f97316' : '#ef4444'),
        pointRadius: 4,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        annotation: {
          annotations: {
            z70: { type: 'line', yMin: 70, yMax: 70, borderColor: '#22c55e', borderWidth: 1, borderDash: [4, 3],
              label: { content: '70 Bonne', display: true, position: 'end', color: '#22c55e', font: { size: 9 }, backgroundColor: 'transparent' } },
            z40: { type: 'line', yMin: 40, yMax: 40, borderColor: '#f97316', borderWidth: 1, borderDash: [4, 3],
              label: { content: '40 Partielle', display: true, position: 'end', color: '#f97316', font: { size: 9 }, backgroundColor: 'transparent' } },
          }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 6, maxRotation: 0 } },
        y: { min: 0, max: 100, grid: { color: 'rgba(107,114,128,0.1)' } }
      }
    }
  });
}

/* ──────────────────────────────────────────────────────────
   2. HRV-GUIDED TRAINING
   Moyenne mobile 7j vs baseline 28j ± 1 SD
   Ref : Kiviniemi et al. (2007) EJAP
   ────────────────────────────────────────────────────────── */
function renderPocHRV() {
  const el = document.getElementById('poc-hrv-reco');
  if (!el || !state.wellness?.days) return;

  const days = Object.values(state.wellness.days)
    .filter(d => d.date && (d.hrv_rmssd || d.hrv_weekly_avg))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (days.length < 14) { el.innerHTML = '<div class="empty">Données HRV insuffisantes (min 14 jours)</div>'; return; }

  const hrv = d => d.hrv_rmssd || d.hrv_weekly_avg || null;

  /* Rolling 7-day average per day */
  function rolling7(arr, i) {
    const slice = arr.slice(Math.max(0, i - 6), i + 1).map(hrv).filter(v => v != null);
    return slice.length ? slice.reduce((s, v) => s + v, 0) / slice.length : null;
  }

  /* Baseline 28j ending at each point */
  function baseline28(arr, i) {
    const slice = arr.slice(Math.max(0, i - 27), i + 1).map(hrv).filter(v => v != null);
    if (slice.length < 7) return null;
    const m = slice.reduce((s, v) => s + v, 0) / slice.length;
    const sd = Math.sqrt(slice.reduce((s, v) => s + (v - m) ** 2, 0) / slice.length);
    return { mean: m, sd };
  }

  const last90 = days.slice(-90);
  const labels = [], r7vals = [], baseVals = [], upVals = [], downVals = [];

  last90.forEach((d, i) => {
    labels.push(new Date(d.date + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }));
    const r7 = rolling7(last90, i);
    const b  = baseline28(last90, i);
    r7vals.push(r7 != null ? +r7.toFixed(1) : null);
    baseVals.push(b ? +b.mean.toFixed(1) : null);
    upVals.push(b ? +(b.mean + 0.5 * b.sd).toFixed(1) : null);
    downVals.push(b ? +(b.mean - 0.5 * b.sd).toFixed(1) : null);
  });

  /* Today's recommendation */
  const todayR7   = r7vals[r7vals.length - 1];
  const todayBase = baseVals[baseVals.length - 1];
  const todayUp   = upVals[upVals.length - 1];
  const todayDown = downVals[downVals.length - 1];
  const todayHRV  = hrv(last90[last90.length - 1]);

  let recoColor, recoIcon, recoTitle, recoText;
  if (todayR7 == null || todayBase == null) {
    recoColor = '#6b7280'; recoIcon = '⚪'; recoTitle = 'Données insuffisantes'; recoText = 'Continuez à synchroniser pour obtenir une recommandation.';
  } else if (todayR7 >= todayUp) {
    recoColor = '#22c55e'; recoIcon = '🟢'; recoTitle = 'Séance intense possible';
    recoText = `HRV 7j (${todayR7} ms) supérieur à la baseline + 0.5 SD (${todayUp} ms). Système nerveux bien récupéré.`;
  } else if (todayR7 <= todayDown) {
    recoColor = '#ef4444'; recoIcon = '🔴'; recoTitle = 'Récupération recommandée';
    recoText = `HRV 7j (${todayR7} ms) inférieur à la baseline − 0.5 SD (${todayDown} ms). Évitez les séances intenses aujourd'hui.`;
  } else {
    recoColor = '#f97316'; recoIcon = '🟠'; recoTitle = 'Endurance fondamentale';
    recoText = `HRV 7j (${todayR7} ms) dans la zone normale (${todayDown}–${todayUp} ms). Séance modérée conseillée.`;
  }

  el.innerHTML = `
    <div style="background:${recoColor}18;border:1.5px solid ${recoColor};border-radius:12px;padding:14px 16px;margin-bottom:12px">
      <div style="font-size:20px;margin-bottom:4px">${recoIcon}</div>
      <div style="font-size:14px;font-weight:700;color:${recoColor};margin-bottom:4px">${recoTitle}</div>
      <div style="font-size:12px;color:var(--text);line-height:1.5">${recoText}</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px">
      <div style="background:var(--surface2);border-radius:8px;padding:8px 10px">
        <div style="color:var(--muted);font-size:10px">HRV dernière nuit</div>
        <b>${todayHRV != null ? todayHRV + ' ms' : '–'}</b>
      </div>
      <div style="background:var(--surface2);border-radius:8px;padding:8px 10px">
        <div style="color:var(--muted);font-size:10px">Trend 7j</div>
        <b>${todayR7 != null ? todayR7 + ' ms' : '–'}</b>
      </div>
      <div style="background:var(--surface2);border-radius:8px;padding:8px 10px">
        <div style="color:var(--muted);font-size:10px">Baseline 28j</div>
        <b>${todayBase != null ? todayBase + ' ms' : '–'}</b>
      </div>
      <div style="background:var(--surface2);border-radius:8px;padding:8px 10px">
        <div style="color:var(--muted);font-size:10px">Seuils ±0.5 SD</div>
        <b>${todayDown != null ? todayDown + ' – ' + todayUp + ' ms' : '–'}</b>
      </div>
    </div>`;

  mkChart('chart-poc-hrv', {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'HRV trend 7j',
          data: r7vals,
          borderColor: '#6366f1', borderWidth: 2, fill: false, tension: 0.4,
          pointRadius: 2, spanGaps: true,
        },
        {
          label: 'Baseline 28j',
          data: baseVals,
          borderColor: '#94a3b8', borderWidth: 1.5, borderDash: [4, 3], fill: false, tension: 0.4,
          pointRadius: 0, spanGaps: true,
        },
        {
          label: '+0.5 SD',
          data: upVals,
          borderColor: '#22c55e55', borderWidth: 1, fill: '+1',
          backgroundColor: 'rgba(34,197,94,0.07)', tension: 0.4, pointRadius: 0, spanGaps: true,
        },
        {
          label: '−0.5 SD',
          data: downVals,
          borderColor: '#ef444455', borderWidth: 1, fill: false,
          tension: 0.4, pointRadius: 0, spanGaps: true,
        },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: true, labels: { boxWidth: 12, font: { size: 10 } } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 7, maxRotation: 0 } },
        y: { title: { display: true, text: 'HRV (ms)', font: { size: 10 }, color: '#6b7280' }, grid: { color: 'rgba(107,114,128,0.1)' } }
      }
    }
  });
}

/* ──────────────────────────────────────────────────────────
   3. RATIO LONGUE SORTIE / VOLUME
   Cible 25–30%, alerte >35%
   Ref : Daniels & Gilbert — Oxygen Power (1979)
   ────────────────────────────────────────────────────────── */
function renderPocLongRatio() {
  const el = document.getElementById('poc-longratio-current');
  if (!el) return;

  const runs = (state.data?.activities || []).filter(a => a.type === 'run' && a.distance_km > 0);
  if (!runs.length) { el.innerHTML = '<div class="empty">Aucune course disponible</div>'; return; }

  /* Weekly buckets — 16 dernières semaines */
  function weekKey(dateStr) {
    const d   = new Date(dateStr + 'T12:00:00');
    const dow = (d.getDay() + 6) % 7;
    const mon = new Date(d); mon.setDate(d.getDate() - dow);
    return localIso(mon);
  }

  const weeks = {};
  runs.forEach(r => {
    const wk = weekKey(r.date);
    if (!weeks[wk]) weeks[wk] = [];
    weeks[wk].push(r.distance_km);
  });

  const sorted = Object.keys(weeks).sort().slice(-16);

  const labels = sorted.map(w => {
    const d = new Date(w + 'T12:00:00');
    return `S${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`;
  });

  const ratios = sorted.map(wk => {
    const dists = weeks[wk];
    const total = dists.reduce((s, v) => s + v, 0);
    const long  = Math.max(...dists);
    return total > 0 ? +(long / total * 100).toFixed(1) : 0;
  });

  const thisWeek = sorted[sorted.length - 1];
  const curRatio = ratios[ratios.length - 1];
  const curDists = weeks[thisWeek] || [];
  const curTotal = curDists.reduce((s, v) => s + v, 0);
  const curLong  = Math.max(...(curDists.length ? curDists : [0]));

  const color = curRatio > 35 ? '#ef4444' : curRatio >= 25 ? '#22c55e' : '#f97316';
  const label = curRatio > 35 ? 'Trop élevé — risque de charge asymétrique'
              : curRatio >= 25 ? 'Optimal (25–30%)'
              : 'Sous-optimal — sortie longue à allonger';

  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:16px;margin-bottom:14px;flex-wrap:wrap">
      <div style="background:${color}18;border:2px solid ${color};border-radius:12px;padding:10px 20px;text-align:center">
        <div style="font-size:28px;font-weight:800;color:${color}">${curRatio}%</div>
        <div style="font-size:10px;color:${color};font-weight:700;text-transform:uppercase">cette semaine</div>
      </div>
      <div style="font-size:12px;line-height:1.6;color:var(--text)">
        <div style="color:${color};font-weight:600;margin-bottom:4px">${label}</div>
        Longue sortie : <b>${curLong.toFixed(1)} km</b> &nbsp;·&nbsp; Volume total : <b>${curTotal.toFixed(1)} km</b><br>
        <span style="color:var(--muted)">Zone optimale : 25–30% · Alerte : &gt; 35%</span>
      </div>
    </div>`;

  mkChart('chart-poc-longratio', {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: '% longue sortie',
        data: ratios,
        backgroundColor: ratios.map(r => r > 35 ? 'rgba(239,68,68,0.7)' : r >= 25 ? 'rgba(34,197,94,0.7)' : 'rgba(249,115,22,0.6)'),
        borderRadius: 4,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        annotation: {
          annotations: {
            optLow:  { type: 'line', yMin: 25, yMax: 25, borderColor: '#22c55e', borderWidth: 1, borderDash: [4, 3],
              label: { content: '25%', display: true, position: 'start', color: '#22c55e', font: { size: 9 }, backgroundColor: 'transparent' } },
            optHigh: { type: 'line', yMin: 30, yMax: 30, borderColor: '#22c55e', borderWidth: 1, borderDash: [4, 3],
              label: { content: '30%', display: true, position: 'start', color: '#22c55e', font: { size: 9 }, backgroundColor: 'transparent' } },
            danger:  { type: 'line', yMin: 35, yMax: 35, borderColor: '#ef4444', borderWidth: 1.5, borderDash: [4, 3],
              label: { content: '35% Alerte', display: true, position: 'end', color: '#ef4444', font: { size: 9 }, backgroundColor: 'transparent' } },
          }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxRotation: 45, font: { size: 9 } } },
        y: { min: 0, suggestedMax: 50, title: { display: true, text: '%', font: { size: 10 }, color: '#6b7280' }, grid: { color: 'rgba(107,114,128,0.1)' } }
      }
    }
  });
}

/* ──────────────────────────────────────────────────────────
   4. DÉTECTION AUTOMATIQUE DE PHASE D'ENTRAÎNEMENT
   Base CTL slope + TSB + ACWR → phase
   ────────────────────────────────────────────────────────── */
function renderPocPhase() {
  const curEl  = document.getElementById('poc-phase-current');
  const tlEl   = document.getElementById('poc-phase-timeline');
  if (!curEl || !tlEl) return;

  const allActs = state.data?.activities || [];
  if (allActs.filter(a => a.type === 'run').length < 10) {
    curEl.innerHTML = '<div class="empty">Données insuffisantes (min 10 sorties)</div>'; return;
  }

  /* Toutes activités avec FC — buildTRIMPMap() est global dans app.js */
  const trimpByDay = buildTRIMPMap(allActs);
  function dayTrimp(dateStr) { return trimpByDay[dateStr] || 0; }

  /* CTL/ATL/TSB per week */
  function weekData(weeksBack) {
    const end = new Date(TODAY); end.setDate(end.getDate() - weeksBack * 7);
    let ctl = 0, atl = 0;
    const kCTL = Math.exp(-1 / 42), kATL = Math.exp(-1 / 7);
    // Warm-up 90 days before window
    for (let i = 90 + weeksBack * 7; i >= weeksBack * 7; i--) {
      const d = new Date(TODAY); d.setDate(d.getDate() - i);
      const t = dayTrimp(localIso(d));
      ctl = ctl * kCTL + t * (1 - kCTL);
      atl = atl * kATL + t * (1 - kATL);
    }
    // Last 7 days of the window
    const trimpW = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(end); d.setDate(end.getDate() - i);
      return dayTrimp(localIso(d));
    });
    const al = trimpW.reduce((s, v) => s + v, 0) / 7;
    const cl = (() => {
      let sum = 0;
      for (let i = 0; i < 28; i++) {
        const d = new Date(end); d.setDate(end.getDate() - i);
        sum += dayTrimp(localIso(d));
      }
      return sum / 28;
    })();
    const acwr = cl > 0.5 ? al / cl : null;
    return { ctl, atl, tsb: ctl - atl, acwr };
  }

  function detectPhase(w) {
    const { ctl, atl, tsb, acwr } = w;
    const prevCTL = weekData(w._wk + 4)?.ctl || ctl;
    const ctlSlope = ctl - prevCTL;

    if (acwr != null && acwr > 1.5 && tsb < -20) return 'surcharge';
    if (tsb > 5 && ctlSlope >= 0)               return 'pic';
    if (tsb > 10)                                return 'recuperation';
    if (ctlSlope > 3 && tsb < -5)               return 'build';
    if (ctlSlope > 0)                            return 'base';
    if (ctlSlope < -3)                           return 'recuperation';
    return 'base';
  }

  const PHASE_CFG = {
    base:        { label: 'Base',        color: '#3b82f6', icon: '🔵', desc: 'CTL qui monte lentement. Travail en endurance fondamentale.' },
    build:       { label: 'Build',       color: '#8b5cf6', icon: '🟣', desc: 'Montée de charge significative. Inclut tempo et seuil.' },
    pic:         { label: 'Pic de forme',color: '#22c55e', icon: '🟢', desc: 'TSB positif, CTL stabilisé. Forme au top.' },
    recuperation:{ label: 'Récupération',color: '#06b6d4', icon: '🔷', desc: 'Décharge intentionnelle. Laissez le corps absorber.' },
    surcharge:   { label: 'Surcharge ⚠️',color: '#ef4444', icon: '🔴', desc: 'ACWR > 1.5 et TSB très négatif. Risque de blessure élevé.' },
  };

  /* Build 24-week timeline */
  const timeline = [];
  for (let wk = 23; wk >= 0; wk--) {
    const w = weekData(wk);
    w._wk = wk;
    const phase = detectPhase(w);
    const weekStart = new Date(TODAY); weekStart.setDate(weekStart.getDate() - wk * 7);
    timeline.push({ wk, phase, ...w, weekStart });
  }

  const todayPhase = timeline[timeline.length - 1];
  const cfg = PHASE_CFG[todayPhase.phase];

  curEl.innerHTML = `
    <div style="background:${cfg.color}18;border:2px solid ${cfg.color};border-radius:12px;padding:14px 18px;margin-bottom:12px">
      <div style="font-size:20px;margin-bottom:4px">${cfg.icon}</div>
      <div style="font-size:16px;font-weight:800;color:${cfg.color}">${cfg.label}</div>
      <div style="font-size:12px;color:var(--text);margin-top:4px;line-height:1.5">${cfg.desc}</div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;font-size:12px">
      <div style="background:var(--surface2);border-radius:8px;padding:8px 10px">
        <div style="color:var(--muted);font-size:10px">CTL (Forme)</div>
        <b>${todayPhase.ctl.toFixed(1)}</b>
      </div>
      <div style="background:var(--surface2);border-radius:8px;padding:8px 10px">
        <div style="color:var(--muted);font-size:10px">TSB (Fraîcheur)</div>
        <b style="color:${todayPhase.tsb > 0 ? '#22c55e' : todayPhase.tsb > -10 ? '#f97316' : '#ef4444'}">${todayPhase.tsb.toFixed(1)}</b>
      </div>
      <div style="background:var(--surface2);border-radius:8px;padding:8px 10px">
        <div style="color:var(--muted);font-size:10px">ACWR</div>
        <b>${todayPhase.acwr != null ? todayPhase.acwr.toFixed(2) : '–'}</b>
      </div>
    </div>`;

  /* Frise chronologique 24 semaines */
  tlEl.innerHTML = `
    <div style="margin-top:16px;overflow-x:auto">
      <div style="font-size:11px;color:var(--muted);margin-bottom:8px">Frise des 24 dernières semaines</div>
      <div style="display:flex;gap:2px;min-width:500px">
        ${timeline.map((w, i) => {
          const c   = PHASE_CFG[w.phase];
          const lbl = w.weekStart.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
          const isCurrent = i === timeline.length - 1;
          return `<div title="${lbl} — ${c.label}" style="flex:1;height:32px;background:${c.color};border-radius:3px;opacity:${isCurrent ? 1 : 0.6};
            ${isCurrent ? 'box-shadow:0 0 0 2px white,0 0 0 3px ' + c.color : ''}"></div>`;
        }).join('')}
      </div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:10px;font-size:11px">
        ${Object.entries(PHASE_CFG).map(([, c]) => `<span style="display:flex;align-items:center;gap:4px"><span style="width:12px;height:12px;border-radius:2px;background:${c.color};display:inline-block"></span>${c.label}</span>`).join('')}
      </div>
    </div>`;
}

/* ──────────────────────────────────────────────────────────
   5. PACE RESERVE (RP)
   RP = (allure_seuil − allure_run) / allure_seuil × 100
   Ref : Renfree & Gibson (2013) Sports Medicine
   ────────────────────────────────────────────────────────── */
function renderPocPaceReserve() {
  const el = document.getElementById('poc-pacereserve');
  if (!el) return;

  const runs = (state.data?.activities || [])
    .filter(a => a.date && a.type === 'run' && a.distance_km >= 3 && a.avg_pace_min_km > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (runs.length < 5) { el.innerHTML = '<div class="empty">Données insuffisantes (min 5 sorties ≥ 3 km)</div>'; return; }

  /* Threshold pace from prognosis (10 km time) or fallback: fastest pace + 10% */
  const fastest = Math.min(...runs.map(r => r.avg_pace_min_km).filter(p => p > 0 && p < 20));
  const thresholdPace = fastest * 1.08; // ~8% au-dessus du meilleur = seuil estimé

  function rp(pace) {
    if (!pace || pace <= 0) return null;
    return +((thresholdPace - pace) / thresholdPace * 100).toFixed(1);
  }

  /* 12 dernières semaines — avg RP par semaine */
  function weekKey(dateStr) {
    const d = new Date(dateStr + 'T12:00:00');
    const dow = (d.getDay() + 6) % 7;
    const mon = new Date(d); mon.setDate(d.getDate() - dow);
    return localIso(mon);
  }

  const weekRPs = {};
  runs.forEach(r => {
    const v = rp(r.avg_pace_min_km);
    if (v == null) return;
    const wk = weekKey(r.date);
    if (!weekRPs[wk]) weekRPs[wk] = [];
    weekRPs[wk].push(v);
  });

  const sortedWks = Object.keys(weekRPs).sort().slice(-12);
  const labels    = sortedWks.map(w => {
    const d = new Date(w + 'T12:00:00');
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  });
  const rpVals = sortedWks.map(wk => {
    const vals = weekRPs[wk];
    return +(vals.reduce((s, v) => s + v, 0) / vals.length).toFixed(1);
  });

  const todayRun  = runs[runs.length - 1];
  const todayRP   = rp(todayRun.avg_pace_min_km);
  const rpColor   = todayRP == null ? '#6b7280' : todayRP > 15 ? '#22c55e' : todayRP >= 5 ? '#f97316' : '#ef4444';
  const rpLabel   = todayRP == null ? '–' : todayRP > 15 ? 'Sortie facile / récupération' : todayRP >= 5 ? 'Zone tempo/seuil' : 'Sortie intense / compétition';

  const paceStr = p => {
    if (!p) return '–';
    const m = Math.floor(p); const s = Math.round((p - m) * 60);
    return `${m}:${s.toString().padStart(2, '0')} min/km`;
  };

  el.innerHTML = `
    <div style="background:${rpColor}18;border:2px solid ${rpColor};border-radius:12px;padding:14px 18px;margin-bottom:12px">
      <div style="font-size:28px;font-weight:800;color:${rpColor}">${todayRP != null ? todayRP + '%' : '–'}</div>
      <div style="font-size:12px;font-weight:700;color:${rpColor};margin-top:2px">${rpLabel}</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px">
      <div style="background:var(--surface2);border-radius:8px;padding:8px 10px">
        <div style="color:var(--muted);font-size:10px">Allure dernière sortie</div>
        <b>${paceStr(todayRun.avg_pace_min_km)}</b>
      </div>
      <div style="background:var(--surface2);border-radius:8px;padding:8px 10px">
        <div style="color:var(--muted);font-size:10px">Allure seuil estimée</div>
        <b>${paceStr(thresholdPace)}</b>
      </div>
    </div>
    <div style="margin-top:10px;font-size:11px;color:var(--muted)">
      RP &gt; 15% = récupération · 5–15% = tempo · &lt; 5% = intense / compétition
    </div>`;

  mkChart('chart-poc-pacereserve', {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Pace Reserve (%)',
        data: rpVals,
        backgroundColor: rpVals.map(v => v > 15 ? 'rgba(34,197,94,0.7)' : v >= 5 ? 'rgba(249,115,22,0.6)' : 'rgba(239,68,68,0.7)'),
        borderRadius: 4,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        annotation: {
          annotations: {
            rp15: { type: 'line', yMin: 15, yMax: 15, borderColor: '#22c55e', borderWidth: 1, borderDash: [4, 3],
              label: { content: '15%', display: true, position: 'end', color: '#22c55e', font: { size: 9 }, backgroundColor: 'transparent' } },
            rp5:  { type: 'line', yMin: 5,  yMax: 5,  borderColor: '#f97316', borderWidth: 1, borderDash: [4, 3],
              label: { content: '5%', display: true, position: 'end', color: '#f97316', font: { size: 9 }, backgroundColor: 'transparent' } },
          }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxRotation: 45, font: { size: 9 } } },
        y: { title: { display: true, text: 'RP %', font: { size: 10 }, color: '#6b7280' }, grid: { color: 'rgba(107,114,128,0.1)' } }
      }
    }
  });
}

/* ──────────────────────────────────────────────────────────
   6. TENDANCE FC REPOS
   28j baseline vs 7j rolling — détection élévation
   ────────────────────────────────────────────────────────── */
function renderRHRTrend() {
  const el = document.getElementById('poc-rhr-trend');
  if (!el) return;

  const wellDays = state.wellness?.days || {};
  const days = Object.values(wellDays)
    .filter(d => d.date && d.resting_hr != null)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (days.length < 7) {
    el.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:8px">Données FC repos insuffisantes (min 7 jours).</div>';
    return;
  }

  const last28 = days.slice(-28);
  const last7  = days.slice(-7);

  const avg28 = last28.reduce((s, d) => s + d.resting_hr, 0) / last28.length;
  const avg7  = last7.reduce((s, d) => s + d.resting_hr, 0) / last7.length;
  const delta = +(avg7 - avg28).toFixed(1);

  let color, label;
  if (delta <= 0) {
    color = '#22c55e';
    label = `FC repos stable — ${Math.round(avg7)} bpm (moy. 7j)`;
  } else if (delta <= 3) {
    color = '#f97316';
    label = `FC repos légèrement élevée +${delta} bpm vs baseline`;
  } else {
    color = '#ef4444';
    label = `⚠ FC repos élevée +${delta} bpm — surveiller récupération`;
  }

  el.innerHTML = `
    <div style="background:${color}12;border:1.5px solid ${color};border-radius:12px;padding:14px 16px">
      <div style="font-size:13px;font-weight:700;color:${color};margin-bottom:10px">${label}</div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;font-size:12px">
        <div style="background:var(--surface2);border-radius:8px;padding:8px 10px;text-align:center">
          <div style="color:var(--muted);font-size:10px;margin-bottom:2px">Baseline 28j</div>
          <b>${avg28.toFixed(0)} bpm</b>
        </div>
        <div style="background:var(--surface2);border-radius:8px;padding:8px 10px;text-align:center">
          <div style="color:var(--muted);font-size:10px;margin-bottom:2px">Moy. 7j</div>
          <b style="color:${color}">${avg7.toFixed(0)} bpm</b>
        </div>
        <div style="background:var(--surface2);border-radius:8px;padding:8px 10px;text-align:center">
          <div style="color:var(--muted);font-size:10px;margin-bottom:2px">Delta</div>
          <b style="color:${color}">${delta > 0 ? '+' : ''}${delta} bpm</b>
        </div>
      </div>
    </div>`;
}

/* ──────────────────────────────────────────────────────────
   ENTRY POINT
   ────────────────────────────────────────────────────────── */
function renderPOC() {
  const safe = (fn) => { try { fn(); } catch(e) { console.error('[POC]', fn.name, e); } };
  safe(renderPocSynthesis);
  safe(renderPocRecovery);
  safe(renderPocHRV);
  safe(renderPocLongRatio);
  safe(renderPocPhase);
  safe(renderPocPaceReserve);
}

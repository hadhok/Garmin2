/* ══════════════════════════════════════════════════════════
   RUNALYZE — CALIBRATION MANUELLE (option A)
   L'API personnelle gratuite de Runalyze est en écriture seule
   (uniquement des POST d'upload) : impossible de lire VO2max,
   CTL, ATL ou Marathon Shape. On calibre donc les calculs
   locaux sur les valeurs affichées par runalyze.com.
   Facteur = valeur Runalyze ÷ valeur brute locale, appliqué
   dans computeCalculations() (js/running.js).
   ══════════════════════════════════════════════════════════ */

const RZ_METRICS = [
  { key: 'vo2',   store: 'vo2_correction',  label: 'VO2max effectif', unit: 'ml/kg/min', digits: 1, step: '0.1' },
  { key: 'shape', store: 'rz_factor_shape', label: 'Marathon Shape',  unit: '%',         digits: 0, step: '1'   },
  { key: 'ctl',   store: 'rz_factor_ctl',   label: 'Fitness (CTL)',   unit: '%',         digits: 0, step: '1'   },
  { key: 'atl',   store: 'rz_factor_atl',   label: 'Fatigue (ATL)',   unit: '%',         digits: 0, step: '1'   },
];

function renderRunalyzeCalibration() {
  const el = document.getElementById('rz-calibration');
  if (!el) return;

  const calc = (typeof computeCalculations === 'function') ? computeCalculations() : null;
  if (!calc || !calc.raw) {
    el.innerHTML = '<div style="padding:16px;color:var(--muted);text-align:center">Pas assez de données de course pour calibrer.</div>';
    return;
  }

  const rows = RZ_METRICS.map(m => {
    const raw    = calc.raw[m.key];
    const factor = calc.factors?.[m.key] ?? 1.0;
    const rawStr = raw != null ? raw.toFixed(m.digits) : '–';
    const calStr = raw != null ? (raw * factor).toFixed(m.digits) : '–';
    const refVal = localStorage.getItem(`rz_ref_${m.key}`) || '';
    const factorStr = Math.abs(factor - 1) > 0.005
      ? `<span style="color:#6366f1;font-weight:600">×${factor.toFixed(2)}</span>`
      : `<span style="color:var(--muted)">×1.00</span>`;
    return `
      <tr>
        <td style="padding:10px 8px;font-weight:600;font-size:13px">${m.label}<span style="font-size:10px;color:var(--muted);display:block">${m.unit}</span></td>
        <td style="padding:10px 8px;text-align:center;font-size:14px">${rawStr}</td>
        <td style="padding:10px 8px;text-align:center">
          <input type="number" id="rz-ref-${m.key}" value="${refVal}" step="${m.step}" min="0"
                 placeholder="–" inputmode="decimal"
                 style="width:80px;padding:6px;text-align:center;border:1px solid var(--border);border-radius:6px;background:var(--card-bg);color:var(--text);font-size:14px">
        </td>
        <td style="padding:10px 8px;text-align:center;font-size:13px">${factorStr}</td>
        <td style="padding:10px 8px;text-align:center;font-size:14px;font-weight:700;color:var(--text)">${calStr}</td>
      </tr>`;
  }).join('');

  el.innerHTML = `
    <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead>
          <tr style="border-bottom:2px solid var(--border)">
            <th style="padding:8px;text-align:left;font-size:10px;text-transform:uppercase;color:var(--muted)">Métrique</th>
            <th style="padding:8px;text-align:center;font-size:10px;text-transform:uppercase;color:var(--muted)">Calcul local</th>
            <th style="padding:8px;text-align:center;font-size:10px;text-transform:uppercase;color:var(--muted)">Valeur Runalyze</th>
            <th style="padding:8px;text-align:center;font-size:10px;text-transform:uppercase;color:var(--muted)">Facteur</th>
            <th style="padding:8px;text-align:center;font-size:10px;text-transform:uppercase;color:var(--muted)">Valeur calibrée</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div style="font-size:11px;color:var(--muted);margin-top:10px;line-height:1.6">
      TSB, Workload Ratio et Rest days sont dérivés de CTL/ATL et suivent automatiquement leur calibration.
    </div>`;
}

function saveRunalyzeCalibration() {
  const calc = (typeof computeCalculations === 'function') ? computeCalculations() : null;
  if (!calc || !calc.raw) return;

  let applied = 0;
  RZ_METRICS.forEach(m => {
    const input = document.getElementById(`rz-ref-${m.key}`);
    const refVal = parseFloat(input?.value);
    const raw = calc.raw[m.key];

    if (!input || !input.value.trim()) {
      /* champ vidé → réinitialiser cette métrique */
      if (m.store === 'vo2_correction') localStorage.setItem('vo2_correction', '1.00');
      else localStorage.removeItem(m.store);
      localStorage.removeItem(`rz_ref_${m.key}`);
      return;
    }
    if (isNaN(refVal) || refVal <= 0 || raw == null || raw <= 0) return;

    const factor = Math.min(2.0, Math.max(0.5, refVal / raw));
    localStorage.setItem(m.store, factor.toFixed(3));
    localStorage.setItem(`rz_ref_${m.key}`, String(refVal));
    applied++;
  });

  const statusEl = document.getElementById('rz-status');
  if (statusEl) {
    statusEl.textContent = applied
      ? `✓ Calibration enregistrée (${applied} métrique${applied > 1 ? 's' : ''})`
      : 'Aucune valeur valide saisie';
    statusEl.style.display = 'block';
    statusEl.style.background = applied ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)';
    statusEl.style.color = applied ? '#16a34a' : '#dc2626';
    setTimeout(() => statusEl.style.display = 'none', 3000);
  }

  /* Resynchroniser l'input du profil (même clé vo2_correction) */
  if (typeof initSettingsInputs === 'function') initSettingsInputs();

  renderRunalyzeCalibration();
  if (typeof markAllDirty === 'function') markAllDirty();
}

function resetRunalyzeCalibration() {
  RZ_METRICS.forEach(m => {
    if (m.store === 'vo2_correction') localStorage.setItem('vo2_correction', '1.00');
    else localStorage.removeItem(m.store);
    localStorage.removeItem(`rz_ref_${m.key}`);
  });
  if (typeof initSettingsInputs === 'function') initSettingsInputs();
  renderRunalyzeCalibration();
  if (typeof markAllDirty === 'function') markAllDirty();

  const statusEl = document.getElementById('rz-status');
  if (statusEl) {
    statusEl.textContent = '✓ Calibration réinitialisée';
    statusEl.style.display = 'block';
    statusEl.style.background = 'rgba(34,197,94,0.12)';
    statusEl.style.color = '#16a34a';
    setTimeout(() => statusEl.style.display = 'none', 3000);
  }
}

/* Appelé par le routage de vue (app.js) */
function onSwitchToRunalyze() {
  renderRunalyzeCalibration();
}

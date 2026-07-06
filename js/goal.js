/* ══════════════════════════════════════════════════════════
   GOAL.JS — Objectif de course
   Compte à rebours + temps prédit (VDOT) + forme projetée
   le jour J (simulation CTL/ATL avec affûtage 7 jours)
   ══════════════════════════════════════════════════════════ */

const GOAL_PRESETS = [
  { label: '5 km',     km: 5 },
  { label: '10 km',    km: 10 },
  { label: 'Semi',     km: 21.097 },
  { label: 'Marathon', km: 42.195 },
];

function getRaceGoal() {
  try {
    const g = JSON.parse(localStorage.getItem('race_goal') || 'null');
    if (!g || !g.date || !g.km) return null;
    return g;
  } catch { return null; }
}

/* "3:45:00" ou "45:30" → secondes */
function parseTimeToSec(str) {
  if (!str) return null;
  const parts = String(str).trim().split(':').map(Number);
  if (parts.some(isNaN)) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return null;
}

/* ── Projection de forme au jour J ──
   Reprend le CTL/ATL actuels, poursuit la charge quotidienne
   moyenne des 28 derniers jours, avec affûtage −50 % sur les
   7 derniers jours avant la course. */
function simulateFormTo(targetIso) {
  const curve = computeFormeCurve(getAll(), 90);
  if (!curve.length) return null;
  let ctl = curve[curve.length - 1].ctl;
  let atl = curve[curve.length - 1].atl;

  const map = buildTRIMPMap(getAll());
  let sum = 0;
  for (let i = 0; i < 28; i++) {
    const d = new Date(TODAY); d.setDate(d.getDate() - i);
    sum += map[localIso(d)] || 0;
  }
  const dailyLoad = sum / 28;

  const target = new Date(targetIso + 'T12:00:00');
  const days = Math.round((target - startOfDay(TODAY)) / 86400000);
  if (days < 0) return null;

  for (let i = 1; i <= days; i++) {
    const load = (days - i) < 7 ? dailyLoad * 0.5 : dailyLoad; // affûtage
    ctl = ctl + (load - ctl) / 42;
    atl = atl + (load - atl) / 7;
  }
  return { ctl: +ctl.toFixed(1), atl: +atl.toFixed(1), tsb: +(ctl - atl).toFixed(1), days };
}

/* ── Temps prédit pour une distance quelconque (Jack Daniels) ──
   Interpole le % VO2max soutenable selon la distance. */
function predictRaceTime(distKm) {
  const calc = (typeof computeCalculations === 'function') ? computeCalculations() : null;
  const vo2 = calc && calc.effectiveVO2max !== '–' ? parseFloat(calc.effectiveVO2max) : null;
  if (!vo2 || !(distKm > 0)) return null;

  const pts = [[1, 0.999], [3, 0.979], [5, 0.955], [10, 0.922], [21.097, 0.884], [42.195, 0.840]];
  let pct;
  if (distKm <= pts[0][0]) pct = pts[0][1];
  else if (distKm >= pts[pts.length - 1][0]) pct = pts[pts.length - 1][1];
  else {
    for (let i = 0; i < pts.length - 1; i++) {
      const [d1, p1] = pts[i], [d2, p2] = pts[i + 1];
      if (distKm >= d1 && distKm <= d2) { pct = p1 + (p2 - p1) * (distKm - d1) / (d2 - d1); break; }
    }
  }
  const v = vdotToVelocity(vo2, pct);          // m/min
  const timeSec = distKm * 1000 / v * 60;
  return { timeSec, paceSec: timeSec / distKm, vo2 };
}

/* ── Rendu ── */
function renderRunGoal() {
  const el = document.getElementById('run-goal');
  if (!el) return;
  const goal = getRaceGoal();
  if (!goal) {
    el.innerHTML = `
      <div class="card" style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <div style="font-size:13px;color:var(--muted)">🎯 Aucun objectif de course défini</div>
        <button class="btn btn-primary" onclick="showGoalForm()" style="font-size:12px">Définir un objectif</button>
      </div>`;
    return;
  }

  const raceDate = new Date(goal.date + 'T12:00:00');
  const daysLeft = Math.round((startOfDay(raceDate) - startOfDay(TODAY)) / 86400000);
  const dateStr = raceDate.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  if (daysLeft < 0) {
    el.innerHTML = `
      <div class="card" style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <div style="font-size:13px">🏁 <strong>${escapeHTML(goal.name || 'Course')}</strong> — c'était le ${dateStr}. Bravo !</div>
        <div style="display:flex;gap:8px">
          <button class="btn" onclick="showGoalForm()" style="font-size:12px">Nouvel objectif</button>
          <button class="btn btn-ghost" onclick="clearRaceGoal()" style="font-size:12px">Effacer</button>
        </div>
      </div>`;
    return;
  }

  const pred = predictRaceTime(goal.km);
  const proj = simulateFormTo(goal.date);
  const targetSec = parseTimeToSec(goal.target);

  const tsbColor = !proj ? 'var(--muted)'
    : proj.tsb >= 5 && proj.tsb <= 20 ? '#22c55e'
    : proj.tsb > 20 ? '#3b82f6'
    : proj.tsb >= 0 ? '#f97316' : '#ef4444';
  const tsbLabel = !proj ? ''
    : proj.tsb >= 5 && proj.tsb <= 20 ? 'Forme optimale prévue ✓'
    : proj.tsb > 20 ? 'Trop frais — augmenter la charge'
    : proj.tsb >= 0 ? 'Légèrement sous-optimal'
    : 'Fatigue résiduelle prévue — alléger';

  let deltaHtml = '';
  if (targetSec && pred) {
    const diff = pred.timeSec - targetSec;
    const ok = diff <= 0;
    deltaHtml = `<div style="font-size:11px;color:${ok ? '#22c55e' : '#f97316'};margin-top:2px">
      ${ok ? '✓ objectif à portée' : `+${secToTime(Math.abs(diff))} vs objectif`}</div>`;
  }

  const tile = (label, val, sub = '', color = 'var(--text)') => `
    <div style="background:var(--surface2);border-radius:10px;padding:10px 12px;text-align:center">
      <div style="font-size:10px;color:var(--muted);margin-bottom:2px">${label}</div>
      <div style="font-size:16px;font-weight:700;color:${color}">${val}</div>
      ${sub}
    </div>`;

  el.innerHTML = `
    <div class="card" style="border:1.5px solid var(--accent-dim)">
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:12px">
        <div>
          <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em">🎯 Objectif</div>
          <div style="font-size:16px;font-weight:800">${escapeHTML(goal.name || 'Course')} · ${goal.km >= 42 ? 'Marathon' : goal.km >= 21 ? 'Semi' : goal.km + ' km'}</div>
          <div style="font-size:12px;color:var(--muted)">${dateStr}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:28px;font-weight:800;color:var(--accent);line-height:1">J−${daysLeft}</div>
          <div style="font-size:10px;color:var(--muted)">${daysLeft === 0 ? "c'est aujourd'hui !" : `${Math.floor(daysLeft / 7)} sem. ${daysLeft % 7} j`}</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px">
        ${pred ? tile('Temps prédit (VDOT)', secToTime(pred.timeSec), deltaHtml) : ''}
        ${pred ? tile('Allure prédite', secToPace(pred.paceSec) + '/km') : ''}
        ${goal.target ? tile('Objectif visé', escapeHTML(goal.target)) : ''}
        ${proj ? tile('TSB projeté jour J', (proj.tsb > 0 ? '+' : '') + proj.tsb,
          `<div style="font-size:10px;color:${tsbColor};margin-top:2px">${tsbLabel}</div>`, tsbColor) : ''}
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px">
        <div style="font-size:10px;color:var(--muted)">Projection : charge moyenne 28 j poursuivie, affûtage −50 % la dernière semaine</div>
        <div style="display:flex;gap:6px">
          <button class="btn btn-ghost" onclick="showGoalForm()" style="font-size:11px;padding:4px 10px">Modifier</button>
          <button class="btn btn-ghost" onclick="clearRaceGoal()" style="font-size:11px;padding:4px 10px">✕</button>
        </div>
      </div>
    </div>`;
}

function showGoalForm() {
  const el = document.getElementById('run-goal');
  if (!el) return;
  const g = getRaceGoal() || {};
  const minIso = localIso(TODAY);
  el.innerHTML = `
    <div class="card">
      <div style="font-size:13px;font-weight:700;margin-bottom:12px">🎯 Objectif de course</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:12px">
        <div>
          <label style="font-size:10px;color:var(--muted);text-transform:uppercase;display:block;margin-bottom:4px">Nom</label>
          <input id="goal-name" class="settings-input" type="text" placeholder="Marathon de Paris" value="${escapeHTML(g.name || '')}" style="width:100%">
        </div>
        <div>
          <label style="font-size:10px;color:var(--muted);text-transform:uppercase;display:block;margin-bottom:4px">Date</label>
          <input id="goal-date" class="settings-input" type="date" min="${minIso}" value="${g.date || ''}" style="width:100%">
        </div>
        <div>
          <label style="font-size:10px;color:var(--muted);text-transform:uppercase;display:block;margin-bottom:4px">Distance</label>
          <select id="goal-dist" class="settings-input" style="width:100%">
            ${GOAL_PRESETS.map(p => `<option value="${p.km}" ${g.km === p.km ? 'selected' : ''}>${p.label}</option>`).join('')}
            <option value="custom" ${g.km && !GOAL_PRESETS.some(p => p.km === g.km) ? 'selected' : ''}>Autre…</option>
          </select>
          <input id="goal-dist-custom" class="settings-input" type="number" step="0.1" min="1" placeholder="km"
            value="${g.km && !GOAL_PRESETS.some(p => p.km === g.km) ? g.km : ''}"
            style="width:100%;margin-top:4px;display:${g.km && !GOAL_PRESETS.some(p => p.km === g.km) ? 'block' : 'none'}">
        </div>
        <div>
          <label style="font-size:10px;color:var(--muted);text-transform:uppercase;display:block;margin-bottom:4px">Temps visé (optionnel)</label>
          <input id="goal-target" class="settings-input" type="text" placeholder="1:45:00" value="${escapeHTML(g.target || '')}" style="width:100%">
        </div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-primary" onclick="saveRaceGoal()" style="font-size:12px">Enregistrer</button>
        <button class="btn btn-ghost" onclick="renderRunGoal()" style="font-size:12px">Annuler</button>
      </div>
    </div>`;
  document.getElementById('goal-dist').addEventListener('change', (e) => {
    document.getElementById('goal-dist-custom').style.display = e.target.value === 'custom' ? 'block' : 'none';
  });
}

function saveRaceGoal() {
  const name = document.getElementById('goal-name')?.value?.trim() || '';
  const date = document.getElementById('goal-date')?.value;
  const distSel = document.getElementById('goal-dist')?.value;
  const km = distSel === 'custom'
    ? parseFloat(document.getElementById('goal-dist-custom')?.value)
    : parseFloat(distSel);
  const target = document.getElementById('goal-target')?.value?.trim() || '';

  if (!date) { showToast('Choisis une date de course', 'err'); return; }
  if (!(km > 0)) { showToast('Distance invalide', 'err'); return; }
  if (target && parseTimeToSec(target) == null) { showToast('Temps visé invalide (format h:mm:ss)', 'err'); return; }

  localStorage.setItem('race_goal', JSON.stringify({ name, date, km, target }));
  showToast('Objectif enregistré 🎯', 'ok');
  renderRunGoal();
}

function clearRaceGoal() {
  localStorage.removeItem('race_goal');
  renderRunGoal();
}

/* ══════════════════════════════════════════════════════════
   INSIGHTS.JS — Notifications · Records · Corrélations
   ══════════════════════════════════════════════════════════ */

/* ══════════════════════════════════════════════════════════
   NOTIFICATIONS LOCALES
   Conseil du matin + nouveaux records. Activation dans
   Profil → Paramètres (permission navigateur requise).
   ══════════════════════════════════════════════════════════ */
function notificationsEnabled() {
  return localStorage.getItem('notif_enabled') === '1'
    && 'Notification' in window
    && Notification.permission === 'granted';
}

async function toggleNotifications() {
  if (!('Notification' in window)) { showToast('Notifications non supportées par ce navigateur', 'err'); return; }
  if (localStorage.getItem('notif_enabled') === '1') {
    localStorage.setItem('notif_enabled', '0');
    showToast('Notifications désactivées', 'ok');
    updateNotifButton();
    return;
  }
  const perm = await Notification.requestPermission();
  if (perm === 'granted') {
    localStorage.setItem('notif_enabled', '1');
    showToast('Notifications activées', 'ok');
    sendLocalNotification('Notifications activées ✓', 'Tu recevras le conseil du matin et les nouveaux records.');
  } else {
    showToast('Permission refusée — vérifie les réglages du navigateur', 'err');
  }
  updateNotifButton();
}

function updateNotifButton() {
  const btn = document.getElementById('notif-toggle-btn');
  if (!btn) return;
  const on = notificationsEnabled();
  btn.textContent = on ? '🔔 Notifications activées' : '🔕 Activer les notifications';
  btn.classList.toggle('btn-primary', !on);
}

async function sendLocalNotification(title, body) {
  if (!notificationsEnabled()) return;
  const opts = { body, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png' };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg?.showNotification) { reg.showNotification(title, opts); return; }
  } catch {}
  try { new Notification(title, opts); } catch {}
}

/* Conseil du matin — une seule fois par jour, entre 5 h et 12 h */
function maybeMorningNotification() {
  if (!notificationsEnabled()) return;
  if (localStorage.getItem('notif_last_morning') === TODAY_ISO) return;
  const h = new Date().getHours();
  if (h < 5 || h >= 12) return;

  const dr = computeDailyReco();
  const RECO_TXT = {
    rest:     '😴 Repos conseillé aujourd\'hui',
    easy:     '🚶 Séance légère conseillée',
    moderate: '🏃 Entraînement modéré possible',
    hard:     '🔥 Feu vert pour une séance intense',
  };
  const lines = [RECO_TXT[dr.reco] || ''];
  if (dr.reasons[0]) lines.push(dr.reasons[0]);
  sendLocalNotification('☀️ Conseil du matin', lines.join('\n'));
  localStorage.setItem('notif_last_morning', TODAY_ISO);
}

/* ══════════════════════════════════════════════════════════
   DÉTECTION DE RECORDS PERSONNELS
   Snapshot des meilleures allures par tranche de distance,
   comparé après chaque synchro / chargement.
   ══════════════════════════════════════════════════════════ */
const PR_CATEGORIES = [
  { label: '3–5 km',   min: 3,  max: 5 },
  { label: '5–8 km',   min: 5,  max: 8 },
  { label: '8–14 km',  min: 8,  max: 14 },
  { label: '14–22 km', min: 14, max: 22 },
  { label: '22 km+',   min: 22, max: Infinity },
];

function computePRSnapshot() {
  const runs = (typeof getRuns === 'function') ? getRuns() : [];
  const snap = {};
  PR_CATEGORIES.forEach(cat => {
    const bucket = runs.filter(r => r.distance_km >= cat.min && r.distance_km < cat.max && r.pace_min_km);
    if (!bucket.length) return;
    const best = bucket.reduce((b, r) => {
      const s = paceToSec(r.pace_min_km);
      return (s && s < (paceToSec(b.pace_min_km) || 9999)) ? r : b;
    }, bucket[0]);
    snap[cat.label] = { pace: paceToSec(best.pace_min_km), date: best.date, name: best.name || '' };
  });
  return snap;
}

function checkNewPRs() {
  let old = null;
  try { old = JSON.parse(localStorage.getItem('pr_snapshot') || 'null'); } catch {}
  const cur = computePRSnapshot();
  if (!Object.keys(cur).length) return [];
  localStorage.setItem('pr_snapshot', JSON.stringify(cur));
  if (!old) return []; // premier passage : on mémorise sans célébrer

  const news = [];
  Object.entries(cur).forEach(([label, rec]) => {
    const prev = old[label];
    /* Record battu = meilleure allure ET run plus récent que l'ancien
       (évite de célébrer un vieux run lors d'un rechargement d'historique) */
    if (prev && rec.pace < prev.pace && rec.date > prev.date) news.push({ label, rec, prev });
  });

  news.forEach(n => showToast(`🎉 Nouveau record ${n.label} : ${secToPace(n.rec.pace)}/km !`, 'ok'));
  if (news.length) {
    sendLocalNotification('🎉 Nouveau record personnel !',
      news.map(n => `${n.label} : ${secToPace(n.rec.pace)}/km (avant : ${secToPace(n.prev.pace)}/km)`).join('\n'));
  }
  return news;
}

/* ══════════════════════════════════════════════════════════
   CORRÉLATIONS BIEN-ÊTRE → PERFORMANCE
   1. Sommeil de la veille → efficience du run (vitesse ÷ FC)
   2. Charge (TRIMP) de la veille → HRV du lendemain
   ══════════════════════════════════════════════════════════ */
function pearsonR(pairs) {
  const n = pairs.length;
  if (n < 5) return null;
  const mx = pairs.reduce((s, p) => s + p.x, 0) / n;
  const my = pairs.reduce((s, p) => s + p.y, 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  pairs.forEach(p => {
    const dx = p.x - mx, dy = p.y - my;
    num += dx * dy; dx2 += dx * dx; dy2 += dy * dy;
  });
  const den = Math.sqrt(dx2 * dy2);
  return den > 0 ? +(num / den).toFixed(2) : null;
}

function describeR(r, posLabel, negLabel) {
  if (r == null) return 'Pas assez de données (minimum 5 points).';
  const a = Math.abs(r);
  const strength = a < 0.2 ? 'négligeable' : a < 0.4 ? 'faible' : a < 0.6 ? 'modérée' : 'forte';
  const dir = r > 0 ? posLabel : negLabel;
  return `r = ${r} — corrélation ${strength}${a >= 0.2 ? ` : ${dir}` : ''}`;
}

function collectSleepPerfPairs() {
  const wdays = state.wellness?.days || {};
  const pairs = [];
  const runs = (typeof getRuns === 'function') ? getRuns() : [];
  runs.forEach(r => {
    if (!r.hr_avg) return;
    const speed = r.speed_kmh || (r.pace_min_km && paceToSec(r.pace_min_km) ? 3600 / paceToSec(r.pace_min_km) : null);
    if (!speed) return;
    const day = wdays[r.date]; // sommeil enregistré le matin du run = nuit précédente
    const sleep = day?.sleep_duration_h ?? (day?.sleep_total_min ? day.sleep_total_min / 60 : null);
    if (sleep == null || sleep <= 0) return;
    pairs.push({ x: +sleep.toFixed(2), y: +(speed / r.hr_avg * 100).toFixed(2) });
  });
  return pairs;
}

function collectLoadHrvPairs() {
  const wdays = state.wellness?.days || {};
  const map = buildTRIMPMap(getAll());
  const pairs = [];
  Object.values(wdays).forEach(d => {
    const hrv = d.hrv_rmssd || d.hrv_overnight_avg || null;
    if (!d.date || !hrv) return;
    const prev = new Date(d.date + 'T12:00:00');
    prev.setDate(prev.getDate() - 1);
    const load = map[localIso(prev)] || 0;
    pairs.push({ x: load, y: hrv });
  });
  return pairs;
}

function _scatterChart(canvasId, pairs, xLabel, yLabel, color) {
  mkChart(canvasId, {
    type: 'scatter',
    data: { datasets: [{ data: pairs, backgroundColor: color + 'aa', pointRadius: 4, pointHoverRadius: 6 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { title: { display: true, text: xLabel, font: { size: 10 } } },
        y: { title: { display: true, text: yLabel, font: { size: 10 } } },
      },
    },
  });
}

function renderCorrelations() {
  const sleepTxt = document.getElementById('corr-sleep-txt');
  const loadTxt  = document.getElementById('corr-load-txt');
  if (!sleepTxt && !loadTxt) return;

  const sleepPairs = collectSleepPerfPairs();
  if (sleepTxt) {
    const r = pearsonR(sleepPairs);
    sleepTxt.textContent = sleepPairs.length < 5
      ? `Pas assez de données (${sleepPairs.length} runs avec sommeil connu, minimum 5).`
      : `${sleepPairs.length} runs · ` + describeR(r, 'mieux dormir précède de meilleurs runs', 'relation inverse — autre facteur en jeu');
    if (sleepPairs.length >= 5) _scatterChart('chart-corr-sleep', sleepPairs, 'Sommeil la veille (h)', 'Efficience (vitesse ÷ FC × 100)', '#6366f1');
  }

  const loadPairs = collectLoadHrvPairs();
  if (loadTxt) {
    const r = pearsonR(loadPairs);
    loadTxt.textContent = loadPairs.length < 5
      ? `Pas assez de données (${loadPairs.length} jours avec HRV, minimum 5).`
      : `${loadPairs.length} jours · ` + describeR(r, 'la charge élève ta HRV (bonne adaptation)', 'une grosse charge fait chuter ta HRV le lendemain');
    if (loadPairs.length >= 5) _scatterChart('chart-corr-load', loadPairs, 'TRIMP de la veille', 'HRV (ms)', '#f97316');
  }
}

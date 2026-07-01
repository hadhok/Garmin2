/* ══════════════════════════════════════════════════════════
   RUNALYZE API INTEGRATION
   ══════════════════════════════════════════════════════════ */

let runalyzeData = null;

async function testRunalyzeAPI() {
  const token = document.getElementById('rz-token')?.value;
  if (!token) {
    alert('Veuillez entrer votre token API Runalyze');
    return;
  }

  const statusEl = document.getElementById('rz-status');
  const dataEl = document.getElementById('rz-data');

  statusEl.style.display = 'block';
  statusEl.textContent = '⏳ Connexion à Runalyze...';
  statusEl.style.background = 'rgba(59,130,246,0.12)';
  statusEl.style.color = '#1e40af';

  try {
    // Test 1: Athlete
    const athleteResp = await fetch('https://runalyze.com/api/v2/athlete', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });

    if (!athleteResp.ok) throw new Error(`Athlete: ${athleteResp.status} ${athleteResp.statusText}`);
    const athlete = await athleteResp.json();

    // Test 2: Activities
    const activitiesResp = await fetch('https://runalyze.com/api/v2/activities?limit=10', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });

    let activities = [];
    if (activitiesResp.ok) {
      activities = await activitiesResp.json();
    }

    runalyzeData = { athlete, activities };

    // Afficher les données
    dataEl.innerHTML = `<pre>${JSON.stringify(runalyzeData, null, 2)}</pre>`;

    statusEl.textContent = `✓ Connecté ! Athlète: ${athlete.firstname || 'N/A'} ${athlete.lastname || 'N/A'}`;
    statusEl.style.background = 'rgba(34,197,94,0.12)';
    statusEl.style.color = '#16a34a';

    renderRunalyzeSelector();

  } catch (err) {
    console.error('Runalyze API error:', err);
    dataEl.innerHTML = `<div style="color:#ef4444">❌ Erreur: ${err.message}</div>`;
    statusEl.textContent = `❌ Erreur: ${err.message}`;
    statusEl.style.background = 'rgba(239,68,68,0.12)';
    statusEl.style.color = '#dc2626';
  }
}

function renderRunalyzeSelector() {
  if (!runalyzeData) return;

  const selector = document.getElementById('rz-selector');
  const athlete = runalyzeData.athlete || {};

  const options = [
    { key: 'use_vo2max', label: 'VO2max effectif', value: athlete.maximalOxygenUptake || 'N/A' },
    { key: 'use_ctl', label: 'Fitness (CTL)', value: athlete.ctl || 'N/A' },
    { key: 'use_atl', label: 'Fatigue (ATL)', value: athlete.atl || 'N/A' },
    { key: 'use_tsb', label: 'Stress Balance (TSB)', value: athlete.tsb || 'N/A' },
  ];

  selector.innerHTML = options.map(opt => `
    <label style="display:flex;align-items:center;gap:8px;padding:8px;cursor:pointer;border:1px solid var(--border);border-radius:4px">
      <input type="checkbox" id="rz-${opt.key}" checked style="cursor:pointer">
      <span style="flex:1">
        <strong>${opt.label}</strong>
        <span style="font-size:11px;color:var(--muted);display:block">${opt.value}</span>
      </span>
    </label>
  `).join('');
}

async function saveRunalyzeToken() {
  const token = document.getElementById('rz-token')?.value;
  if (!token) {
    alert('Veuillez entrer votre token');
    return;
  }

  // TODO: Sauvegarder dans Supabase
  localStorage.setItem('runalyze_token', token);

  const statusEl = document.getElementById('rz-status');
  statusEl.textContent = '✓ Token enregistré';
  statusEl.style.display = 'block';
  statusEl.style.background = 'rgba(34,197,94,0.12)';
  statusEl.style.color = '#16a34a';
  setTimeout(() => statusEl.style.display = 'none', 3000);
}

function initRunalyzeInputs() {
  const tokenEl = document.getElementById('rz-token');
  if (tokenEl) tokenEl.value = localStorage.getItem('runalyze_token') || '';
}

// Appel au switch vers runalyze
function onSwitchToRunalyze() {
  initRunalyzeInputs();
}

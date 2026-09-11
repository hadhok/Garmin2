/* ══════════════════════════════════════════════════════════
   LIVE_HR.JS — FC en direct pendant l'entraînement (Web Bluetooth)
   Connexion directe navigateur ↔ montre (mode "Diffuser la FC"),
   sans passer par Garmin Connect. Chromium uniquement (Chrome/Edge
   Android, desktop) — Web Bluetooth n'existe pas sur Safari/iOS.
   ══════════════════════════════════════════════════════════ */

const _liveHR = {
  device: null,
  characteristic: null,
  connected: false,
  readings: [],       // { t: ms epoch, bpm }
  sessionStart: null,
  wakeLock: null,
  chart: null,
};

function _liveHRSupported() {
  return !!(navigator.bluetooth && navigator.bluetooth.requestDevice);
}

function renderLiveHR() {
  const unsupported = document.getElementById('live-hr-unsupported');
  const connectWrap = document.getElementById('live-hr-connect-wrap');
  if (!unsupported || !connectWrap) return;

  if (!_liveHRSupported()) {
    unsupported.style.display = '';
    connectWrap.style.display = 'none';
    document.getElementById('live-hr-panel').style.display = 'none';
    return;
  }
  unsupported.style.display = 'none';
  _updateLiveHRUI();
}

async function connectLiveHR() {
  const statusEl = document.getElementById('live-hr-status');
  const btn = document.getElementById('live-hr-connect-btn');
  if (statusEl) statusEl.textContent = 'Recherche du capteur…';
  if (btn) btn.disabled = true;

  try {
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: ['heart_rate'] }],
    });
    _liveHR.device = device;
    device.addEventListener('gattserverdisconnected', _onLiveHRDisconnected);

    if (statusEl) statusEl.textContent = `Connexion à ${device.name || 'la montre'}…`;
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService('heart_rate');
    const characteristic = await service.getCharacteristic('heart_rate_measurement');
    await characteristic.startNotifications();
    characteristic.addEventListener('characteristicvaluechanged', _onHeartRateChanged);

    _liveHR.characteristic = characteristic;
    _liveHR.connected = true;
    _liveHR.sessionStart = Date.now();
    _liveHR.readings = [];

    /* Empêche l'écran de s'éteindre pendant qu'on regarde sa FC (best
       effort — pas supporté partout, sans impact si ça échoue). */
    try { _liveHR.wakeLock = await navigator.wakeLock?.request('screen'); } catch {}

    if (statusEl) statusEl.textContent = '';
    _updateLiveHRUI();
    if (typeof showToast === 'function') showToast(`Connecté à ${device.name || 'la montre'} ✓`, 'ok');
  } catch (e) {
    if (statusEl) statusEl.textContent = e.name === 'NotFoundError' ? '' : `Échec : ${e.message}`;
  } finally {
    if (btn) btn.disabled = false;
  }
}

function disconnectLiveHR() {
  if (_liveHR.device?.gatt?.connected) _liveHR.device.gatt.disconnect();
  else _onLiveHRDisconnected();
}

function _onLiveHRDisconnected() {
  _liveHR.connected = false;
  try { _liveHR.wakeLock?.release(); } catch {}
  _liveHR.wakeLock = null;
  _updateLiveHRUI();
}

/* Format Bluetooth GATT "Heart Rate Measurement" (spec 0x2A37) :
   byte 0 = flags (bit0 : 0 = FC sur 8 bits, 1 = FC sur 16 bits) */
function _onHeartRateChanged(event) {
  const value = event.target.value;
  const flags = value.getUint8(0);
  const is16bit = flags & 0x1;
  const bpm = is16bit ? value.getUint16(1, true) : value.getUint8(1);
  _liveHR.readings.push({ t: Date.now(), bpm });
  if (_liveHR.readings.length > 600) _liveHR.readings.shift(); // ~10-20 min de buffer
  _renderLiveHRReading(bpm);
}

function _hrZoneFor(bpm) {
  if (typeof HR_ZONES === 'undefined' || !HR_MAX) return null;
  const pct = bpm / HR_MAX;
  for (let i = HR_ZONES.length - 1; i >= 0; i--) {
    if (pct >= HR_ZONES[i].pctMin) return HR_ZONES[i];
  }
  return HR_ZONES[0];
}

function _renderLiveHRReading(bpm) {
  const bpmEl = document.getElementById('live-hr-bpm');
  if (bpmEl) bpmEl.textContent = bpm;

  const zone = _hrZoneFor(bpm);
  const zoneEl = document.getElementById('live-hr-zone');
  if (zoneEl) {
    if (zone) {
      zoneEl.textContent = zone.label;
      zoneEl.style.background = zone.color + '22';
      zoneEl.style.color = zone.color;
      zoneEl.style.display = '';
    } else {
      zoneEl.style.display = 'none';
    }
  }

  const readings = _liveHR.readings;
  const bpms = readings.map(r => r.bpm);
  const statsEl = document.getElementById('live-hr-stats');
  if (statsEl && bpms.length) {
    const min = Math.min(...bpms), max = Math.max(...bpms);
    const avg = Math.round(bpms.reduce((s, v) => s + v, 0) / bpms.length);
    statsEl.innerHTML = `
      <div class="live-hr-stat"><div class="live-hr-stat-label">Min</div><div class="live-hr-stat-value">${min}</div></div>
      <div class="live-hr-stat"><div class="live-hr-stat-label">Moy.</div><div class="live-hr-stat-value">${avg}</div></div>
      <div class="live-hr-stat"><div class="live-hr-stat-label">Max</div><div class="live-hr-stat-value">${max}</div></div>`;
  }

  _tickLiveHRElapsed();
  _renderLiveHRChart();
}

function _tickLiveHRElapsed() {
  const el = document.getElementById('live-hr-elapsed');
  if (!el || !_liveHR.sessionStart) return;
  const s = Math.floor((Date.now() - _liveHR.sessionStart) / 1000);
  const m = Math.floor(s / 60);
  el.textContent = `${m}:${String(s % 60).padStart(2, '0')}`;
}

function _renderLiveHRChart() {
  if (typeof mkChart !== 'function') return;
  const canvas = document.getElementById('live-hr-chart');
  if (!canvas) return;
  const readings = _liveHR.readings.slice(-120); // ~2 dernières minutes à 1 Hz
  const labels = readings.map(r => '');
  const data = readings.map(r => r.bpm);

  mkChart('live-hr-chart', {
    type: 'line',
    data: { labels, datasets: [{
      data, borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.1)',
      fill: true, tension: 0.3, pointRadius: 0, borderWidth: 2,
    }] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { display: false },
        y: { suggestedMin: (HR_REST || 50) - 10, ticks: { font: { size: 10 } } },
      },
    },
  });
}

function _updateLiveHRUI() {
  const connectWrap = document.getElementById('live-hr-connect-wrap');
  const panel = document.getElementById('live-hr-panel');
  if (!connectWrap || !panel) return;
  connectWrap.style.display = _liveHR.connected ? 'none' : '';
  panel.style.display = _liveHR.connected ? '' : 'none';
  if (!_liveHR.connected) {
    const bpmEl = document.getElementById('live-hr-bpm');
    if (bpmEl) bpmEl.textContent = '–';
  }
}

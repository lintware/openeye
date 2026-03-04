// ─── Config ───────────────────────────────────────────────────────
const OPENSKY_URL = 'https://opensky-network.org/api/states/all';
const CELESTRAK_URL = 'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle';
const AIRCRAFT_REFRESH_MS = 10000;

// ─── State ────────────────────────────────────────────────────────
let viewer;
let aircraftEntities = new Map();
let satelliteEntities = new Map();
let satellites = [];          // parsed TLE records
let aircraftData = [];        // latest OpenSky states
let timeMultiplier = 1;
let layerAircraft = true;
let layerSatellites = true;
let simClock = { base: Date.now(), real: Date.now() };
let aircraftTrails = new Map();  // icao -> array of {lon, lat, alt}

// Generate arrow canvas for aircraft icon
function createArrowCanvas() {
  const c = document.createElement('canvas');
  c.width = 32; c.height = 32;
  const ctx = c.getContext('2d');
  ctx.translate(16, 16);
  // Arrow pointing UP (north=0°), rotation applied by Cesium
  ctx.beginPath();
  ctx.moveTo(0, -14);    // nose
  ctx.lineTo(6, 6);      // right wing
  ctx.lineTo(0, 2);      // center notch
  ctx.lineTo(-6, 6);     // left wing
  ctx.closePath();
  ctx.fillStyle = '#ff9800';
  ctx.fill();
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1;
  ctx.stroke();
  return c;
}
// Military callsign prefixes (common patterns)
const MILITARY_PREFIXES = [
  'RCH','EVAC','NAVY','ARMY','DUKE','RAGE','VIPER','HAWK','COBRA','KNIFE',
  'TREK','DOOM','IRON','BOLT','SLAM','TOPG','WAR','BAF','GAF','FAF','RAF',
  'IAF','PAF','TAF','RRR','CNV','CFC','MMF','AERO','SPAR','SAM','VENUS',
  'MARS','NCHO','PHTM','GRIM','BANDIT','STEEL','ORCA','TITAN','REAPER',
];

function classifyAircraft(callsign, category) {
  const cs = (callsign || '').toUpperCase().trim();
  // Military: known prefixes or category 7 (high performance)
  if (category === 7) return 'military';
  for (const pfx of MILITARY_PREFIXES) {
    if (cs.startsWith(pfx)) return 'military';
  }
  // Commercial: large/heavy aircraft (category 4,5,6)
  if (category >= 4 && category <= 6) return 'commercial';
  // Private: light/small (category 2,3)
  if (category === 2 || category === 3) return 'private';
  // Rotorcraft, UAV, etc
  if (category === 8) return 'private';   // helicopter → private
  if (category === 13) return 'military'; // UAV → military
  return 'unknown';
}

const AIRCRAFT_COLORS = {
  commercial: { css: '#4caf50', cesium: Cesium.Color.fromCssColorString('#4caf50') },  // green
  private:    { css: '#ffd740', cesium: Cesium.Color.fromCssColorString('#ffd740') },  // amber/yellow
  military:   { css: '#f44336', cesium: Cesium.Color.fromCssColorString('#f44336') },  // red
  unknown:    { css: '#ff9800', cesium: Cesium.Color.fromCssColorString('#ff9800') },  // orange
};

function createArrowCanvasColored(color) {
  const c = document.createElement('canvas');
  c.width = 32; c.height = 32;
  const ctx = c.getContext('2d');
  ctx.translate(16, 16);
  ctx.beginPath();
  ctx.moveTo(0, -14);
  ctx.lineTo(6, 6);
  ctx.lineTo(0, 2);
  ctx.lineTo(-6, 6);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1;
  ctx.stroke();
  return c.toDataURL();
}

const arrowImages = {};
for (const [type, col] of Object.entries(AIRCRAFT_COLORS)) {
  arrowImages[type] = createArrowCanvasColored(col.css);
}

// ─── Cesium Init ──────────────────────────────────────────────────
function initCesium() {
  try {
    // No Ion token needed
    Cesium.Ion.defaultAccessToken = undefined;

    viewer = new Cesium.Viewer('cesiumContainer', {
      baseLayer: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      animation: false,
      timeline: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      creditContainer: document.createElement('div'),
      scene3DOnly: true,
      shadows: false,
    });

    // Add OSM tiles as base layer
    viewer.imageryLayers.addImageryProvider(
      new Cesium.UrlTemplateImageryProvider({
        url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        minimumLevel: 0,
        maximumLevel: 19,
        credit: 'OpenStreetMap',
      })
    );
  } catch (e) {
    console.error('Cesium init failed:', e);
    document.getElementById('loadingOverlay').innerHTML =
      '<div style="color:red;padding:2em;">Failed to load globe: ' + e.message + '</div>';
    return;
  }

  viewer.scene.globe.enableLighting = true;
  viewer.scene.highDynamicRange = false;

  // Dark background for space
  viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#0a0a0f');

  // Click handler
  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  handler.setInputAction(onClick, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  hideLoading();
}

// ─── Simulated Clock ──────────────────────────────────────────────
function getSimTime() {
  const elapsed = Date.now() - simClock.real;
  return new Date(simClock.base + elapsed * timeMultiplier);
}

function setTimeMultiplier(mult) {
  // Anchor so there's no jump
  simClock.base = getSimTime().getTime();
  simClock.real = Date.now();
  timeMultiplier = mult;

  document.querySelectorAll('.time-btn').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.speed) === mult);
  });
  updateStats();
}

// ─── Aircraft (OpenSky) ──────────────────────────────────────────
async function fetchAircraft() {
  try {
    const res = await fetch(OPENSKY_URL);
    if (!res.ok) throw new Error(`OpenSky ${res.status}`);
    const data = await res.json();
    aircraftData = (data.states || []).filter(s => s[5] != null && s[6] != null);
    if (layerAircraft) renderAircraft();
    updateStats();
  } catch (e) {
    console.warn('OpenSky fetch failed:', e.message);
  }
}

function renderAircraft() {
  const seen = new Set();

  for (const s of aircraftData) {
    const icao = s[0];
    const callsign = (s[1] || '').trim() || icao;
    const lon = s[5];
    const lat = s[6];
    const alt = s[7] || s[13] || 0;       // baro_altitude or geo_altitude
    const velocity = s[9] || 0;            // m/s
    const heading = s[10] || 0;
    const vertRate = s[11] || 0;
    const origin = s[2] || '??';
    const category = s[17] || 0;

    seen.add(icao);

    const acType = classifyAircraft(callsign, category);
    const acColor = AIRCRAFT_COLORS[acType];
    const position = Cesium.Cartesian3.fromDegrees(lon, lat, alt);

    // Track trail positions (keep last 8 points)
    if (!aircraftTrails.has(icao)) aircraftTrails.set(icao, []);
    const trail = aircraftTrails.get(icao);
    trail.push({ lon, lat, alt });
    if (trail.length > 8) trail.shift();

    const headingRad = Cesium.Math.toRadians(heading);

    if (aircraftEntities.has(icao)) {
      const entity = aircraftEntities.get(icao);
      entity.position = position;
      entity.billboard.show = true;
      entity.billboard.rotation = -headingRad;
      entity.billboard.image = arrowImages[acType];
      entity.label.text = callsign;
      entity.label.fillColor = acColor.cesium;
      entity._wvData = { callsign, alt, velocity, heading, vertRate, origin, lat, lon, type: acType };
      // Update trail
      if (trail.length >= 2) {
        const trailCoords = [];
        for (const p of trail) trailCoords.push(p.lon, p.lat, p.alt);
        entity.polyline.positions = Cesium.Cartesian3.fromDegreesArrayHeights(trailCoords);
        entity.polyline.show = true;
      }
    } else {
      const trailCoords = [];
      for (const p of trail) trailCoords.push(p.lon, p.lat, p.alt);

      const entity = viewer.entities.add({
        position,
        billboard: {
          image: arrowImages[acType],
          width: 20,
          height: 20,
          rotation: -headingRad,
          alignedAxis: Cesium.Cartesian3.UNIT_Z,
          scaleByDistance: new Cesium.NearFarScalar(1e4, 1.5, 8e6, 0.4),
          show: true,
        },
        polyline: {
          positions: Cesium.Cartesian3.fromDegreesArrayHeights(trailCoords),
          width: 2,
          material: new Cesium.PolylineGlowMaterialProperty({
            glowPower: 0.15,
            color: acColor.cesium.withAlpha(0.5),
          }),
          show: trail.length >= 2,
        },
        label: {
          text: callsign,
          font: '11px sans-serif',
          fillColor: acColor.cesium,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(8, -4),
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 1.5e6),
          scaleByDistance: new Cesium.NearFarScalar(1e4, 1.0, 1.5e6, 0.5),
        },
      });
      entity._wvType = 'aircraft';
      entity._wvId = icao;
      entity._wvData = { callsign, alt, velocity, heading, vertRate, origin, lat, lon, type: acType };
      aircraftEntities.set(icao, entity);
    }
  }

  // Remove stale
  for (const [icao, entity] of aircraftEntities) {
    if (!seen.has(icao)) {
      viewer.entities.remove(entity);
      aircraftEntities.delete(icao);
      aircraftTrails.delete(icao);
    }
  }
}

function hideAircraft() {
  for (const entity of aircraftEntities.values()) {
    entity.billboard.show = false;
    if (entity.polyline) entity.polyline.show = false;
  }
}

// ─── Satellites (CelesTrak + satellite.js) ────────────────────────
async function fetchTLEs() {
  try {
    const res = await fetch(CELESTRAK_URL);
    if (!res.ok) throw new Error(`CelesTrak ${res.status}`);
    const text = await res.text();
    satellites = parseTLEs(text);
    console.log(`Loaded ${satellites.length} satellites`);
    if (layerSatellites) renderSatellites();
    updateStats();
  } catch (e) {
    console.warn('TLE fetch failed:', e.message);
  }
}

function parseTLEs(raw) {
  const lines = raw.trim().split('\n').map(l => l.trim());
  const records = [];
  for (let i = 0; i + 2 < lines.length; i += 3) {
    if (!lines[i + 1].startsWith('1 ') || !lines[i + 2].startsWith('2 ')) continue;
    try {
      const satrec = satellite.twoline2satrec(lines[i + 1], lines[i + 2]);
      records.push({ name: lines[i], satrec, tle1: lines[i + 1], tle2: lines[i + 2] });
    } catch (_) { /* skip bad TLEs */ }
  }
  return records;
}

function propagateSat(sat, time) {
  const posVel = satellite.propagate(sat.satrec, time);
  if (!posVel.position) return null;
  const gmst = satellite.gstime(time);
  const geo = satellite.eciToGeodetic(posVel.position, gmst);
  return {
    lat: satellite.degreesLat(geo.latitude),
    lon: satellite.degreesLong(geo.longitude),
    alt: geo.height * 1000, // km to m
    velocity: posVel.velocity
      ? Math.sqrt(posVel.velocity.x ** 2 + posVel.velocity.y ** 2 + posVel.velocity.z ** 2)
      : 0,
  };
}

function renderSatellites() {
  const now = getSimTime();
  const seen = new Set();

  for (const sat of satellites) {
    const pos = propagateSat(sat, now);
    if (!pos) continue;

    const id = sat.name;
    seen.add(id);

    const cartesian = Cesium.Cartesian3.fromDegrees(pos.lon, pos.lat, pos.alt);

    // Extract orbit info from TLE line 2
    const parts2 = sat.tle2.split(/\s+/);
    const inclination = parseFloat(parts2[2]) || 0;
    const period = parts2[7] ? (1440 / parseFloat(parts2[7])).toFixed(1) : '?';

    if (satelliteEntities.has(id)) {
      const entity = satelliteEntities.get(id);
      entity.position = cartesian;
      entity.point.show = true;
      entity._wvData = {
        name: sat.name,
        lat: pos.lat.toFixed(2),
        lon: pos.lon.toFixed(2),
        altKm: (pos.alt / 1000).toFixed(1),
        velocity: pos.velocity.toFixed(2),
        inclination: inclination.toFixed(1),
        period,
      };
    } else {
      const entity = viewer.entities.add({
        position: cartesian,
        point: {
          pixelSize: 3,
          color: Cesium.Color.fromCssColorString('#4fc3f7'),
          scaleByDistance: new Cesium.NearFarScalar(1e5, 2, 2e7, 0.3),
          show: true,
        },
        label: {
          text: sat.name,
          font: '10px sans-serif',
          fillColor: Cesium.Color.fromCssColorString('#4fc3f7'),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(8, -4),
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 5e6),
          scaleByDistance: new Cesium.NearFarScalar(1e5, 1.0, 5e6, 0.3),
        },
      });
      entity._wvType = 'satellite';
      entity._wvId = id;
      entity._wvData = {
        name: sat.name,
        lat: pos.lat.toFixed(2),
        lon: pos.lon.toFixed(2),
        altKm: (pos.alt / 1000).toFixed(1),
        velocity: pos.velocity.toFixed(2),
        inclination: inclination.toFixed(1),
        period,
      };
      satelliteEntities.set(id, entity);
    }
  }

  // Remove stale (shouldn't happen unless TLE list changes)
  for (const [id, entity] of satelliteEntities) {
    if (!seen.has(id)) {
      viewer.entities.remove(entity);
      satelliteEntities.delete(id);
    }
  }
}

function hideSatellites() {
  for (const entity of satelliteEntities.values()) {
    entity.point.show = false;
  }
}

// ─── Click / Detail Panel ─────────────────────────────────────────
function onClick(event) {
  const picked = viewer.scene.pick(event.position);
  if (!Cesium.defined(picked) || !picked.id || !picked.id._wvType) {
    closePanel();
    return;
  }
  showDetail(picked.id);
}

function showDetail(entity) {
  const panel = document.getElementById('detailPanel');
  const type = entity._wvType;
  const data = entity._wvData;

  let html = '<div class="panel-header">';

  if (type === 'aircraft') {
    html += `<div><div class="panel-title">${esc(data.callsign)}</div></div>`;
    const typeLabel = (data.type || 'unknown').charAt(0).toUpperCase() + (data.type || 'unknown').slice(1);
    html += `<span class="panel-type aircraft" style="background:${AIRCRAFT_COLORS[data.type || 'unknown'].css}22;color:${AIRCRAFT_COLORS[data.type || 'unknown'].css}">${typeLabel}</span>`;
    html += `<button class="close-btn" onclick="closePanel()">&times;</button></div>`;
    html += '<div class="detail-rows">';
    html += row('Altitude', `${Math.round(data.alt)} m (${(data.alt * 3.28084).toFixed(0)} ft)`);
    html += row('Speed', `${(data.velocity * 1.94384).toFixed(0)} kts (${(data.velocity * 3.6).toFixed(0)} km/h)`);
    html += row('Heading', `${data.heading.toFixed(0)}°`);
    html += row('Vert Rate', `${data.vertRate.toFixed(1)} m/s`);
    html += row('Origin', data.origin);
    html += row('Position', `${data.lat.toFixed(3)}°, ${data.lon.toFixed(3)}°`);
    html += '</div>';
  } else {
    html += `<div><div class="panel-title">${esc(data.name)}</div></div>`;
    html += `<span class="panel-type satellite">Satellite</span>`;
    html += `<button class="close-btn" onclick="closePanel()">&times;</button></div>`;
    html += '<div class="detail-rows">';
    html += row('Altitude', `${data.altKm} km`);
    html += row('Velocity', `${data.velocity} km/s`);
    html += row('Inclination', `${data.inclination}°`);
    html += row('Period', `${data.period} min`);
    html += row('Lat / Lon', `${data.lat}° / ${data.lon}°`);
    html += '</div>';
  }

  panel.innerHTML = html;
  panel.classList.add('show');
}

function closePanel() {
  document.getElementById('detailPanel').classList.remove('show');
}

function row(label, value) {
  return `<div class="detail-row"><span class="label">${label}</span><span class="value">${value}</span></div>`;
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// ─── Search ───────────────────────────────────────────────────────
function initSearch() {
  const input = document.getElementById('searchBox');
  const results = document.getElementById('searchResults');

  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    if (q.length < 2) { results.classList.remove('show'); return; }

    let items = [];

    // Search aircraft
    for (const [icao, entity] of aircraftEntities) {
      const d = entity._wvData;
      if (d.callsign.toLowerCase().includes(q) || icao.toLowerCase().includes(q)) {
        items.push({ name: d.callsign, detail: `Aircraft · ${d.origin}`, entity });
      }
      if (items.length >= 20) break;
    }

    // Search satellites
    for (const [id, entity] of satelliteEntities) {
      if (id.toLowerCase().includes(q)) {
        items.push({ name: id, detail: `Satellite · ${entity._wvData.altKm} km`, entity });
      }
      if (items.length >= 20) break;
    }

    if (items.length === 0) {
      results.classList.remove('show');
      return;
    }

    results.innerHTML = items.map((item, i) =>
      `<div class="search-item" data-idx="${i}">
        <div class="item-name">${esc(item.name)}</div>
        <div class="item-detail">${item.detail}</div>
      </div>`
    ).join('');

    results.classList.add('show');

    // Attach click handlers
    results.querySelectorAll('.search-item').forEach((el, i) => {
      el.addEventListener('click', () => {
        const entity = items[i].entity;
        viewer.camera.flyTo({
          destination: entity.position.getValue ? entity.position.getValue(Cesium.JulianDate.now()) : entity.position,
          offset: new Cesium.HeadingPitchRange(0, -Math.PI / 4, 500000),
        });
        showDetail(entity);
        results.classList.remove('show');
        input.value = '';
      });
    });
  });

  // Close on outside click
  document.addEventListener('click', (e) => {
    if (!results.contains(e.target) && e.target !== input) {
      results.classList.remove('show');
    }
  });
}

// ─── Layer Toggles ────────────────────────────────────────────────
function toggleAircraft() {
  layerAircraft = !layerAircraft;
  document.getElementById('btnAircraft').classList.toggle('active', layerAircraft);
  if (layerAircraft) renderAircraft();
  else hideAircraft();
}

function toggleSatellites() {
  layerSatellites = !layerSatellites;
  document.getElementById('btnSatellites').classList.toggle('active', layerSatellites);
  if (layerSatellites) renderSatellites();
  else hideSatellites();
}

// ─── Stats Bar ────────────────────────────────────────────────────
function updateStats() {
  const ac = document.getElementById('statAircraft');
  const sat = document.getElementById('statSatellites');
  const tm = document.getElementById('statTime');
  if (ac) ac.textContent = aircraftData.length.toLocaleString();
  if (sat) sat.textContent = satellites.length.toLocaleString();
  if (tm) tm.textContent = `${timeMultiplier}x`;
}

// ─── Loading ──────────────────────────────────────────────────────
function hideLoading() {
  setTimeout(() => {
    document.getElementById('loadingOverlay').classList.add('hidden');
  }, 800);
}

// ─── Update Loop ──────────────────────────────────────────────────
let lastSatRender = 0;
function updateLoop() {
  const now = performance.now();
  // Update satellite positions based on sim time (throttled to every 1s real time)
  if (layerSatellites && satellites.length > 0 && now - lastSatRender > 1000) {
    renderSatellites();
    lastSatRender = now;
  }

  // Update sim clock display
  const simTime = getSimTime();
  const clockEl = document.getElementById('simClock');
  if (clockEl) {
    clockEl.textContent = simTime.toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
  }

  requestAnimationFrame(updateLoop);
}

// ─── Boot ─────────────────────────────────────────────────────────
window.addEventListener('load', async () => {
  initCesium();
  initSearch();

  // Start data fetches
  fetchAircraft();
  fetchTLEs();

  // Auto-refresh aircraft
  setInterval(fetchAircraft, AIRCRAFT_REFRESH_MS);

  // Set initial time button
  setTimeMultiplier(1);

  // Start render loop
  requestAnimationFrame(updateLoop);
});

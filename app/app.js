import * as THREE from 'three';

/* ════════════════════════════════════════════════════════════════
   GALACTICIO — orbital watch
   Scene unit = 1 Earth radius (6371 km). Scene frame = Earth-centred
   inertial (TEME / of-date), mapped to three.js as  (x, z, -y)  so the
   celestial north pole is +Y.
   ════════════════════════════════════════════════════════════════ */
const RE = 6371.0, MU = 398600.4418, DEG = Math.PI / 180, AU = 149597870.7, LD = 384400;
const $ = (id) => document.getElementById(id);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const fmt = (n, d = 0) => Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const pad2 = (n) => String(n).padStart(2, '0');
// Settings saved before the rename to Galacticio move over once.
try { for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k && k.startsWith('asterio.')) { const n = 'galacticio.' + k.slice(8); if (localStorage.getItem(n) == null) localStorage.setItem(n, localStorage.getItem(k)); localStorage.removeItem(k); } } } catch { /* storage unavailable */ }
const store = {
  get(k, d) { try { const v = localStorage.getItem('galacticio.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('galacticio.' + k, JSON.stringify(v)); } catch { /* storage unavailable */ } if (/^(imagery|layer\.|class\.)/.test(k) && typeof prefsChanged === 'function') prefsChanged(); },
};
let route = 'explore'; // current page: explore | about | data | terms | cookies
const IN_SANDBOX = /claude\.ai$|claudeusercontent\.com$|anthropic/.test(location.hostname) || location.search.includes('nolive');
const IS_TOUCH = matchMedia('(pointer: coarse)').matches;

/* ── object classes ─────────────────────────────────────────── */
const CLASSES = [
  { key: 'S', name: 'Crewed stations', color: '#ffc857', size: 7.0, shape: 'sq' },
  { key: 'L', name: 'Starlink', color: '#79a8ff', size: 1.7, shape: '' },
  { key: 'B', name: 'Other constellations', color: '#a891ff', size: 2.3, shape: '' },
  { key: 'N', name: 'Navigation (GNSS)', color: '#6fe0b0', size: 3.4, shape: 'tri' },
  { key: 'G', name: 'Geostationary', color: '#48cfe0', size: 3.2, shape: 'sq' },
  { key: 'P', name: 'Other satellites', color: '#e6eef8', size: 2.5, shape: '' },
  { key: 'D', name: 'Debris', color: '#ff6a3d', size: 2.0, shape: 'tri' },
  { key: 'R', name: 'Rocket bodies', color: '#d9a066', size: 2.6, shape: 'sq' },
];
const CLS_INDEX = Object.fromEntries(CLASSES.map((c, i) => [c.key, i]));
const NEO_COLOR = '#ff5f8f';

/* ── atmosphere & regions (altitudes in km) ─────────────────── */
const LAYERS = [
  { id: 'tropo', name: 'Troposphere', lo: 0, hi: 12, color: '#9fd8ff', blurb: 'Weather, clouds and almost all water vapour. Top varies from 8 km at the poles to 18 km at the equator.' },
  { id: 'strato', name: 'Stratosphere', lo: 12, hi: 50, color: '#6aa8ff', blurb: 'Holds the ozone layer. Temperature rises with height. Weather balloons top out here.' },
  { id: 'meso', name: 'Mesosphere', lo: 50, hi: 85, color: '#7b7cff', blurb: 'Coldest layer, near −90 °C at the top. Most meteors burn up here.' },
  { id: 'thermo', name: 'Thermosphere', lo: 85, hi: 600, color: '#b676ff', blurb: 'Aurora and the ionosphere. The ISS and most Starlink satellites fly inside it. Top swells 500–1,000 km with solar activity.' },
  { id: 'exo', name: 'Exosphere', lo: 600, hi: 10000, color: '#e27bd9', blurb: 'Gas so thin atoms rarely collide; it fades into interplanetary space.' },
];
const REGIMES = [
  { id: 'LEO', name: 'Low Earth orbit', lo: 160, hi: 2000, blurb: 'Stations, Earth imaging and broadband constellations. One orbit every 88–127 minutes.' },
  { id: 'MEO', name: 'Medium Earth orbit', lo: 2000, hi: 35586, blurb: 'Navigation satellites (GPS ~20,200 km, Galileo ~23,200 km) and O3b.' },
  { id: 'GEO', name: 'Geostationary belt', lo: 35586, hi: 35986, blurb: '35,786 km: one orbit per sidereal day, so satellites hover over one longitude.' },
  { id: 'HEO', name: 'High orbits & cislunar', lo: 35986, hi: 450000, blurb: 'Graveyard orbits, Molniya/Tundra apogees, then the Moon at ~384,400 km.' },
  { id: 'NEO', name: 'Near-Earth asteroid flybys', lo: 450000, hi: 8e6, blurb: 'Asteroids passing within 0.05 AU (7.5 million km) in the current window.' },
];
const BELTS = [
  { name: 'Inner Van Allen belt', lo: 1000, hi: 6000, color: '#ff9b5c', blurb: 'Trapped high-energy protons, peaking near 3,000 km (model).' },
  { name: 'Outer Van Allen belt', lo: 13000, hi: 60000, color: '#9db4ff', blurb: 'Trapped electrons; swells and drains with geomagnetic storms (model).' },
];
const SPACEPORTS = [
  ['Kennedy / Cape Canaveral', 28.57, -80.65], ['Vandenberg', 34.63, -120.61], ['Starbase', 25.99, -97.15],
  ['Wallops', 37.94, -75.46], ['Baikonur', 45.92, 63.34], ['Plesetsk', 62.93, 40.58], ['Vostochny', 51.88, 128.33],
  ['Kourou (Guiana)', 5.24, -52.77], ['Jiuquan', 40.96, 100.29], ['Wenchang', 19.61, 110.95], ['Xichang', 28.25, 102.03],
  ['Taiyuan', 38.85, 111.61], ['Satish Dhawan', 13.73, 80.23], ['Tanegashima', 30.40, 130.97], ['Uchinoura', 31.25, 131.08],
  ['Mahia (Rocket Lab)', -39.26, 177.86], ['Naro', 34.43, 127.53], ['Sohae', 39.66, 124.71], ['Semnan', 35.23, 53.92],
  ['Palmachim', 31.88, 34.68], ['Andøya', 69.29, 16.02], ['SaxaVord', 60.82, -0.77], ['Alcântara', -2.32, -44.37],
];

/* ── loader ───────────────────────────────────────────────── */
// One bar, one line of text. Each step reports run/ok/err; the bar fills as steps settle.
const BOOT = [
  ['engine', 'Starting the 3D engine'], ['earth', 'Loading Earth imagery'], ['tle', 'Loading the satellite catalogue'],
  ['eph', 'Placing the Moon and asteroids'], ['wx', 'Reading space weather'], ['sky', 'Drawing the stars'], ['borders', 'Tracing coastlines'],
];
const bootState = {};
function bootSet(k, state) {
  bootState[k] = state;
  const done = BOOT.filter(([b]) => bootState[b] === 'ok' || bootState[b] === 'err').length;
  const pct = k === 'done' ? 100 : Math.min(96, Math.round(done / BOOT.length * 100));
  const bar = $('bootBar'); if (bar) bar.style.width = pct + '%';
  const running = BOOT.find(([b]) => bootState[b] === 'run');
  const txt = $('bootTxt'); if (txt) txt.textContent = k === 'done' ? 'Ready' : running ? running[1] : txt.textContent;
}
function fatal(msg) { $('fatal').hidden = false; $('fatal').textContent = msg; $('bootTxt').hidden = true; }
function toast(msg, ms = 4200) {
  if (route !== 'explore') return;
  const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, ms);
}

/* ════════════════════════ TIME ════════════════════════ */
const clock = { simBase: Date.now(), realBase: performance.now(), rate: 1 };
function simNow() { return clock.simBase + (performance.now() - clock.realBase) * clock.rate; }
function setRate(r) { clock.simBase = simNow(); clock.realBase = performance.now(); clock.rate = r; syncTimeUI(); }
function jump(ms) { clock.simBase = simNow() + ms; clock.realBase = performance.now(); sats && sats.fullPropagate(simNow()); syncTimeUI(); }
function goLive() { clock.simBase = Date.now(); clock.realBase = performance.now(); clock.rate = 1; sats && sats.fullPropagate(simNow()); syncTimeUI(); }
function isLive() { return clock.rate === 1 && Math.abs(simNow() - Date.now()) < 3000; }

/* ════════════════════════ ASTRONOMY ════════════════════════ */
const OBLIQ = 23.4393 * DEG;
const NEP = new THREE.Vector3(0, Math.cos(OBLIQ), Math.sin(OBLIQ)); // north ecliptic pole, three frame
const precessQ = new THREE.Quaternion();
function updatePrecession(ms) {
  const yrs = (ms - Date.UTC(2000, 0, 1, 12)) / (365.25 * 86400000);
  precessQ.setFromAxisAngle(NEP, (50.29 / 3600) * DEG * yrs);
}
function eciToThree(x, y, z, out) { return out.set(x / RE, z / RE, -y / RE); }
function jd(ms) { return ms / 86400000 + 2440587.5; }
function sunFallback(ms, out) { // low-precision, of-date, km
  const n = jd(ms) - 2451545.0, L = (280.460 + 0.9856474 * n) * DEG, g = (357.528 + 0.9856003 * n) * DEG;
  const lam = L + (1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * DEG, e = (23.439 - 0.0000004 * n) * DEG;
  const r = AU * (1.00014 - 0.01671 * Math.cos(g));
  return eciToThree(r * Math.cos(lam), r * Math.cos(e) * Math.sin(lam), r * Math.sin(e) * Math.sin(lam), out);
}
function moonFallback(ms, out) {
  const T = (jd(ms) - 2451545) / 36525, d = DEG;
  const Lp = 218.316 + 481267.881 * T, Mp = (134.963 + 477198.867 * T) * d, F = (93.272 + 483202.019 * T) * d;
  const D = (297.850 + 445267.115 * T) * d, M = (357.529 + 35999.050 * T) * d;
  const lam = (Lp + 6.289 * Math.sin(Mp) - 1.274 * Math.sin(2 * D - Mp) + 0.658 * Math.sin(2 * D) + 0.214 * Math.sin(2 * Mp) - 0.186 * Math.sin(M) - 0.114 * Math.sin(2 * F)) * d;
  const bet = (5.128 * Math.sin(F) + 0.281 * Math.sin(Mp + F) + 0.278 * Math.sin(Mp - F)) * d;
  const r = 385001 - 20905 * Math.cos(Mp) - 3699 * Math.cos(2 * D - Mp) - 2956 * Math.cos(2 * D);
  const x = r * Math.cos(bet) * Math.cos(lam), y = r * Math.cos(bet) * Math.sin(lam), z = r * Math.sin(bet);
  return eciToThree(x, y * Math.cos(OBLIQ) - z * Math.sin(OBLIQ), y * Math.sin(OBLIQ) + z * Math.cos(OBLIQ), out);
}
function makeEphem(rows) {
  const t0 = rows[0][0], t1 = rows[rows.length - 1][0];
  let last = 0;
  return {
    t0, t1, rows,
    at(ms, out, vel) { // returns km in ICRF -> three, precessed to of-date
      const t = ms / 1000;
      if (t < t0 || t > t1) return false;
      let i = last;
      if (!(rows[i][0] <= t && rows[i + 1] && rows[i + 1][0] > t)) {
        let lo = 0, hi = rows.length - 2;
        while (lo < hi) { const m = (lo + hi + 1) >> 1; if (rows[m][0] <= t) lo = m; else hi = m - 1; }
        i = lo; last = i;
      }
      const a = rows[i], b = rows[Math.min(i + 1, rows.length - 1)];
      const h = b[0] - a[0] || 1, s = (t - a[0]) / h, s2 = s * s, s3 = s2 * s;
      const h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
      const x = h00 * a[1] + h10 * h * a[4] + h01 * b[1] + h11 * h * b[4];
      const y = h00 * a[2] + h10 * h * a[5] + h01 * b[2] + h11 * h * b[5];
      const z = h00 * a[3] + h10 * h * a[6] + h01 * b[3] + h11 * h * b[6];
      eciToThree(x, y, z, out).applyQuaternion(precessQ);
      if (vel) vel.set(a[4] + (b[4] - a[4]) * s, a[5] + (b[5] - a[5]) * s, a[6] + (b[6] - a[6]) * s);
      return true;
    },
  };
}
const ephem = { moon: null, sun: null };
const sunDir = new THREE.Vector3(1, 0, 0), sunPos = new THREE.Vector3(), moonPos = new THREE.Vector3(60, 0, 0);
function updateBodies(ms) {
  updatePrecession(ms);
  if (!(ephem.sun && ephem.sun.at(ms, sunPos))) sunFallback(ms, sunPos);
  sunDir.copy(sunPos).normalize();
  moonState.source = (ephem.moon && ephem.moon.at(ms, moonPos)) ? 'JPL Horizons' : (moonFallback(ms, moonPos), 'analytic model');
}
const moonState = { source: '' };

/* ════════════════════════ RENDERER ════════════════════════ */
const canvas = $('gl');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
} catch (e) {
  bootSet('engine', 'err');
  fatal('Your browser could not start WebGL, which this 3D view needs. Try a current Chrome, Edge, Firefox or Safari with hardware acceleration turned on.');
  throw e;
}
// Cap the drawing buffer at ~6.5 megapixels: on large high-DPI screens a full 2× buffer (plus depth
// and antialiasing) costs hundreds of MB of GPU memory for little visible gain.
function targetDpr() { return Math.max(1, Math.min(devicePixelRatio || 1, 2, Math.sqrt(6.5e6 / Math.max(1, innerWidth * innerHeight)))); }
renderer.setPixelRatio(targetDpr());
renderer.autoClear = false;
renderer.setClearColor(0x04060b, 1);
const MAX_ANISO = renderer.capabilities.getMaxAnisotropy();
bootSet('engine', 'ok', 'WebGL ' + (renderer.capabilities.isWebGL2 ? '2' : '1'));

const scene = new THREE.Scene();
const skyScene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(48, 1, 1e-6, 2e5);
const skyCam = new THREE.PerspectiveCamera(48, 1, 0.1, 2000);
const earthGroup = new THREE.Group(); scene.add(earthGroup);
const sunLight = new THREE.DirectionalLight(0xffffff, 3.2); scene.add(sunLight); scene.add(sunLight.target);
scene.add(new THREE.AmbientLight(0x8fa4c8, 0.35));
const texLoader = new THREE.TextureLoader();
// Once a texture has been uploaded to the GPU, drop the decoded image on the JS side: three.js only
// reads it again if the texture is marked for update, which these never are. Halves texture memory.
function releaseAfterUpload(t) { t.onUpdate = () => { t.onUpdate = null; const im = t.image; if (im && im.close) im.close(); if (im && im.tagName === 'CANVAS') { im.width = im.height = 1; } t.source.data = null; }; return t; }
function loadTex(url, srgb = false) {
  return new Promise((res, rej) => texLoader.load(url, (t) => {
    t.anisotropy = MAX_ANISO; if (srgb) t.colorSpace = THREE.SRGBColorSpace; releaseAfterUpload(t); res(t);
  }, undefined, () => rej(new Error('Could not load ' + url))));
}
const LOGV = `#include <common>\n#include <logdepthbuf_pars_vertex>\n`;
const LOGF = `#include <logdepthbuf_pars_fragment>\n`;

/* ════════════════════════ CAMERA CONTROL ════════════════════════ */
const cam = {
  target: new THREE.Vector3(), follow: null, dist: 3.4, az: 0.6, el: 0.32, tilt: 0, userTilt: 0,
  vAz: 0, vEl: 0, fly: null, minDist: 1 + 30 / RE, maxDist: 1600, tiltK: 1,
  pan: new THREE.Vector3(),  // orbit-centre offset from panning
  zoomGoal: null,            // eased zoom target (wheel, keys)
  blend: null,               // orientation hand-over when leaving free flight
};
// Free flight: the camera has its own position and orientation and can go anywhere. When it starts
// while following an object, it moves relative to that object so the object stays close by.
const free = {
  on: false, anchor: null, pos: new THREE.Vector3(), q: new THREE.Quaternion(),
  v: new THREE.Vector3(),    // velocity in camera axes, in units of the cruise speed
  level: store.get('level', true), speed: 0, stick: { x: 0, y: 0 }, lift: 0,
};
const keys = new Set();
// Keep the camera exactly where it is but orbit the Earth's centre again. Without this, dropping
// a satellite target while zoomed in close snaps the orbit centre to the Earth and the camera ends
// up inside the planet.
function recenter() {
  const p = camera.position.clone(), a = angleFromDir(p); // rendered position (already kept outside the planet)
  cam.target.set(0, 0, 0); cam.dist = clamp(p.length(), cam.minDist, cam.maxDist); cam.az = a.az; cam.el = a.el;
  cam.follow = null; cam.fly = null; cam.tiltK = 1; cam.pan.set(0, 0, 0); cam.zoomGoal = null;
}
function cancelFly() { if (!cam.fly) return; cam.fly = null; if (!cam.follow && cam.target.lengthSq() > 1e-12) recenter(); }
// Animated version for "stop following": the camera stays put while its gaze swings back to Earth.
function releaseFollow() {
  if (!cam.follow && !(cam.fly && cam.fly.follow) && cam.target.lengthSq() < 1e-12) { cam.follow = null; return; }
  const p = camera.position.clone(); cam.follow = null; cam.pan.set(0, 0, 0); cam.zoomGoal = null;
  cam.fly = { release: true, t: 0, dur: 0.9, fromT: cam.target.clone(), pos: p };
}
function camAltKm() { return (camera.position.length() - 1) * RE; }
const _camOff = new THREE.Vector3();
const _blendQ = new THREE.Quaternion();
function applyCamera() {
  if (free.on) { freeWorld(camera.position); camera.quaternion.copy(free.q); camera.up.set(0, 1, 0); skyCam.quaternion.copy(camera.quaternion); return; }
  const ce = Math.cos(cam.el);
  const off = _camOff.set(ce * Math.sin(cam.az), Math.sin(cam.el), ce * Math.cos(cam.az)).multiplyScalar(cam.dist);
  camera.position.copy(cam.target).add(off);
  const minR = 1 + 15 / RE; if (camera.position.length() < minR) camera.position.setLength(minR); // never inside the planet
  camera.up.set(0, 1, 0);
  camera.lookAt(cam.target);
  // auto-tilt toward the horizon when skimming low over the planet (target = Earth only)
  if (!cam.follow) {
    const alt = (cam.dist - 1) * RE;
    // the automatic horizon tilt only makes sense while orbiting the Earth's centre, not after panning away
    const t = (smooth(2600, 180, alt) * 1.18 * (1 - smooth(0, 0.03, cam.pan.length())) + cam.userTilt) * cam.tiltK;
    cam.tilt = clamp(t, 0, 1.35);
    if (cam.tilt > 0.001) camera.rotateX(cam.tilt);
  }
  if (cam.blend) { const s = Math.min(cam.blend.t, 1), e = s * s * (3 - 2 * s); _blendQ.copy(camera.quaternion); camera.quaternion.slerpQuaternions(cam.blend.q0, _blendQ, e); }
  skyCam.quaternion.copy(camera.quaternion);
}
function zoomBy(f) {
  cancelFly(); cam.zoomGoal = null;
  if (cam.follow) { cam.dist = clamp(cam.dist * f, 0.0015, cam.maxDist); return; }
  const alt = Math.max(cam.dist - 1, 1e-4);
  cam.dist = clamp(1 + alt * f, cam.minDist, cam.maxDist);
}
// Wheel and key zoom: move a goal and let the camera ease toward it, so steps blend into one glide.
function zoomSmooth(f) {
  if (free.on) { free.v.z = clamp(free.v.z + (f < 1 ? -0.9 : 0.9), -6, 6); return; }
  cancelFly();
  const cur = cam.zoomGoal != null ? cam.zoomGoal : cam.dist;
  cam.zoomGoal = cam.follow ? clamp(cur * f, 0.0015, cam.maxDist) : clamp(1 + Math.max(cur - 1, 1e-4) * f, cam.minDist, cam.maxDist);
}
function stepZoom(dt) {
  const g = cam.zoomGoal; if (g == null || cam.fly) return;
  const k = 1 - Math.exp(-dt * 11);
  if (cam.follow) cam.dist = Math.exp(Math.log(cam.dist) + (Math.log(g) - Math.log(cam.dist)) * k);
  else { const a = Math.log(Math.max(cam.dist - 1, 1e-5)), b = Math.log(Math.max(g - 1, 1e-5)); cam.dist = 1 + Math.exp(a + (b - a) * k); }
  if (Math.abs(Math.log(cam.dist / g)) < 1e-4) { cam.dist = g; cam.zoomGoal = null; }
}
// Slide the orbit centre across the screen (middle-drag, Ctrl/⌘-drag, two-finger drag).
const _pa = new THREE.Vector3(), _pb = new THREE.Vector3(), _pc = new THREE.Vector3();
function panBy(dx, dy) {
  cancelFly();
  const d = cam.follow ? cam.dist : Math.max(cam.dist - 1, 0.002);
  const s = 2 * d * Math.tan(camera.fov * DEG / 2) / innerHeight, ce = Math.cos(cam.el);
  const back = _pa.set(ce * Math.sin(cam.az), Math.sin(cam.el), ce * Math.cos(cam.az));
  const right = _pb.set(Math.cos(cam.az), 0, -Math.sin(cam.az)), up = _pc.crossVectors(back, right);
  cam.pan.addScaledVector(right, -dx * s).addScaledVector(up, dy * s);
  if (cam.pan.length() > cam.maxDist) cam.pan.setLength(cam.maxDist);
}
// Glide the orbit centre back to Earth (or the followed object) without moving the view angle.
function resetPan(dur = 0.8) {
  if (cam.pan.lengthSq() < 1e-12) return;
  const follow = cam.follow; cam.pan.set(0, 0, 0); cam.follow = null; cam.zoomGoal = null;
  cam.fly = { t: 0, dur, fromT: cam.target.clone(), fromD: cam.dist, fromAz: cam.az, fromEl: cam.el, toT: new THREE.Vector3(), follow, toD: cam.dist, toAz: cam.az, toEl: cam.el };
}
function flyTo({ target = null, follow = null, dist, az = cam.az, el = cam.el, dur = 1.6 }) {
  if (free.on) exitFree();
  cam.zoomGoal = null;
  if (!target && cam.target.lengthSq() > 1e-12) recenter(); // e.g. Reset while close to a satellite
  cam.pan.set(0, 0, 0);
  cam.fly = { t: 0, dur, fromT: cam.target.clone(), fromD: cam.dist, fromAz: cam.az, fromEl: cam.el,
    toT: target ? target.clone() : new THREE.Vector3(), follow, toD: dist, toAz: az, toEl: el };
  if (!follow) cam.follow = null;
}
function stepFly(dt) {
  const f = cam.fly; if (!f) return;
  f.t += dt / f.dur; const s = f.t >= 1 ? 1 : 1 - Math.pow(1 - f.t, 3);
  if (f.release) {
    cam.target.copy(f.fromT).multiplyScalar(1 - s);
    const off = f.pos.clone().sub(cam.target), a = angleFromDir(off);
    cam.dist = Math.max(off.length(), 1e-4); cam.az = a.az; cam.el = a.el; cam.tiltK = s;
    if (f.t >= 1) recenter();
    return;
  }
  const toT = f.follow ? f.follow.pos() : f.toT;
  cam.target.lerpVectors(f.fromT, toT, s);
  cam.dist = Math.exp(Math.log(f.fromD) + (Math.log(f.toD) - Math.log(f.fromD)) * s);
  let dAz = f.toAz - f.fromAz; dAz = Math.atan2(Math.sin(dAz), Math.cos(dAz));
  cam.az = f.fromAz + dAz * s; cam.el = f.fromEl + (f.toEl - f.fromEl) * s;
  if (f.t >= 1) { cam.fly = null; cam.follow = f.follow; }
}
function angleFromDir(v) { const d = v.clone().normalize(); return { az: Math.atan2(d.x, d.z), el: Math.asin(clamp(d.y, -0.98, 0.98)) }; }
function goHome(dur = 1.8) {
  const d = sunDir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -0.75);
  const a = angleFromDir(d); cam.userTilt = 0;
  flyTo({ dist: innerWidth < 860 ? 4.6 : 3.4, az: a.az, el: 0.3, dur });
}

/* ── free flight ─────────────────────────────────────────────── */
const _fa = new THREE.Vector3(), _fb = new THREE.Vector3(), _fc = new THREE.Vector3(), _fd = new THREE.Vector3(), _fq = new THREE.Quaternion();
const AX = new THREE.Vector3(1, 0, 0), AY = new THREE.Vector3(0, 1, 0), AZ = new THREE.Vector3(0, 0, 1);
const MOON_R = 1737.4 / RE;
function freeWorld(out) { out.copy(free.pos); if (free.anchor) out.add(free.anchor.pos()); return out; }
// Cruise speed in Earth radii per second: proportional to the distance to the nearest surface (Earth,
// Moon or the object being flown around), so the same keys work from orbit to deep space.
function freeCruise(w) {
  let near = Math.max(w.length() - 1, 2e-6);
  near = Math.min(near, Math.max(w.distanceTo(moon.position) - MOON_R, 2e-6));
  if (free.anchor) near = Math.min(near, Math.max(free.pos.length(), 2e-6));
  return clamp(near * 0.7, 1e-6, 600);
}
// yaw about the local vertical when levelling (keeps the horizon flat), pitch and roll about the camera
function freeTurn(yaw, pitch, roll) {
  const q = free.q;
  if (yaw) {
    if (free.level) { freeWorld(_fa).normalize(); q.premultiply(_fq.setFromAxisAngle(_fa, yaw)); }
    else q.multiply(_fq.setFromAxisAngle(AY, yaw));
  }
  if (pitch) {
    q.multiply(_fq.setFromAxisAngle(AX, pitch));
    if (free.level && Math.abs(_fb.set(0, 0, -1).applyQuaternion(q).dot(freeWorld(_fa).normalize())) > 0.996) q.multiply(_fq.setFromAxisAngle(AX, -pitch)); // no flipping over the top
  }
  if (roll) q.multiply(_fq.setFromAxisAngle(AZ, roll));
  q.normalize();
}
function freeStrafe(dx, dy) { // drag with right button / Shift, or two fingers: slide sideways
  const s = freeCruise(freeWorld(_fb)) * 2 / innerHeight;
  free.pos.add(_fa.set(-dx * s, dy * s, 0).applyQuaternion(free.q));
}
// Roll the camera back toward the local horizon unless the user is rolling on purpose.
function freeLevel(dt) {
  const u = freeWorld(_fa).normalize(), f = _fb.set(0, 0, -1).applyQuaternion(free.q);
  const want = _fc.copy(u).addScaledVector(f, -u.dot(f)); if (want.lengthSq() < 0.02) return; want.normalize();
  const cur = u.set(0, 1, 0).applyQuaternion(free.q);
  const ang = Math.atan2(_fd.crossVectors(cur, want).dot(f), cur.dot(want));
  free.q.premultiply(_fq.setFromAxisAngle(f, ang * (1 - Math.exp(-dt * 2.5)))).normalize();
}
const held = (...c) => (c.some((x) => keys.has(x)) ? 1 : 0);
function freeStep(dt) {
  if (free.anchor && free.anchor.kind === 'sat' && !(sats && sats.recs[free.anchor.i] === free.anchor.rec)) { free.anchor = null; free.pos.copy(camera.position); } // catalogue changed under us
  const yaw = held('ArrowLeft') - held('ArrowRight'), pitch = held('ArrowUp') - held('ArrowDown'), roll = held('KeyQ') - held('KeyE');
  if (yaw || pitch) freeTurn(yaw * 1.1 * dt, pitch * 0.9 * dt, 0);
  if (roll) freeTurn(0, 0, roll * 1.3 * dt);
  const boost = held('ShiftLeft', 'ShiftRight') ? 5 : held('AltLeft', 'AltRight') ? 0.2 : 1;
  const want = _fa.set(
    clamp(held('KeyD') - held('KeyA') + free.stick.x, -1, 1),
    clamp(held('Space', 'PageUp') - held('KeyC', 'PageDown') + free.lift, -1, 1),
    clamp(held('KeyS') - held('KeyW') + free.stick.y, -1, 1)).multiplyScalar(boost);
  const pushing = want.lengthSq() > 0;
  free.v.lerp(want, 1 - Math.exp(-dt * (pushing ? 5 : 2.2))); // quick to start, glides to a stop
  if (!pushing && free.v.lengthSq() < 1e-8) free.v.set(0, 0, 0);
  const w = freeWorld(_fb), cruise = freeCruise(w);
  free.speed = cruise * free.v.length() * RE; // km/s, for the readout
  if (free.v.lengthSq()) free.pos.add(_fc.copy(free.v).applyQuaternion(free.q).multiplyScalar(cruise * dt));
  // keep out of the Earth and the Moon, and inside the scene
  freeWorld(w); let moved = false;
  const minR = 1 + 20 / RE; if (w.length() < minR) { w.setLength(minR); moved = true; }
  if (w.length() > cam.maxDist * 0.95) { w.setLength(cam.maxDist * 0.95); moved = true; }
  const m = _fc.copy(w).sub(moon.position), mr = MOON_R + 15 / RE; if (m.length() < mr) { w.copy(moon.position).add(m.setLength(mr)); moved = true; }
  if (moved) { free.pos.copy(w); if (free.anchor) free.pos.sub(free.anchor.pos()); }
  if (free.level && !roll) freeLevel(dt);
}
function enterFree() {
  if (free.on || route !== 'explore') return;
  camera.updateMatrixWorld();
  free.anchor = cam.follow || (cam.fly && cam.fly.follow) || null;
  free.q.copy(camera.quaternion); free.pos.copy(camera.position); if (free.anchor) free.pos.sub(free.anchor.pos());
  free.v.set(0, 0, 0); free.stick.x = free.stick.y = 0; free.lift = 0;
  cam.fly = null; cam.zoomGoal = null; cam.blend = null; cam.follow = null; cam.vAz = cam.vEl = 0;
  free.on = true; syncNavUi(); if (selected) renderDetail(false);
  toast(IS_TOUCH ? 'Free flight: move with the stick, drag to look around, pinch to glide. Tap Fly again to orbit.'
    : 'Free flight: W A S D to fly, drag or arrow keys to look, Shift for speed. F or Esc returns to orbit.', 6500);
}
// Back to orbiting: around the object we were flying near, otherwise around the Earth, from exactly
// where the camera is now. The view direction eases over instead of snapping.
function exitFree() {
  if (!free.on) return;
  const q0 = camera.quaternion.clone(), a = free.anchor;
  free.on = false; free.anchor = null; free.v.set(0, 0, 0);
  if (a && !(a.kind === 'sat' && !(sats && sats.recs[a.i] === a.rec))) {
    const ap = a.pos(), off = camera.position.clone().sub(ap), ang = angleFromDir(off);
    cam.follow = a; cam.target.copy(ap); cam.dist = clamp(off.length(), 0.0015, cam.maxDist); cam.az = ang.az; cam.el = ang.el;
    cam.fly = null; cam.zoomGoal = null; cam.pan.set(0, 0, 0);
  } else recenter();
  cam.userTilt = 0; cam.vAz = cam.vEl = 0; cam.blend = { q0, t: 0, dur: 0.8 };
  syncNavUi(); if (selected) renderDetail(false);
}
function toggleFree(on = !free.on) { if (on) enterFree(); else exitFree(); }

/* pointer handling
   orbit: drag = rotate, right/Shift-drag = tilt, middle/Ctrl-drag = pan, wheel/pinch = zoom, two fingers = pan
   free flight: drag = look, right/Shift-drag = slide, wheel/pinch = glide forward/back */
const pointers = new Map();
let pinch = null, dragMoved = 0, lastTap = 0;
const mouse = { x: -1, y: -1, over: false, moved: false };
function twoFinger() { const [a, b] = [...pointers.values()]; return { d: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
canvas.addEventListener('pointerdown', (e) => {
  if (e.button === 1) e.preventDefault(); // no auto-scroll on middle-drag
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, b: e.button, sh: e.shiftKey, pan: e.button === 1 || e.ctrlKey || e.metaKey });
  dragMoved = 0; cam.vAz = cam.vEl = 0; canvas.classList.add('dragging');
  pinch = pointers.size >= 2 ? twoFinger() : null;
});
canvas.addEventListener('pointermove', (e) => {
  mouse.x = e.clientX; mouse.y = e.clientY; mouse.over = true; mouse.moved = true;
  const p = pointers.get(e.pointerId); if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
  dragMoved += Math.abs(dx) + Math.abs(dy);
  if (pointers.size >= 2) {
    const g = twoFinger();
    if (pinch && pinch.d > 0 && g.d > 0) {
      const ratio = pinch.d / g.d, mx = g.x - pinch.x, my = g.y - pinch.y;
      if (free.on) { free.v.z = clamp(free.v.z + (ratio - 1) * 7, -6, 6); freeStrafe(mx, my); }
      else { zoomBy(Math.pow(ratio, 1.6)); panBy(mx, my); }
    }
    pinch = g; return;
  }
  if (free.on) {
    if (p.b === 2 || p.sh || p.pan) freeStrafe(dx, dy);
    else { const k = camera.fov * DEG / innerHeight; freeTurn(dx * k, dy * k, 0); } // the sky follows the pointer
    return;
  }
  if (p.pan) { panBy(dx, dy); return; }
  if (p.b === 2 || p.sh) { cam.userTilt = clamp(cam.userTilt + dy * 0.004, -1.2, 1.0); return; }
  cancelFly();
  const alt = cam.follow ? cam.dist : Math.max(cam.dist - 1, 0.002);
  const k = 0.0042 * clamp(alt / 1.2, 0.012, 1.0) * (cam.follow ? 1.6 : 1);
  cam.vAz = -dx * k; cam.vEl = dy * k;
  cam.az += cam.vAz; cam.el = clamp(cam.el + cam.vEl, -1.53, 1.53);
});
const endPtr = (e) => {
  pointers.delete(e.pointerId); pinch = pointers.size >= 2 ? twoFinger() : null;
  if (!pointers.size) canvas.classList.remove('dragging');
  if (e.type === 'pointerup' && dragMoved < 6) onTap(e);
};
canvas.addEventListener('pointerup', endPtr); canvas.addEventListener('pointercancel', endPtr);
canvas.addEventListener('pointerleave', () => { mouse.over = false; if (!pointers.size) setHover(null); });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const dy = clamp(e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1), -160, 160);
  if (free.on) { free.v.z = clamp(free.v.z + dy * 0.006, -6, 6); return; }
  zoomSmooth(Math.exp(dy * 0.0022));
}, { passive: false });
// Keyboard: arrows/WASD orbit (or fly), Q/E zoom (or roll); see the controls card for the full list.
function orbitKeys(dt) {
  const kx = held('ArrowRight', 'KeyD') - held('ArrowLeft', 'KeyA'), ky = held('ArrowUp', 'KeyW') - held('ArrowDown', 'KeyS'), kz = held('KeyQ') - held('KeyE');
  if (kz) zoomBy(Math.exp(kz * 1.5 * dt));
  if (!kx && !ky) return;
  cancelFly();
  const alt = cam.follow ? cam.dist : Math.max(cam.dist - 1, 0.002);
  const r = 0.9 * clamp(alt / 1.2, 0.012, 1.0) * (cam.follow ? 1.6 : 1) * dt;
  cam.az += kx * r; cam.el = clamp(cam.el + ky * r, -1.53, 1.53);
}
canvas.addEventListener('dblclick', () => { if (hover) select(hover, true); });

/* ════════════════════════ SKY ════════════════════════ */
const skyUniforms = { mw: { value: null }, sunDir: { value: sunDir }, nep: { value: NEP }, mwK: { value: 0.0 }, rot: { value: new THREE.Matrix3() } };
const skySphere = new THREE.Mesh(new THREE.SphereGeometry(900, 64, 32), new THREE.ShaderMaterial({
  uniforms: skyUniforms, side: THREE.BackSide, depthWrite: false, depthTest: false,
  vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D mw; uniform vec3 sunDir; uniform vec3 nep; uniform float mwK; uniform mat3 rot; varying vec3 vD;
    void main(){
      vec3 d = normalize(vD);
      vec3 j = rot * d;                         // undo precession -> J2000 sky
      float ra = atan(-j.z, j.x); if(ra<0.0) ra += 6.2831853;
      float dec = asin(clamp(j.y,-1.0,1.0));
      vec3 m = texture2D(mw, vec2(ra/6.2831853, 0.5 + dec/3.1415927)).rgb;
      m = pow(m, vec3(2.2)) * 1.25 * mwK;
      float beta = asin(clamp(dot(d, nep),-1.0,1.0));
      float elong = acos(clamp(dot(d, sunDir),-1.0,1.0));
      float zod = exp(-abs(beta)/0.16) * (0.25*exp(-elong/0.55) + 0.04) + 0.012*exp(-pow((3.1416-elong)/0.12,2.0))*exp(-abs(beta)/0.1);
      vec3 col = m + vec3(1.0,0.9,0.75)*zod*0.10;
      col += vec3(0.0005,0.0007,0.0013);
      gl_FragColor = vec4(pow(col, vec3(1.0/2.2)), 1.0);
    }`,
}));
skyScene.add(skySphere);
const starGroup = new THREE.Group(); skyScene.add(starGroup);
function bvToRGB(bv) {
  const t = clamp(bv, -0.4, 2.0);
  const stops = [[-0.4, [0.62, 0.72, 1.0]], [0.0, [0.80, 0.86, 1.0]], [0.4, [0.98, 0.98, 1.0]], [0.8, [1.0, 0.93, 0.80]], [1.2, [1.0, 0.82, 0.62]], [2.0, [1.0, 0.64, 0.42]]];
  for (let i = 0; i < stops.length - 1; i++) {
    const [a, ca] = stops[i], [b, cb] = stops[i + 1];
    if (t <= b) { const s = (t - a) / (b - a); return ca.map((v, k) => v + (cb[k] - v) * s); }
  }
  return stops[stops.length - 1][1];
}
function buildStars(list) {
  const n = list.length, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), sz = new Float32Array(n);
  list.forEach(([ra, dec, mag, bv], i) => {
    const r = ra * DEG, d = dec * DEG;
    pos.set([Math.cos(d) * Math.cos(r) * 800, Math.sin(d) * 800, -Math.cos(d) * Math.sin(r) * 800], i * 3);
    const b = clamp(Math.pow(10, -0.4 * (mag - 1.2)), 0.05, 2.4);
    const c = bvToRGB(bv); col.set([c[0] * Math.min(b, 1.2), c[1] * Math.min(b, 1.2), c[2] * Math.min(b, 1.2)], i * 3);
    sz[i] = clamp(3.6 - mag * 0.48, 0.9, 5.0);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('size', new THREE.BufferAttribute(sz, 1));
  const m = new THREE.ShaderMaterial({
    uniforms: { dpr: { value: renderer.getPixelRatio() }, k: { value: 1 } }, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `attribute float size; attribute vec3 color; uniform float dpr; varying vec3 vC; void main(){ vC=color; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); gl_PointSize=size*dpr; }`,
    fragmentShader: `uniform float k; varying vec3 vC; void main(){ vec2 p=gl_PointCoord-0.5; float d=length(p); float a=exp(-d*d*22.0)+0.35*exp(-d*d*6.0); gl_FragColor=vec4(vC*a*k,1.0); }`,
  });
  starGroup.add(new THREE.Points(g, m));
  starGroup.userData.mat = m;
}
// sun glare, placed on the sky sphere in the sun direction
const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
  map: (() => {
    const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d');
    const g = x.createRadialGradient(128, 128, 0, 128, 128, 128);
    g.addColorStop(0, 'rgba(255,255,250,1)'); g.addColorStop(0.06, 'rgba(255,250,235,1)'); g.addColorStop(0.12, 'rgba(255,225,170,.55)');
    g.addColorStop(0.35, 'rgba(255,190,120,.12)'); g.addColorStop(1, 'rgba(255,170,90,0)');
    x.fillStyle = g; x.fillRect(0, 0, 256, 256); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })(), blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true,
}));
sunSprite.scale.setScalar(120); skyScene.add(sunSprite);

/* ── foreground dust: sunlit micro-particles drifting past the camera (decorative) ── */
const dust = (() => {
  const n = 2200, base = new Float32Array(n * 3), ph = new Float32Array(n);
  for (let i = 0; i < n; i++) { base[i * 3] = Math.random(); base[i * 3 + 1] = Math.random(); base[i * 3 + 2] = Math.random(); ph[i] = Math.random() * 100; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(base, 3)); g.setAttribute('ph', new THREE.BufferAttribute(ph, 1));
  const m = new THREE.ShaderMaterial({
    uniforms: { camPos: { value: new THREE.Vector3() }, box: { value: 1 }, time: { value: 0 }, dpr: { value: renderer.getPixelRatio() }, k: { value: 1 }, sunDir: { value: sunDir } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: LOGV + `attribute float ph; uniform vec3 camPos; uniform float box; uniform float time; uniform float dpr; varying float vA;
      void main(){
        vec3 drift = vec3(time*0.0021, time*0.0013, -time*0.0017);
        vec3 f = fract(position + drift - camPos/box) - 0.5;
        vec3 w = camPos + f*box;
        vec4 mv = viewMatrix*vec4(w,1.0); gl_Position = projectionMatrix*mv;
        float edge = 1.0 - smoothstep(0.30, 0.5, max(abs(f.x),max(abs(f.y),abs(f.z))));
        float near = smoothstep(0.015, 0.06, length(f));
        float tw = pow(0.5+0.5*sin(time*(0.6+fract(ph)*1.7)+ph), 14.0);
        vA = edge*near*(0.10 + 0.9*tw);
        gl_PointSize = clamp(box*0.012/(-mv.z), 0.6, 2.6)*dpr*(1.0+tw*0.6);
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: LOGF + `uniform float k; varying float vA; void main(){
        #include <logdepthbuf_fragment>
        vec2 p=gl_PointCoord-0.5; float d=length(p); float a=exp(-d*d*30.0);
        float spike = max(0.0, 1.0-abs(p.x)*12.0)*max(0.0,1.0-abs(p.y)*2.2) + max(0.0, 1.0-abs(p.y)*12.0)*max(0.0,1.0-abs(p.x)*2.2);
        gl_FragColor = vec4(vec3(0.85,0.9,1.0)*(a+spike*0.35)*vA*k, 1.0); }`,
  });
  const pts = new THREE.Points(g, m); pts.frustumCulled = false; scene.add(pts); return pts;
})();

/* ════════════════════════ EARTH ════════════════════════ */
const earthUniforms = () => ({
  day: { value: null }, lights: { value: null }, water: { value: null }, fill: { value: null },
  isViirs: { value: 0 }, sunDir: { value: sunDir }, nightK: { value: 1 },
});
const EARTH_V = LOGV + `attribute vec2 guv; varying vec2 vUv; varying vec2 vG; varying vec3 vN; varying vec3 vW;
  void main(){ vUv=uv; vG=guv; vN=normalize(mat3(modelMatrix)*normal); vec4 w=modelMatrix*vec4(position,1.0); vW=w.xyz;
    gl_Position=projectionMatrix*viewMatrix*w;
    #include <logdepthbuf_vertex>
  }`;
const EARTH_F = LOGF + `uniform sampler2D day; uniform sampler2D lights; uniform sampler2D water; uniform sampler2D fill;
  uniform float isViirs; uniform vec3 sunDir; uniform float nightK;
  varying vec2 vUv; varying vec2 vG; varying vec3 vN; varying vec3 vW;
  vec3 lin(vec3 c){ return pow(c, vec3(2.2)); }
  void main(){
    #include <logdepthbuf_fragment>
    vec3 d = lin(texture2D(day, vUv).rgb);
    if(isViirs > 0.5){
      float m = max(d.r, max(d.g, d.b));
      float gap = 1.0 - smoothstep(0.0004, 0.0035, m);
      d = mix(d, lin(texture2D(fill, vG).rgb)*0.8, gap);
    }
    vec3 N = normalize(vN); vec3 V = normalize(cameraPosition - vW);
    float ndl = dot(N, sunDir);
    float dayK = smoothstep(-0.10, 0.22, ndl);
    vec3 col = d * (max(ndl, 0.0)*1.2 + 0.010);
    col += d * vec3(1.0, 0.42, 0.18) * 0.16 * exp(-pow(ndl/0.07, 2.0));
    float w = texture2D(water, vG).r;
    vec3 H = normalize(sunDir + V);
    col += vec3(1.0, 0.86, 0.68) * pow(max(dot(N, H), 0.0), 260.0) * w * 0.45 * smoothstep(0.0, 0.25, ndl);
    col += vec3(0.05, 0.10, 0.20) * w * pow(max(dot(N,H),0.0), 8.0) * 0.25 * smoothstep(0.0,0.3,ndl);
    float li = smoothstep(0.08, 0.95, texture2D(lights, vG).r);
    col += vec3(1.0, 0.64, 0.30) * pow(li, 1.35) * 0.95 * (1.0 - dayK) * nightK;
    float fr = pow(1.0 - max(dot(N, V), 0.0), 3.0);
    col = mix(col, vec3(0.30, 0.55, 1.0) * (0.04 + 0.95*max(ndl + 0.15, 0.0)), fr * 0.6);
    col = col / (1.0 + col * 0.12);
    gl_FragColor = vec4(pow(col, vec3(1.0/2.2)), 1.0);
  }`;
const baseMat = new THREE.ShaderMaterial({ uniforms: earthUniforms(), vertexShader: EARTH_V, fragmentShader: EARTH_F });
const baseGeo = new THREE.SphereGeometry(0.99975, 192, 96);
baseGeo.setAttribute('guv', baseGeo.attributes.uv.clone());
const earthBase = new THREE.Mesh(baseGeo, baseMat); earthBase.renderOrder = 0; earthGroup.add(earthBase);
const globalTex = { bm: null, viirs: null, lights: null, water: null };
const imagery = { mode: store.get('imagery', 'bm') };
const IMAGERY = { bm: { dir: 'tiles/bm', max: 3 }, viirs: { dir: 'tiles/viirs', max: 2 } };

/* ── level-of-detail tiles: equirectangular quadtree, 1024px tiles ──
   level L: 2^(L+1) × 2^L tiles, each 180/2^L degrees. L1 = 4,096 px base globe,
   L2 = 8,192 px, L3 = 16,384 px (≈2.4 km per pixel).                      */
function llToVec(lat, lon, r = 1, out = new THREE.Vector3()) {
  const la = lat * DEG, lo = lon * DEG; return out.set(Math.cos(la) * Math.cos(lo) * r, Math.sin(la) * r, -Math.cos(la) * Math.sin(lo) * r);
}
class TileNode {
  constructor(L, x, y) {
    this.L = L; this.x = x; this.y = y; const span = 180 / 2 ** L;
    this.lon0 = -180 + x * span; this.lat1 = 90 - y * span; this.lon1 = this.lon0 + span; this.lat0 = this.lat1 - span; this.span = span;
    this.center = llToVec((this.lat0 + this.lat1) / 2, (this.lon0 + this.lon1) / 2);
    this.radius = span * DEG * 0.75; this.children = null; this.mesh = null; this.tex = {}; this.loading = {};
  }
  geometry() {
    const seg = this.L >= 3 ? 20 : 28, pos = [], uv = [], guv = [], idx = [], nrm = [];
    for (let j = 0; j <= seg; j++) for (let i = 0; i <= seg; i++) {
      const u = i / seg, v = j / seg, lon = this.lon0 + u * this.span, lat = this.lat0 + v * this.span;
      const p = llToVec(lat, lon); pos.push(p.x, p.y, p.z); nrm.push(p.x, p.y, p.z); uv.push(u, v); guv.push((lon + 180) / 360, (lat + 90) / 180);
    }
    for (let j = 0; j < seg; j++) for (let i = 0; i < seg; i++) { const a = j * (seg + 1) + i, b = a + 1, c = a + seg + 1, d = c + 1; idx.push(a, b, d, a, d, c); }
    const g = new THREE.BufferGeometry(); g.setIndex(idx);
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('guv', new THREE.Float32BufferAttribute(guv, 2));
    g.computeBoundingSphere(); return g;
  }
  ensureMesh() {
    if (this.mesh) return this.mesh;
    const m = new THREE.ShaderMaterial({ uniforms: earthUniforms(), vertexShader: EARTH_V, fragmentShader: EARTH_F });
    this.mesh = new THREE.Mesh(this.geometry(), m); this.mesh.renderOrder = this.L; this.mesh.visible = false; earthGroup.add(this.mesh); return this.mesh;
  }
  url(mode) { return `${IMAGERY[mode].dir}/${this.L}/${this.x}_${this.y}.jpg`; }
  request(mode) {
    if (this.tex[mode] || this.loading[mode] || this.L > IMAGERY[mode].max) return;
    this.loading[mode] = true; tiles.inflight++;
    loadTex(this.url(mode)).then((t) => { this.tex[mode] = t; t.generateMipmaps = true; this.seen = performance.now(); tiles.resident.add(this); }).catch(() => { this.tex[mode] = 'fail'; })
      .finally(() => { this.loading[mode] = false; tiles.inflight--; });
  }
  ready(mode) { return this.tex[mode] && this.tex[mode] !== 'fail'; }
  kids() { if (!this.children) this.children = [0, 1, 2, 3].map((k) => new TileNode(this.L + 1, this.x * 2 + (k & 1), this.y * 2 + (k >> 1))); return this.children; }
}
const tiles = { roots: [], inflight: 0, resident: new Set(), visible: 0, level: 1 };
const TILE_BUDGET = 40;      // resident detail textures (each ~5.6 MB on the GPU with mipmaps)
const TILE_IDLE_MS = 15000;  // a tile unseen this long may be dropped once over budget
for (let y = 0; y < 4; y++) for (let x = 0; x < 8; x++) tiles.roots.push(new TileNode(2, x, y));
const _camLocal = new THREE.Vector3(), _cdir = new THREE.Vector3();
function updateTiles() {
  if (!globalTex.lights) return;
  _camLocal.copy(camera.position); earthGroup.worldToLocal(_camLocal);
  const cd = _camLocal.length(), cdir = _cdir.copy(_camLocal).normalize();
  const horizon = Math.acos(clamp(1 / cd, -1, 1));
  const mode = imagery.mode, max = IMAGERY[mode].max, now = performance.now(); let vis = 0, deepest = 1;
  const hideAll = (n) => { if (n.mesh) n.mesh.visible = false; if (n.children) n.children.forEach(hideAll); };
  const show = (n) => {
    const m = n.ensureMesh(); const u = m.material.uniforms;
    u.day.value = n.tex[mode]; u.lights.value = globalTex.lights; u.water.value = globalTex.water; u.fill.value = globalTex.bm; u.isViirs.value = mode === 'viirs' ? 1 : 0;
    m.visible = true; vis++; deepest = Math.max(deepest, n.L); n.seen = now;
  };
  const walk = (n) => {
    const ang = Math.acos(clamp(n.center.dot(cdir), -1, 1));
    if (ang > horizon + n.radius) { hideAll(n); return; }
    const dist = _camLocal.distanceTo(n.center);
    const want = dist < n.span * DEG * 2.1;
    if (!want || n.L > max) { hideAll(n); return; }
    n.request(mode);
    if (n.L < max && dist < n.span * DEG * 1.05) {
      const kids = n.kids(); kids.forEach((k) => k.request(mode));
      if (kids.every((k) => k.ready(mode) || k.tex[mode] === 'fail' || Math.acos(clamp(k.center.dot(cdir), -1, 1)) > horizon + k.radius)) {
        if (n.mesh) n.mesh.visible = false; kids.forEach(walk); return;
      }
    }
    if (n.children) n.children.forEach(hideAll);
    if (n.ready(mode)) show(n); else if (n.mesh) n.mesh.visible = false;
  };
  tiles.roots.forEach(walk);
  tiles.visible = vis; tiles.level = vis ? deepest : 1;
  // evict the least recently seen textures once over budget (never one on screen)
  if (tiles.resident.size > TILE_BUDGET && (tiles.sweep = (tiles.sweep || 0) + 1) % 30 === 0) {
    const idle = [...tiles.resident].filter((n) => !(n.mesh && n.mesh.visible) && now - n.seen > TILE_IDLE_MS).sort((a, b) => a.seen - b.seen);
    for (const n of idle.slice(0, tiles.resident.size - TILE_BUDGET)) {
      for (const k of Object.keys(n.tex)) { const t = n.tex[k]; if (t && t !== 'fail') t.dispose(); delete n.tex[k]; }
      if (n.mesh) { earthGroup.remove(n.mesh); n.mesh.geometry.dispose(); n.mesh.material.dispose(); n.mesh = null; }
      tiles.resident.delete(n);
    }
  }
}
function setImagery(mode) {
  imagery.mode = mode; store.set('imagery', mode);
  const u = baseMat.uniforms; u.day.value = globalTex[mode] || globalTex.bm; u.isViirs.value = mode === 'viirs' ? 1 : 0;
  document.querySelectorAll('#imagery button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.img === mode)));
}

/* ── borders & graticule ── */
const bordersMat = new THREE.LineBasicMaterial({ color: 0xcfe0ff, transparent: true, opacity: 0, depthWrite: false });
const gratMat = new THREE.LineBasicMaterial({ color: 0x8aa0c0, transparent: true, opacity: 0, depthWrite: false });
function buildBorders(arcs) {
  const pts = []; const v = new THREE.Vector3(), w = new THREE.Vector3();
  for (const a of arcs) for (let i = 2; i < a.length; i += 2) {
    llToVec(a[i - 1], a[i - 2], 1.00045, v); llToVec(a[i + 1], a[i], 1.00045, w); pts.push(v.x, v.y, v.z, w.x, w.y, w.z);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const l = new THREE.LineSegments(g, bordersMat); l.renderOrder = 5; earthGroup.add(l);
}
(() => {
  const pts = []; const v = new THREE.Vector3(), w = new THREE.Vector3();
  for (let lat = -60; lat <= 60; lat += 30) for (let lon = -180; lon < 180; lon += 2) { llToVec(lat, lon, 1.0005, v); llToVec(lat, lon + 2, 1.0005, w); pts.push(v.x, v.y, v.z, w.x, w.y, w.z); }
  for (let lon = -180; lon < 180; lon += 30) for (let lat = -88; lat < 88; lat += 2) { llToVec(lat, lon, 1.0005, v); llToVec(lat + 2, lon, 1.0005, w); pts.push(v.x, v.y, v.z, w.x, w.y, w.z); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const l = new THREE.LineSegments(g, gratMat); l.renderOrder = 5; earthGroup.add(l);
})();

/* ── aurora (NOAA OVATION probability, 1° grid) ── */
const auroraMat = new THREE.ShaderMaterial({
  uniforms: { grid: { value: null }, sunDir: { value: sunDir }, time: { value: 0 }, k: { value: 0 } },
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  vertexShader: LOGV + `varying vec3 vL; varying vec3 vN; varying vec3 vW; void main(){ vL=position; vN=normalize(mat3(modelMatrix)*normal); vec4 w=modelMatrix*vec4(position,1.0); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w;
    #include <logdepthbuf_vertex>
  }`,
  fragmentShader: LOGF + `uniform sampler2D grid; uniform vec3 sunDir; uniform float time; uniform float k; varying vec3 vL; varying vec3 vN; varying vec3 vW;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
    float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
    void main(){
      #include <logdepthbuf_fragment>
      vec3 p = normalize(vL);
      float lat = degrees(asin(p.y)); float lon = degrees(atan(-p.z, p.x));
      float gx = (mod(lon, 360.0) + 0.5)/360.0; float gy = (90.0 - lat + 0.5)/181.0;
      float a = texture2D(grid, vec2(gx, gy)).r;
      float n = noise(vec2(lon*0.35 + time*0.05, lat*1.7 - time*0.11))*0.6 + noise(vec2(lon*1.4 - time*0.2, lat*4.0))*0.4;
      a = pow(a, 0.85) * (0.55 + 0.9*n);
      float night = 1.0 - smoothstep(-0.18, 0.12, dot(normalize(vN), sunDir));
      vec3 V = normalize(cameraPosition - vW);
      float rim = 1.0 + 2.5*pow(1.0 - abs(dot(normalize(vN), V)), 3.0);
      vec3 c = mix(vec3(0.20, 1.0, 0.55), vec3(1.0, 0.25, 0.45), smoothstep(0.55, 1.0, a));
      gl_FragColor = vec4(c * a * (0.15 + 0.85*night) * rim * k * 1.3, 1.0);
    }`,
});
const aurora = new THREE.Mesh(new THREE.SphereGeometry(1 + 110 / RE, 160, 80), auroraMat); aurora.renderOrder = 6; earthGroup.add(aurora);

/* ── atmosphere: scattering halo + layer boundaries drawn at the limb ── */
const halo = new THREE.Mesh(new THREE.SphereGeometry(1.07, 96, 48), new THREE.ShaderMaterial({
  uniforms: { sunDir: { value: sunDir } }, side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  vertexShader: LOGV + `varying vec3 vW; void main(){ vec4 w=modelMatrix*vec4(position,1.0); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w;
    #include <logdepthbuf_vertex>
  }`,
  fragmentShader: LOGF + `uniform vec3 sunDir; varying vec3 vW; void main(){
    #include <logdepthbuf_fragment>
    vec3 V = normalize(vW - cameraPosition); float t = max(-dot(cameraPosition, V), 0.0);
    vec3 pc = cameraPosition + V*t; float h = length(pc);
    float g = exp(-max(h - 1.0, 0.0)/0.0105) * step(1.0, h + 0.0004);
    float s = smoothstep(-0.30, 0.45, dot(normalize(pc), sunDir));
    vec3 c = mix(vec3(1.0,0.45,0.25), vec3(0.35,0.62,1.0), smoothstep(0.15,0.55,s));
    gl_FragColor = vec4(c * g * (0.06 + 1.1*s) * 0.9, 1.0); }`,
}));
halo.renderOrder = 7; scene.add(halo);

const layerUniforms = {
  sunDir: { value: sunDir }, k: { value: 1 }, hi: { value: -1 },
  radii: { value: LAYERS.map((l) => 1 + l.hi / RE) },
  colors: { value: LAYERS.map((l) => new THREE.Color(l.color)) },
};
const layerShell = new THREE.Mesh(new THREE.SphereGeometry(1 + 10400 / RE, 128, 64), new THREE.ShaderMaterial({
  uniforms: layerUniforms, side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  vertexShader: LOGV + `varying vec3 vW; void main(){ vec4 w=modelMatrix*vec4(position,1.0); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w;
    #include <logdepthbuf_vertex>
  }`,
  fragmentShader: LOGF + `uniform float radii[5]; uniform vec3 colors[5]; uniform float k; uniform float hi; varying vec3 vW;
    void main(){
      #include <logdepthbuf_fragment>
      vec3 V = normalize(vW - cameraPosition); float traw = -dot(cameraPosition, V); float t = max(traw, 0.0);
      float h = length(cameraPosition + V*t);
      if(h < 1.0) discard;
      float ahead = smoothstep(0.0, 0.02, traw);
      float pix = max(length(cameraPosition - (cameraPosition+V*t)), 1e-4) * 0.0016;
      vec3 c = vec3(0.0); float lo = 1.0;
      for(int i=0;i<5;i++){
        float r = radii[i];
        float w = max(pix, (r-1.0)*0.006);
        float line = exp(-pow((h - r)/w, 2.0));
        float inside = step(lo, h) * step(h, r);
        float hl = (abs(float(i) - hi) < 0.5) ? 2.6 : 1.0;
        float camIn = step(lo, length(cameraPosition)) * step(length(cameraPosition), r);
        float fill = ahead * inside * (1.0 - camIn*0.85) * (i==4 ? 0.006 : 0.045) * (0.25 + 0.75*smoothstep(lo, r, h));
        c += colors[i] * (line * (i==4 ? 0.18 : 0.38) + fill) * hl;
        lo = r;
      }
      gl_FragColor = vec4(pow(c, vec3(1.0/1.6)) * k, 1.0);
    }`,
}));
layerShell.renderOrder = 8; scene.add(layerShell);

/* ── Van Allen belts: particle cloud on dipole field lines, drifting (model) ── */
const belts = (() => {
  const n = IS_TOUCH ? 22000 : 46000, L = new Float32Array(n), lam = new Float32Array(n), phi = new Float32Array(n), kind = new Float32Array(n);
  const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  for (let i = 0; i < n; i++) {
    const inner = Math.random() < 0.42; kind[i] = inner ? 0 : 1;
    let l = inner ? 1.55 + gauss() * 0.22 : 4.6 + gauss() * 0.85; l = inner ? clamp(l, 1.2, 2.4) : clamp(l, 3.0, 7.0);
    const lmax = Math.acos(Math.sqrt(1 / l));
    let la; do { la = (Math.random() * 2 - 1) * lmax * 0.82; } while (Math.random() > Math.pow(Math.cos(la), 6));
    L[i] = l; lam[i] = la; phi[i] = Math.random() * Math.PI * 2;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('aL', new THREE.BufferAttribute(L, 1)); g.setAttribute('aLam', new THREE.BufferAttribute(lam, 1));
  g.setAttribute('aPhi', new THREE.BufferAttribute(phi, 1)); g.setAttribute('aKind', new THREE.BufferAttribute(kind, 1));
  const m = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, k: { value: 0 }, dpr: { value: renderer.getPixelRatio() }, c0: { value: new THREE.Color(BELTS[0].color) }, c1: { value: new THREE.Color(BELTS[1].color) } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: LOGV + `attribute float aL; attribute float aLam; attribute float aPhi; attribute float aKind; uniform float time; uniform float dpr; uniform vec3 c0; uniform vec3 c1; varying vec3 vC;
      void main(){
        float r = aL * pow(cos(aLam), 2.0);
        float ph = aPhi + time * (aKind < 0.5 ? -0.010 : 0.024) / aL;   // protons drift west, electrons east
        vec3 p = vec3(r*cos(aLam)*cos(ph), r*sin(aLam), -r*cos(aLam)*sin(ph));
        vec4 mv = modelViewMatrix*vec4(p,1.0); gl_Position = projectionMatrix*mv;
        gl_PointSize = clamp(30.0/(-mv.z), 2.5, 9.0)*dpr;
        vC = (aKind < 0.5 ? c0 : c1) * (aKind < 0.5 ? 0.16 : 0.17);
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: LOGF + `uniform float k; varying vec3 vC; void main(){
        #include <logdepthbuf_fragment>
        vec2 p=gl_PointCoord-0.5; float a=exp(-dot(p,p)*12.0); gl_FragColor=vec4(vC*a*k,1.0); }`,
  });
  const pts = new THREE.Points(g, m); pts.frustumCulled = false;
  const grp = new THREE.Group(); grp.add(pts);
  // IGRF-14 (2025) north geomagnetic pole ≈ 80.8°N 72.6°W
  grp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), llToVec(80.8, -72.6));
  earthGroup.add(grp); return { grp, m };
})();

/* ── orbit guides (equatorial rings at regime boundaries) ── */
const guides = new THREE.Group(); scene.add(guides);
const GUIDE_RINGS = [
  { km: 550, label: 'STARLINK SHELL 550 KM', op: 0.18 }, { km: 2000, label: 'LEO LIMIT 2,000 KM', op: 0.22 },
  { km: 20200, label: 'GPS 20,200 KM', op: 0.22 }, { km: 35786, label: 'GEOSTATIONARY 35,786 KM', op: 0.42 },
];
GUIDE_RINGS.forEach((g) => {
  const r = 1 + g.km / RE, pts = [];
  for (let i = 0; i <= 360; i++) { const a = i * DEG; pts.push(new THREE.Vector3(Math.cos(a) * r, 0, -Math.sin(a) * r)); }
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: 0xbcd0ea, transparent: true, opacity: g.op, dashSize: r * 0.02, gapSize: r * 0.015, depthWrite: false }));
  line.computeLineDistances(); line.userData = g; guides.add(line); g.line = line; g.r = r;
});

/* ════════════════════════ MOON ════════════════════════ */
const moonMat = new THREE.MeshStandardMaterial({ color: 0xbdb7aa, roughness: 0.96, metalness: 0 });
const moonGeo = new THREE.SphereGeometry(1737.4 / RE, 96, 48); moonGeo.rotateY(-Math.PI / 2);
const moon = new THREE.Mesh(moonGeo, moonMat); scene.add(moon);
let moonOrbit = null;
function buildMoonOrbit(ms) {
  if (moonOrbit) { scene.remove(moonOrbit); moonOrbit.geometry.dispose(); }
  const pts = []; const v = new THREE.Vector3();
  for (let h = -14 * 24; h <= 14 * 24; h += 3) {
    const t = ms + h * 3600e3; updatePrecession(t);
    if (!(ephem.moon && ephem.moon.at(t, v))) moonFallback(t, v); pts.push(v.clone());
  }
  updatePrecession(ms);
  moonOrbit = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xe8e2d0, transparent: true, opacity: 0.22, depthWrite: false }));
  scene.add(moonOrbit);
}

/* ════════════════════════ OBJECT MODELS ════════════════════════ */
function merge(parts) { // [[geometry, hex], ...] -> one geometry with vertex colors
  let n = 0; const gs = parts.map(([g, c]) => { const ng = g.index ? g.toNonIndexed() : g; n += ng.attributes.position.count; return [ng, new THREE.Color(c)]; });
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3); let o = 0;
  for (const [g, c] of gs) {
    const p = g.attributes.position.array, q = g.attributes.normal.array;
    pos.set(p, o * 3); nor.set(q, o * 3);
    for (let i = 0; i < g.attributes.position.count; i++) col.set([c.r, c.g, c.b], (o + i) * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeBoundingSphere(); return out;
}
const B = (w, h, d, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const C = (r, l, x = 0, y = 0, z = 0, axis = 'x') => { const g = new THREE.CylinderGeometry(r, r, l, 14); if (axis === 'x') g.rotateZ(Math.PI / 2); if (axis === 'z') g.rotateX(Math.PI / 2); return g.translate(x, y, z); };
const GOLD = '#c9a24c', PANEL = '#1f3a66', WHITE = '#e8ecf2', GREY = '#9aa3b0', DARK = '#3a3f48';
// model axes: +X = flight direction, +Y = zenith (away from Earth), +Z = orbit normal
const MODELS = {
  generic: merge([[B(0.32, 0.32, 0.32), GOLD], [B(0.02, 0.02, 0.4, 0, 0, 0.36), GREY], [B(0.02, 0.02, 0.4, 0, 0, -0.36), GREY],
    [B(0.3, 0.01, 0.5, 0, 0, 0.68), PANEL], [B(0.3, 0.01, 0.5, 0, 0, -0.68), PANEL], [C(0.07, 0.12, 0, 0.2, 0, 'y'), WHITE]]),
  starlink: merge([[B(0.6, 0.06, 0.3), GREY], [B(0.04, 0.04, 0.2, 0, 0.05, 0.25), DARK], [B(0.55, 0.01, 1.1, 0, 0.08, 0.9), PANEL]]),
  nav: merge([[B(0.36, 0.36, 0.5), GOLD], [B(0.3, 0.012, 0.9, 0, 0, 0.75), PANEL], [B(0.3, 0.012, 0.9, 0, 0, -0.75), PANEL], [C(0.12, 0.06, 0, -0.21, 0, 'y'), WHITE]]),
  geo: merge([[B(0.4, 0.4, 0.4), GOLD], [B(0.34, 0.012, 1.25, 0, 0, 0.92), PANEL], [B(0.34, 0.012, 1.25, 0, 0, -0.92), PANEL],
    [new THREE.SphereGeometry(0.2, 16, 8, 0, Math.PI * 2, 0, 1.0).scale(1, 0.4, 1).translate(0.22, -0.18, 0), WHITE], [new THREE.SphereGeometry(0.16, 16, 8, 0, Math.PI * 2, 0, 1.0).scale(1, 0.4, 1).translate(-0.22, -0.18, 0), WHITE]]),
  debris: (() => { const g = new THREE.IcosahedronGeometry(0.32, 0); const p = g.attributes.position; for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * (0.5 + Math.random()), p.getY(i) * (0.3 + Math.random() * 0.8), p.getZ(i) * (0.6 + Math.random() * 0.7)); g.computeVertexNormals(); return merge([[g, '#8a6f5c']]); })(),
  rocket: merge([[C(0.16, 1.0, 0, 0, 0, 'x'), '#d8d8d2'], [new THREE.ConeGeometry(0.2, 0.25, 14).rotateZ(Math.PI / 2).translate(-0.6, 0, 0), DARK]]),
};
const ISS_GEO = (() => {
  const parts = [[B(2.2, 0.06, 0.06), GREY]];
  for (const sx of [-1, 1]) for (const k of [0.78, 1.02]) for (const sz of [-1, 1]) parts.push([B(0.17, 0.008, 0.72, sx * k, 0, sz * 0.42), '#b98a3a']);
  parts.push([B(0.32, 0.01, 0.2, 0.32, 0.02, 0), WHITE], [B(0.32, 0.01, 0.2, -0.32, 0.02, 0), WHITE]);
  parts.push([C(0.07, 0.95, 0, 0, -0.05, 'z'), WHITE], [C(0.065, 0.42, 0, 0, 0.62, 'z'), WHITE], [C(0.06, 0.3, 0.18, 0, -0.42, 'x'), WHITE], [C(0.06, 0.3, -0.18, 0, -0.42, 'x'), WHITE]);
  parts.push([B(0.05, 0.005, 0.5, 0, 0, 1.0), '#33507a'], [B(0.5, 0.005, 0.05, 0, 0, 1.0), '#33507a']);
  return merge(parts).rotateY(Math.PI / 2); // modules along flight direction
})();
const CSS_GEO = merge([[C(0.08, 0.75, 0, 0, 0, 'x'), WHITE], [C(0.075, 0.6, 0.3, 0, 0, 'z'), WHITE], [B(0.12, 0.008, 1.1, 0.3, 0, 0.9), PANEL], [B(0.12, 0.008, 1.1, 0.3, 0, -0.9), PANEL], [B(0.12, 0.008, 0.5, -0.2, 0, 0.35), PANEL], [B(0.12, 0.008, 0.5, -0.2, 0, -0.35), PANEL]]);
const modelMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.35, roughness: 0.55 });
const MODEL_FOR = ['generic', 'starlink', 'generic', 'nav', 'geo', 'generic', 'debris', 'rocket'];
const instanced = {};
for (const k of Object.keys(MODELS)) { const im = new THREE.InstancedMesh(MODELS[k], modelMat, 160); im.count = 0; im.frustumCulled = false; scene.add(im); instanced[k] = im; }
const issMesh = new THREE.Mesh(ISS_GEO, modelMat); issMesh.visible = false; scene.add(issMesh);
const cssMesh = new THREE.Mesh(CSS_GEO, modelMat); cssMesh.visible = false; scene.add(cssMesh);
const neoGeos = [0, 1, 2, 3, 4].map((s) => {
  const g = new THREE.IcosahedronGeometry(0.5, 2); const p = g.attributes.position; const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i); const n = Math.sin(v.x * 7 + s) * Math.sin(v.y * 5 + s * 2) * Math.sin(v.z * 6 - s) * 0.18 + Math.sin(v.x * 13 + v.z * 11) * 0.05;
    v.multiplyScalar(1 + n); v.x *= 1.0 + s * 0.12; p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals(); return g;
});
const neoMat = new THREE.MeshStandardMaterial({ color: 0x8c8178, roughness: 1, metalness: 0, flatShading: true });

/* ════════════════════════ SATELLITES ════════════════════════ */
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
class SatEngine {
  constructor() { this.n = 0; this.points = null; this.cursor = 0; this.counts = new Array(CLASSES.length).fill(0); }
  setRecords(recs) {
    this.recs = recs; const n = this.n = recs.length;
    this.r0 = new Float64Array(n * 3); this.c0 = new Float64Array(n * 3); this.w = new Float64Array(n); this.t0 = new Float64Array(n);
    this.speed = new Float32Array(n); this.ok = new Uint8Array(n);
    this.pos = new Float32Array(n * 3); this.alt = new Float32Array(n);
    this.cls = new Float32Array(n); this.vis = new Float32Array(n).fill(1); this.alpha = new Float32Array(n);
    this.counts.fill(0);
    recs.forEach((r, i) => { this.cls[i] = r.c; this.counts[r.c]++; });
    this.byNorad = new Map(recs.map((r, i) => [r.norad, i]));
    if (this.points) { scene.remove(this.points); this.points.geometry.dispose(); }
    const g = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3); this.posAttr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.posAttr); g.setAttribute('cls', new THREE.BufferAttribute(this.cls, 1));
    this.visAttr = new THREE.BufferAttribute(this.vis, 1); g.setAttribute('vis', this.visAttr);
    this.points = new THREE.Points(g, satMat); this.points.frustumCulled = false; this.points.renderOrder = 10; scene.add(this.points);
    const ms = simNow(); this.fullPropagate(ms); this.place(ms); // positions are ready before the first frame (deep links fly straight to them)
  }
  propagateOne(i, ms, date) {
    const r = this.recs[i];
    let pv; try { pv = satellite.propagate(r.satrec, date); } catch { pv = null; }
    if (!pv || !pv.position || isNaN(pv.position.x) || r.satrec.error) { this.ok[i] = 0; this.vis[i] = 0; return; }
    const p = pv.position, v = pv.velocity;
    const hx = p.y * v.z - p.z * v.y, hy = p.z * v.x - p.x * v.z, hz = p.x * v.y - p.y * v.x;
    const h = Math.hypot(hx, hy, hz), rr = p.x * p.x + p.y * p.y + p.z * p.z;
    const kx = hx / h, ky = hy / h, kz = hz / h;
    const o = i * 3;
    this.r0[o] = p.x; this.r0[o + 1] = p.y; this.r0[o + 2] = p.z;
    this.c0[o] = ky * p.z - kz * p.y; this.c0[o + 1] = kz * p.x - kx * p.z; this.c0[o + 2] = kx * p.y - ky * p.x;
    this.w[i] = h / rr; this.t0[i] = ms; this.speed[i] = Math.hypot(v.x, v.y, v.z);
    if (!this.ok[i]) { this.ok[i] = 1; this.vis[i] = 1; this.visDirty = true; }
  }
  fullPropagate(ms) { if (!this.n) return; const d = new Date(ms); for (let i = 0; i < this.n; i++) this.propagateOne(i, ms, d); this.visDirty = true; }
  step(ms) {
    const n = this.n; if (!n) return;
    const chunk = Math.ceil(n / (clock.rate > 100 ? 4 : 8)); const d = new Date(ms);
    for (let k = 0; k < chunk; k++) { this.propagateOne(this.cursor, ms, d); this.cursor = (this.cursor + 1) % n; }
    this.place(ms);
  }
  // Advance every orbit from its last SGP4 fix with a cheap rotation, and write the render positions.
  place(ms) {
    const n = this.n; if (!n) return;
    const P = this.pos, A = this.alt, r0 = this.r0, c0 = this.c0;
    for (let i = 0; i < n; i++) {
      const o = i * 3; if (!this.ok[i]) { P[o] = P[o + 1] = P[o + 2] = 0; A[i] = -1; continue; }
      const a = this.w[i] * (ms - this.t0[i]) / 1000, ca = Math.cos(a), sa = Math.sin(a);
      const x = r0[o] * ca + c0[o] * sa, y = r0[o + 1] * ca + c0[o + 1] * sa, z = r0[o + 2] * ca + c0[o + 2] * sa;
      P[o] = x / RE; P[o + 1] = z / RE; P[o + 2] = -y / RE;
      A[i] = Math.sqrt(x * x + y * y + z * z) - RE;
    }
    this.posAttr.needsUpdate = true;
    if (this.visDirty) { this.visAttr.needsUpdate = true; this.visDirty = false; }
  }
  posOf(i, out) { return out.set(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]); }
}
const satMat = new THREE.ShaderMaterial({
  uniforms: {
    colors: { value: CLASSES.map((c) => new THREE.Color(c.color)) }, sizes: { value: CLASSES.map((c) => c.size) },
    mask: { value: CLASSES.map(() => 1) }, bands: { value: [1, 1, 1, 1] }, camAlt: { value: 1e5 }, focus: { value: 1 },
    dpr: { value: 1 }, sel: { value: -1 }, hov: { value: -1 }, k: { value: 1 },
  },
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  vertexShader: LOGV + `attribute float cls; attribute float vis;
    uniform vec3 colors[8]; uniform float sizes[8]; uniform float mask[8]; uniform float bands[4];
    uniform float camAlt; uniform float focus; uniform float dpr; uniform float sel; uniform float hov;
    varying vec3 vC; varying float vA; varying float vRing;
    void main(){
      int c = int(cls + 0.5);
      float alt = (length(position) - 1.0) * 6371.0;
      float a = mask[c] * vis;
      a *= alt < 2000.0 ? bands[0] : (alt < 35586.0 ? bands[1] : (alt < 35986.0 ? bands[2] : bands[3]));
      if (focus > 0.5) { float lim = camAlt*2.6 + 350.0; a *= 1.0 - smoothstep(lim, lim*2.6 + 600.0, alt); }
      float id = float(gl_VertexID);
      float isSel = (abs(id - sel) < 0.5 || abs(id - hov) < 0.5) ? 1.0 : 0.0;
      if (isSel > 0.5) a = max(a, 1.0);
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mv;
      float near = clamp(0.9 / max(-mv.z, 1e-4), 1.0, 2.2);
      gl_PointSize = sizes[c] * near * dpr * (isSel > 0.5 ? 2.6 : 1.0);
      vC = colors[c]; vA = a; vRing = isSel;
      if (a < 0.01) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      #include <logdepthbuf_vertex>
    }`,
  fragmentShader: LOGF + `uniform float k; varying vec3 vC; varying float vA; varying float vRing;
    void main(){
      #include <logdepthbuf_fragment>
      vec2 p = gl_PointCoord - 0.5; float d = length(p);
      float a = smoothstep(0.5, 0.12, d) * 0.85 + smoothstep(0.22, 0.0, d) * 0.6;
      if (vRing > 0.5) a = smoothstep(0.5, 0.42, d) * smoothstep(0.30, 0.38, d) + smoothstep(0.14, 0.0, d);
      gl_FragColor = vec4(vC * a * vA * k, 1.0);
    }`,
});
let sats = null;

function parseBundledTLE(text) {
  const L = text.split('\n'), out = [];
  for (let i = 0; i + 2 < L.length; i += 3) {
    const [c, ...nm] = L[i].split('|'); const rec = makeRec(nm.join('|'), L[i + 1], L[i + 2], CLS_INDEX[c] ?? 5); if (rec) out.push(rec);
  }
  return out;
}
const DOCKED = /^(ISS|CSS) \((?!ZARYA|TIANHE)|^POISK$/;
function classify(name, l1, l2) {
  const norad = +l1.slice(2, 7);
  if (norad === 25544 || norad === 48274) return 0;
  if (/STARLINK/.test(name)) return 1;
  if (/ONEWEB|KUIPER|QIANFAN|GUOWANG|HULIANWANG/.test(name)) return 2;
  if (/GPS |NAVSTAR|GLONASS|GALILEO|GSAT0|BEIDOU|IRNSS|NAVIC|QZS/.test(name)) return 3;
  if (/R\/B/.test(name)) return 7;
  if (/ DEB/.test(name)) return 6;
  const mm = +l2.slice(52, 63), ecc = +('0.' + l2.slice(26, 33));
  if (mm > 0.98 && mm < 1.02 && ecc < 0.02) return 4;
  return 5;
}
function parseRawTLE(text, debris = false) {
  const L = text.split(/\r?\n/).map((s) => s.trimEnd()).filter(Boolean), out = [];
  for (let i = 0; i + 2 < L.length + 1; i += 3) {
    const nm = (L[i] || '').trim(), l1 = L[i + 1], l2 = L[i + 2];
    if (!l1 || !l2 || !l1.startsWith('1 ') || !l2.startsWith('2 ')) continue;
    if (DOCKED.test(nm)) continue;
    let c = classify(nm, l1, l2); if (debris && c === 5) c = 6;
    const rec = makeRec(nm, l1, l2, c); if (rec) out.push(rec);
  }
  return out;
}
function makeRec(name, l1, l2, c) {
  let satrec; try { satrec = satellite.twoline2satrec(l1, l2); } catch { return null; }
  if (!satrec || satrec.error) return null;
  const y = l1.slice(9, 11).trim(), cos = y ? `${+y < 57 ? '20' : '19'}${y}-${l1.slice(11, 14)}${l1.slice(14, 17).trim()}` : '—';
  // Copy the name so it doesn't keep a reference into the multi-megabyte catalogue text.
  return { name: Array.from(name.trim()).join(''), c, satrec, norad: +l1.slice(2, 7), cospar: cos, epoch: (satrec.jdsatepoch - 2440587.5) * 86400000 };
}
function orbitInfo(rec) {
  const s = rec.satrec, n = s.no / 60, a = Math.cbrt(MU / (n * n));
  return { inc: s.inclo / DEG, ecc: s.ecco, period: 2 * Math.PI / s.no, apo: a * (1 + s.ecco) - RE, peri: a * (1 - s.ecco) - RE, a };
}

/* ════════════════════════ NEOs ════════════════════════ */
const neos = [];
const neoTrails = new THREE.Group(); scene.add(neoTrails);
function buildNeos(list) {
  list.forEach((d, i) => {
    const e = makeEphem(d.vec);
    const mesh = new THREE.Mesh(neoGeos[i % neoGeos.length], neoMat); mesh.visible = false; scene.add(mesh);
    const spin = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    const caMs = Date.parse(d.cd.replace(/(\d{4})-(\w{3})-(\d{2}) (\d{2}:\d{2})/, '$2 $3 $1 $4 UTC'));
    const o = { kind: 'neo', d, e, mesh, spin, rate: 0.3 + Math.random() * 1.4, p: new THREE.Vector3(), vel: new THREE.Vector3(), on: false, caMs, idx: i };
    o.pos = () => o.p; neos.push(o);
    // trajectory: past dim, future brighter
    const pts = [], cols = []; const v = new THREE.Vector3(); const col = new THREE.Color(NEO_COLOR);
    for (let k = 0; k < d.vec.length; k += 2) {
      const r = d.vec[k]; updatePrecession(r[0] * 1000); eciToThree(r[1], r[2], r[3], v).applyQuaternion(precessQ); pts.push(v.x, v.y, v.z);
      cols.push(col.r, col.g, col.b);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    const line = new THREE.Line(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }));
    o.trail = line; o.trailT = d.vec.filter((r, k) => k % 2 === 0).map((r) => r[0] * 1000); neoTrails.add(line);
  });
  updatePrecession(simNow());
}
const neoGlow = (() => {
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(64 * 3), 3));
  const m = new THREE.PointsMaterial({ color: NEO_COLOR, size: 26, sizeAttenuation: false, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending,
    map: (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,255,255,.0)'); gr.addColorStop(0.45, 'rgba(255,255,255,.05)'); gr.addColorStop(0.62, 'rgba(255,255,255,.9)'); gr.addColorStop(0.7, 'rgba(255,255,255,.25)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })() });
  const p = new THREE.Points(g, m); p.frustumCulled = false; scene.add(p); return p;
})();

/* ════════════════════════ LAYERS STATE ════════════════════════ */
const LAYER_TOGGLES = [
  ['atmo', 'Atmosphere layers', true], ['aurora', 'Aurora oval', true], ['belts', 'Radiation belts', true], ['guides', 'Orbit rings', true],
  ['borders', 'Borders & grid', true], ['labels', 'Labels', true], ['dust', 'Space dust', true], ['focus', 'Altitude focus', true],
];
const layersOn = Object.fromEntries(LAYER_TOGGLES.map(([k, , d]) => [k, store.get('layer.' + k, d)]));
const classOn = CLASSES.map((c, i) => store.get('class.' + c.key, true));
let neoOn = store.get('class.neo', true);
const bandsOn = [1, 1, 1, 1];

/* ════════════════════════ PICKING, TOOLTIP, LABELS ════════════════════════ */
let hover = null, selected = null;
const _p = new THREE.Vector3();
function project(v, out) { _p.copy(v).project(camera); if (_p.z > 1 || _p.z < -1) return false; out.x = (_p.x + 1) / 2 * innerWidth; out.y = (1 - _p.y) / 2 * innerHeight; return true; }
function occluded(v) { // is the segment camera→v blocked by the Earth?
  const c = camera.position; const dx = v.x - c.x, dy = v.y - c.y, dz = v.z - c.z; const dd = dx * dx + dy * dy + dz * dz;
  const t = clamp(-(c.x * dx + c.y * dy + c.z * dz) / dd, 0, 1); if (t >= 0.9999) return false;
  const x = c.x + dx * t, y = c.y + dy * t, z = c.z + dz * t; return x * x + y * y + z * z < 0.9995;
}
const satObj = (i) => ({ kind: 'sat', i, rec: sats.recs[i], pos: () => sats.posOf(i, new THREE.Vector3()) });
const moonObj = { kind: 'moon', pos: () => moon.position };
function sameObj(a, b) { return a && b && a.kind === b.kind && (a.kind === 'sat' ? a.i === b.i : a.kind === 'neo' ? a.idx === b.idx : true); }
function pick(mx, my) {
  const r = IS_TOUCH ? 26 : 14; let best = null, bd = r * r; const s = { x: 0, y: 0 };
  const proj = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); const e = proj.elements;
  if (sats) {
    const P = sats.pos, A = sats.alpha, W = innerWidth, H = innerHeight;
    for (let i = 0; i < sats.n; i++) {
      if (A[i] < 0.1) continue;
      const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
      const w = e[3] * x + e[7] * y + e[11] * z + e[15]; if (w <= 0) continue;
      const sx = ((e[0] * x + e[4] * y + e[8] * z + e[12]) / w + 1) / 2 * W, sy = (1 - (e[1] * x + e[5] * y + e[9] * z + e[13]) / w) / 2 * H;
      const d = (sx - mx) ** 2 + (sy - my) ** 2;
      if (d < bd) { _v.set(x, y, z); if (!occluded(_v)) { bd = d; best = i; } }
    }
  }
  let obj = best != null ? satObj(best) : null;
  for (const n of neos) if (n.on && project(n.p, s)) { const d = (s.x - mx) ** 2 + (s.y - my) ** 2; if (d < bd && !occluded(n.p)) { bd = d; obj = n; } }
  if (project(moon.position, s)) {
    const rpx = moonPixelRadius() + r; const d = (s.x - mx) ** 2 + (s.y - my) ** 2;
    if (d < rpx * rpx && (!obj || d < bd + 200) && !occluded(moon.position)) obj = moonObj;
  }
  return obj;
}
function moonPixelRadius() { const d = camera.position.distanceTo(moon.position); return (1737.4 / RE) / d / Math.tan(camera.fov * DEG / 2) * innerHeight / 2; }
function setHover(o) {
  if (sameObj(o, hover)) return; hover = o; canvas.classList.toggle('hovering', !!o);
  satMat.uniforms.hov.value = o && o.kind === 'sat' ? o.i : -1;
  tipTick = 0; $('tip').hidden = !o;
}
function onTap(e) {
  const o = pick(e.clientX, e.clientY);
  if (IS_TOUCH) { if (o && sameObj(o, hover)) { select(o, true); return; } setHover(o); if (o) mouse.x = e.clientX, mouse.y = e.clientY; return; }
  if (o) select(o, false); else if (selected) { select(null); }
}
let tipTick = 0;
function objInfo(o) { // shared by tooltip & detail panel
  const ms = simNow();
  if (o.kind === 'sat') {
    const r = o.rec, oi = orbitInfo(r), i = o.i, alt = sats.alt[i], spd = sats.speed[i];
    const gm = satellite.gstime(new Date(ms));
    const o3 = i * 3, eci = { x: sats.pos[o3] * RE, y: -sats.pos[o3 + 2] * RE, z: sats.pos[o3 + 1] * RE };
    const geo = satellite.eciToGeodetic(eci, gm);
    const lat = geo.latitude / DEG, lon = geo.longitude / DEG;
    return { title: r.name, kind: CLASSES[r.c].name, color: CLASSES[r.c].color, shape: CLASSES[r.c].shape,
      ids: `NORAD ${r.norad} · COSPAR ${r.cospar}`,
      rows: [['Altitude', fmt(alt) + ' km'], ['Speed', fmt(spd, 2) + ' km/s'], ['Sub-point', `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? 'E' : 'W'}`],
        ['Inclination', oi.inc.toFixed(2) + '°'], ['Period', oi.period > 300 ? (oi.period / 60).toFixed(2) + ' h' : oi.period.toFixed(1) + ' min'],
        ['Perigee / apogee', `${fmt(oi.peri)} / ${fmt(oi.apo)} km`], ['Eccentricity', oi.ecc.toFixed(5)], ['Orbit data age', ageStr(ms - r.epoch)]],
      layer: whereIs(alt), oi };
  }
  if (o.kind === 'neo') {
    const d = o.d, dist = o.p.length() * RE, rel = o.vel.length();
    const ca = new Date(o.caMs), past = o.caMs < ms;
    return { title: d.name.replace(/[()]/g, '').trim(), kind: 'Near-Earth asteroid', color: NEO_COLOR, shape: 'ring', ids: `JPL designation ${d.des}`,
      rows: [['Distance now', `${fmt(dist)} km`], ['', `${(dist / LD).toFixed(2)} lunar distances`], ['Speed vs Earth', `${rel.toFixed(2)} km/s`],
        [past ? 'Closest was' : 'Closest on', `${ca.toUTCString().slice(5, 22)} UTC`], ['Miss distance', `${fmt(d.dist_au * AU)} km (${(d.dist_au * AU / LD).toFixed(2)} LD)`],
        ['Est. diameter', d.diameter ? `${(+d.diameter * 1000).toFixed(0)} m` : `${fmt(d.dmin)}–${fmt(d.dmax)} m`], ['Abs. magnitude H', d.h.toFixed(1)]],
      layer: dist > LD ? 'Beyond the Moon' : 'Inside lunar distance' };
  }
  const dist = moon.position.length() * RE;
  return { title: 'The Moon', kind: 'Natural satellite', color: '#e8e2d0', shape: '', ids: 'Radius 1,737 km',
    rows: [['Distance', fmt(dist) + ' km'], ['Light time', (dist / 299792.458).toFixed(2) + ' s'], ['Phase', moonPhase()], ['Position from', moonState.source]], layer: 'Cislunar space' };
}
function moonPhase() {
  const m = moon.position.clone().normalize(); const el = Math.acos(clamp(m.dot(sunDir), -1, 1)); const illum = (1 - Math.cos(el)) / 2;
  const waxing = new THREE.Vector3().crossVectors(sunDir, m).y > 0;
  const nm = illum < 0.03 ? 'New' : illum > 0.97 ? 'Full' : illum < 0.5 ? (waxing ? 'Waxing crescent' : 'Waning crescent') : Math.abs(illum - 0.5) < 0.04 ? (waxing ? 'First quarter' : 'Last quarter') : (waxing ? 'Waxing gibbous' : 'Waning gibbous');
  return `${nm}, ${(illum * 100).toFixed(0)}% lit`;
}
function ageStr(ms) { const h = ms / 3600e3; return h < 0 ? 'in the future' : h < 48 ? `${h.toFixed(1)} h` : `${(h / 24).toFixed(1)} days`; }
function whereIs(alt) {
  const l = LAYERS.find((x) => alt >= x.lo && alt < x.hi); const r = REGIMES.find((x) => alt >= x.lo && alt < x.hi);
  return [r && r.name, l && 'inside the ' + l.name.toLowerCase()].filter(Boolean).join(', ');
}
function renderTip() {
  if (!hover) return;
  const info = objInfo(hover);
  const rows = info.rows.slice(0, hover.kind === 'sat' ? 5 : 6).map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  $('tipBox').innerHTML = `<div class="t">${esc(info.title)}</div><div class="k cap" style="color:${info.color}">${info.kind}</div><dl>${rows}</dl>
    <div class="hint">${IS_TOUCH ? 'Tap again for details' : 'Click for details · double-click to fly there'}</div>`;
}
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function placeTip() {
  const tip = $('tip'); if (!hover) { tip.hidden = true; return; }
  const p = hover.pos(); const s = { x: 0, y: 0 };
  if (!project(p, s) || occluded(p)) { tip.style.opacity = '0'; return; }
  tip.style.opacity = '1'; tip.hidden = false;
  const box = $('tipBox'); const bw = box.offsetWidth + 30, bh = box.offsetHeight + 20;
  const flipX = s.x + bw > innerWidth - 8, flipY = s.y + bh > innerHeight - 8;
  tip.style.transform = `translate(${s.x}px, ${s.y}px) scale(${flipX ? -1 : 1}, ${flipY ? -1 : 1})`;
  box.style.transform = `scale(${flipX ? -1 : 1}, ${flipY ? -1 : 1})`;
  if (tipTick === 0 || performance.now() - tipT > 300) { tipT = performance.now(); tipTick = 1; renderTip(); }
}

/* labels: pool of absolutely positioned divs */
const labelPool = []; let labelUsed = 0;
function label(text, s, cls, dx = 8, dy = 0) {
  let el = labelPool[labelUsed];
  if (!el) { el = document.createElement('div'); el.innerHTML = '<i></i><span></span>'; $('labels').appendChild(el); labelPool.push(el); }
  labelUsed++;
  if (el._t !== text) { el.lastChild.textContent = text; el._t = text; }
  if (el._c !== cls) { el.className = 'lab ' + cls; el._c = cls; }
  el.style.display = ''; el.style.transform = `translate(${s.x + dx - 4}px, ${s.y + dy - 7}px)`;
}
const _labS = { x: 0, y: 0 }, _labV = new THREE.Vector3();
function drawLabels(alt) {
  labelUsed = 0; if (!layersOn.labels) { labelPool.forEach((l) => { l.style.display = 'none'; }); return; }
  const s = _labS, v = _labV;
  if (project(moon.position, s) && !occluded(moon.position)) label('MOON', s, 'big', moonPixelRadius() + 8);
  if (sats && alt < 60000) for (const nor of [25544, 48274]) {
    const i = sats.byNorad.get(nor); if (i == null || !sats.ok[i] || sats.alpha[i] < 0.1) continue;
    sats.posOf(i, v); if (project(v, s) && !occluded(v) && !(selected && selected.kind === 'sat' && selected.i === i)) label(nor === 25544 ? 'ISS' : 'TIANGONG', s, 'big', 12);
  }
  if (alt > 90000) for (const n of neos) if (n.on && project(n.p, s) && s.x > -50 && s.x < innerWidth + 50 && s.y > -50 && s.y < innerHeight + 50) label(n.d.des, s, 'neo', 13);
  if (selected && selected.kind === 'sat') { const p = selected.pos(); if (project(p, s) && !occluded(p)) label(selected.rec.name, s, 'sel', 14); }
  if (alt < 2600) {
    for (const [nm, la, lo] of SPACEPORTS) {
      llToVec(la, lo, 1.0, v); earthGroup.localToWorld(v);
      if (v.clone().sub(camera.position).dot(v) > 0) continue;
      if (project(v, s)) label(nm, s, 'port', 6);
    }
  }
  if (layersOn.atmo && layerShell.material.uniforms.k.value > 0.2) layerLabels(s);
  let lastRing = null;
  if (layersOn.guides && alt > 3000) for (const g of GUIDE_RINGS) {
    if (g.line.material.opacity < 0.05 || g.r / camera.position.length() < 0.08) continue;
    const a = Math.atan2(camera.position.x, camera.position.z) + Math.PI / 2;
    v.set(Math.sin(a) * g.r, 0, Math.cos(a) * g.r); if (project(v, s) && !occluded(v) && (!lastRing || Math.hypot(s.x - lastRing.x, s.y - lastRing.y) > 150)) { label(g.label, s, 'ring', 4, -10); lastRing = { x: s.x, y: s.y }; }
  }
  for (let i = labelUsed; i < labelPool.length; i++) labelPool[i].style.display = 'none';
}
const _ray = new THREE.Vector3(), _ndc = new THREE.Vector3();
function impactAt(sx, sy) { // closest distance to Earth centre of the view ray through screen point
  _ndc.set(sx / innerWidth * 2 - 1, 1 - sy / innerHeight * 2, 0.5).unproject(camera);
  _ray.copy(_ndc).sub(camera.position).normalize(); const t = Math.max(-camera.position.dot(_ray), 0);
  return camera.position.clone().addScaledVector(_ray, t).length();
}
function layerLabels(s) {
  const ec = { x: innerWidth / 2, y: innerHeight / 2 }; const onS = project(new THREE.Vector3(), ec);
  const xc = onS && ec.x > 120 && ec.x < innerWidth - 120 ? ec.x : innerWidth * 0.5;
  const yBottom = onS && ec.y > 0 && ec.y < innerHeight ? ec.y : innerHeight;
  let lastY = -Infinity;
  [...LAYERS].reverse().forEach((l) => {
    const R = 1 + l.hi / RE; if (R >= camera.position.length()) return;
    let lo = 0, hi = yBottom; if (impactAt(xc, lo) < R || impactAt(xc, hi) > R) return;
    for (let k = 0; k < 18; k++) { const m = (lo + hi) / 2; if (impactAt(xc, m) > R) lo = m; else hi = m; }
    const y = (lo + hi) / 2; if (y - lastY < 14 || y < 70) return; lastY = y;
    s.x = xc; s.y = y; label(`${l.name.toUpperCase()} · ${fmt(l.hi)} KM`, s, 'ring', 6, -7);
  });
}

/* ════════════════════════ UI ════════════════════════ */
function swatch(c) { return `<span class="sw ${c.shape || ''}" style="background:${c.color};color:${c.color}"></span>`; }
function buildClassUI() {
  const box = $('classes');
  box.innerHTML = CLASSES.map((c, i) => `<button class="row${classOn[i] ? '' : ' off'}" data-ci="${i}" aria-pressed="${classOn[i]}">${swatch(c)}<span class="nm">${c.name}</span><span class="ct mono" id="ct${i}">–</span></button>`).join('')
    + `<button class="row${neoOn ? '' : ' off'}" data-ci="neo" aria-pressed="${neoOn}">${swatch({ color: NEO_COLOR, shape: 'ring' })}<span class="nm">Near-Earth asteroids</span><span class="ct mono" id="ctneo">–</span></button>`;
  box.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.ci;
    if (k === 'neo') { neoOn = !neoOn; store.set('class.neo', neoOn); b.classList.toggle('off', !neoOn); b.setAttribute('aria-pressed', neoOn); return; }
    const i = +k; classOn[i] = !classOn[i]; store.set('class.' + CLASSES[i].key, classOn[i]); b.classList.toggle('off', !classOn[i]); b.setAttribute('aria-pressed', classOn[i]);
    satMat.uniforms.mask.value[i] = classOn[i] ? 1 : 0;
  }));
  CLASSES.forEach((c, i) => { satMat.uniforms.mask.value[i] = classOn[i] ? 1 : 0; });
  // hide the rocket-body row if that class is empty in this catalogue
}
function buildLayerUI() {
  $('layers').innerHTML = LAYER_TOGGLES.map(([k, nm]) => `<button class="tg" data-k="${k}" aria-pressed="${layersOn[k]}"><span>${nm}</span><span class="sw-t" aria-hidden="true"></span></button>`).join('');
  $('layers').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.k; layersOn[k] = !layersOn[k]; store.set('layer.' + k, layersOn[k]); b.setAttribute('aria-pressed', layersOn[k]);
  }));
  $('imagery').querySelectorAll('button').forEach((b) => { b.onclick = () => setImagery(b.dataset.img); });
}
function syncTimeUI() {
  document.querySelectorAll('#rates button').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.rate === clock.rate)));
}
$('rates').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setRate(+b.dataset.rate); });
$('liveBtn').addEventListener('click', goLive);
$('back').addEventListener('click', () => jump(-3600e3));
$('fwd').addEventListener('click', () => jump(3600e3));
syncTimeUI();

/* detail panel */
let detailTick = 0;
function select(o, fly, fromRoute) {
  // free flight only rides along with the object it started next to while that object stays selected
  if (free.on && free.anchor && !(o && sameObj(o, free.anchor))) { freeWorld(free.pos); free.anchor = null; }
  selected = o; satMat.uniforms.sel.value = o && o.kind === 'sat' ? o.i : -1;
  if (!fromRoute) syncUrlToSelection(o); else document.title = o ? objTitle(o) : TITLES.explore;
  buildOrbitPath();
  const el = $('detail');
  if (!o) { el.hidden = true; $('side').style.visibility = ''; if (!free.on) releaseFollow(); return; }
  el.hidden = false; if (innerWidth > 860) $('side').style.visibility = 'hidden';
  closeSheets();
  renderDetail(true);
  if (fly) focusOn(o);
}
function focusOn(o) {
  const p = o.pos().clone(); if (p.lengthSq() < 0.5) return; // no valid position (e.g. a decayed orbit)
  if (o.kind === 'moon') { const a = angleFromDir(p.clone().negate().applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.5)); flyTo({ target: p, follow: o, dist: 1.4, az: a.az, el: a.el + 0.2 }); return; }
  const a = angleFromDir(p.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -0.35)); a.el = clamp(a.el + 0.25, -1.4, 1.4);
  const dist = o.kind === 'neo' ? Math.max(0.6, p.length() * 0.05) : clamp(p.length() * 0.09, 0.05, 0.9);
  flyTo({ target: p, follow: o, dist, az: a.az, el: a.el });
}
function renderDetail(full) {
  const o = selected; if (!o) return; const info = objInfo(o);
  if (full) {
    const link = o.kind === 'sat' ? `<a href="https://celestrak.org/satcat/table-satcat.php?CATNR=${o.rec.norad}" target="_blank" rel="noopener">CelesTrak record ↗</a>`
      : o.kind === 'neo' ? `<a href="https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html#/?sstr=${encodeURIComponent(o.d.des)}" target="_blank" rel="noopener">JPL database ↗</a>` : '';
    const note = o.kind === 'sat' ? 'Position computed in your browser with SGP4 from the published two-line element set. Accuracy is roughly 1 km at epoch and drifts a few km per day after.'
      : o.kind === 'neo' ? 'Position interpolated from JPL Horizons geocentric vectors. Diameter is estimated from brightness (albedo 0.05–0.25) unless measured.'
        : 'Moon position from JPL Horizons; the texture is a generic lunar map.';
    $('detail').innerHTML = `<button class="close" id="dClose" aria-label="Close details">×</button>
      <div class="kick cap" style="color:${info.color}">${swatch(info)}${info.kind}</div>
      <h2>${esc(info.title)}</h2><div class="ids mono">${info.ids}</div>
      <dl class="mono" id="dRows"></dl>
      <div class="ids" id="dWhere"></div>
      <div class="acts">${o.kind !== 'moon' ? `<button id="dSave" aria-pressed="${isSaved(o)}">${isSaved(o) ? '★ Saved' : '☆ Save'}</button>` : ''}<button id="dFollow" aria-pressed="${!!cam.follow}">Follow</button><button id="dFly">Fly to</button>${link}</div>
      <div class="note">${note}</div>`;
    $('dClose').onclick = () => select(null);
    $('dFly').onclick = () => focusOn(o);
    if ($('dSave')) $('dSave').onclick = () => toggleSave(o);
    $('dFollow').onclick = () => { if (cam.follow || (cam.fly && cam.fly.follow)) releaseFollow(); else focusOn(o); };
  }
  $('dRows').innerHTML = info.rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  $('dWhere').textContent = info.layer ? 'Now in: ' + info.layer : '';
  const f = $('dFollow'); if (f) f.setAttribute('aria-pressed', String(!!(cam.follow || (cam.fly && cam.fly.follow))));
}
let orbitLine = null;
function buildOrbitPath() {
  if (orbitLine) { scene.remove(orbitLine); orbitLine.geometry.dispose(); orbitLine = null; }
  const o = selected; if (!o || o.kind !== 'sat') return;
  const oi = orbitInfo(o.rec), pts = [], ms = simNow(), N = 360;
  for (let k = 0; k <= N; k++) {
    const t = new Date(ms + (k / N) * oi.period * 60e3); const pv = satellite.propagate(o.rec.satrec, t);
    if (pv.position) pts.push(eciToThree(pv.position.x, pv.position.y, pv.position.z, new THREE.Vector3()));
  }
  orbitLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x5aa9ff, transparent: true, opacity: 0.75, depthWrite: false }));
  orbitLine.userData.t = ms; scene.add(orbitLine);
}

/* search */
const qEl = $('q'); let results = [], resIdx = 0;
function doSearch() {
  const q = qEl.value.trim().toUpperCase(); const box = $('results');
  if (!q) { box.innerHTML = ''; results = []; return; }
  results = [];
  if ('MOON'.startsWith(q)) results.push({ o: moonObj, nm: 'The Moon', id: 'natural satellite', c: { color: '#e8e2d0' } });
  for (const n of neos) if (n.d.des.toUpperCase().includes(q) || n.d.name.toUpperCase().includes(q)) results.push({ o: n, nm: n.d.des, id: 'asteroid', c: { color: NEO_COLOR, shape: 'ring' } });
  if (sats) {
    const num = /^\d+$/.test(q) ? +q : null;
    if (num != null && sats.byNorad.has(num)) { const i = sats.byNorad.get(num); results.push({ o: satObj(i), nm: sats.recs[i].name, id: '#' + num, c: CLASSES[sats.recs[i].c] }); }
    for (let i = 0; i < sats.n && results.length < 40; i++) { const r = sats.recs[i]; if (r.name.includes(q) && r.norad !== num) results.push({ o: satObj(i), nm: r.name, id: '#' + r.norad, c: CLASSES[r.c] }); }
  }
  results = results.slice(0, 12); resIdx = 0;
  box.innerHTML = results.length ? results.map((r, i) => `<button role="option" data-i="${i}" class="${i === 0 ? 'on' : ''}">${swatch(r.c)}<span class="nm">${esc(r.nm)}</span><span class="id mono">${r.id}</span></button>`).join('')
    : `<div class="none">Nothing matches “${esc(qEl.value)}”. Try a name like STARLINK, ISS, GPS or a NORAD number.</div>`;
}
function pickResult(i) { const r = results[i]; if (!r) return; qEl.value = ''; $('results').innerHTML = ''; qEl.blur(); select(r.o, true); }
qEl.addEventListener('input', doSearch);
qEl.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); resIdx = clamp(resIdx + (e.key === 'ArrowDown' ? 1 : -1), 0, results.length - 1); $('results').querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i === resIdx)); }
  if (e.key === 'Enter') pickResult(resIdx);
  if (e.key === 'Escape') { qEl.value = ''; doSearch(); qEl.blur(); }
});
$('results').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) pickResult(+b.dataset.i); });
const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'KeyC', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight']);
const typing = (t) => t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
addEventListener('keydown', (e) => {
  if (e.target === qEl || typing(e.target)) return;
  if (e.key === 'Escape') {
    if (!$('navHelp').hidden) toggleNavHelp(false); else if (!$('mobileMenu').hidden) toggleMenu(false);
    else if (route === 'explore') { if (free.on) exitFree(); else select(null); }
  }
  if (route !== 'explore' || e.ctrlKey || e.metaKey) return;
  if (MOVE_KEYS.has(e.code)) {
    keys.add(e.code);
    // arrows, Space and Page keys steer the camera here, not the page (or a focused button)
    if (/^(Arrow|Space|Page)/.test(e.code) || (e.code.startsWith('Alt') && free.on)) { e.preventDefault(); if (e.target.tagName === 'BUTTON') e.target.blur(); }
  }
  if (e.repeat && !/^[+=_-]$/.test(e.key)) return;
  if (e.key === '/') { e.preventDefault(); qEl.focus(); }
  if (e.key === '+' || e.key === '=') zoomSmooth(0.72); if (e.key === '-' || e.key === '_') zoomSmooth(1.38);
  if (e.key === 'h' || e.key === 'H') { select(null); goHome(); }
  if (e.key === 'f' || e.key === 'F') toggleFree();
  if (e.key === 'c' || e.key === 'C') { if (!free.on) resetPan(); }
  if ((e.key === 'l' || e.key === 'L') && free.on) { free.level = !free.level; store.set('level', free.level); toast(free.level ? 'Level horizon on' : 'Level horizon off: roll freely with Q and E', 2400); }
  if (e.key === '?') toggleNavHelp();
});
addEventListener('keyup', (e) => { keys.delete(e.code); if (e.code === 'Space' && free.on && e.target.tagName === 'BUTTON') e.preventDefault(); });
addEventListener('blur', () => keys.clear());
document.addEventListener('visibilitychange', () => keys.clear());

/* camera mode switch, controls card and the touch flight pad */
function syncNavUi() {
  $('modeOrbit').setAttribute('aria-pressed', String(!free.on)); $('modeFree').setAttribute('aria-pressed', String(free.on));
  const dockFly = document.querySelector('#dock [data-open="fly"]'); if (dockFly) dockFly.setAttribute('aria-pressed', String(free.on));
  document.body.classList.toggle('free-flight', free.on);
  $('hint').innerHTML = free.on
    ? '<span>W A S D to fly</span><span class="sep"></span><span>Drag to look</span><span class="sep"></span><span>Shift for speed</span>'
    : '<span>Drag to rotate</span><span class="sep"></span><span>Scroll to zoom</span><span class="sep"></span><span>Middle-drag to pan</span>';
}
let navTick = { pad: null, pan: null };
function syncNavTick() { // cheap per-frame checks, DOM touched only on change
  const pad = free.on && IS_TOUCH && $('detail').hidden && !$('side').classList.contains('open') && !$('wx').classList.contains('open');
  if (pad !== navTick.pad) { navTick.pad = pad; $('flyPad').hidden = !pad; if (!pad) { free.stick.x = free.stick.y = 0; free.lift = 0; } }
  const pan = !free.on && cam.pan.lengthSq() > 1e-10;
  if (pan !== navTick.pan) { navTick.pan = pan; $('recenterBtn').hidden = !pan; }
}
function toggleNavHelp(open = $('navHelp').hidden) {
  $('navHelp').hidden = !open; $('navHelpBtn').setAttribute('aria-expanded', String(open));
}
$('modeOrbit').addEventListener('click', (e) => { e.currentTarget.blur(); exitFree(); });
$('modeFree').addEventListener('click', (e) => { e.currentTarget.blur(); enterFree(); });
$('recenterBtn').addEventListener('click', (e) => { e.currentTarget.blur(); resetPan(); });
$('navHelpBtn').addEventListener('click', () => toggleNavHelp());
$('navHelp').addEventListener('click', (e) => { if (e.target.closest('[data-close]')) toggleNavHelp(false); });
document.addEventListener('pointerdown', (e) => { if (!$('navHelp').hidden && !e.target.closest('#navHelp,#navHelpBtn')) toggleNavHelp(false); });
// virtual stick: drag the knob to move, the two buttons beside it rise and sink
(() => {
  const st = $('flyStick'), knob = st.querySelector('i'); let id = null;
  const move = (e) => {
    const r = st.getBoundingClientRect(), R = r.width * 0.36;
    let x = e.clientX - (r.left + r.width / 2), y = e.clientY - (r.top + r.height / 2); const l = Math.hypot(x, y); if (l > R) { x *= R / l; y *= R / l; }
    knob.style.transform = `translate(${x}px, ${y}px)`; free.stick.x = x / R; free.stick.y = y / R;
  };
  const end = () => { id = null; knob.style.transform = ''; free.stick.x = free.stick.y = 0; st.classList.remove('on'); };
  st.addEventListener('pointerdown', (e) => { id = e.pointerId; try { st.setPointerCapture(id); } catch { /* synthetic pointer */ } st.classList.add('on'); move(e); });
  st.addEventListener('pointermove', (e) => { if (e.pointerId === id) move(e); });
  st.addEventListener('pointerup', end); st.addEventListener('pointercancel', end);
  for (const [b, v] of [[$('flyUp'), 1], [$('flyDown'), -1]]) {
    b.addEventListener('pointerdown', (e) => { try { b.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ } free.lift = v; b.classList.add('on'); });
    const off = () => { free.lift = 0; b.classList.remove('on'); };
    b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off);
    b.addEventListener('contextmenu', (e) => e.preventDefault());
  }
})();

/* sources dialog & mobile dock */
const sourceState = {};
function renderSources() {
  const S = sourceState; const t = (x) => x ? new Date(x).toUTCString().slice(5, 22) + ' UTC' : '—';
  const badge = (st) => st === 'live' ? '<span class="badge live">Live</span>' : st === 'model' ? '<span class="badge model">Model</span>' : st === 'fail' ? '<span class="badge fail">Unavailable</span>' : st === 'deco' ? '<span class="badge model">Decorative</span>' : '<span class="badge snap">Snapshot</span>';
  const rows = [
    ['Satellites & debris', 'CelesTrak GP element sets (active payloads + Fengyun-1C, Cosmos 2251, Iridium 33, Cosmos 1408 debris)', S.tle, `${S.tleN ? fmt(S.tleN) + ' objects. ' : ''}Elements ${S.tleWhen ? 'fetched ' + t(S.tleWhen) + (S.via ? ' via ' + (S.via === 'browser' ? 'your browser' : 'the Galacticio server cache') : '') : 'from 15 Nov 2026, 02:20 UTC'}. Positions are propagated every frame in your browser with SGP4 (satellite.js), so motion is real time.`],
    ['Near-Earth asteroids', 'JPL SBDB Close-Approach API + JPL Horizons vectors', 'snap', `${neos.length} objects passing within 0.05 AU between 12 Nov 2026 and 15 Jan 2027. Ephemeris generated ${t(S.ephWhen)}.`],
    ['Moon & Sun', 'JPL Horizons geocentric vectors', 'snap', 'Valid through mid-January 2027; outside that window an analytic model takes over.'],
    ['Space weather', 'NOAA SWPC: planetary Kp, real-time solar wind, GOES X-ray flux, NOAA scales', S.wx, `${S.wxWhen ? 'Fetched ' + t(S.wxWhen) : ''}`],
    ['Aurora oval', 'NOAA SWPC OVATION model', S.wx, `Observation ${t(S.auroraObs)}, 30–90 minute forecast of aurora probability on a 1° grid.`],
    ['Earth imagery', 'NASA GIBS: Blue Marble Next Generation (2004), NOAA-20 VIIRS true colour (13 Nov 2026), VIIRS Black Marble city lights (2016)', 'snap', 'Cut into a 4-level tile pyramid (up to 16,384 px wide). Black stripes in the satellite view are gaps between orbit passes, filled with Blue Marble.'],
    ['Borders', 'Natural Earth 1:50m via world-atlas', 'snap', ''],
    ['Stars & Milky Way', 'Hipparcos stars to magnitude 6 and Milky Way outlines from d3-celestial', 'snap', 'The Milky Way glow is rendered from its catalogued outline; zodiacal light is computed from the Sun position.'],
    ['Atmosphere layers', 'Standard boundary altitudes', 'model', 'Real boundaries move with latitude, season and solar activity.'],
    ['Van Allen belts', 'Dipole field-line illustration', 'model', 'Shape and drift direction follow physics; particle density is illustrative, not measured.'],
    ['Space dust & object models', 'Generated', 'deco', 'Sparkles are decorative. Satellite models are generic shapes enlarged so they stay visible.'],
  ];
  $('srcRows').innerHTML = rows.map(([a, b, st, d]) => `<tr><td>${a}</td><td>${b}</td><td>${badge(st)}</td><td>${d}</td></tr>`).join('');
}
function closeSheets() { $('side').classList.remove('open'); $('wx').classList.remove('open'); document.querySelectorAll('#dock button').forEach((b) => b.setAttribute('aria-pressed', 'false')); }
function showTab(t) {
  document.querySelectorAll('#side .tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
  $('pane-objects').hidden = t !== 'objects'; $('pane-layers').hidden = t !== 'layers';
}
document.querySelector('#side .tabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) showTab(b.dataset.tab); });
$('dock').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return; const k = b.dataset.open;
  if (k === 'home') { closeSheets(); select(null); goHome(); return; }
  if (k === 'fly') { closeSheets(); toggleFree(); return; }
  const was = b.getAttribute('aria-pressed') === 'true'; closeSheets();
  if (!was) { select(null); const el = k === 'wx' ? $('wx') : $('side'); if (k !== 'wx') showTab(k); el.classList.add('open'); b.setAttribute('aria-pressed', 'true'); }
});

/* space weather panel */
function kpColor(k) { return k >= 8 ? '#ff4f6d' : k >= 7 ? '#ff6a3d' : k >= 6 ? '#ff8a4c' : k >= 5 ? '#ffd25e' : k >= 4 ? '#c9d6a0' : '#6fe0b0'; }
function xrayClass(f) { if (!(f > 0)) return '–'; const L = [['X', 1e-4], ['M', 1e-5], ['C', 1e-6], ['B', 1e-7], ['A', 1e-8]]; for (const [c, b] of L) if (f >= b) return c + (f / b).toFixed(1); return 'A' + (f / 1e-8).toFixed(1); }
function renderWx(w) {
  const kp = w.kp.slice(-56); const last = kp[kp.length - 1];
  $('kpNow').textContent = last ? (+last[1]).toFixed(2).replace(/\.?0+$/, '') : '–'; $('kpNow').style.color = last ? kpColor(+last[1]) : '';
  const c = $('kpbars'), dpr = Math.min(devicePixelRatio, 2), W = c.clientWidth || 180, H = c.clientHeight || 40; c.width = W * dpr; c.height = H * dpr;
  const x = c.getContext('2d'); x.scale(dpr, dpr); x.clearRect(0, 0, W, H);
  const bw = W / 56;
  x.strokeStyle = 'rgba(150,175,210,.16)'; x.beginPath(); x.moveTo(0, H - 5 / 9 * H + 0.5); x.lineTo(W, H - 5 / 9 * H + 0.5); x.stroke();
  kp.forEach(([, v], i) => { const h = Math.max(1.5, (+v / 9) * H); x.fillStyle = kpColor(+v); x.globalAlpha = i === kp.length - 1 ? 1 : 0.7; x.fillRect(i * bw + 0.5, H - h, Math.max(1, bw - 1.2), h); });
  x.globalAlpha = 1; x.fillStyle = '#5f6d80'; x.font = '9px "Geist Mono", monospace'; x.fillText('G1', W - 14, H - 5 / 9 * H - 2); x.fillText('7 DAYS', 0, 9);
  const wl = w.wind[w.wind.length - 1], ml = w.mag[w.mag.length - 1], xl = w.xray[w.xray.length - 1];
  $('swV').textContent = wl && wl[1] != null ? fmt(wl[1]) : '–';
  $('swBz').textContent = ml && ml[2] != null ? (ml[2] > 0 ? '+' : '') + (+ml[2]).toFixed(1) : '–';
  $('swBz').style.color = ml && ml[2] < -5 ? 'var(--alert)' : '';
  $('swBt').textContent = ml && ml[1] != null ? `Bt ${(+ml[1]).toFixed(1)} nT` : 'nT';
  $('xr').textContent = xl ? xrayClass(+xl[1]) : '–';
  const sc = w.scales || {}; const scaleName = { R: 'Radio blackout', S: 'Radiation storm', G: 'Geomagnetic storm' };
  $('scales').innerHTML = ['R', 'S', 'G'].map((k) => `<span class="${+sc[k] > 0 ? 'hot' : ''}" title="${scaleName[k]}">${k}${sc[k] ?? '–'}</span>`).join('') + `<span title="10.7 cm solar radio flux">F10.7 ${w.f107 ? Math.round(+w.f107.flux) : '–'}</span>`;
  $('wxStamp').textContent = w.fetched ? new Date(w.fetched).toISOString().slice(11, 16) + ' UTC' : '';
}

/* ════════════════════════ ALTITUDE LADDER ════════════════════════ */
const lad = { c: $('ladderCanvas'), hist: new Float32Array(140), maxH: 1, hoverY: -1, focusAlt: 0 };
const LOGMIN = 0, LOGMAX = 7; // 1 km … 10,000,000 km
function ladY(alt, H) { const t = (Math.log10(Math.max(alt, 1)) - LOGMIN) / (LOGMAX - LOGMIN); return H - 14 - t * (H - 28); }
function ladAlt(y, H) { const t = (H - 14 - y) / (H - 28); return Math.pow(10, LOGMIN + clamp(t, 0, 1) * (LOGMAX - LOGMIN)); }
function updateHist() {
  lad.hist.fill(0); if (sats) for (let i = 0; i < sats.n; i++) { const a = sats.alt[i]; if (a > 1 && sats.alpha[i] > 0.01) lad.hist[clamp(Math.floor(Math.log10(a) / 7 * 140), 0, 139)]++; }
  for (const n of neos) if (n.on) { const a = n.p.length() * RE - RE; lad.hist[clamp(Math.floor(Math.log10(a) / 7 * 140), 0, 139)] += 1; }
  lad.maxH = Math.max(...lad.hist, 1);
}
function drawLadder(alt) {
  const c = lad.c, dpr = Math.min(devicePixelRatio, 2), W = c.clientWidth, H = c.clientHeight; if (!W || !H) return;
  if (c.width !== W * dpr || c.height !== H * dpr) { c.width = W * dpr; c.height = H * dpr; }
  const x = c.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, W, H);
  const narrow = W < 60;
  // atmosphere strip
  LAYERS.forEach((l) => { const y0 = ladY(Math.max(l.lo, 1), H), y1 = ladY(l.hi, H); x.fillStyle = l.color; x.globalAlpha = 0.85; x.fillRect(0, y1, 4, y0 - y1); });
  // belts strip
  BELTS.forEach((b) => { const y0 = ladY(b.lo, H), y1 = ladY(b.hi, H); const g = x.createLinearGradient(0, y0, 0, y1); g.addColorStop(0, 'transparent'); g.addColorStop(0.5, b.color); g.addColorStop(1, 'transparent'); x.fillStyle = g; x.globalAlpha = 0.55; x.fillRect(6, y1, 3, y0 - y1); });
  x.globalAlpha = 1;
  // decade ticks
  x.font = '9px "Geist Mono", monospace'; x.textBaseline = 'middle';
  for (let d = 1; d <= 6; d++) {
    const y = ladY(10 ** d, H); x.fillStyle = 'rgba(150,175,210,.22)'; x.fillRect(11, Math.round(y) + 0.5, W - 11, 0.5);
    if (!narrow) { x.fillStyle = '#5f6d80'; x.fillText(['', '10', '100', '1K', '10K', '100K', '1M'][d], 13, y - 6); }
  }
  // focus range (things currently drawn)
  if (layersOn.focus) {
    const lim = alt * 2.6 + 350, y = ladY(lim * 1.6, H);
    x.fillStyle = 'rgba(90,169,255,.035)'; x.fillRect(11, y, W - 11, H - 14 - y);
    x.fillStyle = 'rgba(90,169,255,.55)'; x.fillRect(11, Math.round(y), W - 11, 1);
  }
  // histogram
  const hx = 11, hw = W - (narrow ? 13 : 30);
  for (let i = 0; i < 140; i++) {
    const v = lad.hist[i]; if (!v) continue;
    const y0 = ladY(10 ** (i / 140 * 7), H), y1 = ladY(10 ** ((i + 1) / 140 * 7), H);
    const len = Math.max(1.5, Math.sqrt(v / lad.maxH) * hw);
    x.fillStyle = '#dfe7f1'; x.globalAlpha = 0.75; x.fillRect(hx, y1, len, Math.max(1.2, y0 - y1 - 0.6));
  }
  x.globalAlpha = 1;
  // regimes
  if (!narrow) {
    x.textAlign = 'right'; x.font = '600 9px Geist, sans-serif';
    REGIMES.forEach((r) => {
      const y0 = ladY(r.lo, H), y1 = ladY(r.hi, H), ym = (y0 + y1) / 2;
      x.fillStyle = 'rgba(150,175,210,.35)'; x.fillRect(W - 2, y1, 1, Math.max(1, y0 - y1));
      x.fillStyle = '#9aa8b9'; x.fillText(r.id, W - 5, r.id === 'GEO' ? ym : ym);
    });
    x.textAlign = 'left';
  }
  // Moon marker
  const my = ladY(moon.position.length() * RE - RE, H); x.strokeStyle = '#e8e2d0'; x.lineWidth = 1; x.beginPath(); x.arc(W - (narrow ? 6 : 16), my, 3.5, 0, Math.PI * 2); x.stroke();
  // camera needle
  const cy = ladY(Math.max(alt, 1), H);
  x.fillStyle = '#5aa9ff'; x.fillRect(0, Math.round(cy) - 0.5, W, 1.5);
  x.beginPath(); x.moveTo(W, cy); x.lineTo(W + 0.5 - 7, cy - 5); x.lineTo(W + 0.5 - 7, cy + 5); x.fill();
  if (lad.hoverY >= 0) { x.fillStyle = 'rgba(223,231,241,.5)'; x.fillRect(0, lad.hoverY, W, 1); }
}
function ladderInfo(alt) {
  const lay = LAYERS.find((l) => alt >= l.lo && alt < l.hi), reg = REGIMES.find((r) => alt >= r.lo && alt < r.hi), belt = BELTS.find((b) => alt >= b.lo && alt < b.hi);
  const i = clamp(Math.floor(Math.log10(alt) / 7 * 140), 0, 139); const n = lad.hist[i] + (lad.hist[i - 1] || 0) + (lad.hist[i + 1] || 0);
  let html = `<div class="mono">${fmt(alt)} km</div>`;
  if (lay) html += `<b style="color:${lay.color}">${lay.name}</b>${lay.blurb}`;
  if (reg) html += `<b>${reg.name}</b>${reg.blurb}`;
  if (belt) html += `<b style="color:${belt.color}">${belt.name}</b>${belt.blurb}`;
  html += `<div class="mono" style="margin-top:6px">${fmt(n)} objects near this height</div><div style="color:var(--ink-3);margin-top:2px">Click to fly to this altitude</div>`;
  return { html, lay };
}
lad.c.addEventListener('pointermove', (e) => {
  const r = lad.c.getBoundingClientRect(); const y = e.clientY - r.top; lad.hoverY = y; const alt = ladAlt(y, r.height);
  const inf = ladderInfo(alt); const tip = $('ladderTip'); tip.innerHTML = inf.html; tip.hidden = false; tip.style.top = clamp(y, 60, r.height - 60) + 'px';
  layerUniforms.hi.value = inf.lay ? LAYERS.indexOf(inf.lay) : -1;
});
lad.c.addEventListener('pointerleave', () => { lad.hoverY = -1; $('ladderTip').hidden = true; layerUniforms.hi.value = -1; });
lad.c.addEventListener('click', (e) => {
  const r = lad.c.getBoundingClientRect(); const alt = ladAlt(e.clientY - r.top, r.height);
  select(null); const camAltT = alt < 120 ? 260 : alt * 2.2 + 300;
  flyTo({ dist: clamp(1 + camAltT / RE, cam.minDist, cam.maxDist), az: cam.az, el: cam.el, dur: 1.8 });
});

/* focus readout */
function focusName(alt) {
  if (alt < 2000) return alt < 600 ? 'Low Earth orbit · thermosphere' : 'Low Earth orbit';
  if (alt < 30000) return 'Medium Earth orbit';
  if (alt < 120000) return 'Geostationary belt & beyond';
  if (alt < 600000) return 'Cislunar space';
  return 'Near-Earth asteroid space';
}

/* ════════════════════════ DATA LOADING ════════════════════════ */
async function getJSON(u) { const r = await fetch(u, { cache: 'no-cache' }); if (!r.ok) throw new Error(u + ' ' + r.status); return r.json(); }
async function getText(u, cache = 'no-cache') { const r = await fetch(u, { cache }); if (!r.ok) throw new Error(u + ' ' + r.status); return r.text(); }
function withTimeout(p, ms) { return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]); }
let auroraTex = null;
function setAuroraFromGrid(u8) { // u8: 181 rows × 360 cols, row 0 = 90°N
  if (!auroraTex) { auroraTex = new THREE.DataTexture(u8, 360, 181, THREE.RedFormat, THREE.UnsignedByteType); auroraTex.magFilter = THREE.LinearFilter; auroraTex.minFilter = THREE.LinearFilter; auroraTex.wrapS = THREE.RepeatWrapping; }
  else auroraTex.image.data = u8;
  auroraTex.flipY = false; auroraTex.needsUpdate = true; auroraMat.uniforms.grid.value = auroraTex;
}

async function loadAll() {
  bootSet('earth', 'run');
  const earthP = Promise.all([loadTex('tiles/bm_global.jpg'), loadTex('tiles/lights.png'), loadTex('tiles/water.png')]).then(([bm, li, wa]) => {
    globalTex.bm = bm; globalTex.lights = li; globalTex.water = wa;
    const u = baseMat.uniforms; u.lights.value = li; u.water.value = wa; u.fill.value = bm; setImagery(imagery.mode);
    bootSet('earth', 'ok', '16,384 px max');
    loadTex('tiles/viirs/1/0_0.jpg').then(() => { // build a global VIIRS base from the 8 L1 tiles
      const cnv = document.createElement('canvas'); cnv.width = 4096; cnv.height = 2048; const x = cnv.getContext('2d'); let n = 0;
      for (let ty = 0; ty < 2; ty++) for (let tx = 0; tx < 4; tx++) {
        const im = new Image(); im.onload = () => { x.drawImage(im, tx * 1024, ty * 1024); if (++n === 8) { const t = releaseAfterUpload(new THREE.CanvasTexture(cnv)); t.anisotropy = MAX_ANISO; globalTex.viirs = t; setImagery(imagery.mode); } };
        im.src = `tiles/viirs/1/${tx}_${ty}.jpg`;
      }
    }).catch(() => {});
  }).catch((e) => { bootSet('earth', 'err'); throw e; });
  loadTex('tiles/moon.jpg', true).then((t) => { moonMat.map = t; moonMat.color.set(0xffffff); moonMat.needsUpdate = true; }).catch(() => {});

  bootSet('tle', 'run');
  const tleP = getText('data/tle.txt').then((txt) => {
    const recs = parseBundledTLE(txt); sats = new SatEngine(); sats.setRecords(recs);
    sourceState.tle = 'snap'; sourceState.tleN = recs.length;
    bootSet('tle', 'ok', fmt(recs.length) + ' objects');
  }).catch((e) => { bootSet('tle', 'err'); sourceState.tle = 'fail'; console.warn(e); });

  bootSet('eph', 'run');
  const ephP = getJSON('data/ephemeris.json').then((d) => {
    ephem.moon = makeEphem(d.moon); ephem.sun = makeEphem(d.sun); sourceState.ephWhen = d.generated;
    buildNeos(d.neos); bootSet('eph', 'ok', `${d.neos.length} asteroids`);
  }).catch((e) => { bootSet('eph', 'err', 'using models'); console.warn(e); });

  bootSet('wx', 'run');
  const wxP = Promise.all([getJSON('data/spaceweather.json'), loadTex('data/aurora.png')]).then(([w, at]) => {
    renderWx(w); wx = w; sourceState.wx = 'snap'; sourceState.wxWhen = w.fetched; sourceState.auroraObs = w.aurora.observed;
    at.flipY = false; at.needsUpdate = true; auroraMat.uniforms.grid.value = at;
    bootSet('wx', 'ok', 'Kp ' + (+w.kp[w.kp.length - 1][1]).toFixed(1));
  }).catch((e) => { bootSet('wx', 'err'); sourceState.wx = 'fail'; console.warn(e); });

  bootSet('sky', 'run');
  const skyP = Promise.all([getJSON('data/stars.json'), loadTex('tiles/milkyway.jpg')]).then(([st, mw]) => {
    buildStars(st); skyUniforms.mw.value = mw; skyUniforms.mwK.value = 1; bootSet('sky', 'ok', fmt(st.length) + ' stars');
  }).catch((e) => { bootSet('sky', 'err'); console.warn(e); });

  bootSet('borders', 'run');
  getJSON('data/borders.json').then((a) => { buildBorders(a); bootSet('borders', 'ok'); }).catch(() => bootSet('borders', 'err'));

  await Promise.allSettled([earthP, tleP]);
  await Promise.race([Promise.allSettled([ephP, wxP, skyP]), new Promise((r) => setTimeout(r, 2500))]);
  if (bootState.earth === 'err' && bootState.tle === 'err') { fatal('The Earth imagery and orbital catalogue could not be loaded. Check your connection and reload the page.'); return; }
  buildMoonOrbit(simNow());
  bootSet('done', 'ok'); setTimeout(() => { $('boot').classList.add('gone'); setTimeout(() => { $('boot').hidden = true; }, 800); maybeNotice(); }, 300);
  if (route === 'about') renderAbout();
  started = true; goHome(2.6);
  applyRouteObj(); // a /satellite/… or /asteroid/… address flies straight to that object
  const q = new URLSearchParams(location.search).get('q');
  if (q && route === 'explore') { qEl.value = q.slice(0, 60); doSearch(); }
  if (route === 'satellites') renderCatalog();
  updateStatus();
  if (!IN_SANDBOX) setTimeout(tryLive, 1500);
}
let wx = null, started = false;

/* live refresh (works when opened outside the claude.ai sandbox) */
// When served by server.js, the same-origin /api mirrors CelesTrak and NOAA with a shared cache.
// Otherwise (any static host) the browser asks both services directly; both send CORS headers.
let SWPC = 'https://services.swpc.noaa.gov/', viaServer = false;
async function tryLive() {
  try { const h = await withTimeout(getJSON('api/health'), 4000); viaServer = !!(h && h.service === 'galacticio'); } catch { viaServer = false; }
  if (viaServer) SWPC = 'api/swpc/';
  const CT = viaServer ? 'api/tle?group=' : 'https://celestrak.org/NORAD/elements/gp.php?FORMAT=tle&GROUP=';
  if (!viaServer) {
    try { await withTimeout(getJSON(SWPC + 'products/summary/solar-wind-speed.json'), 8000); }
    catch { console.info('Live sources not reachable from this page; using the bundled snapshot.'); return; }
  }
  sourceState.via = viaServer ? 'Galacticio server cache' : 'browser';
  try {
    const [act, ...deb] = await withTimeout(Promise.all(['active', 'fengyun-1c-debris', 'cosmos-2251-debris', 'iridium-33-debris', 'cosmos-1408-debris']
      .map((g, i) => getText(CT + g, viaServer ? 'default' : 'no-cache').catch((e) => (i === 0 ? Promise.reject(e) : '')))), viaServer ? 60000 : 25000);
    const recs = parseRawTLE(act); const seen = new Set(recs.map((r) => r.norad));
    deb.forEach((t) => parseRawTLE(t, true).forEach((r) => { if (!seen.has(r.norad)) { seen.add(r.norad); recs.push(r); } }));
    if (recs.length > 5000) {
      const selNorad = selected && selected.kind === 'sat' ? selected.rec.norad : null;
      const anchorNorad = free.on && free.anchor && free.anchor.kind === 'sat' ? free.anchor.rec.norad : null;
      if (anchorNorad != null) { freeWorld(free.pos); free.anchor = null; } // hold the flight position in world space across the swap
      setHover(null); sats.setRecords(recs);
      if (anchorNorad != null && sats.byNorad.has(anchorNorad)) { free.anchor = satObj(sats.byNorad.get(anchorNorad)); free.pos.sub(free.anchor.pos()); }
      sourceState.tle = 'live'; sourceState.tleN = recs.length; sourceState.tleWhen = Date.now();
      // Re-point the selection (and the camera, if it is following or flying to it) at the new record
      // without moving the camera.
      if (selNorad != null && sats.byNorad.has(selNorad)) {
        const o = satObj(sats.byNorad.get(selNorad)); selected = o; satMat.uniforms.sel.value = o.i;
        if (cam.follow && cam.follow.kind === 'sat') cam.follow = o;
        if (cam.fly && cam.fly.follow && cam.fly.follow.kind === 'sat') cam.fly.follow = o;
        buildOrbitPath(); renderDetail(true);
      } else if (selected && selected.kind === 'sat') select(null, false, true);
      if (route === 'satellites') renderCatalog();
      toast(`Orbital catalogue refreshed live from CelesTrak: ${fmt(recs.length)} objects.`);
    }
  } catch (e) { console.info('Live TLE refresh unavailable, using bundled snapshot.', e.message); }
  refreshWxLive();
  setInterval(refreshWxLive, 5 * 60e3);
  updateStatus();
}
async function refreshWxLive() {
  const S = SWPC;
  try {
    const [kp, spd, mag, xr, sc, ov] = await withTimeout(Promise.all([
      getJSON(S + 'products/noaa-planetary-k-index.json'), getJSON(S + 'products/summary/solar-wind-speed.json'), getJSON(S + 'products/summary/solar-wind-mag-field.json'),
      getJSON(S + 'json/goes/primary/xrays-6-hour.json'), getJSON(S + 'products/noaa-scales.json'), getJSON(S + 'json/ovation_aurora_latest.json')]), 25000);
    const w = { ...(wx || {}) };
    w.kp = kp.map((k) => Array.isArray(k) ? [k[0], +k[1]] : [k.time_tag, +k.Kp]).filter((k) => !isNaN(k[1]));
    w.wind = [[spd[0].time_tag, +spd[0].proton_speed]]; w.mag = [[mag[0].time_tag, +mag[0].bt, +mag[0].bz_gsm]];
    w.xray = xr.filter((x) => x.energy === '0.1-0.8nm').map((x) => [x.time_tag, x.flux]);
    const s0 = sc['0']; w.scales = { R: s0.R.Scale, S: s0.S.Scale, G: s0.G.Scale };
    w.fetched = new Date().toISOString(); wx = w; renderWx(w);
    const g = new Uint8Array(360 * 181); for (const [lo, la, v] of ov.coordinates) g[(90 - Math.round(la)) * 360 + (lo % 360)] = Math.min(255, v * 2.55);
    setAuroraFromGrid(g); sourceState.auroraObs = ov['Observation Time'];
    sourceState.wx = 'live'; sourceState.wxWhen = Date.now(); updateStatus();
  } catch (e) { console.info('Live space-weather refresh unavailable.', e.message); }
}
function updateStatus() {
  const live = sourceState.tle === 'live';
  $('dataChip').textContent = live ? 'Live data' : sourceState.tle === 'fail' ? 'No catalogue' : 'Snapshot';
  $('dataPill').classList.toggle('live', live);
  $('dataPill').title = live ? 'Catalogue refreshed from CelesTrak in this session' : 'Orbital data from 15 Nov 2026, 02:20 UTC. Positions are computed live.';
  const n = sourceState.tleN ? fmt(sourceState.tleN) : '0';
  $('dataTxt').textContent = live ? `${n} objects from CelesTrak, positions computed live` : `${n} objects · orbits from 15 Nov, 02:20 UTC · motion computed live`;
}

/* ════════════════════════ SITE: routes, pages, notice ════════════════════════ */
// Served by server.js the site uses real URLs (/about, /satellite/25544-iss-zarya). Opened as a plain
// file or embedded elsewhere it falls back to #hash routes. Internal links are written as /paths in
// both cases and intercepted here.
const PATH_MODE = !!document.querySelector('meta[name="galacticio:server"]');
const DOCS = ['about', 'sources', 'satellites', 'terms', 'privacy', 'cookies', '404'];
const TITLES = {
  explore: 'Galacticio: Live 3D Satellite Tracker & Space Weather Map', about: 'About Galacticio: How the Live Satellite Map Works',
  sources: 'Data Sources · Galacticio Live Satellite Map', satellites: 'Satellite Catalogue · Galacticio', terms: 'Terms of Use · Galacticio',
  privacy: 'Privacy Policy · Galacticio', cookies: 'Cookie Policy · Galacticio', 404: 'Page not found · Galacticio',
};
const slugify = (t) => String(t).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
const satHref = (rec) => `/satellite/${rec.norad}${slugify(rec.name) ? '-' + slugify(rec.name) : ''}`;
const neoHref = (d) => `/asteroid/${slugify(d.des)}`;
function objHref(o) { return !o ? '/' : o.kind === 'sat' ? satHref(o.rec) : o.kind === 'neo' ? neoHref(o.d) : '/'; }
function objTitle(o) { return o.kind === 'sat' ? `${o.rec.name} Live Position & Orbit Tracker · Galacticio` : o.kind === 'neo' ? `Asteroid ${String(o.d.name || o.d.des).replace(/^\((.*)\)$/, '$1')} Close Approach · Galacticio` : TITLES.explore; }
function routeOf(p) {
  p = p.replace(/\/+$/, '') || '/'; let m;
  if (p === '/') return { name: 'explore' };
  if ((m = /^\/(about|sources|satellites|terms|privacy|cookies)$/.exec(p))) return { name: m[1] };
  if ((m = /^\/satellite\/(\d{1,6})/.exec(p))) return { name: 'explore', sat: +m[1] };
  if ((m = /^\/asteroid\/([a-z0-9-]{3,40})/.exec(p))) return { name: 'explore', neo: m[1] };
  return { name: PATH_MODE ? '404' : 'explore' };
}
function currentPath() {
  if (PATH_MODE) return location.pathname;
  const h = decodeURIComponent(location.hash.slice(1)); return h === 'data' ? '/sources' : h && h !== 'explore' ? '/' + h.replace(/^\//, '') : '/';
}
// Old #about style links still work on the server version.
if (PATH_MODE && /^#(about|data|terms|cookies|explore)$/.test(location.hash)) history.replaceState(null, '', location.hash === '#data' ? '/sources' : location.hash === '#explore' ? '/' : '/' + location.hash.slice(1));
let routeObj = null; // { sat } or { neo } waiting for the catalogue to load
function navigate(href, replace) {
  if (PATH_MODE) { if (href !== location.pathname) history[replace ? 'replaceState' : 'pushState'](null, '', href); setRoute(); return; }
  const h = href === '/' ? '' : href.slice(1);
  if (('#' + h) === location.hash || (!h && !location.hash)) { setRoute(); return; }
  if (replace || !h) { history[replace ? 'replaceState' : 'pushState'](null, '', h ? '#' + h : location.pathname + location.search); setRoute(); } else location.hash = h;
}
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href]');
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || a.target === '_blank' || a.hasAttribute('download')) return;
  const href = a.getAttribute('href');
  if (!href.startsWith('/') || href.startsWith('//') || /^\/(api|data|tiles|brand)\//.test(href) || /\.\w+$/.test(href)) return;
  e.preventDefault(); navigate(href);
});
addEventListener('popstate', setRoute);
addEventListener('hashchange', () => { if (!PATH_MODE) setRoute(); });

function toggleMenu(open) { $('mobileMenu').hidden = !open; $('menuBtn').setAttribute('aria-expanded', String(open)); }
$('menuBtn').addEventListener('click', (e) => { e.stopPropagation(); toggleAccount(false); toggleMenu($('mobileMenu').hidden); });
addEventListener('click', (e) => {
  if (!$('mobileMenu').hidden && !e.target.closest('#mobileMenu')) toggleMenu(false);
  if (!$('accountPop').hidden && !e.target.closest('#accountPop, #accountBtn')) toggleAccount(false);
});
function setRoute() {
  const r = routeOf(currentPath()); const prev = route; route = r.name;
  for (const k of DOCS) { const pg = $('page-' + k); if (!pg) continue; pg.hidden = k !== route; if (k === route && prev !== route) pg.scrollTop = 0; }
  const ex = route === 'explore';
  $('hud').hidden = !ex; $('labels').hidden = !ex; $('vfoot').hidden = !ex; $('search').hidden = !ex;
  $('boot').classList.toggle('away', !ex);
  if (!ex) { setHover(null); $('tip').hidden = true; }
  document.querySelectorAll('[data-route]').forEach((a) => { if (a.dataset.route === route) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  toggleMenu(false); toggleAccount(false);
  if (ex) {
    routeObj = r.sat || r.neo ? r : null;
    if (routeObj) applyRouteObj(); else if (selected && selected.kind !== 'moon' && prev === 'explore') select(null);
  }
  document.title = ex && selected && selected.kind !== 'moon' ? objTitle(selected) : TITLES[route];
  if (route === 'sources') renderSources();
  if (route === 'about') renderAbout();
  if (route === 'satellites') renderCatalog();
}
// Open the object named in the URL once the catalogue is in.
function applyRouteObj() {
  const r = routeObj; if (!r) return;
  if (r.sat != null) {
    if (!sats) return; const i = sats.byNorad.get(r.sat); routeObj = null;
    if (i == null) { $('detail').hidden = true; toast('That satellite is not in the current catalogue.'); return; }
    if (!(selected && selected.kind === 'sat' && selected.i === i)) select(satObj(i), true, true);
  } else if (r.neo) {
    if (!neos.length) return; const n = neos.find((x) => slugify(x.d.des) === r.neo); routeObj = null;
    if (!n) { $('detail').hidden = true; toast('That asteroid is not in the current list.'); return; }
    if (selected !== n) select(n, true, true);
  }
}
// Keep the address bar on the selected object so it can be shared.
function syncUrlToSelection(o) {
  if (route !== 'explore') return;
  document.title = o && o.kind !== 'moon' ? objTitle(o) : TITLES.explore;
  if (!PATH_MODE) return;
  const want = objHref(o); if (want === location.pathname) return;
  history[location.pathname === '/' && want !== '/' ? 'pushState' : 'replaceState'](null, '', want + (want === '/' ? location.search : ''));
}
document.querySelectorAll('.site-foot').forEach((f) => { if (!f.children.length) f.appendChild($('footTpl').content.cloneNode(true)); });

// Satellite catalogue page, grouped like the class panel. Built once per catalogue.
let catalogHtml = null, catalogFor = null;
function renderCatalog() {
  const box = $('catalogList');
  if (!sats) { if (!box.children.length) box.innerHTML = '<p class="cat-note">Loading the catalogue…</p>'; return; }
  if (box.dataset.ssr && sourceState.tle !== 'live') return; // the server already sent the live list; keep it over the bundled snapshot
  if (catalogFor !== sats.recs || !catalogHtml) {
    const order = ['S', 'N', 'G', 'B', 'P', 'L', 'R', 'D'], groups = {};
    sats.recs.forEach((r) => { (groups[CLASSES[r.c].key] ||= []).push(r); });
    let h = '', jump = '';
    for (const k of order) {
      const g = groups[k]; if (!g || !g.length) continue; const c = CLASSES.find((x) => x.key === k);
      jump += `<a href="#cat-${k}" data-jump="cat-${k}">${c.name}<span>${fmt(g.length)}</span></a>`;
      h += `<section class="cat-group" id="cat-${k}"><h2>${esc(c.name)} <span>${fmt(g.length)}</span></h2>`;
      if (k === 'L' || k === 'D' || k === 'R') h += `<p class="cat-note">${k === 'L' ? 'Starlink satellites are too many to list here. Search any of them by name or NORAD ID in the 3D view.' : 'Search any of these by name or NORAD ID in the 3D view.'}</p>`;
      else h += `<ul class="cat-list">${g.slice().sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true })).map((r) => `<li><a href="${satHref(r)}">${esc(r.name)}</a></li>`).join('')}</ul>`;
      h += '</section>';
    }
    if (neos.length) {
      jump += `<a href="#cat-asteroids" data-jump="cat-asteroids">Asteroids<span>${neos.length}</span></a>`;
      h += `<section class="cat-group" id="cat-asteroids"><h2>Asteroids passing Earth <span>${neos.length}</span></h2><ul class="cat-list wide">${neos.slice().sort((a, b) => a.d.dist_au - b.d.dist_au).map((n) => `<li><a href="${neoHref(n.d)}">${esc(String(n.d.name || n.d.des).replace(/^\((.*)\)$/, '$1'))}</a> <small>${(n.d.dist_au * AU / LD).toFixed(2)} LD · ${esc(String(n.d.cd).slice(0, 11))}</small></li>`).join('')}</ul></section>`;
    }
    catalogHtml = [h, jump]; catalogFor = sats.recs;
  }
  box.innerHTML = catalogHtml[0]; $('catJump').innerHTML = catalogHtml[1]; delete box.dataset.ssr;
}
$('catJump').addEventListener('click', (e) => { const a = e.target.closest('a[data-jump]'); if (!a) return; e.preventDefault(); const t = $(a.dataset.jump); if (t) $('page-satellites').scrollTo({ top: t.offsetTop - 80, behavior: 'smooth' }); });

/* ════════════════════════ ACCOUNT & WATCHLIST ════════════════════════ */
// Guests keep saved objects in this browser. Signed in (Google), they live on the server and follow
// the user across devices; local items are merged in at sign-in.
const GOOGLE_ID = (document.querySelector('meta[name="galacticio:google-client-id"]') || {}).content || '';
const account = { user: null, watch: store.get('watchlist', []), ready: !PATH_MODE };
async function api(path, opts = {}) {
  const r = await fetch(path, { credentials: 'same-origin', ...opts, headers: { ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers || {}) } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(body.error || `Request failed (${r.status})`), { status: r.status });
  return body;
}
function watchKey(o) { return o.kind === 'sat' ? { kind: 'sat', id: o.rec.norad, name: o.rec.name } : o.kind === 'neo' ? { kind: 'neo', id: o.d.des, name: String(o.d.name || o.d.des).replace(/^\((.*)\)$/, '$1') } : null; }
const isSaved = (o) => { const k = o && watchKey(o); return !!k && account.watch.some((w) => w.kind === k.kind && w.id === k.id); };
let watchSaveT = null;
function persistWatch() {
  if (!account.user) { store.set('watchlist', account.watch); return; }
  clearTimeout(watchSaveT);
  watchSaveT = setTimeout(() => api('/api/me/watchlist', { method: 'PUT', body: JSON.stringify({ items: account.watch }) }).catch((e) => toast('Could not save your watchlist: ' + e.message)), 400);
}
function toggleSave(o) {
  const k = watchKey(o); if (!k) return;
  const i = account.watch.findIndex((w) => w.kind === k.kind && w.id === k.id);
  if (i >= 0) account.watch.splice(i, 1); else account.watch.unshift(k);
  persistWatch(); renderAccountButton(); if (!$('accountPop').hidden) renderAccountPop();
  const b = $('dSave'); if (b) { b.setAttribute('aria-pressed', String(i < 0)); b.textContent = i < 0 ? '★ Saved' : '☆ Save'; }
  if (i < 0 && !account.user && GOOGLE_ID && account.watch.length === 1) toast('Saved in this browser. Sign in to keep it on every device.');
}
function collectPrefs() {
  const classes = {}; CLASSES.forEach((c, i) => { classes[c.key] = !!classOn[i]; }); classes.neo = !!neoOn;
  return { imagery: imagery.mode, layers: { ...layersOn }, classes };
}
let prefsT = null, applyingPrefs = false;
function prefsChanged() { if (!account.user || applyingPrefs) return; clearTimeout(prefsT); prefsT = setTimeout(() => api('/api/me/prefs', { method: 'PUT', body: JSON.stringify(collectPrefs()) }).catch(() => {}), 1200); }
function applyPrefs(p) {
  if (!p || !Object.keys(p).length) return;
  applyingPrefs = true;
  if (p.layers) for (const [k, v] of Object.entries(p.layers)) if (k in layersOn) { layersOn[k] = v; store.set('layer.' + k, v); }
  if (p.classes) for (const [k, v] of Object.entries(p.classes)) { if (k === 'neo') neoOn = v; else { const i = CLASSES.findIndex((c) => c.key === k); if (i >= 0) { classOn[i] = v; store.set('class.' + k, v); } } }
  buildClassUI(); buildLayerUI(); if (p.imagery) setImagery(p.imagery);
  applyingPrefs = false;
}
function initials(n) { return String(n || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase(); }
function renderAccountButton() {
  const b = $('accountBtn'), img = $('avatarImg'), lab = $('accountLabel'); let ini = b.querySelector('.initial');
  b.classList.toggle('user', !!account.user); b.classList.toggle('signin', !account.user && !!GOOGLE_ID);
  if (account.user) {
    b.setAttribute('aria-label', 'Your account and saved objects');
    if (account.user.picture) { img.src = account.user.picture; img.hidden = false; if (ini) ini.remove(); }
    else { img.hidden = true; if (!ini) { ini = document.createElement('span'); ini.className = 'initial'; b.appendChild(ini); } ini.textContent = initials(account.user.name); }
  } else {
    img.hidden = true; if (ini) ini.remove();
    lab.textContent = GOOGLE_ID ? 'Sign in' : account.watch.length ? `Saved ${account.watch.length}` : 'Saved';
    b.setAttribute('aria-label', GOOGLE_ID ? 'Sign in and saved objects' : 'Saved objects');
  }
}
function savedListHtml() {
  if (!account.watch.length) return '<div class="empty">Nothing saved yet. Open any satellite or asteroid and press Save.</div>';
  return `<div class="saved">${account.watch.map((w, i) => `<button class="item" data-w="${i}">${w.kind === 'neo' ? swatch({ color: NEO_COLOR, shape: 'ring' }) : swatch(CLASSES[(sats && sats.byNorad.has(w.id)) ? sats.recs[sats.byNorad.get(w.id)].c : 5])}<span class="nm">${esc(w.name || w.id)}</span><small>${w.kind === 'neo' ? 'asteroid' : 'NORAD ' + w.id}</small></button>`).join('')}</div>`;
}
let confirmDelete = false;
function renderAccountPop() {
  const pop = $('accountPop'); const u = account.user;
  if (u) {
    pop.innerHTML = `<div class="who">${u.picture ? `<img src="${esc(u.picture)}" alt="" referrerpolicy="no-referrer">` : `<span class="initial">${esc(initials(u.name))}</span>`}<div><b>${esc(u.name)}</b><span>${esc(u.email || 'Signed in with Google')}</span></div></div>
      <h3>Saved objects</h3>${savedListHtml()}
      <div class="row3"><button id="aOut">Sign out</button><button id="aDel" class="danger">${confirmDelete ? 'Click again to delete everything' : 'Delete my data'}</button></div>`;
    $('aOut').onclick = signOut;
    $('aDel').onclick = () => { if (!confirmDelete) { confirmDelete = true; renderAccountPop(); return; } deleteAccount(); };
  } else {
    pop.innerHTML = `<h3>Saved objects</h3>${savedListHtml()}
      ${GOOGLE_ID ? `<p>Sign in to keep saved objects and view settings on every device. We store only your name, email and watchlist.</p><div class="gbtn" id="gBtn"><span class="spin"></span></div><div class="err" id="gErr" hidden></div>`
        : `<p>Saved in this browser only.</p>`}`;
    if (GOOGLE_ID) renderGoogleButton($('gBtn')).catch((e) => { $('gBtn').hidden = true; const er = $('gErr'); er.hidden = false; er.textContent = e.message; });
  }
  pop.querySelectorAll('[data-w]').forEach((b) => b.addEventListener('click', () => openSaved(account.watch[+b.dataset.w])));
}
function openSaved(w) {
  toggleAccount(false);
  if (w.kind === 'sat') { if (sats && sats.byNorad.has(w.id)) { if (route !== 'explore') navigate('/'); select(satObj(sats.byNorad.get(w.id)), true); } else toast(`${w.name || w.id} is not in the current catalogue.`); }
  else { const n = neos.find((x) => x.d.des === w.id); if (n) { if (route !== 'explore') navigate('/'); select(n, true); } else toast(`${w.name || w.id} is no longer in the asteroid window.`); }
}
function toggleAccount(open) {
  const pop = $('accountPop'); if (open === undefined) open = pop.hidden;
  if (open) { confirmDelete = false; renderAccountPop(); toggleMenu(false); }
  pop.hidden = !open; $('accountBtn').setAttribute('aria-expanded', String(open));
}
$('accountBtn').addEventListener('click', (e) => { e.stopPropagation(); toggleAccount(); });

let gisP = null, gisInit = false;
function loadGis() {
  return gisP ||= new Promise((res, rej) => {
    const sc = document.createElement('script'); sc.src = 'https://accounts.google.com/gsi/client'; sc.async = true;
    sc.onload = () => (window.google && google.accounts ? res(google) : rej(new Error('Google sign-in did not start.')));
    sc.onerror = () => { gisP = null; rej(new Error('Google sign-in could not load. Check your connection or content blocker.')); };
    document.head.appendChild(sc);
  });
}
async function renderGoogleButton(el) {
  const g = await loadGis();
  if (!gisInit) { g.accounts.id.initialize({ client_id: GOOGLE_ID, callback: onGoogleCredential, ux_mode: 'popup', auto_select: false, itp_support: true, use_fedcm_for_button: true }); gisInit = true; }
  el.innerHTML = ''; g.accounts.id.renderButton(el, { theme: 'filled_black', size: 'large', shape: 'pill', text: 'signin_with', logo_alignment: 'left', width: 280 });
}
async function onGoogleCredential(resp) {
  try {
    const r = await api('/api/auth/google', { method: 'POST', body: JSON.stringify({ credential: resp.credential }) });
    const local = account.watch.slice(); account.user = r.user;
    // merge anything saved while signed out
    const merged = (r.watchlist || []).slice(); for (const w of local) if (!merged.some((m) => m.kind === w.kind && m.id === w.id)) merged.push(w);
    account.watch = merged; if (local.length) { store.set('watchlist', []); persistWatch(); }
    applyPrefs(r.prefs); if (!r.prefs || !Object.keys(r.prefs).length) prefsChanged();
    renderAccountButton(); toggleAccount(false); toast(`Signed in as ${r.user.name}.`);
    if (selected) renderDetail(true);
  } catch (e) { const er = $('gErr'); if (er) { er.hidden = false; er.textContent = 'Sign-in failed: ' + e.message; } }
}
async function signOut() {
  try { await api('/api/auth/logout', { method: 'POST', body: '{}' }); } catch { /* cookie may already be gone */ }
  if (window.google && google.accounts) google.accounts.id.disableAutoSelect();
  account.user = null; account.watch = store.get('watchlist', []); renderAccountButton(); toggleAccount(false); toast('Signed out.');
  if (selected) renderDetail(true);
}
async function deleteAccount() {
  try { await api('/api/me', { method: 'DELETE' }); account.user = null; account.watch = []; renderAccountButton(); toggleAccount(false); toast('Your account data has been deleted.'); if (selected) renderDetail(true); }
  catch (e) { toast('Could not delete your data: ' + e.message); }
}
async function loadAccount() {
  if (!PATH_MODE) { renderAccountButton(); return; }
  try {
    const r = await api('/api/me');
    if (r.user) { account.user = r.user; account.watch = r.watchlist || []; applyPrefs(r.prefs); }
  } catch { /* offline or API blocked: guest mode */ }
  account.ready = true; renderAccountButton(); if (selected) renderDetail(true);
}
renderAccountButton();

// About page: live counts and an altitude diagram drawn from the same data the 3D view uses
function renderAbout() {
  const N = (x) => fmt(Math.round(x));
  const ms = simNow(); updateBodies(ms); moon.position.copy(moonPos); // the scene may be paused on this page
  neos.forEach((n) => { if (n.e.at(ms, _v, n.vel)) n.p.copy(_v); });
  if (sats) $('aboutCounts').innerHTML = CLASSES.map((c, i) => sats.counts[i] ? `<li><span>${c.name}</span><span>${N(sats.counts[i])}</span></li>` : '').join('')
    + `<li><span>Total</span><span>${N(sats.n)}</span></li>`;
  if (neos.length) {
    const close = neos.reduce((a, b) => (b.d.dist_au < a.d.dist_au ? b : a));
    const moonKm = moon.position.length() * RE;
    $('aboutNeo').innerHTML = `<li><span>Asteroids in window</span><span>${neos.length}</span></li>`
      + `<li><span>Closest pass</span><span>${esc(String(close.d.name || close.d.des).replace(/^\((.*)\)$/, '$1'))}</span></li>`
      + `<li><span>Its distance</span><span>${(close.d.dist_au * AU / LD).toFixed(2)} LD</span></li>`
      + `<li><span>Moon right now</span><span>${N(moonKm)} km</span></li>`;
  }
  // headline numbers
  const kpArr = wx && wx.kp; const kp = kpArr && kpArr.length ? +kpArr[kpArr.length - 1][1] : NaN;
  let leo = 0, deb = 0; if (sats) for (let i = 0; i < sats.n; i++) { if (sats.ok[i] && sats.alt[i] < 2000) leo++; if (CLASSES[sats.cls[i]].key === 'D') deb++; }
  const rows = [];
  if (sats) rows.push(['Objects tracked', N(sats.n)], ['In low Earth orbit', N(leo)], ['Debris fragments', N(deb)]);
  rows.push(['Moon distance', `${N(moon.position.length() * RE)}<small>km</small>`]);
  if (neos.length) rows.push(['Asteroids within 7.5M km', `${neos.length}<small>this window</small>`]);
  if (!isNaN(kp)) rows.push(['Geomagnetic Kp', `${kp.toFixed(1)}<small>${kp >= 5 ? 'storm' : kp >= 4 ? 'active' : 'quiet'}</small>`]);
  $('nowRows').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  const d = new Date(ms); $('nowT').textContent = `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())} UTC`;
  // numbers quoted in the copy and FAQ (the server fills them too; this keeps them current)
  const setStat = (k, v) => document.querySelectorAll(`[data-stat="${k}"]`).forEach((e) => { e.textContent = v; });
  if (sats) {
    const cnt = (key) => sats.counts[CLASSES.findIndex((c) => c.key === key)] || 0;
    setStat('total', N(sats.n)); setStat('leo', N(leo)); setStat('debris', N(deb)); setStat('starlink', N(cnt('L'))); setStat('geo', N(cnt('G')));
    setStat('payloads', N(sats.n - cnt('D') - cnt('R')));
    const iss = sats.byNorad.get(25544); if (iss != null) { const oi = orbitInfo(sats.recs[iss]); setStat('issAlt', N((oi.apo + oi.peri) / 2)); setStat('issPeriod', oi.period.toFixed(1)); }
  }
  if (neos.length) {
    const c0 = neos.reduce((a, b) => (b.d.dist_au < a.d.dist_au ? b : a));
    setStat('neos', String(neos.length)); setStat('closestName', String(c0.d.name || c0.d.des).replace(/^\((.*)\)$/, '$1')); setStat('closestLd', (c0.d.dist_au * AU / LD).toFixed(2));
  }
  $('altDiagram').innerHTML = altitudeSVG();
}
function altitudeSVG() {
  const W = 1000, L = 112, R = W - 16, x = (km) => L + (Math.log10(Math.max(km, 1)) / 7) * (R - L);
  const rows = [['Atmosphere', 26], ['Orbits', 70], ['Radiation', 114]], RH = 30;
  let g = '';
  rows.forEach(([t, y]) => { g += `<text x="0" y="${y + 19}" class="rl">${t}</text>`; });
  const band = (lo, hi, y, fill, op, name) => {
    const a = x(lo), b = x(hi), w = Math.max(b - a, 2);
    g += `<rect x="${a}" y="${y}" width="${w}" height="${RH}" rx="5" fill="${fill}" fill-opacity="${op}"><title>${name}: ${fmt(lo)}–${fmt(hi)} km</title></rect>`;
    if (w > name.length * 6.6 + 14) g += `<text x="${a + 8}" y="${y + 19}" class="bl">${name}</text>`;
  };
  LAYERS.forEach((l) => band(l.lo, l.hi, 26, l.color, 0.32, l.name));
  const regFill = { LEO: '#5aa9ff', MEO: '#48cfe0', GEO: '#e9eef6', HEO: '#8a97ad', NEO: '#ff7aa2' };
  REGIMES.forEach((r) => band(r.lo, r.hi, 70, regFill[r.id], r.id === 'GEO' ? 0.9 : 0.28, r.id === 'HEO' ? 'High & cislunar' : r.id === 'NEO' ? 'Asteroid flybys' : r.id));
  BELTS.forEach((b) => band(b.lo, b.hi, 114, b.color, 0.3, b.name.replace(' Van Allen belt', ' belt')));
  // object histogram
  const base = 250, top = 160, bins = 70, hist = new Array(bins).fill(0);
  if (sats) for (let i = 0; i < sats.n; i++) { if (!sats.ok[i]) continue; const k = Math.floor(Math.log10(Math.max(sats.alt[i], 1)) / 7 * bins); if (k >= 0 && k < bins) hist[k]++; }
  const mx = Math.max(1, ...hist), bw = (R - L) / bins;
  g += `<text x="0" y="${top + 14}" class="rl">Tracked</text><text x="0" y="${top + 30}" class="rl">objects</text>`;
  hist.forEach((v, k) => { if (!v) return; const h = Math.max(2, Math.sqrt(v / mx) * (base - top)); g += `<rect x="${L + k * bw + 1}" y="${base - h}" width="${bw - 2}" height="${h}" rx="1.5" fill="#5aa9ff" fill-opacity="0.75"><title>${fmt(v)} objects</title></rect>`; });
  neos.forEach((n) => { const km = n.p.length() * RE - RE; g += `<circle cx="${x(km)}" cy="${base - 6}" r="3.5" fill="none" stroke="#ff7aa2" stroke-width="1.4"><title>${esc(n.d.name || n.d.des)}</title></circle>`; });
  const moonKm = moon.position.length() * RE - RE; g += `<circle cx="${x(moonKm)}" cy="${base - 9}" r="7" fill="#c9ced6"/>`;
  g += `<line x1="${L}" y1="${base + 0.5}" x2="${R}" y2="${base + 0.5}" stroke="rgba(255,255,255,.18)"/>`;
  // markers
  const marks = [[420, 'ISS'], [20200, 'GPS'], [35786, 'GEO'], [moonKm, 'Moon']];
  marks.forEach(([km, t]) => { const X = x(km), anc = t === 'GPS' ? 'end' : t === 'GEO' ? 'start' : 'middle', dx = t === 'GPS' ? -3 : t === 'GEO' ? 3 : 0; g += `<line x1="${X}" y1="${top - 6}" x2="${X}" y2="${base}" stroke="rgba(255,255,255,.22)" stroke-dasharray="2 3"/><text x="${X + dx}" y="${top - 10}" class="mk" text-anchor="${anc}">${t}</text>`; });
  ['1 km', '10 km', '100 km', '1,000 km', '10,000 km', '100,000 km', '1M km', '10M km'].forEach((t, i) => { const X = L + i / 7 * (R - L); g += `<text x="${X}" y="${base + 20}" class="ax" text-anchor="${i === 0 ? 'start' : i === 7 ? 'end' : 'middle'}">${t}</text>`; });
  return `<svg viewBox="0 0 ${W} ${base + 30}" xmlns="http://www.w3.org/2000/svg"><style>
    .rl{fill:#93a0b4;font:500 12px Geist,system-ui,sans-serif}.bl{fill:#e9eef6;font:500 12px Geist,system-ui,sans-serif}
    .ax{fill:#5d6a7e;font:11px "Geist Mono",monospace}.mk{fill:#c3ccd9;font:500 11px Geist,system-ui,sans-serif}</style>${g}</svg>`;
}

// storage notice: shown once, after the scene is up
function maybeNotice() {
  if (store.get('notice', false)) return;
  $('notice').hidden = false;
  const done = () => { store.set('notice', true); $('notice').hidden = true; };
  $('noticeOk').onclick = done; $('notice').querySelector('a').addEventListener('click', done);
}
canvas.addEventListener('pointerdown', () => { $('hint').style.opacity = '0'; }, { once: true });

/* ════════════════════════ MAIN LOOP ════════════════════════ */
function resize() {
  const w = innerWidth, h = innerHeight; renderer.setPixelRatio(targetDpr()); renderer.setSize(w, h, false);
  camera.aspect = skyCam.aspect = w / h; camera.fov = skyCam.fov = w < 700 ? 58 : 48;
  camera.userData.off = -1; camera.updateProjectionMatrix(); skyCam.updateProjectionMatrix();
  const dpr = renderer.getPixelRatio();
  for (const sc of [scene, skyScene]) sc.traverse((o) => { const u = o.material && o.material.uniforms; if (u && u.dpr) u.dpr.value = dpr; });
}
addEventListener('resize', resize); resize();

let lastT = performance.now(), slowTick = 0, histTick = 0, frames = 0, clockTick = 0, tipT = 0, detT = 0, trailT = 0;
const modelPick = [];
let tileBusy = 0;
function frame(now) {
  requestAnimationFrame(frame);
  if (route !== 'explore') { lastT = now; return; } // a content page covers the scene: skip rendering
  const dt = Math.min((now - lastT) / 1000, 0.1); lastT = now; frames++;
  const ms = simNow(); const date = new Date(ms);
  updateBodies(ms);
  const gmst = satellite.gstime(date);
  earthGroup.rotation.y = gmst;
  sunLight.position.copy(sunDir).multiplyScalar(50);
  moon.position.copy(moonPos); moon.lookAt(0, 0, 0);

  if (sats) sats.step(ms);
  // NEOs
  let neoCount = 0; const gp = neoGlow.geometry.attributes.position;
  neos.forEach((n, k) => {
    const ok = n.e.at(ms, _v, n.vel); n.on = ok && neoOn;
    if (ok) n.p.copy(_v);
    n.mesh.visible = n.on; n.trail.visible = neoOn;
    if (n.on) { neoCount++; n.mesh.position.copy(n.p); n.mesh.rotateOnAxis(n.spin, dt * n.rate * Math.max(1, Math.log10(Math.max(clock.rate, 1)) * 3)); gp.setXYZ(k, n.p.x, n.p.y, n.p.z); }
    else gp.setXYZ(k, 0, 0, 0);
  });
  gp.needsUpdate = true; neoGlow.geometry.setDrawRange(0, neos.length);

  // camera
  if (free.on) freeStep(dt);
  else {
    orbitKeys(dt);
    if (!cam.fly && !pointers.size) { cam.az += cam.vAz; cam.el = clamp(cam.el + cam.vEl, -1.53, 1.53); cam.vAz *= 0.9; cam.vEl *= 0.9; }
    stepZoom(dt); stepFly(dt);
    if (!cam.fly) { if (cam.follow) cam.target.copy(cam.follow.pos()).add(cam.pan); else cam.target.copy(cam.pan); }
  }
  if (cam.blend && (cam.blend.t += dt / cam.blend.dur) >= 1) cam.blend = null;
  syncNavTick();
  const wantOff = innerWidth <= 860 && !$('detail').hidden ? Math.round(innerHeight * 0.24) : 0;
  if (wantOff !== camera.userData.off) {
    camera.userData.off = wantOff;
    for (const c of [camera, skyCam]) { if (wantOff) c.setViewOffset(innerWidth, innerHeight, 0, wantOff, innerWidth, innerHeight); else c.clearViewOffset(); }
  }
  applyCamera(); camera.updateMatrixWorld();
  const alt = camAltKm(), altRE = alt / RE;

  // visibility by altitude
  satMat.uniforms.camAlt.value = cam.follow ? Math.max(alt, (cam.follow.pos().length() - 1) * RE) : alt;
  satMat.uniforms.focus.value = layersOn.focus ? 1 : 0;
  const atmoK = layersOn.atmo ? 1 - smooth(4000, 26000, alt) * 0.8 - smooth(26000, 60000, alt) * 0.2 : 0;
  layerShell.material.uniforms.k.value = atmoK; layerShell.visible = atmoK > 0.01;
  auroraMat.uniforms.k.value = layersOn.aurora ? 1 - smooth(30000, 120000, alt) : 0; aurora.visible = auroraMat.uniforms.k.value > 0.01;
  auroraMat.uniforms.time.value = now / 1000;
  belts.m.uniforms.k.value = layersOn.belts ? smooth(1200, 9000, alt) * (1 - smooth(600000, 2000000, alt)) : 0; belts.grp.visible = belts.m.uniforms.k.value > 0.01;
  belts.m.uniforms.time.value = ms / 1000 % 1e6;
  bordersMat.opacity = layersOn.borders ? 0.32 * (1 - smooth(5000, 14000, alt)) : 0;
  gratMat.opacity = layersOn.borders ? 0.10 * (1 - smooth(6000, 18000, alt)) * smooth(300, 900, alt) : 0;
  guides.visible = layersOn.guides; GUIDE_RINGS.forEach((g) => { g.line.material.opacity = g.op * smooth(g.km * 0.9, g.km * 2.2, alt) * (1 - smooth(g.km * 30, g.km * 120, alt)); });
  if (moonOrbit) moonOrbit.material.opacity = 0.25 * smooth(30000, 150000, alt);
  if (now - trailT > 1000) { trailT = now; for (const n of neos) { const T = n.trailT; let a = 0; while (a < T.length - 1 && T[a] < ms - 1.5 * 86400e3) a++; let b = a; while (b < T.length - 1 && T[b] < ms + 1.5 * 86400e3) b++; n.trail.geometry.setDrawRange(a, Math.max(0, b - a + 1)); } }
  neoTrails.children.forEach((l) => { l.material.opacity = 0.32 * smooth(150000, 900000, alt); });
  neoGlow.material.size = 26; neoGlow.material.opacity = 0.75 * smooth(50000, 180000, alt); neoGlow.visible = neoGlow.material.opacity > 0.01;
  satMat.uniforms.k.value = 1 - 0.65 * smooth(60000, 600000, alt);
  dust.visible = layersOn.dust; dust.material.uniforms.camPos.value.copy(camera.position);
  dust.material.uniforms.box.value = clamp(Math.min(altRE, camera.position.distanceTo(cam.target)) * 0.5, 0.004, 40);
  dust.material.uniforms.time.value = now / 1000;
  skyUniforms.rot.value.setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(precessQ.clone().invert()));
  starGroup.quaternion.copy(precessQ);
  // sun in sky pass
  sunSprite.position.copy(sunDir).multiplyScalar(700);
  // dim stars a little when looking at the bright dayside up close (eye adaptation)
  const dayFacing = clamp(camera.position.clone().normalize().dot(sunDir), 0, 1) * (1 - smooth(20000, 100000, alt));
  if (starGroup.userData.mat) starGroup.userData.mat.uniforms.k.value = 1 - dayFacing * 0.55;
  skyUniforms.mwK.value = skyUniforms.mw.value ? 1 - dayFacing * 0.6 : 0;

  // models near the camera (constant on-screen size)
  const pxK = 2 * Math.tan(camera.fov * DEG / 2) / innerHeight;
  for (const k in instanced) instanced[k].count = 0;
  if (sats && alt < 9000) {
    modelPick.length = 0; const cp = camera.position; const lim = Math.max(altRE * 1.4, 0.32);
    for (let i = 0; i < sats.n; i++) {
      if (sats.alpha[i] < 0.3 || sats.cls[i] === 0) continue; const o = i * 3;
      const dx = sats.pos[o] - cp.x, dy = sats.pos[o + 1] - cp.y, dz = sats.pos[o + 2] - cp.z, d = dx * dx + dy * dy + dz * dz;
      if (d < lim * lim) modelPick.push(d, i);
    }
    const idx = []; for (let j = 0; j < modelPick.length; j += 2) idx.push(j);
    idx.sort((a, b) => modelPick[a] - modelPick[b]);
    const take = Math.min(idx.length, 140);
    for (let j = 0; j < take; j++) {
      const i = modelPick[idx[j] + 1]; const kind = MODEL_FOR[sats.cls[i]]; const im = instanced[kind]; if (im.count >= 160) continue;
      sats.posOf(i, _v); if (occluded(_v)) continue;
      const d = Math.sqrt(modelPick[idx[j]]); const sc = d * pxK * (kind === 'debris' ? 14 : 22) * smooth(0, 0.25, 1 - j / take);
      orientSat(i, _v, ms, kind === 'debris'); _s.setScalar(sc); _m.compose(_v, _q, _s); im.setMatrixAt(im.count++, _m);
    }
    for (const k in instanced) instanced[k].instanceMatrix.needsUpdate = true;
  }
  for (const [mesh, nor, px] of [[issMesh, 25544, 26], [cssMesh, 48274, 22]]) {
    const i = sats ? sats.byNorad.get(nor) : null;
    if (i == null || !sats.ok[i] || !classOn[0] || alt > 60000) { mesh.visible = false; continue; }
    sats.posOf(i, _v); mesh.visible = true; mesh.position.copy(_v); orientSat(i, _v, ms, false); mesh.quaternion.copy(_q);
    mesh.scale.setScalar(Math.max(camera.position.distanceTo(_v) * pxK * px, 109 / 1000 / RE));
  }
  for (const n of neos) if (n.on) n.mesh.scale.setScalar(Math.max(camera.position.distanceTo(n.p) * pxK * 16, (n.d.dmax / 1000) / RE));

  // per-object alpha (CPU mirror of the shader rule) for picking, counts and histogram
  if (sats && (++slowTick % 6 === 0 || mouse.moved)) {
    const cA = satMat.uniforms.camAlt.value, foc = layersOn.focus, lim = cA * 2.6 + 350, lim2 = lim * 2.6 + 600; const counts = new Array(CLASSES.length).fill(0);
    for (let i = 0; i < sats.n; i++) {
      let a = sats.ok[i] ? (classOn[sats.cls[i]] ? 1 : 0) : 0; const h = sats.alt[i];
      if (a && foc) a *= 1 - smooth(lim, lim2, h);
      sats.alpha[i] = a; if (a > 0.05) counts[sats.cls[i]]++;
    }
    if (slowTick % 30 === 0 || mouse.moved) {
      CLASSES.forEach((c, i) => { const el = $('ct' + i); if (el) el.innerHTML = `${fmt(counts[i])} <i>/ ${fmt(sats.counts[i])}</i>`; const row = el && el.parentElement; if (row) row.hidden = sats.counts[i] === 0; });
      const ne = $('ctneo'); if (ne) ne.innerHTML = `${neoCount} <i>/ ${neos.length}</i>`;
      const tot = counts.reduce((a, b) => a + b, 0) + (neoOn ? neoCount : 0);
      $('focusN').textContent = `${fmt(tot)} objects drawn · alt ${fmt(alt)} km${free.on ? ` · ${free.speed >= 10 ? fmt(free.speed) : fmt(free.speed, 2)} km/s` : ''}`;
    }
  }
  if (now - histTick > 1500) { histTick = now; updateHist(); }
  $('focusV').textContent = (free.on ? 'Free flight · ' : '') + focusName(satMat.uniforms.camAlt.value);

  // hover picking (once per frame at most)
  if (mouse.moved && mouse.over && !pointers.size && !IS_TOUCH) { mouse.moved = false; setHover(pick(mouse.x, mouse.y)); }
  if (hover && hover.kind === 'sat' && sats.alpha[hover.i] < 0.05 && !sameObj(hover, selected)) setHover(null);
  placeTip();
  if (selected && now - detT > 500) { detT = now; renderDetail(false); }
  if (orbitLine && Math.abs(ms - orbitLine.userData.t) > (clock.rate > 1 ? 20e3 * clock.rate / 60 : 60e3)) buildOrbitPath();

  // clock
  if (now - clockTick > 250) {
    clockTick = now;
    $('clockT').textContent = `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())} UTC`;
    $('clockT').title = date.toUTCString();
    const busy = started && tiles.inflight > 0; if (!busy) tileBusy = 0; else if (!tileBusy) tileBusy = now;
    $('tileChip').hidden = !(tileBusy && now - tileBusy > 600);
    const off = (ms - Date.now()) / 1000, a = Math.abs(off), sgn = off < -0.5 ? '−' : '+';
    $('offset').textContent = a > 86400 * 2 ? `${sgn}${(a / 86400).toFixed(1)} days` : `${sgn}${pad2(Math.floor(a / 3600))}:${pad2(Math.floor(a % 3600 / 60))}:${pad2(Math.floor(a % 60))}`;
    $('liveBtn').classList.toggle('on', isLive());
  }

  updateTiles();
  drawLabels(alt);
  if (frames % 2 === 0) drawLadder(satMat.uniforms.camAlt.value);

  renderer.clear();
  renderer.render(skyScene, skyCam);
  renderer.clearDepth();
  renderer.render(scene, camera);
}
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _rm = new THREE.Matrix4();
function orientSat(i, p, ms, tumble) {
  if (tumble) { _q.setFromAxisAngle(_x.set(Math.sin(i), Math.cos(i * 1.7), Math.sin(i * 2.3)).normalize(), (ms / 1000) * (0.2 + (i % 7) * 0.13)); return; }
  const o = i * 3; _y.copy(p).normalize(); // zenith
  const c = sats.c0; _x.set(c[o] / RE, c[o + 2] / RE, -c[o + 1] / RE).normalize(); // along-track (prograde)
  _z.crossVectors(_x, _y).normalize(); _x.crossVectors(_y, _z).normalize();
  _rm.makeBasis(_x, _y, _z); _q.setFromRotationMatrix(_rm);
}

buildClassUI(); buildLayerUI();
window.__galacticio = { cam, free, enterFree, exitFree, flyTo, select, satObj: (i) => satObj(i), get sats() { return sats; }, neos, moonObj, setRate, jump, setHover, goHome, layersOn, moon, camera, belts, renderer, project: (v) => { const s = {}; return project(v, s) ? s : null; } };
renderSources();
setRoute();
loadAccount();
requestAnimationFrame(frame);
loadAll().catch((e) => { console.error(e); fatal('Something went wrong while starting: ' + e.message); });

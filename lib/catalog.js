// Server-side view of the object catalogue, used for shareable object pages, the sitemap, structured
// data and llms.txt. Classes come from the bundled snapshot; orbital elements are refreshed from the
// live CelesTrak cache when the server has it.
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { cache, TLE_GROUPS } from './upstream.js';

const RE = 6371, MU = 398600.4418, AU = 149597870.7, LD = 384400;
export const CLASSES = {
  S: { name: 'Crewed stations', one: 'Crewed space station', index: true },
  L: { name: 'Starlink', one: 'Starlink broadband satellite', index: false },
  B: { name: 'Other constellations', one: 'Constellation satellite', index: true },
  N: { name: 'Navigation (GNSS)', one: 'Navigation satellite', index: true },
  G: { name: 'Geostationary', one: 'Geostationary satellite', index: true },
  P: { name: 'Other satellites', one: 'Satellite', index: true },
  D: { name: 'Debris', one: 'Debris fragment', index: false },
  R: { name: 'Rocket bodies', one: 'Rocket body', index: false },
};
export const CLASS_ORDER = ['S', 'N', 'G', 'B', 'P', 'L', 'R', 'D'];

export const slugify = (s) => String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
export const satPath = (o) => `/satellite/${o.norad}${slugify(o.name) ? '-' + slugify(o.name) : ''}`;
export const neoPath = (n) => `/asteroid/${slugify(n.des)}`;

function elements(l1, l2) {
  const yy = +l1.slice(18, 20), day = +l1.slice(20, 32);
  const epoch = Date.UTC(yy < 57 ? 2000 + yy : 1900 + yy, 0, 1) + (day - 1) * 86400e3;
  const inc = +l2.slice(8, 16), raan = +l2.slice(17, 25), ecc = +('0.' + l2.slice(26, 33).trim()), n = +l2.slice(52, 63);
  const period = 1440 / n, nRad = n * 2 * Math.PI / 86400, a = Math.cbrt(MU / (nRad * nRad));
  const y2 = l1.slice(9, 11).trim();
  const cospar = y2 ? `${+y2 < 57 ? '20' : '19'}${y2}-${l1.slice(11, 14)}${l1.slice(14, 17).trim()}` : '';
  return { epoch, inc, raan, ecc, period, apo: a * (1 + ecc) - RE, peri: a * (1 - ecc) - RE, cospar };
}
export function regime(o) {
  if (o.ecc > 0.25) return 'Highly elliptical orbit';
  if (o.apo < 2000) return 'Low Earth orbit';
  if (o.peri > 35586 && o.apo < 35986) return 'Geostationary orbit';
  if (o.apo < 35586) return 'Medium Earth orbit';
  return 'High Earth orbit';
}

let state = null; // { objects: Map<norad, obj>, list, neos, ephemGenerated, builtFrom }
function parseBundled() {
  const txt = readFileSync(path.join(config.publicDir, 'data/tle.txt'), 'utf8').split('\n');
  const map = new Map();
  for (let i = 0; i + 2 < txt.length; i += 3) {
    const head = txt[i], l1 = txt[i + 1], l2 = txt[i + 2];
    if (!head || !l1 || !l1.startsWith('1 ') || !l2 || !l2.startsWith('2 ')) continue;
    const bar = head.indexOf('|'); const cls = head.slice(0, bar), name = head.slice(bar + 1).trim();
    const norad = +l1.slice(2, 7); map.set(norad, { norad, name, cls, ...elements(l1, l2), source: 'snapshot' });
  }
  return map;
}
// Same rules as the browser uses for live catalogues (app.js classify), so counts match.
const DOCKED = /^(ISS|CSS) \((?!ZARYA|TIANHE)|^POISK$/;
function classify(name, l1, l2, debris) {
  const norad = +l1.slice(2, 7);
  if (norad === 25544 || norad === 48274) return 'S';
  if (/STARLINK/.test(name)) return 'L';
  if (/ONEWEB|KUIPER|QIANFAN|GUOWANG|HULIANWANG/.test(name)) return 'B';
  if (/GPS |NAVSTAR|GLONASS|GALILEO|GSAT0|BEIDOU|IRNSS|NAVIC|QZS/.test(name)) return 'N';
  if (/R\/B/.test(name)) return 'R';
  if (/ DEB/.test(name)) return 'D';
  const mm = +l2.slice(52, 63), ecc = +('0.' + l2.slice(26, 33));
  if (mm > 0.98 && mm < 1.02 && ecc < 0.02) return 'G';
  return debris ? 'D' : 'P';
}
function overlayLive(map) {
  let n = 0, fresh = false;
  if (!(cache.get('tle-active') || {}).body) return 0; // debris alone is not a full catalogue
  for (const g of TLE_GROUPS) {
    const e = cache.get('tle-' + g); if (!e || !e.body) continue;
    const L = e.body.split(/\r?\n/);
    for (let i = 0; i + 2 < L.length; i++) {
      if (!L[i + 1].startsWith('1 ') || !L[i + 2].startsWith('2 ') || L[i].startsWith('1 ') || L[i].startsWith('2 ')) continue;
      const name = L[i].trim(), norad = +L[i + 1].slice(2, 7);
      if (!DOCKED.test(name)) {
        if (!fresh) { map.clear(); fresh = true; } // a live catalogue replaces the snapshot entirely
        if (!map.has(norad)) { map.set(norad, { norad, name, cls: classify(name, L[i + 1], L[i + 2], g !== 'active'), ...elements(L[i + 1], L[i + 2]), source: 'live' }); n++; }
      }
      i += 2;
    }
  }
  return n;
}
function loadNeos() {
  try {
    const f = path.join(config.publicDir, 'data/ephemeris.json'); const d = JSON.parse(readFileSync(f, 'utf8'));
    const neos = d.neos.map((n) => ({
      des: n.des, name: String(n.name || n.des).replace(/^\((.*)\)$/, '$1'), when: n.cd, km: n.dist_au * AU, ld: n.dist_au * AU / LD,
      v: n.v_rel, h: n.h, dmin: n.dmin, dmax: n.dmax, diameter: n.diameter,
    })).sort((a, b) => a.km - b.km);
    return { neos, generated: d.generated || statSync(f).mtime.toISOString() };
  } catch { return { neos: [], generated: null }; }
}

const liveVersion = () => TLE_GROUPS.map((g) => (cache.get('tle-' + g) || {}).version || 0).join('.');
export function catalog() {
  const v = liveVersion();
  if (state && state.v === v) return state;
  const map = parseBundled(); const live = overlayLive(map);
  const list = [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
  const counts = {}; for (const k of CLASS_ORDER) counts[k] = 0; let leo = 0;
  for (const o of list) { counts[o.cls] = (counts[o.cls] || 0) + 1; if (o.apo < 2000) leo++; }
  const { neos, generated } = loadNeos();
  const updated = live ? Math.max(...TLE_GROUPS.map((g) => (cache.get('tle-' + g) || {}).fetched || 0)) : Date.parse('2026-11-15T02:20:00Z');
  state = { v, objects: map, list, counts, total: list.length, leo, neos, ephemGenerated: generated, updated, live: live > 0 };
  return state;
}
export const findSat = (norad) => catalog().objects.get(norad) || null;
export const findNeo = (slug) => catalog().neos.find((n) => slugify(n.des) === slug) || null;

export const fmt = (n, d = 0) => Number(n).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
export function neoDiameter(n) {
  if (n.diameter) return `${fmt(n.diameter * 1000)} m`;
  return n.dmin && n.dmax ? `${fmt(n.dmin)}–${fmt(n.dmax)} m` : 'unknown';
}
// "2026-Nov-12 12:52" (JPL, TDB) -> Date
export function neoDate(n) { const m = /^(\d{4})-(\w{3})-(\d{1,2}) (\d{2}):(\d{2})/.exec(n.when || ''); if (!m) return null; return new Date(`${m[3]} ${m[2]} ${m[1]} ${m[4]}:${m[5]} UTC`); }
export const fmtDate = (d) => d ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '';

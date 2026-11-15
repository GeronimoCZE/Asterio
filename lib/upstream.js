// Shared cache for upstream feeds (CelesTrak, NOAA SWPC). Stale entries are served immediately while
// a refresh runs in the background, so a slow or failing upstream never blocks visitors. Entries are
// mirrored to disk so restarts do not re-download unchanged data.
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';

const UA = 'Asterio/1.0 (orbital visualisation; +https://github.com/GeronimoCZE/Asterio)';
export const cache = new Map();

async function fetchUpstream(url, timeoutMs = 30000) {
  // Network errors (CelesTrak sometimes resets connections) get two retries; HTTP errors do not.
  for (let attempt = 0; ; attempt++) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctl.signal });
      const body = await r.text();
      if (!r.ok) throw Object.assign(new Error(`${r.status} from ${new URL(url).host}`), { status: r.status });
      return body;
    } catch (err) {
      if (err.status || attempt >= 2) throw err;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1) ** 2));
    } finally { clearTimeout(t); }
  }
}

const diskName = (key) => path.join(config.cacheDir, key.replace(/[^a-z0-9.-]+/gi, '_'));
async function loadFromDisk(key) {
  try { const meta = JSON.parse(await readFile(diskName(key) + '.meta', 'utf8')); return { body: await readFile(diskName(key), 'utf8'), ...meta }; }
  catch { return null; }
}
async function saveToDisk(key, e) {
  try {
    await mkdir(config.cacheDir, { recursive: true });
    await writeFile(diskName(key) + '.tmp', e.body); await rename(diskName(key) + '.tmp', diskName(key));
    await writeFile(diskName(key) + '.meta', JSON.stringify({ type: e.type, fetched: e.fetched }));
  } catch (err) { console.warn('cache write failed', key, err.message); }
}

export async function cached(key, url, type, ttl, validate) {
  let e = cache.get(key);
  if (!e) { e = (await loadFromDisk(key)) || { body: null, type, fetched: 0 }; e.version = e.body ? 1 : 0; cache.set(key, e); }
  const refresh = () => {
    if (e.inflight) return e.inflight;
    e.inflight = fetchUpstream(url).then((body) => {
      if (validate && !validate(body)) throw new Error('unexpected response from ' + new URL(url).host);
      e.body = body; e.type = type; e.fetched = Date.now(); e.error = null; e.version++; saveToDisk(key, e);
    }).catch((err) => {
      // CelesTrak answers 403 when the data has not changed since our last download: keep what we have.
      if (err.status === 403 && e.body) e.fetched = Date.now();
      e.error = err.message; console.warn(`[${key}] refresh failed: ${err.message}`);
    }).finally(() => { e.inflight = null; });
    return e.inflight;
  };
  if (!e.body) await refresh();
  else if (Date.now() - e.fetched > ttl) refresh();
  return e;
}

export const TLE_GROUPS = ['active', 'fengyun-1c-debris', 'cosmos-2251-debris', 'iridium-33-debris', 'cosmos-1408-debris'];
export const TLE_TTL = 2 * 3600e3;
export const tleUrl = (g) => `https://celestrak.org/NORAD/elements/gp.php?FORMAT=tle&GROUP=${g}`;
export const tleOk = (b) => /^1 \d/m.test(b);
export const SWPC_PATHS = new Set([
  'products/noaa-planetary-k-index.json', 'products/summary/solar-wind-speed.json', 'products/summary/solar-wind-mag-field.json',
  'json/goes/primary/xrays-6-hour.json', 'products/noaa-scales.json', 'json/ovation_aurora_latest.json',
]);
export const SWPC_TTL = 5 * 60e3;

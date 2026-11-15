// Asterio web server.
//
// Serves the static site in ./app and a small caching API so every visitor shares one
// fresh copy of the orbital catalogue and space-weather feeds instead of each browser
// hitting CelesTrak and NOAA directly.
//
//   GET /api/health              server status and cache ages
//   GET /api/tle?group=<name>    CelesTrak GP element sets (TLE text), cached 2 h
//   GET /api/swpc/<path>         whitelisted NOAA SWPC JSON feeds, cached 5 min
//
// No dependencies. Node 18+.   PORT (default 4050) and HOST (default 0.0.0.0) are configurable.

import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat, readFile, writeFile, mkdir } from 'node:fs/promises';
import { createGzip } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'app');
const CACHE_DIR = path.join(ROOT, '.cache');
const PORT = Number(process.env.PORT) || 4050;
const HOST = process.env.HOST || '0.0.0.0';
const UA = 'Asterio/1.0 (orbital visualisation; +https://github.com/GeronimoCZE/Asterio)';

const TLE_GROUPS = new Set(['active', 'fengyun-1c-debris', 'cosmos-2251-debris', 'iridium-33-debris', 'cosmos-1408-debris', 'stations']);
const TLE_TTL = 2 * 3600e3;
const SWPC_PATHS = new Set([
  'products/noaa-planetary-k-index.json',
  'products/summary/solar-wind-speed.json',
  'products/summary/solar-wind-mag-field.json',
  'json/goes/primary/xrays-6-hour.json',
  'products/noaa-scales.json',
  'json/ovation_aurora_latest.json',
]);
const SWPC_TTL = 5 * 60e3;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.md': 'text/markdown; charset=utf-8',
};
const COMPRESSIBLE = /^(text\/|application\/json|image\/svg)/;

/* ── upstream cache ─────────────────────────────────────────── */
// Each entry: { body, type, fetched, inflight }. Stale entries are served immediately while a
// refresh runs in the background, so a slow or failing upstream never blocks visitors.
const cache = new Map();

async function fetchUpstream(url, timeoutMs = 30000) {
  // Network errors (CelesTrak sometimes resets connections) get two retries; HTTP errors do not.
  for (let attempt = 0; ; attempt++) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctl.signal });
      const body = await r.text();
      if (!r.ok) throw Object.assign(new Error(`${r.status} from ${new URL(url).host}`), { status: r.status, body });
      return body;
    } catch (err) {
      if (err.status || attempt >= 2) throw err;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1) ** 2));
    } finally { clearTimeout(t); }
  }
}

const diskName = (key) => path.join(CACHE_DIR, key.replace(/[^a-z0-9.-]+/gi, '_'));
async function loadFromDisk(key) {
  try { const meta = JSON.parse(await readFile(diskName(key) + '.meta', 'utf8')); return { body: await readFile(diskName(key), 'utf8'), ...meta }; }
  catch { return null; }
}
async function saveToDisk(key, e) {
  try { await mkdir(CACHE_DIR, { recursive: true }); await writeFile(diskName(key), e.body); await writeFile(diskName(key) + '.meta', JSON.stringify({ type: e.type, fetched: e.fetched })); }
  catch (err) { console.warn('cache write failed', key, err.message); }
}

async function cached(key, url, type, ttl, validate) {
  let e = cache.get(key);
  if (!e) { e = (await loadFromDisk(key)) || { body: null, type, fetched: 0 }; cache.set(key, e); }
  const refresh = () => {
    if (e.inflight) return e.inflight;
    e.inflight = fetchUpstream(url).then((body) => {
      if (validate && !validate(body)) throw new Error('unexpected response from ' + new URL(url).host);
      e.body = body; e.type = type; e.fetched = Date.now(); e.error = null; saveToDisk(key, e);
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

/* ── http ───────────────────────────────────────────────────── */
function send(req, res, status, body, headers = {}) {
  const type = headers['Content-Type'] || 'text/plain; charset=utf-8';
  const gz = COMPRESSIBLE.test(type) && /\bgzip\b/.test(req.headers['accept-encoding'] || '') && Buffer.byteLength(body) > 1024;
  res.writeHead(status, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', Vary: 'Accept-Encoding', ...(gz ? { 'Content-Encoding': 'gzip' } : {}), ...headers });
  if (req.method === 'HEAD') return res.end();
  if (!gz) return res.end(body);
  const z = createGzip(); z.pipe(res); z.end(body);
}
const json = (req, res, status, obj, headers) => send(req, res, status, JSON.stringify(obj), { 'Content-Type': MIME['.json'], ...headers });

async function api(req, res, url) {
  const p = url.pathname.slice(5);
  if (p === 'health') {
    const ages = {}; for (const [k, e] of cache) ages[k] = { fetched: e.fetched ? new Date(e.fetched).toISOString() : null, error: e.error || null };
    return json(req, res, 200, { ok: true, service: 'asterio', time: new Date().toISOString(), cache: ages }, { 'Cache-Control': 'no-store' });
  }
  if (p === 'tle') {
    const g = url.searchParams.get('group') || 'active';
    if (!TLE_GROUPS.has(g)) return json(req, res, 400, { error: 'unknown group' });
    const e = await cached('tle-' + g, `https://celestrak.org/NORAD/elements/gp.php?FORMAT=tle&GROUP=${g}`, MIME['.txt'], TLE_TTL, (b) => /^1 \d/m.test(b));
    if (!e.body) return json(req, res, 502, { error: 'CelesTrak unavailable', detail: e.error });
    return send(req, res, 200, e.body, { 'Content-Type': e.type, 'Cache-Control': 'public, max-age=600', 'X-Fetched': new Date(e.fetched).toISOString() });
  }
  if (p.startsWith('swpc/')) {
    const sp = p.slice(5);
    if (!SWPC_PATHS.has(sp)) return json(req, res, 404, { error: 'not proxied' });
    const e = await cached('swpc-' + sp, 'https://services.swpc.noaa.gov/' + sp, MIME['.json'], SWPC_TTL, (b) => /^[[{]/.test(b.trim()));
    if (!e.body) return json(req, res, 502, { error: 'NOAA SWPC unavailable', detail: e.error });
    return send(req, res, 200, e.body, { 'Content-Type': e.type, 'Cache-Control': 'public, max-age=120', 'X-Fetched': new Date(e.fetched).toISOString() });
  }
  return json(req, res, 404, { error: 'not found' });
}

async function serveStatic(req, res, url) {
  let rel; try { rel = decodeURIComponent(url.pathname); } catch { return send(req, res, 400, 'Bad request'); }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) return send(req, res, 403, 'Forbidden');
  let st; try { st = await stat(file); } catch { return send(req, res, 404, 'Not found'); }
  if (st.isDirectory()) { res.writeHead(301, { Location: url.pathname + '/' }); return res.end(); }
  const ext = path.extname(file).toLowerCase(); const type = MIME[ext] || 'application/octet-stream';
  const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
  // Imagery tiles never change in place; code and data revalidate on each load.
  const cacheCtl = rel.startsWith('/tiles/') ? 'public, max-age=604800' : 'no-cache';
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag, 'Cache-Control': cacheCtl }); return res.end(); }
  const gz = COMPRESSIBLE.test(type) && /\bgzip\b/.test(req.headers['accept-encoding'] || '') && st.size > 1024;
  res.writeHead(200, { 'Content-Type': type, ETag: etag, 'Cache-Control': cacheCtl, 'X-Content-Type-Options': 'nosniff', Vary: 'Accept-Encoding', ...(gz ? { 'Content-Encoding': 'gzip' } : { 'Content-Length': st.size }) });
  if (req.method === 'HEAD') return res.end();
  const s = createReadStream(file); s.on('error', () => res.destroy());
  (gz ? s.pipe(createGzip()) : s).pipe(res);
}

// index.html in ./app is a body fragment (it is also published as a hosted page that adds the
// document skeleton). Served standalone, wrap it in a proper HTML document.
async function serveIndex(req, res) {
  const frag = await readFile(path.join(PUBLIC, 'index.html'), 'utf8');
  const head = frag.slice(0, frag.indexOf('<style>')).replace('<meta charset="utf-8">\n', ''); const rest = frag.slice(frag.indexOf('<style>'));
  const styleEnd = rest.indexOf('</style>') + 8;
  const html = `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<meta name="theme-color" content="#05070d">\n<link rel="icon" href="favicon.svg" type="image/svg+xml">\n${head}${rest.slice(0, styleEnd)}\n</head>\n<body>\n${rest.slice(styleEnd)}\n</body>\n</html>\n`;
  send(req, res, 200, html, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
}

const server = http.createServer(async (req, res) => {
  const t0 = Date.now();
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(req, res, 405, 'Method not allowed', { Allow: 'GET, HEAD' });
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) await api(req, res, url);
    else if (url.pathname === '/' || url.pathname === '/index.html') await serveIndex(req, res);
    else await serveStatic(req, res, url);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) send(req, res, 500, 'Server error'); else res.destroy();
  } finally {
    if (process.env.LOG) res.on('finish', () => console.log(`${req.method} ${req.url} ${res.statusCode} ${Date.now() - t0}ms`));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Asterio running at http://localhost:${PORT}`);
  // Warm the caches so the first visitor does not wait on CelesTrak.
  (async () => {
    for (const g of ['active', 'fengyun-1c-debris', 'cosmos-2251-debris', 'iridium-33-debris', 'cosmos-1408-debris'])
      await cached('tle-' + g, `https://celestrak.org/NORAD/elements/gp.php?FORMAT=tle&GROUP=${g}`, MIME['.txt'], TLE_TTL, (b) => /^1 \d/m.test(b)).catch(() => {});
  })();
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.close(() => process.exit(0)));

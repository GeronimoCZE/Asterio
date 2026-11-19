// Galacticio web server. No dependencies, Node 18+.
//
// Pages      /  /about  /sources  /satellites  /terms  /privacy  /cookies
//            /satellite/<norad>-<slug>   /asteroid/<designation>
// SEO        /sitemap.xml (+ sitemap-*.xml)  /robots.txt  /llms.txt
// Data API   GET /api/health  /api/tle?group=<name>  /api/swpc/<path>
// Accounts   POST /api/auth/google  POST /api/auth/logout  GET|DELETE /api/me
//            PUT /api/me/watchlist  PUT /api/me/prefs
//
// Configuration: environment variables or a .env file (see .env.example).

import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat, readFile } from 'node:fs/promises';
import { createGzip } from 'node:zlib';
import path from 'node:path';
import { config } from './lib/config.js';
import { MIME, send, json, acceptsGzip, corsCheck, preflight, htmlSecurityHeaders, siteOrigin } from './lib/http.js';
import { clientIp, take, headers as rlHeaders } from './lib/ratelimit.js';
import { cache, cached, TLE_GROUPS, TLE_TTL, tleUrl, tleOk, SWPC_PATHS, SWPC_TTL } from './lib/upstream.js';
import { resolveRoute, renderPage, sitemap, robots, llms } from './lib/seo.js';
import { handleAuth, userCount } from './lib/auth.js';
import { catalog } from './lib/catalog.js';

const PUBLIC = config.publicDir;

/* ── index.html, re-read when it changes ───────────────────── */
let frag = { text: '', mtime: 0 };
async function indexFragment() {
  const f = path.join(PUBLIC, 'index.html'); const st = await stat(f);
  if (st.mtimeMs !== frag.mtime) frag = { text: await readFile(f, 'utf8'), mtime: st.mtimeMs };
  return frag;
}

function limited(req, res, bucket, ip) {
  const r = take(bucket, ip);
  if (r.ok) { for (const [k, v] of Object.entries(rlHeaders(r))) res.setHeader(k, v); return false; }
  const h = rlHeaders(r);
  if (req.url.startsWith('/api/')) json(req, res, 429, { error: 'Too many requests. Please slow down.', retryAfter: +h['Retry-After'] }, h);
  else send(req, res, 429, 'Too many requests. Please wait a moment and try again.', { ...h, 'Cache-Control': 'no-store' });
  return true;
}

/* ── data API ──────────────────────────────────────────────── */
async function dataApi(req, res, url, ip, cors) {
  const p = url.pathname.slice(5);
  const h = { ...cors.headers };
  if (p === 'health') {
    if (limited(req, res, 'api', ip)) return;
    const ages = {}; for (const [k, e] of cache) ages[k] = { fetched: e.fetched ? new Date(e.fetched).toISOString() : null, error: e.error || null };
    const c = catalog();
    return json(req, res, 200, { ok: true, service: 'galacticio', time: new Date().toISOString(), objects: c.total, live: c.live, accounts: userCount(), google: !!config.googleClientId, cache: ages }, h);
  }
  if (p === 'tle') {
    if (limited(req, res, 'tle', ip)) return;
    const g = url.searchParams.get('group') || 'active';
    if (!TLE_GROUPS.includes(g)) return json(req, res, 400, { error: 'unknown group' }, h);
    const e = await cached('tle-' + g, tleUrl(g), MIME['.txt'], TLE_TTL, tleOk);
    if (!e.body) return json(req, res, 502, { error: 'CelesTrak unavailable', detail: e.error }, h);
    return send(req, res, 200, e.body, { ...h, 'Content-Type': e.type, 'Cache-Control': 'public, max-age=600', 'X-Fetched': new Date(e.fetched).toISOString() });
  }
  if (p.startsWith('swpc/')) {
    if (limited(req, res, 'api', ip)) return;
    const sp = p.slice(5);
    if (!SWPC_PATHS.has(sp)) return json(req, res, 404, { error: 'not proxied' }, h);
    const e = await cached('swpc-' + sp, 'https://services.swpc.noaa.gov/' + sp, MIME['.json'], SWPC_TTL, (b) => /^[[{]/.test(b.trim()));
    if (!e.body) return json(req, res, 502, { error: 'NOAA SWPC unavailable', detail: e.error }, h);
    return send(req, res, 200, e.body, { ...h, 'Content-Type': e.type, 'Cache-Control': 'public, max-age=120', 'X-Fetched': new Date(e.fetched).toISOString() });
  }
  return json(req, res, 404, { error: 'not found' }, h);
}

/* ── pages ─────────────────────────────────────────────────── */
async function page(req, res, route) {
  const f = await indexFragment();
  const { html, inlineScripts } = renderPage(f.text, route, siteOrigin(req));
  send(req, res, route.status, html, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache', ...htmlSecurityHeaders(req, inlineScripts) });
}

async function seoFile(req, res, name) {
  const site = siteOrigin(req);
  if (name === 'robots.txt') return send(req, res, 200, robots(site), { 'Content-Type': MIME['.txt'], 'Cache-Control': 'public, max-age=3600' });
  if (name === 'llms.txt') return send(req, res, 200, llms(site), { 'Content-Type': 'text/markdown; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
  const f = await indexFragment();
  const xml = sitemap(name, site, f.mtime);
  if (xml) return send(req, res, 200, xml, { 'Content-Type': MIME['.xml'], 'Cache-Control': 'public, max-age=3600' });
  return false;
}

async function serveStatic(req, res, url) {
  let rel; try { rel = decodeURIComponent(url.pathname); } catch { return send(req, res, 400, 'Bad request'); }
  if (rel.includes('\0')) return send(req, res, 400, 'Bad request');
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep) || path.basename(file) === 'index.html') return false;
  let st; try { st = await stat(file); } catch { return false; }
  if (!st.isFile()) return false;
  const ext = path.extname(file).toLowerCase(); const type = MIME[ext] || 'application/octet-stream';
  const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
  // Imagery tiles and brand images never change in place; code and data revalidate on each load.
  const cacheCtl = /^\/(tiles|brand)\//.test(rel) ? 'public, max-age=604800' : 'no-cache';
  const base = { ETag: etag, 'Cache-Control': cacheCtl, 'X-Content-Type-Options': 'nosniff', Vary: 'Accept-Encoding',
    // Let other sites show our social images, but not hotlink the app's data and imagery.
    'Cross-Origin-Resource-Policy': rel.startsWith('/brand/') || /^\/(favicon\.(svg|ico)|site\.webmanifest)$/.test(rel) ? 'cross-origin' : 'same-site' };
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, base); return res.end(); }
  const gz = /^(text\/|application\/(json|xml)|image\/svg)/.test(type) && acceptsGzip(req) && st.size > 1024;
  res.writeHead(200, { ...base, 'Content-Type': type, ...(gz ? { 'Content-Encoding': 'gzip' } : { 'Content-Length': st.size }) });
  if (req.method === 'HEAD') return res.end();
  const s = createReadStream(file); s.on('error', () => res.destroy());
  (gz ? s.pipe(createGzip()) : s).pipe(res);
}

/* ── request handling ──────────────────────────────────────── */
async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const ip = clientIp(req, config.trustProxy);
  const isApi = url.pathname.startsWith('/api/');
  const isAccount = isApi && /^\/api\/(auth\/|me(\/|$))/.test(url.pathname);

  if (isApi) {
    if (req.method === 'OPTIONS') return preflight(req, res, { publicData: !isAccount });
    const cors = corsCheck(req, { publicData: !isAccount });
    if (!cors.ok) return json(req, res, 403, { error: 'This origin is not allowed to use the Galacticio API.' }, { Vary: 'Origin' });
    if (isAccount) {
      const write = req.method !== 'GET' && req.method !== 'HEAD';
      if (limited(req, res, url.pathname === '/api/auth/google' ? 'auth' : write ? 'write' : 'api', ip)) return;
      return handleAuth(req, res, url.pathname.slice(5));
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(req, res, 405, { error: 'method not allowed' }, { Allow: 'GET, HEAD, OPTIONS' });
    return dataApi(req, res, url, ip, cors);
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(req, res, 405, 'Method not allowed', { Allow: 'GET, HEAD' });

  // canonical forms: no trailing slash, no /index.html, lowercase object slugs
  if (url.pathname !== '/' && (url.pathname.endsWith('/') || url.pathname === '/index.html')) {
    const to = url.pathname === '/index.html' ? '/' : url.pathname.replace(/\/+$/, '') || '/';
    res.writeHead(301, { Location: to + url.search }); return res.end();
  }
  if (/^\/(sitemap(-[a-z]+)?\.xml|robots\.txt|llms\.txt)$/.test(url.pathname)) {
    if (limited(req, res, 'page', ip)) return;
    if ((await seoFile(req, res, url.pathname.slice(1))) !== false) return;
  }
  const route = resolveRoute(url.pathname.toLowerCase() === url.pathname ? url.pathname : url.pathname.toLowerCase());
  if (route && route.redirect) { res.writeHead(301, { Location: route.redirect + url.search }); return res.end(); }
  if (route && url.pathname !== url.pathname.toLowerCase()) { res.writeHead(301, { Location: route.path + url.search }); return res.end(); }
  if (route) { if (limited(req, res, 'page', ip)) return; return page(req, res, route); }

  if (limited(req, res, 'asset', ip)) return;
  if ((await serveStatic(req, res, url)) !== false) return;
  return page(req, res, { name: '404', path: url.pathname, status: 404 });
}

const server = http.createServer((req, res) => {
  const t0 = Date.now();
  if (config.log) res.on('finish', () => console.log(`${req.method} ${req.url} ${res.statusCode} ${Date.now() - t0}ms`));
  handle(req, res).catch((err) => {
    console.error(err);
    if (!res.headersSent) send(req, res, 500, 'Server error'); else res.destroy();
  });
});
// Drop slow or stalled clients instead of holding sockets open.
server.headersTimeout = 15000; server.requestTimeout = 30000; server.keepAliveTimeout = 5000; server.maxHeadersCount = 64;

server.listen(config.port, config.host, () => {
  console.log(`Galacticio running at http://localhost:${config.port}`);
  if (!config.siteUrl) console.log('Tip: set SITE_URL (e.g. https://galacticio.example) so canonical links and the sitemap use your public address.');
  if (!config.googleClientId) console.log('Google sign-in is off. Set GOOGLE_CLIENT_ID to turn it on.');
  // Warm the caches so the first visitor does not wait on CelesTrak.
  (async () => { for (const g of TLE_GROUPS) await cached('tle-' + g, tleUrl(g), MIME['.txt'], TLE_TTL, tleOk).catch(() => {}); })();
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.close(() => process.exit(0)));

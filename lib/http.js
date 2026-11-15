// Response helpers, security headers and the CORS policy.
import { createGzip } from 'node:zlib';
import { createHash } from 'node:crypto';
import { config } from './config.js';

export const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.md': 'text/markdown; charset=utf-8', '.xml': 'application/xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};
const COMPRESSIBLE = /^(text\/|application\/(json|xml|manifest)|image\/svg)/;

export const acceptsGzip = (req) => /\bgzip\b/.test(req.headers['accept-encoding'] || '');
export function send(req, res, status, body, headers = {}) {
  const type = headers['Content-Type'] || 'text/plain; charset=utf-8';
  const gz = COMPRESSIBLE.test(type) && acceptsGzip(req) && Buffer.byteLength(body) > 1024;
  res.writeHead(status, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', Vary: 'Accept-Encoding', ...(gz ? { 'Content-Encoding': 'gzip' } : {}), ...headers });
  if (req.method === 'HEAD') return res.end();
  if (!gz) return res.end(body);
  const z = createGzip(); z.pipe(res); z.end(body);
}
export const json = (req, res, status, obj, headers = {}) => send(req, res, status, JSON.stringify(obj), { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store', ...headers });

// Is the request coming over HTTPS (directly or through a trusted proxy)?
export function isHttps(req) {
  if (req.socket.encrypted) return true;
  if (config.trustProxy && String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https') return true;
  return config.siteUrl.startsWith('https://') && !/^(localhost|127\.|\[::1\])/.test(req.headers.host || '');
}
export function requestOrigin(req) {
  const host = (config.trustProxy && req.headers['x-forwarded-host']) || req.headers.host || 'localhost';
  return `${isHttps(req) ? 'https' : 'http'}://${String(host).split(',')[0].trim()}`;
}
export function siteOrigin(req) { return config.siteUrl || requestOrigin(req); }

/* ── CORS ──────────────────────────────────────────────────────
   Same-origin requests always pass. The public data API (catalogue, space weather) may also be read
   by origins listed in ALLOWED_ORIGINS, without credentials. Account endpoints are same-origin only.
   Anything else cross-origin is refused outright so other sites cannot spend our upstream quota. */
function sameOrigin(origin, req) {
  try { const o = new URL(origin); return o.host === new URL(requestOrigin(req)).host || (config.siteUrl && o.origin === new URL(config.siteUrl).origin); }
  catch { return false; }
}
export function corsCheck(req, { publicData }) {
  const origin = req.headers.origin;
  if (!origin) return { ok: true, headers: {} };   // same-origin GET, or a non-browser client
  if (origin === 'null') return { ok: false };     // sandboxed frames and file:// pages
  if (sameOrigin(origin, req)) return { ok: true, headers: {} };
  if (publicData && config.allowedOrigins.includes(origin)) {
    return { ok: true, headers: { 'Access-Control-Allow-Origin': origin, Vary: 'Origin, Accept-Encoding', 'Access-Control-Expose-Headers': 'X-Fetched, RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset, Retry-After' } };
  }
  return { ok: false };
}
export function preflight(req, res, { publicData }) {
  const c = corsCheck(req, { publicData });
  if (!c.ok || !c.headers['Access-Control-Allow-Origin']) { res.writeHead(c.ok ? 204 : 403, { Vary: 'Origin' }); return res.end(); }
  res.writeHead(204, { ...c.headers, 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600' });
  res.end();
}
// State-changing requests must come from our own pages (CSRF defence on top of SameSite cookies).
export function sameSiteWrite(req) {
  const o = req.headers.origin, site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin') return false;
  return !!o && sameOrigin(o, req);
}

/* ── security headers for HTML ─────────────────────────────── */
const sha256 = (s) => "'sha256-" + createHash('sha256').update(s).digest('base64') + "'";
export function htmlSecurityHeaders(req, inlineScripts = []) {
  const https = isHttps(req);
  const csp = [
    "default-src 'self'",
    `script-src 'self' https://cdn.jsdelivr.net https://accounts.google.com/gsi/client ${inlineScripts.map(sha256).join(' ')}`.trim(),
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com/gsi/style",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https://lh3.googleusercontent.com",
    "connect-src 'self' https://celestrak.org https://services.swpc.noaa.gov https://accounts.google.com/gsi/",
    'frame-src https://accounts.google.com/gsi/',
    "worker-src 'self' blob:",
    "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'self'",
    ...(https ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
  return {
    'Content-Security-Policy': csp,
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()',
    // Google's sign-in popup needs to talk back to this window.
    'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
    'X-Frame-Options': 'SAMEORIGIN',
    ...(https ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' } : {}),
  };
}

/* ── small utilities ───────────────────────────────────────── */
export function readBody(req, limit = 16 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(Object.assign(new Error('body too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
export async function readJson(req, limit) {
  if (!/^application\/json\b/.test(req.headers['content-type'] || '')) throw Object.assign(new Error('expected application/json'), { status: 415 });
  try { return JSON.parse(await readBody(req, limit) || '{}'); } catch (e) { if (e.status) throw e; throw Object.assign(new Error('invalid JSON'), { status: 400 }); }
}
export function parseCookies(req) {
  const out = {}; for (const part of String(req.headers.cookie || '').split(';')) { const i = part.indexOf('='); if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); }
  return out;
}
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

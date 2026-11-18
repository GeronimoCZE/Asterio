// Sign in with Google, sessions and per-user data (watchlist and view preferences).
//
// The browser gets an ID token from Google Identity Services and posts it here. We verify the token's
// RS256 signature against Google's published keys, its issuer, audience (our client ID) and expiry,
// then set an HttpOnly session cookie signed with HMAC. No passwords, no Google access tokens stored.
import { createHmac, createPublicKey, verify as rsaVerify, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { json, readJson, parseCookies, isHttps, sameSiteWrite } from './http.js';

const COOKIE = 'galacticio_session';
const LEGACY_COOKIE = 'asterio_session'; // sessions from before the rename stay valid until they expire
const GOOGLE_CERTS = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
const MAX_WATCH = 200;

/* ── Google ID token ───────────────────────────────────────── */
let jwks = { keys: new Map(), expires: 0, lastFetch: 0 };
async function googleKey(kid, fetcher = fetch) {
  const now = Date.now();
  if (jwks.keys.has(kid) && now < jwks.expires) return jwks.keys.get(kid);
  if (now - jwks.lastFetch > 60e3 || now >= jwks.expires) { // refetch at most once a minute for unknown kids
    jwks.lastFetch = now;
    const r = await fetcher(GOOGLE_CERTS); if (!r.ok) throw new Error('could not load Google signing keys');
    const body = await r.json(); const maxAge = +((r.headers.get('cache-control') || '').match(/max-age=(\d+)/) || [])[1] || 3600;
    jwks = { keys: new Map(body.keys.map((k) => [k.kid, createPublicKey({ key: k, format: 'jwk' })])), expires: now + maxAge * 1000, lastFetch: now };
  }
  const k = jwks.keys.get(kid); if (!k) throw new Error('unknown signing key'); return k;
}
export async function verifyGoogleIdToken(token, clientId, { fetcher, now = Date.now() } = {}) {
  if (typeof token !== 'string' || token.length > 4096) throw new Error('malformed token');
  const parts = token.split('.'); if (parts.length !== 3) throw new Error('malformed token');
  const [h, p, sig] = parts;
  const header = JSON.parse(Buffer.from(h, 'base64url').toString()); const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
  if (header.alg !== 'RS256' || !header.kid) throw new Error('unexpected token algorithm');
  const key = await googleKey(header.kid, fetcher);
  if (!rsaVerify('RSA-SHA256', Buffer.from(h + '.' + p), key, Buffer.from(sig, 'base64url'))) throw new Error('bad signature');
  const t = Math.floor(now / 1000);
  if (!ISSUERS.has(claims.iss)) throw new Error('wrong issuer');
  if (!(Array.isArray(claims.aud) ? claims.aud.includes(clientId) : claims.aud === clientId)) throw new Error('wrong audience');
  if (!(claims.exp > t - 60)) throw new Error('token expired');
  if (claims.iat && claims.iat > t + 300) throw new Error('token issued in the future');
  if (!claims.sub) throw new Error('no subject');
  return claims;
}
export const _setJwks = (keys, expires) => { jwks = { keys, expires, lastFetch: Date.now() }; }; // tests

/* ── sessions: base64url(json).hmac ────────────────────────── */
const sign = (data) => createHmac('sha256', config.sessionSecret).update(data).digest('base64url');
function makeSession(sub) {
  const exp = Math.floor(Date.now() / 1000) + config.sessionDays * 86400;
  const data = Buffer.from(JSON.stringify({ sub, exp })).toString('base64url');
  return data + '.' + sign(data);
}
function readSession(req) {
  const jar = parseCookies(req); const raw = jar[COOKIE] || jar[LEGACY_COOKIE]; if (!raw) return null;
  const [data, mac] = raw.split('.'); if (!data || !mac) return null;
  const want = Buffer.from(sign(data)), got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try { const s = JSON.parse(Buffer.from(data, 'base64url').toString()); return s.exp > Date.now() / 1000 ? s : null; } catch { return null; }
}
function cookie(req, value, maxAge, name = COOKIE) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isHttps(req) ? '; Secure' : ''}`;
}
const clearCookies = (req) => [cookie(req, '', 0), cookie(req, '', 0, LEGACY_COOKIE)];

/* ── user store: one JSON file, written atomically ─────────── */
const USERS = path.join(config.dataDir, 'users.json');
let users = {};
try { users = JSON.parse(readFileSync(USERS, 'utf8')).users || {}; } catch { users = {}; }
let saveTimer = null, saving = Promise.resolve();
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saving = saving.then(async () => {
      await mkdir(config.dataDir, { recursive: true });
      await writeFile(USERS + '.tmp', JSON.stringify({ users }), { mode: 0o600 }); await rename(USERS + '.tmp', USERS);
    }).catch((e) => console.error('could not save users', e.message));
  }, 300);
}
export const userCount = () => Object.keys(users).length;
const publicUser = (u) => u && { name: u.name, email: u.email, picture: u.picture, since: u.created };

/* ── input validation ──────────────────────────────────────── */
function cleanWatchlist(items) {
  if (!Array.isArray(items)) return null;
  const out = [], seen = new Set();
  for (const it of items.slice(0, MAX_WATCH)) {
    if (!it || typeof it !== 'object') continue;
    if (it.kind === 'sat' && Number.isInteger(it.id) && it.id > 0 && it.id < 1e6) { const k = 'sat' + it.id; if (!seen.has(k)) { seen.add(k); out.push({ kind: 'sat', id: it.id, name: String(it.name || '').slice(0, 80) }); } }
    else if (it.kind === 'neo' && typeof it.id === 'string' && /^[\w ()-]{3,40}$/.test(it.id)) { const k = 'neo' + it.id; if (!seen.has(k)) { seen.add(k); out.push({ kind: 'neo', id: it.id, name: String(it.name || '').slice(0, 80) }); } }
  }
  return out;
}
function cleanPrefs(p) {
  if (!p || typeof p !== 'object') return null;
  const out = {};
  if (p.imagery === 'bm' || p.imagery === 'viirs') out.imagery = p.imagery;
  for (const group of ['layers', 'classes']) {
    if (p[group] && typeof p[group] === 'object') {
      out[group] = {}; for (const [k, v] of Object.entries(p[group]).slice(0, 24)) if (/^[a-z]{1,12}$/i.test(k) && typeof v === 'boolean') out[group][k] = v;
    }
  }
  return out;
}

/* ── routes: /api/auth/*, /api/me ──────────────────────────── */
export async function handleAuth(req, res, sub) {
  const method = req.method;
  const write = method !== 'GET' && method !== 'HEAD';
  if (write && !sameSiteWrite(req)) return json(req, res, 403, { error: 'cross-site request refused' });

  if (sub === 'auth/google' && method === 'POST') {
    if (!config.googleClientId) return json(req, res, 503, { error: 'Google sign-in is not configured on this server' });
    let claims;
    try { const body = await readJson(req, 8 * 1024); claims = await verifyGoogleIdToken(body.credential, config.googleClientId); }
    catch (e) { return json(req, res, e.status || 401, { error: 'sign-in failed', detail: e.message }); }
    const now = new Date().toISOString();
    const u = users[claims.sub] || { created: now, watchlist: [], prefs: {} };
    Object.assign(u, { name: String(claims.name || claims.given_name || 'Galacticio user').slice(0, 80), email: claims.email_verified ? String(claims.email || '').slice(0, 120) : '', picture: /^https:\/\/lh3\.googleusercontent\.com\//.test(claims.picture || '') ? claims.picture : '', lastLogin: now });
    users[claims.sub] = u; save();
    res.setHeader('Set-Cookie', cookie(req, makeSession(claims.sub), config.sessionDays * 86400));
    return json(req, res, 200, { user: publicUser(u), watchlist: u.watchlist, prefs: u.prefs });
  }
  if (sub === 'auth/logout' && method === 'POST') {
    res.setHeader('Set-Cookie', clearCookies(req));
    return json(req, res, 200, { ok: true });
  }

  const s = readSession(req); const u = s && users[s.sub];
  if (sub === 'me' && method === 'GET') {
    if (!u) return json(req, res, 200, { user: null, google: !!config.googleClientId });
    return json(req, res, 200, { user: publicUser(u), watchlist: u.watchlist, prefs: u.prefs, google: true });
  }
  if (!u) return json(req, res, 401, { error: 'not signed in' });
  if (sub === 'me' && method === 'DELETE') {
    delete users[s.sub]; save();
    res.setHeader('Set-Cookie', clearCookies(req));
    return json(req, res, 200, { ok: true, deleted: true });
  }
  if (sub === 'me/watchlist' && method === 'PUT') {
    let body; try { body = await readJson(req, 32 * 1024); } catch (e) { return json(req, res, e.status || 400, { error: e.message }); }
    const w = cleanWatchlist(body.items); if (!w) return json(req, res, 400, { error: 'items must be a list' });
    u.watchlist = w; save(); return json(req, res, 200, { watchlist: w });
  }
  if (sub === 'me/prefs' && method === 'PUT') {
    let body; try { body = await readJson(req, 8 * 1024); } catch (e) { return json(req, res, e.status || 400, { error: e.message }); }
    const p = cleanPrefs(body); if (!p) return json(req, res, 400, { error: 'invalid preferences' });
    u.prefs = p; save(); return json(req, res, 200, { prefs: p });
  }
  return json(req, res, 405, { error: 'method not allowed' });
}

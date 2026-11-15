// End-to-end test of Google sign-in, sessions, watchlist, CSRF and CORS, with Google's key endpoint
// replaced by a local key pair. Run: node test/auth-flow.test.mjs
import { generateKeyPairSync, createSign } from 'node:crypto';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PORT = 4061, BASE = `http://127.0.0.1:${PORT}`, CLIENT = 'test-client.apps.googleusercontent.com';
process.env.PORT = String(PORT); process.env.HOST = '127.0.0.1'; process.env.GOOGLE_CLIENT_ID = CLIENT;
process.env.SESSION_SECRET = 'x'.repeat(48); process.env.ALLOWED_ORIGINS = 'https://friend.example';
// Never touch the real user store: run against a throwaway data directory.
const DATA = mkdtempSync(path.join(tmpdir(), 'asterio-test-')); process.env.DATA_DIR = DATA;
process.on('exit', () => rmSync(DATA, { recursive: true, force: true }));

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => String(url).startsWith('https://www.googleapis.com/oauth2/v3/certs')
  ? new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'content-type': 'application/json', 'cache-control': 'max-age=3600' } })
  : realFetch(url, opts);

function token(claims, { kid = 'k1', key = privateKey } = {}) {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const h = b({ alg: 'RS256', kid, typ: 'JWT' }), p = b(claims);
  const sig = createSign('RSA-SHA256').update(h + '.' + p).sign(key).toString('base64url');
  return `${h}.${p}.${sig}`;
}
const now = Math.floor(Date.now() / 1000);
const good = { iss: 'https://accounts.google.com', aud: CLIENT, sub: 'test-user-1', email: 'ada@example.com', email_verified: true, name: 'Ada Test', iat: now, exp: now + 3600 };

await import('../server.js');
await new Promise((r) => setTimeout(r, 300));

const post = (path, body, headers = {}) => fetch(BASE + path, { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE, ...headers }, body: JSON.stringify(body) });
let r, j;

// 1. bad tokens are rejected
for (const [label, t] of [
  ['wrong audience', token({ ...good, aud: 'someone-else' })], ['expired', token({ ...good, exp: now - 3600 })],
  ['wrong issuer', token({ ...good, iss: 'https://evil.example' })], ['unknown key', token(good, { kid: 'nope' })],
  ['forged signature', token(good, { key: generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey })], ['garbage', 'a.b.c'],
]) { r = await post('/api/auth/google', { credential: t }); assert.equal(r.status, 401, label); }
console.log('✓ rejects bad tokens (audience, expiry, issuer, key, signature, garbage)');

// 2. cross-site sign-in attempt is refused
r = await post('/api/auth/google', { credential: token(good) }, { origin: 'https://evil.example' });
assert.equal(r.status, 403); console.log('✓ refuses cross-origin sign-in');

// 3. good token signs in and sets an HttpOnly cookie
r = await post('/api/auth/google', { credential: token(good) }); j = await r.json();
assert.equal(r.status, 200); assert.equal(j.user.name, 'Ada Test'); assert.equal(j.user.email, 'ada@example.com');
const setCookie = r.headers.get('set-cookie'); assert.match(setCookie, /asterio_session=.+; Path=\/; HttpOnly; SameSite=Lax/);
const cookie = setCookie.split(';')[0]; console.log('✓ signs in with a valid token, sets HttpOnly SameSite cookie');

// 4. /api/me with and without the cookie, tampered cookie
j = await (await fetch(BASE + '/api/me', { headers: { cookie } })).json(); assert.equal(j.user.name, 'Ada Test');
j = await (await fetch(BASE + '/api/me')).json(); assert.equal(j.user, null);
j = await (await fetch(BASE + '/api/me', { headers: { cookie: cookie.slice(0, -2) + 'xx' } })).json(); assert.equal(j.user, null);
console.log('✓ session cookie works and tampering is detected');

// 5. watchlist save, validation, CSRF
const put = (path, body, headers = {}) => fetch(BASE + path, { method: 'PUT', headers: { 'content-type': 'application/json', origin: BASE, cookie, ...headers }, body: JSON.stringify(body) });
r = await put('/api/me/watchlist', { items: [{ kind: 'sat', id: 25544, name: 'ISS' }, { kind: 'neo', id: '2026 VU15' }, { kind: 'sat', id: 25544 }, { kind: 'bad', id: 1 }, { kind: 'sat', id: 'x' }] });
j = await r.json(); assert.equal(r.status, 200); assert.equal(j.watchlist.length, 2);
r = await put('/api/me/watchlist', { items: [] }, { origin: 'https://evil.example' }); assert.equal(r.status, 403);
r = await put('/api/me/watchlist', { items: [] }, { 'content-type': 'text/plain' }); assert.equal(r.status, 415);
r = await put('/api/me/prefs', { imagery: 'viirs', layers: { atmo: false, '<script>': true }, classes: { L: false } }); j = await r.json();
assert.deepEqual(j.prefs, { imagery: 'viirs', layers: { atmo: false }, classes: { L: false } });
j = await (await fetch(BASE + '/api/me', { headers: { cookie } })).json(); assert.equal(j.watchlist.length, 2); assert.equal(j.prefs.imagery, 'viirs');
console.log('✓ watchlist and prefs saved, cleaned, and protected against cross-site writes');

// 6. CORS on the data API
r = await fetch(BASE + '/api/health', { headers: { origin: 'https://friend.example' } }); assert.equal(r.status, 200); assert.equal(r.headers.get('access-control-allow-origin'), 'https://friend.example');
r = await fetch(BASE + '/api/health', { headers: { origin: 'https://evil.example' } }); assert.equal(r.status, 403);
r = await fetch(BASE + '/api/me', { headers: { origin: 'https://friend.example', cookie } }); assert.equal(r.status, 403);
r = await fetch(BASE + '/api/health', { method: 'OPTIONS', headers: { origin: 'https://friend.example', 'access-control-request-method': 'GET' } }); assert.equal(r.status, 204);
r = await fetch(BASE + '/api/health', { method: 'OPTIONS', headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' } }); assert.equal(r.status, 403);
console.log('✓ CORS: allow-listed origin can read public data, others and account endpoints refused');

// 7. delete account, logout
r = await fetch(BASE + '/api/me', { method: 'DELETE', headers: { origin: BASE, cookie } }); assert.equal(r.status, 200);
j = await (await fetch(BASE + '/api/me', { headers: { cookie } })).json(); assert.equal(j.user, null);
r = await post('/api/auth/logout', {}); assert.match(r.headers.get('set-cookie'), /Max-Age=0/);
console.log('✓ account deletion removes the user; logout clears the cookie');

// 8. rate limiting: sign-in bucket allows 10 then 429 with Retry-After
let last; for (let i = 0; i < 12; i++) last = await post('/api/auth/google', { credential: 'a.b.c' });
assert.equal(last.status, 429); assert.ok(+last.headers.get('retry-after') > 0);
console.log('✓ rate limit returns 429 with Retry-After after the sign-in burst');

console.log('\nall auth, CORS and rate-limit checks passed'); process.exit(0);

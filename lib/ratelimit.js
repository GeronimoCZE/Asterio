// Token-bucket rate limiting per client IP. Each named bucket has a burst size and a refill rate.
// IPv6 clients are grouped by /64 so rotating addresses inside one allocation does not bypass it.
import net from 'node:net';

export const LIMITS = {
  page:   { burst: 120, perSec: 2 },        // HTML pages
  asset:  { burst: 800, perSec: 40 },       // scripts, data files, imagery tiles
  api:    { burst: 60,  perSec: 1 },        // small JSON endpoints
  tle:    { burst: 30,  perSec: 1 / 12 },   // multi-megabyte catalogue downloads (5 per page load; browsers reuse them for 10 min)
  auth:   { burst: 10,  perSec: 1 / 30 },   // sign-in attempts
  write:  { burst: 30,  perSec: 0.5 },      // account changes
};

const buckets = new Map(); // key -> { tokens, t }
const MAX_KEYS = 200000;

export function clientIp(req, trustProxy) {
  let ip = req.socket.remoteAddress || '';
  if (trustProxy > 0) {
    const xff = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
    // With N trusted proxies the client is the Nth address from the right.
    if (xff.length >= trustProxy) ip = xff[xff.length - trustProxy];
  }
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  if (net.isIPv6(ip)) {
    const full = expandV6(ip); ip = full.slice(0, 4).join(':') + '::/64';
  }
  return ip || 'unknown';
}
function expandV6(ip) {
  const [a, b = ''] = ip.split('::'); const h = a ? a.split(':') : [], t = b ? b.split(':') : [];
  return [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t];
}

// Returns { ok, limit, remaining, reset, retryAfter } and spends one token when ok.
export function take(name, ip, cost = 1) {
  const L = LIMITS[name]; const key = name + '|' + ip; const now = Date.now() / 1000;
  let b = buckets.get(key);
  if (!b) {
    if (buckets.size >= MAX_KEYS) sweep(true);
    b = { tokens: L.burst, t: now }; buckets.set(key, b);
  }
  b.tokens = Math.min(L.burst, b.tokens + (now - b.t) * L.perSec); b.t = now;
  const ok = b.tokens >= cost; if (ok) b.tokens -= cost;
  const deficit = Math.max(0, cost - b.tokens);
  return { ok, limit: L.burst, remaining: Math.floor(b.tokens), reset: Math.ceil((L.burst - b.tokens) / L.perSec), retryAfter: Math.ceil(deficit / L.perSec) };
}

export function headers(r) {
  return { 'RateLimit-Limit': String(r.limit), 'RateLimit-Remaining': String(Math.max(0, r.remaining)), 'RateLimit-Reset': String(r.reset), ...(r.ok ? {} : { 'Retry-After': String(Math.max(1, r.retryAfter)) }) };
}

// Forget full buckets (they carry no state) and, under pressure, the oldest ones.
function sweep(force) {
  const now = Date.now() / 1000;
  for (const [k, b] of buckets) { const L = LIMITS[k.slice(0, k.indexOf('|'))]; if (b.tokens + (now - b.t) * L.perSec >= L.burst || (force && now - b.t > 60)) buckets.delete(k); }
}
setInterval(() => sweep(false), 60e3).unref();
export const _size = () => buckets.size;

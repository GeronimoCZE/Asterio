// Runtime configuration. Values come from the environment, optionally from a .env file in the
// repository root (KEY=value lines; real environment variables win). See .env.example.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

try {
  for (const line of readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if (!m || line.trim().startsWith('#')) continue;
    const v = m[2].replace(/^(['"])(.*)\1$/, '$2'); if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
} catch { /* no .env file */ }

const env = process.env;
const DATA_DIR = env.DATA_DIR ? path.resolve(ROOT, env.DATA_DIR) : path.join(ROOT, '.data'); // users and the session secret

// A stable secret signs session cookies. Use SESSION_SECRET in production; otherwise one is generated
// once and kept in .data/ so sign-ins survive restarts.
function sessionSecret() {
  if (env.SESSION_SECRET && env.SESSION_SECRET.length >= 32) return env.SESSION_SECRET;
  const f = path.join(DATA_DIR, 'session-secret');
  try { return readFileSync(f, 'utf8').trim(); } catch { /* create below */ }
  const s = randomBytes(48).toString('base64url');
  try { mkdirSync(DATA_DIR, { recursive: true }); writeFileSync(f, s, { mode: 0o600 }); } catch { /* read-only disk: per-process secret */ }
  return s;
}

const list = (v) => (v || '').split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);

export const config = {
  port: Number(env.PORT) || 4050,
  host: env.HOST || '0.0.0.0',
  // Public address, used for canonical URLs, the sitemap and social tags. Without it the server
  // uses the Host header of each request.
  siteUrl: (env.SITE_URL || '').replace(/\/$/, ''),
  // Number of reverse proxies in front of the app (nginx, Cloudflare, a load balancer). Needed to
  // read the real client IP from X-Forwarded-For for rate limiting. 0 = direct connections.
  trustProxy: Math.max(0, Number(env.TRUST_PROXY) || 0),
  // Extra origins allowed to read the public data API from the browser (CORS). Same-origin requests
  // are always allowed.
  allowedOrigins: list(env.ALLOWED_ORIGINS),
  googleClientId: env.GOOGLE_CLIENT_ID || '',
  sessionSecret: sessionSecret(),
  sessionDays: Number(env.SESSION_DAYS) || 30,
  dataDir: DATA_DIR,
  cacheDir: path.join(ROOT, '.cache'),
  publicDir: path.join(ROOT, 'app'),
  log: !!env.LOG,
  creator: { name: 'Nikolas Malík', url: 'https://malikweb.eu' },
  hasFile: (rel) => existsSync(path.join(ROOT, 'app', rel)),
};

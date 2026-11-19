# Galacticio

A live 3D map of the space around Earth: every tracked satellite and debris fragment, the Moon,
near-Earth asteroids, the atmosphere layers, the Van Allen belts and current space weather.
Everything is drawn to scale and moves in real time in the browser.

## Moving around

The 3D view has two camera modes, switched with the Orbit / Free flight control at the bottom left,
the **F** key, or **Fly** in the phone dock. The keyboard button next to it lists every control.

- **Orbit** (default) circles the Earth or the selected object. Drag to rotate, scroll or pinch to zoom
  (zoom eases instead of jumping), right-drag to tilt, middle-drag, Ctrl/⌘-drag or two-finger drag to
  pan, **C** to re-center after panning. WASD or the arrow keys rotate, Q/E zoom, H returns to the start view.
- **Free flight** lets the camera go anywhere. Drag to look around, WASD to fly, Space/C to rise and sink,
  arrows to turn, Q/E to roll, Shift/Alt for faster/slower, scroll to glide, L to keep the horizon level,
  Esc to return to orbit from where you are. Speed follows the distance to the nearest surface (Earth,
  Moon or the object you started next to), so the same keys work in low orbit and out by the Moon. Starting
  free flight while following a satellite keeps you moving with it. On touch screens a stick and rise/sink
  buttons appear.

## Run it

Needs Node 18 or newer. There are no npm dependencies.

```
cp .env.example .env   # optional, see below
npm start
# open http://localhost:4050
```

`npm run dev` restarts on changes and logs each request. `npm test` runs the sign-in, CORS and
rate-limit checks against a throwaway server on port 4061 (it never touches real accounts).

### Configuration

Settings come from environment variables or a `.env` file; `.env.example` explains each one.
For a public deployment set at least:

| Variable | Why |
| --- | --- |
| `SITE_URL` | Canonical links, sitemap, social cards and `llms.txt` use it. Example `https://galacticio.example` |
| `TRUST_PROXY` | Number of proxies in front of Node (usually `1`), so rate limits see real visitor IPs |
| `GOOGLE_CLIENT_ID` | Turns on "Sign in with Google" (see below) |
| `SESSION_SECRET` | 32+ random characters that sign session cookies |
| `DATA_DIR` | Where `users.json` lives (default `.data/`). Back it up |

### Google sign-in

1. In Google Cloud Console open APIs & Services > Credentials and create an OAuth client ID of type
   **Web application**.
2. Under **Authorized JavaScript origins** add your `SITE_URL` (and `http://localhost:4050` for local
   testing). No redirect URI is needed.
3. Put the client ID in `GOOGLE_CLIENT_ID` and restart. The OAuth consent screen should link to
   `/privacy` and `/terms`.

The browser gets an ID token from Google Identity Services and posts it to `/api/auth/google`. The server
checks its RS256 signature against Google's published keys, the issuer, audience and expiry, then sets an
HttpOnly, SameSite=Lax session cookie signed with HMAC. Only the Google account ID, name, email, picture
URL, saved objects and view settings are stored. Users can delete everything from the account menu.

## Deploy with pm2

On the server you need Node 18 or newer (20 or 22 LTS recommended), git and pm2 (`npm install -g pm2`).

```
git clone https://github.com/GeronimoCZE/Asterio.git galacticio && cd galacticio
cp .env.example .env        # set SITE_URL, TRUST_PROXY, GOOGLE_CLIENT_ID, SESSION_SECRET
npm test
pm2 start ecosystem.config.cjs && pm2 save
pm2 startup                 # prints one command to run so pm2 starts again after a reboot
```

`ecosystem.config.cjs` runs a single process in fork mode, because rate limits are counted in memory and
accounts are one JSON file. Put nginx or Caddy in front for HTTPS, proxy to `127.0.0.1:4050`, and set
`TRUST_PROXY=1`. Back up `.env` and `DATA_DIR` (default `.data/`); neither is in git.

### Updating

```
./update.sh                 # or: npm run update
```

It refuses to run over local edits to tracked files, fast-forwards to `origin/main`, syntax-checks the
code and runs `npm test`, then reloads the pm2 app and waits for `/api/health`. If the checks fail, the
running version is left alone; if the new version doesn't come up healthy, it rolls back to the previous
commit and restarts that. `.env` and the account data are never touched, and pending account writes are
saved before each restart.

Options: `BRANCH=name` follows another branch, `SKIP_TESTS=1` skips the test suite, `FORCE=1` restarts even
when nothing changed, `PM2_APP=name` if you renamed the pm2 app. For automatic updates, add a cron line such
as `0 4 * * * cd /srv/galacticio && ./update.sh >> $HOME/galacticio-update.log 2>&1`.

## What the server does

### Pages and SEO

| Path | Content |
| --- | --- |
| `/` | 3D view |
| `/satellite/<norad>-<name>` | 3D view focused on one satellite, with its details in the HTML |
| `/asteroid/<designation>` | 3D view focused on one near-Earth asteroid |
| `/satellites` | Catalogue with a link to every satellite page |
| `/about`, `/sources`, `/terms`, `/privacy`, `/cookies` | Content pages |
| `/sitemap.xml` | Sitemap index: `sitemap-pages.xml`, `sitemap-satellites.xml`, `sitemap-asteroids.xml`, built from the live catalogue |
| `/robots.txt`, `/llms.txt` | Crawler rules and a plain summary for AI search tools |

Every page is rendered on the server with its own title, description, canonical URL, Open Graph and
Twitter tags (images in `app/brand/`) and JSON-LD (WebSite, WebApplication, Person, FAQPage,
BreadcrumbList and others). Numbers in the copy, such as how many satellites are tracked, are filled in
from the live catalogue. Debris, Starlink and rocket bodies are left out of the satellite sitemap so it
stays useful. URLs are normalised (no trailing slash, lowercase) with 301 redirects.

### Data API

`server.js` keeps one shared, cached copy of the data instead of each browser calling CelesTrak and NOAA:

| Endpoint | Upstream | Cache |
| --- | --- | --- |
| `GET /api/tle?group=active` (also the four debris groups) | CelesTrak GP element sets | 2 hours, also written to `.cache/` |
| `GET /api/swpc/<path>` | NOAA SWPC JSON feeds (Kp, solar wind, X-ray, scales, aurora) | 5 minutes |
| `GET /api/health` | — | cache ages, object count, last errors |

Stale entries are served immediately while a refresh runs in the background. CelesTrak returns 403 when
asked again for data that has not changed; the server treats that as "still current".

The page checks `/api/health` on start. If the API is there it uses it; on a plain static host it calls
CelesTrak and NOAA directly from the browser and uses `#hash` addresses instead of paths; inside
claude.ai, where outside requests are blocked, it stays on the bundled snapshot in `app/data/`.

### Accounts API

| Endpoint | |
| --- | --- |
| `POST /api/auth/google` | `{ credential }` from Google Identity Services; sets the session cookie |
| `POST /api/auth/logout` | Clears the cookie |
| `GET /api/me` | `{ user, watchlist, prefs }`, or `{ user: null }` for guests |
| `PUT /api/me/watchlist` | `{ items: [{ kind: "sat", id: 25544, name }, …] }`, up to 200 |
| `PUT /api/me/prefs` | Imagery, layer and object-class toggles |
| `DELETE /api/me` | Deletes the account and its data |

### Protection

- **Rate limits** per IP (IPv6 grouped by /64), as token buckets with `RateLimit-*` and `Retry-After`
  headers: pages 120 burst then 2/s, files 800 then 40/s, small API calls 60 then 1/s, catalogue
  downloads 30 then one every 12 s, sign-ins 10 then one every 30 s, account changes 30 then one every 2 s.
- **CORS**: same-origin requests always work. Origins in `ALLOWED_ORIGINS` can read the public data API
  without credentials. Account endpoints are same-origin only. Everything else gets 403, including
  preflights and `Origin: null`.
- **CSRF**: account changes need a same-site `Origin`/`Sec-Fetch-Site` and a JSON body; the cookie is
  SameSite=Lax.
- **Headers**: a Content Security Policy that allows only this site, jsDelivr, Google Fonts, Google sign-in and the
  data sources; HSTS on HTTPS; `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` and
  `Cross-Origin-Resource-Policy`.
- **Limits**: request bodies are capped, slow clients are dropped after 15 s of headers or 30 s per request.

## Layout

```
server.js          Node server: routing, pages, static files, API
ecosystem.config.cjs  pm2 process file
update.sh          pull, check, restart and verify (with rollback)
lib/config.js      settings from the environment or .env
lib/http.js        responses, CORS, CSRF and security headers
lib/ratelimit.js   per-IP token buckets
lib/upstream.js    CelesTrak and NOAA cache
lib/catalog.js     satellite and asteroid catalogue for pages and sitemaps
lib/seo.js         routes, titles, descriptions, structured data, sitemaps
lib/auth.js        Google sign-in, sessions, saved objects
test/              end-to-end checks for accounts, CORS and rate limits
app/index.html     page shell: nav, 3D view, catalogue, About, Data sources, legal pages
app/app.js         3D engine, data loading, UI, routing and account menu
app/brand/         logo, icons and social images (sources in brand/)
app/data/          bundled snapshot: TLEs, JPL ephemerides, space weather, stars, borders
app/tiles/         Earth imagery pyramid (NASA GIBS), Moon and Milky Way textures
scripts/           Python used to build app/data and app/tiles
```

`app/index.html` is written as a body fragment so the same file can be published as a hosted page;
`server.js` turns it into a full HTML document for each route.

## Memory use

The 3D view frees decoded images once they are on the GPU, keeps at most 40 detailed Earth tiles and
drops ones not seen for 15 seconds, caps the drawing buffer at about 6.5 megapixels on high-density
screens, and keeps only the parsed orbit data for each satellite, not its raw text.

## Refreshing the bundled snapshot

The snapshot is only used when live data is unreachable. To rebuild it (Python 3 with Pillow and numpy,
network access to celestrak.org, ssd.jpl.nasa.gov, ssd-api.jpl.nasa.gov, services.swpc.noaa.gov,
gibs.earthdata.nasa.gov), put raw downloads in `raw/` (git-ignored) and run:

- `scripts/horizons.py <cad.json> app/data/ephemeris.json` — Moon, Sun and near-Earth asteroid vectors from JPL Horizons
- `scripts/prep.py` — TLE classification, star catalogue, aurora grid, space weather, borders
- `scripts/tiles.py` — Earth imagery tile pyramid from NASA GIBS
- `scripts/milkyway.py` — Milky Way sky texture from the d3-celestial outlines

The asteroid and Moon ephemeris covers 12 November 2026 to 15 January 2027; after that the Moon falls
back to an analytic model and the asteroid list should be regenerated.

## Live, snapshot or model

The Data sources page in the app shows the state of every layer. In short: satellite motion is computed
every frame with SGP4 from published element sets; asteroid and Moon positions come from JPL
ephemerides; atmosphere layer boundaries and the Van Allen belts are models; space dust is decorative.

## Credits

Designed and built by [Nikolas Malík](https://malikweb.eu).

Data and libraries: CelesTrak, NASA JPL SSD, NOAA SWPC, NASA GIBS, Natural Earth, d3-celestial (Hipparcos),
three.js (MIT), satellite.js (MIT), Geist (SIL OFL).

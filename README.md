# Asterio

A live 3D map of the space around Earth: every tracked satellite and debris fragment, the Moon,
near-Earth asteroids, the atmosphere layers, the Van Allen belts and current space weather.
Everything is drawn to scale and moves in real time in the browser.

## Run it

Needs Node 18 or newer. There are no npm dependencies.

```
npm start
# open http://localhost:4050
```

`PORT` and `HOST` change where it listens (defaults `4050` and `0.0.0.0`). `npm run dev` restarts on
changes and logs each request.

## What the server does

`server.js` serves the site in `app/` and a small caching API, so every visitor shares one fresh copy
of the data instead of each browser calling CelesTrak and NOAA:

| Endpoint | Upstream | Cache |
| --- | --- | --- |
| `GET /api/tle?group=active` (also the four debris groups) | CelesTrak GP element sets | 2 hours, also written to `.cache/` |
| `GET /api/swpc/<path>` | NOAA SWPC JSON feeds (Kp, solar wind, X-ray, scales, aurora) | 5 minutes |
| `GET /api/health` | — | cache ages and last errors |

Stale entries are served immediately while a refresh runs in the background. CelesTrak returns 403 when
asked again for data that has not changed; the server treats that as "still current".

The page checks `/api/health` on start. If the API is there it uses it; on a plain static host it calls
CelesTrak and NOAA directly from the browser (both send CORS headers); inside claude.ai, where outside
requests are blocked, it stays on the bundled snapshot in `app/data/`.

## Layout

```
server.js          Node server (static files + /api)
app/index.html     page shell: nav, 3D view, About, Data sources, Terms, Cookie policy
app/app.js         3D engine, data loading, UI and routing
app/data/          bundled snapshot: TLEs, JPL ephemerides, space weather, stars, borders
app/tiles/         Earth imagery pyramid (NASA GIBS), Moon and Milky Way textures
scripts/           Python used to build app/data and app/tiles
```

`app/index.html` is written as a body fragment so the same file can be published as a hosted page;
`server.js` wraps it in a full HTML document when serving it.

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

CelesTrak, NASA JPL SSD, NOAA SWPC, NASA GIBS, Natural Earth, d3-celestial (Hipparcos),
three.js (MIT), satellite.js (MIT), Geist (SIL OFL).

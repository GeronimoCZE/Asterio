// Search and AI-answer optimisation: per-route titles and descriptions, canonical and social tags,
// structured data (JSON-LD), server-rendered content for object pages, the dynamic sitemap,
// robots.txt and llms.txt.
import { config } from './config.js';
import { esc } from './http.js';
import { catalog, CLASSES, CLASS_ORDER, satPath, neoPath, regime, fmt, neoDate, fmtDate, neoDiameter, findSat, findNeo, slugify } from './catalog.js';

export const DOC_ROUTES = ['about', 'sources', 'satellites', 'terms', 'privacy', 'cookies'];
const SITE_NAME = 'Asterio';

/* ── routing ───────────────────────────────────────────────── */
// Returns { name, path(canonical), obj?, status, redirect? } or null for "not a page".
export function resolveRoute(pathname) {
  if (pathname === '/') return { name: 'explore', path: '/', status: 200 };
  const m1 = /^\/(about|sources|satellites|terms|privacy|cookies)$/.exec(pathname);
  if (m1) return { name: m1[1], path: pathname, status: 200 };
  const m2 = /^\/satellite\/(\d{1,6})(?:-[a-z0-9-]*)?$/.exec(pathname);
  if (m2) {
    const o = findSat(+m2[1]); if (!o) return { name: '404', path: pathname, status: 404 };
    const p = satPath(o); return p === pathname ? { name: 'satellite', path: p, obj: o, status: 200 } : { redirect: p };
  }
  const m3 = /^\/asteroid\/([a-z0-9-]{3,40})$/.exec(pathname);
  if (m3) { const n = findNeo(m3[1]); return n ? { name: 'asteroid', path: neoPath(n), obj: n, status: 200 } : { name: '404', path: pathname, status: 404 }; }
  return null;
}

/* ── per-route metadata ────────────────────────────────────── */
function clip(s, n = 160) { s = s.replace(/\s+/g, ' ').trim(); return s.length <= n ? s : s.slice(0, n - 1).replace(/[\s,.;:]+\S*$/, '') + '…'; }
function brandImage(route) {
  for (const f of [`brand/og-${route}.png`, 'brand/og-default.png']) if (config.hasFile(f)) return '/' + f;
  return null;
}
export function routeMeta(route) {
  const c = catalog(); const total = fmt(c.total);
  const sats = c.total - c.counts.D - c.counts.R;
  switch (route.name) {
    case 'explore': return {
      title: 'Asterio: Live 3D Satellite Tracker & Space Weather Map',
      description: `Track ${total} satellites, Starlink, the ISS, space debris and near-Earth asteroids live on a 3D Earth, with atmosphere layers, Van Allen belts and space weather.`,
      h1: 'Live 3D satellite tracker: every satellite, piece of debris and near-Earth asteroid around Earth',
    };
    case 'about': return {
      title: 'About Asterio: How the Live Satellite Map Works',
      description: 'How Asterio maps the space around Earth in real time: SGP4 orbits, NASA JPL ephemerides, NASA imagery, atmosphere layers and radiation belts, plus an FAQ.',
    };
    case 'sources': return {
      title: 'Data Sources · Asterio Live Satellite Map',
      description: "Every data source behind Asterio's live satellite map: CelesTrak orbital elements, NASA JPL ephemerides, NOAA space weather and NASA GIBS Earth imagery.",
    };
    case 'satellites': return {
      title: `Satellite Catalogue: ${fmt(sats)} Satellites Tracked Live · Asterio`,
      description: `Browse ${fmt(sats)} satellites by type, from space stations and GPS to geostationary and Earth-observation satellites, plus ${c.neos.length} asteroids passing Earth.`,
    };
    case 'terms': return { title: 'Terms of Use · Asterio', description: 'The terms for using Asterio, the free live 3D map of satellites, debris and asteroids around Earth.' };
    case 'privacy': return { title: 'Privacy Policy · Asterio', description: 'What Asterio stores when you sign in with Google, why, for how long, and how to delete it.' };
    case 'cookies': return { title: 'Cookie Policy · Asterio', description: 'Asterio uses no tracking or advertising cookies. One sign-in cookie is set only if you sign in with Google.' };
    case 'satellite': {
      const o = route.obj, k = CLASSES[o.cls] || CLASSES.P, reg = regime(o);
      return {
        title: `${o.name} Live Position & Orbit Tracker · Asterio`,
        description: clip(`Where is ${o.name} now? Track it live in 3D: ${k.one.toLowerCase()} in ${reg[0].toLowerCase() + reg.slice(1)}, ${fmt(o.peri)}–${fmt(o.apo)} km up, ${fmt(o.inc, 1)}° inclination, one orbit every ${fmt(o.period, 1)} min.`),
        h1: `${o.name} live position and orbit`,
        robots: k.index ? null : 'noindex, follow',
      };
    }
    case 'asteroid': {
      const n = route.obj, d = fmtDate(neoDate(n));
      return {
        title: `Asteroid ${n.name} Close Approach, ${d} · Asterio`,
        description: clip(`Asteroid ${n.name} passes Earth on ${d} at ${fmt(n.ld, 2)} lunar distances (${fmt(n.km)} km), moving ${fmt(n.v, 1)} km/s. About ${neoDiameter(n)} across. See its path in 3D.`),
        h1: `Asteroid ${n.name} close approach on ${d}`,
      };
    }
    default: return { title: 'Page not found · Asterio', description: 'This page drifted out of orbit.', robots: 'noindex, follow' };
  }
}

/* ── structured data ───────────────────────────────────────── */
function jsonLd(route, site, meta, faq) {
  const url = site + route.path;
  const creator = { '@type': 'Person', '@id': site + '/#creator', name: config.creator.name, url: config.creator.url };
  const website = {
    '@type': 'WebSite', '@id': site + '/#website', url: site + '/', name: SITE_NAME, inLanguage: 'en',
    description: 'Live 3D map of satellites, space debris, near-Earth asteroids and the layers around Earth.',
    creator: { '@id': creator['@id'] }, publisher: { '@id': creator['@id'] },
    potentialAction: { '@type': 'SearchAction', target: { '@type': 'EntryPoint', urlTemplate: site + '/?q={search_term_string}' }, 'query-input': 'required name=search_term_string' },
  };
  const crumbs = (items) => ({ '@type': 'BreadcrumbList', itemListElement: items.map(([name, u], i) => ({ '@type': 'ListItem', position: i + 1, name, item: site + u })) });
  const page = (type, extra = {}) => ({ '@type': type, '@id': url + '#page', url, name: meta.title, description: meta.description, isPartOf: { '@id': website['@id'] }, inLanguage: 'en', ...extra });
  const graph = [website, creator];
  switch (route.name) {
    case 'explore': graph.push({
      '@type': 'WebApplication', '@id': site + '/#app', name: SITE_NAME, url: site + '/', description: meta.description,
      applicationCategory: 'EducationalApplication', applicationSubCategory: 'Satellite tracker', operatingSystem: 'Any (web browser)',
      browserRequirements: 'Requires a browser with WebGL', isAccessibleForFree: true, offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      creator: { '@id': creator['@id'] },
      featureList: ['Live positions of every tracked satellite and debris fragment', 'Near-Earth asteroid close approaches', 'Atmosphere layers and orbit regions', 'Van Allen radiation belts', 'Aurora oval and space weather', 'Time travel up to 1 hour per second'],
    }); break;
    case 'about':
      graph.push(page('AboutPage'));
      if (faq.length) graph.push({ '@type': 'FAQPage', '@id': url + '#faq', mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) });
      graph.push(crumbs([['Asterio', '/'], ['About', '/about']])); break;
    case 'satellites': graph.push(page('CollectionPage'), crumbs([['Asterio', '/'], ['Satellite catalogue', '/satellites']])); break;
    case 'satellite': {
      const o = route.obj;
      graph.push(page('WebPage', { about: { '@type': 'Thing', name: o.name, identifier: `NORAD ${o.norad}`, ...(o.cospar ? { alternateName: `COSPAR ${o.cospar}` } : {}) }, dateModified: new Date(o.epoch).toISOString() }),
        crumbs([['Asterio', '/'], ['Satellite catalogue', '/satellites'], [o.name, route.path]])); break;
    }
    case 'asteroid': {
      const n = route.obj;
      graph.push(page('WebPage', { about: { '@type': 'Thing', name: `Asteroid ${n.name}`, identifier: n.des } }),
        crumbs([['Asterio', '/'], ['Satellite catalogue', '/satellites'], [`Asteroid ${n.name}`, route.path]])); break;
    }
    case '404': break;
    default: graph.push(page('WebPage'), crumbs([['Asterio', '/'], [meta.title.split(' · ')[0], route.path]]));
  }
  // Escape "<" so the JSON can never close the script element.
  return `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c')}</script>`;
}

/* ── server-rendered content ───────────────────────────────── */
export function stats() {
  const c = catalog(); const iss = findSat(25544), css = findSat(48274);
  const closest = c.neos[0];
  return {
    total: fmt(c.total), leo: fmt(c.leo), debris: fmt(c.counts.D), starlink: fmt(c.counts.L), gnss: fmt(c.counts.N), geo: fmt(c.counts.G),
    payloads: fmt(c.total - c.counts.D - c.counts.R), neos: String(c.neos.length),
    issAlt: iss ? fmt((iss.peri + iss.apo) / 2) : '420', issPeriod: iss ? fmt(iss.period, 1) : '92.9',
    cssAlt: css ? fmt((css.peri + css.apo) / 2) : '380',
    closestName: closest ? closest.name : '', closestLd: closest ? fmt(closest.ld, 2) : '', closestDate: closest ? fmtDate(neoDate(closest)) : '',
    updated: new Date(c.updated).toLocaleString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC',
  };
}
function detailHtml(route) {
  if (route.name === 'satellite') {
    const o = route.obj, k = CLASSES[o.cls] || CLASSES.P;
    const rows = [['Class', k.one], ['Orbit', regime(o)], ['Perigee / apogee', `${fmt(o.peri)} / ${fmt(o.apo)} km`], ['Inclination', `${fmt(o.inc, 2)}°`],
      ['Period', `${fmt(o.period, 1)} min`], ['Eccentricity', fmt(o.ecc, 5)], ['Elements epoch', new Date(o.epoch).toISOString().slice(0, 16).replace('T', ' ') + ' UTC']];
    return `<aside id="detail" class="card vtop" aria-live="polite" data-ssr="1"><div class="kick">${esc(k.one)}</div><h2>${esc(o.name)}</h2><div class="ids mono">NORAD ${o.norad}${o.cospar ? ' · COSPAR ' + esc(o.cospar) : ''}</div><dl class="mono">${rows.map(([a, b]) => `<dt>${esc(a)}</dt><dd>${esc(b)}</dd>`).join('')}</dl><div class="note">Live position loads in the 3D view. Computed in your browser with SGP4 from CelesTrak orbital elements.</div></aside>`;
  }
  if (route.name === 'asteroid') {
    const n = route.obj;
    const rows = [['Closest approach', fmtDate(neoDate(n)) + ' ' + (n.when || '').slice(12) + ' TDB'], ['Miss distance', `${fmt(n.km)} km`], ['In lunar distances', `${fmt(n.ld, 2)} LD`],
      ['Relative speed', `${fmt(n.v, 2)} km/s`], ['Estimated size', neoDiameter(n)], ['Absolute magnitude', `H ${fmt(n.h, 1)}`]];
    return `<aside id="detail" class="card vtop" aria-live="polite" data-ssr="1"><div class="kick">Near-Earth asteroid</div><h2>${esc(n.name)}</h2><div class="ids mono">${esc(n.des)}</div><dl class="mono">${rows.map(([a, b]) => `<dt>${esc(a)}</dt><dd>${esc(b)}</dd>`).join('')}</dl><div class="note">Position from NASA JPL Horizons. Size estimated from brightness.</div></aside>`;
  }
  return null;
}
export function catalogueHtml() {
  const c = catalog(); const groups = {};
  for (const o of c.list) (groups[o.cls] ||= []).push(o);
  let h = '', jump = '';
  for (const k of CLASS_ORDER) {
    const g = groups[k] || []; if (!g.length) continue; const K = CLASSES[k];
    jump += `<a href="#cat-${k}" data-jump="cat-${k}">${esc(K.name)}<span>${fmt(g.length)}</span></a>`;
    h += `<section class="cat-group" id="cat-${k}"><h2>${esc(K.name)} <span>${fmt(g.length)}</span></h2>`;
    if (K.index) h += `<ul class="cat-list">${g.map((o) => `<li><a href="${satPath(o)}">${esc(o.name)}</a></li>`).join('')}</ul>`;
    else h += `<p class="cat-note">${k === 'L' ? 'Starlink satellites are too many to list here. Search any of them by name or NORAD ID in the 3D view.' : 'Search any fragment by name or NORAD ID in the 3D view.'}</p>`;
    h += '</section>';
  }
  if (c.neos.length) {
    jump += `<a href="#cat-asteroids" data-jump="cat-asteroids">Asteroids<span>${c.neos.length}</span></a>`;
    h += `<section class="cat-group" id="cat-asteroids"><h2>Asteroids passing Earth <span>${c.neos.length}</span></h2><ul class="cat-list wide">${c.neos.map((n) => `<li><a href="${neoPath(n)}">${esc(n.name)}</a> <small>${fmt(n.ld, 2)} LD · ${esc(fmtDate(neoDate(n)))}</small></li>`).join('')}</ul></section>`;
  }
  return { list: h, jump };
}

/* ── page assembly ─────────────────────────────────────────── */
// index.html is a body fragment that also works as a hosted page; turn it into a full document for
// this route. Returns { html, inlineScripts } (inline scripts are hashed into the CSP).
export function renderPage(frag, route, site) {
  const meta = routeMeta(route); const st = stats();
  let body = frag;
  // live numbers in the copy
  body = body.replace(/(<span data-stat="(\w+)">)[^<]*(<\/span>)/g, (m, a, k, b) => (st[k] !== undefined ? a + esc(st[k]) + b : m));
  // visible page
  if (DOC_ROUTES.includes(route.name) || route.name === '404') {
    body = body.replace(new RegExp(`(<main id="page-${route.name}" class="page-doc")( hidden)`), '$1').replace('<div id="boot">', '<div id="boot" class="away">');
  }
  const tpl = (body.match(/<template id="footTpl">([\s\S]*?)<\/template>/) || [])[1];
  if (tpl) body = body.replace(/<footer class="site-foot"><\/footer>/g, `<footer class="site-foot">${tpl.trim()}</footer>`);
  if (route.name === 'satellites') {
    const cat = catalogueHtml();
    body = body.replace('<div id="catalogList"></div>', `<div id="catalogList" data-ssr="1">${cat.list}</div>`).replace('<nav class="cat-jump" id="catJump" aria-label="Jump to a group"></nav>', `<nav class="cat-jump" id="catJump" aria-label="Jump to a group">${cat.jump}</nav>`);
  }
  const det = detailHtml(route); if (det) body = body.replace(/<aside id="detail"[^>]*><\/aside>/, det);
  // Show "Sign in" before the app script loads, so the button does not change label on slow connections.
  if (config.googleClientId) body = body.replace('<button id="accountBtn" class="acct" aria-haspopup="dialog" aria-expanded="false" aria-label="Saved objects">', '<button id="accountBtn" class="acct signin" aria-haspopup="dialog" aria-expanded="false" aria-label="Sign in and saved objects">').replace('<span id="accountLabel">Saved</span>', '<span id="accountLabel">Sign in</span>');
  if (meta.h1) body = body.replace(/(<h1 class="sr-only" id="pageH1">)[^<]*(<\/h1>)/, `$1${esc(meta.h1)}$2`);
  // FAQ text for structured data, taken from the rendered About page so the two never disagree
  const faq = route.name === 'about' ? [...body.matchAll(/<details class="faq"><summary>(.*?)<\/summary><div>(.*?)<\/div><\/details>/gs)].map((m) => [m[1], m[2]].map((t) => t.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim())) : [];

  const headEnd = body.indexOf('<style>'), styleEnd = body.indexOf('</style>') + 8;
  const fragHead = body.slice(0, headEnd).replace(/<title>[\s\S]*?<\/title>\s*/, '').replace(/<meta charset="utf-8">\s*/, '').replace(/<meta name="description"[^>]*>\s*/, '').replace(/<meta name="claude:[^>]*>\s*/g, '');
  const url = site + route.path; const img = brandImage(route.name);
  const head = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
    `<title>${esc(meta.title)}</title>`,
    `<meta name="description" content="${esc(meta.description)}">`,
    `<meta name="robots" content="${meta.robots || 'index, follow, max-image-preview:large, max-snippet:-1'}">`,
    route.status === 200 ? `<link rel="canonical" href="${esc(url)}">` : '',
    '<meta name="theme-color" content="#05070d">',
    '<meta name="color-scheme" content="dark">',
    `<meta name="author" content="${esc(config.creator.name)}">`,
    `<link rel="author" href="${esc(config.creator.url)}">`,
    '<base href="/">',
    '<link rel="icon" href="/favicon.ico" sizes="48x48">',
    '<link rel="icon" href="/favicon.svg" type="image/svg+xml">',
    config.hasFile('brand/apple-touch-icon.png') ? '<link rel="apple-touch-icon" href="/brand/apple-touch-icon.png">' : '',
    '<link rel="manifest" href="/site.webmanifest">',
    '<link rel="sitemap" type="application/xml" href="/sitemap.xml">',
    `<meta property="og:site_name" content="${SITE_NAME}">`,
    `<meta property="og:type" content="${route.name === 'explore' ? 'website' : 'article'}">`,
    `<meta property="og:title" content="${esc(meta.title)}">`,
    `<meta property="og:description" content="${esc(meta.description)}">`,
    `<meta property="og:url" content="${esc(url)}">`,
    '<meta property="og:locale" content="en_GB">',
    ...(img ? [`<meta property="og:image" content="${esc(site + img)}">`, '<meta property="og:image:width" content="1200">', '<meta property="og:image:height" content="630">', '<meta property="og:image:alt" content="Asterio: a live map of the space around Earth">'] : []),
    `<meta name="twitter:card" content="${img ? 'summary_large_image' : 'summary'}">`,
    `<meta name="twitter:title" content="${esc(meta.title)}">`,
    `<meta name="twitter:description" content="${esc(meta.description)}">`,
    ...(img ? [`<meta name="twitter:image" content="${esc(site + img)}">`] : []),
    '<meta name="asterio:server" content="1">',
    config.googleClientId ? `<meta name="asterio:google-client-id" content="${esc(config.googleClientId)}">` : '',
    jsonLd(route, site, meta, faq),
  ].filter(Boolean).join('\n');
  const inlineScripts = [...body.matchAll(/<script type="importmap">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const html = `<!doctype html>\n<html lang="en" data-route="${route.name}">\n<head>\n${head}\n${fragHead.trim()}\n${body.slice(headEnd, styleEnd)}\n</head>\n<body>\n${body.slice(styleEnd).trim()}\n</body>\n</html>\n`;
  return { html, inlineScripts };
}

/* ── sitemap, robots, llms.txt, manifest ───────────────────── */
const xmlEsc = (s) => String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
const day = (t) => new Date(t).toISOString().slice(0, 10);
export function sitemap(name, site, pagesModified) {
  const c = catalog();
  const urlset = (items) => `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items.map(([loc, mod]) => `<url><loc>${xmlEsc(site + loc)}</loc>${mod ? `<lastmod>${day(mod)}</lastmod>` : ''}</url>`).join('\n')}\n</urlset>\n`;
  if (name === 'sitemap.xml') {
    const parts = [['sitemap-pages.xml', Math.max(pagesModified, c.updated)], ['sitemap-satellites.xml', c.updated], ['sitemap-asteroids.xml', Date.parse(c.ephemGenerated) || pagesModified]];
    return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${parts.map(([f, m]) => `<sitemap><loc>${xmlEsc(site + '/' + f)}</loc><lastmod>${day(m)}</lastmod></sitemap>`).join('\n')}\n</sitemapindex>\n`;
  }
  if (name === 'sitemap-pages.xml') return urlset([['/', c.updated], ['/satellites', c.updated], ['/about', pagesModified], ['/sources', c.updated], ['/terms', pagesModified], ['/privacy', pagesModified], ['/cookies', pagesModified]]);
  if (name === 'sitemap-satellites.xml') return urlset(c.list.filter((o) => (CLASSES[o.cls] || {}).index).map((o) => [satPath(o), Math.min(o.epoch, Date.now())]));
  if (name === 'sitemap-asteroids.xml') return urlset(c.neos.map((n) => [neoPath(n), Date.parse(c.ephemGenerated) || pagesModified]));
  return null;
}
export function robots(site) {
  return `# Asterio welcomes search engines and AI assistants.\nUser-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${site}/sitemap.xml\n`;
}
export function llms(site) {
  const c = catalog(); const s = stats(); const iss = findSat(25544), css = findSat(48274);
  const notable = [iss, css].filter(Boolean).map((o) => `- [${o.name}](${site}${satPath(o)}): crewed station, about ${fmt((o.peri + o.apo) / 2)} km up, one orbit every ${fmt(o.period, 1)} min`);
  const asts = c.neos.slice(0, 5).map((n) => `- [Asteroid ${n.name}](${site}${neoPath(n)}): passes at ${fmt(n.ld, 2)} lunar distances on ${fmtDate(neoDate(n))}, about ${neoDiameter(n)} across`);
  return `# Asterio

> Asterio is a free, live 3D map of the space around Earth. It shows every publicly tracked satellite and debris fragment (${s.total} objects), near-Earth asteroids, the Moon, the atmosphere layers, the Van Allen radiation belts, the aurora oval and current space weather. Positions are computed in real time in the browser.

Numbers as of ${s.updated}: ${s.total} tracked objects, of which ${s.starlink} are Starlink satellites, ${s.gnss} are navigation (GNSS) satellites, ${s.geo} are geostationary and ${s.debris} are catalogued debris fragments from four major break-ups. ${s.leo} objects are in low Earth orbit (below 2,000 km). ${s.neos} known asteroids pass within 0.05 AU (7.5 million km) of Earth between 12 November 2026 and 15 January 2027.

Created by ${config.creator.name} (${config.creator.url}).

## Pages

- [3D view](${site}/): the live map. Supports search with ${site}/?q=<name or NORAD ID>.
- [About and FAQ](${site}/about): how the map works, altitude ranges of each atmosphere layer and orbit region, common questions.
- [Satellite catalogue](${site}/satellites): every named satellite by type, and the asteroids passing Earth.
- [Data sources](${site}/sources): which data is live, a snapshot or a model, and where it comes from.

## Object pages

- Satellites: ${site}/satellite/<NORAD catalogue number>, for example ${site}${iss ? satPath(iss) : '/satellite/25544'}
- Asteroids: ${site}/asteroid/<designation with dashes>, for example ${c.neos[0] ? site + neoPath(c.neos[0]) : site + '/asteroid/2026-vu15'}

Each object page lists the orbit (perigee, apogee, inclination, period) and opens the 3D view on that object.

## Notable objects

${notable.join('\n')}
${asts.join('\n')}

## Data sources

- Orbital elements: CelesTrak (public US Space Force catalogue), refreshed every 2 hours; positions propagated with SGP4.
- Moon, Sun and asteroid positions: NASA JPL Horizons and the JPL Small-Body close-approach database.
- Space weather and aurora: NOAA Space Weather Prediction Center, refreshed every 5 minutes.
- Earth imagery: NASA GIBS (Blue Marble, NOAA-20 VIIRS).

## Optional

- [Terms of Use](${site}/terms)
- [Privacy Policy](${site}/privacy)
- [Cookie Policy](${site}/cookies)
`;
}
export { slugify };

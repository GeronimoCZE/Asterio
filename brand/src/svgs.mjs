import fs from 'node:fs';
import { C, letterA, arcGrad, word as build, WORD_W } from './geom.mjs';
// Writes every SVG into app/brand (and the favicon into app/). Run: node brand/src/svgs.mjs
const out = new URL('../../app/brand', import.meta.url).pathname;
const pad = 2; // breathing room so miters/antialias are not clipped
const svg = (vb, body, label) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" role="img" aria-label="${label}">${body}</svg>\n`;

// Wordmark: light (for dark bg) and dark ink (for light bg)
const word = (ink, ends, mid, sun) => svg(`0 0 ${WORD_W} 60`,
  `<defs>${arcGrad('asArc', 0, 0, ends, mid)}</defs>` + build({ ink, sun, glow: sun === C.sun ? '#8cc4ff' : ends }).svg, 'Galacticio');
fs.writeFileSync(`${out}/logo.svg`, word(C.ink, C.ion, C.glow, C.sun));
fs.writeFileSync(`${out}/logo-dark.svg`, word('#0b1220', '#1f6fd6', '#5aa9ff', '#1f6fd6'));
fs.writeFileSync(`${out}/logo-mono.svg`, svg(`0 0 ${WORD_W} 60`, build({ ink:'currentColor', arc:'currentColor', sun:'currentColor' }).svg, 'Galacticio'));

// Mark (the A alone), transparent
const mark = (ink, ends, mid, sun) => svg('-6 -4 80 68',
  `<defs>${arcGrad('asArc', 12, 56, ends, mid)}</defs>` + letterA({ ink, sun, t: 11, glow: sun === C.sun ? '#8cc4ff' : ends }), 'Galacticio');
fs.writeFileSync(`${out}/mark.svg`, mark(C.ink, C.ion, C.glow, C.sun));
fs.writeFileSync(`${out}/mark-dark.svg`, mark('#0b1220', '#1f6fd6', '#5aa9ff', '#1f6fd6'));

// App icon tile: A on deep space, faint atmospheric bloom where the sun rises.
export const tile = ({ r = 14, bleed = false, t = 12.5, scale } = {}) => {
  const s = scale || (bleed ? 0.50 : 0.62);              // maskable keeps the A inside the 80% safe zone
  const w = 68 * s, h = 60 * s, x = (64 - w) / 2, y = (64 - h) / 2 + 1;
  const rect = bleed ? `<rect width="64" height="64" fill="url(#bg)"/>` : `<rect width="64" height="64" rx="${r}" fill="url(#bg)"/>`;
  return svg('0 0 64 64',
    `<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="64" gradientUnits="userSpaceOnUse"><stop stop-color="#0c1322"/><stop offset="1" stop-color="${C.space}"/></linearGradient>` +
    `<radialGradient id="bloom" cx="32" cy="${y + 41.5*s}" r="${22}" gradientUnits="userSpaceOnUse"><stop stop-color="${C.ion}" stop-opacity=".30"/><stop offset="1" stop-color="${C.ion}" stop-opacity="0"/></radialGradient>` +
    arcGrad('asArc', 8, 60, C.ion, C.glow) + `</defs>` + rect +
    `<circle cx="32" cy="${y + 41.5*s}" r="22" fill="url(#bloom)"/>` +
    `<g transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${s})">${letterA({ t, aw: 6, rx: 11.5, ry: 10, k: .9, lift: 3.6, glow: '#8cc4ff' })}</g>`, 'Galacticio');
};
fs.writeFileSync(`${out}/icon.svg`, tile());
fs.writeFileSync(`${out}/icon-maskable.svg`, tile({ bleed: true }));
fs.writeFileSync(`${out}/icon-apple.svg`, tile({ bleed: true, scale: 0.6 }));

// Small-size tile (favicon): bigger, heavier A; the sun reduced to a bold spark, no bloom.
const small = (() => {
  const s = 0.80, w = 68 * s, h = 60 * s, x = (64 - w) / 2, y = (64 - h) / 2 + 1;
  return svg('0 0 64 64',
    `<defs>${arcGrad('asArc', 6, 62, C.ion, C.glow)}</defs><rect width="64" height="64" rx="14" fill="${C.space}"/>` +
    `<g transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${s})">${letterA({ t: 13, aw: 7.5, yc: 44, arc: C.ion, sun: 'none' })}</g>`, 'Galacticio');
})();
fs.writeFileSync(`${out}/../favicon.svg`, small);

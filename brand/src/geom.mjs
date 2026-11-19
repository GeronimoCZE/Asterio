// Galacticio brand geometry. Cap height 60 units, stroke 8.
const f = n => +n.toFixed(2);
export const C = { ink:'#e9eef6', ion:'#5aa9ff', glow:'#e6f2ff', sun:'#ffffff', space:'#05070d', space2:'#0a0e17', dark:'#0b1220' };

// The A: chevron (no crossbar) + horizon arc as crossbar + half-star sun rising on it.
export function letterA({ x=0, t=9.9, ink=C.ink, arc='url(#asArc)', sun=C.sun, aw=4.5, yc=41.5, R=46.4, rx=10.5, ry=9, k=0.6, lift=3.2, glow=null, id='as' } = {}) {
  const W = 68, H = 60, cx = 34 + x;
  const yi = H * t / (W / 2);
  const cy = yc + R;
  const ex = 22, ey = cy - Math.sqrt(R*R - ex*ex);
  const yt = yc - aw / 2;                                  // top edge of horizon at crest
  const Rt = R + aw / 2;
  const ty = cy - Math.sqrt(Rt*Rt - rx*rx) + 0.4;          // ray tips sit on the curved horizon
  const legs = `<path fill="${ink}" d="M${f(cx)} 0L${f(x+W)} ${H}H${f(x+W-t)}L${f(cx)} ${f(yi)}L${f(x+t)} ${H}H${f(x)}Z"/>`;
  const arcP = `<path fill="none" stroke="${arc}" stroke-width="${aw}" d="M${f(cx-ex)} ${f(ey)}A${R} ${R} 0 0 1 ${f(cx+ex)} ${f(ey)}"/>`;
  const sy = yt - lift;                                    // sun centre, just above the limb
  const star = `<path fill="${sun}" d="M${f(cx-rx)} ${f(sy)}Q${f(cx-k)} ${f(sy-k)} ${f(cx)} ${f(sy-ry)}Q${f(cx+k)} ${f(sy-k)} ${f(cx+rx)} ${f(sy)}Q${f(cx+k)} ${f(sy+k)} ${f(cx)} ${f(yt+2)}Q${f(cx-k)} ${f(sy+k)} ${f(cx-rx)} ${f(sy)}Z"/>`;
  let g = '';
  if (glow) g = `<clipPath id="${id}Sky"><path d="M${f(cx-ex)} ${f(ey)}A${R} ${R} 0 0 1 ${f(cx+ex)} ${f(ey)}V0H${f(cx-ex)}Z"/></clipPath>` +
    `<radialGradient id="${id}Glow" cx="${f(cx)}" cy="${f(sy)}" r="13" gradientUnits="userSpaceOnUse"><stop stop-color="${glow}" stop-opacity=".9"/><stop offset=".3" stop-color="${glow}" stop-opacity=".35"/><stop offset="1" stop-color="${glow}" stop-opacity="0"/></radialGradient>` +
    `<ellipse clip-path="url(#${id}Sky)" cx="${f(cx)}" cy="${f(sy)}" rx="17" ry="13" fill="url(#${id}Glow)"/>`;
  return g + star + arcP + legs;
}

// Bounding-box units, so the same gradient serves every A wherever it sits.
export function arcGrad(id='asArc', _x0, _x1, ends=C.ion, mid=C.glow) {
  return `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${ends}"/><stop offset=".5" stop-color="${mid}"/><stop offset="1" stop-color="${ends}"/></linearGradient>`;
}

// Glyphs other than A. Each takes its left edge x and returns [svg, width].
const S8 = 8;
const st = ink => `fill="none" stroke="${ink}" stroke-width="${S8}"`;
// Round letters share the O's stadium: radius 26 on the stroke centreline.
const roundC = (x, w, ink, bar) => {
  const r = 26, cl = x + 30, cr = x + w - 30, a = Math.PI / 4;
  const tx = cr + r * Math.cos(a), ty = 30 - r * Math.sin(a);
  const top = `M${f(tx)} ${f(ty)}A${r} ${r} 0 0 0 ${f(cr)} 4H${f(cl)}A${r} ${r} 0 0 0 ${f(cl)} 56H${f(cr)}`;
  const tail = bar ? `A${r} ${r} 0 0 0 ${f(x + w - 4)} 30H${f(x + w - 26)}` : `A${r} ${r} 0 0 0 ${f(tx)} ${f(60 - ty)}`;
  return `<path ${st(ink)} stroke-linejoin="miter" d="${top}${tail}"/>`;
};
export const GLYPH = {
  G: (x, ink) => [roundC(x, 68, ink, true), 68],
  C: (x, ink) => [roundC(x, 64, ink, false), 56],
  L: (x, ink) => [`<path fill="${ink}" d="M${x} 0h8v52h36v8H${x}z"/>`, 44],
  T: (x, ink) => [`<path fill="${ink}" d="M${x} 0h52v8H${x+30}v52h-8V8H${x}z"/>`, 52],
  I: (x, ink) => [`<path fill="${ink}" d="M${x} 0h8v60h-8z"/>`, 8],
  O: (x, ink) => [`<rect ${st(ink)} x="${x+4}" y="4" width="60" height="52" rx="26"/>`, 68],
};

// GALACTICIO. Gaps are set by eye for each pair (units, cap height 60).
// The first A carries the rising Sun; the second keeps the horizon only.
export const WORD = 'GALACTICIO';
const GAPS = [11, 6, 7, 10, 13, 16, 14, 14, 17];
export function word({ ink = C.ink, arc = 'url(#asArc)', sun = C.sun, glow = null } = {}) {
  let x = 0, out = '', n = 0;
  for (let i = 0; i < WORD.length; i++) {
    const ch = WORD[i];
    if (ch === 'A') {
      const first = n++ === 0;
      out += letterA({ x, ink, arc, sun: first ? sun : 'none', glow: first ? glow : null, id: 'as' + i });
      x += 68;
    } else { const [g, w] = GLYPH[ch](x, ink); out += g; x += w; }
    if (i < GAPS.length) x += GAPS[i];
  }
  return { svg: out, width: x };
}
export const WORD_W = word().width, CAP = 60;

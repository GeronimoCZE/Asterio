// Asterio brand geometry. Cap height 60 units, stroke 8.
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

export function arcGrad(id='asArc', x0=12, x1=56, ends=C.ion, mid=C.glow) {
  return `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${x0}" y1="0" x2="${x1}" y2="0"><stop offset="0" stop-color="${ends}"/><stop offset=".5" stop-color="${mid}"/><stop offset="1" stop-color="${ends}"/></linearGradient>`;
}

// STERIO, positioned after the A.
export function rest(ink = C.ink) {
  const s = 8, X = { S:82, T:144, E:208, R:272, I:342, O:370 };
  const st = `fill="none" stroke="${ink}" stroke-width="${s}"`;
  const S = `<path ${st} d="M${X.S+50} 4H${X.S+17}A13 13 0 0 0 ${X.S+17} 30H${X.S+33}A13 13 0 0 1 ${X.S+33} 56H${X.S}"/>`;
  const T = `<path fill="${ink}" d="M${X.T} 0h52v8H${X.T+30}v52h-8V8H${X.T}z"/>`;
  const E = `<path fill="${ink}" d="M${X.E} 0h44v8H${X.E+8}v18h32v8H${X.E+8}v18h36v8H${X.E}z"/>`;
  const R = `<path fill="${ink}" d="M${X.R} 0h8v60h-8z"/><path ${st} d="M${X.R+4} 4H${X.R+33}A13 13 0 0 1 ${X.R+33} 30H${X.R+4}"/><path fill="${ink}" d="M${X.R+25} 30h9.2L${X.R+50} 60h-9.2z"/>`;
  const I = `<path fill="${ink}" d="M${X.I} 0h8v60h-8z"/>`;
  const O = `<rect ${st} x="${X.O+4}" y="4" width="60" height="52" rx="26"/>`;
  return S + T + E + R + I + O;
}
export const WORD_W = 438, CAP = 60;

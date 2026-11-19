import { createRequire } from 'node:module'; const { chromium } = createRequire(import.meta.url)('playwright');
// Renders the social cards (2x, then downscale): node brand/src/og.mjs [name]
const HERE = new URL('.', import.meta.url).pathname;

import fs from 'node:fs';
const APP = HERE + '../../app/';
const b64 = (f, t) => `data:${t};base64,` + fs.readFileSync(f).toString('base64');
const DAY = b64(APP + 'tiles/bm_global.jpg', 'image/jpeg'), NIGHT = b64(APP + 'tiles/lights.png', 'image/png');
const LOGO = b64(APP + 'brand/logo.svg', 'image/svg+xml');
const GEIST = b64(HERE + 'fonts/geist.woff2', 'font/woff2'), MONO = b64(HERE + 'fonts/geistmono.woff2', 'font/woff2');

// Scene: Earth limb at night over Europe, the Sun just clearing the horizon (the same idea as the A).
const scene = ({ W, H, cx, cy, R, gx }) => `
<canvas id="c" style="position:absolute;inset:0;width:${W}px;height:${H}px"></canvas>
<script>
const W=${W},H=${H},DPR=devicePixelRatio, cv=document.getElementById('c'); cv.width=W*DPR; cv.height=H*DPR;
const gl=cv.getContext('webgl',{antialias:true,preserveDrawingBuffer:true});
const vs='attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
const fs=\`precision highp float;
uniform sampler2D day,night; uniform float dpr;
const vec2 C=vec2(${cx.toFixed(1)},${cy.toFixed(1)}); const float R=${R.toFixed(1)};
const float lat0=radians(-33.), lon0=radians(16.);
float h21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
void main(){
  vec2 p=vec2(gl_FragCoord.x, ${H}.0*dpr-gl_FragCoord.y)/dpr;
  vec2 d=(p-C)/R; float r=length(d);
  float gxp=${gx.toFixed(1)}; float limbY=C.y-sqrt(R*R-(gxp-C.x)*(gxp-C.x));
  vec2 G=vec2(gxp, limbY-3.5);
  vec3 sunV=normalize(vec3((gxp-C.x)/R*0.9, 0.21, -0.98));
  float dg=length(p-G);
  float fwd=exp(-dg/240.)+0.35*exp(-dg/700.);
  vec3 col=vec3(0.010,0.014,0.026);
  // sparse stars, dimmer near the glare
  vec2 cell=floor(p/3.); float s=h21(cell); if(s>0.9965){ float m=h21(cell+7.1); col+=vec3(0.75,0.82,1.0)*pow(m,3.)*0.9*(1.-smoothstep(80.,420.,-dg+500.)); }
  col+=vec3(0.03,0.07,0.16)*exp(-max(0.,p.y-0.)/900.)*0.25;
  if(r<1.){
    vec3 n=vec3(d.x,-d.y,sqrt(1.-r*r));
    vec3 e=vec3(-sin(lon0),cos(lon0),0.);
    vec3 u=vec3(-sin(lat0)*cos(lon0),-sin(lat0)*sin(lon0),cos(lat0));
    vec3 f=vec3(cos(lat0)*cos(lon0),cos(lat0)*sin(lon0),sin(lat0));
    vec3 w=n.x*e+n.y*u+n.z*f;
    float lat=asin(clamp(w.z,-1.,1.)), lon=atan(w.y,w.x);
    vec2 uv=vec2(lon/6.2831853+0.5, 0.5-lat/3.1415927);
    vec3 dc=texture2D(day,uv).rgb; float nl=texture2D(night,uv).r;
    float ndl=dot(n,sunV);
    float lit=smoothstep(-0.02,0.16,ndl);
    vec3 c=dc*dc*1.6*lit;
    c+=vec3(1.0,0.76,0.48)*pow(nl,1.25)*1.5*(1.-smoothstep(-0.06,0.03,ndl));
    float rim=pow(1.-n.z,7.);
    c+=vec3(0.18,0.42,1.0)*rim*(0.05+1.8*exp(-dg/260.));
    c+=vec3(0.015,0.035,0.085)*(1.-n.z)*0.5;
    col=c;
  } else {
    float hgt=(r-1.)*R;
    col+=vec3(0.22,0.52,1.0)*exp(-hgt/9.)*(0.14+2.6*fwd);
    col+=vec3(0.30,0.55,1.0)*exp(-hgt/40.)*(0.03+0.55*fwd);
  }
  // the Sun: a bead of light with a long horizontal streak hugging the limb
  vec2 q=p-G;
  col+=vec3(1.0,0.97,0.92)*(exp(-dg/5.5)*2.2+exp(-dg/22.)*0.55);
  col+=vec3(0.75,0.88,1.0)*exp(-abs(q.y)/1.6)*exp(-abs(q.x)/120.)*0.9;
  col+=vec3(0.8,0.9,1.0)*exp(-abs(q.x)/1.3)*exp(-max(0.,-q.y)/34.)*step(q.y,0.)*0.9;
  col=1.-exp(-col*1.25);
  col=pow(col,vec3(0.94));
  col+=(h21(p*1.7)-0.5)/255.;
  gl_FragColor=vec4(col,1.);
}\`;
function sh(t,s){const o=gl.createShader(t);gl.shaderSource(o,s);gl.compileShader(o);if(!gl.getShaderParameter(o,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(o));return o;}
const pr=gl.createProgram();gl.attachShader(pr,sh(gl.VERTEX_SHADER,vs));gl.attachShader(pr,sh(gl.FRAGMENT_SHADER,fs));gl.linkProgram(pr);gl.useProgram(pr);
const bf=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,bf);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
const loc=gl.getAttribLocation(pr,'p');gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0);
gl.uniform1f(gl.getUniformLocation(pr,'dpr'),DPR);
function tex(src,unit,name){return new Promise(res=>{const im=new Image();im.onload=()=>{const t=gl.createTexture();gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,t);
gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,gl.RGB,gl.UNSIGNED_BYTE,im);gl.generateMipmap(gl.TEXTURE_2D);
gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);
gl.uniform1i(gl.getUniformLocation(pr,name),unit);res();};im.src=src;});}
Promise.all([tex('${DAY}',0,'day'),tex('${NIGHT}',1,'night')]).then(()=>{gl.viewport(0,0,cv.width,cv.height);gl.drawArrays(gl.TRIANGLES,0,3);window.READY=1;});
</script>`;

const css = `@font-face{font-family:Geist;src:url(${GEIST}) format('woff2');font-weight:300 700}
@font-face{font-family:'Geist Mono';src:url(${MONO}) format('woff2');font-weight:400 500}
html,body{margin:0;background:#05070d;color:#e9eef6;font-family:Geist,sans-serif;-webkit-font-smoothing:antialiased}
.f{position:relative;overflow:hidden}
.o{position:absolute;inset:0;padding:72px 80px}
.eb{font-family:'Geist Mono',monospace;font-size:15px;letter-spacing:.18em;text-transform:uppercase;color:#5aa9ff;display:flex;align-items:center;gap:12px}
.eb i{width:8px;height:8px;border-radius:50%;background:#3ddc97;box-shadow:0 0 0 4px rgba(61,220,151,.16)}
.tag{font-size:30px;line-height:1.25;font-weight:400;letter-spacing:-.01em;color:#c9d3e1;margin-top:30px}
.h{font-size:66px;line-height:1.02;font-weight:600;letter-spacing:-.03em;max-width:15ch;margin-top:22px}
.sub{font-size:24px;line-height:1.35;color:#93a0b4;max-width:34ch;margin-top:20px}
.foot{position:absolute;left:80px;bottom:56px;font-family:'Geist Mono',monospace;font-size:13px;letter-spacing:.08em;color:#93a0b4}`;

const pages = {
  default: { home: true },
  about:   { eb: 'About', h: 'A live map of the space around Earth', sub: 'Satellites, debris, near-Earth asteroids, the Moon, atmosphere layers and space weather in one 3D view.' },
  sources: { eb: 'Data sources', h: 'Where every layer comes from', sub: 'CelesTrak orbits, NASA JPL ephemerides, NOAA space weather and NASA GIBS imagery, credited layer by layer.' },
  satellites: { eb: 'Satellite catalogue', h: 'Every tracked satellite, by type', sub: 'Space stations, GPS, geostationary and Earth-observation satellites, and passing asteroids.' },
  terms:   { eb: 'Legal', h: 'Terms of Use', sub: 'The terms for using Galacticio, the free live 3D map of the space around Earth.' },
  privacy: { eb: 'Legal', h: 'Privacy Policy', sub: 'What Galacticio stores when you sign in with Google, why, and for how long.' },
  cookies: { eb: 'Legal', h: 'Cookie Policy', sub: 'No tracking or advertising cookies. One sign-in cookie, set only if you sign in.' },
};
const overlay = (pg) => pg.home
  ? `<div class="o"><div class="eb"><i></i>Live 3D orbit map</div><img src="${LOGO}" style="width:680px;display:block;margin-top:30px"><div class="tag">A live map of the space around Earth.</div></div>`
  : `<div class="o"><img src="${LOGO}" style="height:24px;display:block"><div class="eb" style="margin-top:58px">${pg.eb}</div><div class="h">${pg.h}</div><div class="sub">${pg.sub}</div></div>`;

const only = process.argv[2];
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
for (const [name, pg] of Object.entries(pages)) {
  if (only && only !== name) continue;
  const W = 1200, H = 630;
  const geo = pg.home ? { W, H, cx: 800, cy: 1700, R: 1280, gx: 840 } : { W, H, cx: 900, cy: 1500, R: 1050, gx: 940 };
  const p = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
  p.on('pageerror', e => console.error(name, e.message)); p.on('console', m => console.log(name, m.text()));
  await p.setContent(`<style>${css}</style><div class="f" style="width:${W}px;height:${H}px">${scene(geo)}${overlay(pg)}</div>`);
  await p.waitForFunction('window.READY===1', null, { timeout: 120000 });
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path: `${HERE}raw-og-${name}.png` });
  await p.close(); console.log('ok', name);
}
await b.close();

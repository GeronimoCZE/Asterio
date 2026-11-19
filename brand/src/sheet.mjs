import { createRequire } from 'node:module'; const { chromium } = createRequire(import.meta.url)('playwright');
const HERE = new URL('.', import.meta.url).pathname;

import fs from 'node:fs';
const B = HERE + '../../app/brand/';
const u = (f, t) => `data:${t};base64,` + fs.readFileSync(f).toString('base64');
const svg = f => u(B + f, 'image/svg+xml'), png = f => u(B + f, 'image/png');
const GEIST = u(HERE + 'fonts/geist.woff2', 'font/woff2'), MONO = u(HERE + 'fonts/geistmono.woff2', 'font/woff2');
const sw = [['Space','#05070d','Page background'],['Deep','#0a0e17','Surfaces, cards'],['Ink','#e9eef6','Text, wordmark'],['Muted','#93a0b4','Secondary text'],['Ion','#5aa9ff','Accent, links, horizon'],['Glow','#e6f2ff','Sunlight highlight'],['Ion deep','#1f6fd6','Accent on light'],['Night','#0b1220','Ink on light']];
const html = `<style>@font-face{font-family:Geist;src:url(${GEIST});font-weight:300 700}@font-face{font-family:GM;src:url(${MONO});font-weight:400 500}
body{margin:0;background:#05070d;color:#e9eef6;font-family:Geist;-webkit-font-smoothing:antialiased}
.w{width:1600px;padding:72px 80px 64px;box-sizing:border-box}
.k{font-family:GM;font-size:13px;letter-spacing:.16em;text-transform:uppercase;color:#5aa9ff;margin-bottom:18px}
.g{display:grid;gap:24px}.c{background:#0a0e17;border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:28px}
.sw{display:grid;grid-template-columns:repeat(8,1fr);gap:12px}.sw div{border-radius:12px;overflow:hidden;border:1px solid rgba(255,255,255,.1)}
.sw i{display:block;height:92px}.sw p{margin:0;padding:12px 14px;background:#0a0e17;font-size:14px}.sw b{display:block;font-weight:600}.sw span{font-family:GM;font-size:12.5px;color:#93a0b4}.sw em{display:block;font-style:normal;font-size:12px;color:#5d6a7e;margin-top:4px}
.m{font-family:GM;color:#93a0b4;font-size:13px}</style>
<div class="w">
<div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:56px"><div><div class="k">Brand sheet · v2 · November 2026</div><img src="${svg('logo.svg')}" style="width:760px;display:block"></div>
<div class="m" style="text-align:right;line-height:1.7">A live map of the space around Earth.<br>Created by Nikolas Malík · malikweb.eu</div></div>
<div class="g" style="grid-template-columns:1.05fr 1fr 1fr;margin-bottom:24px">
<div class="c"><div class="k">The mark</div><div style="display:flex;gap:28px;align-items:center"><img src="${svg('mark.svg')}" style="width:170px"><p style="margin:0;font-size:16px;line-height:1.55;color:#c9d3e1">Each A has no crossbar. Its place is taken by Earth's horizon, with the Sun clearing the limb: the view from orbit at sunrise. The Sun rises in the first A only. Ion blue is the atmosphere; white is sunlight.</p></div></div>
<div class="c"><div class="k">App icons</div><div style="display:flex;gap:22px;align-items:flex-end"><img src="${png('icon-512.png')}" style="width:132px"><img src="${png('icon-192.png')}" style="width:72px"><img src="${svg('../favicon.svg')}" style="width:32px"><img src="${svg('../favicon.svg')}" style="width:16px"></div><p class="m" style="margin:18px 0 0">Below 48 px the Sun is dropped and the A gets heavier.</p></div>
<div class="c" style="background:#f3f5f9"><div class="k" style="color:#1f6fd6">On light</div><img src="${svg('logo-dark.svg')}" style="width:300px;display:block;margin:18px 0 26px"><img src="${svg('mark-dark.svg')}" style="width:64px"></div>
</div>
<div class="c" style="margin-bottom:24px"><div class="k">Palette</div><div class="sw">${sw.map(([n,h,d])=>`<div><i style="background:${h}"></i><p><b>${n}</b><span>${h}</span><em>${d}</em></p></div>`).join('')}</div></div>
<div class="g" style="grid-template-columns:1fr 1.25fr">
<div class="c"><div class="k">Type</div><div style="font-size:54px;font-weight:600;letter-spacing:-.03em;line-height:1">Geist</div><p style="margin:10px 0 22px;color:#93a0b4;font-size:16px">Headlines 600, tight tracking. Body 400 at 14–16 px.</p><div style="font-family:GM;font-size:30px;line-height:1">Geist Mono 408.2 km</div><p style="margin:10px 0 0;color:#93a0b4;font-size:16px">Numbers, telemetry, labels. Tabular figures.</p><div class="k" style="margin-top:34px">Usage</div><ul style="margin:0;padding-left:18px;color:#c9d3e1;font-size:15px;line-height:1.75"><li>The wordmark is custom drawn. Never retype "GALACTICIO" in a font.</li><li>Clear space: half the cap height on every side.</li><li>Smallest sizes: wordmark 14 px tall, mark 16 px (use favicon.svg below 48 px).</li><li>Keep the horizon ion blue; go single colour only with logo-mono.svg.</li><li>Over imagery, sit the logo on Space or a dark scrim.</li></ul></div>
<div class="c"><div class="k">Social card</div><img src="${png('og-default.png')}" style="width:100%;border-radius:10px;display:block"></div>
</div></div>`;
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
await p.setContent(html); await p.evaluate(() => document.fonts.ready); await p.screenshot({ path: process.argv[2], fullPage: true }); await b.close();

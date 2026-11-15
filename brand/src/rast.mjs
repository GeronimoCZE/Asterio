import { createRequire } from 'node:module'; const { chromium } = createRequire(import.meta.url)('playwright');
import fs from 'node:fs';
// usage: node rast.mjs file.svg size out.png [size out.png ...]
const [,, file, ...rest] = process.argv;
const src = 'data:image/svg+xml;base64,' + fs.readFileSync(file).toString('base64');
const b = await chromium.launch();
for (let i = 0; i < rest.length; i += 2) {
  const s = +rest[i];
  const p = await b.newPage({ viewport: { width: s, height: s } });
  await p.setContent(`<style>html,body{margin:0;background:transparent}</style><img src="${src}" style="width:${s}px;height:${s}px;display:block">`);
  await p.screenshot({ path: rest[i + 1], omitBackground: true }); await p.close();
}
await b.close();

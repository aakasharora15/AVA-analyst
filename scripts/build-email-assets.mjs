// Renders the images AVA emails use (hero banner, icon badges) to PNG.
// Email clients do not display SVG or CSS effects, so these are baked images.
//   node scripts/build-email-assets.mjs   (needs Playwright's Chromium)
import { readFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

// Playwright is a dev tool, not a project dependency: use the machine's copy.
const { chromium } = createRequire(import.meta.url)('playwright');

const out = new URL('../public/icons/email/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const logo = readFileSync(new URL('../src/components/logo.js', import.meta.url), 'utf8');
const paths = [...logo.matchAll(/'(M[^']+)'/g)].map((m) => m[1]);
const wordmark = (h, fill) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 544.53 220.65" height="${h}" fill="${fill}">${paths.map((d) => `<path d="${d}"/>`).join('')}</svg>`;

// Hero: a ledger of currency figures behind a capital line that AVA flags
// before it turns. The figures are texture, not data.
let seed = 7;
const rand = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const W = 560, H = 170;
const SYMBOLS = ['£', '$', '€', '₹', '¥'];
const UNITS = ['K', 'M', 'M', 'M', 'bn'];
const figure = () => `${SYMBOLS[Math.floor(rand() * SYMBOLS.length)]}${(1 + rand() * 98).toFixed(rand() > 0.5 ? 1 : 0)}${UNITS[Math.floor(rand() * UNITS.length)]}`;
const ledger = Array.from({ length: 9 }, (_, r) => {
  let x = -((r * 37) % 60), row = '';
  while (x < W) { const f = figure(); row += `<text x="${x}" y="${16 + r * 19}">${f}</text>`; x += f.length * 7.6 + 22; }
  return row;
}).join('');
const grid = [...Array.from({ length: 21 }, (_, i) => `<path d="M${i * 28} 0V${H}"/>`), ...Array.from({ length: 7 }, (_, i) => `<path d="M0 ${i * 28}H${W}"/>`)].join('');
// Capital line: climbs, AVA flags the peak, the dashed path shows the turn it saw coming.
const pts = [[300, 142], [330, 128], [356, 132], [384, 108], [410, 112], [436, 86], [462, 70]];
const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p.join(' ')}`).join(' ');
const THEMES = {
  dark: { bg: `radial-gradient(80% 120% at 0% 0%, rgba(169,159,255,.30), rgba(169,159,255,0) 60%),
  radial-gradient(60% 90% at 85% 40%, rgba(255,165,102,.16), rgba(255,165,102,0) 65%),
  linear-gradient(180deg,#0C1132,#070A20)`, grid: '#FFFFFF', gridO: '.045', fig: '#C9C2FF', figO: '.16', line: '#C9C2FF', area: '#A99FFF', node: '#0C1132', risk: '#FFA566', down: '#FF8F8F', pillBg: '#1A1430', pillInk: '#FFC79E', ink: '#F2F4FA', caption: '#C9C2FF' },
  light: { bg: `radial-gradient(80% 120% at 0% 0%, rgba(124,110,255,.22), rgba(124,110,255,0) 60%),
  radial-gradient(60% 90% at 85% 40%, rgba(255,140,60,.14), rgba(255,140,60,0) 65%),
  linear-gradient(180deg,#F1EFFF,#FAF9FF)`, grid: '#1C1A4A', gridO: '.06', fig: '#4338CA', figO: '.14', line: '#5146D1', area: '#7C6EFF', node: '#FFFFFF', risk: '#E8650E', down: '#D93B3B', pillBg: '#FFFFFF', pillInk: '#C2410C', ink: '#0E1230', caption: '#5146D1' },
};
const hero = (t) => `<div style="width:${W}px;height:${H}px;border-radius:24px 24px 0 0;overflow:hidden;position:relative;background:${t.bg};">
  <svg width="${W}" height="${H}" style="position:absolute;inset:0">
    <defs>
      <linearGradient id="fade" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".38" stop-color="#fff" stop-opacity=".12"/><stop offset=".62" stop-color="#fff" stop-opacity=".85"/><stop offset="1" stop-color="#fff" stop-opacity=".45"/></linearGradient>
      <mask id="m"><rect width="${W}" height="${H}" fill="url(#fade)"/></mask>
      <linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${t.area}" stop-opacity=".35"/><stop offset="1" stop-color="${t.area}" stop-opacity="0"/></linearGradient>
    </defs>
    <g stroke="${t.grid}" stroke-opacity="${t.gridO}">${grid}</g>
    <g mask="url(#m)" font-family="'Geist Mono',ui-monospace,monospace" font-size="11" font-weight="600" fill="${t.fig}" fill-opacity="${t.figO}">${ledger}</g>
    <path d="${line} L462 ${H} L300 ${H} Z" fill="url(#area)"/>
    <path d="${line}" fill="none" stroke="${t.line}" stroke-width="2" stroke-linejoin="round"/>
    ${pts.slice(0, -1).map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.5" fill="${t.node}" stroke="${t.line}" stroke-width="1.5"/>`).join('')}
    <path d="M462 70 C 486 76, 500 104, 528 132" fill="none" stroke="${t.down}" stroke-width="2" stroke-dasharray="4 5" stroke-linecap="round"/>
    <path d="M462 ${H}V70" stroke="${t.risk}" stroke-opacity=".35" stroke-dasharray="2 4"/>
    <circle cx="462" cy="70" r="16" fill="${t.risk}" fill-opacity=".14"/>
    <circle cx="462" cy="70" r="9" fill="${t.risk}" fill-opacity=".25"/>
    <circle cx="462" cy="70" r="5" fill="${t.risk}"/>
    <g transform="translate(380 30)"><rect width="92" height="22" rx="11" fill="${t.pillBg}" stroke="${t.risk}" stroke-opacity=".7"/>
      <text x="46" y="15" text-anchor="middle" font-family="'Geist Mono',ui-monospace,monospace" font-size="9.5" font-weight="600" letter-spacing="1.2" fill="${t.pillInk}">RISK FOUND</text></g>
  </svg>
  <div style="position:absolute;left:32px;top:46px">${wordmark(40, t.ink)}</div>
  <div style="position:absolute;left:32px;bottom:26px;font:600 10.5px/1.5 'Geist Mono',ui-monospace,monospace;letter-spacing:.16em;color:${t.caption}">FIND THE RISK BEFORE<br>THE CAPITAL GOES IN</div>
</div>`;

const ICONS = {
  invite: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  report: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/>',
  alert: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  metrics: '<path d="M3 3v18h18"/><path d="M8 17v-5M13 17V8M18 17V5"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
  billing: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  share: '<path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"/><path d="m16 6-4-4-4 4M12 2v14"/>',
};
const BADGE = { dark: ['#2A2F5E', '#151A38', '#343B70', '#C9C2FF'], light: ['#F3F1FF', '#E6E1FF', '#D6D0FF', '#4338CA'] };
const badge = (body, [from, to, ring, ink]) => `<div style="width:48px;height:48px;border-radius:50%;background:radial-gradient(circle at 30% 25%,${from},${to});box-shadow:inset 0 0 0 1px ${ring};display:grid;place-items:center">
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${ink}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg></div>`;

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 600, height: 220 } });
const shot = async (markup, file) => {
  await page.setContent(`<html><head><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist+Mono:wght@600&display=swap"></head><body style="margin:0;background:transparent">${markup}</body></html>`);
  await page.waitForTimeout(300);
  await page.locator('body > *').first().screenshot({ path: out + file, omitBackground: true });
};
// Dark files keep the plain names; light ones end in -light.
for (const theme of ['dark', 'light']) {
  const sfx = theme === 'dark' ? '' : '-light';
  await shot(hero(THEMES[theme]), `hero${sfx}.png`);
  for (const [name, body] of Object.entries(ICONS)) await shot(badge(body, BADGE[theme]), `icon-${name}${sfx}.png`);
}
await browser.close();
console.log('email assets written to', out);

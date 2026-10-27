// Renders the site icons (touch icon, 192, 512, favicon.ico) from the logo and tokens.
// Development-only: SITE_PLAYWRIGHT_MODULE=/path/to/playwright node site/scripts/render-icons.mjs
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { avatarHtml } from './share-card.mjs';

const site = fileURLToPath(new URL('../public/', import.meta.url));
const tokens = JSON.parse(readFileSync(new URL('../../brand/tokens/tokens.json', import.meta.url), 'utf8'));
const logo = name => readFileSync(new URL(`../../brand/logo/${name}`, import.meta.url), 'utf8');
const { chromium } = createRequire(import.meta.url)(process.env.SITE_PLAYWRIGHT_MODULE || 'playwright');
const ICONS = [['apple-touch-icon', 180], ['icon-192', 192], ['icon-512', 512]];

const browser = await chromium.launch({ headless: true, executablePath: process.env.SITE_CHROMIUM, args: ['--no-sandbox'] });
try {
  for (const [name, size] of ICONS) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(avatarHtml({ size, tokens, logo }));
    await page.screenshot({ path: `${site}${name}.png` });
    await page.close();
    console.log(`site/public/${name}.png`, `${size}x${size}`);
  }
  await renderFavicon(browser);
} finally { await browser.close(); }

// favicon.ico: the original transparent mark (orange body, near-black base) at 16, 32 and 48 px, PNG-in-ICO
async function renderFavicon(browser) {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const pngs = [];
  for (const size of [16, 32, 48]) {
    await page.setViewportSize({ width: size, height: size });
    const cell = Math.floor(size / 5);  // whole device pixels per mark pixel keeps the edges crisp
    await page.setContent(`<html><body style="margin:0;background:transparent;height:${size}px;display:flex;align-items:center;justify-content:center">${logo('mark.svg').replace('<svg', `<svg style="width:${cell * 4}px;height:${cell * 5}px;display:block"`)}</body></html>`);
    pngs.push([size, await page.screenshot({ omitBackground: true })]);
  }
  await page.close();
  writeFileSync(`${site}favicon.ico`, ico(pngs));
  console.log('site/public/favicon.ico', '16+32+48');
}

// ICONDIR + one ICONDIRENTRY per image, followed by the PNG bytes (supported by every current browser).
function ico(images) {
  const head = Buffer.alloc(6 + 16 * images.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(images.length, 4);
  let offset = head.length;
  images.forEach(([size, png], i) => {
    const e = 6 + 16 * i;
    head.writeUInt8(size % 256, e); head.writeUInt8(size % 256, e + 1);
    head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(png.length, e + 8); head.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  return Buffer.concat([head, ...images.map(([, png]) => png)]);
}

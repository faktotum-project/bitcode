// Renders every platform asset from the logo and tokens. Development-only: needs Playwright.
//   SITE_PLAYWRIGHT_MODULE=/path/to/playwright node brand/social/build.mjs [platform]
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cardHtml, avatarHtml, shareHtml } from './design.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const brand = join(here, '..');
const site = join(brand, '..', 'site/public');  // Vercel serves only this folder
const tokens = JSON.parse(readFileSync(join(brand, 'tokens/tokens.json'), 'utf8'));
const { chromium } = createRequire(import.meta.url)(process.env.SITE_PLAYWRIGHT_MODULE || 'playwright');
const logo = n => readFileSync(join(brand, 'logo', n), 'utf8');
// Link previews show Script, the orange Sat, cheering beside the tagline (same image as the site OG).
const sat = `data:image/png;base64,${readFileSync(join(brand, '..', 'assets/sats/script/masters/happy-1024.png')).toString('base64')}`;
const font = n => `data:font/woff2;base64,${readFileSync(join(brand, '..', 'site/public/assets/site', n)).toString('base64')}`;

// avatar = mark only (circle-safe); share = a Sat and the tagline, for link previews and post cards;
// split = copy beside a mark specimen; stack = centered for tall formats.
// `safe` keeps the composition inside the platform's crop/overlay area; `x` moves it clear of a
// profile photo that the platform lays over the banner's lower left (LinkedIn, X).
const SPECS = {
  // web icons go straight to site/public; the site's OG image is site/scripts/render-og.mjs
  icons: [['apple-touch-icon', 180, 180, 'avatar'], ['icon-192', 192, 192, 'avatar'], ['icon-512', 512, 512, 'avatar']],
  avatars: [['avatar-400', 400, 400, 'avatar'], ['avatar-800', 800, 800, 'avatar']],
  linkedin: [['banner', 1584, 396, 'split', { x: 520, width: 1000, height: 320 }], ['post', 1200, 627, 'share']],
  x: [['header', 1500, 500, 'split', { x: 300, width: 1100, height: 360 }], ['card', 1200, 675, 'share']],
  instagram: [['post-square', 1080, 1080, 'stack'], ['post-portrait', 1080, 1350, 'stack'], ['story', 1080, 1920, 'stack']],
  github: [['social-preview', 1280, 640, 'share']],
  youtube: [['banner', 2560, 1440, 'split', { width: 1546, height: 423 }], ['thumbnail', 1280, 720, 'share']]
};

const only = process.argv[2];
const browser = await chromium.launch({ headless: true, executablePath: process.env.SITE_CHROMIUM, args: ['--no-sandbox'] });
try {
  for (const [platform, items] of Object.entries(SPECS)) {
    if (only && only !== platform) continue;
    for (const [name, w, h, layout, safe] of items) {
      const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
      for (const lang of layout === 'avatar' ? ['en'] : ['en', 'it']) {
        await page.setContent(layout === 'avatar'
          ? avatarHtml({ size: w, tokens, logo })
          : layout === 'share' ? shareHtml({ w, h, lang, tokens, logo, font, sat })
          : cardHtml({ w, h, lang, layout, tokens, logo, font, safe }));
        await page.evaluate(() => document.fonts.ready);
        const dir = platform === 'icons' ? site : join(here, 'export', platform);
        mkdirSync(dir, { recursive: true });
        const file = join(dir, layout === 'avatar' ? `${name}.png` : `${name}-${lang}.png`);
        await page.screenshot({ path: file });
        console.log(file.replace(join(brand, '..') + '/', ''), `${w}x${h}`);
      }
      await page.close();
    }
  }
  if (!only || only === 'icons') {
    // favicon.ico: the original transparent mark (orange body, near-black base) at 16, 32 and 48 px, PNG-in-ICO
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    const pngs = [];
    for (const size of [16, 32, 48]) {
      await page.setViewportSize({ width: size, height: size });
      const cell = Math.floor(size / 5);  // whole device pixels per mark pixel keeps the edges crisp
      await page.setContent(`<html><body style="margin:0;background:transparent;height:${size}px;display:flex;align-items:center;justify-content:center">${logo('mark.svg').replace('<svg', `<svg style="width:${cell * 4}px;height:${cell * 5}px;display:block"`)}</body></html>`);
      pngs.push([size, await page.screenshot({ omitBackground: true })]);
    }
    await page.close();
    writeFileSync(join(site, 'favicon.ico'), ico(pngs));
    console.log('site/public/favicon.ico', '16+32+48');
  }
} finally { await browser.close(); }

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

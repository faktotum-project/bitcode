// Development-only screenshot renderer. No browser dependency is shipped to visitors.
// The composition is shared with the platform kit, so the site's share card and the
// social banners cannot drift apart: see brand/social/design.mjs.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { shareHtml } from '../../brand/social/design.mjs';
const require = createRequire(import.meta.url);
const tokens = JSON.parse(readFileSync(new URL('../../brand/tokens/tokens.json', import.meta.url), 'utf8'));
const logo = name => readFileSync(new URL(`../../brand/logo/${name}`, import.meta.url), 'utf8');
const font = name => `data:font/woff2;base64,${readFileSync(new URL(`../public/assets/site/${name}`, import.meta.url)).toString('base64')}`;
const sat = `data:image/png;base64,${readFileSync(new URL('../../assets/sats/script/masters/happy-1024.png', import.meta.url)).toString('base64')}`;
const { chromium } = require(process.env.SITE_PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.SITE_CHROMIUM, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  for (const lang of ['en', 'it']) {
    await page.setContent(shareHtml({ w: 1200, h: 630, lang, tokens, logo, font, sat }));
    await page.evaluate(() => document.fonts.ready);
    const out = fileURLToPath(new URL(`../public/assets/og-image${lang === 'it' ? '-it' : ''}.png`, import.meta.url));
    await page.screenshot({ path: out });
    console.log(out);
  }
} finally { await browser.close(); }

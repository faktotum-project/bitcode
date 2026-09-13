// Render the silent vertical release clip for bitcode v0.2.
import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tooling = process.env.BITCODE_VIDEO_TOOLS || '/tmp/bitcode-video-tools';
const { chromium } = await import(path.join(tooling, 'node_modules/playwright/index.mjs'));
const out = path.join(repo, 'assets/releases');
const width = 1080, height = 1920, fps = 30, duration = 18;
await mkdir(out, { recursive: true });

let executablePath = process.env.BITCODE_CHROMIUM;
if (!executablePath && !existsSync(chromium.executablePath())) {
  const cache = path.join(os.homedir(), '.cache/ms-playwright');
  executablePath = existsSync(cache) ? readdirSync(cache).filter(name => /^chromium-\d+$/.test(name)).sort().reverse().flatMap(name => ['chrome-linux64/chrome', 'chrome-linux/chrome'].map(file => path.join(cache, name, file))).find(existsSync) : undefined;
}

const markup = `<!doctype html><html><head><meta charset="utf-8"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet"><style>
*{box-sizing:border-box}body{margin:0;width:${width}px;height:${height}px;background:#f7f7f4;color:#26251e;font-family:Inter,system-ui,sans-serif;overflow:hidden}main{height:100%;padding:138px 82px 92px;display:flex;flex-direction:column}.brand{font:600 30px/1 'JetBrains Mono',monospace;letter-spacing:-2px}.brand b{color:#f7931a}.rule{height:2px;background:#f7931a;width:0;margin:44px 0 52px}.lockup{display:flex;align-items:center;gap:28px;min-height:170px}.mark{width:112px;height:140px;overflow:visible}.piece{transform-box:fill-box;transform-origin:center;opacity:0}.wordmark{font-size:80px;font-weight:600;letter-spacing:-.06em;opacity:0;transform:translateX(-20px)}.upgrade{font:500 23px/1.4 'JetBrains Mono',monospace;letter-spacing:.13em;color:#5a5852;margin-top:30px;opacity:0;transform:translateY(12px)}.intro{font-size:48px;line-height:1.12;letter-spacing:-.055em;margin:104px 0 42px;max-width:13ch;opacity:0;transform:translateY(18px)}.items{display:grid;gap:17px}.item{border:1px solid #cfcdc4;background:#fff;border-radius:12px;padding:23px 25px;opacity:0;transform:translateY(16px)}.item-top{display:flex;justify-content:space-between;align-items:baseline;gap:18px}.index{font:500 16px/1 'JetBrains Mono',monospace;color:#f7931a}.title{font-size:26px;font-weight:600;letter-spacing:-.035em}.detail{margin:10px 0 0;color:#5a5852;font:18px/1.45 'JetBrains Mono',monospace;letter-spacing:-.04em}.footer{display:flex;justify-content:space-between;margin-top:auto;font:17px/1.4 'JetBrains Mono',monospace;color:#5a5852}.footer span:last-child{color:#f7931a}@keyframes drop{from{opacity:0;transform:translateY(-60px)}to{opacity:1;transform:translateY(0)}}@keyframes orange{0%,100%{fill:#f7931a}50%{fill:#0f0f0f}}@keyframes ink{0%,100%{fill:#0f0f0f}50%{fill:#f7931a}}@keyframes in{to{opacity:1;transform:none}}.play .piece{animation:drop .5s steps(6,end) calc(.12s + var(--i)*.18s) both,orange .3s step-end 1.7s 3}.play .piece.ink{animation-name:drop,ink}.play .wordmark{animation:in .55s cubic-bezier(.2,.8,.25,1) 2.55s forwards}.play .upgrade{animation:in .45s ease 3s forwards}.play .rule{animation:rule .65s ease 3.25s forwards}.play .intro{animation:in .6s ease 3.5s forwards}.play .item{animation:in .48s cubic-bezier(.2,.8,.25,1) calc(4.3s + var(--i)*1.65s) forwards}@keyframes rule{to{width:100%}}</style></head><body><main class="play"><div class="brand"><b>⚡</b> bitcode</div><div class="rule"></div><div class="lockup"><svg class="mark" viewBox="0 0 4 5" shape-rendering="crispEdges"><rect class="piece ink" style="--i:0" x="0" y="4" width="2" height="1" fill="#0f0f0f"/><rect class="piece" style="--i:1" x="0" y="0" width="1" height="4" fill="#f7931a"/><rect class="piece" style="--i:2" x="3" y="2" width="1" height="2" fill="#f7931a"/><rect class="piece" style="--i:3" x="1" y="2" width="1" height="1" fill="#f7931a"/><rect class="piece" style="--i:4" x="2" y="1" width="1" height="1" fill="#f7931a"/><rect class="piece" style="--i:5" x="1" y="0" width="2" height="1" fill="#f7931a"/></svg><div><div class="wordmark">bitcode</div><div class="upgrade">UPGRADE · V0.2</div></div></div><h1 class="intro">More of your stack, in one terminal.</h1><section class="items"><article class="item" style="--i:0"><div class="item-top"><span class="index">01 / CASHU</span><span class="title">Full e-cash flow</span></div><p class="detail">Mint, request, pay, melt, restore, proofs and pending tokens.</p></article><article class="item" style="--i:1"><div class="item-top"><span class="index">02 / LIGHTNING</span><span class="title">Node &amp; assets</span></div><p class="detail">Info, balance, channels, invoices, payments and Taproot Assets.</p></article><article class="item" style="--i:2"><div class="item-top"><span class="index">03 / LIQUID</span><span class="title">Chain visibility</span></div><p class="detail">Fees, mempool, blocks, transactions, addresses and assets.</p></article><article class="item" style="--i:3"><div class="item-top"><span class="index">04 / WAVELENGTH</span><span class="title">Read-only tools</span></div><p class="detail">Discover the configured wavecli schema directly from the agent.</p></article><article class="item" style="--i:4"><div class="item-top"><span class="index">05 / AGENT</span><span class="title">More control</span></div><p class="detail">Provider login, MCP SDK v2, managed processes and repo instructions.</p></article></section><div class="footer"><span>your code · your bitcoin</span><span>v0.2</span></div></main></body></html>`;

const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
try {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.setContent(markup, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  const file = path.join(out, 'bitcode-v0.2-upgrade-9x16.mp4');
  const encoder = spawn('ffmpeg', ['-y', '-v', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-i', 'pipe:0', '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '19', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', file], { stdio: ['pipe', 'ignore', 'pipe'] });
  let errors = ''; encoder.stderr.on('data', data => { errors += data; });
  const closed = once(encoder, 'close');
  for (let frame = 0; frame < duration * fps; frame++) {
    await page.evaluate(time => { document.getAnimations().forEach(animation => animation.currentTime = time * 1000); }, frame / fps);
    const png = await page.screenshot({ type: 'png' });
    if (!encoder.stdin.write(png)) await once(encoder.stdin, 'drain');
    if (frame === Math.floor(duration * fps * .78)) await writeFile(path.join(out, 'bitcode-v0.2-upgrade-poster.png'), png);
  }
  encoder.stdin.end();
  const [code] = await closed;
  if (code !== 0) throw new Error(`ffmpeg failed: ${errors}`);
  const poster = path.join(out, 'bitcode-v0.2-upgrade-poster.webp');
  await new Promise((resolve, reject) => { const task = spawn('ffmpeg', ['-y', '-v', 'error', '-i', path.join(out, 'bitcode-v0.2-upgrade-poster.png'), '-frames:v', '1', '-quality', '85', poster]); task.on('close', code => code === 0 ? resolve() : reject(new Error('poster encoding failed'))); });
  console.log(file);
} finally { await browser.close(); }

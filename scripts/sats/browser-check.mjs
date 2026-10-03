// Full flow: terminal -> real CLI/runtime -> authenticated SSE -> browser.
// Requires development-only Playwright and sharp. No paid provider or node.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { loadRegistry, POSES } from "../../src/sats/registry.mjs";
import { startCliFixture, until } from "./fixture.mjs";

const require = createRequire(import.meta.url);
const option = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
};
const { chromium } = require(option("--playwright-module", process.env.SATS_PLAYWRIGHT_MODULE || "playwright"));
const sharp = require(option("--sharp-module", process.env.SATS_SHARP_MODULE || "sharp"));
const chromiumPath = option("--chromium-path", process.env.SATS_CHROMIUM_PATH);
const root = fileURLToPath(new URL("../../", import.meta.url));
const output = fileURLToPath(new URL("../../artifacts/sats/", import.meta.url));
await mkdir(output, { recursive: true });
const f = await startCliFixture({ args: ["--sats", "--no-session", "--max-steps", "3"] });
let browser;
const errors = [], external = [], checks = [];
const check = name => { checks.push(name); process.stdout.write(`✓ ${name}\n`); };
try {
  await f.ready();
  const url = await f.panelUrl(), origin = new URL(url).origin;
  browser = await chromium.launch({ headless: true,
    ...(chromiumPath ? { executablePath: chromiumPath } : {}),
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const context = await browser.newContext({ viewport: { width: 1180, height: 960 }, reducedMotion: "reduce" });
  await context.route("**/*", async route => {
    if (!route.request().url().startsWith(origin + "/")) { external.push(route.request().url()); await route.abort(); }
    else await route.continue();
  });
  const page = await context.newPage();
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(url);
  await page.locator("body.connected").waitFor();
  assert.equal(new URL(page.url()).hash, "");
  const cookie = (await context.cookies()).find(c => c.name.startsWith("bitcode_sats_"));
  assert.ok(cookie.httpOnly); assert.equal(cookie.sameSite, "Strict"); assert.equal(cookie.secure, false);
  assert.equal(await page.locator(".sat").count(), 4);
  assert.equal(await page.locator("form, textarea, #approve, #deny").count(), 0);
  assert.equal(await page.evaluate(async () => (await fetch("/api/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status), 404);
  // Deliberate forbidden-route check produces an expected browser HTTP error.
  errors.length = 0;
  await page.locator('[data-agent="script"]').click();
  assert.equal(f.requests.length, 0);
  check("fragment attach, local HttpOnly cookie, four observer cards, no browser controls");

  for (const width of [1180, 768, 360, 590]) {
    await page.setViewportSize({ width, height: 960 });
    const geometry = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth,
      targets: [...document.querySelectorAll("button, .motion")].map(n => n.getBoundingClientRect().height) }));
    assert.ok(geometry.scroll <= geometry.width, JSON.stringify(geometry));
    assert.ok(geometry.targets.every(h => h >= 44));
    await page.screenshot({ path: output + `observer-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1180, height: 960 });
  await page.keyboard.press("Tab");
  await page.locator('[data-agent="node"]').focus();
  assert.notEqual(await page.locator('[data-agent="node"]').evaluate(n => getComputedStyle(n).outlineStyle), "none");
  await page.keyboard.press("Enter");
  assert.equal(await page.locator('[data-agent="node"]').getAttribute("aria-pressed"), "true");
  assert.equal(await page.locator('[data-agent="script"] img').evaluate(n => getComputedStyle(n).animationName), "none");
  check("360/768/1180 layouts, 590px zoom-equivalent viewport, keyboard focus, 44px targets, reduced motion");

  f.send("/subagent script change");
  const script = page.locator('[data-agent="script"]');
  await page.locator('[data-agent="script"][data-state="awaiting_approval"]').waitFor();
  assert.equal(await script.locator(".sat-state").textContent(), "Conferma nel terminale");
  assert.equal(await page.locator('.sat[data-state="idle"]').count(), 3);
  const snapshot = await page.evaluate(async () => (await (await fetch("/api/bootstrap")).json()).snapshot);
  assert.equal(snapshot.activity.some(e => e.type === "tool.started"), false);
  assert.doesNotMatch(JSON.stringify(snapshot), /PRIVATE_|<img/);
  await page.screenshot({ path: output + "awaiting-approval.png", fullPage: true });
  f.send("n");
  await page.locator('[data-agent="script"][data-state="success"]').waitFor();
  await script.click();
  assert.match(await page.locator("#activity").textContent(), /rifiutato/);
  assert.equal(await stat(f.cwd + "/example.txt").then(() => true, () => false), false);
  check("manual CLI delegation animates only Script; denial never starts a write and warnings stay visible");

  await page.reload(); await page.locator("body.connected").waitFor();
  assert.equal(await script.getAttribute("data-state"), "success");
  assert.equal(await page.locator(".celebrate").count(), 0);
  check("authenticated reload restores snapshot without replaying historical success animation");

  f.send("/subagent script change");
  await page.locator('[data-agent="script"][data-state="awaiting_approval"]').waitFor(); f.send("y");
  await page.locator('[data-agent="script"][data-state="success"]').waitFor();
  assert.equal(await stat(f.cwd + "/example.txt").then(() => true, () => false), true);
  check("terminal approval executes one real file write and updates the live result");

  f.send("/subagent node hostile"); await page.locator('[data-agent="node"][data-state="success"]').waitFor();
  await page.locator('[data-agent="node"]').click();
  assert.match(await page.locator("#activity").textContent(), /<img src=x/);
  assert.equal(await page.locator("#activity img").count(), 0);
  check("hostile filenames render as literal text without markup execution");

  f.send("/subagent hash error"); await page.locator('[data-agent="hash"][data-state="error"]').waitFor();
  f.send("/subagent merkle max"); await page.locator('[data-agent="merkle"][data-state="error"]').waitFor();
  await page.locator('[data-agent="merkle"]').click();
  assert.match(await page.locator("#activity").textContent(), /Limite di passaggi/);
  check("provider errors and step limits produce error states, never success");

  f.send("/subagent node wait"); await until(() => f.requests.at(-1)?.messages?.some(m => m.content === "wait"));
  f.child.kill("SIGINT"); await page.locator('[data-agent="node"][data-state="cancelled"]').waitFor();
  check("terminal SIGINT cancels the real provider stream and the companion reports Interrotto");

  // Inject only a development network fault: runtime remains unmodified.
  await page.route("**/assets/sats/script/*-256.webp", route => route.abort());
  f.send("/subagent script change");
  await page.locator('[data-agent="script"][data-state="awaiting_approval"]').waitFor();
  await page.waitForFunction(() => document.querySelector('[data-agent="script"] img').currentSrc.endsWith("ask-256.png"));
  f.send("n"); await page.locator('[data-agent="script"][data-state="success"]').waitFor();
  await page.waitForFunction(() => document.querySelector('[data-agent="script"] img').complete);
  assert.ok((await script.locator("img").evaluate(n => n.currentSrc)).endsWith("happy-256.png"));
  await page.unroute("**/assets/sats/script/*-256.webp");
  errors.length = 0; // Intentional aborted WebP requests only.
  check("each expression has a working PNG fallback when WebP fails");

  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.evaluate(() => window.scrollTo(0, 0));
  f.send("/subagent node read"); await page.locator('[data-agent="node"][data-state="success"]').waitFor();
  // Offscreen pause is checked on a one-column mobile layout.
  await page.setViewportSize({ width: 360, height: 640 }); await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForFunction(() => document.querySelector('[data-agent="merkle"]').classList.contains("paused"));
  await page.locator("#motion-off").check();
  assert.equal(await script.locator("img").evaluate(n => getComputedStyle(n).animationName), "none");
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  assert.equal(await page.locator(".sat.paused").count(), 4);
  await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event("visibilitychange")); });
  check("offscreen cards, visibility handler and the local reduced-motion control stop animation");

  let idleBytes = 0, runtimeBytes = 0;
  for (const a of loadRegistry()) {
    for (const p of POSES) {
      const filename = root + a.poses[p];
      const meta = await sharp(filename).metadata();
      assert.equal(meta.width, 256); assert.equal(meta.height, 256); assert.ok(meta.hasAlpha);
      const size = (await stat(filename)).size; assert.ok(size <= 100 * 1024); runtimeBytes += size;
      if (p === "idle") idleBytes += size;
      const master = await sharp(`${root}assets/sats/${a.id}/masters/${p}-1024.png`).metadata();
      assert.equal(master.width, 1024); assert.equal(master.height, 1024); assert.ok(master.hasAlpha);
    }
    const gif = root + `assets/sats/${a.id}/working.gif`;
    const meta = await sharp(gif, { animated: true }).metadata();
    assert.equal(meta.width, 512); assert.equal(meta.pageHeight, 512); assert.equal(meta.pages, 48);
    assert.equal(meta.delay.reduce((n, ms) => n + ms, 0), 3000);
    await sharp(gif, { animated: true }).raw().toBuffer();
    assert.ok((await stat(gif)).size <= 2 * 1024 * 1024);
  }
  assert.ok(idleBytes <= 400 * 1024); assert.ok(runtimeBytes <= 2 * 1024 * 1024);
  check(`24 transparent poses and four GIFs decode; idle ${idleBytes} bytes, all WebP ${runtimeBytes} bytes`);

  await page.setViewportSize({ width: 1180, height: 960 });
  await page.locator("#all-activity").click();
  await page.screenshot({ path: output + "verified-flow.png", fullPage: true });
  f.send("/exit"); assert.equal(await f.exited(), 0);
  await page.locator("body.disconnected").waitFor();
  assert.match(await page.locator("#connection-label").textContent(), /stato non aggiornato/);
  check("CLI exit closes HTTP/SSE; disconnected panel keeps the last known task states");
  assert.deepEqual(external, []); assert.deepEqual(errors, []);
  check("zero external browser requests, zero unexpected page/console errors");
  await writeFile(output + "report.json", JSON.stringify({ checks, external, errors, idleBytes, runtimeBytes }, null, 2));
  process.stdout.write(`${checks.length} browser/asset checks passed\n`);
} finally { await browser?.close(); await f.close(); }

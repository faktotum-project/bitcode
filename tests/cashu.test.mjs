import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { cashuWallet } from "../src/cashu/wallet.mjs";

function fixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "bc-cashu-"));
  const binary = path.join(dir, "fake cdk");
  writeFileSync(binary, `#!${process.execPath}\nprocess.stdout.write(JSON.stringify(process.argv.slice(2)));\n`, { mode: 0o700 });
  const ctx = { cliPath: binary, workDir: path.join(dir, "wallet with spaces"), unit: "sat", mintUrl: "https://mint.example" };
  return { dir, ctx, wallet: cashuWallet(ctx) };
}
test("Cashu arguments match the vendored CDK CLI and preserve spaces", async () => {
  const { ctx, wallet } = fixture();
  const mint = JSON.parse(await wallet.mint(100));
  assert.ok(mint.includes(ctx.workDir)); assert.deepEqual(mint.slice(-6), ["mint", "--wait-duration", "1", "--", ctx.mintUrl, "100"]);
  assert.deepEqual(JSON.parse(await wallet.melt("ln_invoice")).slice(-5), ["melt", "--mint-url", ctx.mintUrl, "--invoice", "ln_invoice"]);
  assert.deepEqual(JSON.parse(await wallet.restore()).slice(-3), ["restore", "--", ctx.mintUrl]);
  const request = JSON.parse(await wallet.createRequest(10, "a description"));
  assert.ok(request.includes("--transport")); assert.ok(request.includes("none")); assert.equal(request.at(-1), "a description");
});
test("Cashu token and description values are never interpreted as shell code", async () => {
  const { dir, wallet } = fixture(); const marker = path.join(dir, "must-not-exist");
  const token = `cashuA; touch ${marker}`;
  assert.equal(JSON.parse(await wallet.decodeToken(token)).at(-1), token);
  assert.equal(existsSync(marker), false);
});

test("Cashu proof listing redacts bearer secrets in table rows", async () => {
  const { ctx, wallet } = fixture();
  writeFileSync(ctx.cliPath, `#!${process.execPath}\nconsole.log('| 10 | sat | unspent | bearer-secret | true');\n`, { mode: 0o700 });
  const result = await wallet.listProofs();
  assert.match(result, /10.*sat.*unspent/); assert.match(result, /redacted/); assert.doesNotMatch(result, /bearer-secret/);
});

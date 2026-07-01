#!/usr/bin/env node
// faktotum — minimal multi-provider terminal coding agent.
// Entry point: delegates to the CLI.
import { main } from "./src/cli.mjs";

main(process.argv.slice(2)).catch((err) => {
  process.stderr.write(`faktotum: ${err?.stack || err?.message || String(err)}\n`);
  process.exit(1);
});

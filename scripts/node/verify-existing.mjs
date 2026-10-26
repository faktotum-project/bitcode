// Read-only host verification. Registration exists only in a disposable temporary home.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseNodeArgs } from '../../src/node/cli.mjs';
import { createNodeService } from '../../src/node/service.mjs';
const { input } = parseNodeArgs(['connect', ...process.argv.slice(2)]);
if (!input.datadir) throw Error('Provide --datadir with the existing absolute data directory');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'bitcode-existing-smoke-'));
try {
  const service = createNodeService({ home });
  const instance = await service.connect(input, { confirmed: true });
  const status = await service.status(instance.id);
  console.log(JSON.stringify({ mode: instance.mode, network: instance.network, core: status.core,
    indexes: status.indexes, explorer: status.explorerStatus, ready: status.ready, error: status.error }, null, 2));
  if (!status.ready) process.exitCode = 1;
} finally { fs.rmSync(home, { recursive: true, force: true }); }

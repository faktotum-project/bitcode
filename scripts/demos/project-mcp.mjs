// Small, auditable stdio MCP server. Exposes one real file from the demo fixture.
import readline from 'node:readline';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(process.argv[2]);
const send = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
const input = readline.createInterface({ input: process.stdin });
for await (const line of input) {
  let req;
  try {
    req = JSON.parse(line);
    if (req.id == null) continue;
    if (req.method === 'initialize') send(req.id, { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'bitcode-demo-project', version: '1.0.0' } });
    else if (req.method === 'ping') send(req.id, {});
    else if (req.method === 'tools/list') send(req.id, { tools: [{ name: 'release_requirements', description: 'Read the actual fee estimator release requirements from RELEASE.md.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true } }] });
    else if (req.method === 'tools/call' && req.params?.name === 'release_requirements') send(req.id, { content: [{ type: 'text', text: await readFile(path.join(root, 'RELEASE.md'), 'utf8') }] });
    else process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: req.id, error: { code: -32601, message: 'Method or tool not found' } }) + '\n');
  } catch (error) {
    if (req?.id != null) send(req.id, { isError: true, content: [{ type: 'text', text: error.message }] });
  }
}

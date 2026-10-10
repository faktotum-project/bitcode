import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, sessionIn, until, config } from './helpers.mjs';

const USDT = 'rgb:lX~ToKsO-Iup7dJ5-UM794sA-9WD21ge-VHYzBGb-E9PA_h0';
const INVOICE = 'rgb:~/~/~/sbc:utxob:_pnvbOef-ljmgfSr-i0bQvnR-qyC1g6i-IU1Lr9O-DKfmoTF-Cm5ty?expiry=1791664659&endpoints=rpcs://proxy.iriswallet.com/0.2/json-rpc';
const rgbConfig = { ...config, mcp: { kaleido: { command: '/bin/false', env: { RLN_NODE_URL: 'http://127.0.0.1:3001' } } } };

function fakeNode(network) {
  const calls = [];
  const tool = (name, mutating, result) => ({ name: `mcp_kaleido_${name}`, mcpServer: 'kaleido', mutating, description: name,
    parameters: { type: 'object', properties: {} }, run: async args => { calls.push([name, args]); return JSON.stringify(result); } });
  const tools = [
    tool('rln_list_assets', false, [{ asset_id: USDT, ticker: 'USDT', precision: 6, balance: { settled: 93000000, future: 93000000, spendable: 93000000 } }]),
    tool('rln_send_asset', true, { sent: true, txid: 'abc' }),
  ];
  return {
    calls,
    rgbFetch: async () => ({ ok: true, json: async () => ({ network, height: 3493975 }) }),
    rgbMcpTools: async () => ({ tools, servers: [{ name: 'kaleido', ok: true }] }),
  };
}

test('rgb profile is refused when the node reports mainnet', async () => {
  const node = fakeNode('Bitcoin');
  const { c, root } = setup({ config: rgbConfig, ...node });
  try {
    const { s } = await sessionIn(c, root);
    await assert.rejects(c.invoke('chat.submit', { sessionId: s.sessionId, text: '/profile rgb' }, 'ui:1'), { code: 'POLICY_DENIED' });
  } finally { c.shutdown(); }
});

test('rgb session: worker gets only node tools, reads run freely, sends need a payment approval with a readback', async () => {
  const node = fakeNode('SignetCustom');
  const { c, root, events, workers } = setup({ config: rgbConfig, ...node });
  try {
    const { s } = await sessionIn(c, root);
    const switched = await c.invoke('chat.submit', { sessionId: s.sessionId, text: '/profile rgb' }, 'ui:1');
    assert.equal(switched.result.profile, 'rgb'); assert.equal(switched.result.network, 'signet');
    await c.invoke('chat.submit', { sessionId: s.sessionId, text: 'invia 2 USDT' }, 'ui:1');
    await until(() => workers.length);
    const start = workers[0].sent.find(m => m.type === 'start');
    assert.equal(start.profile, 'rgb');
    assert.deepEqual(start.rgbTools.map(t => [t.name, t.financial]), [['mcp_kaleido_rln_list_assets', false], ['mcp_kaleido_rln_send_asset', true]]);

    const listed = await workers[0].request('rgb.call', { name: 'mcp_kaleido_rln_list_assets', args: {} });
    assert.equal(JSON.parse(listed.result)[0].balance_display.spendable, '93 USDT');
    assert.equal(events.filter(([ch]) => ch === 'approval').length, 0);

    // Wait for exactly n pending requests and return them.
    const poll = async n => {
      for (let i = 0; i < 200; i++) { const list = await c.invoke('approval.list', {}); if (list.length === n) return list; await new Promise(r => setTimeout(r, 5)); }
      throw new Error(`expected ${n} pending approvals`);
    };
    const refused = await workers[0].request('rgb.call', { name: 'mcp_kaleido_rln_send_asset', args: { asset_id: 'rgb:invented', amount: 2, recipient_id: INVOICE } });
    assert.match(refused.error, /INVALID_PARAMS: asset rgb:invented is not held/);
    assert.equal((await c.invoke('approval.list', {})).length, 0);
    const denied = workers[0].request('rgb.call', { name: 'mcp_kaleido_rln_send_asset', args: { asset_id: USDT, amount: 2, recipient_id: INVOICE } });
    const [req] = await poll(1);
    assert.equal(req.kind, 'payment');
    assert.deepEqual(req.subject.send, { amount: 2, unit: 'USDT', assetId: USDT, recipientId: 'sbc:utxob:_pnvbOef-ljmgfSr-i0bQvnR-qyC1g6i-IU1Lr9O-DKfmoTF-Cm5ty',
      endpoints: ['rpcs://proxy.iriswallet.com/0.2/json-rpc'] });
    assert.match(req.subject.readback, /^Send 2 USDT \(rgb:lX~ToKsO-Iup…9PA_h0\) to sbc:utxob:_pnvbO…-Cm5ty on signet/);
    await c.invoke('approval.resolve', { requestId: req.id, digest: req.digest, sessionId: s.sessionId, decision: 'deny' }, 'ui:1');
    assert.match((await denied).error, /POLICY_DENIED/);
    assert.equal(node.calls.filter(([n]) => n === 'rln_send_asset').length, 0);

    const approved = workers[0].request('rgb.call', { name: 'mcp_kaleido_rln_send_asset', args: { asset_id: USDT, amount: 2, recipient_id: INVOICE } });
    const [req2] = await poll(1);
    await c.invoke('approval.resolve', { requestId: req2.id, digest: req2.digest, sessionId: s.sessionId, decision: 'approve' }, 'ui:1');
    assert.equal(JSON.parse((await approved).result).sent, true);
    assert.deepEqual(node.calls.at(-1), ['rln_send_asset', { asset_id: USDT, amount: 2,
      recipient_id: 'sbc:utxob:_pnvbOef-ljmgfSr-i0bQvnR-qyC1g6i-IU1Lr9O-DKfmoTF-Cm5ty', transport_endpoints: ['rpcs://proxy.iriswallet.com/0.2/json-rpc'] }]);
  } finally { c.shutdown(); }
});

test('rgb tools are refused outside the rgb profile', async () => {
  const node = fakeNode('SignetCustom');
  const { c, root, workers } = setup({ config: rgbConfig, ...node });
  try {
    const { s } = await sessionIn(c, root);
    await c.invoke('chat.submit', { sessionId: s.sessionId, text: 'ciao' }, 'ui:1');
    await until(() => workers.length);
    assert.match((await workers[0].request('rgb.call', { name: 'mcp_kaleido_rln_list_assets', args: {} })).error, /FORBIDDEN/);
  } finally { c.shutdown(); }
});

# bitcode × RGB (KaleidoSwap kit)

bitcode operates an RGB Lightning Node (RLN) through `kaleido-mcp`, pinned here.
The node runs in Docker via `kaleido-cli`; bitcode talks to it only through MCP,
so no native RGB binding is loaded in Node or Electron.

Test funds only: the node runs on Mutinynet (signet).

## Node

```sh
curl -fsSL https://raw.githubusercontent.com/kaleidoswap/kaleido-cli/master/install.sh | sh
kaleido --agent setup --mode local --defaults   # Docker node on signet
kaleido node init                                # in your own terminal: password + mnemonic
kaleido node unlock                              # after every restart; Signet defaults, Block sync
```

The generated `~/.kaleido/default/docker-compose.yml` starts the node with
`--disable-authentication` and publishes the REST API on all interfaces. Bind it
to loopback (`127.0.0.1:3001:3001`) and run `docker compose up -d` there.
Re-running `kaleido setup` may regenerate the file.

Fund it from https://faucet.mutinynet.com, then create colorable UTXOs before
receiving RGB assets (https://faucet.mutinynet.kaleidoswap.com).

## bitcode

```sh
npm --prefix integrations/kaleido ci
```

Add to `~/.bitcode/config.json` (absolute path to the pinned binary):

```json
{
  "mcp": {
    "kaleido": {
      "command": "/absolute/path/bitcode/integrations/kaleido/node_modules/.bin/kaleido-mcp",
      "env": { "KALEIDO_NETWORK": "signet", "RLN_NODE_URL": "http://localhost:3001" },
      "timeoutMs": 60000,
      "allowedTools": ["rln_get_balances", "rln_list_assets", "rln_create_rgb_invoice", "rln_send_asset", "..."],
      "readOnlyTools": ["rln_get_balances", "rln_list_assets", "..."],
      "financialTools": ["rln_send_asset", "rln_send_btc", "rln_pay_invoice", "rln_create_utxos", "kaleidoswap_lsp_create_order"]
    }
  }
}
```

`readOnlyTools` run without approval; `financialTools` use bitcode's payment
gate (always confirmed; one-shot mode needs `--allow-payments`); every other
allowed tool asks for normal approval. `kaleido-mcp` exposes each RLN tool twice
(`wdk_*` and `rln_*`); allow one family only.

Run with the RGB profile, which exposes only these tools and a short RGB prompt,
and the local QVAC model (`integrations/qvac`, alias `bitcode-rgb-4b`, Qwen 3.5 4B):

```sh
npm --prefix integrations/qvac start
node bitcode.mjs -m qvac/bitcode-rgb-4b --profile rgb
```

In the RGB profile every tool that changes node state (invoices, issuing,
UTXOs, sends) goes through the payment gate: interactive sessions ask each time,
one-shot runs refuse them unless `--allow-payments` is passed.

Model notes, from testing on this node:

- Qwen 3.5 2B (`bitcode-rgb`) keeps calling tools after it has an answer and,
  when refused, tries other tools for the same goal. 4B stops and explains.
- Set `reasoning_budget` (QVAC model config, here 512); the default is unbounded.
- The QVAC HTTP server occasionally accepts a streamed request and never answers.
  Set `providers.qvac.idleTimeoutMs` (e.g. 30000) in `~/.bitcode/config.json`
  so bitcode abandons and retries a silent stream. Warm a new model with a plain
  request first: its download counts as silence.
- Keep `providers.qvac.maxOutputTokens` around 1536.

`kaleido-mcp` 0.5.0 passes the invoice `amount` to the node unconverted although
it documents display units: decimals fail to deserialize and integers are read
as base units. Prefer any-amount invoices until this is fixed upstream.

`config.rgb.mcpServer` selects another MCP server name (default `kaleido`).

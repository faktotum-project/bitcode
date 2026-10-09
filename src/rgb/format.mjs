// RGB nodes report balances in raw base units next to the asset's precision.
// Small models convert them wrongly (100000000 at precision 6 became "100.000
// USDT" instead of 100), so bitcode adds exact display values itself.

const BALANCE_KEYS = ["settled", "future", "spendable", "offchain_outbound", "offchain_inbound"];

// Exact integer division by 10^precision, without floating point.
export function formatUnits(raw, precision) {
  if (!Number.isSafeInteger(precision) || precision < 0 || precision > 18) return null;
  let digits;
  try { digits = BigInt(raw); } catch { return null; }
  const negative = digits < 0n;
  const text = (negative ? -digits : digits).toString().padStart(precision + 1, "0");
  const whole = text.slice(0, text.length - precision), fraction = text.slice(text.length - precision).replace(/0+$/, "");
  return (negative ? "-" : "") + whole + (fraction ? "." + fraction : "");
}

function display(balance, precision, ticker) {
  const out = {};
  for (const key of BALANCE_KEYS) {
    if (!(key in balance)) continue;
    const value = formatUnits(balance[key], precision);
    if (value != null) out[key] = ticker ? `${value} ${ticker}` : value;
  }
  return out;
}

// rgb:~/~/~/<recipient>?expiry=...&endpoints=a,b — the recipient is a blinded
// UTXO (utxob) or a witness output (wvout) on some network prefix.
const INVOICE = /rgb:[^\s?]*?\/((?:[a-z]+):(?:utxob|wvout):[A-Za-z0-9_~-]+)(?:\?([^\s]*))?/;

export function parseRgbInvoice(text) {
  const match = typeof text === "string" && text.match(INVOICE);
  if (!match) return null;
  const endpoints = new URLSearchParams(match[2] || "").get("endpoints");
  return { recipient_id: match[1], transport_endpoints: endpoints ? endpoints.split(",").filter(Boolean) : [] };
}

// Small models copy the wrong field out of an invoice (an endpoint ended up as
// recipient_id). For sends, take recipient and endpoints from the invoice text
// itself, wherever the model put it, and refuse assets the node never listed.
export function prepareRgbSend(args, knownAssets) {
  const invoice = Object.values(args || {}).map(parseRgbInvoice).find(Boolean)
    || (/^[a-z]+:(utxob|wvout):/.test(args?.recipient_id || "") ? { recipient_id: args.recipient_id, transport_endpoints: args.transport_endpoints || [] } : null);
  if (!invoice) throw new Error("pass the receiver's full RGB invoice (rgb:...) as recipient_id");
  if (invoice.recipient_id.includes(":wvout:")) throw new Error("witness (wvout) invoices are not supported by this node tool; ask the receiver for a blinded (utxob) invoice");
  if (knownAssets && !knownAssets.has(args.asset_id)) throw new Error(`asset ${args.asset_id} is not held by this node; list assets first and use its full asset ID`);
  const { invoice: _, ...rest } = args;
  return { ...rest, recipient_id: invoice.recipient_id, ...(invoice.transport_endpoints.length ? { transport_endpoints: invoice.transport_endpoints } : {}) };
}

// Remembers precision per asset so a later balance lookup by ID or ticker,
// which the node returns without metadata, can still be converted.
export function createRgbFormatter() {
  const assets = new Map();
  const learn = node => {
    if (Array.isArray(node)) return node.forEach(learn);
    if (!node || typeof node !== "object") return;
    if (typeof node.asset_id === "string" && Number.isSafeInteger(node.precision)) {
      const meta = { precision: node.precision, ticker: node.ticker || null };
      assets.set(node.asset_id, meta);
      if (meta.ticker) assets.set(meta.ticker, meta);
    }
    Object.values(node).forEach(learn);
  };
  const annotate = (node, args) => {
    if (Array.isArray(node)) return node.map(item => annotate(item, args));
    if (!node || typeof node !== "object") return node;
    const copy = Object.fromEntries(Object.entries(node).map(([k, v]) => [k, annotate(v, args)]));
    const meta = Number.isSafeInteger(node.precision) ? { precision: node.precision, ticker: node.ticker || null } : null;
    if (meta && node.balance && typeof node.balance === "object") copy.balance_display = display(node.balance, meta.precision, meta.ticker);
    // A bare balance object (asset balance lookup) takes its metadata from the request.
    const lookup = !meta && !node.asset_id && args?.asset_id && assets.get(args.asset_id);
    if (lookup && BALANCE_KEYS.some(key => key in node)) copy.balance_display = display(node, lookup.precision, lookup.ticker);
    return copy;
  };
  function format(result, args) {
    if (typeof result !== "string" || result.startsWith("ERROR:")) return result;
    let data;
    try { data = JSON.parse(result); } catch { return result; }
    learn(data);
    return JSON.stringify(annotate(data, args), null, 2);
  }
  format.knownAssetIds = () => new Set([...assets.keys()].filter(key => key.startsWith("rgb:")));
  format.asset = id => assets.get(id) || null;
  return format;
}

// One deterministic line for the approval prompt, built from the arguments that
// will actually reach the node, never from model-written prose.
export function describeRgbSend(args, asset, network = "signet") {
  const short = id => id.length > 24 ? `${id.slice(0, 16)}…${id.slice(-6)}` : id;
  const unit = asset?.ticker || "units";
  return `Send ${args.amount} ${unit} (${short(args.asset_id || "?")}) to ${short(args.recipient_id || "?")} on ${network}`
    + (args.transport_endpoints?.length ? ` via ${args.transport_endpoints.join(", ")}` : "");
}

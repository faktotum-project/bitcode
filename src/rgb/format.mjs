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
  return function format(result, args) {
    if (typeof result !== "string" || result.startsWith("ERROR:")) return result;
    let data;
    try { data = JSON.parse(result); } catch { return result; }
    learn(data);
    return JSON.stringify(annotate(data, args), null, 2);
  };
}

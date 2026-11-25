// Price history from Yahoo Finance's public chart endpoint (no key). Unofficial and rate-limited:
// apps should cache results and show a clear error when it fails.

const RANGE = { "1d": "10y", "1h": "730d" };

/** @returns {Promise<{date:string,open:number,high:number,low:number,close:number,volume:number}[]>} */
export async function fetchYahooBars(symbol, timeframe = "1d", fetchImpl = fetch) {
  const interval = timeframe === "1h" ? "1h" : "1d";
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${RANGE[interval]}&interval=${interval}&includePrePost=false`;
  const res = await fetchImpl(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; QuantKit/1.0)" } });
  if (!res.ok) throw new Error(res.status === 404 ? `No price data for ${symbol}.` : `Price data service returned ${res.status}.`);
  const json = await res.json();
  const r = json?.chart?.result?.[0];
  if (!r?.timestamp) throw new Error(json?.chart?.error?.description || `No price data for ${symbol}.`);
  const q = r.indicators.quote[0];
  const bars = [];
  r.timestamp.forEach((ts, i) => {
    const b = { open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i], volume: q.volume?.[i] ?? 0 };
    if (![b.open, b.high, b.low, b.close].every(Number.isFinite)) return;
    const d = new Date(ts * 1000).toISOString();
    bars.push({ date: interval === "1d" ? d.slice(0, 10) : d.slice(0, 16).replace("T", " "), ...b });
  });
  return bars;
}

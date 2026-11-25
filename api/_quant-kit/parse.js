// Turn a plain-English idea into a spec without AI (keyword matching).
// Used when no AI key is set, and as a sanity fallback when the AI answer fails validation.

import { fromTemplate } from "./templates.js";

const SYMBOLS = [
  [/\b(gold|xau)/, "GC=F", "futures"], [/\b(silver|xag)/, "SI=F", "futures"],
  [/\b(nq|nasdaq|qqq)\b/, "NQ=F", "futures"], [/\b(es|s&p|spx|spy|sp500)\b/, "ES=F", "futures"],
  [/\b(oil|crude|wti|cl)\b/, "CL=F", "futures"],
  [/\b(btc|bitcoin)/, "BTC-USD", "crypto"], [/\b(eth|ethereum)/, "ETH-USD", "crypto"], [/\bsol(ana)?\b/, "SOL-USD", "crypto"],
  [/\beur\s*\/?\s*usd|\beuro\b/, "EURUSD=X", "forex"], [/\bgbp\s*\/?\s*usd|\bcable\b|\bpound\b/, "GBPUSD=X", "forex"],
  [/\busd\s*\/?\s*jpy|\byen\b/, "JPY=X", "forex"],
];

export function detectSymbol(text) {
  const t = ` ${text.toLowerCase()} `;
  for (const [re, symbol, market] of SYMBOLS) if (re.test(t)) return { symbol, market };
  const ticker = text.match(/\$([A-Z]{1,5})\b/) || text.match(/\b([A-Z]{2,5})\b(?=\s+(?:stock|shares))/);
  return ticker ? { symbol: ticker[1], market: "stock" } : null;
}

/** Best-effort spec from free text. Always returns a valid-looking spec plus notes on what was assumed. */
export function parseIdea(text, defaults = {}) {
  const t = String(text || "").toLowerCase();
  const notes = [];
  let id;
  if (/turtle|donchian|breakout|break out|new high|range/.test(t)) id = "donchianBreakout";
  else if (/bollinger|band/.test(t)) id = "bollingerReversion";
  else if (/rsi\s*\(?2|dip|oversold|pullback.*rsi|mean revers|fade|revert/.test(t)) id = /bollinger|band/.test(t) ? "bollingerReversion" : "rsi2";
  else if (/supertrend/.test(t)) id = "supertrend";
  else if (/macd|momentum/.test(t)) id = "macdAdx";
  else if (/cross/.test(t)) id = "emaCross";
  else id = "trendPullback";
  const spec = fromTemplate(id);

  const cross = t.match(/(\d+)\s*(?:ema|sma|day|period|-day)?[^.]{0,30}?cross(?:es)?\s*(?:above|over)\s*(?:the\s*)?(\d+)/);
  if (cross) {
    const [fast, slow] = [Number(cross[1]), Number(cross[2])];
    const kind = /sma|simple/.test(t) ? "sma" : "ema";
    spec.entry = [{ left: { ind: kind, period: fast }, op: "crossesAbove", right: { ind: kind, period: slow } }];
    spec.exit = [{ left: { ind: kind, period: fast }, op: "crossesBelow", right: { ind: kind, period: slow } }];
    spec.name = `${kind.toUpperCase()} ${fast}/${slow} cross`;
  }
  const above = t.match(/above (?:the )?(\d+)[\s-]*(ema|sma|day)/);
  if (above && !cross) {
    const kind = above[2] === "sma" || above[2] === "day" ? "sma" : "ema";
    const filter = { left: { ind: "close" }, op: ">", right: { ind: kind, period: Number(above[1]) } };
    spec.entry = [filter, ...spec.entry.filter((r) => !(r.left.ind === "close" && ["ema", "sma"].includes(r.right.ind)))];
  }

  const sym = detectSymbol(String(text || ""));
  spec.symbol = defaults.symbol || sym?.symbol || "SPY";
  spec.market = defaults.market || sym?.market || "stock";
  if (!sym && !defaults.symbol) notes.push("No market named, so this tests SPY (S&P 500 ETF).");

  spec.timeframe = /\b(1|one)[\s-]*h(ou)?r?\b|hourly|intraday|scalp|\d+[\s-]*min/.test(t) ? "1h" : "1d";
  if (/\d+[\s-]*min|scalp/.test(t)) notes.push("Minute charts aren't available for backtests, so this uses hourly bars.");
  if (/\b[2-8][\s-]*h(ou)?r?\b|[2-8][\s-]*hour/.test(t)) notes.push("Only daily and hourly bars can be backtested, so this uses daily bars.");
  if (/\bshort\b|sell short|go short/.test(t) && !/short[- ]term/.test(t)) spec.side = "short";

  const risk = t.match(/risk\s*(?:of\s*)?(\d+(?:\.\d+)?)\s*%/) || t.match(/(\d+(?:\.\d+)?)\s*%\s*(?:risk|per trade)/);
  if (risk) spec.riskPct = Number(risk[1]);
  const rr = t.match(/(\d+(?:\.\d+)?)\s*r\b/) || t.match(/(\d+(?:\.\d+)?)\s*(?:to|:)\s*1\s*(?:reward|r\/r|rr)?/);
  if (rr) {
    spec.stop = spec.stop || { type: "atr", mult: 1.5, period: 14 };
    spec.target = { type: "r", r: Number(rr[1]) };
  }
  const stopPct = t.match(/stop(?:\s*loss)?\s*(?:at|of)?\s*(\d+(?:\.\d+)?)\s*%/);
  if (stopPct) spec.stop = { type: "percent", pct: Number(stopPct[1]) };
  const atrMult = t.match(/(\d+(?:\.\d+)?)\s*(?:x|×)?\s*atr/);
  if (atrMult && !stopPct) spec.stop = { type: "atr", mult: Number(atrMult[1]), period: 14 };
  if (/trail/.test(t) && spec.stop?.type === "atr") spec.trail = true;
  if (spec.target?.type === "r" && !spec.stop) spec.target = null;

  notes.push(`Built from the "${spec.name}" pattern. Check the rules below match what you meant.`);
  return { spec, notes };
}

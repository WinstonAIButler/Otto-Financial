// Strategy spec: a small JSON language for trading rules that people (or an AI) can write
// and the engine can test. normalizeSpec() is the single gate: it fills defaults, clamps
// numbers to sane ranges and rejects anything it doesn't understand.

import * as I from "./indicators.js";

export const INDICATORS = {
  close: { label: "Close", args: [] },
  open: { label: "Open", args: [] },
  high: { label: "High", args: [] },
  low: { label: "Low", args: [] },
  volume: { label: "Volume", args: [] },
  sma: { label: "SMA", args: ["period"], defaults: { period: 50 } },
  ema: { label: "EMA", args: ["period"], defaults: { period: 20 } },
  rsi: { label: "RSI", args: ["period"], defaults: { period: 14 } },
  atr: { label: "ATR", args: ["period"], defaults: { period: 14 } },
  adx: { label: "ADX", args: ["period"], defaults: { period: 14 } },
  roc: { label: "Change %", args: ["period"], defaults: { period: 10 } },
  bbUpper: { label: "Upper Bollinger", args: ["period", "mult"], defaults: { period: 20, mult: 2 } },
  bbMid: { label: "Middle Bollinger", args: ["period", "mult"], defaults: { period: 20, mult: 2 } },
  bbLower: { label: "Lower Bollinger", args: ["period", "mult"], defaults: { period: 20, mult: 2 } },
  donchianHigh: { label: "Prior high", args: ["period"], defaults: { period: 20 } },
  donchianLow: { label: "Prior low", args: ["period"], defaults: { period: 20 } },
  macd: { label: "MACD", args: [] },
  macdSignal: { label: "MACD signal", args: [] },
  macdHist: { label: "MACD histogram", args: [] },
  supertrend: { label: "Supertrend", args: ["period", "mult"], defaults: { period: 10, mult: 3 } },
  vwap: { label: "VWAP", args: [] },
  volumeSma: { label: "Average volume", args: ["period"], defaults: { period: 20 } },
};

export const OPS = {
  ">": "is above", "<": "is below", ">=": "is at or above", "<=": "is at or below",
  crossesAbove: "crosses above", crossesBelow: "crosses below",
};

export const MARKETS = ["stock", "crypto", "forex", "futures"];
export const TIMEFRAMES = ["1d", "1h"];

const DEFAULT_COST_BPS = { stock: 3, crypto: 10, forex: 1.5, futures: 1.5 };
const DEFAULT_MAX_LEVERAGE = { stock: 1, crypto: 1, forex: 10, futures: 10 };

const clamp = (x, lo, hi, d) => (Number.isFinite(Number(x)) ? Math.min(hi, Math.max(lo, Number(x))) : d);
const intIn = (x, lo, hi, d) => Math.round(clamp(x, lo, hi, d));

function normOperand(o, errors, where) {
  if (typeof o === "number") return { value: o };
  if (!o || typeof o !== "object") { errors.push(`${where}: missing value`); return null; }
  if ("value" in o && !("ind" in o)) {
    const v = Number(o.value);
    if (!Number.isFinite(v)) { errors.push(`${where}: value must be a number`); return null; }
    return { value: v };
  }
  const meta = INDICATORS[o.ind];
  if (!meta) { errors.push(`${where}: unknown indicator "${o.ind}"`); return null; }
  const out = { ind: o.ind };
  if (meta.args.includes("period")) out.period = intIn(o.period, 1, 400, meta.defaults.period);
  if (meta.args.includes("mult")) out.mult = clamp(o.mult, 0.1, 10, meta.defaults.mult);
  const off = intIn(o.offset, 0, 50, 0);
  if (off) out.offset = off;
  if (o.times !== undefined && Number(o.times) !== 1) out.times = clamp(o.times, 0.01, 100, 1);
  return out;
}

function normConditions(list, errors, where) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 8).map((c, i) => {
    const w = `${where} rule ${i + 1}`;
    if (!c || !OPS[c.op]) { errors.push(`${w}: unknown comparison "${c && c.op}"`); return null; }
    const left = normOperand(c.left, errors, w), right = normOperand(c.right, errors, w);
    return left && right ? { left, op: c.op, right } : null;
  }).filter(Boolean);
}

/** Validate and fill defaults. Returns { spec, errors }; spec is null when errors is not empty. */
export function normalizeSpec(input) {
  const errors = [];
  const s = input && typeof input === "object" ? input : {};
  const market = MARKETS.includes(s.market) ? s.market : "stock";
  const spec = {
    version: 1,
    name: String(s.name || "My strategy").slice(0, 80),
    symbol: String(s.symbol || "SPY").toUpperCase().replace(/[^A-Z0-9=^.\-/]/g, "").slice(0, 20) || "SPY",
    market,
    timeframe: TIMEFRAMES.includes(s.timeframe) ? s.timeframe : "1d",
    side: s.side === "short" ? "short" : "long",
    entry: normConditions(s.entry, errors, "Entry"),
    exit: normConditions(s.exit, errors, "Exit"),
    stop: null,
    target: null,
    trail: Boolean(s.trail),
    riskPct: clamp(s.riskPct, 0.05, 10, 1),
    allocationPct: clamp(s.allocationPct, 1, 100, 100),
    maxLeverage: clamp(s.maxLeverage, 0.1, 50, DEFAULT_MAX_LEVERAGE[market]),
    costBps: clamp(s.costBps, 0, 200, DEFAULT_COST_BPS[market]),
    maxBarsInTrade: s.maxBarsInTrade ? intIn(s.maxBarsInTrade, 1, 1000, 0) : 0,
    guards: null,
  };
  if (s.stop && typeof s.stop === "object") {
    if (s.stop.type === "atr") spec.stop = { type: "atr", mult: clamp(s.stop.mult, 0.2, 20, 2), period: intIn(s.stop.period, 2, 200, 14) };
    else if (s.stop.type === "percent") spec.stop = { type: "percent", pct: clamp(s.stop.pct, 0.05, 50, 2) };
    else errors.push(`Stop: unknown type "${s.stop.type}"`);
  }
  if (s.target && typeof s.target === "object") {
    if (s.target.type === "r") {
      if (!spec.stop) errors.push("Target: an R-multiple target needs a stop");
      spec.target = { type: "r", r: clamp(s.target.r, 0.2, 20, 2) };
    } else if (s.target.type === "percent") spec.target = { type: "percent", pct: clamp(s.target.pct, 0.05, 500, 4) };
    else errors.push(`Target: unknown type "${s.target.type}"`);
  }
  if (spec.trail && spec.stop?.type !== "atr") spec.trail = false;
  if (s.guards && typeof s.guards === "object") {
    spec.guards = {
      dailyLossPct: s.guards.dailyLossPct ? clamp(s.guards.dailyLossPct, 0.5, 50, 5) : null,
      maxLossPct: clamp(s.guards.maxLossPct, 1, 90, 10),
      maxLossType: s.guards.maxLossType === "trailing" ? "trailing" : "static",
      profitTargetPct: s.guards.profitTargetPct ? clamp(s.guards.profitTargetPct, 0.5, 200, 8) : null,
    };
  }
  if (!spec.entry.length) errors.push("Entry: add at least one rule");
  if (!spec.exit.length && !spec.stop && !spec.target && !spec.maxBarsInTrade) {
    errors.push("Exit: add an exit rule, a stop, a target or a time limit, or trades never close");
  }
  return errors.length ? { spec: null, errors } : { spec, errors };
}

/** Compute an operand as an array aligned with bars. Results are cached per spec run. */
export function series(op, bars, cache = new Map()) {
  if ("value" in op) return bars.map(() => op.value);
  const key = JSON.stringify(op);
  if (cache.has(key)) return cache.get(key);
  const close = bars.map((b) => b.close);
  let v;
  switch (op.ind) {
    case "close": case "open": case "high": case "low": case "volume": v = bars.map((b) => b[op.ind] ?? NaN); break;
    case "sma": v = I.sma(close, op.period); break;
    case "ema": v = I.ema(close, op.period); break;
    case "rsi": v = I.rsi(close, op.period); break;
    case "atr": v = I.atr(bars, op.period); break;
    case "adx": v = I.adx(bars, op.period); break;
    case "roc": v = I.roc(close, op.period); break;
    case "bbUpper": v = I.bollinger(close, op.period, op.mult).upper; break;
    case "bbMid": v = I.bollinger(close, op.period, op.mult).mid; break;
    case "bbLower": v = I.bollinger(close, op.period, op.mult).lower; break;
    case "donchianHigh": v = I.donchian(bars, op.period).high; break;
    case "donchianLow": v = I.donchian(bars, op.period).low; break;
    case "macd": v = I.macd(close).line; break;
    case "macdSignal": v = I.macd(close).signal; break;
    case "macdHist": v = I.macd(close).hist; break;
    case "supertrend": v = I.supertrend(bars, op.period, op.mult); break;
    case "vwap": v = I.vwap(bars); break;
    case "volumeSma": v = I.sma(bars.map((b) => b.volume || 0), op.period); break;
    default: throw new Error(`unknown indicator ${op.ind}`);
  }
  if (op.offset) v = v.map((_, i) => (i >= op.offset ? v[i - op.offset] : NaN));
  if (op.times) v = v.map((x) => x * op.times);
  cache.set(key, v);
  return v;
}

/** Boolean array: true on bars where every condition holds (false while data is warming up). */
export function evaluate(conditions, bars, cache = new Map()) {
  const out = new Array(bars.length).fill(conditions.length > 0);
  for (const c of conditions) {
    const a = series(c.left, bars, cache), b = series(c.right, bars, cache);
    for (let i = 0; i < bars.length; i++) {
      if (!out[i]) continue;
      const x = a[i], y = b[i];
      let ok;
      if (Number.isNaN(x) || Number.isNaN(y)) ok = false;
      else if (c.op === ">") ok = x > y;
      else if (c.op === "<") ok = x < y;
      else if (c.op === ">=") ok = x >= y;
      else if (c.op === "<=") ok = x <= y;
      else {
        const px = a[i - 1], py = b[i - 1];
        if (i === 0 || Number.isNaN(px) || Number.isNaN(py)) ok = false;
        else ok = c.op === "crossesAbove" ? px <= py && x > y : px >= py && x < y;
      }
      out[i] = ok;
    }
  }
  return out;
}

export function operandText(o) {
  if ("value" in o) return String(o.value);
  const meta = INDICATORS[o.ind];
  let t = meta.label;
  const args = meta.args.map((a) => o[a]).filter((x) => x !== undefined);
  if (args.length) t += `(${args.join(", ")})`;
  if (o.times) t = `${o.times} × ${t}`;
  if (o.offset) t += ` ${o.offset} bar${o.offset > 1 ? "s" : ""} ago`;
  return t;
}

export const conditionText = (c) => `${operandText(c.left)} ${OPS[c.op]} ${operandText(c.right)}`;

/** Plain-English rows describing a normalized spec. */
export function describe(spec) {
  const rows = [
    ["Market", `${spec.symbol} (${spec.market}) · ${spec.timeframe === "1d" ? "daily bars" : "hourly bars"} · ${spec.side}`],
    ["Enter when", spec.entry.map(conditionText).join(" AND ")],
    ["Exit when", spec.exit.length ? spec.exit.map(conditionText).join(" OR ") : "Only by stop, target or time limit"],
    ["Stop", !spec.stop ? "None" : spec.stop.type === "atr"
      ? `${spec.stop.mult} × ATR(${spec.stop.period}) from entry${spec.trail ? ", trailing" : ""}` : `${spec.stop.pct}% from entry`],
    ["Target", !spec.target ? "None" : spec.target.type === "r" ? `${spec.target.r}R (${spec.target.r} × the stop distance)` : `${spec.target.pct}% from entry`],
    ["Size", spec.stop ? `Risk ${spec.riskPct}% of the account per trade (max ${spec.maxLeverage}× leverage)` : `${spec.allocationPct}% of the account per trade`],
    ["Costs", `${spec.costBps} bps per side (fees + slippage)`],
  ];
  if (spec.maxBarsInTrade) rows.push(["Time limit", `Close after ${spec.maxBarsInTrade} bars`]);
  if (spec.guards) {
    const g = spec.guards;
    rows.push(["Prop rules", [g.profitTargetPct && `target +${g.profitTargetPct}%`, g.dailyLossPct && `daily loss −${g.dailyLossPct}%`,
      `max loss −${g.maxLossPct}% (${g.maxLossType})`].filter(Boolean).join(" · ")]);
  }
  return rows;
}

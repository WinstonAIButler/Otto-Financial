// Quant Kit backtester. Bar by bar, no look-ahead:
// - rules are checked at a bar's close; orders fill at the NEXT bar's open
// - stops and targets fill inside the bar; if both could have hit, the stop is assumed (worst case)
// - every fill pays costBps of the traded value
// Research and paper trading only: nothing here talks to a broker.

import { evaluate, normalizeSpec, series } from "./spec.js";

const DAY_MS = 86_400_000;

/**
 * @param {{date:string,open:number,high:number,low:number,close:number,volume?:number}[]} bars oldest first
 * @param {object} rawSpec strategy spec (normalized here)
 * @param {{startingEquity?:number}} [opts]
 */
export function backtest(bars, rawSpec, opts = {}) {
  const { spec, errors } = normalizeSpec(rawSpec);
  if (!spec) return { ok: false, errors };
  const clean = (bars || []).filter((b) => [b.open, b.high, b.low, b.close].every(Number.isFinite) && b.close > 0);
  if (clean.length < 30) return { ok: false, errors: ["Not enough price history to test (need at least 30 bars)."] };

  const start = opts.startingEquity ?? 100_000;
  const cache = new Map();
  const entrySig = evaluate(spec.entry, clean, cache);
  const exitSig = spec.exit.length ? evaluate(spec.exit, clean, cache) : clean.map(() => false);
  const atrStop = spec.stop?.type === "atr" ? series({ ind: "atr", period: spec.stop.period }, clean, cache) : null;
  const dir = spec.side === "long" ? 1 : -1;
  const fee = spec.costBps / 10_000;

  let cash = start, qty = 0, pos = null, pending = null;
  const eq = new Array(clean.length), worst = new Array(clean.length), trades = [];

  const close = (i, price, reason) => {
    cash += qty * price - Math.abs(qty * price) * fee;
    const pnl = (price - pos.entry) * qty - pos.entryCost - Math.abs(qty * price) * fee;
    trades.push({
      entryDate: pos.date, exitDate: clean[i].date, side: spec.side, entry: round(pos.entry), exit: round(price),
      qty: round(Math.abs(qty), 6), pnl: round(pnl, 2), returnPct: round((100 * pnl) / pos.equityAtEntry, 3),
      r: pos.riskAmount ? round(pnl / pos.riskAmount, 2) : null, bars: i - pos.index + 1, reason,
    });
    qty = 0; pos = null;
  };

  for (let i = 0; i < clean.length; i++) {
    const b = clean[i];
    // 1. orders decided at the previous close fill at this open
    if (pending === "exit" && pos) close(i, b.open, pos.exitReason);
    if (pending === "entry" && !pos) {
      const equity = cash, price = b.open;
      let dist = null;
      if (spec.stop?.type === "atr" && Number.isFinite(atrStop[i - 1])) dist = spec.stop.mult * atrStop[i - 1];
      if (spec.stop?.type === "percent") dist = (spec.stop.pct / 100) * price;
      let units = dist ? (equity * spec.riskPct) / 100 / dist : (equity * spec.allocationPct) / 100 / price;
      units = Math.min(units, (equity * spec.maxLeverage) / price);
      if (spec.stop?.type === "atr" && !dist) units = 0; // ATR not ready yet
      if (units > 0) {
        qty = dir * units;
        const cost = Math.abs(qty * price) * fee;
        cash -= qty * price + cost;
        pos = {
          index: i, date: b.date, entry: price, entryCost: cost, equityAtEntry: equity,
          stop: dist ? price - dir * dist : null, dist, riskAmount: dist ? units * dist : null,
          target: !spec.target ? null : spec.target.type === "r" ? price + dir * spec.target.r * dist
            : price * (1 + (dir * spec.target.pct) / 100),
        };
      }
    }
    pending = null;

    // 2. stop / target inside this bar
    if (pos) {
      const hitStop = pos.stop != null && (dir > 0 ? b.low <= pos.stop : b.high >= pos.stop);
      const hitTarget = pos.target != null && (dir > 0 ? b.high >= pos.target : b.low <= pos.target);
      if (hitStop) close(i, dir > 0 ? Math.min(b.open, pos.stop) : Math.max(b.open, pos.stop), "stop");
      else if (hitTarget) close(i, dir > 0 ? Math.max(b.open, pos.target) : Math.min(b.open, pos.target), "target");
    }
    if (pos && spec.trail && Number.isFinite(atrStop[i])) {
      const s = b.close - dir * spec.stop.mult * atrStop[i];
      pos.stop = dir > 0 ? Math.max(pos.stop, s) : Math.min(pos.stop, s);
    }

    // 3. mark to market
    eq[i] = cash + qty * b.close;
    worst[i] = cash + qty * (dir > 0 ? b.low : b.high);
    if (!pos) worst[i] = eq[i];

    // 4. decide for the next bar
    if (i === clean.length - 1) break;
    if (pos) {
      if (exitSig[i]) { pending = "exit"; pos.exitReason = "rule"; }
      else if (spec.maxBarsInTrade && i - pos.index + 1 >= spec.maxBarsInTrade) { pending = "exit"; pos.exitReason = "time"; }
    } else if (entrySig[i]) pending = "entry";
  }
  const openTrade = pos ? { entryDate: pos.date, entry: round(pos.entry), stop: pos.stop && round(pos.stop), target: pos.target && round(pos.target) } : null;
  if (pos) close(clean.length - 1, clean[clean.length - 1].close, "end of test");
  eq[clean.length - 1] = cash;

  const dates = clean.map((b) => b.date);
  const stats = metrics(eq, trades, dates, clean);
  const warnings = [];
  if (!trades.length) warnings.push("The rules never triggered on this data. Loosen them or test a longer period.");
  else if (trades.length < 20) warnings.push(`Only ${trades.length} trades: too few to tell skill from luck.`);
  if (stats.totalReturn < stats.buyHold) warnings.push("Buy-and-hold did better than this strategy over the same period.");

  return {
    ok: true,
    spec,
    from: dates[0], to: dates[dates.length - 1], bars: clean.length,
    stats,
    trades: trades.slice(-100),
    openTrade,
    equity: downsample(dates, eq, 240),
    challenge: spec.guards ? challengeStats(eq, worst, dates, spec.guards) : null,
    warnings,
  };
}

function round(x, d = 4) {
  const f = 10 ** d;
  return Math.round(x * f) / f;
}

function downsample(dates, eq, max) {
  const step = Math.max(1, Math.ceil(eq.length / max));
  const out = [];
  for (let i = 0; i < eq.length; i += step) out.push({ date: dates[i], equity: round(eq[i], 2) });
  if (out[out.length - 1].date !== dates[dates.length - 1]) out.push({ date: dates[dates.length - 1], equity: round(eq[eq.length - 1], 2) });
  return out;
}

export function metrics(eq, trades, dates, bars) {
  const rets = [];
  for (let i = 1; i < eq.length; i++) rets.push(eq[i] / eq[i - 1] - 1);
  const years = Math.max((Date.parse(dates[dates.length - 1]) - Date.parse(dates[0])) / (365.25 * DAY_MS), 1 / 365);
  const ppy = rets.length / years;
  const mean = rets.reduce((a, b) => a + b, 0) / (rets.length || 1);
  const sd = Math.sqrt(rets.reduce((a, r) => a + (r - mean) ** 2, 0) / (rets.length || 1));
  const downs = rets.filter((r) => r < 0);
  const dsd = Math.sqrt(downs.reduce((a, r) => a + r * r, 0) / (rets.length || 1));
  let peak = eq[0], mdd = 0;
  for (const e of eq) { peak = Math.max(peak, e); mdd = Math.min(mdd, e / peak - 1); }
  const total = eq[eq.length - 1] / eq[0] - 1;
  const wins = trades.filter((t) => t.pnl > 0), losses = trades.filter((t) => t.pnl <= 0);
  const gw = wins.reduce((a, t) => a + t.pnl, 0), gl = -losses.reduce((a, t) => a + t.pnl, 0);
  const rs = trades.map((t) => t.r).filter((r) => r != null);
  const inMarket = trades.reduce((a, t) => a + t.bars, 0);
  const pct = (x) => round(100 * x, 2);
  return {
    totalReturn: pct(total),
    cagr: pct(total > -1 ? (1 + total) ** (1 / years) - 1 : -1),
    maxDrawdown: pct(mdd),
    sharpe: sd > 0 ? round((mean / sd) * Math.sqrt(ppy), 2) : 0,
    sortino: dsd > 0 ? round((mean / dsd) * Math.sqrt(ppy), 2) : 0,
    trades: trades.length,
    winRate: trades.length ? pct(wins.length / trades.length) : 0,
    profitFactor: gl > 0 ? round(gw / gl, 2) : gw > 0 ? null : 0,
    avgR: rs.length ? round(rs.reduce((a, b) => a + b, 0) / rs.length, 2) : null,
    exposure: pct(Math.min(1, inMarket / eq.length)),
    buyHold: pct(bars[bars.length - 1].close / bars[0].close - 1),
    years: round(years, 2),
  };
}

/** One prop-firm evaluation starting at bar s. Returns passed / failed / open. */
export function runChallenge(eq, worst, dates, g, s) {
  const base = eq[s - 1] ?? eq[s];
  let dayStart = base, day = String(dates[s]).slice(0, 10), hwm = base, days = 1;
  for (let i = s; i < eq.length; i++) {
    const d = String(dates[i]).slice(0, 10);
    if (d !== day) { day = d; dayStart = eq[i - 1]; days++; }
    const floor = g.maxLossType === "trailing" ? Math.min(base, hwm - (base * g.maxLossPct) / 100) : base * (1 - g.maxLossPct / 100);
    if (worst[i] <= floor) return { status: "failed", reason: "max loss", date: d, days };
    if (g.dailyLossPct && worst[i] <= dayStart * (1 - g.dailyLossPct / 100)) return { status: "failed", reason: "daily loss", date: d, days };
    if (g.profitTargetPct && eq[i] >= base * (1 + g.profitTargetPct / 100)) return { status: "passed", date: d, days };
    hwm = Math.max(hwm, eq[i]);
  }
  return { status: "open", days };
}

/** Start a fresh evaluation about every 21 bars and count how many pass, fail or never finish. */
export function challengeStats(eq, worst, dates, g) {
  const runs = [];
  for (let s = 1; s < eq.length - 5; s += 21) runs.push({ start: dates[s], ...runChallenge(eq, worst, dates, g, s) });
  const n = runs.length || 1;
  const passed = runs.filter((r) => r.status === "passed"), failed = runs.filter((r) => r.status === "failed");
  return {
    attempts: runs.length,
    passRate: round((100 * passed.length) / n, 1),
    failRate: round((100 * failed.length) / n, 1),
    openRate: round((100 * (runs.length - passed.length - failed.length)) / n, 1),
    medianDaysToPass: passed.length ? passed.map((r) => r.days).sort((a, b) => a - b)[Math.floor(passed.length / 2)] : null,
    failReasons: {
      dailyLoss: failed.filter((r) => r.reason === "daily loss").length,
      maxLoss: failed.filter((r) => r.reason === "max loss").length,
    },
    first: runs[0] || null,
  };
}

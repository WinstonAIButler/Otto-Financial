// Ready-made strategies people can start from. Each is a complete spec minus symbol/market.

const c = (ind, extra = {}) => ({ ind, ...extra });
const v = (value) => ({ value });

export const TEMPLATES = {
  trendPullback: {
    label: "Trend pullback",
    style: "Trend following",
    blurb: "In an uptrend (price above the 200 EMA, 20 EMA above 50 EMA), buy short dips; ATR stop, 2R target.",
    spec: {
      name: "Trend pullback",
      entry: [
        { left: c("close"), op: ">", right: c("ema", { period: 200 }) },
        { left: c("ema", { period: 20 }), op: ">", right: c("ema", { period: 50 }) },
        { left: c("rsi", { period: 3 }), op: "<", right: v(30) },
      ],
      exit: [{ left: c("close"), op: "<", right: c("ema", { period: 200 }) }],
      stop: { type: "atr", mult: 1.5, period: 14 }, target: { type: "r", r: 2 }, riskPct: 0.5,
    },
  },
  emaCross: {
    label: "EMA 50/200 crossover",
    style: "Trend following",
    blurb: "Hold while the 50-day EMA is above the 200-day EMA. Slow, few trades, rides big trends.",
    spec: {
      name: "EMA 50/200 crossover",
      entry: [{ left: c("ema", { period: 50 }), op: ">", right: c("ema", { period: 200 }) }],
      exit: [{ left: c("ema", { period: 50 }), op: "<", right: c("ema", { period: 200 }) }],
    },
  },
  donchianBreakout: {
    label: "Donchian breakout",
    style: "Breakout",
    blurb: "Turtle-style: buy a close above the prior 20-bar high, sell a close below the prior 10-bar low.",
    spec: {
      name: "Donchian breakout",
      entry: [{ left: c("close"), op: ">", right: c("donchianHigh", { period: 20 }) }],
      exit: [{ left: c("close"), op: "<", right: c("donchianLow", { period: 10 }) }],
      stop: { type: "atr", mult: 2, period: 20 }, riskPct: 1,
    },
  },
  rsi2: {
    label: "RSI(2) dip buy",
    style: "Mean reversion",
    blurb: "Connors-style: above the 200-day average, buy when 2-day RSI drops under 10, sell when it rebounds above 70.",
    spec: {
      name: "RSI(2) dip buy",
      entry: [
        { left: c("close"), op: ">", right: c("sma", { period: 200 }) },
        { left: c("rsi", { period: 2 }), op: "<", right: v(10) },
      ],
      exit: [{ left: c("rsi", { period: 2 }), op: ">", right: v(70) }],
      maxBarsInTrade: 10,
    },
  },
  bollingerReversion: {
    label: "Bollinger reversion",
    style: "Mean reversion",
    blurb: "Buy a close below the lower band with RSI stretched; exit at the middle band.",
    spec: {
      name: "Bollinger reversion",
      entry: [
        { left: c("close"), op: "<", right: c("bbLower", { period: 20, mult: 2 }) },
        { left: c("rsi", { period: 14 }), op: "<", right: v(30) },
      ],
      exit: [{ left: c("close"), op: ">", right: c("bbMid", { period: 20, mult: 2 }) }],
      stop: { type: "atr", mult: 2, period: 14 }, riskPct: 0.5,
    },
  },
  macdAdx: {
    label: "MACD + ADX trend",
    style: "Trend following",
    blurb: "Long while the MACD histogram is positive and ADX says a real trend is running.",
    spec: {
      name: "MACD + ADX trend",
      entry: [
        { left: c("macdHist"), op: ">", right: v(0) },
        { left: c("adx", { period: 14 }), op: ">", right: v(20) },
      ],
      exit: [{ left: c("macdHist"), op: "<", right: v(0) }],
    },
  },
  supertrend: {
    label: "Supertrend follow",
    style: "Trend following",
    blurb: "Long while price is above the Supertrend line; trailing ATR stop.",
    spec: {
      name: "Supertrend follow",
      entry: [{ left: c("close"), op: ">", right: c("supertrend", { period: 10, mult: 3 }) }],
      exit: [{ left: c("close"), op: "<", right: c("supertrend", { period: 10, mult: 3 }) }],
      stop: { type: "atr", mult: 3, period: 10 }, trail: true, riskPct: 1,
    },
  },
};

/** Prop-firm rule profiles (Otto Funded and a generic one). */
export const PROP_RULES = {
  "Otto Funded Two-Step": { profitTargetPct: 8, dailyLossPct: 5, maxLossPct: 10, maxLossType: "static" },
  "Otto Funded One-Step": { profitTargetPct: 10, dailyLossPct: 3, maxLossPct: 6, maxLossType: "trailing" },
};

export function fromTemplate(id, overrides = {}) {
  const t = TEMPLATES[id];
  if (!t) throw new Error(`unknown template ${id}`);
  return { ...structuredClone(t.spec), ...overrides };
}

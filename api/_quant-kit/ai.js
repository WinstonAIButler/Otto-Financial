// Prompt kit for turning a plain-English idea into a spec with an AI model.
// Provider-agnostic: each app sends SYSTEM_PROMPT + userPrompt(idea) to its own model,
// asks for JSON matching SPEC_JSON_SCHEMA, then runs the answer through specFromAi().

import { INDICATORS, MARKETS, OPS, normalizeSpec } from "./spec.js";
import { parseIdea } from "./parse.js";

const operandSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    ind: { type: "string", enum: [...Object.keys(INDICATORS), "value"] },
    value: { type: "number" },
    period: { type: "integer" },
    mult: { type: "number" },
    offset: { type: "integer" },
    times: { type: "number" },
  },
  required: ["ind"],
};

const conditionSchema = {
  type: "object",
  additionalProperties: false,
  properties: { left: operandSchema, op: { type: "string", enum: Object.keys(OPS) }, right: operandSchema },
  required: ["left", "op", "right"],
};

export const SPEC_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string" },
    symbol: { type: "string" },
    market: { type: "string", enum: MARKETS },
    timeframe: { type: "string", enum: ["1d", "1h"] },
    side: { type: "string", enum: ["long", "short"] },
    entry: { type: "array", items: conditionSchema },
    exit: { type: "array", items: conditionSchema },
    stop: {
      anyOf: [{ type: "null" }, {
        type: "object", additionalProperties: false,
        properties: { type: { type: "string", enum: ["atr", "percent"] }, mult: { type: "number" }, period: { type: "integer" }, pct: { type: "number" } },
        required: ["type"],
      }],
    },
    target: {
      anyOf: [{ type: "null" }, {
        type: "object", additionalProperties: false,
        properties: { type: { type: "string", enum: ["r", "percent"] }, r: { type: "number" }, pct: { type: "number" } },
        required: ["type"],
      }],
    },
    trail: { type: "boolean" },
    riskPct: { type: "number" },
    maxBarsInTrade: { type: "integer" },
    assumptions: { type: "array", items: { type: "string" } },
  },
  required: ["name", "symbol", "market", "timeframe", "side", "entry", "exit", "stop", "target", "trail", "riskPct", "assumptions"],
};

export const SYSTEM_PROMPT = `You convert a trader's plain-English strategy idea into a precise, testable JSON spec.

Indicators (use "ind"): ${Object.entries(INDICATORS).map(([k, m]) => `${k}${m.args.length ? `(${m.args.join(", ")})` : ""}`).join(", ")}.
A constant number is {"ind":"value","value":N}. "offset" looks N bars back. "times" multiplies (e.g. volume > 1.5 × volumeSma).
Comparisons ("op"): ${Object.keys(OPS).join(", ")}.
Entry rules are ANDed; exit rules are ORed. Rules are checked at each bar's close and fill at the next bar's open.
donchianHigh/donchianLow are the highest high / lowest low of the PRIOR N bars, so "close > donchianHigh" is a breakout.

Symbols use Yahoo Finance tickers: stocks/ETFs as-is (AAPL, SPY), crypto like BTC-USD, forex like EURUSD=X, futures like ES=F, NQ=F, GC=F (gold), CL=F (oil).
Markets: stock, crypto, forex, futures. Timeframe is "1d" or "1h" only; map anything intraday to "1h" and say so in assumptions.
Stops: {"type":"atr","mult":M,"period":P} or {"type":"percent","pct":X}. Targets: {"type":"r","r":R} (needs a stop) or {"type":"percent","pct":X}. Use null for none.
riskPct is the percent of the account risked per trade when there is a stop (default 1; 0.5 for prop-firm accounts).

Rules:
- Encode only what the idea says plus the minimum needed to make it testable. Every rule must be something the indicators above can express.
- Anything you had to guess or could not express (news, order flow, patterns, sessions) goes in "assumptions" in plain English.
- Every strategy needs a way out: an exit rule, a stop, a target, or maxBarsInTrade.
- Never claim the strategy will be profitable.`;

export const userPrompt = (idea, context = {}) =>
  `Strategy idea:\n"""${String(idea).slice(0, 1500)}"""\n${context.symbol ? `Use symbol ${context.symbol} (${context.market || "stock"}).\n` : ""}Return the JSON spec.`;

/** Validate an AI answer; fall back to the keyword parser if it doesn't hold up. */
export function specFromAi(answer, idea, defaults = {}) {
  let obj = answer;
  if (typeof answer === "string") {
    try { obj = JSON.parse(answer.replace(/^```(?:json)?\s*|\s*```$/g, "")); } catch { obj = null; }
  }
  if (obj) {
    const fixOp = (o) => (o && o.ind === "value" ? { value: o.value } : o);
    const fixList = (l) => (Array.isArray(l) ? l.map((r) => ({ ...r, left: fixOp(r.left), right: fixOp(r.right) })) : l);
    const candidate = { ...obj, entry: fixList(obj.entry), exit: fixList(obj.exit), ...(defaults.symbol ? { symbol: defaults.symbol, market: defaults.market } : {}) };
    const { spec, errors } = normalizeSpec(candidate);
    if (spec) return { spec, notes: Array.isArray(obj.assumptions) ? obj.assumptions.map(String).slice(0, 6) : [], source: "ai" };
    const fb = parseIdea(idea, defaults);
    return { spec: fb.spec, notes: [`The AI draft had problems (${errors.join("; ")}), so this uses the built-in pattern instead.`, ...fb.notes], source: "keywords" };
  }
  const fb = parseIdea(idea, defaults);
  return { spec: fb.spec, notes: fb.notes, source: "keywords" };
}

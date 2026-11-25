// Otto Quant: turn a plain-English idea into testable rules and backtest them on real prices.
// POST { idea, market?, ruleset?, spec? }
//  - idea:    the trader's description (used when no spec is sent)
//  - market:  "auto" or one of the site's markets (EURUSD, XAUUSD, NQ, ES, BTCUSD)
//  - ruleset: "Otto Funded Two-Step" | "Otto Funded One-Step" | "No prop rules"
//  - spec:    an already-built spec to re-test (skips the AI step)
// With ANTHROPIC_API_KEY set, Claude drafts the rules; without it, built-in keyword patterns do.
// Prices come from Yahoo Finance's public chart data. Nothing here places trades.
import Anthropic from "@anthropic-ai/sdk";
import {
  DISCLAIMER, PROP_RULES, SPEC_JSON_SCHEMA, SYSTEM_PROMPT, backtest, describe, fetchYahooBars,
  normalizeSpec, parseIdea, specFromAi, userPrompt,
} from "./_quant-kit/index.js";

const MODEL = process.env.OTTO_QUANT_MODEL || process.env.OTTO_AGENT_MODEL || "claude-opus-5-5";

const MARKETS = {
  EURUSD: { symbol: "EURUSD=X", market: "forex" },
  XAUUSD: { symbol: "GC=F", market: "futures" },
  NQ: { symbol: "NQ=F", market: "futures" },
  ES: { symbol: "ES=F", market: "futures" },
  BTCUSD: { symbol: "BTC-USD", market: "crypto" },
};
const LABEL = Object.fromEntries(Object.entries(MARKETS).map(([k, v]) => [v.symbol, k]));

// Small per-instance cache so repeated tests don't hammer the price source.
const barCache = new Map();
async function bars(symbol, timeframe) {
  const key = `${symbol}|${timeframe}`;
  const hit = barCache.get(key);
  if (hit && Date.now() - hit.at < 15 * 60_000) return hit.bars;
  const b = await fetchYahooBars(symbol, timeframe);
  barCache.set(key, { at: Date.now(), bars: b });
  return b;
}

async function draftWithClaude(idea, defaults) {
  const client = new Anthropic();
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 4096,
    output_config: { effort: "low", format: { type: "json_schema", schema: SPEC_JSON_SCHEMA } },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt(idea, defaults) }],
  });
  if (response.stop_reason === "refusal") return null;
  return response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const { idea, market = "auto", ruleset = "No prop rules", spec: given } = req.body || {};
  const defaults = MARKETS[market] || {};
  let draft;

  if (given && typeof given === "object") {
    draft = { spec: given, notes: [], source: "edited" };
  } else {
    if (typeof idea !== "string" || !idea.trim() || idea.length > 1500) {
      return res.status(400).json({ error: "Describe your strategy in up to 1,500 characters." });
    }
    draft = null;
    if (process.env.ANTHROPIC_API_KEY) {
      try {
        const answer = await draftWithClaude(idea.trim(), defaults);
        if (answer) draft = specFromAi(answer, idea, defaults);
      } catch (err) {
        if (err instanceof Anthropic.APIError) console.error("Anthropic API error", err.status, err.message);
        else console.error(err);
      }
    }
    if (!draft) draft = { ...parseIdea(idea, defaults), source: "keywords" };
  }

  // Size and guard the strategy for the chosen prop-firm rules.
  const guards = PROP_RULES[ruleset] || null;
  const spec = { ...draft.spec, guards };
  if (guards) {
    const cap = guards.dailyLossPct / 4;
    if (!spec.riskPct || spec.riskPct > cap) {
      draft.notes.push(`Risk per trade capped at ${cap}% (a quarter of the ${guards.dailyLossPct}% daily loss limit).`);
      spec.riskPct = Math.min(spec.riskPct || cap, cap);
    }
    if (!spec.stop) {
      spec.stop = { type: "atr", mult: 2, period: 14 };
      draft.notes.push("Added a 2 × ATR stop: prop accounts need a defined loss on every trade.");
    }
  }
  const { spec: clean, errors } = normalizeSpec(spec);
  if (!clean) return res.status(422).json({ error: "These rules can't be tested yet.", details: errors });

  let priceBars;
  try {
    priceBars = await bars(clean.symbol, clean.timeframe);
  } catch (err) {
    console.error("price data", clean.symbol, err.message);
    return res.status(502).json({ error: `Couldn't load price history for ${clean.symbol} right now. Try again in a minute.`, spec: clean, rows: describe(clean) });
  }

  const result = backtest(priceBars, clean);
  if (!result.ok) return res.status(422).json({ error: result.errors.join(" "), spec: clean, rows: describe(clean) });

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    spec: clean,
    marketLabel: LABEL[clean.symbol] || clean.symbol,
    rows: describe(clean),
    notes: draft.notes,
    source: draft.source,
    from: result.from, to: result.to, bars: result.bars,
    stats: result.stats,
    equity: result.equity,
    challenge: result.challenge,
    trades: result.trades.slice(-10),
    openTrade: result.openTrade,
    warnings: result.warnings,
    disclaimer: DISCLAIMER,
  });
}

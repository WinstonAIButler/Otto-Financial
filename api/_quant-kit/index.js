// Quant Kit: build trading algorithms from plain English and backtest them honestly.
// Master copy: ~/Desktop/Joslin Enterprises/Joslin Quant/quant-kit. Copy into apps with
// copy-into-app.sh; change the master first. Research and paper trading only.

export * as indicators from "./indicators.js";
export { INDICATORS, OPS, MARKETS, normalizeSpec, evaluate, series, describe, conditionText, operandText } from "./spec.js";
export { backtest, metrics, runChallenge, challengeStats } from "./engine.js";
export { TEMPLATES, PROP_RULES, fromTemplate } from "./templates.js";
export { parseIdea, detectSymbol } from "./parse.js";
export { SPEC_JSON_SCHEMA, SYSTEM_PROMPT, userPrompt, specFromAi } from "./ai.js";
export { fetchYahooBars } from "./data.js";

export const DISCLAIMER =
  "Hypothetical results from historical data, prepared with hindsight. They don't include every real-world cost and don't predict future returns. Not investment advice.";

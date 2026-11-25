# Quant Kit

The shared trading-algorithm engine for Joslin Enterprises apps (Winston, Otto Financial). Plain JavaScript (ES modules) with TypeScript types in `index.d.ts`, and no dependencies.

**Master copy:** `~/Desktop/Joslin Enterprises/Joslin Quant/quant-kit`. To change the engine:

1. Edit the master copy.
2. Run `npm test` (Node 20 or newer).
3. Copy it into each app with `./copy-into-app.sh <folder>`.

| App | Folder |
|---|---|
| Winston | `src/lib/quant-kit` |
| Otto Financial | `api/_quant-kit` |

## What it does

1. **Idea → rules.** `parseIdea(text)` uses keywords. `SYSTEM_PROMPT` + `SPEC_JSON_SCHEMA` + `specFromAi(answer)` use any AI model, falling back to keywords if the AI answer doesn't validate.
2. **Rules → spec.** A small JSON language covers entry rules (AND), exit rules (OR), stop (ATR or %), target (R or %), trailing stop, risk per trade, a time limit and prop-firm guards. `normalizeSpec()` validates and clamps everything. `describe(spec)` gives plain-English rows.
3. **Spec → backtest.** `backtest(bars, spec)` steps through the bars one at a time:
   - Orders fill at the next bar's open.
   - Stops and targets trigger inside the bar; if both could have hit, the stop counts.
   - Fees and slippage are charged on every fill.
   It returns stats (return, CAGR, drawdown, Sharpe, win rate, profit factor, average R, buy-and-hold), trades and the equity curve.
4. **Prop-firm check.** When `spec.guards` is set, `challenge` reports how often a fresh evaluation started each month would have passed, failed on daily loss or max loss (static or trailing), or never finished.
5. **Data.** `fetchYahooBars(symbol, "1d" | "1h")` returns 10 years of daily bars or 2 years of hourly bars from Yahoo's public chart endpoint. It's unofficial, so cache the results and handle failures.

`TEMPLATES` holds 7 ready-made strategies. `PROP_RULES` holds the Otto Funded rule profiles.

The Python research version of the same ideas is in `../joslin_quant`.

**Research and paper trading only.** Nothing here places orders. Show `DISCLAIMER` next to any backtest result.

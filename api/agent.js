// Otto Agents: answers typed questions on the site with Claude.
// Needs ANTHROPIC_API_KEY in the Vercel project. Without it this returns 503
// and the page falls back to its built-in demo answers.
import Anthropic from "@anthropic-ai/sdk";

const MODEL = process.env.OTTO_AGENT_MODEL || "claude-opus-5-5";

const AGENTS = {
  guard: "Rule Guardian: tracks equity against the program's exact loss limits and says how much the trader can still lose and what size is safe.",
  coach: "Challenge Coach: stress-tests the trader's plan (risk per trade, win rate, reward to risk) and says what to change to raise the odds of passing.",
  journal: "Journal Analyst: reviews the trader's closed trades by session and setup and finds where the edge is and which trades broke the plan.",
  payout: "Payout Desk: checks every payout condition (14-day cycle, net profit, breaches, consistency rule) and works out the payout amount.",
  news: "News Sentinel: flags high-impact economic events and how the program's news rule applies to them.",
  quant: "Strategy Agent: turns a trading idea into explicit, testable entry, stop, exit and risk rules with drawdown guards."
};

const SYSTEM = `You are one of the Otto Agents on the Otto Financial website. Otto Financial runs Otto Funded (a simulated prop firm evaluation program), the Challenge Toolkit (risk tools for passing prop firm evaluations) and Otto Quant (an AI strategy builder).

Otto Funded rules:
- Two-Step Classic: Phase 1 target 8%, Phase 2 target 5%, daily loss limit 5% of start-of-day balance, max overall loss 10% static, 4 minimum trading days per phase, no time limit, news trading allowed, 80% profit split scaling to 90%.
- One-Step Express: target 10%, daily loss limit 3% of start-of-day balance, max overall loss 6% trailing that locks at the starting balance, 5 minimum trading days, no time limit, best day must be at most 40% of total profit, no trades within 2 minutes of high-impact news, 90% profit split.
- Account sizes $10K to $200K. Payouts can be requested every 14 days; the evaluation fee is refunded with the first payout. All accounts are simulated.

You will get the trader's question and a JSON snapshot of their sample account and the settings they chose on the page. Answer from that data and the rules above, and show the key numbers you used. Keep answers under 150 words, in plain text with short paragraphs and no markdown headings or tables. If the question is outside trading, prop firm challenges or this site, say briefly what you can help with instead. Never promise profits or tell the trader to buy or sell a specific instrument; you explain rules, risk and sizing. The account data is a sample for this demo, so do not describe it as their real account.`;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: "not configured" });

  const { agent, question, context } = req.body || {};
  if (typeof question !== "string" || !question.trim() || question.length > 600) {
    return res.status(400).json({ error: "Ask a question of up to 600 characters." });
  }
  const role = AGENTS[agent] || AGENTS.guard;
  const snapshot = JSON.stringify(context ?? {}).slice(0, 4000);

  const client = new Anthropic();
  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 2048,
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM,
      messages: [{
        role: "user",
        content: `You are acting as ${role}\n\nAccount and page settings:\n${snapshot}\n\nQuestion: ${question.trim()}`
      }]
    });
    if (response.stop_reason === "refusal") {
      return res.status(200).json({ answer: "I can't help with that one. Ask me about drawdown, sizing, payouts, news rules or your strategy." });
    }
    const answer = response.content.filter(b => b.type === "text").map(b => b.text).join("\n").trim();
    return res.status(200).json({ answer, model: response.model });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return res.status(429).json({ error: "busy" });
    if (err instanceof Anthropic.APIError) {
      console.error("Anthropic API error", err.status, err.message);
      return res.status(502).json({ error: "upstream" });
    }
    console.error(err);
    return res.status(500).json({ error: "failed" });
  }
}

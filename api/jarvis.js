// GET/POST /api/jarvis: Jarvis, Otto Financial's operations chief of staff (page at /jarvis).
// Reads Stripe and GitHub (never writes) and has Claude write the briefing and answer questions.
// Environment variables (Vercel -> Settings -> Environment Variables):
//   JARVIS_ACCESS_CODE  optional; if set, the page asks for it (Jarvis is open without it)
//   ANTHROPIC_API_KEY   Claude, for briefings and questions
//   JARVIS_STRIPE_KEY   a restricted, read-only Stripe key (falls back to STRIPE_SECRET_KEY)
//   GITHUB_TOKEN        a fine-grained, read-only token for this repo
//   JARVIS_MODEL        optional, default claude-sonnet-5-5
import { companyConfig, handleJarvis } from "./_jarvis-core.js";

const COMPANY = {
  "id": "otto",
  "name": "Otto Financial",
  "repo": "WinstonAIButler/otto-financial",
  "context": "Otto Financial sells Otto Funded (prop-firm trading evaluations), the Challenge Toolkit, Otto Quant (an AI strategy builder) and Otto Agents (an AI agent desk and playbooks) to retail traders. The site's prices and statistics are still placeholders. Marketing must follow financial-promotion rules: never promise or imply returns, and keep risk disclosures prominent."
};

export default async function handler(req, res) {
  const out = await handleJarvis(
    { method: req.method, headers: req.headers, body: req.body },
    companyConfig(process.env, COMPANY),
  );
  res.setHeader("Cache-Control", "no-store");
  res.status(out.status).json(out.body);
}

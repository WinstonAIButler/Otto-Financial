# Otto Financial

Marketing site for Otto Financial: Otto Funded (prop firm evaluations), the Challenge Toolkit, Otto Quant (AI strategy builder), and Otto Agents (AI agent desk and playbooks).

Static site, no build step. Open `index.html` locally, or deploy the repo root on Vercel with the "Other" framework preset.

All prices, rules and statistics are placeholders.

## Otto Agents AI

Typed questions in the Otto Agents console go to `api/agent.js`, a Vercel serverless function that calls Claude. Set `ANTHROPIC_API_KEY` in the Vercel project's environment variables to turn it on (optionally `OTTO_AGENT_MODEL` to change the model). Without the key the function returns 503 and the page falls back to its built-in demo answers.

## SEO and AI visibility

`robots.txt`, `sitemap.xml` and `llms.txt` sit at the repo root and are served as-is. JSON-LD (Organization, WebSite, WebPage, FAQPage) lives in the `<head>` of `index.html`; if you edit the FAQ, update the FAQPage block to match. Update `<lastmod>` in `sitemap.xml` when the page changes materially.

## Jarvis

`/jarvis` is Otto Financial's operations chief of staff: live Stripe revenue (balance, last 30 days, monthly recurring, open and overdue invoices), dev status from GitHub (open pull requests, latest deploys, recent commits), and a Claude-written briefing with today's priorities and sales and marketing moves. You can also ask it questions. It only reads: it can't move money, merge code or email anyone. It's not linked from the site and isn't indexed.

The page calls `api/jarvis.js`; the engine is `api/_jarvis-core.js`, an identical copy in every Joslin Enterprises repo, so change it there and copy it across. Set these in Vercel → Settings → Environment Variables, then redeploy:

- `JARVIS_ACCESS_CODE` (required): the passphrase the page asks for. Jarvis stays locked until it's set.
- `ANTHROPIC_API_KEY`: Claude, for briefings and questions (the same key as Otto Agents).
- `JARVIS_STRIPE_KEY`: a restricted Stripe key with Read on Balance, Charges, Subscriptions and Invoices.
- `GITHUB_TOKEN`: a fine-grained token with read-only Contents, Pull requests and Deployments on this repo.
- `JARVIS_MODEL` (optional): default `claude-sonnet-5-5`.

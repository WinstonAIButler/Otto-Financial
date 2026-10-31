# Otto Financial

Marketing site for Otto Financial: Otto Funded (prop firm evaluations), the Challenge Toolkit, Otto Quant (AI strategy builder), and Otto Agents (AI agent desk and playbooks).

Static site, no build step. Open `index.html` locally, or deploy the repo root on Vercel with the "Other" framework preset.

All prices, rules and statistics are placeholders.

## Otto Agents AI

Typed questions in the Otto Agents console go to `api/agent.js`, a Vercel serverless function that calls Claude. Set `ANTHROPIC_API_KEY` in the Vercel project's environment variables to turn it on (optionally `OTTO_AGENT_MODEL` to change the model). Without the key the function returns 503 and the page falls back to its built-in demo answers.

## SEO and AI visibility

`robots.txt`, `sitemap.xml` and `llms.txt` sit at the repo root and are served as-is. JSON-LD (Organization, WebSite, WebPage, FAQPage) lives in the `<head>` of `index.html`; if you edit the FAQ, update the FAQPage block to match. Update `<lastmod>` in `sitemap.xml` when the page changes materially.

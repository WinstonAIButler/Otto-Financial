// Copied from the shared Jarvis engine; keep every company's copy identical.
// Jarvis: an operations chief of staff for one company (or, in master mode, for
// every company under Joslin Enterprises Inc.).
//
// It reads, it never moves money: Stripe and GitHub are only ever read with GET
// requests, and Claude writes the briefing and answers questions from what was read.
// No dependencies: plain fetch and node:crypto, so the same file runs in a Vercel
// function, a Next.js route handler, or anything else on Node 20+.
//
// handleJarvis(request, config) is framework-agnostic: pass { method, headers, body }
// and it returns { status, body } for the caller to send.

import { createHash, timingSafeEqual } from "node:crypto";

const STRIPE = "https://api.stripe.com/v1";
const GITHUB = "https://api.github.com";
const ANTHROPIC = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-sonnet-5-5";
const DAY = 86400;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Build a single-company config from environment variables plus the
 * company's built-in description.
 *   JARVIS_ACCESS_CODE  optional: if set, the page asks for it (Jarvis is open without it)
 *   ANTHROPIC_API_KEY   Claude, for the briefing and questions
 *   JARVIS_MODEL        optional, default claude-sonnet-5-5
 *   JARVIS_STRIPE_KEY   optional: a restricted read-only Stripe key (falls back to STRIPE_SECRET_KEY)
 *   GITHUB_TOKEN        optional: read-only token for the repo (needed for private repos)
 *   JARVIS_GITHUB_REPO  optional: owner/repo (falls back to Vercel's git variables, then the default)
 */
export function companyConfig(env, company) {
  const vercelRepo = env.VERCEL_GIT_REPO_OWNER && env.VERCEL_GIT_REPO_SLUG
    ? `${env.VERCEL_GIT_REPO_OWNER}/${env.VERCEL_GIT_REPO_SLUG}` : "";
  return {
    mode: "company",
    accessCode: env.JARVIS_ACCESS_CODE || company.accessCodeFallback?.(env) || "",
    anthropicKey: env.ANTHROPIC_API_KEY || "",
    model: env.JARVIS_MODEL || DEFAULT_MODEL,
    githubToken: env.GITHUB_TOKEN || env.JARVIS_GITHUB_TOKEN || "",
    company: {
      id: company.id,
      name: company.name,
      context: company.context,
      repo: env.JARVIS_GITHUB_REPO || vercelRepo || company.repo,
      stripeKey: env.JARVIS_STRIPE_KEY || env.STRIPE_SECRET_KEY || "",
    },
  };
}

/**
 * Master config: one entry per company. Each company's Stripe key comes from
 * JARVIS_STRIPE_KEY_<ID> (ID upper-cased, non-letters as underscores), e.g.
 * JARVIS_STRIPE_KEY_LODGENET.
 */
export function masterConfig(env, holding, companies) {
  const base = companyConfig(env, holding);
  return {
    ...base,
    mode: "master",
    companies: companies.map((c) => ({
      id: c.id,
      name: c.name,
      context: c.context,
      repo: c.repo,
      stripeKey: env[stripeEnvName(c.id)] || "",
    })),
  };
}

export function stripeEnvName(id) {
  return "JARVIS_STRIPE_KEY_" + String(id).toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------

function sameSecret(a, b) {
  const ha = createHash("sha256").update(String(a)).digest();
  const hb = createHash("sha256").update(String(b)).digest();
  return timingSafeEqual(ha, hb);
}

function header(headers, name) {
  if (!headers) return "";
  if (typeof headers.get === "function") return headers.get(name) || "";
  const v = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v || "";
}

// ---------------------------------------------------------------------------
// Stripe (read-only)
// ---------------------------------------------------------------------------

async function stripeGet(key, path, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${STRIPE}${path}${qs ? "?" + qs : ""}`, {
    headers: { Authorization: `Bearer ${key}`, "Stripe-Version": "2024-06-20" },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `Stripe ${res.status}`);
  return data;
}

async function stripeList(key, path, params, maxPages) {
  const out = [];
  let after;
  for (let page = 0; page < maxPages; page++) {
    const data = await stripeGet(key, path, { ...params, limit: "100", ...(after ? { starting_after: after } : {}) });
    out.push(...data.data);
    if (!data.has_more || !data.data.length) return { items: out, complete: true };
    after = data.data[data.data.length - 1].id;
  }
  return { items: out, complete: false };
}

function addTo(map, currency, cents) {
  const cur = String(currency || "usd").toUpperCase();
  map[cur] = (map[cur] || 0) + cents;
}

function monthlyCents(item) {
  const price = item.price || item.plan || {};
  const amount = (price.unit_amount ?? price.amount ?? 0) * (item.quantity ?? 1);
  const rec = price.recurring || { interval: price.interval, interval_count: price.interval_count };
  const n = rec.interval_count || 1;
  switch (rec.interval) {
    case "day": return (amount * 365) / 12 / n;
    case "week": return (amount * 52) / 12 / n;
    case "year": return amount / 12 / n;
    default: return amount / n;
  }
}

export async function stripeStatus(key, now = Date.now()) {
  if (!key) return { ok: false, error: "No Stripe key set." };
  if (/^sk_|^rk_/.test(key) === false) return { ok: false, error: "That isn't a Stripe secret or restricted key." };
  const since = Math.floor(now / 1000) - 30 * DAY;
  try {
    const [balance, charges, subs, invoices] = await Promise.all([
      stripeGet(key, "/balance"),
      stripeList(key, "/charges", { "created[gte]": String(since) }, 5),
      stripeList(key, "/subscriptions", { status: "active" }, 3),
      stripeGet(key, "/invoices", { status: "open", limit: "20" }),
    ]);
    const available = {}, pending = {}, revenue = {}, refunds = {}, mrr = {}, openDue = {};
    for (const b of balance.available || []) addTo(available, b.currency, b.amount);
    for (const b of balance.pending || []) addTo(pending, b.currency, b.amount);
    let chargeCount = 0;
    for (const c of charges.items) {
      if (c.status !== "succeeded" || !c.paid) continue;
      chargeCount++;
      addTo(revenue, c.currency, c.amount);
      if (c.amount_refunded) addTo(refunds, c.currency, c.amount_refunded);
    }
    for (const s of subs.items) {
      for (const it of s.items?.data || []) addTo(mrr, it.price?.currency || s.currency, monthlyCents(it));
    }
    const nowSec = Math.floor(now / 1000);
    let overdue = 0;
    const openList = (invoices.data || []).map((inv) => {
      addTo(openDue, inv.currency, inv.amount_remaining || 0);
      const isOverdue = Boolean(inv.due_date && inv.due_date < nowSec);
      if (isOverdue) overdue++;
      return {
        customer: inv.customer_name || inv.customer_email || "Customer",
        amount: (inv.amount_remaining || 0) / 100,
        currency: String(inv.currency || "usd").toUpperCase(),
        dueDate: inv.due_date ? new Date(inv.due_date * 1000).toISOString().slice(0, 10) : null,
        overdue: isOverdue,
      };
    });
    const dollars = (m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, Math.round(v) / 100]));
    return {
      ok: true,
      mode: key.includes("_test_") ? "test" : "live",
      balanceAvailable: dollars(available),
      balancePending: dollars(pending),
      revenue30d: dollars(revenue),
      refunds30d: dollars(refunds),
      charges30d: chargeCount,
      revenueComplete: charges.complete,
      activeSubscriptions: subs.items.length,
      mrr: dollars(mrr),
      openInvoices: { count: openList.length, overdue, due: dollars(openDue), items: openList.slice(0, 8) },
    };
  } catch (err) {
    return { ok: false, error: String(err.message || err).slice(0, 200) };
  }
}

// ---------------------------------------------------------------------------
// GitHub (read-only)
// ---------------------------------------------------------------------------

async function ghGet(token, path) {
  const res = await fetch(`${GITHUB}${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "jarvis-ops",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const hint = res.status === 404 && !token ? " (private repo? set GITHUB_TOKEN)" : "";
    throw new Error(`${data?.message || "GitHub " + res.status}${hint}`);
  }
  return data;
}

export async function githubStatus(repo, token) {
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) return { ok: false, error: "No GitHub repo configured." };
  try {
    const [pulls, commits, deployments] = await Promise.all([
      ghGet(token, `/repos/${repo}/pulls?state=open&per_page=10`),
      ghGet(token, `/repos/${repo}/commits?per_page=5`),
      ghGet(token, `/repos/${repo}/deployments?per_page=3`).catch(() => []),
    ]);
    const deploys = await Promise.all((deployments || []).map(async (d) => {
      const statuses = await ghGet(token, `/repos/${repo}/deployments/${d.id}/statuses?per_page=1`).catch(() => []);
      return {
        environment: d.environment,
        state: statuses[0]?.state || "unknown",
        at: statuses[0]?.created_at || d.created_at,
        url: statuses[0]?.environment_url || statuses[0]?.target_url || null,
      };
    }));
    return {
      ok: true,
      repo,
      openPullRequests: pulls.map((p) => ({
        number: p.number,
        title: p.title,
        author: p.user?.login,
        draft: Boolean(p.draft),
        openedAt: p.created_at,
        url: p.html_url,
      })),
      recentCommits: commits.map((c) => ({
        sha: c.sha.slice(0, 7),
        message: String(c.commit?.message || "").split("\n")[0].slice(0, 120),
        at: c.commit?.author?.date,
      })),
      deployments: deploys,
    };
  } catch (err) {
    return { ok: false, repo, error: String(err.message || err).slice(0, 200) };
  }
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export async function companyStatus(company, githubToken) {
  const [stripe, github] = await Promise.all([
    stripeStatus(company.stripeKey),
    githubStatus(company.repo, githubToken),
  ]);
  return { id: company.id, name: company.name, stripe, github };
}

export async function gatherStatus(config) {
  const generatedAt = new Date().toISOString();
  if (config.mode === "master") {
    const companies = await Promise.all(config.companies.map((c) => companyStatus(c, config.githubToken)));
    return { mode: "master", generatedAt, companies, totals: totals(companies) };
  }
  return { mode: "company", generatedAt, ...(await companyStatus(config.company, config.githubToken)) };
}

function totals(companies) {
  const sum = (field) => {
    const out = {};
    for (const c of companies) {
      if (!c.stripe.ok) continue;
      for (const [cur, v] of Object.entries(c.stripe[field] || {})) out[cur] = Math.round(((out[cur] || 0) + v) * 100) / 100;
    }
    return out;
  };
  return {
    balanceAvailable: sum("balanceAvailable"),
    revenue30d: sum("revenue30d"),
    mrr: sum("mrr"),
    openPullRequests: companies.reduce((n, c) => n + (c.github.ok ? c.github.openPullRequests.length : 0), 0),
    overdueInvoices: companies.reduce((n, c) => n + (c.stripe.ok ? c.stripe.openInvoices.overdue : 0), 0),
    stripeConnected: companies.filter((c) => c.stripe.ok).length,
    githubConnected: companies.filter((c) => c.github.ok).length,
  };
}

// ---------------------------------------------------------------------------
// Claude
// ---------------------------------------------------------------------------

function systemPrompt(config, status) {
  const who = config.mode === "master"
    ? `the holding company Joslin Enterprises Inc. and all of its companies:\n${config.companies.map((c) => `- ${c.name}: ${c.context}`).join("\n")}`
    : `${config.company.name}. ${config.company.context}`;
  return [
    `You are Jarvis, the operations chief of staff for ${who}`,
    "",
    "You work from the live snapshot below (Stripe and GitHub, read moments ago). Rules:",
    "- Use only numbers that appear in the snapshot. Never invent revenue, customers, or deals.",
    "- If a source has ok:false, say it isn't connected and what to set up; don't guess around it.",
    "- Stripe 'test' mode means test data: say so before quoting any figure from it.",
    "- You can read but not act: you cannot send payments, merge code, email anyone, or change anything. Never say you did.",
    "- Sales and marketing advice must be concrete and specific to this business: a named action, who it's for, and why now.",
    "- No investment, tax, or legal advice; point to a professional for those.",
    "- Plain, direct language. No hype.",
    "",
    "Snapshot (JSON):",
    JSON.stringify(status),
  ].join("\n");
}

const BRIEFING_ASK = `Write today's briefing in Markdown, under 300 words, with exactly these sections:
## Top 3 priorities today
## Revenue
## Dev status
## Sales & marketing moves
Priorities should be ranked by impact. Under Sales & marketing, give 2 or 3 specific actions.`;

const MASTER_BRIEFING_ASK = `Write today's holding-company briefing in Markdown, under 400 words, with exactly these sections:
## Top 3 priorities across the companies
## Revenue by company
## Dev status by company
## Sales & marketing moves
## Needs your decision
Name the company on every line. Rank priorities by impact across the whole group.`;

async function callClaude(config, system, messages, maxTokens) {
  if (!config.anthropicKey) throw Object.assign(new Error("ANTHROPIC_API_KEY isn't set."), { status: 503 });
  const res = await fetch(ANTHROPIC, {
    method: "POST",
    headers: {
      "x-api-key": config.anthropicKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({ model: config.model, max_tokens: maxTokens, system, messages }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const status = res.status === 429 ? 429 : res.status === 401 ? 500 : 502;
    const msg = res.status === 401 ? "The Anthropic API key was rejected." : data?.error?.message || `Claude ${res.status}`;
    throw Object.assign(new Error(msg), { status });
  }
  return (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
}

export async function writeBriefing(config, status) {
  const ask = config.mode === "master" ? MASTER_BRIEFING_ASK : BRIEFING_ASK;
  return callClaude(config, systemPrompt(config, status), [{ role: "user", content: ask }], 1600);
}

function cleanMessages(messages) {
  if (!Array.isArray(messages)) return [];
  const out = messages
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-12)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}

export async function answer(config, status, messages) {
  const clean = cleanMessages(messages);
  if (!clean.length || clean[clean.length - 1].role !== "user") {
    throw Object.assign(new Error("Send at least one question."), { status: 400 });
  }
  return callClaude(config, systemPrompt(config, status), clean, 1400);
}

// ---------------------------------------------------------------------------
// Request handler
// ---------------------------------------------------------------------------

function setupReport(config) {
  const companies = config.mode === "master" ? config.companies : [config.company];
  return {
    mode: config.mode,
    name: config.mode === "master" ? "Joslin Enterprises Inc." : config.company.name,
    accessCodeSet: Boolean(config.accessCode),
    claude: Boolean(config.anthropicKey),
    githubToken: Boolean(config.githubToken),
    companies: companies.map((c) => ({
      id: c.id,
      name: c.name,
      stripe: Boolean(c.stripeKey),
      repo: c.repo || null,
      ...(config.mode === "master" ? { stripeVariable: stripeEnvName(c.id) } : {}),
    })),
  };
}

/**
 * GET  -> what's configured (no values), so the page can show setup steps
 * POST { action: "status" }              -> live snapshot
 * POST { action: "brief" }               -> snapshot + Claude's briefing
 * POST { action: "ask", messages: [...] } -> snapshot + Claude's answer
 * Jarvis is open by default: with no access code set, anyone who can reach the page can use it.
 * Setting JARVIS_ACCESS_CODE locks it again, and then every POST needs that code in the
 * x-jarvis-code header.
 */
export async function handleJarvis(req, config) {
  if (req.method === "GET") return { status: 200, body: setupReport(config) };
  if (req.method !== "POST") return { status: 405, body: { error: "Use GET or POST." } };
  if (config.accessCode) {
    const given = header(req.headers, "x-jarvis-code");
    if (!given || !sameSecret(given, config.accessCode)) {
      return { status: 401, body: { error: "Wrong or missing access code." } };
    }
  }
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const action = body?.action || "status";
  if (!["status", "brief", "ask"].includes(action)) return { status: 400, body: { error: "Unknown action." } };
  try {
    const status = await gatherStatus(config);
    if (action === "status") return { status: 200, body: { status } };
    if (action === "brief") return { status: 200, body: { status, briefing: await writeBriefing(config, status) } };
    return { status: 200, body: { status, reply: await answer(config, status, body.messages) } };
  } catch (err) {
    return { status: err.status || 500, body: { error: String(err.message || "Jarvis failed.").slice(0, 300) } };
  }
}

// Proves that someone controls a product's website.
//
// POST { slug, key }                     → owner check: looks for the product's verify token on the site
// POST { slug, recover: { token, secret } } → lost key: looks for the recovery token, returns a new owner key
// POST { slug, key, repo: true }          → GitHub: the product's site links to the repo, or the repo holds the token
//
// The token can be published either as
//   <meta name="expanse-verification" content="TOKEN"> on the home page (or the product URL), or
//   a text file at https://DOMAIN/.well-known/expanse-verification.txt containing TOKEN.
//
// Only the product's own domain (from the database, never from the request) is fetched, over
// https on the default port, with a short timeout, a size cap and same-site redirects only.
import postgres from "npm:postgres@3.4.5";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 2, idle_timeout: 20 });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, apikey, authorization, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const MAX_BYTES = 512 * 1024;
const sameSite = (host: string, domain: string) => host.toLowerCase().replace(/^www\./, "") === domain;

async function fetchText(url: string, domain: string, hops = 0): Promise<string | null> {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== "https:" || (u.port && u.port !== "443") || !sameSite(u.hostname, domain)) return null;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(u, {
      redirect: "manual",
      signal: ctl.signal,
      headers: { "User-Agent": "ExpanseVerifier/1.0 (+https://expanse.nyttolabs.com)", Accept: "text/html,text/plain;q=0.9,*/*;q=0.1" },
    });
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get("location");
      await r.body?.cancel();
      return loc && hops < 3 ? fetchText(new URL(loc, u).toString(), domain, hops + 1) : null;
    }
    if (!r.ok || !r.body) { await r.body?.cancel(); return null; }
    const reader = r.body.getReader();
    const parts: Uint8Array[] = [];
    let n = 0;
    while (n < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      parts.push(value);
      n += value.length;
    }
    reader.cancel().catch(() => {});
    const buf = new Uint8Array(Math.min(n, MAX_BYTES));
    let off = 0;
    for (const p of parts) { const take = Math.min(p.length, buf.length - off); buf.set(p.subarray(0, take), off); off += take; if (off >= buf.length) break; }
    return new TextDecoder().decode(buf);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function metaTokens(html: string): string[] {
  const out: string[] = [];
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    if (!/name\s*=\s*["']?expanse-verification["'\s>\/]/i.test(tag)) continue;
    const m = tag.match(/content\s*=\s*["']?([^"'\s>]+)/i);
    if (m) out.push(m[1]);
  }
  return out;
}

async function siteHasToken(domain: string, url: string, token: string): Promise<"found" | "missing" | "unreachable"> {
  let reached = false;
  const file = await fetchText(`https://${domain}/.well-known/expanse-verification.txt`, domain);
  if (file !== null) {
    reached = true;
    if (file.split(/\s+/).includes(token)) return "found";
  }
  for (const page of new Set([`https://${domain}/`, url])) {
    const html = await fetchText(page, domain);
    if (html === null) continue;
    reached = true;
    if (metaTokens(html).includes(token)) return "found";
  }
  return reached ? "missing" : "unreachable";
}

// Raw files from the repo's default branch (only raw.githubusercontent.com, small and quick).
async function fetchRaw(repo: string, path: string): Promise<string | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(`https://raw.githubusercontent.com/${repo}/HEAD/${path}`, { redirect: "error", signal: ctl.signal, headers: { "User-Agent": "ExpanseVerifier/1.0 (+https://expanse.nyttolabs.com)" } });
    if (!r.ok) { await r.body?.cancel(); return null; }
    return (await r.text()).slice(0, 4096);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const reEscape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// A repo counts as the product's when the product's own site links to it, or the repo publishes the verify token.
async function repoLinked(domain: string, url: string, repo: string, token: string): Promise<"found" | "missing" | "unreachable"> {
  const link = new RegExp(`github\\.com/${reEscape(repo)}(?:\\.git)?(?=["'/?#\\s<]|$)`, "i");
  let reached = false;
  for (const page of new Set([`https://${domain}/`, url])) {
    const html = await fetchText(page, domain);
    if (html === null) continue;
    reached = true;
    if (link.test(html)) return "found";
  }
  for (const path of [".well-known/expanse-verification.txt", "expanse-verification.txt"]) {
    const file = await fetchRaw(repo, path);
    if (file !== null && file.split(/\s+/).includes(token)) return "found";
  }
  return reached ? "missing" : "unreachable";
}

const KNOWN = new Set(["bad_key", "bad_recovery", "slow_down", "no_repo"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return reply({ ok: false, reason: "method" }, 405);

  let body: { slug?: unknown; key?: unknown; repo?: unknown; recover?: { token?: unknown; secret?: unknown } };
  try { body = await req.json(); } catch { return reply({ ok: false, reason: "bad_request" }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return reply({ ok: false, reason: "bad_request" }, 400);
  const slug = typeof body.slug === "string" && /^[a-z0-9-]{1,48}$/.test(body.slug) ? body.slug : null;
  if (!slug) return reply({ ok: false, reason: "bad_request" }, 400);

  try {
    if (body.recover) {
      const token = String(body.recover.token ?? ""), secret = String(body.recover.secret ?? "");
      if (!/^expanse-recover-[a-f0-9]{16}$/.test(token) || secret.length < 10 || secret.length > 64) {
        return reply({ ok: false, reason: "bad_recovery" }, 400);
      }
      const [{ t }] = await sql`select public._recovery_target(${slug}, ${token}, ${secret}) as t`;
      const result = await siteHasToken(t.domain, t.url, token);
      if (result !== "found") return reply({ ok: false, reason: result, domain: t.domain });
      const [{ key }] = await sql`select public._complete_recovery(${slug}, ${token}) as key`;
      return reply({ ok: true, key });
    }

    const key = typeof body.key === "string" ? body.key : "";
    if (key.length < 10 || key.length > 64) return reply({ ok: false, reason: "bad_key" }, 400);
    if (body.repo === true) {
      const [{ t }] = await sql`select public._repo_target(${slug}, ${key}) as t`;
      const result = await repoLinked(t.domain, t.url, t.repo, t.token);
      if (result !== "found") return reply({ ok: false, reason: result, domain: t.domain, repo: t.repo });
      const [{ at }] = await sql`select public._mark_repo_verified(${slug}, ${t.repo}) as at`;
      await sql`select public._kick_worker('releases')`.catch(() => {});
      return reply({ ok: true, repo: t.repo, repo_verified_at: at });
    }
    const [{ t }] = await sql`select public._verify_target(${slug}, ${key}) as t`;
    const result = await siteHasToken(t.domain, t.url, t.token);
    if (result !== "found") return reply({ ok: false, reason: result, domain: t.domain });
    const [{ at }] = await sql`select public._mark_verified(${slug}) as at`;
    return reply({ ok: true, verified_at: at });
  } catch (e) {
    const msg = String((e as { message?: string })?.message ?? "");
    if (KNOWN.has(msg)) return reply({ ok: false, reason: msg }, msg === "slow_down" ? 429 : 403);
    console.error(e);
    return reply({ ok: false, reason: "error" }, 500);
  }
});


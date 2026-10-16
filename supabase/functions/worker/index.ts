// Background jobs for Expanse. pg_cron calls this every 10 minutes (see the worker_cron migration),
// and the database calls it right away when an email is queued.
//
// POST { task: "all" | "review" | "mail" | "embed" | "health" | "releases", wait?: boolean }   header x-worker-secret: <Vault secret "worker_secret">
//
// - health:   daily check that each product's website (and demo link) still answers
// - mail:     sends queued emails (review decisions, sign-in codes, admin digest) through Resend; when the plan's
//             quota is used up, the rest wait for the next day and email sign-in pauses until then
// - releases: reads the public releases feed of each connected GitHub repo every 6 hours
// - embed:    turns new or changed live profiles into embeddings for AI search (gte-small, inside Supabase)
// - review:   mail + embed, run right after an admin decision
//
// Only the database decides what to fetch or send; the request only picks which jobs run.
import postgres from "npm:postgres@3.4.5";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 3, idle_timeout: 20 });
const FROM = "Expanse <expanse@nyttolabs.com>";
const UA = "ExpanseBot/1.0 (+https://expanse.nyttolabs.com; link check)";
const HOST = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/i;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// The Resend key lives in Vault (name "resend_api_key"), next to the worker secret. Read on every run,
// so replacing it in Vault takes effect at once.
async function resend(): Promise<string> {
  const rows = await sql`select decrypted_secret from vault.decrypted_secrets where name = 'resend_api_key'`;
  return rows.length ? String(rows[0].decrypted_secret ?? "") : "";
}

async function authorized(req: Request): Promise<boolean> {
  const s = req.headers.get("x-worker-secret") ?? "";
  if (s.length < 16 || s.length > 200) return false;
  const rows = await sql`select decrypted_secret = ${s} as ok from vault.decrypted_secrets where name = 'worker_secret'`;
  return rows.length === 1 && rows[0].ok === true;
}

/* ---------- health: does the website / demo still answer? ---------- */

type Probe = { ok: boolean; status: string };

// Follows up to 5 redirects, https only, to public host names; reads no body.
async function probe(url: string, good: (status: number) => boolean): Promise<Probe> {
  let next = url;
  for (let hop = 0; hop < 6; hop++) {
    let u: URL;
    try { u = new URL(next); } catch { return { ok: false, status: "bad_url" }; }
    if (u.protocol !== "https:" || !HOST.test(u.hostname) || (u.port && u.port !== "443")) return { ok: false, status: "bad_redirect" };
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 10000);
    try {
      const r = await fetch(u, { redirect: "manual", signal: ctl.signal, headers: { "User-Agent": UA, Accept: "text/html,*/*;q=0.8" } });
      await r.body?.cancel().catch(() => {});
      const loc = r.headers.get("location");
      if (r.status >= 300 && r.status < 400 && loc) { next = new URL(loc, u).toString(); continue; }
      return { ok: good(r.status), status: "http_" + r.status };
    } catch {
      return { ok: false, status: ctl.signal.aborted ? "timeout" : "unreachable" };
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, status: "too_many_redirects" };
}

// A site behind bot protection (401/403/429) still exists; a demo only counts as working on a 2xx.
const siteUp = (s: number) => s < 400 || s === 401 || s === 403 || s === 405 || s === 429;
const demoWorks = (s: number) => s >= 200 && s < 300;

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const t = items[i++]; try { await fn(t); } catch (e) { console.error(e); } }
  }));
}

async function health(limit = 20) {
  const [{ due }] = await sql`select public._health_due(${limit}) as due`;
  let up = 0, down = 0;
  await pool(due as { id: number; url: string; demo_url: string }[], 5, async (p) => {
    const site = await probe(p.url, siteUp);
    const demo = p.demo_url ? await probe(p.demo_url, demoWorks) : null;
    await sql`select public._health_record(${p.id}, ${site.ok}, ${site.status}, ${demo ? demo.ok : null}, ${demo ? demo.status : null})`;
    site.ok ? up++ : down++;
  });
  return { checked: up + down, down };
}

/* ---------- releases: GitHub's public Atom feed, no API token needed ---------- */

const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos|#39);/gi, (_, e: string) => {
  const k = e.toLowerCase();
  if (k[0] === "#") { const n = k[1] === "x" ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ""; }
  return ({ lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" } as Record<string, string>)[k] ?? "";
});
const tagText = (xml: string, tag: string) => (xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)) || [])[1] ?? "";

type Release = { tag: string; title: string; url: string; at: string; notes: string };

// The newest 10 entries: tag (from the release link), title, link, date and the start of the notes as plain text.
function parseFeed(xml: string): Release[] {
  return xml.split("<entry>").slice(1, 11).map((e) => {
    const url = decode((e.match(/<link[^>]*href="([^"]+)"/) || [])[1] ?? "");
    let tag = "";
    try { tag = decodeURIComponent(url.split("/releases/tag/")[1] ?? "").slice(0, 120); } catch { /* malformed link */ }
    const html = decode(tagText(e, "content"));
    const notes = decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim().slice(0, 280);
    return { tag, title: decode(tagText(e, "title")).trim().slice(0, 160), url, at: tagText(e, "updated").trim(), notes };
  }).filter((x) => x.tag && x.url.startsWith("https://github.com/") && !isNaN(Date.parse(x.at)));
}

async function feed(repo: string): Promise<Release[] | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10000);
  try {
    const r = await fetch(`https://github.com/${repo}/releases.atom`, { signal: ctl.signal, headers: { "User-Agent": UA, Accept: "application/atom+xml" } });
    if (new URL(r.url).hostname !== "github.com") { await r.body?.cancel(); return null; }
    if (r.status === 404) { await r.body?.cancel(); return []; }
    if (!r.ok) { await r.body?.cancel(); return null; }
    return parseFeed((await r.text()).slice(0, 512 * 1024));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function releases(limit = 15) {
  const [{ due }] = await sql`select public._releases_due(${limit}) as due`;
  let checked = 0, added = 0;
  await pool(due as { id: number; repo: string }[], 4, async (p) => {
    const items = await feed(p.repo);
    if (items === null) return; // try again next run
    const [{ n }] = await sql`select public._releases_record(${p.id}, ${p.repo}, ${sql.json(items as unknown as postgres.JSONValue)}) as n`;
    checked++; added += Number(n) || 0;
  });
  return { checked, added };
}

/* ---------- embed: vectors for AI search ---------- */

// deno-lint-ignore no-explicit-any
let embedder: any = null;
async function vec(text: string): Promise<string> {
  // deno-lint-ignore no-explicit-any
  embedder ??= new (globalThis as any).Supabase.ai.Session("gte-small");
  const v = await embedder.run(text, { mean_pool: true, normalize: true }) as number[];
  return "[" + Array.from(v).join(",") + "]";
}

async function embed(limit = 15) {
  const [{ due }] = await sql`select public._embed_due(${limit}) as due`;
  let embedded = 0;
  for (const p of due as { id: number; hash: string; text: string; needs: string[] }[]) {
    const needs: string[] = [];
    for (const n of p.needs) needs.push(await vec(n));
    await sql`select public._embed_record(${p.id}, ${p.hash}, ${await vec(p.text)}, ${sql.array(needs)}::text[])`;
    embedded++;
  }
  return { embedded };
}

/* ---------- mail ---------- */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
function toHtml(text: string): string {
  const paras = esc(text).split(/\n{2,}/).map((p) =>
    `<p style="margin:0 0 14px">${p.replace(/https:\/\/[^\s<]+/g, (u) => `<a href="${u}" style="color:#1a5fff">${u}</a>`).replace(/\n/g, "<br>")}</p>`);
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f6fb"><div style="max-width:560px;margin:0 auto;padding:28px;background:#fff;border-radius:16px;font:15px/1.55 -apple-system,'Segoe UI',Helvetica,Arial,sans-serif;color:#141a33">${paras.join("")}</div></body></html>`;
}

async function mail() {
  await sql`select public._admin_digest()`;
  const key = await resend();
  if (!key) return { sent: 0, skipped: "no resend_api_key in Vault" };
  const [{ due }] = await sql`select public._outbox_claim(20) as due`;
  let sent = 0, failed = 0, held = 0, quota = false;
  for (const m of due as { id: number; to: string; subject: string; body: string; reply_to: string | null }[]) {
    // Resend's daily/monthly quota is used up: hold the rest until the next UTC day instead of failing them.
    if (quota) { await sql`select public._outbox_defer(${m.id})`; held++; continue; }
    let ok = false, error = "";
    try {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": `expanse-outbox-${m.id}` },
        body: JSON.stringify({ from: FROM, to: [m.to], subject: m.subject, text: m.body, html: toHtml(m.body), ...(m.reply_to ? { reply_to: m.reply_to } : {}) }),
      });
      ok = r.ok;
      if (!ok) {
        const t = (await r.text()).slice(0, 300);
        if (r.status === 429 && /quota/i.test(t)) { quota = true; await sql`select public._outbox_defer(${m.id})`; held++; continue; }
        error = `resend ${r.status}: ${t.slice(0, 200)}`;
      } else await r.body?.cancel().catch(() => {});
    } catch (e) {
      error = String((e as Error)?.message ?? e).slice(0, 200);
    }
    await sql`select public._outbox_done(${m.id}, ${ok}, ${error})`;
    ok ? sent++ : failed++;
  }
  return quota ? { sent, failed, held, quota: true } : { sent, failed };
}

/* ---------- entry ---------- */

const JOBS: Record<string, () => Promise<unknown>> = { mail, embed: () => embed(), health: () => health(), releases: () => releases() };
const GROUPS: Record<string, string[]> = { all: ["mail", "embed", "health", "releases"], review: ["mail", "embed"] };

async function run(task: string) {
  const names = GROUPS[task] ?? [task];
  const out: Record<string, unknown> = { at: new Date().toISOString(), task };
  for (const n of names) {
    try { out[n] = await JOBS[n](); } catch (e) { console.error(n, e); out[n] = { error: String((e as Error)?.message ?? e).slice(0, 200) }; }
  }
  await sql`select public._set_setting('worker_last_run', case when jsonb_typeof(public._setting('worker_last_run')) = 'object' then public._setting('worker_last_run') else '{}'::jsonb end || ${sql.json(out as postgres.JSONValue)})`
    .catch((e) => console.error(e));
  return out;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false }, 405);
  if (!(await authorized(req))) return json({ ok: false }, 401);
  let body: { task?: unknown; wait?: unknown } = {};
  try { body = await req.json(); } catch { /* empty body: run everything */ }
  const task = typeof body.task === "string" && (Object.hasOwn(GROUPS, body.task) || Object.hasOwn(JOBS, body.task)) ? body.task : "all";
  if (body.wait === true) return json(await run(task));
  // Answer at once; the jobs keep running in the background.
  const job = run(task);
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt && typeof rt.waitUntil === "function") rt.waitUntil(job);
  return json({ ok: true, accepted: task }, 202);
});

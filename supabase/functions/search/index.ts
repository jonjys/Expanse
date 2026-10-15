// AI search: turns the visitor's words into an embedding (gte-small, run inside Supabase — nothing leaves it) and
// compares it with every live product. Only results that clearly stand out from the rest of the catalog come back,
// each with the product's stated need that is closest to what was asked.
//
// POST { q } → { results: [{ slug, score 0..1, strength: "strong" | "possible", need? }], count }
import postgres from "npm:postgres@3.4.5";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 3, idle_timeout: 20 });
// deno-lint-ignore no-explicit-any
const model = new (globalThis as any).Supabase.ai.Session("gte-small");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, apikey, authorization, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" } });

// Same words, same answer for a few minutes; and a gentle per-visitor limit.
const cache = new Map<string, { at: number; body: unknown }>();
const hits = new Map<string, { n: number; t: number }>();
function limited(ip: string): boolean {
  const now = Date.now(), h = hits.get(ip);
  if (!h || now - h.t > 60_000) { if (hits.size > 5000) hits.clear(); hits.set(ip, { n: 1, t: now }); return false; }
  return ++h.n > 40;
}

type Row = { slug: string; sim: number; need: string | null; need_sim: number | null };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return reply({ results: [] }, 405);
  let q = "";
  try { q = String((await req.json())?.q ?? ""); } catch { return reply({ results: [] }, 400); }
  q = q.replace(/\s+/g, " ").trim().slice(0, 200);
  if (q.length < 3) return reply({ results: [], count: 0 });

  const key = q.toLowerCase(), hit = cache.get(key);
  if (hit && Date.now() - hit.at < 300_000) return reply(hit.body);
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  if (limited(ip)) return reply({ results: [], reason: "slow_down" }, 429);

  try {
    const v = await model.run(q, { mean_pool: true, normalize: true }) as number[];
    const [{ r }] = await sql`select public._semantic_search(${"[" + Array.from(v).join(",") + "]"}, 30) as r`;
    // gte-small scores everything between ~0.7 and ~0.9, so a match has to stand out: from the catalog's median once
    // there are enough products, from a fixed floor before that (calibrated on unrelated product/query pairs).
    const base = r.count >= 8 ? Math.max(Number(r.median) || 0, 0.77) : 0.79;
    const results = (r.results as Row[]).map((x) => {
      const gap = x.sim - base;
      const strength = gap >= 0.03 ? "strong" : gap >= 0.025 && x.sim >= 0.8 ? "possible" : null;
      return strength && {
        slug: x.slug, strength,
        score: Math.round(Math.max(0, Math.min(1, (gap - 0.01) / 0.05)) * 1000) / 1000,
        need: x.need && (x.need_sim ?? 0) >= 0.8 ? x.need : undefined,
      };
    }).filter(Boolean).slice(0, 20);
    const body = { results, count: r.count };
    if (cache.size > 500) cache.clear();
    cache.set(key, { at: Date.now(), body });
    return reply(body);
  } catch (e) {
    console.error(e);
    return reply({ results: [], reason: "error" }, 500);
  }
});

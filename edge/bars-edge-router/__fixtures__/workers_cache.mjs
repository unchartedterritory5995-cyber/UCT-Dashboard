/**
 * A stand-in for Workers Cache in front of a named entrypoint (entry.js): what `ctx.exports.<Name>` is in
 * production. It keeps exactly what Workers Cache would keep and nothing else, so a rail can ask "was this
 * answer kept?" by asking twice and counting how often the entrypoint really ran:
 *   - only GET; never `no-store`/`private`, never a response with `Set-Cookie`, never a 206 or a 520-526;
 *   - an explicit `max-age` keeps ANY other status for that long (so a 401 marked cacheable WOULD be kept);
 *   - no Cache-Control: the documented defaults, 200/203/204 two hours, 300/301 twenty minutes, 404/410
 *     three minutes, 405/414/501 one minute, anything else not kept;
 *   - keyed by path + query (Workers Cache: no host, no cookie, no header);
 *   - fresh for max-age seconds of the injected clock, then served stale for stale-while-revalidate seconds
 *     while ONE refresh runs (Workers Cache collapses concurrent misses and refreshes the same way).
 * `ignoreMaxAge: true` makes it hand back an expired copy anyway: a cache that misbehaves, to prove the
 * gateway's own age check.
 */
const DEFAULT_TTL_S = { 200: 7200, 203: 7200, 204: 7200, 300: 1200, 301: 1200, 404: 180, 410: 180, 405: 60, 414: 60, 501: 60 };

export function cachedEntry(handler, { now = () => Date.now(), ignoreMaxAge = false } = {}) {
  const store = new Map();
  const log = { runs: 0, requests: [], revalidations: 0 };
  return {
    store, log,
    async fetch(request) {
      const req = request instanceof Request ? request : new Request(request);
      log.requests.push(req);
      const u = new URL(req.url);
      const key = u.pathname + u.search;
      const hit = req.method === "GET" ? store.get(key) : undefined;
      const age = hit ? now() - hit.at : 0;
      if (hit && (ignoreMaxAge || age < hit.maxAge * 1000)) {
        return new Response(hit.bytes.slice(), { status: hit.status, headers: hit.headers });
      }
      if (hit && age < (hit.maxAge + hit.swr) * 1000) {
        // stale-while-revalidate: the stale copy now, ONE refresh behind it (awaited here so a rail can count it)
        const stale = new Response(hit.bytes.slice(), { status: hit.status, headers: hit.headers });
        if (!hit.refreshing) {
          hit.refreshing = true;
          log.revalidations += 1;
          await this.fill(req, key);
        }
        return stale;
      }
      return this.fill(req, key);
    },
    async fill(req, key) {
      log.runs += 1;
      const res = await handler(req);
      const cc = String(res.headers.get("cache-control") || "").toLowerCase();
      const m = /max-age=(\d+)/.exec(cc);
      const w = /stale-while-revalidate=(\d+)/.exec(cc);
      const ttl = m ? Number(m[1]) : (cc ? 0 : (DEFAULT_TTL_S[res.status] || 0));
      const keep = req.method === "GET" && ttl > 0 && !/no-store|private/.test(cc) && !res.headers.get("set-cookie")
        && res.status !== 206 && !(res.status >= 520 && res.status <= 526);
      if (!keep) return res;
      const bytes = new Uint8Array(await res.arrayBuffer());
      store.set(key, { bytes, status: res.status, headers: [...res.headers], at: now(), maxAge: ttl, swr: w ? Number(w[1]) : 0 });
      return new Response(bytes.slice(), { status: res.status, headers: res.headers });
    },
  };
}

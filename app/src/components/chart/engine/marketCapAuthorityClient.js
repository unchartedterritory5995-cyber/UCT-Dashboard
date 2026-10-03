// app/src/components/chart/engine/marketCapAuthorityClient.js
//
// ─── DARK: the client-side cache for the canonical Market Cap authority ──────
//
// ⛔ NOT WIRED. Nothing imports this in production; the consumer migration is a
// separately authorized step. It exists so the cache contract is code, not prose:
//
//   * every entry is keyed by (build_id, ticker). A response from a NEW build
//     (the server's AUTHORITY pointer advanced, or rolled back) evicts every
//     entry of every other build -- a chart can never mix two builds, and can
//     never keep showing A after the server answered B;
//   * an entry is reused without asking the server for at most `revalidateMs`;
//     after that the request carries If-None-Match and a 304 keeps the entry,
//     a 200 replaces it (the server's ETag already includes build + manifest);
//   * errors are never cached, and a 404 (unknown ticker) is cached only for the
//     build that said so.
//
// `fetchImpl(url, {headers}) -> {status, headers: {get(name)}, json()}` is
// injected (window.fetch in the app, a stub in tests).

export function createMarketCapAuthorityCache({ fetchImpl, now = () => Date.now(), revalidateMs = 60_000 } = {}) {
  let build = null                    // the build every cached entry belongs to
  const entries = new Map()           // ticker -> {etag, body, at}

  function adopt(buildId) {
    if (buildId && buildId !== build) {
      entries.clear()
      build = buildId
    }
  }

  async function series(ticker) {
    const key = String(ticker || '').toUpperCase()
    const hit = entries.get(key)
    if (hit && now() - hit.at < revalidateMs) return hit.body
    const headers = hit && hit.etag ? { 'If-None-Match': hit.etag } : {}
    const r = await fetchImpl(`/api/marketcap/pit/${encodeURIComponent(key)}`, { headers, credentials: 'include' })
    const served = r.headers.get('X-MCAP-Build')
    if (r.status === 304 && hit && (!served || served === build)) {
      hit.at = now()
      return hit.body
    }
    if (r.status === 200) {
      const body = await r.json()
      adopt(body.build_id || served)
      entries.set(key, { etag: r.headers.get('ETag'), body, at: now() })
      return body
    }
    if (r.status === 404 && build) {
      entries.set(key, { etag: null, body: null, at: now() })
      return null
    }
    throw new Error(`market cap authority unavailable (${r.status})`)
  }

  return { series, build: () => build, size: () => entries.size }
}

// app/src/pages/journal-2-0/lib/smartChipsApi.js
/** Tier 2 part A: the chips' one question to the server -- which tickers does this text name
 *  (POST /api/j2/smart-chips/tickers, buzz_extract). Never throws; null means "could not check",
 *  and a chip that could not check does not appear (Review Focus 2). Cached per text, 50 entries. */
const URL_ = '/api/j2/smart-chips/tickers'
const MAX = 2000
const cache = new Map()

export const canonicalSymbol = (s) => String(s || '').trim().replace(/^\$/, '').toUpperCase().replace('.', '-')
export function __clearTickerCacheForTests() { cache.clear() }

export async function tickersIn(text, fetchImpl = globalThis.fetch) {
  const key = String(text || '').slice(0, MAX)
  if (!key.trim()) return null
  if (cache.has(key)) return cache.get(key)
  const pending = (async () => {
    try {
      const r = await fetchImpl(URL_, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: key }),
      })
      if (!r?.ok) return null
      const body = await r.json()
      return Array.isArray(body?.tickers) ? body.tickers : null
    } catch {
      return null
    }
  })()
  cache.set(key, pending)
  if (cache.size > 50) cache.delete(cache.keys().next().value)
  const out = await pending
  if (out === null) cache.delete(key)
  return out
}

export function confirmsSymbol(tickers, symbol) {
  const want = canonicalSymbol(symbol)
  return Array.isArray(tickers) && tickers.some((t) => t?.symbol === want)
}

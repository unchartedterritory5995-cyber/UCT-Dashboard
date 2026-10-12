// ── UCT Agent NL: grounded tickers ──────────────────────────────────────────────────────────
//
// Natural Language & Intent Intelligence (N1-safety, N4). Pure helpers plus ONE lookup through UCT's
// existing ticker search (/api/ticker-search, the same service unknownSymbols uses) — no second
// ticker provider, no symbol list of our own.
//
//   isPronounToken(token, raw)  "it", "this", "them"… are words, never tickers, unless the member
//                               marked the word as a ticker ($IT, or IT in capitals inside a
//                               message that has lowercase letters)
//   groundSymbols(inputs)       inputs that are NOT exact tickers are tried as an EXACT company name
//                               ("nvidia" → NVDA, "apple" → AAPL). One ticker → resolved; several →
//                               ambiguous (the member must choose); none → unknown. Never a guess.
//   groundingOf(input)          the cached verdict for one input (sync — for check/apply/describe)

// Words that point at something already in the conversation. Several are also real tickers (IT, ALL,
// ONE, ME…), which is exactly why a lowercase pronoun must never become one.
export const PRONOUNS = new Set([
  'it', 'its', 'this', 'that', 'these', 'those', 'them', 'they', 'one', 'ones', 'all', 'both', 'me', 'my',
  'mine', 'here', 'there', 'same', 'everything', 'something', 'anything', 'stuff', 'em', 'him', 'her', 'us',
])

/** Is `token` (as the member typed it) a pronoun rather than a ticker? */
export function isPronounToken(token, raw = token) {
  const t = String(token || '').trim()
  if (!t || t.startsWith('$')) return false                         // $IT: explicitly a ticker
  if (!PRONOUNS.has(t.toLowerCase())) return false
  // Capitals mark a ticker only when the member was not typing in capitals anyway.
  const marked = /^[A-Z0-9.]+$/.test(t) && /[a-z]/.test(String(raw || ''))
  return !marked
}

// ── company names ──
const SUFFIX = /\b(inc|incorporated|corp|corporation|co|company|ltd|limited|plc|holdings?|group|the|class [a-c]|common stock|ordinary shares|ads|adr|sa|nv|ag|se|lp|llc|n\.v|s\.a)\b/g
/** A company name reduced to the words that identify it ("NVIDIA Corporation" → "nvidia"). */
export function normName(s) {
  return String(s || '').toLowerCase().replace(/[.,'’&()/-]+/g, ' ').replace(SUFFIX, ' ').replace(/\s+/g, ' ').trim()
}

const VERDICTS = new Map()                                           // INPUT (upper) → verdict
const TTL_MS = 10 * 60 * 1000
export const groundingOf = (input) => {
  const v = VERDICTS.get(String(input || '').trim().toUpperCase())
  return v && Date.now() - v.at < TTL_MS ? v : null
}
/** test seam */
export const _resetGrounding = () => VERDICTS.clear()

async function search(q, fetchFn) {
  const r = await fetchFn(`/api/ticker-search?q=${encodeURIComponent(q)}&limit=20`, { credentials: 'include' })
  return r.ok ? ((await r.json()).results || []) : []
}

/**
 * Ground inputs that are not exact tickers. → { unknown: Set, ambiguous: Set, named: Set } of the
 * INPUTS (upper-case). Exact tickers are left alone (callers already validate them). A lookup failure
 * is "unknown" — the caller refuses, never guesses.
 */
export async function groundSymbols(inputs, { fetchFn = (u, o) => fetch(u, o) } = {}) {
  const out = { unknown: new Set(), ambiguous: new Set(), named: new Set() }
  await Promise.all([...new Set(inputs.map(s => String(s || '').trim()).filter(Boolean))].map(async (raw) => {
    const key = raw.toUpperCase()
    const cached = groundingOf(key)
    let v = cached
    if (!v) {
      let rows = []
      try { rows = await search(raw, fetchFn) } catch { rows = [] }
      rows = rows.filter(x => !x.delisted && !x.breadth && x.type !== 'economic' && x.ticker)
      if (rows.some(x => String(x.ticker).toUpperCase() === key)) v = { kind: 'ticker', ticker: key }
      else {
        const want = normName(raw)
        const exact = want ? rows.filter(x => x.name && normName(x.name) === want) : []
        const tickers = [...new Map(exact.map(x => [String(x.ticker).toUpperCase(), x])).values()]
        v = tickers.length === 1 ? { kind: 'name', ticker: String(tickers[0].ticker).toUpperCase(), name: tickers[0].name }
          : tickers.length > 1 ? { kind: 'ambiguous', candidates: tickers.slice(0, 5).map(x => ({ ticker: String(x.ticker).toUpperCase(), name: x.name })) }
            : { kind: 'unknown' }
      }
      VERDICTS.set(key, { ...v, input: raw, at: Date.now() })
    }
    if (v.kind === 'name') out.named.add(key)
    else if (v.kind === 'ambiguous') out.ambiguous.add(key)
    else if (v.kind === 'unknown') out.unknown.add(key)
  }))
  return out
}

/** The ticker an input stands for (itself, or the company it names), for apply. */
export function resolvedTicker(input) {
  const key = String(input || '').trim().toUpperCase().replace(/^\$/, '')
  const v = groundingOf(key)
  return v?.kind === 'name' ? v.ticker : key
}

/** "AAPL (Apple Inc.) or APLE (Apple Hospitality REIT)" — for a clarifying refusal. */
export function candidatesText(input) {
  const v = groundingOf(input)
  const list = (v?.candidates || []).map(c => (c.name ? `${c.ticker} (${c.name})` : c.ticker))
  return list.length <= 1 ? list.join('') : `${list.slice(0, -1).join(', ')} or ${list[list.length - 1]}`
}

// ── UCT Agent PRODUCT GUIDE: a member's own list, named, read as a list ──────────────────────────────────────
//
// "add NVDA to Momentum", "my swing ideas list": the walkthrough is the same as for "my watchlist". The names are the
// member's REAL lists, read at run time from the host's watchlist store (host.watchlists.snapshot, a read): nothing here
// knows any list's name. A name counts as a list only where the words USE it as one — after "to / from / in / into / on /
// onto / of / out of", or followed by "list" / "watchlist" — so a list called "Momentum" leaves "momentum indicators" alone.
// The words are rewritten for routing only ("… to my watchlist"); nothing is written anywhere.

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const LIST_WORD = /\b(watch ?lists?|lists?)\b/i

/** The names of the member's own lists, or [] (no store, nothing loaded). */
export function listNamesOf(host) {
  let rows = []
  try { rows = host?.watchlists?.snapshot?.() || [] } catch { rows = [] }
  return [...new Set(rows.map(r => String(r?.name || '').trim()).filter(n => n.length >= 2 && !LIST_WORD.test(n)))]
    .sort((a, b) => b.length - a.length)   // the longer name first: "Swing Ideas 2" before "Swing Ideas"
}

// "my Swing Ideas list" → "my watchlist", but never a name mid-word ("BigMomentum list"): with no my / the / this / our before
// it, the character before the name must not be a letter or digit. Tested on the text, never a regex lookbehind (Safari
// < 16.4 cannot parse one: agentNoLookbehindStrings); a vetoed match resumes one character on, as the engine did
// (agentGuideListRefsNoLookbehind holds old and new equal).
function replaceNamed(q, re) {
  let out = '', i = 0, m
  re.lastIndex = 0
  while ((m = re.exec(q))) {
    const at = m.index
    if (!m[1] && at > 0 && /[a-z0-9]/i.test(q[at - 1])) { re.lastIndex = at + 1; continue }
    out += q.slice(i, at) + 'my watchlist'
    i = at + m[0].length
    re.lastIndex = i
  }
  return out + q.slice(i)
}

/** The words with each named list read as "my watchlist" where they use it as a list → the words (unchanged if none). */
export function withListRefs(text, names) {
  let q = String(text || '')
  if (!names?.length || !q) return q
  for (const name of names) {
    const n = esc(name).replace(/\s+/g, '\\s+')
    // "to Momentum", "from my Swing Ideas", "in the Q4 Leaders list", "out of Momentum"
    const after = new RegExp(`\\b(to|from|in|into|on|onto|of|out of)\\s+(?:(?:my|the|this|our)\\s+)?${n}(?:\\s+(?:watch ?)?list)?(?=$|[^a-z0-9])`, 'gi')
    // "my Swing Ideas list", "the Momentum watchlist"
    const named = new RegExp(`(\\b(?:my|the|this|our)\\s+)?${n}\\s+(?:watch ?)?list\\b`, 'gi')
    q = replaceNamed(q.replace(after, (_m, prep) => `${prep} my watchlist`), named)
  }
  return q
}

// ⭐ On Charts a COLUMN belongs to a list widget only (a Watchlist, or a scan, which says so), and a note on a TICKER only to a
// list's row (the chart's own Text Note is a drawing). Said without the word "list", they still mean the member's list.
const COLUMN = /\bcolumns?\b/i
const NOT_LIST_COLUMN = /\b(scan\w*|screen\w*|indicators?|breadth|grid|table|calendar|flow)\b/i
const TICKER_NOTE = /\bnotes?\b.*\b(on|for|about|to)\s+(?:(?:an?|the|this|that|my|one)\s+)?(tickers?|stocks?|symbols?)\b|\b(ticker|stock|symbol)(?:'s|’s)?\s+notes?\b/i
const NOT_TICKER_NOTE = /\b(text note|drawing|chart|notebook|journal|headline|news)\b/i

/** The words, with "in my watchlist" added where they speak of a list's column or a ticker's note without naming a list. */
export function withListContext(text) {
  const q = String(text || '')
  if (LIST_WORD.test(q)) return q
  if (COLUMN.test(q) && !NOT_LIST_COLUMN.test(q)) return `${q} in my watchlist`
  if (TICKER_NOTE.test(q) && !NOT_TICKER_NOTE.test(q)) return `${q} in my watchlist`
  return q
}

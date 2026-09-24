/**
 * The quick switcher's half of the global command palette: find ANY note by
 * title as the member types, and decide where those rows sit among the
 * palette's other results.
 *
 * ⛔ The palette is app-wide and its first job is securities. A member who
 * types "nvda" and presses Enter has always landed on NVDA's research page, and
 * a note called "NVDA thesis" must never quietly take that Enter away — so the
 * ORDERING is a rule written down here, with a rail, not an accident of which
 * request answered first.
 *
 * The server does the ranking (`GET /api/j2/notes/switcher`,
 * `notes.py::switcher_search`); this file never re-ranks note titles, it only
 * places them. One authority over "which note is the best match".
 *
 * ⛔ AND IT NEVER RESTATES A SERVER RULE (review S3). Where a row sits among
 * tickers is read from the row's own `strong` and `exact` flags, which the
 * server derives from its tier numbers — this file used to keep its own copy of
 * "tier 2 and below", commented "mirrors notes.py", which is a promise and not
 * a rail. Renumber the tiers and the flags still say the right thing.
 */

export const NOTE_SWITCHER_LIMIT = 8

export function noteSwitcherUrl(query, limit = NOTE_SWITCHER_LIMIT) {
  return `/api/j2/notes/switcher?q=${encodeURIComponent(query)}&limit=${limit}`
}

/** A note row as the palette renders it. */
export function toNoteRow(n) {
  const title = (n.title || '').trim() || 'Untitled'
  let badge = null
  if (n.isFavorite) badge = 'Favorite'
  else if (n.isRecent) badge = 'Recent'
  const row = {
    kind: 'note',
    id: n.id,
    title,
    folderPath: n.folderPath || null,
    ticker: n.ticker || null,
    badge,
    icon: n.isFavorite ? 'star-fill' : 'document',
    matchTier: typeof n.matchTier === 'number' ? n.matchTier : null,
    // The server's placement flags: IS / STARTS WITH / a WORD STARTS WITH the
    // query (strong), and IS the query, case aside (exact).
    strong: n.strong === true,
    exact: n.exact === true,
  }
  row.context = noteContextLine(row)
  return row
}

/**
 * A short ticker-shaped query ("nvda", "amd", "brk.b") is treated as a SYMBOL
 * first: the ticker rows — including the synthetic "Go to NVDA" row that lets
 * Enter work before any request answers — stay above the notes, UNLESS the
 * ticker search has answered with no ticker that IS the query and a note title
 * IS it ("Plan", "Ideas", "Q3"): then that note is the Enter target (S5).
 * Longer or multi-word queries ("q3 thesis", "earnings recap") are treated as
 * a note search first, below only an EXACT ticker hit.
 */
export function tickerLeads(qUpper, tickerLike) {
  return Boolean(qUpper) && qUpper.length <= 5 && tickerLike.test(qUpper)
}

/**
 * Final palette order.
 *   commands  — explicit notebook commands ("new note", "trash")
 *   keyword   — favourites / recents asked for BY NAME ("recent", "favorite")
 *   then, for a ticker-shaped query: every ticker row, then notes — except
 *   that once the ticker search has answered (`tickersSettled`) with no ticker
 *   that IS the query, a note whose title IS the query leads;
 *   otherwise: an exact ticker hit, then strong note matches, then the other
 *   ticker rows, then the weaker note matches.
 * A note already listed as a keyword row is never listed twice.
 *
 * ⛔ Before the ticker search answers, the ticker rows lead whatever the notes
 * said: the zero-network "Go to NVDA" row is what makes Enter work instantly,
 * and "which request answered first" must never decide where Enter goes.
 */
export function orderPaletteRows({
  commands = [], keywordNotes = [], tickers = [], noteMatches = [], qUpper = '', tickerLead = false,
  tickersSettled = false,
}) {
  const seen = new Set(keywordNotes.map((r) => r.id))
  const notes = noteMatches.filter((r) => !seen.has(r.id))
  const exact = tickers.filter((t) => !t._typed && String(t.ticker).toUpperCase() === qUpper)
  if (tickerLead) {
    const exactNote = tickersSettled && !exact.length ? notes.find((n) => n.exact) : null
    if (exactNote) {
      return [...commands, ...keywordNotes, exactNote, ...tickers, ...notes.filter((n) => n !== exactNote)]
    }
    return [...commands, ...keywordNotes, ...tickers, ...notes]
  }
  const restTickers = tickers.filter((t) => !exact.includes(t))
  const strong = notes.filter((n) => n.strong)
  const weak = notes.filter((n) => !n.strong)
  return [...commands, ...keywordNotes, ...exact, ...strong, ...restTickers, ...weak]
}

/** The query as the switcher reads it: lower-cased, whitespace collapsed —
 *  the same normalisation `switcher_search` applies before matching. */
export function normalizeSwitcherQuery(q) {
  return String(q || '').toLowerCase().split(/\s+/).filter(Boolean).join(' ')
}

/**
 * N1: the server answered `prefixExhausted` for `exhausted` — no note matches it
 * or ANY longer query that starts with it (the server only claims this when its
 * own matching rules make it true). While the member keeps typing onto it there
 * is nothing to ask; a backspace past it asks again.
 */
export function extendsExhausted(exhausted, query) {
  return Boolean(exhausted) && normalizeSwitcherQuery(query).startsWith(exhausted)
}

/**
 * [before, match, after] around the first case-insensitive occurrence of the
 * query in the title, for bolding what matched. No match: the title alone.
 */
export function splitTitleMatch(title, query) {
  const q = (query || '').trim().toLowerCase()
  const t = title || ''
  if (!q) return [t, '', '']
  const at = t.toLowerCase().indexOf(q)
  if (at < 0) return [t, '', '']
  return [t.slice(0, at), t.slice(at, at + q.length), t.slice(at + q.length)]
}

/** The line under a note's title: where it lives, and which security.
 *  "Unfiled" is a real place in the sidebar, so it is named rather than left
 *  blank — a blank line reads as "we don't know where this is". */
export function noteContextLine(row) {
  return [row.folderPath || 'Unfiled', row.ticker ? `$${row.ticker}` : null].filter(Boolean).join(' · ')
}

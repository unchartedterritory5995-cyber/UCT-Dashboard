// TAS — Time & Sales: the pure half (no React, no network), so the rules are tested alone.
//
// The server (api/routers/time_and_sales.py) sends prints oldest first as
//   { seq, t (epoch ms), p (price), s (shares), d ('up'|'down'|'zup'|'zdown'|''),
//     b (0 ordinary | 1 large | 2 block), o (1 = odd lot, under 100 shares), c (condition codes) }
// and the panel shows them NEWEST first, at most TAS_CAP, never the same seq twice.
//
// ⛔ `d` is the TICK TEST (this print's price against the previous print's), not bid / ask: no
// stock quote feed is subscribed. Every label below says "uptick" / "downtick", never "buy" /
// "sell" or "at ask" / "at bid", because that is what was measured.

/** The most prints the panel holds; the server's ring is the same size. */
export const TAS_CAP = 200

/** Merge a batch (oldest first) into the shown list (newest first), deduplicated by seq, capped. */
export function mergePrints(shown, incoming, cap = TAS_CAP) {
  const have = new Set((shown || []).map((r) => r.seq))
  const fresh = (Array.isArray(incoming) ? incoming : [])
    .filter((r) => r && Number.isFinite(r.seq) && !have.has(r.seq) && have.add(r.seq))
    .sort((a, b) => b.seq - a.seq)
  return [...fresh, ...(shown || [])].sort((a, b) => b.seq - a.seq).slice(0, cap)
}

/** The snapshot's prints (oldest first) as the shown list. */
export function fromSnapshot(prints, cap = TAS_CAP) {
  return mergePrints([], prints, cap)
}

const TICK = {
  up: { label: 'Uptick', mark: '▲', tone: 'up' },
  zup: { label: 'Zero uptick', mark: '△', tone: 'up' },
  down: { label: 'Downtick', mark: '▼', tone: 'down' },
  zdown: { label: 'Zero downtick', mark: '▽', tone: 'down' },
}

/** The tick label, glyph and tone for a print's `d`. Unknown (the first print): no tone. */
export function tickOf(d) {
  return TICK[d] || { label: 'No prior print', mark: '·', tone: '' }
}

/** Size emphasis: 0 none, 1 large, 2 block. */
export function sizeLabel(b) {
  if (b === 2) return 'Block (at least $1M)'
  if (b === 1) return 'Large (at least $200K or 10,000 shares)'
  return ''
}

/** HH:MM:SS in Eastern time, for an epoch-milliseconds print time. */
export function printTimeEt(ms) {
  const n = Number(ms)
  if (!Number.isFinite(n) || n <= 0) return ''
  return new Date(n).toLocaleTimeString('en-US', {
    timeZone: 'America/New_York', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

/** Price to the cent (sub-dollar names keep four decimals). */
export function printPrice(p) {
  const n = Number(p)
  if (!Number.isFinite(n)) return ''
  return n.toLocaleString('en-US', { minimumFractionDigits: n < 1 ? 4 : 2, maximumFractionDigits: n < 1 ? 4 : 2 })
}

/** Shares with grouping. */
export function printSize(s) {
  const n = Number(s)
  return Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: 4 }) : ''
}

/** What the session line says. `session` is the server's: regular | pre | post | closed. */
export function sessionLine(session, hasPrints) {
  if (session === 'regular') return 'Market open. Prints stream live.'
  if (session === 'pre') return 'Pre-market. Prints stream live; extended-hours tape is thin.'
  if (session === 'post') return 'After hours. Prints stream live; extended-hours tape is thin.'
  if (session === 'closed') {
    return hasPrints ? "Market closed — last session's prints." : 'Market closed.'
  }
  return ''
}

/** Why the server would not open the tape (`unavailable` event's reason), in words. */
export function unavailableText(reason) {
  switch (reason) {
    case 'off': return { title: 'Time & Sales is not switched on yet.', body: 'TAS reads nothing while it is off.' }
    case 'feed_off': return { title: 'The live trade feed is not running on this server.', body: 'Time & Sales listens to the same feed as the live chart; with it off there are no prints to show.' }
    case 'symbol_cap': return { title: 'Too many different tickers are on the tape right now.', body: 'Close a TAS panel on another ticker, or try again in a minute.' }
    case 'at_capacity': return { title: 'The live tape is at capacity right now.', body: 'Try again in a minute.' }
    case 'user_cap': return { title: 'You already have the most Time & Sales panels open at once.', body: 'Close one (in this or another tab) to open this one.' }
    default: return { title: 'The live tape is not available right now.', body: '' }
  }
}

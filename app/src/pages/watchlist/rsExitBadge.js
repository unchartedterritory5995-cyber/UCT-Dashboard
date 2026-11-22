// The Watchlist's "RS Exit" cell, as pure data: what the dot says, in which colour, and the tooltip.
// The warning names are the server's own (`relative_strength.RS_EXIT_LABELS`, carried in the
// screener's `rs_exit_last` column), so the chart legend, the screener and this cell say one word.
// Mike Webster's three RS-line warnings, mildest to worst: Quick Break (amber), Quicksand (orange),
// Grateful Dead Break (red). A warning is a prompt to review a position, never an order to sell.

/** Sessions within which a warning shows as a coloured dot; an older one is a muted dash (its
 *  tooltip still names it), so a list scanned at a glance only lights up for what is current. */
export const RS_EXIT_RECENT_SESSIONS = 20

const KINDS = {
  'Quick Break': { tone: 'quick', short: 'Quick Break' },
  Quicksand: { tone: 'sand', short: 'Quicksand' },
  'Grateful Dead Break': { tone: 'dead', short: 'GD Break' },
}

const sessionsAgo = (n) => (n === 0 ? 'on the latest session' : n === 1 ? '1 session ago' : `${n} sessions ago`)
const shortAgo = (n) => (n === 0 ? 'today' : `${n}d`)

const NOTE = 'RS line vs SPY, daily bars, Mike Webster\'s method. A warning to review the position, not an order to sell.'

/**
 * `{ last, bars_ago }` (one row of /api/watchlists/rs-exit-batch) → the cell:
 *   { recent: bool, tone: 'quick'|'sand'|'dead'|null, text: string, title: string }
 * `text` is the visible label ('' when there is nothing to show), `title` the tooltip.
 */
export function rsExitBadge(entry) {
  const last = entry?.last || null
  const ago = Number.isInteger(entry?.bars_ago) && entry.bars_ago >= 0 ? entry.bars_ago : null
  const kind = last ? KINDS[last] : null
  if (!kind || ago == null) {
    return { recent: false, tone: null, text: '', title: entry ? 'No RS exit warning in the stored window' : '' }
  }
  const title = `${last}, ${sessionsAgo(ago)}. ${NOTE}`
  if (ago > RS_EXIT_RECENT_SESSIONS) return { recent: false, tone: null, text: '', title }
  return { recent: true, tone: kind.tone, text: `${kind.short} · ${shortAgo(ago)}`, title }
}

/** Sort value: newer warnings first on the column's first (descending) click; no warning sinks. */
export function rsExitSortValue(entry) {
  const b = rsExitBadge(entry)
  return b.recent ? -entry.bars_ago : null
}

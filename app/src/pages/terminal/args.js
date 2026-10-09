// UCT Terminal — the ARGUMENTS a function honours (TERMINAL-NEXT V6a).
//
// parseCommand stores every token after the code in `args`. Before this module the shell
// read none of them: `NVDA GP W` drew a daily chart and `CAL TODAY` opened the calendar on
// nothing in particular, both in silence — the exact thing parseCommand's "never silent" rule
// forbids. Now a variant DECLARES what it takes (`args: [{ kind, prop | param }]` in
// functions.js) and `applyArgs` answers, for every token, either APPLIED or NOT APPLIED.
// The shell echoes both; nothing typed is dropped without a word.
//
// ⛔ A kind's accepted values are not invented here when an owner already publishes them:
// `TIMEFRAMES` is pinned to StockChart's own `TF_WM_LABELS` keys by functions.rail.test.js.
import { todayIso } from '../calendar/earningsModalRow'
import { currentWeekMonday, mondayOf } from '../calendar/weekAnchor'
import { canonicalCode, isCode } from './functions'

/** The chart's timeframe codes (StockChart `tf`), with the spellings a member types. */
export const TIMEFRAMES = {
  D: 'D', W: 'W', M: 'M',
  DAILY: 'D', WEEKLY: 'W', MONTHLY: 'M', '1D': 'D', '1W': 'W', '1MO': 'M',
  1: '1', 5: '5', 15: '15', 30: '30', 60: '60', '1H': '60', H: '60', '1MIN': '1', '5MIN': '5',
  '15MIN': '15', '30MIN': '30',
}

function shiftIso(iso, days) {
  const d = new Date(`${iso}T12:00:00`)
  if (Number.isNaN(d.getTime())) return null
  d.setDate(d.getDate() + days)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** `YYYY-MM-DD` shape is not enough — native `Date` auto-rolls an impossible day
 *  (`2026-02-30` becomes 2026-03-02) rather than rejecting it. Parse the three parts and
 *  confirm the Date round-trips to the SAME y/m/d; a rollover means it was never real. */
function isRealIsoDate(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(`${iso}T12:00:00`)
  if (Number.isNaN(dt.getTime())) return false
  return dt.getFullYear() === y && dt.getMonth() + 1 === m && dt.getDate() === d
}

/** The comparison windows `lookback` accepts (REL, CORR). Each panel draws every one of them, and
 *  says so out loud for anything else (panels/RelPanel.jsx, panels/CorrPanel.jsx; railed). */
export const LOOKBACK_WINDOWS = Object.freeze(['1M', '3M', '6M', '1Y', '2Y', 'YTD'])
/** The cadences `cadence` accepts (RRG's daily or weekly closes; panels/RrgPanel.jsx RRG_CADENCES). */
export const CADENCES = Object.freeze(['D', 'W'])

/**
 * Each kind: `parse(token, ctx)` → a value or null (not this kind), `describe(value)` → the
 * echo text, and `takes` → what to tell a member whose token did not fit.
 * A calendar value is an object of URL params; `null` in it means "remove that param".
 */
export const ARG_KINDS = {
  timeframe: {
    takes: 'a timeframe (D, W, M, 1, 5, 15, 30, 60)',
    parse: (tok) => TIMEFRAMES[String(tok).toUpperCase()] ?? null,
    describe: (v) => `timeframe ${v}`,
  },
  calendarDay: {
    takes: 'TODAY, NEXT, PREV or a date (YYYY-MM-DD)',
    parse: (tok, ctx = {}) => {
      const t = String(tok).toUpperCase()
      const today = ctx.today || todayIso()
      const thisWeek = currentWeekMonday(today)
      if (t === 'TODAY') return { week: null, d: today }
      if (t === 'NEXT' || t === 'PREV') {
        const w = thisWeek && shiftIso(thisWeek, t === 'NEXT' ? 7 : -7)
        return w ? { week: w, d: null } : null
      }
      if (/^\d{4}-\d{2}-\d{2}$/.test(tok) && isRealIsoDate(tok) && mondayOf(tok)) {
        return { week: mondayOf(tok) === thisWeek ? null : mondayOf(tok), d: tok }
      }
      return null
    },
    describe: (v) => (v.d ? `day ${v.d}` : `week of ${v.week}`),
  },
  code: {
    takes: 'a function code (HELP GP)',
    parse: (tok) => (isCode(tok) ? canonicalCode(tok) : null),   // HELP MOVERS focuses MOST
    describe: (v) => `function ${v}`,
  },
  // ── the comparison panels (RRG / REL / CORR, feature-gaps-2026-10-06) ──
  /** A comparator security. `$` forces a ticker reading; a bare function code is never one. */
  symbol: {
    takes: 'tickers to compare (NVDA REL AMD SMH)',
    parse: (tok) => {
      const t = String(tok).toUpperCase()
      const forced = t.startsWith('$')
      const s = t.replace(/^\$/, '')
      if (!/^[A-Z][A-Z0-9]{0,5}(?:[.-][A-Z]{1,2})?$/.test(s)) return null
      if (!forced && isCode(s)) return null
      return s
    },
    describe: (v) => `ticker ${v}`,
  },
  /** A comparison window. */
  lookback: {
    takes: 'a window (1M, 3M, 6M, 1Y, 2Y, YTD)',
    parse: (tok) => {
      const t = String(tok).toUpperCase()
      return LOOKBACK_WINDOWS.includes(t) ? t : null
    },
    describe: (v) => `window ${v}`,
  },
  /** RRG's cadence: weekly or daily closes. */
  cadence: {
    takes: 'D or W',
    parse: (tok) => ({ D: 'D', DAILY: 'D', W: 'W', WEEKLY: 'W' })[String(tok).toUpperCase()] ?? null,
    describe: (v) => (v === 'D' ? 'daily closes' : 'weekly closes'),
  },
  /** MOST's lens: which cut of the movers tape. `VOL` is a function code, so it is not offered. */
  moversLens: {
    takes: 'UP, DOWN or RVOL',
    parse: (tok) => ({
      UP: 'up', GAINERS: 'up', GAIN: 'up',
      DOWN: 'down', DN: 'down', LOSERS: 'down', LOSS: 'down',
      RVOL: 'volume', UNUSUAL: 'volume', VOLUME: 'volume',
    })[String(tok).toUpperCase()] ?? null,
    describe: (v) => ({ up: 'gainers', down: 'losers', volume: 'unusual volume' })[v],
  },
  /** IMOV's window: the periods theme_performance stores a reference close for (1D is live). */
  contribWindow: {
    takes: 'a window (1D, 1W, 1M, 3M)',
    parse: (tok) => ({ '1D': '1D', TODAY: '1D', '1W': '1W', '1M': '1M', '3M': '3M' })[String(tok).toUpperCase()] ?? null,
    describe: (v) => `window ${v}`,
  },
  /** IMOV's theme, by NAME: every word the other kinds do not take (`IMOV AI / GPU Chips`). A
   *  REST kind (`rest: true` on the spec): the words are joined into one query and the PANEL
   *  resolves it against the themes it reads (case/spacing-insensitive, unique prefix, "did you
   *  mean" otherwise), because the theme list is data, not a constant. A window-shaped token
   *  (`1Y`) is never a theme word, so it is still said to be not applied. `THEME` is the marker
   *  the panel writes (`IMOV THEME SEMICONDUCTORS`): it forces the theme reading of one word
   *  that would otherwise be a ticker, and is not part of the name. */
  themeName: {
    takes: 'a theme name (IMOV SEMICONDUCTORS)',
    parse: (tok) => {
      const t = String(tok ?? '').trim()
      if (!t || /^(?:\d+[DWMY]|YTD|MTD|QTD)$/i.test(t)) return null
      return t.toUpperCase()
    },
    describe: (v) => `theme "${v}"`,
  },
  /** "Mine" (wave 3 #6): only the member's own names — the calendar's My Stocks set
   *  (hooks/useMyTickers). `CAL MINE`, `MOST UP MINE`, `NVDA CN MINE`, `FREC MINE`. The chip a
   *  panel draws writes this word back into its command, so a reload keeps the filter. */
  mine: {
    takes: 'MINE (only your names)',
    parse: (tok) => (String(tok ?? '').trim().toUpperCase() === MINE_MARKER ? true : null),
    describe: () => 'only your names',
  },
}

/** The word IMOV writes before a hand-picked theme (see `themeName`). */
export const THEME_MARKER = 'THEME'
/** The word that filters a panel to the member's own names (see `mine`). */
export const MINE_MARKER = 'MINE'

/**
 * Pure: what a variant does with the tokens typed after its code.
 *   props    — component props (`{ tf: 'W' }`)
 *   params   — URL params for a URL-owning panel (`{ week: null, d: '2026-10-02' }`)
 *   applied  — echo text for every token that took effect
 *   ignored  — every token that did NOT, verbatim (the shell says so out loud)
 *   takes    — what the variant would have accepted, for the echo
 * A door's `{argN}` placeholders consume their tokens first (CMP's comparator).
 */
export function applyArgs(variant, args = [], ctx = {}) {
  const out = { props: {}, params: {}, applied: [], ignored: [], takes: [] }
  const tokens = [...(args || [])].filter((t) => t != null && String(t) !== '')
  if (!variant) { out.ignored = tokens; return out }
  const consumed = new Set()
  if (variant.door) {
    for (const m of String(variant.door).matchAll(/\{arg(\d+)\}/g)) {
      const i = Number(m[1])
      if (i < tokens.length) consumed.add(i)
    }
  }
  const specs = variant.args || []
  out.takes = [...new Set(specs.map((s) => ARG_KINDS[s.kind]?.takes).filter(Boolean))]
  const filled = new Set()
  // A REST spec (IMOV's theme name) collects every word the single-token specs do not take.
  const restAt = specs.findIndex((s) => s.rest)
  const rest = []
  tokens.forEach((tok, i) => {
    if (consumed.has(i)) return
    const at = specs.findIndex((s, j) => !s.rest && !filled.has(j) && ARG_KINDS[s.kind]?.parse(tok, ctx) != null)
    if (at < 0) {
      if (restAt >= 0 && ARG_KINDS[specs[restAt].kind]?.parse(tok, ctx) != null) rest.push(tok)
      else out.ignored.push(tok)
      return
    }
    filled.add(at)
    const spec = specs[at]
    const value = ARG_KINDS[spec.kind].parse(tok, ctx)
    if (spec.prop) out.props[spec.prop] = value
    if (spec.param) Object.assign(out.params, value)
    out.applied.push(ARG_KINDS[spec.kind].describe(value))
  })
  if (rest.length) {
    const spec = specs[restAt]
    const words = spec.marker && String(rest[0]).toUpperCase() === spec.marker ? rest.slice(1) : rest
    const value = words.length ? ARG_KINDS[spec.kind].parse(words.join(' '), ctx) : null
    if (value == null) out.ignored.push(...rest)            // a bare `THEME` names nothing
    else {
      if (spec.prop) out.props[spec.prop] = value
      out.applied.push(ARG_KINDS[spec.kind].describe(value))
    }
  }
  return out
}

/** The one sentence the shell shows for a command's arguments, or null when there were none. */
export function argsEcho(code, result) {
  if (!result || (!result.applied.length && !result.ignored.length)) return null
  const parts = []
  if (result.applied.length) parts.push(`${code}: applied ${result.applied.join(', ')}.`)
  if (result.ignored.length) {
    const what = result.ignored.map((t) => `"${t}"`).join(', ')
    parts.push(result.takes.length
      ? `Not applied: ${what} — ${code} takes ${result.takes.join(' or ')}.`
      : `Not applied: ${what} — ${code} takes no arguments.`)
  }
  return parts.join(' ')
}

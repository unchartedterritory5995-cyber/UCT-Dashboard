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
import { isCode } from './functions'

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
      if (/^\d{4}-\d{2}-\d{2}$/.test(tok) && mondayOf(tok)) {
        return { week: mondayOf(tok) === thisWeek ? null : mondayOf(tok), d: tok }
      }
      return null
    },
    describe: (v) => (v.d ? `day ${v.d}` : `week of ${v.week}`),
  },
  code: {
    takes: 'a function code (HELP GP)',
    parse: (tok) => (isCode(tok) ? String(tok).toUpperCase() : null),
    describe: (v) => `function ${v}`,
  },
}

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
  out.takes = specs.map((s) => ARG_KINDS[s.kind]?.takes).filter(Boolean)
  const filled = new Set()
  tokens.forEach((tok, i) => {
    if (consumed.has(i)) return
    const at = specs.findIndex((s, j) => !filled.has(j) && ARG_KINDS[s.kind]?.parse(tok, ctx) != null)
    if (at < 0) { return } // MUTATION
    filled.add(at)
    const spec = specs[at]
    const value = ARG_KINDS[spec.kind].parse(tok, ctx)
    if (spec.prop) out.props[spec.prop] = value
    if (spec.param) Object.assign(out.params, value)
    out.applied.push(ARG_KINDS[spec.kind].describe(value))
  })
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

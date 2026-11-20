// SEASB's pure half: the board route's answer -> what the panel draws. No React.
//
// The route (GET /api/research/seasonality-board) answers one row per fund: the four index funds,
// then the eleven sector funds. A fund with numbers carries twelve calendar months (how many years
// were counted, the median and the average month, how often it rose) and the window its own daily
// bars cover. A fund without numbers carries WHY instead, and no months at all.
//
// What this module never does:
//   * it never turns a missing number into 0: a month nobody counted reads "n/a";
//   * it never colours a month counted fewer than `min_years` times: that month is thin, and thin
//     is dimmed with its count;
//   * it never names a best or weakest fund from a thin month, or from fewer than two funds.

export const SEASB_CODE = 'SEASB'
/** The thing read, as a failed read names it ("The seasonality board could not be read just now."). */
export const SEASB_WHAT = 'The seasonality board'
/** The source the panel header names (SEAS names the same store). */
export const SEASB_SOURCE = 'UCT daily bar store'
export const SEASB_URL = '/api/research/seasonality-board'
/** While a fund's history is still being read, or its read failed, the panel asks again this often. */
export const SEASB_POLL_MS = 30 * 1000
/** Once nothing is waiting the board changes once a day (and "this month" once a month): a slow look. */
export const SEASB_SETTLED_POLL_MS = 30 * 60 * 1000
/** Months a narrow panel shows: this month, the next and the one after. */
export const SEASB_NARROW_MONTHS = 3

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October',
  'November', 'December']

/** The two measures, in menu order. `token` is what the command carries; median is the bare command. */
export const SEAS_MEASURES = Object.freeze({
  median: Object.freeze({ label: 'Median month', token: null, field: 'median_pct', word: 'median' }),
  average: Object.freeze({ label: 'Average month', token: 'AVG', field: 'avg_pct', word: 'average' }),
})
/** The words the command takes after the code (args.js keeps a pinned copy). None is a function
 *  code or a listed stock today (args.seasonalityBoard.test.js checks both). */
export const SEAS_MEASURE_ARG_WORDS = Object.freeze({ AVG: 'average', AVERAGE: 'average', MEAN: 'average', MEDIAN: 'median' })

export function parseSeasMeasure(tok) {
  const key = String(tok ?? '').trim().toUpperCase()
  return Object.prototype.hasOwnProperty.call(SEAS_MEASURE_ARG_WORDS, key) ? SEAS_MEASURE_ARG_WORDS[key] : null
}

/** A measure the panel can show; anything else is the median. */
export const normSeasMeasure = (v) => (Object.prototype.hasOwnProperty.call(SEAS_MEASURES, v) ? v : 'median')

/** The tokens after the code for this pick (`[]` for the default). */
export function seasonalityBoardCommandArgs({ measure } = {}) {
  const token = SEAS_MEASURES[normSeasMeasure(measure)].token
  return token ? [token] : []
}

const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const wholeMonth = (m) => (Number.isInteger(m) && m >= 1 && m <= 12 ? m : null)

export const monthShort = (m) => (wholeMonth(m) ? MONTH_SHORT[m - 1] : null)
export const monthLong = (m) => (wholeMonth(m) ? MONTH_LONG[m - 1] : null)

/** The twelve months from `thisMonth` forward: November gives Nov, Dec, Jan ... Oct. An unknown
 *  month gives January to December. The first is this month, the second is next month. */
export function monthsFrom(thisMonth) {
  const start = wholeMonth(thisMonth) || 1
  return Array.from({ length: 12 }, (_, i) => ((start - 1 + i) % 12) + 1)
}

/** What a narrow panel shows: this month, next month and the one after (December: Dec, Jan, Feb). */
export const narrowMonths = (thisMonth) => monthsFrom(thisMonth).slice(0, SEASB_NARROW_MONTHS)

/** A month return as a signed percent with one decimal: "+2.1%", "-0.4%", "0.0%"; "n/a" when missing. */
export function pctText(v) {
  const n = finite(v)
  if (n == null) return 'n/a'
  const body = n.toFixed(1)
  if (Number(body) === 0) return '0.0%'           // a value that rounds to zero is zero: no sign at all
  return `${n > 0 ? '+' : ''}${body}%`
}

/** 'up' | 'down' | 'flat' | null (missing): the sign of the figure AS SHOWN, so "0.0%" is never green. */
export function signOf(v) {
  const n = finite(v)
  if (n == null) return null
  const shown = Number(n.toFixed(1))
  return shown > 0 ? 'up' : shown < 0 ? 'down' : 'flat'
}

/**
 * How many of the `n` years the month rose, from the server's whole-number percent, or null when
 * that is not exact. The server sends `pct_up` rounded to a whole percent; a count is exact when
 * only ONE whole number of years rounds to it (always so below 100 years).
 */
export function upCount(pctUp, n) {
  const p = finite(pctUp)
  if (p == null || !Number.isInteger(n) || n <= 0) return null
  const fits = []
  for (let k = 0; k <= n; k += 1) if (Math.abs((k / n) * 100 - p) <= 0.5 + 1e-9) fits.push(k)
  return fits.length === 1 ? fits[0] : null
}

const yrs = (n) => `${n} ${n === 1 ? 'yr' : 'yrs'}`
const years = (n) => `${n} ${n === 1 ? 'year' : 'years'}`

/** Under a figure: "7 of 10 up", or "70% up, 10 yrs" when the count cannot be recovered exactly. */
export function upWords(pctUp, n) {
  if (!Number.isInteger(n) || n <= 0) return null
  const k = upCount(pctUp, n)
  if (k != null) return `${k} of ${n} up`
  return finite(pctUp) == null ? yrs(n) : `${Math.round(pctUp)}% up, ${yrs(n)}`
}

/** The year a covered window starts in ("1999" from "1999-03-10"), or null. */
export function sinceYear(coveredFrom) {
  const m = /^(\d{4})-\d{2}-\d{2}/.exec(String(coveredFrom ?? ''))
  return m ? m[1] : null
}

/**
 * One month of one fund as the grid draws it.
 *   tone   'up' | 'down' (the sign, only when the month has enough years) | 'flat' | 'thin' | 'none'
 *   text   the chosen measure, signed, one decimal; "n/a" when nothing was counted
 *   sub    "7 of 10 up", or the count alone for a thin month ("3 yrs")
 */
export function cellFor(month, measure, minYears) {
  const spec = SEAS_MEASURES[normSeasMeasure(measure)]
  const m = wholeMonth(month?.month)
  const n = Number.isInteger(month?.n) && month.n > 0 ? month.n : 0
  const value = n ? finite(month?.[spec.field]) : null
  const floor = Number.isInteger(minYears) && minYears > 0 ? minYears : 1
  const thin = n > 0 && (month?.thin === true || n < floor)
  const base = { month: m, label: monthShort(m), n, value, thin }
  if (value == null) {
    return { ...base, tone: 'none', text: 'n/a', sub: n ? yrs(n) : 'no full month',
      title: n ? `${monthLong(m)}: counted ${years(n)}, no figure` : `${monthLong(m)}: no full month on record` }
  }
  const text = pctText(value)
  if (thin) {
    return { ...base, tone: 'thin', text, sub: yrs(n),
      title: `${monthLong(m)}: ${spec.word} ${text} over ${years(n)}. Fewer than ${floor} years: too few to lean on.` }
  }
  const sub = upWords(month?.pct_up, n)
  const sign = signOf(value)
  return { ...base, tone: sign === 'flat' ? 'flat' : sign, text, sub,
    title: `${monthLong(m)}: ${spec.word} ${text}, ${sub}` }
}

/** Why a fund has no numbers, in words. The server's own reason for a failed read is kept for
 *  support (`reason`), never shown as the sentence. */
export function withoutWords(fund) {
  const sym = String(fund?.symbol || 'This fund')
  if (fund?.status === 'pending') return `${sym}: the full history is still being read; this fills in on its own.`
  if (fund?.status === 'not_held') return `${sym}: we hold no daily bars for it.`
  if (fund?.status === 'unavailable' && fund?.reason === 'too_short') return `${sym}: we hold less than one full calendar month of daily bars for it.`
  return `${sym}: its daily bars could not be read just now; it is asked again on its own.`
}

const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)
const isOk = (f) => f?.status === 'ok' && Array.isArray(f.months) && f.months.length === 12

/**
 * The board as the panel draws it.
 *   state    'failed'   the answer is not a board
 *            'ready'    every fund has numbers
 *            'partial'  some funds have numbers, the others are named with their reason
 *            'waiting'  no fund has numbers yet and at least one is still being read (a cold start)
 *            'none'     no fund has numbers and nothing is waiting
 *   months   the twelve months in column order, from this month forward
 *   rows     the funds with numbers, in the server's order (index funds, then sector funds)
 *   without  the funds without numbers, each with its sentence
 */
export function seasonalityBoardRead(body, measure) {
  const failed = { state: 'failed', months: [], rows: [], without: [], thisMonth: null, nextMonth: null, minYears: null,
    settled: false, complete: false, dataThrough: null, funds: 0, pending: 0 }
  if (!body || typeof body !== 'object' || !Array.isArray(body.funds) || !wholeMonth(body.this_month)) return failed
  const picked = normSeasMeasure(measure)
  const minYears = Number.isInteger(body.min_years) && body.min_years > 0 ? body.min_years : 5
  const thisMonth = body.this_month
  const nextMonth = wholeMonth(body.next_month) || (thisMonth % 12) + 1
  const order = monthsFrom(thisMonth)
  const funds = body.funds.filter((f) => f && typeof f === 'object' && str(f.symbol))
  const rows = funds.filter(isOk).map((f) => {
    const byMonth = new Map(f.months.map((m) => [m?.month, m]))
    return {
      symbol: f.symbol.trim().toUpperCase(), name: str(f.name), kind: f.kind === 'index' ? 'index' : 'sector',
      since: sinceYear(f.covered_from), fullMonths: Number.isInteger(f.full_months) ? f.full_months : null,
      cells: order.map((m) => cellFor(byMonth.get(m) || { month: m, n: 0 }, picked, minYears)),
    }
  })
  const without = funds.filter((f) => !isOk(f)).map((f) => {
    // "ok" with no twelve months is not ok: it is a fund whose numbers could not be read
    const status = f.status === 'ok' ? 'unavailable' : (str(f.status) || 'unavailable')
    const symbol = f.symbol.trim().toUpperCase()
    return { symbol, name: str(f.name), status, reason: str(f.reason), text: withoutWords({ symbol, status, reason: f.reason }) }
  })
  const pending = without.filter((w) => w.status === 'pending').length
  const settled = body.settled === true || (body.settled == null && body.complete === true)
  const state = rows.length ? (without.length ? 'partial' : 'ready') : (settled ? 'none' : 'waiting')
  return { state, measure: picked, months: order.map((m, i) => ({ month: m, label: monthShort(m), long: monthLong(m),
    mark: i === 0 ? 'now' : i === 1 ? 'next' : null, narrow: i < SEASB_NARROW_MONTHS })),
    rows, without, thisMonth, nextMonth, minYears, settled, complete: body.complete === true && !without.length,
    dataThrough: str(body.data_through), funds: funds.length, pending }
}

/** How often the panel asks again: every 30 seconds while a fund is waiting, slowly once none is. */
export const pollMs = (body) => (body && typeof body === 'object' && Array.isArray(body.funds)
  ? ((body.settled === true || (body.settled == null && body.complete === true)) ? SEASB_SETTLED_POLL_MS : SEASB_POLL_MS)
  : SEASB_POLL_MS)

/** One note for every fund without numbers. When every fund is waiting for the same thing it is one sentence. */
export function withoutNote(view) {
  const list = view?.without || []
  if (!list.length) return null
  if (list.length > 1 && list.length === view.funds && list.every((w) => w.status === 'pending')) {
    return { one: `All ${list.length} funds: the full history is still being read; this fills in on its own.`, lines: [] }
  }
  return { one: null, lines: list.map((w) => ({ symbol: w.symbol, text: w.text, status: w.status, reason: w.reason })) }
}

function factLine(lead, row, cell, monthName) {
  const k = upCount(cell.pctUp, cell.n)
  const up = k != null ? `up ${k} of ${cell.n} years` : `up ${Math.round(cell.pctUp)}% of ${cell.n} years`
  const who = row.name ? `${row.name} (${row.symbol})` : row.symbol
  return `${lead} sector fund in ${monthName}${row.since ? ` since ${row.since}` : ''}: ${who}, median ${pctText(cell.median)}, ${up}.`
}

/**
 * The two facts: the sector fund with the highest MEDIAN this month and the one with the lowest.
 * Always the median, whatever the measure switch shows. A fund counts only with `min_years` or
 * more of this month behind it; with fewer than two such funds there is nothing to compare, and
 * the answer says so. `leftOut` names the sector funds that did not count, so a short list is
 * never read as all eleven.
 */
export function boardFacts(body) {
  const view = seasonalityBoardRead(body, 'median')
  if (view.state === 'failed') return { best: null, worst: null, leftOut: null, why: null }
  const monthName = monthLong(view.thisMonth)
  const sectors = (body.funds || []).filter((f) => f && f.kind === 'sector' && str(f.symbol))
  const counted = []
  const out = []
  for (const f of sectors) {
    const row = view.rows.find((r) => r.symbol === f.symbol.trim().toUpperCase())
    const m = isOk(f) ? f.months.find((x) => x?.month === view.thisMonth) : null
    const n = Number.isInteger(m?.n) ? m.n : 0
    const median = finite(m?.median_pct)
    if (row && median != null && finite(m?.pct_up) != null && n >= view.minYears && m.thin !== true) {
      counted.push({ row, cell: { n, median, pctUp: m.pct_up } })
    } else {
      out.push(!row ? `${f.symbol} (no numbers yet)` : n > 0 ? `${f.symbol} (${years(n)})` : `${f.symbol} (none on record)`)
    }
  }
  const leftOut = out.length && counted.length >= 2 ? `Not counted in those two: ${out.join(', ')}.` : null
  if (counted.length < 2) {
    const why = sectors.length
      ? `Too few sector funds have ${view.minYears} or more ${monthName}s on record to name a best or a weakest.`
      : null
    return { best: null, worst: null, leftOut: null, why }
  }
  // ties keep the server's order: the first fund listed with the highest (or lowest) median
  let best = counted[0]
  let worst = counted[0]
  for (const c of counted) {
    if (c.cell.median > best.cell.median) best = c
    if (c.cell.median < worst.cell.median) worst = c
  }
  if (best.cell.median === worst.cell.median) {
    return { best: null, worst: null, leftOut: null,
      why: `The sector funds with ${view.minYears} or more ${monthName}s on record all share one median, so there is no best or weakest.` }
  }
  return { best: factLine('Best', best.row, best.cell, monthName), worst: factLine('Weakest', worst.row, worst.cell, monthName),
    leftOut, why: null }
}

/** The line above the grid: what it is, where it comes from, and which month is this month. */
export function ledeLine(view) {
  const base = 'How each fund has done in each calendar month, close to close, from the daily bars we hold.'
  const now = monthLong(view?.thisMonth)
  return now ? `${base} This month is ${now}; the months run from it forward.` : base
}

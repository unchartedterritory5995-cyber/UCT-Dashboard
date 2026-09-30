// app/src/lib/marketClock/calendarCompact.js
//
// ─── ⭐ THE BUNDLE CARRIES `market_calendar.json` WITHOUT REPEATING ITSELF ──────
//
// `market_calendar.json` rides in the ENTRY chunk (the market clock is read on
// every route), and on 2026-09-29 it grew from 25 years of nothing to 2000-2028:
// 273 holidays and 63 early closes, each row spelling out a name that is one of
// about a dozen strings. That pushed the Notebook's first-open budget over its
// line by 8.5 kB. The budget is not raised to fit a reading; the repetition goes.
//
// ⛔ LOSSLESS, AND PROVED SO. `compactCalendar` groups the rows by name (and
// close time) and writes each group's dates as base-36 day gaps; `expandCalendar`
// rebuilds the exact objects the file holds, in its date order. `calendarCompact.test.js` requires
// `expandCalendar(compactCalendar(doc))` to deep-equal the real file, so every
// field the runtime reads (`date`, `name`, `close`) survives by construction.
//
// ⛔ THE FILE ON DISK IS UNTOUCHED. Only the browser bundle is compacted, and only
// on `build` (the vite plugin is `apply: 'build'`). The Python lane
// (`session_calendar.py`) and every test read the full document, and
// `expandCalendar` hands a full document back unchanged, so both shapes work.

const COMPACT = '_compact'

// A date travels as a DAY NUMBER counted from 2000-01-01, and within one group
// every date after the first is the GAP in days from the one before it, in base
// 36 (a yearly holiday is `a5`, not `010115`). Anything outside 2000-2099 is
// REFUSED at build time rather than silently re-dated, and a group must arrive in
// date order (the file is sorted; a negative gap would mean it no longer is).
const EPOCH = Date.UTC(2000, 0, 1)
const DAY = 86400000
function dayNumber(iso) {
  if (!/^20\d\d-\d\d-\d\d$/.test(iso)) {
    throw new Error(`calendarCompact: ${iso} is outside 2000-2099; widen the encoding before adding it`)
  }
  const [y, m, d] = iso.split('-').map(Number)
  return Math.round((Date.UTC(y, m - 1, d) - EPOCH) / DAY)
}
function isoOf(day) {
  const t = new Date(EPOCH + day * DAY)
  const pad = (n) => String(n).padStart(2, '0')
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`
}

function group(rows, keyOf) {
  const days = new Map()
  for (const r of rows || []) {
    const k = keyOf(r)
    if (!days.has(k)) days.set(k, [])
    days.get(k).push(dayNumber(r.date))
  }
  const out = {}
  for (const [k, list] of days) {
    out[k] = list.map((n, i) => {
      const gap = i === 0 ? n : n - list[i - 1]
      if (gap < 0) throw new Error(`calendarCompact: ${k} is not in date order`)
      return gap.toString(36)
    }).join(' ')
  }
  return out
}

const expandDays = (packed) => {
  let day = 0
  return packed.split(' ').map((g) => (day += Number.parseInt(g, 36)))
}

const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)

/**
 * The calendar with its rows grouped by name (and close time) and its dates
 * written as day gaps. Not what the runtime reads; see `expandCalendar`.
 * @param {object} doc the parsed `market_calendar.json`
 * @returns {{doc: object, savedBytes: number}}
 */
export function compactCalendar(doc) {
  const { holidays, early_closes: earlyCloses, ...rest } = doc
  const out = {
    ...rest,
    [COMPACT]: {
      holidays: group(holidays, (h) => h.name),
      early_closes: group(earlyCloses, (e) => `${e.close}|${e.name}`),
    },
  }
  const savedBytes = JSON.stringify(doc).length - JSON.stringify(out).length
  return { doc: out, savedBytes }
}

/**
 * The calendar as the file holds it: rows rebuilt and put back in date order. A
 * full document passes through unchanged.
 * @param {object} data either the file or `compactCalendar(...).doc`
 * @returns {object}
 */
export function expandCalendar(data) {
  const packed = data && data[COMPACT]
  if (!packed) return data
  const { [COMPACT]: _drop, ...rest } = data
  const rows = (groups, build) => Object.entries(groups)
    .flatMap(([key, packed]) => expandDays(packed).map((d) => build(key, isoOf(d))))
    .sort(byDate)
  return {
    ...rest,
    holidays: rows(packed.holidays, (name, date) => ({ date, name })),
    early_closes: rows(packed.early_closes, (key, date) => {
      const bar = key.indexOf('|')
      return { date, name: key.slice(bar + 1), close: key.slice(0, bar) }
    }),
  }
}

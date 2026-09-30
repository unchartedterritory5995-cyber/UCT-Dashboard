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
// close time) and shortens each date to `YYMMDD`; `expandCalendar` rebuilds the
// exact objects the file holds, in its date order. `calendarCompact.test.js` requires
// `expandCalendar(compactCalendar(doc))` to deep-equal the real file, so every
// field the runtime reads (`date`, `name`, `close`) survives by construction.
//
// ⛔ THE FILE ON DISK IS UNTOUCHED. Only the browser bundle is compacted, and only
// on `build` (the vite plugin is `apply: 'build'`). The Python lane
// (`session_calendar.py`) and every test read the full document, and
// `expandCalendar` hands a full document back unchanged, so both shapes work.

const COMPACT = '_compact'

// A date travels as `YYMMDD` in the 2000s. Anything outside that century is
// REFUSED at build time rather than silently re-dated a hundred years off.
function shortDate(iso) {
  const m = /^20(\d\d)-(\d\d)-(\d\d)$/.exec(iso)
  if (!m) throw new Error(`calendarCompact: ${iso} is outside 2000-2099; widen the encoding before adding it`)
  return m[1] + m[2] + m[3]
}
const longDate = (s) => `20${s.slice(0, 2)}-${s.slice(2, 4)}-${s.slice(4, 6)}`

function group(rows, keyOf) {
  const out = {}
  for (const r of rows || []) {
    const k = keyOf(r)
    out[k] = out[k] ? `${out[k]} ${shortDate(r.date)}` : shortDate(r.date)
  }
  return out
}

const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)

/**
 * The calendar with its rows grouped by name (and close time) and its dates
 * shortened. Not what the runtime reads; see `expandCalendar`.
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
    .flatMap(([key, dates]) => dates.split(' ').map((d) => build(key, longDate(d))))
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

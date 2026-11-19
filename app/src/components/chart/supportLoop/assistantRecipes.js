// app/src/components/chart/supportLoop/assistantRecipes.js
//
// ─── ⭐ RECIPES: ONE PROVEN SCRIPT PER HARD REQUEST FAMILY (2026-11-19) ───────────────
//
// The assistant writes Pine for what a formula cannot hold. For the families members ask for most
// (a zigzag, zones, a volume profile, a divergence read swing to swing, structure labels, a table
// of statistics) it should start from a script this engine is KNOWN to draw, not from recollection
// of another platform's dialect. `assistantRecipes/` holds one whole script per family, with the
// words a member uses for it (`asks`); the script turn is handed only the ones its request names
// (`api/services/pine_authoring.py::recipes_for`).
//
// ⛔ "THE PASTE CHECK SAYS IT RUNS" IS NOT ENOUGH, AND THIS FILE IS WHY. The status a pasted script
// gets is decided before any bar is computed. The run itself has further stops: a value that
// depends on where the chart's history starts is never drawn on a chart that does not reach the
// listing (`runtime:warmup-never-converges`), a clock read in a zone the lane cannot answer for is
// refused (`runtime:clock-zone`), a run can exceed its budget. Three first drafts passed the paste
// check and were refused by the run. So a recipe is SERVED only when:
//   1. the member's paste path says it runs fully, AND
//   2. the engine COMPUTES it, with no refusal on any output, on bars of the kind it is for, both on
//      a chart whose history reaches the listing and on one whose history does not, AND
//   3. its first output has a value somewhere on each, AND
//   4. IF IT DRAWS (a line, label, box or table), its drawings are MADE on each: none lost by the
//      lane that took the script ("N of N drawing elements aren't supported yet" arrives as a NOTE
//      beside "runs"), none withheld by the run (a script whose values pass a warm-up check has its
//      drawing program withheld on a chart that does not reach the listing). A first draft of the
//      Fibonacci recipe "ran, with 1 note" and drew none of its levels; two others drew their
//      labels and lines only on a chart from the listing.
// `assistantRecipes.test.js` holds the numbers to an independent calculation as well.

import { RUNS_STATES } from './assistantPineReference'

export const RECIPE_CHARTS = Object.freeze(['daily', 'intraday'])
/** The two histories every recipe is computed on. */
export const RECIPE_HISTORIES = Object.freeze(['fromListing', 'offListing'])

const pad = (n) => String(n).padStart(2, '0')

/** A seeded walk: the same bars on every machine (no clock, no Math.random). */
function walk(seed) {
  let s = seed
  return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648 }
}

/**
 * The bars a recipe is computed on, in the product's own shape (`{t, o, h, l, c, v}`).
 *   daily:    2,000 weekday bars from 2019-06-03, `t` an ISO date
 *   intraday: 40 weekdays of 5-minute bars, 14:30 to 21:00 UTC (78 a day), `t` epoch seconds
 */
export function recipeBars(kind) {
  const rnd = walk(kind === 'intraday' ? 11 : 7)
  const out = []
  let close = 100
  const bar = (t, vol) => {
    // about one daily bar in thirty opens 3% away from the close before it, so a gap is a real case
    const jump = kind !== 'intraday' && rnd() < 0.033 ? (rnd() < 0.5 ? 0.03 : -0.03) : 0
    const o = close * (1 + jump + (rnd() - 0.5) * 0.01)
    close = o * (1 + (rnd() - 0.49) * (kind === 'intraday' ? 0.006 : 0.04))
    const h = Math.max(o, close) * (1 + rnd() * (kind === 'intraday' ? 0.002 : 0.01))
    const l = Math.min(o, close) * (1 - rnd() * (kind === 'intraday' ? 0.002 : 0.01))
    out.push({ t, o, h, l, c: close, v: Math.round(vol * (1 + rnd())) })
  }
  const day = new Date(Date.UTC(2019, 5, 3))
  if (kind === 'intraday') {
    day.setTime(Date.UTC(2025, 5, 2))
    for (let d = 0; d < 40;) {
      if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6) {
        const open = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 13, 30) / 1000
        for (let i = 0; i < 78; i += 1) bar(open + i * 300, 20000)
        d += 1
      }
      day.setUTCDate(day.getUTCDate() + 1)
    }
    return out
  }
  while (out.length < 2000) {
    if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6) {
      bar(`${day.getUTCFullYear()}-${pad(day.getUTCMonth() + 1)}-${pad(day.getUTCDate())}`, 1e6)
    }
    day.setUTCDate(day.getUTCDate() + 1)
  }
  return out
}

/**
 * ⛔ THE CHART'S SYMBOL AS THE CHART HANDS IT: AN OBJECT, NEVER A STRING. The run reads `ctx.symbol`
 * only as `{ticker, exchange, ...}` (`runtimeColumns.symbolOf`), which is `StockChart`'s `symbolMeta`.
 * The first version of this context passed the string 'AMEX:SPY': the run then had NO symbol, so no
 * exchange and no time zone, and `timestamp(...)` was refused (`runtime:clock-zone`) on a chart
 * where a member's is answered. A finding made on a context the member's chart never has is a
 * finding about the harness. `assistantPineReference.test.js` holds this object's fields, and the
 * context's, to the ones `StockChart.jsx` builds.
 */
export const RECIPE_SYMBOL = Object.freeze({ ticker: 'SPY', exchange: 'NYSE Arca', industry: null, sector: null, securityType: 'ETF' })

/** The compute context a recipe's chart kind runs under: the five facts the chart hands its binder. */
export function recipeContext(kind, history) {
  return {
    sym: RECIPE_SYMBOL.ticker,
    symbol: RECIPE_SYMBOL,
    tf: kind === 'intraday' ? '5' : 'D',
    newestBarIsForming: false,
    historyFromListing: history === 'fromListing',
  }
}

/**
 * ⭐ STOPS OF THE RUN ITSELF. The paste check passes each of these; the engine refuses it when it
 * computes. Each is the smallest script that shows one, with the history it is refused on. The
 * generator records the refusal the engine gives TODAY; the assistant is told a stop only while it
 * still stands (`api/services/pine_authoring.py::RUN_STOP_WORDS`).
 */
export const RUN_STOP_PROBES = Object.freeze({
  // ⛔ A WRONG VALUE, NOT A REFUSAL: a drawing taken out of a list and deleted in ONE call
  // (`label.delete(array.shift(xs))`) is deleted and STAYS IN THE LIST, so the list never shrinks
  // (and a `while` over its size never ends). Written in two steps it is right. `expectLast` is what
  // the list's size must be on the last bar; the probe stands while the engine answers otherwise.
  'delete-in-one-call': {
    history: 'fromListing', chart: 'daily', expectLast: 5,
    source: '//@version=5\nindicator("probe", overlay=true)\nvar label[] xs = array.new_label(0)\nif close > close[1]\n    array.push(xs, label.new(bar_index, high, "a"))\nif array.size(xs) > 5\n    label.delete(array.shift(xs))\nplot(array.size(xs), "Labels kept")\n',
  },
  // ⛔ NO VALUE ON THE NEWEST BAR: a weekly (or monthly) read has a value on every bar but the chart's
  // newest one while that week is still forming. Anything decided on the last bar reads a blank.
  // `dropLast` ends the chart three bars early, mid-week; the probe stands while the newest bar is blank.
  'higher-timeframe-newest-bar': {
    history: 'fromListing', chart: 'daily', dropLast: 3, newestBarHasValue: true,
    source: '//@version=5\nindicator("probe", overlay=true)\nplot(request.security(syminfo.tickerid, "W", close), "Weekly close")\n',
  },
  // a value kept since the first bar never forgets where the chart started
  'running-total': {
    history: 'offListing', chart: 'daily',
    source: '//@version=5\nindicator("probe")\nvar float total = 0.0\ntotal += volume\nplot(total, "Total")\n',
  },
  // `timestamp(...)` reads a clock in the exchange's zone. Answered on a chart whose symbol the engine
  // knows the exchange of (every member chart today); the probe stands only if that ever stops.
  'timestamp-clock': {
    history: 'fromListing', chart: 'daily',
    source: '//@version=5\nindicator("probe", overlay=true)\nplot(time >= timestamp(2026, 1, 1, 0, 0) ? close : na, "After")\n',
  },
})

/** What a newest-bar probe carries while the engine computes it and leaves that bar blank. */
export const NEWEST_BAR_BLANK_GUARD = 'newest-bar-blank'
/** What a value probe carries while the engine computes it and answers wrongly. */
export const WRONG_VALUE_GUARD = 'wrong-value'

/** The run-level stops as the engine answers them now: `[{id, standing, guard}]`. */
export function buildRunStops({ computeOf, probes = RUN_STOP_PROBES }) {
  return Object.keys(probes).sort().map((id) => {
    const p = probes[id]
    const c = computeOf(p.source, p.chart, p.history, { dropLast: p.dropLast | 0 }) || {}
    if (c.ok === true && p.newestBarHasValue === true) {
      // a probe of the NEWEST bar: it computes, and stands while that bar has no value
      const blank = !Number.isFinite(c.newest)
      return { id, history: p.history, standing: blank, guard: blank ? NEWEST_BAR_BLANK_GUARD : null }
    }
    if (c.ok === true && 'expectLast' in p) {
      // a probe of a VALUE: it computes, and stands while the last value is not the right one
      const wrong = c.last !== p.expectLast
      return { id, history: p.history, standing: wrong, guard: wrong ? WRONG_VALUE_GUARD : null }
    }
    return { id, history: p.history, standing: c.ok !== true, guard: c.ok === true ? null : (c.guard || null) }
  })
}

const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim()

/** Does this script make a drawing (a line, label, box or table)? Read from its code, comments removed. */
export function drawsObjects(source) {
  const code = String(source || '').split(String.fromCharCode(10)).map((l) => l.split('//')[0]).join(' ')
  return /\b(line|label|box|table)\.new\(/.test(code)
}

/** Are a run's drawings all made? `drawings` is what `computeOf` reports: `{made, lost, withheld, partial}`. */
export function drawingsMade(drawings) {
  return !!drawings && drawings.made > 0 && drawings.lost !== true && !drawings.withheld && drawings.partial !== true
}

/**
 * @param {object} args
 * @param {Array<{id, title, asks, shows, chart, source}>} args.recipes
 * @param {(source) => {ok, lane, state, headline}} args.verdictOf   the paste path's verdict
 * @param {(source, chart, history) => {ok, guard, why, values}} args.computeOf   a real run; `values` is
 *        the count of bars with a value in the first output
 */
export function buildAssistantRecipes({ recipes = [], verdictOf, computeOf, stopProbes = RUN_STOP_PROBES }) {
  const rows = recipes.map((r) => {
    const v = verdictOf(r.source) || {}
    const pasted = v.ok === true && RUNS_STATES.includes(v.state)
    const draws = drawsObjects(r.source)
    const drawingsOf = (d) => ({
      made: (d && d.made) | 0, lost: !!(d && d.lost), withheld: (d && d.withheld) || null, partial: !!(d && d.partial),
    })
    const runs = {}
    for (const history of RECIPE_HISTORIES) {
      const c = pasted ? (computeOf(r.source, r.chart, history) || {}) : { ok: false, guard: 'not-computed', why: 'the paste check did not pass', values: 0 }
      runs[history] = c.ok === true
        ? { ok: true, values: c.values | 0, ...(draws ? { drawings: drawingsOf(c.drawings) } : {}) }
        : { ok: false, guard: c.guard || null, why: clean(c.why).slice(0, 300), values: 0 }
    }
    const served = pasted && RECIPE_HISTORIES.every((h) => runs[h].ok && runs[h].values > 0
      && (!draws || drawingsMade(runs[h].drawings)))
    return {
      id: r.id, title: r.title, asks: r.asks, shows: r.shows, chart: r.chart, source: r.source,
      lane: v.lane || 'host', state: v.state || 'unknown', headline: clean(v.headline), draws, runs, served,
    }
  })
  return {
    _comment: 'GENERATED by app/src/components/chart/supportLoop/assistantPineReference.test.js '
      + '(WRITE_ASSISTANT_PINE_REFERENCE=1). Do not edit by hand. Each recipe with the paste path\'s verdict and a real '
      + 'compute on both histories; only `served` recipes are ever shown to the assistant (api/services/pine_authoring.py).',
    version: 1,
    recipes: rows,
    stops: buildRunStops({ computeOf, probes: stopProbes }),
  }
}

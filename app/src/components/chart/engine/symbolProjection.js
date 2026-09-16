// app/src/components/chart/engine/symbolProjection.js
//
// ─── ONE SERIES' TIMELINE ONTO ANOTHER'S ────────────────────────────────────
//
// ⭐⭐ THIS IS `interpret.js`'s `case 'sym'` ALIGNMENT, LIFTED SO THERE IS ONE
// OF IT. That rule is already correct and already paid for: the formula lane
// aligns a second instrument onto the chart's bars by exact `t`, and its comments
// record why each half is the way it is. Phase 1 needs the same projection in the
// BINDER lane, and writing a second implementation is the "two spellings of one
// fact" failure this codebase guards against everywhere else — two functions that
// agree on the day they are written and quietly stop agreeing later.
//
// ⛔⛔ THE KEY IS `t`, NEVER THE ISO DAY. `sym` reads the SAME timeframe, so two
// bars correspond exactly when they ARE the same bar time. An ISO-day key would
// map every five-minute bar of a session onto the benchmark's FIRST bar of that
// day — a defect found against a 579-bar intraday corpus, and the reason
// `symbolProjection.test.js` pins the intraday case specifically.
//
// ⛔⛔ AND NO FORWARD FILL. A missing bar — a halt, a one-sided holiday, a
// secondary whose history starts later — is NaN there. Carrying the previous
// value forward would present a stale price as this bar's, which is worst exactly
// when it matters. NaN is "not computable", which is the honest answer and the
// one the whole engine already understands.

/** A NaN-filled column of length `n`. */
function nan(n) {
  const out = new Array(n)
  for (let i = 0; i < n; i++) out[i] = NaN
  return out
}

/**
 * One bar's scalar field.
 *
 * ⚠️ ONLY THE FIELDS A SYMBOL SOURCE MAY NAME. `SYMBOL_SOURCE_FIELDS` is the
 * authority on which those are and why (a breadth pseudo-symbol's bar shape is
 * synthetic, so a derived field would be arithmetic over a shape nobody
 * measured). An unknown field yields NaN rather than a guess — the same posture
 * `barFieldSeries` takes for the primary.
 */
function fieldOf(bar, field) {
  if (!bar || typeof bar !== 'object') return NaN
  switch (field) {
    case 'close': return bar.c
    case 'volume': return bar.v
    default: return NaN
  }
}

/**
 * Project a secondary symbol's field onto the primary bars' timeline.
 *
 * @param {Array} secondaryBars bars for the OTHER symbol, same timeframe
 * @param {string} field        a `SYMBOL_SOURCE_FIELDS` member
 * @param {Array} primaryBars   the chart's own bars — defines length and times
 * @returns {number[]} a column the same length as `primaryBars`
 */
export function projectSymbolField(secondaryBars, field, primaryBars) {
  const primary = Array.isArray(primaryBars) ? primaryBars : []
  const out = nan(primary.length)
  const secondary = Array.isArray(secondaryBars) ? secondaryBars : []
  if (!secondary.length || !primary.length) return out

  // FIRST WINS on a duplicate timestamp, matching the formula lane exactly. A
  // duplicate is a data defect either way; what matters is that both lanes make
  // the same choice about it.
  const at = new Map()
  for (let j = 0; j < secondary.length; j++) {
    const b = secondary[j]
    const key = b && typeof b === 'object' ? b.t : undefined
    if (key !== undefined && key !== null && !at.has(key)) at.set(key, j)
  }

  for (let i = 0; i < primary.length; i++) {
    const b = primary[i]
    const key = b && typeof b === 'object' ? b.t : undefined
    if (key === undefined || key === null) continue
    const j = at.get(key)
    if (j !== undefined) out[i] = fieldOf(secondary[j], field)
  }
  return out
}

// ─── The projection cache ───────────────────────────────────────────────────
//
// ⭐⭐ STABLE ARRAY IDENTITY IS THE INVALIDATION MODEL, NOT AN OPTIMISATION.
// `binder.js` stamps `__srcId` on a source column and folds it into the memo
// signature, so a source that did not change hands back the SAME array and every
// consumer's memo HITS. `barFieldFor` exists for precisely this reason: it caches
// on the bars OBJECT because "new bars are a new array (`applyData` never mutates
// in place), so the cache misses exactly when the numbers changed".
//
// ⛔ A PROJECTION BUILT FRESH EVERY PAINT WOULD DEFEAT THAT SILENTLY. It would be
// a new array each time, so `MA(QQQ)` would recompute on every settings write in
// the chart — including ones about somebody else's pane. That is the measured
// defect `barFieldFor` was added to fix, and it would return here unnoticed
// because the numbers would still be RIGHT.
//
// Keyed on BOTH object identities: a change in either the secondary bars or the
// primary timeline is a genuinely different projection.

// ⚠️ KEYED PER SECONDARY SERIES, NOT ONE SLOT. `barFieldCache` can be a single
// slot because every field it serves comes from the SAME bars object; here each
// symbol has its own array, so one slot would thrash — a chart holding QQQ and
// SPY would evict QQQ's projection while computing SPY's, and neither would ever
// be stable across a pass. The memo would then miss every paint while the numbers
// stayed correct, which is the failure mode that is hardest to notice.
//
// A WeakMap keyed on the secondary bars object means an entry dies with the bars
// it belongs to, so a symbol the member removed costs nothing.

const _cache = new WeakMap()   // secondaryBars -> { primary, map: Map<field, column> }

/**
 * `projectSymbolField`, memoised on (secondary bars, primary bars, field).
 *
 * Both object identities participate: new bars for either side are a genuinely
 * different projection, and both sides mint a new array when their numbers
 * change (`applyData` never mutates in place).
 */
export function projectionFor(secondaryBars, field, primaryBars) {
  if (!secondaryBars || typeof secondaryBars !== 'object') {
    return projectSymbolField(secondaryBars, field, primaryBars)
  }
  let entry = _cache.get(secondaryBars)
  if (!entry || entry.primary !== primaryBars) {
    entry = { primary: primaryBars, map: new Map() }
    _cache.set(secondaryBars, entry)
  }
  let col = entry.map.get(field)
  if (!col) {
    col = projectSymbolField(secondaryBars, field, primaryBars)
    entry.map.set(field, col)
  }
  return col
}

/** Test seam. A WeakMap cannot be cleared, so this replaces the entry for one
 *  series — which is all a test needs, and all that is ever correct to do. */
export function clearProjectionFor(secondaryBars) {
  if (secondaryBars && typeof secondaryBars === 'object') _cache.delete(secondaryBars)
}


// ─── THE OTHER TIMELINE RULE, AND IT IS DELIBERATELY NOT THE ONE ABOVE ──────
//
// ⭐⭐ A CANDLE IS A BAR, SO IT KEEPS ITS OWN `t`. Everything above PROJECTS a
// foreign instrument onto the chart's index because a COLUMN has to be
// index-aligned to feed compute: `MA(QQQ)` averages position by position, and a
// value that landed on the wrong index would be arithmetic on the wrong day.
// A candlestick feeds no compute. It is a picture of QQQ's own auction, and
// rewriting its timestamp to AAPL's would attribute QQQ's open, high and low to
// a bar that is not QQQ's. The two rules answer different questions, which is
// why this is a second function and not a `field === 'ohlc'` branch in the first.
//
// ⛔ INTERSECTION, NEVER UNION (v1 ruling). Only secondary bars whose `t` is
// already in the chart's time domain are emitted. A QQQ bar with no AAPL
// counterpart is DROPPED rather than drawn, because drawing it would widen the
// chart's shared time axis with a slot the primary has no candle for — a
// chart-wide decision that belongs to a session policy nobody has written yet.
// For two US equities the intersection is the whole set and this costs nothing;
// for a 24-hour instrument it is the conservative half of a question still open.
//
// ⛔ AND NO FORWARD FILL, for the same reason `projectSymbolField` refuses one: a
// gap is a gap. A bar the secondary does not have is simply absent from the
// output, and the renderer draws nothing there.

/**
 * A secondary symbol's own OHLC bars, clipped to the primary's time domain.
 *
 * @param {Array} secondaryBars bars for the OTHER symbol, same timeframe
 * @param {Array} primaryBars   the chart's bars — defines the admissible times
 * @returns {Array} a subset of `secondaryBars`, in primary order, each carrying
 *                  its OWN `t`
 */
export function clipBarsToDomain(secondaryBars, primaryBars) {
  const secondary = Array.isArray(secondaryBars) ? secondaryBars : []
  const primary = Array.isArray(primaryBars) ? primaryBars : []
  if (!secondary.length || !primary.length) return []

  // FIRST WINS on a duplicate timestamp, matching `projectSymbolField` exactly.
  // Two lanes reading the same bars must make the same choice about a defect.
  const at = new Map()
  for (let j = 0; j < secondary.length; j++) {
    const b = secondary[j]
    const key = b && typeof b === 'object' ? b.t : undefined
    if (key !== undefined && key !== null && !at.has(key)) at.set(key, b)
  }

  // ⭐ WALKED IN PRIMARY ORDER, so the output is sorted the way the axis is
  // without this function having to know how either series is sorted.
  const out = []
  for (let i = 0; i < primary.length; i++) {
    const p = primary[i]
    const key = p && typeof p === 'object' ? p.t : undefined
    if (key === undefined || key === null) continue
    const bar = at.get(key)
    if (bar !== undefined) out.push(bar)
  }
  return out
}

// ⭐ MEMOISED FOR THE REASON `projectionFor` IS: `binder.js` folds a payload's
// identity into its memo signature, so a clip rebuilt every paint would make
// every consumer miss while the numbers stayed right — the failure mode that is
// hardest to notice. Keyed on both object identities, in the same WeakMap shape.
const _clipCache = new WeakMap()   // secondaryBars -> { primary, bars }

/** `clipBarsToDomain`, memoised on (secondary bars, primary bars). */
export function clippedBarsFor(secondaryBars, primaryBars) {
  if (!secondaryBars || typeof secondaryBars !== 'object') {
    return clipBarsToDomain(secondaryBars, primaryBars)
  }
  let entry = _clipCache.get(secondaryBars)
  if (!entry || entry.primary !== primaryBars) {
    entry = { primary: primaryBars, bars: clipBarsToDomain(secondaryBars, primaryBars) }
    _clipCache.set(secondaryBars, entry)
  }
  return entry.bars
}

// app/src/components/chart/engine/runtime/startLatched.js
//
// ─── ⭐⭐ (e103, coordinator ruling 2026-11-27) — WHAT A RUN WITHHOLDS BECAUSE IT LATCHES ITS CHART'S START ─────────
//
// Fred RS (rs-rating-fred6724, `docs/pine/rs-rating/rs-rating-fred6724__pziQwiT2.pine`) draws three things on its
// newest bar: the RS line's new-high dot (`label.style_circle`, no text) and the two rating labels ("RS Rating" and the
// number). The dot reads the RS line, `close / SP:SPX` times a constant, and `ta.highest` of it over at most 252 bars:
// the same value on a bar whatever bar the chart starts at, once 252 + 250 bars stand behind it. The rating does NOT:
// `var float[] different_values` latches the first 7 distinct seed values the run meets, in the order it meets them
// (lines ~265-304), so where the chart starts decides the levels the rating is read against.
//
// So on a chart whose history does not start at the listing, the run (`runtimeColumns.js::computeStartFree`) serves
// the dots and withholds the rating labels BY NAME, under `RUNTIME_START_LATCHED_GUARD`, never a guess. Every rule here
// is keyed on the script's exact source (`FRED_RS_SOURCE_SHA256`): an edited script is another script and is refused
// as before (`runtime:history-start`).
//
// ⛔ THIS MODULE IMPORTS NOTHING: the run (worker) and the binder both read it.

/** The code a drawing is withheld under when its value latches state from the run's first bar. */
export const RUNTIME_START_LATCHED_GUARD = 'runtime:start-latched-state'

/** What the member reads for it. */
export const START_LATCHED_REASON = "the rating needs the stock's full history; it's shown on daily charts that "
  + 'reach the listing'

/** sha256 of Fred RS's source, the house indicator (`runtimeKill.js::runtimeSourceHash` of the file above). */
export const FRED_RS_SOURCE_SHA256 = 'caa94fe31a8788c0f52ca571dbb1b3f8a7499dae913ed5e710720fc8662c5af0'

/** How many bars a chart must hold, and the first bar (0-based) whose values are served: 252 bars of the longest
 *  look-back (`n252`, `input.int(... maxval = 252)`) plus the 250-bar new-high look-back. Bars [0, 501) are withheld. */
export const START_FREE_MIN_BARS = 502
export const START_FREE_FROM_BAR = START_FREE_MIN_BARS - 1

/** Is `o` (a run drawing, `objectStore.finish().live[]`) one of Fred RS's start-free dots: a label drawn as a circle,
 *  with no text, made on a bar whose look-back is start-free? */
export function isStartFreeDot(o) {
  if (!o || o.family !== 'label' || !o.props || typeof o.props !== 'object') return false
  if (!Number.isInteger(o.createdBar) || o.createdBar < START_FREE_FROM_BAR) return false
  const style = o.props.style
  if (typeof style !== 'string' || !/(^|[._])circle$/.test(style)) return false
  const text = o.props.text
  return text === undefined || text === null || text === ''
}

/** ⭐⭐ (coordinator ruling 2026-11-27, second pass) — THE RATING LABELS OFF A DAILY CHART ARE START-FREE TOO. Fred RS
 *  writes the number only when `timeframe.isdaily` (`labelText2 := ... str.tostring(totalRsRating)` under `isDaily`); on
 *  every other timeframe, at its defaults (`ratingOnly` false), its two labels are the constant "RS Rating" heading and an
 *  empty label, made on the newest bar (`barstate.islast`) at `(bar_index, rs)`: nothing in them reads the latched levels.
 *  TradingView draws exactly these two there (FRED's fredgaps captures, ADT 1m / 15m / 1M and SPY 1m, 2026-11-27: text,
 *  style `label_center`, size normal / large, left-aligned, at the price, in the script's blue). Each property is checked
 *  here, so a label the run makes any other way stays withheld. */
export const FRED_RS_HEADING_TEXT = '                RS Rating'
const CONSTANT_LABELS = Object.freeze({ [FRED_RS_HEADING_TEXT]: 'normal', '': 'large' })
const FRED_RS_BLUE = '#0000ff'
/** Is `tf` (the chart's `ctx.tf`) a timeframe on which `timeframe.isdaily` is false: intraday (`'5'`, `'60'`, `'30S'`),
 *  weekly or monthly (`'W'`, `'3M'`)? An unknown or daily spelling is not (fail closed: the number may be printed). */
export function isNonDailyTf(tf) {
  return typeof tf === 'string' && /^(\d+S?|\d*W|\d*M)$/.test(tf)
}
/** Is `o` one of Fred RS's two constant rating labels, drawn exactly as its defaults draw them off a daily chart? */
export function isConstantRatingLabel(o) {
  if (!o || o.family !== 'label' || !o.props || typeof o.props !== 'object' || !Number.isInteger(o.createdBar)) return false
  const p = o.props
  if (typeof p.text !== 'string' || !Object.prototype.hasOwnProperty.call(CONSTANT_LABELS, p.text)) return false
  return p.size === CONSTANT_LABELS[p.text] && p.style === 'label_center' && p.textalign === 'left' && p.yloc === 'price'
    && typeof p.textcolor === 'string' && p.textcolor.toLowerCase() === FRED_RS_BLUE
    && typeof p.color === 'string' && /^#[0-9a-f]{6}00$/i.test(p.color)
}
/** What a run off the listing keeps on this chart: the start-free dots, and off a daily chart the constant labels. */
export function isStartFreeOnChart(o, tf) {
  return isStartFreeDot(o) || (isNonDailyTf(tf) && isConstantRatingLabel(o))
}
/** The words for a chart too short for the new-high dot's look-back (it may draw one TradingView's longer run would). */
export const START_FREE_DOT_SHORT_REASON = `the RS new-high dot needs ${START_FREE_MIN_BARS} bars on this chart; it's shown once the chart holds them`

// ─── ⭐⭐ (owner, 2026-11-27) — THE SETTINGS A MEMBER MAY MOVE AND KEEP THE START-FREE READING ─────────────────────────
//
// UCT's Fred RS opens at the owner's TradingView settings (`house/houseNames.withHouseCreateInputs`: SpxValue 7200,
// offset 90, 'Historical RS New Highs', look-back 30), so "at its defaults" alone would leave every new instance refused
// off the listing. Each setting below was read in the script (`docs/pine/rs-rating/rs-rating-fred6724__pziQwiT2.pine`)
// and keeps the reading true, CHECKED BY VALUE (anything outside its declared range or options is refused as before):
//   · `SpxValue`, `offset`: `rsRatio = SpxValue * offset / 100` (offset - 10 on weekly), one constant on every bar;
//   · `lookback`, `lookback2`: `ta.highest(rs | high | low, n)` with 1 <= n <= 252 (`input.int(maxval = 252)`), inside
//     `START_FREE_FROM_BAR` (252 + 250 bars);
//   · `rsNewHigh`, `rsNewLow`: every option. The two newest-bar types draw one dot on `barstate.islast`; the two
//     Historical types draw one circle per event at `(bar_index, rs)`, each event start-free from `START_FREE_FROM_BAR`,
//     and which of them SURVIVE TradingView's label collector is handled by the run (`runtimeColumns.js::computeStartFree`);
//   · `plotNewHigh`, `plotNewLow`, `hideRSRat`: whether a drawing is made, never a value it reads;
//   · `blueDotCol`, `redDotCol`, `sizeLabHigh`, `sizeLabLow`: a dot's colour and size (`isStartFreeDot` reads neither).
// ⛔ LEFT OUT, refused as before: `lineTicker` (the run is served SP:SPX), `colorRS` (`isConstantRatingLabel` checks the
// script's blue), `ratingOnly` (it prints the latched number off a daily chart), the replay set and the MA settings.
const isBool = (v) => typeof v === 'boolean'
const isLen = (v) => Number.isInteger(v) && v >= 1 && v <= 252
const oneOf = (...opts) => (v) => typeof v === 'string' && opts.includes(v)
const anyColour = (v) => typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v))
const SIZES = ['Tiny', 'Small', 'Normal', 'Large']
export const RS_NEW_HIGH_TYPES = Object.freeze(['RS New Highs', 'RS New Highs Before Price', 'Historical RS New Highs',
  'Historical RS New Highs  Before Price'])
export const RS_NEW_LOW_TYPES = Object.freeze(['RS New Lows', 'RS New Lows Before Price', 'Historical RS New Lows',
  'Historical RS New Lows  Before Price'])
export const START_FREE_SETTINGS = Object.freeze({
  SpxValue: (v) => typeof v === 'number' && Number.isFinite(v) && v > 0,
  offset: (v) => Number.isInteger(v) && v >= 0 && v <= 2000,
  lookback: isLen,
  lookback2: isLen,
  rsNewHigh: oneOf(...RS_NEW_HIGH_TYPES),
  rsNewLow: oneOf(...RS_NEW_LOW_TYPES),
  plotNewHigh: isBool,
  plotNewLow: isBool,
  hideRSRat: isBool,
  blueDotCol: anyColour,
  redDotCol: anyColour,
  sizeLabHigh: oneOf(...SIZES),
  sizeLabLow: oneOf(...SIZES),
})
/** Are the run's moved settings (`ctx.runtimeInputs`, keyed by Pine name) all ones the start-free reading survives? */
export function startFreeSettingsAdmit(given) {
  if (given === undefined || given === null) return true
  if (typeof given !== 'object' || Array.isArray(given)) return false
  for (const [k, v] of Object.entries(given)) {
    const ok = Object.prototype.hasOwnProperty.call(START_FREE_SETTINGS, k) ? START_FREE_SETTINGS[k] : null
    if (!ok || !ok(v)) return false
  }
  return true
}
/** Does this run draw one dot per event (a Historical type, plotted), whose oldest survivors depend on the chart's start? */
export function historicalDotsOn(given) {
  const g = given && typeof given === 'object' ? given : {}
  const high = (g.plotNewHigh ?? true) === true && /^Historical/.test(g.rsNewHigh ?? 'RS New Highs')
  const low = (g.plotNewLow ?? false) === true && /^Historical/.test(g.rsNewLow ?? 'Historical RS New Lows')
  return high || low
}
/** The words for the oldest Historical dots, which TradingView's label collector keeps or not by bars this chart lacks. */
export const START_FREE_OLDEST_DOTS_REASON = 'the oldest RS new-high dots depend on bars before this chart starts; '
  + 'the newest are shown'

/** The record a run that withheld its start-latched drawings carries on its payload (`startLatched`), or null. */
export function startLatchedOf(payload) {
  const r = payload && typeof payload === 'object' ? payload.startLatched : null
  return r && typeof r === 'object' && r.guard === RUNTIME_START_LATCHED_GUARD ? r : null
}

/**
 * HOW an output draws — as distinct from WHAT it computes and WHERE it goes.
 *
 * ⭐⭐ THIS FILE IS THE THIRD SIDE OF THE TRIANGLE. `nativeRegistry` owns
 * CALCULATION, `displayTarget.js` owns PLACEMENT, and this owns PRESENTATION.
 * The whole point is that changing this one changes neither of the others: an
 * RSI drawn as an area is the SAME RSI, computed once, placed where it already
 * was. If switching style ever recomputes, the seam has failed.
 *
 * ⭐ AND IT IS PER OUTPUT, NOT PER INDICATOR. That distinction is what MACD
 * forced: one instance, three outputs, and "the MACD line is a line, the signal
 * is dots, the histogram is a histogram" is not expressible by a single value.
 * RSI keeps working unchanged because the per-output map is an OVERRIDE over an
 * instance-level fallback, not a replacement for it.
 *
 * ⛔⛔ A USER STYLE IS NOT A DEFINITION STYLE, AND CONFLATING THEM WOULD HAVE
 * BEEN THE MISTAKE HERE. `defSchema.PLOT_STYLES` is the AUTHOR's vocabulary —
 * `line`, `stepline`, `histogram`, `area`, `baseline`, `hlines`, `markers`,
 * `band` — and it includes shapes no user picks (`hlines` is a guide; `band`
 * derives from other columns). The USER's vocabulary is the five below, and
 * `PLOT_STYLE_TO_DEF_STYLE` is the one place they meet. Two vocabularies, one
 * mapping, no renderer that has to know both.
 */

/** The default. Absent means this, and the setters delete rather than write it,
 *  so the default has exactly one representation on disk. */
export const DEFAULT_PLOT_STYLE = 'line'

/** Every style a USER can choose. A stored value outside this list is data that
 *  bypassed validation and reads as the fallback rather than as a guess — the
 *  same fail-safe direction `resolvePlacement` takes. */
export const PLOT_STYLES = Object.freeze([
  'line', 'histogram', 'dots', 'area', 'lastValueHorizontal',
])

/** What the Plot Style control offers, with the words a user sees. */
export const PLOT_STYLE_CHOICES = Object.freeze([
  { value: 'line', label: 'Line' },
  { value: 'histogram', label: 'Histogram' },
  { value: 'dots', label: 'Dots' },
  { value: 'area', label: 'Area' },
  { value: 'lastValueHorizontal', label: 'Last value horizontal' },
])

/**
 * A user style → the DEFINITION style the renderer already knows how to draw.
 *
 * ⭐ THIS IS WHY HISTOGRAM, DOTS AND AREA COST ALMOST NOTHING. Every one of them
 * is a shape `seriesOptionsForPlot` has drawn since before this project: a
 * histogram is `poolKey 'histogram'`, dots are the `markers` style SAR has always
 * used (`lineWidth: 0` + point markers), area is `poolKey 'area'`. The work was
 * never a renderer — it was that nothing let a USER ask for one.
 *
 * ⚠️ `lastValueHorizontal` MAPS TO A LINE ON PURPOSE. It draws no history at all,
 * so the underlying series type is only a carrier for the price line that shows
 * the level — and a line series is the one that can be silenced with
 * `lineVisible: false` without losing its price lines (a histogram has no such
 * option). Mapping it to whatever the output happened to be would make the
 * carrier vary for no visible gain and break on histogram outputs.
 */
export const PLOT_STYLE_TO_DEF_STYLE = Object.freeze({
  line: 'line',
  histogram: 'histogram',
  dots: 'markers',
  area: 'area',
  lastValueHorizontal: 'line',
})

/**
 * The DEFINITION styles a user may re-style at all.
 *
 * ⛔ `hlines` AND `band` ARE ABSENT, AND THAT IS THE CAPABILITY MODEL'S WHOLE
 * FIRST RULE: do not offer a dropdown that lies. A guide line is not an output a
 * reader switches to dots; a band's meaning depends on OTHER columns
 * (`plots[].edges`), so "draw it as a histogram" has no answer. `hlines` never
 * reaches this path anyway — `planBindings` walks `dataPlots` — so listing it
 * would be a rule about something that cannot happen.
 */
const RESTYLEABLE_DEF_STYLES = Object.freeze(
  new Set(['line', 'stepline', 'histogram', 'area', 'baseline', 'markers']),
)

/**
 * ⛔ STYLES THAT DO NOT BELONG ON A SHARED PANE, and why capability depends on
 * PLACEMENT and not only on the output.
 *
 * The volume pane already draws a histogram from zero across its full width. A
 * second histogram in the same rectangle is two bar charts on two different
 * scales overlapping pixel for pixel — unreadable, and unreadable in a way the
 * user cannot diagnose. An area fill does the same thing more quietly: it
 * covers the volume bars it is drawn over.
 *
 * Line and Last Value Horizontal read fine over a histogram, which is why those
 * two are what POC C proved and what stays offered here.
 */
const SHARED_PANE_EXCLUDED = Object.freeze(new Set(['histogram', 'area']))

const isKnownStyle = (v) => typeof v === 'string' && PLOT_STYLES.includes(v)

/**
 * The styles this output may be offered, here.
 *
 * @param {object} plot   a resolved plot from the definition
 * @param {object} [ctx]  `{ target }` — where the indicator is drawing
 * @returns {string[]} possibly empty, which means "no control at all"
 */
export function availableStyles(plot, ctx) {
  const declared = plot && plot.style
  if (!declared || !RESTYLEABLE_DEF_STYLES.has(declared)) return []
  const shared = ctx && ctx.target === 'volume'
  return PLOT_STYLES.filter((s) => !(shared && SHARED_PANE_EXCLUDED.has(s)))
}

/**
 * The effective plot style for ONE output of one instance.
 *
 * ⛔⛔ THE FALLBACK CHAIN IS THE BACKWARD-COMPATIBILITY STORY, in this order:
 *
 *   1. `presentation.plots[plotKey].style` — this output, explicitly
 *   2. `presentation.plotStyle`            — the instance-level answer
 *   3. `plot.style`                        — what the DEFINITION ships
 *   4. `DEFAULT_PLOT_STYLE`                — a plot that declares nothing
 *
 * (2) is what keeps every RSI saved by POC D rendering exactly as it did: it
 * stored an instance-level `plotStyle` and there is no per-output entry to
 * outrank it. (3) is what keeps MACD's histogram a HISTOGRAM: an untouched
 * instance has no presentation at all, so each output falls through to its own
 * declared shape rather than to a single shared default. Collapsing (3) into a
 * flat `'line'` would have quietly redrawn every multi-output indicator on the
 * first load after this shipped.
 *
 * ⚠️ KEYED BY `plot.key`, WHICH IS THE STABLE OUTPUT IDENTITY. `plots[].key` is
 * the same string the compute columns, the binding keys (`instanceId::plotKey`),
 * the legend chips and the alert seam all use — `macd` / `signal` / `histogram`,
 * `k` / `d`, `williams_r`. NOT the array index (reordering outputs would
 * re-target every stored style) and NOT the display label (renaming or
 * translating one would lose it).
 */
export function resolvePlotStyle(instance, plot) {
  const pres = instance && instance.presentation
  const key = plot && plot.key

  let chosen = null
  if (pres && pres.plots && typeof key === 'string' && key) {
    const perOutput = pres.plots[key] && pres.plots[key].style
    if (isKnownStyle(perOutput)) chosen = perOutput
  }
  if (!chosen && pres && isKnownStyle(pres.plotStyle)) chosen = pres.plotStyle

  if (!chosen) {
    const declared = plot && plot.style
    // The definition's vocabulary is the author's; map it back into the user's.
    for (const [userStyle, defStyle] of Object.entries(PLOT_STYLE_TO_DEF_STYLE)) {
      // `lastValueHorizontal` also maps to `'line'`, and a definition that ships a
      // line must resolve to `line` — so the first match wins and the LVH entry,
      // which comes later in the object, can never be reached from a declaration.
      if (defStyle === declared) { chosen = userStyle; break }
    }
  }
  if (!chosen) chosen = DEFAULT_PLOT_STYLE

  // ⛔⛔ CAPABILITY BINDS THE RENDERER, NOT JUST THE MENU — and this line is here
  // because leaving it out was VISIBLE. An RSI stored as `area` and then sent to
  // the Volume pane kept its stored style: the dropdown correctly stopped
  // OFFERING Area, and the chart drew it anyway, a full-height translucent fill
  // over the candles it was supposed to be read beside. A capability model that
  // only filters a `<select>` is a suggestion; one the resolver honours is a rule.
  //
  // ⚠️ THE STORED VALUE IS NOT REWRITTEN. Moving back to its own pane restores
  // Area, because the instance still says so — the clamp is a reading of the
  // state at a placement, not an edit of it. Same shape as `placement.position`
  // surviving a round trip through Volume.
  const allowed = availableStyles(plot, { target: instance && instance.placement && instance.placement.target })
  if (allowed.length && !allowed.includes(chosen)) return allowed[0]
  return chosen
}

/**
 * Does this style draw the HISTORY, or only the current value?
 *
 * ⭐ THE SERIES KEEPS ITS DATA EITHER WAY, and that is the load-bearing part.
 * "The historical line disappears" is a statement about INK, not about the
 * numbers: the crosshair still reads a value per bar, the legend still prints
 * `RSI(14) 56.53`, and nothing recomputes. Only `lineVisible` changes.
 */
export function drawsHistory(style) {
  return style !== 'lastValueHorizontal'
}

/**
 * Dot sizes, as a named vocabulary rather than a pixel box.
 *
 * ⭐ NOT THE LINE WIDTH, AND THAT IS DELIBERATE. `seriesOptionsForPlot` reads
 * `plot.width` as the dot RADIUS for a `markers` plot, so reusing the declared
 * line width would give RSI — which ships `width: 1` — a one-pixel dot: present
 * in the DOM, invisible on screen. A line's thickness and a dot's size are not
 * the same quantity and should not share a number.
 *
 * ⚠️ MEDIUM IS THE DEFAULT AND IS SMALLER THAN `DEFAULT_DOT_RADIUS` (3), which
 * SAR uses. SAR draws one dot per bar as its entire meaning; a re-styled
 * oscillator is competing with a pane full of other ink, and 2.5 is where a
 * 260-bar daily chart still reads as points rather than as a thick dotted line.
 */
export const DOT_SIZES = Object.freeze({ small: 1.5, medium: 2.5, large: 4 })
export const DEFAULT_DOT_SIZE = 'medium'
export const DOT_SIZE_CHOICES = Object.freeze([
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' },
])

/** The stored dot size for one output, with the same override→fallback shape as
 *  the style itself. */
export function resolveDotSize(instance, plot) {
  const pres = instance && instance.presentation
  const key = plot && plot.key
  const read = (v) => (typeof v === 'string' && Object.prototype.hasOwnProperty.call(DOT_SIZES, v) ? v : null)
  const perOutput = pres && pres.plots && typeof key === 'string' && pres.plots[key]
    ? read(pres.plots[key].dotSize) : null
  if (perOutput) return perOutput
  const instLevel = pres ? read(pres.dotSize) : null
  return instLevel || DEFAULT_DOT_SIZE
}

/**
 * The plot the RENDERER should draw — the definition's, restyled.
 *
 * ⭐ APPLIED IN `planBindings`, NOT AT BIND TIME, and that placement is the
 * reason style switching works at all. `poolKey(plot)` decides the SERIES TYPE,
 * and a LineSeries cannot become a HistogramSeries — the pool has to know the
 * type changed so it can retire the old series and make the right one. Doing
 * this later would leave the plan holding one type and the binder drawing
 * another.
 *
 * ⚠️ THE OBJECT IS RETURNED UNCHANGED WHEN NOTHING OVERRODE IT. Identity matters
 * downstream (`guideSignature`, plan diffing), and allocating a copy per plot per
 * sync to write the value that was already there is pure churn.
 */
export function presentedPlot(plot, instance) {
  if (!plot) return plot
  const style = resolvePlotStyle(instance, plot)
  const defStyle = PLOT_STYLE_TO_DEF_STYLE[style]
  if (!defStyle || defStyle === plot.style) return plot
  const next = { ...plot, style: defStyle }
  // Dots carry their size in `width`, because that is the field the `markers`
  // branch of `seriesOptionsForPlot` already reads as the point radius.
  if (defStyle === 'markers') next.width = DOT_SIZES[resolveDotSize(instance, plot)]
  return next
}

/**
 * Where a histogram's bars grow FROM, and an area fills TO.
 *
 * ⛔ NEVER INFERRED FROM THE VISIBLE MINIMUM. A baseline that moves with the
 * viewport is a chart that redraws its own meaning when you scroll. The answer
 * comes from metadata, in one order:
 *
 *   1. `plot.base` — an author who said so outright
 *   2. the definition's fixed `placement.scale.min` — RSI's bars grow from 0,
 *      Williams %R's from -100, because that IS the floor of their ladder
 *   3. zero — MACD, and every signed oscillator whose meaning is "above or
 *      below zero". Also lightweight-charts' own default, so a dynamic
 *      indicator's histogram is unchanged by this function existing.
 */
export function histogramBaseline(plot, scaleDomain) {
  if (plot && Number.isFinite(plot.base)) return plot.base
  if (scaleDomain && Number.isFinite(scaleDomain.min)) return scaleDomain.min
  return 0
}

/**
 * Definition INPUTS that the current styles make meaningless.
 *
 * ⭐ DERIVED FROM `plot.$refs`, NOT FROM THE INPUT'S NAME. A definition declares
 * which input drives which plot FIELD — `{ color: 'rsiColor', width: 'lineWidth',
 * lineStyle: 'vwapStyle' }` — so "is this control relevant" is answerable from
 * metadata rather than from guessing that a key called `lineWidth` is about
 * lines. A name heuristic would have been right today and wrong the first time a
 * definition named an input something else.
 *
 * ⛔ A `width` REF IS IRRELEVANT UNDER DOTS TOO, even though a dot has a size:
 * `presentedPlot` OVERRIDES `width` with the chosen dot size, so the declared
 * control would be a box whose value is ignored. The Dot size control replaces
 * it rather than fighting it.
 *
 * ⚠️ AN INPUT SHARED BY TWO OUTPUTS SURVIVES IF EITHER STILL USES IT. Hiding a
 * control because ONE of the plots it feeds stopped caring would silently strip
 * the user's only way to set it for the other.
 */
export function styleIrrelevantInputs(def, instance) {
  const hide = new Set()
  const keep = new Set()
  for (const plot of (def && Array.isArray(def.plots) ? def.plots : [])) {
    const refs = plot && plot.$refs
    if (!refs) continue
    if (refs.color) keep.add(refs.color)
    const style = resolvePlotStyle(instance, plot)
    // A line, an area and a last-value level are all DRAWN WITH A STROKE, so
    // width and dash pattern still mean something. A histogram and a dot are not.
    const stroked = style === 'line' || style === 'area' || style === 'lastValueHorizontal'
    for (const field of ['width', 'lineStyle']) {
      const key = refs[field]
      if (!key) continue
      if (stroked) keep.add(key)
      else hide.add(key)
    }
  }
  for (const k of keep) hide.delete(k)
  return hide
}

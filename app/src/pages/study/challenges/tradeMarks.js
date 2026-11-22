// THE TRADE ON THE CHART, every mode (the owner, batch 24 on the lesson: "the visual graphic of the chart ... can also
// list the levels and action items in the chart as well ... so they can see it all by looking at the chart"). The levels
// are dashed lines with their price on the scale (ENTRY gold, STOP red, the marks green: 3R and 5R, marks on the ruler
// and never fixed sells since the owner's D-013, read from the plan's trim_r); the action items sit on the bars where
// they happened (BOUGHT, the marks reached, STOPPED OUT). What each level is and why it sits there is the chart key directly under the
// chart (ui/ChartKey.jsx): the floating level chips it replaces overlapped each other and ran under the price scale.
// THE ACTION ITEMS (2026-11-08, found on the phone screens: text boxes drawn on the chart ran under the price scale,
// landed on each other and, kept clear of the candles, floated away from their own bar on a trend). They are the chart's
// own bar markers now: an arrow or a dot AT the bar with a short word, which the chart stacks when two share a bar and
// keeps inside the price area, so they never cover a candle, never leave their bar and hold still as the replay runs.
// What each one means, and its price, is the key under the chart.
import { trimLabels } from './hardMode'

const LEVEL_GOLD = '#dcbb5e', LEVEL_RED = '#df4646', LEVEL_GREEN = '#2faf68'

/** The trade's levels, in the order and the words of the chart key (ui/ChartKey.jsx): [name, price, colour]. */
function levelsOf(trade) {
  if (trade.kind === 'plan') {
    const [l1, l2] = trimLabels(trade)
    return [[trade.long === false ? 'SHORT' : 'ENTRY', trade.entry, LEVEL_GOLD], ['STOP', trade.stop, LEVEL_RED], [l1, trade.t1, LEVEL_GREEN], [l2, trade.t2, LEVEL_GREEN]]
  }
  return [[trade.short ? 'MUST STAY UNDER' : 'MUST HOLD', trade.line, LEVEL_RED]]
}

/** The levels as dashed rays from the signal bar to the chart's right edge. `chips: false` drops the small price chip at
 *  the ray's start: a surface that prints the levels on the price axis (tradeLevelLines) passes it, because that chip was
 *  dropped whenever two levels sat close (the entry and the stop always do), so the levels read as unlabeled stubs.
 *  `endAt` (a bar time) stops each ray at that bar, short of the axis tags' names in the blank room after it. */
export function tradeAnnotations(trade, signal, all, { chips = true, endAt = null } = {}) {
  if (!trade || !signal || !all?.length) return null
  const t0 = signal.t
  const out = []
  for (const [label, price, color] of levelsOf(trade)) {
    if (!Number.isFinite(price)) continue
    const id = label === 'SHORT' ? 'ENTRY' : label
    out.push({ id: `hard-${id}`, type: 'hray', points: [{ time: t0, price }], color, lineWidth: id === 'ENTRY' || id === 'STOP' ? 2 : 1.5, lineStyle: 'dashed', showPriceLabel: chips,
      ...(endAt != null ? { rightBoundTime: endAt } : {}) })
  }
  return out.length ? out : null
}

/** THE LEVELS ON THE PRICE AXIS (the Study screen check, 2026-11-14: "the trade's level lines are short unlabeled stubs;
 *  entry and stop merge into one band"). One axis tag per level with its price, in the level's colour, the same prices and
 *  colours as the chart key under the chart; `titles` adds the level's name beside its tag, in the key's words (a wide
 *  screen; on a phone a name's box would sit on the newest candles). The chart's own price lines, drawn line-less (the
 *  dashed ray from the buy day is the line): the library never drops a tag and steps tags that would overlap apart, so the
 *  entry and the stop read as two tags however close they trade. StockChart's `priceLines` prop. */
export function tradeLevelLines(trade, { titles = true } = {}) {
  if (!trade) return null
  const out = []
  for (const [name, price, color] of levelsOf(trade)) {
    if (!Number.isFinite(price)) continue
    // a dark chip with the level's colour as its ink: the chart's own last-price tag is a SOLID green or red chip, and a
    // solid 3R or stop tag beside it read as a second last price (the screen check, mid-replay: three green tags)
    out.push({ price, color, title: titles ? name : '', lineVisible: false, axisLabelVisible: true, lineWidth: 1, lineStyle: 2,
      axisLabelColor: LEVEL_CHIP[color] || '#141518', axisLabelTextColor: LEVEL_INK[color] || color })
  }
  return out.length ? out : null
}
// the chip under each level's tag (the level's hue at about 15% on the chart's black) and the tag's ink (the level's hue,
// lifted to read at 4.5:1 or better on that chip)
const LEVEL_CHIP = { [LEVEL_GOLD]: '#2e2711', [LEVEL_RED]: '#3a1517', [LEVEL_GREEN]: '#0f2c1b' }
const LEVEL_INK = { [LEVEL_GOLD]: '#f1d784', [LEVEL_RED]: '#ff9b93', [LEVEL_GREEN]: '#7fe3aa' }

/** How many bars apart two markers' words must stand so they do not print on top of each other: about 56 px of label,
 *  in the bars of the frame the chart shows (`frameBars` across a plot `plotPx` wide). */
export function markerGapBars(frameBars, plotPx) {
  if (!(frameBars > 0) || !(plotPx > 0)) return 0
  return Math.ceil((56 * frameBars) / plotPx)
}

/** Two of the trade's marks on neighbouring bars printed their words over each other (the screen check: STOPPED a day
 *  after BOUGHT, the red square on the BOUGHT text). A later mark within `near` bars of an earlier one on the same side
 *  moves to the other side of its bar when that side is clear there; when neither side is, it keeps its shape and drops
 *  its word (the chart key names it). Marks on the SAME bar stack, which the chart does itself. Earlier marks never move,
 *  so a mark holds still as the replay lands the ones after it. */
function spreadMarks(marks, idx, near) {
  if (!(near > 0)) return marks
  const placed = []
  for (const m of marks) {
    const i = idx.get(m.time)
    const clash = (pos) => placed.some((p) => p.position === pos && p.i !== i && Math.abs(p.i - i) < near && p.m.text)
    if (clash(m.position)) {
      const other = m.position === 'aboveBar' ? 'belowBar' : 'aboveBar'
      if (!clash(other)) m.position = other
      else m.text = ''
    }
    placed.push({ i, position: m.position, m })
  }
  return marks
}

/** The trade's action items as the chart's bar markers, on the bars the chart shows so far: BOUGHT (or SHORTED) at the
 *  signal, 3R and 5R where they traded, STOPPED where the plan's stop was hit; a signal-only trade marks where it broke
 *  its line. `n` = the bars before the run-on (the signal is bar n - 1). `near` (markerGapBars) spreads marks whose words
 *  would overlap at the chart's scale; without it they sit as before. */
export function tradeMarkers(trade, all, n, { near = 0 } = {}) {
  if (!trade || !all?.length || !(n >= 1)) return null
  const GOLD = '#dcbb5e', RED = '#ef5350', GREEN = '#2faf68'
  const out = []
  const idx = new Map()
  const at = (s) => (Number.isFinite(s) ? all[n - 1 + s] : null)
  const put = (s, m) => { const b = at(s); if (b) { out.push({ time: b.t, size: 1.4, ...m }); idx.set(b.t, n - 1 + s) } }
  if (trade.kind === 'plan') {
    const long = trade.long
    const [l1, l2] = trimLabels(trade)
    put(0, { position: long ? 'belowBar' : 'aboveBar', shape: long ? 'arrowUp' : 'arrowDown', color: GOLD, text: long ? 'BOUGHT' : 'SHORTED' })
    if (trade.t1At) put(trade.t1At, { position: long ? 'aboveBar' : 'belowBar', shape: 'circle', color: GREEN, text: l1 })
    if (trade.t2At) put(trade.t2At, { position: long ? 'aboveBar' : 'belowBar', shape: 'circle', color: GREEN, text: l2 })
    if (trade.stoppedSession) put(trade.stoppedSession, { position: long ? 'belowBar' : 'aboveBar', shape: 'square', color: RED, text: 'STOPPED' })
  } else if (trade.broke) {
    put(trade.broke, { position: trade.short ? 'aboveBar' : 'belowBar', shape: 'square', color: RED, text: trade.short ? 'CLOSED OVER' : 'CLOSED UNDER' })
  }
  // the chart wants them in time order; 3R and 5R on the signal day itself (t1At 0) are said by the key
  return out.length ? spreadMarks(out.sort((a, b) => String(a.time).localeCompare(String(b.time))), idx, near) : null
}

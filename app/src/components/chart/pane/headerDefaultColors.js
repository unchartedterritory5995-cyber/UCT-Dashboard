// The chart header's BUILT-IN colours — what the ticker title and the day change show when the member has saved no
// colour of their own (Chart Settings → Header & legend). Owner 11-16 (UCT Signature: gold only on the current /
// chosen thing): the title is plain white, and the day change takes the chart's OWN candle up / down colours, so the
// header agrees with the candles it sits above. A saved colour (header.colors.*) always wins. ONE authority, read by
// the pane header (ChartPane) and by the Chart Settings swatches, so the swatch shows what the header draws.
import { CHART_DEFAULTS } from '../chartDefaults'

export const HEADER_TITLE_WHITE = '#ededed'      // Signature text (the same white as the header values)
const SUNRISE = Object.freeze({ title: '#12202c', up: '#0a5c22', down: '#7d1620' })   // bright header: dark inks

/** { title, dayChangeUp, dayChangeDown } — the saved colour, else the built-in default. Pure. */
export function headerColors(cs, theme) {
  const saved = cs?.header?.colors || {}
  const candles = cs?.candles || {}
  const sunrise = theme === 'sunrise'
  return {
    title: saved.title || (sunrise ? SUNRISE.title : HEADER_TITLE_WHITE),
    dayChangeUp: saved.dayChangeUp || (sunrise ? SUNRISE.up : (candles.upColor || CHART_DEFAULTS.candles.upColor)),
    dayChangeDown: saved.dayChangeDown || (sunrise ? SUNRISE.down : (candles.downColor || CHART_DEFAULTS.candles.downColor)),
  }
}

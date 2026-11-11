// ── CHART MENU parity (family C: right-click and header parity, 2026-11-11) ──────────────────────────
//
// A chart's right-click menu items the Agent could not reach, through the SAME writers / doors the menu uses:
//
//   chartMenu.askAi           right-click → "Ask AI about {sym}" (C1-178): ChartWidget's own openAskAi, the
//                             /research/:sym?section=ai route (host.charts.askAi → the ChartWidget adapter).
//                             It leaves Charts, so — as app.open — it opens AFTER the receipt; no Undo (Back).
//   chartMenu.resetWatermark  Chart Settings → Watermark → "Reset to center" (C1-061; the right-click "Watermark settings"
//                             opens that section): ChartWidget resetWatermark's write, opts.watermarkPos = null (the
//                             chart kind's watermarkPos patch). Read back from the widget's opts; exact Undo (the position before).
//
// Send to Journal (C1-176 / C1-177) is NOT here: it is widget.sendToJournal over the chart's own capture door
// (ChartWidget useWidgetDoor), the one path every widget's door uses.
//
// Targeting is the chart kind's (the clicked chart, deixis, a relation, "Which chart?"), never its own.

import { registerCapability } from '../capabilities'

const onCharts = (ctx) => ctx.surface === 'charts'
const chartCommon = { target: 'chart', surfaces: ['charts'], available: onCharts }

export const ASK_AI_NO_UNDO = 'Ask AI opens another page, so there is nothing to undo here: use Back to return to Charts.'
const NO_ASK_AI = 'I can\'t open Ask AI from that chart here. Right-click the chart\'s bars → Ask AI, or open the stock in Research.'
const NO_SYMBOL = 'That chart has no symbol yet, so there is nothing to ask AI about.'

let registered = false
export function registerChartMenuCapabilities() {
  if (registered) return
  registered = true

  registerCapability({
    ...chartCommon,
    name: 'chartMenu.askAi',
    summary: 'Open Ask AI about ONE chart\'s symbol, exactly like the chart\'s right-click → "Ask AI about {symbol}": the stock\'s Research page, AI section. It leaves Charts (this panel closes; the conversation is kept). Changes nothing on the chart; no Undo.',
    hints: 'target = the chart whose symbol to ask about. Only when they ask to OPEN Ask AI / the AI about the chart\'s stock; a question about data is answered here instead. A stock that is not on a chart is app.open (page research).',
    args: { type: 'object', properties: {}, required: [], additionalProperties: false },
    undo: 'none',
    undoNote: ASK_AI_NO_UNDO,
    check(st) {
      if (!st.symbol) return NO_SYMBOL
      return st.canAskAi ? null : NO_ASK_AI
    },
    apply: (st) => ({ ...st, askAi: true }),
    describe: (b, a) => (a.askAi ? `Opening Ask AI about ${b.symbol} (its Research page) — this closes the panel; nothing on the chart changed` : null),
  })

  registerCapability({
    ...chartCommon,
    name: 'chartMenu.resetWatermark',
    summary: 'Put ONE chart\'s dragged symbol watermark back in the centre (Chart Settings → Watermark → "Reset to center"). Only the hand-placed position is cleared; the watermark\'s text, size and colour stay. Undo puts it back where it was.',
    hints: 'target = the chart. To set a position by number use chart.setSetting (watermark.x / watermark.y); to hide or show the watermark, chart.setSetting too.',
    args: { type: 'object', properties: {}, required: [], additionalProperties: false },
    check: () => null,
    apply: (st) => (st.watermarkPos == null ? st : { ...st, watermarkPos: null }),
    describe: (b, a) => (b.watermarkPos != null && a.watermarkPos == null ? 'Reset the watermark to the centre' : null),
    noop: () => 'The watermark is already in its default place (it was never moved by hand)',
  })
}

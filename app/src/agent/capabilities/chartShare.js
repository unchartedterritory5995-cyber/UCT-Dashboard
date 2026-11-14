// ── CHART SHARE: a chart as a PNG, and its Share menu (Charts execution family, 2026-11-13) ─────────────────────────────
//
// The chart toolbar's Share button opens ONE popover (StockChart ScreenshotPopover): Download PNG · Copy to Clipboard · Copy
// Share URL. The Agent reaches it through the SAME doors (StockChart toolbarApiRef → ChartPane → ChartWidget adapter →
// host.charts), never a second capture or a second link builder:
//
//   chartShare.export  output 'image' = Share → Download PNG (StockChart handleDownload: composeScreenshot + downloadBlob, the
//                      popover's own file name). Reported only once a PNG was composed and handed to the browser's download
//                      (the door resolves to the file name; null = nothing was made → a failure, never a receipt).
//                      output 'link'  = the chart's Share popover OPENED, read back from StockChart's own state. ⛔ The Agent
//                      never copies: a browser lets only a click write the clipboard, so "Copy Share URL" stays the member's
//                      click (which now says "URL copied" only once the browser confirmed it). Never a faked copy.
//                      output 'both'  = the PNG, then the popover.
//
// Nothing on the chart changes, so there is no Undo (a downloaded file cannot be taken back; the popover closes with ×).
// It runs LAST in its chart's commit (chart.js chartKind), after anything else asked of that chart in the same request, so the
// PNG is the chart as it then draws. A Multi Chart cell / pop-out has no Share doors: refused, nothing is pressed.
// Targeting is the chart kind's (the clicked chart, deixis, a relation, "Which chart?"), never its own.

import { registerCapability } from '../capabilities'

const onCharts = (ctx) => ctx.surface === 'charts'
const chartCommon = { target: 'chart', surfaces: ['charts'], available: onCharts }

export const CHART_SHARE_ACTION = 'chartShare.export'
export const SHARE_OUTPUTS = ['image', 'link', 'both']
export const SHARE_NO_UNDO = 'Nothing on the chart changed, so there is nothing to undo: a downloaded PNG stays in your downloads, and the Share menu closes with ×.'
export const NO_SHARE = 'That chart has no Share menu here (a Multi Chart cell or a pop-out chart). Use the Share button on a chart on the Charts board.'
export const NO_PNG = 'the chart could not be captured as a PNG, so nothing was downloaded — try the chart\'s Share → Download PNG'
const NO_SYMBOL = 'That chart has no symbol yet, so there is nothing to capture or share.'

let registered = false
export function registerChartShareCapabilities() {
  if (registered) return
  registered = true

  registerCapability({
    ...chartCommon,
    name: CHART_SHARE_ACTION,
    summary: 'Download ONE chart as a PNG (its Share → Download PNG) and/or open its Share menu, where Copy Share URL copies its link — a browser lets only a click copy, so the Agent never copies. Nothing on the chart changes; no Undo.',
    hints: 'target = the chart. output: image = download a PNG / screenshot; link = a share link (opens the Share menu); both. For the Journal, use widget.sendToJournal.',
    args: { type: 'object', properties: { output: { type: 'string', enum: SHARE_OUTPUTS } }, required: ['output'], additionalProperties: false },
    undo: 'none',
    undoNote: SHARE_NO_UNDO,
    check(st, { output }) {
      if (!SHARE_OUTPUTS.includes(output)) return 'Say whether you want a PNG of the chart, its share link, or both.'
      if (!st.canShare) return NO_SHARE
      return st.symbol ? null : NO_SYMBOL
    },
    apply: (st, { output }) => {
      const prev = st.share || {}
      const share = { image: prev.image || output !== 'link', link: prev.link || output !== 'image' }
      return prev.image === share.image && prev.link === share.link ? st : { ...st, share }
    },
    describe: (b, a, { output }) => {
      const parts = []
      if (output !== 'link') parts.push(`Downloaded a PNG of the ${a.symbol} chart (as its Share → Download PNG does)`)
      if (output !== 'image') parts.push(`opened its Share menu — click Copy Share URL there to copy the link (a browser lets only your click copy, so I didn't)`)
      if (!parts.length) return null
      const s = parts.join('; ')
      return s[0].toUpperCase() + s.slice(1)
    },
  })
}

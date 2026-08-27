// app/src/components/chart/engine/__tests__/macdV2.js
//
// ─── A DEFINITION-v2 MACD, BUILT FROM ENGINE FUNCTIONS ONLY ─────────────────
// The same measurements `BuilderSheet.buildDefinition` makes — `parseFormula`
// for each tree, `astHash` for the scan tree's `fn`, `treesHash` for the map,
// `lintRepaint`/`freshnessFor` per tree aggregated through `worstRepaint`/
// `stalestFreshness` — so an ENGINE test can hold a v2 document without
// mounting React. W1b.5's `BuilderSheet.plots.test.jsx` asserts the SHEET's own
// output validates through the same door this fixture does.
//
// ⛔ NOTHING HERE IS TYPED THAT THE ENGINE CAN DERIVE. The badges, the hashes
// and the trees are all computed at call time, so a fixture can never disagree
// with the gates it is handed to: if `worstRepaint` moves, this moves with it.
// A hand-typed `repaint: 'non-repainting'` here would make every per-tree badge
// case in `treesLane.test.js` pass for the wrong reason.
import { parseFormula, astHash } from '../ast/parse'
import { treesHash, worstRepaint, stalestFreshness } from '../ast/trees'
import { lintRepaint } from '../ast/lint'
import { freshnessFor } from '../ast/freshness'

/** The four sources, one per plot. `hist_up` is A1's 0/1 SCAN plot: `assert_scannable`
 *  refuses a number-valued tree, so the document carries a boolean tree beside the
 *  numeric ones and hides it (computed, never drawn). */
export const MACD_SRC = Object.freeze({
  macd: 'ema(close, 12) - ema(close, 26)',
  signal: 'ema(ema(close, 12) - ema(close, 26), 9)',
  hist: '(ema(close, 12) - ema(close, 26)) - ema(ema(close, 12) - ema(close, 26), 9)',
  hist_up: '(ema(close, 12) - ema(close, 26)) - ema(ema(close, 12) - ema(close, 26), 9) > 0',
})

const chrome = (key, label, color) => ([
  { key: `${key}Color`, type: 'color', label: `${label} colour`, default: color },
  { key: `${key}Width`, type: 'int', label: `${label} width`, default: 1, min: 1, max: 4, step: 1 },
])

export function macdV2Doc({ id = 'u_0123456789ab', version = 1, scanPlot = 'hist_up', hiddenScan = true, target = 'pane' } = {}) {
  const trees = Object.fromEntries(Object.entries(MACD_SRC).map(([k, s]) => [k, parseFormula(s).ast]))
  const inputs = [
    { key: 'color', type: 'color', label: 'Color', default: '#c9a84c' },
    { key: 'lineWidth', type: 'int', label: 'Line width', default: 1, min: 1, max: 4, step: 1 },
    ...chrome('signal', 'Signal', '#FF9800'),
    ...chrome('hist', 'Histogram', '#4CAF50'),
    ...chrome('hist_up', 'Signal up', '#c9a84c'),
  ]
  const scope = { inputs: Object.fromEntries(inputs.map((i) => [i.key, true])) }
  const modes = Object.values(trees).map((t) => lintRepaint(t, scope).mode)
  const fresh = Object.values(trees).map((t) => freshnessFor(t, scope).mode)
  return {
    schemaVersion: 1, id, version,
    compute: {
      kind: 'ast', fn: astHash(trees[scanPlot]), rev: 1, ast: trees[scanPlot], source: MACD_SRC[scanPlot],
      trees, treesHash: treesHash(trees), scanPlot, sources: { ...MACD_SRC },
    },
    meta: {
      name: 'MACD v2', shortName: 'MACD v2', category: 'Custom', description: 'the MACD histogram above zero',
      tags: ['custom'], tier: 'premium', repaint: worstRepaint(modes), freshness: stalestFreshness(fresh),
    },
    placement: target === 'price' ? { target: 'price' } : { target: 'pane', pane: { height: 0.17 } },
    inputs,
    plots: [
      { key: 'macd', label: 'MACD', style: 'line', color: '$color', width: '$lineWidth', role: 'primary', legend: { decimals: 4 } },
      { key: 'signal', label: 'Signal', style: 'line', color: '$signalColor', width: '$signalWidth', role: 'secondary', legend: { decimals: 4 } },
      { key: 'hist', label: 'Histogram', style: 'histogram', color: '$histColor', width: '$histWidth', role: 'secondary', legend: { hide: true } },
      { key: 'hist_up', label: 'Signal up', style: 'line', color: '$hist_upColor', width: '$hist_upWidth', role: 'signal',
        legend: { hide: true }, ...(hiddenScan ? { hidden: true } : {}) },
      { key: 'zero', label: '0', style: 'hlines', levels: [0], color: 'rgba(255,255,255,0.12)', width: 1, lineStyle: 'largeDashed', role: 'context' },
    ],
  }
}

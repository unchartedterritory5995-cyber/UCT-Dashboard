// ⭐ TARGET DECLARATIONS — Phase 3 measurement (SHADOW: prints the report; behaviour unchanged, nothing enforced).
// Sources (AUDIT condition 7):
//   corpus     capreg baseline corpus.json — every non-dark intent's canonical MODEL plan (the plan the corpus expects to run),
//              under each of its phrasings, path 'model'; and the deterministic readers' own plan for each phrasing, path 'fast'
//              (the same readers corpus.deterministic runs, with targets kept)
//   owner      the two owner production cases (11-13 layout clarify; 11-14 duplicate grid), planned as production planned them
//   heldout    __fixtures__/targetDecl/heldout.json when present — AUDIT held-out probes 33-39 and the #1261 generated set, as
//              { id, source, board, words, ops, expectRefusal } rows (not in the repo yet: requested from AUDIT)
// The gate for any enforce PR: 0 rows in `newRefusals` for the kind it enforces (a passing intent the validator would refuse).
import { describe, it, expect } from 'vitest'
import { registerCatalog, isDark } from '../capabilityRegression/testing/registry'
import { corpus, phrasingsOf } from '../capabilityRegression/testing/corpus'
import { panelHost, BOARDS } from '../capabilityRegression/testing/harness'
import { pinClock } from '../capabilityRegression/testing/clock'
import { makeBoard } from '../../__fixtures__/board'
import { mergeChartSettings } from '../../../components/chart/chartDefaults'
import { multiChartPlan } from '../../multiChart'
import { fastParse } from '../../fastPath'
import { measureCase, aggregate, report } from './measure'

pinClock()
await registerCatalog()

// every JSON file in __fixtures__/targetDecl (none yet: an absent folder is an empty held-out set)
const heldout = Object.values(import.meta.glob('../../__fixtures__/targetDecl/*.json', { eager: true, import: 'default' })).flat()

// the deterministic readers' plan for a phrasing, targets kept (corpus.deterministicReading drops them)
function readerOps(text, host) {
  try {
    const mc = multiChartPlan(text, { host })
    if (mc?.kind === 'ops') return mc.ops
    if (mc?.kind === 'steps') return mc.steps.flatMap(s => s.ops)
    if (mc) return null
    const fp = fastParse(text, { host })
    return fp?.kind === 'ops' ? fp.ops : null
  } catch { return null }
}

const settings = () => ({ settings: mergeChartSettings(null) })
const spyNvda = () => {
  const b = makeBoard([['c1', 0], ['c2', 12]].map(([id, x]) => ({ id, type: 'chart', x, y: 0, w: 12, h: 20, color: 'N', opts: settings() })), { 'N:c1': 'SPY', 'N:c2': 'NVDA' })
  return { ...b.host, charts: { ...b.host.charts, canManageIndicators: () => true, canCreateIndicator: () => true, previewHost: () => null, selected: () => null } }
}
const gridOp = (symbols, extra = {}) => ({ action: 'chartGrid.set', target: 'board', args: { symbols, timeframe: null, layout: 'grid', new_charts: null, watchlist: null, replace: null, ...extra } })
const OWNER = [
  // 11-13: "…2-by-2 grid, keeping SPY and NVDA" → asked → "Add AAPL and MSFT as the other two charts" → SPY became AAPL, NVDA MSFT
  { id: 'owner-1113-layout-clarify', words: 'Change my chart layout to a 2-by-2 grid, keeping SPY and NVDA in the layout. . Add AAPL and MSFT as the other two charts', ops: [gridOp(['AAPL', 'MSFT'])], expectRefusal: true },
  // 11-14: "Add AAPL and MSFT to my charts, but keep SPY and NVDA" → "All four in a grid" → SIX panels
  { id: 'owner-1114-duplicate-grid', words: 'Add AAPL and MSFT to my charts, but keep SPY and NVDA . All four in a grid', ops: [gridOp(['SPY', 'NVDA', 'AAPL', 'MSFT'], { new_charts: true })], expectRefusal: true },
  // …and the plan each should have been (must PASS)
  { id: 'owner-1114-right-plan', words: 'Add AAPL and MSFT to my charts, but keep SPY and NVDA . All four in a grid', ops: [gridOp(['AAPL', 'MSFT'], { new_charts: true })], expectRefusal: false },
]

function rows() {
  const out = []
  for (const intent of corpus.intents.filter(i => !isDark(i) && BOARDS[i.board || 'ONE'])) {
    const expectRefusal = !!intent.expect?.refusal
    for (const [n, ph] of phrasingsOf(intent).entries()) {
      if (ph.prelude) continue
      if (intent.model?.ops?.length) {
        const host = panelHost(intent.board || 'ONE')
        out.push({ id: `${intent.id}#${n}`, source: 'corpus', path: 'model', expectRefusal, m: measureCase({ words: ph.text, host, ops: intent.model.ops }) })
      }
      const host2 = panelHost(intent.board || 'ONE')
      const ops = readerOps(ph.text, host2)
      if (ops?.length) out.push({ id: `${intent.id}#${n}`, source: 'corpus', path: 'fast', expectRefusal, m: measureCase({ words: ph.text, host: host2, ops }) })
    }
  }
  for (const c of OWNER) out.push({ id: c.id, source: 'owner', path: 'model', expectRefusal: c.expectRefusal, m: measureCase({ words: c.words, host: spyNvda(), ops: c.ops }) })
  for (const h of heldout) {
    if (!BOARDS[h.board || 'ONE']) continue
    out.push({ id: h.id, source: h.source || 'heldout', path: h.path || 'model', expectRefusal: !!h.expectRefusal, m: measureCase({ words: h.words, host: panelHost(h.board || 'ONE'), ops: h.ops }) })
  }
  return out
}

describe('TARGET DECLARATIONS — shadow measurement (report only)', () => {
  const all = rows()
  it('prints the per-kind report, strict and with the one-chart reading', () => {
    console.log(`${report(aggregate(all, 'result'), 'TARGET-DECL STRICT')}\n\n${report(aggregate(all, 'sole'), 'TARGET-DECL +SOLE')}\n\nheld-out rows: ${heldout.length}`)
    expect(all.filter(r => r.m.status === 'planned').length).toBeGreaterThan(100)
  })
  it('both owner production cases are caught; the right plan passes', () => {
    const by = Object.fromEntries(all.filter(r => r.source === 'owner').map(r => [r.id, r.m.result]))
    expect(by['owner-1113-layout-clarify'].verdict).toBe('mismatch')
    expect(by['owner-1114-duplicate-grid'].verdict).toBe('mismatch')
    expect(by['owner-1114-duplicate-grid'].final).toBe('fail')
    expect(by['owner-1114-right-plan'].verdict).toBe('match')
  })
})

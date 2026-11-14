// ⭐ TARGET DECLARATIONS — Phase 3 measurement (SHADOW: prints the report; behaviour unchanged, nothing enforced).
// Sources (AUDIT condition 7):
//   corpus     capreg baseline corpus.json — every non-dark intent's canonical MODEL plan (the plan the corpus expects to run),
//              under each of its phrasings, path 'model'; and the deterministic readers' own plan for each phrasing, path 'fast'
//              (the same readers corpus.deterministic runs, with targets kept)
//   fixtures   __fixtures__/targetDecl/*.json — this module's OWN generated cases and the two owner production cases (11-13
//              layout clarify; 11-14 duplicate grid), as { id, source, board, words, ops, expectRefusal } rows. AUDIT's held-out
//              probes are NOT committed (AUDIT ruling): AUDIT runs them locally against the pure module, in the same row shape.
// The gate for any enforce PR: 0 rows in `newRefusals` for the kind it enforces (a passing intent the validator would refuse).
// `content` stays SHADOW (AUDIT ruling): its counts here measure this isolated harness, not the product.
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

// every JSON file in __fixtures__/targetDecl
const fixtures = Object.values(import.meta.glob('../../__fixtures__/targetDecl/*.json', { eager: true, import: 'default' })).flat()

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
  for (const h of fixtures) {
    const host = h.board === 'SPY_NVDA' ? spyNvda() : BOARDS[h.board || 'ONE'] ? panelHost(h.board || 'ONE') : null
    if (!host) continue
    out.push({ id: h.id, source: h.source || 'fixture', path: h.path || 'model', expectRefusal: !!h.expectRefusal, m: measureCase({ words: h.words, host, ops: h.ops }) })
  }
  return out
}

describe('TARGET DECLARATIONS — shadow measurement (report only)', () => {
  const all = rows()
  it('prints the per-kind report (AUDIT rules), and the same without the sole-chart evidence for comparison', () => {
    console.log(`${report(aggregate(all, 'result'), 'TARGET-DECL (AUDIT rules)')}\n\n${report(aggregate(all, 'nosole'), 'TARGET-DECL (sole-chart evidence OFF, comparison)')}\n\nfixture rows: ${fixtures.length}`)
    expect(all.filter(r => r.m.status === 'planned').length).toBeGreaterThan(100)
  })
  it('both owner production cases are caught; the right plan passes', () => {
    const by = Object.fromEntries(all.filter(r => r.source === 'owner').map(r => [r.id, r.m.result]))
    expect(by['owner-1113-layout-clarify'].verdict).toBe('mismatch')
    expect(by['owner-1114-duplicate-grid'].verdict).toBe('mismatch')
    expect(by['owner-1114-duplicate-grid'].final).toBe('fail')
    expect(by['owner-1114-right-plan'].verdict).toBe('match')
  })
  it('every fixture row reads as expected: a wrong plan is caught, a right one matches (an unresolved split list stays OPEN)', () => {
    const rowsF = all.filter(r => r.source === 'generated' || r.source === 'owner')
    expect(rowsF.length).toBe(fixtures.length)
    const got = Object.fromEntries(rowsF.map(r => [r.id, r.m.status === 'planned' ? r.m.result.verdict : 'unplanned']))
    const want = Object.fromEntries(fixtures.map(f => [f.id, f.id === 'g-grid-split-unresolved' ? 'open' : f.expectRefusal ? 'mismatch' : 'match']))
    expect(got).toEqual(want)
  })
})

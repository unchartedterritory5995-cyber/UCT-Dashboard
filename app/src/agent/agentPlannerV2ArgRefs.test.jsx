// ── v2-readiness-2: refs CARRIED IN ARGS under planner v2 (a capability's `argRefs`) ─────────────────────────────
//
// The chart-scoped indicator alert (#771: indicatorAlert.create gains `chart`, argRefs { chart: 'chart' }) is one of a
// family: chartSetup.saveTemplate `chart`, indicator copy `from`, screener `within`, widget `list`. v2 translates them as
// v1 does (translateRefs → argRefsBack over the turn's refMap, which also holds refs earlier steps created and their
// `as` aliases), and refuses a short ref the turn never offered — or one of the wrong kind — BY ARG NAME, so the model
// can correct it. The script IS the model (testing/stepServer.js). Planner v2 stays OFF in production.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen, waitFor } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, TWO } from './testing/panelHarness'
import { installStepServer } from './testing/stepServer'
import { _resetAgentConfig } from './agentClient'
import { getCapability } from './capabilities'
import { argRefProblem } from './steps'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

let p, srv
beforeEach(() => { _resetAgentConfig(); p = setupPanel() })
afterEach(() => { srv?.uninstall?.(); vi.restoreAllMocks(); cleanup() })

const settled = async () => { await waitFor(() => { if (screen.queryByTestId('agent-typing') || srv.stream) throw new Error('busy') }, { timeout: 15000 }) }
const section = (c, key, i = 0) => { const s = c.body.context[key]; return Array.isArray(s) ? s[i]?.ref : s?.ref }
const ema = (target, period) => ({ action: 'indicator.add', target, args: { defId: 'movingAverage', inputs: [{ key: 'period', value: period }, { key: 'maType', value: 'ema' }] }, mode: 'apply' })
// copy the left chart's indicators onto the right one: target = the right chart's indicatorEdits entry, `from` = an ARGS ref
const copy = (from) => (c) => ({ action: 'indicatorCopy.copyTo', target: section(c, 'indicatorEdits', 1), args: { from: typeof from === 'function' ? from(c) : from, instances: [] }, mode: 'apply' })

describe('v2-readiness-2 — argRefs (the chart-scoped alert `chart` family) under planner v2', () => {
  it('argRefProblem: an offered ref of the right kind passes; unknown / wrong-kind short refs are named; other values pass', () => {
    const refMap = { c1: { kind: 'chart', ref: 'cl' }, w1: { kind: 'watchlist', ref: 'wl1' } }
    const op = (chart) => ({ action: 'chartSetup.saveTemplate', args: { name: 'x', chart } })
    expect(getCapability('chartSetup.saveTemplate').argRefs).toEqual({ chart: 'chart' })
    expect(argRefProblem(op('c1'), refMap)).toBeNull()
    expect(argRefProblem(op('c9'), refMap)).toMatch(/^chart "c9" is not a ref on this board/)
    expect(argRefProblem(op('w1'), refMap)).toMatch(/^chart "w1" is a watchlist ref; chart needs a chart ref/)
    expect(argRefProblem(op('cl'), refMap)).toBeNull()                  // not a short ref (an alias / a real ref): untouched
    expect(argRefProblem(op(null), refMap)).toBeNull()
    expect(argRefProblem({ action: 'chart.setTimeframe', args: { timeframe: 'W' } }, refMap)).toBeNull()   // no argRefs
  })

  it('a step naming a chart in ARGS reads that chart (the model ref is translated, as in v1)', async () => {
    srv = installStepServer(p, [(c) => ema(section(c, 'indicatorEdits', 0), 21), copy((c) => c.body.context.charts[0].ref), { reply: '' }])
    const { say, board } = p.mount(...TWO())
    await say('put a 21 ema on the left panel and mirror its studies onto the right one')
    await settled()
    expect(srv.results.map(r => [r.status, r.refusal || ''])).toEqual([['done', ''], ['done', '']])
    expect(p.brief(board, 'cr')).toEqual(p.brief(board, 'cl'))
    expect(p.brief(board, 'cr').join()).toMatch(/21/)
  }, 30000)

  it('an args ref the turn never offered is refused by arg name and nothing runs', async () => {
    srv = installStepServer(p, [(c) => ema(section(c, 'indicatorEdits', 0), 21), copy('c9'), { reply: '' }])
    const { say, board } = p.mount(...TWO())
    await say('put a 21 ema on the left panel and mirror its studies onto the right one')
    await settled()
    expect(srv.results.map(r => r.status)).toEqual(['done', 'refused'])
    expect(srv.results[1].refusal).toMatch(/^from "c9" is not a ref on this board/)
    expect(p.brief(board, 'cr')).toEqual([])
  }, 30000)

  // #771 adds `chart` to indicatorAlert.create (argRefs { chart: 'chart' }); until it lands this case is skipped, and the
  // generic path above is what carries it. With #771 merged it pins the v2 path end to end on the rule itself.
  const alertHasChart = !!getCapability('indicatorAlert.create')?.argRefs?.chart
  it.skipIf(!alertHasChart)('#771: indicatorAlert.create `chart` — an unknown chart ref is refused by arg name in v2', () => {
    const refMap = { c1: { kind: 'chart', ref: 'cl' }, c2: { kind: 'chart', ref: 'cr' } }
    const op = (chart) => ({ action: 'indicatorAlert.create', args: { instance: 'ovl:0', plot: null, condition: 'above', threshold: 1, crossWith: null, chart } })
    expect(argRefProblem(op('c2'), refMap)).toBeNull()
    expect(argRefProblem(op('c7'), refMap)).toMatch(/^chart "c7" is not a ref on this board/)
  })
})

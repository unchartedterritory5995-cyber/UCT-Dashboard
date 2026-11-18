// ─── ⭐⭐ FRED RS, A SAVED COPY: A MOVED SETTING IN THE FIRST PLOT MOVES THE FIRST PLOT ─────────────────────────────
//
// Found by the 10-member sweep on production (2026-11-18): on a member's saved Fred RS, moving "Approximate Value
// of Comparative Symbol" (SpxValue, a folded parameter, `__uct_param_1005`) left the RS line where it was, while the
// run half took the new value, so the column rail refused the run half and the chart fell back to the host's
// drawings with "The complete set of this script's drawings isn't shown on this chart". Offset (a plain input)
// moved cleanly. A saved copy reads back as a shared graph whose hydration names the scan plot's locators
// `treeIndex: null`, and the specialiser wrote those into `compute.ast` only, while a multi-tree document runs its
// scan plot from `trees[scanPlot]` (`paramInputs.specializeParams`).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import * as registry from './nativeRegistry'
import { memberPaneDefinition } from '../builder/memberPane/memberPaneDefinition'
import { runtimeColumnsFor, resetRuntimeSessions, resetRuntimeLedgers } from './runtime/runtimeColumns'
import { __permitRuntimePaneForTests } from './runtimePaneGate'
import { __allowEveryRuntimeScriptForTests, setRuntimeKillList, runtimeSourceHash } from './runtimeKill'
import { setRunHalfObjectEvidence } from './runHalfRailSeam'
import { runHalfOf } from './runtime/runtimeObjects'
import { toGraphDocument, hydrateGraphDocument } from './ast/graphDocument'

const REPO = path.resolve(process.cwd(), '..')
const RS = fs.readFileSync(path.join(REPO, 'docs/pine/rs-rating/rs-rating-fred6724__pziQwiT2.pine'), 'utf8')
const SEED_KEY = 'SEED_FRED6725_RS_RATING:RSRATING'
const SESSIONS = (() => {
  const out = []
  for (let t = Date.parse('2026-11-17T00:00:00Z'); out.length < 600; t -= 86400000) {
    const wd = new Date(t).getUTCDay()
    if (wd !== 0 && wd !== 6) out.unshift(new Date(t).toISOString().slice(0, 10))
  }
  return out
})()
const CHART = SESSIONS.map((t, i) => { const c = 80 + 20 * Math.sin(i / 17) + i * 0.05; return { t, o: c - 0.4, h: c + 1.1, l: c - 1.2, c, v: 1e6 + i } })
const SPX = SESSIONS.map((iso, i) => { const c = 5400 + 300 * Math.sin(i / 41) + i * 3; return { t: Date.parse(`${iso}T00:00:00Z`) / 1000, o: c - 5, h: c + 20, l: c - 22, c, v: 3e9 } })
const SEED = SESSIONS.slice(-35, -1).map((t, i) => ({ t, o: 0, h: 1000, l: 0, c: 300 - 7 * i, v: 0 }))
const CTX = () => ({
  tf: 'D', symbol: { ticker: 'AGL', exchange: 'NYSE', industry: 'Medical Care Facilities', sector: 'Healthcare', securityType: 'stock' },
  newestBarIsForming: false, historyFromListing: true, exchangeOf: (t) => (t === 'SPX' ? 'SP' : null),
  secondary: new Map([['SPX', { bars: SPX, status: 'available' }], [SEED_KEY, { bars: SEED, status: 'available' }]]),
})
const MATCH = { verdict: 'MATCH', objectsV2: true, runtimeOn: true }

let ids = []
beforeEach(() => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  __permitRuntimePaneForTests()
  __allowEveryRuntimeScriptForTests()
  setRuntimeKillList([])
  registry.registerRuntimeLane(runtimeColumnsFor)
  // the defaults' evidence, and a moved SpxValue's (two captures each), as production serves for this script
  setRunHalfObjectEvidence([{ sha256: runtimeSourceHash(RS), captures: [
    { capture: 'a', ...MATCH }, { capture: 'b', ...MATCH },
    { capture: 'c', ...MATCH, inputs: { SpxValue: 5000 } }, { capture: 'd', ...MATCH, inputs: { SpxValue: 5000 } }] }])
})
afterEach(() => {
  for (const id of ids) registry.uninstallUserDefinition(id)
  ids = []
  setRunHalfObjectEvidence([])
  setRuntimeKillList([])
  resetRuntimeSessions()
  resetRuntimeLedgers()
  vi.unstubAllEnvs()
})

function install(doc) {
  const { installed, errors } = registry.installUserDefinitions([doc])
  expect(installed.length, errors.join(' | ')).toBe(1)
  ids.push(installed[0].id)
  return installed[0]
}
/** Fred RS as a member's browser holds it after the House tab saved it: a shared graph, read back hydrated. */
function savedCopy() {
  const fresh = memberPaneDefinition({ source: RS, id: 'u_rssaved01', name: 'Fred RS' }).definition
  const g = toGraphDocument(fresh)
  expect(g.ok, g.reason).toBe(true)
  return install(hydrateGraphDocument(JSON.parse(JSON.stringify(g.definition))))
}

describe('Fred RS saved copy: "Approximate Value of Comparative Symbol" moves the RS line', () => {
  it('the RS line scales by exactly 4205/4200 on every bar, and the run half is still SERVED', () => {
    const def = savedCopy()
    const spx = def.inputs.find((x) => /Approximate Value/.test(String(x.label)))
    expect(spx && spx.fromParam).toBe('__uct_param_1005')
    const at = registry.computeFor(def, CHART, {}, CTX())
    const moved = registry.computeFor(def, CHART, { [spx.key]: 4205 }, CTX())
    const n = CHART.length
    let compared = 0
    for (let i = 0; i < n; i += 1) {
      if (!Number.isFinite(at.value[i])) continue
      expect(moved.value[i] / at.value[i], `bar ${i}`).toBeCloseTo(4205 / 4200, 10)
      compared += 1
    }
    expect(compared).toBeGreaterThan(400)
    expect(runHalfOf(moved)).toEqual(expect.objectContaining({ state: 'served' }))
  })

  it('CONTROL: Offset (a plain input, never folded) moves it on the saved copy as it always did', () => {
    const def = savedCopy()
    const at = registry.computeFor(def, CHART, {}, CTX())
    const moved = registry.computeFor(def, CHART, { offset: 85 }, CTX())
    const i = CHART.length - 1
    expect(moved.value[i] / at.value[i]).toBeCloseTo(85 / 80, 10)
  })
})

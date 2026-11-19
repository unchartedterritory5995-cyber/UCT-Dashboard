// app/src/components/chart/engine/runtime/__tests__/hostParityCalcWindow.test.js
//
// ⭐ (2026-11-19) THE HOST-PARITY HARNESS RUNS A WINDOW AS THE MEMBER DOOR MINTS IT.
//
// Since engine 59 (CBC-FMT) a `calc_bars_count` window is taken from the DOCUMENT's stamp, `meta.calcBarsCount`
// (`calcBarsWindow.js::calcBarsCountOf`), which the member door writes off the translation (`memberPaneDefinition.js`).
// ⚰️ The harness wrote the count into the SOURCE only, so from e59 none of its cases ran windowed: the `calcbars` set
// ran every bar, and `h_varip_window` ("varip on a sliding window", design 4) was refused by the Node half for having
// no realtime ledger and SERVED by the browser's session ledger: the Chromium half's HP-3 red of 2026-11-19, which
// nothing saw because only the Node half runs in CI. A member's document is refused on BOTH (measured below).
// These rails hold the harness to the door:
//   * every case carries exactly the stamp the member door mints for its source (`memberPaneDefinition`);
//   * `h_varip_window` refuses with SLIDING_VARIP_WHY under BOTH hosts' options (the worker's and the Node half's), and
//     the same document without the stamp is served by the worker's (the rail can tell the two apart);
//   * a window case draws nothing before its window, and differs from the same script run unwindowed;
//   * a corpus file that declares its own calc_bars_count is refused.
import { describe, it, expect, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as hp from '../../../../../../../tools/pine_runtime_host_parity.mjs'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import { computeRuntimeColumns, resetRuntimeSessions, resetRuntimeLedgers, SLIDING_VARIP_WHY, RUNTIME_PANE_TIME_BUDGET_MS } from '../runtimeColumns'

const corpus = hp.loadCorpus()
const cases = hp.caseList(corpus)
const rowsOf = (set) => hp.makeBars(corpus.barSets[set]).map((b) => ({ ...b }))
// the two hosts' calls (HP-7): the browser worker's, and the Node half's
const WORKER = { budgetMs: RUNTIME_PANE_TIME_BUDGET_MS, budgetScales: true }
const NODE = { incremental: false }
const run = (c, opts, def = c.def) => {
  resetRuntimeSessions(); resetRuntimeLedgers()
  try { return { cols: computeRuntimeColumns(def, rowsOf(c.set), { ...c.ctx }, opts) } } catch (e) { return { err: e } }
}

describe('the harness stamps a window as the member door does', () => {
  it('every case carries exactly the stamp the member door mints for its source', () => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
    try {
      const windowSets = Object.entries(corpus.barSets).filter(([, s]) => s.calcBars).map(([k]) => k)
      expect(windowSets).toEqual(['calcwindow'])
      let windowed = 0
      let minted = 0
      const seen = new Set()
      for (const c of cases) {
        const want = corpus.barSets[c.set].calcBars || null
        const have = c.def.meta.calcBarsCount === undefined ? null : c.def.meta.calcBarsCount
        expect(have, c.case).toBe(want)
        if (want) windowed += 1
        // the door, once per distinct source (a script's bar sets share it unless a window is written in); the
        // generated hostile sources (an IR past its node budget, a 4,000-deep chain) are refused before any stamp
        const src = c.def.compute.source
        if (seen.has(src) || c.script === 'h_ir_size' || c.script === 'h_deep_chain') continue
        seen.add(src)
        let d = null
        try { d = memberPaneDefinition({ source: src, id: 'u_hpw', name: 'x' }) } catch { d = null }
        if (d && d.ok) {
          minted += 1
          const door = d.definition.meta.calcBarsCount
          expect(door === undefined ? null : door, `${c.case}: the door's stamp`).toBe(want)
        }
      }
      expect(windowed).toBeGreaterThanOrEqual(30)
      expect(minted).toBeGreaterThan(60)
    } finally { vi.unstubAllEnvs() }
  }, 180000)

  it('h_varip_window refuses with the sliding reason on BOTH hosts; unstamped, the worker would serve it', () => {
    const c = cases.find((x) => x.case === 'h_varip_window@calcwindow')
    expect(c).toBeTruthy()
    for (const [host, opts] of [['worker', WORKER], ['node', NODE]]) {
      const r = run(c, opts)
      expect(r.err && r.err.guard, host).toBe('runtime:varip')
      expect(r.err.message, host).toContain(SLIDING_VARIP_WHY)
    }
    // the control: the document as the harness minted it before (no stamp) is served by the worker's session
    const unstamped = { ...c.def, meta: { runtimeHistory: 'listing' } }
    const served = run(c, WORKER, unstamped)
    expect(served.err).toBeUndefined()
    expect(Array.from(served.cols.p0).filter(Number.isFinite).length).toBeGreaterThan(1000)
  })

  it('a window case draws nothing before its window, and is not the unwindowed run', () => {
    const c = cases.find((x) => x.case === 'ema_macd@calcwindow')
    const n = corpus.barSets.calcwindow.n
    const count = corpus.barSets.calcwindow.calcBars
    const r = run(c, NODE)
    expect(r.err).toBeUndefined()
    const col = Array.from(r.cols.p0)
    expect(col).toHaveLength(n)
    expect(col.slice(0, n - count).every((x) => Number.isNaN(x))).toBe(true)
    expect(col.slice(n - count).filter(Number.isFinite).length).toBeGreaterThan(count / 2)
    const unwindowed = run(c, NODE, { ...c.def, meta: { runtimeHistory: 'listing' } })
    expect(Array.from(unwindowed.cols.p0).slice(0, n - count).filter(Number.isFinite).length).toBeGreaterThan(0)
  })

  it('a corpus file that declares its own calc_bars_count is refused, never run unwindowed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hpw-'))
    try {
      mkdirSync(join(dir, 'corpus'))
      writeFileSync(join(dir, 'corpus.json'), JSON.stringify({ barSets: {}, scripts: [{ name: 'a', file: 'corpus/a.pine' }] }))
      writeFileSync(join(dir, 'corpus', 'a.pine'), '//@version=5\nindicator("hp a", overlay=false, calc_bars_count=50)\nplot(close)\n')
      expect(() => hp.loadCorpus(dir)).toThrow(/corpus\/a.pine declares calc_bars_count itself/)
      writeFileSync(join(dir, 'corpus', 'a.pine'), '//@version=5\nindicator("hp a", overlay=false)\nplot(close)\n')
      expect(() => hp.loadCorpus(dir)).not.toThrow()
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})

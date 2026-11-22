// app/src/components/chart/engine/__tests__/libraryLinkParity.test.js
//
// ─── ⭐⭐ U15 — A LINKED LIBRARY ON THE SERVER LANES ───────────────────────────────
//
// The server's user-series alert and scan sweep evaluate a saved HOST document's trees with
// `ast_interpret`. They never see a library store: the member door splices the library's code
// into the trees (`pineLibraries.js`), so the saved document already holds it. This file proves
// that claim instead of assuming it: it WRITES `tests/fixtures/ast/library_link_parity.json`
// (`LIBRARY_LINK_PARITY_WRITE=1`) from the member door's own documents — one script importing a
// fixture library, one with the same function pasted in — and the chart's own bind, and otherwise
// requires the JS lane to reproduce it exactly. `tests/test_pine_library_link_parity.py` holds the
// Python lane to the same file. The library is written from scratch for this file.
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { loadCapture } from './vendorHarness/harness'
import { toProductBars, HARNESS_DEF_ID } from './vendorHarness/ourSide'
import * as registry from '../nativeRegistry'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import { registerPineLibrary, clearPineLibraries } from '../ast/pineLibraryStore'
import { fixtureLibrary } from '../ast/__tests__/libraryFixture.js'

const REPO = path.resolve(process.cwd(), '..')
const FIXTURE = path.join(REPO, 'tests/fixtures/ast/library_link_parity.json')
const CAPTURE = path.join(REPO, 'tests/fixtures/vendor/harness/vw-arm-history-rddt-1d-2026-10-02.json')

const LIB = [
  '//@version=6',
  'library("linkparity")',
  'export spread(float a, float b) => a - b',
  'export smooth(float x, simple int n) => ta.sma(x, n)',
  'export band(float x, simple int n) =>',
  '    m = ta.ema(x, n)',
  '    m + ta.stdev(x, n)',
  '',
].join('\n')
const PATH = 'tester/linkparity/1'
const HEAD = '//@version=6\nindicator("library link parity")\n'
const SCRIPTS = [
  ['imported', `${HEAD}import ${PATH} as lp\nplot(lp.spread(high, low), "S")\nplot(lp.smooth(close, 5), "M")\nplot(lp.band(close, 10), "B")\n`],
  ['pasted', `${HEAD}spread(float a, float b) => a - b\nsmooth(float x, simple int n) => ta.sma(x, n)\nband(float x, simple int n) =>\n    m = ta.ema(x, n)\n    m + ta.stdev(x, n)\nplot(spread(high, low), "S")\nplot(smooth(close, 5), "M")\nplot(band(close, 10), "B")\n`],
]

afterEach(() => {
  clearPineLibraries()
  vi.unstubAllEnvs()
})

const num = (v) => (Number.isFinite(v) ? v : null)

function buildDoc() {
  registerPineLibrary(fixtureLibrary({ path: PATH, source: LIB, licence: 'test-fixture', attribution: 'linkparity (test fixture)' }))
  const bars = toProductBars(loadCapture(CAPTURE).capture)
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  const cases = SCRIPTS.map(([name, source]) => {
    const built = memberPaneDefinition({ source, id: HARNESS_DEF_ID })
    try {
      expect(built.ok, `${name}: ${built.reason}`).toBe(true)
      expect(built.lane, name).not.toBe('runtime')
      const def = built.definition
      const cols = registry.computeFor(def, bars, undefined, { tf: 'D' })
      const plots = (def.plots || []).map((p) => {
        const trees = def.compute.trees
        const tree = trees && Object.prototype.hasOwnProperty.call(trees, p.key) ? trees[p.key] : def.compute.ast
        return { key: p.key, label: p.label, tree, expected: Array.from(cols[p.key] || [], num) }
      })
      return { name, meta: def.meta.libraries ? { libraries: def.meta.libraries } : {}, inputs: def.inputs || [], plots }
    } finally {
      registry.uninstallUserDefinition(HARNESS_DEF_ID)
    }
  })
  return {
    _: 'U15 — a library linked by the member door, evaluated by the server lanes. Written by '
      + 'app/src/components/chart/engine/__tests__/libraryLinkParity.test.js (LIBRARY_LINK_PARITY_WRITE=1) and read by '
      + 'that file and by tests/test_pine_library_link_parity.py. `cases`: the member door\'s own host document for a script '
      + 'importing a fixture library and for the same script with the functions pasted in; each plot\'s tree and the '
      + 'chart\'s bind over `bars` (RDDT 1D from vw-arm-history), null = not computable.',
    bars: bars.map((b) => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v })),
    cases,
  }
}

describe('U15 — the library link parity fixture', () => {
  it('⭐ the JS lane reproduces the committed fixture exactly (regenerate with LIBRARY_LINK_PARITY_WRITE=1)', () => {
    const doc = buildDoc()
    if (process.env.LIBRARY_LINK_PARITY_WRITE === '1') fs.writeFileSync(FIXTURE, `${JSON.stringify(doc)}\n`)
    const committed = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))
    expect(committed).toEqual(JSON.parse(JSON.stringify(doc)))
  }, 120000)

  it('⛔ not vacuous: the imported document is pinned, its trees name no library, and each plot equals the pasted one', () => {
    const doc = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))
    const [imported, pasted] = doc.cases
    expect(imported.meta.libraries).toEqual([expect.objectContaining({ path: PATH })])
    expect(pasted.meta).toEqual({})
    expect(JSON.stringify(imported.plots.map((p) => p.tree))).not.toMatch(/lp\.|__lib/)
    expect(imported.plots).toHaveLength(3)
    imported.plots.forEach((p, i) => {
      expect(p.expected, p.label).toEqual(pasted.plots[i].expected)
      expect(p.expected.filter((v) => v !== null).length, p.label).toBeGreaterThan(100)
    })
  })
})

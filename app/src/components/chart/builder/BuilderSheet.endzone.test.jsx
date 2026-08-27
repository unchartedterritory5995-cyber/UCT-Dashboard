// app/src/components/chart/builder/BuilderSheet.endzone.test.jsx
//
// ─── 🔴 A1, DERIVED RATHER THAN BELIEVED ────────────────────────────────────
//
// A1 is the program's first acceptance criterion: *a MACD-with-histogram
// authored from scratch — three plots, member inputs, overlay/pane, styles —
// draws, scans on `hist > 0`, alerts, with ONE `def_hash` at every surface.*
//
// It was believed because five surfaces were each verified SEPARATELY, by
// different tasks, at different times. Nothing asserted them TOGETHER, and that
// is exactly the gap this file closes: five separately-correct surfaces is the
// situation that manufactures the belief, and the value here is the JOIN.
//
// ⛔ SO THE ASSERTION IS AN AGREEMENT, NOT A CHAIN OF PAIRWISE EQUALITIES.
// `agreementReport` groups every surface by the hash it holds and the test
// asserts there is ONE group. A pairwise `expect(a).toBe(b)` chain fails with
// "expected X to be Y" and leaves the reader to work out which side is the
// stranger; a grouping prints `sheet, registry, install door → sha256:aaa` next
// to `chart binding → sha256:bbb`, which NAMES the disagreeing surface. A
// boolean where a diagnosis is needed is the defect this repo keeps paying for.
//
// ⛔ NOTHING ON THE PATH UNDER TEST IS MOCKED. The rows are typed on the real
// form, the document is what the sheet POSTs, the registry is the shipped one,
// the install door is the real `useInstalledUserDefinitions`, and the fetch
// stub does exactly what `api/routers/user_definitions.py` does — mint a
// `def_id` and stamp it onto the stored document (`definition["id"] = def_id`,
// which `svc.save` then REQUIRES to agree). A stub that handed back a
// hand-built document would decide the answer, and the identity would hold
// trivially — see the report's vacuity column.
//
// ⭐ THE CROSS-LANE JOIN IS THE PUBLISHED FIXTURE, NOT A SECOND MACD.
// `tests/fixtures/ast/multi_tree_parity.json` is read by BOTH lanes
// (`trees.parity.test.js` here, `tests/test_ast_multi_tree_parity.py` and
// `tests/test_user_definitions_v2.py` there) and pins ONE `treesHash` string.
// `treesHash` is `sha256` over `"<key>":astHash(tree)` pairs, so pinning it
// PINS EVERY PER-TREE `astHash` transitively — including the scan tree's, which
// IS `compute.fn`, which IS `scan_definition.def_hash`. Asserting the sheet's
// document against that file therefore reaches the Python lane's hash without
// running Python. The four sources are typed from the fixture's own `sources`,
// so a fixture edit moves this test in the same commit.
//
// ⚠️ WHAT THIS FILE CANNOT SEE, stated here rather than implied by silence:
//   • the RENDERER. "Draws" is exercised at the COMPUTE level (every plot key
//     returns a column, cross-checked against its siblings). A three-series
//     pane with a histogram is the live-surface audit's, and
//     `userDefinitionDraws.test.jsx` covers the single-plot renderer path.
//   • the ALERT CATALOG. `alert_user_series.user_catalog` is Python and gates
//     which formulas the popover offers; a stub there would decide its own
//     answer. What IS asserted is the JS half of the seam — the address
//     `u_<id>.hist_up` resolves, through the shipped `alertSets` bridge, to the
//     instance the sheet put on the chart, and that instance resolves to this
//     same hash.
//   • the STORE. `svc.save`'s own `ast_hash` recomputation is W1b.8's rail.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import BuilderSheet from './BuilderSheet'
import { FORMULA_DEBOUNCE_MS } from './FormulaField'
import { fromAst } from './criteria'
import { AuthContext } from '../../../context/AuthContext'
import { astHash, parseFormula } from '../engine/ast/parse'
import { treesHash } from '../engine/ast/trees'
import {
  getDefinition, clearUserDefinitions, computeFor, validateUserDefinitions,
} from '../engine/nativeRegistry'
import { instancesForAddress } from '../engine/alertSets'
import { useInstalledUserDefinitions } from '../../../hooks/useUserDefinitions'
import { makeBars } from '../engine/__tests__/fakeChart'

// ⛔ THIS FILE NEEDS MORE THAN VITEST'S DEFAULT 5s, AND THAT IS MEASURED, NOT
// DEFENSIVE. It mounts the real BuilderSheet, types a formula through the real
// debounce, saves, and then interprets four trees over 300 bars. Measured
// 2026-08-27: 3,953 ms ALONE, and 7,552-10,360 ms in company. `app/vite.config.js`
// tunes pool, heap and maxWorkers but never sets `testTimeout`, so the default
// 5,000 ms applied — and the file went red under load while passing alone.
//
// ⚠️ A RETRY WOULD HAVE BEEN THE WRONG FIX. This is A1's rail — the one test that
// turns the program's first acceptance criterion from believed into measured — so
// a flake here does not just cost a re-run, it teaches people to re-run it, and a
// rail nobody trusts is a rail nobody reads. Three-way control: 50% pool + 5s -> 1
// red of 5; 50% pool + 30s -> 0 red of 4; maxWorkers=100% + 5s -> 2 red of 2.
vi.setConfig({ testTimeout: 30000 })

// ⭐ THE HOUSE IDIOM FOR REACHING `tests/fixtures/` — `trees.parity.test.js`'s,
// one directory shallower: `app/src/components/chart/builder/` is FIVE levels
// below the repo root.
const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE = path.join(HERE, '..', '..', '..', '..', '..',
  'tests', 'fixtures', 'ast', 'multi_tree_parity.json')
const fx = JSON.parse(readFileSync(FIXTURE, 'utf8'))

/** The id the stub store mints — the shape `svc.new_def_id` produces. */
const DEF_ID = 'u_aaaaaaaaaaaa'

const H = vi.hoisted(() => ({ requests: [], rows: [] }))

// ⛔ THE STUB IS THE ROUTE'S BEHAVIOUR, NOT A CONVENIENT ANSWER.
// `create_definition` does `def_id = svc.new_def_id(); definition["id"] = def_id`
// and `svc.save` then REFUSES a document whose `id` disagrees with the address
// it is stored at. So the row this hands back on the next GET carries the
// POSTed document with the minted id stamped on it — which is what makes the
// install-door surface below read a STORED document rather than a draft.
function stubFetch() {
  H.requests = []; H.rows = []
  global.fetch = vi.fn(async (url, init = {}) => {
    const method = init.method || 'GET'
    H.requests.push({ url: String(url), method, body: init.body ?? null })
    if (method === 'GET') return { ok: true, status: 200, json: async () => ({ definitions: H.rows }) }
    const definition = { ...JSON.parse(init.body).definition, id: DEF_ID }
    H.rows = [{ def_id: DEF_ID, version: 1, rev: 1, ast_hash: definition.compute.fn, definition }]
    return { ok: true, status: 200, json: async () => ({ def_id: DEF_ID, version: 1, rev: 1 }) }
  })
}

const flush = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
}
const settle = async () => { await act(async () => { vi.advanceTimersByTime(FORMULA_DEBOUNCE_MS + 10) }) }
const set = async (el, value) => { await act(async () => { fireEvent.change(el, { target: { value } }) }) }
const click = async (el) => { await act(async () => { fireEvent.click(el) }) }
const type = async (el, value) => { await set(el, value); await settle() }

/** The chart blob the sheet writes an instance into, and the last one it wrote. */
const chart = { settings: { indicatorInstances: [] } }
function mount() {
  chart.settings = { indicatorInstances: [] }
  return render(
    <AuthContext.Provider value={{ user: { id: 7 }, isPaid: true, loading: false }}>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
        <BuilderSheet
          open
          onClose={() => {}}
          settings={chart.settings}
          onChange={(next) => { chart.settings = next }}
        />
      </SWRConfig>
    </AuthContext.Provider>,
  )
}

async function addPlot(n, key, source, style = 'line') {
  await click(screen.getByTestId('add-plot'))
  await set(screen.getByLabelText(`Plot ${n} key`), key)
  await set(screen.getByLabelText(`Plot ${n} label`), key.toUpperCase())
  await set(screen.getByLabelText(`Plot ${n} style`), style)
  await type(screen.getByLabelText(`Formula for plot ${n}`), source)
}
async function save(name) {
  await set(screen.getByLabelText(/^Name/i), name)
  await click(screen.getByRole('button', { name: /^Sav/ }))
  await flush()
}
// ⚠️ THE WRITE, NOT "THE POST" — `saveUserDefinition` POSTs a create and PUTs
// an edit, so a helper that looked only for a POST would report "nothing was
// sent" for every edit, which is indistinguishable from a disabled button.
const sent = () => JSON.parse(H.requests.find((r) => r.method !== 'GET').body).definition

/** The registry, read through the door every chart uses: the STORED row
 *  re-installed by `useInstalledUserDefinitions`. Renders nothing. */
function RegistryProbe({ onHash }) {
  useInstalledUserDefinitions()
  const def = getDefinition(DEF_ID)
  onHash(def ? def.compute.fn : null)
  return null
}

/**
 * Every surface grouped by the hash it holds — ONE line per distinct answer.
 *
 * ⭐ THIS IS THE DIAGNOSIS. A one-element result is agreement; anything longer
 * prints each group's MEMBERS beside its hash, so the failure names WHICH
 * surface disagreed and WITH WHAT, rather than asserting a boolean over five
 * things that were each verified alone.
 */
function agreementReport(surfaces) {
  const groups = new Map()
  for (const s of surfaces) {
    const key = String(s.hash)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(s.name)
  }
  return [...groups.entries()].map(([hash, names]) => `${names.join(' + ')} -> ${hash}`)
}

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); stubFetch() })
afterEach(() => { vi.useRealTimers(); cleanup(); vi.restoreAllMocks(); clearUserDefinitions() })

describe('A1 — author MACD-with-histogram, one def_hash at every surface', () => {
  it('🔴 sheet, trees map, published fixture, registry, install door and chart binding hold ONE hash', async () => {
    mount(); await flush()

    // ── the four rows, typed from the PUBLISHED fixture's own sources ────────
    await type(screen.getByLabelText('Formula'), fx.sources.macd)
    await set(screen.getByLabelText('Plot 1 key'), 'macd')
    await addPlot(2, 'signal', fx.sources.signal)
    await addPlot(3, 'hist', fx.sources.hist, 'histogram')
    await addPlot(4, 'hist_up', fx.sources.hist_up)
    await click(screen.getByLabelText('Scan on plot 4'))
    await click(screen.getByLabelText('Hide plot 4'))

    // A member input — the thing that makes an authored indicator TUNABLE.
    // Declared, not spent inside a tree, because the four trees must stay
    // byte-identical to the cross-lane fixture; the second case below spends
    // one inside a tree and re-checks the whole agreement on a DIFFERENT hash.
    await click(screen.getByTestId('add-input'))
    await set(screen.getByLabelText('Input 1 name'), 'fast')
    await set(screen.getByLabelText('Input 1 default'), '12')

    // Own pane + a zero guide — A1's "overlay/pane" and "styles" half.
    await set(screen.getByLabelText('Placement'), 'pane')
    await set(screen.getByLabelText('Levels'), '0')

    await save('MACD v2')
    const doc = sent()

    // ── the SHEET's own three claims about its document ─────────────────────
    expect(doc.compute.scanPlot, 'the scan names the histogram condition').toBe(fx.scanPlot)
    expect(Object.keys(doc.compute.trees).sort()).toEqual(Object.keys(fx.trees).sort())
    // ⛔ AND THE TREES ARE THE FIXTURE'S, TREE FOR TREE. Without this the hash
    // agreement below could be four surfaces agreeing on the WRONG maths.
    for (const key of Object.keys(fx.trees)) {
      expect(doc.compute.trees[key], `compute.trees.${key}`).toEqual(fx.trees[key])
    }
    // ⭐ THE CROSS-LANE PIN. Python asserts this same string off this same file.
    expect(doc.compute.treesHash, 'the sheet reproduces the published treesHash').toBe(fx.treesHash)
    expect(treesHash(doc.compute.trees)).toBe(fx.treesHash)

    // ── the registry, through the SHEET's OWN install (the store's id) ───────
    const afterSheetInstall = getDefinition(DEF_ID)
    expect(afterSheetInstall, 'the sheet installed nothing under the store id').not.toBeNull()

    // ── the chart binding + the alert seam ──────────────────────────────────
    // `addInstance` is the one control door; the address `u_<id>.hist_up` is
    // what a chart chip arms an alert on, and `instancesForAddress` is the
    // shipped bridge from that address back to an instance.
    const armed = instancesForAddress(chart.settings, `${DEF_ID}.${fx.scanPlot}`)
    expect(armed.map((i) => i.defId), 'the alert address resolves to the instance the sheet added')
      .toEqual([DEF_ID])
    const bound = getDefinition(armed[0].defId)

    // ── the door EVERY chart uses: the stored row, re-installed ─────────────
    cleanup()
    clearUserDefinitions()
    expect(getDefinition(DEF_ID), 'the teardown must actually empty the registry').toBeNull()
    let viaInstallDoor = 'the probe never ran'
    render(
      <AuthContext.Provider value={{ user: { id: 7 }, isPaid: true, loading: false }}>
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
          <RegistryProbe onHash={(h) => { viaInstallDoor = h }} />
        </SWRConfig>
      </AuthContext.Provider>,
    )
    await flush()

    // ── 🔴 THE JOIN ─────────────────────────────────────────────────────────
    const surfaces = [
      { name: 'sheet compute.fn', hash: doc.compute.fn },
      { name: 'sheet compute.ast', hash: astHash(doc.compute.ast) },
      { name: `sheet compute.trees.${fx.scanPlot}`, hash: astHash(doc.compute.trees[fx.scanPlot]) },
      { name: 'published fixture (the Python lane reads this file)', hash: astHash(fx.trees[fx.scanPlot]) },
      { name: 'chart registry after the sheet install', hash: afterSheetInstall.compute.fn },
      { name: 'chart binding via the alert address', hash: bound && bound.compute.fn },
      { name: 'install door (useInstalledUserDefinitions)', hash: viaInstallDoor },
    ]
    expect(surfaces.every((s) => typeof s.hash === 'string' && s.hash.startsWith('sha256:')),
      `a surface answered with something that is not a hash: ${JSON.stringify(surfaces)}`).toBe(true)
    const [agreed, ...disagreed] = agreementReport(surfaces)
    // ⛔ `toHaveLength(1)` WAS THE FIRST SHAPE OF THIS LINE AND IT PRINTED
    // `expected 1, got 2` — a boolean where a diagnosis is needed, which is the
    // defect this file exists to avoid, committed inside the assertion itself.
    // `toEqual([])` prints the RECEIVED groups, so the failure names the
    // surfaces that split off and the hash they hold.
    expect(
      disagreed,
      `A1 — ONE def_hash at every surface. The majority holds ${agreed}; `
      + 'each line below is a group of surfaces that disagreed with it.',
    ).toEqual([])
  })

  it('🔴 the scan tree is a real 0/1 column and the three drawn plots agree with each other', async () => {
    mount(); await flush()
    await type(screen.getByLabelText('Formula'), fx.sources.macd)
    await set(screen.getByLabelText('Plot 1 key'), 'macd')
    await addPlot(2, 'signal', fx.sources.signal)
    await addPlot(3, 'hist', fx.sources.hist, 'histogram')
    await addPlot(4, 'hist_up', fx.sources.hist_up)
    await click(screen.getByLabelText('Scan on plot 4'))
    await click(screen.getByLabelText('Hide plot 4'))
    await save('MACD v2')
    const doc = sent()

    // "Draws", at the level this lane can measure: the installed definition
    // returns a COLUMN for every declared plot key.
    const def = getDefinition(DEF_ID)
    const cols = computeFor(def, makeBars(300), {})
    for (const key of ['macd', 'signal', 'hist', 'hist_up']) {
      expect(Object.keys(cols), `no column for plot ${key}`).toContain(key)
    }

    // ⛔ AN INDEPENDENT CROSS-CHECK, NOT `interpret` COMPARED TO ITSELF. The
    // three columns are related by the DEFINITION's own arithmetic, so a
    // mis-keyed or transposed column set fails here even though every column
    // is individually finite: `hist` IS `macd - signal`, and `hist_up` IS
    // `hist > 0` — measured off the columns, never re-derived from the trees.
    let compared = 0
    for (let i = 0; i < 300; i++) {
      if (!Number.isFinite(cols.macd[i]) || !Number.isFinite(cols.signal[i])) continue
      expect(cols.hist[i], `hist[${i}]`).toBeCloseTo(cols.macd[i] - cols.signal[i], 9)
      expect(cols.hist_up[i], `hist_up[${i}]`).toBe(cols.hist[i] > 0 ? 1 : 0)
      compared += 1
    }
    expect(compared, 'the cross-check compared nothing — every bar was warmup').toBeGreaterThan(200)

    // ⛔ AND IT DISCRIMINATES. A column that is all-1 (or all-0) would satisfy
    // every line above while proving the scan can never separate two symbols.
    const drawn = [...cols.hist_up].filter(Number.isFinite)
    expect(new Set(drawn), 'the scan column must actually take both values').toEqual(new Set([0, 1]))

    // ⭐⭐ A1'S SECOND CLAUSE, ADDED TO THE SPEC 2026-08-27 AND PINNED HERE.
    // The identity join above proves every surface holds the SAME definition.
    // It proves NOTHING about whether the plots compute DIFFERENT things —
    // perturbation P6 (every plot interpreting plot 1's tree, so a "MACD with
    // histogram" draws three identical lines) left the whole agreement case
    // GREEN. Only the arithmetic cross-check above caught it, and that check is
    // specific to THIS definition's shape.
    //
    // ⛔ So the generic clause needs its own generic assertion: the three plots
    // must be PAIRWISE DISTINCT on the same bars. Without this, the spec would
    // declare a property no test holds — which is the defect class this whole
    // branch keeps catching, aimed at its own acceptance criteria.
    const PLOTS = ['macd', 'signal', 'hist']
    for (let a = 0; a < PLOTS.length; a++) {
      for (let b = a + 1; b < PLOTS.length; b++) {
        const [x, y] = [cols[PLOTS[a]], cols[PLOTS[b]]]
        let differing = 0
        for (let i = 0; i < 300; i++) {
          if (!Number.isFinite(x[i]) || !Number.isFinite(y[i])) continue
          if (Math.abs(x[i] - y[i]) > 1e-9) differing += 1
        }
        expect(differing, `${PLOTS[a]} and ${PLOTS[b]} are the same column — ` +
          'three plots that agree everywhere are one plot drawn three times, ' +
          'which satisfies every hash on this branch').toBeGreaterThan(100)
      }
    }

    // The Conditions door — rows, or a refusal BY NAME. Never silence.
    const picker = fromAst(doc.compute.trees[fx.scanPlot])
    expect(picker && typeof picker === 'object', 'the Conditions door answered nothing').toBe(true)
    expect(
      picker.ok === true ? 'rows' : `refused[${picker.guard}]: ${picker.reason}`,
      'a refusal must name its guard and carry a sentence',
    ).toMatch(picker.ok === true ? /^rows$/ : /^refused\[[a-z:]+\]: .{10,}$/)
  })

  it('⭐ THE CONTROL — the agreement is not pinned to one constant, and placement never moves it', async () => {
    // ⛔ WITHOUT THIS THE WHOLE FILE COULD BE TRUE OF A HARD-CODED FIXTURE
    // HASH. A DIFFERENT scan tree — one that spends the member input, which the
    // fixture cannot — must move every surface TOGETHER to a DIFFERENT hash. And
    // an OVERLAY placement (A1's other half) must move NOTHING: `def_hash` names
    // the maths, so chrome cannot be inside it.
    mount(); await flush()
    await type(screen.getByLabelText('Formula'), fx.sources.macd)
    await set(screen.getByLabelText('Plot 1 key'), 'macd')
    await click(screen.getByTestId('add-input'))
    await set(screen.getByLabelText('Input 1 name'), 'fast')
    await set(screen.getByLabelText('Input 1 default'), '12')
    await addPlot(2, 'tuned_up', 'ema(close, 20) * fast > ema(close, 26)')
    await click(screen.getByLabelText('Scan on plot 2'))
    await set(screen.getByLabelText('Placement'), 'price')
    await save('MACD overlay')
    const doc = sent()

    expect(doc.placement, 'A1 names overlay AND pane').toEqual({ target: 'price' })
    expect(doc.inputs.some((i) => i.key === 'fast'), 'the member input reached the document').toBe(true)
    expect(JSON.stringify(doc.compute.trees.tuned_up),
      'the member input reached the SCAN tree').toContain('"name":"fast"')
    expect(validateUserDefinitions([doc]).errors).toEqual([])

    const surfaces = [
      { name: 'sheet compute.fn', hash: doc.compute.fn },
      { name: 'sheet compute.trees.tuned_up', hash: astHash(doc.compute.trees.tuned_up) },
      { name: 'the parser, from the source the sheet stored', hash: astHash(parseFormula(doc.compute.sources.tuned_up).ast) },
      { name: 'chart registry after the sheet install', hash: getDefinition(DEF_ID).compute.fn },
    ]
    const [agreed, ...disagreed] = agreementReport(surfaces)
    expect(disagreed, `the surfaces must agree on the NEW hash too; the majority holds ${agreed}`)
      .toEqual([])
    // …and it is a DIFFERENT hash than case 1's, so nothing above is a constant.
    expect(doc.compute.fn).not.toBe(astHash(fx.trees[fx.scanPlot]))

    // The instance the overlay put on the chart carries the member input's
    // DEFAULT — the wiring that makes the knob reach the drawn indicator.
    const armed = instancesForAddress(chart.settings, `${DEF_ID}.tuned_up`)
    expect(armed).toHaveLength(1)
    expect(armed[0].inputs.fast, 'the member input default reached the instance').toBe(12)
    expect(armed[0].placement, 'the overlay placement reached the instance').toEqual({ target: 'price' })
  })
})

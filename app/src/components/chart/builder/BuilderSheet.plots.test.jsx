// ⛔ MOCKS NOTHING ON THE PATH UNDER TEST — the rows are typed on the real form,
// the document is what the sheet POSTs, and the gate is the shipped
// `validateUserDefinitions`. A component test that rendered plot rows and
// asserted they appear would pass with the form wired to nothing, which is the
// blindness that let eight features ship "built, tested, green, connected to
// nothing" on 2026-08-08.
//
// ⚰️ FOUR THINGS IN THE BRIEF'S DRAFT OF THIS FILE WERE MEASURED WRONG, each
// corrected beside the measurement:
//   1. it asserted the `let:shadow` refusal reaches `save-hint`. It does not, and
//      it MUST not: `BuilderSheet.jsx`'s own rule is that a formula problem
//      already carries the refusal chip and repeating it under the button is a
//      second voice for a fact the member can already see. The refusal is pinned
//      where it renders — `BuilderSheet.letScope.test.jsx`, on the chip.
//   2. it kept the scan choice as a plot KEY in sheet state. Renaming the key of
//      the chosen row would then silently move the scan to plot 1. The sheet
//      holds an INDEX and `buildDefinition` turns it into the key the DOCUMENT
//      carries, which is the only place a key belongs.
//   3. its `chromeInputsFor` ignored row 0, so plot 1's colour and width swatches
//      were controls that wrote nowhere. Row 0's chosen values are the `color` /
//      `lineWidth` input DEFAULTS.
//   4. its byte-identical condition checked only key/style/placement/levels, so
//      hiding plot 1 or recolouring it took the schema-1 path and the choice was
//      dropped. The condition is "row 1 is untouched", stated once.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { SWRConfig } from 'swr'

import BuilderSheet, { buildDefinition } from './BuilderSheet'
import { evaluateFormula, FORMULA_DEBOUNCE_MS } from './FormulaField'
import { BUILDER_INPUTS, BUILDER_INPUT_SCOPE, chromeInputKeys, chromeInputsFor } from './builderInputs'
import { AuthContext } from '../../../context/AuthContext'
import { parseFormula, astHash } from '../engine/ast/parse'
import { treesHash } from '../engine/ast/trees'
import { validateUserDefinitions } from '../engine/nativeRegistry'
import { MACD_SRC } from '../engine/__tests__/macdV2'

const H = vi.hoisted(() => ({ requests: [], rows: [] }))
function stubFetch() {
  H.requests = []; H.rows = []
  global.fetch = vi.fn(async (url, init = {}) => {
    const method = init.method || 'GET'
    H.requests.push({ url: String(url), method, body: init.body ?? null })
    if (method === 'GET') return { ok: true, status: 200, json: async () => ({ definitions: H.rows }) }
    return { ok: true, status: 200, json: async () => ({ def_id: 'u_aaaaaaaaaaaa', version: 1, rev: 1 }) }
  })
}
const flush = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
}
function mount() {
  return render(
    <AuthContext.Provider value={{ user: { id: 7 }, isPaid: true, loading: false }}>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
        <BuilderSheet open onClose={() => {}} />
      </SWRConfig>
    </AuthContext.Provider>,
  )
}
const settle = async () => { await act(async () => { vi.advanceTimersByTime(FORMULA_DEBOUNCE_MS + 10) }) }
const type = async (el, value) => {
  await act(async () => { fireEvent.change(el, { target: { value } }) })
  await settle()
}
const set = async (el, value) => { await act(async () => { fireEvent.change(el, { target: { value } }) }) }
const click = async (el) => { await act(async () => { fireEvent.click(el) }) }
// ⚠️ THE WRITE, NOT "THE POST". `saveUserDefinition` POSTs a create and PUTs
// an edit — one function, two verbs — so a helper that looked only for a POST
// would report "nothing was sent" for every edit, which is indistinguishable
// from a disabled Save button.
const sent = () => JSON.parse(H.requests.find((r) => r.method !== 'GET').body).definition

async function addPlot(n, key, source, style = 'line') {
  await click(screen.getByTestId('add-plot'))
  await set(screen.getByLabelText(`Plot ${n} key`), key)
  await set(screen.getByLabelText(`Plot ${n} label`), key.toUpperCase())
  await set(screen.getByLabelText(`Plot ${n} style`), style)
  await type(screen.getByLabelText(`Formula for plot ${n}`), source)
}
async function save(name = 'MACD v2') {
  await set(screen.getByLabelText(/^Name/i), name)
  await click(screen.getByRole('button', { name: /^Sav/ }))
  await flush()
}

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); stubFetch() })
afterEach(() => { vi.useRealTimers(); cleanup(); vi.restoreAllMocks() })

describe('one plot is the DEFAULT row — the document is byte-identical to today\'s', () => {
  it('⛔ RAIL — the POSTed document equals the schema-1 builder output, key for key', async () => {
    mount(); await flush()
    await type(screen.getByLabelText('Formula'), 'sma(close, 20)')
    await save('My line')
    const doc = sent()
    const ev = evaluateFormula('sma(close, 20)', BUILDER_INPUT_SCOPE)
    expect(doc).toEqual(buildDefinition({
      defId: doc.id, name: 'My line', source: 'sma(close, 20)',
      ast: ev.ast, mode: ev.verdict.mode, readback: ev.readback,
    }))
    expect(Object.keys(doc.compute).sort()).toEqual(['ast', 'fn', 'kind', 'rev', 'source'])
    expect(doc.plots).toEqual([{
      key: 'value', label: 'My line', style: 'line', color: '$color', width: '$lineWidth',
      role: 'primary', legend: { decimals: 2 },
    }])
    expect(doc.placement).toEqual({ target: 'pane', pane: { height: 0.15 } })
  })

  it('🔴 …and the v2 path with ONE untouched row produces that SAME document', () => {
    // ⛔ THE EXTRACTION IS MEANING-PRESERVING, PROVED RATHER THAN ASSERTED IN A
    // COMMENT. `legacyDefinition` is the schema-1 body moved verbatim, and the
    // v2 body is a second way to reach the same object; if the two ever disagree
    // for the simplest possible input, every document a member already saved is
    // one edit away from moving. This is the case that would catch it.
    const ev = evaluateFormula('sma(close, 20)', BUILDER_INPUT_SCOPE)
    const common = {
      defId: 'u_0123456789ab', name: 'My line', source: 'sma(close, 20)',
      ast: ev.ast, mode: ev.verdict.mode, readback: ev.readback,
    }
    const legacy = buildDefinition(common)
    const viaPlots = buildDefinition({
      ...common,
      plots: [{
        key: 'value', label: '', source: 'sma(close, 20)', ast: ev.ast,
        mode: ev.verdict.mode, readback: ev.readback, style: 'line',
        color: BUILDER_INPUTS[0].default, width: BUILDER_INPUTS[1].default, hidden: false,
      }],
    })
    expect(viaPlots).toEqual(legacy)
  })

  it('⛔ …and a recoloured plot 1 is NOT dropped — the swatch is not a dead control', async () => {
    // ⚰️ THE BRIEF'S CONDITION WOULD HAVE DROPPED IT. Row 1 keeps `color` and
    // `lineWidth` as its inputs, so its chosen colour has exactly one honest
    // home: those inputs' DEFAULTS. The plot still references `$color`.
    mount(); await flush()
    await type(screen.getByLabelText('Formula'), 'sma(close, 20)')
    await set(screen.getByLabelText('Plot 1 colour'), '#ff0000')
    await set(screen.getByLabelText('Plot 1 width'), '3')
    await save('Red line')
    const doc = sent()
    expect(doc.plots[0].color, 'the plot still points at the input').toBe('$color')
    expect(doc.inputs.find((i) => i.key === 'color').default).toBe('#ff0000')
    expect(doc.inputs.find((i) => i.key === 'lineWidth').default).toBe(3)
    expect(validateUserDefinitions([doc]).errors).toEqual([])
  })
})

describe('🔴 many plots, one hash', () => {
  it('four rows + the scan radio produce trees/treesHash/scanPlot/sources, and `fn` is the SCAN tree\'s hash', async () => {
    mount(); await flush()
    await type(screen.getByLabelText('Formula'), MACD_SRC.macd)
    await set(screen.getByLabelText('Plot 1 key'), 'macd')
    await addPlot(2, 'signal', MACD_SRC.signal)
    await addPlot(3, 'hist', MACD_SRC.hist, 'histogram')
    await addPlot(4, 'hist_up', MACD_SRC.hist_up)
    await click(screen.getByLabelText('Scan on plot 4'))
    await click(screen.getByLabelText('Hide plot 4'))
    await save()
    const doc = sent()

    expect(Object.keys(doc.compute.trees).sort()).toEqual(['hist', 'hist_up', 'macd', 'signal'])
    expect(doc.compute.scanPlot).toBe('hist_up')
    expect(doc.compute.ast).toEqual(parseFormula(MACD_SRC.hist_up).ast)
    expect(doc.compute.fn).toBe(astHash(doc.compute.trees.hist_up))
    expect(doc.compute.treesHash).toBe(treesHash(doc.compute.trees))
    expect(doc.compute.sources.hist_up).toBe(doc.compute.source)
    expect(doc.plots.map((p) => p.key)).toEqual(['macd', 'signal', 'hist', 'hist_up'])
    expect(doc.plots[2].style).toBe('histogram')
    expect(doc.plots[3].hidden).toBe(true)
    expect(doc.plots[1].color).toBe('$signalColor')
    expect(doc.inputs.map((i) => i.key)).toEqual([
      'color', 'lineWidth', 'signalColor', 'signalWidth', 'histColor', 'histWidth',
      'hist_upColor', 'hist_upWidth',
    ])
    // ⭐ THE SHIPPED DOOR, NOT A SECOND ONE. `validateUserDefinitions` is
    // `defSchema` + the supported-kinds filter + the ast lane's own per-tree
    // gates, and it is what the Save button itself just ran.
    const { errors } = validateUserDefinitions([doc])
    expect(errors).toEqual([])
  })

  it('⛔ the scan choice survives a RENAME of the row it points at', async () => {
    // ⚰️ THE BRIEF HELD THE SCAN AS A KEY IN SHEET STATE. Renaming the chosen
    // row's key would then match nothing, `buildDefinition` would fall back to
    // `rows[0]`, and the document would scan a DIFFERENT tree than the one the
    // radio shows selected — silently, with the radio still lit.
    mount(); await flush()
    await type(screen.getByLabelText('Formula'), 'sma(close, 20)')
    await addPlot(2, 'flag', 'close > sma(close, 20)')
    await click(screen.getByLabelText('Scan on plot 2'))
    await set(screen.getByLabelText('Plot 2 key'), 'above')
    expect(screen.getByLabelText('Scan on plot 2').checked, 'the radio still shows row 2').toBe(true)
    await save('Renamed scan')
    const doc = sent()
    expect(doc.compute.scanPlot).toBe('above')
    expect(doc.compute.ast).toEqual(parseFormula('close > sma(close, 20)').ast)
  })

  it('every tree is RUN before Save — a plot that only refuses at interpret time disables it', async () => {
    mount(); await flush()
    await type(screen.getByLabelText('Formula'), 'sma(close, 20)')
    await addPlot(2, 'bad', 'accum(close, sma(self, 3), 5)')
    await set(screen.getByLabelText(/^Name/i), 'x')
    expect(screen.getByRole('button', { name: /^Sav/ })).toBeDisabled()
    expect(screen.getByTestId('save-hint').textContent).toBe('Fix the plots above to save.')
  })

  it('a member input reaches EVERY tree', async () => {
    mount(); await flush()
    await type(screen.getByLabelText('Formula'), 'sma(close, 20)')
    await click(screen.getByTestId('add-input'))
    await set(screen.getByLabelText('Input 1 name'), 'period')
    // ⚰️ THE BRIEF USED `ema(close, period)` HERE AND IT CANNOT PASS: a window
    // must be a whole-number LITERAL (`resolve:window`), which `lint.js` states in
    // its own words — "a window that changed with a knob is a window the badge
    // cannot promise anything about". A declared input is legal as a VALUE.
    await addPlot(2, 'tuned', 'ema(close, 20) * period')
    await save()
    const doc = sent()
    expect(JSON.stringify(doc.compute.trees.tuned)).toContain('"name":"period"')
    expect(doc.inputs.some((i) => i.key === 'period')).toBe(true)
    expect(validateUserDefinitions([doc]).errors).toEqual([])
  })

  it('`let` bindings are accepted in a row and the stored source keeps them verbatim', async () => {
    mount(); await flush()
    await type(screen.getByLabelText('Formula'),
      'let fast = ema(close, 12)\nlet slow = ema(close, 26)\nfast - slow')
    await save('Let MACD')
    const doc = sent()
    expect(doc.compute.source).toContain('let fast')
    expect(doc.compute.fn).toBe(astHash(parseFormula(MACD_SRC.macd).ast))
  })

  it('Overlay writes placement.target "price"; Levels become ONE hlines plot', async () => {
    mount(); await flush()
    await type(screen.getByLabelText('Formula'), 'sma(close, 20)')
    await set(screen.getByLabelText('Placement'), 'price')
    await set(screen.getByLabelText('Levels'), '70, 30')
    await save()
    const doc = sent()
    expect(doc.placement).toEqual({ target: 'price' })
    expect(doc.plots.at(-1)).toEqual({
      key: 'levels', label: 'Levels', style: 'hlines', levels: [70, 30],
      color: 'rgba(255,255,255,0.12)', width: 1, lineStyle: 'largeDashed', role: 'context',
    })
    expect(validateUserDefinitions([doc]).errors).toEqual([])
  })

  it('a plot key that is blank, a duplicate, or `levels` is refused BY NAME on its row', async () => {
    mount(); await flush()
    await type(screen.getByLabelText('Formula'), 'sma(close, 20)')
    await addPlot(2, 'signal', 'ema(close, 5)')
    await set(screen.getByLabelText('Plot 2 key'), '')
    expect(screen.getByTestId('plot-problem-2').textContent).toMatch(/give the plot a key/)
    await set(screen.getByLabelText('Plot 2 key'), 'value')
    expect(screen.getByTestId('plot-problem-2').textContent)
      .toMatch(/this formula already has a plot called `value`/)
    await set(screen.getByLabelText('Plot 2 key'), 'levels')
    expect(screen.getByTestId('plot-problem-2').textContent).toMatch(/reserved for the levels guide/)
    expect(screen.getByRole('button', { name: /^Sav/ })).toBeDisabled()
  })

  it('⚰️ a plot key that IS a closed-table name is LEGAL — `macd` is the shipped example', async () => {
    // ⛔ THE BRIEF SPECIFIED THE OPPOSITE, AND ITS OWN MACD EXAMPLE DISPROVES
    // IT: `macd` is a declared function in `closedTable.json` (measured), so the
    // rule it wrote refuses the document this whole task exists to make
    // authorable — and the SHIPPED `macd` native uses `macd` as a plot key.
    // The input rule does not transfer because a plot key is not an identifier
    // in any formula: it is an addressing handle namespaced by the definition id.
    mount(); await flush()
    await type(screen.getByLabelText('Formula'), MACD_SRC.macd)
    await set(screen.getByLabelText('Plot 1 key'), 'macd')
    expect(screen.queryByTestId('plot-problem-1')).toBeNull()
    await save('MACD one line')
    const doc = sent()
    expect(doc.plots[0].key).toBe('macd')
    // ⭐ AND THE SHIPPED SCHEMA AGREES — `validatePlot` checks KEY_RE and
    // uniqueness and says nothing at all about the closed table.
    expect(validateUserDefinitions([doc]).errors).toEqual([])
  })

  it('⛔ …but a plot key whose SETTINGS collide with a declared input is refused', async () => {
    // The one collision that IS real: `signalColor` and `signalWidth` land in the
    // same `inputs[]` array as the member's own names, and a duplicate key there
    // is a schema refusal about the wrong thing.
    mount(); await flush()
    await type(screen.getByLabelText('Formula'), 'sma(close, 20)')
    await click(screen.getByTestId('add-input'))
    await set(screen.getByLabelText('Input 1 name'), 'signalWidth')
    await addPlot(2, 'signal', 'ema(close, 5)')
    expect(screen.getByTestId('plot-problem-2').textContent).toMatch(/already declares one of them/)
    expect(screen.getByRole('button', { name: /^Sav/ })).toBeDisabled()
  })

  it('⛔ the badge the DOCUMENT carries is the WORST row’s, not plot 1’s', () => {
    // ⚠️ PINNED ON THE PURE FUNCTION, AND THE REASON IS MEASURED: every
    // table-legal tree is `non-repainting` today (`lint.js`'s declared property —
    // every shipped `lookback` is >= 0 or `argK`), so the sheet CANNOT produce a
    // document whose rows disagree, and a mutation that replaced the aggregation
    // with `rows[0].mode` passed the whole suite. The day the manifest declares a
    // negative lookback, `validateAstLane` re-measures the badge as the WORST of
    // the trees and refuses a disagreement in both directions — so a sheet that
    // wrote plot 1's badge would build a document its own Save door rejects.
    const ev = evaluateFormula('sma(close, 20)', BUILDER_INPUT_SCOPE)
    const row = (key, mode) => ({
      key, label: '', source: 'sma(close, 20)', ast: ev.ast, mode,
      readback: ev.readback, style: 'line',
      color: BUILDER_INPUTS[0].default, width: BUILDER_INPUTS[1].default, hidden: false,
    })
    const doc = buildDefinition({
      defId: 'u_0123456789ab', name: 'Two badges', source: 'sma(close, 20)',
      ast: ev.ast, mode: 'non-repainting', readback: ev.readback,
      plots: [row('value', 'non-repainting'), row('second', 'repaints')],
    })
    expect(doc.meta.repaint).toBe('repaints')
    // ⭐ AND THE CONTROL — with both rows clean the badge is clean, so the case
    // above is the aggregation and not a constant.
    expect(buildDefinition({
      defId: 'u_0123456789ab', name: 'Two badges', source: 'sma(close, 20)',
      ast: ev.ast, mode: 'non-repainting', readback: ev.readback,
      plots: [row('value', 'non-repainting'), row('second', 'non-repainting')],
    }).meta.repaint).toBe('non-repainting')
  })

  it('⛔ removing a row ABOVE the scan keeps the scan on the row the member picked', async () => {
    // ⚰️ THE INDEX HAS TO MOVE WITH THE LIST. Holding the choice as an index
    // fixes the RENAME case for free, and opens this one: delete a row above the
    // chosen one and a fixed index points past the end. `buildDefinition` would
    // then fall back to plot 1 and the document would scan a different tree than
    // the radio shows — the same silent swap, one gesture over.
    mount(); await flush()
    await type(screen.getByLabelText('Formula'), 'sma(close, 20)')
    await addPlot(2, 'first', 'close > sma(close, 10)')
    await addPlot(3, 'second', 'close > sma(close, 50)')
    await click(screen.getByLabelText('Scan on plot 3'))
    await click(screen.getByTestId('remove-plot-2'))
    expect(screen.getByLabelText('Scan on plot 2').checked, 'the chosen row slid up one').toBe(true)
    await save('Scan follows')
    const doc = sent()
    expect(doc.compute.scanPlot).toBe('second')
    expect(doc.compute.ast).toEqual(parseFormula('close > sma(close, 50)').ast)
  })

  it('removing a plot takes its row, its settings and its tree with it', async () => {
    mount(); await flush()
    await type(screen.getByLabelText('Formula'), 'sma(close, 20)')
    await addPlot(2, 'signal', MACD_SRC.signal)
    await addPlot(3, 'hist', MACD_SRC.hist, 'histogram')
    await click(screen.getByTestId('remove-plot-2'))
    await save('Two left')
    const doc = sent()
    expect(doc.plots.map((p) => p.key)).toEqual(['value', 'hist'])
    // ⛔ THE CHROME GOES WITH IT. A `signalColor` input left behind is a setting
    // row for a line nobody draws, and `$refs` on no plot.
    expect(doc.inputs.map((i) => i.key)).toEqual(['color', 'lineWidth', 'histColor', 'histWidth'])
    expect(validateUserDefinitions([doc]).errors).toEqual([])
  })
})

describe('the chrome keys are DERIVED once and read by both sides', () => {
  it('⛔ the sheet\'s reserved names and the document\'s input keys come from ONE function', async () => {
    // A member input named after a plot's own setting would collide in
    // `inputs[]` and be refused by the schema with a message about duplicate
    // keys — a correct sentence about the wrong thing. It is refused on its own
    // row instead, by the same derivation the document is built from.
    mount(); await flush()
    await type(screen.getByLabelText('Formula'), 'sma(close, 20)')
    await addPlot(2, 'signal', MACD_SRC.signal)
    await click(screen.getByTestId('add-input'))
    await set(screen.getByLabelText('Input 1 name'), chromeInputKeys({ key: 'signal' }, 1).color)
    expect(screen.getByTestId('member-input-problem-0').textContent).toMatch(/one of your plots/)
    expect(screen.getByRole('button', { name: /^Sav/ })).toBeDisabled()
  })

  it('chromeInputsFor names row 0 with the SHIPPED labels and later rows after their plot', () => {
    const rows = [
      { key: 'value', label: '', color: '#111111', width: 2 },
      { key: 'signal', label: 'Signal', color: '#222222', width: 4 },
    ]
    expect(chromeInputsFor(rows)).toEqual([
      { ...BUILDER_INPUTS[0], default: '#111111' },
      { ...BUILDER_INPUTS[1], default: 2 },
      { key: 'signalColor', type: 'color', label: 'Signal colour', default: '#222222' },
      { key: 'signalWidth', type: 'int', label: 'Signal width', default: 4, min: 1, max: 4, step: 1 },
    ])
    // ⛔ AND WITH NOTHING TO GO ON IT IS STILL THE SHIPPED PAIR — a document
    // always declares its chrome.
    expect(chromeInputsFor([]).map((s) => s.key)).toEqual(BUILDER_INPUTS.map((s) => s.key))
  })
})

describe('opening a saved v2 formula restores every row, the scan choice, the placement and the member inputs', () => {
  const build = () => {
    const scope = { ...BUILDER_INPUT_SCOPE, period: true }
    const ev = (s) => evaluateFormula(s, scope)
    const rows = ['macd', 'signal', 'hist', 'hist_up'].map((k, i) => {
      // ⚰️ `ema(close, period)` — the brief's spelling — is refused at
      // `resolve:window`, so the fixture would never have been a document the
      // registry accepts. `period` as a VALUE is legal and still proves the
      // member input was restored, which is the only thing this row is for.
      const src = i === 0 ? '(ema(close, 12) - ema(close, 26)) * period' : MACD_SRC[k]
      const e = ev(src)
      return {
        key: k, label: k.toUpperCase(), source: src, ast: e.ast, mode: e.verdict.mode,
        readback: e.readback, style: k === 'hist' ? 'histogram' : 'line',
        color: '#c9a84c', width: 1, hidden: k === 'hist_up',
      }
    })
    const definition = buildDefinition({
      defId: 'u_aaaaaaaaaaaa', name: 'MACD v2', source: rows[3].source, ast: rows[3].ast,
      mode: rows[3].mode, readback: rows[3].readback,
      inputs: [...BUILDER_INPUTS, { key: 'period', type: 'int', label: 'Period', default: 12, min: 1, max: 500 }],
      plots: rows, scanPlot: 'hist_up', placement: { target: 'price' }, levels: [0],
    })
    return { rows, definition }
  }

  it('🔴 the edit path reads compute.sources, not the scan alias', async () => {
    const { rows, definition } = build()
    expect(validateUserDefinitions([definition]).errors,
      'the fixture must be a document the registry accepts, or this measures nothing').toEqual([])
    H.rows = [{ def_id: 'u_aaaaaaaaaaaa', version: 1, rev: 1, definition }]
    mount(); await flush()
    await click(screen.getByLabelText('Edit MACD v2'))
    await settle()

    expect(screen.getByLabelText('Formula').value).toBe(rows[0].source)
    expect(screen.getByLabelText('Formula for plot 2').value).toBe(MACD_SRC.signal)
    expect(screen.getByLabelText('Plot 3 style').value).toBe('histogram')
    expect(screen.getByLabelText('Scan on plot 4').checked).toBe(true)
    expect(screen.getByLabelText('Hide plot 4').checked).toBe(true)
    expect(screen.getByLabelText('Placement').value).toBe('price')
    expect(screen.getByLabelText('Levels').value).toBe('0')
    expect(screen.getByLabelText('Input 1 name').value).toBe('period')
    expect(screen.getByTestId('readback').textContent).toBe(rows[0].readback)
  })

  it('⛔ …and saving it straight back writes the SAME document but for the version', async () => {
    // ⭐ THE ROUND TRIP IS THE GATE. Every field the restore drops silently
    // reappears here as a difference; a restore that reads only what it happens
    // to render would pass the case above and lose the rest.
    const { definition } = build()
    H.rows = [{ def_id: 'u_aaaaaaaaaaaa', version: 1, rev: 1, definition }]
    mount(); await flush()
    await click(screen.getByLabelText('Edit MACD v2'))
    await settle()
    await click(screen.getByRole('button', { name: /^Sav/ }))
    await flush()
    const doc = sent()
    expect(doc).toEqual({ ...definition, version: 2 })
  })

  it('a v2 row whose source was not stored says so rather than opening an empty box', async () => {
    const { definition } = build()
    const broken = JSON.parse(JSON.stringify(definition))
    delete broken.compute.sources.signal
    H.rows = [{ def_id: 'u_aaaaaaaaaaaa', version: 1, rev: 1, definition: broken }]
    mount(); await flush()
    await click(screen.getByLabelText('Edit MACD v2'))
    expect(screen.getByTestId('store-error').textContent).toMatch(/stored without its source text/)
    expect(screen.queryByLabelText('Formula for plot 2')).toBeNull()
  })
})

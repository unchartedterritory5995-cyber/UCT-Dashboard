// app/src/components/chart/builder/BuilderSheet.presentationPreserve.test.jsx
//
// ─── ⭐⭐ P2 — AN EDIT THAT CHANGES THE MATHS KEEPS THE PRESENTATION ──────────
//
// The real sheet, the real `useUserDefinitions` hook, only `fetch` stubbed. A
// stored definition carrying a colour mode, a Pine-style paint the builder never
// wrote, a marker, a custom legend and a line style is reopened, ONE formula is
// edited, and the document that actually leaves (the PUT body) must keep every
// unrelated presentation field byte-identical.
//
// Each case: ASKED / CLAIMED / DID.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, fireEvent, act, screen } from '@testing-library/react'
import { SWRConfig } from 'swr'
import BuilderSheet, { buildDefinition } from './BuilderSheet'
import { BUILDER_INPUT_SCOPE } from './builderInputs'
import { evaluateFormula, FORMULA_DEBOUNCE_MS } from './FormulaField'
import { AuthContext } from '../../../context/AuthContext'
import { clearUserDefinitions } from '../engine/nativeRegistry'
import { validateDefinition } from '../engine/defSchema'

const DEF_ID = 'u_ab12cd34ef56'
const H = vi.hoisted(() => ({ requests: [] }))

function stubFetch() {
  H.requests = []
  global.fetch = vi.fn(async (url, init = {}) => {
    const method = init.method || 'GET'
    H.requests.push({ url: String(url), method, body: init.body ?? null })
    if (method === 'GET') return { ok: true, status: 200, json: async () => ({ definitions: [] }) }
    return { ok: true, status: 200, json: async () => ({ def_id: DEF_ID, version: 2, rev: 2, rev_bumped: true, semantics: 2 }) }
  })
}
const flush = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
}

function row(key, source, extra = {}) {
  const ev = evaluateFormula(source, BUILDER_INPUT_SCOPE)
  if (!ev.ok) throw new Error(`fixture formula ${source}: ${ev.error}`)
  return { key, label: '', source, ast: ev.ast, mode: ev.verdict.mode, readback: ev.readback,
    style: 'line', color: '#2962ff', width: 2, ...extra }
}

/** A stored document with presentation the builder writes AND presentation it
 *  cannot express (a Pine-style palette paint, a computed colour, a custom
 *  legend, a line style, a precision). */
function storedDoc() {
  const doc = buildDefinition({
    defId: DEF_ID, name: 'Painted', version: 1, rev: 1,
    plots: [
      row('value', 'sma(close, 5)', { colorMode: 'column:cond', colorUp: '#00ff00', colorDown: '#ff0000' }),
      row('cond', 'close > open', { hidden: true }),
      row('sig', 'close > sma(close, 5)', { style: 'markers', marker: { shape: 'arrowUp', position: 'belowBar', text: 'up' } }),
    ],
    scanPlot: 'value',
  })
  doc.plots[0].legend = { decimals: 4, label: 'Fast' }
  doc.plots[0].lineStyle = 'dashed'
  doc.plots[0].precision = 3
  doc.plots[1].colorMode = 'column:cond'
  doc.plots[1].colorPacked = { transparency: 20 }
  doc.paints = [
    { kind: 'barcolor', title: 'Pine bars', colorMode: 'column:cond', colorPalette: ['rgba(0, 0, 0, 0)', '#ffeb3b'] },
    { kind: 'bgcolor', color: '#123456', opacity: 0.1 },
  ]
  const v = validateDefinition(doc)
  if (!v.ok) throw new Error(`fixture document is invalid: ${v.errors.join('; ')}`)
  return doc
}

function mount(editRow) {
  return render(
    <AuthContext.Provider value={{ user: { id: 7 }, isPaid: true, loading: false }}>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
        <BuilderSheet open onClose={() => {}} onSaved={() => {}} settings={null} onChange={() => {}} editRow={editRow} />
      </SWRConfig>
    </AuthContext.Provider>,
  )
}
const sent = () => {
  const w = H.requests.find((r) => r.method !== 'GET')
  return w ? JSON.parse(w.body).definition : null
}

beforeEach(() => { vi.useFakeTimers(); stubFetch(); clearUserDefinitions() })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); delete global.fetch; clearUserDefinitions() })

describe('⭐ P2 item 10/11 — presentation survives a maths edit', () => {
  it('ASKED edit plot 1 sma(close,5)→sma(close,9) · CLAIMED "only the maths changes" · DID keep colorMode, paints, marker, legend, lineStyle, precision, colorPacked byte-identical', async () => {
    const prior = storedDoc()
    const editRow = { def_id: DEF_ID, version: 1, rev: 1, definition: prior }
    mount(editRow)
    await act(async () => { vi.advanceTimersByTime(FORMULA_DEBOUNCE_MS) })
    await flush()
    fireEvent.change(screen.getByLabelText('Formula'), { target: { value: 'sma(close, 9)' } })
    await act(async () => { vi.advanceTimersByTime(FORMULA_DEBOUNCE_MS) })
    await flush()
    const save = screen.getByRole('button', { name: /^Sav/ })
    expect(save.disabled).toBe(false)
    await act(async () => { fireEvent.click(save) })
    await flush()
    const doc = sent()
    expect(doc).toBeTruthy()
    // the maths DID change
    expect(doc.compute.trees.value).not.toEqual(prior.compute.trees.value)
    expect(doc.compute.sources.value).toBe('sma(close, 9)')
    const byKey = (d, k) => d.plots.find((p) => p.key === k)
    // plot 1: the builder-expressible colour mode + the unexpressible extras
    for (const f of ['colorMode', 'colorUp', 'colorDown', 'legend', 'lineStyle', 'precision', 'style', 'label']) {
      expect(JSON.stringify(byKey(doc, 'value')[f])).toBe(JSON.stringify(byKey(prior, 'value')[f]))
    }
    // the hidden condition row: its computed colour travels with its mode
    expect(byKey(doc, 'cond').colorMode).toBe('column:cond')
    expect(byKey(doc, 'cond').colorPacked).toEqual({ transparency: 20 })
    expect(byKey(doc, 'cond').hidden).toBe(true)
    // the marker
    expect(byKey(doc, 'sig').style).toBe('markers')
    expect(byKey(doc, 'sig').marker).toEqual(byKey(prior, 'sig').marker)
    // every paint the builder did not write, in stored order
    expect(JSON.stringify(doc.paints)).toBe(JSON.stringify(prior.paints))
    // placement unchanged
    expect(doc.placement).toEqual(prior.placement)
    // and the saved document is still a valid one
    expect(validateDefinition(doc).ok).toBe(true)
  })
})

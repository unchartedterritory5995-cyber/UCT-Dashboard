// app/src/components/chart/builder/BuilderSheet.objectProgram.test.jsx
//
// ─── ⭐⭐ P2X (owner decision 3) — A MANUAL REOPEN-EDIT NEVER SILENTLY DESTROYS
//     AN OBJECT PROGRAM ─────────────────────────────────────────────────────────
//
// The real sheet, the real `useUserDefinitions` hook, only `fetch` stubbed. The
// stored definitions are REAL Pine member-pane documents (the c3b live corpus,
// through `memberPaneDefinition`, the door a member's Pine pane saves through),
// round-tripped through JSON the way the store hands them back.
//
// Each case: ASKED / CLAIMED / DID.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { render, cleanup, fireEvent, act, screen } from '@testing-library/react'
import { SWRConfig } from 'swr'
import BuilderSheet from './BuilderSheet'
import { FORMULA_DEBOUNCE_MS } from './FormulaField'
import { AuthContext } from '../../../context/AuthContext'
import { clearUserDefinitions } from '../engine/nativeRegistry'
import { validateDefinition } from '../engine/defSchema'
import { memberPaneDefinition } from './memberPane/memberPaneDefinition'
import { objectReaderFor } from '../engine/objectColumns'
import { evaluateObjects } from '../engine/objectRuntime'
import { computeFor } from '../engine/nativeRegistry'
import { stampSemantics } from '../engine/definitionSemantics'

const DEF_ID = 'u_0b1ec7000001'
const H = vi.hoisted(() => ({ requests: [] }))
const FIX = path.resolve(globalThis.process.cwd(), '..', 'tests/fixtures/c3b_live')

/** A stored row: the member-pane document, as the store hands it back. */
function stored(file) {
  const built = memberPaneDefinition({ source: fs.readFileSync(path.join(FIX, file), 'utf8'), id: DEF_ID })
  if (!built.ok) throw new Error(`${file}: ${built.reason}`)
  const def = JSON.parse(JSON.stringify(built.definition))
  const v = validateDefinition(def)
  if (!v.ok) throw new Error(`${file}: ${v.errors.join('; ')}`)
  return def
}
const deepFreeze = (o) => {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o)
    for (const v of Object.values(o)) deepFreeze(v)
  }
  return o
}

const N = 260
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1_700_000_000 + i * 86400,
  o: 100 + Math.sin(i / 9) * 6, h: 106 + Math.sin(i / 9) * 6,
  l: 94 + Math.sin(i / 9) * 6, c: 100 + Math.sin(i / 7) * 8, v: 1_000_000 + i,
}))
/** What the object lane draws for a document — the binder's own call. */
function drawn(def) {
  const reader = objectReaderFor(def, BARS, { tf: 'D', symbol: { ticker: 'SPY', exchange: 'NYSE Arca' }, newestBarIsForming: false })
  if (!reader) return null
  const run = evaluateObjects(reader.program, { barCount: N, readNode: reader.readNode, readTime: (i) => BARS[i].t })
  return JSON.stringify(run.live)
}

function stubFetch() {
  H.requests = []
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const method = init.method || 'GET'
    H.requests.push({ url: String(url), method, body: init.body ?? null })
    if (method === 'GET') return { ok: true, status: 200, json: async () => ({ definitions: [] }) }
    return { ok: true, status: 200, json: async () => ({ def_id: DEF_ID, version: 2, rev: 2, rev_bumped: true }) }
  })
}
const flush = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
}
const settle = async () => {
  await act(async () => { vi.advanceTimersByTime(FORMULA_DEBOUNCE_MS) })
  await flush()
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
const writes = () => H.requests.filter((r) => r.method !== 'GET')
const sent = () => {
  const w = writes()[0]
  return w ? JSON.parse(w.body).definition : null
}
const saveButton = () => screen.getByRole('button', { name: /^Sav/ })

beforeEach(() => { vi.useFakeTimers(); stubFetch(); clearUserDefinitions() })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); delete globalThis.fetch; clearUserDefinitions() })

describe('⭐⭐ P2X — a representable edit KEEPS the object program byte-identically', () => {
  it('ASKED reopen a Pine pane with labels, rename it and change sma 50→40 · CLAIMED "only the name and the plot\'s maths change" · DID send the stored program byte-identical, evaluating to the same drawings, with its Pine stamps', async () => {
    const prior = deepFreeze(stored('c3b_02_label_text.pine'))
    const priorBytes = JSON.stringify(prior)
    expect(prior.objects.ops.some((o) => o.k === 'create' && o.family === 'label')).toBe(true)
    mount({ def_id: DEF_ID, version: 1, rev: 1, definition: prior })
    await settle()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Renamed labels' } })
    fireEvent.change(screen.getByLabelText('Formula'), { target: { value: 'sma(close, 40)' } })
    await settle()
    expect(saveButton().disabled).toBe(false)
    await act(async () => { fireEvent.click(saveButton()) })
    await flush()
    // no confirmation was needed
    expect(screen.queryByTestId('object-loss-confirm')).toBeNull()
    const doc = sent()
    expect(doc, 'the edit was never sent').toBeTruthy()
    expect(writes()).toHaveLength(1)
    expect(writes()[0].method).toBe('PUT')
    // the edit DID happen
    expect(doc.meta.name).toBe('Renamed labels')
    expect(doc.compute.source).toBe('sma(close, 40)')
    // ⭐ the program: BYTE-identical
    expect(JSON.stringify(doc.objects)).toBe(JSON.stringify(prior.objects))
    // ⭐ and the stamps it evaluates under (the object lane reads them)
    for (const k of ['recurrenceOrigin', 'naConditionFalse']) expect(doc.meta[k]).toEqual(prior.meta[k])
    expect(validateDefinition(doc).ok).toBe(true)
    // ⭐ it evaluates IDENTICALLY (the object lane's own output, bar for bar)
    const before = drawn(prior)
    expect(before && before.length > 2, 'the fixture draws nothing — vacuous').toBe(true)
    expect(drawn(doc)).toBe(before)
    // the stored row object itself was never touched
    expect(JSON.stringify(prior)).toBe(priorBytes)
  })

  it('ASKED save again after the first save (the editor now holds the stored copy) · CLAIMED still kept · DID', async () => {
    const prior = deepFreeze(stored('c3b_04_table_dash.pine'))
    mount({ def_id: DEF_ID, version: 1, rev: 1, definition: prior })
    await settle()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Dash 2' } })
    await settle()
    await act(async () => { fireEvent.click(saveButton()) })
    await flush()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Dash 3' } })
    await settle()
    await act(async () => { fireEvent.click(saveButton()) })
    await flush()
    const bodies = writes().map((w) => JSON.parse(w.body).definition)
    expect(bodies).toHaveLength(2)
    for (const b of bodies) expect(JSON.stringify(b.objects)).toBe(JSON.stringify(prior.objects))
    expect(drawn(bodies[1])).toBe(drawn(prior))
  })
})

describe('⭐⭐ P2X — an edit that would invalidate the program asks first, and Cancel changes nothing', () => {
  async function destructiveEdit() {
    const prior = deepFreeze(stored('c3b_09_param_object.pine'))
    // the fixture is real: the line's tree reads the member input `off`
    expect(prior.inputs.some((s) => s.key === 'off')).toBe(true)
    expect(JSON.stringify(prior.objects.trees)).toContain('"name":"off"')
    mount({ def_id: DEF_ID, version: 1, rev: 1, definition: prior })
    await settle()
    // the member removes the input and writes the offset in as a literal
    fireEvent.change(screen.getByLabelText('Formula'), { target: { value: 'close - 5' } })
    await settle()
    await act(async () => { fireEvent.click(screen.getByLabelText('Remove input 1')) })
    await settle()
    expect(saveButton().disabled).toBe(false)
    return prior
  }

  it('ASKED remove the input the line reads · CLAIMED "this edit removes the drawing" · DID show a confirmation naming it and send NOTHING', async () => {
    const prior = await destructiveEdit()
    const priorBytes = JSON.stringify(prior)
    await act(async () => { fireEvent.click(saveButton()) })
    await flush()
    // (7) detected, (8) no mutation before confirmation: no request at all
    expect(writes()).toHaveLength(0)
    const box = screen.getByTestId('object-loss-confirm')
    // (10) it names what is removed
    expect(screen.getByTestId('object-loss-sentence').textContent)
      .toBe('This indicator also draws 1 line from its imported script; saving this edit will remove them.')
    expect(screen.getByTestId('object-loss-reason').textContent).toContain('"off"')
    expect(box.getAttribute('role')).toBe('alertdialog')
    // (9) Cancel → nothing sent, the stored definition byte-identical
    await act(async () => { fireEvent.click(screen.getByTestId('object-loss-cancel')) })
    await flush()
    expect(screen.queryByTestId('object-loss-confirm')).toBeNull()
    expect(writes()).toHaveLength(0)
    expect(JSON.stringify(prior)).toBe(priorBytes)
  })

  it('ASKED confirm the lossy save · CLAIMED the drawing is removed, nothing else · DID send a valid document without `objects`', async () => {
    const prior = await destructiveEdit()
    await act(async () => { fireEvent.click(saveButton()) })
    await flush()
    expect(writes()).toHaveLength(0)
    await act(async () => { fireEvent.click(screen.getByTestId('object-loss-confirm-save')) })
    await flush()
    expect(writes()).toHaveLength(1)
    const doc = sent()
    expect('objects' in doc).toBe(false)
    expect(doc.compute.source).toBe('close - 5')
    expect(doc.inputs.some((s) => s.key === 'off')).toBe(false)
    expect(validateDefinition(doc).ok).toBe(true)
    expect(screen.queryByTestId('object-loss-confirm')).toBeNull()
    expect(prior.objects).toBeTruthy()
  })

  it('ASKED change the draft while the confirmation is open · CLAIMED the confirmation answers ONE draft · DID withdraw it', async () => {
    await destructiveEdit()
    await act(async () => { fireEvent.click(saveButton()) })
    await flush()
    expect(screen.getByTestId('object-loss-confirm')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Formula'), { target: { value: 'close - 6' } })
    await settle()
    expect(screen.queryByTestId('object-loss-confirm')).toBeNull()
    expect(writes()).toHaveLength(0)
  })
})

// ─── ⭐⭐ P2X (coordinator ruling on gap 2) — THE STORED ROW'S SOURCE STAMPS RIDE
//     THROUGH EVERY MANUAL EDIT, objects or not ───────────────────────────────
describe('⭐⭐ P2X — a Pine-origin definition keeps its Pine semantics through a manual edit', () => {
  // `close > sma(close, 50)` is `na` for the first 49 bars; Pine (v4+,
  // `naConditionFalse`) reads that `?:` test as FALSE → 0, native rules do not.
  const NA_SRC = `//@version=5
indicator("P2X na ternary")
plot(close > ta.sma(close, 50) ? 1 : 0, title = "Above")
`
  const pineDoc = () => {
    const built = memberPaneDefinition({ source: NA_SRC, id: DEF_ID })
    if (!built.ok) throw new Error(built.reason)
    return JSON.parse(JSON.stringify(built.definition))
  }
  const column = (def) => {
    const cols = computeFor(def, BARS, undefined, { tf: 'D', symbol: { ticker: 'SPY', exchange: 'NYSE Arca' }, newestBarIsForming: false })
    return JSON.stringify(Array.from(cols.value).slice(0, 60))
  }
  const STAMPS = ['recurrenceOrigin', 'naConditionFalse', 'lowerTf', 'otherSymbols', 'periodReads', 'runtimeErrors', 'disclosures', 'requirementTags']

  it('ASKED reopen a Pine pane WITHOUT objects and rename it · CLAIMED Pine semantics unchanged · DID keep every stored stamp byte-identical and the same column (na tests still false) — EXACT', async () => {
    const prior = deepFreeze(pineDoc())
    expect(prior.objects).toBeUndefined()
    expect(prior.meta.recurrenceOrigin).toBe('pine')
    expect(prior.meta.naConditionFalse).toBe(true)
    // non-vacuity: WITHOUT the Pine origin a maths-moving draft is stamped
    // semantics 2 (`stampSemantics`, the store's own rule), and under it the
    // `na` test is UNKNOWN rather than false — a different column
    const { recurrenceOrigin: _r, naConditionFalse: _n, ...nativeMeta } = prior.meta
    const stripped = { ...prior, meta: nativeMeta }
    const restamped = stampSemantics({ ...stripped, compute: { ...stripped.compute, ast: { type: 'series', name: 'close' } } }, { prior: stripped })
    expect(restamped.meta.semantics).toBe(2)
    expect(column({ ...stripped, meta: { ...nativeMeta, semantics: 2 } })).not.toBe(column(prior))
    mount({ def_id: DEF_ID, version: 1, rev: 1, definition: prior })
    await settle()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Renamed na' } })
    await settle()
    await act(async () => { fireEvent.click(saveButton()) })
    await flush()
    const doc = sent()
    expect(doc, 'the edit was never sent').toBeTruthy()
    expect(doc.meta.name).toBe('Renamed na')
    for (const k of STAMPS) expect(JSON.stringify(doc.meta[k]), k).toBe(JSON.stringify(prior.meta[k]))
    expect('semantics' in doc.meta).toBe(false)
    expect(validateDefinition(doc).ok).toBe(true)
    expect(column(doc)).toBe(column(prior))
    // and a later maths edit of THIS document is still never stamped 2
    expect(stampSemantics({ ...doc, compute: { ...doc.compute, ast: { type: 'series', name: 'close' } } }, { prior: doc }).meta.semantics).toBeUndefined()
  })

  it('ASKED reopen a NATIVE definition and rename it · CLAIMED it gains no Pine stamps (nor a forged semantics) · DID', async () => {
    const native = memberPaneDefinition({ source: NA_SRC, id: DEF_ID }).definition
    const prior = JSON.parse(JSON.stringify(native))
    for (const k of STAMPS) delete prior.meta[k]
    prior.meta.semantics = 2
    deepFreeze(prior)
    mount({ def_id: DEF_ID, version: 1, rev: 1, definition: prior })
    await settle()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Native renamed' } })
    await settle()
    await act(async () => { fireEvent.click(saveButton()) })
    await flush()
    const doc = sent()
    expect(doc).toBeTruthy()
    for (const k of STAMPS) expect(k in doc.meta, k).toBe(false)
    expect('semantics' in doc.meta).toBe(false)
  })
})

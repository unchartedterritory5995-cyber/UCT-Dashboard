// app/src/components/chart/builder/BuilderSheet.legacyStocSave.test.jsx
//
// ⭐⭐ P0-1 FOLLOW-UP (owner ruling 2026-10-30) — AN ORDINARY SAVE NEVER
// CONVERTS A LEGACY TC2000 READING, AND THE EXPLICIT SWITCH DOES.
//
// The real sheet, the real `useUserDefinitions` hook; only `fetch` is stubbed,
// so what is asserted is the document the store would actually receive (the
// PUT body), not a state variable.
//
// The four cases the ruling names:
//   1. open + ordinary Save (incl. a rename) keeps the stored tree, and the
//      saved document computes exactly what the stored one did;
//   2. the explicit switch asks first, and Cancel sends nothing;
//   3. the confirmed switch stores TC2000's documented reading;
//   4. EDITING the formula text of a legacy definition asks the same question
//      before anything is sent.
// Plus the control: a definition already on the current reading saves without
// any of this.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { SWRConfig } from 'swr'

import BuilderSheet, { buildDefinition } from './BuilderSheet'
import { BUILDER_INPUT_SCOPE } from './builderInputs'
import { evaluateFormula, FORMULA_DEBOUNCE_MS } from './FormulaField'
import { AuthContext } from '../../../context/AuthContext'
import { astHash } from '../engine/ast/parse'
import { legacyPcfReadings } from '../engine/ast/pcf'
import { validateDefinition } from '../engine/defSchema'
import { clearUserDefinitions, computeFor } from '../engine/nativeRegistry'

const DEF_ID = 'u_5toc0000bb22'
const NAME = 'Oversold'

// Bars with real range, so a wrong price order and a right one cannot agree.
const BARS = Array.from({ length: 80 }, (_, i) => {
  const c = 100 + 10 * Math.sin(i / 5) + i * 0.1
  return { t: 1_700_000_000 + i * 86400, o: c - 0.5, h: c + 1.5 + (i % 3), l: c - 1.7 - (i % 4), c, v: 1000 }
})

function storedRow(source, { legacy }) {
  const ev = evaluateFormula(source, BUILDER_INPUT_SCOPE)
  if (!ev.ok) throw new Error(`${source}: ${ev.error}`)
  const readings = legacyPcfReadings(source)
  if (legacy && !readings.length) throw new Error(`${source} has no legacy reading — the fixture tests nothing`)
  const ast = legacy ? readings[0].ast : ev.ast
  const definition = buildDefinition({
    defId: DEF_ID, name: NAME, source, ast, mode: ev.verdict.mode, readback: ev.readback, version: 1, rev: 1,
  })
  const v = validateDefinition(definition)
  if (!v.ok) throw new Error(`fixture document is invalid: ${v.errors.join('; ')}`)
  return { def_id: DEF_ID, version: 1, rev: 1, definition }
}

const H = vi.hoisted(() => ({ requests: [], rows: [] }))

function stubFetch() {
  H.requests = []
  H.rows = []
  global.fetch = vi.fn(async (url, init = {}) => {
    const method = init.method || 'GET'
    H.requests.push({ url: String(url), method, body: init.body ?? null })
    if (method === 'GET') return { ok: true, status: 200, json: async () => ({ definitions: H.rows }) }
    return { ok: true, status: 200, json: async () => ({ def_id: DEF_ID, version: 2, rev: 2, rev_bumped: true, migrated: 0 }) }
  })
}

const flush = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
}

function mount() {
  render(
    <AuthContext.Provider value={{ user: { id: 7 }, isPaid: true, loading: false }}>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
        <BuilderSheet open onClose={() => {}} onSaved={() => {}} settings={null} onChange={() => {}} />
      </SWRConfig>
    </AuthContext.Provider>,
  )
}

async function settle() {
  await act(async () => { vi.advanceTimersByTime(FORMULA_DEBOUNCE_MS) })
  await flush()
}
async function openEdit() {
  await flush()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: `Edit ${NAME}` })) })
  await settle()
}
async function click(el) {
  await act(async () => { fireEvent.click(el) })
  await flush()
}
const saveBtn = () => screen.getByRole('button', { name: /^Sav/ })
const writes = () => H.requests.filter((r) => r.method === 'PUT' || r.method === 'POST')
const savedDoc = () => {
  const w = writes()
  expect(w.length).toBe(1)
  return JSON.parse(w[0].body).definition
}
const lastValue = (def) => {
  const col = computeFor(def, BARS, {}).value
  return col[col.length - 1]
}

beforeEach(() => { vi.useFakeTimers(); stubFetch(); clearUserDefinitions() })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); delete global.fetch; clearUserDefinitions() })

describe.each([
  ['STOC14.3', 'STOC14.3'],
  ['ATR14', 'ATR14'],
])('a legacy %s definition', (label, term) => {
  const SOURCE = `${term} + 0`
  const legacyHash = () => astHash(legacyPcfReadings(SOURCE)[0].ast)
  const currentHash = () => astHash(evaluateFormula(SOURCE, BUILDER_INPUT_SCOPE).ast)

  it('fixture control: the two readings really differ, in tree AND in value', () => {
    expect(legacyHash()).not.toBe(currentHash())
    const legacy = storedRow(SOURCE, { legacy: true }).definition
    const current = storedRow(SOURCE, { legacy: false }).definition
    expect(lastValue(legacy)).not.toBeCloseTo(lastValue(current), 6)
  })

  it('an ordinary Save — even with a rename — keeps the stored calculation', async () => {
    const row = storedRow(SOURCE, { legacy: true })
    H.rows = [row]
    mount()
    await openEdit()
    expect(screen.getByTestId('legacy-reading-notice')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Oversold renamed' } })
    await flush()
    await click(saveBtn())
    expect(screen.queryByTestId('legacy-convert-confirm')).toBeNull()
    const doc = savedDoc()
    expect(astHash(doc.compute.ast)).toBe(legacyHash())
    expect(doc.meta.name).toBe('Oversold renamed')
    expect(validateDefinition(doc).ok).toBe(true)
    // ⭐ the number, not just the hash: the saved document draws what it drew.
    expect(lastValue(doc)).toBe(lastValue(row.definition))
  })

  it('the switch asks first, and Cancel sends nothing', async () => {
    H.rows = [storedRow(SOURCE, { legacy: true })]
    mount()
    await openEdit()
    await click(screen.getByTestId('legacy-convert'))
    expect(screen.getByTestId('legacy-convert-sentence').textContent).toMatch(/values will change/)
    expect(screen.getByTestId('legacy-convert-sentence').textContent).toMatch(/alert/)
    await click(screen.getByTestId('legacy-convert-cancel'))
    expect(screen.queryByTestId('legacy-convert-confirm')).toBeNull()
    expect(writes()).toHaveLength(0)
  })

  it('the confirmed switch stores TC2000’s documented reading', async () => {
    H.rows = [storedRow(SOURCE, { legacy: true })]
    mount()
    await openEdit()
    await click(screen.getByTestId('legacy-convert'))
    await click(screen.getByTestId('legacy-convert-save'))
    const doc = savedDoc()
    expect(astHash(doc.compute.ast)).toBe(currentHash())
    expect(lastValue(doc)).toBe(lastValue(storedRow(SOURCE, { legacy: false }).definition))
  })

  it('editing the formula text asks the same question before anything is sent', async () => {
    H.rows = [storedRow(SOURCE, { legacy: true })]
    mount()
    await openEdit()
    fireEvent.change(screen.getByLabelText('Formula'), { target: { value: `${term} + 1` } })
    await settle()
    await click(saveBtn())
    expect(screen.getByTestId('legacy-convert-sentence').textContent).toMatch(/You changed this formula/)
    expect(writes()).toHaveLength(0)
    await click(screen.getByTestId('legacy-convert-save'))
    const doc = savedDoc()
    expect(doc.compute.source).toBe(`${term} + 1`)
    expect(astHash(doc.compute.ast)).toBe(astHash(evaluateFormula(`${term} + 1`, BUILDER_INPUT_SCOPE).ast))
  })

  it('control: a definition already on the current reading saves with no notice and no question', async () => {
    H.rows = [storedRow(SOURCE, { legacy: false })]
    mount()
    await openEdit()
    expect(screen.queryByTestId('legacy-reading-notice')).toBeNull()
    await click(saveBtn())
    expect(screen.queryByTestId('legacy-convert-confirm')).toBeNull()
    expect(astHash(savedDoc().compute.ast)).toBe(currentHash())
  })
})

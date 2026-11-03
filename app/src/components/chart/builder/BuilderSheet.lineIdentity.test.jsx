// app/src/components/chart/builder/BuilderSheet.lineIdentity.test.jsx
//
// ⭐⭐ LINE IDENTITY — THE BUILDER'S HALF OF THE DRAFT MARKER (owner decision 2026-11-02).
//
// A row ADDED while editing a stored definition reaches the store with `newLine: true`,
// so a key removed and typed again before ONE save becomes a new line (the store sees
// only two versions and cannot tell). A row restored from the saved document never
// carries it. ⛔ MOCKS NOTHING ON THE PATH: the rows are typed on the real form, the
// body is the one `saveUserDefinition` PUTs, and the installed copy is the registry's.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { SWRConfig } from 'swr'

import BuilderSheet, { buildDefinition } from './BuilderSheet'
import { BUILDER_INPUTS, BUILDER_INPUT_SCOPE } from './builderInputs'
import { evaluateFormula, FORMULA_DEBOUNCE_MS } from './FormulaField'
import { AuthContext } from '../../../context/AuthContext'
import { getDefinition, clearUserDefinitions, installUserDefinitions } from '../engine/nativeRegistry'

const DEF_ID = 'u_beef0123cafe'
const UID_V = 'p_000000000001'
const UID_F = 'p_aaaaaaaaaaaa'

function row(key, text) {
  const ev = evaluateFormula(text, BUILDER_INPUT_SCOPE)
  return { key, label: '', style: 'line', color: BUILDER_INPUTS[0].default, width: BUILDER_INPUTS[1].default,
    hidden: false, source: ev.source, ast: ev.ast, mode: ev.verdict.mode, readback: ev.readback }
}
/** The stored two-line document, with the store's uids on it. */
function storedRow() {
  const rows = [row('value', 'close'), row('fast', 'close * 2')]
  const definition = buildDefinition({
    defId: DEF_ID, version: 1, rev: 1, name: 'Lines', source: rows[0].source, ast: rows[0].ast,
    mode: rows[0].mode, readback: rows[0].readback, inputs: [...BUILDER_INPUTS], plots: rows, scanPlot: 'value',
  })
  definition.plots = definition.plots.map((p) => ({ ...p, uid: p.key === 'value' ? UID_V : UID_F }))
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
    return { ok: true, status: 200, json: async () => ({ def_id: DEF_ID, version: 2, rev: 2 }) }
  })
}
const flush = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
}
const settle = async () => { await act(async () => { vi.advanceTimersByTime(FORMULA_DEBOUNCE_MS + 10) }); await flush() }
const set = async (el, value) => { await act(async () => { fireEvent.change(el, { target: { value } }) }) }
const click = async (el) => { await act(async () => { fireEvent.click(el) }); await flush() }
const writes = () => H.requests.filter((r) => r.method !== 'GET')
const body = (i = -1) => JSON.parse(writes().at(i).body).definition
const plotOf = (doc, key) => doc.plots.find((p) => p.key === key)

function mount() {
  return render(
    <AuthContext.Provider value={{ user: { id: 7 }, isPaid: true, loading: false }}>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
        <BuilderSheet open onClose={() => {}} onSaved={() => {}} />
      </SWRConfig>
    </AuthContext.Provider>,
  )
}
async function openStored() {
  const stored = storedRow()
  H.rows = [stored]
  installUserDefinitions([stored.definition])
  mount()
  await flush()
  await click(screen.getByRole('button', { name: 'Edit Lines' }))
  await settle()
}
async function addRow(n, key, text) {
  await click(screen.getByTestId('add-plot'))
  await set(screen.getByLabelText(`Plot ${n} key`), key)
  await set(screen.getByLabelText(`Formula for plot ${n}`), text)
  await settle()
}
const save = async () => { await click(screen.getByRole('button', { name: /^Sav/ })); await flush() }

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); stubFetch(); clearUserDefinitions() })
afterEach(() => { cleanup(); clearUserDefinitions(); vi.useRealTimers(); vi.restoreAllMocks(); delete global.fetch })

describe('the draft marker in the PUT body', () => {
  it('the fixture is real: the stored rows reopen and an untouched save sends no marker', async () => {
    await openStored()
    expect(screen.getByLabelText('Plot 2 key').value).toBe('fast')
    await save()
    expect(writes().at(-1).method).toBe('PUT')
    const doc = body()
    expect(doc.plots.filter((p) => p.style !== 'hlines').map((p) => p.key)).toEqual(['value', 'fast'])
    expect(doc.plots.some((p) => 'newLine' in p)).toBe(false)
  })

  it('ASKED remove "fast", add a row typed "fast" again, save · CLAIMED the store is told it is a NEW line · DID', async () => {
    await openStored()
    await click(screen.getByRole('button', { name: 'Remove plot 2' }))
    await addRow(2, 'fast', 'close * 3')
    await save()
    const doc = body()
    expect(plotOf(doc, 'fast').newLine).toBe(true)
    expect(plotOf(doc, 'fast').uid, "the removed line's uid rode onto the new one").toBeUndefined()
    expect('newLine' in plotOf(doc, 'value')).toBe(false)
  })

  it('CONTROL — editing the saved row\'s formula is the SAME line: no marker', async () => {
    await openStored()
    await set(screen.getByLabelText('Formula for plot 2'), 'close * 3')
    await settle()
    await save()
    expect('newLine' in plotOf(body(), 'fast')).toBe(false)
  })

  it('a saved row re-keyed by the member is a new line too', async () => {
    await openStored()
    await set(screen.getByLabelText('Plot 2 key'), 'slow')
    await settle()
    await save()
    expect(plotOf(body(), 'slow').newLine).toBe(true)
  })

  it('after the save lands, the NEXT save does not resend the marker (it would mint a new identity again)', async () => {
    await openStored()
    await addRow(3, 'extra', 'close * 4')
    await save()
    expect(plotOf(body(), 'extra').newLine).toBe(true)
    await save()
    expect(writes().length).toBe(2)
    expect('newLine' in plotOf(body(), 'extra')).toBe(false)
  })

  it("the copy this tab installs keeps the continuing line's uid and marks the new one pending", async () => {
    await openStored()
    await click(screen.getByRole('button', { name: 'Remove plot 2' }))
    await addRow(2, 'fast', 'close * 3')
    await save()
    const installed = getDefinition(DEF_ID)
    expect(plotOf(installed, 'value').uid).toBe(UID_V)
    expect(plotOf(installed, 'fast').uid).toBeUndefined()
    expect(plotOf(installed, 'fast').newLine).toBe(true)
  })

  it('a CREATE sends no marker (every line is new to the store anyway)', async () => {
    mount()
    await flush()
    await set(screen.getByLabelText('Formula'), 'close')
    await settle()
    await addRow(2, 'fast', 'close * 2')
    await set(screen.getByLabelText(/^Name/i), 'Fresh')
    await save()
    expect(writes().at(-1).method).toBe('POST')
    expect(body().plots.some((p) => 'newLine' in p)).toBe(false)
  })
})

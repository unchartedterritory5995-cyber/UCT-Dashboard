// app/src/components/chart/builder/BuilderSheet.functionReadback.test.jsx
//
// ⭐ THE LEGACY "NEW FORMULA" SHEET, ON SCREEN: a formula function reads back by name.
// A definition saved BEFORE this change (its stored description is the expanded
// arithmetic) is opened with "Edit", shows "the 50-bar linear regression of close",
// has its length changed, and saves the same maths the function writes — with the
// HOOK NOT MOCKED (`global.fetch` is the spy, as in `BuilderSheet.edit.test.jsx`).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { SWRConfig } from 'swr'

import BuilderSheet, { buildDefinition } from './BuilderSheet'
import { BUILDER_INPUT_SCOPE } from './builderInputs'
import { evaluateFormula, FORMULA_DEBOUNCE_MS } from './FormulaField'
import { AuthContext } from '../../../context/AuthContext'
import { astHash } from '../engine/ast/parse'
import { clearUserDefinitions } from '../engine/nativeRegistry'

const DEF_ID = 'u_0a1b2c3d4e5f'
const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys)
  : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v)

/** A row exactly as the store returns one saved before this change: the description
 *  is the OLD arithmetic sentence (default `evaluateFormula`), keys sorted. */
function storedRow(source, name) {
  const ev = evaluateFormula(source, BUILDER_INPUT_SCOPE)
  if (!ev.ok) throw new Error(ev.error)
  const definition = buildDefinition({ defId: DEF_ID, name, source, ast: ev.ast, mode: ev.verdict.mode, readback: ev.readback })
  return sortKeys({ def_id: DEF_ID, version: 1, rev: 1, definition })
}

const H = vi.hoisted(() => ({ requests: [], rows: [] }))
beforeEach(() => {
  vi.useFakeTimers()
  H.requests = []; H.rows = []
  clearUserDefinitions()
  global.fetch = vi.fn(async (url, init = {}) => {
    const method = init.method || 'GET'
    H.requests.push({ url: String(url), method, body: init.body ?? null })
    if (method === 'GET') return { ok: true, status: 200, json: async () => ({ definitions: H.rows }) }
    return { ok: true, status: 200, json: async () => ({ def_id: DEF_ID, version: 2, rev: 2, rev_bumped: true, migrated: 0 }) }
  })
})
afterEach(() => { cleanup(); clearUserDefinitions(); vi.useRealTimers(); vi.restoreAllMocks(); delete global.fetch })

const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }) }
const settle = async () => { await act(async () => { vi.advanceTimersByTime(FORMULA_DEBOUNCE_MS) }); await flush() }
function mount() {
  render(
    <AuthContext.Provider value={{ user: { id: 7 }, isPaid: true, loading: false }}>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
        <BuilderSheet open onClose={() => {}} onSaved={() => {}} settings={null} onChange={() => {}} />
      </SWRConfig>
    </AuthContext.Provider>,
  )
}
const readback = () => screen.getByTestId('readback').textContent
const field = () => screen.getByLabelText('Formula')

describe('the legacy formula sheet says formula functions by name', () => {
  it('reopens a definition saved with the OLD arithmetic description and reads it as a linear regression', async () => {
    H.rows = [storedRow('linreg(close, 50)', 'Old LR')]
    expect(H.rows[0].definition.meta.description).toMatch(/sum of close over the last 50 bars/)
    mount(); await flush()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Edit Old LR' })) })
    await settle()
    expect(field().value).toBe('linreg(close, 50)')
    expect(readback()).toBe('the 50-bar linear regression of close')
  })

  it('changing its length reads back and SAVES the 20-bar function — the whole formula moves', async () => {
    H.rows = [storedRow('linreg(close, 50)', 'Old LR')]
    mount(); await flush()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Edit Old LR' })) })
    await settle()
    fireEvent.change(field(), { target: { value: 'linreg(close, 20)' } })
    await settle()
    expect(readback()).toBe('the 20-bar linear regression of close')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save changes' })) })
    await flush()
    const put = H.requests.filter((r) => r.method === 'PUT')
    expect(put).toHaveLength(1)
    const body = JSON.parse(put[0].body)
    const saved = body.definition || body
    // the maths saved are the function's at 20, every copy of the length moved
    expect(saved.compute.fn).toBe(astHash(evaluateFormula('linreg(close, 20)').ast))
    expect(saved.meta.description).toBe('the 20-bar linear regression of close')
  })

  it('a formula typed fresh reads back by name, a plain one exactly as before', async () => {
    mount(); await flush()
    // the sheet opens on the Library for a new formula — go to the Formula tab
    const tab = screen.queryByRole('tab', { name: 'Formula' }) || screen.queryByRole('button', { name: 'Formula' })
    if (tab) await act(async () => { fireEvent.click(tab) })
    fireEvent.change(field(), { target: { value: 'kcUpper(close, 20, 2)' } }); await settle()
    expect(readback()).toBe('the upper Keltner Channel band of close (20 bars, 2 × the average true range)')
    fireEvent.change(field(), { target: { value: 'sma(close, 20)' } }); await settle()
    expect(readback()).toBe('the 20-bar average of close')
  })
})

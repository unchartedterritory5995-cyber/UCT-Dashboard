// app/src/components/chart/builder/BuilderSheet.runtimeEditGuard.test.jsx
//
// ⭐⭐ UIE PHASE 1 HARDENING (2026-10-11) — A RUNTIME DOCUMENT IS NOT A FORMULA.
//
// "Your formulas" -> Edit called `openForEdit(row)`, which reads `compute.source`
// with no kind check: a `compute.kind: 'runtime'` document's source is a whole PINE
// SCRIPT, and it landed in the formula box as formula text. The sheet now refuses by
// name and the list stops printing the script as if it were a formula line. A
// formula row is unchanged (the control below). Real sheet, real
// `useUserDefinitions()`, a stand-in server.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act, within } from '@testing-library/react'
import { SWRConfig } from 'swr'
import BuilderSheet from './BuilderSheet'
import { AuthContext } from '../../../context/AuthContext'

const PINE = '//@version=5\nindicator("Sum")\nvar float s = 0.0\ns := s + close\nplot(s, title="Sum")\n'
const RUNTIME_ROW = {
  def_id: 'u_00000000r001', version: 1, rev: 1, ast_hash: 'runtime:sha256:x',
  definition: {
    id: 'u_00000000r001', version: 1, schemaVersion: 1,
    meta: { name: 'Bar By Bar Sum', lane: 'runtime', runtimeLanguage: 'pine' },
    placement: { target: 'pane' },
    compute: { kind: 'runtime', fn: 'runtime:u_00000000r001', rev: 1, source: PINE, outputs: { value: 0 } },
    plots: [{ key: 'value', label: 'Sum', style: 'line' }],
  },
}
const FORMULA_ROW = {
  def_id: 'u_00000000f001', version: 1, rev: 1, ast_hash: 'h',
  definition: {
    id: 'u_00000000f001', version: 1, schemaVersion: 1,
    meta: { name: 'Plain Average' }, placement: { target: 'price' },
    compute: { kind: 'ast', fn: 'h', source: 'sma(close, 20)', ast: { type: 'call', name: 'sma', args: [{ type: 'series', name: 'close' }, { type: 'num', value: 20 }] } },
    plots: [{ key: 'value', label: 'Plain Average', style: 'line' }],
  },
}

function stubFetch(rows) {
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const method = init.method || 'GET'
    if (method === 'GET' && String(url).startsWith('/api/user-definitions')) {
      return { ok: true, status: 200, json: async () => ({ definitions: rows }) }
    }
    return { ok: true, status: 200, json: async () => ({}) }
  })
}
const flush = async () => {
  await act(async () => { vi.advanceTimersByTime(1000) })
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
const listRowOf = (name) => {
  const head = screen.getByText('Your formulas')
  const list = head.closest('section')
  return within(list).getByText(name).closest('li')
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })

describe('⭐ a runtime document cannot be opened as a formula', () => {
  it('the list names it as a script, and Edit refuses by name with the formula box left empty', async () => {
    stubFetch([RUNTIME_ROW, FORMULA_ROW])
    mount()
    await flush()
    const row = listRowOf('Bar By Bar Sum')
    expect(within(row).getByText('Script drawn bar by bar')).toBeTruthy()
    expect(row.textContent).not.toContain('s := s + close')
    fireEvent.click(within(row).getByRole('button', { name: /^Edit Bar By Bar Sum$/i }))
    await flush()
    expect(screen.getByText(/a script drawn bar by bar, not a formula, so it cannot be edited here/i)).toBeTruthy()
    const field = screen.queryByLabelText('Formula')
    if (field) expect(field.value || field.textContent || '').not.toContain('indicator(')
  })

  it('⛔ CONTROL — a formula row still lists its source and still opens for edit', async () => {
    stubFetch([RUNTIME_ROW, FORMULA_ROW])
    mount()
    await flush()
    const row = listRowOf('Plain Average')
    expect(within(row).getByText('sma(close, 20)')).toBeTruthy()
    fireEvent.click(within(row).getByRole('button', { name: /^Edit Plain Average$/i }))
    await flush()
    expect(screen.queryByText(/cannot be edited here/i)).toBeNull()
  })
})

// app/src/components/chart/builder/BuilderSheet.legacyStoc.test.jsx
//
// ⭐ AUDIT P0-1 (2026-10-30) — a saved TC2000 formula that still runs the
// pre-fix `STOC` reading (close, high, low) says so when it is reopened, and a
// formula on the current reading does not. The real sheet; only `fetch` stubbed.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act, screen } from '@testing-library/react'
import { SWRConfig } from 'swr'
import BuilderSheet, { buildDefinition } from './BuilderSheet'
import { BUILDER_INPUT_SCOPE } from './builderInputs'
import { evaluateFormula, FORMULA_DEBOUNCE_MS } from './FormulaField'
import { AuthContext } from '../../../context/AuthContext'
import { clearUserDefinitions } from '../engine/nativeRegistry'
import { validateDefinition } from '../engine/defSchema'
import { legacyPcfReadings, pcfLegacyNotice } from '../engine/ast/pcf'

const DEF_ID = 'u_5toc0000aa11'
const SOURCE = 'STOC14.3 < 20'

function stubFetch() {
  globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ definitions: [] }) }))
}
const flush = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
}

function storedDoc({ legacy }) {
  const ev = evaluateFormula(SOURCE, BUILDER_INPUT_SCOPE)
  if (!ev.ok) throw new Error(ev.error)
  const ast = legacy ? legacyPcfReadings(SOURCE)[0].ast : ev.ast
  const doc = buildDefinition({
    defId: DEF_ID, name: 'Oversold', version: 1, rev: 1,
    plots: [{ key: 'value', label: '', source: SOURCE, ast, mode: ev.verdict.mode, readback: ev.readback,
      style: 'line', color: '#2962ff', width: 2 }],
    scanPlot: 'value',
  })
  const v = validateDefinition(doc)
  if (!v.ok) throw new Error(`fixture document is invalid: ${v.errors.join('; ')}`)
  return doc
}

function mount(definition) {
  return render(
    <AuthContext.Provider value={{ user: { id: 7 }, isPaid: true, loading: false }}>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
        <BuilderSheet open onClose={() => {}} onSaved={() => {}} settings={null} onChange={() => {}}
          editRow={{ def_id: DEF_ID, version: 1, rev: 1, definition }} />
      </SWRConfig>
    </AuthContext.Provider>,
  )
}

beforeEach(() => { vi.useFakeTimers(); stubFetch(); clearUserDefinitions() })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); delete globalThis.fetch; clearUserDefinitions() })

describe('P0-1 — the legacy STOC reading is disclosed on reopen', () => {
  it('a document stored with the legacy tree validates AND shows the notice', async () => {
    mount(storedDoc({ legacy: true }))
    await act(async () => { vi.advanceTimersByTime(FORMULA_DEBOUNCE_MS) })
    await flush()
    expect(screen.getByTestId('legacy-reading-notice').textContent).toBe(pcfLegacyNotice(SOURCE))
  })

  it('control: a document on the current reading shows no notice', async () => {
    mount(storedDoc({ legacy: false }))
    await act(async () => { vi.advanceTimersByTime(FORMULA_DEBOUNCE_MS) })
    await flush()
    expect(screen.queryByTestId('legacy-reading-notice')).toBeNull()
  })
})

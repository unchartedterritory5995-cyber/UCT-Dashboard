// app/src/components/chart/builder/BuilderSheet.repaintNotice.test.jsx
//
// ─── ⭐ GT (RT4 follow-up, owner ruling 2026-10-02) — THE MEMBER IS TOLD ─────
//
// A formula saved BEFORE the shared clock-table fix (`3a77b89423`) that reads one
// of the nine last-bar clock leaves keeps its stored `non-repainting` label: the
// relint pass reports it (direction B) and never flips it. The store now serves
// the finding beside the row as `repaint_notice`
// (`api/services/user_definition_relint.py::member_notice`, railed server side by
// `tests/test_pine_runtime_switch_on.py`). This file proves the member SEES it,
// by rendered text, when they open that definition — and only then.
//
// ⛔ THE HOOK IS NOT MOCKED: `useUserDefinitions` runs for real against a stubbed
// `fetch`, the way `BuilderSheet.edit.test.jsx` does it.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { SWRConfig } from 'swr'

import BuilderSheet, { buildDefinition } from './BuilderSheet'
import { BUILDER_INPUT_SCOPE } from './builderInputs'
import { evaluateFormula, FORMULA_DEBOUNCE_MS } from './FormulaField'
import { AuthContext } from '../../../context/AuthContext'
import { parseFormula } from '../engine/ast/parse'
import { clearUserDefinitions } from '../engine/nativeRegistry'

const SENTENCE = 'This indicator was saved under an older repaint rule: `value` was saved as '
  + 'non-repainting and measures preview-repaints today. Its saved label is kept as it was, so '
  + 'nothing you armed under it has changed; saving a change to the formula records today\'s label.'

function storedRow({ defId, name, source = 'sma(close, 20)', notice = null }) {
  const parsed = parseFormula(source)
  const evaluated = evaluateFormula(source, BUILDER_INPUT_SCOPE)
  return {
    def_id: defId, version: 1, rev: 1,
    definition: buildDefinition({
      defId, name, source, ast: parsed.ast, mode: evaluated.verdict.mode,
      readback: evaluated.readback, version: 1, rev: 1,
    }),
    repaint_notice: notice,
  }
}

let ROWS = []
beforeEach(() => {
  vi.useFakeTimers()
  clearUserDefinitions()
  global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ definitions: ROWS }) }))
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const flush = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
}

function mount() {
  return render(
    <AuthContext.Provider value={{ user: { id: 7 }, isPaid: true, loading: false }}>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
        <BuilderSheet open onClose={() => {}} onSaved={() => {}} settings={null} onChange={() => {}} />
      </SWRConfig>
    </AuthContext.Provider>,
  )
}

async function clickEdit(name) {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: `Edit ${name}` })) })
  await act(async () => { vi.advanceTimersByTime(FORMULA_DEBOUNCE_MS) })
  await flush()
}

describe('GT — a definition saved under an older repaint rule tells its owner', () => {
  it('⭐ opening it shows the server\'s sentence, verbatim', async () => {
    ROWS = [storedRow({ defId: 'u_0000000000c1', name: 'Last bar line',
      notice: { plots: [{ plot_key: 'value', stored: 'non-repainting', current: 'preview-repaints' }], sentence: SENTENCE } })]
    mount()
    await flush()
    // ⛔ not before it is opened: a new formula carries no notice
    expect(screen.queryByTestId('repaint-label-notice')).toBeNull()
    await clickEdit('Last bar line')
    expect(screen.getByTestId('repaint-label-notice').textContent).toBe(SENTENCE)
  })

  it('⭐ CONTROL — a definition with no notice opens with none', async () => {
    ROWS = [storedRow({ defId: 'u_0000000000c2', name: 'Plain line', notice: null })]
    mount()
    await flush()
    await clickEdit('Plain line')
    expect(screen.queryByTestId('repaint-label-notice')).toBeNull()
  })
})

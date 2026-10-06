// app/src/components/chart/builder/BuilderSheet.converseSuperseded.test.jsx
//
// ─── ⭐ P2 — A CONVERSATIONAL SAVE SUPERSEDES THE SHEET'S OWN FORM ─────────────
//
// ASKED: edit "My line" in the sheet, continue it in the conversation, change the
// length there and save. CLAIMED: the conversation's version is the indicator now.
// BEFORE: the sheet's form still held the OLD formula and its Save stayed live —
// the store has no version check, so one click silently reverted the conversation.
// DID (now): the sheet's Save is disabled and SAYS why until the member reopens.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { SWRConfig } from 'swr'

import BuilderSheet, { buildDefinition } from './BuilderSheet'
import { BUILDER_INPUT_SCOPE } from './builderInputs'
import { evaluateFormula } from './FormulaField'
import { AuthContext } from '../../../context/AuthContext'
import { parseFormula } from '../engine/ast/parse'
import { clearUserDefinitions } from '../engine/nativeRegistry'
import { CONVERSE_ENDPOINT } from './authoring/converseClient'

const DEF_ID = 'u_beef0123cafe'

function storedRow({ source = 'sma(close, 20)', name = 'My line', version = 1, rev = 1 } = {}) {
  const parsed = parseFormula(source)
  const evaluated = evaluateFormula(source, BUILDER_INPUT_SCOPE)
  return {
    def_id: DEF_ID, version, rev,
    definition: buildDefinition({
      defId: DEF_ID, name, source, ast: parsed.ast,
      mode: evaluated.verdict.mode, readback: evaluated.readback, version, rev,
    }),
  }
}

const H = vi.hoisted(() => ({ requests: [], rows: [] }))

function stubFetch() {
  H.requests = []
  H.rows = [storedRow()]
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const method = init.method || 'GET'
    H.requests.push({ url: String(url), method, body: init.body ?? null })
    if (String(url).endsWith(CONVERSE_ENDPOINT)) {
      const body = JSON.parse(init.body)
      const slot = (body.view.definition.outputs[0].slots || []).find((s) => s.value === 20)
      return { ok: true, status: 200, json: async () => ({
        ok: true, turn: 'patch', not_understood: [], unavailable: [],
        envelope: { contract: 'uct.authoring.patch/1', baseRevision: body.view.revision,
          ops: [{ op: 'set_slot', slot: slot.id, value: 50 }], assumptions: [] },
      }) }
    }
    if (method === 'GET') return { ok: true, status: 200, json: async () => ({ definitions: H.rows }) }
    return { ok: true, status: 200, json: async () => ({ def_id: DEF_ID, version: 2, rev: 2, rev_bumped: true, semantics: 2 }) }
  })
}
const flush = async () => { await act(async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve() }) }

beforeEach(() => { stubFetch(); clearUserDefinitions() })
afterEach(() => { cleanup(); vi.restoreAllMocks(); delete globalThis.fetch; clearUserDefinitions() })

describe('P2 — the sheet cannot silently revert a conversational save', () => {
  it('after the conversation saves the definition the sheet is editing, the sheet Save is disabled with a reason', async () => {
    render(
      <AuthContext.Provider value={{ user: { id: 7 }, isPaid: true, loading: false }}>
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
          <BuilderSheet open onClose={() => {}} onSaved={() => {}} settings={{ indicatorInstances: [], indicators: {} }} onChange={() => {}} />
        </SWRConfig>
      </AuthContext.Provider>,
    )
    await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Edit My line' }))
    await flush()
    const sheetSave = () => screen.getAllByRole('button', { name: /^Save changes/ })
      .find((b) => b.getAttribute('data-testid') !== 'converse-save')
    expect(sheetSave().disabled).toBe(false)

    fireEvent.click(screen.getByTestId('converse-open-editing'))
    await flush()
    fireEvent.change(screen.getByLabelText('Change it'), { target: { value: 'make it 50' } })
    fireEvent.click(screen.getByTestId('converse-send'))
    await flush()
    fireEvent.click(screen.getByTestId('converse-save'))
    await flush()

    const writes = H.requests.filter((r) => r.method !== 'GET' && !r.url.endsWith(CONVERSE_ENDPOINT))
    expect(writes).toHaveLength(1)
    expect(JSON.parse(writes[0].body).definition.compute.source).toBe('sma(close, 50)')
    // the sheet's form still says 20 — and it can no longer save it over version 2
    expect(sheetSave().disabled).toBe(true)
    expect(screen.getByText(/The conversation above saved this formula as version 2/)).toBeTruthy()
  })
})

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

import { setCreateIndicatorFlag } from './studio/createIndicatorFlag'
import BuilderSheet, { buildDefinition } from './BuilderSheet'
import { BUILDER_INPUT_SCOPE } from './builderInputs'
import { evaluateFormula } from './FormulaField'
import { AuthContext } from '../../../context/AuthContext'
import { parseFormula } from '../engine/ast/parse'
import { clearUserDefinitions } from '../engine/nativeRegistry'
import { CONVERSE_ENDPOINT } from './authoring/converseClient'
import { _resetSessions } from './authoring/conversationSessions'

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
        ok: true, disposition: 'change', reply: '', turn: 'patch', not_understood: [], unavailable: [],
        envelope: { contract: 'uct.authoring.patch/1', baseRevision: body.view.revision,
          ops: [{ op: 'set_slot', slot: slot.id, value: 50 }], assumptions: [] },
      }) }
    }
    if (method === 'GET') return { ok: true, status: 200, json: async () => ({ definitions: H.rows }) }
    return { ok: true, status: 200, json: async () => ({ def_id: DEF_ID, version: 2, rev: 2, rev_bumped: true, semantics: 2 }) }
  })
}
const flush = async () => { await act(async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve() }) }

beforeEach(() => { stubFetch(); clearUserDefinitions(); _resetSessions() })
afterEach(() => { cleanup(); vi.restoreAllMocks(); delete globalThis.fetch; clearUserDefinitions() })

beforeEach(() => { setCreateIndicatorFlag(true) })
afterEach(() => { setCreateIndicatorFlag(null) })

describe('P2 — the sheet cannot silently revert a conversational save', () => {
  it('after the conversation saves the definition the sheet is editing, the sheet Save is disabled with a reason', async () => {
    render(
      <AuthContext.Provider value={{ user: { id: 7, role: 'admin' }, isPaid: true, loading: false }}>
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
          <BuilderSheet open onClose={() => {}} onSaved={() => {}} settings={{ indicatorInstances: [], indicators: {} }} onChange={() => {}} />
        </SWRConfig>
      </AuthContext.Provider>,
    )
    await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Edit My line' }))
    await flush()
    const sheetSave = () => screen.getByTestId('sheet-save')
    expect(sheetSave().disabled).toBe(false)

    fireEvent.click(screen.getByTestId('converse-open-editing'))
    await flush()
    fireEvent.change(screen.getByLabelText('Change it'), { target: { value: 'make it 50' } })
    fireEvent.click(screen.getByTestId('converse-send'))
    await flush()
    // ⭐ SLICE 2 — exactly ONE "Save changes" on screen, and it is the footer's,
    // committing the conversation (the box has no button of its own).
    expect(screen.getAllByRole('button', { name: /^Save changes/ })).toHaveLength(1)
    expect(screen.queryByTestId('converse-save')).toBeNull()
    fireEvent.click(sheetSave())
    await flush()

    // definition writes only: the rollout funnel's shape-only telemetry (`studio_action`) is not one
    const writes = H.requests.filter((r) => r.method !== 'GET' && !r.url.endsWith(CONVERSE_ENDPOINT)
      && !r.url.includes('/api/indicator-telemetry/'))
    expect(writes).toHaveLength(1)
    expect(JSON.parse(writes[0].body).definition.compute.source).toBe('sma(close, 50)')
    // the sheet's form still says 20 — and it can no longer save it over version 2
    expect(sheetSave().disabled).toBe(true)
    expect(screen.getByText(/The conversation above saved this formula as version 2/)).toBeTruthy()
  })
})

// ─── ⭐ P3S — A CONVERSATIONAL SAVE IS THE SHEET'S CLEAN BASELINE ──────────────
// ASKED (P3R, production): edit a saved formula, continue it in the conversation,
// save, then close. BEFORE: "Discard this formula?" — about a form that had just
// been saved by the conversation and that the sheet cannot save anyway. NOW:
// closes at once; a form changed AFTER that save still asks.
describe('P3S — after the conversation saves, closing does not ask to discard', () => {
  function mount(onClose) {
    render(
      <AuthContext.Provider value={{ user: { id: 7, role: 'admin' }, isPaid: true, loading: false }}>
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
          <BuilderSheet open onClose={onClose} onSaved={() => {}} settings={{ indicatorInstances: [], indicators: {} }} onChange={() => {}} />
        </SWRConfig>
      </AuthContext.Provider>,
    )
  }
  async function editAndConverseSave() {
    await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Edit My line' }))
    await flush()
    fireEvent.click(screen.getByTestId('converse-open-editing'))
    await flush()
    fireEvent.change(screen.getByLabelText('Change it'), { target: { value: 'make it 50' } })
    fireEvent.click(screen.getByTestId('converse-send'))
    await flush()
    fireEvent.click(screen.getByTestId('sheet-save'))
    await flush()
    expect(screen.getByText(/The conversation above saved this formula as version 2/)).toBeTruthy()
  }
  const cancel = () => fireEvent.click(screen.getByRole('button', { name: /^Cancel$/ }))

  it('Cancel closes at once — the save was the baseline', async () => {
    const onClose = vi.fn()
    mount(onClose)
    await editAndConverseSave()
    cancel()
    await flush()
    expect(screen.queryByTestId('discard-confirm')).toBeNull()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('…but a form changed AFTER that save still asks (genuinely unsaved work keeps its guard)', async () => {
    const onClose = vi.fn()
    mount(onClose)
    await editAndConverseSave()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Renamed after the save' } })
    await flush()
    cancel()
    await flush()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByTestId('discard-confirm').textContent).toContain('Discard this formula?')
  })
})

// ─── ⭐ ROLLOUT — OPENING A SAVED FORMULA IS A CLEAN BASELINE ──────────────────
// ASKED: open a saved formula and close it without touching anything. BEFORE: the
// sheet asked "Discard this formula?". NOW: it closes; the first real change asks.
describe('ROLLOUT — reopening a saved formula is not unsaved work', () => {
  function mount(onClose) {
    render(
      <AuthContext.Provider value={{ user: { id: 7, role: 'admin' }, isPaid: true, loading: false }}>
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
          <BuilderSheet open onClose={onClose} onSaved={() => {}} settings={{ indicatorInstances: [], indicators: {} }} onChange={() => {}} />
        </SWRConfig>
      </AuthContext.Provider>,
    )
  }
  const cancel = () => fireEvent.click(screen.getByRole('button', { name: /^Cancel$/ }))
  async function openSaved() {
    await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Edit My line' }))
    await flush()
    expect(screen.getByLabelText('Name').value).toBe('My line')
  }

  it('open → Cancel closes at once', async () => {
    const onClose = vi.fn()
    mount(onClose)
    await openSaved()
    cancel()
    await flush()
    expect(screen.queryByTestId('discard-confirm')).toBeNull()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('open → a real change → Cancel asks', async () => {
    const onClose = vi.fn()
    mount(onClose)
    await openSaved()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'My line, renamed' } })
    await flush()
    cancel()
    await flush()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByTestId('discard-confirm').textContent).toContain('Discard this formula?')
  })

  it('open → change → change back → Cancel closes (the baseline is the opened version)', async () => {
    const onClose = vi.fn()
    mount(onClose)
    await openSaved()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'tmp' } })
    await flush()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'My line' } })
    await flush()
    cancel()
    await flush()
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})


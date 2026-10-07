// app/src/components/chart/builder/ConverseBox.p3ux.test.jsx
//
// ─── ⭐ P3 UX — CONVERSEBOX SAYS WHAT IT CANNOT EDIT, BEFORE THE MEMBER TYPES ──
//
// ASKED open the sheet over a definition the conversation cannot edit (a native,
// an imported graph-bound one) · CLAIMED (before) a "Continue «name» in this
// conversation" button, then the FIRST change failed with
// `authoring:kind` / `authoring:unrepresentable` and a schema path list · DID
// (now) a member-safe note up front, no Continue button, and a turn starts a
// new indicator. Also: a refusal reads as a sentence with the code in a
// secondary "Details for support", and an unsaved conversation guards reload.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act, within } from '@testing-library/react'
import { parseFormula } from '../engine/ast/parse'
import { clearUserDefinitions } from '../engine/nativeRegistry'
import { applyPatch } from './authoring'

vi.mock('./editor/PreviewPane', () => ({ default: () => null }))

import ConverseBox from './ConverseBox'

const P = (src) => parseFormula(src).ast
const C = 'uct.authoring.patch/1'
const plain = () => applyPatch(null, { contract: C, baseRevision: 0, ops: [{ op: 'create', name: 'x', outputs: [{ tree: P('close > open') }] }] }).definition

function stub(make) {
  return vi.fn(async ({ state }) => {
    const envelope = make(state)
    return { ok: true, disposition: 'change', reply: '', turn: 'patch', envelope, notUnderstood: [], unavailable: [] }
  })
}
const createTurn = (s) => ({ contract: C, baseRevision: s.revision, ops: [{ op: 'create', name: 'n', outputs: [{ tree: P('close > open') }] }], assumptions: [] })
const flush = async () => { await act(async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve() }) }
async function say(text) {
  fireEvent.change(screen.getByLabelText(/Describe the indicator|Change it/), { target: { value: text } })
  fireEvent.click(screen.getByTestId('converse-send'))
  await flush()
}

beforeEach(() => { clearUserDefinitions() })
afterEach(() => { cleanup(); clearUserDefinitions() })

describe('P3 UX — the up-front kind check', () => {
  it('a NATIVE definition: a member-safe note, no Continue button; a turn starts a NEW indicator (REFUSAL, said first)', async () => {
    const prior = { id: 'u_nnnnnnnnnnnn', version: 2, meta: { name: 'My RSI' }, compute: { kind: 'native', fn: 'rsi' }, plots: [{ key: 'rsi' }] }
    render(<ConverseBox sym="SPY" tf="D" converse={stub(createTurn)} editing={{ defId: prior.id, version: 2, prior }} />)
    const note = screen.getByTestId('converse-not-editable')
    expect(note.textContent).toBe('This indicator is built in a form UCT Intelligence cannot edit yet. You can still edit it manually. Anything you describe here starts a new indicator.')
    expect(note.dataset.code).toBe('authoring:kind')
    expect(screen.queryByTestId('converse-open-editing')).toBeNull()
    await say('anything')
    expect(screen.getByTestId('converse-identity').dataset.defId).toBe('') // a new indicator, not the native
  })

  it('an IMPORTED definition the Builder cannot reproduce: "imported in a form …" with no schema paths (REFUSAL)', () => {
    const d = plain()
    // ⭐ PHASE 4 — a carried presentation field (legend decimals) no longer refuses;
    // an imported MATHS stage the row model cannot hold still does.
    const prior = { ...d, id: 'u_iiiiiiiiiiii', version: 1, meta: { ...d.meta, recurrenceOrigin: 'pine' },
      compute: { ...d.compute, importedStage: { kind: 'foreign' } } }
    render(<ConverseBox sym="SPY" tf="D" converse={stub(createTurn)} editing={{ defId: prior.id, version: 1, prior }} />)
    const note = screen.getByTestId('converse-not-editable')
    expect(note.textContent).toMatch(/^This indicator was imported in a form UCT Intelligence cannot edit yet\. You can still edit it manually\./)
    expect(note.textContent).not.toMatch(/plots\[|compute|importedStage|authoring:/)
  })

  it('an editable definition keeps the Continue button and shows no note (EXACT)', () => {
    const d = plain()
    const prior = { ...d, id: 'u_eeeeeeeeeeee', version: 1 }
    render(<ConverseBox sym="SPY" tf="D" converse={stub(createTurn)} editing={{ defId: prior.id, version: 1, prior }} />)
    expect(screen.queryByTestId('converse-not-editable')).toBeNull()
    expect(screen.getByTestId('converse-open-editing')).toBeTruthy()
  })
})

describe('P3 UX — refusals and unsaved work', () => {
  it('a model fault reads as a sentence; the code lives in "Details for support" (CONTROLLED ERROR)', async () => {
    let n = 0
    const converse = stub((s) => (n++ === 0 ? createTurn(s)
      : { contract: C, baseRevision: s.revision, ops: [{ op: 'set_slot', slot: 'nope#9', value: 3 }], assumptions: [] }))
    render(<ConverseBox sym="SPY" tf="D" converse={converse} />)
    await say('make one')
    await say('break it')
    const entries = [...screen.getByTestId('converse-transcript').children]
    const refusal = entries.filter((e) => e.dataset.kind === 'refusal').pop()
    const lines = [...refusal.querySelectorAll('li')].map((li) => li.textContent)
    expect(lines[0]).toBe('Nothing was changed.')
    expect(lines[1]).toMatch(/^Change 1 \(change a number\): UCT Intelligence proposed a change that does not fit this indicator/)
    expect(lines.join(' ')).not.toMatch(/nope|output:unknown|\[/)
    expect(within(refusal).getByTestId('converse-error-detail').textContent).toMatch(/output:unknown: .*nope/)
  })

  it('reload with an unsaved conversation asks first; a clean one does not (beforeunload)', async () => {
    render(<ConverseBox sym="SPY" tf="D" converse={stub(createTurn)} />)
    const clean = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(clean)
    expect(clean.defaultPrevented).toBe(false)
    await say('make one')
    const dirty = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(dirty)
    expect(dirty.defaultPrevented).toBe(true)
  })
})

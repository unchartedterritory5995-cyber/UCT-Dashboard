// SLICE 2 — the sheet's conversation: answers never dirty it, each definition
// keeps its own conversation, the host footer owns the one save, and a short
// label is a display, never the stored name. ASKED / CLAIMED / DID per case.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { parseFormula } from '../engine/ast/parse'
import { clearUserDefinitions } from '../engine/nativeRegistry'
import { _resetSessions, readSession, editKey, newKey } from './authoring/conversationSessions'
import { chipName, isChipCut, untruncatedLabel } from '../engine/labelText'

const H = vi.hoisted(() => ({ saves: [] }))
vi.mock('../../../hooks/useUserDefinitions', async (orig) => ({
  ...(await orig()),
  saveUserDefinition: vi.fn(async (doc, defId) => {
    H.saves.push({ doc, defId })
    return { ok: true, row: { def_id: defId || 'u_aaaaaaaaaaaa', version: defId ? doc.version : 1, rev: 1, semantics: 2 } }
  }),
}))

import ConverseBox from './ConverseBox'

const C = 'uct.authoring.patch/1'
function stub() {
  return vi.fn(async ({ message, state }) => {
    if (/^what|\?$/i.test(message)) {
      return { ok: true, disposition: 'answer', reply: 'It is a 14-bar RSI threshold.', turn: 'noop',
        envelope: { contract: C, baseRevision: state.revision, ops: [] }, notUnderstood: [], unavailable: [] }
    }
    return { ok: true, disposition: 'change', reply: '', turn: 'patch', notUnderstood: [], unavailable: [],
      envelope: { contract: C, baseRevision: state.revision,
        ops: [{ op: 'create', name: 'RSI overbought', outputs: [{ tree: parseFormula('rsi(close, 14) > 70').ast }] }] } }
  })
}
const flush = async () => { await act(async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve() }) }
async function send(text) {
  fireEvent.change(screen.getByLabelText(/Describe the indicator|Change it/), { target: { value: text } })
  fireEvent.click(screen.getByTestId('converse-send'))
  await flush()
}
const identity = () => screen.getByTestId('converse-identity')

beforeEach(() => { H.saves.length = 0; _resetSessions(); clearUserDefinitions() })
afterEach(() => { cleanup(); clearUserDefinitions() })

describe('answers never dirty; changes do', () => {
  it('a question is answered, the identity stays "none", and nothing says it changed', async () => {
    render(<ConverseBox converse={stub()} sessionKey={newKey('s1')} />)
    await send('What would this do?')
    expect(identity().dataset.saved).toBe('none')
    expect(screen.getByTestId('converse-transcript').textContent).toMatch(/14-bar RSI threshold/)
    expect(screen.getByTestId('converse-transcript').textContent).not.toMatch(/Updated preview/)
    await send('RSI overbought')
    expect(identity().dataset.saved).toBe('unsaved')
    expect(screen.getByTestId('converse-transcript').textContent).toMatch(/Updated preview/)
  })

  it('HOSTED: the footer is told dirty only after a real change, and the box shows no save of its own', async () => {
    const states = []
    const commitRef = { current: null }
    render(<ConverseBox converse={stub()} sessionKey={newKey('s2')} onCommitState={(s) => states.push(s)} commitRef={commitRef} />)
    await send('What would this do?')
    expect(states.at(-1)).toMatchObject({ dirty: false, canSave: false })
    await send('RSI overbought')
    expect(states.at(-1)).toMatchObject({ dirty: true, canSave: true, label: 'Save and add to chart' })
    expect(screen.queryByTestId('converse-save')).toBeNull()
    await act(async () => { await commitRef.current.save() })
    await flush()
    expect(H.saves).toHaveLength(1)                                  // exactly one persistence op
    expect(states.at(-1)).toMatchObject({ dirty: false, canSave: false, label: 'Save changes' })
    // saving again is impossible: nothing is dirty
    expect(states.at(-1).canSave).toBe(false)
  })
})

describe('each authoring context keeps its own conversation (in memory)', () => {
  it('reopening edit:A restores A; edit:B never shows A', async () => {
    const a = render(<ConverseBox converse={stub()} sessionKey={editKey('u_aaaaaaaaaaaa')} />)
    await send('What would this do?')
    a.unmount()
    render(<ConverseBox converse={stub()} sessionKey={editKey('u_bbbbbbbbbbbb')} />)
    expect(screen.getByTestId('converse-transcript').children.length).toBe(0)
    cleanup()
    render(<ConverseBox converse={stub()} sessionKey={editKey('u_aaaaaaaaaaaa')} />)
    expect(screen.getByTestId('converse-transcript').textContent).toMatch(/14-bar RSI threshold/)
  })

  it('a NEW definition saved from the sheet moves to its own edit context; "New formula" starts clean', async () => {
    const commitRef = { current: null }
    render(<ConverseBox converse={stub()} sessionKey={newKey('s3')} onCommitState={() => {}} commitRef={commitRef} />)
    await send('RSI overbought')
    await act(async () => { await commitRef.current.save() })
    await flush()
    expect(readSession(newKey('s3'))).toBeNull()
    expect(readSession(editKey('u_aaaaaaaaaaaa'))).toBeTruthy()
  })
})

describe('labels — the stored name is whole; a short label is a display', () => {
  it('the chip cut is still produced for the narrow chip, and recognised for what it is', () => {
    expect(chipName('Volume above its 50-day average')).toBe('Volume')
    expect(isChipCut('Volume above its 50-day average', 'Volume')).toBe(true)
    expect(isChipCut('RSI 14 > 70', 'RSI 14 > 70')).toBe(false)            // short names are never "cut"
    expect(isChipCut('Volume above its 50-day average', 'Vol')).toBe(false) // a typed label is the member's
  })
  it('the legend shows the WHOLE stored name where the stored short label is only the cut', () => {
    const def = { id: 'u_x', meta: { name: 'Volume above its 50-day average', shortName: 'Volume' } }
    expect(untruncatedLabel(def, 'Volume')).toBe('Volume above its 50-day average')
    expect(untruncatedLabel({ id: 'rsi', meta: { name: 'Relative Strength Index', shortName: 'RSI' } }, 'RSI')).toBe('RSI')
  })
})

describe('an answer turn on a stored definition with an object program changes NOTHING', () => {
  it('open → ask → still clean (the dirty check is a canonical byte comparison of what save writes)', async () => {
    const { applyTurn, newAuthoringState } = await import('./authoring')
    const made = applyTurn(newAuthoringState(), { contract: C, baseRevision: 0, ops: [{ op: 'create', name: 'RSI overbought',
      outputs: [{ tree: parseFormula('rsi(close, 14) > 70').ast }] }] }).state.working
    const prior = { ...made, id: 'u_objobjobjobj', version: 4, objects: { programVersion: 1, regs: [], colls: [], trees: [{ type: 'op', name: '>', args: [{ type: 'call', name: 'rsi', args: [{ type: 'series', name: 'close' }, { type: 'num', value: 14 }] }, { type: 'num', value: 70 }] }], ops: [{ k: 'create', family: 'label', site: 's1', into: null, when: { v: 'tree', tree: 0 }, props: { x: { v: 'bar' }, y: { v: 'const', value: 1 } } }] },
      meta: { ...made.meta, pine: { dialect: 'pine', stamp: 'v5:abc' } } }
    const states = []
    render(<ConverseBox converse={stub()} sessionKey={editKey(prior.id)} editing={{ defId: prior.id, version: 4, prior }}
      onCommitState={(st) => states.push(st)} commitRef={{ current: null }} />)
    fireEvent.click(screen.getByTestId('converse-open-editing'))
    await flush()
    const rev = identity().dataset.revision
    expect(identity().dataset.saved).toBe('saved')
    await send('What would this do?')
    expect(identity().dataset.revision).toBe(rev)
    expect(identity().dataset.saved).toBe('saved')
    expect(states.at(-1)).toMatchObject({ dirty: false })
    expect(H.saves).toHaveLength(0)
  })
})

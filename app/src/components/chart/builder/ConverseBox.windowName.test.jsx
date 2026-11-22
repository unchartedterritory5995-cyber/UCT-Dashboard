// The New formula window: whose name does a described indicator get, and is the name in the window's
// own field the one that is saved?
//
// Seen on production on 2026-11-17, in the owner's browser: an indicator described as "shade green while
// the 10 EMA is above the 21 ..." reached the chart called "EMA 10 · EMA 21 +2", the window's name field
// still said "Name it", and a name typed there was not what a save from the conversation stored.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { parseFormula } from '../engine/ast/parse'
import { clearUserDefinitions } from '../engine/nativeRegistry'
import { _resetSessions, newKey } from './authoring/conversationSessions'
import BUILDER_SRC from './BuilderSheet.jsx?raw'

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
const SPREAD = '(ema(close, 10) - ema(close, 21)) / sma(close, 200) * 100'      // its derived name is a formula
const stub = (name, formula) => vi.fn(async ({ state }) => ({
  ok: true, disposition: 'change', reply: '', turn: 'patch', notUnderstood: [], unavailable: [],
  envelope: { contract: C, baseRevision: state.revision,
    ops: [{ op: 'create', name, outputs: [{ key: 'value', tree: parseFormula(formula).ast }] }] },
}))
const flush = async () => { await act(async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve() }) }
async function send(text) {
  fireEvent.change(screen.getByLabelText(/^Describe it$|^Change it$/), { target: { value: text } })
  fireEvent.click(screen.getByTestId('converse-send'))
  await flush()
}
function hosted(converse, key) {
  const states = []
  const commitRef = { current: null }
  render(<ConverseBox converse={converse} sessionKey={newKey(key)} onCommitState={(s) => states.push(s)} commitRef={commitRef} />)
  return { states, commitRef }
}
const savedName = () => H.saves.at(-1).doc.meta.name

beforeEach(() => { H.saves.length = 0; _resetSessions(); clearUserDefinitions() })
afterEach(() => { cleanup(); clearUserDefinitions() })

describe('whose name', () => {
  it('a formula-like derived name gives way to the assistant’s, and the host is told it', async () => {
    const { states, commitRef } = hosted(stub('Trend Spread', SPREAD), 'n1')
    await send('the spread between the 10 and 21 EMA as a percent of the 200 day')
    expect(states.at(-1)).toMatchObject({ dirty: true, name: 'Trend Spread' })
    await act(async () => { await commitRef.current.save() })
    await flush()
    expect(savedName()).toBe('Trend Spread')
  })

  it('CONTROL: a readable derived name stays ("RSI 14 above 70" is not replaced by "RSI overbought")', async () => {
    const { states } = hosted(stub('RSI overbought', 'rsi(close, 14) > 70'), 'n2')
    await send('RSI overbought')
    expect(states.at(-1).name).toBe('RSI 14 above 70')
  })
})

describe('the name in the window’s field is the name saved', () => {
  it('a name the member typed there is stored, in the same save', async () => {
    const { commitRef } = hosted(stub('Trend Spread', SPREAD), 'n3')
    await send('the spread between the 10 and 21 EMA')
    await act(async () => { await commitRef.current.save('  My   Trend Thing ') })
    await flush()
    expect(H.saves).toHaveLength(1)
    expect(savedName()).toBe('My Trend Thing')
  })

  it('an unchanged or empty field, or a click event in its place, changes nothing', async () => {
    for (const [key, arg] of [['n4', 'Trend Spread'], ['n5', ''], ['n6', { type: 'click' }], ['n7', undefined]]) {
      H.saves.length = 0
      const { commitRef } = hosted(stub('Trend Spread', SPREAD), key)
      await send('the spread between the 10 and 21 EMA')
      await act(async () => { await commitRef.current.save(arg) })
      await flush()
      expect(savedName(), JSON.stringify(arg)).toBe('Trend Spread')
      cleanup(); _resetSessions(); clearUserDefinitions()
    }
  })
})

describe('the window wires both (source rails; comments stripped first)', () => {
  const code = BUILDER_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  it('the conversation’s save is handed the name field', () => {
    expect(code).toMatch(/converseCommitRef\.current\?\.save\(name\)/)
    expect(code).not.toMatch(/converseCommitRef\.current\?\.save\(\)/)
  })
  it('the name field follows the conversation’s name until the member types their own', () => {
    expect(code).toMatch(/if \(cur && cur !== autoNameRef\.current\) return cur/)
    expect(code).toMatch(/\}, \[converseName\]\)/)
  })
})

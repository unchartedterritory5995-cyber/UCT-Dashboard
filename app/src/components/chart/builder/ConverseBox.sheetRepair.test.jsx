// app/src/components/chart/builder/ConverseBox.sheetRepair.test.jsx
//
// ─── THE SHEET SENDS ITS ENGINE'S REFUSAL BACK FOR ONE REPAIR ─────────────────
//
// The dock has done this since 2026-11-17 (`authoringSession.modelTurn`, `browserRepair.test.js`).
// The Create Indicator sheet applies the door's patch itself (`applyEnvelope`) and did not: a
// change the door accepted and this engine refused went straight to "Nothing was changed".
// Measured live on 2026-11-18 (the overnight re-checks through the window): a squeeze with dots on
// the zero line was built by the assistant and refused here, with no second try.
//
// The converse client is stubbed; the engine, the read-back and the box are real.
//
// Each case: ASKED / CLAIMED / DID.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { parseFormula } from '../engine/ast/parse'
import { clearUserDefinitions } from '../engine/nativeRegistry'

vi.mock('../../../hooks/useUserDefinitions', async (orig) => ({
  ...(await orig()),
  saveUserDefinition: vi.fn(async (doc, defId) => ({ ok: true, row: { def_id: defId || 'u_aaaaaaaaaaaa', version: 1, rev: 1, semantics: 2 } })),
}))
vi.mock('../../../hooks/useIndicatorAlerts', async (orig) => ({
  ...(await orig()),
  createIndicatorAlert: vi.fn(async () => ({ ok: true, id: 41 })),
}))
vi.mock('./editor/PreviewPane', () => ({
  default: (p) => (p.definition && p.sym && p.tf ? <div data-testid="converse-preview" /> : null),
}))

import ConverseBox from './ConverseBox'

const P = (src) => {
  const r = parseFormula(src)
  if (!r.ok) throw new Error(src)
  return r.ast
}
const C = 'uct.authoring.patch/1'
const env = (state, ops) => ({ contract: C, baseRevision: state.revision, ops, assumptions: [] })
const change = (envelope) => ({ ok: true, disposition: 'change', reply: '', turn: 'patch', envelope, notUnderstood: [], unavailable: [] })

/** What the door offers first: a create this engine accepts, then an alert on an output that is
 *  not there, which this engine refuses. The whole patch is refused (a turn is atomic). */
const BAD = (s) => env(s, [{ op: 'create', name: 'RSI overbought', outputs: [{ tree: P('rsi(close, 14) > 70') }] },
  { op: 'request_alert', output: 'missing', triggerPolicy: 'becomes_true' }])
/** What it offers once told why. */
const GOOD = (s) => env(s, [{ op: 'create', name: 'RSI overbought', outputs: [{ tree: P('rsi(close, 14) > 70') }] }])

function door(answers) {
  const calls = []
  const fn = vi.fn(async (args) => {
    calls.push(args)
    const next = answers[calls.length - 1]
    if (!next) throw new Error(`the door was asked a ${calls.length}th time`)
    return typeof next === 'function' ? next(args.state) : next
  })
  fn.calls = calls
  return fn
}

const flush = async () => { await act(async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve() }) }
async function say(text) {
  fireEvent.change(screen.getByLabelText(/^Describe it$|^Change it$/), { target: { value: text } })
  fireEvent.click(screen.getByTestId('converse-send'))
  await flush()
}
const entries = () => [...screen.getByTestId('converse-transcript').children]
const lastUct = () => entries().filter((e) => e.dataset.role === 'uct').pop()
const linesOf = (el) => [...el.querySelectorAll('li')].map((li) => li.textContent)
const SETTINGS = Object.freeze({ indicatorInstances: [], indicators: {} })
const mount = (converse) => render(<ConverseBox settings={SETTINGS} onChange={vi.fn()} sym="SPY" tf="D" converse={converse} />)

beforeEach(() => { clearUserDefinitions(); vi.clearAllMocks() })
afterEach(() => { cleanup(); clearUserDefinitions() })

describe('ConverseBox — one repair after this engine refuses a change the door offered', () => {
  it('ASKED a request whose first patch this engine refuses · CLAIMED one repair with this engine\'s own words · DID build the second', async () => {
    const converse = door([(s) => change(BAD(s)), (s) => change(GOOD(s))])
    mount(converse)
    await say('RSI overbought with an alert')
    expect(converse.calls).toHaveLength(2)
    // the first call is the plain request; the second carries the refused patch and why
    expect(converse.calls[0].browserRefusal).toBeUndefined()
    const sent = converse.calls[1].browserRefusal
    expect(sent.envelope.ops.map((o) => o.op)).toEqual(['create', 'request_alert'])
    expect(sent.errors.length).toBeGreaterThan(0)
    expect(sent.errors.every((e) => typeof e === 'string' && e.length > 0)).toBe(true)
    // the same request, the same state it was built from
    expect(converse.calls[1].message).toBe('RSI overbought with an alert')
    expect(converse.calls[1].state).toBe(converse.calls[0].state)
    // the member reads the RESULT, never "Nothing was changed"
    const lines = linesOf(lastUct())
    expect(lines[0]).toBe('Updated preview.')
    expect(lines.join(' ')).not.toMatch(/Nothing was changed/)
    expect(screen.getByTestId('converse-preview')).toBeTruthy()
    expect(screen.queryByText(/Apply just the valid part/)).toBeNull()
  })

  it('a patch this engine accepts is ONE call: no repair is asked for', async () => {
    const converse = door([(s) => change(GOOD(s))])
    mount(converse)
    await say('RSI overbought')
    expect(converse.calls).toHaveLength(1)
    expect(linesOf(lastUct())[0]).toBe('Updated preview.')
  })

  it('a repair that is refused again is the end: two calls, never a third, and the member reads this engine\'s words', async () => {
    const converse = door([(s) => change(BAD(s)), (s) => change(BAD(s))])
    mount(converse)
    await say('RSI overbought with an alert')
    expect(converse.calls).toHaveLength(2)
    const lines = linesOf(lastUct())
    expect(lines[0]).toBe('Nothing was changed.')
    expect(screen.queryByTestId('converse-preview')).toBeNull()
  })

  it('the door\'s own refusal of the repair says nothing about the request: the member reads this engine\'s refusal', async () => {
    const refusal = { ok: false, gate: 'cost:user', reason: 'You have used today\'s allowance.', notUnderstood: [], unavailable: [] }
    const converse = door([(s) => change(BAD(s)), refusal])
    mount(converse)
    await say('RSI overbought with an alert')
    expect(converse.calls).toHaveLength(2)
    const lines = linesOf(lastUct())
    expect(lines[0]).toBe('Nothing was changed.')
    expect(lines.join(' ')).not.toMatch(/allowance/)
    // and what could be applied on its own is still offered, as before
    expect(screen.getByText(/Apply just the valid part/)).toBeTruthy()
  })

  it('a repair turn that says it cannot is what the member reads', async () => {
    const cannot = { ok: true, disposition: 'unsupported', reply: 'An alert needs a yes/no line to watch.', turn: 'noop',
      envelope: null, notUnderstood: [], unavailable: [] }
    const converse = door([(s) => change(BAD(s)), cannot])
    mount(converse)
    await say('RSI overbought with an alert')
    expect(converse.calls).toHaveLength(2)
    expect(linesOf(lastUct()).join(' ')).toMatch(/An alert needs a yes\/no line to watch\./)
  })

  it('a turn that is not a change is never repaired', async () => {
    const answer = { ok: true, disposition: 'answer', reply: 'RSI measures the speed of price changes.', turn: 'noop',
      envelope: null, notUnderstood: [], unavailable: [] }
    const converse = door([answer])
    mount(converse)
    await say('What is RSI?')
    expect(converse.calls).toHaveLength(1)
  })
})

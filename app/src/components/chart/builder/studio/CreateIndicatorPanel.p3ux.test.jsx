// P3 UX — the studio dock reads in member words: the card's formula line is the
// member-voiced readback phrase, a refused patch is a sentence with the code in
// "Details for support", and an unsaved draft guards a reload (the dock's ✕ keeps
// it in this tab only). ASKED / CLAIMED / DID per case.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act, within } from '@testing-library/react'
import * as registry from '../../engine/nativeRegistry'
import { mergeChartSettings } from '../../chartDefaults'
import { parseFormula } from '../../engine/ast/parse'
import { _resetSessions, createKey } from '../authoring/conversationSessions'

vi.mock('../../../../hooks/useUserDefinitions', async (orig) => ({
  ...(await orig()),
  saveUserDefinition: vi.fn(async () => ({ ok: true, row: { def_id: 'u_aaaaaaaaaaaa', version: 1, rev: 1, semantics: 2 } })),
}))

import CreateIndicatorPanel from './CreateIndicatorPanel'

const C = 'uct.authoring.patch/1'
const P = (s) => parseFormula(s).ast
function converse() {
  let n = 0
  return vi.fn(async ({ state }) => {
    const ops = n++ === 0
      ? [{ op: 'create', name: 'x', outputs: [{ tree: P('rsi(close, 14) > 70') }] }]
      : [{ op: 'set_slot', slot: 'nope#9', value: 3 }]
    return { ok: true, disposition: 'change', reply: '', turn: 'patch', notUnderstood: [], unavailable: [],
      envelope: { contract: C, baseRevision: state.revision, ops,
        assumptions: n === 1 ? [{ slot: 'value#0.1', text: 'standard RSI length' }] : [] } }
  })
}
function mount() {
  return render(
    <CreateIndicatorPanel settings={mergeChartSettings({})} onChange={() => {}} sym="AAPL" tf="D"
      onPreview={() => {}} onClose={vi.fn()} converse={converse()} sessionKey={createKey('s_p3ux')} />,
  )
}
async function say(text) {
  fireEvent.change(screen.getByTestId('create-indicator-input'), { target: { value: text } })
  await act(async () => { fireEvent.click(screen.getByTestId('create-indicator-send')) })
  await act(async () => {})
}
const lastUct = () => [...document.querySelectorAll('[data-role="uct"]')].at(-1)

beforeEach(() => { _resetSessions() })
afterEach(() => { cleanup(); registry.clearUserDefinitions() })

describe('P3 UX — studio dock voice', () => {
  it('ASKED "RSI overbought" · CLAIMED (before) "1 when (…) is greater than 70 and 0 otherwise" · DID "true when the 14-bar RSI of close is above 70" on the card and in the reply', async () => {
    mount()
    await say('RSI overbought')
    const card = screen.getByTestId('create-indicator-readback')
    expect(card.textContent).toContain('true when the 14-bar RSI of close is above 70')
    expect(card.textContent).not.toMatch(/0 otherwise/)
    expect(lastUct().textContent).toContain('RSI 14 > 70 — true when the 14-bar RSI of close is above 70')
    expect(lastUct().textContent).toContain('Using RSI period 14.')
  })

  it('a refused patch is a member sentence; the engine code is behind "Details for support" (CONTROLLED ERROR)', async () => {
    mount()
    await say('RSI overbought')
    await say('break it')
    const r = lastUct()
    expect(r.dataset.kind).toBe('refusal')
    expect(r.textContent).toMatch(/UCT Intelligence proposed a change that does not fit this indicator/)
    const detail = within(r).getByTestId('create-indicator-error-detail')
    expect(detail.textContent).toMatch(/output:unknown: /)
    // the headline itself carries no code and no slot id
    const lead = [...r.querySelectorAll('span')].map((s) => s.textContent).join(' ')
    expect(lead).not.toMatch(/output:unknown|nope/)
  })

  it('an unsaved draft guards a reload; an empty dock does not (beforeunload)', async () => {
    mount()
    const clean = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(clean)
    expect(clean.defaultPrevented).toBe(false)
    await say('RSI overbought')
    const dirty = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(dirty)
    expect(dirty.defaultPrevented).toBe(true)
  })
})

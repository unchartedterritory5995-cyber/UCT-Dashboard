// THE DOCK SHOWS THE NOTES AN ANSWER CARRIES (2026-11-21).
//
// THE GAP, found by reading a live round against the dock: an assumption written as a sentence was printed
// by `readback().lines` only, which the "Describe it" box shows and the dock does not. The dock's reply
// printed what was assumed about a SETTING as its value ("Using period 500.") and nothing else. So the door's
// own notes about a build (a running value "recomputed from N bars back"), the assistant's stated assumptions,
// and the sentence that says what an assumed setting MEANS reached no member in the dock.
//
// Now an applied entry carries `notes: { uct, assumed }` and the dock shows each under its own label: what
// UCT itself says about the build, above the assistant's paragraph; what the assistant assumed, below it.
// Two voices, never mixed. ⛔ Not added to `readback().lines` (an Agent approval is sealed on those).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import * as registry from '../../engine/nativeRegistry'
import { mergeChartSettings } from '../../chartDefaults'
import { parseFormula } from '../../engine/ast/parse'
import { _resetSessions, createKey } from '../authoring/conversationSessions'
import { notesOf } from '../authoring/authoringSession'
import { newAuthoringState, applyTurn, readback } from '../authoring/index'
import { NOTE_BY_UCT } from '../authoring/applyPatch'

vi.mock('../../../../hooks/useUserDefinitions', async (orig) => ({
  ...(await orig()),
  saveUserDefinition: vi.fn(async () => ({ ok: true, row: { def_id: 'u_aaaaaaaaaaaa', version: 1, rev: 1, semantics: 2 } })),
}))

import CreateIndicatorPanel from './CreateIndicatorPanel'

const C = 'uct.authoring.patch/1'
const P = (s) => parseFormula(s).ast
// the shapes of the notes the round carried: the door's own, the assistant's, and one about a setting
const UCT_NOTE = 'This value is recomputed from 960 bars back on every bar, so its counts and levels restart 960 bars back. A chart computed from the symbol\'s first bar can differ.'
const ASSUMED = 'The prior year\'s last close is the most recent close before the first day of this year.'
const MEANS = 'The count stops at 500: where the close has not crossed above its average that recently the line reads 500.'
const SAID = 'I built a line counting the bars since the close last crossed above its 50-bar average.'

const BUILD = [{ op: 'create', name: 'Bars since cross', outputs: [{ key: 'since', tree: P('barssince(close > sma(close, 50), 500)') }] }]
const NOTES = [
  { output: 'since', text: UCT_NOTE, by: NOTE_BY_UCT },
  { text: ASSUMED },
  { slot: 'since#1', text: MEANS },
]

let lastConverse = null
const converseCalls = () => (lastConverse ? lastConverse.mock.calls.length : 0)
function converse(turns) {
  let n = 0
  lastConverse = vi.fn(async ({ state }) => {
    const t = turns[Math.min(n++, turns.length - 1)]
    return { ok: true, disposition: 'change', reply: t.reply ?? SAID, turn: 'patch', notUnderstood: [], unavailable: [],
      envelope: { contract: C, baseRevision: state.revision, ops: t.ops, assumptions: t.assumptions } }
  })
  return lastConverse
}
function mount(turns) {
  return render(
    <CreateIndicatorPanel settings={mergeChartSettings({})} onChange={() => {}} sym="AAPL" tf="D"
      onPreview={() => {}} onClose={vi.fn()} converse={converse(turns)} sessionKey={createKey('s_notes')} />,
  )
}
async function say(text) {
  fireEvent.change(screen.getByTestId('create-indicator-input'), { target: { value: text } })
  await act(async () => { fireEvent.click(screen.getByTestId('create-indicator-send')) })
  await act(async () => {})
}
const lastUct = () => [...document.querySelectorAll('[data-role="uct"]')].at(-1)
const within = (el, id) => el.querySelector(`[data-testid="${id}"]`)

beforeEach(() => { _resetSessions() })
afterEach(() => { cleanup(); registry.clearUserDefinitions() })

describe('the dock shows the notes an answer carries', () => {
  it('UCT\'s own note, the assistant\'s assumption and what an assumed setting means are all in the answer, each under its own label', async () => {
    mount([{ ops: BUILD, assumptions: NOTES }])
    await say('bars since the close crossed above its 50 day average')
    const entry = lastUct()
    const uct = within(entry, 'create-indicator-notes-uct')
    const assumed = within(entry, 'create-indicator-notes-assumed')
    expect(uct).not.toBeNull()
    expect(assumed).not.toBeNull()
    // the door's own note, as it stands, under UCT's label and NOT under the assistant's
    expect(uct.textContent).toContain("UCT's notes on this build")
    expect(uct.textContent).toContain(UCT_NOTE)
    expect(assumed.textContent).not.toContain(UCT_NOTE)
    // the assistant's two, under the assistant's label and NOT under UCT's
    expect(assumed.textContent).toContain('What the assistant assumed')
    expect(assumed.textContent).toContain(ASSUMED)
    expect(assumed.textContent).toContain(MEANS)
    expect(uct.textContent).not.toContain(ASSUMED)
    expect(uct.textContent).not.toContain(MEANS)
    // the setting's VALUE is still said the way it always was
    expect(entry.textContent).toMatch(/Using .*500\./)
  })

  it('ORDER: the engine\'s lines, then UCT\'s notes, then the assistant\'s paragraph, then what the assistant assumed', async () => {
    mount([{ ops: BUILD, assumptions: NOTES }])
    await say('bars since the close crossed above its 50 day average')
    const text = lastUct().textContent
    const at = (s) => text.indexOf(s)
    expect(at('Built 1 ')).toBeGreaterThanOrEqual(0)
    expect(at('Built 1 ')).toBeLessThan(at("UCT's notes on this build"))
    expect(at("UCT's notes on this build")).toBeLessThan(at('What the assistant says it built'))
    expect(at('What the assistant says it built')).toBeLessThan(at('What the assistant assumed'))
  })

  it('CONTROL: an answer with no such note shows neither block', async () => {
    mount([{ ops: [{ op: 'create', name: 'x', outputs: [{ tree: P('sma(close, 50)') }] }], assumptions: [] }])
    await say('a 50 day average')
    const entry = lastUct()
    expect(within(entry, 'create-indicator-notes-uct')).toBeNull()
    expect(within(entry, 'create-indicator-notes-assumed')).toBeNull()
    expect(entry.textContent).not.toContain("UCT's notes on this build")
    expect(entry.textContent).not.toContain('What the assistant assumed')
  })

  it('CONTROL: only one voice spoke, so only its block is shown', async () => {
    mount([{ ops: BUILD, assumptions: [{ output: 'since', text: UCT_NOTE, by: NOTE_BY_UCT }] }])
    await say('bars since the cross')
    const entry = lastUct()
    expect(within(entry, 'create-indicator-notes-uct').textContent).toContain(UCT_NOTE)
    expect(within(entry, 'create-indicator-notes-assumed')).toBeNull()
  })

  it('an entry carries THIS turn\'s notes only: a later change does not repeat the first build\'s', async () => {
    mount([
      { ops: BUILD, assumptions: NOTES },
      // ⛔ a MODEL change (a rename typed by the member is answered without the model, on another path, and
      // would pass this test whatever `notesOf` did: a deliberate break found that)
      { ops: [{ op: 'set_slot', slot: 'since#1', value: 250 }], assumptions: [], reply: 'It now looks back 250 bars.' },
    ])
    await say('bars since the close crossed above its 50 day average')
    await say('please have it look back half as far as it does now')
    const entries = [...document.querySelectorAll('[data-role="uct"]')]
    expect(entries.length).toBe(2)
    expect(entries[1].dataset.kind).toBe('patched')
    expect(converseCalls()).toBe(2)                         // both turns went to the model
    expect(within(entries[0], 'create-indicator-notes-uct').textContent).toContain(UCT_NOTE)
    expect(within(entries[1], 'create-indicator-notes-uct')).toBeNull()
    expect(within(entries[1], 'create-indicator-notes-assumed')).toBeNull()
  })
})

describe('notesOf: the two voices, from the state', () => {
  const built = (assumptions, ops = BUILD) => {
    const out = applyTurn(newAuthoringState(), { contract: C, baseRevision: 0, ops, assumptions })
    expect(out.result.status).toBe('applied')
    return { state: out.state, rb: out.readback }
  }

  it('sorts by who said it, keeps each as it stands, and leaves the engine\'s defaults to replyLines', () => {
    const { state, rb } = built(NOTES)
    expect(notesOf(rb, state)).toEqual({ uct: [UCT_NOTE], assumed: [ASSUMED, MEANS] })
    // an engine default is not a note of either voice
    const withEngine = { ...state, assumptions: [...state.assumptions, { source: 'engine', output: 'since', text: 'marker below the bar', revision: state.revision }] }
    expect(notesOf(rb, withEngine)).toEqual({ uct: [UCT_NOTE], assumed: [ASSUMED, MEANS] })
  })

  it('null when the turn carries none, and an earlier turn\'s notes are not this turn\'s', () => {
    const { state, rb } = built([])
    expect(notesOf(rb, state)).toBeNull()
    const first = built(NOTES)
    const later = { ...first.state, revision: first.state.revision + 1 }      // the same notes, one revision on
    expect(notesOf(first.rb, later)).toBeNull()
    expect(notesOf(null, null)).toBeNull()
  })

  it('names the output a note is about only when there is more than one', () => {
    const two = [{ op: 'create', name: 'Two', outputs: [{ key: 'fast', tree: P('ema(close, 10)') }, { key: 'slow', tree: P('ema(close, 21)') }] }]
    const { state, rb } = built([{ output: 'slow', text: 'Seeded with the first close.', by: NOTE_BY_UCT }], two)
    const got = notesOf(rb, state)
    expect(got.uct.length).toBe(1)
    expect(got.uct[0].startsWith('Seeded with the first close. (on ')).toBe(true)
    const one = built([{ output: 'since', text: UCT_NOTE, by: NOTE_BY_UCT }])
    expect(notesOf(one.rb, one.state).uct).toEqual([UCT_NOTE])
  })

  it('⛔ the sealed read-back lines are what they were: the notes are not added to them a second time', () => {
    const { state, rb } = built(NOTES)
    const lines = rb.lines.join('\n')
    // readback already prints an assumption once, in its own words; `notesOf` adds nothing to it
    expect(lines.split(UCT_NOTE).length - 1).toBe(1)
    expect(rb.lines).toEqual(readback(state.working, state, {}).lines)
  })
})

// app/src/components/chart/builder/authoring/createdLines.test.js
//
// THE FIRST ANSWER NAMES WHAT WAS BUILT AND POINTS AT THE CARD (owner's choice, 2026-11-20).
// What moves is the engine's DESCRIPTION of each output (the card under the conversation says it,
// once). What stays in the conversation: everything the engine disclosed about this change, and
// everything assumed this turn. A later change is not touched: it reads back the result in full.
import { describe, it, expect } from 'vitest'
import { createdLines, replyLines, modelTurn } from './authoringSession'
import { newAuthoringState, readback } from './index'
import { OUTPUT_TYPES } from '../../engine/outputType'

const line = (name, phrase, extra = {}) => ({ key: name.toLowerCase().replace(/\W+/g, '_'), name, label: name, type: OUTPUT_TYPES.SERIES, phrase, ...extra })
const condition = (name, phrase) => line(name, phrase, { type: OUTPUT_TYPES.CONDITION })

describe('the first answer names its outputs', () => {
  it('counts them in their own word when they share one, and lists the names in plot order', () => {
    const rb = { outputs: [line('Williams %R (9)', 'a number on every bar: the 9-bar Williams %R'), line('EMA 9 of %R', 'a number on every bar: its 9-bar average')] }
    expect(createdLines(rb, {}, [])).toEqual(['Built 2 lines: Williams %R (9), EMA 9 of %R. Details below.'])
    expect(createdLines({ outputs: [line('EMA 20', 'a number on every bar')] }, {}, [])).toEqual(['Built 1 line: EMA 20. Details below.'])
    expect(createdLines({ outputs: [condition('RSI 14 above 70', 'true when the 14-bar RSI of close is above 70')] }, {}, []))
      .toEqual(['Built 1 condition: RSI 14 above 70. Details below.'])
  })

  it('outputs of different kinds are counted as outputs', () => {
    const rb = { outputs: [line('EMA 20', 'a number on every bar'), condition('Close above EMA 20', 'true when the close is above it')] }
    expect(createdLines(rb, {}, [])).toEqual(['Built 2 outputs: EMA 20, Close above EMA 20. Details below.'])
    // a kind with no noun of its own is an output too, never a blank
    expect(createdLines({ outputs: [line('Crosses', 'each cross', { type: OUTPUT_TYPES.EVENTS })] }, {}, []))
      .toEqual(['Built 1 output: Crosses. Details below.'])
  })

  it('ONLY the descriptions move: what the engine disclosed and what was assumed this turn stay, in order', () => {
    const rb = { outputs: [line('RS vs SPY', 'the close divided by SPY\'s close')] }
    const state = { revision: 3, assumptions: [
      { revision: 3, label: 'period', value: 14 },
      { revision: 3, source: 'engine', text: 'the benchmark is SPY' },
      { revision: 2, label: 'period', value: 99 },                       // an EARLIER turn's: never repeated
    ] }
    const changes = [{ kind: 'refused-on-chart', output: 'RS vs SPY', guard: null, text: 'SPY\'s bars are still loading' }]
    const full = replyLines(rb, state, changes)
    const first = createdLines(rb, state, changes)
    expect(first[0]).toBe('Built 1 line: RS vs SPY. Details below.')
    // every line of the full reply that is not an output's description is still said, in the same order
    const described = 'RS vs SPY — the close divided by SPY\'s close'
    expect(full).toContain(described)
    expect(first).not.toContain(described)
    expect(first.slice(1)).toEqual(full.filter((l) => l !== described))
    expect(first.slice(1).length).toBe(3)
    expect(first.join('\n')).toMatch(/can't be drawn here/)
    expect(first.join('\n')).toMatch(/Using .* 14\./)
    expect(first.join('\n')).not.toMatch(/99/)
  })

  it('a build with nothing to name, or an output with no name at all, says the full reply instead', () => {
    expect(createdLines({ outputs: [] }, {}, [])).toEqual(replyLines({ outputs: [] }, {}, []))
    expect(createdLines(null, {}, [])).toEqual([])
    const nameless = { outputs: [{ key: '', name: '', label: '', type: OUTPUT_TYPES.SERIES, sentence: 'a number on every bar' }] }
    expect(createdLines(nameless, {}, [])).toEqual(['a number on every bar'])
    // ONE nameless output among named ones: never counted short and never left out without a word.
    // The full reply is said instead, so its description is still in the conversation.
    const mixed = { outputs: [line('EMA 20', 'a number on every bar'), { key: '', name: '', label: '', type: OUTPUT_TYPES.SERIES, sentence: 'the unnamed one' }] }
    expect(createdLines(mixed, {}, [])).toEqual(replyLines(mixed, {}, []))
    expect(createdLines(mixed, {}, []).join(' | ')).toContain('the unnamed one')
    expect(createdLines(mixed, {}, []).some((l) => l.startsWith('Built '))).toBe(false)
    // a name falls back to the label, then to the key
    expect(createdLines({ outputs: [{ key: 'k1', label: 'My line', type: OUTPUT_TYPES.SERIES, phrase: 'x' }] }, {}, [])[0]).toBe('Built 1 line: My line. Details below.')
    expect(createdLines({ outputs: [{ key: 'k1', type: OUTPUT_TYPES.SERIES, sentence: 'x' }] }, {}, [])[0]).toBe('Built 1 line: k1. Details below.')
  })
})

// ── through the session: the first turn is named, the next turn reads back in full ──
// (the door's own reply shape, as `sessionFunctions.test.js` holds it)
const PATCH = 'uct.authoring.patch/1'
const reply = (state, ops) => ({
  ok: true, turn: 'patch', disposition: 'change', reply: 'done', notUnderstood: [], unavailable: [],
  envelope: { contract: PATCH, baseRevision: state.revision || 0, ops, assumptions: [], disposition: 'change', reply: 'done' },
})
const EMA20 = { type: 'call', name: 'ema', args: [{ type: 'series', name: 'close' }, { type: 'num', value: 20 }] }
const EMA50 = { type: 'call', name: 'ema', args: [{ type: 'series', name: 'close' }, { type: 'num', value: 50 }] }

describe('through a conversation', () => {
  it('the first build is named; a later change still reads back the result in full', async () => {
    const st = newAuthoringState()
    const made = await modelTurn(st, () => st, 'a 20 bar exponential average', {
      converse: async () => reply(st, [{ op: 'create', name: 'Average', placement: 'price', outputs: [{ key: 'avg', label: 'Average', tree: EMA20 }] }]) })
    expect(made.changed, JSON.stringify(made.entries).slice(0, 300)).toBe(true)
    const [first] = made.entries
    expect(first.kind).toBe('created')
    expect(first.lines[0]).toMatch(/^Built 1 line: .+\. Details below\.$/)
    // the card's own sentence is NOT repeated in the first answer, and the card still has it
    const card = readback(made.state.working, made.state, {}).outputs.map((o) => o.phrase || o.sentence)
    expect(card.length).toBe(1)
    expect(card[0]).toBeTruthy()
    expect(first.lines.join('\n')).not.toContain(card[0])

    const view = made.state
    const changed = await modelTurn(view, () => view, 'make it 50', {
      converse: async () => reply(view, [{ op: 'set_output_tree', output: 'avg', tree: EMA50 }]) })
    expect(changed.changed, JSON.stringify(changed.entries).slice(0, 300)).toBe(true)
    const [second] = changed.entries
    expect(second.kind).toBe('patched')
    const after = readback(changed.state.working, changed.state, {}).outputs.map((o) => o.phrase || o.sentence)
    expect(second.lines.join('\n')).toContain(after[0])                  // the result, in the engine's words
    expect(second.lines.join('\n')).not.toMatch(/^Built /m)
  })
})

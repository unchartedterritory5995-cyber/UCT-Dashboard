// ── W2-A1 MULTI-TURN CONTEXT: the open question and follow-up referents (Wave 2, 2026-11-03) ──────────────────
//
// Live findings LT-5 / LT-6 (docs/agent/program/LIVE-TESTING-RESULTS-2026-11-03.md): a NEW request typed while a
// clarify was open was merged into the old one, and "the close" after an AVWAP question became a dated-close query.
// These scenarios run the REAL panel (panelHarness: AgentPanel + useAgent + registry + planner + runtime) with a
// scripted model, and pin: which message binds to the open question, which closes it, what the server is told
// (`openQuestion` on the turn / record body), and how "that chart" / "the other one" / "those" are read before
// the model. No paid model call.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setupPanel, ONE, TWO, MODEL_SENTINEL } from './testing/panelHarness'
import { readReply, matchChoice, openQuestionForServer, resolveReferents, QUESTION_TTL_MS } from './openQuestion'
import { QUESTION_SET_ASIDE } from './useAgent'
import { createMemory } from './memory'

const clarify = (text, choices = []) => ({ disposition: 'clarify', reply: '', question: { text, choices }, ops: [], unsupported_category: null })
const answer = (reply) => ({ disposition: 'answer', reply, question: null, ops: [], unsupported_category: null })

let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks() })

const records = () => p.st.calls.filter(c => c[1] === '/api/agent/record').map(c => c[2])
const tfOf = (board, id) => board.state.widgets.find(w => w.id === id)?.opts?.tf || 'D'

describe('W2-A1 — a reply to UCT\'s open question binds to it; a new request closes it (panel)', () => {
  it('S1 a clicked choice answers the model\'s question: the model is told status answered + the choice', async () => {
    const { say, click } = p.mount(...TWO())
    p.st.envelopes.push(clarify('Which chart?', ['Left', 'Right']))
    await say('set it up for swing trading')
    expect(p.turns()).toBe(1)
    p.st.envelopes.push(answer('ok'))
    await click('Left')
    expect(p.turns()).toBe(2)
    expect(p.lastTurnBody().openQuestion).toMatchObject({ status: 'answered', question: 'Which chart?', choices: ['Left', 'Right'], choice: 'Left', asked: 'set it up for swing trading' })
  })

  it('S2 a typed answer in the choice\'s own word ("the left one") binds to that choice', async () => {
    const { say } = p.mount(...TWO())
    p.st.envelopes.push(clarify('Which chart?', ['Left', 'Right']))
    await say('set it up for swing trading')
    p.st.envelopes.push(answer('ok'))
    await say('the left one')
    expect(p.turns()).toBe(2)
    expect(p.lastTurnBody().openQuestion).toMatchObject({ status: 'answered', choice: 'Left' })
    expect(p.lastTurnBody().message).toBe('the left one')
  })

  it('S16 a LOCAL question ("Which chart?" holding a plan): a new request closes it and drops the held plan', async () => {
    const { say, board } = p.mount(...TWO())
    const out = await say('make it weekly')
    expect(out).toMatch(/Which chart\?/)
    expect(p.turns()).toBe(0)
    p.st.envelopes.push(answer('ok'))
    await say('what do you think of my setup')
    expect(p.turns()).toBe(1)
    expect(p.lastTurnBody().openQuestion).toMatchObject({ status: 'closed', reason: 'new_request', question: 'Which chart?', asked: 'make it weekly' })
    expect(tfOf(board, 'cl')).toBe('D'); expect(tfOf(board, 'cr')).toBe('D')
    // the held plan is gone: "do it" has nothing to apply
    const after = await say('do it')
    expect(after).toMatch(/no proposal waiting/)
  })

  it('S17 "never mind" over a LOCAL question dismisses it with the existing wording', async () => {
    const { say } = p.mount(...TWO())
    await say('make it weekly')
    const out = await say('never mind')
    expect(out).toMatch(/Okay — nothing changed\./)
    expect(p.turns()).toBe(0)
  })

  it('S3 a short reply ("weekly") while a question is open goes to the model, never through the instant path (LT-5)', async () => {
    const { say, board } = p.mount(...ONE())
    p.st.envelopes.push(clarify('Which timeframe did you mean for the AVWAP anchor?', []))
    await say('avwap on it from last saturday')
    p.st.envelopes.push(answer('ok'))
    await say('weekly')
    expect(tfOf(board, 'c')).toBe('D')                       // the chart was NOT switched by the fast path
    expect(p.turns()).toBe(2)
    expect(p.lastTurnBody().openQuestion).toMatchObject({ status: 'answered', choice: null, asked: 'avwap on it from last saturday' })
  })

  it('S4 "the close" after a price-level question picks the Close choice by its word', async () => {
    const { say } = p.mount(...ONE())
    p.st.envelopes.push(clarify('Which price level for the anchor?', ['Open', 'High', 'Low', 'Close']))
    await say('avwap on it from last saturday')
    p.st.envelopes.push(answer('ok'))
    await say('the close')
    expect(p.lastTurnBody().openQuestion).toMatchObject({ status: 'answered', choice: 'Close' })
  })

  it('S5 a NEW request typed over the open question closes it: status closed / new_request (LT-6)', async () => {
    const { say } = p.mount(...ONE())
    p.st.envelopes.push(clarify('On the Oct 9 low and Oct 28 low, what prices are you looking at?', []))
    await say('draw a trendline on nvda from the oct 9 low to the oct 28 low')
    p.st.envelopes.push(answer('ok'))
    await say('trendline on nvda from 2031-01-01 to today')
    expect(p.turns()).toBe(2)
    expect(p.lastTurnBody().openQuestion).toMatchObject({ status: 'closed', reason: 'new_request', question: 'On the Oct 9 low and Oct 28 low, what prices are you looking at?' })
    expect(p.lastTurnBody().message).toBe('trendline on nvda from 2031-01-01 to today')
  })

  it('S6 "never mind" sets the question aside with no model call; the next message starts clean', async () => {
    const { say } = p.mount(...ONE())
    p.st.envelopes.push(clarify('Which price level?', ['Open', 'Close']))
    await say('avwap on it from last saturday')
    const out = await say('never mind')
    expect(out).toContain(QUESTION_SET_ASIDE)
    expect(p.turns()).toBe(1)
    const rec = records().find(r => r.member === 'never mind')
    expect(rec.outcomeData.kind).toBe('question-closed')
    expect(rec.openQuestion).toMatchObject({ status: 'closed', reason: 'cancelled' })
    p.st.envelopes.push(answer('hi'))
    await say('what do you think of my setup')
    expect(p.lastTurnBody().openQuestion).toBeUndefined()
  })

  it('S7 a request the instant path can run closes the question and runs at once; its record carries the reading', async () => {
    const { say, board } = p.mount(...ONE())
    p.st.envelopes.push(clarify('Which price level?', ['Open', 'Close']))
    await say('avwap on it from last saturday')
    await say('switch to weekly')
    expect(tfOf(board, 'c')).toBe('W')
    expect(p.turns()).toBe(1)
    const rec = records().find(r => r.member === 'switch to weekly')
    expect(rec.openQuestion).toMatchObject({ status: 'closed', reason: 'new_request' })
    // the question is gone: the next model turn carries nothing about it
    p.st.envelopes.push(answer('hi'))
    await say('what do you think of my setup')
    expect(p.lastTurnBody().openQuestion).toBeUndefined()
  })

  it('S8 "undo" over an open question is Undo, not an answer', async () => {
    const { say, board } = p.mount(...ONE())
    await say('switch to weekly')
    expect(tfOf(board, 'c')).toBe('W')
    p.st.envelopes.push(clarify('Which price level?', ['Open', 'Close']))
    await say('avwap on it from last saturday')
    const out = await say('undo')
    expect(out).toMatch(/Undid/)
    expect(tfOf(board, 'c')).toBe('D')
    expect(p.turns()).toBe(1)
  })

  it('S9 a number picks that choice', async () => {
    const { say } = p.mount(...TWO())
    p.st.envelopes.push(clarify('Which chart?', ['Left', 'Right']))
    await say('set it up for swing trading')
    p.st.envelopes.push(answer('ok'))
    await say('2')
    expect(p.lastTurnBody().openQuestion).toMatchObject({ status: 'answered', choice: 'Right' })
  })

  it('S10 a question typed over the open question is a new request', async () => {
    const { say } = p.mount(...ONE())
    p.st.envelopes.push(clarify('Which price level?', ['Open', 'Close']))
    await say('avwap on it from last saturday')
    p.st.envelopes.push(answer('…'))
    await say('what do you think of my setup?')
    expect(p.lastTurnBody().openQuestion).toMatchObject({ status: 'closed', reason: 'new_request' })
  })

  it('S11 once the model answered, the question is resolved: the following message carries no openQuestion', async () => {
    const { say } = p.mount(...TWO())
    p.st.envelopes.push(clarify('Which chart?', ['Left', 'Right']))
    await say('set it up for swing trading')
    p.st.envelopes.push(answer('ok'))
    await say('Left')
    p.st.envelopes.push(answer('ok'))
    await say('Right')
    expect(p.turns()).toBe(3)
    expect(p.lastTurnBody().openQuestion).toBeUndefined()
  })

  it('S12 a second question replaces the first: a new request then closes the SECOND one', async () => {
    const { say } = p.mount(...TWO())
    p.st.envelopes.push(clarify('Which chart?', ['Left', 'Right']))
    await say('set it up for swing trading')
    p.st.envelopes.push(clarify('Daily or weekly?', ['Daily', 'Weekly']))
    await say('Left')
    p.st.envelopes.push(answer('ok'))
    await say('open nvda')
    expect(p.lastTurnBody().openQuestion).toMatchObject({ status: 'closed', question: 'Daily or weekly?', asked: 'Left' })
  })

  it('S13 "yes" with no proposal waiting answers a yes/no question', async () => {
    const { say } = p.mount(...ONE())
    p.st.envelopes.push(clarify('Anchor it at the session open?', []))
    await say('avwap on it from last saturday')
    p.st.envelopes.push(answer('ok'))
    await say('yes')
    expect(p.lastTurnBody().openQuestion).toMatchObject({ status: 'answered' })
  })

  it('S14 a different ticker in a short message is a new request, not an answer', async () => {
    const { say } = p.mount(...ONE())
    p.st.envelopes.push(clarify('Which price level for the NVDA anchor?', ['Open', 'Close']))
    await say('avwap on nvda from last saturday')
    p.st.envelopes.push(answer('ok'))
    await say('AMD profile')
    expect(p.lastTurnBody().openQuestion).toMatchObject({ status: 'closed', reason: 'new_request' })
  })

  it('S15 a message with no question open carries nothing (the v1 request body is unchanged)', async () => {
    const { say } = p.mount(...ONE())
    p.st.envelopes.push(answer('hi'))
    await say('what do you think of my setup')
    expect('openQuestion' in p.lastTurnBody()).toBe(false)
    expect(p.lastTurnBody().context.conversation_memory).toBeUndefined()
  })
})

describe('W2-A1 — follow-up referents are read before the model (panel)', () => {
  it('R1 "that chart" after one chart changed → the ref it names rides as conversation_memory.referents', async () => {
    const { say, board } = p.mount(...TWO())
    await say('make the left chart weekly')
    expect(tfOf(board, 'cl')).toBe('W')
    p.st.envelopes.push(answer('ok'))
    await say('what is on that chart')
    const refs = p.lastTurnBody().context.conversation_memory?.referents
    expect(refs).toHaveLength(1)
    expect(refs[0]).toMatchObject({ words: 'that chart', kind: 'chart' })
    expect(p.lastTurnBody().context.charts.some(c => c.ref === refs[0].ref && /NVDA/.test(c.label))).toBe(true)
  })

  it('R2 "that chart" after BOTH charts changed → asked which (two choices), no model call, no guess', async () => {
    const { say, board } = p.mount(...TWO())
    await say('make all charts weekly')
    expect(tfOf(board, 'cl')).toBe('W'); expect(tfOf(board, 'cr')).toBe('W')
    const out = await say('what is on that chart')
    expect(out).toMatch(/Which chart do you mean by “that chart”\?/)
    expect(p.turns()).toBe(0)
    expect(records().some(r => r.outcomeData?.kind === 'clarify-referent')).toBe(true)
  })

  it('R3 the answer to that question binds to it and goes to the model with the choice', async () => {
    const { say, click } = p.mount(...TWO())
    await say('make all charts weekly')
    await say('what is on that chart')
    p.st.envelopes.push(answer('ok'))
    await click('Chart (NVDA)')
    expect(p.turns()).toBe(1)
    expect(p.lastTurnBody().openQuestion).toMatchObject({ status: 'answered', choice: 'Chart (NVDA)', asked: 'what is on that chart' })
  })

  it('R4 "the other one" after a two-way question was answered → the choice not picked', async () => {
    const { say, click } = p.mount(...TWO())
    p.st.envelopes.push(clarify('Which chart?', ['Left', 'Right']))
    await say('set it up for swing trading')
    p.st.envelopes.push(answer('ok'))
    await click('Left')
    p.st.envelopes.push(answer('ok'))
    await say('what about the other one')
    expect(p.lastTurnBody().context.conversation_memory?.referents?.[0]).toMatchObject({ words: 'the other one', label: 'Right' })
  })

  it('R5 "the other one" with nothing to point at → a plain refusal to guess, no model call', async () => {
    const { say } = p.mount(...TWO())
    const out = await say('open the other one')
    expect(out).toMatch(/I'm not sure what “the other one” points at/)
    expect(p.turns()).toBe(0)
  })

  it('R6 "that alert" with no recent alert of UCT\'s → nothing is resolved; the model is asked as before', async () => {
    const { say } = p.mount(...ONE())
    p.st.envelopes.push(answer('Pause which alert?'))
    await say('pause that alert')
    expect(p.turns()).toBe(1)
    expect(p.lastTurnBody().context.conversation_memory?.referents).toBeUndefined()
  })
})

describe('W2-A1 — readReply, the deterministic reading (unit)', () => {
  const q = { text: 'Which price level for the NVDA anchor?', choices: ['Open', 'High', 'Low', 'Close'], asked: 'avwap on nvda from last saturday', at: 1000 }
  it.each([
    ['Close', 'answer', 'Close'],
    ['close.', 'answer', 'Close'],
    ['the close', 'answer', 'Close'],
    ['3', 'answer', 'Low'],
    ['the second one', 'answer', 'High'],
    ['150', 'answer', null],
    ['both', 'answer', null],
    ['oct 9 at 150 and oct 28 at 180', 'answer', null],
    ['never mind', 'cancel', null],
    ['forget it', 'cancel', null],
    ['nvm', 'cancel', null],
    ['trendline on nvda from 2031-01-01 to today', 'new', null],
    ['draw a trendline on nvda from the oct 9 low to the oct 28 low', 'new', null],
    ['add the 9 ema', 'new', null],
    ['what is an avwap?', 'new', null],
    ['whats nvda at', 'new', null],
    ['ok now switch to weekly', 'new', null],
    ['avwap from last friday', 'new', null],
    ['undo', 'new', null],
    ['do it', 'new', null],
    ['AMD profile', 'new', null],
  ])('%s → %s', (text, kind, choice) => {
    const r = readReply(text, q, { now: 2000 })
    expect(r.kind).toBe(kind)
    expect(r.choice?.label ?? null).toBe(choice)
  })
  it('an expired question binds nothing: the reply is read as new', () => {
    expect(readReply('close', q, { now: 1000 + QUESTION_TTL_MS + 1 }).kind).toBe('new')
    expect(readReply('close', q, { now: 1000 + QUESTION_TTL_MS }).kind).toBe('answer')
  })
  it('"yes" / "no" belong to a waiting proposal, never to the question', () => {
    expect(readReply('yes', { text: 'Anchor at the open?', choices: [], at: 0 }, { now: 1 }).kind).toBe('answer')
    expect(readReply('yes', { text: 'Anchor at the open?', choices: [], at: 0 }, { now: 1, pendingProposal: true }).kind).toBe('new')
  })
  it('a Cancel choice typed by its label cancels', () => {
    expect(readReply('cancel', { text: 'Which chart?', choices: [{ label: 'Left' }, { label: 'Cancel', cancel: true }], at: 0 }, { now: 1 }).kind).toBe('cancel')
  })
  it('matchChoice: an ambiguous word matches nothing; one word match wins; ordinals and numbers index', () => {
    expect(matchChoice('chart', ['Left chart', 'Right chart'])).toBeNull()
    expect(matchChoice('right', ['Left chart', 'Right chart'])?.label).toBe('Right chart')
    expect(matchChoice('the first', ['Left chart', 'Right chart'])?.index).toBe(0)
    expect(matchChoice('5', ['Left chart', 'Right chart'])).toBeNull()
  })
  it('openQuestionForServer is bounded and value-free: labels, the question, the earlier words, the reading', () => {
    const long = 'x'.repeat(1000)
    const out = openQuestionForServer({ text: long, choices: Array.from({ length: 20 }, (_, i) => ({ label: `c${i}` })).concat([{ label: 'Cancel', cancel: true }]), asked: long }, { kind: 'new' })
    expect(out.question).toHaveLength(300)
    expect(out.asked).toHaveLength(500)
    expect(out.choices).toHaveLength(12)
    expect(out.choices).not.toContain('Cancel')
    expect(out).toMatchObject({ status: 'closed', reason: 'new_request' })
    const ans = openQuestionForServer({ text: 'Which?', choices: [{ label: 'L', ref: 'cl' }], asked: 'x' }, { kind: 'answer', choice: { label: 'L', ref: 'cl', index: 0 } }, { back: { cl: 'c1' } })
    expect(ans).toMatchObject({ status: 'answered', choice: 'L', choice_ref: 'c1' })
    expect(openQuestionForServer(null, { kind: 'new' })).toBeNull()
  })
})

describe('W2-A1 — resolveReferents (unit, fake board + session memory)', () => {
  const host = { charts: { list: () => [{ ref: 'cl', symbol: 'NVDA', label: 'Chart (NVDA)' }, { ref: 'cr', symbol: 'AMD', label: 'Chart (AMD)' }], read: (r) => ({ ref: r }) } }
  it('"those" names the latest result set (count only; the tickers already ride as recent_results)', () => {
    const memory = createMemory()
    memory.noteResults({ source: 'screener.run', symbols: ['AAPL', 'MSFT', 'NVDA'] })
    expect(resolveReferents('put those on a list', { host, memory })).toEqual({ hints: [{ words: 'those', set: 'latest', count: 3 }], ask: null, say: null })
    expect(resolveReferents('put those on a list', { host, memory: createMemory() })).toBeNull()
  })
  it('"the other one" after a two-row result set with one on a chart → the other symbol', () => {
    const memory = createMemory()
    memory.noteResults({ source: 'screener.run', symbols: ['NVDA', 'TSLA'] })
    expect(resolveReferents('open the other one', { host, memory }).hints[0]).toMatchObject({ words: 'the other one', symbol: 'TSLA' })
  })
  it('"the other one" after the last change touched one of exactly two charts → the other chart', () => {
    const memory = createMemory()
    memory.beginTurn()
    memory.noteChange({ ops: [{ action: 'chart.setTimeframe', args: { timeframe: 'W' }, target: 'cl' }] })
    expect(resolveReferents('make the other one weekly too', { host, memory }).hints[0]).toMatchObject({ words: 'the other one', ref: 'cr', kind: 'chart' })
  })
  it('"the other one" with three charts and no better clue → refused, never guessed', () => {
    const three = { charts: { list: () => [...host.charts.list(), { ref: 'cx', symbol: 'SPY', label: 'Chart (SPY)' }] } }
    const memory = createMemory()
    memory.beginTurn()
    memory.noteChange({ ops: [{ action: 'chart.setTimeframe', args: { timeframe: 'W' }, target: 'cl' }] })
    const r = resolveReferents('make the other one weekly too', { host: three, memory })
    expect(r.hints).toEqual([])
    expect(r.say).toMatch(/the other one/)
  })
  it('"the other charts" (plural) is not "the other one": nothing is read here', () => {
    expect(resolveReferents('do the same on the other charts', { host, memory: createMemory() })).toBeNull()
  })
  it('a message with no pointing words → null (the request goes on exactly as before)', () => {
    expect(resolveReferents('switch to weekly', { host, memory: createMemory() })).toBeNull()
  })
})

describe('W2-A1 — the v1 path is unchanged where no question is involved', () => {
  it('an ordinary instant change, an ordinary model answer, and the sentinel for an unscripted turn', async () => {
    const { say, board } = p.mount(...ONE())
    await say('switch to weekly')
    expect(tfOf(board, 'c')).toBe('W')
    expect(p.turns()).toBe(0)
    const out = await say('what do you think of my setup')
    expect(out).toContain(MODEL_SENTINEL)
    expect(p.turns()).toBe(1)
    expect('openQuestion' in p.lastTurnBody()).toBe(false)
  })
})

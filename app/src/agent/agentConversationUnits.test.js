// PHASE 2 — the conversation layer, unit by unit: session memory's turn and indicator set (agent/memory.js), the
// follow-up words (agent/conversation.js) and the multi-step planner (agent/compound.js). The end-to-end
// conversations are agentConversationP2.test.jsx.
import { describe, it, expect } from 'vitest'
import { registerBuiltins } from './builtins'
import { createMemory, MEMORY_TTL_MS } from './memory'
import { tidy, chartSet, isReferentWords, followUpShape } from './conversation'
import { planCompound, MAX_STEPS, MAX_STEP_OPS } from './compound'
import { makeBoard } from './__fixtures__/board'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import MANIFEST_CONTRACT from './contract/manifest.contract.json'

registerBuiltins()

const add = (chart) => ({ action: 'indicator.add', target: `ixe:${chart}`, args: { defId: 'rsi', inputs: null } })
const style = (chart) => ({ action: 'indicatorStyle.set', target: `ixe:${chart}`, args: { instance: 'x', property: 'color', value: 'green', output: null } })

describe('memory — one member message is one turn', () => {
  it('the steps a message commits are grouped; the next message starts a new turn', () => {
    const m = createMemory()
    m.beginTurn()
    m.noteChange({ ops: [add('c')], undoId: 'u1' })
    m.noteChange({ ops: [add('c')], undoId: 'u2' })
    expect(m.lastTurn().ops).toHaveLength(2)
    expect(m.lastTurn().undoIds).toEqual(['u1', 'u2'])
    m.beginTurn()
    m.noteChange({ ops: [style('c')], undoId: 'u3' })
    expect(m.lastTurn().ops.map(o => o.action)).toEqual(['indicatorStyle.set'])
  })
  it('undoing one step drops exactly that step; undoing all of them forgets the turn', () => {
    const m = createMemory()
    m.beginTurn()
    m.noteChange({ ops: [add('a')], undoId: 'u1' })
    m.noteChange({ ops: [add('b')], undoId: 'u2' })
    m.noteUndone('u2')
    expect(m.lastTurn().charts).toEqual(['ixe:a'])
    m.noteUndone('u1')
    expect(m.lastTurn()).toBeNull()
  })
  it('the indicator set: what the latest ADDING turn added, in order — kept by a restyling turn, replaced by the next adding turn', () => {
    const m = createMemory()
    m.beginTurn()
    m.noteChange({ ops: [add('c')] }); m.noteIndicator({ chart: 'c', instanceId: 'i9', label: 'EMA 9' })
    m.noteChange({ ops: [add('c')] }); m.noteIndicator({ chart: 'c', instanceId: 'i20', label: 'EMA 20' })
    m.beginTurn()
    m.noteChange({ ops: [style('c')] })                                   // "make the first one green": no new set
    expect(m.indicatorSet().map(i => i.label)).toEqual(['EMA 9', 'EMA 20'])
    m.beginTurn()
    m.noteChange({ ops: [add('c')] }); m.noteIndicator({ chart: 'c', instanceId: 'r', label: 'RSI (14)' })
    expect(m.indicatorSet().map(i => i.label)).toEqual(['RSI (14)'])
  })
  it('mentions: every indicator the CURRENT turn acted on (a colour, a pane) — a new turn starts again', () => {
    const m = createMemory()
    m.beginTurn()
    m.noteMention({ chart: 'c', instanceId: 'a' }); m.noteMention({ chart: 'c', instanceId: 'b' }); m.noteMention({ chart: 'c', instanceId: 'a' })
    expect(m.mentioned().map(i => i.instanceId)).toEqual(['a', 'b'])
    m.beginTurn()
    m.noteMention({ chart: 'c', instanceId: 'z' })
    expect(m.mentioned().map(i => i.instanceId)).toEqual(['z'])
  })
  it('the model sees the recent indicators by chart, id and legend name — nothing else; a board change or the TTL forgets them', () => {
    let t = 1_000
    const m = createMemory({ now: () => t })
    m.beginTurn()
    m.noteChange({ ops: [add('c')] }); m.noteIndicator({ chart: 'c', instanceId: 'i9', defId: 'movingAverage', label: 'EMA 9' })
    expect(m.forModel().recent_indicators).toEqual([{ chart: 'c', id: 'i9', name: 'EMA 9' }])
    t += MEMORY_TTL_MS + 1
    expect(m.forModel()?.recent_indicators).toBeUndefined()
    m.beginTurn()
    m.noteChange({ ops: [add('c')] }); m.noteIndicator({ chart: 'c', instanceId: 'i9', label: 'EMA 9' })
    m.boardChanged()
    expect(m.indicatorSet()).toBeNull()
    expect(m.lastTurn()).toBeNull()
  })
})

describe('conversation words', () => {
  it.each([
    ['Actually, make the 20 yellow instead', 'make the 20 yellow'],
    ['ok now can you make them both dashed please', 'make them both dashed'],
    ['Now put those on my other charts', 'put those on my other charts'],
  ])('tidy(%s)', (a, b) => { expect(tidy(a)).toBe(b) })

  it.each(['the first one', 'the second ema', 'the fast one', 'the slower ma', 'those', 'them both', 'the 9', 'the 20 ema', 'it', 'the rsi', 'that i just added', 'the new one'])('%s is a reference', (w) => {
    expect(isReferentWords(w)).toBe(true)
  })
  it.each(['the chart', 'green', 'weekly', 'my momentum list'])('%s is not', (w) => { expect(isReferentWords(w)).toBe(false) })

  const four = () => {
    const ws = ['a', 'b', 'c', 'd'].map((id, i) => ({ id, type: 'chart', x: (i % 2) * 12, y: Math.floor(i / 2) * 10, w: 12, h: 10, color: 'N', opts: { settings: mergeChartSettings(null) } }))
    return makeBoard(ws, { 'N:a': 'SPY', 'N:b': 'QQQ', 'N:c': 'NVDA', 'N:d': 'TSLA' }).host
  }
  it('chart sets: "my other charts" excludes the conversation\'s chart; "all of them" is every chart; "both" on four charts is said', () => {
    const host = four()
    expect(chartSet('my other charts', { host, sources: ['a'] }).refs).toEqual(['b', 'c', 'd'])
    expect(chartSet('the rest of them', { host, sources: ['a', 'b'] }).refs).toEqual(['c', 'd'])
    expect(chartSet('all of them', { host }).refs).toEqual(['a', 'b', 'c', 'd'])
    expect(chartSet('both', { host }).say).toMatch(/There are 4 charts here, not two/)
    expect(chartSet('the others', { host, sources: [] })).toBeNull()                  // other than what? → the model
    expect(chartSet('the top right one', { host }).refs).toEqual(['b'])
    expect(chartSet('the nvda chart', { host }).refs).toEqual(['c'])
  })
  it('shape: a follow-up the conversation could read once its referents exist — and only that', () => {
    expect(followUpShape('make the 9 green and 20 yellow')).toBe(true)
    expect(followUpShape('make it a little taller')).toBe(true)
    expect(followUpShape('copy those indicators to my other charts')).toBe(true)
    expect(followUpShape('make the 9 green, move RSI into its own pane')).toBe(false)     // two instructions: two steps
    expect(followUpShape('make all my charts match this one')).toBe(true)
    expect(followUpShape('make the 9 green, and copy those indicators to my other charts')).toBe(false)
    expect(followUpShape('tell me a joke')).toBe(false)
  })
})

describe('the multi-step planner', () => {
  const one = () => makeBoard([{ id: 'c', type: 'chart', x: 0, y: 0, w: 24, h: 20, color: 'N', opts: { settings: mergeChartSettings(null) } }], { 'N:c': 'QQQ' }).host
  it('the flagship request → the fewest steps that each read as one step', () => {
    const r = planCompound('Create four daily charts for SPY, QQQ, NVDA and TSLA, put the 9 and 20 EMA on all of them, make the 9 green and 20 yellow, and put RSI in its own pane.', { host: one() })
    expect(r.steps.map(s => s.text)).toEqual(['Create four daily charts for SPY, QQQ, NVDA and TSLA', 'put the 9 and 20 EMA on all of them', 'make the 9 green and 20 yellow', 'put RSI in its own pane'])
    expect(r.steps[0].kind).toBe('grid')
  })
  it('one clause is the panel\'s own layers\' — except "put X in its own pane / under price" (nothing else adds it where asked)', () => {
    expect(planCompound('add rsi', { host: one() })).toBeNull()
    expect(planCompound('Put RSI under price', { host: one() }).steps).toEqual([{ text: 'Put RSI under price', kind: 'pane' }])
  })
  it('a clause nothing reads → null (the whole request goes to the model)', () => {
    expect(planCompound('add rsi and then tell me a joke about the fed', { host: one() })).toBeNull()
  })
  it('limits come from the contract and are never raised', () => {
    expect(MAX_STEP_OPS).toBe(MANIFEST_CONTRACT.limits.maxOps)
    expect(MAX_STEPS).toBe(6)
    expect(planCompound('add rsi, make it purple, add macd, make it red, add atr, make it blue, then switch to weekly', { host: one() }).say).toMatch(/at most 6/)
  })
})

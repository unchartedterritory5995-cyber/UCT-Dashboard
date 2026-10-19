// GATE C session memory + references — the rules, unit by unit (agent/memory.js, agent/references.js).
import { describe, it, expect } from 'vitest'
import { createMemory, tickersOfAnswer, MEMORY_TTL_MS, MAX_SETS, MAX_ITEMS, MODEL_ITEMS } from './memory'
import { resolveReference, subjectTarget } from './references'
import { registerBuiltins } from './builtins'
import { makeBoard } from './__fixtures__/board'

registerBuiltins()
const clock = () => { let t = 1_000_000; return { now: () => t, tick: (ms) => { t += ms } } }
const oneChart = () => makeBoard([{ id: 'c1', type: 'chart', x: 0, y: 0, w: 24, h: 20 }], { A: 'QQQ' }).host

describe('memory — retention and invalidation', () => {
  it('keeps the newest MAX_SETS result sets, MAX_ITEMS each, deduplicated, in order', () => {
    const m = createMemory()
    for (let i = 0; i < MAX_SETS + 2; i++) m.noteResults({ source: 's', symbols: [`T${i}`] })
    expect(m.resultSets().map(s => s.symbols[0])).toEqual(['T4', 'T3', 'T2'])
    m.noteResults({ source: 's', symbols: [...Array(80)].map((_, i) => `X${i}`).concat(['x0']) })
    expect(m.latestResults().symbols).toHaveLength(MAX_ITEMS)
    expect(m.latestResults().symbols[0]).toBe('X0')
  })

  it('everything expires after MEMORY_TTL_MS', () => {
    const c = clock()
    const m = createMemory({ now: c.now })
    m.noteResults({ source: 's', symbols: ['AAA'] })
    m.noteChange({ ops: [{ action: 'chart.setTimeframe', args: { tf: 'W' }, target: 'c1' }], epoch: 'e1' })
    c.tick(MEMORY_TTL_MS - 1)
    expect(m.latestResults()).toBeTruthy()
    expect(m.lastChange('e1')).toBeTruthy()
    c.tick(2)
    expect(m.latestResults()).toBeNull()
    expect(m.lastChange('e1')).toBeNull()
    expect(m.subject('chart', 'e1')).toBeNull()
    expect(m.forModel()).toBeNull()
  })

  it('a layout change drops chart subjects and the last change (refs belong to that board); tickers stay', () => {
    const m = createMemory()
    m.noteResults({ source: 's', symbols: ['AAA'] })
    m.noteChange({ ops: [{ action: 'chart.setTimeframe', args: {}, target: 'c1' }], epoch: 'e1' })
    expect(m.subject('chart', 'e1').ref).toBe('c1')
    expect(m.subject('chart', 'e2')).toBeNull()                         // another layout is showing
    expect(m.lastChange('e2')).toBeNull()
    expect(m.latestResults().symbols).toEqual(['AAA'])
  })

  it('the model sees tickers (first MODEL_ITEMS, in order) and action names — never args or values', () => {
    const m = createMemory()
    m.noteResults({ source: 'screener.run', label: 'Semis', symbols: [...Array(30)].map((_, i) => `S${i}`) })
    m.noteChange({ ops: [{ action: 'chart.compare', args: { add: ['SECRET'] }, target: 'c1' }], epoch: null })
    const f = m.forModel()
    expect(f.recent_results[0].symbols_in_order).toHaveLength(MODEL_ITEMS)
    expect(f.recent_results[0].count).toBe(30)
    expect(f.last_change).toEqual(['chart.compare'])
    expect(JSON.stringify(f)).not.toContain('SECRET')
  })

  it('tickersOfAnswer reads only a ticker column', () => {
    expect(tickersOfAnswer({ table: { columns: [{ key: 'ticker' }], rows: [{ ticker: 'NVDA' }, { ticker: 'AMD' }] } })).toEqual(['NVDA', 'AMD'])
    expect(tickersOfAnswer({ table: { columns: [{ key: 'date' }], rows: [{ date: '2020-04-03' }] } })).toBeNull()
    expect(tickersOfAnswer({ text: 'hi' })).toBeNull()
  })
})

describe('references — ordinals and refusals', () => {
  const m = createMemory()
  m.noteResults({ source: 'screener.run', label: 'Strong semis', symbols: ['NVDA', 'AVGO', 'AMD', 'MU', 'QCOM'] })
  const host = oneChart()
  const sym = (t) => resolveReference(t, { host, memory: m })?.ops?.[0]?.args?.symbol
  it.each([
    ['open the third one', 'AMD'], ['pull up #3', 'AMD'], ['show me number 3', 'AMD'], ['chart the 3rd', 'AMD'],
    ['open the first one', 'NVDA'], ['open the top one', 'NVDA'], ['what about the second one', 'AVGO'],
    ['open the last one', 'QCOM'], ['Can you open the 4th one please', 'MU'], ['load the fifth result', 'QCOM'],
  ])('"%s" → %s', (t, want) => expect(sym(t)).toBe(want))

  it('out of range says so; nothing remembered → null (the model path)', () => {
    expect(resolveReference('open the 7th one', { host, memory: m })).toEqual({ kind: 'say', text: '“Strong semis” showed 5 — pick a number from 1 to 5.' })
    expect(resolveReference('open the third one', { host, memory: createMemory() })).toBeNull()
    expect(resolveReference('open the third one', { host, memory: null })).toBeNull()
  })

  it('ordinary commands are not references', () => {
    for (const t of ['open swing board', 'weekly', 'open the third layout', 'show the first five', 'add rsi']) expect(resolveReference(t, { host, memory: m })).toBeNull()
  })

  it('the opened ticker is marked trusted (it came from UCT, not typing) and aims at the one chart', () => {
    const r = resolveReference('open the third one', { host, memory: m })
    expect(r.ops[0]).toMatchObject({ action: 'chart.setSymbol', args: { symbol: 'AMD' }, trusted: true, target: 'c1' })
  })

  it('"compare it to the others" over the 10-overlay limit asks for a smaller number', () => {
    const big = createMemory()
    big.noteResults({ source: 's', symbols: [...Array(14)].map((_, i) => `B${i}`) })
    expect(resolveReference('compare it to the others', { host, memory: big }).text).toMatch(/14 other results.*10 symbols/)
    expect(resolveReference('compare it to the top 3', { host, memory: big }).ops[0].args.add).toEqual(['B0', 'B1', 'B2'])
  })

  it('subjectTarget fills only a missing target, never over a click or a position', () => {
    const b = makeBoard([{ id: 'L', type: 'chart', x: 0, y: 0, w: 12, h: 20 }, { id: 'R', type: 'chart', x: 12, y: 0, w: 12, h: 20, color: 'B' }], { A: 'SPY', B: 'QQQ' }).host
    const mem = createMemory()
    mem.noteChange({ ops: [{ action: 'chart.setSymbol', args: {}, target: 'R' }], epoch: null })
    const fast = { kind: 'ops', ops: [{ action: 'chart.setTimeframe', args: { tf: 'W' } }], target: null }
    expect(subjectTarget(fast, 'make it weekly', { host: b, memory: mem }).ops[0].target).toBe('R')
    expect(subjectTarget(fast, 'make the chart weekly', { host: b, memory: mem }).ops[0].target).toBeUndefined()
    expect(subjectTarget({ ...fast, target: { position: 'left' } }, 'make it weekly', { host: b, memory: mem }).ops[0].target).toBeUndefined()
    b.charts.selected = () => 'L'
    expect(subjectTarget(fast, 'make it weekly', { host: b, memory: mem }).ops[0].target).toBeUndefined()   // a click wins (deixis)
  })
})

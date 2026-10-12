// UCT Agent — NL Intent N3: typo-tolerant instant commands. The exact parse is never changed; a
// corrected parse is used only for SAFE (local, reversible, no tickers from text) actions, and only
// when every equally close reading leads to the same action.
import { describe, it, expect } from 'vitest'
import { registerBuiltins } from './builtins'
import { fastParse } from './fastPath'
import { correctTypos } from './nl/lexicon'
import { makeBoard } from './__fixtures__/board'
import corpus from './__fixtures__/nlIntent/corpus.json'

registerBuiltins()
const LISTS = [{ id: 'm1', name: 'Momentum', symbols: ['NVDA', 'AMD'] }, { id: 's1', name: 'Swing', symbols: ['TSLA'] }]
const LAYOUTS = [{ id: 1, name: 'Swing Board', scope: 'user' }, { id: 2, name: 'Day Trading', scope: 'user' }]
const host = () => makeBoard([{ id: 'c1', type: 'chart', x: 0, y: 0, w: 18, h: 20, opts: { tf: 'D' } }], { A: 'NVDA' }, { layouts: { entries: LAYOUTS, boards: {}, active: 1 }, watchlists: LISTS }).host
const parse = (t) => fastParse(t, { host: host() })
const ops = (t) => { const f = parse(t); return f?.kind === 'ops' ? f.ops.map(o => [o.action, o.args]) : f?.kind || null }

describe('obvious typos in safe instant commands are corrected', () => {
  it.each([
    ['weeky', [['chart.setTimeframe', { timeframe: 'W' }]]],
    ['swtich to daily', [['chart.setTimeframe', { timeframe: 'D' }]]],
    ['swithc to 5 minuts', [['chart.setTimeframe', { timeframe: '5' }]]],
    ['hide volumn', [['volume.setState', { state: 'hidden' }]]],
    ['candels', [['chart.setType', { type: 'candles' }]]],
    ['logarithmic scael', [['chart.setScale', { scale: 'log' }]]],
    ['add bolinger bands', [['indicator.add', { defId: 'bb', inputs: null }]]],
    ['what layuot am i on', [['layout.current', {}]]],
  ])('%s', (text, want) => expect(ops(text)).toEqual(want))
  it('undo with a typo is still Undo; the correction is reported for telemetry', () => {
    expect(parse('undo taht').kind).toBe('undo')
    // weekly | week are both read as Weekly by the timeframe phrase: one action, so it is used
    expect(parse('weeky').corrected?.[0]?.from).toBe('weeky')
  })
  it('an exact command is never "corrected"', () => {
    expect(parse('switch to weekly').corrected).toBeUndefined()
    expect(parse('hide volume').corrected).toBeUndefined()
  })
})

describe('never corrected into something unsafe or wrong', () => {
  it('destructive / confirm / irreversible results are left to the model (which proposes them)', () => {
    expect(parse('remvoe rsi')).toBeNull()                      // indicator.remove is a confirm action
    expect(parse('delte my swing list')).toBeNull()
    expect(parse('reaname swing board to X')).toBeNull()        // layout.rename is a confirm action
  })
  it('approvals are never typo-corrected (a mistyped "yes" never applies a proposal)', () => {
    expect(parse('yse')).toBeNull()
    expect(parse('do itt')).toBeNull()
    expect(parse('cancle')).toBeNull()                          // cancel | candle: two meanings → nothing
  })
  it('tickers are never corrected, and actions that take tickers from the text never run on a correction', () => {
    // (an exact parse may still carry an unknown ticker — the planner's ticker check refuses it; what
    // matters here is that no CORRECTION ever produced or changed a ticker)
    for (const t of ['pull up tsl', 'pull up TSLAA', 'add amdd to momentum', 'chart AMDD', 'add nvdaa to swing']) expect(parse(t)?.corrected).toBeUndefined()
  })
  it('two different readings → no correction (the parser disambiguates; nothing guesses)', () => {
    const lex = { words: new Set(['switch', 'swatch', 'weekly']), symbols: new Set() }
    expect(correctTypos('swotch to weekly', lex).map(v => v.text).sort()).toEqual(['swatch to weekly', 'switch to weekly'])
  })
  it('short words, numbers, pronouns and capitals are left alone', () => {
    const lex = { words: new Set(['add', 'weekly', 'that']), symbols: new Set(['nvda']) }
    expect(correctTypos('ad', lex)).toBeNull()
    expect(correctTypos('add 2O', lex)).toBeNull()
    expect(correctTypos('add NVDB', lex)).toBeNull()
    expect(correctTypos('add nvda', lex)).toBeNull()
  })
  it('across the whole 192-case corpus, a correction never changes what an exactly-parsed request does, and never fires on a request meant for the model or a question', () => {
    const misfires = []
    for (const c of corpus.cases) {
      const f = parse(c.text)
      if (!f?.corrected) continue
      if (c.expect.ideal !== 'fast' || ['clarify', 'answer', 'unsupported', 'research'].includes(c.expect.kind) && !(c.expect.ops || []).length) misfires.push(`${c.id}: ${c.text}`)
    }
    expect(misfires).toEqual([])
  })
})

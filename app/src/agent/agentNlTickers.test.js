// UCT Agent — NL Intent: pronouns are never tickers (N1-safety) · grounded tickers (N4).
import { describe, it, expect } from 'vitest'
import { registerBuiltins } from './builtins'
import { fastParse } from './fastPath'
import { isPronounToken } from './nl/tickers'
import { newChartTicker } from './capabilities/workspace'
import { makeBoard } from './__fixtures__/board'

registerBuiltins()
const LISTS = [{ id: 'm1', name: 'Momentum', symbols: ['NVDA'] }, { id: 's1', name: 'Swing', symbols: ['TSLA'] }]
const board = () => makeBoard([{ id: 'c1', type: 'chart', x: 0, y: 0, w: 18, h: 20 }], { A: 'NVDA' }, { watchlists: LISTS })
const ops = (text) => { const f = fastParse(text, { host: board().host }); return f?.kind === 'ops' ? f.ops.map(o => [o.action, o.args]) : f }

describe('pronouns are never tickers', () => {
  it.each([
    ['it', 'add it to momentum', true], ['It', 'It goes in Momentum', true], ['them', 'add them', true],
    ['IT', 'ADD IT TO MOMENTUM', true],                       // all capitals: capitals mark nothing
    ['IT', 'add IT to Momentum', false],                      // capitals inside a lowercase message: a ticker
    ['$it', 'add $it to momentum', false], ['$IT', 'add $IT', false],
    ['NVDA', 'add NVDA', false], ['nvda', 'add nvda', false], ['ALL', 'add ALL to swing', false],
  ])('%s in “%s” → pronoun %s', (tok, raw, want) => expect(isPronounToken(tok, raw)).toBe(want))

  it('“add it to momentum” no longer adds the symbol IT (it goes to the model, which knows what “it” is)', () => {
    expect(ops('add it to momentum')).toBeNull()
    expect(ops('Add it to Momentum.')).toBeNull()
    expect(ops('ADD IT TO MOMENTUM')).toBeNull()
    expect(ops('put that in swing')).toBeNull()
    expect(ops('add them to momentum')).toBeNull()
    expect(ops('add AMD and it to swing')).toBeNull()        // never a partial list either
    expect(ops('remove it from momentum')).toBeNull()
  })
  it('a ticker the member marked still works: $IT, IT in capitals, real tickers', () => {
    expect(ops('add $it to momentum')).toEqual([['watchlist.add', { symbols: ['IT'] }]])
    expect(ops('add IT to Momentum')).toEqual([['watchlist.add', { symbols: ['IT'] }]])
    expect(ops('add AMD and SMCI to swing')).toEqual([['watchlist.add', { symbols: ['AMD', 'SMCI'] }]])
    expect(ops('add ALL to swing')).toEqual([['watchlist.add', { symbols: ['ALL'] }]])
  })
  it('new-chart and symbol phrases follow the same rule', () => {
    expect(newChartTicker('open a chart of it')).toBeNull()
    expect(newChartTicker('OPEN A CHART OF IT')).toBeNull()
    expect(newChartTicker('open a $IT chart')).toBe('IT')
    expect(newChartTicker('open a QQQ chart')).toBe('QQQ')
    expect(ops('change the ticker to it')).toBeNull()
    expect(ops('change the ticker to $it')).toEqual([['chart.setSymbol', { symbol: 'IT' }]])
    expect(ops('$IT')).toEqual([['chart.setSymbol', { symbol: 'IT' }]])
  })
})

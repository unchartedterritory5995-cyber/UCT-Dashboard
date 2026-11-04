// NLM-1 D2/D3 — the rewriter's units: an elliptical request → its explicit form, from the last committing message.
// (End-to-end on the real panel, final state + Undo: nlm1Workflows.test.jsx.)
import { describe, it, expect } from 'vitest'
import { rewriteFollowUp, rewriteSameRequest, nlm1Rewrite, slotsOf, positionsOf, createReferents } from './followups'

const fu = (text, prev) => rewriteFollowUp(text, prev)?.text ?? null

describe('D2 same-request references', () => {
  it('"<chart request> with <indicator>" → "… and put <indicator> on it"', () => {
    expect(rewriteSameRequest('add a chart for AMD with RSI')?.text).toBe('add a chart for AMD and put RSI on it')
    expect(rewriteSameRequest('put TSLA on the left chart with the 21 ema')?.text).toBe('put TSLA on the left chart and put the 21 ema on it')
    expect(rewriteSameRequest('add a chart for AMD with the 21 ema and make it orange')?.text).toBe('add a chart for AMD and put the 21 ema on it and make it orange')
  })
  it('"add X to it / the new one" → "put X on …"', () => {
    expect(rewriteSameRequest('add rsi to the new one')?.text).toBe('put rsi on the new one')
    expect(rewriteSameRequest('add rsi to it')?.text).toBe('put rsi on it')
  })
  it('leaves what is not a reference alone', () => {
    expect(rewriteSameRequest('open charts for AMD and QQQ, each with the 21 ema')).toBeNull()
    expect(rewriteSameRequest('find stocks with ADR above 5%')).toBeNull()
    expect(rewriteSameRequest('add a chart for AMD')).toBeNull()
  })
})

describe('D2.1 same-request mechanisms', () => {
  it('multi-ticker creation → the grid / each-with readers\' own form', () => {
    expect(rewriteSameRequest('add AMD and QQQ charts, both with RSI')?.text).toBe('open charts for AMD and QQQ, each with RSI')
    expect(rewriteSameRequest('give me AMD and META charts with the 21 ema on each')?.text).toBe('open charts for AMD and META, each with the 21 ema')
    expect(rewriteSameRequest('pull up NVDA, AMD and AVGO charts')?.text).toBe('open charts for NVDA, AMD and AVGO')
    expect(rewriteSameRequest('add AMD and QQQ charts and make the second one weekly')?.text).toBe('open charts for AMD and QQQ, then make the second one weekly')
  })
  it('a clause\'s "add X to it", never crossing into the clause before it', () => {
    expect(rewriteSameRequest('add a chart for AMD then add MACD to it')?.text).toBe('add a chart for AMD then put MACD on it')
  })
  it('a verb distributed over a list of indicators — only when every conjunct is one', () => {
    expect(rewriteSameRequest('add a chart for AMD then add RSI and MACD to it')?.text).toBe('add a chart for AMD then put RSI on it and put MACD on it')
    expect(rewriteSameRequest('add a chart for AMD and put RSI and MACD on it')?.text).toBe('add a chart for AMD and put RSI on it and put MACD on it')
    expect(rewriteSameRequest('put TSLA and MACD on it')).toBeNull()
  })
})

describe('D3 referents across turns', () => {
  it('slots of a request', () => {
    expect(slotsOf('put TSLA on the right chart')).toMatchObject({ tickers: ['TSLA'], pos: 'right', tf: null, creates: false })
    expect(slotsOf('add a chart for AMD and put RSI on it')).toMatchObject({ tickers: ['AMD'], creates: true })
    expect(positionsOf('the bottom two')).toEqual(['bottom left', 'bottom right'])
    expect(positionsOf('the top right and bottom left charts')).toEqual(['top right', 'bottom left'])
    expect(positionsOf('the other one', 'right')).toEqual(['left'])
  })
  it('same for <ticker> / one for <ticker>', () => {
    expect(fu('same for QQQ', 'add a chart for AMD and put RSI on it')).toBe('add a chart for QQQ and put RSI on it')
    expect(fu('and one for QQQ', 'add a chart for AMD')).toBe('add a chart for QQQ')
  })
  it('same on <chart> / now <chart> too / do that for <charts>', () => {
    expect(fu('now the right one too', 'make the left chart weekly')).toBe('make the right chart weekly')
    expect(fu('do the same on the right chart', 'make the left chart weekly and add rsi')).toBe('make the right chart weekly and add rsi')
    expect(fu('do the same for the bottom two', 'make the top left chart weekly')).toBe('make the bottom left chart weekly and make the bottom right chart weekly')
    expect(fu('do that for the top right and bottom left charts', 'add rsi to the top left chart')).toBe('add rsi to the top right chart and add rsi to the bottom left chart')
  })
  it('… but <timeframe> / the other one <timeframe>', () => {
    expect(fu('same but weekly', 'add a chart for TSLA')).toBe('add a chart for TSLA and make it weekly')
    expect(fu('same on the left but weekly', 'put TSLA on the right chart')).toBe('put TSLA on the left chart and make it weekly')
    expect(fu('same on the right but monthly', 'make the left chart weekly')).toBe('make the right chart monthly')
    expect(fu('and the other one monthly', 'make the right chart weekly')).toBe('make the left chart monthly')
  })
  it('borrowed verb, and "it" = the chart the last request named', () => {
    expect(fu('and QQQ on the right one', 'put TSLA on the left chart')).toBe('put QQQ on the right chart')
    expect(fu('make it weekly and add rsi', 'put TSLA on the right chart')).toBe('make the right chart weekly and add rsi')
  })
  it('never guesses', () => {
    expect(fu('same', 'make the left chart weekly')).toBeNull()                       // a bare "same" is not a request
    expect(fu('same for QQQ', 'make the left chart weekly')).toBeNull()               // no ticker to replace
    expect(fu('make it red', 'put TSLA on the right chart')).toBeNull()               // a look → the indicator readers
    expect(fu('now the right one too', 'add a chart for AMD')).toBeNull()             // a creation is not moved to a chart
    expect(fu('same for QQQ', null)).toBeNull()
  })
  it('nlm1Rewrite: only when the typed text is unread AND a reader reads the explicit form', () => {
    expect(nlm1Rewrite('same for QQQ', { prev: 'add a chart for AMD', claims: () => true })?.text).toBe('add a chart for QQQ')
    expect(nlm1Rewrite('same for QQQ', { prev: 'add a chart for AMD', claims: () => false })).toBeNull()
    expect(nlm1Rewrite('same for QQQ', { prev: 'add a chart for AMD', claims: () => true, originalClaimed: true })).toBeNull()
  })
  it('the tracker keeps the last messages by turn id, bounded', () => {
    const r = createReferents()
    for (let i = 1; i <= 30; i++) r.note(i, `m${i}`)
    expect(r.textOf(30)).toBe('m30')
    expect(r.textOf(1)).toBeNull()
  })
})

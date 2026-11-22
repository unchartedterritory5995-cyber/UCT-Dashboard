// NLM-1 D2/D3 — the rewriter's units: an elliptical request → its explicit form, from the last committing message.
// (End-to-end on the real panel, final state + Undo: nlm1Workflows.test.jsx.)
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { INPLAN_KEY } from './inplan'

// these units exercise EVERY rule, the in-plan ones included: the in-plan key (nlm1/inplan.js) is ON here — its OFF state
// is nlm1InplanGate.test.js
beforeAll(() => { localStorage.setItem(INPLAN_KEY, '1') })
afterAll(() => { localStorage.removeItem(INPLAN_KEY) })
import { rewriteFollowUp, rewriteSameRequest, rewriteClauses, nlm1Rewrite, slotsOf, positionsOf, createReferents } from './followups'

describe('D3.3 clause structure (shapes S1–S7, by structure not wording)', () => {
  const t = (x) => rewriteSameRequest(x)?.text ?? null
  it('S7 "give <target> <thing>", topicalised or not', () => {
    expect(t('give AMD rsi')).toBe('add rsi to AMD')
    expect(t('give the AMD chart a 50 sma')).toBe('add a 50 sma to the AMD chart')
    expect(t('give the TSLA chart the weekly timeframe')).toBe('make the TSLA chart weekly')
    expect(t('the QQQ chart, give it macd')).toBe('add macd to the QQQ chart')
    expect(t('pull up TSLA on the right and give it a 21 ema')).toMatch(/and put a 21 ema on it$/)
  })
  it('S4 possessives', () => {
    expect(t('add a chart for AMD and set its timeframe to weekly')).toBe('add a chart for AMD and make it weekly')
    expect(t('open a TSLA chart and change its interval to monthly')).toBe('open a TSLA chart and make it monthly')
    expect(t('new chart for META with its timeframe on weekly')).toBe('add a chart for META and make it weekly')
  })
  it('S2 a count of charts is a GRID (reuse), whatever the order', () => {
    expect(t('four charts: SPY, QQQ, NVDA and TSLA, all with rsi')).toBe('put SPY, QQQ, NVDA and TSLA on four charts, each with rsi')
    expect(t('show SPY, QQQ, IWM and DIA in four equal charts with macd on each')).toBe('put SPY, QQQ, IWM and DIA on four charts, each with macd')
  })
  it('S5 / S6 in-message "same" → steps (a ticker, or a NEW chart)', () => {
    expect(rewriteSameRequest('add rsi to NVDA and the same to AMD')?.steps).toEqual(['add rsi to NVDA', 'add rsi to AMD'])
    expect(rewriteSameRequest('give NVDA a 50 sma and AMD the same')?.steps).toEqual(['add a 50 sma to NVDA', 'add a 50 sma to AMD'])
    expect(rewriteSameRequest('make NVDA weekly and do the same with TSLA')?.steps).toEqual(['make NVDA weekly', 'make TSLA weekly'])
    expect(rewriteSameRequest('add rsi to NVDA, then open a chart for AMD and do the same there')?.steps).toEqual(['add rsi to NVDA', 'add a chart for AMD and put rsi on it'])
    expect(rewriteSameRequest('make the chart weekly, then add a chart for QQQ and do the same on it')?.steps).toEqual(['make the chart weekly', 'add a chart for QQQ and make it weekly'])
  })
  it('S1 clauses split only before a verb; a later "both of them" takes the set the clause before named', () => {
    expect(rewriteClauses('swap the two charts and add rsi to both')?.steps).toEqual(['swap the two charts', 'add rsi to the two charts'])
    expect(rewriteClauses('swap the top two charts and add rsi to both of them')?.steps).toEqual(['swap the top two charts', 'add rsi to the top two charts'])
    expect(rewriteClauses('add rsi to SPY and QQQ')).toBeNull()                       // a ticker list is never split
  })
})

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

describe('D2.2 structural normalisations (in-plan, no planner)', () => {
  it('a symbol change with a trailing timeframe and indicator', () => {
    expect(rewriteSameRequest('switch the right chart to TSLA on the weekly with RSI')?.text).toBe('switch the right chart to TSLA and make it weekly and put RSI on it')
  })
  it('tickers assigned to positions, verb or not, plus an indicator on both', () => {
    expect(rewriteSameRequest('put TSLA on the left and AMD on the right and add rsi to both')?.text).toBe('put TSLA on the left chart and put AMD on the right chart and add rsi to both charts')
    expect(rewriteSameRequest('TSLA on the left chart, META on the right one, with the 50 sma on both')?.text).toBe('put TSLA on the left chart, put META on the right chart, and add the 50 sma to both charts')
  })
  it('"…, then do the same for <ticker>" → two explicit steps', () => {
    const r = rewriteSameRequest('add a chart for AMD with RSI, then do the same for QQQ')
    expect(r?.steps).toEqual(['add a chart for AMD and put RSI on it', 'add a chart for QQQ and put RSI on it'])
  })
  it('tickers "in four equal charts"', () => {
    expect(rewriteSameRequest('show SPY, QQQ, IWM and DIA in four equal charts with macd on each')?.text).toBe('put SPY, QQQ, IWM and DIA on four charts, each with macd')   // D3.3: a count is a grid (reuse)
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

// SETH (2026-11-22): the code's shape in the registry (the study market-wide, one stock with a ticker, the shared
// MARKET word on both), how it parses, the words that find it and the words that must not, its close-spelling
// neighbours, and that it is not a stock.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { applyArgs } from './args'
import { BY_CODE, FUNCTIONS, FUNCTION_GROUPS, codesForWords, exampleFor, isCode, suggest, variantFor } from './functions'
import { isTickerCollision } from './grammar'
import parseCommand from './parseCommand'
import { PANEL_IMPORTERS } from './panels'
import { resolvePanel } from './TerminalShell'
import { writeBackCommand } from './panels/commandWriteBack'
import { SETH_CODE } from './panels/setupHistoryModel'
import { marketViewArgs } from './panels/marketViewModel'

describe('SETH in the registry', () => {
  it('the model names the code; it is registered once, in the Market group, with a market and a stock variant', () => {
    expect(SETH_CODE).toBe('SETH')
    expect(FUNCTIONS.filter((f) => f.code === 'SETH')).toHaveLength(1)
    expect(FUNCTION_GROUPS).toContain(BY_CODE.SETH.group)
    expect(BY_CODE.SETH.group).toBe('Market')
    expect(BY_CODE.SETH.label).toBe('How setups acted (breakouts, pullbacks, gaps in every correction and rally)')
    for (const scope of ['market', 'ticker']) {
      expect(BY_CODE.SETH[scope]).toEqual({ panel: 'SetupHistory', args: [{ kind: 'marketView', prop: 'view' }] })
      expect(BY_CODE.SETH[scope].flag).toBeUndefined()              // no switch: the routes have their own paid gate
    }
    expect(exampleFor(BY_CODE.SETH)).toBe('SETH')
    expect(variantFor('SETH', false)).toMatchObject({ scope: 'market' })
    expect(variantFor('SETH', true)).toMatchObject({ scope: 'ticker' })
    expect(typeof PANEL_IMPORTERS.SetupHistory).toBe('function')
  })

  it('SETH and NVDA SETH parse as the function, and MARKET is an argument, never a ticker', () => {
    expect(isCode('seth')).toBe(true)
    expect(parseCommand('SETH')).toMatchObject({ ok: true, type: 'function', code: 'SETH', sym: null, args: [] })
    expect(parseCommand('NVDA SETH')).toMatchObject({ ok: true, code: 'SETH', sym: 'NVDA' })
    expect(parseCommand('seth market')).toMatchObject({ ok: true, code: 'SETH', sym: null, args: ['MARKET'] })
    expect(applyArgs(BY_CODE.SETH.ticker, ['MARKET']).props).toEqual({ view: 'market' })
    expect(applyArgs(BY_CODE.SETH.market, ['MKT', 'MARKET']).ignored).toEqual(['MARKET'])
    expect(writeBackCommand('SETH', marketViewArgs(true))).toBe('SETH MARKET')
    expect(parseCommand('SETH').collision).toBeUndefined()
  })

  it('on a panel that follows a stock, bare SETH is that stock and SETH MARKET keeps the study', () => {
    const linked = resolvePanel({ id: 'p1', code: 'SETH', args: ['MARKET'], channel: 'A' }, { A: 'QQZA' }, null)
    expect(linked).toMatchObject({ state: 'ready', sym: 'QQZA', props: { view: 'market' } })
    const bare = resolvePanel({ id: 'p1', code: 'SETH', args: [], channel: 'A' }, { A: 'QQZA' }, null)
    expect(bare).toMatchObject({ state: 'ready', sym: 'QQZA' })
    expect(bare.props.view).toBeUndefined()
  })

  it('its words find it, and the words other functions answer to stay theirs', () => {
    for (const w of ['setup history', 'how setups acted', 'breakout history', 'setup backtest', 'setups by market phase']) {
      expect([w, codesForWords(w)[0]]).toEqual([w, 'SETH'])
    }
    // generic single words never find it first (the label's own words, 'acted', 'pullbacks', 'gaps', may: they name it)
    expect(codesForWords('setups')[0]).toBe('BRKO')
    expect(codesForWords('breakout')[0]).toBe('BRKO')
    expect(codesForWords('corrections')[0]).toBe('MKTH')
    expect(codesForWords('rallies')[0]).toBe('MKTH')
    for (const w of ['history', 'setup', 'study', 'returns', 'market', 'stock', 'signals']) {
      expect([w, codesForWords(w)[0]]).not.toEqual([w, 'SETH'])
    }
  })

  it('a member typing a near spelling of another code is not sent here first', () => {
    for (const t of ['STAT', 'SENT', 'SCTR', 'SEAS']) {
      expect([t, suggest(t)[0]]).not.toEqual([t, 'SETH'])
    }
  })

  it('the code is not a stock the site follows', () => {
    const universe = new Set(JSON.parse(fs.readFileSync(path.join(process.cwd(), '..', 'api', 'data', 'cap_universe.json'), 'utf8')))
    expect(universe.size).toBeGreaterThan(3000)
    expect(universe.has('NVDA')).toBe(true)                          // the control: the list is the ticker list
    expect(universe.has('SETH')).toBe(false)
    expect(isTickerCollision('SETH')).toBe(false)
  })
})

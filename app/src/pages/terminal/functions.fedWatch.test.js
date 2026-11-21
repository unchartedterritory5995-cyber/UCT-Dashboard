// FED (2026-11-21): the code's shape in the registry, how it parses, and the words that find it.
//
// FED is market-wide and takes no argument. Its words must find it without taking a word another
// function already answers to: "interest rates" and "yield curve" stay with RATES, "earnings
// calendar" with CAL, "headlines" with NEWS.
import { describe, it, expect } from 'vitest'
import { applyArgs } from './args'
import { BY_CODE, FUNCTIONS, FUNCTION_GROUPS, codesForWords, exampleFor, isCode, variantFor } from './functions'
import parseCommand from './parseCommand'
import { PANEL_IMPORTERS } from './panels'
import { FED_CODE } from './panels/fedWatchModel'

describe('FED in the registry', () => {
  it('the model names the code, it is registered once, in the Market group, market-wide, with no argument', () => {
    expect(FED_CODE).toBe('FED')
    expect(FUNCTIONS.filter((f) => f.code === 'FED')).toHaveLength(1)
    expect(FUNCTION_GROUPS).toContain(BY_CODE.FED.group)
    expect(BY_CODE.FED.group).toBe('Market')
    expect(BY_CODE.FED.label).toBe('Fed watch (statements, speeches, Fed headlines, the next meeting)')
    expect(BY_CODE.FED.market).toEqual({ panel: 'FedWatch' })
    expect(BY_CODE.FED.ticker).toBeUndefined()
    expect(exampleFor(BY_CODE.FED)).toBe('FED')
    expect(variantFor('FED', false)).toMatchObject({ scope: 'market' })
    expect(applyArgs(BY_CODE.FED.market, ['DOVISH']).ignored).toEqual(['DOVISH'])       // said, never guessed at
    expect(typeof PANEL_IMPORTERS.FedWatch).toBe('function')
  })

  it('FED parses as the function, lower case too', () => {
    expect(isCode('fed')).toBe(true)
    expect(parseCommand('FED')).toMatchObject({ ok: true, type: 'function', code: 'FED', sym: null })
    expect(parseCommand('fed')).toMatchObject({ ok: true, type: 'function', code: 'FED' })
  })

  it('its words find it, and the words other functions answer to stay theirs', () => {
    for (const w of ['fomc', 'federal reserve', 'fed speakers', 'powell', 'fed statement', 'rate decision', 'dot plot']) {
      expect([w, codesForWords(w)[0]]).toEqual([w, 'FED'])
    }
    expect(codesForWords('interest rates')[0]).toBe('RATES')
    expect(codesForWords('yield curve')[0]).toBe('RATES')
    expect(codesForWords('headlines')[0]).toBe('NEWS')
  })
})

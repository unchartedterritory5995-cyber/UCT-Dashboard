// "Can't be drawn here", in a member's words (Indicators backlog 25).
//
// A member read: "RS can't be drawn here: `SPY`'s bars for this timeframe are not in hand", and for a
// venue case a sentence naming a capture-queue row. The refusals about ANOTHER SYMBOL are now worded
// from their code; every other refusal keeps the engine's own sentence.

import { describe, it, expect } from 'vitest'
import { chartRefusalWords } from './memberWords'
import { replyLines } from './authoringSession'
import { OTHER_SYMBOL_REFUSAL } from '../../engine/otherSymbols'
import CONVERSE_BOX_SRC from '../ConverseBox.jsx?raw'

const ENGINE = "`SPY`'s bars for this timeframe are not in hand (loading)"
const ENGINEER_WORDS = /`|in hand|capture-queue|witnessed|spelling|venue/i

describe('chartRefusalWords', () => {
  it('no prices for the other symbol: names it, in plain words', () => {
    expect(chartRefusalWords(OTHER_SYMBOL_REFUSAL.NO_BARS, ENGINE)).toBe("SPY's prices are not available on this timeframe.")
    expect(chartRefusalWords(OTHER_SYMBOL_REFUSAL.NO_BARS, '`NASDAQ:qqq` ...')).toBe("QQQ's prices are not available on this timeframe.")
  })

  it('stands without a ticker in the engine text', () => {
    expect(chartRefusalWords(OTHER_SYMBOL_REFUSAL.NO_BARS, '')).toBe('a symbol it reads has no prices on this timeframe.')
  })

  it('every other-symbol code gets a member sentence with no engineer wording', () => {
    for (const code of Object.values(OTHER_SYMBOL_REFUSAL)) {
      const said = chartRefusalWords(code, '`AMEX:SPY` is witnessed on D charts only (capture-queue row 12), and this chart is `5`')
      expect(said, code).toBeTruthy()
      expect(said, code).not.toMatch(ENGINEER_WORDS)
      expect(said, code).toMatch(/SPY/)
    }
  })

  it('CONTROL: a refusal that is not about another symbol has no member wording here', () => {
    for (const g of ['lint:repaint', 'refused', '', null, undefined, 'engine:error']) expect(chartRefusalWords(g, 'x')).toBeNull()
  })
})

describe('where a member reads it', () => {
  const change = (guard, text) => ({ op: null, kind: 'refused-on-chart', output: 'RS', guard, text })

  it('the dock says it in member words', () => {
    const [line] = replyLines({ outputs: [] }, {}, [change(OTHER_SYMBOL_REFUSAL.NO_BARS, ENGINE)])
    expect(line).toBe("RS can't be drawn here: SPY's prices are not available on this timeframe.")
    expect(line).not.toMatch(ENGINEER_WORDS)
  })

  it('CONTROL: another refusal keeps the engine’s own sentence', () => {
    const [line] = replyLines({ outputs: [] }, {}, [change('lint:repaint', 'it reads a later bar')])
    expect(line).toBe("RS can't be drawn here: it reads a later bar")
  })

  it('the builder’s Ask tab uses the same wording (source rail; comments stripped)', () => {
    const code = CONVERSE_BOX_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
    expect(code).toMatch(/chartRefusalWords\(c\.guard, c\.text\) \|\| withoutGuardIds\(c\.text\)/)
  })
})

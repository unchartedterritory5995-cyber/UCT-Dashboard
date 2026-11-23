// ⭐ P0.2 (INV1 B F1-c, assessment 2026-11-23): LEFTOVER WORDS NEVER BECOME AN ARGUMENT VALUE. The colour reader used to put every
// word between the indicator and the colour into the free-text `output` arg ("make the rsi pane bigger plus make the rsi red" →
// output "pane bigger plus make the rsi"), claimed with no model turn and refused with nonsense ("undefined has more than one
// color"). Generated: indicators × second intents × the connectors that do not split a sentence. Every such sentence is now NOT
// read by the colour reader (it goes to the model); a real output name still is.
import { describe, it, expect } from 'vitest'
import { registerBuiltins } from './builtins'
import { colorOfWords, namesColorOutput } from './capabilities/indicatorPhrases'
import { fastParse } from './fastPath'

registerBuiltins()
const SUBJECTS = ['rsi', 'macd', '20 ema', 'sma 50', 'vwap', 'bollinger bands', 'atr']
const SECOND = ['pane bigger', 'pane smaller', 'line thicker', 'line dashed', '3px', 'pane taller', 'line thinner', 'histogram bigger']
const CONNECT = ['plus', 'with', 'but also', 'while', 'as well as', 'also', '+', 'and also', 'along with']
const sentences = []
for (const s of SUBJECTS) for (const c2 of SECOND) for (const k of CONNECT) sentences.push(`make the ${s} ${c2} ${k} make the ${s} red`)

describe('leftover words never become the colour reader\'s `output`', () => {
  it(`${sentences.length} two-intent sentences: the colour reader declines every one`, () => {
    const claimed = sentences.map(t => [t, colorOfWords(t)]).filter(([, r]) => r)
    expect(claimed).toEqual([])
  })
  it('…and no instant reader turns one into a colour change with a leftover output', () => {
    const host = { charts: { list: () => [], read: () => null } }
    const bad = []
    for (const t of sentences) {
      let r = null
      try { r = fastParse(t, { host }) } catch { r = null }
      for (const o of r?.ops || []) if (o.action === 'indicatorStyle.set' && o.args?.output && !namesColorOutput(o.args.instance, o.args.output)) bad.push([t, o.args.output])
    }
    expect(bad).toEqual([])
  })
  it('controls: a real output name is still read', () => {
    expect(colorOfWords('make the macd signal line red')).toMatchObject({ instance: 'macd', property: 'color', value: 'red', output: 'signal' })
    expect(colorOfWords('make the macd histogram green')).toMatchObject({ instance: 'macd', value: 'green' })
    expect(colorOfWords('make the rsi red')).toMatchObject({ instance: 'rsi', property: 'color', value: 'red', output: null })
    expect(colorOfWords('change the 20 ema colour to blue')).toMatchObject({ instance: '#20:ema', value: 'blue', output: null })
    expect(colorOfWords('make the macd up bars green')).toMatchObject({ instance: 'macd', property: 'upColor' })
  })
})

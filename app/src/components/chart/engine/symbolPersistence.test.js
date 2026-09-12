import { describe, it, expect } from 'vitest'
import {
  parseSource, symbolSource, symbolsNeeded,
  severReferencesTo, severedSource, isSeveredSource, sourceDependsOn,
} from './sourceRef'

// ─── P1.6 · PERSISTENCE AND THE TWO LIFECYCLES ──────────────────────────────
//
// ⭐⭐ THE WHOLE PERSISTENCE STORY IS "A SOURCE IS A STRING IN AN INPUT", so the
// tests that matter are not about a new schema — there isn't one. They are about
// the two lifecycles staying separate, and about an old settings blob being
// untouched by a load.

const SECURITY = 'QQQ'
const BREADTH = 'UCTA50'
const FAMILIES = [['security', SECURITY], ['breadth', BREADTH]]

const MA = 'movingAverage'
const defOf = () => ({
  id: MA,
  inputs: [
    { key: 'source', type: 'source', default: 'close' },
    { key: 'period', type: 'int', default: 5 },
  ],
})

const csWith = (instances) => ({
  indicatorInstances: instances,
  background: '#f3efe4',
  someUnrelatedSetting: true,
})

describe('round trip — no schema, no migration', () => {
  it.each(FAMILIES)('%s: a symbol source survives a JSON round trip unchanged', (_l, sym) => {
    const cs = csWith([
      { instanceId: 'legacy:movingAverage', defId: MA, inputs: { source: symbolSource(sym, 'close'), period: 20 } },
    ])
    const reloaded = JSON.parse(JSON.stringify(cs))
    expect(reloaded).toEqual(cs)
    const value = reloaded.indicatorInstances[0].inputs.source
    expect(parseSource(value)).toEqual({ kind: 'symbol', symbol: sym, field: 'close' })
  })

  it('⭐ it rides `inputs` like any other value — no new key appears anywhere', () => {
    const cs = csWith([
      { instanceId: 'a', defId: MA, inputs: { source: symbolSource(SECURITY, 'close'), period: 20 } },
    ])
    expect(Object.keys(cs.indicatorInstances[0])).toEqual(['instanceId', 'defId', 'inputs'])
    expect(Object.keys(cs.indicatorInstances[0].inputs).sort()).toEqual(['period', 'source'])
  })

  it('⛔⛔ AN OLD SETTINGS BLOB IS BYTE-IDENTICAL AFTER BEING READ', () => {
    // The no-write-on-load rule, which is what makes this additive. An old chart
    // cannot contain the new form, and reading one must not create it.
    const old = csWith([
      { instanceId: 'legacy:movingAverage', defId: MA, inputs: { source: 'close', period: 20 } },
      { instanceId: 'legacy:rsi', defId: 'rsi', inputs: {} },
    ])
    const before = JSON.stringify(old)
    symbolsNeeded(old.indicatorInstances, defOf)      // the discovery pass reads it
    for (const i of old.indicatorInstances) parseSource(i.inputs.source)
    expect(JSON.stringify(old)).toBe(before)
  })

  it('⭐ a chart with no symbol sources needs nothing — the feature costs it zero', () => {
    const old = csWith([{ instanceId: 'legacy:movingAverage', defId: MA, inputs: { source: 'close' } }])
    expect(symbolsNeeded(old.indicatorInstances, defOf)).toEqual([])
  })
})

describe('⛔⛔ THE TWO LIFECYCLES — the distinction this phase must not blur', () => {
  it('deleting an INSTANCE severs references to it, as it always did', () => {
    const cs = csWith([
      { instanceId: 'legacy:rsi', defId: 'rsi', inputs: {} },
      { instanceId: 'legacy:movingAverage', defId: MA, inputs: { source: '@legacy:rsi::rsi', period: 5 } },
    ])
    const next = severReferencesTo(cs, 'legacy:rsi', defOf)
    const ma = next.indicatorInstances.find((i) => i.defId === MA)
    expect(isSeveredSource(ma.inputs.source)).toBe(true)
    expect(parseSource(ma.inputs.source)).toBeNull()          // deliberately unreadable
    expect(ma.inputs.source).toContain('@legacy:rsi::rsi')    // the gravestone keeps the text
  })

  it.each(FAMILIES)('⭐⭐ %s: deleting ANY instance NEVER severs a symbol source', (_l, sym) => {
    // Nobody deletes QQQ. A symbol source is not owned by a chart instance, so no
    // instance deletion — not even of a consumer's neighbour — may turn it into a
    // gravestone.
    const cs = csWith([
      { instanceId: 'legacy:rsi', defId: 'rsi', inputs: {} },
      { instanceId: 'legacy:movingAverage', defId: MA, inputs: { source: symbolSource(sym, 'close'), period: 5 } },
    ])
    const next = severReferencesTo(cs, 'legacy:rsi', defOf)
    const ma = next.indicatorInstances.find((i) => i.defId === MA)
    expect(ma.inputs.source).toBe(symbolSource(sym, 'close'))
    expect(isSeveredSource(ma.inputs.source)).toBe(false)
    expect(parseSource(ma.inputs.source).kind).toBe('symbol')
  })

  it('⭐⭐ REMOVING THE LAST CONSUMER DOES NOT RETIRE THE INSTRUMENT', () => {
    // The symmetric half: with no consumers the symbol is simply not needed this
    // paint. Nothing is tombstoned, so adding it back is not a resurrection.
    const withIt = csWith([
      { instanceId: 'a', defId: MA, inputs: { source: symbolSource(SECURITY, 'close') } },
    ])
    expect(symbolsNeeded(withIt.indicatorInstances, defOf)).toEqual([SECURITY])

    const without = csWith([])
    expect(symbolsNeeded(without.indicatorInstances, defOf)).toEqual([])

    const again = csWith([
      { instanceId: 'b', defId: MA, inputs: { source: symbolSource(SECURITY, 'close') } },
    ])
    // ⛔ THE OPPOSITE OF THE INSTANCE RULE, ON PURPOSE. A re-added RSI must NOT
    // reconnect because it is a different logical instance; a re-added QQQ MUST
    // resolve because it is the same instrument it always was.
    expect(symbolsNeeded(again.indicatorInstances, defOf)).toEqual([SECURITY])
    expect(parseSource(again.indicatorInstances[0].inputs.source))
      .toEqual(parseSource(withIt.indicatorInstances[0].inputs.source))
  })

  it('⛔ a severed symbol string is still a gravestone if something made one', () => {
    // Nothing in the product creates this, but if a string ever arrives severed
    // it must stay unreadable rather than quietly resolving.
    const dead = severedSource(symbolSource(SECURITY, 'close'))
    expect(parseSource(dead)).toBeNull()
    expect(sourceDependsOn(dead)).toBeNull()
    expect(symbolsNeeded([{ instanceId: 'a', defId: MA, inputs: { source: dead } }], defOf)).toEqual([])
  })
})

describe('an unavailable source keeps its configuration', () => {
  it('⛔ a symbol the bar layer cannot serve is RETAINED, not rewritten', () => {
    // Availability is a runtime fact. The member asked for this instrument and
    // the setting must still say so tomorrow, when it may resolve again.
    const cs = csWith([
      { instanceId: 'a', defId: MA, inputs: { source: 'sym:^IXIC:close', period: 5 } },
    ])
    const before = JSON.stringify(cs)
    expect(symbolsNeeded(cs.indicatorInstances, defOf)).toEqual(['^IXIC'])
    expect(JSON.stringify(cs)).toBe(before)
    expect(parseSource(cs.indicatorInstances[0].inputs.source))
      .toEqual({ kind: 'symbol', symbol: '^IXIC', field: 'close' })
  })

  it('⛔ a malformed source is unresolved but still stored verbatim', () => {
    const cs = csWith([{ instanceId: 'a', defId: MA, inputs: { source: 'sym:QQQ:hl2' } }])
    expect(parseSource(cs.indicatorInstances[0].inputs.source)).toBeNull()
    expect(cs.indicatorInstances[0].inputs.source).toBe('sym:QQQ:hl2')
  })
})

describe('label independence', () => {
  it('⭐ identity carries no label, so a rename cannot change the source', () => {
    const a = symbolSource(SECURITY, 'close')
    const b = symbolSource(SECURITY, 'close')
    expect(a).toBe(b)
    // Nothing display-shaped is in the string: no name, no colour, no pane,
    // no timeframe.
    expect(a).not.toMatch(/Invesco|Nasdaq|#|pane|1D|line/i)
  })
})

import { describe, it, expect } from 'vitest'
import { resolveDisplayTarget, volumeOverlayKeys } from '../displayTarget'
import { setInstanceDisplayTarget, setInstancePanePosition } from '../instanceControls'
import * as registry from '../nativeRegistry'

const inst = (over = {}) => ({
  instanceId: 'legacy:rsi', defId: 'rsi', defVersion: 1, inputs: {}, hidden: false, ...over,
})

const csWith = (instances, legacy) => ({
  indicatorInstances: instances,
  ...(legacy ? { volumeOverlayIndicators: legacy } : {}),
})

describe('resolveDisplayTarget — the precedence IS the contract', () => {
  it('1 · an explicit instance placement wins over everything', () => {
    // …including a legacy list that says the opposite.
    expect(resolveDisplayTarget(
      inst({ placement: { target: 'volume' } }), csWith([], []),
    )).toBe('volume')
  })

  it('⛔⛔ …but a target that RESTATES THE DEFINITION is not an override', () => {
    // ⚰️ THIS CASE USED TO ASSERT THE OPPOSITE, with `{target:'pane'}` beating a
    // legacy list. The reason it changed is the first indicator whose correct
    // target is not static: `addInstance` and the migrator BOTH write
    // `placement: { target: <the declared one> }` on every instance they create,
    // expressing no user intent at all — and that copy outranked `MA(RSI)`'s
    // derived answer forever. Measured live: a perfect average of RSI, drawn on
    // the candles' scale.
    //
    // ⚠️ IT COSTS NOTHING, because the pairing below is one the SETTER cannot
    // produce. `setInstanceDisplayTarget` removes the id from the legacy list in
    // the same write that sends it home, so "explicitly pane AND still listed as
    // a volume overlay" is hand-written state, not a chart anybody has.
    expect(resolveDisplayTarget(
      inst({ placement: { target: 'pane' } }), csWith([], ['rsi']),
    )).toBe('volume')
    // …and the SETTER's answer to the same question is the right one, because it
    // leaves the two in step.
    const sent = setInstanceDisplayTarget(
      { indicatorInstances: [inst()], volumeOverlayIndicators: ['rsi'] },
      'legacy:rsi', 'pane', registry,
    )
    expect(sent.volumeOverlayIndicators).toEqual([])
    expect(resolveDisplayTarget(sent.indicatorInstances[0], sent)).toBe('pane')
  })

  it('2 · with no explicit placement, the legacy list is read', () => {
    expect(resolveDisplayTarget(inst(), csWith([], ['rsi']))).toBe('volume')
  })

  it('3 · and with neither, the definition decides', () => {
    expect(resolveDisplayTarget(inst(), csWith([], []))).toBe('pane')
  })

  it('⛔ only a PANE oscillator can be overlaid — a price overlay in the list keeps its target', () => {
    // `bb` draws on the candles' own scale. A legacy list naming it is data that
    // nothing writes, and honouring it would send it somewhere it cannot draw.
    const bb = registry.getDefinition('bb')
    expect(bb?.placement?.target, 'bb is not a price overlay — pick another probe').toBe('price')
    expect(resolveDisplayTarget(
      { instanceId: 'legacy:bb', defId: 'bb' }, csWith([], ['bb']),
    )).toBe('price')
  })

  it('answers null for input it cannot place rather than guessing', () => {
    expect(resolveDisplayTarget(null, csWith([], []))).toBe(null)
    expect(resolveDisplayTarget({ defId: 42 }, csWith([], []))).toBe(null)
    expect(resolveDisplayTarget({ defId: 'no-such-indicator' }, csWith([], []))).toBe(null)
  })
})

describe('volumeOverlayKeys', () => {
  it('collects the canonical and the legacy answers into one set', () => {
    const cs = csWith([inst({ placement: { target: 'volume' } })], ['stoch'])
    expect([...volumeOverlayKeys(cs.indicatorInstances, cs)].sort()).toEqual(['rsi', 'stoch'])
  })

  it('⛔ a HIDDEN instance reserves nothing — it is subtracted from the pane stack', () => {
    const cs = csWith([inst({ hidden: true, placement: { target: 'volume' } })], [])
    expect(volumeOverlayKeys(cs.indicatorInstances, cs).has('rsi')).toBe(false)
  })

  it('⭐ sending it home actually works — through the SETTER, which keeps both in step', () => {
    // Not by hand-writing `{target:'pane'}` beside a legacy entry that still says
    // volume: those two disagree, and the resolver believes the legacy one (see
    // the precedence case above). The setter writes the pair that agrees.
    const sent = setInstanceDisplayTarget(
      { indicatorInstances: [inst()], volumeOverlayIndicators: ['rsi'] },
      'legacy:rsi', 'pane', registry,
    )
    expect(volumeOverlayKeys(sent.indicatorInstances, sent).has('rsi')).toBe(false)
  })

  it('…but a legacy id with NO instance still counts', () => {
    // The toolbar checkbox writes the list directly and always has. Dropping
    // these would move a user's overlay back into its own pane on upgrade.
    const cs = csWith([], ['rsi'])
    expect(volumeOverlayKeys(cs.indicatorInstances, cs).has('rsi')).toBe(true)
  })
})

describe('setInstanceDisplayTarget', () => {
  const base = () => ({ indicatorInstances: [inst()], volumeOverlayIndicators: [] })

  it('writes the canonical target and keeps the legacy list in step', () => {
    const next = setInstanceDisplayTarget(base(), 'legacy:rsi', 'volume', registry)
    // ⭐ 2026-09-15 — AND IT NOW RECORDS THAT A MEMBER CHOSE IT. `targetExplicit`
    // is written WITH the target and never apart from it: a target without the
    // marker is LEGACY state (read by the old `explicit !== declared` rule), and a
    // marker without a target would be a claim about nothing. See
    // `__tests__/displayTargetProvenance.test.js` for why inference was not enough.
    expect(next.indicatorInstances[0].placement).toEqual({ target: 'volume', targetExplicit: true })
    expect(next.volumeOverlayIndicators).toEqual(['rsi'])
  })

  it('⛔ "pane" DELETES the key — the default has one spelling', () => {
    const sent = setInstanceDisplayTarget(base(), 'legacy:rsi', 'volume', registry)
    const home = setInstanceDisplayTarget(sent, 'legacy:rsi', 'pane', registry)
    expect(home.indicatorInstances[0].placement).toBeUndefined()
    expect(home.volumeOverlayIndicators).toEqual([])
  })

  it('⭐⭐ TARGET AND POSITION ARE INDEPENDENT — a round trip through Volume keeps "above"', () => {
    // The preference the owner called out: overlaying RSI onto Volume must not
    // silently demote it from Above Price when it comes home.
    let cs = setInstancePanePosition(base(), 'legacy:rsi', 'above', registry)
    expect(cs.indicatorInstances[0].placement).toEqual({ position: 'above' })

    cs = setInstanceDisplayTarget(cs, 'legacy:rsi', 'volume', registry)
    expect(cs.indicatorInstances[0].placement, 'the pane position was erased by the move')
      .toEqual({ position: 'above', target: 'volume', targetExplicit: true })

    cs = setInstanceDisplayTarget(cs, 'legacy:rsi', 'pane', registry)
    expect(cs.indicatorInstances[0].placement, 'it did not come home ABOVE price')
      .toEqual({ position: 'above' })
  })

  it('refuses a target it does not offer, and an instance it cannot find', () => {
    const cs = base()
    // ⭐ `price` USED TO BE REFUSED HERE and now is not. It was always resolvable
    // (`placement.js` has handled it since the first pass) and was withheld only
    // because nothing offered it; the derived-target work needs it writable, so
    // "a target it does not offer" now means a target that is not a target.
    const toPrice = setInstanceDisplayTarget(cs, 'legacy:rsi', 'price', registry)
    expect(toPrice).not.toBe(cs)
    expect(toPrice.indicatorInstances[0].placement).toEqual({ target: 'price', targetExplicit: true })
    expect(setInstanceDisplayTarget(cs, 'legacy:rsi', 'nowhere', registry)).toBe(cs)
    expect(setInstanceDisplayTarget(cs, 'inst:nope:9', 'volume', registry)).toBe(cs)
  })

  it('does not duplicate an id the legacy list already names', () => {
    const cs = { indicatorInstances: [inst()], volumeOverlayIndicators: ['rsi'] }
    const next = setInstanceDisplayTarget(cs, 'legacy:rsi', 'volume', registry)
    expect(next.volumeOverlayIndicators).toEqual(['rsi'])
  })
})

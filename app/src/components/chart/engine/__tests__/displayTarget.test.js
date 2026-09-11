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
    // …including a legacy list that says the opposite, in BOTH directions.
    expect(resolveDisplayTarget(
      inst({ placement: { target: 'volume' } }), csWith([], []),
    )).toBe('volume')
    expect(resolveDisplayTarget(
      inst({ placement: { target: 'pane' } }), csWith([], ['rsi']),
    )).toBe('pane')
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

  it('⭐ an explicit "pane" OVERRIDES the legacy list — sending it home actually works', () => {
    const cs = csWith([inst({ placement: { target: 'pane' } })], ['rsi'])
    expect(volumeOverlayKeys(cs.indicatorInstances, cs).has('rsi')).toBe(false)
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
    expect(next.indicatorInstances[0].placement).toEqual({ target: 'volume' })
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
      .toEqual({ position: 'above', target: 'volume' })

    cs = setInstanceDisplayTarget(cs, 'legacy:rsi', 'pane', registry)
    expect(cs.indicatorInstances[0].placement, 'it did not come home ABOVE price')
      .toEqual({ position: 'above' })
  })

  it('refuses a target it does not offer, and an instance it cannot find', () => {
    const cs = base()
    expect(setInstanceDisplayTarget(cs, 'legacy:rsi', 'price', registry)).toBe(cs)
    expect(setInstanceDisplayTarget(cs, 'legacy:rsi', 'nowhere', registry)).toBe(cs)
    expect(setInstanceDisplayTarget(cs, 'inst:nope:9', 'volume', registry)).toBe(cs)
  })

  it('does not duplicate an id the legacy list already names', () => {
    const cs = { indicatorInstances: [inst()], volumeOverlayIndicators: ['rsi'] }
    const next = setInstanceDisplayTarget(cs, 'legacy:rsi', 'volume', registry)
    expect(next.volumeOverlayIndicators).toEqual(['rsi'])
  })
})

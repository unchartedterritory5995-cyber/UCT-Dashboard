// app/src/components/chart/engine/__tests__/priceScaleNonePin.test.js
//
// ─── `indicator(scale = scale.none)` IS THE AUTHOR'S "No scale" (2026-11-26) ──
//
// TradingView draws such a script's plots on an overlay scale of their own, with no axis, that fills the pane. The
// translator records the word (`presentation.scale`); the minted definition carries it as the DEFAULT of the member's
// "Pin to scale" (`placement.pinScale`), which `placement.js` answers with the instance's own invisible scale. A
// member's own pick on the instance overrides it.

import { describe, it, expect } from 'vitest'
import { translatePine } from '../ast/pine'
import { memberPaneDefinition, declaredPinScale } from '../../builder/memberPane/memberPaneDefinition'
import { validateDefinition, PLACEMENT_PIN_SCALES } from '../defSchema'
import { resolvePlacement, pinScaleOf, defaultPinScaleOf, PIN_SCALE_CHOICES, MAIN_PRICE_SCALE_ID } from '../placement'

const script = (decl) => `//@version=5\n${decl}\nplot(close * 0.4, "parked")\n`
const NONE = script('indicator("N", overlay = true, scale = scale.none)')
const LEFT = script('indicator("N", overlay = true, scale = scale.left)')
const RIGHT = script('indicator("N", overlay = true, scale = scale.right)')
const BARE = script('indicator("N", overlay = true)')
const PANE_NONE = script('indicator("N", scale = scale.none)')

const host = (src) => translatePine(src, { strict: true })
const mint = (src) => memberPaneDefinition({ source: src, id: 'u_pin_test', name: 'N' })
const inst = (extra = {}) => ({ instanceId: 'n1', defId: 'u_pin_test', inputs: {}, ...extra })

describe('the declaration', () => {
  it('only an overlay script declaring scale.none asks for "No scale"', () => {
    expect(declaredPinScale(host(NONE))).toBe('none')
    for (const src of [LEFT, RIGHT, BARE, PANE_NONE]) expect(declaredPinScale(host(src))).toBeNull()
    expect(declaredPinScale(null)).toBeNull()
  })
})

describe('the minted definition', () => {
  it('scale.none: on price, pinScale "none", valid; the others carry no pinScale', () => {
    const n = mint(NONE)
    expect(n.ok, JSON.stringify(n.reason || null)).toBe(true)
    expect(n.definition.placement).toEqual({ target: 'price', pinScale: 'none' })
    expect(validateDefinition(n.definition).errors || []).toEqual([])
    for (const src of [LEFT, RIGHT, BARE]) {
      const d = mint(src).definition
      expect(d.placement.pinScale, src).toBeUndefined()
    }
    expect(mint(PANE_NONE).definition.placement.target).toBe('pane')
  })

  it('the schema admits only the chart\'s choices', () => {
    const doc = mint(NONE).definition
    for (const bad of ['left', 'right', true, 1, null]) {
      const d = { ...doc, placement: { ...doc.placement, pinScale: bad } }
      expect((validateDefinition(d).errors || []).some((e) => /placement\.pinScale/.test(e)), String(bad)).toBe(true)
    }
    expect(PIN_SCALE_CHOICES).toBe(PLACEMENT_PIN_SCALES)
  })
})

describe('the chart', () => {
  const DOC = mint(NONE).definition
  it('the declaration is the default: the instance draws on its own scale', () => {
    expect(defaultPinScaleOf(DOC)).toBe('none')
    const p = resolvePlacement(inst(), DOC, {})
    expect(p.scaleId).toBe('pin:n1')
    expect(p.autoscale).toBe('default')
  })

  it('the member\'s pick overrides it', () => {
    expect(pinScaleOf(inst({ placement: { pinScale: 'price' } }), DOC)).toBe('price')
    expect(resolvePlacement(inst({ placement: { pinScale: 'price' } }), DOC, {}).scaleId).toBe(MAIN_PRICE_SCALE_ID)
  })

  it('CONTROL: a script declaring no scale keeps the candles\' scale', () => {
    expect(resolvePlacement(inst(), mint(BARE).definition, {}).scaleId).toBe(MAIN_PRICE_SCALE_ID)
  })
})

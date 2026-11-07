// app/src/components/chart/engine/placement.axisHidden.test.js
//
// ─── A4: `placement.axis: 'hidden'` — THE PANE'S AXIS, ANSWERED IN PLACEMENT ──
//
// Phase 2a visual spec A4 (owner decision D6): the RS pane carries no price axis —
// no tick labels, no last-value tag, no crosshair price label in its gutter — and
// still autoscales. The definition-side field and its validation belong to unit
// VA2 (`defSchema.js`, `nativeRegistry.js`); this file pins the ENGINE half: what
// `resolvePlacement` and `applyAxisTenancy` answer for a definition that asks.
//
// The fixture is the real `rsLine` definition with the field set, i.e. exactly
// what VA2 declares. The controls are RSI and MACD, whose answers must not move.
//
// ⛔ WHY NOT `visible: false`: on lightweight-charts 5.2.0 that option wedges the
// chart for any pane but the first and leaks into every pane created afterwards.
// Measured on a real chart in `__tests__/axisHiddenRealChart.test.js`; the
// reasoning is at `HIDDEN_AXIS_SCALE_ID` in `placement.js`.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  resolvePlacement, applyAxisTenancy, axisHiddenOf, HIDDEN_AXIS_SCALE_ID, PANE_BAND,
} from './placement'
import { __setPaneModeForTest } from './paneLayout'
import * as registry from './nativeRegistry'

// The registered rsLine declares `placement.axis: 'hidden'` since the definition unit
// (VA2) landed; this fixture is the same definition WITHOUT the field, so the
// "visible" cases keep meaning what they say (2026-11-07).
const RS_REGISTERED = registry.getDefinition('rsLine')
const RS = (() => { const { axis, ...rest } = RS_REGISTERED.placement || {}; return { ...RS_REGISTERED, placement: rest } })()
const RSI = registry.getDefinition('rsi')
const MACD = registry.getDefinition('macd')

/** The definition VA2 ships: `rsLine` with `placement.axis: 'hidden'`. */
const withAxis = (def, axis) => ({ ...def, placement: { ...def.placement, axis } })
const RS_HIDDEN = withAxis(RS, 'hidden')

const inst = (defId, n = 1, extra = {}) => ({
  instanceId: `${defId}:${n}`, defId, inputs: {}, hidden: false, ...extra,
})
const guestOf = (host, defId, n = 1) => inst(defId, n, { placement: { target: `@${host.instanceId}` } })

const RS1 = inst('rsLine')
const RSI1 = inst('rsi')
const MACD1 = inst('macd')

/** RSI in pane 1, MACD in pane 2, RS in pane 3 — candles in 0. */
const CTX = {
  paneLayout: {
    priceIndex: 0,
    panes: [
      { key: 'price', index: 0 },
      { key: RSI1.instanceId, index: 1 },
      { key: MACD1.instanceId, index: 2 },
      { key: RS1.instanceId, index: 3 },
    ],
  },
  volOverlaySet: new Set(),
  volSeparatePane: false,
  VOL_PANE_INDEX: 1,
}

beforeEach(() => { __setPaneModeForTest('panes') })
afterEach(() => { __setPaneModeForTest(null) })

describe('axisHiddenOf — the field is read defensively (absent = visible)', () => {
  it('only the exact string "hidden" hides', () => {
    expect(axisHiddenOf(RS_HIDDEN)).toBe(true)
    for (const v of [undefined, null, 'visible', 'HIDDEN', 'Hidden', true, 1, {}, '']) {
      expect(axisHiddenOf(withAxis(RS, v)), String(v)).toBe(false)
    }
  })

  it('a definition with no placement, or no definition at all, is visible', () => {
    expect(axisHiddenOf({ id: 'x' })).toBe(false)
    expect(axisHiddenOf({ id: 'x', placement: null })).toBe(false)
    expect(axisHiddenOf({ id: 'x', placement: 'pane' })).toBe(false)
    expect(axisHiddenOf(null)).toBe(false)
    expect(axisHiddenOf(undefined)).toBe(false)
  })

  it('no shipped definition asks yet, so nothing on a chart moves until VA2 sets it', () => {
    // Non-vacuity for the identity claims below: the controls really are visible.
    expect(axisHiddenOf(RSI)).toBe(false)
    expect(axisHiddenOf(MACD)).toBe(false)
  })
})

describe('resolvePlacement — a hidden-axis definition in its own pane', () => {
  it('lands on the pane\'s hidden overlay scale, with no value tag', () => {
    const p = resolvePlacement(RS1, RS_HIDDEN, CTX)
    expect(p.paneIndex).toBe(3)
    expect(p.scaleId).toBe(HIDDEN_AXIS_SCALE_ID)
    expect(p.scaleId).not.toBe('right')
    expect(p.lastValue).toBe(false)
    expect(p.axis).toBe('hidden')
  })

  it('frames the line exactly as the visible answer does — autoscale still works', () => {
    const hidden = resolvePlacement(RS1, RS_HIDDEN, CTX)
    const visible = resolvePlacement(RS1, RS, CTX)
    expect(hidden.scaleOptions).toEqual(visible.scaleOptions)
    expect(hidden.scaleOptions).toEqual({ borderVisible: false, scaleMargins: { ...PANE_BAND }, autoScale: true })
    expect(hidden.autoscale).toBe('default')
    expect(hidden.autoscaleRange).toEqual(visible.autoscaleRange)
  })

  it('never writes `visible` on any scale — that option wedges lightweight-charts 5.2.0', () => {
    const p = resolvePlacement(RS1, RS_HIDDEN, CTX)
    expect(p.scaleOptions).not.toHaveProperty('visible')
  })

  it('a declared fixed range survives the hide (RSI-shaped fixture)', () => {
    const rsiHidden = withAxis(RSI, 'hidden')
    const hidden = resolvePlacement(RSI1, rsiHidden, CTX)
    const visible = resolvePlacement(RSI1, RSI, CTX)
    expect(hidden.autoscaleRange).toEqual({ min: 0, max: 100 })
    expect(hidden.scaleOptions).toEqual(visible.scaleOptions)
  })

  it('the same definition without the field is the visible answer, unchanged', () => {
    const p = resolvePlacement(RS1, RS, CTX)
    expect(p.scaleId).toBe('right')
    expect(p.lastValue).toBe(true)
    expect(p).not.toHaveProperty('axis')
    // `'visible'` is the explicit spelling of the default.
    expect(resolvePlacement(RS1, withAxis(RS, 'visible'), CTX)).toEqual(p)
  })
})

describe('resolvePlacement — the field changes nothing outside the indicator\'s own pane', () => {
  it('on the price pane the candles\' axis is never hidden', () => {
    const onPrice = inst('rsLine', 1, { placement: { target: 'price' } })
    expect(resolvePlacement(onPrice, RS_HIDDEN, CTX)).toEqual(resolvePlacement(onPrice, RS, CTX))
  })

  it('overlaid into the volume pane the shared ladder is never hidden', () => {
    const ctx = { ...CTX, volSeparatePane: true, volOverlaySet: new Set(['rsLine']) }
    expect(resolvePlacement(RS1, RS_HIDDEN, ctx)).toEqual(resolvePlacement(RS1, RS, ctx))
    expect(resolvePlacement(RS1, RS_HIDDEN, ctx).scaleId).toBe('left')
  })

  it('in bands mode the scale is already an axis-less overlay, so the answer is unchanged', () => {
    __setPaneModeForTest('bands')
    const ctx = { ...CTX, paneMargins: { rsLine: { top: 0.8, bottom: 0 } } }
    const hidden = resolvePlacement(RS1, RS_HIDDEN, ctx)
    expect(hidden).toEqual(resolvePlacement(RS1, RS, ctx))
    expect(hidden.scaleId).toBe('rsLine')
    expect(hidden.lastValue).toBeUndefined()
  })
})

describe('CONTROL — RSI and MACD answer byte-identically', () => {
  // Hand-written, so a change to either answer is caught here and not only by a
  // comparison of the code with itself.
  const EXPECT_RSI = {
    paneIndex: 1, scaleId: 'right',
    scaleOptions: { borderVisible: false, scaleMargins: { top: 0.16, bottom: 0.1 }, autoScale: true, minimum: 0, maximum: 100 },
    autoscale: 'default', autoscaleRange: { min: 0, max: 100 }, lastValue: true,
  }
  const EXPECT_MACD = {
    paneIndex: 2, scaleId: 'right',
    scaleOptions: { borderVisible: false, scaleMargins: { top: 0.16, bottom: 0.1 }, autoScale: true },
    autoscale: 'default', lastValue: true,
  }

  it('resolvePlacement', () => {
    expect(JSON.stringify(resolvePlacement(RSI1, RSI, CTX))).toBe(JSON.stringify(EXPECT_RSI))
    expect(JSON.stringify(resolvePlacement(MACD1, MACD, CTX))).toBe(JSON.stringify(EXPECT_MACD))
  })

  it('applyAxisTenancy returns their answers as the SAME objects, alone or beside a hidden pane', () => {
    const rsi = resolvePlacement(RSI1, RSI, CTX)
    const macd = resolvePlacement(MACD1, MACD, CTX)
    const alone = applyAxisTenancy([rsi, macd], CTX)
    expect(alone[0]).toBe(rsi)
    expect(alone[1]).toBe(macd)

    const rs = resolvePlacement(RS1, RS_HIDDEN, CTX)
    const beside = applyAxisTenancy([rsi, macd, rs], CTX)
    expect(beside[0]).toBe(rsi)
    expect(beside[1]).toBe(macd)
    expect(beside[2]).toBe(rs)
    expect(beside[2].scaleId).toBe(HIDDEN_AXIS_SCALE_ID)
  })

  it('a chart with no hidden ask comes back untouched, nulls and price overlays included', () => {
    const bb = resolvePlacement(inst('bb'), registry.getDefinition('bb'), CTX)
    const list = [null, bb, resolvePlacement(RSI1, RSI, CTX), resolvePlacement(MACD1, MACD, CTX)]
    const out = applyAxisTenancy(list, CTX)
    out.forEach((a, i) => expect(a).toBe(list[i]))
  })
})

describe('applyAxisTenancy — two tenants in one pane: the axis hides only when EVERY tenant asks', () => {
  const ctxWith = (extraPanes) => ({ ...CTX, paneLayout: { ...CTX.paneLayout, panes: [...CTX.paneLayout.panes, ...extraPanes] } })

  it('a guest states its ask but keeps the host\'s scale id until tenancy runs', () => {
    const guest = guestOf(RS1, 'rsLine', 2)
    const p = resolvePlacement(guest, RS_HIDDEN, CTX)
    expect(p.paneIndex).toBe(3)
    expect(p.scaleId).toBe('right')
    expect(p.scaleOptions).toBeNull()
    expect(p.axis).toBe('hidden')
    // A guest of a definition without the field states nothing.
    expect(resolvePlacement(guestOf(RS1, 'rsi'), RSI, CTX)).not.toHaveProperty('axis')
  })

  it('both ask → both share the hidden overlay (the guest still reads the host\'s ladder)', () => {
    const host = resolvePlacement(RS1, RS_HIDDEN, CTX)
    const guest = resolvePlacement(guestOf(RS1, 'rsLine', 2), RS_HIDDEN, CTX)
    const [h, g] = applyAxisTenancy([host, guest], CTX)
    expect(h.scaleId).toBe(HIDDEN_AXIS_SCALE_ID)
    expect(g.scaleId).toBe(HIDDEN_AXIS_SCALE_ID)
    expect(g.scaleOptions).toBeNull()          // a guest still asserts nothing
    expect(h.lastValue).toBe(false)
    expect(g.lastValue).toBe(false)
  })

  it('only the host asks → the axis comes back for both; the host keeps its no-tag answer', () => {
    const host = resolvePlacement(RS1, RS_HIDDEN, CTX)
    const guest = resolvePlacement(guestOf(RS1, 'rsi'), RSI, CTX)
    const [h, g] = applyAxisTenancy([host, guest], CTX)
    expect(h.scaleId).toBe('right')
    expect(g.scaleId).toBe('right')
    expect(g).toBe(guest)                       // the guest's own answer was already right
    expect(h.lastValue).toBe(false)             // the tag follows the series' own definition
    expect(h.scaleOptions).toEqual(host.scaleOptions)
  })

  it('only the guest asks → the host\'s visible axis stands and nothing changes', () => {
    const host = resolvePlacement(RS1, RS, CTX)
    const guest = resolvePlacement(guestOf(RS1, 'rsLine', 2), RS_HIDDEN, CTX)
    const out = applyAxisTenancy([host, guest], CTX)
    expect(out[0]).toBe(host)
    expect(out[1]).toBe(guest)
    expect(out.map((a) => a.scaleId)).toEqual(['right', 'right'])
  })

  it('order does not matter — guest listed first gives the same answer', () => {
    const host = resolvePlacement(RS1, RS_HIDDEN, CTX)
    const guest = resolvePlacement(guestOf(RS1, 'rsi'), RSI, CTX)
    const [g, h] = applyAxisTenancy([guest, host], CTX)
    expect([g.scaleId, h.scaleId]).toEqual(['right', 'right'])
  })

  it('panes are settled independently: a disagreement in one pane leaves another hidden', () => {
    const RS2 = inst('rsLine', 2)
    const ctx = ctxWith([{ key: RS2.instanceId, index: 4 }])
    const a = resolvePlacement(RS1, RS_HIDDEN, ctx)
    const aGuest = resolvePlacement(guestOf(RS1, 'rsi'), RSI, ctx)
    const b = resolvePlacement(RS2, RS_HIDDEN, ctx)
    const out = applyAxisTenancy([a, aGuest, b], ctx)
    expect(out[0].scaleId).toBe('right')
    expect(out[2]).toBe(b)
    expect(out[2].scaleId).toBe(HIDDEN_AXIS_SCALE_ID)
  })

  it('every plot of one instance is one tenant\'s ask, so a multi-plot RS pane stays hidden', () => {
    const host = resolvePlacement(RS1, RS_HIDDEN, CTX)
    const out = applyAxisTenancy([host, { ...host }, { ...host }], CTX)
    expect(out.every((a) => a.scaleId === HIDDEN_AXIS_SCALE_ID)).toBe(true)
  })

  it('the candles\' pane and the volume pane are never settled, whatever their tenants ask', () => {
    const asks = (paneIndex) => ({ paneIndex, scaleId: 'right', scaleOptions: null, autoscale: 'default', lastValue: false, axis: 'hidden' })
    const onPrice = asks(0)
    const onVolume = asks(1)
    const out = applyAxisTenancy([onPrice, onVolume], { ...CTX, volSeparatePane: true, VOL_PANE_INDEX: 1 })
    expect(out[0]).toBe(onPrice)
    expect(out[1]).toBe(onVolume)
  })

  it('a non-array input is returned as-is (the binder falls back to the raw answers)', () => {
    expect(applyAxisTenancy(null, CTX)).toBeNull()
  })
})

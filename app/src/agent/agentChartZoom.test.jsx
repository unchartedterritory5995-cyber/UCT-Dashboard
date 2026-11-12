// C1-028: the chart's + / - time-axis zoom (chartSetup.zoom), as vertical slices through the REAL panel (scripted model).
// Request → the chart named → the + / - keys' own writer (StockChart.zoomTimeAxis, via ChartPane.viewDo 'zoom') → read-back
// from the view (getDateMeta().frame: the window's width) → the receipt, and Undo (restoreView: window + view lock).
// The stand-in chart keeps a view the way getDateMeta reports it, so a zoom that does not land is one the Agent cannot claim.
// StockChart's half (the shared writer, the key handler, the limits) is read from the source below.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, ONE, TWO } from './testing/panelHarness'
import { getCapability } from './capabilities'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })
const op = (action, args, target = 'c') => p.env('apply', [{ action, target, args }])
const here = dirname(fileURLToPath(import.meta.url))
const src = (rel) => readFileSync(resolve(here, rel), 'utf8')
const width = (v) => v.fromRight - v.toRight

/** Each chart's view, by ref, as getDateMeta reports it. `viewDo` is the chart's own control; `land: false` = it did nothing. */
function withViews(h, start = {}) {
  const views = {}
  const viewOf = (ref) => (views[ref] ||= { land: true, calls: [], fromRight: 100, toRight: 0, locked: false, lock: null, activeRange: null,
    limits: { minWidth: 1, maxWidth: 2000 }, ...start })
  const meta = (ref) => {
    const v = viewOf(ref)
    return { firstMs: 0, lastMs: 1, rightMs: 1, activeRange: v.activeRange, atDefaultView: false, indicatorsHidden: false, priceAuto: true,
      zoomLimits: v.limits,
      frame: v.noFrame ? null : { fromRight: v.fromRight, toRight: v.toRight, activeRange: v.activeRange, locked: v.locked, lock: v.lock } }
  }
  const base = h.charts
  const read = base.read, list = base.list
  h.charts = {
    ...base,
    read: (ref) => { const s = read(ref); return s && { ...s, view: meta(ref) } },
    list: () => list().map(s => ({ ...s, view: meta(s.ref) })),
    viewDo: (ref, o, arg) => {
      const v = viewOf(ref)
      v.calls.push([o, arg])
      if (!v.land) return true
      // as zoomTimeAxis: the width × 0.8 (in) or × 1.25 (out) per press around the centre, clamped as the time scale clamps
      if (o === 'zoom') {
        const c = (v.fromRight + v.toRight) / 2
        const w = Math.min(v.limits?.maxWidth ?? Infinity, Math.max(v.limits?.minWidth ?? 0, width(v) * Math.pow(arg.out ? 1.25 : 0.8, arg.steps)))
        Object.assign(v, { fromRight: c + w / 2, toRight: c - w / 2, activeRange: null })
      }
      if (o === 'restoreView') { v.fromRight = arg.fromRight; v.toRight = arg.toRight; v.activeRange = arg.activeRange; v.locked = arg.locked; v.lock = arg.lock }
      return true
    },
  }
  return viewOf
}
const fastClock = () => {
  const realNow = Date.now
  let t = realNow()
  vi.spyOn(Date, 'now').mockImplementation(() => { t += 2000; return t })   // the 10s read-back wait passes at once
}

describe('chartSetup.zoom: the + / - keys on ONE chart', () => {
  it('zoom in once reaches the chart\'s own zoom with one press, and is read back as a narrower window', async () => {
    const { say, h } = p.mount(...ONE('NVDA'))
    const v = withViews(h)('c')
    p.st.envelopes.push(op('chartSetup.zoom', { direction: 'in', steps: 1 }))
    expect(await say('zoom in on this chart')).toMatch(/Zoomed this chart in, the same as pressing \+ on it/)
    expect(v.calls).toEqual([['zoom', { out: false, steps: 1 }]])
    expect(width(v)).toBeCloseTo(80)
  }, 40000)

  it('zoom out three steps is ONE call with three presses (the keys\' arithmetic: × 1.25³), read back as a wider window', async () => {
    const { say, h } = p.mount(...ONE('NVDA'))
    const v = withViews(h)('c')
    p.st.envelopes.push(op('chartSetup.zoom', { direction: 'out', steps: 3 }))
    expect(await say('zoom out a lot')).toMatch(/Zoomed this chart out 3 steps/)
    expect(v.calls).toEqual([['zoom', { out: true, steps: 3 }]])
    expect(width(v)).toBeCloseTo(100 * 1.25 ** 3)
  }, 40000)

  it('Undo puts back the exact window and view lock it zoomed from', async () => {
    const { say, h } = p.mount(...ONE('NVDA'))
    const lock = { anchorFrac: 0.7, width: 90, tf: 'D', top: 0.1, bottom: 0.8, hLocked: true }
    const v = withViews(h, { fromRight: 88.25, toRight: -3.5, locked: true, lock, activeRange: '1y' })('c')
    p.st.envelopes.push(op('chartSetup.zoom', { direction: 'in', steps: 2 }))
    const out = await say('zoom in twice')
    expect(out).not.toMatch(/has no Undo|can't be undone/)
    await say('undo')
    expect(v.calls.at(-1)[0]).toBe('restoreView')
    expect({ from: v.fromRight, to: v.toRight, locked: v.locked, lock: v.lock, range: v.activeRange }).toEqual({ from: 88.25, to: -3.5, locked: true, lock, range: '1y' })
  }, 60000)

  it('a member who panned or zoomed since keeps their view: Undo refuses as stale and moves nothing', async () => {
    for (const moved of [{ fromRight: 40, toRight: -20 }, { fromRight: 70, toRight: 10 }]) {   // a pan; a zoom of their own
      const { say, h } = p.mount(...ONE('NVDA'))
      const v = withViews(h)('c')
      p.st.envelopes.push(op('chartSetup.zoom', { direction: 'out', steps: 1 }))
      await say('zoom out')
      Object.assign(v, moved)
      const calls = v.calls.length
      await say('undo')
      expect(document.body.textContent).toMatch(/has changed since/)
      expect(v.calls.length).toBe(calls)
      expect([v.fromRight, v.toRight]).toEqual([moved.fromRight, moved.toRight])
      cleanup()
    }
  }, 90000)

  it('⛔ at the time scale\'s limit it refuses honestly, and the chart is not told anything', async () => {
    for (const [direction, start, re] of [['in', { fromRight: 2, toRight: 0, limits: { minWidth: 1.6, maxWidth: 2000 } }, /already zoomed in as far as it goes/],
      ['out', { fromRight: 1999.8, toRight: 0, limits: { minWidth: 1, maxWidth: 2000 } }, /already zoomed out as far as it goes/]]) {
      const { say, h } = p.mount(...ONE('NVDA'))
      const v = withViews(h, start)('c')
      p.st.envelopes.push(op('chartSetup.zoom', { direction, steps: 1 }))
      const out = await say(`zoom ${direction}`)
      expect(out).toMatch(re)
      expect(out).not.toMatch(/Zoomed this chart/)
      expect(v.calls).toEqual([])
      cleanup()
    }
  }, 60000)

  it('near the limit it zooms as far as it goes and says so (the read-back expects the clamped width)', async () => {
    const { say, h } = p.mount(...ONE('NVDA'))
    const v = withViews(h, { fromRight: 10, toRight: 0, limits: { minWidth: 6, maxWidth: 2000 } })('c')
    p.st.envelopes.push(op('chartSetup.zoom', { direction: 'in', steps: 5 }))
    expect(await say('zoom all the way in')).toMatch(/Zoomed this chart in as far as it goes/)
    expect(width(v)).toBeCloseTo(6)
  }, 40000)

  it('⛔ a chart whose window did not change gets no success', async () => {
    const { say, h } = p.mount(...ONE('NVDA'))
    const v = withViews(h, { land: false })('c')
    fastClock()
    p.st.envelopes.push(op('chartSetup.zoom', { direction: 'in', steps: 1 }))
    expect(await say('zoom in')).not.toMatch(/Zoomed this chart/)
    expect(v.calls).toEqual([['zoom', { out: false, steps: 1 }]])
  }, 40000)

  it('⛔ a chart that zoomed the WRONG way gets no success', async () => {
    const { say, h } = p.mount(...ONE('NVDA'))
    const v = withViews(h)('c')
    const real = h.charts.viewDo
    h.charts.viewDo = (ref, o, arg) => real(ref, o, o === 'zoom' ? { ...arg, out: !arg.out } : arg)
    fastClock()
    p.st.envelopes.push(op('chartSetup.zoom', { direction: 'in', steps: 1 }))
    expect(await say('zoom in')).not.toMatch(/Zoomed this chart/)
    expect(width(v)).toBeCloseTo(125)
  }, 40000)

  it('a window it cannot read: refuses, and the chart is not told to zoom', async () => {
    const { say, h } = p.mount(...ONE('NVDA'))
    const v = withViews(h, { noFrame: true })('c')
    p.st.envelopes.push(op('chartSetup.zoom', { direction: 'out', steps: 1 }))
    expect(await say('zoom out')).toMatch(/hasn.t finished loading/)
    expect(v.calls).toEqual([])
  }, 40000)

  it('outside 1–10 steps refuses and points at a range; nothing moves', async () => {
    for (const steps of [0, 11]) {
      const { say, h } = p.mount(...ONE('NVDA'))
      const v = withViews(h)('c')
      p.st.envelopes.push(op('chartSetup.zoom', { direction: 'out', steps }))
      expect(await say('zoom out')).toMatch(/1 to 10 steps at a time/)
      expect(v.calls).toEqual([])
      cleanup()
    }
  }, 60000)

  it('wrong-target control: with two charts, only the chart named zooms', async () => {
    const { say, h } = p.mount(...TWO('NVDA', 'AMD'))
    const get = withViews(h)
    const left = get('cl'), right = get('cr')
    p.st.envelopes.push(op('chartSetup.zoom', { direction: 'in', steps: 2 }, 'cr'))
    await say('zoom the AMD chart in two steps')
    expect(right.calls).toEqual([['zoom', { out: false, steps: 2 }]])
    expect(left.calls).toEqual([])
    expect([left.fromRight, left.toRight]).toEqual([100, 0])
  }, 40000)

  it('the capability: a view on ONE chart, Undo through restoreView, member-facing strings', () => {
    const c = getCapability('chartSetup.zoom')
    expect(c.target).toBe('chart')
    expect(c.undo).not.toBe('none')
    expect(c.summary).toMatch(/like pressing \+ or -/)
    expect(c.undoNote).toMatch(/can't be undone here/)
    expect(c.args.properties.direction.enum).toEqual(['in', 'out'])
  })
})

describe('the chart\'s half: the + / - keys and the Agent share ONE writer', () => {
  it('the key handler and onDateNavApi.zoom both call zoomTimeAxis; the pane lets "zoom" through; getDateMeta reports the limits', () => {
    const s = src('../components/StockChart.jsx')
    const body = s.slice(s.indexOf('function zoomTimeAxis('), s.indexOf('function zoomLimitsOf('))
    expect(body).toMatch(/Math\.pow\(out \? 1\.25 : 0\.8/)
    expect(body).toMatch(/setVisibleLogicalRange\(\{ from: center - half, to: center \+ half \}\)/)
    expect(s).toMatch(/if \(zoomTimeAxis\(chartRef\.current, e\.key === '-', 1\)\) e\.preventDefault\(\)/)
    expect(s).toMatch(/zoom: \(z\) => zoomTimeAxis\(chartRef\.current, !!z\?\.out, z\?\.steps\)/)
    expect(s).toMatch(/zoomLimits: zoomLimitsOf\(chartRef\.current\)/)
    // no second zoom path: the old inline arithmetic is gone from the key handler
    expect(s.match(/e\.key === '-' \? 1\.25 : 0\.8/g)).toBeNull()
    // (re-merge onto 3f13cc4435) #1110 drawing extras added 'positionCalc' after 'zoom' in the same forwarded-ops list
    expect(src('../components/chart/pane/ChartPane.jsx')).toMatch(/'stepBar', 'autoScale', 'zoom', 'positionCalc'\]\.includes\(op\)/)
  })
})

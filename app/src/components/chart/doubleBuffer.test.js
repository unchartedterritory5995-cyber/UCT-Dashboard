// The double-buffered next row, the pure half (chart/doubleBuffer.js, 2026-11-27):
//   F1 THE FLIP RULE: a shadow is shown only when its chart REPORTED a pass of the very symbol, the front chart's
//      timeframe and session, the widget's settings, holding the bars the store gives that key NOW, with the two charts'
//      views alike and no replay; each mismatch is refused with its own reason (a stale flip is never shown)
//   F1b THE VIEWS: alike only at the same span and right edge with no range, lock, hand-set price scale or replay; the
//      shadow's mirror of the front's span
//   F2 the board's shadow budget: at most MAX_SHADOWS per board, a release frees one, boards are independent
//   F3 the switch: on by default; off on the touch tier, under the server's chart-speed kill, or with '0'
//   F4 the shadow's row: the first row the list names after the symbol (the direction of travel), none without a list
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  flipDecision, viewParity, mirrorFrameFor, acquireShadow, shadowsHeld, MAX_SHADOWS, doubleBufferOn, __setDoubleBufferForTests, DOUBLE_BUFFER_KEY,
  TOUCH_TIER_QUERY, nextShadowSym,
} from './doubleBuffer'
import * as nf from './neighborFrames'
import { __resetChartSpeedForTests } from '../../lib/chartSpeed'

const settings = { a: 1 }
const bars = Object.freeze([1, 2, 3])
const want = { sym: 'BBB', tf: 'D', ext: false, settings, replay: false }
const report = { sym: 'BBB', tf: 'D', ext: false, bars, settings }
const now = () => bars
const ok = () => 'ok'

describe('F1 the flip rule (the shadow PROVES what it shows: review of #2922, F3)', () => {
  it("flips when the shadow reported the symbol, the front chart's timeframe and session, the settings, the bars of now, alike views", () => {
    expect(flipDecision(want, report, now, ok)).toEqual({ flip: true, why: 'flip' })
  })
  it.each([
    ['no-front', null, report],
    ['replay', { ...want, replay: true }, report],
    ['no-shadow', want, null],
    ['sym', want, { ...report, sym: 'CCC' }],
    ['tf', want, { ...report, tf: '60' }],
    ['tf', { ...want, tf: null }, report],
    ['session', want, { ...report, ext: true }],
    ['settings', want, { ...report, settings: { a: 1 } }],   // equal content, another object: the board hands both layers ONE
  ])('refuses %s', (why, w, r) => {
    expect(flipDecision(w, r, now, ok)).toEqual({ flip: false, why })
  })
  it("refuses a STALE shadow: its reported bars are not the store's now (moved on, none, a throw, never reported)", () => {
    expect(flipDecision(want, report, () => [...bars], ok)).toEqual({ flip: false, why: 'stale' })
    expect(flipDecision(want, report, () => null, ok)).toEqual({ flip: false, why: 'stale' })
    expect(flipDecision(want, report, () => { throw new Error('x') }, ok)).toEqual({ flip: false, why: 'stale' })
    expect(flipDecision(want, { ...report, bars: null }, () => null, ok)).toEqual({ flip: false, why: 'stale' })
  })
  it("refuses when the views differ (the reason is the view's), or cannot be read", () => {
    expect(flipDecision(want, report, now, () => 'view-zoom')).toEqual({ flip: false, why: 'view-zoom' })
    expect(flipDecision(want, report, now, () => { throw new Error('x') })).toEqual({ flip: false, why: 'view-unknown' })
  })
})

describe('F1b the views (review of #2922, F1; the typed-Enter dry run)', () => {
  // a frame pinned as the switch pins it on a 1000 px plot (gap 5 %): toRight = -(reserve + width x 0.05)
  const pinned = (width, reserve = 0, extra = {}) => {
    const toRight = -(reserve + width * 0.05)
    return { frame: { fromRight: toRight + width, toRight, locked: false }, activeRange: null, priceAuto: true, replay: { on: false }, plotWidthPx: 1000, ...extra }
  }
  it('alike: the same width, whatever the right edges (each chart pins its own symbol; the margin scales with the width)', () => {
    expect(viewParity(pinned(160), pinned(160))).toBe('ok')
    expect(viewParity(pinned(160), pinned(160, 1))).toBe('ok')                       // the hidden symbol's own reserve
    const panned = { ...pinned(160), frame: { fromRight: 400, toRight: 240, locked: false } }   // the front scrolled back
    expect(viewParity(panned, pinned(160))).toBe('ok')                               // the switch re-pins at present
  })
  it.each([
    ['view-zoom', pinned(80), pinned(160)],
    ['view-range', pinned(160, 0, { activeRange: '1Y' }), pinned(160)],
    ['view-locked', { ...pinned(160), frame: { ...pinned(160).frame, locked: true } }, pinned(160)],
    ['view-price', pinned(160, 0, { priceAuto: false }), pinned(160)],
    ['replay', pinned(160, 0, { replay: { on: true } }), pinned(160)],
    ['view-unknown', null, pinned(160)],
    ['view-unknown', pinned(160), { frame: null }],
  ])('%s', (why, f, sh) => { expect(viewParity(f, sh)).toBe(why) })
  it("the mirror re-pins the hidden chart at the front's width, keeping its own reserve; then the views are alike", () => {
    expect(mirrorFrameFor(pinned(80), pinned(160))).toEqual({ fromRight: 76, toRight: -4, activeRange: null, locked: false, lock: null })
    expect(mirrorFrameFor(pinned(80), pinned(160, 1))).toEqual({ fromRight: 75, toRight: -5, activeRange: null, locked: false, lock: null })
    const noWidth = (m) => ({ ...m, plotWidthPx: null })
    expect(mirrorFrameFor(noWidth(pinned(80)), noWidth(pinned(160)))).toEqual({ fromRight: 76, toRight: -4, activeRange: null, locked: false, lock: null })
    const mirrored = { ...pinned(160), frame: { ...mirrorFrameFor(pinned(80), pinned(160)), locked: false } }
    expect(viewParity(pinned(80), mirrored)).toBe('ok')
  })
  it('nothing to mirror, or nothing that may be: null', () => {
    expect(mirrorFrameFor(pinned(160), pinned(160))).toBe(null)
    expect(mirrorFrameFor(pinned(80, 0, { activeRange: '1Y' }), pinned(160))).toBe(null)
    expect(mirrorFrameFor({ ...pinned(80), frame: { ...pinned(80).frame, locked: true } }, pinned(160))).toBe(null)
  })
})

describe("F2 the board\'s shadow budget", () => {
  it(`at most ${MAX_SHADOWS} per board; a release frees one; another board has its own`, () => {
    const board = {}
    const a = {}, b = {}, c = {}
    const ra = acquireShadow(board, a)
    const rb = acquireShadow(board, b)
    expect(typeof ra).toBe('function')
    expect(typeof rb).toBe('function')
    expect(acquireShadow(board, c)).toBe(null)
    expect(shadowsHeld(board)).toBe(MAX_SHADOWS)
    expect(typeof acquireShadow({}, c)).toBe('function')   // another board
    ra()
    expect(typeof acquireShadow(board, c)).toBe('function')
    expect(shadowsHeld(board)).toBe(2)
  })
})

describe('F3 the switch', () => {
  let mq = false
  beforeEach(() => {
    __setDoubleBufferForTests(null)
    __resetChartSpeedForTests()
    localStorage.removeItem(DOUBLE_BUFFER_KEY)
    mq = false
    vi.stubGlobal('matchMedia', (q) => ({ matches: q === TOUCH_TIER_QUERY ? mq : false, media: q, addEventListener() {}, removeEventListener() {} }))
  })
  afterEach(() => { __setDoubleBufferForTests(null); vi.unstubAllGlobals(); document.cookie = 'uct_chart_speed=; max-age=0' })
  it('on by default (desktop)', () => { expect(doubleBufferOn()).toBe(true) })
  it('off on the touch tier', () => { mq = true; expect(doubleBufferOn()).toBe(false) })
  it("off with localStorage '0'", () => { localStorage.setItem(DOUBLE_BUFFER_KEY, '0'); expect(doubleBufferOn()).toBe(false) })
  it("off under the server's chart-speed kill", () => { document.cookie = 'uct_chart_speed=0'; expect(doubleBufferOn()).toBe(false) })
  it('the touch tier query is the owner\'s', () => { expect(TOUCH_TIER_QUERY).toBe('(max-width: 1024px), (pointer: coarse)') })
})

describe("F4 the shadow\'s row", () => {
  beforeEach(() => { nf.__setNeighborFramesForTests(true); nf.__resetScanForTests() })
  afterEach(() => nf.__setNeighborFramesForTests(null))
  it('the first row the list names ahead; none without a list', () => {
    expect(nextShadowSym('AAA')).toBe(null)
    nf.publishScanNeighbors('AAA', ['BBB', 'CCC'], ['ZZZ'])
    expect(nextShadowSym('AAA')).toBe('BBB')
    nf.publishScanNeighbors('AAA', ['ZZZ'], ['BBB'])   // moving up: ahead is the row above
    expect(nextShadowSym('aaa')).toBe('ZZZ')
  })
})

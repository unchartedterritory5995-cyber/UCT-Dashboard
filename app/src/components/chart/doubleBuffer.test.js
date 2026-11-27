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

describe('F1b the views (review of #2922, F1)', () => {
  const meta = (fromRight, toRight, extra = {}) => ({ frame: { fromRight, toRight, locked: false }, activeRange: null, priceAuto: true, replay: { on: false }, ...extra })
  it('alike: the same span at the same right edge', () => {
    expect(viewParity(meta(160, -5), meta(160, -5))).toBe('ok')
  })
  it.each([
    ['view-zoom', meta(80, -5), meta(160, -5)],
    ['view-offset', meta(260, 95), meta(160, -5)],           // the front panned back: the normal switch re-anchors
    ['view-range', meta(160, -5, { activeRange: '1Y' }), meta(160, -5)],
    ['view-locked', { ...meta(160, -5), frame: { fromRight: 160, toRight: -5, locked: true } }, meta(160, -5)],
    ['view-price', meta(160, -5, { priceAuto: false }), meta(160, -5)],
    ['replay', meta(160, -5, { replay: { on: true } }), meta(160, -5)],
    ['view-unknown', null, meta(160, -5)],
    ['view-unknown', meta(160, -5), { frame: null }],
  ])('%s', (why, f, sh) => { expect(viewParity(f, sh)).toBe(why) })
  it("the mirror gives the shadow the front's span at its own right edge; nothing to mirror, or nothing that may be: null", () => {
    expect(mirrorFrameFor(meta(80, -5), meta(160, -5))).toEqual({ fromRight: 80, toRight: -5, activeRange: null, locked: false, lock: null })
    expect(mirrorFrameFor(meta(160, -5), meta(160, -5))).toBe(null)
    expect(mirrorFrameFor(meta(260, 95), meta(160, -5))).toBe(null)
    expect(mirrorFrameFor(meta(80, -5, { activeRange: '1Y' }), meta(160, -5))).toBe(null)
    expect(viewParity(meta(80, -5), { ...meta(160, -5), frame: mirrorFrameFor(meta(80, -5), meta(160, -5)) })).toBe('ok')
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

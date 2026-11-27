// The double-buffered next row, the pure half (chart/doubleBuffer.js, 2026-11-27):
//   F1 THE FLIP RULE: a shadow is shown only when it was set (committed) to the very symbol, timeframe, session and
//      settings the front would show now AND its bars are still the store's base snapshot; each mismatch is refused
//      with its own reason (a stale flip is never shown)
//   F2 the board's shadow budget: at most MAX_SHADOWS per board, a release frees one, boards are independent
//   F3 the switch: on by default; off on the touch tier, under the server's chart-speed kill, or with '0'
//   F4 the shadow's row: the first row the list names after the symbol (the direction of travel), none without a list
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  flipDecision, acquireShadow, shadowsHeld, MAX_SHADOWS, doubleBufferOn, __setDoubleBufferForTests, DOUBLE_BUFFER_KEY,
  TOUCH_TIER_QUERY, nextShadowSym,
} from './doubleBuffer'
import * as nf from './neighborFrames'
import { __resetChartSpeedForTests } from '../../lib/chartSpeed'

const settings = { a: 1 }
const snap = { key: 'K', bars: [1, 2, 3] }
const want = { sym: 'BBB', tf: 'D', showExtended: false, settings }
const shadow = { sym: 'BBB', tf: 'D', showExtended: false, settings, snap, set: true }
const now = () => snap

describe('F1 the flip rule', () => {
  it('flips when everything the front would show matches and the bars are the store\'s snapshot now', () => {
    expect(flipDecision(want, shadow, now)).toEqual({ flip: true, why: 'flip' })
  })
  it.each([
    ['no-shadow', null],
    ['not-set', { ...shadow, set: false }],
    ['sym', { ...shadow, sym: 'CCC' }],
    ['tf', { ...shadow, tf: '60' }],
    ['session', { ...shadow, showExtended: true }],
    ['settings', { ...shadow, settings: { a: 1 } }],   // equal content, another object: the board hands both layers ONE
  ])('refuses %s', (why, sh) => {
    expect(flipDecision(want, sh, now)).toEqual({ flip: false, why })
  })
  it('refuses a STALE shadow: the store moved on (another base snapshot), or holds none, or answering throws', () => {
    expect(flipDecision(want, shadow, () => ({ ...snap }))).toEqual({ flip: false, why: 'stale' })
    expect(flipDecision(want, shadow, () => null)).toEqual({ flip: false, why: 'stale' })
    expect(flipDecision(want, { ...shadow, snap: null }, () => null)).toEqual({ flip: false, why: 'stale' })
    expect(flipDecision(want, shadow, () => { throw new Error('x') })).toEqual({ flip: false, why: 'stale' })
  })
})

describe('F2 the board\'s shadow budget', () => {
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

describe('F4 the shadow\'s row', () => {
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

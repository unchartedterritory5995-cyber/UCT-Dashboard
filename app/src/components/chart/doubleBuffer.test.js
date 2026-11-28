// The double-buffered next row, the pure half (chart/doubleBuffer.js, 2026-11-27):
//   F1 THE FLIP RULE: a shadow is shown only when its chart REPORTED a pass of the very symbol, the front chart's
//      timeframe and session, the widget's settings, holding the bars the store gives that key NOW, with the two charts'
//      views alike and no replay; each mismatch is refused with its own reason (a stale flip is never shown)
//   F1b THE VIEWS: alike only at the same span and right edge with no range, lock, hand-set price scale or replay; the
//      shadow's mirror of the front's span
//   F2 the board's shadow budget: at most MAX_SHADOWS per board, a release frees one, boards are independent
//   F3 the switch: on by default; off on the touch tier, under the server's chart-speed kill, or with '0'
//   F4 the shadow's row: the first row the list names after the symbol (the direction of travel), none without a list
//   F5 (owner, 2026-11-27: instant scanning zoomed out and in change-date) THE VIEW MODE: a replay cutoff, a view lock
//      (a range, a pan or zoom), a replay view lock frame the switch, so the hidden chart is prepared in the SAME mode:
//      the same cutoff, the same locks, at the frame they give it, its history covering that frame; it flips then, and
//      refuses only what it cannot prove (another cutoff, another lock, a frame off, a lock past the newest bar, short rows)
//   F6 (owner, 2026-11-27) THE DATE THE MEMBER WENT TO (the date box's anchor): both charts carry it as a prop and frame
//      their own symbol at it; a flip needs the hidden chart drawn under the same anchor, at the frame it gives its own
//      rows, those rows holding the date; it is never mirrored
//   F7 (the cold-ticker measurement, 2026-11-28) a view lock only the front holds (its pan or zoom at the date) refuses
//      nothing while both charts share the anchor (the anchor frames the switch before any lock)
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
    ['view-lock', { ...pinned(160), frame: { ...pinned(160).frame, locked: true, lock: { anchorFrac: 0.95, width: 160, tf: 'D' } } }, pinned(160)],
    ['view-price', pinned(160, 0, { priceAuto: false }), pinned(160)],
    ['replay', pinned(160, 0, { replay: { on: true } }), pinned(160)],
    ['view-unknown', null, pinned(160)],
    ['view-unknown', pinned(160), { frame: null }],
  ])('%s', (why, f, sh) => { expect(viewParity(f, sh, { tf: 'D' })).toBe(why) })
  it("a range button's read-back alone frames nothing (the switch reads the view lock the button wrote): alike", () => {
    expect(viewParity(pinned(160, 0, { activeRange: '1Y' }), pinned(160))).toBe('ok')
  })
  it("the mirror re-pins the hidden chart at the front's width, keeping its own reserve; then the views are alike", () => {
    expect(mirrorFrameFor(pinned(80), pinned(160))).toEqual({ fromRight: expect.closeTo(76, 6), toRight: expect.closeTo(-4, 6), activeRange: null, locked: false, lock: null, replayLock: null })
    expect(mirrorFrameFor(pinned(80), pinned(160, 1))).toEqual({ fromRight: expect.closeTo(75, 6), toRight: expect.closeTo(-5, 6), activeRange: null, locked: false, lock: null, replayLock: null })
    const noWidth = (m) => ({ ...m, plotWidthPx: null })
    expect(mirrorFrameFor(noWidth(pinned(80)), noWidth(pinned(160)))).toEqual({ fromRight: expect.closeTo(76, 6), toRight: expect.closeTo(-4, 6), activeRange: null, locked: false, lock: null, replayLock: null })
    const mirrored = { ...pinned(160), frame: { ...mirrorFrameFor(pinned(80), pinned(160)), locked: false } }
    expect(viewParity(pinned(80), mirrored)).toBe('ok')
  })
  it('nothing to mirror, or nothing that may be: null', () => {
    expect(mirrorFrameFor(pinned(160), pinned(160))).toBe(null)
    expect(mirrorFrameFor(pinned(80, 0, { replay: { mode: true } }), pinned(160))).toBe(null)
    expect(mirrorFrameFor(pinned(80, 0, { priceAuto: false }), pinned(160))).toBe(null)
  })
  // (review of #2932) the same width, but the hidden chart is no longer where the switch would pin its symbol NOW: the
  // chart's own `pinReserve` (StockChart getDateMeta) says what that pin is
  const frameOf = (fromRight, toRight) => ({ fromRight: expect.closeTo(fromRight, 6), toRight: expect.closeTo(toRight, 6), activeRange: null, locked: false, lock: null, replayLock: null })
  it("re-pins a hidden chart more than half a bar off its own pin: today's first bar landed while pinned, or the widget was resized", () => {
    expect(mirrorFrameFor(pinned(160), { ...pinned(160, 1), pinReserve: 0 })).toEqual(frameOf(152, -8))
    expect(mirrorFrameFor(pinned(160), { ...pinned(160), plotWidthPx: 400, pinReserve: 0 })).toEqual(frameOf(146.4, -13.6))   // gap 34/400
    expect(mirrorFrameFor(pinned(80), { ...pinned(160, 1), pinReserve: 0 })).toEqual(frameOf(76, -4))   // a new width: the chart's reserve, not the read-back
  })
  it('on its own pin, within half a bar of it, no pin to read, or nothing that may be moved: null', () => {
    expect(mirrorFrameFor(pinned(160), { ...pinned(160, 1), pinReserve: 1 })).toBe(null)
    expect(mirrorFrameFor(pinned(160), { ...pinned(160), pinReserve: 0, frame: { fromRight: 151.6, toRight: -8.4, locked: false } })).toBe(null)
    expect(mirrorFrameFor(pinned(160), pinned(160, 1))).toBe(null)
    expect(mirrorFrameFor(pinned(160), { ...pinned(160, 1), pinReserve: 0, plotWidthPx: null })).toBe(null)
    expect(mirrorFrameFor(pinned(160), { ...pinned(160, 1), pinReserve: 0, priceAuto: false })).toBe(null)
    expect(mirrorFrameFor(pinned(160, 0, { replay: { mode: true } }), { ...pinned(160, 1), pinReserve: 0 })).toBe(null)
  })
})

describe('F5 the view MODE (owner, 2026-11-27: instant scanning zoomed out 2014-2026 and in change-date at 2006)', () => {
  // zoomed out to 2014-2026 on a daily chart: a view lock (a range button writes one, as a pan or a zoom does) of
  // ~3,000 bars with the newest bar at 95 % of the width. The switch frames the next symbol from the lock alone
  // (StockChart: from = lastIdx - anchorFrac x width), so the hidden chart's frame is fromRight 2850, toRight -150.
  const lock = { anchorFrac: 0.95, width: 3000, tf: 'D', top: null, bottom: null }
  const atLock = { fromRight: 2850, toRight: -150 }
  const meta = (frame, extra = {}) => ({ frame: { locked: false, lock: null, ...frame }, activeRange: null, priceAuto: true, replay: { mode: false }, plotWidthPx: 1000, rows: 6000, replayLock: null, ...extra })
  const locked = (frame, extra = {}, l = lock) => meta({ ...frame, locked: true, lock: { ...l } }, extra)
  const D = { tf: 'D' }

  it("flips in change-date mode at a 2006 date: the hidden chart reported the front's cutoff; another cutoff, or none, refuses", () => {
    const w = { ...want, cutoff: '2006-03-15' }
    expect(flipDecision(w, { ...report, cutoff: '2006-03-15' }, now, ok)).toEqual({ flip: true, why: 'flip' })
    expect(flipDecision(w, { ...report, cutoff: '2006-03-16' }, now, ok)).toEqual({ flip: false, why: 'cutoff' })
    expect(flipDecision(w, report, now, ok)).toEqual({ flip: false, why: 'cutoff' })
    expect(flipDecision(want, { ...report, cutoff: '2006-03-15' }, now, ok)).toEqual({ flip: false, why: 'cutoff' })
  })
  it('flips zoomed out 2014-2026: the hidden chart holds the same lock at the frame the lock gives it (whatever the range read-back)', () => {
    expect(viewParity(locked(atLock, { activeRange: '12Y' }), locked(atLock), D)).toBe('ok')
    expect(viewParity(locked({ fromRight: 2900, toRight: -100 }), locked(atLock), D)).toBe('ok')   // the lock frames the switch, not the front's frame
    expect(viewParity(locked(atLock), locked({ fromRight: 2850.4, toRight: -149.6 }), D)).toBe('ok')
  })
  it.each([
    ['view-lock', locked(atLock), meta(atLock)],                                                     // the hidden chart holds no lock
    ['view-lock', locked(atLock), locked(atLock, {}, { ...lock, anchorFrac: 0.9 })],                 // another lock
    ['view-lock', meta({ fromRight: 152, toRight: -8 }), locked({ fromRight: 152, toRight: -8 })],   // the front's was reset
    ['view-frame', locked(atLock), locked({ fromRight: 2800, toRight: -200 })],                      // not where the lock puts it
    ['view-locked-past', locked({ fromRight: 4500, toRight: 1500 }, {}, { ...lock, anchorFrac: 1.5 }), locked({ fromRight: 4500, toRight: 1500 }, {}, { ...lock, anchorFrac: 1.5 })],
    ['view-short', locked(atLock), locked(atLock, { rows: 2000 })],                                  // its history does not reach the frame's left edge
    ['replay', locked(atLock), locked(atLock, { replay: { mode: true } })],                          // a bar-by-bar replay is running
  ])('refuses %s', (why, f, sh) => { expect(viewParity(f, sh, D)).toBe(why) })
  it('a lock captured on another timeframe does not frame the switch (the pin does), but the hidden chart must still hold it', () => {
    const wk = { ...lock, tf: 'W' }
    expect(viewParity(locked({ fromRight: 152, toRight: -8 }, {}, wk), locked({ fromRight: 152, toRight: -8 }, {}, wk), D)).toBe('ok')
    expect(viewParity(locked({ fromRight: 152, toRight: -8 }, {}, wk), meta({ fromRight: 152, toRight: -8 }), D)).toBe('view-lock')
  })
  it('a replay view lock (a pan in change-date mode) frames the switch from the cutoff: the same lock at its frame is alike', () => {
    const rl = { barsFromRight: 1, width: 120 }
    expect(viewParity(meta({ fromRight: 300, toRight: 180 }, { replayLock: rl }), meta({ fromRight: 120, toRight: 0 }, { replayLock: { ...rl } }), D)).toBe('ok')
    expect(viewParity(meta({ fromRight: 300, toRight: 180 }, { replayLock: rl }), meta({ fromRight: 120, toRight: 0 }), D)).toBe('view-lock')
    expect(viewParity(meta({ fromRight: 300, toRight: 180 }, { replayLock: rl }), meta({ fromRight: 126, toRight: 6 }, { replayLock: { ...rl } }), D)).toBe('view-frame')
  })
  it("the mirror prepares the hidden chart in the front's mode: its locks, at the frame they give it; nothing when it is there", () => {
    const at = (fromRight, toRight, l, replayLock = null) => ({ fromRight: expect.closeTo(fromRight, 6), toRight: expect.closeTo(toRight, 6), activeRange: null, locked: !!l, lock: l, replayLock })
    expect(mirrorFrameFor(locked(atLock), meta({ fromRight: 152, toRight: -8 }), D)).toEqual(at(2850, -150, lock))
    expect(mirrorFrameFor(locked(atLock), locked(atLock), D)).toBe(null)
    expect(mirrorFrameFor(meta({ fromRight: 152, toRight: -8 }), locked(atLock), D)).toEqual(at(152, -8, null))   // the front's lock was reset: the pin, unlocked
    const rl = { barsFromRight: 1, width: 120 }
    expect(mirrorFrameFor(meta({ fromRight: 300, toRight: 180 }, { replayLock: rl }), meta({ fromRight: 152, toRight: -8 }), D)).toEqual(at(120, 0, null, rl))
    const mirrored = locked({ fromRight: 2850, toRight: -150 })
    expect(viewParity(locked(atLock), mirrored, D)).toBe('ok')
    expect(mirrorFrameFor(locked({ fromRight: 4500, toRight: 1500 }, {}, { ...lock, anchorFrac: 1.5 }), meta(atLock), D)).toBe(null)   // past: nothing to prepare
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

describe('F6 the date the member went to (owner, 2026-11-27: scanning charts at 1/3/2006)', () => {
  const anchor = { date: '2006-01-03', width: 120 }
  const at = (fromRight, toRight, extra = {}) => ({ frame: { fromRight, toRight, locked: false, lock: null }, activeRange: null, priceAuto: true,
    replay: { mode: false }, plotWidthPx: 1000, rows: 6000, replayLock: null, anchor, anchorFrame: { fromRight, toRight }, anchorEarliest: false, ...extra })
  const D = { tf: 'D' }
  it('flips when the hidden chart drew under the same anchor; another anchor, or none, refuses', () => {
    const w = { ...want, anchor: '2006-01-03|120' }
    expect(flipDecision(w, { ...report, anchor: '2006-01-03|120' }, now, ok)).toEqual({ flip: true, why: 'flip' })
    expect(flipDecision(w, { ...report, anchor: '2006-01-04|120' }, now, ok)).toEqual({ flip: false, why: 'anchor' })
    expect(flipDecision(w, report, now, ok)).toEqual({ flip: false, why: 'anchor' })
    expect(flipDecision(want, { ...report, anchor: '2006-01-03|120' }, now, ok)).toEqual({ flip: false, why: 'anchor' })
  })
  it("alike when the hidden chart sits at the frame the anchor gives ITS rows (whatever the front's own frame)", () => {
    expect(viewParity(at(4700, 4580), at(5200, 5080), D)).toBe('ok')
  })
  // (the cold-ticker measurement, 2026-11-28: 16 of 16 arrows refused for a view lock) a pan or zoom at the date writes
  // the FRONT a view lock; the anchor frames the switch before any lock, so a lock only one chart holds refuses nothing
  it('F7 a view lock only the front holds (its pan or zoom at the date) refuses nothing while both share the anchor', () => {
    const zoomed = at(4900, 4500, { frame: { fromRight: 4900, toRight: 4500, locked: true, lock: { anchorFrac: 12.25, width: 400, tf: 'D', top: null, bottom: null } } })
    expect(viewParity(zoomed, at(5200, 5080), D)).toBe('ok')
    expect(viewParity({ ...zoomed, anchor: null, anchorFrame: null }, { ...at(5200, 5080), anchor: null, anchorFrame: null }, D)).toBe('view-lock')   // no anchor: the lock rule, as before
  })
  it.each([
    ['view-anchor', at(4700, 4580), at(5200, 5080, { anchor: null, anchorFrame: null })],
    ['view-anchor', at(4700, 4580), at(5200, 5080, { anchor: { date: '2006-01-04', width: 120 } })],
    ['view-frame', at(4700, 4580), { ...at(5200, 5080), frame: { fromRight: 120, toRight: -6, locked: false, lock: null } }],
    ['view-short', at(4700, 4580), at(5200, 5080, { anchorFrame: null })],          // the anchor names no bar of its rows yet
    ['view-short', at(4700, 4580), at(5200, 5080, { anchorEarliest: true })],       // its rows start after the date
    ['view-short', at(4700, 4580), at(5200, 5080, { rows: 5100 })],                 // its rows do not reach the frame's left edge
  ])('refuses %s', (why, f, sh) => { expect(viewParity(f, sh, D)).toBe(why) })
  it('never mirrored: each chart frames its own symbol at the anchor', () => {
    expect(mirrorFrameFor(at(4700, 4580), { ...at(5200, 5080), frame: { fromRight: 120, toRight: -6, locked: false, lock: null } }, D)).toBe(null)
    expect(mirrorFrameFor({ ...at(160, -8), anchor: null, anchorFrame: null }, at(5200, 5080), D)).toBe(null)
  })
})

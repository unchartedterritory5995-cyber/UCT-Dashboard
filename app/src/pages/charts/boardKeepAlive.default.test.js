// The board keep-alive's DEFAULT (2026-11-27, owner directive: on by default for everyone once proven; boardKeepAlive.js).
//   KD1 the device rule: a reported device memory decides alone (>= KEEPALIVE_MIN_DEVICE_GB); with none reported a
//       desktop window keeps a board and the touch tier does not: <= 1024 px OR a coarse pointer (a landscape iPad,
//       1366 px, Safari: no memory report; review of #2911, M1); no matchMedia and no report: no board
//   KD2 the order: storage ('0' is the opt-out, '1' / '2' a choice) over the build's VITE_BOARD_KEEPALIVE over the
//       device's default, which is the LAYER mode
import { describe, it, expect, vi, afterEach } from 'vitest'
import { boardKeepAliveMode, deviceCanKeepBoard, KEEPALIVE_MIN_DEVICE_GB, BOARD_KEEPALIVE_KEY } from './boardKeepAlive'

// a media query answer for a window `width` px wide with a `coarse` (or fine) pointer: each comma-separated part is OR-ed
const mq = (narrow, coarse = false) => (q) => ({
  matches: q.split(',').some((part) => (part.includes('max-width: 1024px') && narrow) || (part.includes('pointer: coarse') && coarse)),
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); try { localStorage.clear() } catch { /* */ } })

describe('the board keep-alive default', () => {
  it('KD1 the device rule', () => {
    expect(deviceCanKeepBoard({ deviceMemory: KEEPALIVE_MIN_DEVICE_GB }, mq(true))).toBe(true)
    expect(deviceCanKeepBoard({ deviceMemory: 8 }, mq(false))).toBe(true)
    expect(deviceCanKeepBoard({ deviceMemory: KEEPALIVE_MIN_DEVICE_GB / 2 }, mq(false)), 'a small device kept a board').toBe(false)
    expect(deviceCanKeepBoard({}, mq(false)), 'a desktop window that reports no memory').toBe(true)
    expect(deviceCanKeepBoard({}, mq(true)), 'the touch tier kept a board without a memory report').toBe(false)
    expect(deviceCanKeepBoard({}, mq(false, true)), 'a 1366 px coarse-pointer tablet (no memory report) kept a board').toBe(false)
    expect(deviceCanKeepBoard({ deviceMemory: 8 }, mq(false, true)), 'a tablet that reports its memory').toBe(true)
    expect(deviceCanKeepBoard({}, null), 'no matchMedia and no memory report kept a board').toBe(false)   // (undefined would take the defaults)
  })

  it('KD2 storage over the build over the device; the device default is the layer mode', () => {
    vi.stubEnv('VITE_BOARD_KEEPALIVE', '')
    vi.stubGlobal('navigator', { deviceMemory: 8 })
    vi.stubGlobal('matchMedia', mq(false))
    expect(boardKeepAliveMode(), 'nothing chosen, a capable device').toBe('layer')
    vi.stubGlobal('navigator', { deviceMemory: 1 })
    expect(boardKeepAliveMode(), 'nothing chosen, a small device').toBe('off')
    vi.stubEnv('VITE_BOARD_KEEPALIVE', '1')
    expect(boardKeepAliveMode(), 'the build chose').toBe('activity')
    localStorage.setItem(BOARD_KEEPALIVE_KEY, '0')
    expect(boardKeepAliveMode(), 'the member opted out').toBe('off')
    localStorage.setItem(BOARD_KEEPALIVE_KEY, '2')
    expect(boardKeepAliveMode()).toBe('layer')
  })
})

// ⭐ (2026-11-28, Lane G) how many boards the layer mode keeps
//   KD3 under 8 GB (or no report) one; 8-15 GB two; 16 GB or more four; the desktop app four; storage `uct.boardKeepAlive.k`
//       (1..8) over everything
describe('the kept-board limit', () => {
  it('KD3 K by device memory, the desktop app, and the storage override', async () => {
    const { keptBoardLimit, BOARD_KEEP_K_KEY, KEPT_BOARDS_MAX } = await import('./boardKeepAlive')
    expect(keptBoardLimit({}, false), 'no memory report').toBe(1)
    expect(keptBoardLimit({ deviceMemory: 4 }, false)).toBe(1)
    expect(keptBoardLimit({ deviceMemory: 7.9 }, false)).toBe(1)
    expect(keptBoardLimit({ deviceMemory: 8 }, false), 'an 8 GB device (Chromium reports at most 8)').toBe(2)
    expect(keptBoardLimit({ deviceMemory: 15 }, false)).toBe(2)
    expect(keptBoardLimit({ deviceMemory: 16 }, false)).toBe(4)
    expect(keptBoardLimit({ deviceMemory: 2 }, true), 'the desktop app').toBe(4)
    localStorage.setItem(BOARD_KEEP_K_KEY, '3')
    expect(keptBoardLimit({ deviceMemory: 2 }, false), 'the storage choice').toBe(3)
    localStorage.setItem(BOARD_KEEP_K_KEY, '99')
    expect(keptBoardLimit({}, false)).toBe(KEPT_BOARDS_MAX)
    localStorage.setItem(BOARD_KEEP_K_KEY, 'x')
    expect(keptBoardLimit({ deviceMemory: 8 }, false), 'a bad value is no choice').toBe(2)
  })
})

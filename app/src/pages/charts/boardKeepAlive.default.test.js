// The board keep-alive's DEFAULT (2026-11-27, owner directive: on by default for everyone once proven; boardKeepAlive.js).
//   KD1 the device rule: a reported device memory decides alone (>= KEEPALIVE_MIN_DEVICE_GB); with none reported a
//       desktop-width window keeps a board and the touch tier (<= 1024 px) does not
//   KD2 the order: storage ('0' is the opt-out, '1' / '2' a choice) over the build's VITE_BOARD_KEEPALIVE over the
//       device's default, which is the LAYER mode
import { describe, it, expect, vi, afterEach } from 'vitest'
import { boardKeepAliveMode, deviceCanKeepBoard, KEEPALIVE_MIN_DEVICE_GB, BOARD_KEEPALIVE_KEY } from './boardKeepAlive'

const mq = (narrow) => (q) => ({ matches: q.includes('1024') ? narrow : false })
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); try { localStorage.clear() } catch { /* */ } })

describe('the board keep-alive default', () => {
  it('KD1 the device rule', () => {
    expect(deviceCanKeepBoard({ deviceMemory: KEEPALIVE_MIN_DEVICE_GB }, mq(true))).toBe(true)
    expect(deviceCanKeepBoard({ deviceMemory: 8 }, mq(false))).toBe(true)
    expect(deviceCanKeepBoard({ deviceMemory: KEEPALIVE_MIN_DEVICE_GB / 2 }, mq(false)), 'a small device kept a board').toBe(false)
    expect(deviceCanKeepBoard({}, mq(false)), 'a desktop window that reports no memory').toBe(true)
    expect(deviceCanKeepBoard({}, mq(true)), 'the touch tier kept a board without a memory report').toBe(false)
    expect(deviceCanKeepBoard(undefined, undefined)).toBe(true)
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

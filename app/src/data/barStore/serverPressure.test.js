// The server's pressure as the page saw it (2026-11-28, board pre-mount; serverPressure.js)
//   PM8 (red first) a bars answer of 429 or 503 (a shed or a warming name) marks the pressure; any other failure does not
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRegistry } from './registry'
import { createNetwork } from './network'
import { keyOf } from './types'
import { msSincePressure, pressureCount, __resetPressureForTests } from './serverPressure'

const OPEN = Date.UTC(2026, 10, 13, 14, 30) / 1000
const K = keyOf({ sym: 'SIMB', tf: '1' })
afterEach(() => { __resetPressureForTests() })

function net(request) {
  const registry = createRegistry({ ctx: () => ({ nowMs: Date.now() }) })
  const network = createNetwork({
    registry, request, setTimer: () => ({}), clearTimer: () => {}, isHidden: () => false, onVisible: () => () => {},
  })
  return { registry, network }
}
const fail = (status, extra = {}) => Object.assign(new Error('x'), { status, retryAfterMs: 2000, ...extra })

describe('serverPressure', () => {
  it('PM8 (red first) a 429 / 503 from the bars network marks the pressure; a 404 or a network error does not', async () => {
    expect(msSincePressure()).toBe(Infinity)
    for (const [e, marks] of [[fail(404), false], [new TypeError('Failed to fetch'), false], [fail(429), true], [fail(503, { warming: true }), true], [fail(503), true]]) {
      __resetPressureForTests()
      const { registry, network } = net(vi.fn(async () => { throw e }))
      registry.acquire(K)
      await network.fetchOnce(K, { priority: 'visible' })
      expect(pressureCount() > 0, `${e.status ?? e.name}`).toBe(marks)
      if (marks) expect(msSincePressure()).toBeLessThan(1000)
    }
    void OPEN
  })
})

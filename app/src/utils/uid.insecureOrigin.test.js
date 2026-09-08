// @vitest-environment jsdom
/* The insecure-origin rail.
 *
 * ⛔ WHAT THIS EXISTS TO CATCH, and it is a real measurement rather than a
 * hypothetical: `crypto.randomUUID` is SECURE-CONTEXT-ONLY. Read live off
 * `http://bs-local.com:8093` on 2026-09-08 — `isSecureContext:false`,
 * `typeof crypto.randomUUID === 'undefined'`, and calling it throws
 * `TypeError: crypto.randomUUID is not a function`. Every plain-HTTP way this
 * app is opened on a real phone during development lands there: `vite --host`
 * on a LAN IP, an IP-based staging host, BrowserStack's `bs-local.com` tunnel.
 *
 * ⛔ AND THE TWO ASSERTIONS THAT MATTER ARE THE PRODUCT ONES, not the helper's.
 * A unit test of `uid()` would have passed on the day this was broken — the bug
 * was never in an id generator, it was that DRAWING A LINE and CREATING A BOARD
 * called `crypto.randomUUID()` directly. So the rail drives those two doors with
 * the API deleted, exactly as an insecure origin presents it.
 *
 * ⭐ EACH BLOCK CARRIES A CONTROL. `deleteRandomUUID` is asserted to actually
 * remove the property before the product call runs — a "simulation" that quietly
 * failed to simulate would leave this test green against the very bug it names.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { uid } from './uid'
import * as drawingsStore from '../components/chart/drawingsStore'

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** Present `crypto` the way a plain-HTTP origin does: `getRandomValues` stays,
 *  `randomUUID` and `subtle` are gone. Returns a restore fn. */
function deleteRandomUUID() {
  const real = globalThis.crypto
  const fake = {
    getRandomValues: (a) => real.getRandomValues(a),
    // no randomUUID, no subtle — this IS the insecure-context shape
  }
  Object.defineProperty(globalThis, 'crypto', { value: fake, configurable: true, writable: true })
  // The control: prove the simulation took.
  expect(typeof globalThis.crypto.randomUUID).toBe('undefined')
  expect(() => globalThis.crypto.randomUUID()).toThrow()
  return () => Object.defineProperty(globalThis, 'crypto', { value: real, configurable: true, writable: true })
}

beforeEach(() => {
  localStorage.clear()
  drawingsStore._reset()
})
afterEach(() => { localStorage.clear() })

describe('on an insecure origin (no crypto.randomUUID)', () => {
  it('you can still DRAW — addDrawing returns an id and the drawing lands', () => {
    const restore = deleteRandomUUID()
    try {
      const id = drawingsStore.addDrawing('NVDA', { type: 'horizontal', points: [{ price: 100 }] })
      expect(id).toMatch(V4)
      const drawn = drawingsStore.getSnapshot('NVDA').drawings
      expect(drawn).toHaveLength(1)
      expect(drawn[0].id).toBe(id)
    } finally { restore() }
  })

  it('you can still create a BOARD — the step that failed on a real iPhone', () => {
    const restore = deleteRandomUUID()
    try {
      const before = drawingsStore.listTracings().length
      const id = drawingsStore.createTracing()
      expect(id).toMatch(V4)
      expect(drawingsStore.listTracings()).toHaveLength(before + 1)
      // And it is selectable, which is what "New board" does next.
      drawingsStore.setActiveTracing(id)
      expect(drawingsStore.getActiveTracingId()).toBe(id)
    } finally { restore() }
  })

  it('ids stay unique and v4-shaped, so they interchange with stored ones', () => {
    const restore = deleteRandomUUID()
    try {
      const ids = new Set(Array.from({ length: 500 }, () => uid()))
      expect(ids.size).toBe(500)
      for (const id of ids) expect(id).toMatch(V4)
    } finally { restore() }
  })

  it('survives even with NO crypto at all', () => {
    const real = globalThis.crypto
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true, writable: true })
    try {
      expect(uid()).toMatch(V4)
      expect(uid()).not.toBe(uid())
    } finally {
      Object.defineProperty(globalThis, 'crypto', { value: real, configurable: true, writable: true })
    }
  })

  it('CONTROL — a secure context still uses the platform generator', () => {
    let called = 0
    const real = globalThis.crypto
    Object.defineProperty(globalThis, 'crypto', {
      value: { ...real, randomUUID: () => { called++; return '11111111-2222-4333-8444-555555555555' } },
      configurable: true, writable: true,
    })
    try {
      expect(uid()).toBe('11111111-2222-4333-8444-555555555555')
      expect(called).toBe(1)
    } finally {
      Object.defineProperty(globalThis, 'crypto', { value: real, configurable: true, writable: true })
    }
  })
})

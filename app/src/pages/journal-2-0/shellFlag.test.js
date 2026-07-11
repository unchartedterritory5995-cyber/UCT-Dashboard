import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  J2_SHELL_ROLLOUT_PCT,
  resolveJ2Shell,
  setJ2Shell,
  useJ2Shell,
} from './shellFlag'

// Start every test from a clean storage slate so the rollout-bucket path and
// the explicit override path never leak between cases.
beforeEach(() => {
  try { localStorage.clear() } catch { /* ignore */ }
})
afterEach(() => vi.restoreAllMocks())

describe('shellFlag', () => {
  it('exposes a rollout constant at 100 (new shell default — Today is real)', () => {
    expect(J2_SHELL_ROLLOUT_PCT).toBe(100)
  })

  describe('resolveJ2Shell', () => {
    it("returns 'v8' when the localStorage override is 'v8' (legacy)", () => {
      localStorage.setItem('uct.j2.shell', 'v8')
      expect(resolveJ2Shell()).toBe('v8')
    })

    it("returns 'v5' when the localStorage override is 'v5' (new)", () => {
      localStorage.setItem('uct.j2.shell', 'v5')
      expect(resolveJ2Shell()).toBe('v5')
    })

    it("unset → falls through to the rollout bucket, which is 'v5' at 100% (default)", () => {
      // No 'uct.j2.shell' key set. With J2_SHELL_ROLLOUT_PCT=100 every bucket
      // [0,100) is < 100, so the default is the new shell for all browsers.
      expect(localStorage.getItem('uct.j2.shell')).toBeNull()
      expect(resolveJ2Shell()).toBe('v5')
    })

    it('assigns a stable per-browser bucket persisted in localStorage', () => {
      resolveJ2Shell()
      const bucket = localStorage.getItem('uct.j2.shell.bucket')
      expect(bucket).not.toBeNull()
      const n = parseInt(bucket, 10)
      expect(n).toBeGreaterThanOrEqual(0)
      expect(n).toBeLessThan(100)
      // Stable: a second read does not reassign it.
      resolveJ2Shell()
      expect(localStorage.getItem('uct.j2.shell.bucket')).toBe(bucket)
    })
  })

  describe('setJ2Shell', () => {
    it("writes localStorage AND dispatches the 'uct-j2shell-change' event", () => {
      const spy = vi.fn()
      window.addEventListener('uct-j2shell-change', spy)
      setJ2Shell('v8')
      expect(localStorage.getItem('uct.j2.shell')).toBe('v8')
      expect(spy).toHaveBeenCalledTimes(1)
      window.removeEventListener('uct-j2shell-change', spy)
    })

    it('re-read: resolveJ2Shell reflects the value after setJ2Shell', () => {
      setJ2Shell('v8')
      expect(resolveJ2Shell()).toBe('v8')
      setJ2Shell('v5')
      expect(resolveJ2Shell()).toBe('v5')
    })

    it('ignores an invalid value (no-op — does not corrupt the flag)', () => {
      setJ2Shell('v5')
      const spy = vi.fn()
      window.addEventListener('uct-j2shell-change', spy)
      setJ2Shell('nonsense')
      expect(localStorage.getItem('uct.j2.shell')).toBe('v5') // unchanged
      expect(spy).not.toHaveBeenCalled()
      window.removeEventListener('uct-j2shell-change', spy)
    })
  })

  describe('useJ2Shell', () => {
    it('returns the current shell and re-renders when setJ2Shell fires', () => {
      localStorage.setItem('uct.j2.shell', 'v5')
      const { result } = renderHook(() => useJ2Shell())
      expect(result.current).toBe('v5')
      act(() => setJ2Shell('v8'))
      expect(result.current).toBe('v8')
      act(() => setJ2Shell('v5'))
      expect(result.current).toBe('v5')
    })
  })

  describe('window.__uctJ2Shell', () => {
    it('is the setJ2Shell DevTools handle', () => {
      expect(window.__uctJ2Shell).toBe(setJ2Shell)
      window.__uctJ2Shell('v8')
      expect(resolveJ2Shell()).toBe('v8')
    })
  })
})

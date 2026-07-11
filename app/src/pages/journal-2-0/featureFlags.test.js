import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  FEATURE_DEFAULTS,
  resolveFeatureFlag,
  setFeatureFlag,
  useFeatureFlag,
  J2_FEATURE_EVENT,
} from './featureFlags'
import { renderHook, act } from '@testing-library/react'

describe('featureFlags', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('every known feature defaults ON', () => {
    for (const name of Object.keys(FEATURE_DEFAULTS)) {
      expect(resolveFeatureFlag(name)).toBe(true)
    }
  })

  it('the P6 coach-amplification flags are registered + individually revertible', () => {
    for (const name of ['verdictScore', 'tagSuggest', 'makeRule', 'celebrate']) {
      expect(resolveFeatureFlag(name)).toBe(true)
      setFeatureFlag(name, false)
      expect(resolveFeatureFlag(name)).toBe(false)
    }
  })

  it('an unknown feature name defaults OFF (a typo cannot silently enable a surface)', () => {
    expect(resolveFeatureFlag('does-not-exist')).toBe(false)
  })

  it('setFeatureFlag pins an override and resolveFeatureFlag reflects it', () => {
    setFeatureFlag('psychology', false)
    expect(resolveFeatureFlag('psychology')).toBe(false)
    setFeatureFlag('psychology', true)
    expect(resolveFeatureFlag('psychology')).toBe(true)
  })

  it('setFeatureFlag(name, null) clears the override back to the default', () => {
    setFeatureFlag('regime', false)
    expect(resolveFeatureFlag('regime')).toBe(false)
    setFeatureFlag('regime', null)
    expect(resolveFeatureFlag('regime')).toBe(true)
  })

  it('setFeatureFlag dispatches the same-tab change event', () => {
    const cb = vi.fn()
    window.addEventListener(J2_FEATURE_EVENT, cb)
    setFeatureFlag('adherence', false)
    expect(cb).toHaveBeenCalled()
    window.removeEventListener(J2_FEATURE_EVENT, cb)
  })

  it('a non-string name is a no-op (no throw, no write)', () => {
    expect(() => setFeatureFlag(null, false)).not.toThrow()
    expect(() => setFeatureFlag(undefined, true)).not.toThrow()
    expect(resolveFeatureFlag('adherence')).toBe(true)
  })

  it('exposes a window.__uctJ2Feature DevTools handle', () => {
    expect(typeof window.__uctJ2Feature).toBe('function')
  })

  it('useFeatureFlag reads the current state and re-renders on a flip', () => {
    const { result } = renderHook(() => useFeatureFlag('tradePng'))
    expect(result.current).toBe(true)
    act(() => setFeatureFlag('tradePng', false))
    expect(result.current).toBe(false)
    act(() => setFeatureFlag('tradePng', null))
    expect(result.current).toBe(true)
  })
})

// app/src/lib/chartDeepLink.claimShare.test.js — A1.3: the share link is claimed ONCE
import { describe, it, expect, beforeEach } from 'vitest'
import { claimShareState, _resetShareClaimForTests, SHARE_STATE_PARAM } from './chartDeepLink'

beforeEach(() => { _resetShareClaimForTests(); window.history.replaceState(null, '', '/') })

describe('A1.3 — claimShareState', () => {
  it('the FIRST caller gets the state, the param is stripped, every later caller gets null', () => {
    window.history.replaceState({ key: 'router-k', idx: 3 }, '', `/charts?sym=QQQ&${SHARE_STATE_PARAM}=abc123&tf=D#x`)
    expect(claimShareState()).toBe('abc123')
    expect(window.location.search).toBe('?sym=QQQ&tf=D')
    expect(window.location.hash).toBe('#x')
    expect(window.history.state, 'history.state (the router key) survives the strip').toEqual({ key: 'router-k', idx: 3 })
    expect(claimShareState(), 'a second chart on the page must not apply it').toBe(null)
  })
  it('no param → null, and the latch stays open for a later page load', () => {
    window.history.replaceState(null, '', '/charts?sym=QQQ')
    expect(claimShareState()).toBe(null)
    window.history.replaceState(null, '', `/charts?${SHARE_STATE_PARAM}=z`)
    expect(claimShareState()).toBe('z')
  })
  it('a reload (param already stripped) claims nothing', () => {
    window.history.replaceState(null, '', `/charts?${SHARE_STATE_PARAM}=z`)
    claimShareState()
    _resetShareClaimForTests()                       // the "reload": a fresh module latch…
    expect(claimShareState(), '…but the URL no longer carries the param').toBe(null)
  })
})

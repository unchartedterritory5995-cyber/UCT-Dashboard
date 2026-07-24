import { describe, it, expect } from 'vitest'
import { setVideoOwnsMediaSession, videoOwnsMediaSession } from './mediaSessionOwner'

describe('mediaSessionOwner', () => {
  it('defaults to false', () => {
    // Fresh module state may carry over between test files in the same
    // process, so explicitly set false first to establish the baseline.
    setVideoOwnsMediaSession(false)
    expect(videoOwnsMediaSession()).toBe(false)
  })

  it('set(true) -> get() reads true', () => {
    setVideoOwnsMediaSession(true)
    expect(videoOwnsMediaSession()).toBe(true)
  })

  it('set(false) -> get() reads false', () => {
    setVideoOwnsMediaSession(true)
    setVideoOwnsMediaSession(false)
    expect(videoOwnsMediaSession()).toBe(false)
  })

  it('coerces truthy/falsy inputs to booleans', () => {
    setVideoOwnsMediaSession(1)
    expect(videoOwnsMediaSession()).toBe(true)
    setVideoOwnsMediaSession(0)
    expect(videoOwnsMediaSession()).toBe(false)
  })
})

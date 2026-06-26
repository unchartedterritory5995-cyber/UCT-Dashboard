import { describe, it, expect } from 'vitest'
import { pipSupported } from './documentPip'

describe('pipSupported', () => {
  it('is false when the browser lacks Document Picture-in-Picture (jsdom)', () => {
    expect(pipSupported()).toBe(false)
  })
})

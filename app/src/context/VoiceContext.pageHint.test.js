/**
 * P4-F unification — setVoicePageHint / getVoicePageHint module-level ref.
 *
 * The ref is intentionally not React state so components can write to it
 * without re-render. Tests verify the ref behavior and string trimming.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { setVoicePageHint, getVoicePageHint } from './VoiceContext'

describe('voice page hint ref', () => {
  beforeEach(() => {
    setVoicePageHint(null)
  })

  it('returns null when nothing is set', () => {
    expect(getVoicePageHint()).toBeNull()
  })

  it('returns the hint after setting', () => {
    setVoicePageHint('chart of NVDA')
    expect(getVoicePageHint()).toBe('chart of NVDA')
  })

  it('trims whitespace', () => {
    setVoicePageHint('   chart of NVDA   ')
    expect(getVoicePageHint()).toBe('chart of NVDA')
  })

  it('clears when set to null', () => {
    setVoicePageHint('chart of AAPL')
    expect(getVoicePageHint()).toBe('chart of AAPL')
    setVoicePageHint(null)
    expect(getVoicePageHint()).toBeNull()
  })

  it('clears when set to empty string', () => {
    setVoicePageHint('chart of AAPL')
    setVoicePageHint('')
    expect(getVoicePageHint()).toBeNull()
  })

  it('overwrites previous hint', () => {
    setVoicePageHint('chart of NVDA')
    setVoicePageHint('chart of AAPL')
    expect(getVoicePageHint()).toBe('chart of AAPL')
  })

  it('handles undefined safely', () => {
    setVoicePageHint(undefined)
    expect(getVoicePageHint()).toBeNull()
  })

  it('coerces non-string input to string', () => {
    setVoicePageHint(42)
    expect(getVoicePageHint()).toBe('42')
  })
})

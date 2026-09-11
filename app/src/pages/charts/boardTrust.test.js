import { describe, it, expect, beforeEach, vi } from 'vitest'
import { markBoardCrashed, boardCrashed, subscribeBoardTrust, _resetBoardTrustForTests } from './boardTrust'

beforeEach(() => _resetBoardTrustForTests())

describe('board trust — the settings-side counterpart of the shrink guard', () => {
  it('⭐ starts trusted', () => {
    expect(boardCrashed()).toBe(false)
  })

  it('⛔ a render error marks the board untrusted, and says so loudly', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    markBoardCrashed(new Error('Should have a queue'))
    expect(boardCrashed()).toBe(true)
    expect(warn).toHaveBeenCalled()
    // The warning has to be actionable — it names the cause and the recovery.
    const msg = warn.mock.calls[0].join(' ')
    expect(msg).toMatch(/auto-save suspended/i)
    expect(msg).toMatch(/Should have a queue/)
    expect(msg).toMatch(/reload/i)
    warn.mockRestore()
  })

  it('⛔ it is ONE-WAY — there is no safe moment to declare a rebuilt board healthy', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    markBoardCrashed(new Error('first'))
    markBoardCrashed(new Error('second'))
    expect(boardCrashed()).toBe(true)
    // …and it only warns once, so a crash loop cannot flood the console.
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it('⭐ subscribers are notified so the workspace can re-render and stop saving', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fn = vi.fn()
    const off = subscribeBoardTrust(fn)
    markBoardCrashed(new Error('x'))
    expect(fn).toHaveBeenCalledTimes(1)
    off()
    warn.mockRestore()
  })

  it('⛔ a throwing listener cannot break the guard itself', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    subscribeBoardTrust(() => { throw new Error('listener exploded') })
    expect(() => markBoardCrashed(new Error('x'))).not.toThrow()
    expect(boardCrashed()).toBe(true)
    warn.mockRestore()
  })

  it('⭐ a missing/odd error still produces a usable message', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    markBoardCrashed(undefined)
    expect(warn.mock.calls[0].join(' ')).toMatch(/a render error/)
    warn.mockRestore()
  })
})

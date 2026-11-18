import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { showBrowserNotification } from './alertSound'

let made
beforeEach(() => {
  made = []
  class FakeNotification {
    constructor(title, opts) {
      this.title = title
      this.opts = opts
      this.close = vi.fn()
      made.push(this)
    }
  }
  FakeNotification.permission = 'granted'
  vi.stubGlobal('Notification', FakeNotification)
  window.Notification = FakeNotification
  vi.spyOn(window, 'focus').mockImplementation(() => {})
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('showBrowserNotification', () => {
  it('keeps the legacy tag and focus-only click with no options (other callers unchanged)', () => {
    showBrowserNotification('T', 'B')
    expect(made[0].opts.tag).toBe('uct-alert')
    made[0].onclick()
    expect(window.focus).toHaveBeenCalled()
    expect(made[0].close).toHaveBeenCalled()
  })
  it('uses the supplied tag so several alerts do not replace each other', () => {
    showBrowserNotification('A', 'a', undefined, { tag: 'uct-alert-1' })
    showBrowserNotification('B', 'b', undefined, { tag: 'uct-alert-2' })
    expect(made.map(n => n.opts.tag)).toEqual(['uct-alert-1', 'uct-alert-2'])
  })
  it('runs onClick after focusing, and closes the notification', () => {
    const onClick = vi.fn()
    showBrowserNotification('A', 'a', undefined, { onClick })
    made[0].onclick()
    expect(window.focus).toHaveBeenCalled()
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(made[0].close).toHaveBeenCalled()
  })
  it('a throwing onClick does not escape the handler', () => {
    showBrowserNotification('A', 'a', undefined, { onClick: () => { throw new Error('x') } })
    expect(() => made[0].onclick()).not.toThrow()
  })
})

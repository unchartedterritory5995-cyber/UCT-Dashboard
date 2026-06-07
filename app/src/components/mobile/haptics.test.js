import { afterEach, vi } from 'vitest'
import { tap, success } from './haptics'

afterEach(() => { vi.restoreAllMocks(); delete navigator.vibrate })

test('tap calls navigator.vibrate with a short pulse', () => {
  navigator.vibrate = vi.fn(() => true)
  tap()
  expect(navigator.vibrate).toHaveBeenCalledWith(10)
})

test('success uses a multi-pulse pattern', () => {
  navigator.vibrate = vi.fn(() => true)
  success()
  expect(navigator.vibrate).toHaveBeenCalledWith([10, 40, 12])
})

test('no-ops (no throw) when vibrate is unsupported', () => {
  delete navigator.vibrate
  expect(() => tap()).not.toThrow()
})

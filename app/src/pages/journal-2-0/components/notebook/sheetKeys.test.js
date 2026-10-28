// sheetKeys.js: one registry registration per key set while any sheet instance holds it, every live holder called in
// the order it took hold (what two raw window listeners did while a closing sheet and its successor overlapped).
import { describe, it, expect, vi } from 'vitest'
import { holdSheetKeys } from './sheetKeys'
import { registerShortcuts, ShortcutConflictError } from '../../../command/shortcutRegistry'

const esc = () => {
  const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
  document.body.dispatchEvent(e)
  return e
}

describe('holdSheetKeys', () => {
  it('two overlapping holders are both called, in the order they took hold, through ONE registration', () => {
    const calls = []
    const a = holdSheetKeys('myToolsTab', () => calls.push('a'))
    const b = holdSheetKeys('myToolsTab', () => calls.push('b'))  // the successor, while the first is still mounted
    // ONE live registration: the registry still refuses a second owner of the binding.
    expect(() => registerShortcuts({ 'myTools.tabEscape': () => {} })).toThrow(ShortcutConflictError)
    esc()
    expect(calls).toEqual(['a', 'b'])
    a()                                     // the closing sheet unmounts a tick later
    esc()
    expect(calls).toEqual(['a', 'b', 'b'])
    b()
    b()                                     // idempotent
    esc()
    expect(calls).toEqual(['a', 'b', 'b'])
    // ...and released, the binding is free again.
    const again = registerShortcuts({ 'myTools.tabEscape': () => {} })
    again()
  })

  it('the builder set answers Escape and Ctrl/Cmd+Enter/Z/Y on window capture, and nothing else', () => {
    const fn = vi.fn()
    const spy = vi.spyOn(window, 'addEventListener')
    const off = holdSheetKeys('builder', fn)
    expect(spy.mock.calls.filter((c) => c[0] === 'keydown').map((c) => c[2])).toEqual([true])
    for (const init of [{ key: 'Escape' }, { key: 'Enter', ctrlKey: true }, { key: 'z', metaKey: true }, { key: 'Y', ctrlKey: true, shiftKey: true }]) {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { ...init, bubbles: true }))
    }
    for (const init of [{ key: 'Enter' }, { key: 'z' }, { key: 'a', ctrlKey: true }]) {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { ...init, bubbles: true }))
    }
    expect(fn).toHaveBeenCalledTimes(4)
    off()
    spy.mockRestore()
  })

  it('an unknown key set is refused by name', () => {
    expect(() => holdSheetKeys('nope', () => {})).toThrow(/nope/)
  })
})

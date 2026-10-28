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

  // The raw listeners these replaced had NO focus guard: each handler decides about fields itself (the builder lets
  // Ctrl+Enter save from the Name field, keeps a text field's own undo but undoes from a checkbox or radio). So every
  // sheet binding is inEditable, and the registry must hand them the key with an editable element focused. At the
  // builder's main level no real checkbox or radio exists (its radios are buttons), so this is railed here, on the
  // declarations, with a focused <input type=checkbox> and <input type=text>.
  it.each([
    ['builder', [{ key: 'Escape' }, { key: 'Enter', ctrlKey: true }, { key: 'z', ctrlKey: true }, { key: 'y', metaKey: true }]],
    ['toolEditor', [{ key: 'Escape' }]],
    ['myToolsTab', [{ key: 'Escape' }]],
  ])('%s: its keys reach the handler with a text field or a checkbox focused', (name, keys) => {
    const fn = vi.fn()
    const off = holdSheetKeys(name, fn)
    for (const type of ['text', 'checkbox']) {
      const input = document.body.appendChild(document.createElement('input'))
      input.type = type
      input.focus()
      expect(document.activeElement).toBe(input)
      for (const init of keys) input.dispatchEvent(new KeyboardEvent('keydown', { ...init, bubbles: true }))
      input.remove()
    }
    expect(fn).toHaveBeenCalledTimes(keys.length * 2)
    off()
  })

  it('a holder released DURING a dispatch (its sheet unmounted by an earlier handler) is not called', () => {
    const calls = []
    let releaseB = null
    const a = holdSheetKeys('toolEditor', () => { calls.push('a'); releaseB() })
    releaseB = holdSheetKeys('toolEditor', () => calls.push('b'))
    const c = holdSheetKeys('toolEditor', () => calls.push('c'))
    esc()
    expect(calls).toEqual(['a', 'c'])
    a(); c()
  })

  it('an unknown key set is refused by name', () => {
    expect(() => holdSheetKeys('nope', () => {})).toThrow(/nope/)
  })
})

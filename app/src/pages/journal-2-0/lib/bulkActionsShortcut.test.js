import { describe, it, expect } from 'vitest'
import { isBulkActionsShortcut, bulkActionsChordLabel } from './bulkActionsShortcut'

/** Wave 13 lane 13Q-5 — mirrors dailyNote.test.js's isDailyShortcut coverage. */
const key = (over = {}) => ({
  code: 'KeyB', key: 'b', altKey: true, ctrlKey: false, metaKey: false, shiftKey: false,
  getModifierState: () => false, ...over,
})

describe('isBulkActionsShortcut', () => {
  it('is Ctrl+Alt+B, and Cmd+Option+B (where Option makes the key "∫")', () => {
    expect(isBulkActionsShortcut(key({ ctrlKey: true }))).toBe(true)
    expect(isBulkActionsShortcut(key({ metaKey: true, key: '∫' }))).toBe(true)
  })

  it('is never AltGr (a character a member meant to type), nor another combination', () => {
    expect(isBulkActionsShortcut(key({ ctrlKey: true, getModifierState: (m) => m === 'AltGraph' }))).toBe(false)
    expect(isBulkActionsShortcut(key({ ctrlKey: true, shiftKey: true }))).toBe(false)
    expect(isBulkActionsShortcut(key({ ctrlKey: true, altKey: false }))).toBe(false)
    expect(isBulkActionsShortcut(key({ altKey: true }))).toBe(false)
    expect(isBulkActionsShortcut(key({ ctrlKey: true, code: 'KeyC' }))).toBe(false)
    expect(isBulkActionsShortcut(null)).toBe(false)
  })

  // ⛔ NON-VACUITY: the Daily shortcut's own chord must never also satisfy this
  // one, or the two features would fight over one keypress.
  it('does not fire on the Daily note shortcut (Ctrl+Alt+D)', () => {
    expect(isBulkActionsShortcut(key({ ctrlKey: true, code: 'KeyD', key: 'd' }))).toBe(false)
  })
})

describe('bulkActionsChordLabel', () => {
  it('reads Ctrl+Alt+B off a non-Mac platform', () => {
    const d = Object.getOwnPropertyDescriptor(window.navigator, 'platform')
    Object.defineProperty(window.navigator, 'platform', { value: 'Win32', configurable: true })
    expect(bulkActionsChordLabel()).toBe('Ctrl+Alt+B')
    if (d) Object.defineProperty(window.navigator, 'platform', d)
  })

  it('reads Cmd+Option+B on a Mac', () => {
    const d = Object.getOwnPropertyDescriptor(window.navigator, 'platform')
    Object.defineProperty(window.navigator, 'platform', { value: 'MacIntel', configurable: true })
    expect(bulkActionsChordLabel()).toBe('Cmd+Option+B')
    if (d) Object.defineProperty(window.navigator, 'platform', d)
  })
})

// S14 (audit 2026-11-05, "Settings shows ⌘K on Windows"): the header's "Jump to…" chip named the Mac chord on
// every machine. It names this machine's.
import { describe, it, expect, afterEach } from 'vitest'
import { paletteChordLabel } from './Settings'

const real = Object.getOwnPropertyDescriptor(Navigator.prototype, 'platform')
const setPlatform = (v) => Object.defineProperty(navigator, 'platform', { value: v, configurable: true })
afterEach(() => { delete navigator.platform; if (real) Object.defineProperty(Navigator.prototype, 'platform', real) })

describe('the Settings palette chip', () => {
  it('Windows reads Ctrl K, never ⌘', () => {
    setPlatform('Win32')
    expect(paletteChordLabel()).toBe('Ctrl K')
  })
  it('a Mac reads ⌘K (CONTROL: the label really depends on the platform)', () => {
    setPlatform('MacIntel')
    expect(paletteChordLabel()).toBe('⌘K')
  })
})

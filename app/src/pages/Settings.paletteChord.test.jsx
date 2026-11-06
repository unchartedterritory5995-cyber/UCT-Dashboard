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

// Tier 2 fix round 1 (review minors 15 and 16). Settings is a page with many cards and reads; these are read from its
// source (the rendered Help-host contract itself is railed in FeedbackWidget.test.jsx and JournalLayout.test.jsx).
describe('Settings has ONE "?" and ONE "is this a Mac?"', () => {
  it('its "?" is THE Help button: it registers as the help host and the shortcuts host, and opens the one menu', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const src = readFileSync(join(process.cwd(), 'src', 'pages', 'Settings.jsx'), 'utf8')
    expect(src).toMatch(/useEffect\(\(\) => registerHelpHost\(\), \[\]\)/)
    expect(src).toMatch(/useEffect\(\(\) => registerShortcutsHost\(\(\) => setHelpOpen\(true\)\), \[\]\)/)
    expect(src).toMatch(/openFeedback\('menu', helpBtnRef\.current, \{ toggle: true \}\)/)
    expect(src).not.toMatch(/aria-label="Show keyboard shortcuts"/)
    // review minor 16: no second Mac regex
    expect(src).not.toMatch(/\/Mac\|iPhone/)
    expect(src).toMatch(/import \{ isMacPlatform \} from '\.\/journal-2-0\/lib\/platform'/)
  })
})

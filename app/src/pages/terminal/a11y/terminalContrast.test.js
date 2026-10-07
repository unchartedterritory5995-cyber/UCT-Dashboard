// app/src/pages/terminal/a11y/terminalContrast.test.js
//
// RAIL: every text colour the terminal's own stylesheets declare clears WCAG AA (4.5:1, 3:1
// for large text) against every surface it can sit on, in EVERY app theme — dark, oled,
// light and the 18 catalog themes (styles/appThemes.js). Derived, never typed: the file set
// is walked from disk and the theme set comes from tokens.css + APP_THEMES, so a stylesheet
// or a theme added tomorrow is covered the day it lands.
//
// ⛔ WHAT THIS EXISTS FOR (audit 2026-10-06, docs/terminal-research/14-visual/
// a11y-audit-2026-10-06.md): `--loss` used as TEXT read 3.18–4.41:1 on the dark catalog
// themes' raised surfaces (worst: Nord --bg-hover 3.18), and `--gain` read 4.19–4.44:1 on the
// light themes' hover. `--loss`/`--gain` also colour chart candles app-wide, so the fix was
// NOT to move them: terminal text now uses the text inks `--danger-ink` / `--success-ink`,
// lifted in tokens.css until they clear every catalog surface. Fix contrast in the TOKENS,
// never with a per-theme colour in terminal CSS.
import { describe, it, expect } from 'vitest'
import { APP_THEMES } from '../../../styles/appThemes'
import { allThemes, auditCss, auditTerminalContrast, terminalCss } from './__tests__/terminalContrast'

const THEMES = allThemes()
const ROWS = auditTerminalContrast(terminalCss(), THEMES)

describe('terminal text contrast — every theme, every surface', () => {
  it('measures all 21 themes (3 base + every catalog theme)', () => {
    expect(Object.keys(THEMES)).toHaveLength(3 + APP_THEMES.length)
    expect(APP_THEMES.length).toBe(18)
  })

  it('found the terminal stylesheets and real text pairs (non-vacuity)', () => {
    const files = terminalCss()
    expect(files).toContain('pages/terminal/TerminalShell.module.css')
    expect(files).toContain('components/terminal/PanelState.module.css')
    expect(files).toContain('pages/terminal/panels/moversPanel.module.css')
    const selectors = new Set(ROWS.map((r) => r.selector))
    expect(selectors.has('.down')).toBe(true) // the red numbers the audit was about
    expect(ROWS.length).toBeGreaterThan(5000)
  })

  it('no text pair falls under its WCAG AA bar', () => {
    const fails = ROWS.filter((r) => !r.pass)
      .map((r) => `${r.file} ${r.selector} [${r.prop}] ${r.theme} on ${r.surface}: ${r.ratio.toFixed(2)} < ${r.bar}`)
    expect(fails, `text under WCAG AA — fix it in a TOKEN (tokens.css / appThemes.js), not per theme:\n${fails.slice(0, 40).join('\n')}`).toEqual([])
  })

  it('CONTROL: the audit SEES a failing pair (--loss as text on the catalog themes)', () => {
    const rows = auditCss('fixture.css', '.bad { color: var(--loss); }', THEMES)
    const worst = rows.filter((r) => !r.pass)
    expect(worst.length).toBeGreaterThan(0)
    expect(worst.some((r) => r.theme === 'uct:nord' && r.surface === '--bg-hover')).toBe(true)
  })

  it('CONTROL: opacity is composited (an otherwise-passing ink dimmed to 0.3 fails)', () => {
    const ok = auditCss('fixture.css', '.t { color: var(--text-muted); }', THEMES)
    const dim = auditCss('fixture.css', '.t { color: var(--text-muted); opacity: 0.3; }', THEMES)
    expect(ok.every((r) => r.pass)).toBe(true)
    expect(dim.some((r) => !r.pass)).toBe(true)
  })

  it('CONTROL: an unresolvable token throws by name rather than being skipped', () => {
    expect(() => auditCss('fixture.css', '.x { color: var(--no-such-token); }', THEMES)).toThrow(/--no-such-token/)
  })
})

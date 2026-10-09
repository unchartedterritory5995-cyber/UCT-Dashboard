// app/src/pages/terminal/a11y/linkGroupColours.test.js
//
// RAIL (wave 4, lane D): the terminal's link-group colours follow the theme at RENDER time
// while what is STORED never changes.
//
// ⛔ THE DEFECT: a group's colour is a fixed hex (boardModel.js GROUP_DOT / CHANNEL_COLORS,
// pinned to /charts' COLOR_HEX and saved in boards and share links) and the terminal painted it
// raw, so the group letter drawn in it read 1.2:1 (yellow #facc15) to 2.2:1 on the light themes.
// The fix maps each stored hex to a display token (tokens.css `--link-group-*`) in
// `groupStyle()`. Nothing stored moves: no migration, the hexes stay byte-identical.
//
// terminalContrast.test.js cannot see this on its own: the stylesheet reads
// `var(--dot-ink, var(--text))`, a property set inline per group, so its audit resolves the
// fallback. This file measures every group token as TEXT, on every surface, in all 21 themes.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CHANNEL_COLORS, COMPAT_CHANNELS, GROUP_DOT, groupStyle, normalizeLayout } from '../boardModel'
import { allThemes, auditCss, parseRules, declarations, TOKENS_CSS } from './__tests__/terminalContrast'

const THEMES = allThemes()
const STORED = [...COMPAT_CHANNELS.map((id) => GROUP_DOT[id]), ...CHANNEL_COLORS]
const tokenOf = (hex) => /^var\((--link-group-[a-z0-9]+)\)$/.exec(groupStyle(hex)['--dot-ink'] || '')?.[1]

describe('link-group colours — stored hex unchanged, rendered colour follows the theme', () => {
  it('the stored palette is exactly what /charts stores (no migration of member data)', () => {
    expect(GROUP_DOT).toEqual({ A: '#c9a84c', B: '#60a5fa', C: '#4ade80', D: '#c084fc', N: '#6b7280' })
    expect(CHANNEL_COLORS).toEqual(['#f472b6', '#fb923c', '#2dd4bf', '#facc15', '#a3e635', '#38bdf8', '#e879f9', '#f87171'])
    // A saved board's channel keeps its stored hex through a read.
    const layout = normalizeLayout({ v: 2, channels: [{ id: 'E', name: 'Group E', color: '#facc15', history: [] }], panels: [] })
    expect(layout.channels.find((c) => c.id === 'E').color).toBe('#facc15')
  })

  it('every stored group hex maps to its own display token, for the ring and the letter', () => {
    const tokens = STORED.map(tokenOf)
    expect(tokens.every(Boolean), `unmapped: ${STORED.filter((h) => !tokenOf(h)).join(', ')}`).toBe(true)
    expect(new Set(tokens).size).toBe(STORED.length)
    for (const hex of STORED) {
      const s = groupStyle(hex)
      expect(s['--dot']).toBe(s['--dot-ink'])
      expect(s['--dot']).not.toContain('#')
    }
    expect(groupStyle('#FACC15')).toEqual(groupStyle('#facc15')) // stored hex case is not meaning
  })

  it('a hex outside the palette keeps its own ring and sets NO letter ink (falls back to --text)', () => {
    expect(groupStyle('#123456')).toEqual({ '--dot': '#123456' })
    expect(groupStyle(null)).toEqual({})
    expect(groupStyle('var(--x)')).toEqual({}) // never an injected value
  })

  it('on the dark default (and oled) each token IS its stored hex — the terminal draws what /charts draws', () => {
    for (const hex of STORED) {
      const t = tokenOf(hex)
      expect(THEMES.dark.get(t), t).toBe(hex)
      expect(THEMES.oled.get(t), t).toBe(hex)
    }
  })

  it('⛔ every group token, read as TEXT, clears WCAG AA on every surface of all 21 themes', () => {
    const fails = []
    for (const hex of STORED) {
      const t = tokenOf(hex)
      const rows = auditCss('fixture.css', `.x { color: var(${t}); }`, THEMES)
      expect(rows.length).toBe(Object.keys(THEMES).length * 4)
      for (const r of rows.filter((x) => !x.pass)) fails.push(`${t} ${r.theme} on ${r.surface}: ${r.ratio.toFixed(2)}`)
    }
    expect(fails, fails.slice(0, 30).join('\n')).toEqual([])
  })

  it('CONTROL: the raw stored hexes FAIL as text on the light themes (the defect this fixes)', () => {
    const light = Object.fromEntries(Object.entries(THEMES).filter(([k, v]) => k === 'light' || v.get('--ut-gold') === '#7a5c16'))
    expect(Object.keys(light).length).toBeGreaterThan(1)
    const failing = STORED.filter((hex) => auditCss('fixture.css', `.x { color: ${hex}; }`, light).some((r) => !r.pass))
    expect(failing).toEqual(STORED)
  })

  it('the group-dot letter reads --dot-ink (never the raw ring colour) in TerminalShell.module.css', () => {
    const css = readFileSync(join(process.cwd(), 'src', 'pages', 'terminal', 'TerminalShell.module.css'), 'utf8')
    const rules = parseRules(css)
      .filter((r) => (r.selector === '.groupDot' || r.selector === '.groupDotStatic') && declarations(r.body).has('color'))
    expect(rules.map((r) => r.selector).sort()).toEqual(['.groupDot', '.groupDotStatic'])
    for (const r of rules) expect(declarations(r.body).get('color').replace(/\s+/g, ' ')).toBe('var(--dot-ink, var(--text))')
  })

  it('tokens.css declares a light value for every group token (so the light theme actually differs)', () => {
    const css = readFileSync(TOKENS_CSS, 'utf8')
    for (const hex of STORED) {
      const t = tokenOf(hex)
      expect(THEMES.light.get(t), t).not.toBe(hex)
      expect(css).toContain(`${t}:`)
    }
  })
})

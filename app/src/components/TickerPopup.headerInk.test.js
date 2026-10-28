// The TickerPopup header's day change (`-16.99%` beside the price) reads as TEXT at >= 4.5:1 on the
// popup in EVERY app theme.
//
// Measured on the live site (Playwright WebKit + axe, desktop 1200, a DOWN ticker): the span was
// `--ut-red` #c0392b on the popup's #0a0a0a = 3.64:1 at 13px (axe color-contrast, serious). The
// red/green-as-text rule (terminalReachableContrast.test.js): text takes `--danger-ink` /
// `--success-ink`, never a candle or brand hue. The UP side was `--ut-green-bright`, which happened
// to pass, but it is the same mistake waiting for a theme; both sides now take the inks.
//
// The surface: the header has no background of its own, so the text sits on `.modal`'s.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { allThemes, parseColor, resolveVars } from '../pages/terminal/a11y/__tests__/terminalContrast'
import { contrast, composite } from '../styles/__tests__/contrastMath'

const SRC = join(process.cwd(), 'src')
const read = (p) => readFileSync(join(SRC, p), 'utf8')
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')
const CSS = stripComments(read('components/TickerPopup.module.css'))
const JSX = read('components/TickerPopup.jsx')
const INK = { up: ['.modalChangeUp', '--success-ink'], down: ['.modalChangeDown', '--danger-ink'] }

/** Every value any rule (in or out of @media) whose selector list holds exactly `selector` gives `prop`. */
function allDeclared(css, selector, prop) {
  const out = []
  for (const [, sels, decls] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!sels.split(',').some((s) => s.trim() === selector)) continue
    for (const m of decls.matchAll(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+?)\\s*(?=;|$)`, 'g'))) out.push(m[1])
  }
  return out
}
const opaque = (value, vars, under) => {
  const c = parseColor(resolveVars(value, vars))
  return c.alpha >= 1 ? c.rgb.map(Math.round) : composite(c.rgb, c.alpha, under)
}
const MODAL_BG = allDeclared(CSS, '.modal', 'background')[0]

/** [theme dir ratio] for every theme where `colorOf(dir)` reads under 4.5:1 on the popup. */
function failures(colorOf) {
  const out = []
  for (const [name, raw] of Object.entries(allThemes())) {
    const vars = new Map(raw)
    const bg = opaque(MODAL_BG, vars, [0, 0, 0])
    for (const dir of Object.keys(INK)) {
      const r = contrast(opaque(colorOf(dir), vars, bg), bg)
      if (r < 4.5) out.push(`${name} ${dir} ${r.toFixed(2)}`)
    }
  }
  return out
}

describe('TickerPopup header day change uses the text inks', () => {
  it('each direction is coloured by its ink, and by nothing else anywhere in the sheet', () => {
    for (const [sel, token] of Object.values(INK)) expect(allDeclared(CSS, sel, 'color'), sel).toEqual([`var(${token})`])
  })

  it('the header span the rules name is the one that prints the day change (the wire)', () => {
    expect(JSX).toMatch(/className=\{`\$\{styles\.modalChange\} \$\{liveData\.change_pct >= 0 \? styles\.modalChangeUp : styles\.modalChangeDown\}`\}/)
    // the header has no surface of its own: the text sits on the popup's
    expect(allDeclared(CSS, '.modalHeader', 'background')).toEqual([])
    expect(MODAL_BG).toBe('var(--bg-surface)')
  })

  it('every app theme: both directions clear 4.5:1 on the popup header', () => {
    expect(Object.keys(allThemes()).length).toBeGreaterThanOrEqual(15)
    const shipped = (dir) => allDeclared(CSS, INK[dir][0], 'color')[0]
    expect(failures(shipped)).toEqual([])
  })

  it('CONTROL: the old candle/brand red fails the same check (the math can fail)', () => {
    const old = (dir) => (dir === 'down' ? 'var(--ut-red, var(--danger-ink))' : 'var(--ut-green-bright)')
    const fails = failures(old)
    expect(fails.some((f) => /^oled down 3\.6/.test(f)), fails.join('\n')).toBe(true)
    expect(fails.length).toBeGreaterThan(10)
  })
})

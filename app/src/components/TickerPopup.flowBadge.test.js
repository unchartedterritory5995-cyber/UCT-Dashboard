// The TickerPopup header's flow badge (BULL / BEAR, shown when the popup opens from a flow row)
// reads at >= 4.5:1 in every app theme.
//
// The badge is a FILL in the candle hue (--gain / --loss), which is right for a fill. Its text
// was `var(--bg)`, which on Nord's --loss read 4.41:1 (and 4.56-4.79 across the other dark
// catalog themes, just over the line by accident). The text over a loss/gain fill is now its own
// token pair, `--on-loss` / `--on-gain` (tokens.css), chosen per theme family so it clears 4.5:1
// on the fill it sits on: black in the dark family, white in the light family.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { allThemes, parseColor, resolveVars } from '../pages/terminal/a11y/__tests__/terminalContrast'
import { contrast } from '../styles/__tests__/contrastMath'

const SRC = join(process.cwd(), 'src')
const JSX = readFileSync(join(SRC, 'components/TickerPopup.jsx'), 'utf8')
const FILL = { bull: 'var(--gain)', bear: 'var(--loss)' }

/** The badge's inline style, as written in the JSX: `{ color, background }` expressions. */
function badgeStyle() {
  const m = /<span style=\{\{([^}]*)\}\}>\s*\{flowMeta\.bull \? 'BULL' : 'BEAR'\}/.exec(JSX)
  if (!m) return null
  const prop = (name) => new RegExp(`${name}:\\s*([^,]+?\\?[^:]+:[^,}]+)`).exec(m[1])?.[1].trim()
  return { color: prop('color'), background: prop('background') }
}
/** `flowMeta.bull ? 'A' : 'B'` -> { bull: 'A', bear: 'B' } */
function branches(expr) {
  const m = /^flowMeta\.bull \? '([^']+)' : '([^']+)'$/.exec(expr || '')
  return m ? { bull: m[1], bear: m[2] } : null
}

/** [theme side ratio] wherever `inkOf(side)` reads under 4.5:1 on that side's fill. */
function failures(inkOf) {
  const out = []
  for (const [name, raw] of Object.entries(allThemes())) {
    const vars = new Map(raw)
    for (const side of Object.keys(FILL)) {
      const fill = parseColor(resolveVars(FILL[side], vars))
      const ink = parseColor(resolveVars(inkOf(side), vars))
      expect(fill.alpha, `${name} ${side} fill`).toBe(1)
      const r = contrast(ink.rgb, fill.rgb)
      if (r < 4.5) out.push(`${name} ${side} ${r.toFixed(2)}`)
    }
  }
  return out
}

describe('TickerPopup flow badge text clears 4.5:1 on its own fill', () => {
  it('the badge keeps the candle fill and takes the on-fill ink for the SAME side', () => {
    const s = badgeStyle()
    expect(s, 'the BULL/BEAR badge span').not.toBeNull()
    expect(branches(s.background)).toEqual(FILL)
    expect(branches(s.color)).toEqual({ bull: 'var(--on-gain)', bear: 'var(--on-loss)' })
  })

  it('every app theme: --on-gain on --gain and --on-loss on --loss clear 4.5:1', () => {
    expect(Object.keys(allThemes()).length).toBeGreaterThanOrEqual(15)
    const ink = branches(badgeStyle().color)
    expect(failures((side) => ink[side])).toEqual([])
  })

  it('CONTROL: the old var(--bg) text fails the same check (Nord BEAR 4.41)', () => {
    const fails = failures(() => 'var(--bg)')
    expect(fails, fails.join('\n')).toContain('uct:nord bear 4.41')
  })
})

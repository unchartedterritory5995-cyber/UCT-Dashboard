// The tap drill's prompt pill ("Tap the RS new high") stays off the time axis, the price scale and the RS pane.
//
// Found on the real screen (2026-11-08, the RS drafts): the pill sat at the BOTTOM centre of the chart box, which is
// where the time axis prints its dates, and on an RS item the bottom of the box is the RS pane the member is asked to
// tap. It now sits at the TOP of the plot, held left of the price scale, wraps on a phone, and carries its own ink on
// its own plate (the --text-bright token went dark-on-dark on the light theme).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { allThemes, declarations, parseColor, parseRules, resolveVars } from '../../terminal/a11y/__tests__/terminalContrast'
import { contrast, composite } from '../../../styles/__tests__/contrastMath'

const DIR = join(process.cwd(), 'src', 'pages', 'study', 'drills')
const CSS = readFileSync(join(DIR, 'drills.module.css'), 'utf8')
const RULES = parseRules(CSS)
const THEMES = Object.entries(allThemes()).map(([name, raw]) => ({ name, vars: new Map(raw) }))

const opaque = (value, vars, under) => {
  const c = parseColor(resolveVars(value, vars))
  return c.alpha >= 1 ? c.rgb.map(Math.round) : composite(c.rgb, c.alpha, under)
}

describe('the tap prompt pill stays off the time axis and the price scale', () => {
  const hud = RULES.filter((r) => r.selector.split(',').some((x) => x.trim() === '.hud'))
  const all = (prop) => hud.map((r) => declarations(r.body).get(prop)).filter((v) => v != null)

  it('anchors to the TOP of the chart box, never the bottom (where the dates print), in every rule and @media', () => {
    expect(hud.length).toBeGreaterThan(0)
    expect(all('bottom')).toEqual([])
    expect(all('top').map((v) => parseFloat(v))).toEqual([expect.any(Number)])
    expect(parseFloat(all('top')[0])).toBeLessThanOrEqual(16)
  })

  it('is held left of the price scale and wraps rather than running under it on a phone', () => {
    expect(parseFloat(all('right').at(-1))).toBeGreaterThanOrEqual(64)
    expect(all('white-space').at(-1)).toBe('normal')
    expect(all('max-width').at(-1)).toMatch(/calc\(100% - .*72px\)/)
    expect(all('pointer-events').at(-1)).toBe('none')     // a tap through the pill still lands on the chart
  })

  it('reads >= 4.5:1 on its own plate over a dark AND a light chart canvas, in every theme', () => {
    expect(THEMES.some((t) => t.name === 'light')).toBe(true)
    const bad = []
    for (const t of THEMES) {
      for (const canvas of [[15, 15, 15], [255, 255, 255]]) {
        const plate = opaque(all('background').at(-1), t.vars, canvas)
        const r = contrast(opaque(all('color').at(-1), t.vars, plate), plate)
        if (r < 4.5) bad.push(`${t.name} ${canvas} ${r.toFixed(2)}`)
      }
    }
    expect(bad).toEqual([])
  })

  it('is the overlay TapDrill renders inside the chart box (the wire)', () => {
    const tap = readFileSync(join(DIR, 'TapDrill.jsx'), 'utf8')
    expect(tap).toMatch(/className=\{`\$\{styles\.hud\} /)
  })
})

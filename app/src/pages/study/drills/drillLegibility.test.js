// Two legibility rails for the drills, both from the real-screen review of the RS drafts (2026-11-08).
//
// 1. The answer cards (ChoiceList: Yes / No, Line A / Line B, every choice list) read at >= 4.5:1 in EVERY app theme,
// in every state a member sees: resting, picked, right, wrong.
//
// Found on the real screen (2026-11-08, the RS drafts on the light theme): the cards are the workbench's dark cards
// with LITERAL surfaces (#1b1a16 -> #121212), but their ink was the --text-bright TOKEN, which the light theme turns
// near-black. Dark text on a dark card. The fix keeps the scored dark look and gives the light theme its own block
// (drills.module.css, last): the theme's surface and inks, every state naming both.
//
// 2. The tap drill's prompt pill ("Tap the RS new high") sat at the BOTTOM of the chart box, over the time axis's
// dates. It now sits at the top of the plot, clear of the price scale, and carries its own ink on its own plate.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { allThemes, declarations, parseColor, parseRules, resolveVars } from '../../terminal/a11y/__tests__/terminalContrast'
import { contrast, composite } from '../../../styles/__tests__/contrastMath'
import { APP_THEMES } from '../../../styles/appThemes'

const DIR = join(process.cwd(), 'src', 'pages', 'study', 'drills')
const CSS = readFileSync(join(DIR, 'drills.module.css'), 'utf8')
const JSX = readFileSync(join(DIR, 'ChoiceList.jsx'), 'utf8')
const RULES = parseRules(CSS)
const LIGHT = ":global([data-theme='light'])"

const lightFamily = new Set(['light', ...APP_THEMES.filter((t) => t.family === 'light').map((t) => `uct:${t.id}`)])
const THEMES = Object.entries(allThemes()).map(([name, raw]) => ({ name, vars: new Map(raw), light: lightFamily.has(name) }))

/** The last value any rule whose selector list holds exactly `selector` gives `prop` (source order = the cascade at equal specificity). */
function lastDeclared(selector, prop) {
  let out = null
  for (const r of RULES) {
    if (!r.selector.split(',').some((s) => s.trim() === selector)) continue
    const v = declarations(r.body).get(prop)
    if (v != null) out = v
  }
  return out
}

const opaque = (value, vars, under) => {
  const c = parseColor(resolveVars(value, vars))
  return c.alpha >= 1 ? c.rgb.map(Math.round) : composite(c.rgb, c.alpha, under)
}
/** Every colour stop of a background (a flat colour, or a gradient's hex stops). */
const stops = (bg) => (/gradient\(/.test(bg) ? [...bg.matchAll(/#[0-9a-f]{3,8}\b/gi)].map((m) => m[0]) : [bg])

// [state, selector, ink-selector] for the dark cards: the surface and the ink the cascade lands on.
const DARK = [
  ['resting', '.choice', '.choice'],
  ['picked', '.choice.choice[aria-checked="true"]', '.choice.choice[aria-checked="true"]'],
  ['right', '.choiceRight.choiceRight', '.choiceRight.choiceRight'],
  ['wrong', '.choiceWrong.choiceWrong', '.choiceWrong.choiceWrong'],
]
const LIGHT_STATES = [
  ['resting', `${LIGHT} .choice.choice`],
  ['hover', `${LIGHT} .choice:hover:not(:disabled)`],
  ['picked', `${LIGHT} .choice.choice[aria-checked="true"]`],
  ['right', `${LIGHT} .choice.choiceRight.choiceRight`],
  ['wrong', `${LIGHT} .choice.choiceWrong.choiceWrong`],
]

describe('answer cards follow the theme (light + dark)', () => {
  it('the light block names a surface for every state, and an ink for every state that changes it', () => {
    for (const [state, sel] of LIGHT_STATES) {
      expect(lastDeclared(sel, 'background'), `${state} background`).toBeTruthy()
      if (state !== 'hover') expect(lastDeclared(sel, 'color'), `${state} color`).toMatch(/^var\(--/)
    }
  })

  it('the light block is LAST: no unscoped card rule after it can win a tie', () => {
    const first = RULES.findIndex((r) => r.selector.startsWith(LIGHT))
    expect(first).toBeGreaterThan(0)
    const after = RULES.slice(first).filter((r) => /\.choice\b|\.choiceRight|\.choiceWrong/.test(r.selector) && !r.selector.startsWith(LIGHT))
    expect(after.map((r) => r.selector)).toEqual([])
  })

  it('every light theme: each state reads >= 4.5:1 (ink on the card)', () => {
    const bad = []
    for (const t of THEMES.filter((x) => x.light)) {
      const page = opaque('var(--bg)', t.vars, [255, 255, 255])
      for (const [state, sel] of LIGHT_STATES) {
        const bg = opaque(lastDeclared(sel, 'background'), t.vars, page)
        const ink = opaque(lastDeclared(sel, 'color') || lastDeclared(LIGHT_STATES[0][1], 'color'), t.vars, bg)
        const r = contrast(ink, bg)
        if (r < 4.5) bad.push(`${t.name} ${state} ${r.toFixed(2)}`)
      }
    }
    expect(bad).toEqual([])
  })

  it('every dark theme: the workbench cards keep a readable ink on every stop of their surface', () => {
    const bad = []
    for (const t of THEMES.filter((x) => !x.light)) {
      for (const [state, sel, inkSel] of DARK) {
        const ink = opaque(lastDeclared(inkSel, 'color') || lastDeclared('.choice', 'color'), t.vars, [0, 0, 0])
        for (const stop of stops(lastDeclared(sel, 'background'))) {
          const r = contrast(ink, opaque(stop, t.vars, [0, 0, 0]))
          if (r < 4.5) bad.push(`${t.name} ${state} ${stop} ${r.toFixed(2)}`)
        }
      }
    }
    expect(bad).toEqual([])
  })

  it('the light theme exists in the token sheet, and the cards are the classes ChoiceList renders (the wire)', () => {
    expect(THEMES.some((t) => t.name === 'light')).toBe(true)
    expect(JSX).toMatch(/className=\{`\$\{styles\.choice\} \$\{sameAnswer\(choice, rightLabel\) \? styles\.choiceRight : ''\} \$\{sameAnswer\(choice, wrongLabel\) \? styles\.choiceWrong : ''\}`\}/)
  })
})

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

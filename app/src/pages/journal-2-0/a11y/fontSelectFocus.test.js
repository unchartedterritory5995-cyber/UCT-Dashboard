// app/src/pages/journal-2-0/a11y/fontSelectFocus.test.js
//
// F4 / A2R-11 (consistency, WCAG 2.4.7): lane 10E-2's walk measured the editor toolbar's two
// selects -- "Font family" and "Text size" -- showing keyboard focus only as a 1 px border
// colour change (`select-focus/select-focus.json`: outline `none 0px`, border 102 -> gold),
// while every other control wears the app's 2 px gold ring. The cause was one rule,
// `.fontSelect:focus, .fontSizeSelect:focus { outline: none; ... }` in
// components/notebook/NoteEditorPage.module.css, which beat the app-wide `:focus-visible`
// ring in tokens.css on specificity.
//
// A STRUCTURAL rail, because jsdom computes no cascade: it names the stylesheet it guards and
// the line of every rule it reads. No rule that selects either select may suppress the
// outline (only a `:focus:not(:focus-visible)` rule may, the mouse-only case), and the ring
// they now fall through to must still be the 2 px gold one. A control proves the check can see
// the defect: the old rule, fed through the same check, fails.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { J2_DIR } from './population'
import { parseRules, declarations, TOKENS_CSS } from './cssAudit'

const SHEET = 'components/notebook/NoteEditorPage.module.css'
const SELECTS = /\.(fontSelect|fontSizeSelect)(?![\w-])/
const SUPPRESS = /^(none|0)$/
const mouseOnly = (sel) => /:focus:not\(:focus-visible\)/.test(sel)

/** Every rule of `css` that selects a toolbar select and kills its outline, as `sheet:line`. */
function suppressions(css, sheet) {
  const found = []
  for (const r of parseRules(css)) {
    const parts = r.selector.split(',').map((p) => p.trim()).filter((p) => SELECTS.test(p) && !mouseOnly(p))
    if (!parts.length) continue
    for (const d of declarations(r)) {
      if (d.prop === 'outline' && SUPPRESS.test(d.value)) found.push(`${sheet}:${d.line} "${r.selector}"`)
    }
  }
  return found
}

describe('the toolbar font selects wear the app focus ring (F4, A2R-11)', () => {
  const css = readFileSync(join(J2_DIR, SHEET), 'utf8')

  it('non-vacuity: the sheet really styles both selects, including a focus rule', () => {
    const rules = parseRules(css).filter((r) => SELECTS.test(r.selector))
    expect(rules.length).toBeGreaterThan(0)
    expect(rules.some((r) => /\.fontSelect(?![\w-])/.test(r.selector))).toBe(true)
    expect(rules.some((r) => /\.fontSizeSelect(?![\w-])/.test(r.selector))).toBe(true)
    expect(rules.some((r) => /:focus/.test(r.selector))).toBe(true)
  })

  it(`no rule in ${SHEET} suppresses their outline`, () => {
    expect(suppressions(css, SHEET)).toEqual([])
  })

  it('the ring they fall through to is the app-wide 2 px gold :focus-visible outline', () => {
    const tokens = readFileSync(TOKENS_CSS, 'utf8')
    const ring = parseRules(tokens).find((r) => r.selector === ':focus-visible')
    expect(ring, 'tokens.css has no bare :focus-visible rule').toBeTruthy()
    const outline = declarations(ring).find((d) => d.prop === 'outline')
    expect(outline?.value).toBe('2px solid var(--ut-gold)')
  })

  it('⛔ CONTROL — the rule this replaced is seen by the same check', () => {
    const old = '.fontSelect:focus, .fontSizeSelect:focus { outline: none; border-color: var(--ut-gold); }'
    expect(suppressions(old, 'old')).toHaveLength(1)
    // and the mouse-only form stays allowed
    expect(suppressions('.fontSelect:focus:not(:focus-visible) { outline: none; }', 'ok')).toEqual([])
  })
})

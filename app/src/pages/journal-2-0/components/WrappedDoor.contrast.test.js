// P2 Tier 3 final fix T10-C2 and ruling R-T3-FIN-2 -- EVERY bordered control in WrappedDoor.module.css
// reads at >= 3:1 on the Report page's paper.
//
// WCAG 1.4.11 (non-text contrast): the visual boundary that identifies a control needs 3:1 against
// what it sits on. The Report page draws on `.wrap` (ReportPage.module.css), which is #fff in every
// theme. The set of bordered rules is DERIVED by parsing the stylesheet (cssAudit.parseRules strips
// comments first), never typed here, so a control added tomorrow is measured the day it lands. The
// paper is read from its stylesheet too, and the contrast is the one formula
// (styles/__tests__/contrastMath.js).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { contrast } from '../../../styles/__tests__/contrastMath'
import { parseRules, declarations, parseColor, colorsIn } from '../a11y/cssAudit'

const DIR = join(process.cwd(), 'src', 'pages', 'journal-2-0', 'components')
const BAR = 3

const declsOf = (file, selector) => {
  const rule = parseRules(readFileSync(join(DIR, file), 'utf8')).find((r) => r.selector === selector)
  if (!rule) throw new Error(`${selector} not found in ${file}`)
  return Object.fromEntries(declarations(rule).map((d) => [d.prop, d.value]))
}
const opaqueRgb = (value) => {
  const c = parseColor(value)
  if (!c || c.alpha !== 1) throw new Error(`${value} is not an opaque colour`)
  return c.rgb
}

/** Every `border*` declaration carrying a colour, in every rule of `css`: [{selector, prop, colour}]. */
function borderColours(css) {
  const out = []
  for (const rule of parseRules(css)) {
    for (const d of declarations(rule)) {
      if (!d.prop.startsWith('border') || d.prop.includes('radius')) continue
      for (const colour of colorsIn(d.value)) out.push({ selector: rule.selector, prop: d.prop, colour })
    }
  }
  return out
}

/** The entries of `found` whose colour reads under BAR on `paperRgb`, each with its ratio. */
const failing = (found, paperRgb) => found
  .map((f) => ({ ...f, ratio: Number(contrast(opaqueRgb(f.colour), paperRgb).toFixed(2)) }))
  .filter((f) => f.ratio < BAR)

describe('every bordered control on the Report page door (WrappedDoor.module.css)', () => {
  const paper = opaqueRgb(declsOf('ReportPage.module.css', '.wrap').background)
  const found = borderColours(readFileSync(join(DIR, 'WrappedDoor.module.css'), 'utf8'))

  it('non-vacuity: the paper is #fff, and the parse finds the door\'s bordered controls', () => {
    expect(paper).toEqual([255, 255, 255])
    const selectors = found.map((f) => f.selector)
    expect(selectors).toContain('.select')
    expect(selectors.some((s) => s.includes('.open'))).toBe(true)
  })

  it('each border reads at >= 3:1 against the paper (WCAG 1.4.11)', () => {
    expect(failing(found, paper)).toEqual([])
  })

  it('control: the check sees a failing border, the old #ccc and #dcbb5e, in a parsed rule', () => {
    const css = '.a { border: 1px solid #ccc; }\n.b, .c { border-color: #dcbb5e; }\n.d { border: 1px solid #767676; }'
    expect(failing(borderColours(css), paper).map((f) => f.selector)).toEqual(['.a', '.b, .c'])
  })

  it('control: a colour only in a comment is not a border', () => {
    const css = '.a { border: 1px solid #ccc; /* border: 1px solid #767676; */ }'
    expect(failing(borderColours(css), paper).map((f) => f.colour)).toEqual(['#ccc'])
  })
})

// P2 Tier 3 final fix T10-C2 -- the year picker's boundary reads at >= 3:1 on the Report page's paper.
//
// WCAG 1.4.11 (non-text contrast): the visual boundary that identifies a control needs 3:1 against
// what it sits on. The Report page draws on `.wrap` (ReportPage.module.css), which is #fff in every
// theme; the picker's `#ccc` border was about 1.6:1 there. Both colours are READ from the
// stylesheets (comments stripped by cssAudit.parseRules), never typed here, and the contrast is the one
// formula (styles/__tests__/contrastMath.js).
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

describe('the year picker on the Report page (WrappedDoor.module.css `.select`)', () => {
  const paper = declsOf('ReportPage.module.css', '.wrap').background
  const [border] = colorsIn(declsOf('WrappedDoor.module.css', '.select').border)

  it('non-vacuity: the paper and the border colour are both read from the stylesheets', () => {
    expect(opaqueRgb(paper)).toEqual([255, 255, 255])
    expect(border).toBeTruthy()
  })

  it('the border reads at >= 3:1 against the paper (WCAG 1.4.11)', () => {
    const ratio = contrast(opaqueRgb(border), opaqueRgb(paper))
    expect(ratio, `${border} on ${paper}: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(BAR)
  })

  it('control: the old #ccc is the finding (under 3:1 on the same paper)', () => {
    expect(contrast(opaqueRgb('#ccc'), opaqueRgb(paper))).toBeLessThan(BAR)
  })
})

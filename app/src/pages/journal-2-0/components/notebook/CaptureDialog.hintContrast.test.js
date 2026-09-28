// Wave 10 follow-up F5 -- the capture dialog's hint reads at >= 4.5:1 in every theme.
//
// proof walk 10E-1 9b (docs/notebook/proof/walk-fd7d1f42d/axe.json, surface
// capture-dialog, light): axe color-contrast on `p._hint` "Your own words -- saved as
// a note." -- #74777a on #f4f5f6, 4.12:1 against 1.4.3's 4.5. The rule dimmed the
// INHERITED text colour with `opacity: 0.6`, so no stylesheet colour pair existed for
// the Notebook contrast rail (a11y/notebookContrast.test.js) to measure: an opacity
// dim is invisible to a rail that reads colour declarations. The hint now takes the
// theme's own secondary-text token and no opacity.
//
// This rail measures the hint against the surface the dialog is drawn on -- read from
// Sheet.module.css's `.panel`, never typed -- in dark, oled and light, with the one
// formula (styles/__tests__/contrastMath.js) and the one token resolver (a11y/cssAudit.js).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { contrast, composite } from '../../../../styles/__tests__/contrastMath'
import { parseRules, declarations, themeVars, resolveVars, parseColor, THEMES } from '../../a11y/cssAudit'

const SRC = join(process.cwd(), 'src')
const CAPTURE_CSS = join(SRC, 'pages', 'journal-2-0', 'components', 'notebook', 'CaptureDialog.module.css')
const SHEET_CSS = join(SRC, 'components', 'mobile', 'Sheet.module.css')
const BAR = 4.5

const declsOf = (file, selector) => {
  const rule = parseRules(readFileSync(file, 'utf8')).find((r) => r.selector === selector)
  if (!rule) throw new Error(`${selector} not found in ${file}`)
  return Object.fromEntries(declarations(rule).map((d) => [d.prop, d.value]))
}

const vars = themeVars()
const rgb = (value, theme) => {
  const c = parseColor(resolveVars(value, vars[theme]))
  if (c.alpha !== 1) throw new Error(`${value} is translucent in ${theme}; composite it first`)
  return c.rgb
}

describe('the capture dialog hint (CaptureDialog.module.css `.hint`)', () => {
  const hint = declsOf(CAPTURE_CSS, '.hint')
  const surface = declsOf(SHEET_CSS, '.panel').background

  it('non-vacuity: the dialog surface is read from the Sheet, and it is a token', () => {
    expect(surface).toMatch(/^var\(--/)
    for (const t of THEMES) expect(rgb(surface, t)).toHaveLength(3)
  })

  it('dims with a colour token, never with opacity (an opacity dim is invisible to the contrast rail)', () => {
    expect(hint.opacity).toBeUndefined()
    expect(hint.color).toMatch(/^var\(--/)
  })

  it.each(THEMES)('reads at >= 4.5:1 on the dialog surface in %s', (theme) => {
    const ratio = contrast(rgb(hint.color, theme), rgb(surface, theme))
    expect(ratio, `${theme}: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(BAR)
  })

  it('control: the old rule (the body text colour, --text, at opacity 0.6) is the axe finding in light', () => {
    const fg = rgb('var(--text)', 'light')
    const bg = rgb(surface, 'light')
    const seen = composite(fg, 0.6, bg)
    // axe reported #74777a on #f4f5f6: the composite reproduces it exactly
    expect(seen).toEqual(parseColor('#74777a').rgb)
    expect(bg).toEqual(parseColor('#f4f5f6').rgb)
    const ratio = contrast(seen, bg)
    expect(ratio).toBeLessThan(BAR)
    expect(ratio).toBeCloseTo(4.12, 1)
  })
})

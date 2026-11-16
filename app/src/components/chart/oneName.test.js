// One name: a SAVED indicator is called an indicator where a member finds one.
//
// A member who built an "indicator" found it badged "Your formula" under "My formulas",
// and published it to a "Formula library". "Formula" stays the name of ONE thing: the
// typed-expression way of writing an indicator ("write a formula", "New formula",
// the Formula reference). This rail holds the surfaces that list SAVED indicators.
//
// Read from source with comments stripped: prose that explains the old wording must not
// satisfy or trip it.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { USER_CATEGORY, REFUSED_CATEGORY } from './indicatorCatalog'

const read = (p) => fs.readFileSync(path.resolve(__dirname, p), 'utf8')
/** Source without block, JSX-block and line comments. */
const code = (s) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/** Wording for a saved indicator that must not be shown on these surfaces. */
const OLD = [/Your formula(?!s? reference)/, /My formulas/, /saved formulas/, /Formula library/, /Formulas other members/]

const SURFACES = [
  './ChartSettingsIndicators.jsx',
  './IndicatorLibraryDialog.jsx',
  './IndicatorMembersTab.jsx',
  './indicatorCatalog.js',
  '../../pages/formulas/FormulaLibrary.jsx',
  // the formula builder: its own list of saved work (slice 2). "New formula" and "Edit
  // formula" stay, they name the typed way of writing one.
  './builder/BuilderSheet.jsx',
].filter((p) => fs.existsSync(path.resolve(__dirname, p)))

describe('a saved indicator is called an indicator', () => {
  it('the catalogue headings say so', () => {
    expect(USER_CATEGORY).toBe('My indicators')
    expect(REFUSED_CATEGORY).toBe('My indicators — not available')
  })

  it.each(SURFACES)('%s shows none of the old wording', (p) => {
    const src = code(read(p))
    for (const re of OLD) expect(src, `${p} still says ${re}`).not.toMatch(re)
  })

  it('the badge on a member\'s own row reads "Your indicator" in both lists', () => {
    expect(code(read('./ChartSettingsIndicators.jsx'))).toMatch(/resMine\}>Your indicator</)
    expect(code(read('./IndicatorLibraryDialog.jsx'))).toMatch(/styles\.mine\}>Your indicator</)
  })

  it('"formula" is still the name of the typed way in', () => {
    expect(code(read('./ChartSettingsIndicators.jsx'))).toMatch(/>write a formula</)
    expect(code(read('./IndicatorLibraryDialog.jsx'))).toMatch(/New formula/)
  })

  it('⛔ CONTROL: the sweep sees the old wording in code and ignores it in a comment', () => {
    const inCode = 'const a = <span>Your formula</span>'
    const inComment = '// it used to say "Your formula"\n/* My formulas */\n{/* Formula library */}\nconst a = 1'
    expect(OLD.some((re) => re.test(code(inCode)))).toBe(true)
    expect(OLD.some((re) => re.test(code(inComment)))).toBe(false)
  })
})

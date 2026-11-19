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
import { windowTitle, startOverLabel } from './builder/windowTitle'

const read = (p) => fs.readFileSync(path.resolve(__dirname, p), 'utf8')
/** Source without block, JSX-block and line comments. */
const code = (s) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/** Wording for a saved indicator that must not be shown on these surfaces. */
const OLD = [/Your formula(?!s? reference)/, /My formulas/, /saved formulas/, /Formula library/, /Formulas other members/]

const SURFACES = [
  './ChartSettingsIndicators.jsx',
  './IndicatorLibraryDialog.jsx',
  './IndicatorMembersTab.jsx',
  './IndicatorHouseTab.jsx',
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
    expect(code(read('./ChartSettingsIndicators.jsx'))).toMatch(/>[Ww]rite a formula</)   // UCT Signature R2: a sentence-case link ("Write a formula")
  })

  // ⭐ Owner decision 2026-11-17 (backlog 49): the window is named by where it opens. From a chart
  // the member pressed "Create indicator" and the window says so; from the Screener the same
  // window builds a scan's formula and keeps "New formula". The chart's launchers use the same words.
  it('the builder window is titled by where it opens, and the launchers on a chart say what it is titled', () => {
    expect([windowTitle('indicator', false), windowTitle('indicator', true)]).toEqual(['Create indicator', 'Edit indicator'])
    expect([windowTitle('formula', false), windowTitle('formula', true)]).toEqual(['New formula', 'Edit formula'])
    expect(windowTitle(undefined, false)).toBe('New formula')              // a mount that says nothing is the Screener's
    expect([startOverLabel('indicator'), startOverLabel('formula')]).toEqual(['New indicator', 'New formula'])
    const toolbar = code(read('./ChartToolbar.jsx'))
    expect(toolbar).toMatch(/noun="indicator"/)                             // the chart's ONE mount of the window
    expect(toolbar).not.toMatch(/>New formula</)
    expect(code(read('./IndicatorLibraryDialog.jsx'))).toMatch(/createName\}>Create indicator</)
    expect(code(read('./IndicatorLibraryDialog.jsx'))).not.toMatch(/>New formula</)
    // the Screener's mounts do not name a noun, so they keep "formula"
    for (const p of ['../../pages/screener/ScreensManager.jsx', '../../pages/charts/widgets/ScanObjectCard.jsx']) {
      if (!fs.existsSync(path.resolve(__dirname, p))) continue
      const mount = /<BuilderSheet\b[\s\S]*?\/>/.exec(code(read(p)))
      expect(mount, `${p} mounts the window`).not.toBeNull()
      expect(mount[0], p).not.toMatch(/\bnoun=/)
    }
    // CONTROL: the same reader finds the noun on the chart's mount, so the check above can fail
    expect(/<BuilderSheet\b[\s\S]*?\/>/.exec(toolbar)[0]).toMatch(/\bnoun="indicator"/)
  })

  it('⛔ CONTROL: the sweep sees the old wording in code and ignores it in a comment', () => {
    const inCode = 'const a = <span>Your formula</span>'
    const inComment = '// it used to say "Your formula"\n/* My formulas */\n{/* Formula library */}\nconst a = 1'
    expect(OLD.some((re) => re.test(code(inCode)))).toBe(true)
    expect(OLD.some((re) => re.test(code(inComment)))).toBe(false)
  })
})

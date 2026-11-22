// X7 (Studio plan, section 5): a member is never told an indicator is "Valid", "Converted",
// "Verified" or "Supported". Those words claim a check nobody made; the verdict a member reads
// comes from the engine's status or the served row, in its own words.
//
// Swept 2026-11-16: none of these surfaces shows one. This rail keeps it that way. It reads the
// TEXT a member can see (string literals and JSX text) with comments stripped, so a comment
// explaining the rule neither trips it nor satisfies it.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const WORDS = /\b(Valid|Validated|Converted|Verified|Supported)\b/

/** Comments out, line numbers kept. */
const code = (s) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:'"`])\/\/.*$/gm, (m, p) => p + ' '.repeat(m.length - p.length))

/** Every banned word in member-readable text: `file:line text`. */
export function bannedIn(src, name = 'src') {
  const out = []
  code(src).split('\n').forEach((line, i) => {
    if (/^\s*import /.test(line)) return
    for (const m of line.matchAll(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`|>[^<>{}]+</g)) {
      if (WORDS.test(m[0])) out.push(`${name}:${i + 1} ${m[0].slice(0, 100)}`)
    }
  })
  return out
}

const SURFACES = [
  './ChartSettingsIndicators.jsx',
  './IndicatorLibraryDialog.jsx',
  './IndicatorMembersTab.jsx',
  './IndicatorHouseTab.jsx',
  './builder/studio/CreateIndicatorPanel.jsx',
  './builder/SharePanel.jsx',
  './builder/BuilderSheet.jsx',
  './builder/authoring/memberWords.js',
  '../../pages/formulas/FormulaLibrary.jsx',
  '../../pages/formulas/SharedFormula.jsx',
  '../../pages/formulas/FormulaReference.jsx',
].filter((p) => fs.existsSync(path.resolve(__dirname, p)))

describe('no verdict word a member could read as a check that was made', () => {
  it('the sweep covers the surfaces it names', () => {
    expect(SURFACES.length).toBeGreaterThanOrEqual(9)
  })

  it.each(SURFACES)('%s', (p) => {
    expect(bannedIn(fs.readFileSync(path.resolve(__dirname, p), 'utf8'), p)).toEqual([])
  })

  it('⛔ CONTROL: it sees the words in text and ignores them in comments and identifiers', () => {
    const seen = bannedIn("const a = 'Converted to UCT'\nconst b = <p>Supported here</p>\n")
    expect(seen).toHaveLength(2)
    expect(bannedIn('// Verified in a comment\n/* Valid */\n{/* Supported */}\nconst isValid = 1\n')).toEqual([])
  })
})

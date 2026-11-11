// @vitest-environment node
// S13 (audit 2026-11-05): the formula editor is shown only while a member writes or edits a formula, so it is its own
// chunk (perf-budgets.md, the `lazyDialog` pattern). One static import of it anywhere on the note's path would pull it
// back into the Notebook's first open, and every rendered test would still pass. This reads the import graph.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const DIR = join(process.cwd(), 'src', 'pages', 'journal-2-0', 'components', 'notebook')

describe('FormulaEditor loads on demand', () => {
  it('PropertiesSection reaches it through exactly one dynamic import', () => {
    const src = readFileSync(join(DIR, 'PropertiesSection.jsx'), 'utf8')
    expect(src.match(/import\(\s*'\.\/FormulaEditor'\s*\)/g)).toHaveLength(1)
    expect(src).not.toMatch(/^import [^\n]*from '\.\/FormulaEditor'/m)
  })

  it('no Notebook component imports it statically', () => {
    const files = readdirSync(DIR).filter((f) => f.endsWith('.jsx') && !f.includes('.test.') && f !== 'FormulaEditor.jsx')
    expect(files.length).toBeGreaterThan(50)   // non-vacuity
    for (const f of files) expect(readFileSync(join(DIR, f), 'utf8'), f).not.toMatch(/^import [^\n]*from '\.\/FormulaEditor'/m)
  })
})

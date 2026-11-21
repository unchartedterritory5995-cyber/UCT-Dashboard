// CATH in a UCT Terminal panel (2026-11-21): the catalysts history table reacts to its OWN width, not only the
// screen's. A Terminal panel on a wide screen gives the table about 525px, where the six fixed columns (540px) cut
// Catalyst Time and left the catalyst text about 94px wide; the small-screen @media rule never matches there.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const css = fs.readFileSync(path.join(here, 'CatalystsHistory.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

/** The body of the first block whose prelude matches `prelude`, or null. */
function blockAfter(prelude) {
  const m = prelude.exec(css)
  if (!m) return null
  let depth = 0
  for (let i = css.indexOf('{', m.index); i < css.length; i += 1) {
    if (css[i] === '{') depth += 1
    if (css[i] === '}') { depth -= 1; if (depth === 0) return css.slice(css.indexOf('{', m.index) + 1, i) }
  }
  return null
}

describe('CATH: the table folds by its own width', () => {
  it('the table box is a named inline-size container', () => {
    const wrap = blockAfter(/\.tableWrap\s*\{/)
    expect(wrap).toMatch(/container:\s*cath-table\s*\/\s*inline-size/)
  })

  it('below 720px of table, Tag and Catalyst Time step aside, and nothing else does', () => {
    const rule = blockAfter(/@container\s+cath-table\s*\(\s*max-width:\s*720px\s*\)/)
    expect(rule).not.toBeNull()
    const hidden = /([^{}]+)\{\s*display:\s*none;?\s*\}/.exec(rule)
    expect(hidden).not.toBeNull()
    const selectors = hidden[1].split(',').map((s) => s.trim()).sort()
    expect(selectors).toEqual(['.colTag', '.colWhen'])
    // symbol, price, change, relative volume and the catalyst itself stay
    for (const kept of ['.colSym', '.colPrice', '.colGap', '.colVol', '.colThesis']) expect(rule).not.toContain(kept)
  })

  it('the small-screen rule is unchanged (it still hides the four narrow columns)', () => {
    expect(css).toMatch(/@media \(max-width: 1024px\)\s*\{\s*\.colSym \{ width: auto; \}\s*\.colPrice, \.colVol, \.colTag, \.colWhen \{ display: none; \}/)
  })
})

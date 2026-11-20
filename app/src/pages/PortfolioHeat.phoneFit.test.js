// Phone fit, part 2 (2026-11-20): the positions table of /portfolio-heat (RISK in the Terminal) ran 45px past a
// 340px screen (25px at 360px) and scrolled sideways with its stop cut off. jsdom lays nothing out, so
// this pins the rule itself; the widths were measured on real screens with the private sweep.
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { describe, it, expect } from 'vitest'

const read = (rel) => fs.readFileSync(path.join(process.cwd(), 'src', rel), 'utf8').replace(/\r\n/g, '\n')
const noComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '')

/** The inside of every `@media <condition>` block, braces matched. */
function mediaBlocks(css, condition) {
  const out = []
  const head = `@media ${condition}`
  let at = css.indexOf(head)
  while (at >= 0) {
    const open = css.indexOf('{', at)
    let depth = 1
    let i = open + 1
    for (; i < css.length && depth > 0; i += 1) {
      if (css[i] === '{') depth += 1
      else if (css[i] === '}') depth -= 1
    }
    out.push(css.slice(open + 1, i - 1))
    at = css.indexOf(head, i)
  }
  return out
}

/** The sheet with every at-rule block taken out: what applies at every width. */
function outsideAtRules(css) {
  let out = ''
  let i = 0
  while (i < css.length) {
    const at = css.indexOf('@', i)
    if (at < 0) { out += css.slice(i); break }
    out += css.slice(i, at)
    const open = css.indexOf('{', at)
    const semi = css.indexOf(';', at)
    if (open < 0 || (semi >= 0 && semi < open)) { i = semi < 0 ? css.length : semi + 1; continue }
    let depth = 1
    let j = open + 1
    for (; j < css.length && depth > 0; j += 1) {
      if (css[j] === '{') depth += 1
      else if (css[j] === '}') depth -= 1
    }
    i = j
  }
  return out
}

const squash = (s) => s.replace(/\s+/g, ' ').trim()

describe('portfolio heat: the positions table fits a small phone', () => {
  const css = noComments(read('pages/PortfolioHeat.module.css'))
  const phone = squash(mediaBlocks(css, '(max-width: 640px)').join('\n'))
  const wide = squash(outsideAtRules(css))

  it('on a phone its cells sit 4px a side', () => {
    expect(phone).toContain('.table th, .table td { padding-inline: var(--space-xs); }')
  })

  it('a wider screen keeps its 12px: the closer cells are a phone rule only', () => {
    expect(wide).not.toMatch(/padding-inline/)
    expect(wide).toMatch(/\.table th \{[^}]*padding: var\(--space-sm\) var\(--space-md\);/)
    expect(wide).toMatch(/\.table td \{[^}]*padding: var\(--space-sm\) var\(--space-md\);/)
  })

  it('the phone rule comes after the rule it overrides (same weight, so the later one wins)', () => {
    const base = css.indexOf('.table td {')
    expect(base).toBeGreaterThan(-1)
    expect(css.indexOf('@media (max-width: 640px)')).toBeGreaterThan(base)
  })

  it('the page keys on the canonical phone breakpoint only, and the table still scrolls if it ever outgrows the screen', () => {
    const widths = [...css.matchAll(/@media[^{]*\(max-width:\s*(\d+)px\)/g)].map((m) => Number(m[1]))
    expect(widths).toEqual([640])
    expect(wide).toContain('.tableWrap { overflow-x: auto; }')
  })
})

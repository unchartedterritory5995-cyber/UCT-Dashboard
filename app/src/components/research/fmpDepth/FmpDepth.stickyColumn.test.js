// Wave 3 (FA P2 #23, shared with EE): the frozen first column of the statement / estimate tables
// sat on --bg-surface inside a --bg-elevated card, so the row labels were a visibly different
// ground and lost the zebra stripe. jsdom does no layout or cascade, so this pins the stylesheet.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(join(here, 'FmpDepth.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
// Every rule block for a selector, joined (a selector may appear in more than one block).
const rule = (selector) => {
  const out = []
  for (let at = css.indexOf(`${selector} {`); at >= 0; at = css.indexOf(`${selector} {`, at + 1)) {
    out.push(css.slice(at, css.indexOf('}', at)))
  }
  return out.join(' ')
}

describe('FmpDepth sticky first column', () => {
  it('inside a card, the frozen cell is on the card ground, not --bg-surface', () => {
    expect(rule('.card')).toMatch(/--sticky-ground:\s*var\(--bg-elevated\)/)
    expect(rule('.table th:first-child, .table td:first-child')).toMatch(/background:\s*var\(--sticky-ground,\s*var\(--bg-surface\)\)/)
  })

  it('an even row keeps its stripe on the frozen cell, layered over an opaque ground', () => {
    const even = rule('.table tbody tr:nth-child(even) > :first-child')
    expect(even).toMatch(/background-image:\s*linear-gradient\(color-mix\(in srgb, var\(--text-heading\) 2%, transparent\)/)
  })
})

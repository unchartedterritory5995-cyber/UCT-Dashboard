// Phone fit, part 3 (2026-11-20): "Market Tide by sector" (TIDE in the Terminal, the Market Tide tab
// of /options-flow) showed the sector and ONE money column on a phone; the other two money columns
// sat behind a sideways scroll. The table now measures its own box: headers and sector names may
// take two lines, and on a phone Prints folds so the three money columns always show.
// The stylesheet is shared by every options panel, so every rule here is on this table's own classes.
// jsdom lays nothing out, so this pins the rules; the widths were measured with the private sweep.
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { describe, it, expect } from 'vitest'

const read = (rel) => fs.readFileSync(path.join(process.cwd(), 'src', rel), 'utf8').replace(/\r\n/g, '\n')
const noComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '')

/** The inside of every block that starts with `head` (an at-rule prelude), braces matched. */
function blocks(css, head) {
  const out = []
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

describe('Market Tide by sector: every money column shows on a small phone', () => {
  const jsx = read('pages/optionsAnalytics/MarketTidePanel.jsx')
  const css = noComments(read('pages/optionsAnalytics/optionsAnalytics.module.css'))
  const wide = squash(outsideAtRules(css))
  const wrapTier = squash(blocks(css, '@container sectortide (max-width: 640px)').join('\n'))
  const phoneTier = squash(blocks(css, '@container sectortide (max-width: 480px)').join('\n'))
  const everyTier = squash(blocks(css, '@container').join('\n'))

  it('the sector table and its scroller carry their own classes, and no other table does', () => {
    expect(jsx).toContain('<div className={`${styles.scroll} ${styles.sectorScroll}`}>')
    expect(jsx).toContain('<table className={`${styles.table} ${styles.sectorTable}`} data-testid="sector-tide-table" aria-label="Market Tide by sector">')
    expect((jsx.match(/styles\.sectorTable\b/g) || []).length).toBe(1)
    expect((jsx.match(/styles\.sectorScroll\b/g) || []).length).toBe(1)
  })

  it('the columns are in the order the fold rule counts on: Prints is the fifth', () => {
    const head = jsx.slice(jsx.indexOf('data-testid="sector-tide-table"'), jsx.indexOf('</thead>', jsx.indexOf('data-testid="sector-tide-table"')))
    const cols = [...head.matchAll(/<th[^>]*>([^<]+)<\/th>/g)].map((m) => m[1].trim())
    expect(cols).toEqual(['Sector', 'Net call premium', 'Net put premium', 'Net', 'Prints'])
  })

  it('the table measures its own box, so the options page and a panel get the same rule', () => {
    expect(wide).toContain('.sectorScroll { container: sectortide / inline-size; }')
    // nothing else about the sector table applies at every width: a wide box is untouched
    expect(wide).not.toMatch(/\.sectorTable\b/)
    expect(css).not.toMatch(/@media/)
  })

  it('in a box up to 640 px the headers may take two lines and the cells sit closer', () => {
    expect(wrapTier).toContain('.sectorTable th { white-space: normal; }')
    expect(wrapTier).toContain('.sectorTable th, .sectorTable td { padding: 3px 5px; }')
    expect(wrapTier).not.toMatch(/display: none/)
  })

  it('in a box up to 480 px the type steps down and Prints folds: never a money column', () => {
    expect(phoneTier).toContain('.sectorTable { font-size: var(--text-xs); }')
    expect(phoneTier).toContain('.sectorTable th:nth-child(5), .sectorTable td:nth-child(5) { display: none; }')
    expect((everyTier.match(/display: none/g) || []).length).toBe(1)
    expect(everyTier).not.toMatch(/nth-child\((?!5\))/)
  })

  it('every rule in those tiers is on the sector table alone; the shared table rules stand', () => {
    const selectors = [...everyTier.matchAll(/([^{}]+)\{[^{}]*\}/g)].map((m) => m[1].trim())
    expect(selectors.length).toBeGreaterThanOrEqual(5)
    for (const sel of selectors) {
      for (const part of sel.split(',')) expect(part.trim().startsWith('.sectorTable')).toBe(true)
    }
    expect(wide).toContain('.scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }')
    expect(wide).toMatch(/\.table \{[^}]*font-size: var\(--text-base\);[^}]*white-space: nowrap;/)
    expect(wide).toContain('.table th, .table td { padding: 3px 8px; text-align: right; border-bottom: 1px solid var(--border); }')
  })
})

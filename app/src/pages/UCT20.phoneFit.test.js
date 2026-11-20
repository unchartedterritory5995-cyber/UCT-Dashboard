// Phone fit, part 3 (2026-11-20): the UCT 20 list (/uct-20, U20 in the Terminal) drew the ticker, its
// badges and the price on top of each other at 340 to 390 px: the ticker column was 0 to 54 px wide.
// On a phone the badges now sit on their own line UNDER the ticker, and where six columns still do
// not fit, "Since add" folds (rating and the day's change stay).
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

describe('UCT 20: a row fits a small phone', () => {
  const jsx = read('pages/UCT20.jsx')
  const css = noComments(read('pages/UCT20.module.css'))
  const phoneRaw = blocks(css, '@media (max-width: 640px)').join('\n')
  const phone = squash(phoneRaw)
  const fold = squash(blocks(phoneRaw, '@container uct20table').join('\n'))
  const phoneOnly = squash(outsideAtRules(phoneRaw))
  const wide = squash(outsideAtRules(css))

  it('the badges are one group inside the ticker cell, after the ticker and before the company', () => {
    const cell = jsx.slice(jsx.indexOf('<span className={styles.tickerCell}>'), jsx.indexOf('<span className={styles.price}>'))
    const group = cell.slice(cell.indexOf('<span className={styles.badges}>'), cell.indexOf('{company && <span className={styles.companyName}>'))
    expect(cell.indexOf('<span className={styles.tickerInner}')).toBeGreaterThan(0)
    expect(cell.indexOf('<span className={styles.tickerInner}')).toBeLessThan(cell.indexOf('<span className={styles.badges}>'))
    expect(group).toContain('styles.newBadge')
    expect(group).toContain('>INSIDER</span>')
    expect(group).toContain('data-testid="uct20-team-badge"')
    expect(group).toContain('styles.erBadge')
    // every badge is in the group: none is left loose in the ticker cell
    expect((cell.match(/styles\.(newBadge|insiderBadge|erBadge)\b/g) || []).length)
      .toBe((group.match(/styles\.(newBadge|insiderBadge|erBadge)\b/g) || []).length)
    expect((jsx.match(/className=\{styles\.badges\}/g) || []).length).toBe(1)
  })

  it('on a wide screen the group is not a box, so the line reads as it did', () => {
    expect(wide).toContain('.badges { display: contents; }')
    expect(wide).toContain('.tickerCell { display: flex; align-items: baseline; gap: 8px; min-width: 0; }')
    expect(wide).not.toMatch(/\.cSince\b/)
    expect(wide).not.toMatch(/container:/)
  })

  it('on a phone the badges get their own line under the ticker, the width of the row', () => {
    expect(phoneOnly).toContain('.tickerCell { display: contents; }')
    expect(phoneOnly).toContain('.tickerInner { grid-column: 2; grid-row: 1; min-width: 0; }')
    expect(phoneOnly).toContain('.badges { display: flex; flex-wrap: wrap; gap: 4px; grid-column: 2 / -1; grid-row: 2; min-width: 0; }')
    expect(phoneOnly).toContain('.badges:empty { display: none; }')
    expect(phoneOnly).toContain('.row { row-gap: 4px; }')
  })

  it('"Since add" carries its own class on the header and on the row', () => {
    expect(jsx).toContain('<SortHead k="since" label="SINCE ADD" className={`${styles.cSince} ${styles.alignR}`}')
    expect(jsx).toContain('<span className={`${styles.cSince} ${styles.since} ')
    expect((jsx.match(/styles\.cSince\b/g) || []).length).toBe(2)
  })

  it('where the table is too narrow, "Since add" folds and nothing else does', () => {
    expect(phoneOnly).toContain('.table { container: uct20table / inline-size; }')
    expect(phone).toContain('@container uct20table (max-width: 354px) {')
    // five columns: rank, ticker, price, day's change, rating, and the caret
    expect(fold).toContain('.headerRow, .row { grid-template-columns: 18px minmax(0, 1fr) 58px 50px 44px 14px; column-gap: 4px; }')
    expect(fold).toContain('.cSince { display: none; }')
    expect((fold.match(/display: none/g) || []).length).toBe(1)
    // the phone never hides the price, the day's change or the rating
    expect(phone).not.toMatch(/\.(price|chg|rating)\b[^{]*\{[^}]*display: none/)
    // and the six-column phone grid still stands above that width
    expect(phoneOnly).toContain('--cols: 20px minmax(0, 1fr) 58px 50px 56px 44px 14px;')
  })
})

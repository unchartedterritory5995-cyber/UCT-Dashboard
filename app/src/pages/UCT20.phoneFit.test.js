// The UCT 20 list (/uct-20, U20 in the Terminal) fits ITSELF. Part 3 (2026-11-20) fixed a phone with
// rules keyed to the SCREEN; a 592px desktop Terminal panel never matched them, so there the ticker,
// its badges and the price were still drawn on top of each other (all 20 rows, by up to 51px).
// Part 4 moved the layout onto container queries on the table's own box: the same table lays itself
// out the same way in a phone, in a narrow panel and in a wide page, by its own width.
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

describe('UCT 20: the table fits its own width', () => {
  const jsx = read('pages/UCT20.jsx')
  const css = noComments(read('pages/UCT20.module.css'))
  const phone = squash(blocks(css, '@media (max-width: 640px)').join('\n'))
  const tier = (px) => squash(blocks(css, `@container uct20table (max-width: ${px}px)`).join('\n'))
  const tiers = [920, 529, 445, 354].map(tier)
  const [all, noTrend, phoneSix, fold] = tiers
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

  it('the table and its footnote sit in one box, and that box is what the table measures itself against', () => {
    const box = jsx.indexOf('<div className={styles.tableFit}>')
    expect(box).toBeGreaterThan(0)
    expect((jsx.match(/styles\.tableFit\b/g) || []).length).toBe(1)
    expect(jsx.indexOf('<div className={styles.table}>')).toBeGreaterThan(box)
    expect(jsx.indexOf('<p className={styles.tableFootnote}>')).toBeGreaterThan(jsx.indexOf('<div className={styles.table}>'))
    expect(wide).toContain('.tableFit { container: uct20table / inline-size; }')
    // a box cannot answer its own query: the table itself is never the container
    expect(css).not.toMatch(/\.table\s*\{[^}]*container/)
    expect((css.match(/container:/g) || []).length).toBe(1)
  })

  it('no layout of the row hangs on the width of the SCREEN any more: a desktop panel never matched that', () => {
    expect(phone).not.toMatch(/grid-template-columns|--cols|display: none|grid-column|@container/)
    expect(phone).not.toMatch(/\.(badges|tickerCell|tickerInner|cSince|cTag|cRs|cDays)\b/)
    // what is left there is about a finger and a small screen, not about columns
    expect(phone).toContain('.row { padding: 13px 2px; min-height: var(--tap-min); box-sizing: border-box; }')
  })

  it('over 920px wide the table is the wide page it was: the group is not a box and the company shows', () => {
    expect(wide).toContain('.badges { display: contents; }')
    expect(wide).toContain('.tickerCell { display: flex; align-items: baseline; gap: 8px; min-width: 0; }')
    expect(wide).not.toMatch(/\.(cSince|footSince)\b/)
    expect(wide).toContain('--cols: 30px 94px minmax(0, 1fr) 78px 64px 54px 50px 72px 62px 22px;')
  })

  it('at 920px and under the badges get their own line under the ticker and every column still shows (the 592px panel)', () => {
    expect(all).toContain('.tickerCell { display: contents; }')
    expect(all).toContain('.tickerInner { grid-column: 3; grid-row: 1; min-width: 0; }')
    expect(all).toContain('.badges { display: flex; flex-wrap: wrap; gap: 4px; grid-column: 3 / -1; grid-row: 2; min-width: 0; }')
    expect(all).toContain('.badges:empty { display: none; }')
    expect(all).toContain('.row { row-gap: 4px; }')
    // ten tracks, each with a floor it cannot go under: the ticker never gets 0px again
    const tracks = /\.headerRow, \.row \{ grid-template-columns: ([^;]+); gap: 6px; padding-inline: 2px; \}/.exec(all)?.[1] || ''
    expect(tracks.match(/minmax\(/g) || []).toHaveLength(10)
    expect(tracks).toContain('minmax(74px, 1fr)')
    expect(tracks).not.toMatch(/minmax\(0/)
    // nothing with a number in it is hidden here: only the company name (the tooltip still carries it)
    expect(all.match(/display: none/g) || []).toHaveLength(2)
    expect(all).toContain('.companyName { display: none; }')
    expect(all).toContain('.cDays { display: block; }')
  })

  it('at 529px and under the trend tag steps aside (it is a label, not a number) and the ticker moves up a column', () => {
    expect(noTrend).toContain('.cTag { display: none; }')
    expect(noTrend).toContain('.tickerInner { grid-column: 2; }')
    expect(noTrend).toContain('.badges { grid-column: 2 / -1; }')
    const tracks = /\.headerRow, \.row \{ grid-template-columns: ([^;]+); \}/.exec(noTrend)?.[1] || ''
    expect(tracks.match(/minmax\(/g) || []).toHaveLength(9)
    expect(noTrend.match(/display: none/g) || []).toHaveLength(1)
  })

  it('at 445px and under it is the phone table part 3 drew: six columns, RS and days folded', () => {
    expect(phoneSix).toContain('.headerRow, .row { grid-template-columns: 20px minmax(0, 1fr) 58px 50px 56px 44px 14px; }')
    expect(phoneSix).toContain('.cRs, .cDays { display: none; }')
    expect(phoneSix.match(/display: none/g) || []).toHaveLength(1)
  })

  it('"Since add" carries its own class on the header and on the row', () => {
    expect(jsx).toContain('<SortHead k="since" label="SINCE ADD" className={`${styles.cSince} ${styles.alignR}`}')
    expect(jsx).toContain('<span className={`${styles.cSince} ${styles.since} ')
    expect((jsx.match(/styles\.cSince\b/g) || []).length).toBe(2)
  })

  it('"Since add" folds only on a table of 354px or less, and nothing else folds there', () => {
    // five columns: rank, ticker, price, day's change, rating, and the caret
    expect(fold).toContain('.headerRow, .row { grid-template-columns: 18px minmax(0, 1fr) 58px 50px 44px 14px; column-gap: 4px; }')
    expect(fold).toContain('.cSince, .footSince { display: none; }')
    expect(fold.match(/display: none/g) || []).toHaveLength(1)
    // no wider tier touches it, so the 592px panel keeps every number
    for (const t of [all, noTrend, phoneSix]) expect(t).not.toMatch(/\.cSince\b/)
    expect((css.match(/\.cSince\b/g) || []).length).toBe(1)
  })

  it('the footnote stops explaining "SINCE ADD" exactly where that column folds, and nowhere else', () => {
    const start = jsx.indexOf('<p className={styles.tableFootnote}>')
    const note = jsx.slice(start, jsx.indexOf('</p>', start))
    const span = note.slice(note.indexOf('<span className={styles.footSince} data-testid="uct20-foot-since">'), note.indexOf('</span>'))
    expect(span).toContain('"SINCE ADD" reflects the no-stops')
    expect(span).toContain('see "How it&rsquo;s built."')
    // the first sentence is outside the span: it always shows
    expect(note.slice(0, note.indexOf('<span'))).toContain('not investment advice')
    expect((jsx.match(/styles\.footSince\b/g) || []).length).toBe(1)
    // one rule hides it, the same rule that hides the column
    expect((css.match(/\.footSince\b/g) || []).length).toBe(1)
    expect(fold).toContain('.cSince, .footSince { display: none; }')
  })

  it('no tier hides the price, the day\'s change or the rating, and a narrower tier always comes later', () => {
    for (const t of tiers) expect(t).not.toMatch(/\.(price|chg|rating)\b[^{]*\{[^}]*display: none/)
    const at = [920, 529, 445, 354].map((px) => css.indexOf(`@container uct20table (max-width: ${px}px)`))
    expect(at.every((n) => n > 0)).toBe(true)
    expect([...at].sort((a, b) => a - b)).toEqual(at)
    expect((css.match(/@container uct20table/g) || []).length).toBe(4)
    // and all of them come after the two screen rules that lay the table out (the tablet columns, the phone block)
    expect(css.indexOf('.table { --cols: 28px 86px')).toBeGreaterThan(0)
    expect(at[0]).toBeGreaterThan(css.indexOf('.table { --cols: 28px 86px'))
    expect(at[0]).toBeGreaterThan(css.indexOf('@media (max-width: 640px)'))
    // the screen rules further down only set finger-target heights: none of them lays the table out again
    const later = blocks(css.slice(at[3]), '@media')
    expect(later.length).toBe(2)
    for (const b of later) expect(b).not.toMatch(/--cols|grid-template|display:|\.c[A-Z]\w+/)
  })

  it('a long line of the context strip may wrap in a narrow table instead of running off the side', () => {
    expect(all).toContain('.ctxItem { white-space: normal; }')
  })
})

describe('UCT 20: the page does not scroll sideways on a phone', () => {
  const css = noComments(read('pages/UCT20.module.css'))
  const phone = squash(blocks(css, '@media (max-width: 640px)').join('\n'))
  const header = squash(blocks(noComments(read('components/PageHeader.module.css')), '@media (max-width: 640px)').join('\n'))

  it('the header bleeds by the page padding the phone really has (it assumed 16px, the page has 10: 6px past each side)', () => {
    // the full-bleed header reads this pair on a phone, and falls back to 16px
    expect(header).toContain('margin: calc(-1 * var(--page-pad-top-m, 16px)) calc(-1 * var(--page-pad-x-m, 16px)) 12px;')
    const pad = /\.page \{ padding: (\S+) (\S+); --page-pad-top-m: (\S+); --page-pad-x-m: (\S+); \}/.exec(phone)
    expect(pad?.slice(1)).toEqual(['12px', '10px', '12px', '10px'])
  })

  it('the cure is the cause: nothing clips the page to hide a bleed', () => {
    expect(css).not.toMatch(/\.page\s*\{[^}]*overflow(-x)?:\s*(hidden|clip)/)
  })
})

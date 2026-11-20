// Phone fit, part 3 (2026-11-20): a Screener phone card's second line (SECTOR, MKT CAP, VOL x)
// wrapped when the sector name was long, and because the cards are placed a fixed 64 px apart the
// second line was drawn onto the next card. The stats are now ONE line: only a stat whose value is
// words gives way (ellipsis, full text in `title`); labels and numbers never break or shrink.
// jsdom lays nothing out, so this pins the rules; the widths were measured with the private sweep.
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { describe, it, expect } from 'vitest'

const read = (rel) => fs.readFileSync(path.join(process.cwd(), 'src', rel), 'utf8').replace(/\r\n/g, '\n')
const noComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '')

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
/** The declarations of the one rule whose selector is exactly `sel`. */
function rule(css, sel) {
  const found = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1].trim() === sel)
  expect(found.length, `one rule for ${sel}`).toBe(1)
  return found[0][2].split(';').map((d) => d.trim()).filter(Boolean)
}

describe('Screener phone cards: the stats stay on one line', () => {
  const jsx = read('pages/screener/shell/ResultCards.jsx')
  const all = noComments(read('pages/screener/shell/ScannerShell.module.css'))
  const css = squash(outsideAtRules(all))

  it('the stats line is one line that cuts what does not fit, at every width', () => {
    const stats = rule(css, '.cardStats')
    expect(stats).toContain('display: flex')
    expect(stats).toContain('white-space: nowrap')
    expect(stats).toContain('overflow: hidden')
    expect(stats).toContain('min-width: 0')
    expect(stats.some((d) => d.startsWith('flex-wrap'))).toBe(false)
  })

  it('a stat never shrinks, and its label never breaks or shrinks', () => {
    expect(rule(css, '.cardStat')).toContain('flex: 0 0 auto')
    expect(rule(css, '.cardStatLabel')).toContain('flex: none')
  })

  it('only a stat whose value is words gives way, and its value is cut with an ellipsis', () => {
    const text = rule(css, '.cardStatText')
    expect(text).toContain('flex: 0 1 auto')
    expect(text).toContain('min-width: 0')
    const val = rule(css, '.cardStatText .cardStatVal')
    expect(val).toContain('overflow: hidden')
    expect(val).toContain('text-overflow: ellipsis')
    expect(val).toContain('min-width: 0')
    // a number is never the one that is cut
    expect(rule(css, '.cardStatVal').some((d) => d.startsWith('overflow') || d.startsWith('text-overflow'))).toBe(false)
  })

  it('no narrower tier takes any of it back', () => {
    // every mention of the stats classes is outside the sheet's media and container blocks
    const mentions = (s) => (s.match(/\.cardStat(s|Text|Label|Val)?\b/g) || []).length
    expect(mentions(css)).toBe(7)
    expect(mentions(all)).toBe(mentions(css))
  })

  it('the card marks a words stat and keeps its full text for a reader', () => {
    expect(jsx).toContain("const words = typeof raw === 'string' && raw.trim() !== '' && Number.isNaN(Number(raw))")
    expect(jsx).toContain('className={words ? `${styles.cardStat} ${styles.cardStatText}` : styles.cardStat}')
    expect(jsx).toContain("title={words ? (typeof shown === 'string' ? shown : raw) : undefined}")
  })

  it('the fixed card pitch is untouched', () => {
    expect(jsx).toContain('estimateSize: () => 64')
  })
})

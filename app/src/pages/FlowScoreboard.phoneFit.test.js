// Phone fit, part 2 (2026-11-20): the grade table of /flow-scoreboard (FREC in the Terminal) ran 163px past a
// 340px screen and scrolled sideways with nothing pinned. It has five short columns, so on a phone it
// fits instead. The picks table beside it keeps its DECIDED sideways scroll with the pick pinned.
// jsdom lays nothing out, so this pins the rules; the widths were measured with the private sweep.
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

describe('flow scoreboard: the grade table fits a small phone', () => {
  const jsx = read('pages/FlowScoreboard.jsx')
  const css = noComments(read('pages/FlowScoreboard.module.css'))
  const phone = squash(mediaBlocks(css, '(max-width: 640px)').join('\n'))
  const wide = squash(outsideAtRules(css))

  it('the grade table carries the class and the picks table does not', () => {
    expect(jsx).toContain('<table className={`${styles.table} ${styles.gradeTable}`} aria-label="Grade calibration: peak-gain outcomes by flag grade">')
    expect((jsx.match(/styles\.gradeTable\b/g) || []).length).toBe(1)
    expect(jsx).toContain('className={`${styles.table} ${styles.tapeTable}`}')
  })

  it('on a phone its headers may take a second line and its cells sit closer', () => {
    expect(phone).toContain('.gradeTable th { white-space: normal; letter-spacing: 0.3px; }')
    expect(phone).toContain('.gradeTable th, .gradeTable td { padding-inline: 3px; }')
  })

  it('none of it applies to a wider screen', () => {
    expect(wide).not.toMatch(/\.gradeTable/)
    expect(wide).toMatch(/\.table th \{[^}]*padding: 8px 10px;[^}]*white-space: nowrap;/)
    expect(wide).toMatch(/\.table td \{[^}]*padding: 9px 10px;[^}]*white-space: nowrap;/)
  })

  it('the picks table keeps its decided scroll: the pick stays pinned and the wrapper scrolls', () => {
    expect(phone).toMatch(/\.tapeTable th:first-child, \.tapeTable td:first-child \{ position: sticky; left: 0;/)
    expect(phone).not.toMatch(/\.tapeTable t[hd][^{]*\{[^}]*(white-space: normal|padding-inline)/)
    expect(wide).toContain('.tableWrap { width: 100%; overflow-x: auto; }')
  })
})

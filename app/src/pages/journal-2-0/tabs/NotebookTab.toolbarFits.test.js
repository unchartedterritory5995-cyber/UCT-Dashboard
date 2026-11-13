// Tier 1b fix round 1 (review Important 7): the phone list toolbar may never be wider than its line. With a folder
// AND a filter on, the row holds the Folder chip, View, sort, the ticker chip, Clear filter and ⋯ -- more than 350 px
// at 390 -- and a `nowrap` row clipped or overlapped them, or pushed <main> sideways (the defect F5/10E-1 fixed for
// the old view switcher, whose rail NotebookTab.viewSwitcherFits.test.js went with it). The phone row WRAPS onto a
// second line instead, and nothing in it is wider than the line.
//
// ⛔ STRUCTURAL, NOT THE VERDICT: jsdom lays nothing out. The verdict is tools/mobile_audit.py at 390 px with a folder,
// a tag and a ticker on (run on production after deploy).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const CSS = readFileSync(join(process.cwd(), 'src', 'pages', 'journal-2-0', 'tabs', 'NotebookTab.module.css'), 'utf8')

/** The bodies of every `@media (max-width: 640px)` block, by brace matching. */
function phoneBodies(css) {
  const out = []
  let at = css.indexOf('@media (max-width: 640px)')
  while (at >= 0) {
    let i = css.indexOf('{', at) + 1
    const start = i
    for (let depth = 1; depth > 0; i += 1) { if (css[i] === '{') depth += 1; else if (css[i] === '}') depth -= 1 }
    out.push(css.slice(start, i - 1))
    at = css.indexOf('@media (max-width: 640px)', i)
  }
  return out.join(' ')
}
const rule = (body, sel) => {
  const esc = sel.replace(/[.>*[\]]/g, (c) => `\\${c}`)
  const re = new RegExp(String.raw`(^|[\s}])` + esc + String.raw`\s*\{([^}]*)\}`)
  const m = re.exec(body)
  return m ? m[2] : null
}

describe('the phone toolbar fits its line (Important 7)', () => {
  const phone = phoneBodies(CSS)
  it('the row wraps onto another line instead of widening the page', () => {
    expect(rule(phone, '.toolbar')).toMatch(/flex-wrap:\s*wrap/)
  })
  it('no control in it is wider than the line', () => {
    expect(rule(phone, '.toolbar > *')).toMatch(/max-width:\s*100%/)
  })
  it('CONTROL: the shipped nowrap row fails the first read', () => {
    expect(rule('.toolbar { flex-wrap: nowrap; gap: 6px; }', '.toolbar')).not.toMatch(/flex-wrap:\s*wrap/)
  })
})

describe('the phone ⋯ menu is as wide as its longest row (simplify pass 2, C6)', () => {
  // Found by the fin walk at 390: at the menu engine's 200 px floor "Remove sample notebook" wrapped to two lines
  // (row 57.6 px tall); at max-content the menu is 211 px and the row one line (44 px), measured in Chromium.
  const phone = phoneBodies(CSS)
  it('the row-end menu sizes to its content, still anchored right', () => {
    const body = rule(phone, '.newWrap [role="menu"]')
    expect(body).toMatch(/width:\s*max-content/)
    expect(body).toMatch(/right:\s*0/)
  })
  it('CONTROL: the rule as pass 2 shipped it fails the read', () => {
    expect(rule('.newWrap [role="menu"] { left: auto; right: 0; }', '.newWrap [role="menu"]')).not.toMatch(/width:\s*max-content/)
  })
})

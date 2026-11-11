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

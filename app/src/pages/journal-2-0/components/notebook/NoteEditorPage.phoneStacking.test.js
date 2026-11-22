// @vitest-environment node
// Go-live wave 1 (D1): on a phone, an open note's More panel (NoteMoreMenu, `position: fixed; z-index: 60`) must cover
// the in-note folders button and the back chevron (NotebookTab.module.css, `z-index: 41`). Measured at 390 wide, the
// folders button painted over the panel's "Find in note" row.
//
// The cause: `.chrome` (the editor's header and toolbar) is a FLEX ITEM of `.page`, and a flex item with a z-index makes
// a stacking context even when it is not positioned. On a phone the chrome turns static but kept `z-index: 40`, so
// every layer inside it -- the panel's 60 included -- was painted inside a z 40 context, under the buttons' 41 outside
// it. jsdom does no painting, so this reads the stylesheets: the static chrome drops its z-index, and the numbers the
// fix relies on stay ordered.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseRules, declarations } from '../../a11y/cssAudit'

const HERE = join(process.cwd(), 'src', 'pages', 'journal-2-0')
const read = (rel) => readFileSync(join(HERE, rel), 'utf8')

/** The bodies of every `@media <query> { ... }` block, brace-matched. */
function mediaBodies(css, query) {
  const out = []
  let at = css.indexOf(`@media ${query}`)
  while (at >= 0) {
    const open = css.indexOf('{', at)
    let depth = 0
    let i = open
    for (; i < css.length; i += 1) {
      if (css[i] === '{') depth += 1
      else if (css[i] === '}') { depth -= 1; if (depth === 0) break }
    }
    out.push(css.slice(open + 1, i))
    at = css.indexOf(`@media ${query}`, i)
  }
  return out
}
const props = (rule) => Object.fromEntries(declarations(rule).map((d) => [d.prop, d.value]))
const rulesFor = (css, selector) => parseRules(css).filter((r) => r.selector === selector).map(props)

const EDITOR = read('components/notebook/NoteEditorPage.module.css')

describe('the phone note: the open More panel covers the folders button and the back chevron', () => {
  it('a phone chrome that turns static also drops its z-index (no stacking context of its own)', () => {
    const phone = mediaBodies(EDITOR, '(max-width: 640px)').join('\n')
    const chrome = rulesFor(phone, '.chrome')
    expect(chrome.length, 'non-vacuity: the phone block has a .chrome rule').toBeGreaterThan(0)
    const statics = chrome.filter((p) => p.position === 'static')
    expect(statics.length, 'the phone chrome is static').toBeGreaterThan(0)
    for (const p of statics) expect(p['z-index'], 'a static flex item with a z-index is still a stacking context').toBe('auto')
  })

  it('the base chrome keeps its sticky layer (desktop and tablet are unchanged)', () => {
    const base = rulesFor(EDITOR, '.chrome')[0]
    expect(base).toMatchObject({ position: 'sticky', 'z-index': '40' })
  })

  it('the panel\'s layer is above the buttons\' (60 > 41), so with no context between them it wins', () => {
    const panel = rulesFor(read('components/notebook/NoteMoreMenu.module.css'), '.panel')[0]
    const tab = read('tabs/NotebookTab.module.css')
    const folders = rulesFor(mediaBodies(tab, '(max-width: 640px)').join('\n'), '.wrap[data-note-open] > .noteFoldersBtn')[0]
    const back = rulesFor(mediaBodies(tab, '(max-width: 640px)').join('\n'), '.phoneBack')[0]
    expect(Number(panel['z-index'])).toBeGreaterThan(Number(folders['z-index']))
    expect(Number(panel['z-index'])).toBeGreaterThan(Number(back['z-index']))
  })

  it('CONTROL: the check sees a static chrome that keeps its z-index', () => {
    const css = '@media (max-width: 640px) {\n  .chrome { position: static; z-index: 40; }\n}'
    const statics = rulesFor(mediaBodies(css, '(max-width: 640px)').join('\n'), '.chrome').filter((p) => p.position === 'static')
    expect(statics[0]['z-index']).not.toBe('auto')
  })
})

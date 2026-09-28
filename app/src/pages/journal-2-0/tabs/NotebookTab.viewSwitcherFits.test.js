// Wave 10 follow-up F5 -- the Notebook's view switcher may not be wider than its line.
//
// proof walk 10E-1 6b (docs/notebook/proof/walk-fd7d1f42d/geometry.json.gz): at 390 px
// `.viewModeWrap` (seven 44 px view buttons plus Save view) measured 401 px inside a
// 350 px toolbar line, and the app's <main> -- which scrolls sideways as well as down
// (`overflow-y: auto` computes overflow-x to auto) -- grew to 445 px. The whole page
// panned sideways on eleven Notebook surfaces: list, table, board, calendar, timeline,
// search, bulk, templates, import, saved view, publish folder. The same shape as 10B's
// note-header row (NoteEditorPage.headerFits.test.js): guards that never bind while
// there is room, so it wraps onto a second line instead.
//
// ⛔ STRUCTURAL, NOT THE VERDICT: jsdom lays nothing out. The measured widths are the
// proof walk's before/after (docs/notebook/proof/f5-*/f5probe.json, `overflow`).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseRules, declarations } from '../a11y/cssAudit'

const FILE = join(process.cwd(), 'src', 'pages', 'journal-2-0', 'tabs', 'NotebookTab.module.css')

/** The BASE (first, unconditioned) `.viewModeWrap` rule's declarations. */
function viewModeWrap(css) {
  const rule = parseRules(css).find((r) => r.selector === '.viewModeWrap')
  if (!rule) throw new Error('no .viewModeWrap rule')
  return Object.fromEntries(declarations(rule).map((d) => [d.prop, d.value]))
}

describe('.viewModeWrap fits its line (NotebookTab.module.css)', () => {
  it('wraps onto another line instead of widening the page', () => {
    expect(viewModeWrap(readFileSync(FILE, 'utf8'))['flex-wrap']).toBe('wrap')
  })

  it('is never wider than the toolbar line it sits in', () => {
    expect(viewModeWrap(readFileSync(FILE, 'utf8'))['max-width']).toBe('100%')
  })

  it('control: the old rule (inline-flex, no guards) fails both', () => {
    const old = viewModeWrap('.viewModeWrap { display: inline-flex; align-items: center; gap: 4px; }')
    expect(old['flex-wrap']).toBeUndefined()
    expect(old['max-width']).toBeUndefined()
  })
})

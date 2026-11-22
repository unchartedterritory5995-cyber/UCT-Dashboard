// Final polish (WebKit at 390 px, production): on an open note the Folders door took a row of its own above the note
// header (and the Journal tools row another; that one now folds, JournalLayout.compactHeader.test.jsx). Folders joins
// the back button's row: a 44 px icon door to the right of the chevron, its name kept, the header padded past both.
// jsdom lays nothing out, so this reads the phone stylesheet.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const CSS = readFileSync(join(process.cwd(), 'src/pages/journal-2-0/tabs/NotebookTab.module.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
const phone = [...CSS.matchAll(/@media \(max-width: 640px\)\s*\{([\s\S]*?)\n\}/g)].map((m) => m[1]).join('\n')
const rule = (sel) => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = new RegExp(`(?:^|[}\\s])${esc}\\s*\\{([^}]*)\\}`).exec(phone)
  return m ? m[1] : null
}

describe('an open note on a phone: Folders shares the back button\'s row', () => {
  it('the Folders door is a 44 px icon placed right of the 44 px back chevron, in the same row', () => {
    const r = rule('.wrap[data-note-open] > .noteFoldersBtn')
    expect(r).toMatch(/position:\s*absolute/)
    expect(r).toMatch(/top:\s*var\(--space-sm\)/)
    expect(r).toMatch(/left:\s*calc\(var\(--tap-min\) \+ var\(--space-sm\)\)/)
    expect(r).toMatch(/width:\s*var\(--tap-min\)/)
    expect(rule('.wrap[data-note-open] > .noteFoldersBtn .sidebarToggleLabel')).toMatch(/display:\s*none/)
  })

  it('the note header is padded past both doors, so its actions never slide under them', () => {
    expect(rule('.wrap[data-note-open] .mainNote [data-note-header]'))
      .toMatch(/padding-left:\s*calc\(2 \* var\(--tap-min\) \+ 2 \* var\(--space-sm\)\)/)
  })
})

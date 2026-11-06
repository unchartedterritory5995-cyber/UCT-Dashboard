// Tier 4 fix round 2 (the live scorecard, "field borders under 3:1"):
//   - select.folderInline (the folder under the title) measured 1:1: a transparent border. It IS a field (it moves the
//     note), so it now wears --field-edge at rest (V1: 3.28:1, never --border) and --border-accent on hover.
//   - the note title input is borderless BY DESIGN (Notion's pattern): an exemption, recorded in the Tier 4 report.
//   - the card "Select" checkbox read borderRatio None: a MEASUREMENT ARTEFACT. Its element border is 0 on purpose and
//     the visible 1.5 px --field-edge box is drawn in ::before (the 16 px square stays 16 px inside a 24 / 44 px hit
//     area); the scorecard reads the element's own border. Railed here so neither half can drift.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (rel) => readFileSync(join(process.cwd(), 'src', rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const body = (css, sel) => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // every rule for the selector, in source order (a touch-tier rule may come first)
  const all = [...css.matchAll(new RegExp(`(?:^|[}\\s])${esc}\\s*\\{([^}]*)\\}`, 'g'))].map((m) => m[1])
  return all.length ? all.join(';') : null
}
const decl = (b, prop) => { const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`).exec(b || ''); return m ? m[1].trim() : null }

describe('Notebook field edges', () => {
  const EDITOR = read('pages/journal-2-0/components/notebook/NoteEditorPage.module.css')
  const TAB = read('pages/journal-2-0/tabs/NotebookTab.module.css')

  it('the folder select wears the field edge at rest and the accent on hover', () => {
    expect(decl(body(EDITOR, '.folderInline'), 'border')).toBe('1px solid var(--field-edge)')
    expect(decl(body(EDITOR, '.folderInline:hover'), 'border-color')).toBe('var(--border-accent)')
  })

  it('the themed checkbox draws its 1.5 px field edge in ::before (the element border is 0 on purpose)', () => {
    expect(decl(body(TAB, ':where(.wrap input[type="checkbox"])'), 'border')).toBe('0')
    expect(decl(body(TAB, ':where(.wrap input[type="checkbox"])::before'), 'border')).toBe('1.5px solid var(--field-edge)')
  })
})

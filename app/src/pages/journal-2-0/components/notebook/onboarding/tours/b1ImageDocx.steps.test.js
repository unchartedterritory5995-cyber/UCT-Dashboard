// W14-Q2 round 2: on a phone the image/docx tour showed 1 of 3 (Scan is inside Format; the
// sidebar search is hidden while a note is open). Two phone-only "do this" steps lead there.
// Their anchors must be phone-only, read from the stylesheets (display: none outside the
// phone block), so a tablet or desktop still sees exactly the steps it saw before.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { STEPS, COPY } from './b1ImageDocx.steps'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')   // journal-2-0
const css = (rel) => readFileSync(join(root, rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const baseRule = (text, cls) => {
  // the rule OUTSIDE any @media block: strip media blocks first
  const outside = text.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '')
  const m = new RegExp(`\\.${cls}\\s*\\{([^}]*)\\}`).exec(outside)
  return m ? m[1] : ''
}

describe('image-docx-import reaches Scan and search on a phone', () => {
  const ids = STEPS.map((s) => s.id)

  it('Format waits for Scan, and Back to notes waits for search', () => {
    const format = STEPS.find((s) => s.id === 'format')
    const back = STEPS.find((s) => s.id === 'back')
    expect(format).toMatchObject({ anchor: 'note-format', waitFor: 'note-scan' })
    expect(back).toMatchObject({ anchor: 'note-phone-back', waitFor: 'search' })
    expect(ids.indexOf('format')).toBe(ids.indexOf('scan') - 1)
    expect(ids.indexOf('back')).toBe(ids.indexOf('find') - 1)
  })

  it('the steps a tablet or desktop can see are unchanged: add, scan, find', () => {
    const phoneOnly = new Set(['note-format', 'note-phone-back'])
    expect(STEPS.filter((s) => !phoneOnly.has(s.anchor)).map((s) => s.anchor))
      .toEqual(['note-toolbar', 'note-scan', 'search'])
  })

  it('both new anchors are hidden outside the phone block (read from the stylesheets)', () => {
    expect(baseRule(css('components/notebook/NoteEditorPage.module.css'), 'formatToggle')).toMatch(/display:\s*none/)
    expect(baseRule(css('tabs/NotebookTab.module.css'), 'phoneBack')).toMatch(/display:\s*none/)
  })

  it('control: every step has its copy', () => {
    for (const s of STEPS) expect(COPY[s.id]?.title, s.id).toBeTruthy()
  })
})

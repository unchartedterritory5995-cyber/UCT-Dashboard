import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// Tier 2 part A, item 8: the "Set alert" chip is MOUNTED by the editor page, lazily, behind the one smart-chips
// switch, beside the pasted-link menu. A menu that is built and tested but mounted nowhere is the defect this
// repo keeps rediscovering (reachable.test.js walks the import graph for the same reason), and the plugin it
// hosts offers nothing until this mount runs -- so an unmounted chip is also an invisible feature.
const src = fs.readFileSync(path.join(__dirname, 'NoteEditorPage.jsx'), 'utf8').replace(/\r\n/g, '\n')

describe('NoteEditorPage mounts the alert chip', () => {
  it('through lazyChunk, never a static import or a bare React.lazy', () => {
    expect(src).toMatch(/const AlertPhraseMenu = lazyChunk\(\(\) => import\('\.\/AlertPhraseMenu'\)\)/)
    expect(src).not.toMatch(/^import .*AlertPhraseMenu/m)
    expect(src).not.toMatch(/^import .*TextAlertSheet/m)
    expect(src).not.toMatch(/\blazy\(\(\) => import\('\.\/AlertPhraseMenu'\)/)
  })

  it('only while the smart-chips switch is on, handing it the editor and the note ticker', () => {
    expect(src).toMatch(/import \{ smartChipsEnabled \} from '\.\.\/\.\.\/lib\/smartChipsFlag'/)
    expect(src).toMatch(
      /\{smartChipsEnabled\(\) && \(\s*<Suspense fallback=\{null\}><AlertPhraseMenu editor=\{editor\} noteTicker=\{note\?\.ticker \|\| null\} \/><\/Suspense>\s*\)\}/,
    )
  })

  it('right beside the pasted-link menu (the other menu that floats at the caret)', () => {
    const link = src.indexOf('<LinkPasteMenu editor={editor} />')
    const chip = src.indexOf('<AlertPhraseMenu editor={editor}')
    expect(link).toBeGreaterThan(0)
    expect(chip).toBeGreaterThan(link)
    expect(chip - link).toBeLessThan(300)
  })

  it('and only ONE import() of the chip exists in the editor page (a second costs first-open bytes)', () => {
    expect(src.match(/import\('\.\/AlertPhraseMenu'\)/g)).toHaveLength(1)
  })
})

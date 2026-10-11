import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

// P0.6: the layout jsdom cannot measure, railed structurally on the stylesheet itself. The
// phone-tier rules are read from the text AFTER the first `@media (max-width: 640px)`, so a
// rule that exists only OUTSIDE the phone query cannot satisfy them.
const HERE = path.dirname(fileURLToPath(import.meta.url))
const css = fs.readFileSync(path.join(HERE, 'NoteEditorPage.module.css'), 'utf8').replace(/\r\n/g, '\n')
const phone = css.split('@media (max-width: 640px)').slice(1).join('\n')

describe('P0.6 phone toolbar CSS', () => {
  it('an open Format wraps into rows instead of scrolling sideways', () => {
    expect(/\.toolbarRow\[data-format-open\][^{]*\{[^}]*flex-wrap:\s*wrap/.test(phone)).toBe(true)
    expect(/\.toolbarRow\[data-format-open\][^{]*\{[^}]*overflow-x:\s*visible/.test(phone)).toBe(true)
  })
  it('the insert "+" shows on phone and hides above it', () => {
    expect(/\.insertPhone\s*\{[^}]*display:\s*none/.test(css)).toBe(true)
    expect(/\.insertPhone\s*\{[^}]*display:\s*inline-flex/.test(phone)).toBe(true)
  })
  it('the "+" keeps the finger floor: it is a .toolBtn, and the touch tier floors every .toolBtn on both axes', () => {
    const src = fs.readFileSync(path.join(HERE, 'NoteEditorPage.jsx'), 'utf8')
    expect(/className=\{`\$\{styles\.toolBtn\} \$\{styles\.insertPhone\}/.test(src)).toBe(true)
    const touch = css.split('@media (max-width: 1024px)').slice(1).join('\n')
    expect(/\.toolBtn\s*\{[^}]*min-height:\s*var\(--tap-min[^}]*min-width:\s*var\(--tap-min/.test(touch)).toBe(true)
  })
  it('the phone rules sit INSIDE the existing phone block, not a block of their own', () => {
    // The file had two phone blocks before P0.6 (the editor block and the rails block). A third
    // would mean the new rules were added as a block of their own, and a rail that reads "the
    // last phone block" would miss them.
    expect(css.split('@media (max-width: 640px)').length - 1).toBe(2)
  })
})

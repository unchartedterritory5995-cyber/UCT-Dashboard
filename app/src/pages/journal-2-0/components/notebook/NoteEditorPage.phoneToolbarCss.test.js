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
  // Fix round 1 (controller ruling). The 7 always-visible controls were 362 px wide in a real
  // browser (Undo 47, Redo 47, Format 78, four 44 px controls, six 7 px gaps), so the mic ended
  // near x=398 behind a clip edge near x=366. Format becomes an "Aa" icon and Undo / Redo /
  // Format are pinned to the finger floor, which makes the row 7 x 44 + 14 = 322 px.
  // ⛔ The selectors are `.toolbarRow .x` (0,2,0) ON PURPOSE: the unconditional
  // `.toolbarRow .toolBtn { padding: 3px 8px }` near the top of the file outranks a bare
  // `.x` in the phone block, which is how a first attempt at this would silently do nothing.
  it('the Format toggle is icon-only on a phone: its word is visually hidden, its name is kept', () => {
    const src = fs.readFileSync(path.join(HERE, 'NoteEditorPage.jsx'), 'utf8')
    // the word is inside a span carrying the phone block's visually-hidden class (not removed:
    // the accessible name "Format" is what tests and tours find the toggle by)
    expect(/<span className=\{styles\.phoneIconLabel\}>Format<\/span>/.test(src)).toBe(true)
    const hidden = phone.match(/\.phoneIconLabel\s*\{([^}]*)\}/)
    expect(hidden, 'the phone block defines .phoneIconLabel').toBeTruthy()
    expect(/position:\s*absolute/.test(hidden[1]) && /clip:\s*rect\(0 0 0 0\)/.test(hidden[1])).toBe(true)
  })
  it('Undo, Redo and Format are exactly var(--tap-min) wide on a phone', () => {
    // one rule may serve both selectors (a comma list); find the rule whose list names `sel`
    const ruleFor = (sel) => {
      // comments stripped first: the prose above a rule would otherwise be read as its selector
      const bare = phone.replace(/\/\*[\s\S]*?\*\//g, '')
      const rule = /([^{}]+)\{([^{}]*)\}/g
      let m
      while ((m = rule.exec(bare))) {
        if (m[1].split(',').map((x) => x.trim().replace(/\s+/g, ' ')).includes('.toolbarRow ' + sel)) return m[2]
      }
      return null
    }
    for (const sel of ['.formatToggle', '.historyBtn']) {
      const body = ruleFor(sel)
      expect(body, `${sel} has a (0,2,0) \`.toolbarRow ${sel}\` rule in the phone block`).toBeTruthy()
      expect(/(^|[;\s])width:\s*var\(--tap-min/.test(body), `${sel} width`).toBe(true)
      expect(/box-sizing:\s*border-box/.test(body), `${sel} box-sizing`).toBe(true)
      expect(/padding-left:\s*0/.test(body) && /padding-right:\s*0/.test(body), `${sel} no side padding`).toBe(true)
    }
  })
  it('the CLOSED row fits a 390 px phone without scrolling: padding + sentinel gap + 7 x 44 + 6 gaps <= the row inner width', () => {
    // The real browser (tools/notebook_phone_toolbar_measure.py, docs/notebook/evidence/
    // phone-toolbar-*) found the controls all inside the clip edge but the ROW still scrolling 4 px:
    // 12 left padding + the 0-width history sentinel's 2 px gap + 320 px of controls + 12 right
    // padding = 346 > the 342 px inner width (the row spans x=24..366 at 390 px, measured).
    const bare = phone.replace(/\/\*[\s\S]*?\*\//g, '')
    const m = bare.match(/(?:^|\n)\s*\.toolbarRow\s*\{([^{}]*)\}/)
    expect(m, 'the phone block has a bare .toolbarRow rule').toBeTruthy()
    const pad = m[1].match(/padding:\s*(\d+)px\s+(\d+)px\s+(\d+)px(?:\s+(\d+)px)?/)
    expect(pad, 'its padding is the 3-or-4-value px shorthand').toBeTruthy()
    const right = Number(pad[2])
    const left = pad[4] != null ? Number(pad[4]) : right
    const INNER = 342                       // measured: the row's clientWidth at 390 px
    const CONTROLS = 7 * 44 + 6 * 2         // seven finger-floor controls, the row's 2 px gaps
    const SENTINEL_GAP = 2                  // the zero-width history sentinel is a flex item too
    expect(left + SENTINEL_GAP + CONTROLS + right).toBeLessThanOrEqual(INNER)
  })
  it('the phone rules sit INSIDE the existing phone block, not a block of their own', () => {
    // The file had two phone blocks before P0.6 (the editor block and the rails block). A third
    // would mean the new rules were added as a block of their own, and a rail that reads "the
    // last phone block" would miss them.
    expect(css.split('@media (max-width: 640px)').length - 1).toBe(2)
  })
})

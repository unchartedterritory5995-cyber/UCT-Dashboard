// @vitest-environment node
// Finish program, lane AI-FE, K7: two AI surfaces under the 44 px floor at 390.
//
//   - The citation chip in an Ask ANSWER (the panel) measured 32 x 44: tall enough, too narrow.
//   - The "Full transcript" fold's title line in a voice note measured 29 px tall.
//
// The panel chip gets a real 44 px box. ⛔ A real box, never a wider invisible hit area: the
// chip INSIDE A NOTE uses an `::after` extension, and an extension that reached an EARLIER chip
// once let a tap on `[2]` open source 3 (G-064 close-out; the rule and its geometry are in
// AskCitationView.module.css). Two real boxes side by side cannot overlap, so run-together
// chips in the panel each keep their own source. The in-note chip shares the panel chip's
// class, so it must hand BOTH floors back and keep its own extension; this pins that too.
//
// This reads declarations (jsdom lays nothing out). The boxes are measured in a browser.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const read = (f) => readFileSync(resolve(HERE, f), 'utf8').replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '')

/** The bodies of every `@media` block in `css` whose condition matches `re`, joined. */
function media(css, re) {
  const out = []
  const open = /@media([^{]+)\{/g
  let m
  while ((m = open.exec(css))) {
    let depth = 1
    let i = open.lastIndex
    while (i < css.length && depth) { if (css[i] === '{') depth += 1; else if (css[i] === '}') depth -= 1; i += 1 }
    if (re.test(m[1])) out.push(css.slice(open.lastIndex, i - 1))
  }
  return out.join('\n')
}
/** Every declaration block in `css` whose selector list matches `selRe`, joined. */
function rules(css, selRe) {
  const out = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m
  while ((m = re.exec(css))) if (selRe.test(m[1])) out.push(m[2])
  return out.join(';')
}
const TOUCH = /max-width:\s*1024px/
const floor = (prop) => new RegExp(`${prop}:\\s*var\\(--tap-min(, 44px)?\\)`)

describe('K7: the Ask panel’s citation chip is 44 px wide as well as tall on touch', () => {
  const panel = media(read('AskPanel.module.css'), TOUCH)
  const chip = rules(panel, /\.citationChip(?![\w-])/)

  it('declares both floors at 1024 px and below', () => {
    expect(chip).toMatch(floor('min-height'))
    expect(chip).toMatch(floor('min-width'))
  })

  it('the width is a real box: the panel chip has no ::after or ::before hit area', () => {
    expect(read('AskPanel.module.css')).not.toMatch(/\.citationChip::(after|before)/)
  })

  it('run-together chips keep a gap: the chip’s side margin is still there', () => {
    expect(rules(read('AskPanel.module.css'), /^\s*\.citationChip\s*$/)).toMatch(/margin:\s*0 1px/)
  })
})

describe('K7: the chip inside a note hands both floors back and keeps its own hit area', () => {
  const note = media(read('AskCitationView.module.css'), TOUCH)
  const chip = rules(note, /^\s*\.wrap \.chip\s*$/)

  it('min-height and min-width are both taken off, so a prose line is not stretched', () => {
    expect(chip).toMatch(/min-height:\s*0/)
    expect(chip).toMatch(/min-width:\s*0/)
  })

  it('the invisible extension is still the in-note finger target, and never reaches up', () => {
    const after = rules(note, /\.wrap button\.chip::after/)
    expect(after).toMatch(/top:\s*0/)
    expect(after).toMatch(/bottom:\s*-\d+px/)
    expect(rules(note, /\.node-askCitation\)\s*\+\s*:global\(\.node-askCitation\)/)).toMatch(/left:\s*0/)
  })
})

describe('K7: a toggle’s title line (the voice note’s "Full transcript") is 44 px tall on touch', () => {
  const editor = media(read('NoteEditorPage.module.css'), TOUCH)

  it('the summary declares the height floor at 1024 px and below', () => {
    expect(rules(editor, /\.uctToggleDetails\)\s*>\s*summary\s*$/)).toMatch(floor('min-height'))
  })

  it('the fold button beside it keeps both floors', () => {
    const chevron = rules(editor, /\.uctToggleChevron\)/)
    expect(chevron).toMatch(/width:\s*var\(--tap-min(, 44px)?\)/)
    expect(chevron).toMatch(/height:\s*var\(--tap-min(, 44px)?\)/)
  })
})

describe('CONTROL: the reader tells a declared floor from a missing one', () => {
  it('inside the touch block or not; this class or another', () => {
    const css = '@media (max-width: 1024px) { .a { min-width: var(--tap-min, 44px); } .b { color: red; } } .c { min-width: var(--tap-min, 44px); }'
    const touch = media(css, TOUCH)
    expect(rules(touch, /\.a(?![\w-])/)).toMatch(floor('min-width'))
    expect(rules(touch, /\.b(?![\w-])/)).not.toMatch(floor('min-width'))
    expect(rules(touch, /\.c(?![\w-])/)).not.toMatch(floor('min-width'))
  })
})

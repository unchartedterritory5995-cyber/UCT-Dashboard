// The open note's header row (Favorite, Ask, Find, History, Share, the folder
// select, Ticker, tags, Duplicate, Delete, ...) must never be wider than the
// page -- wave 10 follow-up F1.
//
// ⛔ A STRUCTURAL RAIL, NOT THE VERDICT. jsdom lays nothing out; it cannot see a
// <select> grow to its longest option. The verdict is the real-browser walk row
// B9d (tools/notebook_wave10b_walk.py), which makes a folder named the way an
// import names one ("Imported from Files (Markdown, Text, HTML, Word) ...") and
// then measures the Notebook note at 390 px. Measured there before this fix: the
// folder select ran x 56-526, Share / Duplicate / Save as template sat off the
// right edge, and the app's <main> scroller grew to 526 px -- with or without the
// voice hint. A full walk hit the same thing through B5's real import folder
// (463 px), which is how it was first seen and first mis-named.
//
// The cause: a flex row can never be narrower than its widest item (min-width:
// auto), and a <select>'s widest is its longest option. The fix lets the row
// shrink to the header (and wrap its own controls) and lets the select be
// narrower than its longest option. Both are width GUARDS: they never bind when
// the row has room, so they sit in the base rules, not a breakpoint.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const CSS = readFileSync(
  join(process.cwd(), 'src/pages/journal-2-0/components/notebook/NoteEditorPage.module.css'),
  'utf8',
  // Comments out first: a comment inside a rule (or just above one) would be read
  // as part of a selector or a declaration, and a guard that is present would read
  // as absent.
).replace(/\/\*[\s\S]*?\*\//g, '')

/** The stylesheet with every @media block cut out -- the rules for every width. */
function baseRules(css) {
  let out = ''
  let i = 0
  const re = /@media[^{]+\{/g
  let m
  while ((m = re.exec(css))) {
    out += css.slice(i, m.index)
    let depth = 1
    let j = re.lastIndex
    for (; j < css.length && depth > 0; j += 1) {
      if (css[j] === '{') depth += 1
      else if (css[j] === '}') depth -= 1
    }
    i = j
    re.lastIndex = j
  }
  return out + css.slice(i)
}

/** Does `selector`'s rule body declare `prop` with a value matching `pattern`? */
function declaresProp(text, selector, prop, pattern) {
  const rules = [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  for (const [, sels, decls] of rules) {
    if (!sels.split(',').some((s) => s.trim() === selector)) continue
    for (const part of decls.split(';')) {
      const colon = part.indexOf(':')
      if (colon < 0) continue
      if (part.slice(0, colon).trim() !== prop) continue
      if (pattern.test(part.slice(colon + 1).trim())) return true
    }
  }
  return false
}

describe('the note header row fits the page at every width (structural rail; B9d is the verdict)', () => {
  const base = baseRules(CSS)

  it('⛔ NON-VACUITY -- the base rules were found and carry both selectors', () => {
    expect(base.length).toBeGreaterThan(1000)
    expect(base).toMatch(/\.headerControls\s*\{/)
    expect(base).toMatch(/\.headerSelect\s*\{/)
  })

  it('lets the controls row shrink to the header and never outgrow it', () => {
    expect(declaresProp(base, '.headerControls', 'min-width', /^0(px)?$/)).toBe(true)
    expect(declaresProp(base, '.headerControls', 'max-width', /^100%$/)).toBe(true)
    // ...and the row still WRAPS its controls (shrinking alone would squeeze them)
    expect(declaresProp(base, '.headerControls', 'flex-wrap', /^wrap$/)).toBe(true)
  })

  it('lets the folder select be narrower than its longest folder name', () => {
    expect(declaresProp(base, '.headerSelect', 'min-width', /^0(px)?$/)).toBe(true)
    expect(declaresProp(base, '.headerSelect', 'max-width', /^100%$/)).toBe(true)
  })

  it('⭐ CONTROL -- a rule inside a media block is NOT a base rule', () => {
    const scoped = '@media (max-width: 640px) { .headerSelect { min-width: 0; max-width: 100%; } }'
    expect(declaresProp(baseRules(scoped), '.headerSelect', 'min-width', /^0(px)?$/)).toBe(false)
  })

  it('⭐ CONTROL -- the row without the guard does NOT satisfy this', () => {
    const without = '.headerControls { margin-left: auto; display: flex; flex-wrap: wrap; }'
    expect(declaresProp(without, '.headerControls', 'min-width', /^0(px)?$/)).toBe(false)
  })
})

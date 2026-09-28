// app/src/pages/journal-2-0/a11y/targetFloors.test.js
//
// Wave 10 follow-up F5: the Notebook's small targets, held to WCAG 2.5.8's 24 px.
//
//   * proof walk 10E-1 9b (axe `target-size`, all three themes): the Search filters
//     toggle was 22x22 -- and it sat ON TOP of the "Clear search" x, both at
//     `right: 6px`, so with a query typed a click on the x opened the filters;
//   * design review D-6: at 1200 px the editor's formatting row rendered 22 px tall
//     (B, I, H1, ...), a folder row's actions 20-23 px wide, the tag rename pencil
//     20x12;
//   * keyboard review A2R-10: the row checkboxes were 16x16 at 820 (their 44 px label
//     takes the tap; the control a keyboard or switch user lands on did not).
//
// ⛔ A STRUCTURAL RAIL, NOT THE VERDICT. jsdom lays nothing out; the measured boxes are
// the proof walk's before/after (docs/notebook/proof/f5-*/geometry.json). What this
// holds is the declarations that produce them -- including WHERE each floor lives:
// the editor's floor is desktop-only because `.toolbarRow .toolBtn` outranks the touch
// tier's bare `.toolBtn`, so an unscoped 24 px floor would pull a phone's 44 down.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { stripComments } from './cssAudit'

const J2 = join(process.cwd(), 'src', 'pages', 'journal-2-0')
const NB = join(J2, 'components', 'notebook')
const read = (p) => readFileSync(p, 'utf8')

/**
 * Every innermost rule with the @media it sits in (null = none), in source order:
 * `{ media, selector, decls: Map(prop -> value) }`. Nested at-rules are flattened to
 * their innermost @media, which is all these files use.
 */
function rulesWithMedia(css) {
  const text = stripComments(css)
  const out = []
  const walk = (s, media) => {
    let i = 0
    while (i < s.length) {
      const open = s.indexOf('{', i)
      if (open < 0) return
      const head = s.slice(i, open).trim()
      let depth = 1
      let j = open + 1
      while (j < s.length && depth) {
        if (s[j] === '{') depth += 1
        else if (s[j] === '}') depth -= 1
        j += 1
      }
      const body = s.slice(open + 1, j - 1)
      if (head.startsWith('@media')) walk(body, head.replace(/^@media\s*/, '').trim())
      else if (!head.startsWith('@')) {
        const decls = new Map()
        for (const m of body.matchAll(/([-a-zA-Z]+)\s*:\s*([^;]+?)\s*(?:;|$)/g)) decls.set(m[1].toLowerCase(), m[2].trim())
        for (const sel of head.split(',').map((x) => x.trim()).filter(Boolean)) out.push({ media, selector: sel, decls })
      }
      i = j
    }
  }
  walk(text, null)
  return out
}

/** The last value `prop` resolves to for `selector` under `media` (null = base rules). */
function lastDecl(rules, selector, prop, media = null) {
  let v
  for (const r of rules) if (r.selector === selector && r.media === media && r.decls.has(prop)) v = r.decls.get(prop)
  return v
}
const px = (v) => {
  const m = /^(-?\d+(?:\.\d+)?)px$/.exec(String(v || '').trim())
  if (!m) throw new Error(`not a px length: ${v}`)
  return Number(m[1])
}
const TOUCH = '(max-width: 1024px)'
const DESKTOP = '(min-width: 1025px)'

describe('non-vacuity: the parser sees rules, and the @media each sits in', () => {
  it('reads a base rule and a touch-tier rule of the same selector apart', () => {
    const rules = rulesWithMedia(read(join(NB, 'FolderSidebar.module.css')))
    expect(rules.length).toBeGreaterThan(50)
    expect(lastDecl(rules, '.iconBtn', 'min-width', TOUCH)).toBe('var(--tap-min, 44px)')
    expect(lastDecl(rules, '.iconBtn', 'padding')).toBe('0 6px')
  })
})

describe('the Search filters toggle and the Clear search x (FolderSidebar.module.css)', () => {
  const rules = rulesWithMedia(read(join(NB, 'FolderSidebar.module.css')))
  const box = (sel) => ({
    right: px(lastDecl(rules, sel, 'right')),
    w: px(lastDecl(rules, sel, 'width')),
    h: px(lastDecl(rules, sel, 'height')),
  })

  it('both are at least 24x24 (axe target-size, WCAG 2.5.8)', () => {
    for (const sel of ['.searchFilterToggle', '.searchClear']) {
      const b = box(sel)
      expect(b.w, `${sel} width`).toBeGreaterThanOrEqual(24)
      expect(b.h, `${sel} height`).toBeGreaterThanOrEqual(24)
    }
  })

  it('they no longer share a spot: the x sits wholly to the left of the toggle', () => {
    const t = box('.searchFilterToggle')
    const c = box('.searchClear')
    expect(c.right, 'the x starts where the toggle ends (or further left)').toBeGreaterThanOrEqual(t.right + t.w)
  })

  it('the input keeps its text clear of both', () => {
    const c = box('.searchClear')
    expect(px(lastDecl(rules, '.searchInput', 'padding-right'))).toBeGreaterThanOrEqual(c.right + c.w)
  })

  it('control: the old declarations (both at right 6px, 22 and 20 px) fail these checks', () => {
    const old = rulesWithMedia(`.searchFilterToggle { position:absolute; right:6px; width:22px; height:22px }
      .searchClear { position:absolute; right:6px; width:20px; height:20px }`)
    expect(px(lastDecl(old, '.searchFilterToggle', 'width'))).toBeLessThan(24)
    expect(px(lastDecl(old, '.searchClear', 'right')))
      .toBeLessThan(px(lastDecl(old, '.searchFilterToggle', 'right')) + px(lastDecl(old, '.searchFilterToggle', 'width')))
  })
})

describe('the editor formatting row (NoteEditorPage.module.css, D-6)', () => {
  const rules = rulesWithMedia(read(join(NB, 'NoteEditorPage.module.css')))

  it('has a 24 px floor on both axes at the desktop width', () => {
    expect(px(lastDecl(rules, '.toolbarRow .toolBtn', 'min-height', DESKTOP))).toBeGreaterThanOrEqual(24)
    expect(px(lastDecl(rules, '.toolbarRow .toolBtn', 'min-width', DESKTOP))).toBeGreaterThanOrEqual(24)
  })

  it('the floor is DESKTOP-ONLY: no min-size on `.toolbarRow .toolBtn` outside the desktop query', () => {
    const leaks = rules.filter((r) => r.selector === '.toolbarRow .toolBtn' && r.media !== DESKTOP
      && (r.decls.has('min-height') || r.decls.has('min-width')))
    expect(leaks.map((r) => r.media || 'base')).toEqual([])
  })

  it("the touch tier's 44 px floor on the bare `.toolBtn` is untouched", () => {
    expect(lastDecl(rules, '.toolBtn', 'min-height', TOUCH)).toBe('var(--tap-min, 44px)')
    expect(lastDecl(rules, '.toolBtn', 'min-width', TOUCH)).toBe('var(--tap-min, 44px)')
  })
})

describe('the sidebar row actions and the tag rename pencil (FolderSidebar.module.css, D-6)', () => {
  const rules = rulesWithMedia(read(join(NB, 'FolderSidebar.module.css')))

  it.each(['.iconBtn', '.renameTagBtn'])('%s has a 24 px floor on both axes', (sel) => {
    expect(px(lastDecl(rules, sel, 'min-width'))).toBeGreaterThanOrEqual(24)
    expect(px(lastDecl(rules, sel, 'min-height'))).toBeGreaterThanOrEqual(24)
  })

  it.each(['.iconBtn', '.renameTagBtn'])('%s keeps its 44 px floor on the touch tier', (sel) => {
    expect(lastDecl(rules, sel, 'min-width', TOUCH)).toBe('var(--tap-min, 44px)')
    expect(lastDecl(rules, sel, 'min-height', TOUCH)).toBe('var(--tap-min, 44px)')
  })
})

describe('the row checkboxes on the touch tier (A2R-10)', () => {
  it.each([
    ['NoteCard.module.css', join(NB, 'NoteCard.module.css')],
    ['NotesTableView.module.css', join(NB, 'NotesTableView.module.css')],
  ])('%s: the checkbox itself is at least 24x24, inside its 44 px label', (_name, file) => {
    const rules = rulesWithMedia(read(file))
    expect(px(lastDecl(rules, '.selectBox input', 'width', TOUCH))).toBeGreaterThanOrEqual(24)
    expect(px(lastDecl(rules, '.selectBox input', 'height', TOUCH))).toBeGreaterThanOrEqual(24)
    expect(lastDecl(rules, '.selectBox', 'min-height', TOUCH)).toBe('var(--tap-min)')
  })
})

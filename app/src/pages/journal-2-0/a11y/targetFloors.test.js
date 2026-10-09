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
import { MQ } from '../../../styles/breakpoints'

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

// Wave 10 lane D3P (D-3 PHONE). At 390 px the formatting row wrapped to ~8 rows and the note's
// title fell below the first screen (lane L3, measured); a phone now keeps Undo / Redo, B, I and
// the bullet list and puts the rest behind "Aa Format". The rendered half (which controls sit
// behind the toggle, the keyboard contract, the desktop order) is
// components/notebook/NoteEditorPage.phoneFormat.test.jsx; THIS is where the collapse lives: it
// must be inside the canonical PHONE query and nowhere else, so desktop and tablet are the row
// they were. Structural; the measured before/after is docs/notebook/proof/d3p-*.
// The canonical phone query, imported rather than restated (review M-4b): a copy here would be a
// second authority over the one number the whole collapse hangs on.
const PHONE = MQ.phone
const COLLAPSE = '.toolbarRow:not([data-format-open]) .formatRun'

describe('D3P: the phone formatting disclosure lives ONLY inside the 640 query (NoteEditorPage.module.css)', () => {
  const rules = rulesWithMedia(read(join(NB, 'NoteEditorPage.module.css')))

  it('base (every width): the toggle is not displayed and a run lays out as if it were not there', () => {
    expect(lastDecl(rules, '.formatToggle', 'display')).toBe('none')
    expect(lastDecl(rules, '.formatRun', 'display')).toBe('contents')
  })

  it('phone: the toggle shows and the runs collapse while the row is not open', () => {
    expect(lastDecl(rules, '.formatToggle', 'display', PHONE)).toBe('inline-flex')
    expect(lastDecl(rules, COLLAPSE, 'display', PHONE)).toBe('none')
  })

  it('NOTHING outside the phone query shows the toggle or collapses a run', () => {
    const leaks = rules.filter((r) => r.media !== PHONE && r.decls.has('display') && (
      (r.selector.includes('.formatToggle') && r.decls.get('display') !== 'none')
      || (r.selector.includes('.formatRun') && r.decls.get('display') !== 'contents')))
    expect(leaks.map((r) => `${r.media || 'base'} ${r.selector}`)).toEqual([])
  })

  it('CONTROL: the collapse moved out to every width is caught', () => {
    const bad = rulesWithMedia(`.formatToggle { display: none; } .formatRun { display: contents; }
      ${COLLAPSE} { display: none; }`)
    const leaks = bad.filter((r) => r.media !== PHONE && r.selector.includes('.formatRun') && r.decls.get('display') !== 'contents')
    expect(leaks).toHaveLength(1)
    expect(lastDecl(bad, COLLAPSE, 'display', PHONE)).toBeUndefined()
  })
})

// Wave 10 lane D3P (design re-check N-3): at 390 px the open "More note actions" panel hung
// ~13 rows down from its door, under the Log FAB ("Print"), the orb cluster and below the fold
// (Delete). On a phone it is pinned to the viewport ABOVE the bottom band and scrolls inside
// itself. The band is DERIVED from the three things that make it, never retyped: move any of
// them up and this reds.
describe('D3P N-3: on a phone the open More panel sits above the bottom band (NoteMoreMenu.module.css)', () => {
  const rules = rulesWithMedia(read(join(NB, 'NoteMoreMenu.module.css')))
  const SRC = join(process.cwd(), 'src')
  /** A length or a calc() split into its TOP-LEVEL terms, each with the sign in front of it and
   *  the px it carries (`env(x, 0px)` carries 0; `var(--y, 48px)` carries its fallback). Signed
   *  (review M-4c): an unsigned sum reads `- 168px` and `+ 168px` as the same cap. CSS calc() puts
   *  whitespace round a binary + or -, which is what tells an operator from a negative number. */
  const signedTerms = (v) => {
    let s = String(v || '').trim()
    const inner = /^calc\((.*)\)$/s.exec(s)
    if (inner) s = inner[1]
    const terms = []
    let depth = 0; let sign = 1; let cur = ''
    for (let i = 0; i < s.length; i += 1) {
      const c = s[i]
      if (c === '(') depth += 1
      else if (c === ')') depth -= 1
      if (depth === 0 && (c === '+' || c === '-') && /\s/.test(s[i - 1] || '') && /\s/.test(s[i + 1] || '')) {
        if (cur.trim()) terms.push({ sign, text: cur.trim() })
        sign = c === '-' ? -1 : 1
        cur = ''
        continue
      }
      cur += c
    }
    if (cur.trim()) terms.push({ sign, text: cur.trim() })
    return terms.map((t) => ({ ...t, px: [...t.text.matchAll(/(\d+(?:\.\d+)?)px/g)].reduce((a, m) => a + Number(m[1]), 0) }))
  }
  const pxSum = (v) => signedTerms(v).reduce((a, t) => a + t.sign * t.px, 0)
  const tapMin = px(/--tap-min:\s*([^;]+);/.exec(read(join(SRC, 'styles', 'tokens.css')))[1])
  const hubConst = (name) => Number(new RegExp(`export const ${name} = (\\d+)`).exec(read(join(SRC, 'hub', 'constants.js')))[1])
  const journal = rulesWithMedia(read(join(J2, 'JournalLayout.module.css')))
  const orb = rulesWithMedia(read(join(SRC, 'components', 'voice', 'FloatingOrb.module.css')))
  const band = () => ({
    hubPad: hubConst('BOTTOM_OFFSET_PX') + hubConst('PAD_PX'),
    logFab: pxSum(lastDecl(journal, '.logFab', 'bottom', PHONE)) + tapMin,
    orb: pxSum(lastDecl(orb, '.orbCluster', 'bottom', TOUCH)) + px(lastDecl(orb, '.orb', 'height')),
  })

  it('non-vacuity: every part of the band was read, and each is a real height', () => {
    const b = band()
    expect(b.hubPad).toBeGreaterThan(100)
    expect(b.logFab).toBeGreaterThan(tapMin)
    expect(b.orb).toBeGreaterThan(40)
  })

  it('phone: pinned to the viewport, its bottom edge above the highest thing in the band', () => {
    expect(lastDecl(rules, '.panel', 'position', PHONE)).toBe('fixed')
    const bottom = pxSum(lastDecl(rules, '.panel', 'bottom', PHONE))
    const highest = Math.max(...Object.values(band()))
    expect(bottom, JSON.stringify(band())).toBeGreaterThan(highest)
  })

  it('phone: it cannot run under the top bar or off the screen -- capped, and it scrolls inside', () => {
    expect(lastDecl(rules, '.panel', 'overflow-y', PHONE)).toBe('auto')
    const cap = lastDecl(rules, '.panel', 'max-height', PHONE)
    expect(cap).toMatch(/var\(--mobile-topbar-h/)
    // the cap takes AWAY the top bar and the panel's own bottom offset (plus a gap), so top +
    // height stays on screen. Read by sign: a term that is added back is not taken away.
    const terms = signedTerms(cap)
    const isTopbar = (t) => /--mobile-topbar-h/.test(t.text)
    expect(terms.some((t) => t.sign < 0 && isTopbar(t)), `the top bar is subtracted: ${cap}`).toBe(true)
    expect(terms.filter((t) => t.sign > 0).reduce((a, t) => a + t.px, 0), `no px is added back: ${cap}`).toBe(0)
    const takenAway = terms.filter((t) => t.sign < 0 && !isTopbar(t)).reduce((a, t) => a + t.px, 0)
    expect(takenAway).toBeGreaterThanOrEqual(pxSum(lastDecl(rules, '.panel', 'bottom', PHONE)))
  })

  it('CONTROL (M-4c): the sign is read -- a cap that ADDS its offset back, or a bottom subtracted, fails', () => {
    const flipped = signedTerms('calc(100dvh - var(--mobile-topbar-h, 48px) + 168px)')
    expect(flipped.filter((t) => t.sign > 0).reduce((a, t) => a + t.px, 0)).toBe(168)
    expect(pxSum('calc(env(safe-area-inset-bottom, 0px) - 160px)')).toBe(-160)
    expect(pxSum('calc(env(safe-area-inset-bottom, 0px) + 160px)')).toBe(160)
  })

  it('above 640 px nothing changed: the panel still hangs from its door', () => {
    expect(lastDecl(rules, '.panel', 'position')).toBe('absolute')
    const leaks = rules.filter((r) => r.selector === '.panel' && r.media !== PHONE && r.decls.get('position') === 'fixed')
    expect(leaks).toEqual([])
  })

  it('CONTROL: a panel whose bottom sits inside the band fails the check', () => {
    const low = rulesWithMedia('@media (max-width: 640px) { .panel { position: fixed; bottom: calc(env(safe-area-inset-bottom, 0px) + 120px); } }')
    expect(pxSum(lastDecl(low, '.panel', 'bottom', PHONE))).toBeLessThanOrEqual(Math.max(...Object.values(band())))
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

// Wave 10 lane K2 (keyboard walk row S6-02 at 820 px): after F5 the row checkboxes passed, and
// the one target left under 24 px was a folder row's NAME button, 20x44 -- squeezed by the
// chevron and four 44 px row actions on the same line. Structural, like the rest of this file;
// the verdict is the walk's own row (docs/notebook/evidence/a11y-k2-keyboard-2026-09-28/).
describe('a folder row keeps its name tappable on the touch tier (S6-02)', () => {
  const rules = rulesWithMedia(read(join(NB, 'FolderSidebar.module.css')))

  it('the name button has a 44 px width floor on the touch tier (it was `min-width: 0`)', () => {
    expect(lastDecl(rules, '.rowWrap .row', 'min-width')).toBe('0')
    expect(lastDecl(rules, '.rowWrap .row', 'min-width', TOUCH)).toBe('var(--tap-min, 44px)')
  })

  it('...and the row wraps its actions under the name rather than overflow the panel', () => {
    expect(lastDecl(rules, '.folderRow', 'flex-wrap', TOUCH)).toBe('wrap')
  })

  it('CONTROL: a touch tier without the floor fails the check', () => {
    const old = rulesWithMedia('.rowWrap .row { flex: 1; min-width: 0; } @media (max-width: 1024px) { .row { min-height: 44px; } }')
    expect(lastDecl(old, '.rowWrap .row', 'min-width', TOUCH)).toBeUndefined()
  })
})

// Wave 10 lane L3 (clause 6c, "no layout regressions at 390/820/1200"): three targets the
// layout instrument measured under 24 px with no spacing to excuse them
// (docs/notebook/proof/l3-layout-0e72ad573/before/run.json; after/ holds the re-measure):
//   * a timeline note bar, 81x20 at 1200, stacked 3 px from the next bar;
//   * a tag's "Remove tag" x, 20x20 at 1200, within 12 px of the Subtitle field;
//   * a calendar note chip, 22.3 px tall at 820 and 1200, beside the hub's fixed
//     "Notebook actions" button at 820.
// Structural, like the rest of this file; the rendered verdict is the instrument's.
describe('L3: the timeline bar, the tag remove x and the calendar chip reach 24 px', () => {
  const timeline = rulesWithMedia(read(join(NB, 'NoteTimelineView.module.css')))
  const tags = rulesWithMedia(read(join(NB, 'NoteTagsField.module.css')))
  const calendar = rulesWithMedia(read(join(NB, 'NoteCalendarView.module.css')))

  it('a timeline bar has a 24 px height floor outside any @media', () => {
    expect(px(lastDecl(timeline, '.chip', 'min-height'))).toBeGreaterThanOrEqual(24)
  })

  it("...and the touch tier's 44 px floor still wins: same selector, LATER in the file", () => {
    const base = timeline.findIndex((r) => r.selector === '.chip' && r.media === null && r.decls.has('min-height'))
    const touch = timeline.findIndex((r) => r.selector === '.chip' && r.media === TOUCH && r.decls.has('min-height'))
    expect(lastDecl(timeline, '.chip', 'min-height', TOUCH)).toBe('var(--tap-min)')
    expect(base, 'the base floor exists').toBeGreaterThanOrEqual(0)
    expect(touch, 'the touch floor comes after it').toBeGreaterThan(base)
  })

  it('the tag remove x is at least 24x24, and keeps its 44 px floor on the touch tier', () => {
    expect(px(lastDecl(tags, '.remove', 'width'))).toBeGreaterThanOrEqual(24)
    expect(px(lastDecl(tags, '.remove', 'height'))).toBeGreaterThanOrEqual(24)
    expect(lastDecl(tags, '.remove', 'min-height', TOUCH)).toBe('var(--tap-min)')
    expect(lastDecl(tags, '.remove', 'min-width', TOUCH)).toBe('var(--tap-min)')
  })

  it('a calendar note chip has a 24 px height floor', () => {
    expect(px(lastDecl(calendar, '.chip', 'min-height'))).toBeGreaterThanOrEqual(24)
  })

  it('CONTROL: the measured declarations (20 px bar, 20x20 x, no chip floor) fail these checks', () => {
    const old = rulesWithMedia(`.chip { padding: 2px 8px; font-size: 12px; }
      .remove { width: 20px; height: 20px; }
      @media (max-width: 1024px) { .chip { min-height: var(--tap-min); } }`)
    expect(lastDecl(old, '.chip', 'min-height')).toBeUndefined()
    expect(px(lastDecl(old, '.remove', 'width'))).toBeLessThan(24)
  })
})

// Wave 10 lane L3, fix round 1. The rendered verdict is the layout instrument's run
// (docs/notebook/proof/l3-layout-0e72ad573/r1-after/, calendar_cells); this holds the declaration.
// (Round 1's phone-toolbar Log FAB clearance and its rails were reverted in fix round 2.)
describe('L3 R1: a calendar note chip is a 44 px finger target on the touch tier (review I-1)', () => {
  const calendar = rulesWithMedia(read(join(NB, 'NoteCalendarView.module.css')))

  it('the touch tier floors `.chip` at --tap-min, AFTER the base 24 px rule so it wins', () => {
    expect(lastDecl(calendar, '.chip', 'min-height', TOUCH)).toBe('var(--tap-min)')
    const base = calendar.findIndex((r) => r.selector === '.chip' && r.media === null && r.decls.has('min-height'))
    const touch = calendar.findIndex((r) => r.selector === '.chip' && r.media === TOUCH && r.decls.has('min-height'))
    expect(base).toBeGreaterThanOrEqual(0)
    expect(touch).toBeGreaterThan(base)
  })

  it('CONTROL: without the touch rule the chip has no touch floor', () => {
    const old = rulesWithMedia('.chip { min-height: 24px; }')
    expect(lastDecl(old, '.chip', 'min-height', TOUCH)).toBeUndefined()
  })
})

// Wave 10 lane WK (proof walk wk-7bd834b9f, clause 6c). The find bar's OWN sibling
// controls (`.navBtn`/`.closeBtn`/`.textBtn`) already floor to --tap-min at the touch
// tier; the find input itself was the one left out -- measured 248x18 at 390 and
// 195x18 at 820 (geometry sweep, `tag: INPUT`, `control: "Find in note"`, surface
// ed-find). Below the product's own 24 px WCAG floor this file otherwise holds
// everything to, not merely the stricter 44 px instrument reading.
describe('WK: the Find-in-note input gets the same touch floor as its row-mates (NoteFindBar.module.css)', () => {
  const find = rulesWithMedia(read(join(NB, 'NoteFindBar.module.css')))

  it('the input floors to --tap-min at the touch tier, same as .navBtn/.closeBtn/.textBtn', () => {
    expect(lastDecl(find, '.input', 'min-height', TOUCH)).toBe('var(--tap-min, 44px)')
    expect(lastDecl(find, '.navBtn', 'min-height', TOUCH)).toBe('var(--tap-min, 44px)')
    expect(lastDecl(find, '.closeBtn', 'min-height', TOUCH)).toBe('var(--tap-min, 44px)')
  })

  it('the floor is TOUCH-ONLY: no min-height on `.input` outside the touch query', () => {
    const leaks = find.filter((r) => r.selector === '.input' && r.media !== TOUCH && r.decls.has('min-height'))
    expect(leaks.map((r) => r.media || 'base')).toEqual([])
  })

  it("the phone query's `.input { width: 100% }` is untouched by the floor", () => {
    expect(lastDecl(find, '.input', 'width', '(max-width: 640px)')).toBe('100%')
  })

  it('CONTROL: the measured declaration (font-size only, no min-height) fails the floor check', () => {
    const old = rulesWithMedia(`@media (max-width: 1024px) { .input { font-size: 16px; } }`)
    expect(lastDecl(old, '.input', 'min-height', TOUCH)).toBeUndefined()
  })
})

// Wave 10 lane WK2 (proof walk wk-7bd834b9f, clause 6c -- two more sub-24px targets from the
// same geometry.json the WK block above reads): the import wizard's "How do I get my export
// file?" accordion toggle (195.4x23 at both 390 and 820) and the widget palette's "Close insert
// panel" x (21.8x24 at 820 -- height already clears the floor, width did not).
describe('WK2: the export-guide accordion toggle reaches 24px height (ImportWizard.module.css)', () => {
  const wiz = rulesWithMedia(read(join(NB, 'import', 'ImportWizard.module.css')))

  it('the accordion header has a 24px height floor outside any @media', () => {
    expect(px(lastDecl(wiz, '.accordionHeader', 'min-height'))).toBeGreaterThanOrEqual(24)
  })

  it('CONTROL: the measured declaration (padding only, no min-height) fails the floor check', () => {
    const old = rulesWithMedia('.accordionHeader { padding: 4px 0; font-size: 13px; }')
    expect(lastDecl(old, '.accordionHeader', 'min-height')).toBeUndefined()
  })
})

describe('WK2: the widget palette head buttons reach 24px width (WidgetPalette.module.css)', () => {
  const pal = rulesWithMedia(read(join(NB, 'WidgetPalette.module.css')))

  it('"Close insert panel" (and its row-mate "‹ Back") get a 24px width floor', () => {
    expect(px(lastDecl(pal, '.headBtn', 'min-width'))).toBeGreaterThanOrEqual(24)
  })

  it('CONTROL: the measured declaration (padding only, no min-width) fails the floor check', () => {
    const old = rulesWithMedia('.headBtn { padding: 4px 6px; font-size: 12px; }')
    expect(lastDecl(old, '.headBtn', 'min-width')).toBeUndefined()
  })
})

// Wave 10 lane DR-F (design re-review D-8, docs/notebook/design-review-2.md): the
// SAME target-floor class D-6 closed on the editor, unaudited on six other 1200px
// surfaces -- read against `record.json`/`detail.json`
// (docs/notebook/proof/drr-ef55d6025/): the 16x16 row-selection checkbox on
// List/Table/Templates/Search-result rows (one shared component, `NoteCard.jsx`,
// covers all four; Table's own `.selectBox input` is a second, separate copy);
// the board's 216x18 note-title link; the templates gallery's 76x21 "Preview"
// button; and Timeline's own eight toolbar controls at 20-22px. Each below is a
// genuine gap, not a WCAG 2.5.8 spacing/equivalent exception (the header comment
// names those exceptions; none of these six have a bigger same-function control
// beside them -- the checkbox's 32/28px wrapper is a bigger POINTER hit area, not
// an independently reachable equivalent target).
describe('D-8: the row-selection checkbox reaches 24px at 1200 (NoteCard.module.css, list/templates/search)', () => {
  const card = rulesWithMedia(read(join(NB, 'NoteCard.module.css')))

  it('the checkbox is at least 24x24 OUTSIDE any @media (desktop was never floored)', () => {
    expect(px(lastDecl(card, '.selectBox input', 'width'))).toBeGreaterThanOrEqual(24)
    expect(px(lastDecl(card, '.selectBox input', 'height'))).toBeGreaterThanOrEqual(24)
  })

  it('the touch tier keeps its own 24x24 (A2R-10, unmoved by this fix)', () => {
    expect(px(lastDecl(card, '.selectBox input', 'width', TOUCH))).toBeGreaterThanOrEqual(24)
    expect(px(lastDecl(card, '.selectBox input', 'height', TOUCH))).toBeGreaterThanOrEqual(24)
  })

  it('CONTROL: the measured declaration (16x16, no base floor) fails the check', () => {
    const old = rulesWithMedia(`.selectBox input { width: 16px; height: 16px; }
      @media (max-width: 1024px) { .selectBox input { width: 24px; height: 24px; } }`)
    expect(px(lastDecl(old, '.selectBox input', 'width'))).toBeLessThan(24)
  })
})

describe('D-8: the row-selection checkbox reaches 24px at 1200 (NotesTableView.module.css, table)', () => {
  const table = rulesWithMedia(read(join(NB, 'NotesTableView.module.css')))

  it('the checkbox (a row\'s own, and "Select all notes in view") is at least 24x24 outside any @media', () => {
    expect(px(lastDecl(table, '.selectBox input', 'width'))).toBeGreaterThanOrEqual(24)
    expect(px(lastDecl(table, '.selectBox input', 'height'))).toBeGreaterThanOrEqual(24)
  })

  it('CONTROL: the measured declaration (16x16, no base floor) fails the check', () => {
    const old = rulesWithMedia('.selectBox input { width: 16px; height: 16px; }')
    expect(px(lastDecl(old, '.selectBox input', 'width'))).toBeLessThan(24)
  })
})

describe('D-8: a board card\'s title link reaches 24px height (NoteBoardView.module.css)', () => {
  const board = rulesWithMedia(read(join(NB, 'NoteBoardView.module.css')))

  it('.cardTitle has a 24px height floor -- it is the ONLY way to open the note from a board card', () => {
    expect(px(lastDecl(board, '.cardTitle', 'min-height'))).toBeGreaterThanOrEqual(24)
  })

  it('CONTROL: the measured declaration (padding: 0, no min-height) fails the check', () => {
    const old = rulesWithMedia('.cardTitle { padding: 0; font-size: 13px; line-height: 1.35; }')
    expect(lastDecl(old, '.cardTitle', 'min-height')).toBeUndefined()
  })
})

describe('D-8: the templates gallery\'s "Preview" button reaches 24px height (TemplatePicker.module.css)', () => {
  const tpl = rulesWithMedia(read(join(NB, 'TemplatePicker.module.css')))

  it('.miniBtn has a 24px height floor outside any @media -- 76px wide already clears the width axis', () => {
    expect(px(lastDecl(tpl, '.miniBtn', 'min-height'))).toBeGreaterThanOrEqual(24)
  })

  it('the touch tier still floors it further, to --tap-min', () => {
    expect(lastDecl(tpl, '.miniBtn', 'min-height', TOUCH)).toBe('var(--tap-min)')
  })

  it('CONTROL: the measured declaration (padding only, no min-height) fails the check', () => {
    const old = rulesWithMedia('.miniBtn { padding: 2px 8px; font-size: 11px; }')
    expect(lastDecl(old, '.miniBtn', 'min-height')).toBeUndefined()
  })
})

describe('D-8: all eight Timeline toolbar controls reach 24px height (NoteTimelineView.module.css)', () => {
  const tl = rulesWithMedia(read(join(NB, 'NoteTimelineView.module.css')))

  it('Place-by / Group-by (.control select) floor to 24px outside any @media', () => {
    expect(px(lastDecl(tl, '.control select', 'min-height'))).toBeGreaterThanOrEqual(24)
  })

  it('Week/Month/Quarter and Previous/Next/Today (.zoomBtn, .navBtn) floor to 24px outside any @media', () => {
    expect(px(lastDecl(tl, '.zoomBtn', 'min-height'))).toBeGreaterThanOrEqual(24)
    expect(px(lastDecl(tl, '.navBtn', 'min-height'))).toBeGreaterThanOrEqual(24)
  })

  it('the touch tier still floors all three further, to --tap-min', () => {
    expect(lastDecl(tl, '.control select', 'min-height', TOUCH)).toBe('var(--tap-min)')
    expect(lastDecl(tl, '.zoomBtn', 'min-height', TOUCH)).toBe('var(--tap-min)')
    expect(lastDecl(tl, '.navBtn', 'min-height', TOUCH)).toBe('var(--tap-min)')
  })

  it('CONTROL: the measured declarations (22px select, 20-21px buttons, no base floor) fail the check', () => {
    const old = rulesWithMedia(`.control select { padding: 2px 6px; font-size: 12px; }
      .zoomBtn, .navBtn { padding: 2px 8px; font-size: 12px; }`)
    expect(lastDecl(old, '.control select', 'min-height')).toBeUndefined()
    expect(lastDecl(old, '.zoomBtn', 'min-height')).toBeUndefined()
  })
})

// Finish program, lane KEYS3 round 3 (the final browser walk's finding F2, measured at 820 and
// 390 px): three touch controls under the 44 px floor.
//   * the template picker's "All" chip, 37 px wide. Fixed by the landing itself after the walk
//     (380cb32522); pinned here so it stays.
//   * the import wizard's destination select, 37 px tall.
//   * a 20 x 20 checkbox in the import wizard. A checkbox keeps its box: its hit area is the
//     <label> it sits in, so the two label rows that hold one are 44 px tall.
describe('KEYS3 F2: touch floors on the template chip and in the import wizard', () => {
  const tpl = rulesWithMedia(read(join(NB, 'TemplatePicker.module.css')))
  const wiz = rulesWithMedia(read(join(NB, 'import', 'ImportWizard.module.css')))
  const floor = (rules, selector, prop) => {
    const hit = [...rules].reverse().find((r) => r.media === TOUCH
      && r.selector.split(',').map((s) => s.trim()).includes(selector) && r.decls.has(prop))
    return hit ? hit.decls.get(prop) : undefined
  }
  const is44 = (v) => /var\(--tap-min/.test(String(v)) || px(v) >= 44

  it('the template picker\'s chips are 44 px wide and tall on the touch tier', () => {
    expect(is44(floor(tpl, '.chip', 'min-width'))).toBe(true)
    expect(is44(floor(tpl, '.chip', 'min-height'))).toBe(true)
  })

  it('the import wizard\'s destination select is 44 px tall on the touch tier', () => {
    expect(is44(floor(wiz, '.destSelect', 'min-height'))).toBe(true)
  })

  it('both label rows that hold a checkbox are 44 px tall on the touch tier', () => {
    expect(is44(floor(wiz, '.noteRow', 'min-height'))).toBe(true)
    expect(is44(floor(wiz, '.excludeRow', 'min-height'))).toBe(true)
  })

  // Finish program, the walk's last F2 row: a group's "All" button measured 38 x 44 -- the
  // height floor was there and the WIDTH was the label's. Both bulk buttons get both floors.
  it('the import wizard\'s bulk buttons ("All"/"None", "Select all"/"Select none") are 44 px wide and tall', () => {
    for (const sel of ['.groupBulkBtn', '.bulkBtn']) {
      expect(is44(floor(wiz, sel, 'min-width')), `${sel} min-width`).toBe(true)
      expect(is44(floor(wiz, sel, 'min-height')), `${sel} min-height`).toBe(true)
    }
  })

  it('CONTROL: the helper reads no floor from a sheet that has none', () => {
    const none = rulesWithMedia('.destSelect { padding: 8px 10px; } @media (max-width: 640px) { .destSelect { min-height: 44px; } }')
    expect(floor(none, '.destSelect', 'min-height')).toBeUndefined()
  })
})

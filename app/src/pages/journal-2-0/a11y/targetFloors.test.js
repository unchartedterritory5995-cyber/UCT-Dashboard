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

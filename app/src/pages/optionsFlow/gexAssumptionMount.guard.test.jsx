/**
 * TERM-029 / RM-N14 — THE ASSUMPTION IS AT THE NUMBER, AND REACHABLE BY THUMB.
 *
 * ⛔ WHAT THIS RAIL MUST NOT BE. `GEX_ASSUMPTION_LONG` has lived in
 * `OptionsFlow.jsx` since 2026-07-22 as the Naive/Trade-Aware toggle's native
 * `title=`, and `gexAssumption.test.js` pins the copy against it. So a rail that
 * asked "does the assumption text exist in this file" would have passed on
 * arrival, measured nothing, and read as coverage for the one thing TERM-029
 * changes. Every assertion below is about PLACEMENT — the label is inside the
 * region that renders Total GEX, and inside the region that renders the Summary
 * row — and about REACH, which is the half a `title=` never had.
 *
 * Proven RED against `git show HEAD:app/src/pages/OptionsFlow.jsx` before the
 * wiring landed: the mount assertions and both region assertions failed; the
 * `title=` assertion passed, which is exactly why it is not the rail.
 *
 * Structural like `explainMount.guard.test.js` and `wiring.guard.test.js` beside
 * it, for the same reason they are: `OptionsFlow.jsx` is partner-owned, edited
 * through the GitHub web UI, and twice on 2026-07-25 a save from a long-open tab
 * landed as a stale-buffer commit that silently reverted committed work. An
 * additive mount can vanish that way without breaking the page — the member just
 * quietly loses the disclosure again, and no render test of the component would
 * notice, because the component would still be perfect.
 *
 * If a case fails, RE-APPLY the wiring — three insertions, and none of them
 * touches an inline style:
 *   1. `import GexAssumptionNote from "./optionsFlow/GexAssumptionNote";`
 *   2. `<GexAssumptionNote adjusted={gexData.adjusted} />` as the last child of
 *      the Total GEX key-level card
 *   3. the same mount as the last child of the Summary row's pill strip
 * ⛔ Do not "fix" a failure by editing this file, and NEVER edit
 * `OptionsFlow.jsx` to satisfy the copy pin — that file is the authority for
 * what the product says. If TERM-029 was reverted ON PURPOSE, delete this file
 * and `GexAssumptionNote.jsx` in the same commit and restore the
 * `gexAssumption.js` entry in `components/screener/reachable.test.js`.
 */
import { describe, it, expect } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import GexAssumptionNote from './GexAssumptionNote.jsx'
import {
  GEX_ASSUMPTION_LONG,
  GEX_ASSUMPTION_BY_MODE,
  gexAssumptionFor,
} from './gexAssumption.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const SRC = fs.readFileSync(path.join(here, '..', 'OptionsFlow.jsx'), 'utf8')
const CSS = fs.readFileSync(path.join(here, '..', 'OptionsFlow.mobile.css'), 'utf8')
const NOTE = fs.readFileSync(path.join(here, 'GexAssumptionNote.jsx'), 'utf8')

/** Code only. A mention in prose must never satisfy — or trip — a check. */
const strip = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/.*$/gm, '$1')
const CODE = strip(SRC)
const NOTE_CODE = strip(NOTE)

const FIX = '\n\n  ==> re-apply the three insertions listed at the top of '
  + 'gexAssumptionMount.guard.test.jsx\n'

const count = (hay, needle) => hay.split(needle).length - 1

/**
 * The rendered region of ONE key number, bounded by code anchors either side.
 * ⛔ Anchors are LOCATED, never line numbers: this file moves constantly, and a
 * pinned line is how a guard in this directory has already gone stale twice.
 */
function region(startAnchor, endAnchor) {
  const start = CODE.indexOf(startAnchor)
  if (start < 0) return { start, end: -1, text: '' }
  const end = CODE.indexOf(endAnchor, start)
  return { start, end, text: end > start ? CODE.slice(start, end) : '' }
}

/** The Total GEX key-level card: its label, its figure, its safety-net line. */
const tile = () => region('Total GEX', 'GEX by Strike')
/** The GEX Summary row: the Spot / Danger Line / GEX pill strip. */
const summary = () => region('[["Spot","$"+sp.toFixed(0)', 'linear-gradient(90deg')

describe('TERM-029 — the assumption label is mounted AT the GEX numbers', () => {
  it('CONTROL: the guard can see the partner file, and both anchors are unique', () => {
    // Without this every containment check below could pass over an empty slice,
    // which is the defect class this repo has logged three times.
    expect(CODE.length).toBeGreaterThan(100000)
    expect(CODE).toContain('of-mroot')
    expect(count(CODE, 'Total GEX'), 'the Total GEX label is not unique any '
      + 'more — the tile region cannot be located by it').toBe(1)
    expect(count(CODE, '[["Spot","$"+sp.toFixed(0)'), 'the Summary pill array '
      + 'is not unique any more').toBe(1)
    expect(tile().text.length).toBeGreaterThan(200)
    expect(summary().text.length).toBeGreaterThan(200)
  })

  it('CONTROL: the two regions are genuinely different places', () => {
    // A bug that made one anchor resolve to the other's slice would let a single
    // mount satisfy both "at the number" assertions.
    expect(tile().text, 'the tile slice has swallowed the Summary row')
      .not.toContain('fmtGex(tg)')
    expect(summary().text, 'the Summary slice has swallowed the tile')
      .not.toContain('gexData.totalGex')
    expect(tile().text.length).toBeLessThan(4000)
    expect(summary().text.length).toBeLessThan(4000)
  })

  it('imports the note from its own home in optionsFlow/', () => {
    expect(CODE.includes('import GexAssumptionNote from "./optionsFlow/GexAssumptionNote";'),
      'the import is gone — both mounts went with it' + FIX).toBe(true)
  })

  it('renders AT the Total GEX number — in the same card as the figure', () => {
    const t = tile().text
    // The region really is the one that renders the number...
    expect(t, 'the tile region no longer renders the Total GEX figure')
      .toContain('fmtGex(gexData.totalGex)')
    expect(t).toContain('Safety net O')
    // ...and the label is in it.
    expect(t.includes('<GexAssumptionNote'),
      'the Total GEX card renders the figure with NO assumption beside it — a '
      + 'member reading it cannot reach what it assumes' + FIX).toBe(true)
  })

  it('renders AT the GEX Summary row — in the same strip as the pills', () => {
    const s = summary().text
    expect(s, 'the Summary region no longer renders the GEX pill').toContain('fmtGex(tg)')
    expect(s).toContain('Danger Line')
    expect(s.includes('<GexAssumptionNote'),
      'the Summary row shows Spot / Danger Line / GEX with no assumption beside '
      + 'them' + FIX).toBe(true)
  })

  it('mounts exactly twice — once per number, nowhere else', () => {
    expect((CODE.match(/<GexAssumptionNote\b/g) || []).length,
      'there should be exactly two mounts: the Total GEX card and the Summary '
      + 'row' + FIX).toBe(2)
  })

  it('⛔ both mounts read the PAYLOAD basis, never the live toggle state', () => {
    // Click Naive then Trade-Aware and the slower reply can land last.
    // `gexData.adjusted` is the basis that PRODUCED the number on screen;
    // `gexAdjusted` is what the toggle currently shows. Captioning a figure with
    // the other basis's assumption inverts the sign a member reads it by — the
    // same trap wiring.guard.test.js already records for the GEX expiry label.
    expect((CODE.match(/<GexAssumptionNote adjusted=\{gexData\.adjusted\}\s*\/>/g) || []).length,
      'a mount no longer passes gexData.adjusted' + FIX).toBe(2)
    expect(/<GexAssumptionNote[^>]*gexAdjusted/.test(CODE),
      'a mount is captioned from the live toggle state — an in-flight basis '
      + 'switch would label the number with the wrong assumption' + FIX).toBe(false)
  })

  it('CONTROL: `gexAdjusted` is still a real identifier in this file', () => {
    // Otherwise the assertion above passes because the name vanished, not
    // because the mounts stopped reading it.
    expect(/const \[gexAdjusted, setGexAdjusted\] = useState/.test(CODE)).toBe(true)
  })

  it('is additive: className hooks only, no inline style, partner content intact', () => {
    expect(/<GexAssumptionNote[^>]*style=/.test(CODE),
      'a mount carries an inline style — styling belongs in OptionsFlow.mobile.css'
      + FIX).toBe(false)
    // The card and the pill strip still render exactly what they rendered before.
    expect(CODE).toContain('letterSpacing:1 }}>Total GEX</div>')
    expect(CODE).toContain('{[["Spot","$"+sp.toFixed(0),P.wh]')
    expect(CODE).toContain('<div style={{ fontSize:18, fontWeight:900, color:gexData.totalGex>0?P.bu:P.be }}>')
  })

  it('⛔ the toggle keeps its own title — the pinned copy was NOT edited', () => {
    // gexAssumption.test.js asserts GEX_ASSUMPTION_LONG is byte-identical to a
    // title in this file. The only correct way to satisfy that is to leave the
    // partner's string alone, so the rail that could tempt someone to edit it
    // gets a rail of its own here.
    expect(CODE.includes(`title="${GEX_ASSUMPTION_LONG}"`),
      "the toggle's title= was reworded or removed — the partner file is the "
      + 'authority for what the product says; update gexAssumption.js instead')
      .toBe(true)
  })
})

describe('TERM-029 — the label is reachable BY TAP, not by hover', () => {
  it('a real button, named for what it reveals', () => {
    const { getByTestId } = render(<GexAssumptionNote adjusted={false} />)
    const btn = getByTestId('gex-assumption-trigger')
    // A <button> is the one control tap, click, Enter/Space and a screen reader
    // all reach. `type="button"` because a stray submit inside a form would
    // navigate instead of disclose.
    expect(btn.tagName).toBe('BUTTON')
    expect(btn.getAttribute('type')).toBe('button')
    expect(btn.getAttribute('aria-label')).toBe('What Naive GEX assumes')
    expect(btn.getAttribute('aria-expanded')).toBe('false')
  })

  it('names the live basis BEFORE any tap, so the figure is never unattributed', () => {
    const { container } = render(<GexAssumptionNote adjusted={false} />)
    expect(container.textContent).toContain('Naive basis')
  })

  it('a TAP reveals the sentence; a second tap puts it away', () => {
    const { getByTestId, container } = render(<GexAssumptionNote adjusted={false} />)
    const btn = getByTestId('gex-assumption-trigger')
    expect(container.textContent).not.toContain(GEX_ASSUMPTION_BY_MODE.naive)
    fireEvent.click(btn)
    expect(container.textContent,
      'tapping the control revealed nothing — this is the whole feature')
      .toContain(GEX_ASSUMPTION_BY_MODE.naive)
    expect(btn.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(btn)
    expect(container.textContent).not.toContain(GEX_ASSUMPTION_BY_MODE.naive)
  })

  it('⛔ is NOT a hover affordance — a pointer entering it discloses nothing', () => {
    // The defect TERM-029 exists to close is a `title=`, which is hover-only and
    // so does not exist on a phone. Re-implementing the reveal on mouseenter
    // would ship the same hole in a new costume, and it would LOOK fixed to
    // whoever tested it on a laptop.
    const { getByTestId, container } = render(<GexAssumptionNote adjusted={false} />)
    const btn = getByTestId('gex-assumption-trigger')
    fireEvent.mouseOver(btn)
    fireEvent.mouseEnter(btn)
    fireEvent.focus(btn)
    expect(container.textContent,
      'the sentence appeared without a tap — the reveal has a pointer-only path')
      .not.toContain(GEX_ASSUMPTION_BY_MODE.naive)
  })

  it('⛔ and it carries no native title= either', () => {
    // A `title` here would re-create the exact affordance being replaced, and
    // would read as belt-and-braces while being unreachable on touch.
    const { getByTestId } = render(<GexAssumptionNote adjusted={false} />)
    expect(getByTestId('gex-assumption-trigger').hasAttribute('title')).toBe(false)
    expect(/onMouseEnter|onMouseOver|onPointerEnter/.test(NOTE_CODE),
      'the component declares a pointer-enter handler').toBe(false)
  })
})

describe('TERM-029 — the label states the ACTIVE basis only', () => {
  for (const [adjusted, label, mine, theirs] of [
    [false, 'Naive', GEX_ASSUMPTION_BY_MODE.naive, GEX_ASSUMPTION_BY_MODE.tradeAware],
    [true, 'Trade-Aware', GEX_ASSUMPTION_BY_MODE.tradeAware, GEX_ASSUMPTION_BY_MODE.naive],
  ]) {
    it(`${label}: shows its own assumption and not the other one`, () => {
      const { getByTestId, container } = render(<GexAssumptionNote adjusted={adjusted} />)
      expect(container.textContent).toContain(`${label} basis`)
      fireEvent.click(getByTestId('gex-assumption-trigger'))
      expect(container.textContent).toContain(mine)
      // The ruling gexAssumption.js records: a label at the number states ONLY
      // the basis that produced that number. Both would leave the reader unable
      // to tell which assumption the figure in front of them rests on, which is
      // the defect this ticket exists to close.
      expect(container.textContent,
        'the label states the OTHER basis too — the reader cannot tell which '
        + 'assumption their figure rests on').not.toContain(theirs)
      expect(container.textContent,
        'the label shows the long two-basis form, which belongs on the toggle '
        + '(the control that CHOOSES between them), not at a number')
        .not.toContain(GEX_ASSUMPTION_LONG)
    })
  }

  it('an absent payload flag falls to Naive, the product default', () => {
    // An older payload carrying no `adjusted` key must not caption a naive
    // number as trade-aware. Absent means naive, which is what the toggle
    // defaults to.
    const { getByTestId, container } = render(<GexAssumptionNote />)
    expect(container.textContent).toContain('Naive basis')
    fireEvent.click(getByTestId('gex-assumption-trigger'))
    expect(container.textContent).toContain(gexAssumptionFor(false))
  })
})

describe('TERM-029 — the stylesheet reaches every member, phone and desktop', () => {
  // ⛔ COMMENTS OFF FIRST, AND THIS IS NOT HOUSEKEEPING. The block below is
  // documented in prose that names its own selectors and quotes its own
  // `z-index:3` rationale — so an uncommented scan both passes on prose and, as
  // the first version of this file proved, reads the digit out of a COMMENT:
  // a greedy `[^}]*` backtracks to the LAST `z-index:` inside the rule, which
  // was the one in the note explaining the value. It reported 3 for a rule
  // declaring 40.
  const CSS_CODE = CSS.replace(/\/\*[\s\S]*?\*\//g, ' ')

  /** CSS with every `@media` block removed, brace-counted. */
  const outsideMedia = (() => {
    let out = ''
    let i = 0
    for (;;) {
      const at = CSS_CODE.indexOf('@media', i)
      if (at === -1) { out += CSS_CODE.slice(i); break }
      out += CSS_CODE.slice(i, at)
      const open = CSS_CODE.indexOf('{', at)
      let depth = 1
      let j = open + 1
      for (; j < CSS_CODE.length && depth; j++) {
        if (CSS_CODE[j] === '{') depth += 1
        else if (CSS_CODE[j] === '}') depth -= 1
      }
      i = j
    }
    return out
  })()

  it('CONTROL: comment-stripping and the media stripper both work', () => {
    // `.of-picks` is declared ONLY inside a phone query, and named in the file
    // header's prose. If either stripper failed, "declared outside a media
    // query" would mean nothing below.
    expect(CSS_CODE, 'comments are not being stripped')
      .not.toContain('the payload, and a data grid that scrolls')
    expect(CSS_CODE).toContain('.of-picks')
    expect(outsideMedia, 'the @media stripper is not removing blocks')
      .not.toContain('.of-picks')
  })

  it('the appearance is declared OUTSIDE any media query', () => {
    // Scoped to ≤640px, the control would render unstyled — an unrecognisable
    // caption with no tappable tell — on the screens most members use.
    for (const sel of ['.of-gexnote-trigger', '.of-gexnote-text', '.of-gexnote-mode']) {
      expect(outsideMedia.includes(sel),
        `${sel} is only styled inside a media query — desktop gets an unstyled `
        + 'control').toBe(true)
    }
  })

  it('the finger floor is declared at the TOUCH boundary, not phone-only', () => {
    // 640 alone leaves the tablet tier (641-1024) under 44px, which is the
    // app-wide defect styles/tapFloor.test.js exists for.
    const touch = /@media \(max-width: 1024px\) \{[^@]*?\.of-gexnote-trigger[^@]*?min-height: var\(--tap-min/s
    expect(touch.test(CSS_CODE),
      'the trigger has no --tap-min floor in a <=1024px query').toBe(true)
  })

  it('the panel sits above the Summary gauge it overlaps', () => {
    // The Summary row's gauge markers carry z-index 3 on inline styles we may
    // not touch, so the panel has to out-stack them from here or it opens
    // behind them.
    const m = /\.of-gexnote-text\s*\{[^{}]*?z-index:\s*(\d+)/.exec(outsideMedia)
    expect(m, 'the panel declares no z-index').not.toBe(null)
    expect(Number(m[1]),
      'the panel does not out-stack the gauge markers it opens over')
      .toBeGreaterThan(3)
  })
})

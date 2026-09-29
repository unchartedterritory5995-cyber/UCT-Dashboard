// Wave 10 D-5 -- a VISIBLE scroll cue that does not depend on the OS scrollbar.
//
// The design-recheck (row D-5) found F5's fix real (the row scrolls itself, no page pans)
// but its own affordance UNPROVEN: with scrollbars shown, a pixel scan under the columns at
// 1200/820 "finds nothing above black". This file rails the SECOND, OS-independent cue added
// beside it -- a mask on the scroller's own right edge, present only while a column sits past
// the visible edge (`NoteBoardView.jsx`'s `moreRight` state) and gone at the end of the
// scroll. Two halves, like `NoteBoardView.scrollsAlone.test.js`:
//   * a RENDERED test that drives scroll metrics in jsdom (jsdom lays nothing out, so
//     `scrollWidth`/`clientWidth`/`scrollLeft` are mocked -- the same technique
//     `VideosSection.landing.test.jsx`'s "shelf paddles track content-only changes" test uses
//     for the identical reason: a real layout engine isn't here to overflow anything);
//   * a CSS/structural rail that reads the raw stylesheet + JSX text (`NoteBoardView.scrollsAlone.test.js`'s
//     own pattern) and checks the MECHANISM -- a mask, not a colour-matched overlay, cross-browser,
//     wired to the element that actually scrolls.
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { parseRules, declarations, stripComments } from '../../a11y/cssAudit'

import NoteBoardView from './NoteBoardView'

const STATUS = {
  id: 'builtin:thesis_status',
  name: 'Thesis Status',
  type: 'select',
  source: 'user_set',
  options: [
    { id: 'watching', label: 'Watching', color: 'blue' },
    { id: 'active', label: 'Active', color: 'green' },
    { id: 'closed', label: 'Closed', color: 'gray' },
  ],
}
const CONF = {
  id: 'builtin:confidence',
  name: 'Confidence',
  type: 'select',
  source: 'user_set',
  options: [{ id: 'high', label: 'High', color: 'green' }],
}
const NOTES = [
  { id: 'n1', title: 'NVDA thesis', propertiesJson: { 'builtin:thesis_status': 'watching' } },
]

// D5 fix round 1 (M2): DERIVED, never a re-typed magic number -- STATUS's own option
// count plus the always-present "No value" column, matching what `columnsFor()` in
// NoteBoardView.jsx actually builds (and matching NoteBoardView.test.jsx's own fixture:
// 3 options -> 4 columns).
const COLS = STATUS.options.length + 1
const COL_W = 300 // px per mocked column below -- arbitrary but shared by every test
const CLIENT_W = 700 // the mocked visible width every overflowing-board test renders at
const SCROLL_W = COLS * COL_W
// The effect's own `max = scrollWidth - clientWidth` -- derived here so a test never
// restates the arithmetic NoteBoardView.jsx already does.
const MAX_SCROLL = SCROLL_W - CLIENT_W

const renderBoard = (props = {}) => render(
  <NoteBoardView
    notes={NOTES}
    propertyDefs={[STATUS, CONF]}
    onOpenNote={vi.fn()}
    blockedNoteIds={new Set()}
    onChanged={vi.fn()}
    {...props}
  />,
)

const scroller = () => document.querySelector('[data-board-scroll-more]')
// ⛔ Ground truth is the ATTRIBUTE, not the CSS module class: a class name is hashed
// per-build (production has no readable local name), so a real production bundle can only be
// asked about this through `data-board-scroll-more` -- the same attribute
// `tools/notebook_d5_scroll_probe.py`'s R-RAW measurement reads. The class assertion in the
// CSS/structural block below is the second, independent half: that the attribute's "true"
// state is actually WIRED to a paint-affecting rule, not just data sitting unused in the DOM.
const cue = () => scroller()?.getAttribute('data-board-scroll-more')

// Mocks HTMLElement.prototype's scrollWidth/clientWidth for the life of `fn`. Every element
// answers the same way (Shelf.jsx's own test does this too) -- fine, because only the
// scroller's own reading is asserted.
const withScrollMetrics = (scrollWidth, clientWidth, fn) => {
  const sw = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(scrollWidth)
  const cw = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(clientWidth)
  try {
    return fn()
  } finally {
    sw.mockRestore()
    cw.mockRestore()
  }
}

describe('the board scroll cue -- rendered (jsdom scroll metrics driven by hand)', () => {
  it('is ABSENT when the row does not overflow (clientWidth >= scrollWidth)', () => {
    withScrollMetrics(SCROLL_W, 2000, () => {
      renderBoard()
      expect(cue()).toBe('false')
    })
  })

  it('is PRESENT at rest when the row overflows (scrollLeft 0, more columns to the right)', () => {
    withScrollMetrics(SCROLL_W, CLIENT_W, () => {
      renderBoard()
      expect(cue()).toBe('true')
    })
  })

  it('HIDES once scrolled to the end -- nothing more sits past the visible edge', async () => {
    withScrollMetrics(SCROLL_W, CLIENT_W, () => {
      renderBoard()
      expect(cue()).toBe('true')
      const el = scroller()
      Object.defineProperty(el, 'scrollLeft', { value: MAX_SCROLL, configurable: true })
      fireEvent.scroll(el)
      expect(cue()).toBe('false')
    })
  })

  it('REAPPEARS if scrolled back from the end', () => {
    withScrollMetrics(SCROLL_W, CLIENT_W, () => {
      renderBoard()
      const el = scroller()
      Object.defineProperty(el, 'scrollLeft', { value: MAX_SCROLL, configurable: true })
      fireEvent.scroll(el)
      expect(cue()).toBe('false')
      Object.defineProperty(el, 'scrollLeft', { value: 120, configurable: true })
      fireEvent.scroll(el)
      expect(cue()).toBe('true')
    })
  })

  // D5 fix round 1 (M1): the effect's `< max - 2` clause is a deliberate 2px END
  // tolerance -- a real browser's fractional-pixel scroll position at rest can land a
  // hair short of the true max, and the cue must already read "done" there, not "one
  // more nudge to go". Mutation-proved: dropping the tolerance (`< max - 2` -> `< max`)
  // turns this red.
  it('a sub-pixel scrollLeft inside the 2px END tolerance reads as fully scrolled', () => {
    withScrollMetrics(SCROLL_W, CLIENT_W, () => {
      renderBoard()
      const el = scroller()
      Object.defineProperty(el, 'scrollLeft', { value: MAX_SCROLL - 1.5, configurable: true })
      fireEvent.scroll(el)
      expect(cue()).toBe('false')
    })
  })

  // D5 fix round 2 (F1, controller ruling): the ">2" floor this test used to pin is GONE
  // from NoteBoardView.jsx -- M1b's own mutation-proof (loosen `max > 2` to `max > 0`)
  // needed a synthetic NEGATIVE scrollLeft to distinguish the two, which is exactly the
  // tell that the floor railed a code token, not a behaviour any real (scrollLeft >= 0)
  // input could reach: at max<=2 the tolerance clause alone already forces false. This is
  // the real-input replacement -- a genuine 1-2px overflow, read AT REST (scrollLeft=0,
  // the only value a member's browser produces here), still reads as not-yet-scrollable,
  // now through the tolerance clause ALONE: `0 < max - 2` === `0 < 0` === false.
  it('a 1-2px overflow at rest (scrollLeft=0) still reads as not-yet-scrollable', () => {
    withScrollMetrics(CLIENT_W + 2, CLIENT_W, () => {
      renderBoard()
      const el = scroller()
      Object.defineProperty(el, 'scrollLeft', { value: 0, configurable: true })
      fireEvent.scroll(el)
      expect(cue()).toBe('false')
    })
  })

  it('a CONTENT-ONLY change (regrouping to fewer columns) updates the cue with no resize event', async () => {
    // Mirrors VideosSection.landing.test.jsx's "shelf paddles track content-only changes"
    // control: scrollWidth is DERIVED from the scroller's own children count, so switching
    // "Group by" to a property with one option (2 columns: High + No value) shrinks it below
    // clientWidth without the box itself ever resizing -- exactly what a real ResizeObserver
    // cannot see, and exactly why `columns.length` rides the effect's dependency array as a
    // content key.
    const cw = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(700)
    const sw = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get')
      .mockImplementation(function boardScrollWidth() {
        return this.children ? this.children.length * 300 : 0
      })
    try {
      renderBoard()
      expect(cue()).toBe('true') // 4 columns * 300 = 1200 > 700
      fireEvent.change(screen.getByLabelText('Group by'), { target: { value: 'builtin:confidence' } })
      // Confidence has 1 option -> 2 columns (High + No value) * 300 = 600 <= 700.
      await waitFor(() => expect(cue()).toBe('false'))
    } finally {
      sw.mockRestore()
      cw.mockRestore()
    }
  })

  // D5 fix round 1 (I1): this used to be `expect(() => unmount()).not.toThrow()` --
  // which STILL PASSES with the effect's whole cleanup block (NoteBoardView.jsx's
  // `return () => { ... }`) deleted outright, because the global `test-setup.js`
  // ResizeObserver stub is a no-op (`observe`/`disconnect` do nothing observable) and
  // nothing ever asserted the scroll/resize listeners were actually removed. A leaked
  // `scroll` listener on a detached element or a leaked `resize` listener on `window`
  // throws NOTHING and unmounts cleanly -- it just keeps firing into a component that
  // no longer exists. This version spies on the real registration calls and asserts
  // each one is undone with the SAME function reference, plus a fake ResizeObserver
  // (the global stub can't see this) recording observe()/disconnect().
  // Mutation-proved: deleting the cleanup block, or deleting just its
  // `window.removeEventListener('resize', update)` line, both turn this red.
  it('control: unmounting REMOVES every listener with the SAME fn reference and disconnects its ResizeObserver', () => {
    withScrollMetrics(SCROLL_W, CLIENT_W, () => {
      const roCalls = { observe: 0, disconnect: 0 }
      const RealRO = globalThis.ResizeObserver
      class FakeRO {
        observe() { roCalls.observe += 1 }
        unobserve() {}
        disconnect() { roCalls.disconnect += 1 }
      }
      globalThis.ResizeObserver = FakeRO

      const winAdd = vi.spyOn(window, 'addEventListener')
      const winRemove = vi.spyOn(window, 'removeEventListener')
      const elAdd = vi.spyOn(HTMLElement.prototype, 'addEventListener')
      const elRemove = vi.spyOn(HTMLElement.prototype, 'removeEventListener')

      try {
        const { unmount } = renderBoard()
        expect(cue()).toBe('true')
        expect(roCalls.observe).toBe(1)

        const el = scroller()
        // Scoped to the SCROLLER specifically (via mock.instances, the same idiom
        // wireSection.test.jsx uses for Element.prototype.scrollIntoView) -- other
        // elements in the tree may also register listeners, and this must not
        // accidentally pass by finding one of THEIRS.
        const scrollAddIdx = elAdd.mock.calls.findIndex(
          (args, i) => args[0] === 'scroll' && elAdd.mock.instances[i] === el,
        )
        expect(scrollAddIdx, 'the effect registers a scroll listener on the scroller').toBeGreaterThan(-1)
        const registeredScrollFn = elAdd.mock.calls[scrollAddIdx][1]

        const resizeAddCall = winAdd.mock.calls.find((args) => args[0] === 'resize')
        expect(resizeAddCall, 'the effect registers a resize listener on window').toBeTruthy()
        const registeredResizeFn = resizeAddCall[1]

        // D5 fix round 2 (NIT): snapshot BEFORE unmount() and search only the LATER calls
        // for the removal -- so the assertion can only be satisfied by a call that happened
        // AS PART OF the unmount, never by an earlier call that merely used the same
        // reference for some other reason.
        const elRemoveLenBefore = elRemove.mock.calls.length
        const winRemoveLenBefore = winRemove.mock.calls.length

        unmount()
        expect(scroller()).toBeNull()

        const scrollRemoved = elRemove.mock.calls
          .slice(elRemoveLenBefore)
          .some((args) => args[0] === 'scroll' && args[1] === registeredScrollFn)
        expect(scrollRemoved, 'el.removeEventListener(scroll, SAME fn) was called ON unmount').toBe(true)

        const resizeRemoved = winRemove.mock.calls
          .slice(winRemoveLenBefore)
          .some((args) => args[0] === 'resize' && args[1] === registeredResizeFn)
        expect(resizeRemoved, 'window.removeEventListener(resize, SAME fn) was called ON unmount').toBe(true)

        expect(roCalls.disconnect).toBe(1)
      } finally {
        winAdd.mockRestore()
        winRemove.mockRestore()
        elAdd.mockRestore()
        elRemove.mockRestore()
        globalThis.ResizeObserver = RealRO
      }
    })
  })
})

describe('the board scroll cue -- CSS/structural (NoteBoardView.module.css [data-board-scroll-more])', () => {
  const DIR = join(process.cwd(), 'src', 'pages', 'journal-2-0', 'components', 'notebook')
  const FADE_SELECTOR = '.columns[data-board-scroll-more="true"]'

  const ruleFrom = (text, selector) => {
    const r = parseRules(text).find((x) => x.selector === selector)
    if (!r) throw new Error(`${selector} not found`)
    return Object.fromEntries(declarations(r).map((d) => [d.prop, d.value]))
  }

  // D5 fix round 1 (M3): `fade` used to be resolved by a bare `const` at DESCRIBE-BODY
  // execution -- which runs at COLLECTION time, before any test starts. A renamed/
  // removed selector threw THERE and killed collection for the WHOLE FILE (this block
  // AND the rendered describe block above it), reporting "0 tests" with no named
  // failure. A first attempt moved the lookup into `beforeAll` -- better (the rendered
  // block above now runs), but a `beforeAll` throw marks every test in ITS OWN block as
  // SKIPPED, still not a named failure. So `getFade()` below is called from INSIDE each
  // `it()` that needs it: a throw there fails only THAT test, by name, and every test
  // still gets its own pass/fail line.
  let css, jsx
  beforeAll(() => {
    css = readFileSync(join(DIR, 'NoteBoardView.module.css'), 'utf8')
    jsx = readFileSync(join(DIR, 'NoteBoardView.jsx'), 'utf8')
  })
  const getFade = () => ruleFrom(css, FADE_SELECTOR)

  it('is a MASK, cross-browser (prefixed + unprefixed), not a background overlay', () => {
    const fade = getFade()
    expect(fade['mask-image']).toBeTruthy()
    expect(fade['-webkit-mask-image']).toBeTruthy()
    // A colour-matched overlay would need a `background`/`background-color` literal that
    // drifts the moment a new theme is added -- a mask never needs one. If this rule ever
    // grows a background declaration, the reasoning in its own comment no longer holds.
    expect(fade.background).toBeUndefined()
    expect(fade['background-color']).toBeUndefined()
  })

  it('non-vacuity: the mask fades TOWARD the scroll direction (transparent on the right)', () => {
    const fade = getFade()
    // `linear-gradient(to right, ...)` with the transparent stop LAST is what hides the
    // right edge while the strong (#000 => fully painted) stop leads -- the reverse would
    // fade the LEFT edge instead, which is not what D-5 asked for.
    expect(fade['mask-image']).toMatch(/^linear-gradient\(to right,/)
    expect(fade['mask-image']).toMatch(/transparent\)\s*$/)
  })

  it('no transition on the swap -- there is no motion to gate behind prefers-reduced-motion', () => {
    expect(getFade().transition).toBeUndefined()
  })

  it('non-vacuity: the attribute is on the SAME node the mask selector targets (.columns)', () => {
    getFade() // still resolvable -- keeps this test's failure mode specific to ITS OWN assertions
    const code = stripComments(jsx)
    const openTagStart = code.indexOf('ref={setColumnsEl}')
    expect(openTagStart, 'the scroller ref is rendered').toBeGreaterThan(-1)
    const openTagEnd = code.indexOf('>', openTagStart)
    const openTag = code.slice(openTagStart, openTagEnd)
    expect(openTag).toContain('data-board-scroll-more')
    // ⛔ `className={styles.columns}` -- UNCHANGED, byte-for-byte, from before this
    // lane. NoteBoardView.scrollsAlone.test.js finds the row by this EXACT substring
    // (`code.indexOf('className={styles.columns}')`); a template string or a second
    // class here would silently break that rail's own non-vacuity check without
    // reducing anything the mask needs -- the attribute selector above is what lets
    // the fade live WITHOUT touching this string at all.
    expect(openTag).toContain('className={styles.columns}')
  })

  it('control: an overlay-div idiom would need a background colour and is NOT what this rule does', () => {
    const overlay = ruleFrom(
      '.overlayFade { position: absolute; right: 0; background: linear-gradient(to right, transparent, #111); }',
      '.overlayFade',
    )
    expect(overlay['mask-image']).toBeUndefined()
    expect(overlay.background).toBeTruthy()
  })

  // D5 fix round 1 (M4), re-worded round 2 (F4): the token is declared exactly once, and
  // neither scroll-padding nor the mask restates a literal. A column scrolled into view
  // (keyboard, scrollIntoView) must not land directly under the fade, dimmed at the exact
  // moment it's the thing being shown -- scroll-padding-inline-end and the mask's own width
  // share ONE custom property so they can never drift apart.
  it('the token is declared exactly once, and neither scroll-padding nor the mask restates a literal', () => {
    const fade = getFade()
    const base = ruleFrom(css, '.columns')
    expect(base['scroll-padding-inline-end']).toBe('var(--board-fade-w)')
    expect(fade['mask-image']).toContain('var(--board-fade-w)')
    expect(fade['-webkit-mask-image']).toContain('var(--board-fade-w)')
    const literalPxWidths = css.match(/--board-fade-w:\s*[\d.]+px/g) || []
    expect(literalPxWidths).toHaveLength(1)
  })
})

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
import { describe, it, expect, vi } from 'vitest'
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

// STATUS has 3 options + "No value" -- 4 columns, matching NoteBoardView.test.jsx's own
// fixture. Each rendered column is 300 "px" under the mock below.
const COLS = 4

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
    withScrollMetrics(COLS * 300, 2000, () => {
      renderBoard()
      expect(cue()).toBe('false')
    })
  })

  it('is PRESENT at rest when the row overflows (scrollLeft 0, more columns to the right)', () => {
    withScrollMetrics(COLS * 300, 700, () => {
      renderBoard()
      expect(cue()).toBe('true')
    })
  })

  it('HIDES once scrolled to the end -- nothing more sits past the visible edge', async () => {
    withScrollMetrics(COLS * 300, 700, () => {
      renderBoard()
      expect(cue()).toBe('true')
      const el = scroller()
      // max = scrollWidth - clientWidth = 1200 - 700 = 500
      Object.defineProperty(el, 'scrollLeft', { value: 500, configurable: true })
      fireEvent.scroll(el)
      expect(cue()).toBe('false')
    })
  })

  it('REAPPEARS if scrolled back from the end', () => {
    withScrollMetrics(COLS * 300, 700, () => {
      renderBoard()
      const el = scroller()
      Object.defineProperty(el, 'scrollLeft', { value: 500, configurable: true })
      fireEvent.scroll(el)
      expect(cue()).toBe('false')
      Object.defineProperty(el, 'scrollLeft', { value: 120, configurable: true })
      fireEvent.scroll(el)
      expect(cue()).toBe('true')
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

  it('control: unmounting the board tears the cue state down with it (no leaked listener state)', () => {
    withScrollMetrics(COLS * 300, 700, () => {
      const { unmount } = renderBoard()
      expect(cue()).toBe('true')
      expect(() => unmount()).not.toThrow()
      expect(scroller()).toBeNull()
    })
  })
})

describe('the board scroll cue -- CSS/structural (NoteBoardView.module.css [data-board-scroll-more])', () => {
  const DIR = join(process.cwd(), 'src', 'pages', 'journal-2-0', 'components', 'notebook')
  const css = readFileSync(join(DIR, 'NoteBoardView.module.css'), 'utf8')
  const jsx = readFileSync(join(DIR, 'NoteBoardView.jsx'), 'utf8')
  const FADE_SELECTOR = '.columns[data-board-scroll-more="true"]'

  const rule = (text, selector) => {
    const r = parseRules(text).find((x) => x.selector === selector)
    if (!r) throw new Error(`${selector} not found`)
    return Object.fromEntries(declarations(r).map((d) => [d.prop, d.value]))
  }
  const fade = rule(css, FADE_SELECTOR)

  it('is a MASK, cross-browser (prefixed + unprefixed), not a background overlay', () => {
    expect(fade['mask-image']).toBeTruthy()
    expect(fade['-webkit-mask-image']).toBeTruthy()
    // A colour-matched overlay would need a `background`/`background-color` literal that
    // drifts the moment a new theme is added -- a mask never needs one. If this rule ever
    // grows a background declaration, the reasoning in its own comment no longer holds.
    expect(fade.background).toBeUndefined()
    expect(fade['background-color']).toBeUndefined()
  })

  it('non-vacuity: the mask fades TOWARD the scroll direction (transparent on the right)', () => {
    // `linear-gradient(to right, ...)` with the transparent stop LAST is what hides the
    // right edge while the strong (#000 => fully painted) stop leads -- the reverse would
    // fade the LEFT edge instead, which is not what D-5 asked for.
    expect(fade['mask-image']).toMatch(/^linear-gradient\(to right,/)
    expect(fade['mask-image']).toMatch(/transparent\)\s*$/)
  })

  it('no transition on the swap -- there is no motion to gate behind prefers-reduced-motion', () => {
    expect(fade.transition).toBeUndefined()
  })

  it('non-vacuity: the attribute is on the SAME node the mask selector targets (.columns)', () => {
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
    const overlay = rule(
      '.overlayFade { position: absolute; right: 0; background: linear-gradient(to right, transparent, #111); }',
      '.overlayFade',
    )
    expect(overlay['mask-image']).toBeUndefined()
    expect(overlay.background).toBeTruthy()
  })
})

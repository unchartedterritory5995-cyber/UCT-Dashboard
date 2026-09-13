/**
 * G3-15 — the mode chip clears the Actions button, in both hands, and the ceiling moves with it.
 *
 * ⚰️ WHAT THIS EXISTS BECAUSE OF. On 2026-09-12 a real iPhone 15 Pro / iOS 17.6 measured the two
 * boxes against production and found them overlapping by **40 x 28 px on every mode** — screener,
 * wire, breadth, dashboard and calendar all returned exactly 40, because the chip is anchored by
 * its RIGHT edge and grows leftward, so its right edge sat at a fixed 118 while the Actions button
 * owned right-offsets [114, 158]. Both carry `z-index: 360` and the button is later in the DOM, so
 * `elementFromPoint` inside the band returned the button's `<svg>`: it painted AND hit-tested over
 * the chip's last 40px, on every mode, at every label length, since the button shipped.
 *
 * ⛔ THE ARITHMETIC THAT COULD HAVE CAUGHT IT ALREADY EXISTED. `feedbackIsOneTap.test.jsx` had
 * `boxOf`/`overlaps` and a rule that treats an auto-width element as extending inward without
 * limit — under which chip [118, ∞) and button [114, 158] overlap on the first evaluation. It was
 * pointed only at the feedback button. That is `lesson_a_guard_that_tests_the_adjacent_thing` in
 * its purest form, and the remedy is not a second copy of the arithmetic here: both files now
 * import `__tests__/restBoxes.js` and point it at the pair each one cares about.
 *
 * ⚠️ jsdom performs no layout, so every box below is the DECLARED inline style, `env()` read as 0.
 * The real-glass counterpart is `tools/hub_chip_clearance.py`, which sweeps `elementFromPoint`
 * across the chip on every mode at 360/375/430 in a browser that actually lays out.
 */
import { describe, it as vitestIt, expect, afterAll, vi, beforeEach, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { AuthContext } from '../context/AuthContext'
import HubChip from './HubChip'
import { boxOf, overlaps, sumPx } from './__tests__/restBoxes'

let definedCount = 0
let executedCount = 0
function it(name, fn) {
  definedCount += 1
  return vitestIt(name, (...args) => { executedCount += 1; return fn(...args) })
}
// A `vitest -t` filter that matches nothing exits 0 and looks exactly like a real green run
// (`lesson_a_green_suite_can_hide_a_layout_regression`). This fails loudly instead.
afterAll(() => {
  expect(executedCount).toBeGreaterThan(0)
  expect(executedCount).toBe(definedCount)
})

let mockPrefs = {}
vi.mock('../hooks/usePreferences', () => ({
  default: () => ({ prefs: mockPrefs, setPrefMerged: vi.fn(), loading: false }),
  parsePref: (raw) => {
    if (raw == null) return undefined
    if (typeof raw !== 'string') return raw
    try { return JSON.parse(raw) } catch { return undefined }
  },
}))
const { default: HubRoot } = await import('./HubRoot.jsx')

const HERE = path.dirname(fileURLToPath(import.meta.url))

// ── capability stubs (the idiom every hub mount test uses) ───────────────────
const realVisualViewport = Object.getOwnPropertyDescriptor(window, 'visualViewport')
function stubCapable(viewportWidth) {
  globalThis.CSS = { supports: () => true }
  window.visualViewport = {
    width: viewportWidth, height: 812, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }
  window.matchMedia = vi.fn().mockImplementation((q) => ({
    matches: /max-width:\s*1023px/.test(q),
    media: q,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }))
}
beforeEach(() => { mockPrefs = {}; stubCapable(393) })
afterEach(() => {
  vi.restoreAllMocks()
  delete globalThis.CSS
  if (realVisualViewport) Object.defineProperty(window, 'visualViewport', realVisualViewport)
  else delete window.visualViewport
})

function renderHub({ handedness = 'right', route = '/screener' } = {}) {
  mockPrefs = { joystick_hub: JSON.stringify({ enabled: true, coachMarkSeen: true, handedness }) }
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AuthContext.Provider value={{ user: { role: 'admin' }, plan: 'pro', trial: null, isPaid: true }}>
        <HubRoot />
      </AuthContext.Provider>
    </MemoryRouter>,
  )
}

/** The chip and the Actions button, as rest boxes, from a live hub render. */
function pair(container) {
  const chipEl = container.querySelector('[data-testid="hub-chip"]')
  const btnEl = [...container.querySelectorAll('button[aria-label]')]
    .find((b) => /actions$/i.test(b.getAttribute('aria-label')))
  // CONTROL: a missing element makes "they do not overlap" true and meaningless.
  expect(chipEl, 'the hub chip did not render — this rail would pass by measuring nothing').toBeTruthy()
  expect(btnEl, 'the Actions button did not render — this rail would pass by measuring nothing').toBeTruthy()
  return { chipEl, btnEl, chip: boxOf(chipEl), btn: boxOf(btnEl) }
}

// ── the fix ──────────────────────────────────────────────────────────────────
describe('⛔ G3-15 — the chip does not sit under the Actions button', () => {
  for (const handedness of ['right', 'left']) {
    // Both boxes are anchored purely by an edge offset, so this arithmetic never reads the
    // viewport width — the three widths are asserted anyway, as the same tripwire
    // `hubChipCollision.test.js` keeps: the day either box is repositioned onto `left`/`top`,
    // these cases stop being redundant and whoever did it has to plug the real width in here.
    for (const viewportWidth of [360, 375, 430]) {
      it(`${handedness}-handed, ${viewportWidth}px viewport: the two rest boxes do not intersect`, () => {
        stubCapable(viewportWidth)
        const { chip, btn } = pair(renderHub({ handedness }).container)
        expect(
          overlaps(chip, btn),
          `chip [${chip.x0}, ${chip.x1}] and Actions button [${btn.x0}, ${btn.x1}] intersect. `
          + 'The chip is auto-width and extends inward without limit, so the only guarantee here is '
          + "its ANCHOR — move the chip's anchor, never the assumption.",
        ).toBe(false)
      })
    }
  }

  it('the gap is the button\'s own measured width plus the clearance, not a typed number', () => {
    const { chip, btn } = pair(renderHub().container)
    const buttonWidth = btn.x1 - btn.x0
    // The button reports its rendered width; jsdom lays nothing out, so it falls back to its own
    // declared `MIN_TAP_PX` floor — which is why this compares against the BOX rather than 44.
    expect(buttonWidth).toBeGreaterThanOrEqual(44)
    // The chip's right edge now sits beyond the button's inner edge, with room to spare. 8px is
    // what the ruling's "+4" produces once the chip's pre-existing 4px inset is counted, and it
    // is width-INDEPENDENT: both terms carry `buttonWidth`, so it cancels.
    expect(chip.x0 - btn.x1).toBe(8)
  })
})

// ── the control: the component produces the pre-fix geometry on demand, and it DOES overlap ──
describe('⭐ mutation control — the rail can still fail', () => {
  it('with no Actions button reported (actionsWidthPx = 0) the chip lands back under it', () => {
    // ⛔ NOT arithmetic in the test. This is `HubChip` rendering its own "no button to clear"
    // branch, which is exactly the geometry that shipped before the fix — so the control proves
    // three things at once: the rail can go red, the fix is what moved the chip, and the
    // `actionsWidthPx = 0` branch is the pre-fix anchor rather than something new.
    const { btn } = pair(renderHub().container)
    const { container } = render(<HubChip label="Screener" tapHint="tap: next result" actionsWidthPx={0} />)
    const preFix = boxOf(container.querySelector('[data-testid="hub-chip"]'))
    expect(preFix.x0, 'the no-button branch is not the pre-fix anchor any more').toBe(118)
    expect(
      overlaps(preFix, btn),
      'the pre-fix chip anchor no longer overlaps the Actions button, so this control proves '
      + 'nothing and the rail above may be passing for the wrong reason',
    ).toBe(true)
  })
})

// ── the other half of the ruling: truncation, at the REDUCED width ───────────
describe('the chip keeps a ceiling, and it moves with the anchor', () => {
  it('declares a max-width derived from its own anchor, in both hands', () => {
    for (const handedness of ['right', 'left']) {
      const { chipEl, chip } = pair(renderHub({ handedness }).container)
      const ceiling = chipEl.style.maxWidth
      expect(ceiling, `${handedness}-handed: the chip declares no ceiling, so a long label runs `
        + 'off the far edge — which the anchor move makes happen 48px sooner').toBeTruthy()
      // Derived, not typed: the subtrahend is the chip's own inset plus the far gutter.
      expect(sumPx(ceiling)).toBeGreaterThan(chip.x0)
    }
  })

  it('a wider Actions button tightens the ceiling by exactly as much as it moves the anchor', () => {
    // The relationship is what matters, not either number: whatever the button measures, the chip
    // gives up exactly that much room. A hand-typed ceiling would drift the first time the button
    // rendered wider (Dynamic Type, a different icon).
    const read = (px) => {
      const { container } = render(<HubChip label="Screener" tapHint="tap: next result" actionsWidthPx={px} />)
      const el = container.querySelector('[data-testid="hub-chip"]')
      return { anchor: sumPx(el.style.right), ceiling: sumPx(el.style.maxWidth) }
    }
    const narrow = read(44)
    const wide = read(60)
    expect(wide.anchor - narrow.anchor).toBe(16)
    expect(wide.ceiling - narrow.ceiling).toBe(16)
  })

  it('the mode label is the part that never yields — the hint is', () => {
    // The stylesheet owns this half; assert the declarations rather than a rendered box, since
    // jsdom resolves no flex layout. `.chipMode` must not shrink, `.chipHint` must be able to.
    const css = readFileSync(path.join(HERE, 'hub.module.css'), 'utf8')
    const block = (sel) => {
      const at = css.indexOf(`${sel} {`)
      expect(at, `${sel} not found in hub.module.css`).toBeGreaterThan(-1)
      return css.slice(at, css.indexOf('}', at))
    }
    expect(block('.chip')).toMatch(/overflow:\s*hidden/)
    expect(block('.chipMode')).toMatch(/flex:\s*0\s+0\s+auto/)
    expect(block('.chipHint')).toMatch(/text-overflow:\s*ellipsis/)
    expect(block('.chipHint')).toMatch(/min-width:\s*0/)
  })
})

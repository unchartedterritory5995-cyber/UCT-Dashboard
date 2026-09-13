// ⛔⛔ THE TABLET CASE, IN THE UNITS THE BUG LIVED IN.
//
// `Dashboard.heroMount.test.jsx` (shipped with the navigation-freeze fix) proves the rule by
// BRANCH: hide the mobile subtree and the desktop copy owns the hub, hide the desktop subtree and
// the mobile copy does. That is correct and it is not quite the thing that broke.
//
// What broke was a WIDTH. The old rule was "the mobile copy owns it", and `Dashboard.module.css`
// hides `.mobileOnly` by DEFAULT — it is only shown inside `@media (max-width: 640px)`. So at any
// width above 640 the visible branch is the DESKTOP one, and the hub was handed to a
// `display: none` tree. On a 641–1024px tablet — a coarse-pointer device, i.e. exactly the
// population the hub exists for — the joystick addressed a tile nobody could see.
//
// ⭐ THE BOUNDARY IS READ FROM THE STYLESHEET, NOT TYPED. A hand-written 640 here would be a
// second authority over the same number, which is the defect this repo keeps re-finding. The
// media query is parsed out of `Dashboard.module.css`, and cross-checked against the canonical
// `BP.phone` — so if the stylesheet and `styles/breakpoints.js` ever disagree, THAT fails here
// rather than silently changing which branch this file thinks is visible.
import { describe, it as vitestIt, expect, vi, afterEach, afterAll } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { BP } from '../styles/breakpoints'

let defined = 0
let executed = 0
function it(name, fn) {
  defined += 1
  return vitestIt(name, (...a) => { executed += 1; return fn(...a) })
}
it.each = (rows) => (name, fn) => {
  defined += rows.length
  return vitestIt.each(rows)(name, (...a) => { executed += 1; return fn(...a) })
}
afterAll(() => {
  expect(executed).toBeGreaterThan(0)
  expect(executed).toBe(defined)
})

vi.mock('swr', () => ({
  default: () => ({ data: undefined, error: undefined, isLoading: false, mutate: () => {} }),
  useSWRConfig: () => ({ mutate: () => {} }),
}))
vi.mock('./dashboard/useSessionState', () => ({
  default: () => 'LIVE',
  resolveSession: () => 'LIVE',
  nextBoundary: () => ({ kind: 'close', ms: 0 }),
  formatCountdown: () => '0m',
  useNextBoundary: () => ({ kind: 'close', ms: 0, label: 'Closes in 0m', holidayToday: false }),
}))
vi.mock('./dashboard/TheWeek', () => ({ default: () => <div>THE WEEK</div> }))
vi.mock('../components/tiles/CatalystTable', () => ({
  default: ({ hubScope }) => <div data-hero data-owns={String(!!hubScope)}>CATALYSTS</div>,
}))

afterEach(cleanup)

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CSS = readFileSync(path.join(HERE, 'Dashboard.module.css'), 'utf8')

/** The width at or below which the stylesheet hides `.desktopOnly` — parsed, never typed.
 *
 * ⚰️ THE FIRST VERSION OF THIS FUNCTION WAS WRONG AND THE CONTROLS BELOW CAUGHT IT. It used one
 * regex with a lazy `[\s\S]*?` between the `@media` opener and the declaration, which happily
 * spanned a BLOCK BOUNDARY: `Dashboard.module.css` nests the 640px query inside a 1024px one, so
 * it reported the ceiling as 1024. Every width case then "passed" while asserting that the MOBILE
 * branch owns the hub at 800px and 1024px — which is the exact defect this file exists to pin. A
 * rail that derives the wrong number is worse than one that hardcodes it, because it looks
 * principled. The cross-check against `BP.phone` is what made it visible.
 *
 * So the scan is line-oriented and tracks the INNERMOST open `@media (max-width: N)` instead. */
function phoneCeilingFromStylesheet() {
  const lines = CSS.split(/\r?\n/)
  const open = []           // stack of max-widths for the media blocks currently open
  let depth = 0
  const found = []
  for (const line of lines) {
    const m = /@media\s*\([^)]*max-width:\s*(\d+)px/.exec(line)
    if (m) open.push({ width: Number(m[1]), at: depth })
    if (/\.desktopOnly\s*\{[^}]*display:\s*none/.test(line) && open.length) {
      found.push(open[open.length - 1].width)
    }
    depth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length
    while (open.length && depth <= open[open.length - 1].at) open.pop()
  }
  if (found.length !== 1) {
    throw new Error(`expected exactly ONE media rule hiding .desktopOnly, found ${found.length}`)
  }
  return found[0]
}
const PHONE_CEILING = phoneCeilingFromStylesheet()

/** Which branch the stylesheet shows at `w`. Derived from the rule above, not from a tier name. */
const visibleBranchAt = (w) => (w <= PHONE_CEILING ? 'mobileOnly' : 'desktopOnly')

async function renderAtWidth(w) {
  const { default: Dashboard } = await import('./Dashboard')
  const r = render(<MemoryRouter><Dashboard /></MemoryRouter>)
  // jsdom applies no CSS, so BOTH branches are "displayed" until we impose the stylesheet's
  // verdict. Hiding the branch the real stylesheet would hide at this width is the whole fixture.
  const hidden = visibleBranchAt(w) === 'mobileOnly' ? 'desktopOnly' : 'mobileOnly'
  const el = document.querySelector(`[class*="${hidden}"]`)
  expect(el, `neither branch found at ${w}px — the Dashboard markup changed`).not.toBeNull()
  act(() => {
    el.style.display = 'none'
    window.dispatchEvent(new Event('resize'))
  })
  return r
}

const heroes = () => Array.from(document.querySelectorAll('[data-hero]'))
const owners = () => heroes().filter((h) => h.getAttribute('data-owns') === 'true')

describe('the stylesheet and the canonical breakpoints agree', () => {
  it('⛔ the phone ceiling is read from Dashboard.module.css and matches BP.phone', () => {
    expect(PHONE_CEILING, 'the media rule that hides .desktopOnly was not found or is ambiguous — '
      + 'this file can no longer tell which branch is visible at a width').toBeGreaterThan(0)
    expect(PHONE_CEILING, `Dashboard.module.css hides .desktopOnly at ${PHONE_CEILING}px while `
      + `styles/breakpoints.js says the phone tier ends at ${BP.phone}px. Two authorities over one `
      + 'boundary; fix the stylesheet or the constant, do not paper over it here.').toBe(BP.phone)
  })

  it('CONTROL: the derivation really discriminates — it does not answer the same at every width', () => {
    expect(visibleBranchAt(393)).toBe('mobileOnly')
    expect(visibleBranchAt(BP.phone + 1)).toBe('desktopOnly')
    expect(new Set([visibleBranchAt(393), visibleBranchAt(800)]).size,
      'the width→branch map returns one answer for every width — the fixture proves nothing').toBe(2)
  })
})

describe('⛔⛔ one hero, owned by the VISIBLE branch, at every width', () => {
  // 393 phone · 800 tablet · 1024 the tablet CEILING — the last width before desktop, and the one
  // most likely to be assumed to behave like a phone. All three were broken by "the mobile copy
  // owns it"; the two tablet widths are the ones that reached real coarse-pointer devices.
  it.each([[393], [800], [1024]])('%ipx: exactly one hero, and it owns the hub', async (w) => {
    await renderAtWidth(w)
    const branch = visibleBranchAt(w)

    expect(heroes().length, `${w}px: ${heroes().length} heroes are mounted. The hidden branch is `
      + 'still rendering one, so two live tiles poll, subscribe and register on every visit.').toBe(1)

    expect(heroes()[0].closest(`[class*="${branch}"]`),
      `${w}px: the surviving hero is not in the ${branch} branch, which is the one the stylesheet `
      + 'actually shows at this width').not.toBeNull()

    expect(owners().length, `${w}px: ${owners().length} copies claim the hub`).toBe(1)
    expect(owners()[0].closest(`[class*="${branch}"]`),
      `${w}px: the hub is owned by a copy the stylesheet HIDES at this width. This is the tablet `
      + 'defect exactly: 641–1024px shows the desktop branch, and "the mobile copy owns it" handed '
      + 'the joystick to a display:none tree on every tablet — a coarse-pointer device, i.e. the '
      + 'population the hub exists for.').not.toBeNull()
  })
})

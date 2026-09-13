// Left/right mirroring moves the pad, the fan quadrant and the chip AS A UNIT — spec §C2:769.
//
// ── THE GAP THIS FILLS ─────────────────────────────────────────────────────────────────────────
// Exactly one assertion covered mirroring before this file: `hubComponents.test.jsx:249` renders
// `<HubPad mirrored />` on its own and checks that it moved. Seven hub components take a
// `mirrored` prop. Six of them had nothing.
//
// ⛔⛔ AND THE DEFECT THIS EXISTS FOR IS IN NONE OF THEM. Every one of those components mirrors
// correctly in isolation, and a per-component test proves exactly that and no more. The failure
// that ships is in the COMPOSITION: `HubRoot` computes `mirrored` once (`HubRoot.jsx:83`) and
// hands it down seven separate times. Drop ONE of those `mirrored={mirrored}` attributes and a
// left-handed member gets the pad, the fan and the knob on the left with the chip stranded on the
// right — while every component test stays green, because every component is still correct.
//
// That is `lesson_a_projection_drops_what_it_does_not_name` wearing a JSX prop, and it is
// invisible in review for the same reason: the diff that breaks it is a deletion.
//
// ── TWO INDEPENDENT HALVES, AND NEITHER SUBSUMES THE OTHER ─────────────────────────────────────
//   1. BEHAVIOURAL, through a real `HubRoot` render: every element that anchors itself to a screen
//      edge anchors to the SAME edge, in both handedness settings. This is the spec sentence
//      stated as a property rather than as seven separate facts.
//   2. STRUCTURAL, from source: the mirror-aware set is DERIVED (never typed), and `HubRoot` must
//      pass `mirrored` to every member of it that it renders — so a component added tomorrow is
//      covered the day it lands, and fails BY NAME instead of by a count going stale.
//
// (1) cannot see a component `HubRoot` does not render in this fixture; (2) cannot see a component
// that takes the prop and ignores it. Keep both.
//
// ⚠️ WHAT THIS CANNOT PROVE: jsdom performs no layout, so nothing here says the chip is visually
// clear of the pad on a real phone. It reads the DECLARED anchor — which is the half that
// regresses silently. The device matrix owns the other half.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

import { AuthContext } from '../context/AuthContext'

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

const HUB = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))

// ── capability stubs: an unstubbed jsdom looks exactly like a browser too old for the hub ───────
const realVisualViewport = Object.getOwnPropertyDescriptor(window, 'visualViewport')

function stubCapable() {
  globalThis.CSS = { supports: () => true }
  window.visualViewport = {
    width: 375, height: 812, addEventListener: vi.fn(), removeEventListener: vi.fn(),
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

beforeEach(() => { mockPrefs = {}; stubCapable() })
afterEach(() => {
  vi.restoreAllMocks()
  delete globalThis.CSS
  if (realVisualViewport) Object.defineProperty(window, 'visualViewport', realVisualViewport)
  else delete window.visualViewport
})

/** Render the real hub for an admin, in the requested handedness. */
function renderHanded(handedness) {
  mockPrefs = { joystick_hub: JSON.stringify({ enabled: true, coachMarkSeen: true, handedness }) }
  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <AuthContext.Provider value={{ user: { role: 'admin' }, plan: 'pro', trial: null, isPaid: true }}>
        <HubRoot />
      </AuthContext.Provider>
    </MemoryRouter>,
  )
}

/** A short human name for an element, for failure messages. */
const describeEl = (el) =>
  el.getAttribute('data-testid') || `<${el.tagName.toLowerCase()} class="${el.className}">`

/**
 * Every element under `root` that pins itself to ONE horizontal edge, and which edge.
 *
 * ⭐ `left: auto` is how a mirrored component RELEASES the edge it is not using (HubToastHost and
 * HubCoachMark both set the unused side to `'auto'` explicitly), so `auto` must read as "not
 * anchored here" rather than as an anchor — otherwise those two report BOTH sides and quietly
 * drop out of the unit check below.
 *
 * An element pinned to both edges is SPANNING (a full-bleed overlay), not anchored, and is
 * excluded — but reported separately, so a component that starts spanning by accident cannot
 * disappear from this rail's view instead of failing it.
 */
function anchors(root) {
  const anchored = []
  const spanning = []
  root.querySelectorAll('*').forEach((el) => {
    const l = el.style?.left
    const r = el.style?.right
    const hasL = !!l && l !== 'auto'
    const hasR = !!r && r !== 'auto'
    if (hasL && hasR) spanning.push(describeEl(el))
    else if (hasL) anchored.push({ name: describeEl(el), side: 'left' })
    else if (hasR) anchored.push({ name: describeEl(el), side: 'right' })
  })
  return { anchored, spanning }
}

describe('mirroring moves the hub as a unit (§C2:769)', () => {
  it('non-vacuity — the hub renders, and enough of it anchors to an edge to mean something', () => {
    // If HubRoot rendered nothing (a stub that drifted, a mount gate that changed), every
    // "all sides agree" assertion below would pass over an EMPTY set. `[]` satisfies "every
    // element agrees" perfectly.
    const { container } = renderHanded('right')
    expect(container.querySelector('[data-testid="hub-root"]'), 'the hub did not mount, so every '
      + 'assertion in this file is vacuous').toBeTruthy()

    const { anchored } = anchors(container)
    const names = anchored.map((a) => a.name)
    // Named members, not a count — a count goes stale the day a bubble is added.
    for (const required of ['hub-pad', 'hub-fan-wedge', 'hub-chip']) {
      expect(names, `${required} is not edge-anchored, so the spec's own three-part sentence `
        + '("the pad, the fan quadrant and the chip") is not being measured here')
        .toContain(required)
    }
    expect(anchored.length).toBeGreaterThan(3)
  })

  it('⛔ RIGHT-HANDED: every edge-anchored element is on the RIGHT', () => {
    const { container } = renderHanded('right')
    const { anchored } = anchors(container)
    const strays = anchored.filter((a) => a.side !== 'right').map((a) => a.name)
    expect(strays, 'these hub elements anchored to the LEFT edge while the member is right-handed')
      .toEqual([])
  })

  it('⛔⛔ LEFT-HANDED: every edge-anchored element moves TOGETHER — none left behind', () => {
    const { container } = renderHanded('left')
    const { anchored } = anchors(container)
    const strays = anchored.filter((a) => a.side !== 'left').map((a) => a.name)
    expect(strays, 'A left-handed member has these hub elements stranded on the RIGHT edge while '
      + 'the rest of the hub moved left. §C2:769: "Left/right mirroring moves the pad, the fan '
      + 'quadrant and the chip as a unit."\n'
      + '⭐ The likely cause is NOT inside the component named above — it is a dropped '
      + '`mirrored={mirrored}` on that element in HubRoot.jsx. Every component mirrors correctly '
      + 'on its own; the composition is what loses one.')
      .toEqual([])
  })

  it('⛔ THE CONTROL: the two renders genuinely DIFFER — mirroring is not a no-op', () => {
    // Without this, a build where `mirrored` never reached anything would pass BOTH assertions
    // above: every element would sit on the right in both renders, unanimously and wrongly.
    const right = anchors(renderHanded('right').container)
    const left = anchors(renderHanded('left').container)
    expect(right.anchored.every((a) => a.side === 'right')).toBe(true)
    expect(left.anchored.every((a) => a.side === 'left')).toBe(true)
    expect(left.anchored.length, 'the two renders anchor different numbers of elements, so they '
      + 'are not the same hub and the comparison proves nothing').toBe(right.anchored.length)
  })

  it('nothing in the hub spans both edges unnoticed', () => {
    // Not a failure by itself — a full-bleed overlay is legitimate. But a component that starts
    // spanning silently LEAVES the unit check above, so the set is pinned rather than ignored.
    const { spanning } = anchors(renderHanded('left').container)
    expect(spanning, 'a hub element now pins BOTH edges. If that is deliberate it is invisible to '
      + 'the mirroring rail above — say so here on purpose.').toEqual([])
  })
})

// ───────────────────────────────────────────────────────────────────────────────────────────────
// THE STRUCTURAL HALF — derived from source, so tomorrow's component is covered today.
// ───────────────────────────────────────────────────────────────────────────────────────────────

const stripComments = (t) => t
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')

/**
 * The opening tag of `<Name ...>` in `src`, brace-aware.
 *
 * ⭐ A plain `/<Name[^>]*>/` is wrong on JSX and fails in the flattering direction: an arrow
 * function in ANY attribute (`onDismiss={() => x}`) contains a `>`, so the match ends early, the
 * `mirrored` attribute falls outside it, and the rail reports a prop missing that is right there.
 * Scanning to the first `>` at brace-depth zero is the honest read.
 */
function openingTag(src, name) {
  const at = src.search(new RegExp(`<${name}\\b`))
  if (at < 0) return null
  let depth = 0
  for (let i = at; i < src.length; i += 1) {
    const c = src[i]
    if (c === '{') depth += 1
    else if (c === '}') depth -= 1
    else if (c === '>' && depth === 0) return src.slice(at, i + 1)
  }
  return null
}

const HUB_FILES = readdirSync(HUB)
  .filter((f) => /^Hub.*\.jsx$/.test(f) && !/\.test\.jsx$/.test(f))

/** A component is mirror-aware if it DECLARES the prop — never merely mentions the word. */
const MIRROR_AWARE = HUB_FILES
  .filter((f) => /\bmirrored\s*=\s*false\b/.test(stripComments(readFileSync(path.join(HUB, f), 'utf8'))))
  .map((f) => f.replace(/\.jsx$/, ''))
  .sort()

const ROOT_SRC = stripComments(readFileSync(path.join(HUB, 'HubRoot.jsx'), 'utf8'))

describe('HubRoot hands `mirrored` to every component that takes one', () => {
  it('non-vacuity — the derivation found real components, including the three the spec names', () => {
    // A derivation that returns [] passes every "for each" below without looking at anything.
    for (const required of ['HubPad', 'HubFan', 'HubChip']) {
      expect(MIRROR_AWARE, `${required} is not in the derived mirror-aware set — the detector is `
        + 'broken, not the product').toContain(required)
    }
    expect(MIRROR_AWARE.length).toBeGreaterThan(4)
  })

  it('⛔ THE CONTROL: the word alone is not a declaration, and the tag scan survives an arrow fn', () => {
    // Hub files write prose about mirroring constantly — HubContext.jsx alone says "mirrors React
    // state" and "mirroring `pathname`". A substring scan for the word reports those files as
    // mirror-aware components and drags files with no such prop into the requirement below.
    const prose = '// this mirrors React state OUT to storage, and `mirrored` is discussed here'
    expect(prose.includes('mirrored'), 'the fixture must contain the word or it shows nothing').toBe(true)
    expect(/\bmirrored\s*=\s*false\b/.test(stripComments(prose)), 'a COMMENT mentioning the prop '
      + 'must not read as a declaration').toBe(false)
    expect(/\bmirrored\s*=\s*false\b/.test('  mirrored = false,'), 'a real declaration must be '
      + 'detected, or the requirement below can never bind').toBe(true)

    // And the tag scanner: an arrow function in an earlier attribute must not truncate the tag.
    const tricky = '<HubThing onPick={() => go()} mirrored={mirrored} />'
    expect(openingTag(tricky, 'HubThing'), 'the brace-aware scan lost the attribute after an arrow '
      + 'function — the naive [^>]* bug').toContain('mirrored={mirrored}')

    // The detector must be able to report a MISSING prop, or it can never fail.
    const missing = '<HubThing onPick={() => go()} disabledIds={ids} />'
    expect(openingTag(missing, 'HubThing')).not.toContain('mirrored=')
  })

  it('⛔⛔ every mirror-aware component HubRoot renders is passed `mirrored`', () => {
    const rendered = MIRROR_AWARE.filter((name) => openingTag(ROOT_SRC, name) !== null)
    expect(rendered.length, 'HubRoot renders none of the mirror-aware components, so this '
      + 'assertion is vacuous').toBeGreaterThan(4)

    const dropped = rendered.filter((name) => !/mirrored=\{mirrored\}/.test(openingTag(ROOT_SRC, name)))
    expect(dropped, 'HubRoot renders these mirror-aware components WITHOUT passing `mirrored`. A '
      + 'left-handed member gets them stranded on the right edge while the rest of the hub moves.\n'
      + 'This is a one-attribute deletion and it breaks no component test, because every component '
      + 'is still individually correct — the composition is what drops it.')
      .toEqual([])
  })

  it('a mirror-aware component HubRoot does NOT render is named, not silently excused', () => {
    // Not a failure: a component can legitimately be rendered elsewhere. But "HubRoot does not
    // render it" is exactly how a real omission would look to the assertion above, so the set is
    // pinned. If this list grows, decide deliberately which case it is.
    const notRendered = MIRROR_AWARE.filter((name) => openingTag(ROOT_SRC, name) === null)
    expect(notRendered, 'a mirror-aware component left HubRoot\'s tree — confirm it is rendered '
      + 'somewhere that also passes `mirrored`, then update this list').toEqual([])
  })
})

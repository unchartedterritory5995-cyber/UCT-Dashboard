// app/src/pages/journal-2-0/a11y/axeHarness.contract.test.js
//
// The harness's own contract (wave 8, lane 8A, A0). Three things, each of which
// would otherwise fail SILENTLY:
//   (a) the exclusion list is exactly the ruled set (D-A5) — a growing list is
//       a mute button, and nothing downstream would notice a new entry;
//   (b) a known-bad fixture still produces each violation id — a harness that
//       stops reporting reads exactly like a clean product;
//   (c) a known-good fixture produces none — a harness that always rejects
//       would make every rail red for a reason that is not the product's.
import { describe, it, expect, afterEach } from 'vitest'
import axe from 'axe-core'
import {
  AXE_EXCLUSIONS,
  LEVELS,
  WCAG_TAGS,
  runAxe,
  expectNoAxeViolations,
} from './axeHarness.js'

const LANDMARK_FAMILY = [
  'region',
  'landmark-banner-is-top-level',
  'landmark-complementary-is-top-level',
  'landmark-contentinfo-is-top-level',
  'landmark-main-is-top-level',
  'landmark-no-duplicate-banner',
  'landmark-no-duplicate-contentinfo',
  'landmark-no-duplicate-main',
  'landmark-one-main',
  'landmark-unique',
]

function mount(html) {
  const el = document.createElement('div')
  el.innerHTML = html
  document.body.appendChild(el)
  return el
}

/** A button INSIDE a button. ⛔ It cannot be written as HTML: the parser closes
 *  the outer <button> at the inner start tag, so `innerHTML` yields two SIBLING
 *  buttons and axe rightly reports nothing (measured: the first draft of this
 *  control did exactly that). React builds the DOM with appendChild, which
 *  does nest them — so the control does too. */
function nestedButtons() {
  const outer = document.createElement('button')
  outer.type = 'button'
  outer.textContent = 'Outer '
  const inner = document.createElement('button')
  inner.type = 'button'
  inner.textContent = 'Inner'
  const span = document.createElement('span')
  span.appendChild(inner)
  outer.appendChild(span)
  return outer
}

function mountNode(node) {
  const el = document.createElement('div')
  el.appendChild(node)
  document.body.appendChild(el)
  return el
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('(a) the exclusion list is exactly the ruled set (D-A5)', () => {
  it('component level = color-contrast + region + the landmark family, nothing else', () => {
    expect([...AXE_EXCLUSIONS.component].sort()).toEqual(['color-contrast', ...LANDMARK_FAMILY].sort())
  })

  it('page level = color-contrast, nothing else', () => {
    expect([...AXE_EXCLUSIONS.page]).toEqual(['color-contrast'])
  })

  it('there are exactly two levels', () => {
    expect([...LEVELS].sort()).toEqual(['component', 'page'])
  })

  it('the landmark family is DERIVED from axe itself, so it cannot drift from the installed rule set', () => {
    // Non-vacuity: axe must report rules at all, and must know color-contrast.
    const ids = axe.getRules().map((r) => r.ruleId)
    expect(ids).toContain('color-contrast')
    const derived = ids.filter((id) => id === 'region' || id.startsWith('landmark-')).sort()
    expect(derived).toEqual([...LANDMARK_FAMILY].sort())
  })

  it('every excluded id is a real axe rule (a typo would exclude nothing and look like a pass)', () => {
    const ids = new Set(axe.getRules().map((r) => r.ruleId))
    for (const level of LEVELS) {
      for (const id of AXE_EXCLUSIONS[level]) expect(ids.has(id), `${level}: ${id}`).toBe(true)
    }
  })

  it('the lists are frozen', () => {
    expect(Object.isFrozen(AXE_EXCLUSIONS)).toBe(true)
    expect(Object.isFrozen(AXE_EXCLUSIONS.component)).toBe(true)
    expect(Object.isFrozen(AXE_EXCLUSIONS.page)).toBe(true)
  })

  it('the tag set is the WCAG 2.2 AA bar and selects real rules', () => {
    expect([...WCAG_TAGS]).toEqual(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    const selected = axe.getRules([...WCAG_TAGS]).map((r) => r.ruleId)
    expect(selected).toContain('button-name')
    expect(selected).toContain('nested-interactive')
  })
})

describe('(b) the known-bad fixture control: each defect MUST produce its violation id', () => {
  const html = (s) => () => {
    const d = document.createElement('div')
    d.innerHTML = s
    return d
  }
  const CASES = [
    ['a button with no name', html('<button type="button"></button>'), 'button-name'],
    ['an image with no alt', html('<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">'), 'image-alt'],
    ['a button nested in a button', nestedButtons, 'nested-interactive'],
    ['an input with no label', html('<input type="text">'), 'label'],
  ]

  for (const level of ['component', 'page']) {
    for (const [what, build, id] of CASES) {
      it(`${level}: ${what} -> ${id}`, async () => {
        const el = mountNode(build())
        const results = await runAxe(el, { level })
        expect(results.violations.map((v) => v.id)).toContain(id)
      })
    }
  }

  it('expectNoAxeViolations REJECTS on the known-bad fixture, naming every id and a target', async () => {
    const el = document.createElement('div')
    for (const [, build] of CASES) el.appendChild(build())
    document.body.appendChild(el)
    let message = ''
    try {
      await expectNoAxeViolations(el)
    } catch (err) {
      message = String(err.message)
    }
    for (const [, , id] of CASES) expect(message).toContain(id)
    expect(message).toMatch(/target: /)
  })

  it('two runs started together both complete (axe refuses to run concurrently; the harness queues)', async () => {
    const a = mount('<button type="button"></button>')
    const b = mount('<input type="text">')
    const [ra, rb] = await Promise.all([runAxe(a), runAxe(b)])
    expect(ra.violations.map((v) => v.id)).toContain('button-name')
    expect(rb.violations.map((v) => v.id)).toContain('label')
  })

  it('refuses to run over nothing (an empty context would read as a pass)', () => {
    expect(() => runAxe(null)).toThrow(/rendered element/)
  })
})

describe('(c) the known-good fixture control: a labelled form produces zero violations', () => {
  it.each(['component', 'page'])('%s level', async (level) => {
    const el = mount(`
      <form aria-label="Rename note">
        <label for="t">Title</label>
        <input id="t" type="text" value="Weekly plan">
        <label><input type="checkbox"> Pin to top</label>
        <img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="Chart of the week">
        <button type="submit">Save</button>
      </form>`)
    const results = await expectNoAxeViolations(el, { level })
    expect(results.violations).toEqual([])
    // Non-vacuity: axe actually evaluated rules against this DOM.
    expect(results.testEngine.name).toBe('axe-core')
  })
})

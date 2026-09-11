/**
 * R-19 — `notebook.templates` RETURNS AS A CONFIRM WITH A SELECT.
 *
 * ⛔⛔ THE TWO SHAPES R-19 REFUSED, AND WHY THIS FILE ASSERTS AGAINST BOTH.
 * "Templates" means CHOOSE ONE. Shipping it with no run body is a dead bubble — the fan closes
 * and nothing happens, the R-09 defect. Shipping it with a hardcoded key makes the LABEL LIE:
 * "Templates" that always makes the same note. So the cases below do not merely check that a note
 * was created; they change the picker and assert that a DIFFERENT template's content leaves the
 * app. A test that creates one note from the default would pass against the hardcoded version.
 *
 * ⭐ THE OPTION LIST IS DERIVED FROM THE CATALOG, IN THE TEST AS WELL AS IN THE PRODUCT. A
 * hand-typed roster here would agree with `lib/notebookTemplates.js` exactly once — on the day it
 * was written — which is the drift this repo has already paid for in the writer index, the COT
 * router's "4 routes", and the setup catalog's "24".
 *
 * ⚠️ SCOPE OF THE STAND-INS: the same five presentational mocks as
 * `confirmFieldsReachable.test.jsx` and `linkTickerWritesTheNote.test.jsx`, for the same stated
 * reason — `HubPad` is the seam `useJoystick` drives and the rest would only add noise to a sheet
 * query. Nothing on the path under test is stubbed: the real registry, the real `HubRoot` confirm
 * branch, the real sheet, the real `useNotebookSection`, the real `createNoteFromTemplateViaApi`.
 * `fetch` is the boundary.
 */
import { describe, it as vitestIt, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react'
import { forwardRef } from 'react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { SWRConfig } from 'swr'

// ⛔ RAIL (house convention): `vitest -t` is a REGEX, and a filter matching nothing exits 0 and
// reads as a PASS.
let definedCount = 0
let executedCount = 0
function it(name, fn) {
  definedCount += 1
  return vitestIt(name, (...args) => { executedCount += 1; return fn(...args) })
}
afterAll(() => {
  expect(executedCount).toBeGreaterThan(0)
  expect(executedCount).toBe(definedCount)
})

const { hoisted } = vi.hoisted(() => ({
  hoisted: { prefs: {}, actionsDoor: { current: null } },
}))

vi.mock('../hooks/usePreferences', () => ({
  default: () => ({ prefs: hoisted.prefs, setPrefMerged: vi.fn(), loading: false }),
  parsePref: (raw) => {
    if (raw == null) return undefined
    if (typeof raw !== 'string') return raw
    try { return JSON.parse(raw) } catch { return undefined }
  },
}))

vi.mock('./HubPad', () => ({
  default: forwardRef(function MockHubPad(
    { onPointerDown, onPointerMove, onPointerUp, onPointerCancel }, ref,
  ) {
    return (
      <div
        data-testid="mock-hub-pad"
        ref={ref}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      />
    )
  }),
}))
vi.mock('./HubKnob', () => ({ default: () => null }))
vi.mock('./HubFan', () => ({ default: () => null }))
vi.mock('./HubChip', () => ({ default: () => null }))
vi.mock('./HubScrim', () => ({ default: () => null }))
vi.mock('./HubActionsButton', () => ({
  default: (props) => { hoisted.actionsDoor.current = props; return null },
}))
vi.mock('../components/FeedbackWidget', () => ({ default: () => null }))

import HubRoot from './HubRoot'
import { HubProvider, useHub } from './HubContext'
import { modesById, OUTER_MAX, INNER_MAX } from './registry'
import { wedgeAngles } from './fanGeometry'
import { _reset as resetCursors } from './useHubCursor'
import { AuthContext } from '../context/AuthContext'
import NotebookHubSection from './sections/NotebookHubSection'
import { NOTEBOOK_ROUTE, templateOptions } from './sections/notebookSection'
import { TEMPLATES, getTemplate } from '../pages/journal-2-0/lib/notebookTemplates'

const TEMPLATES_ACTION = 'notebook.templates'

let calls = []
const noteCreates = () => calls.filter((c) => c.method === 'POST' && c.url === '/api/j2/notes')

let registered = null
let seenSearch = ''
function ConfigProbe() {
  registered = useHub().activeModeConfig
  seenSearch = useLocation().search
  return null
}
const registeredFan = () => {
  if (!registered) throw new Error('no hub config registered — the Notebook controller never ran')
  return registered.fan
}
const actionInFan = (id) => registeredFan().find((a) => a.id === id)

function NoteGrid({ notes }) {
  return (
    <div>
      {notes.map((n) => (
        <button type="button" key={n.id} data-note-card-id={n.id}>
          <span><span>{n.title}</span></span>
        </button>
      ))}
    </div>
  )
}
const NOTES = Object.freeze([Object.freeze({ id: 'n-1', title: 'Regime notes' })])

function stubHubCapable() {
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

function vecAtAngle(dist, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180
  return { dx: Math.cos(rad) * dist, dy: -Math.sin(rad) * dist }
}

/** A deliberate push-and-release onto `actionId` — the same driver the sibling rails use. */
function deliberateSelect(actionId) {
  const outer = registeredFan().filter((a) => a.ring === 0)
  const idx = outer.findIndex((a) => a.id === actionId)
  expect(idx, `${actionId} is not on the registered outer ring`).toBeGreaterThanOrEqual(0)
  const { dx, dy } = vecAtAngle(30, wedgeAngles(outer.length)[idx])

  let now = 1_700_000_000_000
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => now)
  try {
    const pad = screen.getByTestId('mock-hub-pad')
    fireEvent.pointerDown(pad, { clientX: 0, clientY: 0, pointerId: 1 })
    fireEvent.pointerMove(pad, { clientX: dx, clientY: dy, pointerId: 1 })
    now += 400
    fireEvent.pointerUp(pad, { clientX: dx, clientY: dy, pointerId: 1 })
  } finally {
    clock.mockRestore()
  }
}

const renderHub = ({ notes = NOTES } = {}) => render(
  <AuthContext.Provider value={{ user: { id: 1, email: 'x@y.z' } }}>
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <MemoryRouter initialEntries={[NOTEBOOK_ROUTE]}>
        <HubProvider>
          <NoteGrid notes={notes} />
          <NotebookHubSection />
          <ConfigProbe />
          <HubRoot />
        </HubProvider>
      </MemoryRouter>
    </SWRConfig>
  </AuthContext.Provider>,
)

const picker = () => screen.getByTestId('hub-confirm-field-template')
const choose = (key) => fireEvent.change(picker(), { target: { value: key } })
const confirmIt = async () => {
  fireEvent.click(screen.getByTestId('hub-confirm-primary'))
  await act(async () => { await Promise.resolve() })
  await act(async () => { await Promise.resolve() })
  await act(async () => { await Promise.resolve() })
}

beforeEach(() => {
  hoisted.prefs = { joystick_hub: JSON.stringify({ enabled: true }) }
  hoisted.actionsDoor.current = null
  registered = null
  seenSearch = ''
  calls = []
  resetCursors()
  stubHubCapable()
  vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
    const method = (opts.method || 'GET').toUpperCase()
    calls.push({ url: String(url), method, body: opts.body })
    if (method === 'POST' && String(url) === '/api/j2/notes') {
      return { ok: true, status: 200, json: async () => ({ note: { id: 'new-note-1' } }) }
    }
    // Everything `assembleTemplateContext` reaches for is best-effort by its own design; an
    // unhelpful answer here exercises its documented fallback rather than hiding it.
    return { ok: false, status: 404, json: async () => ({}) }
  }))
})

afterEach(() => {
  cleanup()
  delete globalThis.CSS
  delete window.visualViewport
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

// ═════════════════════════════════════════════════════════════════════════════════════════════
describe('R-19 — the action is back, and the ring is still legal', () => {
  it('CONTROL: the section ships notebook.templates WITH a confirmPayload, and no sheet is open', () => {
    renderHub()
    expect(registeredFan().map((a) => a.id)).toContain(TEMPLATES_ACTION)
    expect(typeof actionInFan(TEMPLATES_ACTION).confirmPayload).toBe('function')
    expect(screen.queryByTestId('hub-confirm-primary')).toBeNull()
  })

  it('⛔ RING LEGALITY after the return — outer 3, inner 4, both within the caps', () => {
    renderHub()
    const drawn = hoisted.actionsDoor.current.actions
    const outer = drawn.filter((a) => a.ring === 0).map((a) => a.id)
    const inner = drawn.filter((a) => a.ring === 1).map((a) => a.id)
    expect(outer).toEqual(['notebook.newNote', 'notebook.linkTicker', TEMPLATES_ACTION])
    expect(inner).toEqual([
      'notebook.dailyPlan', 'notebook.postMortem', 'notebook.voice', 'notebook.home',
    ])
    expect(outer.length).toBeLessThanOrEqual(OUTER_MAX)
    expect(inner.length).toBeLessThanOrEqual(INNER_MAX)
  })

  it('it is present on an EMPTY notebook — creating a note needs nothing from the grid', () => {
    // Deliberately unlike `linkTicker`, which is dropped with no note to tag. On an empty
    // notebook this is the most useful bubble on the fan, and dropping it would be the wrong
    // reading of "absent, never present-and-inert".
    renderHub({ notes: [] })
    expect(registeredFan().map((a) => a.id)).toContain(TEMPLATES_ACTION)
    expect(registeredFan().map((a) => a.id)).not.toContain('notebook.linkTicker')
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════
describe('R-19 — the sheet carries a real picker, derived from the catalog', () => {
  it('⛔ it is a <select>, and its options ARE the template catalog — never a typed copy', () => {
    renderHub()
    deliberateSelect(TEMPLATES_ACTION)

    const el = picker()
    expect(el.tagName, 'the picker is not a select — a text box would ask the member to TYPE a '
      + 'stable API key, which is worse than the hardcoded key R-19 refused').toBe('SELECT')
    expect(screen.getByLabelText('template')).toBe(el)

    // DERIVED both sides: the catalog is the authority, and `templateOptions` is the one mapping.
    const expected = TEMPLATES.map((t) => [t.key, t.label])
    expect(expected.length, 'the catalog is empty — every assertion here would be vacuous')
      .toBeGreaterThan(3)
    const rendered = [...el.querySelectorAll('option')].map((o) => [o.value, o.textContent])
    expect(rendered, 'the picker and the catalog disagree').toEqual(expected)
    expect(templateOptions().map((o) => [o.value, o.label])).toEqual(expected)
  })

  it('⛔ a select gets NO steppers — ± on an unordered set promises arithmetic it cannot do', () => {
    renderHub()
    deliberateSelect(TEMPLATES_ACTION)
    expect(screen.queryByLabelText('Increase template')).toBeNull()
    expect(screen.queryByLabelText('Decrease template')).toBeNull()
  })

  it('the sheet opens on a real option, never on a blank row', () => {
    renderHub()
    deliberateSelect(TEMPLATES_ACTION)
    expect(picker().value).toBe(TEMPLATES[0].key)
    expect(screen.getByTestId('hub-confirm-primary')).toHaveTextContent('Start note')
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════
describe('R-19 — the note it creates is the one the member PICKED', () => {
  it('⛔ picking a template creates THAT template, and opens the note', async () => {
    // The third template in the catalog, so this can never be satisfied by the default.
    const pick = TEMPLATES[2]
    renderHub()
    deliberateSelect(TEMPLATES_ACTION)
    choose(pick.key)
    await confirmIt()

    const posts = noteCreates()
    expect(posts, 'no note was created — the fan closed and nothing happened, the R-09 defect')
      .toHaveLength(1)
    const body = JSON.parse(posts[0].body)

    // ⛔ THE TITLE IS COMPARED ON ITS STABLE HALF, AND THAT IS DERIVED, NOT TYPED. Templates date
    // themselves (`defaultTitle(ctx)` reads the assembled context), so the full string legitimately
    // differs run to run; everything before the em dash is the template's own name for itself.
    const stableTitle = (key) => getTemplate(key).defaultTitle({}).split('—')[0].trim()
    const prefix = stableTitle(pick.key)
    expect(prefix, 'the picked template has no stable title half, so this comparison proves nothing')
      .toBeTruthy()
    // …and it has to DISCRIMINATE: another template must not share it.
    expect(TEMPLATES.filter((t) => stableTitle(t.key) === prefix), 'two templates share a title '
      + 'prefix, so this assertion cannot tell them apart').toHaveLength(1)
    expect(body.title, 'the note created is not the template that was picked').toContain(prefix)

    expect(body.tags ?? [], 'the tags are not the picked template\'s').toEqual(pick.tags ?? [])
    expect(body.bodyJson, 'no document body was sent').toBeTruthy()

    // …and the member lands in it.
    expect(new URLSearchParams(seenSearch).get('note'), 'the note was created and never opened')
      .toBe('new-note-1')
    expect(screen.getByText(`Started ${pick.label}`)).toBeTruthy()
  })

  it('⛔⛔ TWO DIFFERENT PICKS PRODUCE TWO DIFFERENT NOTES — the hardcoded-key defect, railed', async () => {
    // R-19 names this in so many words: "with a hardcoded key the label lies — Templates that
    // always makes the same one". A rail that only creates one note passes against exactly that.
    const a = TEMPLATES[1]
    const b = TEMPLATES[4]
    expect(a.key, 'the two picks must differ or this proves nothing').not.toBe(b.key)

    renderHub()
    deliberateSelect(TEMPLATES_ACTION)
    choose(a.key)
    await confirmIt()
    const firstBody = JSON.parse(noteCreates()[0].body)

    deliberateSelect(TEMPLATES_ACTION)
    choose(b.key)
    await confirmIt()
    const secondBody = JSON.parse(noteCreates()[1].body)

    expect(noteCreates()).toHaveLength(2)
    expect(secondBody.title, 'both picks produced the same note — the key is effectively hardcoded')
      .not.toBe(firstBody.title)
    expect(JSON.stringify(secondBody.bodyJson)).not.toBe(JSON.stringify(firstBody.bodyJson))
  })

  it('⛔ it performs ONE write — the guarded second write in noteCreation stays closed', async () => {
    // `createNoteViaApi` also holds `PUT /api/j2/notes/{id}`, gated on `properties`. No template
    // in the catalog declares any, so the template path cannot open it either; the manifest
    // therefore needs no new entry for this action.
    renderHub()
    deliberateSelect(TEMPLATES_ACTION)
    await confirmIt()

    expect(noteCreates()).toHaveLength(1)
    expect(calls.filter((c) => c.method === 'PUT'), 'a second, undeclared write left the app')
      .toHaveLength(0)
    expect(TEMPLATES.filter((t) => t.properties), 'a template grew `properties`, which opens the '
      + 'guarded PUT inside createNoteViaApi — it must be declared in writePaths.test.js\'s manifest')
      .toHaveLength(0)
  })

  it('⛔ a failing create is reported, not swallowed into a silent success', async () => {
    renderHub()
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase()
      calls.push({ url: String(url), method, body: opts.body })
      if (method === 'POST') return { ok: false, status: 500, json: async () => ({}) }
      return { ok: false, status: 404, json: async () => ({}) }
    }))
    deliberateSelect(TEMPLATES_ACTION)
    await confirmIt()

    expect(screen.getByText('Could not start that note: Could not create note (500)')).toBeTruthy()
    expect(new URLSearchParams(seenSearch).get('note'), 'a failed create still navigated')
      .toBeNull()
  })
})

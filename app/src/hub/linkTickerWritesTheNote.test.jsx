/**
 * R-17 — `notebook.linkTicker` RETURNS, AND THE SYMBOL COMES FROM THE SHEET.
 *
 * ⛔⛔ WHY THIS DRIVES THE PRODUCT INSTEAD OF THE PIECES.
 * The action was removed in Increment 4 because it declared `requires: ['symbol']` and
 * `/journal/notebook` carries no symbol, so it could only ever render as a permanently dimmed
 * bubble (spec §2e — disabled, never hidden). The fix is not "delete the requirement": it is that
 * the symbol is supplied BY THE MEMBER, on this action's own confirm sheet, after the gesture. So
 * the thing that has to be true is a chain — the registry entry, `HubRoot`'s confirm branch,
 * `HubConfirmSheet`'s field rendering, the section's payload, and the Notebook's own note client —
 * and EVERY link of it was green while the action was absent from the fan.
 *
 * ⭐ SO: a real `HubRoot` on the real Notebook route, a real gesture onto the real bubble, and the
 * assertions are on the RENDERED SHEET and on the REQUEST that leaves. A test that `confirmPayload`
 * returned the right object passes with the wire cut; a test that `update()` was called passes with
 * a hub-local fetch that bypasses the Notebook's cache invalidation entirely.
 *
 * ⚠️ SCOPE OF THE STAND-INS. `HubPad` is the seam `useJoystick` drives and the five presentational
 * components are mocked for the same reason `confirmFieldsReachable.test.jsx` mocks them — they
 * would only add noise to a sheet query. NOTHING on the path under test is stubbed: the real
 * `useNotebookSection`, the real `useJ2Note`, the real sheet, the real registry. `fetch` is the
 * boundary, and asserting on it is the point.
 *
 * ⭐ The grid stand-in mirrors `NoteCard`'s real shape (a button whose leftmost spine ends at the
 * title div), because `readout()` reads the title off the card and a flat `<div id>` fixture would
 * make that pass for the wrong reason.
 */
import { describe, it as vitestIt, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react'
import { forwardRef, useEffect } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'

// ⛔ RAIL (house convention): `vitest -t` is a REGEX, and a filter matching nothing exits 0 and
// reads as a PASS. These counters catch a `-t` typo or a stray `.only`/`.skip`.
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
  // ⚠️ A mocked module namespace is a Proxy that THROWS on any export the mock omits, and
  // useHubSettings.js imports `parsePref` directly.
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
import { modesById, OUTER_MAX, INNER_MAX, validateRegistry } from './registry'
import { wedgeAngles } from './fanGeometry'
import { _reset as resetCursors } from './useHubCursor'
import { AuthContext } from '../context/AuthContext'
import NotebookHubSection from './sections/NotebookHubSection'
import { NOTEBOOK_ROUTE } from './sections/notebookSection'

const LINK = 'notebook.linkTicker'

/** Every fetch this render performed, in order. `fetch` is the boundary the product writes at. */
let calls = []
const noteWrites = () => calls.filter((c) => c.method === 'PUT' && /\/api\/j2\/notes\//.test(c.url))
const noteRequests = () => calls.filter((c) => /\/api\/j2\/notes/.test(c.url))

/** The registered section config, as `HubRoot` receives it from `HubProvider`. */
let registered = null
function ConfigProbe() {
  registered = useHub().activeModeConfig
  return null
}
const registeredFan = () => {
  if (!registered) throw new Error('no hub config registered — the Notebook controller never ran')
  return registered.fan
}
const actionInFan = (id) => registeredFan().find((a) => a.id === id)

/** A symbol into the hub context, the way any other section publishes one. */
function SymbolInScope({ symbol }) {
  const { setSymbol } = useHub()
  useEffect(() => { setSymbol(symbol) }, [setSymbol, symbol])
  return null
}

/**
 * The note grid, shaped like `NoteCard`: a <button> whose leftmost element spine ends at the
 * title. R-18's `data-note-card-id` is the only thing the hub is allowed to depend on.
 */
function NoteGrid({ notes }) {
  return (
    <div>
      {notes.map((n) => (
        <button type="button" key={n.id} data-note-card-id={n.id}>
          <span>
            <span>{n.title}</span>
            <span>{n.date}</span>
          </span>
        </button>
      ))}
    </div>
  )
}

const NOTES = Object.freeze([
  Object.freeze({ id: 'n-1', title: 'Regime notes', date: '2d' }),
  Object.freeze({ id: 'n-2', title: 'NVDA thesis', date: '3d' }),
  Object.freeze({ id: 'n-3', title: 'Postmortem', date: '5d' }),
])

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

/** A point `dist` px from the pad centre at `angleDeg` — the inverse of `fanGeometry.pointerAngle`. */
function vecAtAngle(dist, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180
  return { dx: Math.cos(rad) * dist, dy: -Math.sin(rad) * dist }
}

/**
 * A DELIBERATE push-and-release onto `actionId` — pointerdown, drag past the open threshold, then
 * release more than FLICK_MS later, so release lands in `useJoystick`'s `phase === 'pushing'`
 * branch and fires the resolved target. (Same driver as `confirmFieldsReachable.test.jsx`.)
 */
function deliberateSelect(actionId) {
  const outer = registeredFan().filter((a) => a.ring === 0)
  // ⭐ NON-VACUITY. Without this, a fan that shipped no such action makes the gesture land on
  // nothing and every assertion below fails for a reason that reads like the sheet is broken.
  const idx = outer.findIndex((a) => a.id === actionId)
  expect(idx, `${actionId} is not on the registered outer ring`).toBeGreaterThanOrEqual(0)
  const { dx, dy } = vecAtAngle(30, wedgeAngles(outer.length)[idx])

  let now = 1_700_000_000_000
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => now)
  try {
    const pad = screen.getByTestId('mock-hub-pad')
    fireEvent.pointerDown(pad, { clientX: 0, clientY: 0, pointerId: 1 })
    fireEvent.pointerMove(pad, { clientX: dx, clientY: dy, pointerId: 1 })
    now += 400 // past FLICK_MS (120): a deliberate selection, never a flick
    fireEvent.pointerUp(pad, { clientX: dx, clientY: dy, pointerId: 1 })
  } finally {
    clock.mockRestore()
  }
}

const renderHub = ({ notes = NOTES, symbol = null, route = NOTEBOOK_ROUTE } = {}) => render(
  <AuthContext.Provider value={{ user: { id: 1, email: 'x@y.z' } }}>
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <MemoryRouter initialEntries={[route]}>
        <HubProvider>
          {symbol ? <SymbolInScope symbol={symbol} /> : null}
          <NoteGrid notes={notes} />
          <NotebookHubSection />
          <ConfigProbe />
          <HubRoot />
        </HubProvider>
      </MemoryRouter>
    </SWRConfig>
  </AuthContext.Provider>,
)

/** The sheet, as the DOM has it. */
const sheetOpen = () => screen.queryByTestId('hub-confirm-primary') != null
const field = (name) => screen.getByTestId(`hub-confirm-field-${name}`)
const type = (name, value) => fireEvent.change(field(name), { target: { value } })
const confirmIt = async () => {
  fireEvent.click(screen.getByTestId('hub-confirm-primary'))
  // The write is async (fetch -> json -> SWR mutate). Let it settle before asserting.
  await act(async () => { await Promise.resolve() })
  await act(async () => { await Promise.resolve() })
}

beforeEach(() => {
  hoisted.prefs = { joystick_hub: JSON.stringify({ enabled: true }) }
  hoisted.actionsDoor.current = null
  registered = null
  calls = []
  resetCursors()
  stubHubCapable()
  vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
    calls.push({ url: String(url), method: (opts.method || 'GET').toUpperCase(), body: opts.body })
    return {
      ok: true,
      status: 200,
      json: async () => ({ note: { id: 'n-1', title: 'Regime notes', ticker: 'NVDA' } }),
    }
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
describe('R-17 — the action is on the fan, and it is never the thing it was removed for', () => {
  it('CONTROL: the section ships notebook.linkTicker WITH a confirmPayload, and no sheet is open', () => {
    renderHub()
    expect(registeredFan().map((a) => a.id)).toContain(LINK)
    expect(typeof actionInFan(LINK).confirmPayload).toBe('function')
    expect(sheetOpen(), 'a sheet was open before any gesture').toBe(false)
  })

  it('⛔ the registry entry declares NO `requires` — the precondition MOVED, it was not softened', () => {
    // This is the whole of R-17 in one assertion. `requires` is answered from the CONTEXT before
    // the gesture resolves; the symbol this action needs is one the member types afterwards. A
    // `requires:['symbol']` here disables the only action whose purpose is to supply a symbol.
    const declared = modesById.notebook.fan.find((a) => a.id === LINK)
    expect(declared, 'the action is not in the registry at all').toBeTruthy()
    expect(declared.requires ?? [], 'linkTicker demands something from ctx again — on a route that '
      + 'carries no symbol, that is the permanently dimmed bubble it was removed for').toEqual([])
    // …and the contract's other half: it is a confirm, so it HAS a sheet to ask on.
    expect(declared.kind).toBe('confirm')
  })

  it('⛔ it is never DISABLED — the fan HubRoot draws dims nothing on this route', () => {
    renderHub()
    const door = hoisted.actionsDoor.current
    expect(door, 'the Peek door never rendered, so disabledIds is unmeasured').toBeTruthy()
    expect(door.actions.map((a) => a.id), 'the action never reached the drawn fan').toContain(LINK)
    expect(door.disabledIds, 'linkTicker renders dimmed — the R-17 defect, returned')
      .not.toContain(LINK)
    expect(door.disabledReason(actionInFan(LINK)), 'a reason implies a requirement it no longer has')
      .toBeNull()
  })

  it('⛔ with NO notes it is ABSENT, not present-and-inert — and it comes back when there are', () => {
    // The presence half of the gate that replaced `requires`. An empty grid has nothing to file
    // under a ticker, and a bubble that can only tell the member it cannot work is the R-09 dead
    // bubble. Absent tells the truth; dimmed-forever does not.
    renderHub({ notes: [] })
    expect(registeredFan().map((a) => a.id), 'an empty notebook still shipped the bubble')
      .not.toContain(LINK)
    cleanup()
    resetCursors()
    registered = null
    renderHub({ notes: NOTES })
    expect(registeredFan().map((a) => a.id)).toContain(LINK)
  })

  it('⛔ RING LEGALITY — the fan the member is handed is still within both caps', () => {
    // R-17 notes the counts (OUTER_MAX 5, INNER_MAX 4) and asks for the result to be proven, not
    // asserted. Measured on the PROJECTION HubRoot draws, not only on the declaration.
    renderHub()
    const drawn = hoisted.actionsDoor.current.actions
    const outer = drawn.filter((a) => a.ring === 0).map((a) => a.id)
    const inner = drawn.filter((a) => a.ring === 1).map((a) => a.id)
    // ⚰️ WAS TWO, THEN THREE, AND IS NOW FOUR — and this list going red is the mechanism
    // working, not failing. R-19 landed `notebook.templates` and D-17 landed
    // `notebook.voiceNote` in this same increment, on THREE separate branches, all onto this
    // one ring. Each branch's own rail said "three" because three was true where it was
    // written. Spelling the list out rather than counting it is what forced a human to look
    // at the fourth instead of a count quietly absorbing it.
    expect(outer, 'the outer ring is not the four the notebook declares')
      .toEqual(['notebook.newNote', 'notebook.voiceNote', LINK, 'notebook.templates'])
    expect(inner).toEqual([
      'notebook.dailyPlan', 'notebook.postMortem', 'notebook.voice', 'notebook.home',
    ])
    expect(outer.length).toBeLessThanOrEqual(OUTER_MAX)
    expect(inner.length).toBeLessThanOrEqual(INNER_MAX)
    // And the registry's own conscience agrees, on the declared fan as well as the drawn one.
    expect(validateRegistry()).toEqual([])
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════
describe('R-17 — the sheet is where the symbol comes from', () => {
  it('⛔ the field is EMPTY when no symbol is in scope — never a fabricated default', () => {
    renderHub({ symbol: null })
    deliberateSelect(LINK)

    expect(screen.getByLabelText('ticker'), 'no ticker field — the sheet is the generic yes/no one')
      .toBe(field('ticker'))
    expect(field('ticker').value, 'the sheet invented a ticker the member never chose').toBe('')
    expect(field('ticker').type).toBe('text')
    expect(screen.getByTestId('hub-confirm-body'))
      .toHaveTextContent('File this note under a ticker. Type the symbol, e.g. NVDA.')
    expect(screen.getByTestId('hub-confirm-primary')).toHaveTextContent('Set ticker')
  })

  it('⛔ the field DEFAULTS from ctx when a symbol IS in scope, and the body says so', () => {
    renderHub({ symbol: 'NVDA' })
    deliberateSelect(LINK)

    expect(field('ticker').value).toBe('NVDA')
    expect(screen.getByTestId('hub-confirm-body'))
      .toHaveTextContent('NVDA is the symbol in scope')
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════
describe('R-17 — the write, end to end, through the Notebook\'s own note client', () => {
  it('⛔ the typed ticker is PUT onto the note, and the member is told', async () => {
    renderHub()
    deliberateSelect(LINK)
    type('ticker', 'NVDA')
    await confirmIt()

    const writes = noteWrites()
    expect(writes, 'no PUT left the app — the sheet closed and nothing was written').toHaveLength(1)
    expect(writes[0].url).toBe('/api/j2/notes/n-1')
    expect(JSON.parse(writes[0].body), 'the body must carry the ticker and nothing else — this PUT '
      + 'is a partial update and a stray key would rewrite the note').toEqual({ ticker: 'NVDA' })
    // Asserted as RENDERED TEXT: a toast host that never paints is the defect this house rule
    // exists for.
    expect(screen.getByText('Tagged NVDA')).toBeTruthy()
  })

  it('⛔ it writes to the note the CURSOR IS ON, not to note one', async () => {
    // The whole reason `onTap` had to be fixed in the same change: the write target and the note
    // the member is looking at are the same note, or the label lies.
    renderHub()
    act(() => { registered.onTap() })   // the registered handler, not a reconstruction of it
    act(() => { registered.onTap() })

    deliberateSelect(LINK)
    type('ticker', 'AMD')
    await confirmIt()

    const writes = noteWrites()
    expect(writes).toHaveLength(1)
    expect(writes[0].url, 'the write went to the first note while the cursor was on the third')
      .toBe('/api/j2/notes/n-3')
  })

  it('⛔ a lowercase ticker is normalised — the member types, the product files it properly', async () => {
    renderHub()
    deliberateSelect(LINK)
    type('ticker', '  nvda ')
    await confirmIt()

    expect(JSON.parse(noteWrites()[0].body)).toEqual({ ticker: 'NVDA' })
    expect(screen.getByText('Tagged NVDA')).toBeTruthy()
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════
describe('R-17 — the field is REQUIRED, and a refusal is spoken', () => {
  it('⛔ an EMPTY ticker writes NOTHING and says so in the member\'s own words', async () => {
    // `HubConfirmSheet` has no required-field concept and closes on its primary either way, so a
    // refusal that said nothing would be indistinguishable from a success.
    renderHub()
    deliberateSelect(LINK)
    await confirmIt()

    expect(noteWrites(), 'an empty ticker reached the server').toHaveLength(0)
    expect(screen.getByText('Type a ticker first — nothing was changed.')).toBeTruthy()
  })

  it('⛔ something that cannot be a ticker writes NOTHING and says so', async () => {
    renderHub()
    deliberateSelect(LINK)
    type('ticker', 'not a ticker')
    await confirmIt()

    expect(noteWrites(), 'prose was filed onto the note as a ticker').toHaveLength(0)
    expect(screen.getByText('Type a ticker first — nothing was changed.')).toBeTruthy()
  })

  it('⛔ a failing server is reported verbatim, not swallowed into a silent success', async () => {
    renderHub()
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      calls.push({ url: String(url), method: (opts.method || 'GET').toUpperCase(), body: opts.body })
      if ((opts.method || 'GET').toUpperCase() === 'PUT') {
        return { ok: false, status: 422, json: async () => ({ detail: 'ticker is not tradable' }) }
      }
      return { ok: true, status: 200, json: async () => ({ note: { id: 'n-1' } }) }
    }))
    deliberateSelect(LINK)
    type('ticker', 'NVDA')
    await confirmIt()

    expect(screen.getByText('Could not set the ticker: ticker is not tradable')).toBeTruthy()
    expect(screen.queryByText('Tagged NVDA'), 'a failed write reported success').toBeNull()
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════
describe('R-17 — the note client is armed at the GESTURE, never at every cursor step', () => {
  it('⛔ moving the cursor fires NO note request — a scrub must not cost a request per frame', () => {
    // `useJ2Note(id)` opens an SWR subscription keyed on the id. Keying it to the cursor would GET
    // a note per index change, and the index changes on every frame of a drag: one pass down a
    // fifty-note grid would be fifty requests on a phone. This is the rail on that design.
    renderHub()
    expect(noteRequests(), 'mounting the section already fetched a note').toHaveLength(0)

    act(() => { registered.onScrub(null, { delta: 0.5, axis: 'x' }) })
    act(() => { registered.onScrub(null, { delta: 1, axis: 'x' }) })
    act(() => { registered.onTap() })

    expect(noteRequests(), 'the cursor moved and the app went to the network for a note')
      .toHaveLength(0)
  })

  it('the gesture IS what arms it — one GET for the one note about to be tagged', () => {
    renderHub()
    deliberateSelect(LINK)
    const gets = noteRequests().filter((c) => c.method === 'GET')
    expect(gets.length, 'the sheet opened without the client being armed for any note')
      .toBeGreaterThan(0)
    for (const g of gets) expect(g.url).toBe('/api/j2/notes/n-1')
  })
})

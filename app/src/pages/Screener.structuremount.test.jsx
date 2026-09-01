// app/src/pages/Screener.structuremount.test.jsx
//
// ─── 🔴 THE SECOND WIRE-CUT, ONE LAYER UP ───────────────────────────────────
//
// `StructureProvenance.test.jsx` is 21 green cases that render the component
// DIRECTLY. Every one of them stays green while the panel is imported by
// nothing — which is what it was until this file existed. That is the same
// defect `Screener.scanmount.test.jsx` was written for, and this repo's own
// running count of it stands at thirteen.
//
// ⛔ SO THIS FILE RENDERS THE PAGE. `<Screener/>` is what `App.jsx` mounts at
// `/screener`. The assertion is that markup only `StructureProvenance` writes —
// a verbatim source quote, and the refusal section naming what a house declined
// to publish — reaches the real DOM after a member does the only thing a member
// can do: click the control that opens it. Cut the import, the button, or the
// `<StructureProvenance/>` element inside the sheet, and only this file reds.
//
// ⛔ WHAT THE FETCH CASE DOES AND DOES NOT PROVE — measured, not assumed.
// `/api/screener/structures` must be ABSENT from the call log before the click
// and present after it: a member must not pay for a request they did not ask
// for. That property is REAL and worth pinning end-to-end. But it is owned by
// `Sheet`, which returns null while closed (Sheet.jsx L120) — NOT by the
// `libOpen &&` guard beside the panel. Mutation-checked: deleting that guard so
// the panel mounts eagerly leaves all six cases GREEN, because Sheet keeps the
// children unmounted anyway. So this case is a CONTRACT PIN on the composed
// behaviour, not a discriminator between the two spellings, and calling it one
// would be the adjacent-thing guard this repo keeps paying for.
import { SWRConfig } from 'swr'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { AuthProvider } from '../context/AuthContext'
import { VoiceProvider } from '../context/VoiceContext'

// ScannerShell's own data lane — three hooks, none of them on the chain this
// file measures. Frozen module constants (the `screenSharing.mount.test.jsx`
// hazard: a fresh literal per call re-fires the accumulate effect forever).
const { META, SCAN } = vi.hoisted(() => ({
  META: { meta: { categories: [], filters: [], views: [{ key: 'overview', label: 'Overview', columns: ['ticker'] }] } },
  SCAN: { result: { total: 0, page: 1, view: 'overview', view_columns: ['ticker'], rows: [], snapshot_date: '2026-08-30' }, isLoading: false },
}))
vi.mock('./screener/hooks/useScreenerMeta', () => ({ default: () => META }))
vi.mock('./screener/hooks/useScreenerScan', () => ({ default: () => SCAN }))
vi.mock('../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {} }) }))
vi.mock('../components/chart/pane/ChartPane', () => ({
  default: ({ sym }) => <div data-testid={`pane-${sym}`}>pane</div>,
}))

const Screener = (await import('./Screener')).default

// The shape `GET /api/screener/structures` answers with — one structure
// carrying all three provenance states, because the whole point of the panel is
// that they stay distinguishable all the way to the screen.
const STRUCTURES = {
  structures: {
    'darvas-box': {
      key: 'darvas-box',
      label: 'Darvas Box',
      desc: 'Price framed between a ceiling and a floor.',
      axis: 'relation', family: 'Base Structure', bias: 'neutral',
      coverage_pct: 4.8,
      criteria: [
        { condition: 'Sessions with no touch of the prior high', value: 3,
          state: 'sourced', quote: 'does not touch or penetrate',
          source_id: 'darvas_1960', confidence: 'high', missing: null },
        { condition: 'Box duration', value: null, state: 'refused', quote: null,
          source_id: 'darvas_1960', confidence: 'high',
          missing: 'Darvas publishes no minimum or maximum box length.' },
        { condition: 'Frame must be LIVE', value: 20, state: 'ours', quote: null,
          source_id: null, confidence: 'high', missing: null },
      ],
      // ⛔ THE REAL LEDGER SHAPE. This fixture originally used `lift_pp` and
      // `ci_pp`, which the route never sends — the same invented payload that
      // let 26 green component tests stand over a panel rendering "No measured
      // edge published" for every structure. `lift` is a FRACTION.
      evidence: {
        published: true, lift: 0.0735, ci_low: 0.0678, ci_high: 0.0796,
        n: 24428, null_max: 0.011, null_trials: 30, direction: 'long',
      },
    },
  },
  counts: { structures: 26, sourced: 141, refused: 44, ours: 25 },
}

const json = (body) => Promise.resolve({
  ok: true, status: 200, json: () => Promise.resolve(body),
})

const H = { calls: [] }

function stubFetch(structuresResponse) {
  vi.stubGlobal('fetch', vi.fn((url) => {
    const u = String(url)
    H.calls.push(u)
    if (u.startsWith('/api/auth/me')) {
      return json({ user: { id: 7, email: 'member@uct.test', role: 'user' }, plan: 'premium' })
    }
    if (u.startsWith('/api/screener/structures')) return structuresResponse()
    return json({})
  }))
}

beforeEach(() => {
  H.calls = []
  stubFetch(() => json(STRUCTURES))
})

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function renderScreenerPage() {
  return render(
    <MemoryRouter initialEntries={['/screener']}>
      <AuthProvider>
        <VoiceProvider>
          <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
            <Screener />
          </SWRConfig>
        </VoiceProvider>
      </AuthProvider>
    </MemoryRouter>,
  )
}

const structureCalls = () => H.calls.filter(u => u.startsWith('/api/screener/structures'))

/** The door, located by ROLE and its own visible label — never a testid. A
 *  member finds this control by reading it. */
const libraryButton = () => screen.findByRole('button', { name: /Structure library/i })

describe('🔴 the structure library reaches a member from /screener', () => {
  it('the door exists on the page App.jsx actually mounts', async () => {
    renderScreenerPage()
    expect(await libraryButton()).toBeInTheDocument()
  })

  it('⭐ nothing is fetched until the member opens it', async () => {
    renderScreenerPage()
    await libraryButton()
    expect(structureCalls()).toEqual([])
  })

  it('opening it renders the RESEARCH — a verbatim source quote on the real DOM', async () => {
    const user = userEvent.setup()
    renderScreenerPage()
    await user.click(await libraryButton())
    expect(await screen.findByText(/does not touch or penetrate/)).toBeInTheDocument()
    expect(screen.getByText('Darvas Box')).toBeInTheDocument()
    expect(structureCalls()).toEqual(['/api/screener/structures'])
  })

  it('⭐ the REFUSAL survives the trip — the part nobody else ships', async () => {
    const user = userEvent.setup()
    renderScreenerPage()
    await user.click(await libraryButton())
    expect(await screen.findByText(/The source did not publish this/i)).toBeInTheDocument()
    expect(screen.getByText(/no minimum or maximum box length/i)).toBeInTheDocument()
  })

  it('the measured lift arrives WITH its direction, not as a bare number', async () => {
    const user = userEvent.setup()
    renderScreenerPage()
    await user.click(await libraryButton())
    expect(await screen.findByText('+7.35pp')).toBeInTheDocument()
    expect(screen.getByText('resolves upward')).toBeInTheDocument()
  })

  it('⛔⛔ the dialog it opens HAS A NAME — "dialog" alone names nothing', async () => {
    // This property belongs to the COMPOSITION and to nothing else, which is
    // why it is pinned here rather than in StructureProvenance.test.jsx.
    // `Sheet` renders `title` into a plain <div> and takes the dialog's name
    // from `ariaLabel` ALONE (`aria-label={ariaLabel || undefined}`,
    // Sheet.jsx L142 — no aria-labelledby wiring, exactly as its own header
    // comment states). ScannerShell passed only `title`, so an `aria-modal`
    // dialog opened with no accessible name at all: a screen reader announced
    // "dialog" and stopped, on the one panel in the screener whose entire job
    // is telling a member who said what.
    const user = userEvent.setup()
    renderScreenerPage()
    await user.click(await libraryButton())
    expect(await screen.findByRole('dialog', { name: 'Structure library' }))
      .toBeInTheDocument()
  })

  it('a failed route reports itself instead of rendering an EMPTY library', async () => {
    stubFetch(() => Promise.resolve({ ok: false, status: 503 }))
    const user = userEvent.setup()
    renderScreenerPage()
    await user.click(await libraryButton())
    expect(await screen.findByRole('alert')).toHaveTextContent(/503/)
  })
})

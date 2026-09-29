// TERM-039 — the Beta mark and the "Here today / Working on" strip.
//
// Every member-facing assertion reads RENDERED TEXT, never state (owner ruling
// 2026-09-09). The server derives the states (tests/test_feature_status.py); these rails
// prove the client says exactly what it was told — including "not available" when it was
// told nothing, which must never read as "nothing here".
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AuthContext } from '../../context/AuthContext'
import BetaMark from './BetaMark'
import FeatureStatusStrip from './FeatureStatusStrip'
import { readFeatureStatus, isPreview, FEATURE_STATUS_HREF } from './featureStatus'
import BreadthChartsV2 from '../../pages/breadth/v2/BreadthChartsV2'
import Support from '../../pages/Support'
import { expectNoAxeViolations } from '../../pages/journal-2-0/a11y/axeHarness'

const FLOW = { id: 'research_flow_tab_enabled', label: 'Flow tab', where: 'Research', state: 'released' }
const STACK = { id: 'breadth_dc_v2_2_enabled', label: 'Stacked chart panels', where: 'Breadth > Data Charts', state: 'preview' }
const GHOST = { id: 'ghost_enabled', label: 'Ghost feature', where: 'Nowhere', state: 'unknown' }

const status = (...features) => ({ measured: true, features })

function withAuth(ui, value) {
  return (
    <AuthContext.Provider value={value}>
      <MemoryRouter>{ui}</MemoryRouter>
    </AuthContext.Provider>
  )
}

describe('readFeatureStatus — what counts as measured', () => {
  it.each([
    ['no payload', undefined],
    ['no field (an older server)', { paid_equiv: true }],
    ['measured false', { feature_status: { measured: false, features: [] } }],
    ['features not a list', { feature_status: { measured: true, features: {} } }],
  ])('%s reads as NOT measured (null), never as an empty list', (_, payload) => {
    expect(readFeatureStatus(payload)).toBeNull()
  })

  it('keeps well-formed entries and drops the rest rather than inventing a name', () => {
    const got = readFeatureStatus({
      feature_status: {
        measured: true,
        features: [FLOW, { id: 'x', label: '', where: 'Research', state: 'released' },
          { id: 'y', label: 'Y', where: 'Z', state: 'off' }],
      },
    })
    expect(got).toEqual({ measured: true, features: [FLOW] })
  })

  it('isPreview answers only for a preview state', () => {
    expect(isPreview(status(STACK), [STACK.id])).toBe(true)
    expect(isPreview(status({ ...STACK, state: 'released' }), [STACK.id])).toBe(false)
    expect(isPreview(null, [STACK.id])).toBe(false)
  })
})

describe('BetaMark — at the point of use', () => {
  it('says Beta, and links to the strip, while the capability is an early preview', () => {
    render(withAuth(<BetaMark ids={[STACK.id]} />, { featureStatus: status(STACK) }))
    const mark = screen.getByTestId('beta-mark')
    expect(mark).toHaveTextContent('Beta')
    expect(mark).toHaveTextContent('turned on early for your account')
    expect(mark.getAttribute('href')).toBe(FEATURE_STATUS_HREF)
  })

  it('DISAPPEARS when the same capability reaches full rollout — no content edit', () => {
    const { rerender } = render(withAuth(<BetaMark ids={[STACK.id]} />, { featureStatus: status(STACK) }))
    expect(screen.getByText('Beta')).toBeInTheDocument()
    rerender(withAuth(<BetaMark ids={[STACK.id]} />, { featureStatus: status({ ...STACK, state: 'released' }) }))
    expect(screen.queryByText('Beta')).toBeNull()
  })

  it('makes no claim when status was not measured, and does not throw outside a provider', () => {
    render(withAuth(<BetaMark ids={[STACK.id]} />, { featureStatus: null }))
    expect(screen.queryByText('Beta')).toBeNull()
    render(<BetaMark ids={[STACK.id]} />)
    expect(screen.queryByText('Beta')).toBeNull()
  })
})

describe('FeatureStatusStrip — here today / working on', () => {
  it('says "not available" out loud when the server did not measure it — never "nothing here"', () => {
    render(withAuth(<FeatureStatusStrip />, { featureStatus: null }))
    expect(screen.getByTestId('feature-status-unmeasured')).toHaveTextContent(
      'Feature status is not available right now. That does not mean anything is switched off.')
    expect(screen.queryByText('Nothing is listed here yet.')).toBeNull()
    expect(screen.queryByText('Here today')).toBeNull()
  })

  it('puts each capability in the column its state names', () => {
    render(withAuth(<FeatureStatusStrip />, { featureStatus: status(FLOW, STACK, GHOST) }))
    const here = screen.getByTestId('feature-status-here')
    const working = screen.getByTestId('feature-status-working')
    expect(here).toHaveTextContent('Here today')
    expect(here).toHaveTextContent('Flow tab')
    expect(here).toHaveTextContent('Research')
    expect(here).not.toHaveTextContent('Stacked chart panels')
    expect(working).toHaveTextContent('Working on')
    expect(working).toHaveTextContent('Turned on early for your account. These may still change.')
    expect(within(working).getByText('Stacked chart panels')).toBeInTheDocument()
    expect(within(working).getByText('Beta')).toBeInTheDocument()
    expect(screen.getByTestId('feature-status-unknown')).toHaveTextContent('Status not measured: Ghost feature.')
  })

  it('says each column is empty in words when it is', () => {
    render(withAuth(<FeatureStatusStrip />, { featureStatus: status() }))
    expect(screen.getByTestId('feature-status-here')).toHaveTextContent('Nothing is listed here yet.')
    expect(screen.getByTestId('feature-status-working')).toHaveTextContent(
      'Nothing is in early access for your account right now.')
    expect(screen.queryByTestId('feature-status-unknown')).toBeNull()
  })

  it('follows a flip on the next payload: preview -> released moves the line, off removes it', () => {
    const { rerender } = render(withAuth(<FeatureStatusStrip />, { featureStatus: status(STACK) }))
    expect(within(screen.getByTestId('feature-status-working')).getByText('Stacked chart panels')).toBeInTheDocument()
    rerender(withAuth(<FeatureStatusStrip />, { featureStatus: status({ ...STACK, state: 'released' }) }))
    expect(within(screen.getByTestId('feature-status-here')).getByText('Stacked chart panels')).toBeInTheDocument()
    expect(screen.queryByText('Beta')).toBeNull()
    rerender(withAuth(<FeatureStatusStrip />, { featureStatus: status() }))
    expect(screen.queryByText('Stacked chart panels')).toBeNull()
  })

  it('has no axe violations when populated', async () => {
    const { container } = render(withAuth(<FeatureStatusStrip />, { featureStatus: status(FLOW, STACK, GHOST) }))
    await expectNoAxeViolations(container)
  })
})

describe('wired where members meet it', () => {
  const PAYLOAD = {
    from: '2026-06-01', to: '2026-06-03', sessions: 3,
    dates: ['2026-06-01', '2026-06-02', '2026-06-03'],
    series: { breadth_score: [41, 42, 43] }, reconstructed: [], missing: [],
  }
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (url === '/api/auth/faq-votes') return { ok: true, json: async () => ({ votes: [] }) }
      if (url === '/api/auth/tickets') return { ok: true, json: async () => [] }
      if (url === '/api/support/status') return { ok: true, json: async () => ({ status: 'operational', components: [] }) }
      return { ok: true, json: async () => PAYLOAD }
    }))
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('the Data Charts surface carries the Beta mark during the owner preview, and loses it at full rollout', async () => {
    const auth = (state) => ({ breadthDcV22Enabled: true, featureStatus: status({ ...STACK, state }) })
    const { rerender } = render(withAuth(
      <BreadthChartsV2 keys={['breadth_score']} from="2026-06-01" to="2026-06-03" />, auth('preview')))
    const root = await screen.findByTestId('breadth-charts-v2')
    expect(within(root).getByTestId('beta-mark')).toHaveTextContent('Beta')
    rerender(withAuth(
      <BreadthChartsV2 keys={['breadth_score']} from="2026-06-01" to="2026-06-03" />, auth('released')))
    expect(within(screen.getByTestId('breadth-charts-v2')).queryByTestId('beta-mark')).toBeNull()
  })

  it('the Support page shows the strip from the auth payload', async () => {
    render(withAuth(<Support />, {
      user: { id: 'u1', email: 'm@local.dev' }, plan: 'pro', isPaid: true,
      featureStatus: status(FLOW),
    }))
    const strip = await screen.findByTestId('feature-status')
    await waitFor(() => expect(strip).toHaveTextContent('Flow tab'))
    expect(strip).toHaveTextContent('Here today')
  })
})

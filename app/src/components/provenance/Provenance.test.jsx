// app/src/components/provenance/Provenance.test.jsx
//
// S8 Step 1's degraded state, extended in Step 2 with loading (§9.7),
// availability (§9.3/§16, orthogonal to freshness), and a real accessible
// detail disclosure for the present-provenance case.

import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Provenance from './Provenance'
import { NOT_FOUND, ENTITLEMENT_DENIED, PROVIDER_ERROR } from './availabilityContract'

afterEach(cleanup)

describe('the degraded state — no provenance record available', () => {
  it('renders the value AND an explicit "provenance unavailable" affordance', () => {
    render(<Provenance value="$505.24" provenance={null} />)
    expect(screen.getByTestId('provenance-degraded')).toHaveTextContent('$505.24')
    expect(screen.getByTestId('provenance-unavailable-note')).toHaveTextContent(/provenance unavailable/i)
  })

  it('never fabricates a receipt — no source/as-of text appears when provenance is null', () => {
    render(<Provenance value="42" provenance={null} calcVersion="v3" />)
    expect(screen.queryByText(/v3/)).toBeNull()
  })

  it('the value still renders even though provenance is unavailable — never a silently bare value either way', () => {
    render(<Provenance value="not fetched, but not hidden either" provenance={null} />)
    expect(screen.getByTestId('provenance-degraded')).toHaveTextContent('not fetched, but not hidden either')
  })
})

describe('the present-provenance state', () => {
  it('renders plainly, distinct from the degraded state', () => {
    render(<Provenance
      value="$505.24"
      provenance={{ sourceActivity: 'massive.get_quote', sourceEntity: null, timestamp: 1788393600 }}
    />)
    expect(screen.getByTestId('provenance-present')).toHaveTextContent('$505.24')
    expect(screen.queryByTestId('provenance-degraded')).toBeNull()
    expect(screen.queryByTestId('provenance-unavailable-note')).toBeNull()
  })

  it('has NO detail toggle when there is nothing to show (no sourceActivity/timestamp/calcVersion/tieBreak)', () => {
    render(<Provenance value="42" provenance={{}} />)
    expect(screen.queryByTestId('provenance-detail-toggle')).toBeNull()
  })
})

describe('the accessible detail disclosure (S8 Step 2)', () => {
  it('is closed by default, and aria-expanded reflects that', () => {
    render(<Provenance value="230.00" provenance={{ sourceActivity: 'fmp_client.get_quote' }} />)
    const toggle = screen.getByTestId('provenance-detail-toggle')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('provenance-detail-panel')).toBeNull()
  })

  it('a click opens the panel and shows source/as-of/calc detail', async () => {
    const user = userEvent.setup()
    render(<Provenance
      value="230.00"
      provenance={{ sourceActivity: 'fmp_client.get_quote', timestamp: 1788379201 }}
      calcVersion="v1"
    />)
    await user.click(screen.getByTestId('provenance-detail-toggle'))
    const panel = screen.getByTestId('provenance-detail-panel')
    expect(panel).toHaveTextContent('fmp_client.get_quote')
    expect(panel).toHaveTextContent(/Calc: v1/)
    expect(screen.getByTestId('provenance-detail-toggle')).toHaveAttribute('aria-expanded', 'true')
  })

  it('is keyboard-operable: Tab to focus, Enter to open — no mouse required', async () => {
    const user = userEvent.setup()
    render(<Provenance value="230.00" provenance={{ sourceActivity: 'massive.get_quote' }} />)
    await user.tab()
    expect(screen.getByTestId('provenance-detail-toggle')).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(screen.getByTestId('provenance-detail-panel')).toBeTruthy()
  })

  it('aria-controls on the toggle matches the panel id once open', async () => {
    const user = userEvent.setup()
    render(<Provenance value="x" provenance={{ sourceActivity: 'fmp_client.get_quote' }} />)
    const toggle = screen.getByTestId('provenance-detail-toggle')
    await user.click(toggle)
    const controls = toggle.getAttribute('aria-controls')
    expect(document.getElementById(controls)).toBe(screen.getByTestId('provenance-detail-panel'))
  })

  it('a second click closes the panel again', async () => {
    const user = userEvent.setup()
    render(<Provenance value="x" provenance={{ sourceActivity: 'fmp_client.get_quote' }} />)
    const toggle = screen.getByTestId('provenance-detail-toggle')
    await user.click(toggle)
    expect(screen.getByTestId('provenance-detail-panel')).toBeTruthy()
    await user.click(toggle)
    expect(screen.queryByTestId('provenance-detail-panel')).toBeNull()
  })
})

describe('loading (PRD-S8 §9.7)', () => {
  it('renders a distinct loading affordance, never the value and never a freshness-less blank', () => {
    render(<Provenance value="$505.24" loading />)
    expect(screen.getByTestId('provenance-loading')).toBeTruthy()
    expect(screen.queryByText('$505.24')).toBeNull()
    expect(screen.queryByTestId('provenance-present')).toBeNull()
    expect(screen.queryByTestId('provenance-degraded')).toBeNull()
  })

  it('loading takes precedence even when provenance is also given', () => {
    render(<Provenance value="x" provenance={{ sourceActivity: 'fmp_client.get_quote' }} loading />)
    expect(screen.getByTestId('provenance-loading')).toBeTruthy()
  })
})

describe('availability (PRD-S8 §9.3/§16) — orthogonal to freshness, never guessed', () => {
  it('NOT_FOUND renders a distinct, honest "no data" state', () => {
    render(<Provenance value={null} availability={NOT_FOUND} />)
    const el = screen.getByTestId('provenance-unavailable')
    expect(el.dataset.availability).toBe('not_found')
    expect(screen.getByTestId('availability-note')).toHaveTextContent(/no data/i)
  })

  it('ENTITLEMENT_DENIED renders a distinct state from NOT_FOUND', () => {
    render(<Provenance value={null} availability={ENTITLEMENT_DENIED} />)
    const el = screen.getByTestId('provenance-unavailable')
    expect(el.dataset.availability).toBe('entitlement_denied')
    expect(screen.getByTestId('availability-note')).not.toHaveTextContent(/no data/i)
  })

  it('PROVIDER_ERROR renders a third, distinct state', () => {
    render(<Provenance value={null} availability={PROVIDER_ERROR} />)
    expect(screen.getByTestId('provenance-unavailable').dataset.availability).toBe('provider_error')
  })

  it('the three unavailable states are pairwise distinct text', () => {
    const texts = [NOT_FOUND, ENTITLEMENT_DENIED, PROVIDER_ERROR].map((a) => {
      const { unmount } = render(<Provenance value={null} availability={a} />)
      const text = screen.getByTestId('availability-note').textContent
      unmount()
      return text
    })
    expect(new Set(texts).size).toBe(3)
  })

  it('AVAILABLE (the default) falls through to the normal degraded/present logic', () => {
    render(<Provenance value="$1.00" provenance={null} />)
    expect(screen.getByTestId('provenance-degraded')).toBeTruthy()
    expect(screen.queryByTestId('provenance-unavailable')).toBeNull()
  })
})

describe('density is accepted and threaded through, never changes which state renders', () => {
  it('the degraded state renders identically regardless of density', () => {
    render(<Provenance value="x" provenance={null} density="inline" />)
    expect(screen.getByTestId('provenance-degraded').dataset.density).toBe('inline')
  })
})

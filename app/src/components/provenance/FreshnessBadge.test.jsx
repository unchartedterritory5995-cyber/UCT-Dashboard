// app/src/components/provenance/FreshnessBadge.test.jsx
//
// Render-level counterpart to freshnessContract.test.js. Pins the owner's
// explicit "before FreshnessBadge live wiring" checklist at the component
// level: delayed_15/end_of_day never render as LIVE, historical never renders
// as an error, source-stale and session-stale never collapse into one state.

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import FreshnessBadge from './FreshnessBadge'

afterEach(cleanup)

describe('each D1 tier renders its own distinct label', () => {
  it('real_time renders LIVE', () => {
    render(<FreshnessBadge freshnessClass="real_time" />)
    expect(screen.getByTestId('freshness-tier')).toHaveTextContent('LIVE')
  })

  it('delayed_15 renders a delayed label and NEVER "LIVE"', () => {
    render(<FreshnessBadge freshnessClass="delayed_15" />)
    const tier = screen.getByTestId('freshness-tier')
    expect(tier).toHaveTextContent(/delayed/i)
    expect(tier).not.toHaveTextContent(/^LIVE$/)
    expect(tier.textContent).not.toBe('LIVE')
  })

  it('end_of_day renders its own label and is NEVER displayed as realtime', () => {
    render(<FreshnessBadge freshnessClass="end_of_day" />)
    const tier = screen.getByTestId('freshness-tier')
    expect(tier).toHaveTextContent(/end of day/i)
    expect(tier.dataset.freshnessTier).not.toBe('real_time')
  })

  it('historical renders plainly and is NOT treated as a freshness error', () => {
    render(<FreshnessBadge freshnessClass="historical" />)
    const tier = screen.getByTestId('freshness-tier')
    expect(tier).toHaveTextContent(/historical/i)
    expect(tier.dataset.sourceStale).toBe('false')
    expect(screen.queryByTestId('source-stale-note')).toBeNull()
  })

  it('D1 stale renders as SOURCE staleness, with the source-stale note present', () => {
    render(<FreshnessBadge freshnessClass="stale" />)
    expect(screen.getByTestId('freshness-tier')).toHaveTextContent(/source/i)
    expect(screen.getByTestId('source-stale-note')).toBeTruthy()
    expect(screen.queryByTestId('session-stale-note')).toBeNull()
  })
})

describe('absence/unknown freshness follows the spec, never a guess', () => {
  it('freshnessClass=null renders an honest unknown state, not LIVE and not a throw', () => {
    render(<FreshnessBadge freshnessClass={null} />)
    const tier = screen.getByTestId('freshness-tier')
    expect(tier.dataset.freshnessTier).toBe('unknown')
    expect(tier).not.toHaveTextContent('LIVE')
  })

  it('an unrecognized freshnessClass throws rather than silently rendering something', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<FreshnessBadge freshnessClass="not_a_real_value" />)).toThrow()
    spy.mockRestore()
  })
})

describe('source staleness and session staleness never collapse into one render', () => {
  it('source-stale alone renders only the source-stale note', () => {
    render(<FreshnessBadge freshnessClass="stale" sessionStale={false} />)
    expect(screen.getByTestId('source-stale-note')).toBeTruthy()
    expect(screen.queryByTestId('session-stale-note')).toBeNull()
  })

  it('session-stale alone (on an otherwise fresh value) renders only the session-stale note', () => {
    render(<FreshnessBadge freshnessClass="real_time" sessionStale />)
    expect(screen.queryByTestId('source-stale-note')).toBeNull()
    expect(screen.getByTestId('session-stale-note')).toBeTruthy()
  })

  it('BOTH can be true at once, and they render as two independent, distinctly-labeled notes', () => {
    render(<FreshnessBadge freshnessClass="stale" sessionStale />)
    const sourceNote = screen.getByTestId('source-stale-note')
    const sessionNote = screen.getByTestId('session-stale-note')
    expect(sourceNote).toBeTruthy()
    expect(sessionNote).toBeTruthy()
    // ⛔ THE ASSERTION THIS FILE EXISTS FOR: not the same node, not the same text.
    expect(sourceNote).not.toBe(sessionNote)
    expect(sourceNote.textContent).not.toBe(sessionNote.textContent)
  })
})

describe('the delayed-data disclosure (PRD-S8 §9.4/§10.3)', () => {
  it('renders for delayed_15', () => {
    render(<FreshnessBadge freshnessClass="delayed_15" />)
    expect(screen.getByTestId('freshness-disclosure')).toBeTruthy()
  })

  it('does not render for real_time', () => {
    render(<FreshnessBadge freshnessClass="real_time" />)
    expect(screen.queryByTestId('freshness-disclosure')).toBeNull()
  })

  it('a custom disclosureText overrides the default string', () => {
    render(<FreshnessBadge freshnessClass="delayed_15" disclosureText="Custom Del-15 Notice" />)
    expect(screen.getByTestId('freshness-disclosure')).toHaveTextContent('Custom Del-15 Notice')
  })
})

describe('session context is rendered separately from source freshness', () => {
  it('sessionState.label renders as its own element, distinct from the tier', () => {
    render(<FreshnessBadge freshnessClass="real_time" sessionState={{ label: 'MARKET OPEN', tone: 'open' }} />)
    expect(screen.getByTestId('freshness-session-context')).toHaveTextContent('MARKET OPEN')
    expect(screen.getByTestId('freshness-tier')).toHaveTextContent('LIVE')
  })

  it('no sessionState prop renders no session-context element', () => {
    render(<FreshnessBadge freshnessClass="real_time" />)
    expect(screen.queryByTestId('freshness-session-context')).toBeNull()
  })
})

describe('composite freshness (PRD-S8 §9.5 — delayed price, live volume)', () => {
  it('renders one distinct tier per field, never collapsed to a single freshness', () => {
    render(<FreshnessBadge fields={[
      { label: 'price', freshnessClass: 'delayed_15' },
      { label: 'volume', freshnessClass: 'real_time' },
    ]} />)
    const priceTier = screen.getByTestId('freshness-tier-0')
    const volumeTier = screen.getByTestId('freshness-tier-1')
    expect(priceTier).toHaveTextContent(/delayed/i)
    expect(volumeTier).toHaveTextContent('LIVE')
    expect(priceTier).not.toHaveTextContent('LIVE')
  })
})

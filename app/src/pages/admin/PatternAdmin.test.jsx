import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import PatternAdmin from './PatternAdmin'

// Packet Y CP1 (signed 2026-09-23, fingerprint 4007862bd) — covers the new
// `/api/admin/patterns/health` stat cards. Same swr-mock-by-URL idiom as
// PatternReview.test.jsx in this directory.

const RECENT_PAYLOAD = { detections: [], count: 3, reviewed_count: 1, accept_rate_pct: 90 }
const HEALTH_PAYLOAD = {
  detector_count: 12,
  stored_detections_total: 481,
  recent_24h_count: 7,
  last_detected_at: 1758000000,
}

let recentData = RECENT_PAYLOAD
let healthData = HEALTH_PAYLOAD

vi.mock('swr', () => ({
  default: (key) => {
    if (typeof key === 'string' && key.includes('/patterns/health')) {
      return { data: healthData, error: undefined, isLoading: false, mutate: vi.fn() }
    }
    if (typeof key === 'string' && key.includes('/patterns/recent')) {
      return { data: recentData, error: undefined, isLoading: false, mutate: vi.fn() }
    }
    return { data: undefined, error: undefined, isLoading: false, mutate: vi.fn() }
  },
}))

beforeEach(() => {
  recentData = RECENT_PAYLOAD
  healthData = HEALTH_PAYLOAD
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))
})

describe('PatternAdmin — Packet Y CP1 engine health stats', () => {
  it('renders the four health stat cards from /api/admin/patterns/health', () => {
    render(<PatternAdmin />)
    expect(screen.getByText('Detectors', { selector: 'label' })).toBeTruthy()
    expect(screen.getByText('12')).toBeTruthy()
    expect(screen.getByText('Stored detections', { selector: 'label' })).toBeTruthy()
    expect(screen.getByText('481')).toBeTruthy()
    // "Last 24h" also names an <option> in the Window filter select — scope
    // to the stat <label> so the two do not collide.
    expect(screen.getByText('Last 24h', { selector: 'label' })).toBeTruthy()
    expect(screen.getByText('7')).toBeTruthy()
    expect(screen.getByText('Last detected', { selector: 'label' })).toBeTruthy()
    expect(screen.getByText('1758000000')).toBeTruthy()
  })

  it('degrades to em-dashes when the health endpoint has not answered yet', () => {
    healthData = undefined
    render(<PatternAdmin />)
    expect(screen.getByText('Detectors', { selector: 'label' }).nextSibling.textContent).toBe('—')
    expect(screen.getByText('Stored detections', { selector: 'label' }).nextSibling.textContent).toBe('—')
    expect(screen.getByText('Last 24h', { selector: 'label' }).nextSibling.textContent).toBe('—')
    expect(screen.getByText('Last detected', { selector: 'label' }).nextSibling.textContent).toBe('—')
  })

  it('leaves the existing /recent feed and stat strip untouched', () => {
    render(<PatternAdmin />)
    expect(screen.getByText('Pattern Verification')).toBeTruthy()
    expect(screen.getByText('Detections')).toBeTruthy()
    expect(screen.getByText('Reviewed')).toBeTruthy()
    expect(screen.getByText('Accept Rate')).toBeTruthy()
  })
})

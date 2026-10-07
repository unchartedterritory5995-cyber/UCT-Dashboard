import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import VoiceTelemetryPanel from './VoiceTelemetryPanel'

// GET /api/voice/cost answers 200 either way: the figures, or
// {available: false, message, <every figure null>} when usage cannot be read.

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function answerCostWith(cost) {
  vi.stubGlobal('fetch', vi.fn((url) => {
    const u = String(url)
    if (u.includes('/api/voice/cost')) return Promise.resolve({ ok: true, json: async () => cost })
    if (u.includes('/api/voice/reward/variants')) return Promise.resolve({ ok: false, status: 404 })
    return Promise.resolve({ ok: true, json: async () => ({}) })
  }))
}

const FIGURES = {
  available: true,
  month_to_date_usd: 1.23, projected_month_usd: 4.5, days_elapsed: 7, days_in_month: 31, daily_rate_usd: 0.18,
  breakdown: {
    mode_c_realtime: { cost_usd: 1.0, sessions: 2, minutes: 12.5 },
    mode_a_tts: { cost_usd: 0.2, seconds: 300 },
    mode_b_oneshot: { cost_usd: 0.03, calls: 15 },
  },
}

describe('VoiceTelemetryPanel: the cost block', () => {
  it('shows the figures when the server has them', async () => {
    answerCostWith(FIGURES)
    render(<VoiceTelemetryPanel />)
    await waitFor(() => expect(screen.getByText('$1.23')).toBeTruthy())
  })

  it('says usage is not available, and does not break, when the server could not read it', async () => {
    answerCostWith({
      available: false, message: 'Voice usage is not available right now.',
      month_to_date_usd: null, projected_month_usd: null, days_elapsed: null,
      days_in_month: null, daily_rate_usd: null, breakdown: null,
    })
    render(<VoiceTelemetryPanel />)
    await waitFor(() => expect(screen.getByText('Voice usage is not available right now.')).toBeTruthy())
    expect(screen.queryByText('Month-to-date')).toBeNull()
  })
})

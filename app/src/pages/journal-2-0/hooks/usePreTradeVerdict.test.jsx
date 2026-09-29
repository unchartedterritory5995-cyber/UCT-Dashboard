// The daily verdict limit (429) must reach the member as its own sentence; every
// other failure keeps the generic line. Asserted by RENDERED TEXT through the real
// card, never by hook state alone.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import usePreTradeVerdict from './usePreTradeVerdict'
import PreTradeVerdictCard from '../components/PreTradeVerdictCard'

const LIMIT = "You've hit today's limit for pre-trade verdicts — it resets at midnight ET."
const GENERIC = "Compass couldn't grade this trade. Try again."

function Harness() {
  const { run, verdict, isLoading, error } = usePreTradeVerdict('acct-1')
  return (
    <div>
      <button onClick={() => run({ symbol: 'NVDA' })}>grade</button>
      <PreTradeVerdictCard verdict={verdict} isLoading={isLoading} error={error} />
    </div>
  )
}

function respond(status, body) {
  globalThis.fetch = vi.fn(async () => ({
    ok: false, status, json: async () => body,
  }))
}

afterEach(() => { vi.restoreAllMocks() })

describe('usePreTradeVerdict error copy', () => {
  it('shows the limit sentence on a 429', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    respond(429, { detail: LIMIT })
    render(<Harness />)
    fireEvent.click(screen.getByText('grade'))
    await waitFor(() => expect(screen.getByText(/resets at midnight ET/)).toBeTruthy())
    expect(screen.queryByText(new RegExp(GENERIC.slice(0, 20)))).toBeNull()
  })

  it('keeps the generic line for any other failure, detail or not', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    respond(500, { detail: 'Traceback (most recent call last): boom' })
    render(<Harness />)
    fireEvent.click(screen.getByText('grade'))
    await waitFor(() => expect(screen.getByText(/couldn't grade this trade/)).toBeTruthy())
    expect(screen.queryByText(/Traceback/)).toBeNull()
  })
})

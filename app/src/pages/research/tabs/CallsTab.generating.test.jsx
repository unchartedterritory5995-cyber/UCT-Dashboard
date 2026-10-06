// TRAN: the "Writing the recap now ... this panel updates on its own" copy was not true —
// nothing re-asked. The tab now re-asks while the recap is being written.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { SWRConfig } from 'swr'

vi.mock('../../../components/calendar/SentimentGauge', () => ({ default: () => null }))
vi.mock('../../../components/calendar/TranscriptPanel', () => ({ default: () => null }))
vi.mock('../../../components/calendar/CallRecapSection', () => ({ default: ({ recap }) => <div>recap:{recap?.recap?.headline}</div> }))
vi.mock('../hooks/useEarningsAudio', () => ({ default: () => ({ data: null }) }))
import CallsTab from './CallsTab'
import { PENDING_REASK_MS } from '../depth/depthFetch'

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('a recap being written', () => {
  it('re-asks by itself and shows the recap once it lands', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let body = { recap: null, recap_status: 'generating' }
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: async () => body })))
    render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><CallsTab sym="nvda" /></SWRConfig>)
    expect((await screen.findByTestId('call-recap-empty')).textContent).toMatch(/Writing the recap now/)
    body = { recap: { headline: 'Beat and raise' }, recap_status: 'ok' }
    await act(async () => { await vi.advanceTimersByTimeAsync(PENDING_REASK_MS + 50) })
    expect(await screen.findByText('recap:Beat and raise')).toBeInTheDocument()
  })
})

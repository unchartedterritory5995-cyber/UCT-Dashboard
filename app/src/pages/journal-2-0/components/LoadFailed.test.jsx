// app/src/pages/journal-2-0/components/LoadFailed.test.jsx
//
// ⛔⛔ Wave 10 follow-up F7, Part A (clause 5d: every failure a member can see is said). The ONE
// shared "this didn't load" element, rendered: the sentence a failed read shows, in each of its
// three voices, and that "Try again" really asks again -- over a real SWR read that fails once
// and then answers, so the data the sentence stood in for appears.
//
// Asserted by RENDERED TEXT (CLAUDE.md: user-facing feedback is never asserted by state).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import useSWR, { SWRConfig } from 'swr'
import LoadFailed, { SaveFailed, isNetworkFailure, loadFailedSentence } from './LoadFailed'

const serverError = () => new Error('500')
const networkError = () => new TypeError('Failed to fetch')

afterEach(() => {
  vi.restoreAllMocks()
})

describe('LoadFailed -- the sentence', () => {
  it('a server fault: "Couldn\'t load <what>." and a Try again', () => {
    render(<LoadFailed what="your folders" error={serverError()} onRetry={() => {}} />)
    expect(screen.getByRole('status')).toHaveTextContent("Couldn't load your folders.")
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('a request that never got an answer says the server could not be reached, not "error"', () => {
    render(<LoadFailed what="your tags" error={networkError()} onRetry={() => {}} />)
    expect(screen.getByRole('status')).toHaveTextContent("Couldn't reach the server to load your tags.")
    expect(screen.getByRole('status').textContent).not.toMatch(/error/i)
  })

  it('OFFLINE says offline', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    render(<LoadFailed what="this note's attachments" error={networkError()} onRetry={() => {}} />)
    expect(screen.getByRole('status')).toHaveTextContent("You're offline, so this note's attachments didn't load.")
  })

  // F7 fix round 1 (review M1): async, and it waits for the retry to SETTLE (the button reads
  // "Try again" and is enabled again) -- the synchronous version let retry()'s final setState land
  // after the test returned, outside act().
  it('several failures are ONE sentence naming each, and one Try again that asks every one', async () => {
    const a = vi.fn()
    const b = vi.fn()
    render(<LoadFailed failures={[
      { what: 'your folders', error: serverError(), retry: a },
      { what: 'your favorites', error: null, retry: vi.fn() },
      { what: 'your tags', error: serverError(), retry: b },
    ]} />)
    expect(screen.getAllByRole('status')).toHaveLength(1)
    expect(screen.getByRole('status')).toHaveTextContent("Couldn't load your folders and your tags.")
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled())
  })

  it('CONTROL: nothing failed, nothing rendered (it never stands in for data that loaded)', () => {
    const { container } = render(<LoadFailed failures={[{ what: 'your folders', error: null }]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('no codes and no raw error text reach the member', () => {
    const e = new Error('sqlite3.OperationalError: database is locked')
    render(<LoadFailed what="your folders" error={e} onRetry={() => {}} />)
    expect(screen.getByRole('status').textContent).not.toMatch(/sqlite|locked|500|Error/)
  })

  it('the pure helpers agree with what renders', () => {
    expect(isNetworkFailure(new TypeError('x'))).toBe(true)
    expect(isNetworkFailure(new Error('x'))).toBe(false)
    expect(loadFailedSentence([{ what: 'x', error: null }])).toBe('')
  })
})

/** A real SWR consumer: the shape every wired panel has. */
function Panel({ fetcher }) {
  const { data, error, mutate } = useSWR('/api/j2/probe-list', fetcher, { shouldRetryOnError: false })
  return (
    <div>
      <LoadFailed what="your probe list" error={error} onRetry={() => mutate()} />
      {data && <ul aria-label="probe list">{data.items.map((i) => <li key={i}>{i}</li>)}</ul>}
    </div>
  )
}

describe('LoadFailed -- Try again asks again', () => {
  it('a failed read shows the sentence; Try again refetches; the data replaces the sentence', async () => {
    let calls = 0
    const fetcher = vi.fn(async () => {
      calls += 1
      if (calls === 1) throw new Error('500')
      return { items: ['alpha', 'beta'] }
    })
    render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><Panel fetcher={fetcher} /></SWRConfig>)
    expect(await screen.findByText("Couldn't load your probe list.")).toBeInTheDocument()
    expect(fetcher).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('list', { name: 'probe list' })).toHaveTextContent('alphabeta')
    expect(fetcher).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(screen.queryByText("Couldn't load your probe list.")).toBeNull())
  })
})

describe('SaveFailed -- a write that did not land', () => {
  it('is an alert that STAYS (no timer takes it away) until Dismiss', async () => {
    vi.useFakeTimers()
    try {
      const onDismiss = vi.fn()
      const { rerender } = render(<SaveFailed message="Couldn't add that tag. Nothing changed." onDismiss={onDismiss} />)
      expect(screen.getByRole('alert')).toHaveTextContent("Couldn't add that tag. Nothing changed.")
      vi.advanceTimersByTime(10_000)
      expect(screen.getByRole('alert')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
      expect(onDismiss).toHaveBeenCalled()
      rerender(<SaveFailed message={null} onDismiss={onDismiss} />)
      expect(screen.queryByRole('alert')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})

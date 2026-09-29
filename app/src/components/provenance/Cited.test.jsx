// app/src/components/provenance/Cited.test.jsx
//
// SPEC-S8 §4.5's narrow interim form: buildable now against bar_provenance
// .py's actual shape, without waiting on D2. Never fabricates a recursive
// inputs graph the backend does not supply.

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Cited from './Cited'

afterEach(cleanup)

describe('no row — the honest degraded state', () => {
  it('renders the child value AND an explicit "citation unavailable" note', () => {
    render(<Cited row={null}><span>230.00</span></Cited>)
    expect(screen.getByTestId('cited-unavailable')).toHaveTextContent('230.00')
    expect(screen.getByTestId('cited-unavailable-note')).toHaveTextContent(/citation unavailable/i)
  })
})

describe('the bar-shaped row (today\'s real data source)', () => {
  const row = {
    ticker: 'AAPL', tf: 'D', bar_time: 1788307200,
    source: 'massive', validated_at: 1788393600, verified_at: null,
  }

  it('renders the value plainly plus a toggle, closed by default', () => {
    render(<Cited row={row}><span>230.00</span></Cited>)
    expect(screen.getByTestId('cited-present')).toHaveTextContent('230.00')
    expect(screen.getByTestId('cited-toggle')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('cited-panel')).toBeNull()
  })

  it('opening the panel shows ticker/tf, source, and validated-at — one level deep, no inputs graph', async () => {
    const user = userEvent.setup()
    render(<Cited row={row}><span>230.00</span></Cited>)
    await user.click(screen.getByTestId('cited-toggle'))
    const panel = screen.getByTestId('cited-panel')
    expect(panel).toHaveTextContent('AAPL · D')
    expect(panel).toHaveTextContent(/Source: massive/)
  })

  it('an unverified bar honestly says so — a real state, not an error', async () => {
    const user = userEvent.setup()
    render(<Cited row={row}><span>230.00</span></Cited>)
    await user.click(screen.getByTestId('cited-toggle'))
    expect(screen.getByTestId('cited-unverified-note')).toBeTruthy()
    expect(screen.getByTestId('cited-panel')).toHaveTextContent(/not yet verified/i)
  })

  it('a verified bar reports reconciliation positively, and shows no unverified note', async () => {
    const user = userEvent.setup()
    const verifiedRow = { ...row, verified_at: 1788393700 }
    render(<Cited row={verifiedRow}><span>230.00</span></Cited>)
    await user.click(screen.getByTestId('cited-toggle'))
    expect(screen.getByTestId('cited-panel')).toHaveTextContent(/Reconciliation: verified/)
    expect(screen.queryByTestId('cited-unverified-note')).toBeNull()
  })

  it('is keyboard-operable: Tab to focus, Enter to open', async () => {
    const user = userEvent.setup()
    render(<Cited row={row}><span>230.00</span></Cited>)
    await user.tab()
    expect(screen.getByTestId('cited-toggle')).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(screen.getByTestId('cited-panel')).toBeTruthy()
  })
})

describe('a uctUri-shaped row (forward-compatible, D2-gated full form not built)', () => {
  it('renders without crashing and shows the address, never a fabricated inputs graph', async () => {
    const user = userEvent.setup()
    render(<Cited row={{ uctUri: 'uct://breadth/pct_above_50sma@2026-09-02' }}><span>62%</span></Cited>)
    await user.click(screen.getByTestId('cited-toggle'))
    expect(screen.getByTestId('cited-panel')).toHaveTextContent('uct://breadth/pct_above_50sma@2026-09-02')
    expect(screen.queryByTestId('cited-unverified-note')).toBeNull()
  })
})

describe('a checked-claim row (TERM-060) — only a verified check reads as cited', () => {
  const uctUri = 'uct://breadth_snapshot_numeric.breadth_score/D?as_of=2026-09-25'
  const check = (over = {}) => ({
    verdict: 'verified', reason: 'match', status: 'resolved',
    resolved_value: 72.4, resolved_as_of: '2026-09-25', ...over,
  })

  it('verified: the figure renders with a toggle and NO note; the panel names the address and the check', async () => {
    const user = userEvent.setup()
    render(<Cited row={{ uctUri, check: check() }}><span>72.4</span></Cited>)
    const el = screen.getByTestId('cited-claim')
    expect(el).toHaveAttribute('data-verdict', 'verified')
    expect(el.textContent).toBe('72.4')
    expect(screen.queryByTestId('cited-check-note')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Show citation detail' }))
    const panel = screen.getByTestId('cited-panel')
    expect(panel).toHaveTextContent(`Address: ${uctUri}`)
    expect(panel).toHaveTextContent('Stored value: 72.4 (2026-09-25)')
    expect(panel).toHaveTextContent('Checked: the stated figure matches the stored value')
  })

  it('mismatch: the page itself says "does not match the stored record" — before any click', async () => {
    const user = userEvent.setup()
    render(<Cited row={{ uctUri, check: check({ verdict: 'mismatch', reason: 'value_differs', resolved_value: 71.9 }) }}>
      <span>77.4</span></Cited>)
    expect(screen.getByTestId('cited-check-note').textContent).toBe('does not match the stored record')
    await user.click(screen.getByTestId('cited-toggle'))
    expect(screen.getByTestId('cited-panel')).toHaveTextContent('Stored value: 71.9 (2026-09-25)')
    expect(screen.getByTestId('cited-panel'))
      .toHaveTextContent('Checked: the stated figure does not match the stored value')
  })

  it('a value from another session is named as such', async () => {
    const user = userEvent.setup()
    render(<Cited row={{ uctUri, check: check({ verdict: 'mismatch', reason: 'as_of_differs', resolved_as_of: '2026-09-24' }) }}>
      <span>72.4</span></Cited>)
    await user.click(screen.getByTestId('cited-toggle'))
    expect(screen.getByTestId('cited-panel')).toHaveTextContent('Checked: the stored value is from a different session')
  })

  it.each([
    ['not_computable', 'Not checked: the stored value could not be read'],
    ['empty', 'Not checked: nothing is stored for that session'],
    ['unknown_metric', 'Not checked: the address names no declared figure'],
    ['unresolved_entity', 'Not checked: the address names no known instrument'],
  ])('an unresolvable pointer (%s) is never shown as verified', async (status, line) => {
    const user = userEvent.setup()
    render(<Cited row={{ uctUri, check: check({ verdict: 'unverified', reason: 'not_resolved', status, resolved_value: null }) }}>
      <span>72.4</span></Cited>)
    expect(screen.getByTestId('cited-claim')).toHaveAttribute('data-verdict', 'unverified')
    expect(screen.getByTestId('cited-check-note').textContent).toBe('not verified')
    await user.click(screen.getByTestId('cited-toggle'))
    expect(screen.getByTestId('cited-panel')).toHaveTextContent(line)
    expect(screen.getByTestId('cited-panel')).not.toHaveTextContent(/Stored value/)
  })

  it('a verdict it does not know is treated as unverified, never as verified', () => {
    render(<Cited row={{ uctUri, check: check({ verdict: 'VERIFIED!' }) }}><span>72.4</span></Cited>)
    expect(screen.getByTestId('cited-claim')).toHaveAttribute('data-verdict', 'unverified')
    expect(screen.getByTestId('cited-check-note').textContent).toBe('not verified')
  })

  it('CONTROL: a uctUri row with no check still renders the pre-TERM-060 way', () => {
    render(<Cited row={{ uctUri }}><span>72.4</span></Cited>)
    expect(screen.getByTestId('cited-present')).toBeTruthy()
    expect(screen.queryByTestId('cited-claim')).toBeNull()
  })
})

describe('a transcript-span row (TERM-044) — the passage itself, one click away', () => {
  const transcript = {
    segment: 2, start: 186, end: 229, speaker: 'Josh D’Amaro',
    text: 'Total segment operating income came in ahead',
  }

  it('closed by default: the value renders, the passage does not', () => {
    render(<Cited row={{ transcript }}><span>OI up 21%</span></Cited>)
    expect(screen.getByTestId('cited-present')).toHaveTextContent('OI up 21%')
    expect(screen.getByTestId('cited-toggle')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('cited-passage')).toBeNull()
  })

  it('opening it shows the passage verbatim and names the speaker — no bar-row fields', async () => {
    const user = userEvent.setup()
    render(<Cited row={{ transcript }}><span>OI up 21%</span></Cited>)
    await user.click(screen.getByRole('button', { name: 'Show the transcript passage this point comes from' }))
    expect(screen.getByTestId('cited-passage').textContent).toBe(transcript.text)
    const panel = screen.getByTestId('cited-panel')
    expect(panel).toHaveTextContent('From the call transcript · Josh D’Amaro')
    expect(panel).not.toHaveTextContent(/Reconciliation|Source:/)
  })

  it('an unnamed turn is labelled as such, never left blank', async () => {
    const user = userEvent.setup()
    render(<Cited row={{ transcript: { ...transcript, speaker: '' } }}><span>x</span></Cited>)
    await user.click(screen.getByTestId('cited-toggle'))
    expect(screen.getByTestId('cited-panel')).toHaveTextContent('From the call transcript · Unattributed speaker')
  })

  it('offers "Show in full transcript" only when the surface can go there, and hands back the span', async () => {
    const user = userEvent.setup()
    const onOpenSource = vi.fn()
    const { unmount } = render(<Cited row={{ transcript }} onOpenSource={onOpenSource}><span>x</span></Cited>)
    await user.click(screen.getByTestId('cited-toggle'))
    await user.click(screen.getByTestId('cited-open-source'))
    expect(onOpenSource).toHaveBeenCalledWith(transcript)
    unmount()
    render(<Cited row={{ transcript }}><span>x</span></Cited>)
    await user.click(screen.getByTestId('cited-toggle'))
    expect(screen.queryByTestId('cited-open-source')).toBeNull()
  })

  it('is keyboard-operable: Tab to focus, Enter to open', async () => {
    const user = userEvent.setup()
    render(<Cited row={{ transcript }}><span>x</span></Cited>)
    await user.tab()
    expect(screen.getByTestId('cited-toggle')).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(screen.getByTestId('cited-passage')).toBeTruthy()
  })
})

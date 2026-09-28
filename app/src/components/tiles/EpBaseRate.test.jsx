// TERM-090 -- the episodic-pivot base rate, beside the flag. Rails:
//   * the number on screen is the payload's number (move the payload, the
//     text moves -- a typed rate cannot pass two payloads);
//   * n and the window render beside it every time a payload is present;
//   * a thin payload renders "not enough history" with n and the floor, and
//     no percentage anywhere;
//   * the EP label never renders on an earnings gapper.
import { render, screen } from '@testing-library/react'
import { EpFlagChip, isEarningsGapper, isEpSetup } from './EpBaseRate'

const payload = (over = {}) => ({
  ok: true, setup: 'EP', label: 'Episodic Pivot',
  resolved: 447, followed_through: 76, unresolved: 27,
  window: { start: '2026-02-20', end: '2026-09-25' },
  min_resolved: 30, thin: false, rate_pct: 17.0,
  definition: 'Share of resolved EP flags...',
  ...over,
})

const newsRow = { catalyst_type: 'Contract' }
const newsSignals = { earnings_meta: null }

test('the rendered rate is the payload rate, with n and the window beside it', () => {
  const { container, rerender } = render(<EpFlagChip row={newsRow} rs={newsSignals} data={payload()} />)
  const first = container.textContent
  expect(first).toContain('Episodic Pivot')
  expect(first).toContain('17%')
  expect(first).toContain('76 of 447')
  expect(first).toContain('2026-02-20')
  expect(first).toContain('2026-09-25')

  rerender(<EpFlagChip row={newsRow} rs={newsSignals}
    data={payload({ resolved: 60, followed_through: 30, rate_pct: 50.0,
                    window: { start: '2026-03-02', end: '2026-04-01' } })} />)
  const second = container.textContent
  expect(second).toContain('50%')
  expect(second).toContain('30 of 60')
  expect(second).toContain('2026-03-02')
  expect(second).not.toContain('17%')
})

test('a thin sample says not enough history, shows n and the floor, and no percentage', () => {
  const { container } = render(<EpFlagChip row={newsRow} rs={newsSignals}
    data={payload({ resolved: 5, followed_through: 3, thin: true, rate_pct: null,
                    window: { start: '2026-03-02', end: '2026-03-03' } })} />)
  const t = container.textContent
  expect(t).toMatch(/not enough history/i)
  expect(t).toContain('n=5')
  expect(t).toContain('30')
  expect(t).toContain('2026-03-02')
  expect(t).not.toMatch(/\d%/)
})

test('an empty record is not enough history with n=0, never 0%', () => {
  const { container } = render(<EpFlagChip row={newsRow} rs={newsSignals}
    data={payload({ resolved: 0, followed_through: 0, thin: true, rate_pct: null,
                    window: { start: null, end: null } })} />)
  expect(container.textContent).toContain('n=0')
  expect(container.textContent).not.toMatch(/\d%/)
})

test('no payload (loading, 402, pack missing) renders the label and no number', () => {
  for (const data of [undefined, { ok: false, reason: 'brain pack not installed' }]) {
    const { container, unmount } = render(<EpFlagChip row={newsRow} rs={newsSignals} data={data} />)
    expect(container.textContent).toContain('Episodic Pivot')
    expect(container.textContent).not.toMatch(/\d/)
    unmount()
  }
})

test('the EP label never renders on an earnings gapper', () => {
  const cases = [
    [{ catalyst_type: 'Earnings' }, {}],
    [{ catalyst_type: 'Contract' }, { earnings_meta: { reported_recently: true } }],
  ]
  for (const [row, rs] of cases) {
    expect(isEarningsGapper(row, rs)).toBe(true)
    const { container, unmount } = render(<EpFlagChip row={row} rs={rs} data={payload()} />)
    expect(container.textContent).not.toMatch(/Episodic Pivot|\bEP\b/)
    unmount()
  }
  expect(isEarningsGapper(newsRow, { earnings_meta: { reported_recently: false } })).toBe(false)
})

test('the definition and the unresolved count travel in the title', () => {
  render(<EpFlagChip row={newsRow} rs={newsSignals} data={payload()} />)
  const el = screen.getByTestId('ep-base-rate')
  expect(el.getAttribute('title')).toContain('Share of resolved EP flags')
  expect(el.getAttribute('title')).toContain('27')
})

test('the stored grade key EP and the name Episodic Pivot are both the EP flag; PEG is not', () => {
  // The engine resolves "Episodic Pivot" to its template key before the grade
  // is stored, so live rows carry `EP` -- matching only the long name would
  // leave the old setup_performance % on every real EP row.
  for (const s of ['EP', 'Episodic Pivot', 'episodic-pivot']) expect(isEpSetup(s)).toBe(true)
  for (const s of ['PEG', 'Power Earnings Gap', 'Remount', '', null]) expect(isEpSetup(s)).toBe(false)
})

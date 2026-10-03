// G-040 ruling 2 — the COT positioning rail's "Save to Notebook" control, in the
// REAL rail. The send is the one seam mocked: the capture it is handed is the thing
// under test; the send path is railed by lib/offline/doorFamilies.settle.test.jsx.
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRef } from 'react'
import PositioningRail from './PositioningRail'
import { composeWeek } from './cotCompose'
import { buildCotCapture } from './cotNotebookCapture'
import { normalizeParams, validateParams, isReconstructable } from '../../widgets/registry'

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn(async () => 'ES COT positioning sent to “Plan”') }))
vi.mock('../journal-2-0/lib/sendToJournal', () => ({ sendCaptureToJournal: sendMock }))

// The rail's own fixture shape (PositioningRail.test.jsx `mkRows`): commercials
// climb to a 3-year max long on the last week, large specs to a max short.
function mkRows(n = 200) {
  const out = []
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(2022, 0, 4 + i * 7))
    out.push({
      date: d.toISOString().slice(0, 10),
      commercial_net: -200_000 + i * 1_000,
      large_spec_net: 150_000 - i * 800,
      small_spec_net: 20_000 + (i % 7) * 1_000,
      open_interest: 1_800_000 + i * 1_500,
    })
  }
  return out
}

beforeEach(() => {
  sendMock.mockClear()
  global.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) }))
})

describe('COT rail — Save to Notebook (G-040)', () => {
  it('is a real, named button that freezes the LATEST week exactly as the rail shows it', async () => {
    const rows = mkRows()
    render(<PositioningRail rows={rows} symbol="ES" name="S&P 500 E-Mini" />)
    const btn = screen.getByRole('button', { name: 'Save ES COT positioning for the week of 10/28/2025 to Notebook' })
    expect(btn.tagName).toBe('BUTTON')
    expect(btn.getAttribute('type')).toBe('button')

    fireEvent.click(btn)
    await waitFor(() => expect(sendMock).toHaveBeenCalledTimes(1))
    const [widgetId, capture, opts] = sendMock.mock.calls[0]
    expect(widgetId).toBe('cot')
    expect(opts).toEqual({ label: 'ES COT positioning' })

    // The figures are the rail's OWN composition for that week — derived, not retyped…
    const { snap, read } = composeWeek(rows, rows.length - 1, { symbol: 'ES', name: 'S&P 500 E-Mini' })
    expect(capture).toEqual(buildCotCapture({ symbol: 'ES', name: 'S&P 500 E-Mini', snap, read }))
    // …and spot-checked against the fixture's arithmetic so the derivation is not circular.
    expect(capture.market).toBe('ES')
    expect(capture.marketName).toBe('S&P 500 E-Mini')
    expect(capture.reportDate).toBe('2025-10-28')
    expect(capture.groups.commercials).toMatchObject({ net: -1000, wow: 1000 })
    expect(capture.groups.largeSpecs).toMatchObject({ net: -9200, wow: -800 })
    expect(capture.groups.smallSpecs).toMatchObject({ net: 23000, wow: 1000 })
    expect(capture.openInterest).toMatchObject({ value: 2_098_500, wow: 1_500 })
    // The verdicts are the ones on screen.
    expect(screen.getByText(capture.bias.label)).toBeInTheDocument()
    expect(capture.bias.label).toBe('Contrarian Bullish')
    expect(screen.getByText(capture.crowding.label)).toBeInTheDocument()
    // And it is a capture the registry will render.
    const params = normalizeParams('cot', capture)
    expect(validateParams('cot', params).ok).toBe(true)
    expect(isReconstructable('cot', params)).toBe(true)
    expect(await screen.findByText('ES COT positioning sent to “Plan”')).toBeInTheDocument()
  })

  it('a SCRUBBED week is the week that is saved', async () => {
    const rows = mkRows()
    const ref = createRef()
    render(<PositioningRail ref={ref} rows={rows} symbol="ES" name="S&P 500 E-Mini" />)
    act(() => ref.current.setIndex(150))
    const week = rows[150].date
    const [y, m, d] = week.split('-')
    fireEvent.click(screen.getByRole('button', {
      name: `Save ES COT positioning for the week of ${parseInt(m)}/${parseInt(d)}/${y} to Notebook`,
    }))
    await waitFor(() => expect(sendMock).toHaveBeenCalledTimes(1))
    expect(sendMock.mock.calls[0][1].reportDate).toBe(week)
    expect(sendMock.mock.calls[0][1].groups.commercials.net).toBe(rows[150].commercial_net)
  })
})

describe('buildCotCapture', () => {
  it('nothing on screen, nothing to save', () => {
    expect(buildCotCapture({ symbol: 'ES', snap: null, read: null })).toBeNull()
  })

  it('never stores the code twice as its own name', () => {
    const rows = mkRows()
    const { snap, read } = composeWeek(rows, rows.length - 1, { symbol: 'ZZ', name: 'ZZ' })
    expect(buildCotCapture({ symbol: 'ZZ', name: 'ZZ', snap, read }).marketName).toBeUndefined()
  })
})

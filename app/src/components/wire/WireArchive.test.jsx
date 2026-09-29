// TERM-089 — the Morning Wire replay surface.
//
// What this file makes impossible:
//   * a FREE member's page sending the paid archive read at all (the free tier
//     keeps today's wire exactly as before — nothing rendered, nothing fetched);
//   * a past issue rendered through anything but the live rundown's own wrapper
//     (`MorningWire.module.css` `.rundownWrap`, which owns every `:global(.rd-*)`
//     rule) — a second renderer is a second authority on what a letter looks like;
//   * a date the archive does not hold rendering another day's wire, or an empty
//     letter — it must SAY there is no wire that day;
//   * the index hiding its gaps — held vs weekdays in range is on screen.
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { vi, beforeEach, afterEach, test, expect } from 'vitest'
import wireStyles from '../../pages/MorningWire.module.css'

let paid = true
vi.mock('../../context/AuthContext', () => ({ useIsPaid: () => paid }))

import WireArchive from './WireArchive'

const INDEX = {
  dates: ['2026-09-28', '2026-09-23', '2026-09-21'],
  coverage: {
    held: 3, first: '2026-09-21', last: '2026-09-28', weekdays_in_range: 6,
    missing_weekdays: ['2026-09-22', '2026-09-24', '2026-09-25'], denominator: 'weekdays',
  },
}

const ISSUES = {
  '2026-09-21': { date: '2026-09-21', held: true, html: '<p class="rd-probe">wire of 2026-09-21</p>' },
  '2026-09-23': { date: '2026-09-23', held: true, html: '<p class="rd-probe">wire of 2026-09-23</p>' },
  '2026-09-22': { date: '2026-09-22', held: false, html: null },
}

function json(body, status = 200) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) })
}

let fetchMock
beforeEach(() => {
  paid = true
  fetchMock = vi.fn((url) => {
    if (url === '/api/wire/archive') return json(INDEX)
    const m = String(url).match(/^\/api\/wire\/archive\/(.+)$/)
    if (m && ISSUES[m[1]]) return json(ISSUES[m[1]])
    return json({ detail: 'nope' }, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { vi.unstubAllGlobals() })

const mount = () => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <WireArchive />
  </SWRConfig>,
)

const pick = async (ymd) => {
  const input = await screen.findByLabelText(/replay the wire of/i)
  fireEvent.change(input, { target: { value: ymd } })
}

test('a FREE member sees nothing and the paid archive is never requested', () => {
  paid = false
  const { container } = mount()
  expect(container).toBeEmptyDOMElement()
  expect(fetchMock).not.toHaveBeenCalled()
})

test('the index publishes its coverage: held against weekdays in range, gaps named', async () => {
  mount()
  expect(await screen.findByText(/3 of 6 weekdays/i)).toBeInTheDocument()
  expect(screen.getByText(/2026-09-21/)).toBeInTheDocument()
  expect(screen.getByText(/not held: 2026-09-22, 2026-09-24, 2026-09-25/i)).toBeInTheDocument()
})

test('a HELD date renders through the live rundown wrapper (the same renderer)', async () => {
  mount()
  await pick('2026-09-21')
  const text = await screen.findByText('wire of 2026-09-21')
  const wrap = text.closest(`.${wireStyles.rundownWrap}`)
  expect(wrap).not.toBeNull()
  expect(screen.getByText(/replaying the wire of 2026-09-21/i)).toBeInTheDocument()
})

test('a MISSING date says there was no wire, and shows no other day', async () => {
  mount()
  await pick('2026-09-22')
  expect(await screen.findByText(/no wire in the archive for 2026-09-22/i)).toBeInTheDocument()
  expect(screen.queryByText(/wire of 2026-09-2[13]/)).toBeNull()
  expect(fetchMock).toHaveBeenCalledWith('/api/wire/archive/2026-09-22', undefined)
})

test('a refused index says so rather than rendering an empty archive', async () => {
  fetchMock.mockImplementation(() => json({ detail: 'paid' }, 402))
  mount()
  await waitFor(() => expect(screen.getByText(/past issues are part of the paid plan/i)).toBeInTheDocument())
})

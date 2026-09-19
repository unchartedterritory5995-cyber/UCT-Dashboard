// TickerPopup — Shift+F flags the open ticker; the PLATFORM ACCELERATOR chord must not.
//
// ⚰️ F-S2-1, measured on `feb7ba1f8`. Five surfaces claimed Shift+F and disagreed about
// which modifiers they answered: `ChartPane.jsx` excluded ctrl/alt/meta, this modal did
// not. So a member reaching for Ctrl+Shift+F / Cmd+Shift+F — the browser's find chord —
// got a SILENT write to their flag list here and nothing on the chart. That is HY-35's
// recorded class ("one chord flagged a ticker in two widgets at once") in the form the
// 2026-08-28 ownership fix did not cover.
//
// ⛔ BEHAVIOUR, NOT SHAPE. `pages/command/chordCollision.test.js` derives the guard set
// from SOURCE and is how the defect was found — but it reads text. It would stay green
// if the exclusions were present and the handler fired anyway. These cases mount the
// real component and assert the decision a member feels: did my flag list change?
import { renderWithProviders, screen, fireEvent } from '../test-utils'
import userEvent from '@testing-library/user-event'
import { vi, beforeEach, afterEach, test, expect } from 'vitest'

vi.mock('../utils/prefetchBars', () => ({
  prefetchAllTimeframes: vi.fn(), prefetchBars: vi.fn(), prefetchBar: vi.fn(), default: vi.fn(),
}))
vi.mock('./StockChart', () => ({ default: () => null }))
vi.mock('./chart/SymbolSearch', () => ({ default: () => null }))

// ── The hook under observation ──
const flagSpy = { toggle: vi.fn(), flagged: [] }
vi.mock('../hooks/useFlagged', () => ({
  useFlagged: () => ({
    flagged: flagSpy.flagged,
    toggle: flagSpy.toggle,
    isFlagged: (s) => flagSpy.flagged.includes(s),
  }),
}))

const TickerPopup = (await import('./TickerPopup')).default

beforeEach(() => {
  flagSpy.toggle.mockClear()
  flagSpy.flagged = []
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
    ok: true, status: 200, json: () => Promise.resolve({}),
  })))
})
afterEach(() => { vi.unstubAllGlobals() })

/** ⛔ The handler binds only while the modal is OPEN (`useEffect` guarded on
 *  `modalOpen`). A case that fired the chord without opening it would pass against a
 *  deleted handler, so the open is asserted before any key is sent. */
async function openModal() {
  const user = userEvent.setup()
  renderWithProviders(<TickerPopup sym="NVDA" />)
  await user.click(screen.getByTestId('ticker-NVDA'))
  expect(await screen.findByRole('button', { name: 'Close chart' })).toBeInTheDocument()
}

test('POSITIVE CONTROL: bare Shift+F still flags the open ticker', async () => {
  await openModal()
  fireEvent.keyDown(window, { key: 'F', code: 'KeyF', shiftKey: true })
  expect(flagSpy.toggle).toHaveBeenCalledWith('NVDA')
})

// S2 CP6 — added alongside the chord-table adoption. This file never covered
// the auto-repeat guard even before the migration (Watchlists.flagkey.test.jsx
// did); a held key firing 21 toggles lands wherever the release parity falls,
// which reads to a member as "the flag doesn't stick".
test('holding Shift+F flags ONCE, not once per auto-repeat', async () => {
  await openModal()
  fireEvent.keyDown(window, { key: 'F', code: 'KeyF', shiftKey: true })
  for (let i = 0; i < 20; i++) {
    fireEvent.keyDown(window, { key: 'F', code: 'KeyF', shiftKey: true, repeat: true })
  }
  expect(flagSpy.toggle).toHaveBeenCalledTimes(1)
})

test.each([
  ['Ctrl', { ctrlKey: true }],
  ['Cmd', { metaKey: true }],
  ['Alt', { altKey: true }],
])('%s+Shift+F does NOT touch the flag list', async (_label, mods) => {
  await openModal()
  fireEvent.keyDown(window, { key: 'F', code: 'KeyF', shiftKey: true, ...mods })
  expect(flagSpy.toggle).not.toHaveBeenCalled()
})

test('CapsLock + Ctrl+Shift+F is refused, and the same casing WITHOUT it still flags', async () => {
  // ⭐ Both halves in one case on purpose: the refusal has to be about the MODIFIER.
  // A guard that had simply stopped answering lowercase would pass the first assertion
  // and fail the member exactly as the original defect did.
  await openModal()
  fireEvent.keyDown(window, { key: 'f', code: 'KeyF', shiftKey: true, ctrlKey: true })
  expect(flagSpy.toggle).not.toHaveBeenCalled()

  fireEvent.keyDown(window, { key: 'f', code: 'KeyF', shiftKey: true })
  expect(flagSpy.toggle).toHaveBeenCalledWith('NVDA')
})

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, beforeEach, afterEach, test, expect } from 'vitest'
import AddSymbolBar from './AddSymbolBar'

// The combobox hits /api/ticker-search; serve a small deterministic universe.
const UNIVERSE = [
  { ticker: 'NVDA', name: 'NVIDIA Corp.' },
  { ticker: 'NVDL', name: 'GraniteShares 2x Long NVDA' },
  { ticker: 'AMD', name: 'Advanced Micro Devices' },
]

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn((url) => {
    const q = decodeURIComponent(String(url).split('q=')[1]?.split('&')[0] || '')
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        results: UNIVERSE.filter(r => r.ticker.startsWith(q.toUpperCase())),
      }),
    })
  }))
})
afterEach(() => { vi.unstubAllGlobals() })

function makeTargets(overrides = {}) {
  return [
    { id: 'flagged', name: 'Flagged', syms: new Set(['TSLA']), ...(overrides.flagged || {}) },
    { id: 'wl1', name: 'Momentum Plays', syms: new Set(['AAPL']), ...(overrides.wl1 || {}) },
  ]
}

function setup(props = {}) {
  const onAdd = props.onAdd || vi.fn().mockResolvedValue({ duplicate: false })
  const onCreateList = props.onCreateList || vi.fn().mockResolvedValue({ id: 'new1', name: 'Breakouts' })
  const utils = render(
    <AddSymbolBar
      targets={props.targets || makeTargets()}
      selectedSym={props.selectedSym ?? null}
      onAdd={onAdd}
      onCreateList={onCreateList}
    />,
  )
  return { ...utils, onAdd, onCreateList }
}

// ── Quick-add the charted symbol ───────────────────────────────────────────

test('quick-add button adds the charted symbol to the current target', async () => {
  const user = userEvent.setup()
  const { onAdd } = setup({ selectedSym: 'NVDA' })

  await user.click(screen.getByRole('button', { name: /add nvda to flagged/i }))
  expect(onAdd).toHaveBeenCalledWith('flagged', 'NVDA')
  expect(await screen.findByText('NVDA added to Flagged')).toBeInTheDocument()
})

test('quick-add is disabled when the symbol is already in the target list', () => {
  setup({ selectedSym: 'TSLA' })   // TSLA is already in Flagged
  expect(screen.getByRole('button', { name: /tsla is already in flagged/i })).toBeDisabled()
})

test('no quick-add button renders when no symbol is charted', () => {
  setup({ selectedSym: null })
  expect(screen.queryByRole('button', { name: /^add [A-Z]+ to/i })).not.toBeInTheDocument()
})

// ── Predictive combobox ────────────────────────────────────────────────────

test('typing surfaces matching tickers and Enter adds the highlighted one', async () => {
  const user = userEvent.setup()
  const { onAdd } = setup()

  const input = screen.getByRole('combobox')
  await user.click(input)
  await user.type(input, 'NVD')

  expect(await screen.findByText('NVIDIA Corp.')).toBeInTheDocument()
  await user.keyboard('{Enter}')
  await waitFor(() => expect(onAdd).toHaveBeenCalledWith('flagged', 'NVDA'))
})

test('arrow keys move the highlight before Enter commits', async () => {
  const user = userEvent.setup()
  const { onAdd } = setup()

  const input = screen.getByRole('combobox')
  await user.click(input)
  await user.type(input, 'NVD')
  await screen.findByText('NVIDIA Corp.')

  await user.keyboard('{ArrowDown}')      // NVDA -> NVDL
  await user.keyboard('{Enter}')
  await waitFor(() => expect(onAdd).toHaveBeenCalledWith('flagged', 'NVDL'))
})

test('the input clears but keeps focus after an add, so several can be banked in a row', async () => {
  const user = userEvent.setup()
  setup()
  const input = screen.getByRole('combobox')
  await user.click(input)
  await user.type(input, 'NVD')
  await screen.findByText('NVIDIA Corp.')
  await user.keyboard('{Enter}')

  await waitFor(() => expect(input).toHaveValue(''))
  expect(input).toHaveFocus()
})

test('a duplicate add is reported as already-present, not as a fresh add', async () => {
  const user = userEvent.setup()
  const onAdd = vi.fn().mockResolvedValue({ duplicate: true })
  setup({ onAdd, selectedSym: 'NVDA' })

  await user.click(screen.getByRole('button', { name: /add nvda to flagged/i }))
  expect(await screen.findByText('NVDA is already in Flagged')).toBeInTheDocument()
})

// ── Target picker + inline list creation ───────────────────────────────────

test('choosing a different target routes subsequent adds to it and persists the choice', async () => {
  const user = userEvent.setup()
  const { onAdd, unmount } = setup({ selectedSym: 'NVDA' })

  await user.click(screen.getByRole('button', { name: /choose which list/i }))
  await user.click(screen.getByRole('menuitem', { name: /Momentum Plays/ }))
  await user.click(screen.getByRole('button', { name: /add nvda to momentum plays/i }))
  expect(onAdd).toHaveBeenCalledWith('wl1', 'NVDA')

  // Remount: the target survives via localStorage.
  unmount()
  setup({ selectedSym: 'NVDA' })
  expect(screen.getByRole('button', { name: /add nvda to momentum plays/i })).toBeInTheDocument()
})

test('"New list…" creates the list and retargets to it in one motion', async () => {
  const user = userEvent.setup()
  const onCreateList = vi.fn().mockResolvedValue({ id: 'new1', name: 'Breakouts' })
  setup({ onCreateList })

  await user.click(screen.getByRole('button', { name: /choose which list/i }))
  await user.click(screen.getByRole('menuitem', { name: /New list/i }))
  await user.type(screen.getByLabelText(/new watchlist name/i), 'Breakouts')
  await user.keyboard('{Enter}')

  await waitFor(() => expect(onCreateList).toHaveBeenCalledWith('Breakouts'))
  expect(await screen.findByText('Created Breakouts')).toBeInTheDocument()
})

test('a failed list creation does not retarget or claim success', async () => {
  const user = userEvent.setup()
  const onCreateList = vi.fn().mockResolvedValue(null)
  setup({ onCreateList })

  await user.click(screen.getByRole('button', { name: /choose which list/i }))
  await user.click(screen.getByRole('menuitem', { name: /New list/i }))
  await user.type(screen.getByLabelText(/new watchlist name/i), 'Breakouts')
  await user.keyboard('{Enter}')

  expect(await screen.findByText('Could not create list')).toBeInTheDocument()
  expect(screen.queryByText('Created Breakouts')).not.toBeInTheDocument()
})

test('a stored target that no longer exists falls back to the first list', () => {
  localStorage.setItem('uct.watchlist.addTarget', 'deleted-list-id')
  setup({ selectedSym: 'NVDA' })
  expect(screen.getByRole('button', { name: /add nvda to flagged/i })).toBeInTheDocument()
})

// ── Accessibility ──────────────────────────────────────────────────────────

test('the add confirmation is announced in a live region', async () => {
  const user = userEvent.setup()
  setup({ selectedSym: 'NVDA' })
  await user.click(screen.getByRole('button', { name: /add nvda to flagged/i }))

  const live = await screen.findByRole('status')
  expect(live).toHaveAttribute('aria-live', 'polite')
  expect(live).toHaveTextContent('NVDA added to Flagged')
})

test('the combobox exposes listbox semantics with an active descendant', async () => {
  const user = userEvent.setup()
  setup()
  const input = screen.getByRole('combobox')

  expect(input).toHaveAttribute('aria-expanded', 'false')
  await user.click(input)
  expect(input).toHaveAttribute('aria-expanded', 'true')

  await user.type(input, 'NVD')
  await screen.findByText('NVIDIA Corp.')
  expect(screen.getByRole('listbox')).toBeInTheDocument()
  expect(input.getAttribute('aria-activedescendant')).toBe(screen.getAllByRole('option')[0].id)
})

// ── Scoped (Charts widget) mode ────────────────────────────────────────────
// A Watchlist widget is pinned to ONE list, so there is nothing to pick between
// and a list created here would be invisible. The picker must be suppressed.

test('showPicker={false} hides the target picker but keeps adding to the sole target', async () => {
  const user = userEvent.setup()
  const onAdd = vi.fn().mockResolvedValue({ duplicate: false })
  render(
    <AddSymbolBar
      targets={[{ id: 'flagged', name: 'Flagged', syms: new Set() }]}
      selectedSym="NVDA"
      onAdd={onAdd}
      onCreateList={vi.fn()}
      showPicker={false}
    />,
  )

  expect(screen.queryByRole('button', { name: /choose which list/i })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: /add nvda to flagged/i }))
  expect(onAdd).toHaveBeenCalledWith('flagged', 'NVDA')
})

test('scoped mode offers no "New list…" affordance', () => {
  render(
    <AddSymbolBar
      targets={[{ id: 'flagged', name: 'Flagged', syms: new Set() }]}
      selectedSym={null}
      onAdd={vi.fn()}
      onCreateList={vi.fn()}
      showPicker={false}
    />,
  )
  expect(screen.queryByRole('menuitem', { name: /new list/i })).not.toBeInTheDocument()
})

/**
 * Wave 14, lane W14-keys: "Help: Walkthroughs" in the ONE command palette
 * (docs/notebook/wave14-keys.md). The palette is the established cheap keyboard door (Ctrl+K,
 * the door wave 13's Q1/Q3/Q4 budgets were met through); this command takes a keyboard member
 * from anywhere to Help's Walkthroughs heading, whose next Tab stop is Replay.
 *
 *   * gated by the wave-14 switch, like Help > Walkthroughs itself;
 *   * matched ONLY by a word that names it ("walkth..."), never by a two-letter fragment: a
 *     command row LEADS the palette (orderPaletteRows), so a loose match would steal Enter from
 *     a ticker ("ro", "th", "to" are all real queries).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import CommandPalette from './CommandPalette'
import { __resetNotebookFlags, latchNotebookFlags } from '../pages/journal-2-0/lib/offline/notebookFlags'

function RouteSpy() {
  const l = useLocation()
  return <div data-testid="route-spy">{l.pathname}{l.hash}</div>
}

function renderPalette() {
  return render(
    <MemoryRouter initialEntries={['/journal/notebook']}>
      <CommandPalette />
      <RouteSpy />
    </MemoryRouter>,
  )
}

async function openAndType(q) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }))
  })
  const box = await screen.findByRole('combobox')
  fireEvent.change(box, { target: { value: q } })
  return box
}

beforeEach(() => {
  __resetNotebookFlags()
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ results: [] }) }))
})
afterEach(() => { __resetNotebookFlags(); vi.restoreAllMocks() })

const ON = { notebook_onboarding_enabled: true, notebook_getting_started_enabled: true }

describe('palette -- Help: Walkthroughs (W14-keys)', () => {
  it('switch on: "walkthroughs" offers it as the top row, and Enter lands on /support#walkthroughs', async () => {
    latchNotebookFlags(ON)
    renderPalette()
    const box = await openAndType('walkthroughs')
    const opts = await screen.findAllByRole('option')
    expect(opts[0]).toHaveTextContent('Help: Walkthroughs')
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(screen.getByTestId('route-spy')).toHaveTextContent('/support#walkthroughs'))
  })

  it('a prefix of the word finds it ("walkt")', async () => {
    latchNotebookFlags(ON)
    renderPalette()
    await openAndType('walkt')
    expect((await screen.findAllByRole('option'))[0]).toHaveTextContent('Help: Walkthroughs')
  })

  it.each(['wa', 'ro', 'th', 'to', 'help', 'tour', 'walk'])('never matches the fragment "%s"', async (q) => {
    latchNotebookFlags(ON)
    renderPalette()
    await openAndType(q)
    await act(async () => { await new Promise((r) => setTimeout(r, 250)) })
    expect(screen.queryByRole('option', { name: /Walkthroughs/ })).toBeNull()
  })

  it('switch off: not offered at all', async () => {
    latchNotebookFlags({ ...ON, notebook_getting_started_enabled: false })
    renderPalette()
    await openAndType('walkthroughs')
    await act(async () => { await new Promise((r) => setTimeout(r, 250)) })
    expect(screen.queryByRole('option', { name: /Walkthroughs/ })).toBeNull()
  })
})

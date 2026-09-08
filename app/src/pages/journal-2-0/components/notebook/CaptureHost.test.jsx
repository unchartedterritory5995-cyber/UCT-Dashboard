import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import CaptureHost from './CaptureHost'
import { openCapture } from '../../lib/captureBus'
import { captureDestination } from '../../lib/capture'
import { parseShare, writePendingShare } from '../../lib/shareTarget'

const mount = () => render(<MemoryRouter><CaptureHost /></MemoryRouter>)

beforeEach(() => { global.fetch = vi.fn() })
afterEach(() => { vi.restoreAllMocks() })

describe('every door opens the SAME dialog', () => {
  it('starts closed', () => {
    mount()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('the palette door opens it', async () => {
    mount()
    openCapture({ source: 'palette' })
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it('the hotkey opens it', async () => {
    mount()
    fireEvent.keyDown(window, { key: 'Y', code: 'KeyY', ctrlKey: true, shiftKey: true })
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it('palette and hotkey open ONE dialog, not two products', async () => {
    mount()
    openCapture({ source: 'palette' })
    fireEvent.keyDown(window, { key: 'Y', code: 'KeyY', metaKey: true, shiftKey: true })
    await screen.findByRole('dialog')
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
  })
})

describe('the shortcut does not collide with what is already claimed (§11)', () => {
  // The audit's conclusions, pinned. If someone later re-binds capture onto one
  // of these, this fails rather than silently stealing an established command.
  const claimed = [
    ['Cmd/Ctrl+K — command palette', { key: 'k', code: 'KeyK', ctrlKey: true }],
    ['Cmd/Ctrl+Shift+V — push to talk', { key: 'V', code: 'KeyV', ctrlKey: true, shiftKey: true }],
    ['Cmd/Ctrl+Shift+T — read aloud', { key: 'T', code: 'KeyT', ctrlKey: true, shiftKey: true }],
    ['Cmd/Ctrl+Shift+C — devtools inspector', { key: 'C', code: 'KeyC', ctrlKey: true, shiftKey: true }],
    ['plain Y while typing', { key: 'y', code: 'KeyY' }],
  ]

  it.each(claimed)('%s does not open capture', (_name, ev) => {
    mount()
    fireEvent.keyDown(window, ev)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('context supplies DEFAULTS, visibly (§3/§4)', () => {
  it('a research door prefills the destination and shows it', async () => {
    mount()
    openCapture({
      source: 'research',
      destination: captureDestination({ noteId: 'n1', ticker: 'NVDA' }),
    })
    await screen.findByRole('dialog')
    expect(screen.getByTestId('capture-destination')).toHaveTextContent('NVDA Research')
  })

  it('prefilled source fields arrive populated so the fast path is type-and-save', async () => {
    mount()
    openCapture({
      source: 'surface',
      destination: captureDestination({ noteId: 'n1', ticker: 'NVDA' }),
      initial: { url: 'https://example.com/a', title: 'Article', passage: 'A quoted line.' },
    })
    await screen.findByRole('dialog')
    expect(screen.getByLabelText('Source link')).toHaveValue('https://example.com/a')
    expect(screen.getByLabelText('Selected passage')).toHaveValue('A quoted line.')
  })

  it('with no context it ASKS where to save rather than guessing', async () => {
    // ⛔ The measured defect was ["a destination"] with nothing to resolve it:
    // a global command that could never complete. With no context the dialog
    // now shows a picker -- one extra step, and only in the case that earns it.
    mount()
    fireEvent.keyDown(window, { key: 'Y', code: 'KeyY', ctrlKey: true, shiftKey: true })
    await screen.findByRole('dialog')
    expect(screen.getByTestId('capture-destination-picker')).toBeInTheDocument()
  })
})

describe('capture preserves the member context (§5/§20)', () => {
  it('saving does NOT navigate away', async () => {
    global.fetch.mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ note: { id: 'n9', title: 'a thought' } }),
    })
    mount()
    openCapture({ destination: captureDestination({ noteId: 'n1', ticker: 'NVDA' }) })
    await screen.findByRole('dialog')
    fireEvent.change(screen.getByLabelText('Quick thought'), { target: { value: 'a thought' } })
    fireEvent.click(screen.getByTestId('capture-save'))
    expect(await screen.findByRole('status')).toHaveTextContent('Saved to NVDA Research')
    // Still on the dialog, still on the same route — no churn.
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('closing returns the dialog to nothing', async () => {
    mount()
    openCapture({})
    await screen.findByRole('dialog')
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})

describe('the mobile share door lands here (Slice 4)', () => {
  // `ShareTargetPage` lives outside `Layout`, so arriving from it always mounts
  // this component fresh — which is why a mount-time consume is enough and no
  // second channel exists to keep in sync.
  beforeEach(() => { sessionStorage.clear() })

  it('a parked share opens the dialog on mount, with no door event', async () => {
    writePendingShare(parseShare({ url: 'https://wsj.com/x', title: 'Fed holds', text: 'rates steady' }))
    mount()
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toBeInTheDocument()
    expect(screen.getByLabelText('Source link')).toHaveValue('https://wsj.com/x')
    expect(screen.getByLabelText('Selected passage')).toHaveValue('rates steady')
  })

  it('⛔ a url-less share opens the THOUGHT box, not a quotation', async () => {
    // Source mode would demand a URL the share never carried, so the member
    // would meet a blocked Save; and calling their text a passage would assert
    // provenance nobody established.
    writePendingShare(parseShare({ text: 'margins normalize by Q3' }))
    mount()
    await screen.findByRole('dialog')
    expect(screen.getByLabelText('Quick thought')).toHaveValue('margins normalize by Q3')
    expect(screen.queryByLabelText('Selected passage')).toBeNull()
  })

  it('⛔ it is consumed ONCE — a remount does not reopen it', async () => {
    writePendingShare(parseShare({ url: 'https://wsj.com/x' }))
    const first = mount()
    await screen.findByRole('dialog')
    first.unmount()
    mount()
    // A share left in storage would reopen on every mount: a capture the member
    // cannot dismiss.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('no parked share means no dialog — the normal case is untouched', async () => {
    mount()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})

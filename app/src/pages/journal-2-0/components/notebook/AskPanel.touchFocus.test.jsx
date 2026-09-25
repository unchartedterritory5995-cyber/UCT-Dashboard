/**
 * G-064 close-out — the REAL AskPanel on the touch tier, where it renders inside
 * a `Sheet`. Measured on the deployed build (386px): every keystroke in the
 * question box moved focus out of it (to the Ask toggle behind the sheet, then
 * to the sheet panel), which on a phone closes the keyboard after each
 * character, and the Insert picker's search box lost its focus the same way two
 * frames after it opened. The mechanism was Sheet's focus effect re-running on
 * every host render because AskPanel passes `onClose` inline; the fix is in
 * `components/mobile/Sheet.jsx` and has its own rail in `Sheet.test.jsx`. This
 * file pins the member-facing half, on the component members actually use.
 *
 * `useIsTouch` is mocked the way CaptureDialog.test.jsx and ScopeBar.test.jsx
 * do it, so AskPanel picks its Sheet branch and Sheet resolves a bottom sheet;
 * a control asserts the Sheet is really there, or every check below would pass
 * on the desktop tier, where there is no Sheet to steal focus.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, fireEvent } from '@testing-library/react'
import AskPanel from './AskPanel'
import { __resetNotebookFlags, latchNotebookFlags } from '../../lib/offline/notebookFlags'

vi.mock('../../../../hooks/useBreakpoint', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useIsTouch: () => true }
})

function sse(events) {
  const enc = new TextEncoder()
  return new ReadableStream({
    start(c) {
      for (const ev of events) c.enqueue(enc.encode(`data: ${JSON.stringify(ev)}\n\n`))
      c.close()
    },
  })
}
const SOURCE = {
  n: 1, type: 'note', label: 'NVDA thesis', citation: 'exact', snippet: 's',
  navigation: { kind: 'note', note_id: 'n1' }, location: {}, payload: {}, stance: null, truncated: false,
}

// Real animation frames, flushed: Sheet schedules its panel focus with
// requestAnimationFrame, so a check that does not wait cannot fail.
const frames = (n = 2) => act(() => new Promise((resolve) => {
  const step = (k) => (k ? requestAnimationFrame(() => step(k - 1)) : resolve())
  step(n)
}))

beforeEach(() => {
  vi.restoreAllMocks()
  __resetNotebookFlags()
  latchNotebookFlags({ notebook_ask_insert_on: true })
  global.fetch = vi.fn().mockResolvedValue({
    ok: true, status: 200, json: async () => ({ notes: [] }),
    body: sse([
      { type: 'sources', scope: 'notebook', scopeLabel: 'My Notebook', sources: [SOURCE], coverageNotice: null },
      { type: 'final', answer: 'Margins fell [1].' },
    ]),
  })
})

async function openPanel(props = {}) {
  render(<AskPanel scope="notebook" target={null} autoOpen {...props} />)
  await frames(4)
  // Control: the touch tier really rendered a Sheet.
  expect(document.querySelector('[data-sheet-panel]')).not.toBeNull()
}

const question = () => screen.getAllByRole('textbox')[0]

describe('AskPanel on the touch tier keeps focus where the member is typing', () => {
  it('the question box keeps focus across keystrokes', async () => {
    await openPanel()
    const box = question()
    box.focus()
    for (const value of ['m', 'ma', 'mar', 'marg']) {
      fireEvent.change(box, { target: { value } })
      await frames()
      expect(document.activeElement).toBe(box)
    }
  })

  it("the Insert picker's search box has focus after it opens, and keeps it while typing", async () => {
    await openPanel({ onOpenNote: vi.fn() })
    fireEvent.change(question(), { target: { value: 'margins?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
    await screen.findByTestId('ask-answer')
    await frames()

    // A tap on iOS does not focus the button, so nothing here calls .focus().
    fireEvent.click(await screen.findByRole('button', { name: /Insert into a note/ }))
    const search = screen.getByRole('textbox', { name: 'Find a note to insert into' })
    await frames()
    expect(document.activeElement).toBe(search)

    for (const value of ['n', 'nv', 'nvd']) {
      fireEvent.change(search, { target: { value } })
      await frames()
      expect(document.activeElement).toBe(search)
    }
  })
})

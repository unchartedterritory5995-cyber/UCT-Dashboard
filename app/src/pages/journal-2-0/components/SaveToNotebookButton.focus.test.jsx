// Finish program, lane CLICKS: the shared "Save to Notebook" button keeps keyboard focus
// through a save.
//
// The defect: while a save was in flight the button carried the native `disabled`
// attribute. A disabled button cannot hold focus, so the browser moved focus to <body>,
// and a keyboard member who had just pressed Enter was back at the top of the page
// (measured in a real browser by lane NAV, docs/notebook/fin-nav.md, open item 1).
//
// The rule these tests pin: BUSY is `aria-disabled` plus a guarded handler, never the
// native attribute. The `disabled` PROP (nothing to save yet) stays native.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

const { sendMock, gate } = vi.hoisted(() => ({ sendMock: vi.fn(), gate: { release: null } }))

vi.mock('../lib/sendToJournal', () => ({ sendCaptureToJournal: sendMock }))

import SaveToNotebookButton from './SaveToNotebookButton'

const NAME = 'Save these results to Notebook'

function mount(props = {}) {
  return render(
    <SaveToNotebookButton widgetId="screener" label="Screener results" ariaLabel={NAME}
      buildCapture={() => ({ rows: [{ sym: 'AAA' }] })} {...props} />,
  )
}

beforeEach(() => {
  sendMock.mockReset()
  gate.release = null
  // A save that stays in flight until the test lets it land.
  sendMock.mockImplementation(() => new Promise((resolve) => { gate.release = () => resolve('Screener results sent') }))
})

// jsdom leaves focus on an element that becomes disabled. A browser does not: the HTML
// "focus fixup" rule moves focus to <body> (that is the defect a member met). This applies the
// browser's rule, so `document.activeElement` means here what it means in Chromium.
function browserFocusFixup() {
  const el = document.activeElement
  if (!el || el === document.body || !el.disabled) return
  // jsdom's own blur() is a no-op on a disabled element, so focus is moved the long way round:
  // onto a throwaway control, which is then removed. That leaves <body> as the active element.
  const sink = document.createElement('button')
  document.body.appendChild(sink)
  sink.focus()
  sink.remove()
  expect(document.activeElement).toBe(document.body)
}

async function pressAndWaitForFlight(btn) {
  btn.focus()
  expect(document.activeElement).toBe(btn)
  fireEvent.click(btn) // what Enter on a focused button dispatches
  await waitFor(() => expect(sendMock).toHaveBeenCalledTimes(1))
  browserFocusFixup()
}

describe('SaveToNotebookButton: focus stays on the button through a save', () => {
  it('is not natively disabled while saving, so it still holds focus', async () => {
    mount()
    const btn = screen.getByRole('button', { name: NAME })
    await pressAndWaitForFlight(btn)

    expect(btn.disabled).toBe(false)
    expect(btn.getAttribute('aria-disabled')).toBe('true')
    expect(document.activeElement).toBe(btn)

    await act(async () => { gate.release() })
  })

  it('has focus on the button after the save completes', async () => {
    mount()
    const btn = screen.getByRole('button', { name: NAME })
    await pressAndWaitForFlight(btn)

    await act(async () => { gate.release() })
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Screener results sent'))

    expect(document.activeElement).toBe(btn)
    expect(btn.hasAttribute('aria-disabled')).toBe(false)
    expect(btn.disabled).toBe(false)
  })

  it('ignores a second press while the first save is in flight', async () => {
    mount()
    const btn = screen.getByRole('button', { name: NAME })
    await pressAndWaitForFlight(btn)

    fireEvent.click(btn)
    fireEvent.click(btn)
    expect(sendMock).toHaveBeenCalledTimes(1)

    await act(async () => { gate.release() })
    await waitFor(() => expect(btn.hasAttribute('aria-disabled')).toBe(false))
    // Control: once the save has landed the button works again.
    fireEvent.click(btn)
    await waitFor(() => expect(sendMock).toHaveBeenCalledTimes(2))
    await act(async () => { gate.release() })
  })

  it('keeps focus when the save fails', async () => {
    sendMock.mockReset()
    sendMock.mockImplementation(() => new Promise((_, reject) => { gate.release = () => reject(new Error('offline')) }))
    mount()
    const btn = screen.getByRole('button', { name: NAME })
    await pressAndWaitForFlight(btn)

    await act(async () => { gate.release() })
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Capture failed/))
    expect(document.activeElement).toBe(btn)
    expect(btn.hasAttribute('aria-disabled')).toBe(false)
  })

  it('the disabled PROP is still the native attribute (nothing to save yet)', () => {
    mount({ disabled: true })
    const btn = screen.getByRole('button', { name: NAME })
    expect(btn.disabled).toBe(true)
    fireEvent.click(btn)
    expect(sendMock).not.toHaveBeenCalled()
  })
})

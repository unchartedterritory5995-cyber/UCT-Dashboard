// S12 + VIS-4 (audit 2026-11-05, M9): ONE floating "+" on a phone's Notebook, with a Sheet of quick doors, replacing
// the five floating buttons (the Compass orb and its Train Me, paperclip and agent menu, and the Help "?") on
// Notebook routes only. Fix round 1: the sheet is its own chunk (NotebookPlusSheet, fetched on first open); the Help
// row opens the Help & Feedback menu; the orb's "in a call" attribute is pinned by a RENDERED test
// (FloatingOrb.coachmark.test.jsx). ⛔ jsdom lays nothing out: the phone-only drawing is pinned on the stylesheets.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { useRef, useState } from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import NotebookPlusFab, { NOTEBOOK_ROUTE_ATTR } from './NotebookPlusFab'
import NotebookPlusSheet from './NotebookPlusSheet'
import { OPEN_FEEDBACK_EVENT } from '../../../../components/feedbackDoor'

afterEach(cleanup)
function Where() { const l = useLocation(); return <output data-testid="where">{l.pathname}</output> }
function Harness(props) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  return (
    <>
      <NotebookPlusFab ref={ref} open={open} onOpen={() => setOpen(true)} />
      <NotebookPlusSheet open={open} onClose={() => setOpen(false)} returnFocusTo={ref} onQuickNote={vi.fn()} {...props} />
    </>
  )
}
const mount = (props = {}) => render(
  <MemoryRouter initialEntries={['/journal/notebook']}><Harness {...props} /><Where /></MemoryRouter>,
)
const open = () => { fireEvent.click(screen.getByRole('button', { name: 'Add to your notebook' })); return screen.getByRole('dialog', { name: 'Add' }) }

describe('the floating "+"', () => {
  it('opens a sheet of Quick note, Voice note, Photo, Ask your Notebook and Help & feedback (every gate on)', () => {
    mount({ onVoiceNote: vi.fn(), onPhoto: vi.fn(), onAskNotebook: vi.fn() })
    const sheet = open()
    expect(screen.getByRole('button', { name: 'Add to your notebook' })).toHaveAttribute('aria-expanded', 'true')
    for (const name of ['Quick note', 'Voice note', 'Ask your Notebook', 'Help & feedback']) {
      expect(within(sheet).getByRole('button', { name })).toBeTruthy()
    }
    expect(within(sheet).getByLabelText('Photo / chart screenshot')).toHaveAttribute('type', 'file')
  })

  // Simplify pass 2 (A8): the row was "Ask AI" and opened Compass (the voice coach page). It is the Notebook's own
  // Ask now, the same door as the list's More row "Ask your Notebook", and it never leaves the Notebook.
  it('each row runs its door: Quick note creates, Ask your Notebook opens the Notebook\'s Ask, Help opens the Help & Feedback menu', async () => {
    const onQuickNote = vi.fn()
    const onAskNotebook = vi.fn()
    const feedback = vi.fn()
    window.addEventListener(OPEN_FEEDBACK_EVENT, feedback)
    mount({ onQuickNote, onAskNotebook })
    fireEvent.click(within(open()).getByRole('button', { name: 'Quick note' }))
    expect(onQuickNote).toHaveBeenCalledTimes(1)
    fireEvent.click(within(open()).getByRole('button', { name: 'Ask your Notebook' }))
    expect(onAskNotebook).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('where').textContent).toBe('/journal/notebook')
    expect(screen.queryByRole('dialog', { name: 'Add' })).toBeNull()
    expect(within(open()).queryByRole('button', { name: 'Ask AI' })).toBeNull()
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Add' })).getByRole('button', { name: 'Help & feedback' }))
    await waitFor(() => expect(feedback).toHaveBeenCalledTimes(1))   // on the next frame (fix round 2, N2)
    window.removeEventListener(OPEN_FEEDBACK_EVENT, feedback)
  })

  it('Photo / chart screenshot is the file input label (the picker opens inside the tap) and hands the file on', () => {
    const onPhoto = vi.fn()
    mount({ onPhoto })
    const input = within(open()).getByLabelText('Photo / chart screenshot')
    expect(input).toHaveAttribute('accept', 'image/*')
    const f = new File(['x'], 'chart.png', { type: 'image/png' })
    fireEvent.change(input, { target: { files: [f] } })
    expect(onPhoto).toHaveBeenCalledWith(f)
    expect(screen.queryByRole('dialog', { name: 'Add' })).toBeNull()
  })

  it('a gate that is off leaves no row that opens nothing', () => {
    mount()
    const sheet = open()
    expect(within(sheet).queryByRole('button', { name: 'Voice note' })).toBeNull()
    expect(within(sheet).queryByRole('button', { name: 'Ask your Notebook' })).toBeNull()
    expect(within(sheet).queryByLabelText('Photo / chart screenshot')).toBeNull()
    expect(within(sheet).getByRole('button', { name: 'Help & feedback' })).toBeTruthy()
  })

  it('marks <html> while the Notebook is on screen, and clears it after', () => {
    const view = mount()
    expect(document.documentElement.hasAttribute(NOTEBOOK_ROUTE_ATTR)).toBe(true)
    view.unmount()
    expect(document.documentElement.hasAttribute(NOTEBOOK_ROUTE_ATTR)).toBe(false)
  })
})

describe('the stylesheets: phone-only, and the five floating buttons give way on the Notebook only', () => {
  const css = (p) => readFileSync(join(process.cwd(), 'src', p), 'utf8')
  it('the "+" is drawn only at <=640 px, and steps up above an orb in a call', () => {
    const fab = css('pages/journal-2-0/components/notebook/NotebookPlusFab.module.css')
    expect(fab).toMatch(/^\.fab \{\s*display: none;\s*\}/m)
    expect(fab).toMatch(/@media \(max-width: 640px\) \{\s*\.fab \{\s*position: fixed;/)
    expect(fab).toMatch(/:global\(html\[data-orb-in-session\]\) \.fab \{\s*bottom: calc\(100px/)
    expect(fab).not.toMatch(/:has\(/)   // fix round 2 (N6): no document-wide :has()
  })
  it('the orb cluster gives way on the phone Notebook unless a call is live or failing', () => {
    expect(css('components/voice/FloatingOrb.module.css'))
      .toMatch(/@media \(max-width: 640px\) \{\s*:global\(html\[data-notebook-route\]\) \.orbCluster:not\(\[data-in-session\]\) \{\s*display: none;/)
  })
  it('the Help "?" gives way on the phone Notebook', () => {
    expect(css('components/FeedbackWidget.module.css'))
      .toMatch(/@media \(max-width: 640px\) \{\s*:global\(html\[data-notebook-route\]\) \.fab \{\s*display: none !important;/)
  })
})

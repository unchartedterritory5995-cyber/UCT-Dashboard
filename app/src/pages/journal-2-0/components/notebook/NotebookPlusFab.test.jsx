// S12 + VIS-4 (audit 2026-11-05, M9): ONE floating "+" on a phone's Notebook, with a Sheet of quick doors, replacing
// the five floating buttons (the Compass orb and its Train Me, paperclip and agent menu, and the Help "?") on
// Notebook routes only. ⛔ jsdom lays nothing out: the phone-only drawing is pinned on the stylesheets below.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import NotebookPlusFab, { NOTEBOOK_ROUTE_ATTR } from './NotebookPlusFab'

afterEach(cleanup)
function Where() { const l = useLocation(); return <output data-testid="where">{l.pathname}</output> }
const mount = (props = {}) => render(
  <MemoryRouter initialEntries={['/journal/notebook']}><NotebookPlusFab onQuickNote={vi.fn()} {...props} /><Where /></MemoryRouter>,
)
const open = () => { fireEvent.click(screen.getByRole('button', { name: 'Add to your notebook' })); return screen.getByRole('dialog', { name: 'Add' }) }

describe('the floating "+"', () => {
  it('opens a sheet of Quick note, Voice note, Ask AI and Help (every gate on)', () => {
    mount({ onVoiceNote: vi.fn(), askAi: true })
    const sheet = open()
    expect(within(sheet).getAllByRole('button').map((b) => b.textContent.trim()).filter((t) => t))
      .toEqual(expect.arrayContaining(['Quick note', 'Voice note', 'Ask AI', 'Help']))
  })

  it('each row runs its door: Quick note creates, Ask AI opens Compass, Help opens Support', () => {
    const onQuickNote = vi.fn()
    mount({ onQuickNote, askAi: true })
    fireEvent.click(within(open()).getByRole('button', { name: 'Quick note' }))
    expect(onQuickNote).toHaveBeenCalledTimes(1)
    fireEvent.click(within(open()).getByRole('button', { name: 'Ask AI' }))
    expect(screen.getByTestId('where').textContent).toBe('/journal/compass')
    fireEvent.click(within(open()).getByRole('button', { name: 'Help' }))
    expect(screen.getByTestId('where').textContent).toBe('/support')
  })

  it('a gate that is off leaves no row that opens nothing', () => {
    mount()
    const sheet = open()
    expect(within(sheet).queryByRole('button', { name: 'Voice note' })).toBeNull()
    expect(within(sheet).queryByRole('button', { name: 'Ask AI' })).toBeNull()
    expect(within(sheet).getByRole('button', { name: 'Help' })).toBeTruthy()
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
  it('the "+" is drawn only at <=640 px', () => {
    const fab = css('pages/journal-2-0/components/notebook/NotebookPlusFab.module.css')
    expect(fab).toMatch(/^\.fab \{\s*display: none;\s*\}/m)
    expect(fab).toMatch(/@media \(max-width: 640px\) \{\s*\.fab \{\s*position: fixed;/)
  })
  it('the orb cluster (Compass, Train Me, paperclip, agent menu) gives way on the phone Notebook, never mid-call', () => {
    expect(css('components/voice/FloatingOrb.module.css'))
      .toMatch(/@media \(max-width: 640px\) \{\s*:global\(html\[data-notebook-route\]\) \.orbCluster:not\(\[data-in-session\]\) \{\s*display: none;/)
    expect(css('components/voice/FloatingOrb.jsx')).toMatch(/data-in-session=\{inSession \? '' : undefined\}/)
  })
  it('the Help "?" gives way on the phone Notebook', () => {
    expect(css('components/FeedbackWidget.module.css'))
      .toMatch(/@media \(max-width: 640px\) \{\s*:global\(html\[data-notebook-route\]\) \.fab \{\s*display: none !important;/)
  })
})

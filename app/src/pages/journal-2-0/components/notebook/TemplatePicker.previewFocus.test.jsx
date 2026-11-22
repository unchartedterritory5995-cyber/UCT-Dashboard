// VIS-7 (audit 2026-11-05, visual-report §2.7 overlays): Tier 1b fixed focus return for Insert, Writing help and the
// tours. The audit's other named overlay is the template Preview (stacked over the New note sheet, two ✕ in view).
// It returns focus correctly today; this pins it: Escape AND its ✕ each put focus back on the "Preview <name>" button
// that opened it, never on <body> and never on the sheet beneath.
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import TemplatePicker from './TemplatePicker'
import { loadTemplates } from '../../lib/templatesLoader'
import { TEMPLATES } from '../../lib/notebookTemplates'

beforeAll(() => loadTemplates())
afterEach(cleanup)

const mount = () => render(<MemoryRouter><TemplatePicker onPick={() => {}} /></MemoryRouter>)

describe('the template Preview returns focus to its opener', () => {
  it.each([['Escape', async (user) => user.keyboard('{Escape}')],
    ['its ✕', async (user, dialog) => user.click(dialog.querySelector('button[aria-label="Close"]'))]])(
    '%s closes the Preview and focus is back on "Preview <name>"', async (_, close) => {
      const user = userEvent.setup()
      mount()
      const tpl = TEMPLATES.find((t) => screen.queryByRole('button', { name: `Preview ${t.label}` }))
      expect(tpl, 'a built-in template with a Preview button').toBeTruthy()
      const opener = screen.getByRole('button', { name: `Preview ${tpl.label}` })
      await user.click(opener)
      const dialog = await screen.findByRole('dialog', { name: tpl.label })
      await close(user, dialog)
      await waitFor(() => expect(screen.queryByRole('dialog', { name: tpl.label })).toBeNull())
      await waitFor(() => expect(document.activeElement).toBe(opener))
    })
})

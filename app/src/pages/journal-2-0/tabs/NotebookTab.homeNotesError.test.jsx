// Tier 4 fix round 3 (R1): round 2 made Research Home wait on its skeleton until NotebookTab's note count is known
// (the welcome no longer flashes for a member with notes). A FAILED count read leaves the total undefined for good, so
// the page must treat the failure as an answer and render -- never sit on a skeleton forever.
// Notebook simplify, Task 5: the bare Notebook is the notes list now (Research Home, and `?view=home`, open the list),
// so the rail reads the list: a failed read is said, and its loading skeleton does not stay up.
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { AUTH, installFetch, Providers } from '../a11y/fixtures'
import { __resetNotebookFlags } from '../lib/offline/notebookFlags'
import NotebookTab from './NotebookTab'

const settle = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })
afterEach(() => { cleanup(); __resetNotebookFlags() })

describe('the bare Notebook after a failed note-count read', () => {
  for (const route of ['/journal/notebook', '/journal/notebook?view=home']) {
    it(`${route}: says the read failed, not a skeleton that never ends`, async () => {
      installFetch([
        [/^\/api\/j2\/notes$/, [500, { detail: 'down' }]],
        [/mapping-offer$/, { offer: null }],
      ])
      render(<Providers auth={AUTH} route={route}><NotebookTab /></Providers>)
      await settle(60)
      await screen.findByRole('toolbar', { name: 'Notes list tools' })
      await waitFor(() => expect(screen.getByText(/Couldn't load your notes/)).toBeTruthy(), { timeout: 4000 })
      const pane = document.getElementById('notebook-pane')
      expect(pane.querySelector('[role="status"][aria-label="Loading…"]')).toBeNull()
    })
  }
})

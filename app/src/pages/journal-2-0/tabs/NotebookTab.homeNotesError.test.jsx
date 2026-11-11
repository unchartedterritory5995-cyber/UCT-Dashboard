// Tier 4 fix round 3 (R1): round 2 made Research Home wait on its skeleton until NotebookTab's note count is known
// (the welcome no longer flashes for a member with notes). A FAILED count read leaves the total undefined for good, so
// Home must treat the failure as an answer and render -- never sit on a skeleton forever. And the first-run / tour
// gates keep the strict `notesKnown`: a member whose list failed is never shown the new-member first run.
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { AUTH, installFetch, Providers } from '../a11y/fixtures'
import { __resetNotebookFlags } from '../lib/offline/notebookFlags'
import NotebookTab from './NotebookTab'

const settle = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })
afterEach(() => { cleanup(); __resetNotebookFlags() })

describe('Research Home after a failed note-count read', () => {
  it('renders Home, not a skeleton that never ends', async () => {
    installFetch([
      [/^\/api\/j2\/notes$/, [500, { detail: 'down' }]],
      [/mapping-offer$/, { offer: null }],
    ])
    render(<Providers auth={AUTH} route="/journal/notebook?view=home"><NotebookTab /></Providers>)
    await settle(60)
    // Home itself comes on screen (with no count it reads as a Home without notes, its welcome, as before round 2),
    // and the skeleton is gone.
    await waitFor(() => expect(document.querySelector('[class*="_firstRun_"], [class*="_homeTop_"]')).not.toBeNull(), { timeout: 4000 })
    expect(document.querySelector('[data-home-skeleton]')).toBeNull()
  })
})

// @vitest-environment jsdom
// app/src/pages/journal-2-0/a11y/followup.a11y.test.jsx
//
// Notebook P2 Tier 2 part B (Task 11): the Notices box holding the earnings follow-up row, through 8A's axe
// harness. The card itself is read by followupCard.a11y.test.jsx (Task 9); what that file cannot see is the
// door INTO it -- the row the producer writes, rendered by NoticesBox as a link to
// /journal/notebook?followup=ORCL&reportDate=2026-10-14 beside its Dismiss button. The row is the CAPTURED
// one (lib/__fixtures__/notices.followup.json, see its _provenance), not a typed copy of what the
// producer is believed to write. The box is read OPEN, after the link and the button are proved to be on
// screen by their accessible names, so axe is not run over an empty shell. NoticesBox keeps its own manifest
// entry (recipe 'notices-box'); this id is an extra rail on the same file, so notebookSurfaces.js is unchanged.
import { describe, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { axeSurface } from './surface'
import NoticesBox from '../components/notebook/NoticesBox'
import { AuthContext } from '../../../context/AuthContext'
import fu from '../lib/__fixtures__/notices.followup.json'

const json = (body) => ({ ok: true, status: 200, json: async () => body })

const TITLE = 'ORCL reported: write your follow-up'

describe('Tier 2 part B surfaces (the Notices row that opens the earnings follow-up)', () => {
  axeSurface('notices-followup-row', async () => {
    globalThis.fetch = vi.fn(async (url) => {
      const u = String(url)
      if (u === '/api/alerts?limit=20') return json(fu.alertsBody)
      if (u === '/api/voice/insights') return json({ insights: [] })
      return json({})
    })
    const { container } = render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <AuthContext.Provider value={{ user: { id: 'u1' } }}>
          <MemoryRouter>
            <main>
              <NoticesBox />
            </main>
          </MemoryRouter>
        </AuthContext.Provider>
      </SWRConfig>,
    )
    await screen.findByText(/Notices · 1/)
    const details = container.querySelector('details')
    details.open = true
    const box = within(details)
    // The accessible names, as a member's screen reader reads them (NoticesBox.jsx: the Link's text, and the
    // Dismiss button's aria-label of `Dismiss ${title}`).
    const link = box.getByRole('link', { name: TITLE })
    expect(link.getAttribute('href')).toBe('/journal/notebook?followup=ORCL&reportDate=2026-10-14')
    box.getByRole('button', { name: `Dismiss ${TITLE}` })
    expect(box.getAllByRole('listitem')).toHaveLength(1)
    return { root: container }
  })
})

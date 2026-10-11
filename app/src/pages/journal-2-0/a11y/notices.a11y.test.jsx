// @vitest-environment jsdom
// app/src/pages/journal-2-0/a11y/notices.a11y.test.jsx
//
// P0.4's Notices box on Research Home (components/notebook/NoticesBox.jsx) through 8A's axe
// harness. It arrived with no entry in a11y/notebookSurfaces.js, so `surfaceCoverage.test.js` failed
// by name. It gets a recipe of its own: Research Home's rail renders no member, so the box (which
// reads nothing while nobody is signed in) is never on screen there. The box is read OPEN, with a
// row of each kind -- a link row, a row whose title is plain text, and their Dismiss buttons --
// after the rows are proved to be there, so axe is not run over an empty shell.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { axeSurface } from './surface'
import { expectNoAxeViolations } from './axeHarness'
import NoticesBox from '../components/notebook/NoticesBox'
import { AuthContext } from '../../../context/AuthContext'
import fx from '../lib/__fixtures__/notices.json'

const json = (body) => ({ ok: true, status: 200, json: async () => body })

function stub() {
  const unlinked = { ...fx.insightsBody.insights[0], id: 2, headline: 'AMD is up 6.2% today, and you wrote about it', link: null }
  globalThis.fetch = vi.fn(async (url) => {
    const u = String(url)
    if (u === '/api/alerts?limit=20') return json(fx.alertsBody)
    if (u === '/api/voice/insights') return json({ insights: [...fx.insightsBody.insights, unlinked] })
    return json({})
  })
}

async function mount() {
  stub()
  const out = render(
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
  // Non-vacuity: the box is there, with its four notices.
  await screen.findByText(/Notices · 4/)
  return out
}

describe('Research Home\'s Notices box', () => {
  axeSurface('notices-box', async () => {
    const { container } = await mount()
    const details = container.querySelector('details')
    details.open = true
    const rows = within(details).getAllByRole('listitem')
    if (rows.length !== 4) throw new Error(`expected 4 notices, found ${rows.length}`)
    if (within(details).getAllByRole('button', { name: /^Dismiss / }).length !== 4) throw new Error('a row has no Dismiss')
    if (within(details).getAllByRole('link').length !== 3) throw new Error('expected 3 linked titles')
    return { root: container }
  })

  it('closed: axe finds 0 violations, and the summary is the only thing in the box', async () => {
    const { container } = await mount()
    expect(container.querySelector('details').open).toBe(false)
    await expectNoAxeViolations(container, { level: 'component' })
  }, 30000)
})

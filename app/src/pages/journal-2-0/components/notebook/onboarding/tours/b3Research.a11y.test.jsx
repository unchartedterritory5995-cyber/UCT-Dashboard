// Wave 14 lane W14-B3: one B3 tour through the ONE generic engine and 8A's axe
// harness. `earnings-prep` is the representative: it is the B3 tour whose start is a
// fixed Notebook location (Research Home), so it is the one a member reaches from
// Help today. The page carries its real anchors; the copy is its real copy.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import GenericTourEngine from '../GenericTourEngine'
import { expectNoAxeViolations } from '../../../../a11y/axeHarness'
import { installTourLayout } from '../__fixtures__/tourLayout'
import { TOURS } from './b3Research'

const ENTRY = TOURS.find((t) => t.id === 'earnings-prep')

let restoreLayout = () => {}
let steps = []
let copy = {}

function Page() {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <MemoryRouter initialEntries={['/journal/notebook']}>
        <main>
          <h1>Research home</h1>
          <ul aria-label="Names reporting soon" data-tour="reporting-soon-list">
            <li>
              <span data-tour="reporting-soon-when">Tomorrow, before the open</span>
              <span data-tour="reporting-soon-sources">Watchlist</span>
              <button type="button" data-tour="reporting-soon-prep">Create prep note</button>
            </li>
          </ul>
          <GenericTourEngine entry={ENTRY} onClose={() => {}} />
        </main>
      </MemoryRouter>
    </SWRConfig>
  )
}

beforeEach(async () => {
  global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))
  restoreLayout = installTourLayout()
  ;({ steps, copy } = await ENTRY.load())
})
afterEach(() => { vi.restoreAllMocks() })

describe('earnings-prep through the generic engine: axe', () => {
  it('the fixture carries every one of the tour\'s real anchors (non-vacuity)', async () => {
    render(<Page />)
    for (const s of steps) expect(document.querySelector(`[data-tour="${s.anchor}"]`), s.anchor).not.toBeNull()
    await screen.findByRole('dialog', {}, { timeout: 2000 })
  })

  it('the first step shows its real copy with zero violations', async () => {
    render(<Page />)
    expect(await screen.findByRole('dialog', {}, { timeout: 2000 })).toBeInTheDocument()
    expect(screen.getByText(copy[steps[0].id].title)).toBeInTheDocument()
    expect(screen.getByText(`Step 1 of ${steps.length}`)).toBeInTheDocument()
    restoreLayout()
    await expectNoAxeViolations(document.body)
  })

  it('the last step (Done) has zero violations', async () => {
    render(<Page />)
    await screen.findByRole('dialog', {}, { timeout: 2000 })
    for (let i = 1; i < steps.length; i += 1) fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText(copy[steps[steps.length - 1].id].title)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument()
    restoreLayout()
    await expectNoAxeViolations(document.body)
  })
})

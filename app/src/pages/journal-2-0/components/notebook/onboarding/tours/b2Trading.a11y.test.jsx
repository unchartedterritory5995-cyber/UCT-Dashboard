// Track W14-B2: one REAL tour through the ONE generic engine and 8A's axe harness.
// `review-drafts` is the representative: its steps and copy are loaded from the
// registry exactly as a member's would be, its anchors stand in as plain elements
// (the engine only needs `[data-tour]` boxes on screen), and every step is checked.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import GenericTourEngine from '../GenericTourEngine'
import { getTourEntry } from '../tourRegistry'
import { expectNoAxeViolations } from '../../../../a11y/axeHarness'
import { installTourLayout } from '../__fixtures__/tourLayout'

const ENTRY = getTourEntry('review-drafts')
let restoreLayout = () => {}

function Page({ steps }) {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <MemoryRouter initialEntries={['/journal/notebook']}>
        <main>
          {steps.map((s) => <div key={s.id} data-tour={s.anchor}>{s.id}</div>)}
          <GenericTourEngine entry={ENTRY} onClose={() => {}} />
        </main>
      </MemoryRouter>
    </SWRConfig>
  )
}

beforeEach(() => {
  global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))
  restoreLayout = installTourLayout()
})
afterEach(() => { vi.restoreAllMocks() })

describe('review-drafts tour through the generic engine: axe', () => {
  it('walks every step with its real copy; the last step has zero violations', async () => {
    const { steps, copy } = await ENTRY.load()
    render(<Page steps={steps} />)
    await screen.findByRole('dialog', {}, { timeout: 2000 })
    for (let i = 0; i < steps.length; i += 1) {
      expect(screen.getByText(copy[steps[i].id].title)).toBeInTheDocument()
      if (i < steps.length - 1) fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    }
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument()
    restoreLayout()
    await expectNoAxeViolations(document.body)
  })

  it('the first step: zero violations', async () => {
    render(<Page steps={(await ENTRY.load()).steps} />)
    await screen.findByRole('dialog', {}, { timeout: 2000 })
    restoreLayout()
    await expectNoAxeViolations(document.body)
  })
})

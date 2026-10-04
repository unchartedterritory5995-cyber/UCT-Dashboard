// The generic engine through 8A's axe harness (wave 14, lane W14-0) -- same pattern
// as NotebookTour.a11y.test.jsx, run against a fake tour since no real one ships
// in this lane. Proves the ONE engine's own markup, not any future tour's copy.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import GenericTourEngine from './GenericTourEngine'
import { expectNoAxeViolations } from '../../../a11y/axeHarness'
import { installTourLayout } from './__fixtures__/tourLayout'

const ENTRY = {
  id: 'w14-0-a11y-tour',
  load: async () => ({
    steps: [
      { id: 's1', anchor: 'a11y-anchor-1', file: 'x' },
      { id: 's2', anchor: 'a11y-anchor-2', file: 'x' },
    ],
    copy: {
      s1: { title: 'First step', body: 'The first body text.' },
      s2: { title: 'Second step', body: 'The second body text.' },
    },
  }),
}

let restoreLayout = () => {}

function Page() {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <MemoryRouter>
        <main>
          <div data-tour="a11y-anchor-1">anchor one</div>
          <div data-tour="a11y-anchor-2">anchor two</div>
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

describe('GenericTourEngine -- axe', () => {
  it('the first step: zero violations', async () => {
    render(<Page />)
    expect(await screen.findByRole('dialog', {}, { timeout: 2000 })).toBeInTheDocument()
    restoreLayout()
    await expectNoAxeViolations(document.body)
  })

  it('the second (last) step: zero violations', async () => {
    render(<Page />)
    await screen.findByRole('dialog', {}, { timeout: 2000 })
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument()
    restoreLayout()
    await expectNoAxeViolations(document.body)
  })
})

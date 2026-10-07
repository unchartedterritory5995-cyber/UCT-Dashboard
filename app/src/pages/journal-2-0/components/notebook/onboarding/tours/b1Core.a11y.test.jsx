// Wave 14, lane W14-B1: one REAL B1 tour through the generic engine and 8A's axe
// harness. `task-reminders` is the representative: its real entry, its real step
// list and its real copy, walked first step to last. The engine's own markup is
// covered by ../GenericTourEngine.a11y.test.jsx; this proves a shipped tour's copy
// and step count render without a violation too.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import GenericTourEngine from '../GenericTourEngine'
import { expectNoAxeViolations } from '../../../../a11y/axeHarness'
import { installTourLayout } from '../__fixtures__/tourLayout'
import { TOURS } from './b1Core'

const ENTRY = TOURS.find((t) => t.id === 'task-reminders')
let STEPS = []
let COPY = {}
let restoreLayout = () => {}

function Page() {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <MemoryRouter initialEntries={[ENTRY.start]}>
        <main>
          {STEPS.map((s) => <div key={s.id} data-tour={s.anchor}>{s.anchor}</div>)}
          <GenericTourEngine entry={ENTRY} onClose={() => {}} />
        </main>
      </MemoryRouter>
    </SWRConfig>
  )
}

beforeEach(async () => {
  ;({ steps: STEPS, copy: COPY } = await ENTRY.load())
  global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))
  restoreLayout = installTourLayout()
})
afterEach(() => { vi.restoreAllMocks() })

describe('task-reminders tour (real entry and copy) -- axe', () => {
  it('the first step: real copy on screen, zero violations', async () => {
    render(<Page />)
    expect(await screen.findByRole('dialog', {}, { timeout: 2000 })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: COPY[STEPS[0].id].title })).toBeInTheDocument()
    expect(screen.getByText(`Step 1 of ${STEPS.length}`)).toBeInTheDocument()
    restoreLayout()
    await expectNoAxeViolations(document.body)
  })

  it('the last step: zero violations', async () => {
    render(<Page />)
    await screen.findByRole('dialog', {}, { timeout: 2000 })
    for (let i = 1; i < STEPS.length; i += 1) fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByRole('heading', { name: COPY[STEPS[STEPS.length - 1].id].title })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument()
    restoreLayout()
    await expectNoAxeViolations(document.body)
  })
})

// Notebook P5 Task 10: the B4 track (b4Styles.js) through the ONE generic engine and 8A's axe harness,
// in the shape of b1Core / b2Trading / b3Research's a11y tests. Both B4 tours are walked: `journal-styles`
// and `style-library`. Steps and copy are loaded from the registry entry exactly as a member's would be; the
// anchors stand in as plain `[data-tour]` elements (the engine only needs boxes on screen). Two of the steps
// carry `waitFor` ("do this to continue"), so their cards are passive and say so in a status line; the walk
// uses Next, which a member may also choose.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import GenericTourEngine from '../GenericTourEngine'
import { expectNoAxeViolations } from '../../../../a11y/axeHarness'
import { installTourLayout } from '../__fixtures__/tourLayout'
import { TOURS } from './b4Styles'

let restoreLayout = () => {}

function Page({ entry, steps }) {
  // Every anchor a step names (its own and its waitFor), once each.
  const anchors = [...new Set(steps.flatMap((s) => [s.anchor, s.waitFor].filter(Boolean)))]
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <MemoryRouter initialEntries={['/journal/notebook?view=all']}>
        <main>
          <h1>Notes</h1>
          {anchors.map((a) => <div key={a} data-tour={a}>{a}</div>)}
          <GenericTourEngine entry={entry} onClose={() => {}} />
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

describe('the B4 tours through the generic engine: axe', () => {
  it('the track holds exactly the two tours this file walks (non-vacuity)', () => {
    expect(TOURS.map((t) => t.id)).toEqual(['journal-styles', 'style-library'])
  })

  for (const entry of TOURS) {
    it(`${entry.id}: walks every step with its real copy; the last step has zero violations`, async () => {
      const { steps, copy } = await entry.load()
      expect(steps.length).toBeGreaterThan(1)
      render(<Page entry={entry} steps={steps} />)
      await screen.findByRole('dialog', {}, { timeout: 2000 })
      for (let i = 0; i < steps.length; i += 1) {
        expect(screen.getByText(copy[steps[i].id].title)).toBeInTheDocument()
        expect(screen.getByText(`Step ${i + 1} of ${steps.length}`)).toBeInTheDocument()
        if (i < steps.length - 1) fireEvent.click(screen.getByRole('button', { name: 'Next' }))
      }
      expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument()
      restoreLayout()
      await expectNoAxeViolations(document.body)
    })

    it(`${entry.id}: the first step (a "do this to continue" step) has zero violations`, async () => {
      const { steps, copy } = await entry.load()
      expect(steps[0].waitFor).toBeTruthy()
      render(<Page entry={entry} steps={steps} />)
      await screen.findByRole('dialog', {}, { timeout: 2000 })
      expect(screen.getByText(copy[steps[0].id].title)).toBeInTheDocument()
      expect(screen.getByText('Do this to continue, or choose Next to skip it.')).toBeInTheDocument()
      restoreLayout()
      await expectNoAxeViolations(document.body)
    })
  }
})

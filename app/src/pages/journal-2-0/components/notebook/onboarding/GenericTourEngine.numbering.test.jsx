// Finish program, lane FE2, finding P6 — a tour numbers the steps it SHOWS.
//
// The Formulas tour opened on "Step 2 of 5" at every width: its first two steps are the two
// branches of one Add property button (a note with no properties, a note with some), so on a
// note that has properties step 1 can never show. The card counted the step's place in the
// file, not in what the member sees. Now a step that was passed over is not counted: the tour
// opens on "Step 1 of 4" and ends on "Step 4 of 4". When a later step turns out not to be there,
// the total drops by one at that moment; it never claims a step it will not show.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import GenericTourEngine from './GenericTourEngine'
import { STEPS as FORMULA_STEPS, COPY as FORMULA_COPY } from './tours/b1Formulas.steps'
import { installTourLayout } from './__fixtures__/tourLayout'

const tour = (ids) => ({
  id: 'fin-fe2-numbering',
  load: async () => ({
    steps: ids.map((id) => ({ id, anchor: `anchor-${id}`, file: 'x' })),
    copy: Object.fromEntries(ids.map((id) => [id, { title: `Title ${id}`, body: 'b' }])),
  }),
})

function Page({ entry, anchors }) {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <MemoryRouter>
        {anchors.map((a) => <div key={a} data-tour={a}>{a}</div>)}
        <GenericTourEngine entry={entry} onClose={vi.fn()} startWaitMs={120} stepWaitMs={120} />
      </MemoryRouter>
    </SWRConfig>
  )
}

let restore
beforeEach(() => {
  global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))
  restore = installTourLayout()
})
afterEach(() => { restore(); vi.restoreAllMocks() })

const progress = () => screen.findByText(/^Step \d+ of \d+$/, {}, { timeout: 4000 })
const next = () => fireEvent.click(screen.getByRole('button', { name: 'Next' }))

describe('P6 — the step counter counts what is shown', () => {
  it('the Formulas tour on a note that HAS properties opens on Step 1 of 4 and ends on Step 4 of 4', async () => {
    const entry = { id: 'formulas-rollups', load: async () => ({ steps: FORMULA_STEPS, copy: FORMULA_COPY }) }
    // a note with properties: the "no properties yet" button (step add-first) does not exist
    render(<Page entry={entry} anchors={['properties-add', 'computed-value', 'computed-edit']} />)
    expect((await progress()).textContent).toBe('Step 1 of 4')
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Numbers that work themselves out')
    const seen = ['Step 1 of 4']
    for (let i = 0; i < 3; i += 1) {
      next()
      seen.push((await screen.findByText(new RegExp(`^Step ${i + 2} of 4$`), {}, { timeout: 4000 })).textContent)
    }
    expect(seen).toEqual(['Step 1 of 4', 'Step 2 of 4', 'Step 3 of 4', 'Step 4 of 4'])
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument()
  })

  it('a first step that is not there: the tour opens on Step 1, of one fewer', async () => {
    render(<Page entry={tour(['a', 'b', 'c'])} anchors={['anchor-b', 'anchor-c']} />)
    expect((await progress()).textContent).toBe('Step 1 of 2')
  })

  it('a middle step that turns out not to be there is dropped from the total when it is passed', async () => {
    render(<Page entry={tour(['a', 'b', 'c'])} anchors={['anchor-a', 'anchor-c']} />)
    expect((await progress()).textContent).toBe('Step 1 of 3')
    next()
    expect((await screen.findByText('Step 2 of 2', {}, { timeout: 4000 })).textContent).toBe('Step 2 of 2')
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Title c')
  })

  it('Back onto an earlier step keeps its number', async () => {
    render(<Page entry={tour(['a', 'b', 'c'])} anchors={['anchor-b', 'anchor-c']} />)
    await progress()
    next()
    await screen.findByText('Step 2 of 2', {}, { timeout: 4000 })
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect((await screen.findByText('Step 1 of 2', {}, { timeout: 4000 })).textContent).toBe('Step 1 of 2')
  })

  it('CONTROL — with every step there, the numbers are the plain ones', async () => {
    render(<Page entry={tour(['a', 'b', 'c'])} anchors={['anchor-a', 'anchor-b', 'anchor-c']} />)
    expect((await progress()).textContent).toBe('Step 1 of 3')
    next()
    expect((await screen.findByText('Step 2 of 3', {}, { timeout: 4000 })).textContent).toBe('Step 2 of 3')
  })
})

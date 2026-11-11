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

  // ⛔ Audit 2026-11-05, spec S5 (B6): the total used to DROP when a missing middle step was passed
  // ("Step 1 of 5", then "Step 2 of 3" on the My Playbook tour). The list is fixed when the tour
  // opens, so a step not on screen then is out of the total from the first card, and it holds.
  it('a middle step that is not there is out of the total from the first card, and the total holds', async () => {
    render(<Page entry={tour(['a', 'b', 'c'])} anchors={['anchor-a', 'anchor-c']} />)
    expect((await progress()).textContent).toBe('Step 1 of 2')
    next()
    expect((await screen.findByText('Step 2 of 2', {}, { timeout: 4000 })).textContent).toBe('Step 2 of 2')
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Title c')
  })

  // ⛔ Fix round 1 (review finding 3): an anchor that is IN the page but not on screen until the
  // tour marks it (the chart toolbar, revealed by [data-tour-active]) is a step the tour will show.
  // It is counted from the first card, so the total never grows as the tour reaches it.
  // Fix round 2 (re-review N5): the reveal is modelled the way the engine can show it -- an anchor
  // in the page with NO BOX yet (CSS keyed on [data-tour-active] gives it one), never a `hidden`
  // attribute, which `anchorFor` refuses for ever.
  it('an anchor in the page with no box until the tour reveals it is counted from the first card', async () => {
    render(<Page entry={tour(['a', 'b'])} anchors={['anchor-a']} />)
    const revealedLater = document.createElement('div')
    revealedLater.setAttribute('data-tour', 'anchor-b')
    revealedLater.setAttribute('data-test-box', 'none')      // display:none until the tour marks it
    document.body.appendChild(revealedLater)
    try {
      expect((await progress()).textContent).toBe('Step 1 of 2')
    } finally {
      revealedLater.remove()
    }
  })

  it('an anchor the engine can never show (inside [hidden] or aria-hidden) is not counted', async () => {
    render(<Page entry={tour(['a', 'b', 'c'])} anchors={['anchor-a']} />)
    const never = document.createElement('div')
    never.setAttribute('hidden', '')
    never.innerHTML = '<span data-tour="anchor-b"></span>'
    const alsoNever = document.createElement('div')
    alsoNever.setAttribute('aria-hidden', 'true')
    alsoNever.innerHTML = '<span data-tour="anchor-c"></span>'
    document.body.append(never, alsoNever)
    try {
      expect((await progress()).textContent).toBe('Step 1 of 1')
    } finally {
      never.remove()
      alsoNever.remove()
    }
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

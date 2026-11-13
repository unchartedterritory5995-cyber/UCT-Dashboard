// Go-live wave 1: a step may belong to one screen tier (`tier`, tourTiers.js). The engine drops the other tiers' steps
// when the tour loads, so a control that is visible at both widths but is a step of only one (the list's ⋯, the phone
// door to the New menu's rows) is never pointed at on the wrong screen, the count is the screen's own, and the last
// step of the screen's tour says Done.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import GenericTourEngine from './GenericTourEngine'
import { installTourLayout } from './__fixtures__/tourLayout'
import { MQ } from '../../../../../styles/breakpoints'

const entry = {
  id: 'tiers-probe',
  load: async () => ({
    steps: [
      { id: 'w1', anchor: 'menu-arrow', file: 'x', tier: 'wide' },
      { id: 'w2', anchor: 'menu-row', file: 'x', tier: 'wide' },
      { id: 'p1', anchor: 'more-button', file: 'x', tier: 'phone' },
      { id: 'all', anchor: 'everywhere', file: 'x' },
    ],
    copy: {
      w1: { title: 'Wide one', body: 'b' }, w2: { title: 'Wide two', body: 'b' },
      p1: { title: 'Phone one', body: 'b' }, all: { title: 'Every screen', body: 'b' },
    },
  }),
}

// Every anchor is on the page: the tier, not the box, is what decides.
function Page() {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <MemoryRouter>
        {['menu-arrow', 'menu-row', 'more-button', 'everywhere'].map((a) => <div key={a} data-tour={a}>{a}</div>)}
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
afterEach(() => { restore(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

const progress = () => screen.findByText(/^Step \d+ of \d+$/, {}, { timeout: 4000 })
const next = () => fireEvent.click(screen.getByRole('button', { name: 'Next' }))
const phoneScreen = () => vi.stubGlobal('matchMedia', (q) => ({ matches: q === MQ.phone || q === MQ.tabletDown }))
const desktopScreen = () => vi.stubGlobal('matchMedia', () => ({ matches: false }))

describe('a step for another screen tier is not in the tour', () => {
  it('desktop: the wide steps and the untiered one, never the phone step, and the last says Done', async () => {
    desktopScreen()
    render(<Page />)
    expect((await progress()).textContent).toBe('Step 1 of 3')
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Wide one')
    next()
    expect(await screen.findByRole('dialog', { name: 'Wide two' })).toBeInTheDocument()
    next()
    expect(await screen.findByRole('dialog', { name: 'Every screen' })).toBeInTheDocument()
    expect(screen.getByText('Step 3 of 3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument()
  })

  it('phone: the phone step and the untiered one, never the wide steps', async () => {
    phoneScreen()
    render(<Page />)
    expect((await progress()).textContent).toBe('Step 1 of 2')
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Phone one')
    next()
    expect(await screen.findByRole('dialog', { name: 'Every screen' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument()
  })
})

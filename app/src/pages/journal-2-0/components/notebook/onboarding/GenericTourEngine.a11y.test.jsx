// The generic engine through 8A's axe harness (wave 14, lane W14-0) -- same pattern
// as NotebookTour.a11y.test.jsx, run against a fake tour since no real one ships
// in this lane. Proves the ONE engine's own markup, not any future tour's copy.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import Sheet from '../../../../../components/mobile/Sheet'
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

// W14-C1: the engine's new markup -- the non-modal card (a "do this" step, and a step
// inside a sheet) and the "cannot start here" card -- through the same harness.
const WAIT = {
  id: 'c1-a11y-wait',
  title: 'Wait tour',
  replayable: true,
  load: async () => ({
    steps: [
      { id: 'w1', anchor: 'c1-door', file: 'x', waitFor: 'c1-panel' },
      { id: 'w2', anchor: 'c1-panel', file: 'x' },
    ],
    copy: { w1: { title: 'Open it', body: 'Choose Plan to continue.' }, w2: { title: 'The panel', body: 'Here it is.' } },
  }),
}
const IN_SHEET = {
  id: 'c1-a11y-sheet',
  title: 'Sheet tour',
  replayable: true,
  load: async () => ({
    steps: [{ id: 'i1', anchor: 'c1-in', file: 'x' }, { id: 'i2', anchor: 'c1-in2', file: 'x' }],
    copy: { i1: { title: 'In the sheet', body: 'Inside.' }, i2: { title: 'Still in', body: 'More.' } },
  }),
}
const NOTE_START = {
  id: 'c1-a11y-none',
  title: 'Note tour',
  replayable: true,
  start: { note: 'recent' },
  load: async () => ({
    steps: [{ id: 'n1', anchor: 'c1-never', file: 'x' }],
    copy: { n1: { title: 'Never', body: 'Never shown.' } },
  }),
}
const wrap = (children) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <MemoryRouter><main>{children}</main></MemoryRouter>
  </SWRConfig>
)

describe('GenericTourEngine W14-C1 markup -- axe', () => {
  it('a non-modal "do this to continue" card: zero violations', async () => {
    render(wrap(<>
      <button type="button" data-tour="c1-door">Plan</button>
      <GenericTourEngine entry={WAIT} onClose={() => {}} />
    </>))
    const d = await screen.findByRole('dialog', { name: 'Open it' }, { timeout: 2000 })
    expect(d).not.toHaveAttribute('aria-modal')
    restoreLayout()
    await expectNoAxeViolations(document.body)
  })

  it('a non-modal card inside a Sheet: zero violations', async () => {
    render(wrap(<>
      <Sheet open onClose={() => {}} title="A sheet" labelledByTitle variant="modal">
        <p data-tour="c1-in">inside</p>
        <p data-tour="c1-in2">inside too</p>
      </Sheet>
      <GenericTourEngine entry={IN_SHEET} onClose={() => {}} />
    </>))
    const d = await screen.findByRole('dialog', { name: 'In the sheet' }, { timeout: 2000 })
    expect(d.closest('[data-sheet-panel]')).not.toBeNull()
    restoreLayout()
    await expectNoAxeViolations(document.body)
  })

  it('the "this walkthrough runs inside a note" card: zero violations', async () => {
    global.fetch = vi.fn(async (url) => ({ ok: true, status: 200, json: async () => (String(url).startsWith('/api/j2/notes?') ? { notes: [] } : {}) }))
    render(wrap(<GenericTourEngine entry={NOTE_START} onClose={() => {}} />))
    await screen.findByRole('dialog', { name: 'This walkthrough runs inside a note' }, { timeout: 2000 })
    restoreLayout()
    await expectNoAxeViolations(document.body)
  })
})

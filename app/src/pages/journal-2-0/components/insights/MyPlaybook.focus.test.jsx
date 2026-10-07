// Lane FIN-A11Y (review R4: I-10, M-10, M-11 and the status note in M-16). My Playbook
// promises "every number opens its trades". For a screen reader member pressing a number
// said nothing (the table appears further down the card), and Close removed the table with
// focus inside it. Now the number says whether its trades are open, opening moves focus to
// the table's heading, and Close returns focus to the number.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import MyPlaybook from './MyPlaybook'
import { latchNotebookFlags, __resetNotebookFlags } from '../../lib/offline/notebookFlags'

const trade = (id, win) => ({
  id, tradeRef: 'id:' + id, symbol: 'NVDA', side: 'Long', result: win ? 'Win' : 'Loss',
  entryDate: '2026-03-02T14:30:00+00:00', exitDate: '2026-03-03T19:30:00+00:00',
  rMultiple: win ? 2 : -1, pnlDollar: win ? 200 : -100, source: null,
})
const setup = (name) => ({
  setup: name, tradeCount: 25, winCount: 10, lossCount: 15, beCount: 0, winRate: 0.4,
  profitFactor: 1.33, expectancy: 20, expectancyR: 0.2, avgR: 0.2, totalR: 5, totalPnlDollar: 500,
  sample: { n: 25, band: 'normal', wording: null },
  winRateStat: { k: 10, n: 25, rate: 0.4, band: 'normal', wording: null, range: null },
  avgRStat: { n: 25, mean: 0.2, band: 'normal', wording: null, range: null },
  expectancyStat: { n: 25, mean: 20, band: 'normal', wording: null, range: null },
  trades: Array.from({ length: 25 }, (_, i) => trade(name + i, i % 5 < 2)),
})
const PAYLOAD = {
  asOf: '2026-10-03T12:00:00+00:00', accountId: null, untagged: { count: 0 },
  sample: { tooFewBelow: 10, normalFrom: 25, rangeZ: 1.96, wording: {} },
  setups: [setup('Pullback'), setup('Breakout')],
  notesBySetup: { Pullback: [], Breakout: [] },
  patterns: null,
}
const json = (body) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })

function renderPage(props = {}) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <MemoryRouter initialEntries={['/journal-2-0/playbook']}>
        <main>
          <Routes>
            <Route path="/journal-2-0/playbook" element={<MyPlaybook {...props} />} />
            <Route path="/journal/notebook" element={<p>notebook page</p>} />
          </Routes>
        </main>
      </MemoryRouter>
    </SWRConfig>,
  )
}

beforeEach(() => {
  latchNotebookFlags({ notebook_playbook_enabled: true })
  global.fetch = vi.fn((url) => (String(url).startsWith('/api/j2/my-playbook') ? json(PAYLOAD) : json({})))
})
afterEach(() => { __resetNotebookFlags(); vi.restoreAllMocks() })

const number = (card, label) => within(card).getByRole('button', { name: new RegExp('^' + label + ' ') })

describe('I-10 -- a number that opens its trades says so and moves focus', () => {
  it('each number says it is collapsed, and names the region it opens once that exists', async () => {
    const user = userEvent.setup()
    renderPage()
    const card = await screen.findByRole('article', { name: 'Pullback' })
    const win = number(card, 'Win rate')
    expect(win).toHaveAttribute('aria-expanded', 'false')
    await user.click(win)
    expect(win).toHaveAttribute('aria-expanded', 'true')
    const drill = within(card).getByTestId('playbook-drill')
    expect(win.getAttribute('aria-controls')).toBe(drill.id)
    // the others on the card are still collapsed
    expect(number(card, 'Avg R')).toHaveAttribute('aria-expanded', 'false')
  })

  it('opening moves focus to the heading of the trades table', async () => {
    const user = userEvent.setup()
    renderPage()
    const card = await screen.findByRole('article', { name: 'Pullback' })
    await user.click(number(card, 'Win rate'))
    const heading = within(card).getByRole('heading', { name: /Pullback win rate: the 25 wins and losses behind it/ })
    await waitFor(() => expect(heading).toHaveFocus())
  })

  it('switching to another number on the same card moves focus to the new heading', async () => {
    const user = userEvent.setup()
    renderPage()
    const card = await screen.findByRole('article', { name: 'Pullback' })
    await user.click(number(card, 'Win rate'))
    await user.click(number(card, 'Avg R'))
    const heading = within(card).getByRole('heading', { name: /Pullback avg r: the 25 trades with an R behind it/ })
    await waitFor(() => expect(heading).toHaveFocus())
    expect(number(card, 'Win rate')).toHaveAttribute('aria-expanded', 'false')
    expect(number(card, 'Avg R')).toHaveAttribute('aria-expanded', 'true')
  })

  it('Close returns focus to the number that opened it', async () => {
    const user = userEvent.setup()
    renderPage()
    const card = await screen.findByRole('article', { name: 'Pullback' })
    await user.click(number(card, 'Expectancy'))
    await user.click(within(card).getByRole('button', { name: /^Close/ }))
    expect(within(card).queryByTestId('playbook-drill')).toBeNull()
    expect(number(card, 'Expectancy')).toHaveFocus()
    expect(number(card, 'Expectancy')).toHaveAttribute('aria-expanded', 'false')
  })

  it('the Close button says what it closes', async () => {
    const user = userEvent.setup()
    renderPage()
    const card = await screen.findByRole('article', { name: 'Pullback' })
    await user.click(number(card, 'Win rate'))
    expect(within(card).getByRole('button', { name: 'Close the trades behind Pullback win rate' })).toBeInTheDocument()
  })

  it('opening a number on another card closes the first and focuses the new table', async () => {
    const user = userEvent.setup()
    renderPage()
    const a = await screen.findByRole('article', { name: 'Pullback' })
    const b = screen.getByRole('article', { name: 'Breakout' })
    await user.click(number(a, 'Win rate'))
    await user.click(number(b, 'Win rate'))
    expect(within(a).queryByTestId('playbook-drill')).toBeNull()
    const heading = within(b).getByRole('heading', { name: /Breakout win rate/ })
    await waitFor(() => expect(heading).toHaveFocus())
  })
})

describe('M-11 -- one main landmark', () => {
  it('the page is a labelled section inside the shell main, not a second main', async () => {
    renderPage()
    const page = await screen.findByTestId('my-playbook')
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(page.tagName).toBe('SECTION')
    expect(page).toHaveAccessibleName('My Playbook')
    expect(within(page).getByRole('heading', { name: 'My Playbook' })).toBeInTheDocument()
  })
})

describe('M-16 -- the snapshot result is a status that was already there', () => {
  it('the region is mounted before the save, and the result is written into the same element', async () => {
    const user = userEvent.setup()
    const save = vi.fn(async () => ({ id: 'snap-1' }))
    renderPage({ onSaveSnapshot: save })
    await screen.findByRole('article', { name: 'Pullback' })
    const region = screen.getByRole('status')
    expect(region).toHaveTextContent('')
    await user.click(screen.getByRole('button', { name: 'Save a snapshot note' }))
    await waitFor(() => expect(region).toHaveTextContent(/Snapshot saved/))
    expect(screen.getByRole('status')).toBe(region)
  })
})

describe('M-10 -- links are not told apart by colour alone', () => {
  const css = readFileSync(join(process.cwd(), 'src/pages/journal-2-0/components/insights/MyPlaybook.module.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
  const body = (selector) => {
    const at = css.indexOf('\n' + selector + ' {')
    expect(at, selector).toBeGreaterThanOrEqual(0)
    return css.slice(at, css.indexOf('}', at))
  }

  it('.link and .linkBtn are underlined at rest', () => {
    expect(body('.link')).toMatch(/text-decoration:\s*underline/)
    expect(body('.linkBtn')).toMatch(/text-decoration:\s*underline/)
    expect(body('.link')).not.toMatch(/text-decoration:\s*none/)
  })
})

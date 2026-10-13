// Insights, "Before / after this rule" (Notebook P2b Task 9; spec §P2 item 2; R-P2b-3; Review Focus 2).
// The card reads the account's rules and one rule's before / after windows; every case asserts what is
// on screen once the read settles (R-RC-2).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { windowLines } from '../../lib/blocks/beforeAfterText'

let RULES_RET
const rulesCalls = []
vi.mock('../../hooks/useJournalRules', () => ({
  default: (id) => { rulesCalls.push(id); return RULES_RET },
}))
let stylesOn = true
vi.mock('../../lib/journalStylesFlag', () => ({ journalStylesEnabled: () => stylesOn }))
import RuleBeforeAfterCard from './RuleBeforeAfterCard'
import PsychologySection from './PsychologySection'

const win = (o) => ({ from: null, to: null, trades: 0, wins: 0, winRate: null, rCount: 0, avgR: null, adherenceCount: 0, adherence: null, small: true, ...o })
const V2 = {
  version: 2, label: 'Wait 15 minutes', changedAt: '2026-10-02T15:00:00+00:00',
  before: win({ trades: 21, wins: 13, winRate: 13 / 21, small: false, rCount: 18, avgR: 1.4, adherenceCount: 12, adherence: 0.8 }),
  after: win({ trades: 7, wins: 4, winRate: 4 / 7, rCount: 7, avgR: -0.25, adherenceCount: 6, adherence: 0.5 }),
}
const V1 = {
  version: 1, label: 'Wait 5 minutes', changedAt: '2026-06-01T15:00:00+00:00',
  before: win({}), after: win({ trades: 3, wins: 1, winRate: 1 / 3 }),
}
const RULES = [{ id: 'r1', label: 'Wait 15 minutes' }, { id: 'r2', label: 'No adds to a loser' }]

const realFetch = globalThis.fetch
const urls = []
beforeEach(() => {
  RULES_RET = { rules: RULES, isLoading: false }
  rulesCalls.length = 0
  urls.length = 0
  stylesOn = true
  globalThis.fetch = vi.fn(async (url) => {
    urls.push(url)
    if (url === '/api/j2/trader-blocks/rules/r1/before-after') {
      return { ok: true, status: 200, json: async () => ({ ruleId: 'r1', accountId: 'a1', versions: [V2, V1] }) }
    }
    if (String(url).endsWith('/before-after')) return { ok: false, status: 404, json: async () => ({ detail: 'Not found' }) }
    return { ok: true, status: 200, json: async () => ({ trades: [] }) }
  })
})
afterEach(() => { globalThis.fetch = realFetch })

const fresh = (ui) => render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>)
const column = (section, name) => within(section).getByRole('list', { name })

describe('RuleBeforeAfterCard', () => {
  it('the "Rule" picker lists the account\'s rules; the newest version comes first, with its words and day', async () => {
    fresh(<RuleBeforeAfterCard accountId="a1" />)
    const picker = screen.getByRole('combobox', { name: 'Rule' })
    expect([...picker.options].map((o) => o.textContent)).toEqual(['Wait 15 minutes', 'No adds to a loser'])
    expect(rulesCalls).toContain('a1')
    const sections = await screen.findAllByRole('region', { name: /^Version / })
    expect(sections.map((s) => s.getAttribute('aria-label'))).toEqual(['Version 2', 'Version 1'])
    expect(within(sections[0]).getByText('Wait 15 minutes')).toBeTruthy()
    expect(within(sections[0]).getByText('v2 · changed Oct 2')).toBeTruthy()
    expect(within(sections[1]).getByText('Wait 5 minutes')).toBeTruthy()
    expect(urls).toContain('/api/j2/trader-blocks/rules/r1/before-after')
  })

  it('each window reads its three lines from windowLines: sample sizes always, no bare rate under 10', async () => {
    fresh(<RuleBeforeAfterCard accountId="a1" />)
    const [v2, v1] = await screen.findAllByRole('region', { name: /^Version / })
    const before = column(v2, 'Before')
    const after = column(v2, 'After')
    expect(within(before).getAllByRole('listitem').map((li) => li.textContent))
      .toEqual(['62% won (13 of 21 trades)', '+1.40 R average (over 18 trades)', '80% of checklist items followed (over 12 trades)'])
    expect(within(after).getAllByRole('listitem').map((li) => li.textContent))
      .toEqual(['4 of 7 won (too few trades to read as a rate)', '-0.25 R average (over 7 trades)',
        '50% of checklist items followed (only 6 trades: too few to read as a rate)'])
    // every window, not just the two spelled out above
    for (const [section, v] of [[v2, V2], [v1, V1]]) {
      for (const side of ['before', 'after']) {
        const name = side === 'before' ? 'Before' : 'After'
        expect(within(column(section, name)).getAllByRole('listitem').map((li) => li.textContent))
          .toEqual(Object.values(windowLines(v[side])))
      }
    }
  })

  it('a rule the server will not read (404) says so in words, never a status code', async () => {
    fresh(<RuleBeforeAfterCard accountId="a1" />)
    await screen.findAllByRole('region', { name: /^Version / })
    fireEvent.change(screen.getByRole('combobox', { name: 'Rule' }), { target: { value: 'r2' } })
    expect(await screen.findByText('This rule could not be read. It may have been dismissed.')).toBeTruthy()
    expect(screen.queryByRole('region', { name: /^Version / })).toBeNull()
    expect(screen.queryByText(/404|Not found/)).toBeNull()
    expect(urls).toContain('/api/j2/trader-blocks/rules/r2/before-after')
  })

  it('another failure says it could not load, and Try again asks again', async () => {
    globalThis.fetch = vi.fn(async (url) => { urls.push(url); return { ok: false, status: 500, json: async () => ({}) } })
    fresh(<RuleBeforeAfterCard accountId="a1" />)
    expect(await screen.findByText("The before and after numbers couldn't load.")).toBeTruthy()
    const asked = urls.length
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(urls.length).toBeGreaterThan(asked))
  })

  it('no rules: nothing to compare, so the card shows nothing and asks the server nothing', () => {
    RULES_RET = { rules: [], isLoading: false }
    const { container } = fresh(<RuleBeforeAfterCard accountId="a1" />)
    expect(container.textContent).toBe('')
    expect(urls.filter((u) => String(u).includes('before-after'))).toEqual([])
  })
})

const analytics = {
  psychology: {
    emotionOutcomes: [], costOfMistakes: { total: 0, byMistake: [] },
    revenge: { flags: [], timeComponentCoverage: { timed: 1, total: 1 } }, taggedTradeCount: 5,
  },
}

describe('PsychologySection mounts the card only while Journal styles is on', () => {
  // The card is a lazy chunk. Each case first mounts it with the switch on (the CONTROL, and it
  // leaves the chunk resolved), so the absent case below renders WITHOUT suspending: a card that
  // should not be there would be on screen at once, never hidden behind a chunk still loading.
  async function warm() {
    stylesOn = true
    const view = fresh(<PsychologySection analytics={analytics} accountId="a1" />)
    expect(await screen.findByText('Before / after this rule')).toBeTruthy()
    expect(await screen.findAllByRole('region', { name: /^Version / })).toHaveLength(2)
    view.unmount()
    urls.length = 0
  }
  it('switch off: no card, and no before / after read', async () => {
    await warm()
    stylesOn = false
    fresh(<PsychologySection analytics={analytics} accountId="a1" />)
    expect(screen.getByText('Trading psychology')).toBeTruthy()
    expect(screen.queryByText('Before / after this rule')).toBeNull()
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByText('Before / after this rule')).toBeNull()
    expect(urls.filter((u) => String(u).includes('before-after'))).toEqual([])
  })
  it('switch on but no single account: no card', async () => {
    await warm()
    fresh(<PsychologySection analytics={analytics} accountId={null} />)
    expect(screen.queryByText('Before / after this rule')).toBeNull()
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByText('Before / after this rule')).toBeNull()
  })
})

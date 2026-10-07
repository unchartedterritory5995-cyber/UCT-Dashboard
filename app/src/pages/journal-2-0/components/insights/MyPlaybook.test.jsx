// Wave 13 lane 13B — My Playbook's page rails.
//
//  * R3 on screen: a too-few setup hides its numbers behind "too few to judge"; a thin one shows
//    "thin sample" with its range; a normal one shows the number plainly.
//  * EVERY DISPLAYED NUMBER IS THE AUTHORITY'S: each number token on the page is a payload value
//    run through the page's own formatters (or a count/date the payload carries) — nothing is
//    computed on the client.
//  * NO STAT WITHOUT ITS n: every stat cell carries its sample size beside it.
//  * Every number opens its trades, and the drill lists exactly n of them.
//  * Every pattern finding cites its trades and notes.
//  * Flag off: nothing is fetched and the route sends the member back to Insights.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { SWRConfig } from 'swr'
import MyPlaybook from './MyPlaybook'
import { latchNotebookFlags, __resetNotebookFlags } from '../../lib/offline/notebookFlags'
import { fmtDollar, fmtPct, fmtPF, fmtR } from '../../lib/playbookFormat'

const trade = (id, result, r, pnl, extra = {}) => ({
  id, tradeRef: `id:${id}`, symbol: 'NVDA', side: 'Long', result, entryDate: '2026-03-02T14:30:00+00:00',
  exitDate: '2026-03-03T19:30:00+00:00', rMultiple: r, pnlDollar: pnl, source: null, ...extra,
})

const BREAKOUT_TRADES = [2.0, -1.0, 1.5, -1.0, 3.0, -0.5, 0.8, -1.0, 2.2, -1.0, 1.1, 0.4]
  .map((r, i) => trade(`b${i}`, r > 0 ? 'Win' : 'Loss', r, Math.round(r * 10000) / 100, i === 0 ? { source: 'broker' } : {}))

const PAYLOAD = {
  asOf: '2026-10-03T12:00:00+00:00',
  accountId: null,
  untagged: { count: 3 },
  sample: { tooFewBelow: 10, normalFrom: 25, rangeZ: 1.96, wording: { too_few: 'too few to judge', thin: 'thin sample', normal: null } },
  setups: [
    {
      setup: 'Breakout', tradeCount: 12, winCount: 7, lossCount: 5, beCount: 0, winRate: 7 / 12,
      profitFactor: 2.42, expectancy: 54.17, expectancyR: 0.5417, avgR: 0.5417, totalR: 6.5, totalPnlDollar: 650,
      sample: { n: 12, band: 'thin', wording: 'thin sample' },
      winRateStat: { k: 7, n: 12, rate: 0.5833, band: 'thin', wording: 'thin sample', range: [0.32, 0.807] },
      avgRStat: { n: 12, mean: 0.5417, band: 'thin', wording: 'thin sample', range: [-0.374, 1.457] },
      expectancyStat: { n: 12, mean: 54.1667, band: 'thin', wording: 'thin sample', range: [-37.366, 145.7] },
      trades: BREAKOUT_TRADES,
    },
    {
      setup: 'High Tight Flag', tradeCount: 9, winCount: 6, lossCount: 3, beCount: 0, winRate: 6 / 9,
      profitFactor: 2.0, expectancy: 33.33, expectancyR: 0.3333, avgR: 0.3333, totalR: 3, totalPnlDollar: 300,
      sample: { n: 9, band: 'too_few', wording: 'too few to judge' },
      winRateStat: { k: 6, n: 9, rate: 0.6667, band: 'too_few', wording: 'too few to judge', range: null },
      avgRStat: { n: 9, mean: 0.3333, band: 'too_few', wording: 'too few to judge', range: null },
      expectancyStat: { n: 9, mean: 33.3333, band: 'too_few', wording: 'too few to judge', range: null },
      trades: Array.from({ length: 9 }, (_, i) => trade(`h${i}`, i % 3 ? 'Win' : 'Loss', i % 3 ? 1 : -1, i % 3 ? 100 : -100)),
    },
    {
      setup: 'Pullback', tradeCount: 25, winCount: 10, lossCount: 15, beCount: 0, winRate: 0.4,
      profitFactor: 1.33, expectancy: 20, expectancyR: 0.2, avgR: 0.2, totalR: 5, totalPnlDollar: 500,
      sample: { n: 25, band: 'normal', wording: null },
      winRateStat: { k: 10, n: 25, rate: 0.4, band: 'normal', wording: null, range: null },
      avgRStat: { n: 25, mean: 0.2, band: 'normal', wording: null, range: null },
      expectancyStat: { n: 25, mean: 20, band: 'normal', wording: null, range: null },
      trades: Array.from({ length: 25 }, (_, i) => trade(`p${i}`, i % 5 < 2 ? 'Win' : 'Loss', i % 5 < 2 ? 2 : -1, i % 5 < 2 ? 200 : -100)),
    },
  ],
  notesBySetup: { Breakout: [{ noteId: 'n-plan', title: 'NVDA breakout plan', tradeCount: 2 }], 'High Tight Flag': [], Pullback: [] },
  patterns: {
    caption: 'Patterns, not proof', status: 'ok', tradesRead: 46, noted: { wins: 6, losses: 6 },
    constants: { MIN_NOTED_PER_SIDE: 5, MIN_MENTIONS: 3, MAX_FINDINGS: 6, MAX_TRADES: 500 },
    vocabulary: { source: 'standard', terms: ['FOMO', 'patient'] },
    excludes: 'Break-even trades, and notes written or edited after entry, are not read.',
    findings: [
      {
        term: 'FOMO', kind: 'mistake', leans: 'losses', losses: { k: 4, n: 6 }, wins: { k: 1, n: 6 },
        citations: ['b1', 'b3', 'b5', 'b7', 'b0'].map((id, i) => ({
          tradeId: id, tradeRef: `id:${id}`, symbol: 'NVDA', result: i < 4 ? 'Loss' : 'Win',
          exitDate: '2026-03-03T19:30:00+00:00', notes: [{ noteId: `nf${i}`, title: `Pre-trade ${i}`, asOf: '2026-03-01' }],
        })),
      },
    ],
  },
}

const json = (body) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
const settle = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })

function renderPage(props = {}) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <MemoryRouter initialEntries={['/journal-2-0/playbook']}>
        <Routes>
          <Route path="/journal-2-0/playbook" element={<MyPlaybook {...props} />} />
          <Route path="/journal/insights" element={<p>insights page</p>} />
          <Route path="/journal/notebook" element={<p>notebook page</p>} />
        </Routes>
      </MemoryRouter>
    </SWRConfig>,
  )
}

/** Every number-shaped token in the page's text. */
function numberTokens(text) {
  return text.match(/[+-]?\$?\d[\d,]*(?:\.\d+)?(?:%|R)?/g) || []
}

/** The page's text, one text node at a time (`textContent` glues adjacent table cells together). */
function pageText(root) {
  const out = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) out.push(walker.currentNode.nodeValue)
  return out.join(' ')
}

/** Every string the page may legitimately show for a number: each numeric leaf of the payload run
 *  through every formatter the page owns, plus every digit run inside a payload string (dates,
 *  ids, titles). Anything else on screen was computed on the client. */
function allowedTokens(payload) {
  const allowed = new Set()
  const walk = (v) => {
    if (typeof v === 'number') {
      for (const s of [String(v), fmtPct(v), fmtR(v), fmtDollar(v), fmtPF(v), v.toFixed(2)]) {
        for (const t of numberTokens(s)) allowed.add(t)
      }
    } else if (typeof v === 'string') {
      for (const t of numberTokens(v)) allowed.add(t)
    } else if (Array.isArray(v)) v.forEach(walk)
    else if (v && typeof v === 'object') Object.values(v).forEach(walk)
  }
  walk(payload)
  return allowed
}

describe('My Playbook (wave 13, lane 13B)', () => {
  let calls
  beforeEach(() => {
    calls = []
    latchNotebookFlags({ notebook_playbook_enabled: true })
    global.fetch = vi.fn((url) => {
      calls.push(String(url))
      if (String(url).startsWith('/api/j2/my-playbook')) return json(PAYLOAD)
      return json({})
    })
  })
  afterEach(() => { __resetNotebookFlags(); vi.restoreAllMocks() })

  it('words each card by its sample (R3)', async () => {
    renderPage()
    const thin = await screen.findByRole('article', { name: 'Breakout' })
    expect(within(thin).getByText(/12 trades · thin sample/)).toBeTruthy()
    const win = within(thin).getByText('Win rate').closest('[data-stat]')
    expect(win.textContent).toContain('58%')
    expect(win.textContent).toContain('thin sample, likely 32% to 81%')

    const few = screen.getByRole('article', { name: 'High Tight Flag' })
    const fewWin = within(few).getByText('Win rate').closest('[data-stat]')
    const details = fewWin.querySelector('details')
    expect(details).toBeTruthy()
    expect(details.open).toBe(false)                       // the number is behind the reveal
    expect(within(fewWin).getByText('too few to judge').tagName).toBe('SUMMARY')

    const normal = screen.getByRole('article', { name: 'Pullback' })
    const nWin = within(normal).getByText('Win rate').closest('[data-stat]')
    expect(nWin.textContent).toContain('40%')
    expect(nWin.textContent).not.toMatch(/thin sample|too few/)
    expect(screen.getByTestId('playbook-untagged').textContent).toContain('3 closed trades have no setup')
  })

  it('every displayed number is found in the authority’s payload', async () => {
    const { container } = renderPage()
    await screen.findByRole('article', { name: 'Breakout' })
    // Open a drill and a pattern's citations so their numbers are on screen too.
    await userEvent.click(screen.getAllByRole('button', { name: /^Win rate 58%/ })[0])
    await userEvent.click(screen.getByRole('button', { name: /Show the 5 trades/ }))
    const tokens = numberTokens(pageText(container))
    expect(tokens.length).toBeGreaterThan(40)             // non-vacuity: the page shows numbers
    const allowed = allowedTokens(PAYLOAD)
    const strays = tokens.filter((t) => !allowed.has(t))
    expect(strays).toEqual([])
  })

  it('the payload check can fail: a number the payload does not carry is caught', () => {
    const allowed = allowedTokens(PAYLOAD)
    expect(allowed.has('61%')).toBe(false)
    expect(numberTokens('win rate 61%').filter((t) => !allowed.has(t))).toEqual(['61%'])
  })

  it('no stat without its n', async () => {
    const { container } = renderPage()
    await screen.findByRole('article', { name: 'Breakout' })
    const cells = [...container.querySelectorAll('[data-stat]')]
    expect(cells.length).toBe(15)                           // 3 setups x 5 stats
    for (const c of cells) {
      const chip = c.querySelector('[data-n]')
      expect(chip, c.getAttribute('data-stat')).toBeTruthy()
      expect(chip.textContent).toBe(`n=${chip.getAttribute('data-n')}`)
      expect(Number(chip.getAttribute('data-n'))).toBeGreaterThan(0)
    }
  })

  it('every number opens the trades it was computed from, exactly n of them', async () => {
    renderPage()
    const card = await screen.findByRole('article', { name: 'Breakout' })
    for (const [label, n] of [['Win rate', 12], ['Avg R', 12], ['Expectancy', 12], ['Total P&L', 12]]) {
      await userEvent.click(within(card).getByRole('button', { name: new RegExp(`^${label} `) }))
      const drill = within(card).getByTestId('playbook-drill')
      expect(drill.querySelectorAll('tbody tr').length).toBe(n)
      expect(drill.querySelector('tbody tr a').getAttribute('href')).toMatch(/^\/journal-2-0\/trade\//)
    }
    // A too-few setup still opens its trades, from inside the reveal.
    const few = screen.getByRole('article', { name: 'High Tight Flag' })
    await userEvent.click(within(few).getAllByText('too few to judge')[0])
    await userEvent.click(within(few).getByRole('button', { name: /^Win rate 67%/ }))
    expect(within(few).getByTestId('playbook-drill').querySelectorAll('tbody tr').length).toBe(9)
  })

  it('every pattern finding cites its trades and notes', async () => {
    renderPage()
    const sec = await screen.findByTestId('playbook-patterns')
    expect(sec.textContent).toContain('Patterns, not proof')
    const f = within(sec).getByText(/before 4 of 6 losses and 1 of 6 wins/)
    expect(f.textContent).toContain('“FOMO”')
    await userEvent.click(within(sec).getByRole('button', { name: /Show the 5 trades and notes/ }))
    const cites = within(sec).getByTestId('pattern-citations').querySelectorAll('[data-cite]')
    expect(cites.length).toBe(5)
    for (const c of cites) {
      const hrefs = [...c.querySelectorAll('a')].map((a) => a.getAttribute('href'))
      expect(hrefs.some((h) => h.startsWith('/journal-2-0/trade/'))).toBe(true)
      expect(hrefs.some((h) => h.startsWith('/journal/notebook?note='))).toBe(true)
    }
  })

  it('"From your notes" links the notes behind a setup', async () => {
    renderPage()
    const card = await screen.findByRole('article', { name: 'Breakout' })
    const link = within(card).getByRole('link', { name: 'NVDA breakout plan' })
    expect(link.getAttribute('href')).toBe('/journal/notebook?note=n-plan')
  })

  it('saves a snapshot through the one door and offers to open it', async () => {
    const save = vi.fn(async () => ({ id: 'snap-1' }))
    renderPage({ onSaveSnapshot: save })
    await screen.findByRole('article', { name: 'Breakout' })
    await userEvent.click(screen.getByRole('button', { name: 'Save a snapshot note' }))
    expect(save).toHaveBeenCalledWith(PAYLOAD)
    // The status region is mounted from the start now (lane FIN-A11Y, M-16), so wait for
    // its TEXT rather than for the region itself.
    expect((await screen.findByText(/Snapshot saved/)).closest('[role="status"]')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Open the note' }))
    expect(screen.getByText('notebook page')).toBeTruthy()
  })

  it('flag off: nothing is fetched and the route goes back to Insights', async () => {
    __resetNotebookFlags()
    latchNotebookFlags({ notebook_playbook_enabled: false })
    renderPage()
    expect(await screen.findByText('insights page')).toBeTruthy()
    await settle()
    expect(calls.filter((u) => u.startsWith('/api/j2/my-playbook'))).toEqual([])
  })
})

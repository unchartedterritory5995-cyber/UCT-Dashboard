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
//
// CONTRACT: the payload is the REAL server's answer to GET /api/j2/my-playbook
// (`__fixtures__/contract`, written by tools/notebook_contract_fixtures.py and held current by
// tests/test_notebook_contract_fixtures.py): a thin setup (Breakout, 24 trades), a normal one
// (Pullback, 25), one with too few (EP, 9), three untagged trades, and two patterns. The
// "every displayed number is the authority's" rail therefore runs on what the server sends.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { SWRConfig } from 'swr'
import MyPlaybook from './MyPlaybook'
import { latchNotebookFlags, __resetNotebookFlags } from '../../lib/offline/notebookFlags'
import { fmtDollar, fmtPct, fmtPF, fmtR } from '../../lib/playbookFormat'
import { contractBody, contractResponse } from '../../__fixtures__/contract'

const PAYLOAD = contractBody('my-playbook')
const setupNamed = (name) => PAYLOAD.setups.find((x) => x.setup === name)

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

describe('the recorded playbook carries every band this page words (non-vacuity)', () => {
  it('a thin, a normal and a too-few setup, untagged trades, and two patterns', () => {
    expect(PAYLOAD.setups.map((x) => [x.setup, x.tradeCount, x.sample.band])).toEqual(
      [['Breakout', 24, 'thin'], ['Pullback', 25, 'normal'], ['EP', 9, 'too_few']])
    expect(setupNamed('Breakout').winRateStat).toMatchObject({ k: 12, n: 24, rate: 0.5, range: [0.314, 0.686] })
    expect(setupNamed('EP').winRateStat).toMatchObject({ k: 6, n: 9, rate: 0.6667, range: null })
    expect(PAYLOAD.untagged).toEqual({ count: 3 })
    expect(PAYLOAD.patterns.findings.map((f) => [f.term, f.leans, f.citations.length]))
      .toEqual([['patient', 'wins', 4], ['FOMO', 'losses', 5]])
    for (const x of PAYLOAD.setups) expect(x.trades).toHaveLength(x.tradeCount)
  })
})

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
    expect(within(thin).getByText(/24 trades · thin sample/)).toBeTruthy()
    const win = within(thin).getByText('Win rate').closest('[data-stat]')
    expect(win.textContent).toContain('50%')
    expect(win.textContent).toContain('thin sample, likely 31% to 69%')

    const few = screen.getByRole('article', { name: 'EP' })
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
    await userEvent.click(screen.getAllByRole('button', { name: /^Win rate 50%/ })[0])
    await userEvent.click(screen.getByRole('button', { name: /Show the 5 trades/ }))
    await userEvent.click(screen.getByRole('button', { name: /Show the 4 trades/ }))
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
    for (const [label, n] of [['Win rate', 24], ['Avg R', 24], ['Expectancy', 24], ['Total P&L', 24]]) {
      await userEvent.click(within(card).getByRole('button', { name: new RegExp(`^${label} `) }))
      const drill = within(card).getByTestId('playbook-drill')
      expect(drill.querySelectorAll('tbody tr').length).toBe(n)
      expect(drill.querySelector('tbody tr a').getAttribute('href')).toMatch(/^\/journal-2-0\/trade\//)
    }
    // A too-few setup still opens its trades, from inside the reveal.
    const few = screen.getByRole('article', { name: 'EP' })
    await userEvent.click(within(few).getAllByText('too few to judge')[0])
    await userEvent.click(within(few).getByRole('button', { name: /^Win rate 67%/ }))   // 6 of 9
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
    const notes = PAYLOAD.notesBySetup.Breakout
    expect(notes.length).toBeGreaterThan(0)
    const link = within(card).getByRole('link', { name: notes[0].title })
    expect(link.getAttribute('href')).toBe(`/journal/notebook?note=${notes[0].noteId}`)
    // a setup with no linked note shows no "From your notes" link at all
    expect(PAYLOAD.notesBySetup.Pullback).toEqual([])
    expect(within(screen.getByRole('article', { name: 'Pullback' })).queryByRole('link', { name: /Pre-trade/ })).toBeNull()
  })

  it('a pattern that leans to wins is worded the same honest way', async () => {
    renderPage()
    const sec = await screen.findByTestId('playbook-patterns')
    expect(within(sec).getByText(/before 0 of 6 losses and 4 of 6 wins/).textContent).toContain('“patient”')
  })

  it('a member with no closed trade: no card, the way to start, and why there are no patterns', async () => {
    global.fetch = vi.fn(async (url) => (String(url).startsWith('/api/j2/my-playbook') ? contractResponse('my-playbook.empty') : json({})))
    renderPage()
    expect((await screen.findByTestId('playbook-empty')).textContent)
      .toBe('Tag a closed trade with a setup and its card appears here.')
    expect(screen.queryByRole('article')).toBeNull()
    expect(screen.queryByTestId('playbook-untagged')).toBeNull()
    // the server's own sentence for too few noted trades, verbatim
    const message = contractBody('my-playbook.empty').patterns.message
    expect(message).toMatch(/at least 5 wins and 5 losses/)
    expect(screen.getByText(message)).toBeTruthy()
  })

  it('a failed read is an error with Try again, never an empty playbook', async () => {
    let n = 0
    global.fetch = vi.fn(async (url) => {
      if (!String(url).startsWith('/api/j2/my-playbook')) return json({})
      n += 1
      return n === 1 ? contractResponse('my-playbook.signed-out') : contractResponse('my-playbook')
    })
    renderPage()
    expect((await screen.findByRole('alert')).textContent).toContain('Couldn’t load your playbook.')
    expect(screen.queryByTestId('playbook-empty')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('article', { name: 'Breakout' })).toBeTruthy()
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

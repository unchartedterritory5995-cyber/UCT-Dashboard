// EEHSC: estimate revisions by sector. Rails:
//   * one read per estimate and window; the picks write the command; typed words seed the panel;
//   * the header says FIRST that it is only the stocks UCT tracks, with N, the window and the newest snapshot;
//   * one row per sector in the server's order (net breadth highest first): its net breadth, raised / cut / held, the
//     largest raise and cut; a sector with too few counted says so, never 0; each row opens its stocks (each a
//     PanelSymbol that loads the board), the three largest raises and cuts, and the stocks not counted by reason;
//   * loading, computing, a failed read of the store (Retry), a failed request (Retry), signed out, free plan, switched
//     off (404), an answer it cannot read, nothing tracked, nothing spanning the window yet (with a way to 7 days);
//   * the as-of is the newest snapshot; the counted stocks are published to the shell's list; axe; no hard-coded colour.
// The fixtures are the route's real shape (api/services/estimate_revisions.py) with invented figures.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
import jsonFetcher from '../../../utils/jsonFetcher'
import { PanelFreshnessContext, PanelListContext, TerminalPanelContext } from '../../../components/terminal'
import RevisionBreadthPanel from './RevisionBreadthPanel'
import { revisionBreadthUrl } from './revisionBreadthModel'
import { COLLECTING_30, COMPUTING, EMPTY, EPS_30, FAILED, REV_7 } from './__fixtures__/revisionBreadthFixture'
import { colourLiteralsIn } from '../__tests__/themeScope'
import { expectNoAxeViolations } from '../../journal-2-0/a11y/axeHarness'

const EPS30 = revisionBreadthUrl({ metric: 'eps', window: 30 })
const EPS7 = revisionBreadthUrl({ metric: 'eps', window: 7 })
const REV7 = revisionBreadthUrl({ metric: 'revenue', window: 7 })
const REV30 = revisionBreadthUrl({ metric: 'revenue', window: 30 })
const HERE = path.dirname(fileURLToPath(import.meta.url))
const fail = (status, extra = {}) => Object.assign(new Error(`http ${status}`), { status }, extra)
const PENDING = Symbol('pending')
function serve(routes) {
  jsonFetcher.mockImplementation((url) => {
    if (!(url in routes)) return Promise.reject(fail(500))
    const hit = routes[url]
    if (hit === PENDING) return new Promise(() => {})
    return hit instanceof Error ? Promise.reject(hit) : Promise.resolve(hit)
  })
}
const asked = () => [...new Set(jsonFetcher.mock.calls.map(([url]) => url))]

function renderPanel(props = {}, { rerun = vi.fn(), run = vi.fn(), publish = vi.fn(), setFreshness = vi.fn() } = {}) {
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <PanelFreshnessContext.Provider value={setFreshness}>
        <PanelListContext.Provider value={{ open: vi.fn(), run, rerun, publish, publishRows: vi.fn() }}>
          <TerminalPanelContext.Provider value={{ code: 'EEHSC', density: 'comfortable', inset: true }}>
            <RevisionBreadthPanel {...props} />
          </TerminalPanelContext.Provider>
        </PanelListContext.Provider>
      </PanelFreshnessContext.Provider>
    </SWRConfig>,
  )
  return { rerun, run, publish, setFreshness }
}
const table = () => screen.getByTestId('terminal-eehsc-table')
const rowNames = () => within(table()).getAllByRole('row').slice(1)
  .map((r) => r.getAttribute('data-testid')).filter((t) => t.startsWith('terminal-eehsc-row-')).map((t) => t.replace('terminal-eehsc-row-', ''))
/** A cell's text as it reads: a line break is a space. */
function textOf(el) {
  const d = document.createElement('div')
  d.innerHTML = el.innerHTML.replace(/<br\s*\/?>/gi, ' ')
  return d.textContent.replace(/\s+/g, ' ').trim()
}
const cells = (name) => [...screen.getByTestId(`terminal-eehsc-row-${name}`).querySelectorAll('td')].map(textOf)

beforeEach(() => { jsonFetcher.mockReset() })
afterEach(cleanup)

describe('EEHSC: what is read', () => {
  it('reads EPS over 30 days once, and shows a skeleton while it loads', () => {
    serve({ [EPS30]: PENDING })
    renderPanel()
    expect(EPS30).toBe('/api/research/estimate-history?metric=eps&window=30')
    expect(screen.getByTestId('terminal-eehsc-loading')).toBeTruthy()
    expect(asked()).toEqual([EPS30])
  })

  it('typed words seed the panel', async () => {
    serve({ [REV7]: REV_7 })
    renderPanel({ window: 7, metric: 'revenue' })
    await screen.findByTestId('terminal-eehsc-table')
    expect(asked()).toEqual([REV7])
    const root = screen.getByTestId('terminal-eehsc')
    expect([root.getAttribute('data-window'), root.getAttribute('data-metric')]).toEqual(['7', 'revenue'])
    expect(screen.getByTestId('terminal-eehsc-window').value).toBe('7')
    expect(screen.getByTestId('terminal-eehsc-metric').value).toBe('revenue')
  })

  it('each pick is a new read and writes the command', async () => {
    serve({ [EPS30]: EPS_30, [EPS7]: { ...EPS_30, window: 7 }, [REV7]: REV_7 })
    const { rerun } = renderPanel()
    await screen.findByTestId('terminal-eehsc-table')
    fireEvent.change(screen.getByTestId('terminal-eehsc-window'), { target: { value: '7' } })
    expect(rerun).toHaveBeenLastCalledWith('EEHSC 7D')
    await waitFor(() => expect(asked()).toContain(EPS7))
    fireEvent.change(screen.getByTestId('terminal-eehsc-metric'), { target: { value: 'revenue' } })
    expect(rerun).toHaveBeenLastCalledWith('EEHSC 7D REVENUE')
    await waitFor(() => expect(rowNames()).toEqual(['Technology']))
    expect(asked()).toEqual([EPS30, EPS7, REV7])
    expect(asked()).not.toContain(REV30)
    expect(cells('Technology')[3]).toBe('ZQTA +4.0% ZQTF -2.0%')
  })
})

describe('EEHSC: a pick never draws the previous answer under the new choice', () => {
  it('a skeleton until the answer for the new estimate arrives', async () => {
    serve({ [EPS30]: EPS_30, [REV30]: PENDING })
    renderPanel()
    await screen.findByTestId('terminal-eehsc-table')
    fireEvent.change(screen.getByTestId('terminal-eehsc-metric'), { target: { value: 'revenue' } })
    await waitFor(() => expect(asked()).toContain(REV30))
    expect(screen.getByTestId('terminal-eehsc-loading')).toBeTruthy()
    expect(screen.queryByTestId('terminal-eehsc-table')).toBeNull()
  })
})

describe('EEHSC populated', () => {
  it('⭐ the header says first: only the stocks UCT tracks, with N, the window and the newest snapshot', async () => {
    serve({ [EPS30]: EPS_30 })
    const { setFreshness } = renderPanel()
    await screen.findByTestId('terminal-eehsc-table')
    const lede = screen.getByTestId('terminal-eehsc-lede').textContent
    expect(lede).toBe('Among the 23 stocks UCT tracks (the S&P 500 list and stocks members have looked at), not the whole market. '
      + 'Next-quarter EPS estimates, the change over 30 days to Mar 14, 2031 (the newest snapshot).')
    expect(screen.getByTestId('terminal-eehsc-coverage').textContent).toBe(
      '19 counted; 2 still collecting, 1 with a gap in its snapshots, 1 with no comparable estimate. All tracked stocks: net +16% (9 raised, 6 cut, 4 held; 19 counted).')
    expect(setFreshness).toHaveBeenLastCalledWith({ source: "UCT's daily snapshots of the analyst consensus (FMP)", age: { asOfDate: '2031-03-14' } })
  })

  it('⭐ one row per sector in net-breadth order; too few counted says so, never 0', async () => {
    serve({ [EPS30]: EPS_30 })
    renderPanel()
    await screen.findByTestId('terminal-eehsc-table')
    expect(within(table()).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Sector', 'Net breadth', 'Raised / cut / held', 'Largest raise / cut'])
    expect(rowNames()).toEqual(['Technology', 'Healthcare', 'Energy', 'Utilities', 'Sector not on file'])
    expect(cells('Technology')).toEqual(['Technology 6 of 7 counted', '+50%', '4 / 1 / 1', 'ZQTA +20.0% ZQTF -10.0%'])
    expect(cells('Energy')).toEqual(['Energy 5 of 6 counted', '-60%', '1 / 4 / 0', 'ZQEE +4.0% ZQEA -20.0%'])
    expect(cells('Utilities')).toEqual(['Utilities 2 of 2 counted', 'too few', '1 / 0 / 1', 'ZQUA +1.0% no cut'])
    expect(screen.getByTestId('terminal-eehsc-few-Utilities').closest('td').getAttribute('title')).toBe('2 stocks counted, fewer than 5, so no net figure')
    expect(screen.queryByText('0%')).toBeNull()
    expect(screen.getByTestId('terminal-eehsc-net-Technology').className).toMatch(/up/)
    expect(screen.getByTestId('terminal-eehsc-net-Energy').className).toMatch(/down/)
  })

  it('⭐ a row opens its stocks: each a symbol that loads the board, the top three each way, the rest by reason', async () => {
    serve({ [EPS30]: EPS_30 })
    const { run } = renderPanel()
    await screen.findByTestId('terminal-eehsc-table')
    const btn = screen.getByTestId('terminal-eehsc-open-Technology')
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByTestId('terminal-eehsc-detail-Technology')).toBeNull()
    fireEvent.click(btn)
    expect(btn.getAttribute('aria-expanded')).toBe('true')
    const detail = screen.getByTestId('terminal-eehsc-detail-Technology')
    expect(btn.getAttribute('aria-controls')).toBe(detail.id)
    expect(screen.getByTestId('terminal-eehsc-raises-Technology').textContent).toBe('Largest raises: ZQTA +20.0%, ZQTB +15.0%, ZQTC +5.0%')
    expect(screen.getByTestId('terminal-eehsc-cuts-Technology').textContent).toBe('Largest cuts: ZQTF -10.0%')
    const items = within(detail).getAllByRole('listitem')
    expect(items.map((li) => li.textContent)).toEqual(['ZQTA +20.0% 1.00 to 1.20', 'ZQTB +15.0% 2.00 to 2.30', 'ZQTC +5.0% 1.00 to 1.05',
      'ZQTD +2.5% 4.00 to 4.10', 'ZQTE +0.1% 1.00 to 1.00', 'ZQTF -10.0% 1.00 to 0.90'])
    expect(screen.getByTestId('terminal-eehsc-sym-ZQTA').getAttribute('title')).toBe('+20.0%, 1.00 to 1.20 (Feb 12, 2031 to Mar 14, 2031)')
    expect(screen.getByTestId('terminal-eehsc-rest-collecting').textContent).toBe('Still collecting: snapshots too new to span the window: ZQTG')
    // a held stock takes no colour
    expect(within(screen.getByTestId('terminal-eehsc-sym-ZQTE')).getByText('+0.1%').className).toBe('')
    // every symbol is a PanelSymbol: a click loads the board (ZQTD is only in the opened list)
    for (const li of items) expect(within(li).getAllByRole('button', { name: /^Load ZQT[A-G]$/ })).toHaveLength(1)
    fireEvent.click(within(screen.getByTestId('terminal-eehsc-sym-ZQTD')).getByTestId('panel-symbol-ZQTD'))
    expect(run).toHaveBeenLastCalledWith('$ZQTD')
    fireEvent.click(within(detail).getAllByTestId('panel-symbol-ZQTG')[0])
    expect(run).toHaveBeenLastCalledWith('$ZQTG')
    fireEvent.click(within(screen.getByTestId('terminal-eehsc-row-Energy')).getByTestId('panel-symbol-ZQEA'))
    expect(run).toHaveBeenLastCalledWith('$ZQEA')
    // a second sector opens beside it; a click closes
    fireEvent.click(screen.getByTestId('terminal-eehsc-open-Healthcare'))
    expect(screen.getByTestId('terminal-eehsc-rest-gap').textContent).toBe('A gap in the snapshots: none near one end of the window: ZQHF')
    fireEvent.click(btn)
    expect(screen.queryByTestId('terminal-eehsc-detail-Technology')).toBeNull()
    expect(screen.getByTestId('terminal-eehsc-detail-Healthcare')).toBeTruthy()
  })

  it('revenue in its own units; the counted stocks go to the shell\'s list', async () => {
    serve({ [REV7]: REV_7 })
    const { publish } = renderPanel({ window: 7, metric: 'revenue' })
    await screen.findByTestId('terminal-eehsc-table')
    fireEvent.click(screen.getByTestId('terminal-eehsc-open-Technology'))
    expect(screen.getByTestId('terminal-eehsc-sym-ZQTB').textContent).toBe('ZQTB +1.0% 10.00B to 10.10B')
    expect(publish).toHaveBeenLastCalledWith({ syms: ['ZQTA', 'ZQTB', 'ZQTC', 'ZQTD', 'ZQTF'], label: 'estimate revisions by sector' })
    expect(screen.getByTestId('terminal-eehsc-method').textContent).toMatch(/18 from the S&P 500 list the daily job follows, 5 added when a member opened their estimate history \(at most 600\)\./)
  })

  it('a later read that did not finish is said beside the last figures', async () => {
    serve({ [EPS30]: { ...EPS_30, check: { state: 'failed', reason: 'error', http_status: null, at: '2031-03-15T02:00:00+00:00' } } })
    renderPanel()
    await screen.findByTestId('terminal-eehsc-check')
    expect(screen.getByTestId('terminal-eehsc-table')).toBeTruthy()
  })
})

describe('EEHSC states', () => {
  it('computing: said, and asked again', async () => {
    serve({ [EPS30]: COMPUTING })
    renderPanel()
    expect((await screen.findByTestId('terminal-eehsc-computing')).textContent).toMatch(/asks again every 3 seconds/)
  })

  it('a failed read of the store: said, with Retry, never "no revisions"', async () => {
    serve({ [EPS30]: FAILED })
    renderPanel()
    const box = await screen.findByTestId('terminal-eehsc-failed')
    expect(box.textContent).toMatch(/not the same as no revisions/)
    serve({ [EPS30]: EPS_30 })
    fireEvent.click(within(box).getByRole('button', { name: 'Retry' }))
    await screen.findByTestId('terminal-eehsc-table')
  })

  it('a failed request and signed out: Retry (the house rule, marketRead canRetry); free plan and switched off: said, no Retry', async () => {
    for (const [status, words, retry] of [[500, /could not be read just now/, true], [401, /You are signed out/, true],
      [402, /needs a paid plan/, false], [404, /not switched on for this server yet/, false]]) {
      cleanup()
      serve({ [EPS30]: fail(status) })
      renderPanel()
      const box = await screen.findByTestId('terminal-eehsc-error')
      expect([status, words.test(box.textContent)]).toEqual([status, true])
      expect([status, !!within(box).queryByRole('button', { name: 'Retry' })]).toEqual([status, retry])
    }
  })

  it('an answer it cannot read', async () => {
    serve({ [EPS30]: { status: 'ok', sectors: 'x' } })
    renderPanel()
    expect((await screen.findByTestId('terminal-eehsc-error')).textContent).toMatch(/cannot read/)
  })

  it('nothing tracked yet: said, not "no revisions"', async () => {
    serve({ [EPS30]: EMPTY })
    renderPanel()
    expect((await screen.findByTestId('terminal-eehsc-empty')).textContent).toMatch(/does not track any stock/)
  })

  it('nothing spans the window yet: the day the first changes are due, and a way to 7 days', async () => {
    serve({ [EPS30]: COLLECTING_30, [EPS7]: { ...EPS_30, window: 7 } })
    const { rerun } = renderPanel()
    const box = await screen.findByTestId('terminal-eehsc-collecting')
    expect(screen.getByTestId('terminal-eehsc-lede').textContent).toMatch(/^Among the 3 stocks UCT tracks \(stocks members have looked at\), not the whole market\./)
    expect(box.textContent).toMatch(/None of the 3 tracked stocks has snapshots spanning 30 days yet\./)
    expect(box.textContent).toMatch(/Snapshots began on Mar 2, 2031, so the first 30-day changes are due from about Apr 1, 2031\./)
    fireEvent.click(within(box).getByRole('button', { name: 'Show 7 days' }))
    expect(rerun).toHaveBeenLastCalledWith('EEHSC 7D')
    await screen.findByTestId('terminal-eehsc-table')
  })
})

describe('EEHSC follows the member\'s theme and passes axe', () => {
  it('the panel, the model and its sheet hold no hard-coded colour', () => {
    for (const f of ['RevisionBreadthPanel.jsx', 'revisionBreadthModel.js', 'revisionBreadth.module.css']) {
      const text = fs.readFileSync(path.join(HERE, f), 'utf8')
      expect(colourLiteralsIn(`pages/terminal/panels/${f}`, text).map((h) => h.lit), f).toEqual([])
    }
  })

  it('populated with a sector open, collecting and an error pass axe (WCAG A and AA)', async () => {
    serve({ [EPS30]: EPS_30 })
    renderPanel()
    await screen.findByTestId('terminal-eehsc-table')
    fireEvent.click(screen.getByTestId('terminal-eehsc-open-Technology'))
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    serve({ [EPS30]: COLLECTING_30 })
    renderPanel()
    await screen.findByTestId('terminal-eehsc-collecting')
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    serve({ [EPS30]: fail(500) })
    renderPanel()
    await screen.findByTestId('terminal-eehsc-error')
    await expectNoAxeViolations(document.body.firstElementChild)
  }, 60_000)
})

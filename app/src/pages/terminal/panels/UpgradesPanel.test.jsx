// UPDG: analyst upgrades, downgrades and price-target changes. Rails:
//   * the pure shaping: the three buckets as rows in the server's order, the action in plain words,
//     the rating before and after, a price target read as a number only when it is one;
//   * the list is NEVER called today's unless the payload dates it: with no date the header is
//     undated and the method sentence says so; with a date (and a stale verdict) the panel says so;
//   * loading, a failed read (error with Retry), a paywall and a switched-off route (no Retry);
//   * an empty list says the list has not arrived, and can be checked again;
//   * a symbol loads into the linked panels; row numbers follow the rows on screen;
//   * the kind chips cut the list, show their counts, and write themselves into the command only
//     where the registry takes the word; the columns sort.
// The fixture is the route's real shape (api/services/engine.py get_analyst_actions), with made-up
// tickers and firms.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
import jsonFetcher from '../../../utils/jsonFetcher'
import { PanelFreshnessContext, PanelListContext, TerminalPanelContext } from '../../../components/terminal'
import UpgradesPanel, {
  UPGRADES_URL, UPGRADE_KINDS, analystActions, normKind, rowsOfKind, stampOf, targetNumber, upgradesCommandArgs,
} from './UpgradesPanel'
import { stampedKey } from './marketRead'
import { colourLiteralsIn } from '../__tests__/themeScope'
import { expectNoAxeViolations } from '../../journal-2-0/a11y/axeHarness'

const SOURCE = 'UCT morning wire (analyst actions)'
const PAYLOAD = {
  upgrades: [
    { ticker: 'AAA', action: 'upgrade', firm: 'Harbor Securities', from_rating: 'Hold', to_rating: 'Buy', price_target: '$120' },
    { ticker: 'bbb', action: 'Initiates', firm: 'Northgate Research', from_rating: null, to_rating: 'Outperform', price_target: 48.5 },
  ],
  downgrades: [
    { ticker: 'CCC', action: 'downgraded', firm: 'Harbor Securities', from_rating: 'Buy', to_rating: 'Neutral', price_target: null },
  ],
  pt_changes: [
    { ticker: 'DDD', action: 'raises pt', firm: 'Northgate Research', from_rating: '', to_rating: 'Buy', price_target: '$1,250.50' },
    { ticker: 'AAA', action: 'lowers pt', firm: 'Eastline Capital', price_target: '300-320' },
  ],
  summary: { upgrades: 2, downgrades: 1, pt_changes: 2 },
}
const EMPTY = { upgrades: [], downgrades: [], pt_changes: [], summary: { upgrades: 0, downgrades: 0, pt_changes: 0 } }

function renderPanel(props = {}, { run = vi.fn(), rerun = vi.fn(), publishRows = vi.fn(), setFreshness = vi.fn(), code = null } = {}) {
  const body = <UpgradesPanel {...props} />
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <PanelFreshnessContext.Provider value={setFreshness}>
        <PanelListContext.Provider value={{ open: vi.fn(), run, rerun, publish: vi.fn(), publishRows }}>
          {code ? <TerminalPanelContext.Provider value={{ code, density: 'comfortable', inset: true }}>{body}</TerminalPanelContext.Provider> : body}
        </PanelListContext.Provider>
      </PanelFreshnessContext.Provider>
    </SWRConfig>,
  )
  return { run, rerun, publishRows, setFreshness }
}
const tableRows = () => within(screen.getByTestId('terminal-updg-table')).getAllByRole('row').slice(1)
const symsInTable = () => tableRows().map((r) => r.getAttribute('data-testid').replace('terminal-updg-row-', ''))
const fail = (status) => Object.assign(new Error('x'), { status })
const HERE = path.dirname(fileURLToPath(import.meta.url))

beforeEach(() => { jsonFetcher.mockReset() })
afterEach(cleanup)

describe('UPDG pure shaping', () => {
  it('normKind and the command arguments', () => {
    expect(Object.keys(UPGRADE_KINDS)).toEqual(['all', 'upgrades', 'downgrades', 'targets'])
    for (const [raw, want] of [['UP', 'upgrades'], ['upgrades', 'upgrades'], ['down', 'downgrades'], ['DN', 'downgrades'],
      ['Downgrades', 'downgrades'], ['PT', 'targets'], ['targets', 'targets'], ['ALL', 'all'], [null, 'all'], ['', 'all'], ['nonsense', 'all']]) {
      expect(normKind(raw), String(raw)).toBe(want)
    }
    expect(upgradesCommandArgs('all')).toEqual([])
    expect(upgradesCommandArgs('upgrades')).toEqual(['UP'])
    expect(upgradesCommandArgs('downgrades')).toEqual(['DOWN'])
    expect(upgradesCommandArgs('targets')).toEqual(['PT'])
    // every token the chips write is a word normKind reads back to the same kind
    for (const [key, m] of Object.entries(UPGRADE_KINDS)) if (m.token) expect(normKind(m.token)).toBe(key)
  })

  it('targetNumber reads one number and nothing else', () => {
    expect(targetNumber(120)).toBe(120)
    expect(targetNumber('$120')).toBe(120)
    expect(targetNumber('$1,250.50')).toBe(1250.5)
    expect(targetNumber(' 48.5 ')).toBe(48.5)
    for (const bad of ['300-320', 'N/A', '', null, undefined, 0, -5, Number.NaN, '$', '12 to 14']) expect(targetNumber(bad), String(bad)).toBeNull()
  })

  it('stampOf keeps a calendar date, reads a zoned instant, and never guesses a time zone', () => {
    expect(stampOf('2026-11-16')).toBe('2026-11-16')
    expect(stampOf('2026-11-16T12:40:00Z')).toBe('2026-11-16T12:40:00.000Z')
    expect(stampOf('2026-11-16T07:40:00-05:00')).toBe('2026-11-16T12:40:00.000Z')
    // a clock time with no zone keeps only its date: the zone is never guessed
    expect(stampOf('2026-11-16 07:40:00')).toBe('2026-11-16')
    expect(stampOf('2026-11-16T07:40:00')).toBe('2026-11-16')
    expect(stampOf(1_794_832_800)).toBe(new Date(1_794_832_800_000).toISOString())
    for (const bad of [null, undefined, '', 'yesterday', '11/16/2026', 0, Number.NaN]) expect(stampOf(bad), String(bad)).toBeNull()
  })

  it('analystActions: the three buckets as rows, in the server\'s order, in plain words', () => {
    const out = analystActions(PAYLOAD)
    expect(out.rows.map((r) => [r.kind, r.sym, r.action])).toEqual([
      ['upgrades', 'AAA', 'Upgrade'], ['upgrades', 'BBB', 'New coverage'], ['downgrades', 'CCC', 'Downgrade'],
      ['targets', 'DDD', 'Target raised'], ['targets', 'AAA', 'Target lowered'],
    ])
    expect(out.rows.map((r) => r.order)).toEqual([0, 1, 2, 3, 4])
    expect(out.rows.map((r) => r.rating)).toEqual(['Hold to Buy', 'Outperform', 'Buy to Neutral', 'Buy', null])
    expect(out.rows.map((r) => r.target)).toEqual([120, 48.5, null, 1250.5, null])
    expect(out.rows.map((r) => r.targetText)).toEqual([null, null, null, null, '300-320'])
    expect(out.rows.map((r) => r.tone)).toEqual(['up', null, 'down', 'up', 'down'])
    expect(out.rows[0].firm).toBe('Harbor Securities')
    expect(out.counts).toEqual({ all: 5, upgrades: 2, downgrades: 1, targets: 2 })
    expect(new Set(out.rows.map((r) => r.key)).size).toBe(5)
    // the real payload carries no date: the list is undated, never assumed to be today's
    expect(out.builtOn).toBeNull()
    expect(out.wireStatus).toBeNull()
  })

  it('analystActions: a row with no ticker is dropped, an unknown action is kept in its own words', () => {
    const out = analystActions({
      upgrades: [{ action: 'upgrade', firm: 'Nobody' }, { ticker: 'EEE', action: 'REITERATES', from_rating: 'Buy' }, null],
      downgrades: 'not a list',
    })
    expect(out.rows.map((r) => [r.sym, r.action, r.rating, r.firm])).toEqual([['EEE', 'Reiterates', 'From Buy', null]])
    expect(out.counts).toEqual({ all: 1, upgrades: 1, downgrades: 0, targets: 0 })
  })

  it('analystActions: a date is used only when the payload sends one (the list\'s own, else the newest item time)', () => {
    expect(analystActions({ ...PAYLOAD, wire_date: '2026-11-13', wire_status: 'stale' })).toMatchObject({ builtOn: '2026-11-13', wireStatus: 'stale' })
    expect(analystActions({ ...PAYLOAD, date: '2026-11-16', wire_status: 'FRESH' })).toMatchObject({ builtOn: '2026-11-16', wireStatus: 'fresh' })
    expect(analystActions({ ...PAYLOAD, generated_at: '2026-11-16T12:40:00Z', wire_status: 'whatever' }))
      .toMatchObject({ builtOn: '2026-11-16T12:40:00.000Z', wireStatus: null })
    const timed = analystActions({
      upgrades: [{ ticker: 'AAA', action: 'upgrade', at: '2026-11-16T11:05:00Z' }, { ticker: 'BBB', action: 'upgrade', at: '2026-11-16T12:10:00Z' }],
      downgrades: [{ ticker: 'CCC', action: 'downgrade', at: 'this morning' }],
    })
    expect(timed.builtOn).toBe('2026-11-16T12:10:00.000Z')
    expect(timed.rows.map((r) => r.at)).toEqual(['2026-11-16T11:05:00.000Z', '2026-11-16T12:10:00.000Z', null])
  })

  it('analystActions: an empty, missing or malformed body is no rows', () => {
    for (const body of [undefined, null, {}, EMPTY, [], 'x', { detail: 'The daily wire surface requires a paid plan' }]) {
      const out = analystActions(body)
      expect(out.rows).toEqual([])
      expect(out.counts).toEqual({ all: 0, upgrades: 0, downgrades: 0, targets: 0 })
      expect(out.builtOn).toBeNull()
    }
  })

  it('rowsOfKind cuts the list and keeps the order', () => {
    const { rows } = analystActions(PAYLOAD)
    expect(rowsOfKind(rows, 'all')).toHaveLength(5)
    expect(rowsOfKind(rows, 'targets').map((r) => r.sym)).toEqual(['DDD', 'AAA'])
    expect(rowsOfKind(rows, 'DOWN').map((r) => r.sym)).toEqual(['CCC'])
    expect(rowsOfKind(rows, 'nonsense')).toHaveLength(5)
  })
})

describe('UPDG panel states', () => {
  it('shows a loading skeleton', () => {
    jsonFetcher.mockReturnValue(new Promise(() => {}))
    renderPanel()
    expect(screen.getByTestId('terminal-updg-loading')).toBeTruthy()
    expect(screen.queryByTestId('terminal-updg-table')).toBeNull()
  })

  it('a failed read is an error with Retry, never "no analyst actions"', async () => {
    jsonFetcher.mockRejectedValueOnce(fail(500))
    renderPanel()
    const err = await screen.findByTestId('terminal-updg-error')
    expect(err.getAttribute('data-kind')).toBe('error')
    expect(err.textContent).toContain('Analyst actions could not be read just now.')
    expect(err.textContent).toContain('That is not the same as no analyst actions.')
    expect(screen.queryByTestId('terminal-updg-empty')).toBeNull()
    jsonFetcher.mockResolvedValueOnce(PAYLOAD)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-updg-table')).toBeTruthy()
    expect(jsonFetcher).toHaveBeenCalledWith('/api/analyst-actions')
    expect(UPGRADES_URL).toBe('/api/analyst-actions')
    expect(stampedKey(UPGRADES_URL)).toEqual(['/api/analyst-actions', 'terminal-stamped'])
  })

  it('a 402 says paid plan and a 404 says not switched on, both locked with no Retry', async () => {
    jsonFetcher.mockRejectedValueOnce(fail(402))
    renderPanel()
    const paid = await screen.findByTestId('terminal-updg-error')
    expect(paid.getAttribute('data-kind')).toBe('locked')
    expect(paid.textContent).toContain('Analyst actions needs a paid plan.')
    expect(screen.queryByRole('button')).toBeNull()
    cleanup()
    jsonFetcher.mockRejectedValueOnce(fail(404))
    renderPanel()
    const off = await screen.findByTestId('terminal-updg-error')
    expect(off.getAttribute('data-kind')).toBe('locked')
    expect(off.textContent).toContain('Analyst actions is not switched on for this server yet.')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('an empty list says it has not arrived yet, and can be checked again', async () => {
    jsonFetcher.mockResolvedValueOnce(EMPTY)
    const { setFreshness } = renderPanel()
    const empty = await screen.findByTestId('terminal-updg-empty')
    expect(empty.getAttribute('data-kind')).toBe('empty')
    expect(empty.textContent).toContain('No analyst actions to show yet.')
    expect(empty.textContent).toContain('it is empty until a wire arrives')
    expect(setFreshness.mock.calls.every(([report]) => report == null)).toBe(true)
    jsonFetcher.mockResolvedValueOnce(PAYLOAD)
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
    expect(await screen.findByTestId('terminal-updg-table')).toBeTruthy()
  })
})

describe('UPDG panel, populated', () => {
  it('lists every action with its firm, rating and target, undated because the payload is', async () => {
    jsonFetcher.mockResolvedValue(PAYLOAD)
    const { setFreshness } = renderPanel()
    await screen.findByTestId('terminal-updg-table')
    expect(symsInTable()).toEqual(['AAA', 'BBB', 'CCC', 'DDD', 'AAA'])
    const cells = tableRows().map((r) => r.textContent)
    for (const s of ['1', 'AAA', 'Harbor Securities', 'Upgrade', 'Hold to Buy', '$120.00']) expect(cells[0]).toContain(s)
    for (const s of ['BBB', 'Northgate Research', 'New coverage', 'Outperform', '$48.50']) expect(cells[1]).toContain(s)
    for (const s of ['CCC', 'Downgrade', 'Buy to Neutral', 'Not given']) expect(cells[2]).toContain(s)
    for (const s of ['DDD', 'Target raised', '$1250.50']) expect(cells[3]).toContain(s)
    for (const s of ['5', 'AAA', 'Eastline Capital', 'Target lowered', '300-320']) expect(cells[4]).toContain(s)
    // the header: the source, and no date the payload never sent
    await waitFor(() => expect(setFreshness).toHaveBeenCalledWith({ source: SOURCE }))
    const method = screen.getByTestId('terminal-updg-method').textContent
    expect(method).toContain('The server keeps up to 12 upgrades (new coverage is counted with them), 12 downgrades and 15 target changes.')
    expect(method).toContain('The server does not say which morning this list is from')
    expect(method).toMatch(/Read at \d{1,2}:\d{2} [AP]M ET\./)
    expect(method).not.toContain('List dated')
    expect(screen.queryByTestId('terminal-updg-stale')).toBeNull()
    // an undated list is never called today's
    expect(document.body.textContent).not.toMatch(/today/i)
    expect(document.body.textContent).not.toMatch(/[—–]/)
  })

  it('a dated list says its date in the header and the method, and a stale one says today\'s has not arrived', async () => {
    jsonFetcher.mockResolvedValue({ ...PAYLOAD, wire_date: '2026-11-13', wire_status: 'stale' })
    const { setFreshness } = renderPanel()
    await screen.findByTestId('terminal-updg-table')
    await waitFor(() => expect(setFreshness).toHaveBeenCalledWith({ source: SOURCE, age: { asOfDate: '2026-11-13' } }))
    expect(screen.getByTestId('terminal-updg-method').textContent).toContain('List dated 2026-11-13.')
    const stale = screen.getByTestId('terminal-updg-stale').textContent
    expect(stale).toContain('This list is from the morning wire of 2026-11-13.')
    expect(stale).toContain("Today's list has not arrived yet.")
    cleanup()
    jsonFetcher.mockResolvedValue({ ...PAYLOAD, wire_date: '2026-11-16', wire_status: 'fresh' })
    renderPanel()
    await screen.findByTestId('terminal-updg-table')
    expect(screen.queryByTestId('terminal-updg-stale')).toBeNull()
    expect(screen.getByTestId('terminal-updg-method').textContent).toContain('List dated 2026-11-16.')
  })

  it('a symbol loads into the linked panels, and the numbered rows are the rows on screen', async () => {
    jsonFetcher.mockResolvedValue(PAYLOAD)
    const { run, publishRows } = renderPanel()
    await screen.findByTestId('terminal-updg-table')
    fireEvent.click(screen.getByTestId('panel-symbol-CCC'))
    expect(run).toHaveBeenCalledWith('$CCC')
    expect(publishRows).toHaveBeenLastCalledWith(['$AAA', '$BBB', '$CCC', '$DDD', '$AAA'])
    fireEvent.click(screen.getByTestId('terminal-updg-kind-targets'))
    expect(publishRows).toHaveBeenLastCalledWith(['$DDD', '$AAA'])
  })

  it('says when a kind is full, so a capped list is not read as the whole market', async () => {
    const twelve = Array.from({ length: 12 }, (_, i) => ({ ticker: `U${String.fromCharCode(65 + i)}`, action: 'upgrade', firm: 'Harbor Securities' }))
    jsonFetcher.mockResolvedValue({ ...PAYLOAD, upgrades: twelve })
    renderPanel()
    await screen.findByTestId('terminal-updg-table')
    expect(screen.getByTestId('terminal-updg-method').textContent).toContain('so there may be more upgrades than shown.')
    cleanup()
    jsonFetcher.mockResolvedValue(PAYLOAD)
    renderPanel()
    await screen.findByTestId('terminal-updg-table')
    expect(screen.getByTestId('terminal-updg-method').textContent).not.toContain('there may be more')
  })
})

describe('UPDG chips and sorting', () => {
  it('the chips show their counts and cut the list', async () => {
    jsonFetcher.mockResolvedValue(PAYLOAD)
    const { rerun } = renderPanel()
    await screen.findByTestId('terminal-updg-table')
    expect(screen.getByTestId('terminal-updg-kind-all').textContent).toBe('All (5)')
    expect(screen.getByTestId('terminal-updg-kind-upgrades').textContent).toBe('Upgrades (2)')
    expect(screen.getByTestId('terminal-updg-kind-downgrades').textContent).toBe('Downgrades (1)')
    expect(screen.getByTestId('terminal-updg-kind-targets').textContent).toBe('Target changes (2)')
    expect(screen.getByTestId('terminal-updg-kind-all').getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByTestId('terminal-updg-kind-downgrades'))
    expect(screen.getByTestId('terminal-updg-kind-downgrades').getAttribute('aria-pressed')).toBe('true')
    expect(symsInTable()).toEqual(['CCC'])
    expect(screen.getByRole('table', { name: 'Downgrades, sortable' })).toBeTruthy()
    fireEvent.click(screen.getByTestId('terminal-updg-kind-upgrades'))
    expect(symsInTable()).toEqual(['AAA', 'BBB'])
    fireEvent.click(screen.getByTestId('terminal-updg-kind-all'))
    expect(symsInTable()).toHaveLength(5)
    // outside a registered panel nothing is written back: the chip is plain component state
    expect(rerun).not.toHaveBeenCalled()
  })

  it('the kind prop seeds the chip, and a kind with nothing in it says so', async () => {
    jsonFetcher.mockResolvedValue({ ...PAYLOAD, downgrades: [] })
    renderPanel({ kind: 'DOWN' })
    const none = await screen.findByTestId('terminal-updg-none')
    expect(none.textContent).toContain('No downgrades in this list.')
    expect(screen.getByTestId('terminal-updg').getAttribute('data-kind')).toBe('downgrades')
    expect(screen.getByTestId('terminal-updg-kind-downgrades').textContent).toBe('Downgrades (0)')
    expect(screen.queryByTestId('terminal-updg-table')).toBeNull()
    fireEvent.click(screen.getByTestId('terminal-updg-kind-targets'))
    expect(symsInTable()).toEqual(['DDD', 'AAA'])
  })

  it('sorts by a column, says which way, and goes back to the list order', async () => {
    jsonFetcher.mockResolvedValue(PAYLOAD)
    renderPanel()
    await screen.findByTestId('terminal-updg-table')
    expect(screen.queryByTestId('terminal-updg-sort-reset')).toBeNull()
    fireEvent.click(screen.getByTestId('terminal-updg-sort-target'))
    // biggest target first; rows with no single number sink, in list order
    expect(symsInTable()).toEqual(['DDD', 'AAA', 'BBB', 'CCC', 'AAA'])
    expect(screen.getByTestId('terminal-updg-sort-target').closest('th').getAttribute('aria-sort')).toBe('descending')
    fireEvent.click(screen.getByTestId('terminal-updg-sort-sym'))
    expect(symsInTable()).toEqual(['AAA', 'AAA', 'BBB', 'CCC', 'DDD'])
    expect(screen.getByTestId('terminal-updg-sort-sym').closest('th').getAttribute('aria-sort')).toBe('ascending')
    expect(screen.getByTestId('terminal-updg-sort-target').closest('th').getAttribute('aria-sort')).toBe('none')
    fireEvent.click(screen.getByTestId('terminal-updg-sort-reset'))
    expect(symsInTable()).toEqual(['AAA', 'BBB', 'CCC', 'DDD', 'AAA'])
  })

  it('inside a panel whose code takes the word, a chip writes itself into the command', async () => {
    // MOST is an existing code whose market variant takes UP and DOWN (and not PT).
    jsonFetcher.mockResolvedValue(PAYLOAD)
    const { rerun } = renderPanel({}, { code: 'MOST' })
    await screen.findByTestId('terminal-updg-table')
    fireEvent.click(screen.getByTestId('terminal-updg-kind-upgrades'))
    expect(rerun).toHaveBeenLastCalledWith('MOST UP')
    fireEvent.click(screen.getByTestId('terminal-updg-kind-downgrades'))
    expect(rerun).toHaveBeenLastCalledWith('MOST DOWN')
    fireEvent.click(screen.getByTestId('terminal-updg-kind-all'))
    expect(rerun).toHaveBeenLastCalledWith('MOST')
    // a word the code does not take is not written back, and the chip still cuts the list
    fireEvent.click(screen.getByTestId('terminal-updg-kind-targets'))
    expect(rerun).toHaveBeenCalledTimes(3)
    expect(symsInTable()).toEqual(['DDD', 'AAA'])
  })
})

describe('UPDG follows the member\'s theme', () => {
  it('the panel holds no hard-coded color', () => {
    const text = fs.readFileSync(path.join(HERE, 'UpgradesPanel.jsx'), 'utf8')
    expect(colourLiteralsIn('pages/terminal/panels/UpgradesPanel.jsx', text).map((h) => h.lit)).toEqual([])
  })
})

describe('UPDG accessibility', () => {
  it('the list passes axe (WCAG A and AA), sorted or not', async () => {
    jsonFetcher.mockResolvedValue({ ...PAYLOAD, wire_date: '2026-11-13', wire_status: 'stale' })
    renderPanel()
    await screen.findByTestId('terminal-updg-table')
    await expectNoAxeViolations(document.body.firstElementChild)
    fireEvent.click(screen.getByTestId('terminal-updg-sort-target'))
    await expectNoAxeViolations(document.body.firstElementChild)
  }, 20_000)
})

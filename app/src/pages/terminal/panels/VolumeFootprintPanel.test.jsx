// VFP: one stock's volume footprint and gaps. Rails:
//   * no ticker asks for one; loading; a failed read (error with Retry); signed out, a timeout, not on a
//     paid plan and a switched-off route; not a ticker (400); an answer that is not the route's shape;
//     a stock with no stored prices, a busy server and a failed build each say so in words;
//   * the four sections in order, each with its own as-of and its definition in words; every number
//     through the shared words; too little history is words; a young stock says its year is short;
//   * the earnings mark only where it is known, and the note naming the span; a gap over 40% marked;
//     the gap list's cut said; a later failed read keeps the last answer;
//   * the header gets the data's own date; tokens only; one reader, no polling loop of its own; axe;
//     screen-reader text adds no width (no visually hidden copy inside a table cell).
// Every value is invented (__fixtures__/volumeFootprintFixture.js) in the route's real shape.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { SWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
import jsonFetcher from '../../../utils/jsonFetcher'
import { PanelFreshnessContext, PanelListContext, TerminalPanelContext } from '../../../components/terminal'
import VolumeFootprintPanel from './VolumeFootprintPanel'
import { HELD_POLL_MS, VFP_CODE, VFP_SOURCE, vfpUrl } from './volumeFootprintModel'
import { vfpAnswer } from './__fixtures__/volumeFootprintFixture'
import { colourLiteralsIn } from '../__tests__/themeScope'
import { expectNoAxeViolations } from '../../journal-2-0/a11y/axeHarness'

const fail = (status, extra = {}) => Object.assign(new Error(`http ${status}`), { status }, extra)
const PENDING = Symbol('pending')
const URL_NVDA = '/api/research/volume-footprint/NVDA'
function serve(body, url = URL_NVDA) {
  jsonFetcher.mockImplementation((u) => {
    if (u !== url) return Promise.reject(fail(500))
    if (body === PENDING) return new Promise(() => {})
    return body instanceof Error ? Promise.reject(body) : Promise.resolve(body)
  })
}
const asked = () => [...new Set(jsonFetcher.mock.calls.map(([u]) => u))]

function renderPanel({ setFreshness = vi.fn(), code = null, sym = 'NVDA' } = {}) {
  const body = <VolumeFootprintPanel sym={sym} />
  const view = render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <PanelFreshnessContext.Provider value={setFreshness}>
        <PanelListContext.Provider value={{ open: vi.fn(), run: vi.fn(), rerun: vi.fn(), publish: vi.fn(), publishRows: vi.fn() }}>
          {code ? <TerminalPanelContext.Provider value={{ code, density: 'comfortable', inset: true }}>{body}</TerminalPanelContext.Provider> : body}
        </PanelListContext.Provider>
      </PanelFreshnessContext.Provider>
    </SWRConfig>,
  )
  return { setFreshness, container: view.container }
}
const HERE = path.dirname(fileURLToPath(import.meta.url))
const root = () => screen.getByTestId('terminal-vfp')
const textOf = (id) => screen.getByTestId(id).textContent

beforeEach(() => { jsonFetcher.mockReset() })
afterEach(cleanup)

describe('VFP states', () => {
  it('without a ticker it asks for one and reads nothing', () => {
    renderPanel({ sym: '', code: 'VFP' })
    expect(screen.getByText('VFP needs a ticker.')).toBeTruthy()
    expect(jsonFetcher).not.toHaveBeenCalled()
  })

  it('shows a loading skeleton and asks the one route for the ticker', () => {
    serve(PENDING)
    renderPanel()
    expect(VFP_CODE).toBe('VFP')
    expect(vfpUrl('NVDA')).toBe(URL_NVDA)
    expect(screen.getByTestId('terminal-vfp-loading')).toBeTruthy()
    expect(asked()).toEqual([URL_NVDA])
  })

  it('a failed read is an error with Retry, and Retry reads again', async () => {
    serve(fail(500))
    const { setFreshness } = renderPanel({ code: 'VFP' })
    const err = await screen.findByTestId('terminal-vfp-error')
    expect(err.getAttribute('data-kind')).toBe('error')
    expect(err.textContent).toContain('The volume footprint could not be read just now.')
    expect(err.textContent).toContain('Retry, or run NVDA VFP again.')
    expect(setFreshness.mock.calls.every(([r]) => r == null)).toBe(true)
    serve(vfpAnswer())
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-vfp-accumulation')).toBeTruthy()
  })

  it('signed out, a timeout, no paid plan and a switched-off route each say so; only an error can be retried', async () => {
    for (const [err, kind, words] of [
      [fail(401), 'error', 'You are signed out, so the volume footprint cannot be read. Sign in again.'],
      [fail(0, { timedOut: true }), 'error', 'The volume footprint did not answer within 30 seconds.'],
      [fail(402), 'locked', 'The volume footprint needs a paid plan.'],
      [fail(404), 'locked', 'The volume footprint is not switched on for this server yet.'],
    ]) {
      serve(err)
      renderPanel()
      const state = await screen.findByTestId('terminal-vfp-error')
      expect(state.getAttribute('data-kind')).toBe(kind)
      expect(state.textContent).toContain(words)
      expect(!!screen.queryByRole('button', { name: 'Retry' })).toBe(kind === 'error')
      cleanup()
    }
  })

  it('a symbol the server refuses (400) asks for a ticker; an answer that is not the route\'s shape is a failed read', async () => {
    serve(fail(400), '/api/research/volume-footprint/%24%24')
    renderPanel({ sym: '$$', code: 'VFP' })
    expect((await screen.findByTestId('terminal-vfp-bad-symbol')).textContent).toContain('Type one first, e.g. NVDA VFP')
    cleanup()
    for (const b of [{ items: [] }, { status: 'computing' }, []]) {
      serve(b)
      renderPanel()
      expect((await screen.findByTestId('terminal-vfp-error')).textContent).toContain('The volume footprint for NVDA could not be read just now.')
      cleanup()
    }
  })

  it('a stock with no stored prices, a busy server and a failed build each say so, never an empty panel', async () => {
    serve({ status: 'not_held', symbol: 'NVDA', detail: 'UCT holds no daily prices for NVDA.' })
    renderPanel()
    const none = await screen.findByTestId('terminal-vfp-not-held')
    expect(none.textContent).toContain('UCT holds no daily prices for NVDA.')
    expect(none.textContent).toContain('That is not the same as NVDA having no history.')
    cleanup()
    serve({ status: 'busy', symbol: 'NVDA', detail: 'The server is busy working out volume footprints. Try again in a moment.' })
    renderPanel()
    expect((await screen.findByTestId('terminal-vfp-busy')).textContent).toContain('Try again in a moment.')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
    cleanup()
    serve({ status: 'unavailable', symbol: 'NVDA', reason: 'failed', detail: 'The volume footprint for NVDA could not be worked out just now.' })
    renderPanel()
    expect((await screen.findByTestId('terminal-vfp-unavailable')).textContent).toContain('could not be worked out just now')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })
})

describe('VFP sections', () => {
  it('draws the four sections in order, each with its own as-of, and reports the data\'s date to the header', async () => {
    serve(vfpAnswer())
    const { setFreshness } = renderPanel({ code: 'VFP' })
    await screen.findByTestId('terminal-vfp-accumulation')
    const ids = [...root().querySelectorAll('section')].map((s) => s.getAttribute('data-testid'))
    expect(ids).toEqual(['terminal-vfp-accumulation', 'terminal-vfp-bigdays', 'terminal-vfp-pivots', 'terminal-vfp-gaps'])
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Accumulation and distribution', 'The biggest volume days', 'Pocket pivots', 'Gaps'])
    expect(textOf('terminal-vfp-accumulation-asof')).toBe('As of the close of Nov 20, 2026; the windows run 25 from Oct 19, 2026 and 50 from Sep 14, 2026.')
    expect(textOf('terminal-vfp-bigdays-asof')).toBe('As of the close of Nov 20, 2026.')
    expect(textOf('terminal-vfp-pivots-asof')).toBe('As of the close of Nov 20, 2026.')
    expect(textOf('terminal-vfp-gaps-asof')).toBe('Every session from Mar 1, 2019 to the close of Nov 20, 2026.')
    const last = setFreshness.mock.calls.map(([r]) => r).filter(Boolean).at(-1)
    expect(last.source).toBe(VFP_SOURCE)
    expect(last.age.asOfDate).toBe('2026-11-20')
  })

  it('section 1: both windows, up/down volume, the day lists and every definition in words', async () => {
    serve(vfpAnswer())
    renderPanel()
    await screen.findByTestId('terminal-vfp-ad')
    expect(textOf('terminal-vfp-ad-w25')).toBe('7 accumulation days, 5 distribution days: net +2')
    expect(textOf('terminal-vfp-ad-w50')).toMatch(/^14 accumulation days, 11 distribution days: net \+3$/)
    expect(textOf('terminal-vfp-ad-updown')).toMatch(/^0\.88 \([\d.]+M shares on \d+ up closes, [\d.]+M on \d+ down closes\)$/)
    expect(textOf('terminal-vfp-ad-dist')).toMatch(/^([A-Z][a-z]{2} \d{1,2}(, )?)+$/)
    const method = textOf('terminal-vfp-ad-method')
    expect(method).toContain('An accumulation day closed at least 0.2% above the session before on more volume than it')
    expect(method).toContain('an unchanged close counts in neither')
  })

  it('section 2: the ten heaviest sessions, largest first, with the multiple, the change and where it closed', async () => {
    serve(vfpAnswer())
    renderPanel()
    const table = await screen.findByTestId('terminal-vfp-bigdays-table')
    const rows = within(table).getAllByTestId('terminal-vfp-bigday')
    expect(rows).toHaveLength(10)
    expect(rows[0].textContent).toMatch(/^Aug 27, 2026earnings[\d.]+M[\d.]+x its 50-day average[+-][\d.]+%closed \d+% up its range$/)
    expect(rows.filter((r) => r.getAttribute('data-earnings') === 'true')).toHaveLength(4)
    expect(textOf('terminal-vfp-bigdays-line')).toMatch(/^The 10 heaviest sessions since Nov 20, 2025: \d+ closed up, \d+ down; 4 were on an earnings report\.$/)
    expect(textOf('terminal-vfp-bigdays-method')).toContain("the day's volume over the average of the 50 sessions before it (the day itself left out)")
    expect(screen.queryByTestId('terminal-vfp-bigdays-partial')).toBeNull()
  })

  it('section 3: every pocket pivot newest first, with the definition in words', async () => {
    const b = vfpAnswer()
    serve(b)
    renderPanel()
    const rows = await screen.findAllByTestId('terminal-vfp-pivot')
    expect(rows).toHaveLength(b.pivots.count)
    const dates = b.pivots.rows.map((r) => r.date)
    expect([...dates].sort().reverse()).toEqual(dates)
    expect(rows[0].textContent).toMatch(/\d\.\d{2}x the biggest down day/)
    expect(rows[0].textContent).toMatch(/vs the 10-day line$/)
    expect(textOf('terminal-vfp-pivots-method')).toContain('A pocket pivot is an up day whose volume is above the largest volume of any down day among the 10 sessions before it, closing above its 10-day moving average')
  })

  it('section 4: the fill shares up and down, the newest gaps with the day and the fill, and the cut said', async () => {
    serve(vfpAnswer())
    renderPanel()
    await screen.findByTestId('terminal-vfp-gaps-table')
    expect(textOf('terminal-vfp-gaps-line')).toMatch(/^91 gaps of 3% or more since Mar 1, 2019: \d+ up, \d+ down; 15 not filled yet\.$/)
    expect(textOf('terminal-vfp-fills-all')).toBe('All91 gaps15 still open23%21 of 9152%47 of 91')
    expect(within(screen.getByTestId('terminal-vfp-fills')).getAllByRole('rowheader').map((h) => h.textContent)).toEqual(['All', 'Up', 'Down'])
    const gaps = screen.getAllByTestId('terminal-vfp-gap')
    expect(gaps).toHaveLength(60)
    expect(gaps[0].textContent).toMatch(/^[A-Z][a-z]{2} \d{1,2}, 2026(up|down) [\d.]+% from \$[\d,.]+/)
    expect(textOf('terminal-vfp-gaps-cut')).toBe('Listing the newest 60 of 91; the counts above take in every one.')
    expect(textOf('terminal-vfp-gaps-earnings')).toBe('48 gaps fall inside the span the earnings dates cover; 12 were on an earnings report.')
    expect(textOf('terminal-vfp-gaps-method')).toContain('It filled when a later price traded back to that close')
    expect(screen.queryByTestId('terminal-vfp-check-note')).toBeNull()
  })

  it('the earnings note names the span; with none held no session is marked and the note says why', async () => {
    serve(vfpAnswer())
    renderPanel()
    expect((await screen.findByTestId('terminal-vfp-earnings-note')).textContent).toContain('The marks are complete from Nov 29, 2023 to Nov 20, 2026')
    cleanup()
    const b = vfpAnswer()
    b.earnings = { state: 'not_held', source: 'x' }
    for (const r of [...b.big_days.rows, ...b.pivots.rows, ...b.gaps.rows]) r.earnings = null
    serve(b)
    renderPanel()
    expect((await screen.findByTestId('terminal-vfp-earnings-note')).textContent).toBe("UCT's earnings page has not been built for NVDA on this server yet, so no session carries an earnings mark.")
    expect(screen.queryAllByTestId('terminal-vfp-earnings')).toHaveLength(0)
    expect(screen.queryByTestId('terminal-vfp-gaps-earnings')).toBeNull()
  })

  it('too little history is words; a young stock says its year is short; a gap over 40% is marked', async () => {
    const b = vfpAnswer()
    b.accumulation.windows[1] = { state: 'short', needed: 51, held: 40, unit: 'sessions', sessions: 50 }
    b.accumulation.updown = { state: 'short', needed: 51, held: 40, unit: 'sessions', sessions: 50 }
    b.big_days.full_year = false
    b.big_days.held_from = '2026-09-14'
    b.gaps.rows[0].check = true
    serve(b)
    renderPanel()
    await screen.findByTestId('terminal-vfp-ad')
    expect(textOf('terminal-vfp-ad-w50')).toBe('Needs 51 sessions; UCT holds 40.')
    expect(textOf('terminal-vfp-ad-updown')).toBe('Needs 51 sessions; UCT holds 40.')
    expect(root().textContent).not.toMatch(/\b0 accumulation days, 0 distribution/)
    expect(textOf('terminal-vfp-bigdays-partial')).toBe("UCT's prices for NVDA start Sep 14, 2026, less than a year back: this covers what is held.")
    expect(screen.getAllByTestId('terminal-vfp-check')).toHaveLength(1)
    expect(textOf('terminal-vfp-check-note')).toContain('can be a split the history did not adjust')
  })

  it('asks again after half an hour; a later read that fails keeps the last answer and says so', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      let n = 0
      jsonFetcher.mockImplementation(async () => {
        n += 1
        if (n === 1) return vfpAnswer()
        throw fail(503)
      })
      renderPanel()
      await screen.findByTestId('terminal-vfp-accumulation')
      expect(n).toBe(1)
      await vi.advanceTimersByTimeAsync(HELD_POLL_MS + 1000)
      expect((await screen.findByTestId('terminal-vfp-stale-read')).textContent).toBe('The volume footprint could not be read just now. Showing the last read.')
      expect(n).toBe(2)
      expect(screen.getByTestId('terminal-vfp-gaps-table')).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('VFP rails', () => {
  it('has no axe violations with every section and after a failed read', async () => {
    serve(vfpAnswer())
    const ok = renderPanel()
    await screen.findByTestId('terminal-vfp-gaps-table')
    await expectNoAxeViolations(ok.container)
    cleanup()
    serve(fail(500))
    const failed = renderPanel()
    await screen.findByTestId('terminal-vfp-error')
    await expectNoAxeViolations(failed.container)
  })

  it('paints no hard-coded color: the panel, its model and its stylesheet use tokens only, with no screen query', () => {
    for (const file of ['VolumeFootprintPanel.jsx', 'volumeFootprintModel.js', 'volumeFootprintPanel.module.css']) {
      const src = fs.readFileSync(path.join(HERE, file), 'utf8')
      expect(colourLiteralsIn(src, file), file).toEqual([])
    }
    const css = fs.readFileSync(path.join(HERE, 'volumeFootprintPanel.module.css'), 'utf8')
    expect(css).not.toMatch(/--(success|danger|gain|loss)/)
    expect(css).not.toMatch(/@media|infinite/)
  })

  it('reads through the terminal\'s one reader and reports the data\'s date through the panel header', () => {
    const src = fs.readFileSync(path.join(HERE, 'VolumeFootprintPanel.jsx'), 'utf8')
    expect(src).toMatch(/useMarketRead\(vfpUrl\(s\), \{ refreshInterval: HELD_POLL_MS \}\)/)
    expect(src).toMatch(/usePanelFreshness\(ok \? panelAsOf\(VFP_SOURCE, view\.dataThrough\) : null\)/)
    expect(src).not.toMatch(/setInterval|setTimeout|fetch\(/)
    expect(src).not.toMatch(/srOnly|visually-?hidden/i)
    expect(process.env.NODE_ENV).not.toBe('production')
  })
})

// IDAY: the latest AI-written intraday market update. Rails:
//   * loading, a failed read (error with Retry), a paywall and a switched-off route (no Retry),
//     signed out, and a body that is not this route's;
//   * the route's `{}` is "no update on hand": not an error, not a quiet market, and no as-of;
//   * an update says it is AI-written and when it was written, on screen and in the panel header;
//   * OWNER RULING 2026-11-17: the market phase and the session note only. A payload that carries
//     a per-stock list draws none of it (no symbol, no note, no status, no count) and the copy
//     does not name it;
//   * the notes are drawn as text: markup the model wrote stays characters, never elements;
//   * the model's own exposure, trend, risk and leader numbers are not drawn;
//   * REGM opens beside the panel.
// The fixture is the shape the writer posts (api/routers/push.py push_intraday), made-up content.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
import jsonFetcher from '../../../utils/jsonFetcher'
import { PanelFreshnessContext, PanelListContext, TerminalPanelContext } from '../../../components/terminal'
import IntradayUpdatePanel, { INTRADAY_UPDATE_CODE, INTRADAY_UPDATE_URL, NOTE_MAX } from './IntradayUpdatePanel'
import { colourLiteralsIn } from '../__tests__/themeScope'
import { expectNoAxeViolations } from '../../journal-2-0/a11y/axeHarness'

const SOURCE = 'UCT Intelligence engine (AI-written)'
const UPDATE = {
  mode: 'midday',
  timestamp: '2026-11-17T12:02:31.123456-05:00',
  date: '2026-11-17',
  regime: { phase: 'Uptrend', trend_score: 7.7, distribution_days: 6, risk_score: 3.3, exposure_pct: 83, notes: 'Breadth is holding and volume is above average.' },
  ep_updates: [
    { symbol: 'ZZQA', status: 'new', current_price: 41.25, pct_from_entry: 6.5, note: 'Gapped on earnings and held the open.' },
    { symbol: 'ZZQB', status: 'following through', note: 'Second day of heavy volume.' },
    { symbol: 'ZZQC', status: 'failed', note: '' },
  ],
  session_notes: 'Buyers are holding the morning gains into midday.',
  leaders_count: 19,
}

const fail = (status, extra = {}) => Object.assign(new Error(`http ${status}`), { status }, extra)
const PENDING = Symbol('pending')
/** Serves the route its body (an Error is thrown, PENDING never answers); anything else is a 500. */
function serve(hit) {
  jsonFetcher.mockImplementation((url) => {
    if (url !== INTRADAY_UPDATE_URL || hit === undefined) return Promise.reject(fail(500))
    if (hit === PENDING) return new Promise(() => {})
    return hit instanceof Error ? Promise.reject(hit) : Promise.resolve(hit)
  })
}
const asked = () => jsonFetcher.mock.calls.map(([url]) => url)

function renderPanel({ run = vi.fn(), open = vi.fn(), publish = vi.fn(), publishRows = vi.fn(), setFreshness = vi.fn(), code = null } = {}) {
  const body = <IntradayUpdatePanel />
  const view = render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <PanelFreshnessContext.Provider value={setFreshness}>
        <PanelListContext.Provider value={{ open, run, rerun: vi.fn(), publish, publishRows }}>
          {code ? <TerminalPanelContext.Provider value={{ code, density: 'comfortable', inset: true }}>{body}</TerminalPanelContext.Provider> : body}
        </PanelListContext.Provider>
      </PanelFreshnessContext.Provider>
    </SWRConfig>,
  )
  return { run, open, publish, publishRows, setFreshness, container: view.container }
}
const HERE = path.dirname(fileURLToPath(import.meta.url))

beforeEach(() => { jsonFetcher.mockReset() })
afterEach(cleanup)

describe('IDAY states', () => {
  it('shows a loading skeleton and asks the one route', () => {
    serve(PENDING)
    renderPanel()
    expect(INTRADAY_UPDATE_CODE).toBe('IDAY')
    expect(screen.getByTestId('terminal-iday-loading')).toBeTruthy()
    expect(screen.queryByTestId('terminal-iday')).toBeNull()
    expect(asked()).toEqual(['/api/intraday-update'])
  })

  it('a failed read (500) is an error with Retry, never "no update"', async () => {
    serve(undefined)
    const { setFreshness } = renderPanel({ code: 'IDAX' })
    const err = await screen.findByTestId('terminal-iday-error')
    expect(err.getAttribute('data-kind')).toBe('error')
    expect(err.textContent).toContain('The intraday update could not be read just now.')
    expect(err.textContent).toContain('That is not the same as no update. Retry, or run IDAX again.')
    expect(screen.queryByTestId('terminal-iday-none')).toBeNull()
    expect(setFreshness.mock.calls.every(([report]) => report == null)).toBe(true)
    serve(UPDATE)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-iday-written')).toBeTruthy()
  })

  it('signed out (401) and locked (402, 404) each say so, and only an error can be retried', async () => {
    for (const [status, kind, words] of [
      [401, 'error', 'You are signed out, so the intraday update cannot be read. Sign in again.'],
      [402, 'locked', 'The intraday update needs a paid plan.'],
      [404, 'locked', 'The intraday update is not switched on for this server yet.'],
    ]) {
      cleanup()
      serve(fail(status))
      renderPanel()
      const state = await screen.findByTestId('terminal-iday-error')
      expect(state.getAttribute('data-kind'), String(status)).toBe(kind)
      expect(state.textContent).toContain(words)
      expect(!!screen.queryByRole('button', { name: 'Retry' }), String(status)).toBe(kind === 'error')
      expect(screen.queryByTestId('terminal-iday-none')).toBeNull()
    }
  })

  it('a body that is not this route\'s is an error, not an update and not "none"', async () => {
    serve({ detail: 'upstream said something else' })
    renderPanel()
    const err = await screen.findByTestId('terminal-iday-error')
    expect(err.getAttribute('data-kind')).toBe('error')
    expect(err.textContent).toContain('came back in a form this panel cannot read')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })

  it('the route\'s {} says no update is on hand, why, and when one is written: no as-of, and it can be checked again', async () => {
    serve({})
    const { setFreshness } = renderPanel()
    const none = await screen.findByTestId('terminal-iday-none')
    expect(screen.getByTestId('terminal-iday').getAttribute('data-state')).toBe('none')
    expect(none.getAttribute('data-kind')).toBe('empty')
    expect(none.getAttribute('role')).toBe('status')
    expect(none.textContent).toContain('No intraday update is on hand right now.')
    expect(none.textContent).toContain('An AI model writes one on trading days after the open (about 9:45 AM ET), at midday (12:00 PM ET) and before the close (2:30 PM ET).')
    expect(none.textContent).toContain('The server keeps each one for 4 hours')
    expect(none.textContent).toContain('That is not a failed read, and it says nothing about the market.')
    expect(screen.queryByTestId('terminal-iday-error')).toBeNull()
    expect(screen.queryByTestId('terminal-iday-written')).toBeNull()
    expect(setFreshness.mock.calls.every(([report]) => report == null)).toBe(true)
    serve(UPDATE)
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
    expect(await screen.findByTestId('terminal-iday-written')).toBeTruthy()
  })
})

describe('IDAY an update', () => {
  it('says it is AI-written and when, then the phase and the session note', async () => {
    serve(UPDATE)
    const { setFreshness } = renderPanel()
    const written = await screen.findByTestId('terminal-iday-written')
    expect(screen.getByTestId('terminal-iday').getAttribute('data-mode')).toBe('midday')
    expect(written.textContent).toMatch(/^AI-writtenMidday run, written at 12:02\sPM ET on 2026-11-17\.$/)
    expect(screen.getByTestId('terminal-iday-ai').textContent)
      .toContain('An AI model wrote everything below. No person checked or edited it')
    expect(screen.getByTestId('terminal-iday-session').textContent).toBe('Buyers are holding the morning gains into midday.')
    const phase = screen.getByTestId('terminal-iday-phase').textContent
    expect(phase).toContain('PhaseUptrend')
    expect(phase).toContain('Its reasonBreadth is holding and volume is above average.')
    expect(screen.getByTestId('terminal-iday-regm').textContent)
      .toBe('The AI\'s phase is its own label, not the site\'s market regime. The site\'s regime and the UCT Exposure are on REGM.')
    // the header names the source as AI-written and carries the instant the model wrote it
    await waitFor(() => expect(setFreshness).toHaveBeenCalledWith(expect.objectContaining({ source: SOURCE, observedAt: '2026-11-17T17:02:31.123Z' })))
    const method = screen.getByTestId('terminal-iday-method').textContent
    expect(method).toContain('keeps it for 4 hours')
    expect(method).toContain('This panel shows the market phase and the session note; the update\'s other details are not shown here.')
    expect(document.body.textContent).not.toMatch(/[—–]/)
    expect(asked()).toEqual([INTRADAY_UPDATE_URL])
  })

  it('a payload that carries a per-stock list draws none of it: no symbol, no note, no status, no count, no table', async () => {
    serve(UPDATE)
    const { container, publish, publishRows } = renderPanel()
    await screen.findByTestId('terminal-iday-written')
    const text = document.body.textContent
    const html = document.body.innerHTML
    for (const s of [
      'ZZQA', 'ZZQB', 'ZZQC', 'Gapped on earnings', 'held the open', 'Second day of heavy volume', 'following through', '41.25', '6.5',
    ]) {
      expect(text, s).not.toContain(s)
      expect(html, s).not.toContain(s)
    }
    // no count of them, in digits or in words, and no copy that says a list exists or was left out
    expect(text).not.toMatch(/\b3\b/)
    expect(text).not.toMatch(/\b(two|three)\b/i)
    expect(text).not.toMatch(/candidate|episodic|pivot|flagged|stocks?\b|symbols?\b|tickers?\b|left out|at most|characters/i)
    expect(container.querySelector('table')).toBeNull()
    expect(container.querySelector('[data-testid^="panel-symbol-"]')).toBeNull()
    expect(container.querySelector('[data-testid^="terminal-iday-row"]')).toBeNull()
    expect(screen.queryByTestId('terminal-iday-stocks')).toBeNull()
    expect(screen.queryByTestId('terminal-iday-no-stocks')).toBeNull()
    // no row is published to the shell (a typed row number must load nothing) and no list either
    expect(publishRows.mock.calls.every(([rows]) => !rows || rows.length === 0)).toBe(true)
    expect(publish.mock.calls.every(([list]) => list == null)).toBe(true)
    // the same screen, word for word, with and without the list
    const withList = screen.getByTestId('terminal-iday').textContent
    cleanup()
    const { ep_updates: _left, ...without } = UPDATE
    serve(without)
    renderPanel()
    await screen.findByTestId('terminal-iday-written')
    expect(screen.getByTestId('terminal-iday').textContent).toBe(withList)
  })

  it('an update with no list reads the same: no sentence says none was sent', async () => {
    serve({ ...UPDATE, ep_updates: [] })
    renderPanel()
    await screen.findByTestId('terminal-iday-written')
    expect(document.body.textContent).not.toMatch(/candidate|episodic|pivot|flagged|\bno stock/i)
  })

  it('the model\'s own exposure, trend, risk, distribution and leader numbers are not drawn or named', async () => {
    serve(UPDATE)
    renderPanel()
    await screen.findByTestId('terminal-iday-written')
    const text = document.body.textContent
    for (const n of ['83', '7.7', '3.3', '19']) expect(text, n).not.toContain(n)
    expect(text).not.toMatch(/distribution day|trend score|risk score|leaders/i)
  })

  it('markup the model wrote stays text: no element is made from a note', async () => {
    serve({
      ...UPDATE,
      session_notes: '<b>Strong</b> open <img src=x onerror=alert(1)>',
      regime: { phase: '<i>Uptrend</i>', notes: '<a href="https://example.com">read this</a>' },
    })
    const { container } = renderPanel()
    await screen.findByTestId('terminal-iday-written')
    expect(screen.getByTestId('terminal-iday-session').textContent).toBe('<b>Strong</b> open <img src=x onerror=alert(1)>')
    expect(screen.getByTestId('terminal-iday-phase').textContent).toContain('<i>Uptrend</i>')
    expect(screen.getByTestId('terminal-iday-phase').textContent).toContain('<a href="https://example.com">read this</a>')
    for (const tag of ['b', 'i', 'img', 'a', 'script']) expect(container.querySelector(tag), tag).toBeNull()
  })

  it('an update with no time says so, and one with nothing to read says that', async () => {
    serve({ mode: 'afterhours', timestamp: 'soon', session_notes: '', regime: {}, ep_updates: UPDATE.ep_updates })
    const { setFreshness } = renderPanel()
    const written = await screen.findByTestId('terminal-iday-written')
    expect(screen.getByTestId('terminal-iday').getAttribute('data-mode')).toBe('unknown')
    expect(written.textContent).toBe('AI-writtenAn intraday run. The update does not say when it was written.')
    expect(screen.getByTestId('terminal-iday-blank').textContent).toContain('This update carries no market phase and no session note.')
    expect(screen.queryByTestId('terminal-iday-session')).toBeNull()
    expect(screen.queryByTestId('terminal-iday-phase')).toBeNull()
    expect(document.body.textContent).not.toContain('ZZQ')
    // the source is still named; no time is made up for it
    await waitFor(() => expect(setFreshness).toHaveBeenCalledWith({ source: SOURCE }))
  })

  it('a note that runs past what the panel draws is cut, and says so', async () => {
    serve({ ...UPDATE, session_notes: 'x'.repeat(NOTE_MAX + 20) })
    renderPanel()
    await screen.findByTestId('terminal-iday-written')
    expect(screen.getByTestId('terminal-iday-session').textContent).toBe(`${'x'.repeat(NOTE_MAX)} (cut here; the note runs longer)`)
  })

  it('a session note alone still shows, with the pointer to REGM, and REGM opens beside this panel', async () => {
    serve({ mode: 'open', timestamp: '2026-11-17T09:46:00-05:00', session_notes: 'Quiet open.' })
    const { open } = renderPanel()
    const written = await screen.findByTestId('terminal-iday-written')
    expect(written.textContent).toMatch(/^AI-writtenAfter the open run, written at 9:46\sAM ET\.$/)
    expect(screen.getByTestId('terminal-iday-session').textContent).toBe('Quiet open.')
    expect(screen.queryByTestId('terminal-iday-phase')).toBeNull()
    fireEvent.click(screen.getByTestId('panel-command-REGM'))
    expect(open).toHaveBeenCalledWith('REGM')
  })
})

describe('IDAY follows the member\'s theme', () => {
  it('the panel and its model hold no hard-coded color', () => {
    for (const f of ['IntradayUpdatePanel.jsx', 'intradayUpdateModel.js']) {
      const text = fs.readFileSync(path.join(HERE, f), 'utf8')
      expect(colourLiteralsIn(`pages/terminal/panels/${f}`, text).map((h) => h.lit), f).toEqual([])
    }
  })
})

describe('IDAY accessibility', () => {
  it('an update and the no-update state pass axe (WCAG A and AA)', async () => {
    serve(UPDATE)
    renderPanel()
    await screen.findByTestId('terminal-iday-written')
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    serve({})
    renderPanel()
    await screen.findByTestId('terminal-iday-none')
    await expectNoAxeViolations(document.body.firstElementChild)
  }, 60_000)
})

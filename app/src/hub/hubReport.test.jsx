/**
 * W2 / R2 — the one-tap report.
 *
 * ⛔⛔ THE LOAD-BEARING CASE IS "IT NEVER SENDS WITHOUT A TAP". `gestureTrace.js` carries an
 * absolute header — "NO SINK, NO NETWORK, EVER … nothing in this file may POST, fetch, beacon, or
 * write to a server" — and adds that this "is not a limitation to be engineered around later — it
 * is the reason this instrument was allowed to exist at all."
 *
 * R2 relaxed exactly one thing: an ADMIN pressing a button may send. Everything else in that
 * sentence still holds, and the only way to keep holding it is to assert it. So this file rails the
 * TAP, not the transport: mounting sends nothing, re-rendering sends nothing, and the recorder
 * itself still contains no network call at all.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import HubReportButton from './HubReportButton'
import { buildReport, visibilityTriple, sendReport, REPORT_ENDPOINT } from './hubReport'
import { clearGestureTrace, recordGestureEvent } from './gestureTrace'

const HERE = path.dirname(fileURLToPath(import.meta.url))

let fetchSpy

beforeEach(() => {
  clearGestureTrace()
  fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ id: 7 }) }))
  vi.stubGlobal('fetch', fetchSpy)
})

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('⛔⛔ THE RECORDER STILL HAS NO SINK — the invariant R2 did NOT relax', () => {
  it('gestureTrace.js contains no network call of any kind', () => {
    // ⭐ Source-level, and the needle is built by concatenation so this file cannot match itself.
    const src = readFileSync(path.join(HERE, 'gestureTrace.js'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/\/\/[^\n]*/g, ' ')
    for (const needle of ['fet' + 'ch(', 'send' + 'Beacon', 'XML' + 'HttpRequest', 'navigator.' + 'sendBeacon']) {
      expect(src.includes(needle), `gestureTrace.js gained ${needle} — R2 did not authorise that`)
        .toBe(false)
    }
    // CONTROL: the stripper did not eat the file.
    expect(src).toMatch(/recordGestureEvent/)
  })

  it('mounting the Report button sends NOTHING', () => {
    render(<HubReportButton />)
    expect(fetchSpy, 'the report fired without a tap').not.toHaveBeenCalled()
  })

  it('re-rendering sends NOTHING', () => {
    const { rerender } = render(<HubReportButton />)
    rerender(<HubReportButton mode="scan" />)
    rerender(<HubReportButton mode="wire" />)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('even OPENING the sheet sends nothing — only Send does', () => {
    render(<HubReportButton />)
    fireEvent.click(screen.getByTestId('hub-report-button'))
    expect(screen.getByTestId('hub-report-sheet')).toBeTruthy()
    expect(fetchSpy, 'opening the sheet posted').not.toHaveBeenCalled()
  })
})

describe('⭐ one tap, no typing — the designed case', () => {
  it('Send with an empty note files a report with note null', async () => {
    render(<HubReportButton />)
    fireEvent.click(screen.getByTestId('hub-report-button'))
    fireEvent.click(screen.getByTestId('hub-report-send'))
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1))
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe(REPORT_ENDPOINT)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body).note, 'an empty note must travel as null, never ""').toBeNull()
  })

  it('a typed note travels, trimmed', async () => {
    render(<HubReportButton />)
    fireEvent.click(screen.getByTestId('hub-report-button'))
    fireEvent.change(screen.getByTestId('hub-report-note'), { target: { value: '  fan opened  ' } })
    fireEvent.click(screen.getByTestId('hub-report-send'))
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body).note).toBe('fan opened')
  })

  it('⛔ a failure keeps the sheet OPEN so the typed words are not thrown away', async () => {
    fetchSpy.mockResolvedValue({ ok: false, status: 503 })
    render(<HubReportButton />)
    fireEvent.click(screen.getByTestId('hub-report-button'))
    fireEvent.change(screen.getByTestId('hub-report-note'), { target: { value: 'my words' } })
    fireEvent.click(screen.getByTestId('hub-report-send'))
    await waitFor(() => expect(screen.getByTestId('hub-report-error')).toBeTruthy())
    expect(screen.getByTestId('hub-report-note').value, 'the note was discarded on failure')
      .toBe('my words')
  })

  it('⭐ the sheet SAYS whether a trace is attached — an instrument that cannot say what it '
     + 'measured is a vacuous one', () => {
    render(<HubReportButton />)
    fireEvent.click(screen.getByTestId('hub-report-button'))
    expect(screen.getByTestId('hub-report-meta').textContent)
      .toMatch(/No gesture trace/)

    cleanup()
    recordGestureEvent({ type: 'pointerdown', pointerType: 'touch' })
    render(<HubReportButton />)
    fireEvent.click(screen.getByTestId('hub-report-button'))
    expect(screen.getByTestId('hub-report-meta').textContent).toMatch(/gesture events attached/)
  })
})

describe('⛔ buildReport — the payload is frozen and honest', () => {
  it('carries every key the endpoint allows, and no others', () => {
    const r = buildReport({ page: '/screener' })
    // The server refuses an unknown top-level key BY NAME. A client that grew one would 400 on
    // every report, so the two lists are pinned against each other here.
    expect(Object.keys(r).sort()).toEqual(
      ['clientTime', 'device', 'flags', 'mode', 'note', 'page', 'stage', 'trace', 'visibility'])
  })

  it('⭐ derives the mode from the ROUTE, never from a passed-in guess', () => {
    expect(buildReport({ page: '/screener' }).mode).toBe('scan')
    expect(buildReport({ page: '/not-a-hub-route' }).mode).toBeNull()
  })

  it('⚰️ the visibility triple is all THREE — present is not showing', () => {
    // The programme published a defect that was not one by asking a querySelector whether the hub
    // was visible. `hidden`, computed display and a real box, or the answer is a guess.
    const el = document.createElement('div')
    el.setAttribute('hidden', '')
    document.body.appendChild(el)
    const v = visibilityTriple(el)
    expect(v.present).toBe(true)
    expect(v.hiddenAttr).toBe(true)
    expect(v).toHaveProperty('display')
    expect(v).toHaveProperty('box')
  })

  it('an absent hub reports present:false rather than pretending', () => {
    expect(visibilityTriple(null).present).toBe(false)
  })
})

describe('⛔ sendReport never throws — a rejected promise would show the owner nothing', () => {
  it('a thrown fetch resolves to ok:false with the reason', async () => {
    const res = await sendReport({}, async () => { throw new Error('offline') })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/offline/)
  })

  it('a non-ok response resolves to ok:false naming the status', async () => {
    const res = await sendReport({}, async () => ({ ok: false, status: 403 }))
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/403/)
  })
})

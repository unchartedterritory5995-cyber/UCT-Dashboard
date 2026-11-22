// TSRC call alerts: the save control and its small print, against a fake network (the real
// jsonFetcher runs, so a 402, a 500 and a dropped connection reach the panel the way they do live).
// Rails:
//   * nothing is written until the member presses the button, and the word sent is the stored form;
//   * NOTHING FLIPS BEFORE THE SERVER ANSWERS: while a write is out the screen still shows the old
//     state, and a second press sends nothing;
//   * every write outcome is said (saved, removed, already gone, refused with the server's reason,
//     unreadable, failed) and a write that did not land changes nothing on screen;
//   * the list is read again after every write, so the screen is the server's truth even when the
//     answer was lost; and the list the server sent WITH a write is kept when that re-read fails;
//   * a search an alert cannot hold shows why in place of the button, so it cannot be sent;
//   * a failed list read is an error with a retry, never "not saved"; the route's own failure
//     answer (max 0) is not "no alerts, paused";
//   * the panel says how a member is told, and nothing the server does not do.
// The fixtures are the routes' real shapes (api/routers/earnings_intel.py keyword-alerts).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import CallAlertSave, { CallAlertNotes } from './CallAlertSave'
import { CALL_ALERTS_URL } from './callAlertModel'
import { colourLiteralsIn } from '../__tests__/themeScope'
import { expectNoAxeViolations } from '../../journal-2-0/a11y/axeHarness'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const NETWORK = Symbol('no network')

const realFetch = globalThis.fetch
/** What the fake server holds. A healthy route reads and writes this; `over` replaces one method. */
let server
let calls
/**
 * `over[METHOD]`: a number (that status), an object (that 200 body), NETWORK (the request never
 * connects) or a function (called with the request, returns a Response or a promise of one).
 */
function serve(over = {}) {
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const method = init.method || 'GET'
    const u = new URL(String(url), 'http://x')
    calls.push([method, String(url), init.body ?? null])
    if (u.pathname !== CALL_ALERTS_URL) return json({ detail: 'not found' }, 404)
    const hit = over[method]
    if (hit === NETWORK) throw new TypeError('Failed to fetch')
    if (typeof hit === 'number') return json({ detail: 'x' }, hit)
    if (typeof hit === 'function') return hit({ url: u, init })
    if (hit !== undefined) return json(hit)
    const list = () => [...server.keywords].sort()
    if (method === 'POST') {
      const kw = JSON.parse(init.body).keyword
      if (!server.keywords.includes(kw)) server.keywords.push(kw)
      return json({ ok: true, keyword: kw, keywords: list() })
    }
    if (method === 'DELETE') {
      const kw = u.searchParams.get('keyword')
      const had = server.keywords.includes(kw)
      server.keywords = server.keywords.filter((k) => k !== kw)
      return json({ ok: had, keywords: list() })
    }
    return json({ keywords: list(), max: server.max, min_length: 3, enabled: server.enabled })
  })
}
const sent = (method) => calls.filter(([m]) => m === method)

function renderSave(q = 'margin', { notes = false } = {}) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <CallAlertSave q={q} />
      {notes ? <CallAlertNotes /> : null}
    </SWRConfig>,
  )
}
const box = () => screen.getByTestId('terminal-tsrc-alert')
const button = () => screen.getByTestId('terminal-tsrc-alert-button')
const status = () => screen.getByTestId('terminal-tsrc-alert-status')
const press = async () => { await act(async () => { fireEvent.click(button()) }) }
const outcome = (kind) => waitFor(() => expect(status().getAttribute('data-outcome')).toBe(kind))

beforeEach(() => {
  server = { keywords: ['buyback', 'tariff'], max: 25, enabled: true }
  calls = []
})
afterEach(() => { cleanup(); globalThis.fetch = realFetch })

describe('TSRC call alert: saving the search', () => {
  it('offers one button named with the word, says how the member is told, and writes nothing until it is pressed', async () => {
    serve()
    renderSave('Pricing Power')
    await screen.findByTestId('terminal-tsrc-alert')
    expect(box().getAttribute('data-state')).toBe('can-save')
    expect(screen.getByRole('button', { name: 'Save this search as a call alert: pricing power' })).toBe(button())
    expect(screen.getByTestId('terminal-tsrc-alert-how').textContent)
      .toBe('A match rings the alert bell and sends an email, after the 6:30 PM ET check on weekdays. 2 of 25 call alerts saved.')
    // a status region is there before anything is written, and it is empty
    expect(status().getAttribute('role')).toBe('status')
    expect(status().textContent).toBe('')
    expect(sent('POST')).toEqual([])
    expect(sent('DELETE')).toEqual([])
  })

  it('a save that lands: the stored word is sent, the result is said, and the one button turns into Remove', async () => {
    serve()
    renderSave('Margin')
    await screen.findByTestId('terminal-tsrc-alert')
    const before = button()
    before.focus()
    await press()
    await outcome('saved')
    expect(sent('POST')).toEqual([['POST', CALL_ALERTS_URL, JSON.stringify({ keyword: 'margin' })]])
    expect(status().textContent).toBe('Saved as a call alert: margin.')
    expect(box().getAttribute('data-state')).toBe('saved')
    expect(screen.getByTestId('terminal-tsrc-alert-saved').textContent).toBe('This search is a call alert.')
    expect(screen.getByRole('button', { name: 'Remove the call alert: margin' })).toBe(button())
    // the same element, so a keyboard user is still on it
    expect(button()).toBe(before)
    expect(document.activeElement).toBe(before)
    await waitFor(() => expect(screen.getByTestId('terminal-tsrc-alert-how').textContent).toContain('3 of 25 call alerts saved.'))
    // the list is read again after the write
    expect(sent('GET').length).toBeGreaterThanOrEqual(2)
  })

  it('nothing flips before the server answers, and a second press sends nothing', async () => {
    let answer
    serve({
      POST: () => new Promise((resolve) => {
        answer = () => { server.keywords.push('margin'); resolve(json({ ok: true, keyword: 'margin', keywords: ['buyback', 'margin', 'tariff'] })) }
      }),
    })
    renderSave()
    await screen.findByTestId('terminal-tsrc-alert')
    await press()
    expect(button().textContent).toBe('Saving the call alert: margin')
    expect(button().getAttribute('aria-disabled')).toBe('true')
    // still the old state: not shown as saved, no result yet
    expect(box().getAttribute('data-state')).toBe('can-save')
    expect(screen.queryByTestId('terminal-tsrc-alert-saved')).toBeNull()
    expect(status().textContent).toBe('')
    await press()
    await press()
    expect(sent('POST')).toHaveLength(1)
    await act(async () => { answer() })
    await outcome('saved')
    expect(box().getAttribute('data-state')).toBe('saved')
    expect(button().getAttribute('aria-disabled')).toBeNull()
  })

  it('refused by the server: its reason is said in plain words and nothing changes', async () => {
    for (const [body, words] of [
      [{ ok: false, reason: 'limit_reached', max: 25 }, 'Not saved. You already have 25 call alerts, the most call alerts allowed. Remove one first.'],
      [{ ok: false, reason: 'too_short_or_too_long', min_length: 3 }, 'Not saved. The server takes an alert of 3 to 60 characters, and "margin" is outside that.'],
      [{ ok: false, reason: 'not_a_reason_yet' }, 'Not saved. The server refused "margin" and gave no reason this panel knows.'],
    ]) {
      cleanup()
      calls = []
      serve({ POST: body })
      renderSave()
      await screen.findByTestId('terminal-tsrc-alert')
      await press()
      await outcome('refused')
      expect(status().textContent).toBe(words)
      expect(box().getAttribute('data-state')).toBe('can-save')
      expect(button().textContent).toBe('Save this search as a call alert: margin')
      expect(screen.getByTestId('terminal-tsrc-alert-how').textContent).toContain('2 of 25 call alerts saved.')
    }
  })

  it('a save that fails (500) says so, changes nothing, and the same button is the retry', async () => {
    serve({ POST: 500 })
    renderSave()
    await screen.findByTestId('terminal-tsrc-alert')
    await press()
    await outcome('failed')
    expect(status().textContent).toBe('The call alert could not be saved just now: margin. Nothing changed. Try again.')
    expect(box().getAttribute('data-state')).toBe('can-save')
    expect(screen.queryByTestId('terminal-tsrc-alert-saved')).toBeNull()
    expect(server.keywords).toEqual(['buyback', 'tariff'])
    // the server is back: pressing the same button again saves it
    serve()
    await press()
    await outcome('saved')
    expect(box().getAttribute('data-state')).toBe('saved')
    expect(server.keywords).toContain('margin')
  })

  it('signed out and no paid plan on the write are said as what they are', async () => {
    for (const [code, words] of [
      [401, 'You are signed out, so "margin" was not saved. Sign in again.'],
      [402, 'Call alerts need a paid plan, so "margin" was not saved.'],
    ]) {
      cleanup()
      serve({ POST: code })
      renderSave()
      await screen.findByTestId('terminal-tsrc-alert')
      await press()
      await outcome('failed')
      expect(status().textContent).toBe(words)
      expect(box().getAttribute('data-state')).toBe('can-save')
    }
  })

  it('an answer this panel cannot read never counts as saved', async () => {
    serve({ POST: { saved: 'yes' } })
    renderSave()
    await screen.findByTestId('terminal-tsrc-alert')
    await press()
    await outcome('unreadable')
    expect(status().textContent).toContain('cannot say whether "margin" was saved')
    expect(box().getAttribute('data-state')).toBe('can-save')
  })

  it('a lost answer does not guess: it says it cannot know, and the list read again shows the truth', async () => {
    // the request reached the server and was saved, but the answer never came back
    serve({ POST: () => { server.keywords.push('margin'); throw new TypeError('Failed to fetch') } })
    renderSave()
    await screen.findByTestId('terminal-tsrc-alert')
    await press()
    await outcome('failed')
    expect(status().textContent).toContain('The server could not be reached, so this panel cannot say whether "margin" was saved.')
    await waitFor(() => expect(box().getAttribute('data-state')).toBe('saved'))
    expect(button().textContent).toBe('Remove the call alert: margin')
  })

  it('the list the server sent with the write is kept when the read after it fails', async () => {
    serve()
    renderSave()
    await screen.findByTestId('terminal-tsrc-alert')
    serve({ GET: 500 })
    await press()
    await outcome('saved')
    await waitFor(() => expect(sent('GET').length).toBeGreaterThanOrEqual(2))
    expect(box().getAttribute('data-state')).toBe('saved')
    expect(screen.getByTestId('terminal-tsrc-alert-how').textContent).toContain('3 of 25 call alerts saved.')
  })
})

describe('TSRC call alert: a write result outlives an unreadable list', () => {
  it('the save is still said when the read after it comes back as the route\'s failure answer', async () => {
    serve()
    renderSave()
    await screen.findByTestId('terminal-tsrc-alert')
    serve({ GET: { keywords: [], max: 0, min_length: 0, enabled: false } })
    await press()
    await screen.findByTestId('terminal-tsrc-alert-error')
    expect(status().textContent).toBe('Saved as a call alert: margin.')
    expect(screen.queryByTestId('terminal-tsrc-alert-button')).toBeNull()
    expect(document.body.textContent).not.toContain('switched off')
  })
})

describe('TSRC call alert: a search that is already saved', () => {
  it('shows as saved whatever its capitals, with a Remove button named with the word', async () => {
    serve()
    renderSave('Tariff')
    await screen.findByTestId('terminal-tsrc-alert')
    expect(box().getAttribute('data-state')).toBe('saved')
    expect(screen.getByTestId('terminal-tsrc-alert-saved')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Remove the call alert: tariff' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Save this search/ })).toBeNull()
    expect(sent('POST')).toEqual([])
  })

  it('a removal that lands: the result is said and the search can be saved again', async () => {
    serve()
    renderSave('tariff')
    await screen.findByTestId('terminal-tsrc-alert')
    await press()
    await outcome('removed')
    expect(sent('DELETE')).toEqual([['DELETE', `${CALL_ALERTS_URL}?keyword=tariff`, null]])
    expect(status().textContent).toBe('Removed the call alert: tariff.')
    expect(box().getAttribute('data-state')).toBe('can-save')
    expect(button().textContent).toBe('Save this search as a call alert: tariff')
    expect(server.keywords).toEqual(['buyback'])
    // one press brings it back
    await press()
    await outcome('saved')
    expect(server.keywords).toContain('tariff')
  })

  it('a removal is not sent until the server is asked once, and waits for its answer', async () => {
    let answer
    serve({
      DELETE: () => new Promise((resolve) => {
        answer = () => { server.keywords = ['buyback']; resolve(json({ ok: true, keywords: ['buyback'] })) }
      }),
    })
    renderSave('tariff')
    await screen.findByTestId('terminal-tsrc-alert')
    await press()
    expect(button().textContent).toBe('Removing the call alert: tariff')
    expect(box().getAttribute('data-state')).toBe('saved')
    await press()
    expect(sent('DELETE')).toHaveLength(1)
    await act(async () => { answer() })
    await outcome('removed')
    expect(box().getAttribute('data-state')).toBe('can-save')
  })

  it('a removal that fails says so and the alert is still shown as saved', async () => {
    serve({ DELETE: 500 })
    renderSave('tariff')
    await screen.findByTestId('terminal-tsrc-alert')
    await press()
    await outcome('failed')
    expect(status().textContent).toBe('The call alert could not be removed just now: tariff. It is still saved. Try again.')
    expect(box().getAttribute('data-state')).toBe('saved')
    expect(button().textContent).toBe('Remove the call alert: tariff')
    expect(server.keywords).toContain('tariff')
  })

  it('an alert removed somewhere else is said as already gone', async () => {
    serve()
    renderSave('tariff')
    await screen.findByTestId('terminal-tsrc-alert')
    server.keywords = ['buyback']   // removed from the transcript panel in another tab
    await press()
    await outcome('gone')
    expect(status().textContent).toBe('The call alert was already gone: tariff.')
    expect(box().getAttribute('data-state')).toBe('can-save')
  })
})

describe('TSRC call alert: a search an alert cannot hold', () => {
  it('says why in place of the button, so nothing can be sent', async () => {
    const full = Array.from({ length: 25 }, (_, i) => `word${i}`)
    for (const [q, problem, words, setup] of [
      ['AI', 'short', 'This search cannot be saved as a call alert. An alert needs at least 3 characters, because a shorter word is said on almost every call.'],
      ['x'.repeat(61), 'long', 'This search cannot be saved as a call alert. An alert holds at most 60 characters, and this search has 61.'],
      ['tariff NEAR/5 china', 'near', 'This search cannot be saved as a call alert. It uses NEAR, and an alert is stored in lower case, where NEAR stops working. Search the words without NEAR to save them.'],
      ['margin', 'full', 'This search cannot be saved as a call alert. You have 25 call alerts, the most allowed. Remove one first.', () => { server.keywords = full }],
      ['margin', 'paused', 'This search cannot be saved as a call alert. Call alerts are switched off on the server right now, so nothing would be sent.', () => { server.enabled = false }],
    ]) {
      cleanup()
      server = { keywords: ['buyback', 'tariff'], max: 25, enabled: true }
      calls = []
      setup?.()
      serve()
      renderSave(q)
      await screen.findByTestId('terminal-tsrc-alert')
      expect(box().getAttribute('data-state'), problem).toBe('blocked')
      expect(box().getAttribute('data-problem')).toBe(problem)
      expect(screen.getByTestId('terminal-tsrc-alert-blocked').textContent).toBe(words)
      expect(screen.queryByRole('button')).toBeNull()
      expect(sent('POST')).toEqual([])
    }
  })

  it('a NEAR search is not shown as saved because its lower-case twin is', async () => {
    server.keywords = ['tariff near china']
    serve()
    renderSave('tariff NEAR china')
    await screen.findByTestId('terminal-tsrc-alert')
    expect(box().getAttribute('data-problem')).toBe('near')
    expect(screen.queryByTestId('terminal-tsrc-alert-saved')).toBeNull()
  })

  it('switched off: a saved search says nothing is being sent, and can still be removed', async () => {
    server.enabled = false
    serve()
    renderSave('tariff', { notes: true })
    await screen.findByTestId('terminal-tsrc-alert')
    expect(box().getAttribute('data-state')).toBe('saved')
    expect(screen.getByTestId('terminal-tsrc-alert-how').textContent)
      .toBe('Call alerts are switched off on the server right now, so nothing is being sent. 2 of 25 call alerts saved.')
    expect(screen.getByTestId('terminal-tsrc-alert-notes').textContent).toContain('no check runs and nothing is sent')
    expect(document.body.textContent).not.toContain('rings the alert bell')
    await press()
    await outcome('removed')
  })
})

describe('TSRC call alert: reading the list', () => {
  it('says it is reading, and offers nothing to press until it knows', () => {
    serve({ GET: () => new Promise(() => {}) })
    renderSave()
    expect(screen.getByTestId('terminal-tsrc-alert-loading').textContent).toBe('Reading your call alerts, to see whether this search is one.')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('a failed read is an error with a retry, never "not saved", and offers no save', async () => {
    serve({ GET: 500 })
    renderSave('tariff')
    const err = await screen.findByTestId('terminal-tsrc-alert-error')
    expect(err.getAttribute('role')).toBe('status')
    expect(err.textContent).toContain('The call alert list could not be read just now.')
    expect(err.textContent).toContain('cannot say whether this search is already a call alert, and will not save it without knowing.')
    expect(screen.queryByTestId('terminal-tsrc-alert-button')).toBeNull()
    serve()
    fireEvent.click(screen.getByRole('button', { name: 'Retry the call alert list' }))
    await screen.findByTestId('terminal-tsrc-alert')
    expect(box().getAttribute('data-state')).toBe('saved')
  })

  it('the route\'s own failure answer (max 0) is an error, never "no alerts, paused"', async () => {
    serve({ GET: { keywords: [], max: 0, min_length: 0, enabled: false } })
    renderSave('tariff', { notes: true })
    const err = await screen.findByTestId('terminal-tsrc-alert-error')
    expect(err.textContent).toContain('The call alert list could not be read just now.')
    expect(screen.getByRole('button', { name: 'Retry the call alert list' })).toBeTruthy()
    expect(screen.queryByTestId('terminal-tsrc-alert')).toBeNull()
    expect(screen.queryByTestId('terminal-tsrc-alert-notes')).toBeNull()
    expect(document.body.textContent).not.toContain('switched off')
  })

  it('no paid plan and signed out are said once, and a paywall has no retry', async () => {
    for (const [code, words, retry] of [
      [402, 'The call alert list needs a paid plan.', false],
      [401, 'You are signed out, so the call alert list cannot be read. Sign in again.', true],
    ]) {
      cleanup()
      serve({ GET: code })
      renderSave()
      const err = await screen.findByTestId('terminal-tsrc-alert-error')
      expect(err.textContent).toContain(words)
      expect(!!screen.queryByRole('button', { name: 'Retry the call alert list' }), String(code)).toBe(retry)
    }
  })
})

describe('TSRC call alert: the small print', () => {
  it('says how the member is told, what is not caught, and where the full list lives', async () => {
    serve()
    renderSave('margin', { notes: true })
    const notes = await screen.findByTestId('terminal-tsrc-alert-notes')
    const said = notes.textContent
    expect(said).toContain('at 6:30 PM ET, Monday to Friday')
    expect(said).toContain('rings the alert bell and sends one email to the address on your account, once per call')
    expect(said).toContain('older calls listed here never are')
    expect(said).toContain('more than one business day after its call is missed')
    expect(said).toContain('run NVDA TRAN, open Full transcript, and look under Search all transcripts.')
    expect(said).not.toMatch(/discord|push|instant/i)
    expect(document.body.textContent).not.toMatch(/[—–]/)
  })
})

describe('TSRC call alert: theme and accessibility', () => {
  it('the control and its model hold no hard-coded color', () => {
    for (const f of ['CallAlertSave.jsx', 'callAlertModel.js']) {
      const text = fs.readFileSync(path.join(HERE, f), 'utf8')
      expect(colourLiteralsIn(`pages/terminal/panels/${f}`, text).map((h) => h.lit), f).toEqual([])
    }
  })

  it('the save button with the small print passes axe (WCAG A and AA)', async () => {
    serve()
    renderSave('margin', { notes: true })
    await screen.findByTestId('terminal-tsrc-alert-notes')
    await expectNoAxeViolations(document.body.firstElementChild)
  }, 60_000)

  it('a saved search with a write result, and a failed write, pass axe', async () => {
    serve()
    renderSave('margin')
    await screen.findByTestId('terminal-tsrc-alert')
    await press()
    await outcome('saved')
    await expectNoAxeViolations(document.body.firstElementChild)
    serve({ DELETE: 500 })
    await press()
    await outcome('failed')
    await expectNoAxeViolations(document.body.firstElementChild)
  }, 60_000)

  it('a blocked search and a failed list read pass axe', async () => {
    serve()
    renderSave('AI')
    await screen.findByTestId('terminal-tsrc-alert-blocked')
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    serve({ GET: 500 })
    renderSave()
    await screen.findByTestId('terminal-tsrc-alert-error')
    await expectNoAxeViolations(document.body.firstElementChild)
  }, 60_000)
})

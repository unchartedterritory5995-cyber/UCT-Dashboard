// The "vs P&L" panel the routine and tracker blocks flip to (Notebook widgets phase 2, wave 9, Task 9.15). Asserted by
// RENDERED TEXT after the read has settled: a sentence a member cannot read is not a sentence.
//
// The server shapes are Task 9.7's (api/services/journal_two/routine_insights.py): a routine answers
// `{done, other, winRate: {done, other}, sentence}`, a tracker `{buckets: [{label, ...}], sentence}`, each group
// `{avg, n, sample: 'hide'|'small'|'', text}`; every sentence ends with "A comparison, not proof.".
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import VsPnlPanel, { CAVEAT, FAILED, SMALL_SAMPLE, winRateLine } from './VsPnlPanel'

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
const setOnline = (v) => Object.defineProperty(globalThis.navigator, 'onLine', { value: v, configurable: true })
const group = (n, avg, text, sample = n < 5 ? 'hide' : n < 20 ? 'small' : '') => ({ avg, n, sample, text })

/** The routine answer of the spec's own example (§16.2): 22 done days, 9 other days. */
const ROUTINE = {
  done: group(22, 95, '+$95 average (22 days)'),
  other: group(9, -40, '−$40 average (9 days)'),
  winRate: { done: group(22, 0.58, '58% win rate (22 days)'), other: group(9, 0.41, '41% win rate (9 days)') },
  sentence: 'On days you finished it: +$95 average (22 days). Other days: −$40 (9 days). A comparison, not proof.',
}
const TRACKER = {
  buckets: [
    { label: 'Under 6h', ...group(9, -210, '−$210 average (9 days)') },
    { label: '6h-8h', ...group(22, 95, '+$95 average (22 days)') },
    { label: 'Over 8h', ...group(0, null, 'No days with trades yet.') },
  ],
  sentence: 'Sleep under 6h: avg day −$210 (9 days); 6h-8h: +$95 (22 days). A comparison, not proof.',
}
const NO_DAYS_ROUTINE = {
  done: group(0, null, 'No days with trades yet.'), other: group(0, null, 'No days with trades yet.'),
  winRate: { done: group(0, null, 'No days with trades yet.'), other: group(0, null, 'No days with trades yet.') },
  sentence: 'No days with trades yet. A comparison, not proof.',
}

/** A fake vs P&L route: `answers` is a queue of [status, body]; the last one repeats. */
function serve(...answers) {
  const queue = answers.length ? answers : [[200, ROUTINE]]
  globalThis.fetch = vi.fn(async (url) => {
    const [status, body] = queue.length > 1 ? queue.shift() : queue[0]
    if (!/\/vs-pnl$/.test(url)) return json(404, {})
    return json(status, body)
  })
  return { gets: () => globalThis.fetch.mock.calls.filter(([u]) => /\/vs-pnl$/.test(u)).length }
}
const panel = (c) => c.querySelector('[data-vs-pnl]')
/** Every text node, SPACE-separated (textContent runs neighbouring nodes together and hides a 0 from \b). */
function textOf(el) {
  const out = []
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  while (w.nextNode()) out.push(w.currentNode.nodeValue)
  return out.join(' ')
}
const lastLine = (c) => [...panel(c).children].at(-1)
const count = (hay, needle) => hay.split(needle).length - 1

beforeEach(() => { setOnline(true) })
afterEach(() => { cleanup(); setOnline(true); vi.restoreAllMocks() })

describe('VsPnlPanel', () => {
  it('caveat_always_last_line', async () => {
    // Every state the panel can be in: a routine, a tracker, no days, not enough days, a failed read, and loading.
    const cases = [
      ['routine', [200, ROUTINE], 'On days you finished it: +$95 average (22 days). Other days: −$40 (9 days).'],
      ['tracker', [200, TRACKER], 'Sleep under 6h: avg day −$210 (9 days); 6h-8h: +$95 (22 days).'],
      ['routine', [200, NO_DAYS_ROUTINE], 'No days with trades yet.'],
      ['routine', [500, {}], FAILED],
    ]
    for (const [kind, answer, lead] of cases) {
      serve(answer)
      const { container, unmount } = render(<VsPnlPanel kind={kind} id="x1" />)
      await waitFor(() => expect(screen.getByText(lead)).toBeTruthy())
      expect(lastLine(container).textContent).toBe(CAVEAT)
      // Exactly once: the server's own trailing caveat is not said a second time.
      expect(count(panel(container).textContent, CAVEAT)).toBe(1)
      unmount()
    }
    // Loading, before the answer: the caveat is still the last line.
    let answer
    globalThis.fetch = vi.fn(() => new Promise((r) => { answer = r }))
    const { container } = render(<VsPnlPanel kind="routine" id="x1" />)
    await waitFor(() => expect(screen.getByText('Loading…')).toBeTruthy())
    expect(lastLine(container).textContent).toBe(CAVEAT)
    await act(async () => { answer(json(200, ROUTINE)) })
  })

  it('not_enough_days_and_no_days_copy', async () => {
    // Under 5 days the value is replaced by "Not enough days yet (3)"; none at all says "No days with trades yet."
    serve([200, {
      done: group(3, null, 'Not enough days yet (3)'), other: group(0, null, 'No days with trades yet.'),
      winRate: { done: group(3, null, 'Not enough days yet (3)'), other: group(0, null, 'No days with trades yet.') },
      sentence: 'On days you finished it: Not enough days yet (3). Other days: No days with trades yet. A comparison, not proof.',
    }])
    let r = render(<VsPnlPanel kind="routine" id="r1" />)
    await waitFor(() => expect(screen.getByText('On days you finished it: Not enough days yet (3)')).toBeTruthy())
    expect(screen.getByText('Other days: No days with trades yet.')).toBeTruthy()
    let text = textOf(panel(r.container))
    expect(text).not.toMatch(/\$/)                                   // no value is shown for too few days
    expect(text).not.toMatch(/\(0\)|\b0 days?\b|\b0%/)               // never "(0)", never a zero
    r.unmount()
    // No days at all: the one sentence and the caveat; no groups, no win rate, no zero anywhere.
    serve([200, NO_DAYS_ROUTINE])
    r = render(<VsPnlPanel kind="routine" id="r1" />)
    await waitFor(() => expect(screen.getByText('No days with trades yet.')).toBeTruthy())
    expect(r.container.querySelectorAll('[data-pnl-group]')).toHaveLength(0)
    expect(r.container.querySelector('[data-win-rate]')).toBeNull()
    text = textOf(panel(r.container))
    expect(text).not.toMatch(/\(0\)|\b0\b/)
    expect(text.trim()).toBe(`No days with trades yet. ${CAVEAT}`)
    r.unmount()
    // A tracker with no days: the same.
    serve([200, { buckets: [], sentence: `No days with trades yet. ${CAVEAT}` }])
    r = render(<VsPnlPanel kind="tracker" id="t1" />)
    await waitFor(() => expect(screen.getByText('No days with trades yet.')).toBeTruthy())
    expect(r.container.querySelectorAll('[data-pnl-group]')).toHaveLength(0)
    expect(textOf(panel(r.container))).not.toMatch(/\(0\)|\b0\b/)
  })

  it('small_badge', async () => {
    serve([200, TRACKER])
    const { container } = render(<VsPnlPanel kind="tracker" id="t1" />)
    await waitFor(() => expect(container.querySelectorAll('[data-pnl-group]')).toHaveLength(2))
    const [under, mid] = container.querySelectorAll('[data-pnl-group]')
    // 9 days: small. 22 days: none. A bucket with no days is not listed (the server's own sentence skips it).
    expect(under.textContent).toBe(`Under 6h: −$210 average (9 days)${SMALL_SAMPLE}`)
    expect(under.querySelector('[data-pnl-small]').textContent).toBe(SMALL_SAMPLE)
    expect(mid.textContent).toBe('6h-8h: +$95 average (22 days)')
    expect(mid.querySelector('[data-pnl-small]')).toBeNull()
    expect(container.textContent).not.toMatch(/Over 8h/)
    // 'hide' (under 5) is not "small": its value is already replaced by words.
    cleanup()
    serve([200, { ...ROUTINE, done: group(3, null, 'Not enough days yet (3)') }])
    const r = render(<VsPnlPanel kind="routine" id="r1" />)
    await waitFor(() => expect(r.container.querySelectorAll('[data-pnl-group]')).toHaveLength(2))
    const [done, other] = r.container.querySelectorAll('[data-pnl-group]')
    expect(done.querySelector('[data-pnl-small]')).toBeNull()
    expect(other.querySelector('[data-pnl-small]').textContent).toBe(SMALL_SAMPLE)
  })

  it('win_rate_pair', async () => {
    serve([200, ROUTINE])
    const { container, unmount } = render(<VsPnlPanel kind="routine" id="r1" />)
    await waitFor(() => expect(container.querySelector('[data-win-rate]')).toBeTruthy())
    expect(container.querySelector('[data-win-rate]').textContent)
      .toBe('Win rate on days you finished it: 58% (22 days). Other days: 41% (9 days).')
    // 9 decided days is a small sample: the pair carries the badge (beside it, never inside its sentence).
    expect(container.querySelector('[data-win-rate-row] [data-pnl-small]').textContent).toBe(SMALL_SAMPLE)
    unmount()
    // A side with too few days says so in the server's words; a single day is "1 day".
    expect(winRateLine({ done: group(1, null, 'Not enough days yet (1)'), other: group(30, 0.5, '50% win rate (30 days)') }))
      .toBe('Win rate on days you finished it: Not enough days yet (1). Other days: 50% (30 days).')
    expect(winRateLine({ done: group(0, null, 'No decided trades yet.'), other: group(30, 0.505, '51% win rate (30 days)') }))
      .toBe('Win rate on days you finished it: No decided trades yet. Other days: 51% (30 days).')
    // A tracker has no win-rate pair.
    serve([200, TRACKER])
    const t = render(<VsPnlPanel kind="tracker" id="t1" />)
    await waitFor(() => expect(t.container.querySelectorAll('[data-pnl-group]')).toHaveLength(2))
    expect(t.container.querySelector('[data-win-rate]')).toBeNull()
  })

  it('comparison_failure_retry_never_zero', async () => {
    // A 500, then an answer: the failure sentence and a Retry, no number at all; Retry reads once more and lands focus
    // on the panel.
    const srv = serve([500, {}], [200, ROUTINE])
    const { container } = render(<VsPnlPanel kind="routine" id="r1" />)
    await waitFor(() => expect(screen.getByText(FAILED)).toBeTruthy())
    expect(textOf(panel(container))).not.toMatch(/\d/)
    const retry = screen.getByRole('button', { name: 'Retry' })
    expect(retry.hasAttribute('disabled')).toBe(false)
    retry.focus()
    fireEvent.click(retry)
    await waitFor(() => expect(container.querySelector('[data-win-rate]')).toBeTruthy())
    expect(srv.gets()).toBe(2)
    expect(document.activeElement).toBe(panel(container))
    cleanup()
    // An answer without a sentence, and offline, are failures too (never an empty panel, never a zero).
    for (const setup of [() => serve([200, { done: group(22, 0, '$0 average (22 days)') }]), () => { serve([200, ROUTINE]); setOnline(false) }]) {
      setup()
      const r = render(<VsPnlPanel kind="routine" id="r1" />)
      await waitFor(() => expect(screen.getByText(FAILED)).toBeTruthy())
      expect(textOf(panel(r.container))).not.toMatch(/\d/)
      expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
      r.unmount()
      setOnline(true)
    }
  })

  it('a retry that is still on its way: the Retry is aria-disabled (never disabled) and a second press sends nothing', async () => {
    let answer
    let calls = 0
    globalThis.fetch = vi.fn(() => {
      calls += 1
      if (calls === 1) return Promise.resolve(json(500, {}))
      return new Promise((r) => { answer = r })
    })
    render(<VsPnlPanel kind="routine" id="r1" />)
    await waitFor(() => expect(screen.getByText(FAILED)).toBeTruthy())
    const retry = screen.getByRole('button', { name: 'Retry' })
    fireEvent.click(retry)
    await waitFor(() => expect(retry.getAttribute('aria-disabled')).toBe('true'))
    expect(retry.hasAttribute('disabled')).toBe(false)
    fireEvent.click(retry)
    expect(calls).toBe(2)
    await act(async () => { answer(json(200, ROUTINE)) })
    await waitFor(() => expect(screen.getByText('Win rate on days you finished it: 58% (22 days). Other days: 41% (9 days).')).toBeTruthy())
  })

  it('reads lazily: nothing while hidden, once when shown, never again for a hide and show, again for a new refresh key', async () => {
    const srv = serve([200, ROUTINE])
    const { container, rerender } = render(<VsPnlPanel kind="routine" id="r1" hidden />)
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    expect(srv.gets()).toBe(0)
    expect(panel(container).hasAttribute('hidden')).toBe(true)
    rerender(<VsPnlPanel kind="routine" id="r1" />)
    await waitFor(() => expect(container.querySelector('[data-win-rate]')).toBeTruthy())
    expect(srv.gets()).toBe(1)
    rerender(<VsPnlPanel kind="routine" id="r1" hidden />)
    rerender(<VsPnlPanel kind="routine" id="r1" />)
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    expect(srv.gets()).toBe(1)
    // A new refresh key while hidden waits for the panel to be shown; while shown, it reads at once, and the old
    // comparison stays on screen meanwhile (no "Loading…" flash).
    rerender(<VsPnlPanel kind="routine" id="r1" refreshKey="2" hidden />)
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    expect(srv.gets()).toBe(1)
    let answer
    globalThis.fetch = vi.fn(() => new Promise((r) => { answer = r }))
    rerender(<VsPnlPanel kind="routine" id="r1" refreshKey="2" />)
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('Loading…')).toBeNull()
    expect(container.querySelector('[data-win-rate]')).toBeTruthy()
    await act(async () => { answer(json(200, ROUTINE)) })
  })

  it('a stale answer for an older refresh key is dropped', async () => {
    const answers = []
    globalThis.fetch = vi.fn(() => new Promise((r) => { answers.push(r) }))
    const { rerender } = render(<VsPnlPanel kind="routine" id="r1" refreshKey="1" />)
    await waitFor(() => expect(answers).toHaveLength(1))
    rerender(<VsPnlPanel kind="routine" id="r1" refreshKey="2" />)
    await waitFor(() => expect(answers).toHaveLength(2))
    await act(async () => { answers[1](json(200, ROUTINE)) })
    await waitFor(() => expect(screen.getByText(/^Win rate on days/)).toBeTruthy())
    await act(async () => { answers[0](json(500, {})) })                     // the older read's failure lands last
    await act(async () => { await new Promise((r) => setTimeout(r, 10)) })
    expect(screen.queryByText(FAILED)).toBeNull()
    expect(screen.getByText(/^Win rate on days/)).toBeTruthy()
  })

  it('is one region with no live region of its own, and its CSS hides it when hidden and uses no --gain/--loss', () => {
    const css = readFileSync(join(__dirname, 'VsPnlPanel.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(css).toMatch(/\.panel\[hidden\]\s*\{\s*display:\s*none/)
    expect(css).not.toMatch(/--gain|--loss/)
    expect(css).not.toMatch(/outline:\s*var\(--focus-ring/)
    expect(css).toMatch(/\.tap\s*\{[^}]*min-height:\s*var\(--tap-min\)/)
    serve([200, ROUTINE])
    const { container } = render(<VsPnlPanel kind="routine" id="r1" />)
    expect(container.querySelectorAll('[role="status"], [aria-live]')).toHaveLength(0)
  })
})

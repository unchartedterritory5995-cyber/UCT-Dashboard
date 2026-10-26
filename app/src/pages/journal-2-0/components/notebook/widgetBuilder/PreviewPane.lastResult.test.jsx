// F-DEF-1 fix round 1, I-1 (ruling W11-R50, WCAG 1.4.1): a dimmed preview must never rely on opacity alone.
// Whenever the last good result is kept on screen under a failure (`failed`) or because no preview could be asked
// for (`stale`), or while such a kept preview is being retried, ONE sentence says so, beside the preview and on the
// phone summary bar. It is VISIBLE only (W11-R50b): the pane's one polite live region stays exactly as spec 5.11
// (the summary only), so a failure, a retry and its failure announce nothing new. A fresh preview shows none of it.
// Asserted by rendered text.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import PreviewPane, { ANNOUNCE_DELAY_MS } from './PreviewPane'
import { LAST_RESULT_SENTENCE } from '../../../lib/builtWidgets'

const SUMMARY = 'Net P&L: +$2,140.00 over 47 trades.'
const PAYLOAD = { view: 'number', empty: 'Nothing to draw here.', summary: SUMMARY, count: 47 }
const FAILED = { status: 'error', error: { code: 'busy', message: 'x' } }
const STALE = { status: 'ok', error: null, stale: true }
const FRESH = { status: 'ok', error: null }
const RETRYING = { status: 'loading', error: { code: 'busy', message: 'x' } }   // runPreview keeps the error

const flush = async (ms) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
const pane = (state, extra = {}) => render(
  <PreviewPane payload={PAYLOAD} name="Net P&L" unit="trades" onRetry={() => {}} onSuggestRange={() => {}}
    canSuggestRange={false} {...state} {...extra} />,
)

beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }) })
afterEach(() => { vi.useRealTimers() })

describe('I-1: "Showing the last result." whenever the preview is failed or stale', () => {
  it('the sentence is the one exported constant', () => {
    expect(LAST_RESULT_SENTENCE).toBe('Showing the last result.')
  })

  it.each([['failed', FAILED], ['stale', STALE], ['retrying a kept preview', RETRYING]])('%s: a visible line beside the dimmed preview', (_n, state) => {
    pane(state)
    const line = screen.getByText(LAST_RESULT_SENTENCE)
    expect(line).toBeVisible()
    // beside the dimmed preview, never inside it (it is not dimmed itself)
    expect(screen.getByTestId('builder-preview-view').contains(line)).toBe(false)
    expect(screen.getByTestId('builder-preview').contains(line)).toBe(true)
    // the ONE predicate also drives the dimming
    expect(screen.getByTestId('builder-preview-view').className).toMatch(/dimmed/)
  })

  it.each([['failed', FAILED], ['stale', STALE]])('%s: the one polite live region says the summary only (spec 5.11)', async (_n, state) => {
    pane(state)
    await flush(ANNOUNCE_DELAY_MS)
    const live = screen.getByTestId('builder-live')
    expect(live).toHaveAttribute('aria-live', 'polite')
    expect(live.textContent).toBe(SUMMARY)
    expect(document.querySelectorAll('[aria-live]')).toHaveLength(1)
  })

  it('error -> loading (retry, held) -> error: the live region announces nothing new; the line stays throughout', async () => {
    const { rerender } = pane(FAILED)
    await flush(ANNOUNCE_DELAY_MS)
    const live = screen.getByTestId('builder-live')
    const seen = [live.textContent]
    const props = { payload: PAYLOAD, name: 'Net P&L', unit: 'trades', onRetry: () => {}, onSuggestRange: () => {}, canSuggestRange: false }
    for (const state of [RETRYING, FAILED]) {
      rerender(<PreviewPane {...props} {...state} />)
      for (let t = 0; t < 4; t += 1) {
        await flush(ANNOUNCE_DELAY_MS / 2)
        seen.push(live.textContent)
        expect(screen.getByText(LAST_RESULT_SENTENCE)).toBeVisible()
      }
    }
    expect(new Set(seen)).toEqual(new Set([SUMMARY]))
  })

  it('phone, retrying a kept preview: the bar keeps the words and stays dimmed', () => {
    pane(RETRYING, { phone: true, keyboardOpen: false })
    const bar = screen.getByTestId('builder-summary-bar')
    expect(bar.textContent.startsWith(LAST_RESULT_SENTENCE)).toBe(true)
    expect(bar.querySelector('[class*="dimmed"]')).not.toBeNull()
  })

  it.each([['failed', FAILED], ['stale', STALE]])('phone, %s: the summary bar starts with the same words', (_n, state) => {
    pane(state, { phone: true, keyboardOpen: false })
    expect(screen.getByTestId('builder-summary-bar')).toHaveTextContent(new RegExp(`^${LAST_RESULT_SENTENCE.replace('.', '\\.')} Net P&L · 47 trades`))
  })

  it('CONTROL, fresh: no line, no prefix on the phone bar, and the live region says the summary alone', async () => {
    const { unmount } = pane(FRESH)
    expect(screen.queryByText(LAST_RESULT_SENTENCE)).toBeNull()
    await flush(ANNOUNCE_DELAY_MS)
    expect(screen.getByTestId('builder-live').textContent).toBe(SUMMARY)
    unmount()
    pane(FRESH, { phone: true, keyboardOpen: false })
    expect(screen.getByTestId('builder-summary-bar').textContent).not.toContain(LAST_RESULT_SENTENCE)
  })

  it('CONTROL, failed with no last result at all: nothing claims one is shown', () => {
    pane({ ...FAILED, payload: null })
    expect(screen.queryByText(LAST_RESULT_SENTENCE)).toBeNull()
  })

  it('CONTROL, a first load with no error kept: no line, not dimmed (busy is aria-busy, not a kept result)', () => {
    pane({ status: 'loading', error: null })
    expect(screen.queryByText(LAST_RESULT_SENTENCE)).toBeNull()
    expect(screen.getByTestId('builder-preview-view').className).not.toMatch(/dimmed/)
  })
})

// F-DEF-1 fix round 1, I-1 (ruling W11-R50, WCAG 1.4.1): a dimmed preview must never rely on opacity alone.
// Whenever the last good result is kept on screen under a failure (`failed`) or because no preview could be asked
// for (`stale`), ONE sentence says so, beside the preview and on the phone summary bar, and the pane's one polite
// live region carries it with the summary. A fresh preview shows none of it. Asserted by rendered text.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import PreviewPane, { ANNOUNCE_DELAY_MS } from './PreviewPane'
import { LAST_RESULT_SENTENCE } from '../../../lib/builtWidgets'

const SUMMARY = 'Net P&L: +$2,140.00 over 47 trades.'
const PAYLOAD = { view: 'number', empty: 'Nothing to draw here.', summary: SUMMARY, count: 47 }
const FAILED = { status: 'error', error: { code: 'busy', message: 'x' } }
const STALE = { status: 'ok', error: null, stale: true }
const FRESH = { status: 'ok', error: null }

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

  it.each([['failed', FAILED], ['stale', STALE]])('%s: a visible line beside the dimmed preview', (_n, state) => {
    pane(state)
    const line = screen.getByText(LAST_RESULT_SENTENCE)
    expect(line).toBeVisible()
    // beside the dimmed preview, never inside it (it is not dimmed itself)
    expect(screen.getByTestId('builder-preview-view').contains(line)).toBe(false)
    expect(screen.getByTestId('builder-preview').contains(line)).toBe(true)
  })

  it.each([['failed', FAILED], ['stale', STALE]])('%s: the one polite live region says it with the summary', async (_n, state) => {
    pane(state)
    await flush(ANNOUNCE_DELAY_MS)
    const live = screen.getByTestId('builder-live')
    expect(live).toHaveAttribute('aria-live', 'polite')
    expect(live.textContent).toBe(`${LAST_RESULT_SENTENCE} ${SUMMARY}`)
    expect(document.querySelectorAll('[aria-live]')).toHaveLength(1)
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
})

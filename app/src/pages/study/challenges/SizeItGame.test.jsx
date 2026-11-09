/**
 * Size It rails (docs/study/GAMES.md §1 rule 6): the start screen with its stakes and three steps; a right answer scores
 * on the multiplier and deals the next card at once; a miss takes over the screen with the mistake named, the right size
 * and why, then "See the working" opens the coach's card (the working in three steps and the rule) and "Next card" deals
 * on, the clock waiting from the miss to Next; the clock ends the run on the end screen with its log; the run reports
 * itself once to POST /api/study/game-runs (StrictMode too) and the level bar shows what the server granted; a refused or
 * malformed report leaves the end screen whole without the bar and says the XP did not save; an unmounted run reports
 * nothing. Time is faked, so the seed (Date.now() at start) and every card are known.
 */
import { StrictMode } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, within } from '@testing-library/react'

vi.mock('../../../components/study/StudyMark', () => ({ default: () => <span data-testid="mark" /> }))

import SizeItGame, { GAME } from './SizeItGame'
import { UICON_NAMES } from '../../../components/ui/UIcon'
import { LESSON, LESSON_SOURCE, ROUND_DOWN, cardAt, dollars, missTitle, pointsFor, price, riskPctText, runIdOf, sharesText, whyLine, working } from './games/sizeIt'

const SEED = 1731100000000
const tileFor = (value) => within(screen.getByTestId('size-choices')).getByRole('button', { name: sharesText(value) })   // exact: "20" never matches "20,000"
const flush = async () => { await act(async () => { for (let k = 0; k < 6; k++) await Promise.resolve() }) }
const okFetcher = (posts) => vi.fn(async (url, opts = {}) => {
  posts.push({ url, body: opts.body })
  return { xp_gained: 2, duplicate: false, progress: { xp_gained: 2, xp: 1002, level: 3 } }
})

function expectCard(c) {
  expect(screen.getByTestId('size-account')).toHaveTextContent(dollars(c.account))
  expect(screen.getByTestId('size-risk')).toHaveTextContent(riskPctText(c.riskBps))
  expect(screen.getByTestId('size-entry')).toHaveTextContent(price(c.entryCents))
  expect(screen.getByTestId('size-stop')).toHaveTextContent(price(c.stopCents))
  const labels = within(screen.getByTestId('size-choices')).getAllByRole('button').map((b) => b.textContent)
  expect(labels).toHaveLength(4)
  c.choices.forEach((x, k) => expect(labels[k]).toContain(sharesText(x.value)))
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(SEED); localStorage.clear() })
afterEach(() => { cleanup(); vi.useRealTimers(); localStorage.clear() })

describe('SizeItGame', () => {
  it('registers itself with a real icon, one of the landing accents and the skill group', () => {
    expect(GAME).toEqual({ kind: 'size', title: 'Size It', sub: expect.any(String), icon: 'scale', plate: 'Size', accent: 'gold', group: 'skill' })
    expect(UICON_NAMES).toContain(GAME.icon)
    expect(['amber', 'red', 'gold', 'green']).toContain(GAME.accent)
    expect(GAME.sub).not.toMatch(/[—–]|\bfirm\b/i)
  })

  it('opens on the start arena: the stakes, the rule, the three steps and the best score', () => {
    localStorage.setItem('study.size.best', '140')
    render(<SizeItGame fetcher={okFetcher([])} />)
    const intro = screen.getByTestId('size-intro')
    expect(intro).toHaveTextContent('Size It')
    expect(intro).toHaveTextContent('60seconds')
    expect(intro).toHaveTextContent('2%max risk')
    expect(intro).toHaveTextContent('x5top multiplier')
    expect(intro).toHaveTextContent(LESSON)
    expect(screen.getByTestId('size-best')).toHaveTextContent('140')
    const how = screen.getByTestId('size-howto')
    expect(how.querySelectorAll('li')).toHaveLength(3)
    for (const t of ['Read the card', 'Size it', 'Build the multiplier']) expect(how).toHaveTextContent(t)
    expect(intro.textContent).not.toMatch(/[—–]|the firm/i)
    expect(screen.getByTestId('size-start')).not.toBeDisabled()
  })

  it('plays a run: right scores on the multiplier, a miss takes over then shows the working, the clock waits, time ends it and reports once', async () => {
    const posts = []
    const onClose = vi.fn()
    render(<SizeItGame fetcher={okFetcher(posts)} onClose={onClose} />)
    fireEvent.keyDown(window, { key: 'Enter' })                                         // Enter starts the clock
    expect(screen.getByTestId('size-play')).toBeInTheDocument()
    expect(screen.getByTestId('blitz-clock')).toHaveTextContent('60s left')

    // card 1: the right size, tapped
    const c0 = cardAt(SEED, 0)
    expectCard(c0)
    expect(screen.getByTestId('size-card')).toHaveAttribute('data-level', 'easy')
    fireEvent.click(tileFor(c0.shares))
    expect(screen.getByTestId('blitz-score')).toHaveTextContent(String(pointsFor(1)))
    expect(screen.queryByTestId('size-takeover')).toBeNull()

    // card 2 comes at once; a named mistake, picked by its number key
    const c1 = cardAt(SEED, 1)
    expectCard(c1)
    const k = c1.choices.findIndex((x) => x.mistake)
    const wrong = c1.choices[k]
    act(() => { vi.advanceTimersByTime(3000) })
    expect(screen.getByTestId('blitz-clock')).toHaveTextContent('57s left')
    fireEvent.keyDown(window, { key: String(k + 1) })

    // the takeover: the mistake named, the right size, and why; no more than fits a phone (the working waits below)
    const tk = screen.getByTestId('size-takeover')
    expect(tk).toHaveAttribute('data-correct', '0')
    expect(tk).toHaveTextContent(missTitle(c1, wrong.value))
    expect(tk).toHaveTextContent(`${sharesText(c1.shares)} shares`)
    expect(screen.getByTestId('size-takeover-why')).toHaveTextContent(whyLine(c1, wrong.value))
    expect(within(tk).queryByTestId('size-working')).toBeNull()
    expect(screen.getByTestId('size-takeover-go')).toHaveTextContent('See the working')
    expect(screen.getByTestId('blitz-score')).toHaveTextContent(String(pointsFor(1)))   // a miss scores nothing
    expect(screen.queryByTestId('size-choices')).toBeNull()                            // no tile to press under it

    // the clock waits while the verdict holds the screen, and a number key does nothing
    act(() => { vi.advanceTimersByTime(10000) })
    expect(screen.getByTestId('blitz-clock')).toHaveTextContent('57s left')
    fireEvent.keyDown(window, { key: '1' })
    expect(screen.getByTestId('size-takeover')).toBeInTheDocument()

    // Enter opens the working (once: Next does not fire on the same press)
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(screen.queryByTestId('size-takeover')).toBeNull()
    const review = screen.getByTestId('size-review')
    expect(review).toHaveTextContent(missTitle(c1, wrong.value))
    expect(review).toHaveTextContent(`The answer was ${sharesText(c1.shares)} shares · you said ${sharesText(wrong.value)}`)
    const work = screen.getByTestId('size-working')
    expect(work).toHaveTextContent(`How to get ${sharesText(c1.shares)} shares`)
    expect(screen.getByTestId('size-why')).toHaveTextContent(whyLine(c1, wrong.value))
    const steps = working(c1)
    expect(steps[0].text).toMatch(/^Risk \$[\d,.]+ = \$[\d,]+ × [\d.]+%\.$/)
    expect(steps[1].text).toMatch(/^Per share \$[\d,.]+ = \$[\d,.]+ − \$[\d,.]+\.$/)
    for (const st of steps) expect(screen.getByTestId(`size-step-${st.key}`)).toHaveTextContent(st.text)
    expect(work).toHaveTextContent(`${LESSON} ${ROUND_DOWN}`)
    expect(work).toHaveTextContent(LESSON_SOURCE)
    expect(screen.getByTestId('size-card')).toBeInTheDocument()                       // the card stays up beside its working

    // still waiting while the working is read
    act(() => { vi.advanceTimersByTime(10000) })
    expect(screen.getByTestId('blitz-clock')).toHaveTextContent('57s left')
    expect(review.textContent).not.toMatch(/[—–]|the firm|NaN|undefined/i)

    // Enter (Next card's own) deals card 3 and the clock runs again
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(screen.queryByTestId('size-review')).toBeNull()
    expectCard(cardAt(SEED, 2))
    act(() => { vi.advanceTimersByTime(56000) })
    expect(screen.getByTestId('blitz-clock')).toHaveTextContent('1s left')
    expect(posts).toHaveLength(0)
    act(() => { vi.advanceTimersByTime(1000) })

    // the end screen, the run's log, the slip it made, and one report
    expect(screen.getByTestId('size-done')).toBeInTheDocument()
    expect(screen.getByTestId('size-right')).toHaveTextContent('1/2')
    const log = screen.getByTestId('run-log')
    const cards = within(log).getAllByRole('listitem')
    expect(cards).toHaveLength(2)
    expect(cards[0]).toHaveTextContent(`${sharesText(c0.shares)} shares`)
    expect(cards[1]).toHaveTextContent(`you said ${sharesText(wrong.value)}`)
    expect(screen.getByTestId('size-slip')).toHaveTextContent('Your most common slip:')
    expect(screen.getByTestId('size-best-line')).toHaveTextContent('A new best.')
    expect(localStorage.getItem('study.size.best')).toBe(String(pointsFor(1)))
    await flush()
    expect(posts).toEqual([{ url: '/api/study/game-runs', body: { kind: 'size', run_id: runIdOf(SEED, 1), right: 1, total: 2 } }])
    expect(screen.getByTestId('size-level')).toHaveTextContent('+2 XP this run')
    expect(screen.queryByTestId('size-not-saved')).toBeNull()
    expect(screen.getByTestId('size-done').textContent).not.toMatch(/[—–]|the firm|NaN|undefined/i)

    // Back to Study closes; Again returns to the arena, and nothing is reported twice
    fireEvent.click(screen.getByRole('button', { name: /Back to Study/ }))
    expect(onClose).toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('size-again'))
    expect(screen.getByTestId('size-intro')).toBeInTheDocument()
    await flush()
    expect(posts).toHaveLength(1)
  })

  it('plays the miss by mouse too: See the working, then Next card', () => {
    render(<SizeItGame fetcher={okFetcher([])} />)
    fireEvent.click(screen.getByTestId('size-start'))
    const c0 = cardAt(SEED, 0)
    fireEvent.click(tileFor(c0.choices.find((x) => x.mistake).value))
    fireEvent.click(screen.getByTestId('size-takeover-go'))
    expect(screen.getByTestId('size-working')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('size-next'))
    expectCard(cardAt(SEED, 1))
    expect(screen.getByTestId('blitz-clock')).toHaveTextContent('60s left')            // the miss cost no time
  })

  it('reports exactly once under StrictMode, with every timer and key handler doubled and cleaned', async () => {
    const posts = []
    render(<StrictMode><SizeItGame fetcher={okFetcher(posts)} /></StrictMode>)
    fireEvent.click(screen.getByTestId('size-start'))
    fireEvent.keyDown(window, { key: String(cardAt(SEED, 0).choices.findIndex((x) => x.mistake == null) + 1) })
    expect(screen.getByTestId('blitz-score')).toHaveTextContent(String(pointsFor(1)))   // one key, one answer
    act(() => { vi.advanceTimersByTime(10000) })
    expect(screen.getByTestId('blitz-clock')).toHaveTextContent('50s left')             // one clock, not two
    act(() => { vi.advanceTimersByTime(50000) })
    await flush()
    expect(screen.getByTestId('size-done')).toBeInTheDocument()
    expect(posts).toHaveLength(1)
    expect(screen.getByTestId('size-level')).toBeInTheDocument()
  })

  it('shows the end screen whole without the level bar when the report fails, and says so when signed out', async () => {
    const fail = vi.fn(async () => { const e = new Error('POST /api/study/game-runs answered 401'); e.status = 401; throw e })
    render(<SizeItGame fetcher={fail} signedOut={<a data-testid="sign-in" href="/login">Sign in</a>} />)
    fireEvent.click(screen.getByTestId('size-start'))
    fireEvent.click(tileFor(cardAt(SEED, 0).shares))
    act(() => { vi.advanceTimersByTime(60000) })
    await flush()
    expect(fail).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('size-done')).toBeInTheDocument()
    expect(screen.getByTestId('size-right')).toHaveTextContent('1/1')
    expect(screen.queryByTestId('size-level')).toBeNull()
    expect(screen.getByTestId('size-not-saved')).toHaveTextContent('You are signed out, so this run\'s XP did not save.')
    expect(screen.getByTestId('sign-in')).toBeInTheDocument()
  })

  it('says the XP did not save on a server error or a malformed answer, and a run with no answers reports nothing', async () => {
    for (const fetcher of [vi.fn(async () => { const e = new Error('500'); e.status = 500; throw e }), vi.fn(async () => ({})), vi.fn(() => { throw new Error('offline') })]) {
      vi.setSystemTime(SEED)                                                             // each run seeds from the same clock
      render(<SizeItGame fetcher={fetcher} />)
      fireEvent.click(screen.getByTestId('size-start'))
      const c0 = cardAt(SEED, 0)
      fireEvent.click(tileFor(c0.choices.find((x) => x.mistake).value))
      fireEvent.click(screen.getByTestId('size-takeover-go'))
      fireEvent.click(screen.getByTestId('size-next'))
      act(() => { vi.advanceTimersByTime(60000) })
      await flush()
      expect(fetcher).toHaveBeenCalledTimes(1)
      expect(screen.getByTestId('size-done')).toBeInTheDocument()
      expect(screen.queryByTestId('size-level')).toBeNull()
      expect(screen.getByTestId('size-not-saved')).toHaveTextContent('This run\'s XP did not save.')
      expect(screen.getByTestId('size-best-line')).toHaveTextContent('Your best stands at')
      cleanup()
    }

    const quiet = vi.fn()
    render(<SizeItGame fetcher={quiet} />)
    fireEvent.click(screen.getByTestId('size-start'))
    act(() => { vi.advanceTimersByTime(60000) })
    await flush()
    expect(screen.getByTestId('size-done')).toBeInTheDocument()
    expect(screen.getByTestId('size-slip')).toHaveTextContent('Every card is one rule')
    expect(screen.queryByTestId('size-not-saved')).toBeNull()
    expect(quiet).not.toHaveBeenCalled()
  })

  it('closed mid-run, it stops its clock and its keys and reports nothing', async () => {
    const posts = []
    const { unmount } = render(<SizeItGame fetcher={okFetcher(posts)} />)
    fireEvent.click(screen.getByTestId('size-start'))
    fireEvent.click(tileFor(cardAt(SEED, 0).shares))
    unmount()
    act(() => { vi.advanceTimersByTime(120000) })
    fireEvent.keyDown(window, { key: '1' })
    await flush()
    expect(posts).toHaveLength(0)
    expect(vi.getTimerCount()).toBe(0)
  })
})

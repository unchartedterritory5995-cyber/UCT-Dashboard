/**
 * True or False rails (docs/study/GAMES.md §1 rule 6): the start arena with its stakes, its three steps and the draw;
 * a right call scored on the server (POST /api/study/attempts) and on the multiplier, the next statement at once; a miss
 * that takes over the screen with the answer, the reason and its source, moving on by itself after 2.5 seconds (longer for a longer reason) or on a
 * tap, the clock waiting while it shows and while an answer is on the wire; the end screen listing every statement with
 * the answer, the member's call, the lesson line and the source; the XP from the attempts on the level bar and never a
 * game run posted; a thin, failed, refused or silent draw shown honestly with a way back; an answer that never reaches
 * the server not counted; StrictMode and an unmount mid-run. Time is faked, so the seed (Date.now() at start) and the
 * deal are known.
 */
import { StrictMode } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, within } from '@testing-library/react'

vi.mock('../../../components/study/StudyMark', () => ({ default: () => <span data-testid="mark" /> }))

import TrueFalseGame, { GAME } from './TrueFalseGame'
import { UICON_NAMES } from '../../../components/ui/UIcon'
import { FALSE, TF_POOL_URL, TF_TAKEOVER_GUARD_MS, TF_TAKEOVER_MAX_MS, TRUE, deckOf, takeoverMs, leanLine, lessonLineOf, otherOf, reasonOf, shortSource, statementsOf, verdictTitle } from './games/trueFalse'

const SEED = 1731100000000
const ATTEMPTS = '/api/study/attempts'
const SRC = (name) => ({ name, url: 'https://www.investor.gov/page', quote: 'quoted text' })
const BANK = [
  { id: 'si_t1', q: 'A company can cut its dividend, or stop paying one altogether.', key: TRUE,
    why: "True. A company may pay dividends, but it doesn't have to. The amount isn't guaranteed.", line: 'You own the business, not a promised check. Dividends can change or stop.',
    source: 'SEC, Investor.gov: Dividends (Investor Bulletin, 2024)' },
  { id: 'si_f1', q: 'When you buy SPY, you are buying the S&P 500 index itself.', key: FALSE,
    why: "False. You can't invest directly in an index. A SPY share is ownership in a fund that aims to match the S&P 500.", line: 'SPY is the fund. The S&P 500 is the scoreboard it follows.',
    source: 'SEC, Investor.gov: Index Funds (August 2024)' },
  { id: 'si_f2', q: "Your broker can get the locate after your short sale goes through, as long as it's the same day.", key: FALSE,
    why: 'False. The locate must be made and documented before the short sale, not after.', line: 'The locate comes first. Then the short.',
    source: 'FINRA: Regulation SHO (2023)' },
  { id: 'si_t2', q: 'Your SPY order can be filled somewhere other than NYSE Arca, the exchange SPY lists on.', key: TRUE,
    why: "True. Your broker decides where the order goes: SPY's own exchange, another exchange, or a market maker.", line: 'Where a stock lists and where your order fills are two different things.',
    source: 'SEC, Investor.gov: Executing an Order' },
  { id: 'si_f3', q: 'Heavy short interest means a short squeeze is coming.', key: FALSE,
    why: "False. Heavy short interest means many people think the price will fall. It doesn't mean it will rise.", line: "Short interest is a crowd, not a catalyst. I'd want a real reason to own it.",
    source: 'SEC, Investor.gov: Short Sales' },
  { id: 'si_f4', q: 'Once you have a good trading plan, you can stop reviewing your trades.', key: FALSE,
    why: 'False. Frequent review is part of becoming a good trader, and a plan needs refining as markets change.', line: 'A plan is where you start. The review keeps it current.',
    source: 'CME Group: Building a Trade Plan, Step 5: Keep a Trade Log (CME Group education course)' },
]
const BY_ID = Object.fromEntries(BANK.map((b) => [b.id, b]))
const itemOf = (b) => ({ id: b.id, version: 1, type: 'recall', skill_id: 'basics.shares', module: 'F1', difficulty: 1, prompt_json: { q: b.q, kind: 'tf', choices: ['True', 'False'] }, tier_scale_id: null, has_chart: false })
const ITEMS = BANK.map(itemOf)
const revealOf = (b) => ({ unit: 'F1.02', why: b.why, lesson_line: b.line, facts: {}, depth: { summary: '', sources: [SRC(b.source)] }, answer: { answer: b.key }, lesson: `${b.why} ${b.line}`, ref: 'abc123' })

const flush = async () => { await act(async () => { for (let k = 0; k < 12; k++) await Promise.resolve() }) }
const tick = (ms) => act(() => { vi.advanceTimersByTime(ms) })
const shown = () => BANK.find((b) => b.q === screen.getByTestId('tf-statement').textContent)
const tile = (label) => within(screen.getByTestId('tf-choices')).getByRole('button', { name: label })
const keyFor = (choice) => (choice === TRUE ? 't' : 'f')

/** The server: the pool, and each attempt scored against the bank's key with the XP it grants. */
function bankFetcher({ items = ITEMS, attempt = null } = {}) {
  const calls = []
  let xp = 990
  const fn = vi.fn(async (url, opts = {}) => {
    calls.push({ url, body: opts.body })
    if (url === TF_POOL_URL) return { kind: 'tf', items }
    if (url === ATTEMPTS) {
      if (attempt) { const out = attempt(opts.body, calls.filter((c) => c.url === ATTEMPTS).length); if (out !== undefined) return out }
      const b = BY_ID[opts.body.item_id]
      const correct = opts.body.answer.choice === b.key
      const gained = correct ? 10 : 2
      xp += gained
      return { attempt_id: calls.length, item_id: b.id, correct, score: correct ? 1 : 0, unscored: false, reveal: revealOf(b), progress: { xp_gained: gained, xp, level: 3, streak: 1, badges_new: [] }, skill: {} }
    }
    throw new Error(`unexpected ${url}`)
  })
  fn.calls = calls
  return fn
}

async function startRun(fetcher, props = {}) {
  const view = render(<TrueFalseGame fetcher={fetcher} {...props} />)
  await flush()
  fireEvent.click(screen.getByTestId('tf-start'))
  return view
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(SEED); localStorage.clear() })
afterEach(() => { cleanup(); vi.useRealTimers(); localStorage.clear() })

describe('TrueFalseGame', () => {
  it('registers itself with a real icon, one of the landing accents and the skill group', () => {
    expect(GAME).toEqual({ kind: 'tf', title: 'True or False', sub: expect.any(String), icon: 'check', plate: 'True/False', accent: 'green', group: 'skill' })
    expect(UICON_NAMES).toContain(GAME.icon)
    expect(['amber', 'red', 'gold', 'green']).toContain(GAME.accent)
    expect(GAME.sub).not.toMatch(/[—–]|\bfirm\b/i)
  })

  it('opens on the start arena: the stakes, the three steps, the best score and the draw it asked for', async () => {
    localStorage.setItem('study.tf.best', '170')
    const fetcher = bankFetcher()
    render(<TrueFalseGame fetcher={fetcher} />)
    expect(screen.getByTestId('tf-start')).toBeDisabled()                            // the draw is still loading
    expect(screen.getByTestId('tf-start')).toHaveTextContent('Loading the statements')
    await flush()
    expect(fetcher.calls).toEqual([{ url: TF_POOL_URL, body: { kind: 'tf', size: 40 } }])
    const intro = screen.getByTestId('tf-intro')
    expect(intro).toHaveTextContent('True or False')
    expect(intro).toHaveTextContent('45seconds')
    expect(intro).toHaveTextContent('Allcourses')
    expect(intro).toHaveTextContent('x5top multiplier')
    expect(screen.getByTestId('tf-best')).toHaveTextContent('170')
    expect(screen.getByTestId('tf-pool-line')).toHaveTextContent('6 statements in this draw')
    const how = screen.getByTestId('tf-howto')
    expect(how.querySelectorAll('li')).toHaveLength(3)
    for (const t of ['Read the statement', 'Call it', 'Build the multiplier']) expect(how).toHaveTextContent(t)
    expect(intro.textContent).not.toMatch(/[—–]|the firm/i)
    expect(screen.getByTestId('tf-start')).not.toBeDisabled()
    expect(screen.getByTestId('tf-start')).toHaveTextContent('Start the clock')
  })

  it('plays a run: a right call scores at once, a miss takes over and teaches, the clock waits, time ends it with the run log and the XP', async () => {
    const fetcher = bankFetcher()
    const onClose = vi.fn()
    render(<TrueFalseGame fetcher={fetcher} onClose={onClose} />)
    await flush()
    fireEvent.keyDown(window, { key: 'Enter' })                                          // Enter starts the clock
    expect(screen.getByTestId('tf-play')).toBeInTheDocument()
    expect(screen.getByTestId('blitz-clock')).toHaveTextContent('45s left')
    const deck = deckOf(statementsOf(ITEMS), SEED)
    expect(screen.getByTestId('tf-statement')).toHaveTextContent(deck[0].q)
    expect(screen.getByTestId('tf-card')).toHaveTextContent('Statement 1')

    // statement 1: the right call, by its key; the clock waits while the answer is on the wire
    const s1 = shown()
    fireEvent.keyDown(window, { key: keyFor(s1.key) })
    expect(screen.getByTestId('tf-play')).toHaveAttribute('data-state', 'checking')
    tick(3000)
    expect(screen.getByTestId('blitz-clock')).toHaveTextContent('45s left')
    await flush()
    const posted = fetcher.calls.filter((c) => c.url === ATTEMPTS)
    expect(posted).toHaveLength(1)
    expect(posted[0].body).toEqual({ item_id: s1.id, answer: { choice: s1.key }, time_ms: 0 })
    expect(screen.getByTestId('blitz-score')).toHaveTextContent('20')
    expect(screen.queryByTestId('tf-takeover')).toBeNull()
    expect(screen.getByTestId('tf-statement')).toHaveTextContent(deck[1].q)            // the next one, at once

    // two seconds of thinking cost two seconds
    tick(2000)
    expect(screen.getByTestId('blitz-clock')).toHaveTextContent('43s left')

    // statement 2: the wrong tile; the answer takes over with the reason in the bank's words and its source
    const s2 = shown()
    fireEvent.click(tile(otherOf(s2.key)))
    await flush()
    const tk = screen.getByTestId('tf-takeover')
    expect(tk).toHaveAttribute('data-correct', '0')
    expect(tk).toHaveTextContent(verdictTitle(s2.key))
    expect(screen.getByTestId('tf-takeover-why')).toHaveTextContent(reasonOf(revealOf(s2)))
    expect(screen.getByTestId('tf-takeover-why').textContent).not.toMatch(/^(True|False)\./)
    expect(screen.getByTestId('tf-takeover-source')).toHaveTextContent(shortSource(s2.source))
    expect(screen.getByTestId('tf-takeover-go')).toHaveTextContent('Next statement')
    expect(screen.getByTestId('blitz-score')).toHaveTextContent('20')                   // a miss scores nothing
    expect(tk.textContent).not.toMatch(/[—–]|the firm|NaN|undefined/i)

    // the clock waits while it shows, and a call key does nothing under it
    const hold = takeoverMs(screen.queryByTestId('tf-takeover-why')?.textContent)
    expect(hold).toBeGreaterThanOrEqual(2500)
    tick(2000)
    expect(screen.getByTestId('blitz-clock')).toHaveTextContent('43s left')
    fireEvent.keyDown(window, { key: 't' })
    expect(fetcher.calls.filter((c) => c.url === ATTEMPTS)).toHaveLength(2)
    expect(screen.getByTestId('tf-takeover')).toBeInTheDocument()
    // it holds as long as its reason takes to read (2.5 seconds at least), then moves on by itself, once
    tick(hold - 2001)
    expect(screen.getByTestId('tf-takeover')).toBeInTheDocument()
    tick(1)
    expect(screen.queryByTestId('tf-takeover')).toBeNull()
    expect(screen.getByTestId('tf-statement')).toHaveTextContent(deck[2].q)
    expect(screen.getByTestId('blitz-clock')).toHaveTextContent('43s left')

    // statement 3: the wrong key; a second tap the moment it shows is a stray one and never skips the lesson, a tap after
    // that moves on at once
    const s3 = shown()
    fireEvent.keyDown(window, { key: keyFor(otherOf(s3.key)) })
    await flush()
    expect(screen.getByTestId('tf-takeover')).toHaveTextContent(verdictTitle(s3.key))
    fireEvent.click(screen.getByTestId('tf-takeover'))
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(screen.getByTestId('tf-takeover')).toBeInTheDocument()
    tick(TF_TAKEOVER_GUARD_MS)
    fireEvent.click(screen.getByTestId('tf-takeover'))
    expect(screen.queryByTestId('tf-takeover')).toBeNull()
    expect(screen.getByTestId('tf-statement')).toHaveTextContent(deck[3].q)
    tick(3000)                                                                           // the auto move was cancelled
    expect(screen.getByTestId('tf-statement')).toHaveTextContent(deck[3].q)
    expect(screen.getByTestId('blitz-clock')).toHaveTextContent('40s left')

    // statement 4: right, by the number key
    const s4 = shown()
    fireEvent.keyDown(window, { key: s4.key === TRUE ? '1' : '2' })
    await flush()
    expect(screen.getByTestId('blitz-score')).toHaveTextContent('40')
    expect(screen.getByTestId('tf-statement')).toHaveTextContent(deck[4].q)

    // time ends the run
    tick(39900)
    expect(screen.getByTestId('blitz-clock')).toHaveTextContent('1s left')
    tick(100)
    const done = screen.getByTestId('tf-done')
    tick(2000)                                                                           // the points count up
    expect(screen.getByTestId('tf-right')).toHaveTextContent('2/4')
    expect(screen.getByTestId('tf-xp')).toHaveTextContent('+40 points')
    expect(done).toHaveTextContent('Tough run')

    // every statement with the answer, the member's call, the lesson line and the source
    const cards = within(screen.getByTestId('run-log')).getAllByRole('listitem')
    expect(cards).toHaveLength(4)
    const played = [[s1, s1.key], [s2, otherOf(s2.key)], [s3, otherOf(s3.key)], [s4, s4.key]]
    played.forEach(([b, said], k) => {
      expect(cards[k]).toHaveTextContent(b.q)
      expect(cards[k]).toHaveTextContent(`Answer ${b.key}`)
      expect(cards[k]).toHaveTextContent(`You said ${said}`)
      expect(cards[k]).toHaveTextContent(lessonLineOf(revealOf(b)))
      const link = within(cards[k]).getByRole('link', { name: shortSource(b.source) })
      expect(link).toHaveAttribute('href', 'https://www.investor.gov/page')
      expect(link).toHaveAttribute('target', '_blank')
    })
    expect(screen.getByTestId('tf-lean')).toHaveTextContent(leanLine([{ ok: false, said: otherOf(s2.key) }, { ok: false, said: otherOf(s3.key) }, { ok: true }, { ok: true }]))

    // the XP the four attempts earned fills the level bar; nothing is posted as a game run
    expect(screen.getByTestId('tf-level')).toHaveTextContent('+24 XP this run')
    expect(fetcher.calls.filter((c) => c.url === '/api/study/game-runs')).toHaveLength(0)
    expect(fetcher.calls.filter((c) => c.url === ATTEMPTS)).toHaveLength(4)
    expect(screen.getByTestId('tf-best-line')).toHaveTextContent('A new best.')
    expect(localStorage.getItem('study.tf.best')).toBe('40')
    expect(done.textContent).not.toMatch(/[—–]|the firm|NaN|undefined/i)

    // Back to Study closes; Again returns to the arena on a fresh draw
    fireEvent.click(screen.getByRole('button', { name: /Back to Study/ }))
    expect(onClose).toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('tf-again'))
    await flush()
    expect(screen.getByTestId('tf-intro')).toBeInTheDocument()
    expect(fetcher.calls.filter((c) => c.url === TF_POOL_URL)).toHaveLength(2)
  })

  it('ends when the draw runs out, every call right', async () => {
    const fetcher = bankFetcher({ items: ITEMS.slice(0, 5) })
    await startRun(fetcher)
    for (let k = 0; k < 5; k++) {
      fireEvent.click(tile(shown().key))
      await flush()
    }
    expect(screen.getByTestId('tf-done')).toHaveTextContent('Every call right')
    tick(2000)
    expect(screen.getByTestId('tf-right')).toHaveTextContent('5/5')
    expect(screen.getByTestId('tf-deck-out')).toHaveTextContent('You called every statement in this draw.')
    expect(screen.getByTestId('tf-lean')).toHaveTextContent('No misses.')
    expect(screen.getByTestId('tf-xp')).toHaveTextContent('+130 points')                // 20 + 20 + 30 + 30 + 30 (x2, x2, x3, x3, x3)
  })

  it('says so honestly when the draw is thin or empty, with a way back', async () => {
    for (const items of [ITEMS.slice(0, 4), [], null]) {
      const onClose = vi.fn()
      render(<TrueFalseGame fetcher={bankFetcher({ items })} onClose={onClose} />)
      await flush()
      const empty = screen.getByTestId('tf-empty')
      expect(screen.getByTestId('tf-empty-line')).toHaveTextContent('No questions in this game yet. They arrive as the courses are approved.')
      expect(screen.getByTestId('tf-start')).toBeDisabled()
      expect(screen.getByTestId('tf-start')).toHaveTextContent('No statements yet')
      fireEvent.keyDown(window, { key: 'Enter' })
      expect(screen.queryByTestId('tf-play')).toBeNull()
      expect(empty.textContent).not.toMatch(/[—–]|the firm/i)
      fireEvent.click(screen.getByTestId('tf-back'))
      expect(onClose).toHaveBeenCalledTimes(1)
      cleanup()
    }
  })

  it('shows a failed draw with a retry and a way back, and a draw that never answers fails instead of spinning', async () => {
    let fail = true
    const fetcher = vi.fn(async (url) => {
      if (fail) { const e = new Error('500'); e.status = 500; throw e }
      return { kind: 'tf', items: url === TF_POOL_URL ? ITEMS : [] }
    })
    const onClose = vi.fn()
    render(<TrueFalseGame fetcher={fetcher} onClose={onClose} />)
    await flush()
    expect(screen.getByTestId('tf-failed')).toHaveTextContent("Couldn't load the True or False statements.")
    fireEvent.click(screen.getByTestId('tf-back'))
    expect(onClose).toHaveBeenCalledTimes(1)
    fail = false
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }))
    await flush()
    expect(screen.getByTestId('tf-intro')).toBeInTheDocument()
    cleanup()

    render(<TrueFalseGame fetcher={vi.fn(() => new Promise(() => {}))} onClose={onClose} />)
    await flush()
    expect(screen.getByTestId('tf-start')).toHaveTextContent('Loading the statements')
    tick(15000)
    expect(screen.getByTestId('tf-failed')).toBeInTheDocument()
    cleanup()

    const out = vi.fn(async () => { const e = new Error('401'); e.status = 401; throw e })
    render(<TrueFalseGame fetcher={out} signedOut={<a data-testid="sign-in" href="/login">Sign in</a>} />)
    await flush()
    expect(screen.getByTestId('sign-in')).toBeInTheDocument()
  })

  it('does not count an answer that never reaches the server, and stops after three in a row', async () => {
    const down = (body, n) => { if (n <= 4) { const e = new Error('500'); e.status = 500; throw e } }
    // the first call hangs past the timeout; the next three fail outright
    const fetcher = bankFetcher({ attempt: (body, n) => (n === 1 ? new Promise(() => {}) : down(body, n)) })
    await startRun(fetcher)
    const deck = deckOf(statementsOf(ITEMS), SEED)
    fireEvent.click(tile(TRUE))
    tick(8000)                                                                           // the answer took too long
    await flush()
    expect(screen.getByTestId('tf-note')).toHaveTextContent('We could not check that one, so it does not count.')
    expect(screen.getByTestId('tf-statement')).toHaveTextContent(deck[1].q)
    expect(screen.getByTestId('blitz-clock')).toHaveTextContent('45s left')            // the wait cost nothing
    expect(screen.getByTestId('blitz-score')).toHaveTextContent('0')
    fireEvent.click(tile(FALSE))
    await flush()
    expect(screen.getByTestId('tf-statement')).toHaveTextContent(deck[2].q)
    fireEvent.click(tile(TRUE))
    await flush()
    expect(screen.getByTestId('tf-done')).toBeInTheDocument()
    expect(screen.getByTestId('tf-offline')).toHaveTextContent('The server stopped answering, so the run ended early.')
    expect(screen.getByTestId('tf-right')).toHaveTextContent('0/0')
    expect(screen.getByTestId('tf-done')).toHaveTextContent('No calls this run')
  })

  it('never reads a reply without a verdict as a miss: it is not counted and no wrong answer is shown', async () => {
    // the first call comes back with a reveal but no verdict; the rest are scored as usual
    const fetcher = bankFetcher({ items: ITEMS.slice(0, 5), attempt: (body, n) => (n === 1 ? { reveal: revealOf(BY_ID[body.item_id]), progress: {} } : undefined) })
    await startRun(fetcher)
    const deck = deckOf(statementsOf(ITEMS.slice(0, 5)), SEED)
    fireEvent.click(tile(otherOf(shown().key)))
    await flush()
    expect(screen.queryByTestId('tf-takeover')).toBeNull()
    expect(screen.getByTestId('tf-note')).toHaveTextContent('We could not check that one, so it does not count.')
    expect(screen.getByTestId('blitz-score')).toHaveTextContent('0')
    expect(screen.getByTestId('tf-statement')).toHaveTextContent(deck[1].q)
    for (let k = 1; k < 5; k++) {
      fireEvent.click(tile(shown().key))
      await flush()
    }
    expect(screen.getByTestId('tf-done')).toBeInTheDocument()
    tick(2000)
    expect(screen.getByTestId('tf-right')).toHaveTextContent('4/4')
    expect(screen.getByTestId('tf-lost')).toHaveTextContent('1 call could not be checked, so it does not count.')
    expect(within(screen.getByTestId('run-log')).getAllByRole('listitem')).toHaveLength(4)
  })

  it('stops the run when the session ends mid-run and offers the sign-in', async () => {
    const fetcher = bankFetcher({ attempt: (body, n) => { if (n === 2) { const e = new Error('401'); e.status = 401; throw e } } })
    await startRun(fetcher, { signedOut: <a data-testid="sign-in" href="/login">Sign in</a> })
    fireEvent.click(tile(shown().key))
    await flush()
    fireEvent.click(tile(TRUE))
    await flush()
    expect(screen.getByTestId('tf-done')).toBeInTheDocument()
    expect(screen.getByTestId('tf-signed-out')).toHaveTextContent('You are signed out, so the run stopped there.')
    expect(screen.getByTestId('tf-right')).toHaveTextContent('1/1')
    expect(screen.getByTestId('sign-in')).toBeInTheDocument()
  })

  it('runs one clock, one key handler and one takeover timer under StrictMode', async () => {
    const fetcher = bankFetcher()
    render(<StrictMode><TrueFalseGame fetcher={fetcher} /></StrictMode>)
    await flush()
    fireEvent.click(screen.getByTestId('tf-start'))
    const deck = deckOf(statementsOf(ITEMS), SEED)
    fireEvent.keyDown(window, { key: keyFor(shown().key) })
    await flush()
    expect(fetcher.calls.filter((c) => c.url === ATTEMPTS)).toHaveLength(1)           // one key, one answer
    expect(screen.getByTestId('blitz-score')).toHaveTextContent('20')
    tick(10000)
    expect(screen.getByTestId('blitz-clock')).toHaveTextContent('35s left')             // one clock, not two
    fireEvent.click(tile(otherOf(shown().key)))
    await flush()
    expect(screen.getByTestId('tf-takeover')).toBeInTheDocument()
    tick(takeoverMs(screen.queryByTestId('tf-takeover-why')?.textContent))
    expect(screen.queryByTestId('tf-takeover')).toBeNull()
    expect(screen.getByTestId('tf-statement')).toHaveTextContent(deck[2].q)             // moved on once, not twice
    // the takeover's own button (its click also reaches the tap-anywhere layer) and Enter each move on exactly one
    fireEvent.click(tile(otherOf(shown().key)))
    await flush()
    tick(TF_TAKEOVER_GUARD_MS)
    fireEvent.click(screen.getByTestId('tf-takeover-go'))
    expect(screen.getByTestId('tf-statement')).toHaveTextContent(deck[3].q)
    fireEvent.click(tile(otherOf(shown().key)))
    await flush()
    tick(TF_TAKEOVER_GUARD_MS)
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(screen.queryByTestId('tf-takeover')).toBeNull()
    expect(screen.getByTestId('tf-statement')).toHaveTextContent(deck[4].q)
    tick(TF_TAKEOVER_MAX_MS)
    expect(screen.getByTestId('tf-statement')).toHaveTextContent(deck[4].q)
  })

  it('closed mid-run, it stops its clock, its timers and its keys', async () => {
    // closed while a miss holds the screen
    const fetcher = bankFetcher()
    const { unmount } = await startRun(fetcher)
    fireEvent.click(tile(otherOf(shown().key)))
    await flush()
    expect(screen.getByTestId('tf-takeover')).toBeInTheDocument()
    unmount()
    expect(vi.getTimerCount()).toBe(0)
    tick(60000)
    fireEvent.keyDown(window, { key: 't' })
    await flush()
    expect(fetcher.calls.filter((c) => c.url === ATTEMPTS)).toHaveLength(1)
    expect(document.body.style.overflow).toBe('')                                        // the takeover gave the page back

    // closed while an answer is on the wire: its time-out goes with it, and a late answer changes nothing
    let late = null
    const slow = bankFetcher({ attempt: () => new Promise((resolve) => { late = resolve }) })
    const second = await startRun(slow)
    fireEvent.click(tile(TRUE))
    await flush()
    expect(screen.getByTestId('tf-play')).toHaveAttribute('data-state', 'checking')
    second.unmount()
    expect(vi.getTimerCount()).toBe(0)
    late({ correct: true, reveal: {}, progress: { xp: 5, xp_gained: 5 } })
    await flush()
    expect(vi.getTimerCount()).toBe(0)
  })
})

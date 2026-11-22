/**
 * Greeks Lab rails: the start arena with its stakes and three steps; the lab's sliders are labelled range inputs whose
 * every move reprices the option from the pure module, with the 4% rate said on screen; a set challenge covers its Greek
 * and is scored from the slider; a pick challenge is scored from a tile; a right answer takes over the screen with its
 * lesson, a wrong one with the mistake named and the answer (one line: the takeover cannot scroll); the lab then slides to the answer and the
 * lesson shows the numbers before and after; the run posts once to /api/study/game-runs and the end screen's level bar
 * reads the server's answer; a failed or signed-out post never breaks the end screen; a run that cannot be dealt is an
 * honest empty state with a way back. The seed is pinned, so every expected number is the pure module's.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within, act } from '@testing-library/react'

vi.mock('../../../components/study/StudyMark', () => ({ default: () => <span data-testid="mark" /> }))
const ctl = vi.hoisted(() => ({ deal: 'real' }))
vi.mock('./games/greeksLab', async (importOriginal) => {
  const m = await importOriginal()
  return {
    ...m,
    buildRun: (...a) => {
      if (ctl.deal === 'empty') return []
      if (ctl.deal === 'throw') throw new Error('no deal for this seed')
      return m.buildRun(...a)
    },
  }
})

import GreeksLabGame, { GAME } from './GreeksLabGame'
import { UICON_NAMES } from '../../../components/ui/UIcon'
import {
  GREEKS_TOTAL, MODEL_LINE, buildRun, curveOf, dollars, fmtDelta, fmtGamma, greeksOf, gridOf, measureText, money, moveLabel, passes, priceParts,
  rowsOf, setLine, shown, signed, sliderOf, sliderText, snapTo, stepOf, stepText, verdictOf, zoneText,
} from './games/greeksLab'

// delta_atm (set), theta_most (pick), vega_dollars (pick), gamma_peak (set), lever (pick)
const SEED = 1731100000002
const RUN = buildRun(SEED)
// delta_wing (set), theta_day (set), iv_move (pick), gamma_peak (set), lever (pick)
const SEED_B = 1731100000031
const RUN_B = buildRun(SEED_B)

const realMatchMedia = window.matchMedia
/** Reduced motion on (the lab jumps to the answer instead of gliding), every other query off. */
function motion({ reduce = true } = {}) {
  window.matchMedia = (q) => ({ matches: reduce && /reduce/.test(q), media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false } })
}

/** The fetcher: records the game-runs posts; answers with the member's new XP, or fails. */
function fetcherWith(posts, { fail = false, status = 500 } = {}) {
  return vi.fn(async (url, opts = {}) => {
    if (url === '/api/study/game-runs') {
      posts.push(opts.body)
      if (fail) { const e = new Error('boom'); e.status = status; throw e }
      return { xp_gained: opts.body.right * 2, progress: { xp: 1000 + opts.body.right * 2, level: 3, xp_gained: opts.body.right * 2 }, badges_new: [] }
    }
    throw new Error(`unexpected ${url}`)
  })
}

/** Start a run on a pinned seed (the component seeds from Date.now() once, at Start). */
function startRun(seed = SEED, button = 'greeks-start') {
  const spy = vi.spyOn(Date, 'now').mockReturnValue(seed)
  fireEvent.click(screen.getByTestId(button))
  spy.mockRestore()
}

const slider = (k) => screen.getByTestId(`greeks-slider-${k}`)
const setSlider = (k, v) => fireEvent.change(slider(k), { target: { value: String(v) } })
const tiles = () => [...screen.getByTestId('greeks-cards').querySelectorAll('button')]
const tile = (ch, label) => tiles()[ch.labels.indexOf(label)]
const wrongChoice = (ch) => ch.choices.find((c) => !c.right)
/** A near miss for a set challenge: the grid value just outside the zone (never the start). */
function nearMiss(ch) {
  const grid = gridOf(ch.live, ch.start.K)
  const lo = grid.indexOf(ch.zone.lo), hi = grid.indexOf(ch.zone.hi)
  const v = [grid[lo - 1], grid[hi + 1]].find((x) => x != null && x !== ch.start[ch.live] && !passes(ch.check, { ...ch.start, [ch.live]: x }))
  return { ...ch.start, [ch.live]: v }
}

/** Answer the challenge on screen right or wrong, through the takeover, into the lab. */
function play(ch, right) {
  if (ch.mode === 'set') setSlider(ch.live, right ? ch.best[ch.live] : nearMiss(ch)[ch.live])
  else fireEvent.click(tile(ch, right ? ch.answer : wrongChoice(ch).label))
  fireEvent.click(screen.getByTestId('greeks-check'))
  expect(screen.getByTestId('greeks-takeover').getAttribute('data-correct')).toBe(right ? '1' : '0')
  fireEvent.click(screen.getByTestId('greeks-takeover-go'))
}

beforeEach(() => { ctl.deal = 'real'; motion() })
afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); window.matchMedia = realMatchMedia })

describe('GreeksLabGame', () => {
  it('registers itself from one place, on an existing icon and accent', () => {
    expect(GAME).toEqual({ kind: 'greeks', title: 'Greeks Lab', sub: expect.any(String), icon: 'sliders', plate: 'Greeks', accent: 'amber', group: 'skill' })
    expect(UICON_NAMES).toContain(GAME.icon)
    expect(['amber', 'red', 'gold', 'green']).toContain(GAME.accent)
    expect(GAME.sub).not.toMatch(/—|firm/i)
  })

  it('the pinned runs are the mixes these rails were written for', () => {
    expect(RUN.map((c) => c.kind)).toEqual(['delta_atm', 'theta_most', 'vega_dollars', 'gamma_peak', 'lever'])
    expect(RUN_B.map((c) => c.mode)).toEqual(['set', 'set', 'pick', 'set', 'pick'])
  })

  it('opens on the start arena: the stakes, the model, the three steps, the best score', () => {
    render(<GreeksLabGame fetcher={fetcherWith([])} onClose={() => {}} />)
    const intro = screen.getByTestId('greeks-intro')
    expect(intro).toHaveTextContent('Greeks Lab')
    expect(intro).toHaveTextContent('5challenges')
    expect(intro).toHaveTextContent('3sliders')
    expect(intro).toHaveTextContent('4Greeks')
    expect(intro).toHaveTextContent(MODEL_LINE)
    const how = screen.getByTestId('greeks-howto')
    expect(within(how).getAllByRole('listitem')).toHaveLength(3)
    expect(how).toHaveTextContent('Work the lab')
    expect(how).toHaveTextContent('Take the challenge')
    expect(how).toHaveTextContent('See it move')
    expect(screen.getByTestId('greeks-best')).toHaveTextContent('0')
    expect(intro.textContent).not.toMatch(/—|\bfirm\b/i)
  })

  it('the lab: labelled sliders, the rate on screen, a covered Greek, and every move repriced from the module', () => {
    render(<GreeksLabGame fetcher={fetcherWith([])} onClose={() => {}} />)
    startRun()
    const ch = RUN[0]
    expect(screen.getByTestId('greeks-step')).toHaveTextContent(`Challenge 1 of ${GREEKS_TOTAL}`)
    expect(screen.getByTestId('greeks-question')).toHaveTextContent(ch.question)
    expect(screen.getByTestId('greeks-detail')).toHaveTextContent(ch.detail)
    expect(screen.getByTestId('greeks-model')).toHaveTextContent('Black-Scholes · no dividends · 4% rate')
    expect(screen.getByTestId('greeks-option')).toHaveTextContent(`XYZ ${ch.start.K} ${ch.start.type}`)
    // keyboard-accessible sliders: native range inputs with their labels; only the challenge's own slider is live
    const S = screen.getByLabelText('Stock price')
    expect(S).toBe(slider('S'))
    expect(S).toHaveAttribute('type', 'range')
    expect(S).toHaveAttribute('min', String(sliderOf('S', ch.start.K).min))
    expect(S).toHaveAttribute('max', String(sliderOf('S', ch.start.K).max))
    expect(S).toHaveAttribute('aria-valuetext', sliderText('S', ch.start.S))
    expect(S).not.toBeDisabled()
    expect(screen.getByLabelText('Days to expiry')).toBeDisabled()
    expect(screen.getByLabelText('Implied volatility')).toBeDisabled()
    expect(screen.getByTestId('greeks-type-put')).toBeDisabled()
    expect(screen.getByTestId('greeks-row-S').getAttribute('data-live')).toBe('1')
    // the price and the Greeks as the module shows them; delta covered (its number is not on the page)
    const n = shown(ch.start)
    expect(screen.getByTestId('greeks-price')).toHaveTextContent(money(n.price))
    const parts = priceParts(ch.start)
    expect(screen.getByTestId('greeks-parts')).toHaveTextContent(`${dollars(parts.contract)} a contract · intrinsic ${money(parts.intrinsic)} · time value ${money(parts.timeValue)}`)
    expect(screen.queryByTestId('greeks-under')).toBeNull()
    expect(screen.getByTestId('greeks-delta').getAttribute('data-covered')).toBe('1')
    expect(screen.getByTestId('greeks-delta')).toHaveTextContent('?')
    expect(screen.getByTestId('greeks-delta')).not.toHaveTextContent(fmtDelta(n.delta))
    expect(screen.getByTestId('greeks-gamma')).toHaveTextContent(fmtGamma(n.gamma))
    expect(screen.getByTestId('greeks-theta')).toHaveTextContent(money(n.theta))
    expect(screen.getByTestId('greeks-vega')).toHaveTextContent(money(n.vega))
    expect(screen.getByTestId('greeks-last')).toHaveTextContent('Move a slider')
    // Check waits for a move; Enter on the untouched challenge does nothing
    expect(screen.getByTestId('greeks-check')).toBeDisabled()
    expect(screen.getByTestId('greeks-check')).toHaveTextContent('move the stock slider first')
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(screen.queryByTestId('greeks-takeover')).toBeNull()
    // a move: the price, the readout and the last move all come from the module
    const step = sliderOf('S', ch.start.K).step
    const one = { ...ch.start, S: ch.start.S + step }
    setSlider('S', one.S)
    expect(screen.getByTestId('greeks-value-S')).toHaveTextContent(sliderText('S', one.S))
    expect(screen.getByTestId('greeks-price')).toHaveTextContent(money(shown(one).price))
    const t = stepText(stepOf(ch.start, one))
    expect(screen.getByTestId('greeks-last')).toHaveTextContent(t.move)
    expect(screen.getByTestId('greeks-last')).toHaveTextContent(t.change)
    expect(screen.getByTestId('greeks-check')).not.toBeDisabled()
    // the step buttons move one step either way
    fireEvent.click(screen.getByRole('button', { name: 'Stock price, one step up' }))
    expect(slider('S').value).toBe(String(one.S + step))
    fireEvent.click(screen.getByRole('button', { name: 'Stock price, one step down' }))
    expect(slider('S').value).toBe(String(one.S))
    expect(screen.getByRole('button', { name: 'Days to expiry, one step up' })).toBeDisabled()
  })

  it('a full run: right and wrong in both modes, each with its lesson, then the end screen and the XP, posted once', async () => {
    const posts = []
    render(<GreeksLabGame fetcher={fetcherWith(posts)} onClose={() => {}} />)
    startRun()

    // 1 · set, right: the takeover holds the verdict and the lesson; the lesson card shows start → what you set
    let ch = RUN[0]
    setSlider('S', ch.best.S)
    fireEvent.click(screen.getByTestId('greeks-check'))
    let tk = screen.getByTestId('greeks-takeover')
    expect(tk.getAttribute('data-correct')).toBe('1')
    expect(tk).toHaveTextContent('In the zone.')
    // one line, so the takeover's only button stays on a phone's screen: on a right answer, the lesson
    expect(screen.getByTestId('greeks-takeover-lesson')).toHaveTextContent(ch.lesson)
    expect(screen.queryByTestId('greeks-takeover-why')).toBeNull()
    expect(screen.queryByTestId('greeks-lesson')).toBeNull()       // the card opens when the member opens the lab
    fireEvent.click(screen.getByTestId('greeks-takeover-go'))
    expect(screen.queryByTestId('greeks-takeover')).toBeNull()
    // the verdict line under it says where the member set it, and the zone that counts
    expect(screen.getByText(setLine(ch, ch.best), { exact: false })).toBeInTheDocument()
    let lesson = screen.getByTestId('greeks-lesson')
    expect(screen.getByTestId('greeks-lesson-line')).toHaveTextContent(ch.lesson)
    expect(lesson).toHaveTextContent('StartYou set')
    for (const r of rowsOf(ch, ch.start, ch.best)) expect(screen.getByTestId(`greeks-ba-${r.key}`)).toHaveTextContent(`${r.label}${r.before}→${r.after}`)
    expect(screen.getByTestId('greeks-note')).toHaveTextContent(ch.note)
    expect(lesson).toHaveTextContent('From the course · F6.04 Delta')
    expect(screen.queryByTestId('greeks-mistake')).toBeNull()
    // the covered Greek is uncovered with the answer, and the lab is open to play with
    expect(screen.getByTestId('greeks-delta')).toHaveTextContent(fmtDelta(shown(ch.best).delta))
    expect(screen.getByLabelText('Days to expiry')).not.toBeDisabled()
    expect(screen.getByTestId('greeks-lab').getAttribute('data-open')).toBe('1')
    fireEvent.click(screen.getByTestId('greeks-next'))

    // 2 · pick, wrong: the takeover names the mistake and the answer; the lab moves to the right move's numbers
    ch = RUN[1]
    expect(screen.getByTestId('greeks-step')).toHaveTextContent(`Challenge 2 of ${GREEKS_TOTAL}`)
    expect(screen.getByText(ch.question)).toBeInTheDocument()
    for (const k of ['S', 'days', 'iv']) expect(slider(k)).toBeDisabled()     // a pick challenge reads the lab, it does not move it
    const miss = wrongChoice(ch)
    fireEvent.click(tile(ch, miss.label))
    expect(tile(ch, miss.label).getAttribute('data-state')).toBe('sel')
    fireEvent.click(screen.getByTestId('greeks-check'))
    tk = screen.getByTestId('greeks-takeover')
    expect(tk.getAttribute('data-correct')).toBe('0')
    expect(tk).toHaveTextContent(miss.headline)
    expect(tk).toHaveTextContent(`The answer${ch.answer}`)
    // on a miss, the one line is the mistake named; the lesson waits on the coach's card
    expect(screen.getByTestId('greeks-takeover-why')).toHaveTextContent(miss.why)
    expect(screen.queryByTestId('greeks-takeover-lesson')).toBeNull()
    fireEvent.click(screen.getByTestId('greeks-takeover-go'))
    expect(screen.getByTestId('greeks-lesson-line')).toHaveTextContent(ch.lesson)
    expect(screen.getByTestId('greeks-mistake')).toHaveTextContent(miss.why)
    expect(screen.getByText(`you said ${miss.label}`, { exact: false })).toBeInTheDocument()
    expect(tile(ch, ch.answer).getAttribute('data-state')).toBe('right')
    expect(tile(ch, miss.label).getAttribute('data-state')).toBe('wrong')
    // the lab now stands on the right move, and the lesson shows every move's result and before → after
    expect(slider('days').value).toBe(String(ch.after.days))
    expect(screen.getByTestId('greeks-price')).toHaveTextContent(money(shown(ch.after).price))
    expect(screen.getByTestId('greeks-last')).toHaveTextContent(moveLabel('days', ch.start.days, ch.after.days))
    const moves = screen.getByTestId('greeks-moves')
    for (const c of ch.choices) expect(moves).toHaveTextContent(`${c.label}${c.result}`)
    expect(screen.getByTestId('greeks-ba-days')).toHaveTextContent(`Days${ch.start.days} days→${ch.after.days} days`)
    expect(screen.getByTestId('greeks-ba-decay')).toHaveTextContent(`A day costs${money(ch.before)}→${money(measureTextValue(ch))}`)
    expect(screen.getByTestId('greeks-lesson')).toHaveTextContent('From the course · F6.05 Theta')
    fireEvent.click(screen.getByTestId('greeks-next'))

    // 3 · pick, right, from the keyboard: a number key picks, Enter checks, Enter opens the lab; the working is shown
    ch = RUN[2]
    fireEvent.keyDown(window, { key: String(ch.labels.indexOf(ch.answer) + 1) })
    expect(tile(ch, ch.answer).getAttribute('data-state')).toBe('sel')
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(screen.getByTestId('greeks-takeover').getAttribute('data-correct')).toBe('1')
    expect(screen.getByTestId('greeks-takeover')).toHaveTextContent(`You said${ch.answer}`)
    expect(screen.getByTestId('greeks-takeover-lesson')).toHaveTextContent(ch.lesson)
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(screen.queryByTestId('greeks-takeover')).toBeNull()
    for (const w of ch.working) expect(screen.getByTestId('greeks-lesson')).toHaveTextContent(w)
    expect(screen.getByTestId('greeks-note')).toHaveTextContent(ch.note)
    expect(slider('iv').value).toBe(String(ch.after.iv))
    fireEvent.click(screen.getByTestId('greeks-next'))

    // 4 · set, wrong, checked with Enter on the slider itself: the zone is the answer; the lab slides to the peak
    ch = RUN[3]
    const near = nearMiss(ch)
    expect(screen.getByTestId('greeks-gamma').getAttribute('data-covered')).toBe('1')
    setSlider('S', near.S)
    slider('S').focus()
    expect(document.activeElement).toBe(slider('S'))
    fireEvent.keyDown(slider('S'), { key: 'Enter' })
    // Check lets go of the slider (it locks under the takeover), so the next Enter reaches the takeover's button
    expect(document.activeElement).not.toBe(slider('S'))
    tk = screen.getByTestId('greeks-takeover')
    expect(tk.getAttribute('data-correct')).toBe('0')
    expect(tk).toHaveTextContent('Outside the zone.')
    expect(tk).toHaveTextContent(`The answerXYZ ${zoneText(ch).slider}`)
    expect(screen.getByTestId('greeks-takeover-why')).toHaveTextContent(`${setLine(ch, near)} The zone is ${zoneText(ch).measure}.`)
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(slider('S').value).toBe(String(ch.best.S))
    expect(screen.getByTestId('greeks-lesson')).toHaveTextContent('You setIn the zone')
    expect(screen.getByTestId('greeks-ba-gamma')).toHaveTextContent(`Gamma${fmtGamma(shown(near).gamma)}→${fmtGamma(shown(ch.best).gamma)}`)
    expect(screen.getByTestId('greeks-lesson')).toHaveTextContent(ch.note)
    fireEvent.click(screen.getByTestId('greeks-next'))

    // 5 · pick, right; the last Next says so
    ch = RUN[4]
    play(ch, true)
    expect(screen.getByTestId('greeks-next')).toHaveTextContent('See the run')
    expect(posts).toHaveLength(0)
    fireEvent.click(screen.getByTestId('greeks-next'))

    // the end screen: the verdict, the run log with what was said on each miss, and the server's XP
    expect(screen.getByTestId('greeks-done')).toBeInTheDocument()
    expect(screen.getByText(verdictOf(3, 5))).toBeInTheDocument()
    expect(screen.getByTestId('greeks-right')).toHaveTextContent('3/5')
    const log = screen.getByTestId('run-log')
    expect(within(log).getAllByRole('listitem')).toHaveLength(5)
    expect(log).toHaveTextContent(RUN[0].title)
    expect(log).toHaveTextContent(`you said ${wrongChoice(RUN[1]).label}, it was ${RUN[1].answer}`)
    expect(log).toHaveTextContent(`you said gamma ${measureText('gamma', shown(near).gamma)} at ${sliderText('S', near.S)}, it was ${zoneText(RUN[3]).measure}`)
    await waitFor(() => expect(screen.getByTestId('greeks-level')).toBeInTheDocument())
    expect(posts).toEqual([{ kind: 'greeks', run_id: `greeks-${SEED}`, right: 3, total: 5 }])
    expect(screen.getByTestId('greeks-level')).toHaveTextContent('+6 XP this run')
    await waitFor(() => expect(screen.getByTestId('greeks-xp')).toHaveTextContent('+6'))
    expect(screen.getByTestId('greeks-best-line')).toHaveTextContent('Your best run. 3 of 5 right.')
    expect(localStorage.getItem('study.greeks.best')).toBe('3')
    expect(screen.queryByTestId('greeks-not-saved')).toBeNull()
  })

  it('five for five is Legendary, posts 5 of 5, and keeps the best score on the device', async () => {
    const posts = []
    render(<GreeksLabGame fetcher={fetcherWith(posts)} onClose={() => {}} />)
    startRun(SEED_B)
    for (const ch of RUN_B) { play(ch, true); fireEvent.click(screen.getByTestId('greeks-next')) }
    expect(screen.getByText('Lab legend')).toBeInTheDocument()
    expect(screen.getByTestId('legend-medal').getAttribute('data-lit')).toBe('1')
    expect(screen.getByTestId('greeks-right')).toHaveTextContent('5/5')
    expect(screen.getByTestId('greeks-best-line')).toHaveTextContent('Five for five.')
    await waitFor(() => expect(posts).toEqual([{ kind: 'greeks', run_id: `greeks-${SEED_B}`, right: 5, total: 5 }]))
    await waitFor(() => expect(screen.getByTestId('greeks-level')).toHaveTextContent('+10 XP this run'))
    expect(localStorage.getItem('study.greeks.best')).toBe('5')
  })

  it('a failed post never breaks the end screen: no level bar, and it says the XP did not save', async () => {
    const posts = []
    render(<GreeksLabGame fetcher={fetcherWith(posts, { fail: true })} onClose={() => {}} />)
    startRun()
    for (const ch of RUN) { play(ch, false); fireEvent.click(screen.getByTestId('greeks-next')) }
    expect(screen.getByTestId('greeks-done')).toBeInTheDocument()
    expect(await screen.findByTestId('greeks-not-saved')).toHaveTextContent('This run\'s XP did not save.')
    expect(posts).toEqual([{ kind: 'greeks', run_id: `greeks-${SEED}`, right: 0, total: 5 }])
    expect(screen.queryByTestId('greeks-level')).toBeNull()
    expect(screen.getByTestId('greeks-right')).toHaveTextContent('0/5')
    expect(screen.getByText(verdictOf(0, 5))).toBeInTheDocument()
  })

  it('a signed-out run says it earned no XP and offers the sign-in', async () => {
    render(<GreeksLabGame fetcher={fetcherWith([], { fail: true, status: 401 })} onClose={() => {}} signedOut={<button type="button">Sign in</button>} />)
    startRun()
    for (const ch of RUN) { play(ch, true); fireEvent.click(screen.getByTestId('greeks-next')) }
    expect(await screen.findByTestId('greeks-not-saved')).toHaveTextContent('You are signed out, so this run earned no XP.')
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.queryByTestId('greeks-level')).toBeNull()
  })

  it("the lab glides to the answer, then it is the member's: flip call and put, move anything, show the answer again", async () => {
    motion({ reduce: false })
    render(<GreeksLabGame fetcher={fetcherWith([])} onClose={() => {}} />)
    startRun()
    play(RUN[0], true)
    fireEvent.click(screen.getByTestId('greeks-next'))
    const ch = RUN[1]
    fireEvent.click(tile(ch, ch.answer))
    fireEvent.click(screen.getByTestId('greeks-check'))
    fireEvent.click(screen.getByTestId('greeks-takeover-go'))
    // while it glides the lab is locked, and the replay waits
    expect(screen.getByTestId('greeks-lab').getAttribute('data-open')).toBe('0')
    expect(slider('days')).toBeDisabled()
    expect(screen.getByTestId('greeks-replay')).toBeDisabled()
    await waitFor(() => expect(screen.getByTestId('greeks-lab').getAttribute('data-open')).toBe('1'))
    expect(slider('days').value).toBe(String(ch.after.days))
    expect(screen.getByTestId('greeks-last')).toHaveTextContent(moveLabel('days', ch.start.days, ch.after.days))
    expect(screen.getByTestId('greeks-price')).toHaveTextContent(money(shown(ch.after).price))
    // the member's lab: the other type, then more IV, each repriced by the module
    const other = ch.after.type === 'call' ? 'put' : 'call'
    fireEvent.click(screen.getByTestId(`greeks-type-${other}`))
    const flipped = { ...ch.after, type: other }
    expect(screen.getByTestId('greeks-option')).toHaveTextContent(`XYZ ${ch.after.K} ${other}`)
    expect(screen.getByTestId(`greeks-type-${other}`)).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('greeks-price')).toHaveTextContent(money(shown(flipped).price))
    const more = { ...flipped, iv: flipped.iv + 5 }
    setSlider('iv', more.iv)
    expect(screen.getByTestId('greeks-price')).toHaveTextContent(money(shown(more).price))
    expect(screen.getByTestId('greeks-last')).toHaveTextContent(`about ${signed(rnd2((shown(more).price - shown(flipped).price) / 5))} a point`)
    // the record of the challenge does not move with the play
    expect(screen.getByTestId('greeks-ba-decay')).toHaveTextContent(money(ch.before))
    fireEvent.click(screen.getByTestId('greeks-replay'))
    await waitFor(() => expect(slider('iv').value).toBe(String(ch.after.iv)))
    await waitFor(() => expect(screen.getByTestId('greeks-lab').getAttribute('data-open')).toBe('1'))
    expect(screen.getByTestId('greeks-option')).toHaveTextContent(`XYZ ${ch.after.K} ${ch.after.type}`)
    expect(screen.getByTestId('greeks-price')).toHaveTextContent(money(shown(ch.after).price))
    // out of the money with a month left: the tangent's left end falls under $0 and is clipped, never bent, so the drawn
    // slope is still delta's
    const otm = { ...ch.after, days: 30, S: snapTo('S', ch.after.K, ch.after.K * 0.92) }
    setSlider('days', otm.days)
    setSlider('S', otm.S)
    const c = curveOf(otm)
    const dx = (c.x1 - c.x0) * 0.09
    expect(Math.min(c.at.y - c.at.delta * dx, c.at.y + c.at.delta * dx)).toBeLessThan(-0.1)
    expect(drawnSlope(otm)).toBeCloseTo(greeksOf(otm).delta, 2)
    expect(drawnSlope(otm)).toBeGreaterThan(0.05)
    // a deep in-the-money put with time left and low IV prices under its intrinsic value in this model; the card says why,
    // and that a listed stock option (exercisable early) would not
    expect(screen.queryByTestId('greeks-under')).toBeNull()
    fireEvent.click(screen.getByTestId('greeks-type-put'))
    const deep = { ...otm, type: 'put', S: sliderOf('S', otm.K).min, days: 120, iv: 10 }
    setSlider('S', deep.S); setSlider('days', deep.days); setSlider('iv', deep.iv)
    expect(priceParts(deep).timeValue).toBeLessThan(0)
    expect(screen.getByTestId('greeks-parts')).toHaveTextContent(`time value ${money(priceParts(deep).timeValue)}`)
    expect(screen.getByTestId('greeks-under')).toHaveTextContent('exercised early, so it holds its intrinsic value')
  })

  it('a run that cannot be dealt is an honest empty state with a way back, never a crash or a spinner', () => {
    ctl.deal = 'empty'
    const onClose = vi.fn()
    render(<GreeksLabGame fetcher={fetcherWith([])} onClose={onClose} />)
    startRun()
    const empty = screen.getByTestId('greeks-empty')
    expect(empty).toHaveTextContent('No challenges in the lab right now.')
    expect(empty).toHaveTextContent('Deal a fresh one, or head back to Study.')
    expect(screen.queryByTestId('greeks-play')).toBeNull()
    fireEvent.click(screen.getByTestId('greeks-back'))
    expect(onClose).toHaveBeenCalledTimes(1)
    ctl.deal = 'throw'
    startRun(SEED, 'greeks-retry')
    expect(screen.getByTestId('greeks-empty')).toBeInTheDocument()
    ctl.deal = 'real'
    startRun(SEED, 'greeks-retry')
    expect(screen.queryByTestId('greeks-empty')).toBeNull()
    expect(screen.getByTestId('greeks-question')).toHaveTextContent(RUN[0].question)
  })

  it("a late XP answer for the last run never lands on the next run's end screen", async () => {
    let settle = null
    const posts = []
    const fetcher = vi.fn((url, opts = {}) => {
      posts.push(opts.body)
      // the first run's post waits for the test to answer it; the second's never answers
      return posts.length === 1 ? new Promise((res) => { settle = res }) : new Promise(() => {})
    })
    render(<GreeksLabGame fetcher={fetcher} onClose={() => {}} />)
    startRun()
    for (const ch of RUN) { play(ch, false); fireEvent.click(screen.getByTestId('greeks-next')) }
    await waitFor(() => expect(settle).not.toBeNull())
    startRun(SEED_B, 'greeks-again')
    await act(async () => { settle({ xp_gained: 0, progress: { xp: 1000, level: 3 } }) })
    for (const ch of RUN_B) { play(ch, false); fireEvent.click(screen.getByTestId('greeks-next')) }
    expect(screen.getByTestId('greeks-done')).toBeInTheDocument()
    await waitFor(() => expect(posts).toHaveLength(2))
    expect(posts[1]).toEqual({ kind: 'greeks', run_id: `greeks-${SEED_B}`, right: 0, total: 5 })
    expect(screen.queryByTestId('greeks-level')).toBeNull()
  })
})

const rnd2 = (x) => Math.round(x * 100) / 100

/** The tangent's slope as drawn, back in dollars of option per dollar of XYZ (the drawing's own frame: no
 *  ResizeObserver here, so its fallback width of 480 by 290 on a desktop, margins 46, 12, 12 and 28). */
function drawnSlope(st) {
  const c = curveOf(st)
  const pw = 480 - 46 - 12, ph = 290 - 12 - 28
  const [x1, y1, x2, y2] = screen.getByTestId('greeks-tangent').getAttribute('d').match(/-?\d+(\.\d+)?/g).map(Number)
  return (-(y2 - y1) / (x2 - x1)) * (pw / (c.x1 - c.x0)) * ((c.y1 - c.y0) / ph)
}

/** The right move's measure, as the lesson shows it. */
function measureTextValue(ch) {
  return ch.choices.find((c) => c.right).value
}

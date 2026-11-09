// Trade Story's rules (games/tradeStory.js): the decision points read off known bars, the trail measured from the higher
// lows, the fills at a gap, the exits in R with no size invented, the working that adds up to the cent, and every line of
// copy in the voice (no dashes, never "the firm", never a fraction the plan does not name).
import { describe, it, expect } from 'vitest'
import {
  ACTIONS, ALL, EMPTY_LINE, ENTRY_DETAIL, ENTRY_Q, EXIT_NOTE, FAILED_LINE, HOLD, NOTHING_TRADED, NOT_SCORED, NO_PLAN, PLAN_SKILLS, STORY_SETUPS, STORY_SOURCE, START_LEAD, TRAIL_RULE, TRIM, actionLabel, bankLine,
  callsOf, entryChoices, entryTitle, eventLine, exitsOf, exitsText, higherLows, levelAfter, logRows, namedLine, planExits, planLine,
  planOk, poolItems, positionLine, positionWord, px, questionOf, rAt, rText, riskPct, runIdOf, stopAt, stopTag, storyKeys, storyOf,
  storyVerdict, tally, tradeLine, tradeOk, tradeTitle, trailAt, trailMeasured, whyOf, workingOf,
} from './tradeStory'

const bar = (i, o, h, l, c) => ({ t: `2025-03-${String(4 + i).padStart(2, '0')}`, o, h, l, c, v: 1000 })

// A Launchpad, long: entry 10.00, stop 9.50 (risk 0.50), 2R 11.00, 3R 11.50, entering on the close; the plan names the
// higher lows as one of its two trails.
const P = { skill: 'setup.family1.launchpad', direction: 'bullish', entry: 10, stop: 9.5, t1: 11, t2: 11.5, enters_intraday: false,
  trail: 'under the rising 21-day average, or under each higher low', entry_note: 'the close out of the tight cluster of averages', stop_note: 'under the 21-day and 50-day averages' }
const S = { t: '2025-03-03', o: 9.7, h: 10.05, l: 9.6, c: 10, v: 1000 }
// sessions 1..12: a higher low on day 3 (10.00), 2R on day 4, 3R on day 6, a higher low on day 8 (11.20), and day 11
// trades under it (11.10) without gapping (it opened 11.70)
const F = [
  bar(1, 10.0, 10.3, 9.8, 10.2), bar(2, 10.2, 10.6, 10.1, 10.5), bar(3, 10.5, 10.7, 10.0, 10.3), bar(4, 10.3, 11.1, 10.25, 11.0),
  bar(5, 11.0, 11.3, 10.8, 11.2), bar(6, 11.2, 11.6, 11.1, 11.5), bar(7, 11.5, 11.8, 11.3, 11.4), bar(8, 11.4, 11.5, 11.2, 11.3),
  bar(9, 11.3, 11.9, 11.25, 11.8), bar(10, 11.8, 12.0, 11.6, 11.7), bar(11, 11.7, 11.75, 11.1, 11.2), bar(12, 11.2, 11.4, 10.9, 11.0),
]

describe('the plan, in numbers', () => {
  it('plays only a plan with an entry, a stop on the right side and both targets', () => {
    expect(planOk(P)).toBe(true)
    expect(planOk({ ...P, stop: 10.5 })).toBe(false)
    expect(planOk({ ...P, t2: null })).toBe(false)
    expect(planOk({ ...P, t2: 10.9 })).toBe(false)
    expect(planOk({ direction: 'bearish', entry: 50, stop: 52, t1: 46, t2: 44 })).toBe(true)
    expect(planOk({ direction: 'bearish', entry: 50, stop: 48, t1: 46, t2: 44 })).toBe(false)
    expect(planOk(null)).toBe(false)
  })
  it('measures R from the entry to the cent, both ways', () => {
    expect(rAt(P, 11.2)).toBeCloseTo(2.4, 10)
    expect(rAt(P, 9.5)).toBeCloseTo(-1, 10)
    expect(rAt(P, 9.3)).toBeCloseTo(-1.4, 10)
    expect(rAt({ direction: 'bearish', entry: 50, stop: 52 }, 46)).toBeCloseTo(2, 10)
    expect(rAt({ direction: 'bearish', entry: 50, stop: 52 }, 52)).toBeCloseTo(-1, 10)
    expect(rAt({ entry: 10, stop: 10 }, 11)).toBe(null)
    expect(riskPct(P)).toBe(5)
    expect(rText(2.4)).toBe('+2.4R')
    expect(rText(-1)).toBe('−1.0R')
    expect(px(11.2)).toBe('11.20')
  })
  it('rounds a tie the way a member does by hand, the same on both sides, and a nothing has no sign', () => {
    // (223.22 − 192.69) ÷ 14.20 = 2.15 exactly; the stored double sits a hair under, and toFixed alone said +2.1R
    const p = { direction: 'bullish', entry: 192.69, stop: 178.49 }
    expect(rText(rAt(p, 223.22))).toBe('+2.2R')
    expect(rText(rAt({ direction: 'bullish', entry: 8.88, stop: 8.16 }, 9.78))).toBe('+1.3R')     // 0.90 ÷ 0.72 = 1.25
    expect(rText(rAt({ direction: 'bullish', entry: 11.7, stop: 11.42 }, 11.35))).toBe('−1.3R')   // −0.35 ÷ 0.28 = −1.25
    expect(rText(2.14)).toBe('+2.1R')
    expect(riskPct({ direction: 'bullish', entry: 20, stop: 18.99, t1: 22.02, t2: 23.03 })).toBe(5.1)        // 1.01 ÷ 20.00 = 5.05%, a tie, up
    expect(rText(0)).toBe('0.0R')
    expect(rText(-0.04)).toBe('0.0R')
    expect(rText(null)).toBe('')
  })
  it('names the trail it can measure: the higher lows, on a long', () => {
    expect(trailMeasured(P)).toBe(true)
    expect(trailMeasured({ ...P, trail: 'under each higher low, or under the 10-day average' })).toBe(true)
    expect(trailMeasured({ ...P, trail: 'under the 10-day average, or under each higher low' })).toBe(true)
    expect(trailMeasured({ ...P, trail: 'if it drifts sideways at the gap, a tighter stop just under the gap top' })).toBe(false)
    expect(trailMeasured({ ...P, trail: null })).toBe(false)
    expect(trailMeasured({ ...P, direction: 'bearish' })).toBe(false)
  })
  it('says the plan in one line', () => {
    expect(planLine(P)).toBe('Bought at 10.00 · stop 9.50 · 5.0% risk')
    expect(planLine({ direction: 'bearish', entry: 50, stop: 52, t1: 46, t2: 44 })).toBe('Shorted at 50.00 · stop 52.00 · 4.0% risk')
    expect(planLine(null)).toBe('')
  })
})

describe('the higher lows', () => {
  it('finds a day under both neighbours and above the low before it, known the day after', () => {
    expect(higherLows(S, F)).toEqual([{ session: 3, low: 10.0, known: 4 }, { session: 8, low: 11.2, known: 9 }])
  })
  it('never counts a lower low or an equal low, and still compares the next one against the lower low', () => {
    const sig = { l: 10 }
    const fwd = [bar(1, 0, 0, 10.5, 0), bar(2, 0, 0, 9.8, 0), bar(3, 0, 0, 10.4, 0), bar(4, 0, 0, 10.1, 0), bar(5, 0, 0, 10.3, 0),
      bar(6, 0, 0, 10.3, 0), bar(7, 0, 0, 10.6, 0)]
    // day 2 (9.80) is a low but under the signal's 10.00: not a higher low; day 4 (10.10) is over 9.80: a higher low;
    // days 5 and 6 sit level at 10.30: not a low of their own
    expect(higherLows(sig, fwd)).toEqual([{ session: 4, low: 10.1, known: 5 }])
    expect(higherLows(null, fwd)).toEqual([])
    expect(higherLows(sig, [])).toEqual([])
  })
})

describe('the story', () => {
  it('stops at 2R, at 3R and where the trail breaks; the trail steps up under each higher low and never down', () => {
    const st = storyOf(P, S, F)
    expect(st.long).toBe(true)
    expect(st.points.map((p) => [p.id, p.session, p.label, p.answer])).toEqual([['t1', 4, '2R', TRIM], ['t2', 6, '3R', TRIM], ['trail', 11, 'Trail', ALL]])
    expect(st.points[0]).toMatchObject({ level: 11, r: 2, gap: false })
    expect(st.points[1]).toMatchObject({ level: 11.5, r: 3, gap: false })
    expect(st.points[2]).toMatchObject({ level: 11.2, fill: 11.2, gap: false, low: 8 })
    expect(st.points[2].r).toBeCloseTo(2.4, 10)
    expect(st.end).toEqual({ session: 11, kind: 'trail', r: expect.closeTo(2.4, 10) })
    expect(st.trail).toEqual([{ known: 6, level: 10.0, low: 3 }, { known: 9, level: 11.2, low: 8 }])
    // the chart's marks stop the day before the trail broke (the game marks that day itself)
    expect(st.shown).toMatchObject({ t1At: 4, t2At: 6, stoppedSession: null })
    expect([...storyKeys(st)].sort((a, b) => a - b)).toEqual([1, 2, 4, 6, 11])
    expect(trailAt(st, 5)).toBe(null)
    expect(trailAt(st, 6)).toEqual({ known: 6, level: 10.0, low: 3 })
    expect(trailAt(st, 8)).toEqual({ known: 6, level: 10.0, low: 3 })
    expect(trailAt(st, 9)).toEqual({ known: 9, level: 11.2, low: 8 })
    expect(stopAt(st, P, 4)).toEqual({ kind: 'stop', level: 9.5, low: null })
    expect(stopAt(st, P, 7)).toEqual({ kind: 'trail', level: 10.0, low: 3 })
    expect(stopAt(st, P, 10)).toEqual({ kind: 'trail', level: 11.2, low: 8 })
  })

  it('fills a trail the day opened under at the open', () => {
    const gap = F.map((b, i) => (i === 10 ? { ...b, o: 11.0 } : b))
    const p = storyOf(P, S, gap).points[2]
    expect(p).toMatchObject({ id: 'trail', session: 11, level: 11.2, fill: 11.0, gap: true })
    expect(p.r).toBeCloseTo(2, 10)
  })

  it('fills a target the day opened past at the open: the level never printed, so the question never says it traded', () => {
    // a Launchpad, entry 100.00, stop 95.00 (risk 5.00), 2R 110.00, 3R 115.00; day 2 opens 111.00 with a low of 110.50
    const LP = { ...P, entry: 100, stop: 95, t1: 110, t2: 115 }
    const sig = { o: 97, h: 100.5, l: 96.5, c: 100 }
    const fwd = [bar(1, 101, 104, 99, 103), bar(2, 111, 113, 110.5, 112), bar(3, 112, 116, 111, 115.5)]
    const [t1, t2] = storyOf(LP, sig, fwd).points
    expect(t1).toMatchObject({ id: 't1', session: 2, level: 110, fill: 111, gap: true })
    expect(t1.r).toBeCloseTo(2.2, 10)
    expect(t2).toMatchObject({ id: 't2', session: 3, level: 115, fill: 115, gap: false, r: 3 })
    expect(questionOf(t1)).toBe('It opened over 2R, at 111.00. What do you do?')
    expect(workingOf(t1, LP).map((x) => x.text)).toEqual(['Risk a share: 100.00 − 95.00 = 5.00.', '2R: 100.00 + 2 × 5.00 = 110.00.',
      'It opened at 111.00, past 2R, so that is the fill: (111.00 − 100.00) ÷ 5.00 = +2.2R.', 'At 2R the plan takes some off. It names the level, not how much to sell.'])
    expect(whyOf(t1, TRIM, LP).text).toBe('2R is the first target: take some off. The plan names the level, not how much to sell. What is left rides on the stop. It opened past 2R, so the open is the fill: +2.2R.')
    // a short's target gapped through is the mirror: it opened UNDER it
    const SH = { direction: 'bearish', entry: 50, stop: 52, t1: 46, t2: 44, trail: null, enters_intraday: false }
    const s1 = storyOf(SH, { o: 51, h: 52, l: 49.8, c: 50 }, [bar(1, 49, 49.5, 48, 48.5), bar(2, 45.5, 46.2, 45, 45.2)]).points[0]
    expect(s1).toMatchObject({ id: 't1', session: 2, fill: 45.5, gap: true })
    expect(s1.r).toBeCloseTo(2.25, 10)
    expect(rText(s1.r)).toBe('+2.3R')
    expect(eventLine(s1, false)).toBe('It opened under 2R, at 45.50.')
  })

  it('measures a target exit on the prices on the screen, so a plan rounded a cent says its own R', () => {
    // make_levels rounds each price on its own: entry 5.00, stop 4.91, 3R 5.30 on the plan, (5.30 − 5.00) ÷ 0.09 = 3.3R
    const R = { ...P, entry: 5, stop: 4.91, t1: 5.2, t2: 5.3, trail: null }
    const st = storyOf(R, { o: 4.95, h: 5.01, l: 4.92, c: 5 }, [bar(1, 5.05, 5.22, 5.0, 5.2), bar(2, 5.2, 5.31, 5.15, 5.3)])
    expect(rText(st.points[0].r)).toBe('+2.2R')
    expect(rText(st.points[1].r)).toBe('+3.3R')
    expect(workingOf(st.points[1], R)[1].text).toBe('3R: the entry plus three times the risk, 5.30 on the plan.')
  })

  it('is the same story on any first part of the strip: the points so far never change as more bars arrive', () => {
    const full = storyOf(P, S, F)
    for (let L = 0; L <= F.length; L++) {
      const part = storyOf(P, S, F.slice(0, L))
      expect(part.points).toEqual(full.points.filter((p) => p.session <= L))
      if (full.end.session <= L) expect(part.end).toEqual(full.end)
      else expect(part.end.kind).toBe('open')
    }
  })

  it('ends at the stop before any target, filled at the stop, or at the open on a gap', () => {
    const G = [bar(1, 10, 10.2, 9.7, 9.9), bar(2, 9.8, 9.85, 9.4, 9.45)]
    const st = storyOf(P, S, G)
    expect(st.points).toEqual([{ id: 'stop', label: 'Stop', session: 2, level: 9.5, fill: 9.5, gap: false, low: null, r: expect.closeTo(-1, 10), answer: ALL }])
    expect(st.end).toEqual({ session: 2, kind: 'stop', r: expect.closeTo(-1, 10) })
    const gapped = storyOf(P, S, [G[0], { ...G[1], o: 9.3 }])
    expect(gapped.points[0]).toMatchObject({ fill: 9.3, gap: true })
    expect(gapped.points[0].r).toBeCloseTo(-1.4, 10)
  })

  it('keeps what is left on the plan stop when the plan names no trail (High Volume Edge)', () => {
    const H = { ...P, skill: 'setup.family3.hve', trail: null }
    const fwd = [...F.slice(0, 6), bar(7, 11.4, 11.45, 10.6, 10.7), bar(8, 10.6, 10.7, 9.45, 9.5)]
    const st = storyOf(H, S, fwd)
    expect(st.points.map((p) => [p.id, p.session])).toEqual([['t1', 4], ['t2', 6], ['stop', 8]])
    expect(st.points[2].r).toBeCloseTo(-1, 10)
    expect(st.trail).toBe(null)
    expect(stopAt(st, H, 7)).toEqual({ kind: 'stop', level: 9.5, low: null })
  })

  it('treats the trail as the plan stop until a higher low lifts it', () => {
    const up = [bar(1, 10, 10.6, 9.9, 10.5), bar(2, 10.5, 11.2, 10.4, 11.1), bar(3, 11.1, 11.6, 11.0, 11.5), bar(4, 11.5, 11.6, 9.4, 9.6)]
    const st = storyOf(P, S, up)
    expect(st.points.map((p) => [p.id, p.session])).toEqual([['t1', 2], ['t2', 3], ['stop', 4]])
    expect(st.points[2]).toMatchObject({ level: 9.5, fill: 9.5, low: null })
    expect(st.trail).toEqual([{ known: 3, level: 9.5, low: null }])
    expect(stopAt(st, P, 3)).toEqual({ kind: 'stop', level: 9.5, low: null })
  })

  it('plays a short (a bearish High Volume Edge) mirrored, with Cover the rest', () => {
    const SH = { skill: 'setup.family3.hve', direction: 'bearish', entry: 50, stop: 52, t1: 46, t2: 44, trail: null, enters_intraday: false }
    const sig = { o: 52.5, h: 52.8, l: 49.8, c: 50 }
    const fwd = [bar(1, 49.8, 50.5, 48.9, 49), bar(2, 49, 49.2, 45.8, 46.2), bar(3, 46, 47, 45, 46.5), bar(4, 46.5, 52.4, 46, 52.1)]
    const st = storyOf(SH, sig, fwd)
    expect(st.long).toBe(false)
    expect(st.points.map((p) => [p.id, p.session, p.r])).toEqual([['t1', 2, 2], ['stop', 4, expect.closeTo(-1, 10)]])
    expect(actionLabel(ALL, false)).toBe('Cover the rest')
    expect(eventLine(st.points[1], false)).toBe('Price just traded up through your stop, 52.00.')
    expect(workingOf(st.points[0], SH).map((x) => x.text).slice(0, 2)).toEqual(['Risk a share: 52.00 − 50.00 = 2.00.', '2R: 50.00 − 2 × 2.00 = 46.00.'])
    expect(workingOf(st.points[1], SH).find((x) => x.key === 'r').text).toBe('Out at 52.00: (50.00 − 52.00) ÷ 2.00 = −1.0R.')
    expect(whyOf(st.points[1], TRIM, SH).text).toContain('the plan covers the rest, not part of it')
  })

  it('asks at once when 2R traded on the entry day itself (a same-day entry), and ends open when the bars run out', () => {
    const K = { skill: 'setup.family3.kicker', direction: 'bullish', entry: 20, stop: 19.3, t1: 21.4, t2: 22.1, enters_intraday: true,
      trail: 'under each higher low, or under the 10-day average' }
    const sig = { o: 19.8, h: 21.5, l: 19.5, c: 21.3 }
    const st = storyOf(K, sig, [bar(1, 21.3, 22.2, 21.0, 22.0)])
    expect(st.points.map((p) => [p.id, p.session])).toEqual([['t1', 0], ['t2', 1]])
    expect(eventLine(st.points[0])).toBe('2R traded on the entry day itself, at 21.40.')
    expect(st.end).toEqual({ session: 1, kind: 'open', r: expect.closeTo(200 / 70, 10) })
    expect(storyKeys(st).has(0)).toBe(false)
    expect(exitsText(planExits(st), st.end)).toBe('Some off at 2R and 3R. The rest still open, +2.9R at the last close.')
  })

  it('has no story without a playable plan', () => {
    expect(storyOf(null, S, F)).toBe(null)
    expect(storyOf(P, null, F)).toBe(null)
    expect(storyOf({ ...P, stop: 11 }, S, F)).toBe(null)
  })
})

describe('the calls and the exits', () => {
  const st = storyOf(P, S, F)
  it('reads the exits off the calls, each at its own R, and ignores calls after the member is out', () => {
    expect(planExits(st)).toEqual({ out: true, exits: [
      { id: 't1', label: '2R', part: 'some', r: 2 }, { id: 't2', label: '3R', part: 'some', r: 3 },
      { id: 'trail', label: 'Trail', part: 'rest', r: expect.closeTo(2.4, 10) }] })
    expect(exitsText(planExits(st), st.end)).toBe('Some off at 2R and 3R. The rest out at +2.4R on the trail.')
    expect(exitsText(exitsOf(st.points, [HOLD, TRIM, ALL]), st.end)).toBe('Some off at 3R. The rest out at +2.4R on the trail.')
    expect(exitsText(exitsOf(st.points, [ALL, TRIM, HOLD]), st.end)).toBe('Out at 2R.')
    expect(exitsText(exitsOf(st.points, [TRIM, ALL]), st.end)).toBe('Some off at 2R. The rest out at 3R.')
    expect(exitsText(exitsOf(st.points, [TRIM, HOLD, HOLD]), st.end)).toBe('Some off at 2R. The rest still held when the plan was out.')
    expect(exitsText(exitsOf(st.points, [HOLD, HOLD, HOLD]), st.end)).toBe('All of it still held when the plan was out.')
    expect(exitsOf(st.points, [TRIM]).out).toBe(false)
  })
  it('says where the member stands', () => {
    expect(positionLine(exitsOf(st.points, []))).toBe('You hold the full position.')
    expect(positionLine(exitsOf(st.points, [TRIM]))).toBe('You took some off at 2R. The rest is still on.')
    expect(positionLine(exitsOf(st.points, [TRIM, TRIM]))).toBe('You took some off at 2R and 3R. The rest is still on.')
    expect(positionLine(exitsOf(st.points, [ALL]))).toBe('You are out.')
    expect(positionWord(exitsOf(st.points, []))).toBe('Full')
    expect(positionWord(exitsOf(st.points, [TRIM]))).toBe('Some off')
    expect(positionWord(exitsOf(st.points, [ALL]))).toBe('Out')
  })
  it('counts the calls on the plan', () => {
    expect(callsOf(st, [TRIM, HOLD, ALL])).toEqual({ right: 2, total: 3 })
    expect(callsOf(st, [TRIM])).toEqual({ right: 1, total: 1 })
    expect(tradeTitle({ right: 3, total: 3 })).toBe('On the plan, every call.')
    expect(tradeTitle({ right: 1, total: 1 })).toBe('On the plan.')
    expect(tradeTitle({ right: 2, total: 3 })).toBe('2 of 3 calls on the plan.')
    expect(tradeTitle({ right: 0, total: 0 })).toBe('Nothing to manage on this one.')
  })
})

describe('the copy at each stop', () => {
  const st = storyOf(P, S, F)
  const [t1, t2, tr] = st.points
  it('asks what happened, with its price, then the call', () => {
    expect(questionOf(t1)).toBe('2R just traded, at 11.00. What do you do?')
    expect(questionOf(t2)).toBe('3R just traded, at 11.50. What do you do?')
    expect(questionOf(tr)).toBe('Price just traded under 11.20, the higher low of day 8. What do you do?')
    expect(questionOf(t2, true, false)).toBe('3R just traded, at 11.50. You are already out. What does the plan do here?')
    expect(stopTag(t1)).toBe('The replay stops · 2R')
    expect(eventLine({ ...tr, gap: true, fill: 11 })).toBe('It opened under the trail, at 11.00.')
    const stop = storyOf(P, S, [bar(1, 10, 10.2, 9.7, 9.9), bar(2, 9.3, 9.85, 9.2, 9.45)]).points[0]
    expect(questionOf(stop)).toBe('It opened under your stop, at 9.30. What do you do?')
  })
  it('says why, on the plan: right and each wrong call', () => {
    expect(whyOf(t1, TRIM, P)).toEqual({ ok: true, title: 'That is the plan.', text: '2R is the first target: take some off. The plan names the level, not how much to sell. What is left rides on the stop.' })
    expect(whyOf(t1, HOLD, P)).toMatchObject({ ok: false, title: 'Not the plan.' })
    expect(whyOf(t1, ALL, P).text).toBe('2R is the first of two targets. The plan takes some off here and lets the rest ride on the stop.')
    expect(whyOf(t2, TRIM, P).text).toBe('3R is the second target: take some off. What is left now trails under each higher low.')
    expect(whyOf(t2, TRIM, { ...P, trail: null }).text).toBe('3R is the second target: take some off. What is left rides on the stop.')
    expect(whyOf(t2, ALL, P).text).toBe('3R is the second target, not the exit. The plan takes some off and trails the rest under each higher low.')
    expect(whyOf(tr, ALL, P).text).toBe('The trail is the stop on what is left. Price traded under the higher low of day 8, 11.20: out at +2.4R.')
    expect(whyOf(tr, HOLD, P).text).toBe('The trail is the stop on what is left. Price traded under the higher low of day 8, 11.20, so the plan sells the rest at +2.4R.')
    expect(whyOf(tr, TRIM, P).text).toBe('A broken trail ends the trade. The plan sells all that is left, not part of it, at +2.4R.')
    const stop = storyOf(P, S, [bar(1, 10, 10.2, 9.7, 9.9), bar(2, 9.3, 9.85, 9.2, 9.45)]).points[0]
    expect(whyOf(stop, ALL, P).text).toBe('The stop is an appointment, not a debate. Out at −1.4R. It opened under the level: a stop cannot catch an overnight gap.')
    expect(whyOf(stop, HOLD, P).text).toBe('The stop is an appointment, not a debate. At the stop the plan is out of all of it, at −1.4R. It opened under the level: a stop cannot catch an overnight gap.')
  })
  it('shows the working on the plan prices, adding up to the cent', () => {
    expect(workingOf(t1, P).map((x) => x.text)).toEqual([
      'Risk a share: 10.00 − 9.50 = 0.50.', '2R: 10.00 + 2 × 0.50 = 11.00.', 'At 2R the plan takes some off. It names the level, not how much to sell.'])
    expect(workingOf(t2, P).map((x) => x.text)).toEqual([
      'Risk a share: 10.00 − 9.50 = 0.50.', '3R: 10.00 + 3 × 0.50 = 11.50.', 'At 3R the plan takes some off. It names the level, not how much to sell.', TRAIL_RULE])
    expect(workingOf(t2, { ...P, trail: null }).pop().text).toBe('This plan names no trail, so what is left rides on the stop.')
    // the Gap Support DOES name a trail, a judgment the bars cannot place: never "names no trail"
    const GS = { ...P, trail: 'if it drifts sideways at the gap, a tighter stop just under the gap top' }
    expect(workingOf(t2, GS).pop().text).toBe("What is left rides on the stop here. This plan's trail is a judgment, not a level: if it drifts sideways at the gap, a tighter stop just under the gap top.")
    expect(workingOf(tr, P).map((x) => x.text)).toEqual([
      'Risk a share: 10.00 − 9.50 = 0.50.', 'The trail: the higher low of day 8, 11.20. Price traded under it.', 'Out at 11.20: (11.20 − 10.00) ÷ 0.50 = +2.4R.', TRAIL_RULE])
    const stop = storyOf(P, S, [bar(1, 10, 10.2, 9.7, 9.9), bar(2, 9.3, 9.85, 9.2, 9.45)]).points[0]
    expect(workingOf(stop, P).map((x) => x.text)).toEqual(['Risk a share: 10.00 − 9.50 = 0.50.', 'The stop: 9.50, and the day opened past it.', 'Out at 9.30: (9.30 − 10.00) ÷ 0.50 = −1.4R.'])
  })
  it('never prints a sum the chart disagrees with: a target the plan rounded a cent away is said without it', () => {
    const odd = { ...P, t1: 11.01 }
    const p = storyOf(odd, S, F).points[0]
    expect(workingOf(p, odd)[1].text).toBe('2R: the entry plus twice the risk, 11.01 on the plan.')
  })
  it('keeps every line in the voice: no dashes, never the firm, no fraction, questions of 22 words or less', () => {
    const lines = [START_LEAD, EMPTY_LINE, FAILED_LINE, STORY_SOURCE, TRAIL_RULE, EXIT_NOTE, ENTRY_Q, ENTRY_DETAIL, NOT_SCORED, NO_PLAN, NOTHING_TRADED, bankLine(4)]
    const stop = storyOf(P, S, [bar(1, 10, 10.2, 9.7, 9.9), bar(2, 9.3, 9.85, 9.2, 9.45)]).points[0]
    // a target the day opened past (2R gapped through on day 2)
    const gapped = storyOf(P, S, [bar(1, 10, 10.3, 9.8, 10.2), bar(2, 11.1, 11.3, 11.05, 11.2)]).points[0]
    expect(gapped).toMatchObject({ id: 't1', gap: true, fill: 11.1 })
    for (const p of [gapped]) {
      for (const inPos of [true, false]) lines.push(questionOf(p, true, inPos))
      for (const a of ACTIONS) lines.push(whyOf(p, a, P).text)
      lines.push(...workingOf(p, P).map((x) => x.text))
    }
    lines.push(...workingOf(t2, { ...P, trail: 'if it drifts sideways at the gap, a tighter stop just under the gap top' }).map((x) => x.text))
    for (const p of [t1, t2, tr, stop]) {
      for (const inPos of [true, false]) lines.push(questionOf(p, true, inPos))
      for (const a of ACTIONS) lines.push(whyOf(p, a, P).text, whyOf(p, a, { ...P, trail: null }).text, actionLabel(a), actionLabel(a, false))
      lines.push(...workingOf(p, P).map((x) => x.text))
    }
    for (const picks of [[TRIM, TRIM, ALL], [HOLD, HOLD, HOLD], [ALL], [TRIM, HOLD, HOLD]]) lines.push(exitsText(exitsOf(st.points, picks), st.end))
    for (const l of lines) {
      expect(l).not.toMatch(/[—–]/)
      expect(l).not.toMatch(/\bfirm\b/i)
      expect(l).not.toMatch(/\bthirds?\b|\bhalf\b|\bhalves\b/i)
      expect(l).not.toMatch(/may potentially|it's important to|in order to|leverage|utilize|journey|robust|seamless|dive in|great job|crucial|framework/i)
      expect(l).not.toMatch(/NaN|undefined|null/)
    }
    for (const p of [t1, t2, tr, stop]) {
      for (const s of questionOf(p, true, false).split(/(?<=[.?])\s+/)) expect(s.split(/\s+/).length).toBeLessThanOrEqual(22)
    }
  })
})

describe('the trade and the run', () => {
  it('deals four setup names with a plan, the chart own among them, the same for the same seed', () => {
    const item = { id: 'k1', name: 'Kicker' }
    const a = entryChoices(item, 7)
    expect(a).toHaveLength(4)
    expect(a).toEqual(entryChoices(item, 7))
    expect(a).toContain('Kicker')
    expect(new Set(a).size).toBe(4)
    for (const n of a) expect(STORY_SETUPS).toContain(n)
    expect(STORY_SETUPS).not.toContain('Bear gap')
    const orders = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9].map((s) => entryChoices(item, s).join('|')))
    expect(orders.size).toBeGreaterThan(1)
  })
  it('names the entry verdict', () => {
    expect(entryTitle(true, 'Kicker')).toBe('Named it.')
    expect(entryTitle(false, 'Oops Reversal')).toBe('It was an Oops Reversal.')
  })
  it('keeps the charts of a setup with a plan, with their bars', () => {
    const set = { session_id: 's1', items: [
      { id: 'a', skill_id: 'setup.family3.kicker', bars: { bars: [1, 2, 3] }, prompt_json: { choices: ['Yes', 'No'] } },
      { id: 'b', skill_id: 'setup.family3.bear_gap', bars: { bars: [1, 2, 3] } },
      { id: 'c', skill_id: 'setup.family4.oops', bars: { bars: [] } },
      { id: 'd', skill_id: 'setup.family3.hve', bars: { bars: [1, 2] } },
    ] }
    expect(poolItems(set, (b) => b.bars)).toEqual([
      { id: 'a', skill: 'setup.family3.kicker', name: 'Kicker', choices: ['Yes', 'No'], bars: [1, 2, 3], sessionId: 's1' },
      { id: 'd', skill: 'setup.family3.hve', name: 'High Volume Edge', choices: ['Yes', 'No'], bars: [1, 2], sessionId: 's1' },
    ])
    expect(poolItems(null)).toEqual([])
    expect(PLAN_SKILLS).toHaveLength(6)
  })
  it('counts the run, logs every call, and says each trade in a line', () => {
    const st = storyOf(P, S, F)
    const stop = storyOf(P, S, [bar(1, 10, 10.2, 9.7, 9.9), bar(2, 9.8, 9.85, 9.4, 9.45)])
    const trades = [
      { id: 'a', name: 'Launchpad', ticker: 'NVDA', long: true, named: true, story: st, picks: [TRIM, TRIM, ALL] },
      { id: 'b', name: 'Launchpad', ticker: 'AMD', long: true, named: false, story: stop, picks: [HOLD] },
      { id: 'c', name: 'Kicker', ticker: '', skipped: true },
    ]
    // a scored chart whose reveal had no playable plan: played, its name counts, no calls, and never "not scored"
    const noPlan = { id: 'd', name: 'Slingshot', ticker: 'TSLA', long: true, named: true, story: null, picks: [], skipped: false }
    expect(tradeLine(noPlan)).toBe('TSLA · Slingshot: no trade plan came back, so there was nothing to manage.')
    expect(tradeOk(noPlan)).toBe(true)
    expect(tally([...trades, noPlan])).toMatchObject({ right: 3, total: 4, named: 2, played: 3 })
    expect(tally(trades)).toEqual({ right: 3, total: 4, named: 1, played: 2, results: [true, true, true, false] })
    expect(tradeOk(trades[0])).toBe(true)
    expect(tradeOk(trades[1])).toBe(false)
    expect(tradeOk(trades[2])).toBe(null)
    expect(logRows(trades)).toEqual([
      { name: '2R · Take some off', ticker: 'NVDA · Launchpad', ok: true, said: null, was: '' },
      { name: '3R · Take some off', ticker: 'NVDA · Launchpad', ok: true, said: null, was: '' },
      { name: 'Trail · Sell the rest', ticker: 'NVDA · Launchpad', ok: true, said: null, was: '' },
      { name: 'Stop · Sell the rest', ticker: 'AMD · Launchpad', ok: false, said: 'hold', was: '' },
    ])
    expect(tradeLine(trades[0])).toBe('NVDA · Launchpad: some off at 2R and 3R. The rest out at +2.4R on the trail.')
    expect(tradeLine(trades[1])).toBe('AMD · Launchpad: all of it still held when the plan was out.')
    expect(tradeLine(trades[2])).toBe('Kicker: not scored, so not played.')
    expect(namedLine(tally(trades))).toBe('You named 1 of 2 setups before the trade.')
  })
  it('titles the run', () => {
    expect(storyVerdict(0, 0)).toBe('Nothing to manage')
    expect(storyVerdict(8, 8)).toBe('Legendary')
    expect(storyVerdict(6, 8)).toBe('Disciplined')
    expect(storyVerdict(4, 8)).toBe('Getting there')
    expect(storyVerdict(1, 8)).toBe('Tough run')
  })
  it('fills the level bar from the first scored answer to the game run grant', () => {
    expect(levelAfter({ before: 990, after: 1000 }, { xp_gained: 6, progress: { xp: 1006 } })).toEqual({ before: 990, after: 1006 })
    expect(levelAfter(null, { xp_gained: 6, progress: { xp: 1006 } })).toEqual({ before: 1000, after: 1006 })
    expect(levelAfter(null, {})).toBe(null)
    expect(levelAfter(null, { progress: { xp: '9' } })).toBe(null)
  })
  it('makes one run id per run', () => {
    expect(runIdOf(1731100000000, 2)).toBe(`story-${(1731100000000).toString(36)}-2`)
    expect(runIdOf(1731100000000, 2).length).toBeLessThanOrEqual(64)
  })
})

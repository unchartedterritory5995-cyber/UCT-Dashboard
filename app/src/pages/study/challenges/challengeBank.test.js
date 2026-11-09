/** Challenge bank rails: the pools are built from skill sessions, an attempt lands in the item's own session, and
 *  Blitz's question mix never invents a market fact (names from the skill, verdicts from the server or the bars). */
import { describe, it, expect, vi } from 'vitest'
import { buildBlitzQuestions, blitzMult, fetchSpotPool, scoreAttempt, SETUP_NAMES, setupName } from './challengeBank'

const bars = (n) => Array.from({ length: n }, (_, i) => ({ t: 20250101 + i, o: 10 + i, h: 11 + i, l: 9 + i, c: 10.5 + i, v: 100 }))
const spotItem = (id, skill) => ({ id, type: 'spot', skill_id: skill, prompt_json: { q: 'Does it fire?', choices: ['Yes', 'No'] }, bars: { symbol: id, tf: 'D', bars: bars(30) } })

describe('challenge bank', () => {
  it('fetchSpotPool asks one skill session per setup and pools the chart items with their session id and normalized bars', async () => {
    const calls = []
    const fetcher = vi.fn(async (url, opts) => {
      calls.push(opts.body)
      return { session_id: `s-${opts.body.skill_id}`, items: [spotItem(`i-${opts.body.skill_id}`, opts.body.skill_id), { id: 'x', type: 'recall', prompt_json: {} }] }
    })
    const pool = await fetchSpotPool(['setup.family3.kicker', 'setup.family1.launchpad'], 5, fetcher, 7)
    expect(calls).toEqual([
      { kind: 'skill', skill_id: 'setup.family3.kicker', size: 5 },
      { kind: 'skill', skill_id: 'setup.family1.launchpad', size: 5 },
    ])
    expect(pool).toHaveLength(2)
    const k = pool.find((p) => p.skill === 'setup.family3.kicker')
    expect(k.name).toBe('Kicker')
    expect(k.sessionId).toBe('s-setup.family3.kicker')
    expect(k.bars[0].t).toBe('2025-01-01')     // YYYYMMDD normalized to the day key the chart uses
    expect(k.choices).toEqual(['Yes', 'No'])
  })

  it('a signed-out session (401) is surfaced, not swallowed into an empty pool', async () => {
    const err = Object.assign(new Error('401'), { status: 401 })
    const fetcher = vi.fn(async () => { throw err })
    await expect(fetchSpotPool(['setup.family3.kicker'], 5, fetcher)).rejects.toBe(err)
  })

  it('the sessions are asked ONE AT A TIME, a skill that fails for a server reason is skipped, and only all-fail is an error', async () => {
    let inFlight = 0, peak = 0
    const fetcher = vi.fn(async (url, opts) => {
      inFlight += 1; peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight -= 1
      if (opts.body.skill_id === 'setup.family1.launchpad') throw Object.assign(new Error('500'), { status: 500 })
      return { session_id: `s-${opts.body.skill_id}`, items: [spotItem(`i-${opts.body.skill_id}`, opts.body.skill_id)] }
    })
    const pool = await fetchSpotPool(['setup.family3.kicker', 'setup.family1.launchpad', 'setup.family4.oops'], 5, fetcher, 3)
    expect(peak).toBe(1)
    expect(pool.map((p) => p.skill).sort()).toEqual(['setup.family3.kicker', 'setup.family4.oops'])
    const allFail = vi.fn(async () => { throw Object.assign(new Error('500'), { status: 500 }) })
    await expect(fetchSpotPool(['setup.family3.kicker'], 5, allFail)).rejects.toMatchObject({ status: 500 })
  })

  it('scoreAttempt posts the answer into the item\'s session and normalizes the forward bars', async () => {
    const fetcher = vi.fn(async () => ({ correct: true, reveal: { forward_bars: [{ t: 20250201, o: 1, h: 2, l: 0.5, c: 1.5, v: 1 }] } }))
    const r = await scoreAttempt({ id: 'i1', sessionId: 's1' }, { choice: 'Yes' }, 1234.6, fetcher)
    expect(fetcher).toHaveBeenCalledWith('/api/study/attempts', { method: 'POST', body: { item_id: 'i1', answer: { choice: 'Yes' }, time_ms: 1235, session_id: 's1' } })
    expect(r.correct).toBe(true)
    expect(r.forward).toEqual([{ t: '2025-02-01', o: 1, h: 2, l: 0.5, c: 1.5, v: 1 }])
  })

  it('a bank spot item never becomes a "what fired" question: it may be a chart where the setup does not fire', () => {
    const spots = Array.from({ length: 8 }, (_, i) => ({ id: `s${i}`, skill: 'setup.family3.kicker', name: 'Kicker', q: 'Does a Kicker fire?', choices: ['Yes', 'No'], bars: bars(12), sessionId: 's' }))
    const qs = buildBlitzQuestions(spots, [], 7)
    expect(qs.some((q) => q.kind === 'name')).toBe(false)
    expect(qs.filter((q) => q.kind === 'fires')).toHaveLength(4)
  })

  it('buildBlitzQuestions mixes the kinds deterministically per seed: name questions carry the item\'s own setup among four names, facts are measured from the bars, server kinds carry no local answer', () => {
    const spots = Array.from({ length: 8 }, (_, i) => ({ id: `s${i}`, skill: 'setup.family3.kicker', name: 'Kicker', q: 'Does a Kicker fire?', choices: ['Yes', 'No'], bars: bars(12), sessionId: 's' }))
    const recalls = [{ id: 'r1', skill: 'vocab.candle', name: 'Candle name', q: 'Which name fits?', choices: ['Hammer', 'Doji', 'Marubozu', 'Spinning top'], bars: bars(12), sessionId: 'r', highlight: 1 }]
    const named = [{ id: 'n1', skill: 'setup.family3.kicker', name: 'Kicker', bars: bars(12), sessionId: 'n' }]
    const a = buildBlitzQuestions(spots, recalls, 42, named)
    const b = buildBlitzQuestions(spots, recalls, 42, named)
    expect(a.map((q) => q.kind)).toEqual(b.map((q) => q.kind))
    const kinds = new Set(a.map((q) => q.kind))
    expect([...kinds].sort()).toEqual(['fact', 'fires', 'name', 'recall'])
    for (const q of a.filter((x) => x.kind === 'name')) {
      expect(q.choices).toHaveLength(4)
      expect(q.choices).toContain('Kicker')
      expect(q.choices.every((c) => SETUP_NAMES.includes(c))).toBe(true)
      expect(q.answer).toBe('Kicker')
      expect(q.server).toBe(false)
    }
    for (const q of a.filter((x) => x.kind === 'fact')) {
      // the fixture's candles all close green and above yesterday's high: the measured answer says so
      expect(['Green', 'Yes']).toContain(q.answer)
    }
    for (const q of a.filter((x) => x.server)) expect(q.answer).toBeUndefined()
  })

  it('the multiplier climbs 1, 2, 3, 4, 5 with the combo and setupName falls back to the skill tail', () => {
    expect([0, 1, 3, 6, 9].map(blitzMult)).toEqual([1, 2, 3, 4, 5])
    expect(setupName('setup.family9.power_gap')).toBe('power gap')
  })
})

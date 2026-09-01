// app/src/components/research/sectionLeads.test.js
//
// Every builder is a pure function of a payload its canvas already renders, so
// the whole contract is testable without a DOM. Two rules are asserted on ALL
// of them, because both have shipped as bugs on this branch before:
//   • a missing value returns null, never a hedging sentence;
//   • a GENUINE zero is a value, never treated as missing (`Number(null) === 0`).
import { describe, it, expect } from 'vitest'
import { historyLead, streetLead, catalystsLead } from './sectionLeads'

describe('historyLead', () => {
  const q = (over = {}) => ({ reported: true, surprise_pct: 4, reaction_pct: 3, ...over })

  it('states the beat record and the price record in one sentence', () => {
    const quarters = [
      q({ surprise_pct: 4, reaction_pct: 5 }),
      q({ surprise_pct: 2, reaction_pct: -3 }),
      q({ surprise_pct: -1, reaction_pct: -2 }),
      q({ surprise_pct: 6, reaction_pct: 8 }),
    ]
    const s = historyLead('DELL', quarters)
    expect(s).toMatch(/DELL beat in 3 of its last 4 reported quarters/)
    expect(s).toMatch(/the stock rose after 2 of its last 4/)
    expect(s).toMatch(/±4\.5% on average/)
  })

  it('is the combination that matters — beats up, stock down, said plainly', () => {
    // The single most useful thing this panel can say, and it is invisible
    // while the two series are read separately.
    const quarters = [
      q({ surprise_pct: 5, reaction_pct: -4 }),
      q({ surprise_pct: 3, reaction_pct: -6 }),
    ]
    const s = historyLead('X', quarters)
    expect(s).toMatch(/beat in 2 of its last 2/)
    expect(s).toMatch(/rose after none of its last 2/)
  })

  it('ignores quarters that have not reported', () => {
    const quarters = [q(), { reported: false, reaction_pct: null }]
    expect(historyLead('X', quarters)).toMatch(/last 1 reported quarter\b/)
  })

  it('judges a beat from surprise_pct when present, and from the PAIR otherwise', () => {
    // ⛔ never from `eps_actual > eps_estimate` alone: a quarter with NO
    // estimate would then count as a beat.
    const noEstimate = [{ reported: true, eps_actual: 1.2, eps_estimate: null, reaction_pct: 1 }]
    expect(historyLead('X', noEstimate)).not.toMatch(/beat in/)
    const withPair = [{ reported: true, eps_actual: 1.2, eps_estimate: 1.0, reaction_pct: 1 }]
    expect(historyLead('X', withPair)).toMatch(/beat in 1 of its last 1/)
  })

  it('treats a genuine 0% reaction as a value, not a missing one', () => {
    const s = historyLead('X', [q({ reaction_pct: 0 })])
    expect(s).toMatch(/rose after none of its last 1/)   // 0 is not > 0
    expect(s).toMatch(/±0\.0% on average/)               // and it IS averaged
  })

  it('returns null when nothing has reported', () => {
    expect(historyLead('X', [{ reported: false }])).toBeNull()
    expect(historyLead('X', [])).toBeNull()
    expect(historyLead('X', null)).toBeNull()
  })
})

describe('streetLead', () => {
  const ratings = (over = {}) => ({
    composite: 91,
    components: { eps: 98, rs: 96, growth: 95, value: 92 },
    checkup: [{ status: 'pass' }, { status: 'pass' }, { status: 'fail' }],
    ...over,
  })

  it('places the composite on its scale and names the two strongest inputs', () => {
    const s = streetLead('DELL', ratings())
    expect(s).toMatch(/DELL rates 91 of 99 on the UCT composite/)
    expect(s).toMatch(/strongest on EPS strength \(98\) and relative strength \(96\)/)
    expect(s).toMatch(/passes 2 of 3 checkup rules/)
  })

  it('excludes a rule that could not be computed from BOTH sides of the ratio', () => {
    const s = streetLead('X', ratings({ checkup: [{ status: 'pass' }, { status: 'unknown' }] }))
    expect(s).toMatch(/passes 1 of 1 checkup rule\b/)
  })

  it('omits the checkup clause entirely when nothing was decided', () => {
    const s = streetLead('X', ratings({ checkup: [{ status: 'unknown' }] }))
    expect(s).not.toMatch(/checkup/)
  })

  it('treats a composite of 0 as a real score, not a missing one', () => {
    expect(streetLead('X', ratings({ composite: 0 }))).toMatch(/rates 0 of 99/)
  })

  it('returns null without a composite — never a sentence about nothing', () => {
    expect(streetLead('X', ratings({ composite: null }))).toBeNull()
    expect(streetLead('X', null)).toBeNull()
  })

  it('survives a payload with no components at all', () => {
    const s = streetLead('X', { composite: 40 })
    expect(s).toMatch(/rates 40 of 99/)
    expect(s).not.toMatch(/strongest/)
  })
})

describe('catalystsLead', () => {
  const ev = (over = {}) => ({ title: 'Q2 beat and raise', move_pct: 4.2, ...over })

  it('names the biggest mover, which the reverse-chronological feed buries', () => {
    const s = catalystsLead('DELL', [
      ev({ move_pct: 4.2, title: 'Q2 beat and raise' }),
      ev({ move_pct: 9.4, title: 'AI server order from a hyperscaler' }),
      ev({ move_pct: -2.1, title: 'Analyst downgrade' }),
    ])
    expect(s).toMatch(/^3 catalysts on file for DELL\./)
    expect(s).toMatch(/biggest moved it \+9\.4% — AI server order from a hyperscaler/)
  })

  it('ranks by MAGNITUDE — a big down day answers "what moved it" too', () => {
    const s = catalystsLead('X', [ev({ move_pct: 5 }), ev({ move_pct: -12.5, title: 'Guidance cut' })])
    expect(s).toMatch(/moved it -12\.5% — Guidance cut/)
  })

  it('singularises one catalyst', () => {
    expect(catalystsLead('X', [ev()])).toMatch(/^1 catalyst on file/)
  })

  it('trims a long headline on a word boundary rather than running three lines', () => {
    const long = 'A very long provider headline that simply keeps going and going well past any reasonable lead length'
    const s = catalystsLead('X', [ev({ title: long })])
    const tail = s.split('— ')[1]
    expect(tail.length).toBeLessThanOrEqual(73)
    expect(tail).toMatch(/…$/)
    expect(tail).not.toMatch(/\s…$/)   // trimmed at a word, no dangling space
  })

  it('still counts when no event carries a move', () => {
    const s = catalystsLead('X', [{ title: 'Something happened' }])
    expect(s).toBe('1 catalyst on file for X.')
  })

  it('treats a genuine 0% move as a value', () => {
    expect(catalystsLead('X', [ev({ move_pct: 0, title: 'Flat day' })])).toMatch(/moved it 0\.0%/)
  })

  it('returns null for an empty or absent feed', () => {
    expect(catalystsLead('X', [])).toBeNull()
    expect(catalystsLead('X', null)).toBeNull()
  })
})

/**
 * The Read — the composition, tested WITHOUT RENDERING ANYTHING.
 *
 * The strip is a `<p>`; the risk is entirely in the sentences. Prose sounds
 * authoritative in a way a bar chart does not, so these tests are written to
 * fail if the module ever invents something rather than to confirm that it
 * usually does not:
 *
 *   1. each clause matches ITS OWN source function's output, on a fixture where
 *      the three lenses disagree with each other;
 *   2. a fixture missing a series produces a paragraph with that clause ABSENT
 *      — not a hedged, numberless version of it;
 *   3. every number in the produced paragraph traces back to the input.
 *
 * (3) is the one that makes rule 2 real rather than aspirational, and it
 * carries a control proving the tracer can actually catch an invented number.
 */
import { describe, it, expect } from 'vitest'
import { composeRead, ordinal } from './theRead'
import { quadrantOf, medianOf, metricValue, percentileRank, LADDER_MIN_READINGS } from './breadthViewShared'
import { zscore, divergenceRuns, MIN_SESSIONS } from './divergence'
import { scanEvents, EVENT_DEFS } from './breadthEvents'
import { ROTATION_PANELS, rotationReading } from './rotation'
import { STYLES, optionsSchema, optionDefaults } from './viewMetricConfig'
import { HM_METRICS } from '../heatmapMetrics'

// ── the fixture ─────────────────────────────────────────────────────────────
//
// Deliberately built so the three lenses tell DIFFERENT stories at once:
//   · the Regime Clock is in DISTRIBUTION (level 52.1, momentum −4.3)
//   · the Divergence lens has an ACTIVE price-leads run
//   · the Event Ledger has nothing today and a follow-through 18 sessions back
//   · Rotation is BROADENING (rsp/spy rising)
// A paragraph that quietly harmonised them would be caught by the per-clause
// assertions below, which each recompute from the source function.
const N = 60
const mkRow = (i) => ({
  date: new Date(Date.UTC(2026, 7, 28) - i * 86400000).toISOString().slice(0, 10),
  // level: 52.1 today, 56.4 twenty sessions back  ⇒ momentum −4.3, Distribution
  pct_above_50sma: 52.1 + i * 0.215,
  pct_above_200sma: 60,
  // price rising into a falling participation ⇒ a sustained price-leads run
  sp500_close: 5000 + (N - 1 - i) * 5,
  qqq_close: 400 + (N - 1 - i),
  // newest reading is the MAXIMUM of its own history ⇒ 100th percentile
  breadth_score: 88 - i * 0.3,
  uct_exposure: 60,
  vix: 16 + i * 0.1,
  mcclellan_osc: 10,                     // tier g1 — neither ledger extreme
  advancing: 3000, declining: 1500,      // Zweig measurable, never fires
  up_vol_ratio: 1.8,                     // 64% up volume — neither 90% day
  new_52w_highs: 10 + i, new_52w_lows: 5 + i,   // newest is the LOW of the window
  up_4pct_today: 200, down_4pct_today: 90,
  is_ftd: i === 18 ? 1 : 0,              // the one past firing
  rsp_spy_ratio: 0.62 + (N - 1 - i) * 0.0002,   // +0.004 over 20 ⇒ broadening
  iwm_qqq_ratio: 0.55, vxn: 20,
})
const ROWS = Array.from({ length: N }, (_, i) => mkRow(i))

const LADDER_KEYS = ['breadth_score', 'pct_above_50sma', 'vix', 'new_52w_highs']
const LADDER_METRICS = HM_METRICS.filter(m => LADDER_KEYS.includes(m.key))

const ANALOGUES = {
  reference_date: '2026-08-28',
  analogues: [
    { date: '2025-03-11', similarity: 92.4, forward_returns: { fwd_20d: 4.5 } },
    { date: '2024-11-02', similarity: 88.1, forward_returns: { fwd_20d: -2.1 } },
  ],
}
const ATTRIBUTION = {
  ok: true, date: '2026-08-28', total: 80, min_weight_met: true,
  components: [
    { key: 'vix', label: 'VIX (inverted)', points: 9, max_points: 10, present: true },
    { key: 'hi_ratio', label: 'High/low ratio', points: 3, max_points: 15, present: true },
  ],
  prev: { date: '2026-08-27', total: 70, components: [] },
}

const base = (over = {}) => ({
  rows: ROWS, rowIdx: 0, optionsFor: optionDefaults, ladderMetrics: LADDER_METRICS, ...over,
})
const read = (over) => composeRead(base(over))
const clause = (r, key) => r.clauses.find(c => c.key === key) ?? null
const keys = (r) => r.clauses.map(c => c.key)

// ── clauses match their own source functions ────────────────────────────────

describe('the paragraph', () => {
  it('reads as one short paragraph, in a fixed order', () => {
    // Pinned in full so a reviewer can see exactly what ships — and so a
    // reworded clause has to be a deliberate edit here rather than a drift.
    const r = read({ analogueData: ANALOGUES, attributionData: ATTRIBUTION })
    expect(r.text).toBe(
      'Distribution — % above 50 SMA at 52.1, down 4.3 points over 20 sessions. '
      + 'Price has led breadth for 21 sessions. '
      + 'No named event today; the last was Follow-Through Day, 18 sessions ago. '
      + 'Equal vs Cap +0.004 over 20 sessions — broadening. '
      + 'Furthest from its own median on the ladder: Health, 100th percentile of 60 readings. '
      + 'Score attribution 80, +10.0 from the prior session (2 of 2 inputs). '
      + 'Analogues to 2026-08-28: 1 of 2 were higher 20 days later, median +1.2%.',
    )
    expect(r.clauses.map(c => c.key)).toEqual(
      ['regime', 'divergence', 'events', 'rotation', 'percentile', 'attribution', 'analogues'])
  })

  it('names the source function behind every clause it emits', () => {
    // The report of what The Read says is only checkable if each sentence can
    // be traced to the lens that owns it.
    for (const c of read({ analogueData: ANALOGUES, attributionData: ATTRIBUTION }).clauses) {
      expect(typeof c.source, `clause "${c.key}" names no source`).toBe('string')
      expect(c.source.length).toBeGreaterThan(3)
    }
  })
})

describe('every clause says what its own source function says', () => {
  it('names the regime `quadrantOf` names, with the level and momentum behind it', () => {
    const win = ROWS
    const now = win[0].pct_above_50sma, prior = win[20].pct_above_50sma
    const expected = quadrantOf(now, now - prior)

    const c = clause(read(), 'regime')
    expect(c).toBeTruthy()
    expect(expected).toBe('Distribution')                 // the fixture's own story
    expect(c.text).toContain(expected)
    expect(c.text).toContain(now.toFixed(1))
    expect(c.text).toContain(Math.abs(now - prior).toFixed(1))
    expect(c.text).toContain('20 sessions')
  })

  it('reports the run `divergenceRuns` reports, in the direction it reports', () => {
    const asc = [...ROWS].reverse()
    const runs = divergenceRuns(
      zscore(asc.map(r => r.sp500_close)),
      zscore(asc.map(r => r.pct_above_50sma)), 5)
    const last = runs[runs.length - 1]
    expect(last.end).toBe(asc.length - 1)                 // it IS active
    expect(last.dir).toBe('price-leads')

    const c = clause(read(), 'divergence')
    expect(c.text).toBe(`Price has led breadth for ${last.end - last.start + 1} sessions.`)
  })

  it('names the event `scanEvents` says fired last, and how long ago it says', () => {
    const events = scanEvents(ROWS, { families: null }).filter(e => !e.unavailable)
    const last = events.filter(e => e.lastIdx != null)
      .reduce((a, b) => (a == null || b.lastIdx < a.lastIdx ? b : a), null)
    expect(events.some(e => e.firedToday)).toBe(false)
    expect(last.label).toBe('Follow-Through Day')
    expect(last.sessionsAgo).toBe(18)

    expect(clause(read(), 'events').text)
      .toBe('No named event today; the last was Follow-Through Day, 18 sessions ago.')
  })

  it('quotes the rotation panel’s OWN direction word and its own delta', () => {
    const r = rotationReading(ROWS, ROTATION_PANELS[0], 20)
    expect(r.verdict).toBe(ROTATION_PANELS[0].up)          // rising RSP/SPY
    const c = clause(read(), 'rotation')
    expect(c.text).toContain(r.label)
    expect(c.text).toContain(r.delta.toFixed(3))
    // the word is the panel's, lowercased — never a word this module chose
    expect(c.text).toContain(r.verdict.split(' ')[0].toLowerCase())
  })

  it('reports the percentile `percentileRank` computes, for the reading furthest from its median', () => {
    const ranked = LADDER_METRICS.map(m => {
      const vals = ROWS.map(r => metricValue(m, r)).filter(v => v != null)
      return { m, pct: percentileRank([...vals].sort((a, b) => a - b), metricValue(m, ROWS[0])), n: vals.length }
    })
    const top = ranked.reduce((a, b) => (Math.abs(b.pct - 50) > Math.abs(a.pct - 50) ? b : a))
    const c = clause(read(), 'percentile')
    expect(c.text).toContain(top.m.label)
    expect(c.text).toContain(ordinal(top.pct))
    expect(c.text).toContain(`${top.n} readings`)
  })

  it('summarises the analogue payload with the deck’s own median', () => {
    const withReturn = ANALOGUES.analogues.filter(a => a.forward_returns.fwd_20d != null)
    const median = medianOf(withReturn.map(a => a.forward_returns.fwd_20d))
    const c = clause(read({ analogueData: ANALOGUES }), 'analogues')
    expect(c.text).toContain(`1 of ${withReturn.length} were higher`)
    expect(c.text).toContain(median.toFixed(1))
    // ⛔ the reference date, because the server matches the LATEST session and
    // never the cursor — the deck says so in its own header.
    expect(c.text).toContain(ANALOGUES.reference_date)
  })

  it('reports the attribution total and its move, off the server’s own numbers', () => {
    const c = clause(read({ attributionData: ATTRIBUTION }), 'attribution')
    expect(c.text).toBe('Score attribution 80, +10.0 from the prior session (2 of 2 inputs).')
  })

  it('reads the lens’s CONFIGURED options, not a default of its own', () => {
    const custom = (style) => ({ ...optionDefaults(style), ...(style === 'clock' ? { level: 'pct_above_200sma', rocWindow: 10 } : {}) })
    const c = clause(read({ optionsFor: custom }), 'regime')
    expect(c.text).toContain('% above 200 SMA')
    expect(c.text).toContain('10 sessions')
    // pct_above_200sma is flat in the fixture ⇒ the Clock's own quadrant for it
    expect(c.text).toContain(quadrantOf(60, 0))
  })
})

// ── absence omits, it never hedges ──────────────────────────────────────────

const strip = (key) => ROWS.map(r => { const c = { ...r }; delete c[key]; return c })

describe('a clause whose source is absent is omitted, never softened', () => {
  // ⚠️ NOT 'broad' / 'narrow': those are the Rotation panel's OWN declared
  // words ("Broadening — the average stock is gaining on the index"), quoted
  // verbatim from the card the reader can see. A sweep that flagged them would
  // be crying wolf at the one clause doing exactly what rule 3 asks.
  const HEDGES = [
    'weak', 'strong', 'improving', 'deteriorating', 'roughly',
    'about', 'around', 'appears', 'seems', 'largely', 'somewhat', 'generally',
  ]

  it('drops the regime and divergence clauses when the level series is gone', () => {
    const r = read({ rows: strip('pct_above_50sma') })
    expect(keys(r)).not.toContain('regime')
    expect(keys(r)).not.toContain('divergence')
    // …and says nothing vaguer in their place
    for (const q of ['Expansion', 'Recovery', 'Distribution', 'Contraction']) {
      expect(r.text).not.toContain(q)
    }
    expect(r.text).not.toContain('in step')
    for (const h of HEDGES) expect(r.text.toLowerCase()).not.toContain(h)
  })

  it('drops only the divergence clause when the PRICE series is gone', () => {
    const r = read({ rows: strip('sp500_close') })
    expect(keys(r)).not.toContain('divergence')
    expect(keys(r)).toContain('regime')      // its own source is untouched
  })

  it('refuses "in step" on a series that was never reported, rather than reading agreement', () => {
    // 🔴 THE SUBTLE ONE. `zscore` of an all-null series is an array of nulls,
    // `divergenceRuns` then finds no runs, and the naive composition states —
    // in prose, with a number — that price and breadth agree. They may; nobody
    // measured. Coverage is checked, not just window depth.
    const r = read({ rows: ROWS.map(x => ({ ...x, sp500_close: null })) })
    expect(keys(r)).not.toContain('divergence')
    expect(r.text).not.toContain('in step')
  })

  it('drops the rotation clause when neither ratio nor the vol pair is reported', () => {
    const bare = ROWS.map(r => {
      const c = { ...r }
      for (const k of ['rsp_spy_ratio', 'iwm_qqq_ratio', 'vxn']) delete c[k]
      return c
    })
    expect(keys(read({ rows: bare }))).not.toContain('rotation')
  })

  it('drops the percentile clause when no metric has enough readings', () => {
    const shallow = ROWS.slice(0, LADDER_MIN_READINGS - 1)
    expect(keys(read({ rows: shallow }))).not.toContain('percentile')
  })

  it('drops the events clause when nothing in the window could be evaluated', () => {
    // Every event's input removed ⇒ `scanEvents` marks them all `unavailable`.
    // "Nothing fired" and "nothing could be checked" are different sentences.
    const blind = ROWS.map(r => ({ date: r.date }))
    const r = read({ rows: blind })
    expect(keys(r)).not.toContain('events')
    expect(r.text).not.toContain('No named event')
  })

  it('drops both endpoint clauses when the SWR cache holds nothing', () => {
    const k = keys(read())
    expect(k).not.toContain('analogues')
    expect(k).not.toContain('attribution')
  })

  it('drops the analogue clause when the payload cannot say what it matched against', () => {
    const noRef = { ...ANALOGUES, reference_date: undefined }
    expect(keys(read({ analogueData: noRef }))).not.toContain('analogues')
  })

  it('drops the attribution clause when the server declined to score the session', () => {
    const unscored = { ...ATTRIBUTION, total: null, min_weight_met: false }
    expect(keys(read({ attributionData: unscored }))).not.toContain('attribution')
    // …and on the shape a 402/500 body actually has
    expect(keys(read({ attributionData: { detail: 'Subscription required' } }))).not.toContain('attribution')
  })

  it('a window with nothing readable in it composes an EMPTY read, not a vague one', () => {
    const r = read({ rows: ROWS.slice(0, 3).map(x => ({ date: x.date })) })
    expect(r.clauses).toEqual([])
    expect(r.text).toBe('')
    expect(r.windowLength).toBe(3)
  })

  it('a SHORT window still says only what it can measure there', () => {
    // The control on the test above: three sessions of full data is not
    // "nothing readable" — the events scan and the rotation delta both still
    // hold over three sessions, and both name the span they actually cover.
    const r = read({ rows: ROWS.slice(0, 3) })
    expect(keys(r)).toEqual(['events', 'rotation'])
    expect(r.text).toContain('3 sessions')      // the span it really read
    expect(r.text).toContain('2 sessions')      // rotation's measured span
  })

  it('refuses divergence on exactly the window depth the lens refuses on', () => {
    expect(keys(read({ rows: ROWS.slice(0, MIN_SESSIONS - 1) }))).not.toContain('divergence')
    expect(keys(read({ rows: ROWS.slice(0, MIN_SESSIONS) }))).toContain('divergence')
  })
})

// ── the cursor ──────────────────────────────────────────────────────────────

describe('the cursor', () => {
  it('reads the window AS OF the cursor, never sessions after it', () => {
    const r = read({ rowIdx: 30 })
    expect(r.windowLength).toBe(N - 30)
    // the level clause must quote the CURSOR's session, not the newest one
    expect(clause(r, 'regime').text).toContain(ROWS[30].pct_above_50sma.toFixed(1))
    expect(clause(r, 'regime').text).not.toContain(ROWS[0].pct_above_50sma.toFixed(1))
  })
})

// ── it reads the instruments; it does not forecast ──────────────────────────

describe('no clause adds an opinion its view does not already assert', () => {
  const FORECAST = [
    'suggest', 'expect', 'likely', 'should', 'watch for', 'risk of', 'caution',
    'buy', 'sell', 'ahead', 'signal a', 'warn', 'means that', 'because',
  ]
  it('the fullest paragraph the fixture can produce carries no forecast', () => {
    const r = read({ analogueData: ANALOGUES, attributionData: ATTRIBUTION })
    expect(r.clauses).toHaveLength(7)      // every clause present — nothing hidden
    const lower = r.text.toLowerCase()
    for (const w of FORECAST) expect(lower, `"${w}" is a claim no lens makes`).not.toContain(w)
  })
})

// ── the number-traceability rail ────────────────────────────────────────────
//
// ⭐ THIS IS WHAT MAKES RULE 2 A MEASUREMENT RATHER THAN AN INTENTION. Every
// number in the paragraph is extracted and matched against a set the test
// builds ITSELF, from the fixture and the source functions — not from anything
// `theRead.js` returns, which would be the module grading its own homework.

// Names carry digits: "% above 50 SMA", "52W Highs (Close)", "90% Up Volume
// Day", "20 days". Those digits belong to a NAME, not to a claim about the tape.
//
// ⛔ AND THE FIX IS TO ALLOW THEM, NOT TO DELETE THE NAMES FROM THE TEXT. The
// first version stripped every registry name before reading numbers, and the
// registry contains bare numeric labels ('3', '5', '10' — the Radar's spoke
// count, the deck's match count), so "52.1" was quietly cut down to "2.1" and
// "4.3" to "4". A tracer that edits the sentence before checking it can delete
// the very claim it exists to check. Every number in the paragraph is read,
// and the digits a name is entitled to are added to the allowed set instead.
const NAMES = (() => {
  const out = new Set()
  for (const s of STYLES) for (const o of optionsSchema(s)) for (const c of (o.choices ?? [])) out.add(String(c.label))
  for (const m of HM_METRICS) if (m.label) out.add(String(m.label))
  for (const e of EVENT_DEFS) out.add(e.label)
  for (const p of ROTATION_PANELS) { out.add(p.label); out.add(p.sub); out.add(p.up); out.add(p.down) }
  return [...out]
})()
const NAME_DIGITS = new Set(
  NAMES.flatMap(n => (String(n).match(/\d+(?:\.\d+)?/g) ?? []).map(Number)))

function numbersIn(text) {
  const dates = text.match(/\d{4}-\d{2}-\d{2}/g) ?? []
  const t = text.replace(/\d{4}-\d{2}-\d{2}/g, ' ')
  const nums = (t.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number)
  return { nums, dates }
}
const untraceable = (text, allowed) =>
  numbersIn(text).nums.filter(n => !allowed.has(n) && !NAME_DIGITS.has(n))

function traceable(input) {
  const set = new Set()
  const add = (...vs) => vs.forEach(v => {
    if (v == null || isNaN(Number(v))) return
    const n = Number(v)
    for (const x of [n, Math.abs(n)]) {
      set.add(x); set.add(+x.toFixed(0)); set.add(+x.toFixed(1)); set.add(+x.toFixed(3))
    }
  })

  const win = input.rows.slice(input.rowIdx ?? 0)
  const asc = [...win].reverse()
  add(win.length)

  const clockOpts = input.optionsFor('clock')
  const roc = Number(clockOpts.rocWindow)
  add(roc, win[0]?.[clockOpts.level], win[roc]?.[clockOpts.level])
  if (win[0]?.[clockOpts.level] != null && win[roc]?.[clockOpts.level] != null) {
    add(win[0][clockOpts.level] - win[roc][clockOpts.level])
  }

  const dv = input.optionsFor('divergence')
  add(Number(dv.minGap), asc.length)
  for (const r of divergenceRuns(zscore(asc.map(x => x[dv.price])),
                                 zscore(asc.map(x => x[dv.participation])), Number(dv.minGap))) {
    add(r.end - r.start + 1)
  }

  const ev = input.optionsFor('events')
  const events = scanEvents(win, { families: ev.families && ev.families !== 'all' ? [ev.families] : null })
  for (const e of events) add(e.sessionsAgo, e.windowLength)
  add(events.filter(e => !e.unavailable && e.firedToday).length)

  const ro = input.optionsFor('rotation')
  for (const p of ROTATION_PANELS) {
    const r = rotationReading(win, p, ro.lookback)
    if (r) add(r.delta, r.measured, r.now, r.prior)
  }

  for (const m of input.ladderMetrics) {
    const vals = win.map(r => metricValue(m, r)).filter(v => v != null)
    const today = metricValue(m, win[0])
    if (vals.length < LADDER_MIN_READINGS || today == null) continue
    add(vals.length, percentileRank([...vals].sort((a, b) => a - b), today))
  }

  const at = input.attributionData
  if (at?.components) {
    add(at.total, at.prev?.total, at.components.length, at.components.filter(c => c.present).length)
    if (at.total != null && at.prev?.total != null) add(at.total - at.prev.total)
  }

  const an = input.analogueData
  if (an?.analogues) {
    const h = input.optionsFor('analogues').horizon
    const wr = an.analogues.filter(a => a.forward_returns?.[h] != null)
    add(wr.length, wr.filter(a => Number(a.forward_returns[h]) > 0).length,
        medianOf(wr.map(a => Number(a.forward_returns[h]))))
  }
  return set
}

const datesIn = (input) => new Set([
  ...input.rows.map(r => r.date),
  input.analogueData?.reference_date,
  input.attributionData?.date, input.attributionData?.prev?.date,
].filter(Boolean))

describe('no number appears that cannot be traced to the input', () => {
  const cases = [
    ['the full paragraph', { analogueData: ANALOGUES, attributionData: ATTRIBUTION }],
    ['with the cursor moved back', { rowIdx: 30, analogueData: ANALOGUES, attributionData: ATTRIBUTION }],
    ['with the price series gone', { rows: strip('sp500_close') }],
    ['with an event firing today', { rows: ROWS.map((r, i) => ({ ...r, is_ftd: i === 0 ? 1 : 0 })) }],
    ['on a 25-session window', { rows: ROWS.slice(0, 25) }],
    ['with a different level series and momentum window',
      { optionsFor: (s) => ({ ...optionDefaults(s), ...(s === 'clock' ? { level: 'breadth_score', rocWindow: 40 } : {}) }) }],
  ]

  for (const [name, over] of cases) {
    it(`${name}: every number is in the fixture or derived from it`, () => {
      const input = base(over)
      const r = composeRead(input)
      const allowed = traceable(input)
      expect(untraceable(r.text, allowed), `untraceable numbers in: ${r.text}`).toEqual([])
      expect(numbersIn(r.text).dates.filter(d => !datesIn(input).has(d)),
        'a date nobody supplied').toEqual([])
    })
  }

  // ⛔ WITHOUT THIS THE LOOP ABOVE COULD PASS BECAUSE THE TRACER SEES NOTHING.
  it('the tracer reads real numbers out of the paragraph, and catches an invented one', () => {
    const input = base({ analogueData: ANALOGUES, attributionData: ATTRIBUTION })
    const r = composeRead(input)
    expect(numbersIn(r.text).nums.length,
      'the tracer extracted nothing — it would pass on anything').toBeGreaterThan(8)

    const allowed = traceable(input)
    // A sentence of exactly the shape a hallucinating composer would produce.
    expect(untraceable('Participation is 91.7% and falling 13.9 points over 7 sessions.', allowed))
      .toEqual([91.7, 13.9])
    // …and an invented DATE is caught too.
    expect(numbersIn('Analogues to 1999-01-04:').dates
      .filter(d => !datesIn(input).has(d))).toEqual(['1999-01-04'])
  })

  it('reads every number in the sentence, including the ones a name is entitled to', () => {
    // The allowance is per-NUMBER, never a rewrite of the text: 52.1 and 4.3
    // must survive intact beside the 50 that belongs to the series name.
    expect(numbersIn('% above 50 SMA at 52.1, down 4.3 points over 20 sessions.').nums)
      .toEqual([50, 52.1, 4.3, 20])
    expect(NAME_DIGITS.has(50)).toBe(true)
    expect(NAME_DIGITS.has(52.1)).toBe(false)
  })
})

describe('ordinal', () => {
  it('reads the way a percentile is spoken', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 100].map(ordinal))
      .toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '100th'])
  })
})

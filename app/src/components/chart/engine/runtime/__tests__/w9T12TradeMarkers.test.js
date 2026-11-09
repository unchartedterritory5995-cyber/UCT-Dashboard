// app/src/components/chart/engine/runtime/__tests__/w9T12TradeMarkers.test.js
//
// W9-T12 — trade markers from the run's record (`runtime/tradeMarkers.js`).
//
//   1. An indicator has no record and gets no markers (null, never a refusal).
//   2. The member door refuses by name while W9-MK1 is open: `runtime:strategy-unpinned`,
//      rule MK-LOOK, capture W9-MK1, a member sentence, nothing drawn.
//   3. Behind the TEST-ONLY pin path (`isPinned`): the geometry of hand-made records
//      (long, short, partial exits, same-bar entry + exit, a reversal), each with a control.
//   4. A record the markers cannot read whole refuses whole (never a marker set with a fill missing).
import { describe, it, expect } from 'vitest'

import {
  tradeMarkersOf, tradeMarkerObjects, memberTradeMarkers, drawsTradeMarkers, markerText,
  MARKER_RULE, MARKER_CAPTURE, MARKER_RECORD_GUARD, MARKER_UNRECORDED_GUARD, MARKER_LOOK_HYPOTHESES,
  MARKER_UNPINNED_SENTENCE, MARKER_UNRECORDED_SENTENCE, MARKER_RECORD_SENTENCE,
  publishTradeMarkers, tradeMarkersFor, onTradeMarkersChange, resetTradeMarkers,
} from '../tradeMarkers.js'
import { strategyRecordOf, withStrategyRecord, strategyRecordShapeErrors, STRATEGY_WINDOW_HISTORY } from '../strategyRecord.js'
import { UNPINNED_GUARD, BROKER_RULE_IDS, PRESENTATION_RULES, MARKER_RULE as RULES_MARKER_RULE } from '../brokerRules.js'
import RESOLVED from '../brokerPins.resolved.json'
import { toRenderState } from '../../objectRenderState.js'

const DAY = 86400
const T0 = 1714000000
const TIMES = Array.from({ length: 20 }, (_, i) => T0 + i * DAY)
const at = (i) => TIMES[i]
const PIN = { isPinned: (id) => id === MARKER_RULE }

/** A broker trade (`broker.js::tradeRecord` shape). */
const tr = (id, dir, qty, ei, ep, xi, xp) => ({
  id, dir, qty, exact: true,
  entry: { time: at(ei), price: ep, rule: 'B-MARKET' },
  ...(xi === undefined ? {} : { exit: { time: at(xi), price: xp, rule: 'B-MARKET' } }),
})

/** The record T11 builds from those trades: orders and exit ids unserved (as on master). */
function rawRecord(trades) {
  return strategyRecordOf({ summary: { record: { trades, rulesUsed: ['B-MARKET'] } },
    decl: { version: 5, initialCapital: 100000, defaultQty: 1, pyramiding: 2 },
    barTimes: TIMES, historyWindowBars: 5000, confirmed: true })
}

/** The same record with the order log and the exit ids served (what W9-T7 adds), hand-made. */
function servedRecord(trades, exits, orders) {
  const rec = rawRecord(trades)
  rec.trades.forEach((t, i) => { t.exitId = t.open ? null : exits[i] })
  rec.orders = orders
  const u = { ...rec.unserved }
  delete u.orders
  delete u['trades.exitId']
  rec.unserved = u
  expect(strategyRecordShapeErrors(rec)).toEqual([])
  return rec
}
const ord = (id, i, comment = null) => ({ id, status: 'filled', fillTime: at(i), comment })

describe('W9-T12 1 — an indicator gets no markers', () => {
  it('no record: null from the pure function and from the member door', () => {
    expect(tradeMarkersOf(null)).toBe(null)
    expect(tradeMarkersOf(undefined, PIN)).toBe(null)
    expect(memberTradeMarkers({ acc: new Float64Array(3) })).toBe(null)
    expect(tradeMarkerObjects(null)).toEqual([])
  })

  it('only a runtime document stamped with the strategy window draws markers', () => {
    const rt = (h) => ({ compute: { kind: 'runtime' }, meta: h === undefined ? {} : { runtimeHistory: h } })
    expect(drawsTradeMarkers(rt(STRATEGY_WINDOW_HISTORY))).toBe(true)
    expect(drawsTradeMarkers(rt('listing'))).toBe(false)
    expect(drawsTradeMarkers(rt())).toBe(false)
    expect(drawsTradeMarkers({ compute: { kind: 'ast' }, meta: { runtimeHistory: STRATEGY_WINDOW_HISTORY } })).toBe(false)
    expect(drawsTradeMarkers(null)).toBe(false)
  })
})

describe('W9-T12 2 — the member door refuses by name until W9-MK1 is pinned', () => {
  const rec = () => servedRecord([tr('L', 1, 3, 2, 10, 5, 12)], ['XL'], [ord('L', 2), ord('XL', 5)])

  it('the committed ledger does not pin the look, so the door refuses naming MK-LOOK and W9-MK1', () => {
    expect(Object.prototype.hasOwnProperty.call(RESOLVED.rules, MARKER_RULE)).toBe(false)
    const cols = withStrategyRecord({}, rec())
    const out = memberTradeMarkers(cols)
    expect(out.status).toBe('refused')
    expect(out.guard).toBe(UNPINNED_GUARD)
    expect(out.guard).toBe('runtime:strategy-unpinned')
    expect(out.rule).toBe('MK-LOOK')
    expect(out.capture).toBe('W9-MK1')
    expect(out.sentence).toBe(MARKER_UNPINNED_SENTENCE)
    expect(out.sentence).toMatch(/capture row W9-MK1/)
    expect(out.asOfBar).toBe(at(19))
    expect(tradeMarkerObjects(out)).toEqual([])
  })

  it('⛔ CONTROL — the same record with the look pinned (test path) is served', () => {
    expect(tradeMarkersOf(rec(), PIN).status).toBe('ok')
  })

  it('the refusal is the look, asked FIRST: a record T11 builds today (orders unserved) still names W9-MK1', () => {
    const out = memberTradeMarkers(withStrategyRecord({}, rawRecord([tr('L', 1, 1, 2, 10, 5, 12)])))
    expect(out.capture).toBe(MARKER_CAPTURE)
  })

  it('with the look pinned, a record without the order log refuses by name, naming the owner', () => {
    const out = tradeMarkersOf(rawRecord([tr('L', 1, 1, 2, 10, 5, 12)]), PIN)
    expect(out.status).toBe('refused')
    expect(out.guard).toBe(MARKER_UNRECORDED_GUARD)
    expect(out.fields).toEqual(['orders', 'trades.exitId'])
    expect(out.owners).toEqual(['W9-T7', 'W9-T7'])
  })

  it('MK-LOOK is a presentation rule, read from the one table in brokerRules.js, never a broker rule', () => {
    expect(BROKER_RULE_IDS).not.toContain(MARKER_RULE)
    expect(MARKER_RULE).toBe(RULES_MARKER_RULE)
    expect(MARKER_CAPTURE).toBe(PRESENTATION_RULES[MARKER_RULE].capture)
  })

  it('member sentences carry no field path and no raw shape error (those stay on the refusal)', () => {
    const fieldPath = /\b[a-z][A-Za-z]*\.[a-z][A-Za-z_]*\b/
    const unrec = tradeMarkersOf(rawRecord([tr('L', 1, 1, 2, 10, 5, 12)]), PIN)
    const bad = tradeMarkersOf({ schema: 'nope' })
    expect(unrec.sentence).toBe(MARKER_UNRECORDED_SENTENCE)
    expect(bad.sentence).toBe(MARKER_RECORD_SENTENCE)
    expect(bad.errors.length).toBeGreaterThan(0)
    for (const sentence of [MARKER_UNPINNED_SENTENCE, MARKER_UNRECORDED_SENTENCE, MARKER_RECORD_SENTENCE]) {
      expect(sentence).not.toMatch(fieldPath)
      expect(sentence).not.toMatch(/exitId|window\.|trades\.|trades\[/)
    }
    // CONTROL: the pattern does catch the shapes the first cut put in a sentence
    expect('does not carry orders and trades.exitId yet').toMatch(fieldPath)
    expect('(window.startDate, schema)').toMatch(fieldPath)
  })
})

const ok = (rec) => {
  const out = tradeMarkersOf(rec, PIN)
  expect(out.status, JSON.stringify(out)).toBe('ok')
  return out
}
const brief = (out) => out.markers.map((m) => [m.role, m.side, m.id, m.time, m.price, m.qty, m.trades.join('+')])

describe('W9-T12 3 — geometry from hand-made records (test pin path)', () => {
  it('a long round trip: a buy at the entry fill, a sell at the exit fill', () => {
    const out = ok(servedRecord([tr('L', 1, 3, 2, 10, 5, 12)], ['XL'], [ord('L', 2), ord('XL', 5)]))
    expect(brief(out)).toEqual([
      ['entry', 'buy', 'L', at(2), 10, 3, '1'],
      ['exit', 'sell', 'XL', at(5), 12, 3, '1'],
    ])
    const objs = tradeMarkerObjects(out)
    expect(objs.map((o) => [o.props.x, o.props.y, o.props.style, o.props.text, o.props.color])).toEqual([
      [at(2) * 1000, 10, 'arrowup', 'L\n+3', '#2962FF'],
      [at(5) * 1000, 12, 'arrowdown', 'XL\n-3', '#9C27B0'],
    ])
  })

  it('a short round trip mirrors it: a sell at entry, a buy at exit', () => {
    const out = ok(servedRecord([tr('S', -1, 2, 3, 20, 7, 18)], ['XS'], [ord('S', 3), ord('XS', 7)]))
    expect(brief(out)).toEqual([
      ['entry', 'sell', 'S', at(3), 20, 2, '1'],
      ['exit', 'buy', 'XS', at(7), 18, 2, '1'],
    ])
    expect(tradeMarkerObjects(out).map((o) => [o.props.style, o.props.text, o.props.color])).toEqual([
      ['arrowdown', 'S\n-2', '#F23645'],
      ['arrowup', 'XS\n+2', '#9C27B0'],
    ])
  })

  it('partial exits: one entry fill split over two trades is ONE entry marker with the summed size', () => {
    // entry L x3 on bar 2, then 2 closed on bar 4 and 1 on bar 6 (the broker splits the trade)
    const out = ok(servedRecord([tr('L', 1, 2, 2, 10, 4, 11), tr('L', 1, 1, 2, 10, 6, 13)], ['X1', 'X2'],
      [ord('L', 2), ord('X1', 4), ord('X2', 6)]))
    expect(brief(out)).toEqual([
      ['entry', 'buy', 'L', at(2), 10, 3, '1+2'],
      ['exit', 'sell', 'X1', at(4), 11, 2, '1'],
      ['exit', 'sell', 'X2', at(6), 13, 1, '2'],
    ])
  })

  it('⛔ CONTROL — two entries with the same id on DIFFERENT bars (pyramiding) stay two markers', () => {
    const out = ok(servedRecord([tr('L', 1, 1, 2, 10, 6, 13), tr('L', 1, 1, 3, 10.5, 6, 13)], ['X', 'X'],
      [ord('L', 2), ord('L', 3), ord('X', 6)]))
    expect(brief(out)).toEqual([
      ['entry', 'buy', 'L', at(2), 10, 1, '1'],
      ['entry', 'buy', 'L', at(3), 10.5, 1, '2'],
      ['exit', 'sell', 'X', at(6), 13, 2, '1+2'],
    ])
  })

  it('same-bar entry and exit: a buy and a sell on one bar are two labels on that bar', () => {
    const out = ok(servedRecord([tr('L', 1, 1, 4, 10, 4, 10.8)], ['XL'], [ord('L', 4), ord('XL', 4)]))
    // the exit is listed first on its bar only when it closes an EARLIER trade; here it is the
    // same trade, so the order is exit-before-entry by rule and both carry trade 1
    expect(brief(out)).toEqual([
      ['exit', 'sell', 'XL', at(4), 10.8, 1, '1'],
      ['entry', 'buy', 'L', at(4), 10, 1, '1'],
    ])
    const objs = tradeMarkerObjects(out)
    expect(objs).toHaveLength(2)
    expect(objs.map((o) => [o.props.x, o.props.style, o.props.text])).toEqual([
      [at(4) * 1000, 'arrowdown', 'XL\n-1'],
      [at(4) * 1000, 'arrowup', 'L\n+1'],
    ])
  })

  it('a reversal: the long\'s exit and the short\'s entry are both sells on one bar, ONE label, exit first', () => {
    const out = ok(servedRecord([tr('L', 1, 2, 2, 10, 6, 12), tr('S', -1, 2, 6, 12, 9, 11)], ['S', 'XS'],
      [ord('L', 2), ord('S', 6), ord('XS', 9)]))
    const objs = tradeMarkerObjects(out)
    expect(objs.map((o) => [o.props.x, o.props.style, o.props.text])).toEqual([
      [at(2) * 1000, 'arrowup', 'L\n+2'],
      [at(6) * 1000, 'arrowdown', 'S\n-2\nS\n-2'],
      [at(9) * 1000, 'arrowup', 'XS\n+2'],
    ])
  })

  it('an open trade has its entry marker and no exit marker', () => {
    const out = ok(servedRecord([tr('L', 1, 1, 2, 10)], [null], [ord('L', 2)]))
    expect(brief(out)).toEqual([['entry', 'buy', 'L', at(2), 10, 1, '1']])
  })

  it('an order\'s comment replaces its id in the text; ⛔ CONTROL: an empty comment does not', () => {
    const out = ok(servedRecord([tr('L', 1, 1, 2, 10, 5, 12)], ['XL'], [ord('L', 2, 'go long'), ord('XL', 5, '')]))
    expect(out.markers.map(markerText)).toEqual(['go long\n+1', 'XL\n-1'])
  })

  it('the render state places every marker on its bar and its fill price (the one bar clock)', () => {
    const out = ok(servedRecord([tr('L', 1, 3, 2, 10, 5, 12)], ['XL'], [ord('L', 2), ord('XL', 5)]))
    const bars = TIMES.map((t) => ({ t, o: 1, h: 2, l: 0.5, c: 1.5, v: 1 }))
    const rs = toRenderState(tradeMarkerObjects(out), { bars, tf: 'D' })
    expect(rs.labels.map((l) => [l.x, l.y, l.style, l.text])).toEqual([
      [at(2), 10, 'arrowup', 'L\n+3'],
      [at(5), 12, 'arrowdown', 'XL\n-3'],
    ])
    expect(rs.dropped.label).toBe(0)
  })

  it('the result carries the asOfBar stamp', () => {
    const out = ok(servedRecord([tr('L', 1, 3, 2, 10, 5, 12)], ['XL'], [ord('L', 2), ord('XL', 5)]))
    expect(out.asOfBar).toBe(at(19))
    expect(out.stamp).toBe(`trades through the closed bar of ${new Date(at(19) * 1000).toISOString().slice(0, 10)} (UTC)`)
  })

  it('every look value the drawing uses comes from the hypothesis table W9-MK1 settles', () => {
    const out = ok(servedRecord([tr('L', 1, 3, 2, 10, 5, 12)], ['XL'], [ord('L', 2), ord('XL', 5)]))
    const [o] = tradeMarkerObjects(out)
    expect(o.props.size).toBe(MARKER_LOOK_HYPOTHESES['MK-H-SIZE'].value)
    expect(o.props.style).toBe(MARKER_LOOK_HYPOTHESES['MK-H-SHAPE'].value.buy)
    expect(o.props.color).toBe(MARKER_LOOK_HYPOTHESES['MK-H-COLOUR'].value.entryBuy)
  })
})

describe('W9-T12 4 — a record the markers cannot read whole refuses whole', () => {
  it('a fill with no filled order in the log', () => {
    const out = tradeMarkersOf(servedRecord([tr('L', 1, 1, 2, 10, 5, 12)], ['XL'], [ord('L', 2)]), PIN)
    expect(out.status).toBe('refused')
    expect(out.guard).toBe(MARKER_RECORD_GUARD)
    expect(out.errors).toEqual(['trade 1 exit has no filled order XL'])
  })

  it('a fill after asOfBar', () => {
    const rec = servedRecord([tr('L', 1, 1, 2, 10, 5, 12)], ['XL'], [ord('L', 2), ord('XL', 5)])
    rec.window.asOfBar = at(4)
    const out = tradeMarkersOf(rec, PIN)
    expect(out.guard).toBe(MARKER_RECORD_GUARD)
    expect(out.errors).toEqual(['trade 1 exit after asOfBar'])
  })

  it('a record that is not v1, refused before the pin is asked', () => {
    const out = tradeMarkersOf({ schema: 'nope' }, { isPinned: () => { throw new Error('asked') } })
    expect(out.guard).toBe(MARKER_RECORD_GUARD)
  })
})

describe('W9-T12 5 the published outcome (review F2, F3)', () => {
  const rec = () => servedRecord([tr('L', 1, 3, 2, 10, 5, 12)], ['XL'], [ord('L', 2), ord('XL', 5)])

  it('is scoped by binder: one instance id in two scopes holds two outcomes; clearing one keeps the other', () => {
    resetTradeMarkers()
    const a = tradeMarkersOf(rec(), PIN)
    const b = tradeMarkersOf(rec())
    publishTradeMarkers('i1', a, 'A')
    publishTradeMarkers('i1', b, 'B')
    expect(tradeMarkersFor('i1', 'A').status).toBe('ok')
    expect(tradeMarkersFor('i1', 'B').status).toBe('refused')
    expect(tradeMarkersFor('i1')).toBe(null)
    publishTradeMarkers('i1', null, 'B')
    expect(tradeMarkersFor('i1', 'B')).toBe(null)
    expect(tradeMarkersFor('i1', 'A').status).toBe('ok')
    resetTradeMarkers()
  })

  it('emits only when the outcome changes BY VALUE (a fresh equal object each sync emits nothing)', () => {
    resetTradeMarkers()
    const seen = []
    onTradeMarkersChange((id, scope) => seen.push(`${scope}:${id}`))
    publishTradeMarkers('i1', tradeMarkersOf(rec(), PIN), 'A')
    publishTradeMarkers('i1', tradeMarkersOf(rec(), PIN), 'A')   // equal by value, a new object
    publishTradeMarkers('i1', tradeMarkersOf(rec(), PIN), 'A')
    expect(seen).toEqual(['A:i1'])
    // CONTROL: a different outcome emits, and so does a clear; a second clear does not
    publishTradeMarkers('i1', tradeMarkersOf(rec()), 'A')
    publishTradeMarkers('i1', null, 'A')
    publishTradeMarkers('i1', null, 'A')
    expect(seen).toEqual(['A:i1', 'A:i1', 'A:i1'])
    resetTradeMarkers()
  })
})

import { describe, it, expect } from 'vitest'
import {
  buildRows, conditionRow, priceRow, countByKind, fireLine,
  KIND_CONDITION, KIND_INDICATOR, KIND_PRICE, KIND_DRAWING,
  TONE_OK, TONE_MUTED, TONE_FIRED, TONE_FAULT,
} from './alertRows'

const DEF = 'u_275dadc9fafe'
const ind = (over = {}) => ({
  id: 1, sym: 'tsla', tf: 'D', indicator: `${DEF}.value`,
  condition: 'cross_above', threshold: 0.5, active: true, state: 'armed',
  trigger_count: 0, triggered_at: null, ...over,
})
const wl = (over = {}) => ({
  id: 'w1', sym: 'aapl', target_price: 450, direction: 'above',
  is_active: 1, triggered_at: null, alert_type: 'price', ...over,
})

describe('one list, three backends — and it does not pretend they are one', () => {
  it('⭐⭐ a member formula is a CONDITION; a builtin address is an INDICATOR', () => {
    expect(conditionRow(ind()).kind).toBe(KIND_CONDITION)
    expect(conditionRow(ind({ indicator: 'rsi.value' })).kind).toBe(KIND_INDICATOR)
  })

  it('⭐⭐ a drawing alert is a watchlist row with a drawing_id — and reads as DRAWINGS', () => {
    expect(priceRow(wl()).kind).toBe(KIND_PRICE)
    expect(priceRow(wl({ drawing_id: 'd1', alert_type: 'trendline' })).kind).toBe(KIND_DRAWING)
  })

  it('⭐ the bound line says it FOLLOWS the drawing; a fixed level does not', () => {
    expect(priceRow(wl({ drawing_id: 'd1', alert_type: 'trendline' })).what).toMatch(/trendline/)
    expect(priceRow(wl()).what).toMatch(/crosses above/)
    expect(priceRow(wl({ direction: 'below' })).what).toMatch(/crosses below/)
  })

  it('⛔⛔ A PRICE ALERT OFFERS NO CONTROL ITS BACKEND CANNOT HONOUR', () => {
    // `watchlist_alerts` is one-shot: no state column, no snooze, no re-arm, no
    // fire history. Four controls that cannot work is worse than four absences.
    const p = priceRow(wl()).can
    expect(p).toEqual({ pause: false, mute: false, rearm: false, history: false, delete: true })
  })

  it('⭐ a condition alert offers the controls its engine actually has', () => {
    const c = conditionRow(ind()).can
    expect(c.pause && c.mute && c.history && c.delete).toBe(true)
  })
})

describe('states come from the real engine model', () => {
  it('⭐ armed reads as Watching', () => {
    expect(conditionRow(ind()).status).toMatchObject({ label: 'Watching', tone: TONE_OK })
  })

  it('⛔ `active: false` WINS over whatever state column the row carries', () => {
    // A paused alert is not evaluated at all, so its `state` is a fact about the
    // last time it ran rather than about now.
    const r = conditionRow(ind({ active: false, state: 'fired' }))
    expect(r.status).toMatchObject({ label: 'Paused', tone: TONE_MUTED })
  })

  it('⭐ fired says what it is waiting for, in the engine’s actual terms', () => {
    const r = conditionRow(ind({ state: 'fired', triggered_at: 1757000000 }))
    expect(r.status.label).toBe('Fired')
    expect(r.status.detail).toMatch(/go false/)
    expect(r.lastFired).toBe(1757000000 * 1000)
  })

  it('⭐ snoozed reads as Muted and carries the window', () => {
    const r = conditionRow(ind({ state: 'snoozed', snooze_until: 999, state_detail: 'snoozed for 60 min' }))
    expect(r.status).toMatchObject({ label: 'Muted', tone: TONE_MUTED, until: 999 })
  })

  it('⭐ both fault states read as Not working and keep the diagnosis', () => {
    for (const st of ['needs_attention', 'error']) {
      const r = conditionRow(ind({ state: st, state_detail: 'no bars for 5 cycles' }))
      expect(r.status).toMatchObject({ label: 'Not working', tone: TONE_FAULT })
      expect(r.status.detail).toBe('no bars for 5 cycles')
    }
  })

  it('⛔⛔ THE ORPHANED INSTANCE IS A FLAG, NOT A STATE — and it still shows', () => {
    // The service keeps it in its own column precisely because
    // `record_evaluation` would clear a state on the very next cycle.
    const r = conditionRow(ind({ instance_missing: 1 }))
    expect(r.status).toMatchObject({ label: 'Source unavailable', tone: TONE_FAULT })
  })

  it('⛔ "delivery issue" is NOT an alert state', () => {
    // It is a property of individual FIRES. An alert can be perfectly healthy
    // with one undelivered fire behind it.
    const labels = ['armed', 'fired', 'snoozed', 'needs_attention', 'error']
      .map((s) => conditionRow(ind({ state: s })).status.label)
    expect(labels.some((l) => /deliver/i.test(l))).toBe(false)
  })

  it('⭐ a triggered PRICE alert is FINISHED, not "waiting to reset"', () => {
    const r = priceRow(wl({ is_active: 0, triggered_at: '2026-09-12T14:31:00Z' }))
    expect(r.status).toMatchObject({ label: 'Triggered', tone: TONE_FIRED })
    expect(r.status.detail).toMatch(/one-time/)
    expect(r.lastFired).toBe(Date.parse('2026-09-12T14:31:00Z'))
  })
})

describe('the trigger, in the member’s words', () => {
  it('⭐⭐ a boolean condition reads "becomes true", never the comparator', () => {
    const r = conditionRow(ind())
    expect(r.trigger).toBe('becomes true')
    expect(`${r.trigger} ${r.what}`).not.toMatch(/cross_above|0\.5/)
  })

  it('⛔ a hand-built threshold alert keeps ITS OWN number', () => {
    // `cross_above` @ 0.5 and `cross_above` @ 70 are different sentences.
    const r = conditionRow(ind({ indicator: 'rsi.value', condition: 'above', threshold: 70 }))
    expect(r.trigger).toBe('above 70')
  })

  it('⭐ a price alert’s trigger is the level, formatted', () => {
    expect(priceRow(wl({ target_price: 450 })).trigger).toBe('$450.00')
  })
})

describe('ordering — what needs you first', () => {
  it('⭐⭐ faults sort above fired, above watching, above muted', () => {
    const rows = buildRows([
      ind({ id: 1, state: 'snoozed' }),
      ind({ id: 2, state: 'armed' }),
      ind({ id: 3, state: 'error' }),
      ind({ id: 4, state: 'fired' }),
    ], [])
    expect(rows.map((r) => r.status.label))
      .toEqual(['Not working', 'Fired', 'Watching', 'Muted'])
  })

  it('⭐ within a tone, by symbol', () => {
    const rows = buildRows([ind({ id: 1, sym: 'zm' }), ind({ id: 2, sym: 'aapl' })], [])
    expect(rows.map((r) => r.sym)).toEqual(['AAPL', 'ZM'])
  })

  it('⭐ both listings land in one list, with stable unique keys', () => {
    // ⚠️ the two backends have colliding id spaces (INTEGER vs TEXT), so the key
    // is prefixed — without it React would reconcile two different alerts as one.
    const rows = buildRows([ind({ id: 1 })], [wl({ id: '1' })])
    expect(rows).toHaveLength(2)
    expect(new Set(rows.map((r) => r.key)).size).toBe(2)
  })

  it('⭐ counts cover every kind, including the empty ones', () => {
    const rows = buildRows([ind()], [wl(), wl({ id: 'w2', drawing_id: 'd1' })])
    const n = countByKind(rows)
    expect(n.all).toBe(3)
    expect(n[KIND_CONDITION]).toBe(1)
    expect(n[KIND_PRICE]).toBe(1)
    expect(n[KIND_DRAWING]).toBe(1)
    expect(n[KIND_INDICATOR]).toBe(0)
  })

  it('⛔ it survives every shape a listing can arrive in', () => {
    expect(buildRows(null, undefined)).toEqual([])
    expect(buildRows([], [])).toEqual([])
  })
})

describe('history, in the member’s words', () => {
  it('⭐⭐ the BAR is the time, and the verb is the policy’s', () => {
    const row = conditionRow(ind())
    const f = fireLine({ bar_time: 1757635200, fired_at: 1757650000, condition: 'cross_above', threshold: 0.5 }, row)
    expect(f.when).toBe(1757635200 * 1000)   // the BAR, not when the evaluator noticed
    expect(f.barText).toBe('1D bar')
    expect(f.verb).toBe('becomes true')
  })

  it('⭐ a failed channel is named, and "skipped" is not a failure', () => {
    const f = fireLine({
      fired_at: 1, condition: 'cross_above', threshold: 0.5,
      delivery_channels: { in_app: 'ok', email: 'failed', discord: 'skipped' },
    }, null)
    expect(f.failedChannels).toEqual(['email'])
  })

  it('⛔ a fire with no delivery map reports no failures rather than crashing', () => {
    expect(fireLine({ fired_at: 1 }, null).failedChannels).toEqual([])
    expect(fireLine({ fired_at: 1, delivery_channels: 'oops' }, null).failedChannels).toEqual([])
  })
})

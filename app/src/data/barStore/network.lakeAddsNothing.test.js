// A lake load that provably adds nothing is not ingested (2026-11-27, the keep-alive A/B on master). The chart's
// background warm re-reads the lake for its other intraday timeframes on every visit of a board; network.lakeSeed's
// settled-depth skip (#2871) does not hold across a new key life or an entry no server answered, so every visit decoded
// and ingested the same rows again (`got` -> LAKE_HIT -> applyLocal -> ingestRows: about 40-48 ms a board click on the
// owner's board). Now a load whose rows the entry already holds is dispatched EMPTY (the registry's own bookkeeping
// stays), exactly as persist.hydrateMem treats a saved copy that adds nothing.
//   L1 (red first) an ANSWERED entry holding the lake's rows: a load of the same rows dispatches none, bars identical
//   L2 (red first) a LAKE-ONLY entry (no server answer) holding the lake's rows: the same
//   L3 control: an entry missing the lake's older rows still gets them
//   L4 control: a lake-only entry whose rows differ in one value is not proven: the load is applied
//   L5 control: a load carrying a row newer than the entry holds is applied
import { describe, it, expect, vi } from 'vitest'
import { createRegistry } from './registry'
import { createNetwork } from './network'
import { keyOf, ACTION } from './types'

// 5-minute regular-session rows (14:30Z-20:55Z, EST) on the weekdays of the `days` days ending 2026-11-09
function rows5(days, lastDay = '2026-11-09', close = () => 100) {
  const out = []
  const d = new Date(`${lastDay}T00:00:00Z`)
  const dates = []
  while (dates.length < days) {
    const wd = d.getUTCDay()
    if (wd !== 0 && wd !== 6) dates.push(d.getTime())
    d.setUTCDate(d.getUTCDate() - 1)
  }
  for (const day of dates.reverse()) {
    for (let k = 0; k < 78; k++) {
      const t = day / 1000 + 14.5 * 3600 + k * 300
      const c = close(t)
      out.push({ t, o: c, h: c + 1, l: c - 1, c, v: 10 })
    }
  }
  return out
}
const LAKE = rows5(20)
const TAIL = LAKE.slice(-3 * 78)

function world({ lake = LAKE } = {}) {
  const registry = createRegistry({ ctx: () => ({ nowMs: Date.UTC(2026, 10, 9, 21, 0) }) })
  const request = vi.fn(async () => ({ ticker: 'SIM', tf: '5', bars: TAIL }))
  const history = { olderBars: vi.fn(async () => ({ bars: lake })), prime: () => {} }
  const net = () => createNetwork({ registry, request, history, isHidden: () => false, onVisible: () => () => {} })
  const key = keyOf({ sym: 'SIM', tf: '5' })
  return { registry, request, history, net, key }
}
const lakeRowsDispatched = (spy) => spy.mock.calls.filter(([, a]) => a?.type === ACTION.LAKE_HIT && (a.payload?.bars?.length ?? 0) > 0).length
const barsOf = (w) => w.registry.peek(w.key).bars.map((b) => [b.t, b.o, b.h, b.l, b.c, b.v])

describe('network.lakeSeed: a load that adds nothing is not ingested', () => {
  it('L1 (red first) an answered entry holding the lake rows ingests nothing again', async () => {
    const w = world()
    const first = w.net()
    await first.fetchOnce(w.key)
    expect(w.registry.peek(w.key).restSeen).toBe(true)
    await first.lakeSeed(w.key)
    const before = barsOf(w)
    expect(before.length, 'NON-VACUITY: the first load joined the lake').toBe(LAKE.length)
    const spy = vi.spyOn(w.registry, 'dispatch')
    await w.net().lakeSeed(w.key)          // a new key life: the settled-depth skip does not hold
    expect(lakeRowsDispatched(spy), 'the same lake rows were ingested again').toBe(0)
    expect(barsOf(w)).toEqual(before)
  })

  it('L2 (red first) a lake-only entry holding the lake rows ingests nothing again', async () => {
    const w = world()
    w.registry.getSnapshot(w.key)          // the entry exists (a chart asked for it)
    await w.net().lakeSeed(w.key)
    const before = barsOf(w)
    expect(w.registry.peek(w.key).restSeen).toBe(false)
    expect(before.length, 'NON-VACUITY: the lake seeded the entry').toBe(LAKE.length)
    const spy = vi.spyOn(w.registry, 'dispatch')
    await w.net().lakeSeed(w.key)
    expect(lakeRowsDispatched(spy), 'the same lake rows were ingested again').toBe(0)
    expect(barsOf(w)).toEqual(before)
  })

  it('L3 an entry missing the older rows still gets them', async () => {
    const w = world()
    const n = w.net()
    await n.fetchOnce(w.key)
    expect(barsOf(w).length).toBe(TAIL.length)
    const spy = vi.spyOn(w.registry, 'dispatch')
    await n.lakeSeed(w.key)
    expect(lakeRowsDispatched(spy)).toBe(1)
    expect(barsOf(w).length).toBe(LAKE.length)
  })

  it('L4 a lake-only entry whose rows differ in one value is not proven: the load is applied', async () => {
    const w = world()
    w.registry.getSnapshot(w.key)
    await w.net().lakeSeed(w.key)
    const changed = LAKE.map((r, i) => (i === 100 ? { ...r, c: r.c + 0.5, h: r.h + 0.5 } : r))
    w.history.olderBars.mockImplementation(async () => ({ bars: changed }))
    const spy = vi.spyOn(w.registry, 'dispatch')
    await w.net().lakeSeed(w.key)
    expect(lakeRowsDispatched(spy), 'a row with another close was read as held').toBe(1)
  })

  it('L5 a load carrying a newer row than the entry holds is applied', async () => {
    const w = world({ lake: LAKE.slice(0, -1) })
    w.registry.getSnapshot(w.key)
    await w.net().lakeSeed(w.key)
    w.history.olderBars.mockImplementation(async () => ({ bars: LAKE }))
    const spy = vi.spyOn(w.registry, 'dispatch')
    await w.net().lakeSeed(w.key)
    expect(lakeRowsDispatched(spy), 'a newer row was read as held').toBe(1)
    expect(barsOf(w).length).toBe(LAKE.length)
  })
})

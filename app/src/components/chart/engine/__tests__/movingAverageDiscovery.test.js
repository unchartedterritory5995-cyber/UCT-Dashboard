// app/src/components/chart/engine/__tests__/movingAverageDiscovery.test.js
//
// ─── ONE MOVING AVERAGE, AND IT GOES WHERE ITS SOURCE IS ────────────────────
//
// ⚰️ THE MEMBER REPORT: *"I added a Moving Average but I cannot see where to put
// it on QQQ."* They had not missed a control. Browse offered TWO rows that both
// read "Moving Average", and the easier one to find was `cs.overlays`' legacy
// price average — which has no source at all.
//
// ⭐⭐ THE RESOLUTION IS A CATALOGUE DECISION, NOT A MIGRATION. `cs.overlays` is a
// POSITIONAL ARRAY with its own writers and its own compute; `movingAverage` is an
// ENGINE INSTANCE inside the dependency, display-target and provenance
// architecture. Different persistence mechanisms — merging them would rewrite
// saved charts. So the legacy row stopped being OFFERED
// (`discoveryCatalog.LIBRARY_HIDDEN_IDS`) and the engine one took the plain name.
// Nothing moved on disk and no overlay was touched.
//
// ⚠️ COMPUTE AND DEPENDENCY ARE NOT THIS FILE'S BUSINESS.
// `movingAverageSource.test.js` already owns the source grammar, the SMA/EMA
// arithmetic, missing sources, cycles and deletion-severs. This file owns the two
// things the catalogue change is actually about: that exactly one Moving Average
// is offered, and that it lands — and stays — where the member expects.

import { describe, it, expect } from 'vitest'
import * as registry from '../nativeRegistry'
import { addInstance, setInstanceDisplayTarget, setInstanceInput } from '../instanceControls'
import { resolveDisplayTarget, paneOwnKeys, paneFollowerKeys } from '../displayTarget'
import { defaultPaneKeys } from '../paneLayout'
import { resolvePaneOrder, PRICE_PANE, VOLUME_PANE } from '../paneOrder'
import { normalizeInstances } from '../instances'
import { libraryRows, hiddenLibraryIds } from '../../discoveryCatalog'

const QQQ = 'sym:QQQ:close'
const insts = (cs) => (Array.isArray(cs.indicatorInstances) ? cs.indicatorInstances : [])
const find = (cs, id) => insts(cs).find((i) => i.instanceId === id)
const where = (cs, id) => resolveDisplayTarget(find(cs, id), cs)
const setSrc = (cs, id, source) => setInstanceInput(cs, id, 'source', source, registry)

const order = (cs) => resolvePaneOrder(cs, defaultPaneKeys(insts(cs), {
  excludeKeys: paneFollowerKeys(insts(cs), cs),
  includeKeys: paneOwnKeys(insts(cs), cs),
}), { volumePane: true })

/** Add one instance through the canonical door and hand back its id. */
function add(cs, defId) {
  const before = insts(cs).map((i) => i.instanceId)
  const next = addInstance(cs, defId, registry)
  return [next, insts(next).map((i) => i.instanceId).find((i) => !before.includes(i))]
}

const reconstruct = (cs) => {
  const blob = JSON.parse(JSON.stringify(cs))
  const { kept, dropped } = normalizeInstances(blob.indicatorInstances, registry)
  if (dropped.length) throw new Error(`validator dropped: ${JSON.stringify(dropped)}`)
  return { ...blob, indicatorInstances: kept }
}

/** QQQ in its own pane, plus an MA reading it. The live shape. */
function qqqWithMa() {
  let cs = { indicatorInstances: [] }
  let qqq; [cs, qqq] = add(cs, 'dataSeries')
  cs = setSrc(cs, qqq, QQQ)
  let ma; [cs, ma] = add(cs, 'movingAverage')
  cs = setSrc(cs, ma, `@${qqq}::value`)
  return { cs, qqq, ma }
}

describe('⭐ the catalogue offers exactly ONE Moving Average', () => {
  it('and it is the source-capable one, under the plain name', () => {
    const rows = libraryRows(registry)
    expect(rows.filter((r) => /^Moving Average/i.test(r.name)).map((r) => `${r.id}:${r.name}`))
      .toEqual(['movingAverage:Moving Average'])
    // ⛔ THE LEGACY ROW IS NOT OFFERED — and is not deleted either. Its data lives
    // in `cs.overlays`, which this catalogue has never described.
    expect(rows.map((r) => r.id)).not.toContain('ma')
  })

  it('⭐ …and it is findable by every word a member would type', () => {
    const row = libraryRows(registry).find((r) => r.id === 'movingAverage')
    for (const term of ['ma', 'sma', 'ema', 'moving average', 'average']) {
      expect(row.tags, `"${term}" does not reach the Moving Average row`).toContain(term)
    }
  })
})

describe('⭐⭐ a new MA displays in its SOURCE’s pane', () => {
  it('PRICE: the default source is close, and it lands on the candles', () => {
    const [cs, ma] = add({ indicatorInstances: [] }, 'movingAverage')
    expect(find(cs, ma).inputs.source, 'the fast path stopped defaulting to price').toBe('close')
    expect(where(cs, ma)).toBe('price')
    expect(paneOwnKeys(insts(cs), cs).has(ma), 'a price MA took a pane of its own').toBe(false)
  })

  it('RSI: an MA sourced from RSI draws in RSI’s pane', () => {
    let cs = { indicatorInstances: [] }
    let rsi; [cs, rsi] = add(cs, 'rsi')
    let ma; [cs, ma] = add(cs, 'movingAverage')
    cs = setSrc(cs, ma, `@${rsi}::rsi`)
    expect(where(cs, ma)).toBe(`@${rsi}`)
    expect(order(cs), 'the MA carved a pane instead of joining RSI').not.toContain(ma)
  })

  it('QQQ: an MA sourced from a data series draws in that series’ pane', () => {
    const { cs, qqq, ma } = qqqWithMa()
    expect(where(cs, ma)).toBe(`@${qqq}`)
    expect(order(cs)).toEqual([PRICE_PANE, VOLUME_PANE, qqq])
  })
})

describe('⛔ a deliberate Display choice outranks the source', () => {
  it('MA(QQQ) explicitly on Price stays on Price, and QQQ keeps its pane', () => {
    const { qqq, ma } = qqqWithMa()
    let { cs } = qqqWithMa()
    cs = setInstanceDisplayTarget(cs, ma, 'price', registry)
    expect(where(cs, ma)).toBe('price')
    expect(find(cs, ma).placement).toEqual({ target: 'price', targetExplicit: true })
    expect(order(cs), 'QQQ lost its pane when the MA left').toContain(qqq)
  })

  it('⭐⭐ and it SURVIVES a source change — explicit intent wins', () => {
    let cs = { indicatorInstances: [] }
    let rsi; [cs, rsi] = add(cs, 'rsi')
    let qqq; [cs, qqq] = add(cs, 'dataSeries'); cs = setSrc(cs, qqq, QQQ)
    let ma; [cs, ma] = add(cs, 'movingAverage'); cs = setSrc(cs, ma, `@${rsi}::rsi`)

    cs = setInstanceDisplayTarget(cs, ma, 'price', registry)
    cs = setSrc(cs, ma, `@${qqq}::value`)
    expect(where(cs, ma), 'the member’s Price choice was recomputed away').toBe('price')
  })

  it('⭐ while an AUTOMATIC one follows the new source', () => {
    let cs = { indicatorInstances: [] }
    let rsi; [cs, rsi] = add(cs, 'rsi')
    let qqq; [cs, qqq] = add(cs, 'dataSeries'); cs = setSrc(cs, qqq, QQQ)
    let ma; [cs, ma] = add(cs, 'movingAverage')

    cs = setSrc(cs, ma, `@${rsi}::rsi`)
    expect(where(cs, ma)).toBe(`@${rsi}`)
    cs = setSrc(cs, ma, `@${qqq}::value`)
    expect(where(cs, ma), 'automatic placement did not follow the source').toBe(`@${qqq}`)
  })

  it('⭐ Own Pane, then back to automatic, clears the provenance', () => {
    const { qqq, ma } = qqqWithMa()
    let { cs } = qqqWithMa()
    cs = setInstanceDisplayTarget(cs, ma, 'pane', registry)
    expect(where(cs, ma)).toBe('pane')
    expect(paneOwnKeys(insts(cs), cs).has(ma)).toBe(true)
    expect(find(cs, ma).inputs.source, 'the source changed when the pane did').toBe(`@${qqq}::value`)

    cs = setInstanceDisplayTarget(cs, ma, `@${qqq}`, registry)
    expect(find(cs, ma).placement, 'a spent override was left behind').toBeUndefined()
    expect(where(cs, ma)).toBe(`@${qqq}`)
  })
})

describe('⛔ identity and reload', () => {
  it('⭐⭐ two QQQ series — the MA binds to the INSTANCE, not the label', () => {
    let cs = { indicatorInstances: [] }
    let a; [cs, a] = add(cs, 'dataSeries'); cs = setSrc(cs, a, QQQ)
    let b; [cs, b] = add(cs, 'dataSeries'); cs = setSrc(cs, b, QQQ)
    expect(a).not.toBe(b)

    let ma; [cs, ma] = add(cs, 'movingAverage')
    cs = setSrc(cs, ma, `@${b}::value`)
    expect(where(cs, ma), 'the MA attached to the wrong QQQ').toBe(`@${b}`)

    const back = reconstruct(cs)
    expect(where(back, ma), 'the binding moved on reload').toBe(`@${b}`)
    expect(find(back, ma).inputs.source).toBe(`@${b}::value`)
  })

  it('⭐ save / reload keeps automatic and explicit placements apart', () => {
    let cs = { indicatorInstances: [] }
    let rsi; [cs, rsi] = add(cs, 'rsi')
    let auto; [cs, auto] = add(cs, 'movingAverage'); cs = setSrc(cs, auto, `@${rsi}::rsi`)
    let fixed; [cs, fixed] = add(cs, 'movingAverage'); cs = setSrc(cs, fixed, `@${rsi}::rsi`)
    cs = setInstanceDisplayTarget(cs, fixed, 'price', registry)

    const back = reconstruct(cs)
    expect(where(back, auto), 'the automatic MA lost its source pane').toBe(`@${rsi}`)
    expect(where(back, fixed), 'the explicit MA lost its Price choice').toBe('price')
    expect(find(back, fixed).placement.targetExplicit).toBe(true)
    expect(find(back, auto).placement, 'the automatic MA gained an override').toBeUndefined()
  })

  it('⛔ the legacy overlay array is untouched by any of this', () => {
    // The whole compatibility claim in one line: adding the engine MA writes
    // instances and never `cs.overlays`.
    const withOverlays = { indicatorInstances: [], overlays: [{ type: 'EMA', period: 9, enabled: true }] }
    const [cs] = add(withOverlays, 'movingAverage')
    expect(cs.overlays, 'a legacy overlay was rewritten').toEqual(withOverlays.overlays)
  })
})

describe('⚰️⚰️ the legacy row is WITHHELD, not deleted — and comes back to be revived', () => {
  // ⛔ TWO MEMBER REPORTS PULL OPPOSITE WAYS AND BOTH ARE REAL:
  //   · "I removed my moving average and search finds nothing" — the legacy row
  //     exists so adding REVIVES the tombstone with the member's colour/period.
  //   · "I added a Moving Average but cannot put it on QQQ" — two rows read the
  //     same and the findable one had no source.
  // Hiding it outright answers the second by re-breaking the first, so the offer
  // is conditional on there being something to revive.
  it('⛔ an ordinary chart offers ONE Moving Average', () => {
    const plain = { overlays: [{ type: 'EMA', period: 9 }, { type: 'SMA', period: 50 }] }
    expect(hiddenLibraryIds(plain)).toContain('ma')
  })

  it('⭐⭐ a chart with a TOMBSTONED overlay offers the legacy row again', () => {
    // There the row means "give me my EMA 9 back", not "here is a second MA".
    const removed = { overlays: [{ type: 'EMA', period: 9, removed: true }, { type: 'SMA', period: 50 }] }
    expect(hiddenLibraryIds(removed), 'the revive path is unreachable').not.toContain('ma')
    // …and `dataSeries` stays hidden either way — this is about `ma` alone.
    expect(hiddenLibraryIds(removed)).toContain('dataSeries')
  })

  it('⛔ a chart with no overlays at all still shows one Moving Average', () => {
    expect(hiddenLibraryIds({})).toContain('ma')
    expect(hiddenLibraryIds({ overlays: [] })).toContain('ma')
    expect(hiddenLibraryIds(null)).toContain('ma')
  })
})

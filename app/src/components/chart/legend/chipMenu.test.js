import { describe, it, expect, vi } from 'vitest'
import { chipMenuItems, moveTargetRefusal, currentTargetOf, MOVE_TARGETS } from './chipMenu'
import * as engineRegistry from '../engine/nativeRegistry'
import { resolvePlacement } from '../engine/placement'
import { computePaneLayout, paneMode } from '../engine/paneLayout'
// ⚠️ FROM `defSchema`, WHICH IS WHERE THE VOCABULARY LIVES — `instances.js`
// IMPORTS it to validate against and re-exports nothing, so a read from there
// would have been a read of a name that does not exist.
import { PLACEMENT_TARGETS } from '../engine/defSchema'

const chip = (over = {}) => ({
  defId: 'rsi', plotKey: 'rsi', instanceId: 'legacy:rsi',
  label: 'RSI(14)', color: '#7b68ef', decimals: 1, value: 54.3, hidden: false,
  text: 'RSI(14) 54.3', ...over,
})
const handlers = () => ({
  onSettings: vi.fn(), onToggleHidden: vi.fn(), onMove: vi.fn(), onDuplicate: vi.fn(),
  onAlerts: vi.fn(), onAbout: vi.fn(), onRemove: vi.fn(),
})
const rows = (c, id = 'rsi', h = handlers()) =>
  chipMenuItems(c, engineRegistry.getDefinition(id), h)

describe('chipMenuItems — spec §6\'s rows, from ONE source', () => {
  it('offers exactly the declared actions, in the declared order', () => {
    // ⭐ THE EXPECTATION MOVED, THE ASSERTION DID NOT (chart-UX-walls Task 6).
    // `duplicate` is the seventh row and it sits between Move and Alerts:
    // everything above the separator changes what is drawn, and a row that ADDS
    // a line does not belong on the destructive side of it.
    const items = rows(chip()).filter(i => !i.separator)
    expect(items.map(i => i.key))
      .toEqual(['settings', 'hidden', 'move', 'duplicate', 'alerts', 'about', 'remove'])
  })

  it('⭐ Duplicate names the DEFINITION and hands back the INSTANCE id', () => {
    // The row is per DEFINITION in what it says ("another RSI") and per INSTANCE
    // in what it passes, because the caller has to prove the instance still
    // exists before minting a sibling for it — a chip whose × already fired
    // would otherwise add an indicator the user never asked for.
    const h = handlers()
    const dup = chipMenuItems(chip(), engineRegistry.getDefinition('rsi'), h)
      .find(i => i.key === 'duplicate')
    expect(dup.label).toBe(`Duplicate ${engineRegistry.getDefinition('rsi').meta.name}`)
    expect(dup.disabled, 'Duplicate is refused — nothing here can refuse it').toBeUndefined()
    dup.onClick()
    expect(h.onDuplicate).toHaveBeenCalledWith('legacy:rsi')
    // …and it falls back to the defId rather than printing `undefined`, exactly
    // as About does, for a chip whose definition the registry cannot resolve.
    expect(chipMenuItems(chip({ defId: 'ghost' }), null, handlers())
      .find(i => i.key === 'duplicate').label).toBe('Duplicate ghost')
  })

  it('the Hide row states which way it goes — a toggle labelled "Hide" on a hidden chip is a lie', () => {
    expect(rows(chip()).find(i => i.key === 'hidden').label).toBe('Hide RSI(14)')
    expect(rows(chip({ hidden: true })).find(i => i.key === 'hidden').label).toBe('Show RSI(14)')
  })

  it('Remove is the only danger row, and it is the only one behind a separator', () => {
    const items = rows(chip())
    expect(items.filter(i => i.danger).map(i => i.key)).toEqual(['remove'])
    const sep = items.findIndex(i => i.separator)
    expect(sep, 'the destructive row is not separated from the rest').toBeGreaterThan(0)
    expect(items.slice(sep + 1).map(i => i.key)).toEqual(['remove'])
  })

  it('⛔ Move offers only targets the VALIDATOR accepts, and the current one is CHECKED', () => {
    const move = rows(chip()).find(i => i.key === 'move')
    expect(move.submenu.map(s => s.target)).toEqual(['price', 'pane', 'volume'])
    // ⛔ DERIVED, NOT TYPED: the three rows are exactly the three values
    // `normalizeInstances` will accept on an instance. An offer outside that set
    // is an instance the validator DROPS — an indicator that vanishes on the next
    // paint rather than moving.
    expect(MOVE_TARGETS.map(t => t.target).sort()).toEqual([...PLACEMENT_TARGETS].sort())
    // The CURRENT target is checked, never offered as a destination that does
    // nothing — `rsi` declares `pane`, and the chip carries no override.
    const pane = move.submenu.find(s => s.target === 'pane')
    expect(pane.checked).toBe(true)
    expect(pane.disabled, 'the current placement is offered as a destination').toBeTruthy()
    expect(pane.onClick, 'a refused row still carries a handler').toBeUndefined()
  })

  it('…and an instance that OVERRODE its target is checked on the override, not the declaration', () => {
    const move = rows(chip({ placementTarget: 'price' })).find(i => i.key === 'move')
    expect(move.submenu.filter(s => s.checked).map(s => s.target)).toEqual(['price'])
    // …so the definition's own `pane` is now a real destination again.
    expect(move.submenu.find(s => s.target === 'pane').disabled).toBeUndefined()
  })

  it('a PRICE-target definition cannot be moved AT ALL, and the row says so once', () => {
    const items = rows(chip({ defId: 'bb', instanceId: 'legacy:bb', label: 'BB(20, 2)' }), 'bb')
    const move = items.find(i => i.key === 'move')
    const vol = move.submenu.find(s => s.target === 'volume')
    expect(vol.disabled, 'a price overlay in the volume pane is not a placement the binder resolves')
      .toBeTruthy()
    expect(move.submenu.find(s => s.target === 'pane').disabled,
      'a price overlay is given no pane by `computePaneLayout`, so this move unbinds it').toBeTruthy()
    expect(move.submenu.every(s => s.disabled),
      'a price overlay has a live destination — the rail below says the binder disagrees').toBe(true)
    expect(move.disabled, 'every destination is refused and the ROW is still live').toBeTruthy()
  })

  it('every row calls its handler with the INSTANCE id, never the defId', () => {
    const h = handlers()
    const items = chipMenuItems(chip(), engineRegistry.getDefinition('rsi'), h)
    for (const item of items) if (item.onClick) item.onClick()
    // ⚠️ `move` carries NO `onClick` — it is a submenu — so `onMove` is fired
    // through the submenu instead of weakening the assertion to "some handler ran".
    const dest = items.find(i => i.key === 'move').submenu.filter(s => s.onClick)
    expect(dest.length, 'no live destination to fire — this half is vacuous').toBeGreaterThan(0)
    for (const s of dest) s.onClick()

    for (const fn of [h.onSettings, h.onToggleHidden, h.onDuplicate, h.onAlerts, h.onAbout, h.onRemove]) {
      expect(fn).toHaveBeenCalledWith('legacy:rsi')
    }
    for (const call of h.onMove.mock.calls) expect(call[0]).toBe('legacy:rsi')
    expect(h.onMove.mock.calls.length).toBe(dest.length)
    // ⛔ AND THE CONTROL: no handler was called with the DEFINITION id, which is
    // what every earlier write door takes and what would hide the wrong RSI.
    for (const fn of Object.values(h)) {
      for (const call of fn.mock.calls) {
        expect(call[0], 'a handler was addressed by defId — that is the wrong RSI')
          .not.toBe('rsi')
      }
    }
  })

  it('the Alerts row names the chip, and goes DEAD when the mount cannot open the popover', () => {
    const live = rows(chip()).find(i => i.key === 'alerts')
    expect(live.label).toBe('Add alert on RSI(14)…')
    expect(live.disabled).toBeUndefined()
    expect(typeof live.onClick).toBe('function')
    // A mount with no symbol (or no toolbar) has no alert popover to open — the
    // 🔔 button is `disabled` there for the same reason. A live row would be a
    // row that opens nothing.
    const dead = chipMenuItems(chip(), engineRegistry.getDefinition('rsi'), handlers(),
      { alertsRefusal: 'pick a symbol first' }).find(i => i.key === 'alerts')
    expect(dead.disabled).toBe('pick a symbol first')
    expect(dead.onClick, 'a refused row still carries a handler').toBeUndefined()
  })

  it('About names the definition, and falls back to the defId rather than printing undefined', () => {
    expect(rows(chip()).find(i => i.key === 'about').label)
      .toBe(`About ${engineRegistry.getDefinition('rsi').meta.name}`)
    expect(chipMenuItems(chip({ defId: 'ghost' }), null, handlers())
      .find(i => i.key === 'about').label).toBe('About ghost')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// ─── THE RAIL: THIS FILE'S REFUSALS ARE THE RENDERER'S, MEASURED ────────────
//
// ⛔ A DISABLED REASON IS A CLAIM ABOUT THE BINDER, AND A CLAIM ABOUT THE BINDER
// THAT NOTHING CHECKS IS THE `legendParams`-DECLARED-AND-INERT DEFECT WEARING A
// DIFFERENT COAT. So the two refusals `chipMenu` can give are driven against the
// REAL `resolvePlacement`, over the REAL registry, with a REAL `computePaneLayout`
// — every definition × every target, sixteen definitions and three targets each.
//
// `resolvePlacement` returning `null` means `binder.sync` binds NOTHING
// (`placement.js` — *"an indicator nobody can place renders nothing rather than
// landing somewhere plausible-looking"*). A menu that offered that move would
// take the indicator off the chart while leaving its box ticked.
describe('⛔ the Move refusals are DERIVED from the renderer, not asserted about it', () => {
  const DEFS = engineRegistry.listDefinitions()

  /** `resolvePlacement`'s answer for `def` moved to `target`, through a real
   *  layout built from a real one-instance list. */
  const resolveAt = (def, target, { overlaid = false } = {}) => {
    const inst = {
      instanceId: `probe:${def.id}`, defId: def.id, defVersion: def.version,
      inputs: {}, placement: { target }, hidden: false,
    }
    const volOverlaySet = new Set(overlaid ? [def.id] : [])
    const layout = computePaneLayout([inst], {
      chartHeight: 600, hasVolumeBand: false, excludeKeys: volOverlaySet,
    })
    return resolvePlacement(inst, def, {
      paneMargins: layout.bands,
      paneLayout: layout,
      volOverlaySet,
      volSeparatePane: overlaid,
      VOL_PANE_INDEX: 1,
    })
  }

  it('the subject is not empty, and the probe really can produce BOTH answers', () => {
    expect(DEFS.length, 'no definitions — every loop below is vacuous').toBeGreaterThan(10)
    expect(paneMode(), 'the rail was measured under real panes (Flip C)').toBe('panes')
    const all = DEFS.flatMap(d => MOVE_TARGETS.map(t => resolveAt(d, t.target)))
    expect(all.some(r => r === null),
      'the probe never resolves to null — the whole rail would be vacuously satisfied').toBe(true)
    expect(all.some(r => r !== null),
      'the probe resolves NOTHING — the layout it builds is broken, not the menu').toBe(true)
  })

  it('⭐ every move this menu OFFERS is one the binder resolves — and every null is refused', () => {
    const offeredButUnbindable = []
    const refusedButBindable = []
    for (const def of DEFS) {
      const current = currentTargetOf({}, def)
      for (const { target } of MOVE_TARGETS) {
        const refusal = moveTargetRefusal(def, target, current)
        const resolved = resolveAt(def, target)
        if (!refusal && resolved === null) {
          offeredButUnbindable.push(`${def.id} → ${target}`)
        }
        // The converse, scoped to the reason that CLAIMS unbindability: the
        // "already here" and "chart-wide toggle" refusals are about meaning, not
        // about the binder, and are gated by their own cases below.
        if (refusal && /no pane of its own/.test(refusal) && resolved !== null) {
          refusedButBindable.push(`${def.id} → ${target}`)
        }
      }
    }
    expect(offeredButUnbindable,
      'the menu offers a move `resolvePlacement` returns null for. `binder.sync` skips a binding '
      + 'whose placement does not resolve, so this row takes the indicator OFF THE CHART while '
      + 'its box stays ticked — the silent-vanish the fail-closed posture exists to prevent.')
      .toEqual([])
    expect(refusedButBindable,
      'the menu refuses a move with "no pane of its own" that the binder resolves fine. The '
      + 'reason is stale — re-derive it against `paneLayout.paneTargetIds`, do not delete the row.')
      .toEqual([])
  })

  it('⛔ and the population is real: exactly the PRICE-declared definitions lose their pane', () => {
    // Non-vacuity with teeth. If `paneTargetIds` ever stopped deriving from the
    // DEFINITION's target, the equality above would still hold (both sides move
    // together) while this equality names who is affected.
    const noPane = DEFS.filter(d => resolveAt(d, 'pane') === null).map(d => d.id).sort()
    const declaredPrice = DEFS
      .filter(d => (d.placement && d.placement.target) !== 'pane').map(d => d.id).sort()
    expect(noPane, 'the set of definitions `computePaneLayout` gives no pane is no longer the '
      + 'set that declares a PRICE target — `chipMenu`\'s reason names the wrong mechanism')
      .toEqual(declaredPrice)
    expect(noPane.length, 'no definition is pane-less — the refusal has no subject').toBeGreaterThan(0)
    expect(noPane.length, 'EVERY definition is pane-less — the layout probe is broken')
      .toBeLessThan(DEFS.length)
  })

  it('⭐ "volume" is INERT as an instance placement — measured, both ways round', () => {
    // The reason the Volume row is refused for every definition. It is not that
    // it is unbindable — for a pane definition it binds perfectly — it is that it
    // binds to the SAME PLACE `pane` does, because `resolvePlacement` reads the
    // overlay decision from `cs.volumeOverlayIndicators` and never from the
    // instance's target. A persisted no-op with a tick beside it.
    const paneDefs = DEFS.filter(d => (d.placement && d.placement.target) === 'pane')
    expect(paneDefs.length, 'no pane definitions — this case is vacuous').toBeGreaterThan(3)
    for (const def of paneDefs) {
      expect(resolveAt(def, 'volume'), `${def.id}: 'volume' resolved differently from 'pane' with `
        + 'the chart-wide overlay list EMPTY — the instance target has become meaningful and the '
        + 'Volume row can be enabled')
        .toEqual(resolveAt(def, 'pane'))
      expect(resolveAt(def, 'volume', { overlaid: true }),
        `${def.id}: 'volume' resolved differently from 'pane' with the definition IN the '
        + 'chart-wide overlay list`)
        .toEqual(resolveAt(def, 'pane', { overlaid: true }))
    }
    // …and the control: the two contexts really do produce different answers, so
    // the equalities above are not comparing one constant with itself.
    const probe = paneDefs[0]
    expect(resolveAt(probe, 'pane', { overlaid: true }),
      'the overlay context changed nothing — the pair of equalities above is one equality')
      .not.toEqual(resolveAt(probe, 'pane'))
    // …and every definition therefore refuses it, in one place.
    for (const def of DEFS) {
      expect(moveTargetRefusal(def, 'volume', currentTargetOf({}, def)), def.id).toBeTruthy()
    }
  })
})

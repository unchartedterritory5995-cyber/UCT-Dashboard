// app/src/components/chart/legend/chipMenu.test.js
//
// ─── THE ROWS BEHIND A LEGEND LABEL, AND WHERE THEIR DESTINATIONS COME FROM ──
//
// ⚰️⚰️ THIS FILE USED TO CARRY A 200-LINE RAIL THAT DROVE `moveTargetRefusal`
// AGAINST `resolvePlacement` — every definition × every target, with a real
// `computePaneLayout` — to prove that `chipMenu`'s hand-written refusals agreed
// with the renderer's. It was a good rail for a bad design: the reason it had to
// exist is that this module HELD ITS OWN COPY of the placement rules, and a
// second copy of a rule is a thing you can only keep honest by measuring it.
//
// ⭐⭐ THE COPY IS GONE. `displayTargetOptions` is now the one function that
// answers *"where may this instance draw?"* — for the on-chart popover and for
// Chart Settings → Indicators alike — so the rail this file needs is no longer
// *"do two implementations agree?"* but *"does the menu show what the helper
// said, unaltered?"*. That is what the second block below drives, over a REAL
// settings blob with a REAL host pane, because the answer it is checking is the
// one Universal Data made possible and the old list could not express:
// `@<hostInstanceId>`.
//
// The refusals themselves keep their own rails where the rules now live —
// `ChartSettingsModal.displayIn.test.jsx` (orphan, self-exclusion, tombstones)
// and `engine/__tests__/instanceHostedPanes.test.jsx`.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { chipMenuItems, displaySubmenu } from './chipMenu'
import * as engineRegistry from '../engine/nativeRegistry'
import { mergeChartSettings } from '../chartDefaults'
import { createDirectSeries, lastCreatedInstance } from '../discoveryCatalog'
import { symbolSource } from '../engine/sourceRef'
import { clearSecondaryBars, primeSecondaryBars } from '../engine/secondaryBars'
import { addInstance, findInstance } from '../engine/instanceControls'
import { displayTargetOptions, resolveDisplayTarget } from '../engine/displayTarget'

const chip = (over = {}) => ({
  defId: 'rsi', plotKey: 'rsi', instanceId: 'legacy:rsi',
  label: 'RSI(14)', color: '#7b68ef', decimals: 1, value: 54.3, hidden: false,
  text: 'RSI(14) 54.3', ...over,
})
const handlers = () => ({
  onSettings: vi.fn(), onToggleHidden: vi.fn(), onMove: vi.fn(), onDuplicate: vi.fn(),
  onAlerts: vi.fn(), onAbout: vi.fn(), onRemove: vi.fn(),
})
const rows = (c, id = 'rsi', h = handlers(), caps = {}) =>
  chipMenuItems(c, engineRegistry.getDefinition(id), h, caps)

describe('chipMenuItems — the approved V1 rows, from ONE source', () => {
  it('offers exactly the declared actions, in the declared hierarchy', () => {
    // ⭐ THE ORDER IS THE HIERARCHY: visibility and placement are the
    // high-frequency verbs and lead; the full editor and the additive verbs
    // follow; the one destructive verb is alone below a rule.
    // ⚰️ `settings` USED TO BE FIRST AND IS NOW THIRD — it opens a MODAL, which
    // is the least frequent thing a member does to a plotted line, and it sat
    // above Hide for no reason other than spec order.
    const items = rows(chip()).filter(i => !i.separator)
    expect(items.map(i => i.key))
      .toEqual(['hidden', 'move', 'settings', 'duplicate', 'alerts', 'about', 'remove'])
  })

  it('⭐ the full-editor row is the ONE channel, and it says where it goes', () => {
    const h = handlers()
    const s = chipMenuItems(chip(), engineRegistry.getDefinition('rsi'), h)
      .find(i => i.key === 'settings')
    expect(s.label).toBe('Edit in Indicators…')
    s.onClick()
    expect(h.onSettings).toHaveBeenCalledWith('legacy:rsi')
  })

  it('⭐ Duplicate hands back the INSTANCE id', () => {
    // It is per INSTANCE in what it passes, because the caller has to prove the
    // instance still exists before minting a sibling for it — a chip whose Delete
    // already fired would otherwise add an indicator the user never asked for.
    // ⚰️ IT USED TO SAY `Duplicate Relative Strength Index`, which was the widest
    // row in the menu and the reason the popover was as wide as it was.
    const h = handlers()
    const dup = chipMenuItems(chip(), engineRegistry.getDefinition('rsi'), h)
      .find(i => i.key === 'duplicate')
    expect(dup.label).toBe('Duplicate')
    expect(dup.disabled, 'Duplicate is refused — nothing here can refuse it').toBeUndefined()
    dup.onClick()
    expect(h.onDuplicate).toHaveBeenCalledWith('legacy:rsi')
  })

  it('the Hide row states which way it goes — a toggle labelled "Hide" on a hidden chip is a lie', () => {
    // ⚰️ IT USED TO NAME THE CHIP — `Hide RSI(14)`. The popover's header names it
    // directly above, so the row repeated it and set the menu's width from its
    // longest label (owner, 2026-09-14: bare verbs). The DIRECTION is the part
    // that was never decorative and it is still here.
    expect(rows(chip()).find(i => i.key === 'hidden').label).toBe('Hide')
    expect(rows(chip({ hidden: true })).find(i => i.key === 'hidden').label).toBe('Show')
  })

  it('Delete is the only danger row, and it is the only one behind the LAST separator', () => {
    const items = rows(chip())
    expect(items.filter(i => i.danger).map(i => i.key)).toEqual(['remove'])
    const seps = items.map((i, n) => (i.separator ? n : -1)).filter(n => n >= 0)
    expect(seps.length, 'the destructive row is not separated from the rest').toBeGreaterThan(0)
    expect(items.slice(seps[seps.length - 1] + 1).map(i => i.key)).toEqual(['remove'])
  })

  it('⭐⭐ Delete fires on the FIRST click — no arming, no confirm, no modal', () => {
    // ⚰️ IT USED TO ARM: a first click re-labelled the row `Delete RSI(14)?` and
    // a second fired it. The owner removed the second click (2026-09-14). The row
    // is red, destructive-styled, alone below a rule and last in the menu, and
    // that is the protection a plot-management action warrants — the hazard the
    // arming replaced was an 11px ✕ five pixels from the gear on a strip that
    // reflowed under the pointer, and neither of those facts is true of a menu row
    // you travelled to deliberately.
    const h = handlers()
    const row = chipMenuItems(chip(), engineRegistry.getDefinition('rsi'), h)
      .find(i => i.key === 'remove')
    expect(row.label).toBe('Delete')
    expect(row.danger).toBe(true)
    // ⛔ NO `keepOpen` — the click removes the instance and the popover closes
    // with the thing it was about.
    expect(row.keepOpen, 'the popover stays open after a delete').toBeFalsy()
    row.onClick()
    expect(h.onRemove, 'Delete did not fire on the first click')
      .toHaveBeenCalledWith('legacy:rsi')
    expect(h.onRemove).toHaveBeenCalledTimes(1)
  })

  it('every row calls its handler with the INSTANCE id, never the defId', () => {
    const h = handlers()
    const items = chipMenuItems(chip(), engineRegistry.getDefinition('rsi'), h, {
      displayOptions: [{ value: 'price', label: 'Price', group: 'shared' }],
      displayCurrent: 'pane',
    })
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
    expect(live.label).toBe('Add alert…')
    expect(live.disabled).toBeUndefined()
    expect(typeof live.onClick).toBe('function')
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

  it('⛔ NO DESTINATIONS ⇒ the Display-in row is dead, and it says so ONCE', () => {
    // `displayTargetOptions` answers EMPTY for a definition with exactly one
    // place to draw — the same test Chart Settings uses to render no control at
    // all. The row is disabled with a sentence, not silently live.
    const move = rows(chip()).find(i => i.key === 'move')
    expect(move.submenu).toEqual([])
    expect(move.disabled).toBeTruthy()
    expect(move.disabled).toMatch(/nowhere else/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// ─── THE RAIL: THE MENU SHOWS WHAT THE HELPER SAID, UNALTERED ───────────────
//
// ⛔⛔ THE INVARIANT THAT REPLACED A 200-LINE AGREEMENT PROOF. There is one
// placement truth and this module is not it: every row of the Display-in page is
// a `displayTargetOptions` entry in the order that helper returned it, with the
// CURRENT one ticked-and-refused and a `missing` one refused and never healed.
// If this module ever grows a rule of its own again — a filter, a reorder, a
// target it invents — one of these equalities breaks.
//
// ⭐ AND IT IS DRIVEN OVER A REAL BLOB WITH A REAL HOST PANE, because
// `@<hostInstanceId>` is exactly the destination the old hard-coded list could
// not express and is therefore the one a regression would drop first.
const TF = 'D'
const WINDOW = 400
function prime(symbol) {
  primeSecondaryBars(symbol, TF, WINDOW, {
    bars: Array.from({ length: 12 }, (_, i) => ({
      t: `2026-09-${String(i + 1).padStart(2, '0')}`,
      o: 100 + i, h: 102 + i, l: 99 + i, c: 101 + i, v: 1000,
    })),
  })
}
function withSeries(cs, symbol) {
  prime(symbol)
  const next = createDirectSeries(cs, symbolSource(symbol, 'close'), engineRegistry, { name: symbol })
  return { cs: next, id: lastCreatedInstance(cs, next).instanceId }
}

describe('⛔ the Display-in page IS `displayTargetOptions`, shaped — not a second rule', () => {
  beforeEach(() => { clearSecondaryBars() })
  afterEach(() => { clearSecondaryBars() })

  /** A chart with two direct series: QQQ (a pane HOST) and SPY. */
  const twoSeries = () => {
    const a = withSeries(mergeChartSettings({}), 'QQQ')
    const b = withSeries(a.cs, 'SPY')
    return { cs: b.cs, qqq: a.id, spy: b.id }
  }
  const optionsFor = (cs, id) => {
    const inst = findInstance(cs, id)
    const defOf = (d) => engineRegistry.getDefinition(d)
    return {
      options: displayTargetOptions(inst, cs, defOf),
      current: resolveDisplayTarget(inst, cs),
    }
  }
  const submenuFor = (cs, id, h = handlers()) => {
    const { options, current } = optionsFor(cs, id)
    const inst = findInstance(cs, id)
    return chipMenuItems(
      chip({ instanceId: id, defId: inst.defId, label: 'SPY' }),
      engineRegistry.getDefinition(inst.defId), h,
      { displayOptions: options, displayCurrent: current },
    ).find(i => i.key === 'move')
  }

  it('the fixture really produces a host pane — otherwise every case below is vacuous', () => {
    const { cs, qqq, spy } = twoSeries()
    const { options } = optionsFor(cs, spy)
    expect(options.length, 'no destinations at all — the fixture is broken, not the menu')
      .toBeGreaterThan(2)
    expect(options.some(o => o.value === `@${qqq}`),
      'the helper offers no host-instance pane — the thing Universal Data made possible and the '
      + 'retired hard-coded list could never express').toBe(true)
  })

  it('⭐⭐ every row is a helper option, in the helper’s own order, with the helper’s label', () => {
    const { cs, spy } = twoSeries()
    const { options } = optionsFor(cs, spy)
    const move = submenuFor(cs, spy)
    expect(move.submenu.map(s => s.target)).toEqual(options.map(o => o.value))
    expect(move.submenu.map(s => s.label)).toEqual(options.map(o => o.label))
  })

  it('⛔ the CURRENT target is ticked, refused, and carries no handler', () => {
    const { cs, spy } = twoSeries()
    const { current } = optionsFor(cs, spy)
    const move = submenuFor(cs, spy)
    const here = move.submenu.filter(s => s.checked)
    expect(here.map(s => s.target), 'the current target is not ticked exactly once')
      .toEqual([current])
    expect(here[0].disabled).toBe('it is already here')
    // ⛔ NO HANDLER ON A REFUSED ROW — a handler that exists is one a keyboard, a
    // test or a future renderer can still fire, and `setInstanceDisplayTarget`
    // would refuse it by identity anyway. A click that changes nothing is the
    // defect class this whole surface exists to retire.
    expect(here[0].onClick).toBeUndefined()
  })

  it('⭐ a host pane is a LIVE destination, and firing it passes the canonical target string', () => {
    const { cs, qqq, spy } = twoSeries()
    const h = handlers()
    const move = submenuFor(cs, spy, h)
    const intoQqq = move.submenu.find(s => s.target === `@${qqq}`)
    expect(intoQqq, 'the QQQ pane is not offered').toBeTruthy()
    expect(intoQqq.disabled).toBeUndefined()
    intoQqq.onClick()
    expect(h.onMove).toHaveBeenCalledWith(spy, `@${qqq}`)
  })

  it('⛔⛔ an ORPHANED target is SHOWN, refused, and never silently healed', () => {
    // The helper lists a stored target whose host is gone, flagged `missing`, and
    // the member's placement is preserved. A menu that omitted it would tell a
    // member their line is fine while it draws nothing — which is exactly how the
    // original defect hid.
    const missing = { value: '@inst:ghost', label: 'Pane unavailable', group: 'missing', missing: true }
    const sub = displaySubmenu(
      [missing, { value: 'price', label: 'Price', group: 'shared' }],
      '@inst:ghost', vi.fn(), 'inst:spy',
    )
    expect(sub[0].label).toBe('Pane unavailable')
    expect(sub[0].disabled).toMatch(/no longer exists/)
    expect(sub[0].onClick).toBeUndefined()
    // …and the live one beside it is still live, so the refusal is targeted.
    expect(sub[1].disabled).toBeUndefined()
  })

  it('a price overlay with nowhere to go gets an EMPTY page and a dead row', () => {
    // `bb` declares a price target and reads no source, so `displayTargetOptions`
    // answers empty — derived, never a list of ids typed here.
    const cs = addInstance(mergeChartSettings({}), 'bb', engineRegistry)
    const inst = (cs.indicatorInstances || []).find(i => i && i.defId === 'bb')
    const { options, current } = optionsFor(cs, inst.instanceId)
    expect(options).toEqual([])
    const move = chipMenuItems(
      chip({ instanceId: inst.instanceId, defId: 'bb', label: 'BB(20, 2)' }),
      engineRegistry.getDefinition('bb'), handlers(),
      { displayOptions: options, displayCurrent: current },
    ).find(i => i.key === 'move')
    expect(move.submenu).toEqual([])
    expect(move.disabled, 'every destination is refused and the ROW is still live').toBeTruthy()
  })
})

// ─── §21 · THE SUBSTRATE'S NAME NEVER REACHES A MEMBER ──────────────────────
//
// ⚰️ MEASURED ON PRODUCTION 2026-09-16, on the very surface this project built.
// A member searches `QQQ`, clicks it, then clicks its legend row — and the
// popover offered **"About Data Series"** over a subtitle reading **"Data Series ·
// Own pane"**. `dataSeries` is the substrate; the owner's §21 names it explicitly
// as language a member must never encounter, and this change is what made that
// row reachable in one click.
describe('⛔⛔ a definition whose identity IS its source lends no noun to the member', () => {
  const chipFor = (defId, label) => ({ defId, instanceId: `inst:${defId}:1`, plotKey: 'value', label })
  const noop = () => {}
  const handlers = {
    onHide: noop, onMove: noop, onSettings: noop,
    onDuplicate: noop, onAlerts: noop, onAbout: noop, onRemove: noop,
  }
  const rowsFor = (def, chip) => chipMenuItems(chip, def, handlers, {})

  it('⭐⭐ `About` names the SERIES for a source-named definition', () => {
    const def = { id: 'dataSeries', meta: { name: 'Data Series', labelFrom: 'source' } }
    const labels = rowsFor(def, chipFor('dataSeries', 'QQQ')).filter(Boolean).map((r) => r.label || '')
    expect(labels.join(' | '), 'the substrate name reached the member').not.toMatch(/Data Series/)
    expect(labels.some((l) => /^About QQQ$/.test(l)), `got: ${labels.join(' | ')}`).toBe(true)
  })

  it('⛔ AND EVERY OTHER DEFINITION KEEPS ITS CATALOGUE NAME — the narrow half', () => {
    // This row exists to explain the INDICATOR. `About Moving Average` is the
    // right answer; `About EMA 9` would be a worse one, and MACD's `SIG` chip
    // must never read `About SIG`.
    const ma = { id: 'movingAverage', meta: { name: 'Moving Average' } }
    const maLabels = rowsFor(ma, chipFor('movingAverage', 'EMA 9')).filter(Boolean).map((r) => r.label || '')
    expect(maLabels.some((l) => /^About Moving Average$/.test(l)), maLabels.join(' | ')).toBe(true)

    const macd = { id: 'macd', meta: { name: 'MACD' } }
    const sigLabels = rowsFor(macd, chipFor('macd', 'SIG')).filter(Boolean).map((r) => r.label || '')
    expect(sigLabels.some((l) => /^About MACD$/.test(l)), sigLabels.join(' | ')).toBe(true)
  })
})

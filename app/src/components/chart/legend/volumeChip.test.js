// app/src/components/chart/legend/volumeChip.test.js
//
// ─── Owner 11-16 (Option C) · VOLUME'S MENU IS AN INDICATOR'S MENU ──────────
//
// `volumeChip.js` describes Volume as a synthetic chip and asks `chipMenuItems` for its
// rows. These cases pin the owner-approved menu: Hide · Display in ▸ · (Reset pane
// height) · Edit in Indicators… · Value in header (not yet) · Add alert… (not yet) ·
// About Volume · ——— · Delete — and no Duplicate, custom copy or Preset.
import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  volumeMenuItems, volumeMenuCaps, volumeChipOf, volumePaneSizeStored,
  withVolumeDisplay, withVolumePaneHeightReset, VOLUME_NOT_YET, VOLUME_ABOUT,
} from './volumeChip'
import { CHIP_MENU_GROUPS } from './chipMenu'
import { mergeChartSettings } from '../chartDefaults'
import { setPaneSize, storedPaneSizes } from '../engine/paneSizes'
import { toggledRow } from '../IndicatorLibraryDialog'
import { nativeVolumeOwnsPane, volumePaneRequired } from '../engine/volumePresentation'
import { PANE_LOOK } from '../pane/paneLook'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const keys = (rows) => rows.filter((r) => r && r.key).map((r) => r.key)
const byKey = (rows, k) => rows.find((r) => r && r.key === k)
const handlers = () => ({
  onToggleHidden: vi.fn(), onSettings: vi.fn(), onMove: vi.fn(),
  onResetPaneSize: vi.fn(), onAbout: vi.fn(), onRemove: vi.fn(),
})

describe('the Volume menu is chipMenuItems’ own rows', () => {
  it('⭐ the approved rows, in the indicator order, with the indicator group labels', () => {
    const cs = mergeChartSettings({})
    const rows = volumeMenuItems(cs, handlers(), volumeMenuCaps(cs, { ownsPane: true }))
    expect(keys(rows)).toEqual(['hidden', 'move', 'settings', 'info-value', 'alerts', 'about', 'remove'])
    expect(rows.filter((r) => r.groupLabel != null).map((r) => r.groupLabel))
      .toEqual([CHIP_MENU_GROUPS.line, CHIP_MENU_GROUPS.settings, CHIP_MENU_GROUPS.more])
    expect(byKey(rows, 'about').label).toBe('About Volume')
    expect(byKey(rows, 'settings').label).toBe('Edit in Indicators…')
    expect(byKey(rows, 'remove').label).toBe('Delete')
    expect(byKey(rows, 'remove').danger).toBe(true)
    // ⛔ no Duplicate, no custom copy, no Preset — and so no "Copies" group label
    for (const k of ['duplicate', 'custom-copy', 'preset']) expect(keys(rows)).not.toContain(k)
    expect(rows.some((r) => r.groupLabel === CHIP_MENU_GROUPS.copies)).toBe(false)
  })

  it('⛔ Value in header and Add alert… are shown DISABLED with "Not available for Volume yet"', () => {
    const cs = mergeChartSettings({})
    const rows = volumeMenuItems(cs, handlers(), volumeMenuCaps(cs, { ownsPane: true }))
    for (const k of ['info-value', 'alerts']) {
      const r = byKey(rows, k)
      expect(r.disabled).toBe(VOLUME_NOT_YET)
      expect(r.hint).toBe(VOLUME_NOT_YET)
      expect(r.soon).toBe(true) // the UCT Signature menu's "Soon" chip
      expect(r.onClick).toBeUndefined()
    }
    expect(VOLUME_NOT_YET).toBe('Not available for Volume yet')
  })

  it('Hide reads Show on a hidden Volume; every verb hands back the row id', () => {
    const h = handlers()
    const cs = mergeChartSettings({ volume: { visible: false } })
    const rows = volumeMenuItems(cs, h, volumeMenuCaps(cs, { ownsPane: true }))
    expect(volumeChipOf(cs).hidden).toBe(true)
    expect(byKey(rows, 'hidden').label).toBe('Show')
    byKey(rows, 'hidden').onClick(); expect(h.onToggleHidden).toHaveBeenCalledWith('volume')
    byKey(rows, 'settings').onClick(); expect(h.onSettings).toHaveBeenCalledWith('volume')
    byKey(rows, 'remove').onClick(); expect(h.onRemove).toHaveBeenCalledWith('volume')
    byKey(rows, 'about').onClick(); expect(h.onAbout).toHaveBeenCalled()
  })

  it('the About card has words of its own, in American spelling', () => {
    expect(VOLUME_ABOUT.title).toBe('Volume')
    expect(VOLUME_ABOUT.text.length).toBeGreaterThan(40)
    expect(VOLUME_ABOUT.text).not.toMatch(/colour/i)
  })
})

describe('Display in — own pane / overlay on price', () => {
  it('⭐ ticks where it draws now and offers the other; the detail is the option’s words', () => {
    const h = handlers()
    const cs = mergeChartSettings({ volume: { separatePane: true } })
    const move = byKey(volumeMenuItems(cs, h, volumeMenuCaps(cs, { ownsPane: true })), 'move')
    expect(move.disabled).toBeUndefined()
    expect(move.detail).toBe('Own pane')
    expect(move.submenu.map((s) => [s.label, s.checked, !!s.disabled]))
      .toEqual([['Own pane', true, true], ['Overlay on price', false, false]])
    move.submenu[1].onClick()
    expect(h.onMove).toHaveBeenCalledWith('volume', 'price')

    const banded = mergeChartSettings({ volume: { separatePane: false } })
    const m2 = byKey(volumeMenuItems(banded, h, volumeMenuCaps(banded, { ownsPane: false })), 'move')
    expect(m2.detail).toBe('Overlay on price')
    expect(m2.submenu.find((s) => s.checked).target).toBe('price')
  })

  it('⛔ disabled WITH THE HOST’S REASON when the host fixes where Volume draws', () => {
    const cs = mergeChartSettings({})
    const why = "Fixed by this chart's layout"
    const move = byKey(volumeMenuItems(cs, handlers(), volumeMenuCaps(cs, { ownsPane: true, displayFixed: why })), 'move')
    expect(move.disabled).toBe(why)
    for (const s of move.submenu) { expect(s.disabled).toBeTruthy(); expect(s.onClick).toBeUndefined() }
  })

  it('⛔ a series displayed in the Volume pane keeps it from overlaying price, and says so', () => {
    const cs = mergeChartSettings({ volume: { separatePane: false } })
    const move = byKey(volumeMenuItems(cs, handlers(), volumeMenuCaps(cs, { ownsPane: true, guestForcesPane: true })), 'move')
    expect(move.disabled).toMatch(/another series/)
    expect(move.submenu.find((s) => s.target === 'price').onClick).toBeUndefined()
  })

  it('the writer: separatePane AND displayIn, by identity when unchanged', () => {
    const cs = mergeChartSettings({ volume: { separatePane: false } })
    const next = withVolumeDisplay(cs, 'pane')
    expect(next.volume.separatePane).toBe(true)
    expect(next.volume.displayIn).toBe('pane')
    expect(next.preset).toBe('custom')
    expect(withVolumeDisplay(next, 'pane')).toBe(next)
    const back = withVolumeDisplay(next, 'price')
    expect(back.volume.separatePane).toBe(false)
    expect(back.volume.displayIn).toBe('price')
    expect(withVolumeDisplay(cs, 'nowhere')).toBe(cs)
  })

  it('⭐ an old /charts blob (separatePane:false, never chosen) CAN choose Overlay on price', () => {
    // separatePane was inert on /charts, so `false` there never meant "overlay" — the
    // writer must still record the choice rather than call it unchanged.
    const cs = mergeChartSettings({ volume: { separatePane: false } })
    const next = withVolumeDisplay(cs, 'price')
    expect(next).not.toBe(cs)
    expect(next.volume.displayIn).toBe('price')
  })
})

describe('Display in on /charts (volumePaneByDefault) — the member chooses (owner 11-16)', () => {
  const opts = (cs, extra = {}) => ({ cs, volumePaneByDefault: true, shown: true, ...extra })

  it('⭐ ENABLED, both options offered, ticking where Volume draws now', () => {
    const h = handlers()
    const cs = mergeChartSettings({})
    // StockChart's displayFixed is `(volumeSeparatePane || blankVolume)` — /charts passes neither now
    expect(PANE_LOOK.volumeSeparatePane).toBeUndefined()
    const caps = volumeMenuCaps(cs, { ownsPane: nativeVolumeOwnsPane(opts(cs)), paneExists: volumePaneRequired(opts(cs)) })
    const move = byKey(volumeMenuItems(cs, h, caps), 'move')
    expect(move.disabled).toBeUndefined()
    expect(move.detail).toBe('Own pane')
    expect(move.submenu.map((s) => [s.label, s.checked, !!s.disabled]))
      .toEqual([['Own pane', true, true], ['Overlay on price', false, false]])
    move.submenu[1].onClick()
    expect(h.onMove).toHaveBeenCalledWith('volume', 'price')

    const over = withVolumeDisplay(cs, 'price')
    expect(nativeVolumeOwnsPane(opts(over))).toBe(false)
    expect(volumePaneRequired(opts(over)), 'the volume pane survived Overlay on price').toBe(false)
    const m2 = byKey(volumeMenuItems(over, h, volumeMenuCaps(over, { ownsPane: false, paneExists: false })), 'move')
    expect(m2.detail).toBe('Overlay on price')
    expect(m2.submenu.map((s) => [s.label, s.checked, !!s.disabled]))
      .toEqual([['Own pane', false, false], ['Overlay on price', true, true]])
  })

  it('⛔ Reset pane height is hidden in overlay mode (there is no pane to size)', () => {
    const over = setPaneSize(withVolumeDisplay(mergeChartSettings({}), 'price'), 'volume', 0.3)
    const caps = volumeMenuCaps(over, { ownsPane: false, paneExists: volumePaneRequired(opts(over)) })
    expect(keys(volumeMenuItems(over, handlers(), caps))).not.toContain('pane-size-reset')
    // …and the stored size is kept, so Own pane comes back at that height
    const back = withVolumeDisplay(over, 'pane')
    expect(storedPaneSizes(back).volume).toBe(storedPaneSizes(over).volume)
    expect(volumePaneRequired(opts(back))).toBe(true)
  })

  it('⛔ a guest in the Volume pane still forces it — Overlay on price disabled with its reason', () => {
    const cs = mergeChartSettings({ volumeOverlayIndicators: ['rsi'] })
    expect(nativeVolumeOwnsPane(opts(withVolumeDisplay(cs, 'price')))).toBe(true)
    const move = byKey(volumeMenuItems(cs, handlers(), volumeMenuCaps(cs, { ownsPane: true, guestForcesPane: true })), 'move')
    expect(move.disabled).toMatch(/another series/)
  })
})

describe('Reset pane height — only when a size is stored', () => {
  it('⛔ absent on a default pane, and on a chart with no volume pane', () => {
    const cs = mergeChartSettings({ volume: { separatePane: true } })
    expect(keys(volumeMenuItems(cs, handlers(), volumeMenuCaps(cs, { ownsPane: true, paneExists: true }))))
      .not.toContain('pane-size-reset')
    const sized = setPaneSize(cs, 'volume', 0.3)
    expect(keys(volumeMenuItems(sized, handlers(), volumeMenuCaps(sized, { ownsPane: false, paneExists: false }))))
      .not.toContain('pane-size-reset')
  })

  it('⭐ offered for a stored share or a moved slider, right under Display in; the reset forgets both', () => {
    const h = handlers()
    const base = mergeChartSettings({ volume: { separatePane: true } })
    const sized = setPaneSize(base, 'volume', 0.3)
    expect(volumePaneSizeStored(sized)).toBe(true)
    const rows = volumeMenuItems(sized, h, volumeMenuCaps(sized, { ownsPane: true, paneExists: true }))
    expect(keys(rows).indexOf('pane-size-reset')).toBe(keys(rows).indexOf('move') + 1)
    byKey(rows, 'pane-size-reset').onClick()
    expect(h.onResetPaneSize).toHaveBeenCalledWith('volume')

    const both = { ...sized, volume: { ...sized.volume, paneHeightPct: 35 } }
    const reset = withVolumePaneHeightReset(both)
    expect(storedPaneSizes(reset).volume).toBeUndefined()
    expect(reset.volume.paneHeightPct).toBe(22)
    expect(withVolumePaneHeightReset(reset)).toBe(reset)

    // a host that fixes the height makes the slider inert — only the share counts
    const slider = { ...base, volume: { ...base.volume, paneHeightPct: 35 } }
    expect(volumePaneSizeStored(slider)).toBe(true)
    expect(volumePaneSizeStored(slider, { heightFixed: true })).toBe(false)
  })
})

describe('Delete is re-addable from the Indicators library', () => {
  it('⭐ the library flips `removed` back, never `visible`', () => {
    const removed = mergeChartSettings({ volume: { removed: true, visible: false } })
    const back = toggledRow({ builtIn: 'volume' }, removed, null)
    expect(back.volume.removed).toBe(false)
    expect(back.volume.visible).toBe(false)
  })
})

describe('the volume strip is a study stack, like a pane readout', () => {
  it('⭐ `.volLegend` stacks its rows (column, 8px pitch, weight 500) and keeps its own class name', () => {
    const css = fs.readFileSync(path.join(HERE, '../../StockChart.module.css'), 'utf8')
    const rule = css.match(/(?:^|\n)\.volLegend\s*\{([^}]*)\}/g) || []
    const body = rule.join('\n')
    expect(body).toMatch(/flex-direction:\s*column/)
    expect(body).toMatch(/row-gap:\s*8px/)
    expect(body).toMatch(/font-weight:\s*500/)
    const sc = fs.readFileSync(path.join(HERE, '../../StockChart.jsx'), 'utf8')
    const at = sc.indexOf('{volPaneRows.map((r, ri) => (')
    expect(at, 'the strip no longer renders volPaneRows').toBeGreaterThan(0)
    expect(sc.slice(at, at + 1400)).toMatch(/<LegendRow[\s\S]*?\bvertical\b/)
  })
})

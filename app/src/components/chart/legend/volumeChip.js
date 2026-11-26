// app/src/components/chart/legend/volumeChip.js
//
// ─── VOLUME, MANAGED LIKE AN INDICATOR (owner, 2026-11-16 — "Option C") ─────
//
// Volume keeps its bespoke rendering (`cs.volume`: bars, colors, its own pane or a
// band under the candles). What changes is the LEGEND: its row looks and behaves
// exactly like an indicator row — same hover buttons (Hide / Settings / ⋯), same
// popover, same menu rows from `chipMenu.chipMenuItems`, in the same order.
//
// ⭐ THIS FILE IS THE ADAPTER, AND NOTHING ELSE. It describes Volume as a synthetic
// chip `{instanceId: 'volume', label: 'Volume'}`, hands `chipMenuItems` the caps and
// handlers only the CALLER can know, and then adjusts the few rows Volume answers
// differently (a host that fixes its pane, the two "not yet" rows). Every row's
// shape, order, group label and icon stays `chipMenu.js`'s, so the Volume menu
// cannot drift from an indicator's.
//
// ⛔ IMPORTED BY `StockChart` ONLY — it is kept OUT of `chipMenu.js` (and so out of
// the notebook first-open closure that file sits in).
//
// ⛔ NO NEW WRITER FOR HIDE / EDIT / DELETE. Those three are still
// `legendRowHidden` / `legendRowSettings` / `legendRowRemove` in StockChart. The two
// writers here (`withVolumeDisplay`, `withVolumePaneHeightReset`) write the same
// `cs.volume` keys Chart Settings → Indicators → Volume already writes.
import { chipMenuItems } from './chipMenu'
import { clearPaneSize, storedPaneSizes } from '../engine/paneSizes'
import { CHART_DEFAULTS } from '../chartDefaults'

/** Volume's row id on every legend surface, and its pane key in `paneSizes`. */
export const VOLUME_CHIP_ID = 'volume'

/** The reason on the two rows Volume does not support yet (owner-approved copy). */
export const VOLUME_NOT_YET = 'Not available for Volume yet'

/** Volume's "Display in" destinations, in menu order. */
export const VOLUME_DISPLAY_OPTIONS = Object.freeze([
  Object.freeze({ value: 'pane', label: 'Own pane', group: 'Panes' }),
  Object.freeze({ value: 'price', label: 'Overlay on price', group: 'Price' }),
])

/** What our volume counts, said where members read volume (owner ruling 2026-11-25: "keep the full volume with
 *  the note"). Our bars carry the consolidated tape's volume, odd lots included; TradingView's intraday history
 *  leaves odd lots out, so its bars read lower. Static text: the Volume legend row's tooltip and the About card. */
export const VOLUME_SOURCE_NOTE = 'Volume: consolidated, includes odd lots (TradingView excludes them).'

/** The About card — Volume has no engine definition, so its words live here. */
export const VOLUME_ABOUT = Object.freeze({
  title: 'Volume',
  text: 'The number of shares traded in each bar. Up bars take the up color and down bars the down color. '
    + 'Volume can sit in its own pane or overlay the bottom of the price pane, and it can carry its own moving average '
    + '(Edit in Indicators…). Bars that set a 52-week volume high can be highlighted. '
    + 'The count is consolidated across all exchanges and includes odd lots (TradingView excludes them), '
    + 'so it can read higher than TradingView.',
  category: 'Volume',
})

/** Volume's synthetic "definition" — enough for `chipMenuItems` to say `About Volume`. */
const VOLUME_DEF = Object.freeze({ id: VOLUME_CHIP_ID, meta: Object.freeze({ name: 'Volume' }) })

/** The synthetic chip `chipMenuItems` is asked about. */
export function volumeChipOf(cs) {
  return {
    instanceId: VOLUME_CHIP_ID,
    defId: VOLUME_CHIP_ID,
    plotKey: VOLUME_CHIP_ID,
    label: 'Volume',
    hidden: !!(cs && cs.volume && cs.volume.visible === false),
  }
}

const paneHeightDefault = () => {
  const d = CHART_DEFAULTS && CHART_DEFAULTS.volume && CHART_DEFAULTS.volume.paneHeightPct
  return Number.isFinite(d) ? d : 22
}

/**
 * Does the volume pane carry a size the member set?
 *
 * Two places can hold one: the shared `paneSizes.volume` share (a dragged divider in
 * the pane stack) and the legacy `cs.volume.paneHeightPct` slider value. The second
 * counts only when it differs from the default and the host does not fix the height
 * itself (`opts.heightFixed` — a prop that wins over the stored value, so resetting
 * it would change nothing on screen).
 */
export function volumePaneSizeStored(cs, opts = {}) {
  if (!cs || typeof cs !== 'object') return false
  if (storedPaneSizes(cs)[VOLUME_CHIP_ID] !== undefined) return true
  if (opts.heightFixed) return false
  const pct = cs.volume && cs.volume.paneHeightPct
  return pct != null && Number(pct) !== paneHeightDefault()
}

/** "Reset pane height": forget both stored sizes. Identity when nothing changes. */
export function withVolumePaneHeightReset(cs, opts = {}) {
  if (!cs || typeof cs !== 'object') return cs
  let next = clearPaneSize(cs, VOLUME_CHIP_ID)
  const pct = next.volume && next.volume.paneHeightPct
  if (!opts.heightFixed && pct != null && Number(pct) !== paneHeightDefault()) {
    next = { ...next, volume: { ...(next.volume || {}), paneHeightPct: paneHeightDefault() }, preset: 'custom' }
  }
  return next
}

/**
 * "Display in": `'pane'` → its own pane, `'price'` → overlaid on price. Identity when unchanged.
 *
 * ⭐ WRITES TWO KEYS, ONE CHOICE. `separatePane` is what a host with no default of its own
 * reads; `displayIn` is the member's explicit choice on a host that DEFAULTS to a pane
 * (/charts — `volumePaneByDefault`, see `engine/volumePresentation.js`). Old blobs there
 * all say `separatePane: false` without having meant "overlay", so only `displayIn` can
 * tell a choice from the default.
 */
export function withVolumeDisplay(cs, target) {
  if (!cs || typeof cs !== 'object') return cs
  if (target !== 'pane' && target !== 'price') return cs
  const want = target === 'pane'
  const v = cs.volume || {}
  if ((v.separatePane === true) === want && v.displayIn === target) return cs
  return { ...cs, volume: { ...v, separatePane: want, displayIn: target }, preset: 'custom' }
}

/**
 * The caps `chipMenuItems` takes, for Volume.
 *
 * @param {object} cs the live chart settings
 * @param {object} [opts]
 * @param {boolean} [opts.ownsPane]        the native bars draw in a pane of their own now
 * @param {string}  [opts.displayFixed]    the host fixes where Volume draws — the reason (e.g.
 *                                         `VOLUME_PANE_SURFACE_FIXED`); the Display in row is disabled with it
 * @param {boolean} [opts.guestForcesPane] another series is displayed in the volume pane, so it
 *                                         cannot overlay price
 * @param {boolean} [opts.paneExists]      the volume pane is on the chart (Reset pane height needs one)
 * @param {boolean} [opts.heightFixed]     the host fixes the pane's height
 */
export function volumeMenuCaps(cs, opts = {}) {
  return {
    displayOptions: VOLUME_DISPLAY_OPTIONS,
    displayCurrent: opts.ownsPane ? 'pane' : 'price',
    displayFixed: typeof opts.displayFixed === 'string' && opts.displayFixed ? opts.displayFixed : undefined,
    guestForcesPane: opts.guestForcesPane === true,
    paneSizeStored: opts.paneExists === true && volumePaneSizeStored(cs, opts),
    canDuplicate: false,
    alertsRefusal: VOLUME_NOT_YET,
    infoValueOn: false,
    infoValueRefusal: VOLUME_NOT_YET,
  }
}

const noop = () => {}

/**
 * The handlers `chipMenuItems` takes, for Volume. Each takes the row id (always
 * `'volume'`) like an indicator's takes an instance id. The two "not yet" rows get a
 * no-op: they are disabled, so `chipMenuItems` attaches no `onClick` to them anyway.
 */
export function volumeMenuHandlers(h = {}) {
  return {
    onToggleHidden: h.onToggleHidden || noop,
    onSettings: h.onSettings || noop,
    onMove: h.onMove || noop,
    onResetPaneSize: h.onResetPaneSize || noop,
    onAbout: h.onAbout || noop,
    onRemove: h.onRemove || noop,
    onAlerts: noop,
    onInfoValue: noop,
    onDuplicate: noop,
  }
}

/**
 * Volume's menu rows: `chipMenuItems`' own rows for the synthetic Volume chip, with
 * Volume's answers applied —
 *   · Display in: disabled with the host's reason when the host fixes it; "Overlay on
 *     price" disabled while a guest holds the pane; the dimmed detail is the option's
 *     own words.
 *   · Value in header / Add alert…: disabled, hint and reason `VOLUME_NOT_YET`.
 * No Duplicate, no custom copy, no Preset (none are offered for it).
 */
export function volumeMenuItems(cs, h = {}, caps = volumeMenuCaps(cs)) {
  const rows = chipMenuItems(volumeChipOf(cs), VOLUME_DEF, volumeMenuHandlers(h), caps)
  return rows.map((r) => {
    if (!r || !r.key) return r
    if (r.key === 'move') {
      const priceRefusal = caps.guestForcesPane ? 'another series is displayed in the Volume pane' : undefined
      const submenu = (r.submenu || []).map((s) => {
        const why = caps.displayFixed || (s.target === 'price' && !s.checked ? priceRefusal : undefined) || s.disabled
        return why ? { ...s, disabled: why, onClick: undefined } : s
      })
      const movable = submenu.some((s) => !s.disabled)
      const current = VOLUME_DISPLAY_OPTIONS.find((o) => o.value === caps.displayCurrent)
      return {
        ...r,
        // A greyed row already explains itself in its hint; the current place would only crowd it (owner test 11-16).
        detail: movable ? (current ? current.label : r.detail) : undefined,
        disabled: movable ? undefined : (caps.displayFixed || priceRefusal || r.disabled),
        submenu,
      }
    }
    if (r.key === 'info-value' || r.key === 'alerts') {
      // `soon`: the UCT Signature menu shows a small "Soon" chip (the reason stays the tooltip).
      return { ...r, disabled: VOLUME_NOT_YET, hint: VOLUME_NOT_YET, soon: true, onClick: undefined }
    }
    return r
  })
}

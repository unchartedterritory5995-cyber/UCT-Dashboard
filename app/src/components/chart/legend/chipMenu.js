// app/src/components/chart/legend/chipMenu.js
//
// ─── THE ROWS BEHIND A LEGEND LABEL (Track B V1) ────────────────────────────
//
// PURE. No React, no chart, no registry import — the definition and the
// destination list are passed in, so this file names no indicator and cannot
// become an enumeration site.
//
// ⛔ EVERY HANDLER TAKES AN INSTANCE ID. A label is per instance; a handler
// taking a defId would hide, remove or open the settings of the WRONG RSI the
// moment a second one exists, and would do it silently.
//
// ⚰️⚰️ THIS FILE USED TO CARRY ITS OWN PLACEMENT RULES, AND THEY HAD GONE STALE.
// `MOVE_TARGETS` was a frozen list of three — Price pane / Its own pane / Volume
// pane — with a `moveTargetRefusal` that DERIVED its verdicts from
// `placement.resolvePlacement`. That was correct when a pane was a definition.
// Universal Data made a pane belong to the INSTANCE that hosts it, and
// `displayTarget.displayTargetOptions` became the one function that knows which
// hosts may be joined (`@<hostInstanceId>`), which target is the current one,
// and which stored target points at a pane that no longer exists. This file
// never learned any of it: the legend's Move submenu could not offer *"into the
// QQQ pane"* even though Chart Settings could and the engine supported it, and
// one of its three rows — Volume — was a permanent refusal.
//
// ⭐⭐ SO THE DESTINATIONS ARE NOW AN INPUT, NOT A RULE. The caller hands in
// exactly what `displayTargetOptions(instance, cs, defOf)` returned and this
// file shapes it into rows. There is ONE placement truth, it lives in
// `engine/displayTarget.js`, and both the on-chart popover and Chart Settings →
// Indicators read it through the same call. A refusal this file invents on its
// own is a second rule waiting to drift, which is the defect that produced this
// rewrite.

/** The empty destination list, as a stable identity so a caller can pass it
 *  every render without allocating. */
const NO_OPTIONS = Object.freeze([])

/**
 * The **Display in** page: one row per destination `displayTargetOptions`
 * returned, in the order it returned them.
 *
 * ⛔ THE CURRENT TARGET IS TICKED, NEVER OFFERED. "Move it where it is" is the
 * definition of a control that does nothing — and `setInstanceDisplayTarget`
 * refuses it by identity anyway, so a live row here would be a click that
 * silently changes nothing.
 *
 * ⛔⛔ AND AN ORPHAN IS SHOWN, DISABLED, NEVER HEALED. `displayTargetOptions`
 * flags a stored target whose host has been deleted as `missing`; it is the
 * member's real state and this renders it as such. A menu that quietly omitted
 * it would tell a member their line is fine while it draws nothing — the exact
 * way the original defect hid. Same ruling as `ChartSettingsIndicators`'
 * Display-in select, reached through the same helper.
 *
 * @param {{value:string,label:string,group:string,missing?:boolean}[]} options
 *        the `displayTargetOptions(...)` result, verbatim
 * @param {string|null} current `resolveDisplayTarget(...)` for this instance
 * @param {Function} onMove `(instanceId, target) => void`
 * @param {string} instanceId
 */
export function displaySubmenu(options, current, onMove, instanceId) {
  const list = Array.isArray(options) ? options : NO_OPTIONS
  return list.map((o) => {
    const isCurrent = o.value === current
    const disabled = o.missing
      ? 'the pane this series was sent to no longer exists'
      : (isCurrent ? 'it is already here' : undefined)
    return {
      key: `display-${o.value}`,
      label: o.label,
      target: o.value,
      checked: isCurrent,
      disabled,
      // ⛔ NO `onClick` ON A REFUSED ROW. A handler that exists is a handler a
      // keyboard, a test or a future renderer can still fire.
      onClick: disabled ? undefined : () => onMove(instanceId, o.value),
    }
  })
}

/**
 * Track B V1's rows, in the declared order, from ONE source.
 *
 *   Hide/Show · Display in ▸ · ——— · Edit in Chart Data · Duplicate · Alert ·
 *   About · ——— · Delete
 *
 * ⭐ THE ORDER IS THE HIERARCHY THE OWNER APPROVED: visibility and placement are
 * the high-frequency verbs and sit at the top; the full editor and the additive
 * verbs sit in the middle; the one destructive verb is alone below a rule.
 *
 * ⛔ DELETE ARMS RATHER THAN FIRING. `caps.armed` is VIEW state the renderer
 * owns (a first click sets it, a second click fires), and it is passed in rather
 * than tracked here so this module stays pure and the wording of the armed row
 * stays testable. The row is the same row either way — there is no second
 * control and no modal.
 *
 * @param {object} chip a `readout.legendChips` row (label, hidden, instanceId…)
 * @param {object} def  its definition, or null
 * @param {object} h    `{onSettings, onToggleHidden, onMove, onDuplicate, onAlerts, onAbout, onRemove}`
 * @param {object} [caps] what the CALLER knows and this file cannot:
 *   `{alertsRefusal, displayOptions, displayCurrent, armed, canDuplicate}`
 * @returns {Array} rows for `mobile/ContextPopover`
 */
export function chipMenuItems(chip, def, h, caps = {}) {
  const submenu = displaySubmenu(
    caps.displayOptions, caps.displayCurrent, h.onMove, chip.instanceId,
  )
  // Every destination refused ⇒ the ROW is dead, and it says so once instead of
  // N times. `displayTargetOptions` answers EMPTY for a definition with exactly
  // one place to draw, which is the same test Chart Settings uses to render no
  // control at all.
  const movable = submenu.some((s) => !s.disabled)
  const name = (def && def.meta && def.meta.name) || chip.defId
  const rows = [
    {
      // ⛔ THE ROW STATES WHICH WAY IT GOES. A toggle labelled "Hide" on a label
      // that is ALREADY hidden is a lie, and `data-hidden` is the only other
      // thing on screen that says which state it is in.
      key: 'hidden',
      label: `${chip.hidden ? 'Show' : 'Hide'} ${chip.label}`,
      icon: 'eye',
      onClick: () => h.onToggleHidden(chip.instanceId),
    },
    {
      key: 'move',
      label: 'Display in',
      icon: 'expand',
      disabled: movable ? undefined : (submenu.length
        ? 'this series is already in the only pane it can draw in'
        : 'this indicator draws on the candles’ scale and has nowhere else it can be placed'),
      submenu,
    },
    { separator: true },
    {
      // ⭐ THE FULL EDITOR. One channel — see `StockChart.handleChipSettings`.
      key: 'settings',
      label: 'Edit in Chart Data…',
      icon: 'sliders',
      onClick: () => h.onSettings(chip.instanceId),
    },
  ]
  if (caps.canDuplicate !== false) {
    rows.push({
      key: 'duplicate',
      label: `Duplicate ${name}`,
      icon: 'copy',
      onClick: () => h.onDuplicate(chip.instanceId),
    })
  }
  rows.push(
    {
      key: 'alerts',
      label: `Add alert on ${chip.label}…`,
      icon: 'bell',
      disabled: caps.alertsRefusal || undefined,
      onClick: caps.alertsRefusal ? undefined : () => h.onAlerts(chip.instanceId),
    },
    {
      key: 'about',
      label: `About ${name}`,
      icon: 'info',
      onClick: () => h.onAbout(chip.instanceId),
    },
    { separator: true },
    {
      key: 'remove',
      // ⛔ THE ARMED ROW NAMES WHAT IT WILL DELETE. "Delete?" on a chart carrying
      // eleven series is a question about nothing.
      label: caps.armed ? `Delete ${chip.label}?` : 'Delete',
      icon: 'trash',
      danger: true,
      armed: !!caps.armed,
      // ⛔ THE FIRST CLICK MUST NOT CLOSE THE MENU. `keepOpen` is what lets the
      // row re-render as the confirmation; without it the arm would be invisible.
      keepOpen: !caps.armed,
      onClick: () => h.onRemove(chip.instanceId),
    },
  )
  return rows
}

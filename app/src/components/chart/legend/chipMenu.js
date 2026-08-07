// app/src/components/chart/legend/chipMenu.js
//
// ─── THE SIX ROWS BEHIND A LEGEND CHIP (spec §6) ────────────────────────────
//
// PURE. No React, no chart, no registry import — the definition is passed in, so
// this file names no indicator and cannot become an enumeration site in the
// phase that exists to end them.
//
// ⛔ EVERY HANDLER TAKES AN INSTANCE ID. A chip is per instance; a handler taking
// a defId would hide, remove or open the settings of the WRONG RSI the moment a
// second one exists, and would do it silently.
//
// ⛔ AND EVERY ROW EITHER WRITES OR SAYS WHY IT CANNOT. A menu row that a user can
// click and that changes nothing is the defect class this phase retires — the
// `+N` button that shipped un-clickable, the `legendParams` that was declared and
// inert, the `styleOverrides` with zero consumers. So the Move submenu carries a
// DISABLED REASON per target rather than a bare boolean, and the reasons below
// are DERIVED from what `engine/placement.resolvePlacement` actually does — with
// `chipMenu.test.js` driving the real resolver over the real registry to prove
// this file's answer and the renderer's are the same answer.

/** The three values `instances.PLACEMENT_TARGETS` accepts. Kept as labels here
 *  and as the raw values in `target`, so the menu can never offer a placement
 *  `normalizeInstances` would reject outright. */
const MOVE_TARGETS = Object.freeze([
  { target: 'price', label: 'Price pane' },
  { target: 'pane', label: 'Its own pane' },
  { target: 'volume', label: 'Volume pane' },
])

/** The target an instance is on right now: its own override, else what its
 *  definition declares, else the schema default. */
export function currentTargetOf(chip, def) {
  const stored = chip && typeof chip.placementTarget === 'string' && chip.placementTarget
  const declared = def && def.placement && typeof def.placement.target === 'string'
    && def.placement.target
  return stored || declared || 'pane'
}

/**
 * Why moving this instance to `target` is refused, or `undefined` if it is a
 * real destination. The string is rendered, so it is a sentence and not a code.
 *
 * ⛔ ALL THREE REASONS WERE MEASURED AGAINST `resolvePlacement`, NOT REASONED
 * ABOUT. `chipMenu.test.js` runs the real resolver over every definition × every
 * target, with a real `computePaneLayout`, and asserts this function's verdict
 * matches — so if the renderer's rules move, this file goes red rather than
 * quietly offering a move that unbinds an indicator.
 *
 *   1. ALREADY THERE. The current target is `checked`, never offered as a
 *      destination — "move it where it is" is the definition of a control that
 *      does nothing.
 *
 *   2. THE VOLUME PANE IS NOT AN INSTANCE PLACEMENT AT ALL. `resolvePlacement`
 *      decides the volume overlay from `ctx.volOverlaySet` — i.e. from
 *      `cs.volumeOverlayIndicators`, the chart-wide toggle in the right-click
 *      **Overlay on volume ▸** submenu — and NEVER from the instance's stored
 *      target (`placement.js:327-332` says so in as many words: *"whether it is
 *      overlaid THIS pass is decided below from the LIVE list, because that
 *      toolbar control is what users actually toggle"*). Measured: for a
 *      pane definition, `resolvePlacement` with `target:'volume'` returns an
 *      object DEEP-EQUAL to the one it returns for `target:'pane'`. Writing
 *      'volume' here would therefore be a persisted no-op — the worst kind,
 *      because the menu would then draw a tick beside it.
 *
 *   3. A PRICE OVERLAY HAS NO PANE TO MOVE INTO. `paneLayout.paneTargetIds()`
 *      derives which definitions own a pane from the DEFINITION's declared
 *      target, so `computePaneLayout` never allocates one to `bb`/`vwap`/`sar`/
 *      `ichimoku`/`donchian`/`avwap`/`atrBands` — and `resolvePlacement` returns
 *      **null** for an instance the layout gave no pane (`placement.js:400`),
 *      which `binder.sync` reads as *bind nothing*. The indicator would silently
 *      vanish off the chart with its box still ticked.
 */
export function moveTargetRefusal(def, target, current) {
  if (target === current) return 'it is already here'
  if (target === 'volume') {
    return 'the volume overlay is a chart-wide toggle (right-click → Overlay on volume), '
      + 'not an instance placement'
  }
  const declared = (def && def.placement && def.placement.target) || 'pane'
  if (target === 'pane' && declared !== 'pane') {
    return 'a price overlay draws on the candles’ own scale and is given no pane of its own'
  }
  return undefined
}

/**
 * The Move submenu: three rows, each either a destination or a refusal.
 *
 * @param {object} chip a `readout.legendChips` row, optionally carrying
 *                      `placementTarget` (the STORED override the chart resolved)
 * @param {object} def  the definition behind it
 * @param {Function} onMove `(instanceId, target) => void`
 */
export function moveSubmenu(chip, def, onMove) {
  const current = currentTargetOf(chip, def)
  return MOVE_TARGETS.map((t) => {
    const disabled = moveTargetRefusal(def, t.target, current)
    return {
      ...t,
      key: `move-${t.target}`,
      checked: t.target === current,
      disabled,
      // ⛔ NO `onClick` ON A REFUSED ROW. `ContextPopover` renders `disabled` on
      // the button, but a handler that exists is a handler a keyboard, a test or
      // a future renderer can still fire — and this one would persist a
      // placement the binder resolves to nothing.
      onClick: disabled ? undefined : () => onMove(chip.instanceId, t.target),
    }
  })
}

/**
 * Spec §6's six rows, in the declared order, from ONE source.
 *
 * Settings · Hide/Show · Move · Alerts · About · ——— · Remove
 *
 * @param {object} chip a `readout.legendChips` row (+ optional `placementTarget`)
 * @param {object} def  its definition, or null
 * @param {object} h    `{onSettings, onToggleHidden, onMove, onAlerts, onAbout, onRemove}`
 * @param {object} [caps] surface capabilities the CALLER knows and this file
 *   cannot: `{alertsRefusal}` — a sentence when the mount cannot open the alert
 *   popover at all (no symbol, no toolbar). Same rule as everything else here: a
 *   row that opens nothing is disabled and says why, never rendered live.
 * @returns {Array} rows for `mobile/ContextPopover`
 */
export function chipMenuItems(chip, def, h, caps = {}) {
  const submenu = moveSubmenu(chip, def, h.onMove)
  // Every destination refused ⇒ the ROW is dead, and it says so once instead of
  // three times. A price overlay has nowhere to go: it cannot leave the candles'
  // scale (3) and the volume pane is not an instance placement (2).
  const movable = submenu.some((s) => !s.disabled)
  const name = (def && def.meta && def.meta.name) || chip.defId
  return [
    {
      key: 'settings',
      label: 'Settings…',
      icon: 'gear',
      onClick: () => h.onSettings(chip.instanceId),
    },
    {
      // ⛔ THE ROW STATES WHICH WAY IT GOES. A toggle labelled "Hide" on a chip
      // that is ALREADY hidden is a lie, and `data-hidden` is the only other
      // thing on screen that says which state it is in.
      key: 'hidden',
      label: `${chip.hidden ? 'Show' : 'Hide'} ${chip.label}`,
      icon: 'eye',
      onClick: () => h.onToggleHidden(chip.instanceId),
    },
    {
      key: 'move',
      label: 'Move to',
      icon: 'expand',
      disabled: movable ? undefined : 'this indicator draws on the candles’ scale and has '
        + 'nowhere else it can be placed',
      submenu,
    },
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
      label: 'Remove',
      icon: 'trash',
      danger: true,
      onClick: () => h.onRemove(chip.instanceId),
    },
  ]
}

export { MOVE_TARGETS }

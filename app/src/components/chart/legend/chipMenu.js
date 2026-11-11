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

/** The member's word for "no preset matches". Not a preset id, never written. */
export const CUSTOM_PRESET_LABEL = 'Custom'

/** The current preset's label, or `Custom` when `currentId` names none of them. */
export function presetLabelOf(presets, currentId) {
  const list = Array.isArray(presets) ? presets : NO_OPTIONS
  const hit = typeof currentId === 'string' ? list.find((p) => p && p.id === currentId) : null
  return hit && typeof hit.label === 'string' ? hit.label : CUSTOM_PRESET_LABEL
}

/**
 * ⭐ PHASE 2a (A6) — the **Preset** page: one row per declared preset, in
 * declaration order, then `Custom`.
 *
 * ⛔ THE CURRENT PRESET IS CHECKED AND STILL PRESSABLE. Choosing it re-applies
 * its values, which is how a member who tweaked one input gets the preset back
 * (the dialog's "Reset to preset", one tap away). `applyPresetInputs` refuses a
 * write that changes nothing by identity, so a press on an untouched preset
 * persists nothing.
 *
 * ⛔ CUSTOM IS A STATE, NEVER A CHOICE: it has no `onClick`, it is checked when
 * nothing matches, and choosing it would mean nothing (the dialog's
 * `CUSTOM_PRESET` option is a no-op for the same reason).
 *
 * @param {{id:string,label:string,origin?:string}[]} presets `presetsOf(def)`
 * @param {string|null} currentId the `detectPreset` match's id, or null
 * @param {Function} onPreset `(instanceId, presetId) => void`
 * @param {string} instanceId
 */
export function presetSubmenu(presets, currentId, onPreset, instanceId) {
  const list = (Array.isArray(presets) ? presets : NO_OPTIONS)
    .filter((p) => p && typeof p.id === 'string' && typeof p.label === 'string')
  const matched = list.some((p) => p.id === currentId)
  const rows = list.map((p) => ({
    key: `preset-${p.id}`,
    presetId: p.id,
    label: p.label,
    origin: typeof p.origin === 'string' ? p.origin : '',
    checked: p.id === currentId,
    onClick: () => onPreset(instanceId, p.id),
  }))
  rows.push({
    key: 'preset-custom',
    presetId: null,
    label: CUSTOM_PRESET_LABEL,
    origin: '',
    checked: !matched,
    custom: true,
  })
  return rows
}

/**
 * Track B V1's rows, in the declared order, from ONE source.
 *
 *   Hide/Show · Display in ▸ · ——— · Edit in Indicators · Duplicate · Alert ·
 *   About · ——— · Delete
 *
 * ⭐ THE ORDER IS THE HIERARCHY THE OWNER APPROVED: visibility and placement are
 * the high-frequency verbs and sit at the top; the full editor and the additive
 * verbs sit in the middle; the one destructive verb is alone below a rule.
 *
 * ⚰️ DELETE USED TO ARM — a first click re-labelled the row `Delete <x>?` and a
 * second fired it. The owner removed the second click (2026-09-14): this row is
 * already red, already destructive-styled, already alone below a rule and already
 * the last thing in the menu, and that is the protection a plot-management action
 * warrants. The hazard the arming replaced was an 11px ✕ five pixels from the
 * gear on a strip that reflowed under the pointer; neither of those facts is true
 * of a menu row you travelled to deliberately.
 *
 * ⛔ AND THERE IS STILL NO SECOND WRITER, NO MODAL AND NO CONFIRM DIALOG. One
 * click → `removeInstance`, the popover closes, persistence takes it from there.
 *
 * @param {object} chip a `readout.legendChips` row (label, hidden, instanceId…)
 * @param {object} def  its definition, or null
 * @param {object} h    `{onSettings, onToggleHidden, onMove, onDuplicate, onAlerts, onAbout, onRemove}`
 *   ⭐ PHASE 4 — and, for a DEFINITION the member can edit or copy:
 *   `{onModify, onEditFormula, onCustomCopy}` (each takes the instance id; the caller
 *   resolves the definition from it)
 * @param {object} [caps] what the CALLER knows and this file cannot:
 *   `{alertsRefusal, displayOptions, displayCurrent, canDuplicate}`
 *   ⭐ PHASE 4 — `{definitionKind: 'user'|'builtin'|'other', canModify, copyRefusal}`
 *   ⭐ RS split U3 — `paneSizeStored: true` when the instance's host pane carries a
 *   stored member size; with `h.onResetPaneSize` it offers "Reset pane height"
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
  // ⛔⛔ AND THE SAME RULE AS `legendMenuSubtitle`: a definition whose identity IS
  // its source (`meta.labelFrom: 'source'` — `dataSeries`) must not lend its
  // internal noun to a member-facing row. Measured on production 2026-09-16: the
  // QQQ row offered **"About Data Series"**. It says `About QQQ` now, which is
  // what the member asked for and what the header above it reads.
  //
  // ⚠️ EVERY OTHER DEFINITION KEEPS ITS CATALOGUE NAME, which is the point of this
  // row — `About Moving Average` and `About Relative Strength Index` explain the
  // INDICATOR, and MACD's `SIG` chip must not read `About SIG`.
  const namesItsSource = !!(def && def.meta && def.meta.labelFrom === 'source')
  const name = (namesItsSource && chip.label)
    || (def && def.meta && def.meta.name) || chip.defId
  const rows = [
    {
      // ⛔ THE ROW STATES WHICH WAY IT GOES. A toggle labelled "Hide" on a label
      // that is ALREADY hidden is a lie, and `data-hidden` is the only other
      // thing on screen that says which state it is in.
      //
      // ⚰️ IT USED TO NAME THE CHIP TOO — `Hide RSI(14)`. The popover's HEADER
      // names it now, directly above, so the row repeated it three pixels away and
      // set the menu's width from its longest label (owner, 2026-09-14: bare
      // verbs). `Duplicate Relative Strength Index` was the worst of them.
      key: 'hidden',
      label: chip.hidden ? 'Show' : 'Hide',
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
  ]
  // ⭐ RS split U3 — RESET PANE HEIGHT, right under Display in (the other
  // placement verb). Offered ONLY when the caller says this instance's host pane
  // carries a stored member size (`caps.paneSizeStored`) and wires the handler:
  // a pane on its computed default has nothing to reset, and a row that does
  // nothing is the control this file refuses to offer. The caller resolves the
  // host pane key and calls `paneSizes.clearPaneSize` — "return to automatic";
  // this file reads no settings and names no pane.
  if (caps.paneSizeStored === true && typeof h.onResetPaneSize === 'function') {
    rows.push({
      key: 'pane-size-reset',
      label: 'Reset pane height',
      icon: 'refresh',
      onClick: () => h.onResetPaneSize(chip.instanceId),
    })
  }
  // ⭐ PHASE 2a (A6) — PRESET ▸, right after Display in, for a definition that
  // declares `meta.presets`. Offered only when the caller wires `h.onPreset` and
  // hands the presets in (`caps.presets`, the `presetsOf(def)` list) — this file
  // stays pure and reads no definition field itself. The row's trailing label is
  // the CURRENT preset (`caps.presetCurrent`, what `detectPreset` answered), or
  // `Custom` when none matches.
  const presets = Array.isArray(caps.presets) ? caps.presets : NO_OPTIONS
  if (presets.length && typeof h.onPreset === 'function') {
    rows.push({
      key: 'preset',
      label: 'Preset',
      icon: 'library',
      trailing: presetLabelOf(presets, caps.presetCurrent),
      submenu: presetSubmenu(presets, caps.presetCurrent, h.onPreset, chip.instanceId),
    })
  }
  rows.push(
    { separator: true },
    {
      // ⭐ THE FULL EDITOR. One channel — see `StockChart.handleChipSettings`.
      key: 'settings',
      label: 'Edit in Indicators…',
      icon: 'sliders',
      onClick: () => h.onSettings(chip.instanceId),
    },
  )
  // ⭐ P1 — VALUE: "show this output's latest value in the header". It writes a
  // REFERENCE `{instanceId, plotKey}` (`engine/infoValues.js`) and nothing else:
  // the output keeps its type and its compute. Offered only when the caller wires
  // it; a refusal (an output that cannot be referenced) is shown, never hidden.
  if (typeof h.onInfoValue === 'function') {
    const on = caps.infoValueOn === true
    rows.push({
      key: 'info-value',
      label: on ? 'Remove value from header' : 'Show latest value in header',
      icon: 'info',
      disabled: on ? undefined : (caps.infoValueRefusal || undefined),
      onClick: (!on && caps.infoValueRefusal) ? undefined : () => h.onInfoValue(chip.instanceId, chip.plotKey, on),
    })
  }
  // ⭐⭐ PHASE 4 — THE DEFINITION'S OWN VERBS. "Edit in Indicators…" above edits THIS
  // instance (its inputs and look); these edit or copy the INDICATOR ITSELF.
  //   Modify with UCT Intelligence — the conversational studio, opened on it
  //   Edit formula                 — the manual formula editor, opened on it
  // Both are offered only for the member's OWN formula definitions; the first only
  // with Create Indicator access (the caller asks the same gate the studio uses).
  const userDef = caps.definitionKind === 'user'
  if (userDef && caps.canModify && typeof h.onModify === 'function') {
    rows.push({ key: 'modify', label: 'Modify with UCT Intelligence', icon: 'sparkle',
      onClick: () => h.onModify(chip.instanceId) })
  }
  if (userDef && typeof h.onEditFormula === 'function') {
    rows.push({ key: 'edit-formula', label: 'Edit formula', icon: 'edit',
      onClick: () => h.onEditFormula(chip.instanceId) })
  }
  // ⭐⭐ SAVED-SCRIPT AUTO-UPGRADE — ONE quiet row, only for the member's own Pine
  // script saved before its source was kept (`savedScriptUpgrade.needsScriptForUpgrade`):
  // engine fixes cannot reach it until it is saved once from its script. A menu row,
  // never a toast or a modal — it is there when the member opens this menu, and
  // nowhere else. The CALLER decides (`caps.scriptUpgrade`); this file places it.
  if (userDef && caps.scriptUpgrade === true && typeof h.onScriptUpgrade === 'function') {
    rows.push({ key: 'script-upgrade', label: caps.scriptUpgradeLabel || 'Updated accuracy available',
      icon: 'info', onClick: () => h.onScriptUpgrade(chip.instanceId) })
  }
  if (caps.canDuplicate !== false) {
    rows.push({
      key: 'duplicate',
      // ⭐ PHASE 4 — SAYS WHAT IT IS: another instance of the SAME indicator on this
      // chart (editing its formula edits both). "Create custom copy" below is the
      // independent one.
      label: 'Duplicate on chart',
      icon: 'copy',
      onClick: () => h.onDuplicate(chip.instanceId),
    })
  }
  if ((caps.definitionKind === 'user' || caps.definitionKind === 'builtin') && typeof h.onCustomCopy === 'function') {
    rows.push({
      key: 'custom-copy',
      // A NEW, independent definition the member owns — the built-in (or the source
      // formula) is never changed. A built-in that cannot be reproduced exactly
      // shows the row DISABLED with its reason: never hidden, never approximated.
      label: 'Create custom copy',
      icon: 'copy',
      disabled: caps.copyRefusal || undefined,
      onClick: caps.copyRefusal ? undefined : () => h.onCustomCopy(chip.instanceId),
    })
  }
  // ⭐ SUPPORT LOOP A3 (`docs/pine/support-loop/PHASE-A.md`) — "Doesn't match
  // TradingView?" for an imported Pine script that translated fully and still looks
  // different. The CALLER decides (`caps.reportMismatch`: the document is a Pine
  // translation AND the server's report flag is on); this file only places the row.
  if (caps.reportMismatch === true && typeof h.onReportMismatch === 'function') {
    rows.push({
      key: 'report-mismatch',
      label: 'Doesn’t match TradingView?',
      icon: 'flag',
      onClick: () => h.onReportMismatch(chip.instanceId),
    })
  }
  rows.push(
    {
      key: 'alerts',
      label: 'Add alert…',
      icon: 'bell',
      disabled: caps.alertsRefusal || undefined,
      onClick: caps.alertsRefusal ? undefined : () => h.onAlerts(chip.instanceId),
    },
    {
      key: 'about',
      label: `About ${name}`,   // ⛔ the DEFINITION's name, not the chip's — this row
      // is about the indicator, and "About" alone says nothing at all
      icon: 'info',
      onClick: () => h.onAbout(chip.instanceId),
    },
    { separator: true },
    {
      key: 'remove',
      label: 'Delete',
      icon: 'trash',
      danger: true,
      // ⛔ NO `keepOpen`. The click removes the instance and the popover closes
      // with the thing it was about.
      onClick: () => h.onRemove(chip.instanceId),
    },
  )
  return rows
}

/** B9 (2026-11-07) — the chip rows a right-click inside an indicator PANE leads
 *  with, in this order. */
export const PANE_MENU_KEYS = Object.freeze(['settings', 'preset', 'hidden', 'alerts', 'about'])

/**
 * The rows a right-click inside an indicator's own pane leads with:
 *
 *   <name> settings… · Preset ▸ (when declared) · Hide · Add alert… · About <name>
 *
 * ⭐ THESE ARE `chipMenuItems`' OWN ROWS, PICKED, NOT A SECOND LIST. The handlers,
 * the refusals, the Preset page and the About noun are the chip's, so the pane
 * and the legend label cannot drift apart. The one relabel is the editor row:
 * the chip menu's header names the indicator above "Edit in Indicators…", and a
 * plain chart menu has no header, so the row carries the name itself.
 *
 * Placement verbs (Display in, Duplicate, Delete) stay on the chip: a pane
 * menu's job is the reading in front of the pointer, and Delete one row away
 * from "Reset view" is a misclick waiting to happen.
 *
 * @param {object} chip   `{instanceId, defId, label, hidden}` for the pane's owner
 * @param {object} def    its definition, or null
 * @param {object} h      `{onSettings, onPreset, onToggleHidden, onAlerts, onAbout}`
 * @param {object} [caps] `chipMenuItems` caps, plus `paneName` (the editor row's noun)
 * @returns {Array} rows in `PANE_MENU_KEYS` order (a row the chip menu does not
 *          offer, such as Preset without presets, is simply absent)
 */
export function paneMenuItems(chip, def, h, caps = {}) {
  const rows = chipMenuItems(chip, def, h, caps)
  const byKey = new Map(rows.filter((r) => r && r.key).map((r) => [r.key, r]))
  const noun = caps.paneName || chip.label || (def && def.meta && def.meta.name) || chip.defId
  return PANE_MENU_KEYS
    .map((k) => byKey.get(k))
    .filter(Boolean)
    .map((r) => (r.key === 'settings' ? { ...r, label: `${noun} settings…` } : r))
}

/**
 * ONE MOVING AVERAGE — the read-time adoption of `cs.overlays` into engine
 * `movingAverage` instances.
 *
 * ⭐⭐ WHY THIS EXISTS. A member's default averages (EMA 9, EMA 20, SMA 50,
 * SMA 200) lived in `cs.overlays`: a POSITIONAL array with its own renderer, its
 * own writers and a hard-wired close. Every average added through + Add
 * Indicator is a `movingAverage` INSTANCE. The two had different settings, one
 * could read RSI and the other could not, and only one could ever learn a
 * calculation timeframe or a visibility rule. After this fold there is one
 * authority: a default average is simply a pre-created instance.
 *
 * ⛔⛔ NOTHING IS DESTROYED, AND THAT IS THE ROLLBACK STORY.
 *   · The slot STAYS, at its index, with every value it had. It gains
 *     `removed: true` (so every legacy reader — including an older client —
 *     stops drawing it) and `adopted: '<instanceId>'` (so this fold never runs
 *     on it twice and a revival door can tell it from a member's delete).
 *   · The instance it becomes is one an OLDER client already understands: the
 *     four inputs `movingAverage` has always declared (source/period/maType/
 *     color). Appearance rides `presentation`, which an older client preserves
 *     and ignores — never `inputs`, where an undeclared key gets the whole
 *     instance DROPPED by `validateInstance`.
 *   So reverting this code leaves every member with the same averages drawn by
 *   the engine instead of the overlay block, rather than with none or with two.
 *
 * ⛔ IDEMPOTENT BY THE SLOT MARKER, NOT BY THE INSTANCE LIST. `mergeChartSettings`
 * pads `overlays` POSITIONALLY with the defaults, so "no instance called ovl:0"
 * can never be the signal — the defaults would re-fold forever. The marker lives
 * on the slot the padding would otherwise refill.
 *
 * ⭐ A LIVE SLOT WRITTEN AFTER ADOPTION IS AUTHORITATIVE. Presets, the Settings
 * page and templates saved by an older build write `overlays` wholesale; a live,
 * unmarked slot is therefore somebody's newer intent for that average and it
 * updates the adopted instance rather than being ignored. Fields the slot cannot
 * express (calculation timeframe, visibility, display) are kept.
 *
 * ⛔ PURE, AND IT IMPORTS NOTHING FROM THE ENGINE. `instanceShape.js` was split out
 * of `chartDefaults.js` to break an import cycle; this module is called from both
 * of them and must not re-create it.
 */

import { MA_TYPES } from './movingAverages.js'

export const MA_DEF_ID = 'movingAverage'

/** The legacy editors' spelling of an instance's `maType` (`hma` → `HMA`).
 *  ⭐ 2026-10-01: an adopted average can carry any of the nine kit types, and the
 *  toolbar/Settings/phone editors must SHOW the type it really is — reporting an
 *  HMA as `SMA` would invite a member to "change" it to what it already says. */
export function maTypeLabel(maType) {
  const hit = MA_TYPES.find(([id]) => id === maType)
  return hit ? hit[1] : 'SMA'
}

/** A legacy editor's `type` value → the instance's `maType` id. */
export function maTypeId(value) {
  const v = String(value || '').toLowerCase()
  return MA_TYPES.some(([id]) => id === v) ? v : 'sma'
}

/** The instance id a slot is adopted as. Stable per SLOT, so a slot is always the
 *  same average across reads, templates and grid cells. */
export function adoptedInstanceId(index) {
  return `ovl:${index}`
}

/** The declared range of `movingAverage.period` — see `nativeRegistry`. Kept in
 *  step by `maAdoption.test.js`, which reads the definition. */
export const MA_PERIOD_MIN = 1
export const MA_PERIOD_MAX = 500

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)

function isTombstone(inst) {
  return isObj(inst) && inst.deleted === true
}

/** The four inputs `movingAverage` declares, read off a legacy slot. */
function inputsFromSlot(slot) {
  const raw = Math.floor(Number(slot.period))
  const valid = Number.isFinite(raw) && raw >= MA_PERIOD_MIN
  return {
    inputs: {
      source: 'close',
      period: valid ? Math.min(raw, MA_PERIOD_MAX) : MA_PERIOD_MIN,
      maType: String(slot.type || '').toUpperCase() === 'EMA' ? 'ema' : 'sma',
      ...(typeof slot.color === 'string' && slot.color ? { color: slot.color } : {}),
    },
    // An invalid length drew NO line on the legacy renderer (`computeSMA` returns
    // []), so the honest adoption is a hidden instance, never a line at some
    // period the member did not choose.
    periodValid: valid,
  }
}

/** The appearance a slot carried, as `presentation` keys — defaults omitted, so a
 *  default average adopts with no presentation at all. */
function presentationFromSlot(slot) {
  const out = {}
  const w = Number(slot.lineWidth)
  if (Number.isFinite(w) && w > 0 && w !== 1) out.lineWidth = w
  if (slot.lineStyle === 'dashed' || slot.lineStyle === 'dotted') out.lineStyle = slot.lineStyle
  if (slot.onTop === true) out.overlap = true
  const off = Number(slot.offset)
  if (Number.isFinite(off) && off !== 0) out.offset = off
  // ⛔ `slot.plotStyle` IS NOT CARRIED. The overlay renderer never honoured it (the
  // settings field was disabled `NOT_WIRED`), so a stored `area` never drew as an
  // area. Carrying it would make the adoption the first time it took effect.
  return out
}

/** The fields a slot OWNS on its instance. Everything else on an adopted instance
 *  (timeframe, visibility, placement, a rename) is the instance's own. */
function slotOwnedFields(slot) {
  const { inputs, periodValid } = inputsFromSlot(slot)
  const presentation = presentationFromSlot(slot)
  return {
    inputs,
    hidden: slot.enabled === false || !periodValid,
    presentation,
  }
}

function withPresentation(inst, presentation) {
  // The slot owns the four appearance keys; every other presentation key (a plot
  // style chosen on the instance, dot size…) is the instance's own and survives.
  const kept = { ...(isObj(inst.presentation) ? inst.presentation : {}) }
  for (const k of ['lineWidth', 'lineStyle', 'overlap', 'offset']) delete kept[k]
  const merged = { ...kept, ...presentation }
  const out = { ...inst }
  if (Object.keys(merged).length) out.presentation = merged
  else delete out.presentation
  return out
}

/**
 * Fold every live, unadopted overlay slot into a `movingAverage` instance.
 *
 * @param {object} cs a settings blob (merged or partial). Not mutated.
 * @param {{explicitReset?: boolean}} [opts] `explicitReset` makes each NEWLY
 *   created instance carry the instance-owned optional keys as explicit
 *   `undefined`. `mergeSettingsOverride` merges instances by id as a PATCH, so a
 *   widget's freshly adopted `ovl:0` would otherwise inherit the GLOBAL `ovl:0`'s
 *   timeframe or visibility.
 * @returns {object} `cs` itself when there was nothing to adopt
 */
export function adoptOverlayAverages(cs, opts) {
  if (!isObj(cs) || !Array.isArray(cs.overlays) || !cs.overlays.length) return cs
  if (!cs.overlays.some((s) => isObj(s) && typeof s.adopted !== 'string')) return cs

  const list = Array.isArray(cs.indicatorInstances) ? [...cs.indicatorInstances] : []
  const indexOf = new Map()
  list.forEach((inst, i) => { if (isObj(inst) && typeof inst.instanceId === 'string') indexOf.set(inst.instanceId, i) })

  const created = []
  const overlays = cs.overlays.map((slot, i) => {
    if (!isObj(slot) || typeof slot.adopted === 'string') return slot
    // ⚠️ `adoptAs` is a RESTORED slot's previous identity (`reviveSlot`). A splice
    // elsewhere (`forceNewChartDefaults`) can move a slot off the index its id was
    // minted from, and re-deriving the id from the new index would land the restore
    // on a DIFFERENT live average.
    const id = typeof slot.adoptAs === 'string' && slot.adoptAs ? slot.adoptAs : adoptedInstanceId(i)
    const at = indexOf.get(id)
    const existing = at === undefined ? null : list[at]

    // ── A MEMBER-DELETED SLOT ── nothing to draw, but the id is RESERVED with a
    // tombstone: `mergeSettingsOverride` would otherwise let the global blob's
    // live `ovl:<i>` leak into a chart whose member deleted that average.
    if (slot.removed === true) {
      if (!existing) created.push({ instanceId: id, deleted: true })
      const { adoptAs: _a, ...rest } = slot
      return { ...rest, adopted: id }
    }

    const owned = slotOwnedFields(slot)
    if (existing && !isTombstone(existing)) {
      // ⭐ A live slot written AFTER adoption: newer intent for this average.
      list[at] = withPresentation({ ...existing, inputs: { ...owned.inputs }, hidden: owned.hidden },
        owned.presentation)
    } else {
      const fresh = withPresentation({
        instanceId: id,
        defId: MA_DEF_ID,
        inputs: owned.inputs,
        hidden: owned.hidden,
        // ⛔ `deleted: false` IS THE OVERRIDE MERGE'S RE-ADD SIGNAL. Without it a
        // GLOBAL tombstone for the same id collapses this widget's average on the
        // merge ("a tombstone collapses whatever it merged with"), and a member who
        // deleted EMA 9 on one chart would lose it on every widget.
        ...(opts && opts.explicitReset
          ? { deleted: false, placement: undefined, calculationTimeframe: undefined,
              visibility: undefined, display: undefined }
          : {}),
      }, owned.presentation)
      if (opts && opts.explicitReset && !('presentation' in fresh)) fresh.presentation = undefined
      if (existing) list[at] = fresh   // a tombstone the slot has since revived
      else created.push(fresh)
    }
    const { adoptAs: _a, ...rest } = slot
    return { ...rest, removed: true, adopted: id }
  })

  // ⭐ ADOPTED AVERAGES FIRST. The overlay rows always listed (and drew) before
  // every engine row; `withInstances` sorts by definition rank with a STABLE sort,
  // so leading the list keeps EMA 9 above an added SMA 150 from here on.
  const out = { ...cs, overlays, indicatorInstances: [...created, ...list] }
  // ⭐ A member's within-pane series order named the slot by its ROW id
  // (`overlay-<i>`, `indicatorRegistry.overlayRowId`); the same average's row id is
  // now its instance id. Renamed in place, so the order they chose survives.
  if (isObj(cs.paneSeriesOrder)) {
    const rename = new Map(overlays.map((s, i) => [`overlay-${i}`, isObj(s) ? s.adopted : null])
      .filter(([, id]) => typeof id === 'string'))
    let touched = false
    const pso = {}
    for (const [pane, ids] of Object.entries(cs.paneSeriesOrder)) {
      pso[pane] = Array.isArray(ids) ? ids.map((id) => {
        const to = rename.get(id)
        if (to) { touched = true; return to }
        return id
      }) : ids
    }
    if (touched) out.paneSeriesOrder = pso
  }
  return out
}

/** Is this slot one the fold has adopted (as opposed to one a member deleted)? */
export function isAdoptedSlot(slot) {
  return isObj(slot) && typeof slot.adopted === 'string'
}

/**
 * The positional MA view the LEGACY editors (Settings page, toolbar, phone sheet)
 * still speak: slot i → its current values, read from the adopted instance when
 * there is one. `null` for a slot with nothing on the chart.
 */
export function averageSlotView(cs) {
  const overlays = Array.isArray(cs?.overlays) ? cs.overlays : []
  const list = Array.isArray(cs?.indicatorInstances) ? cs.indicatorInstances : []
  const byId = new Map(list.filter(isObj).map((i) => [i.instanceId, i]))
  return overlays.map((slot, index) => {
    if (!isObj(slot)) return null
    if (!isAdoptedSlot(slot)) return slot.removed === true ? null : { ...slot, index }
    const inst = byId.get(slot.adopted)
    if (!inst || isTombstone(inst)) return null
    const inputs = isObj(inst.inputs) ? inst.inputs : {}
    const pres = isObj(inst.presentation) ? inst.presentation : {}
    return {
      index,
      instanceId: inst.instanceId,
      enabled: inst.hidden !== true,
      type: maTypeLabel(inputs.maType || 'sma'),
      period: Number(inputs.period) || slot.period,
      color: inputs.color || slot.color,
      lineWidth: Number(pres.lineWidth) || 1,
      lineStyle: pres.lineStyle || 'solid',
      onTop: pres.overlap === true,
      offset: Number(pres.offset) || 0,
    }
  })
}

/**
 * Write ONE legacy-editor field for slot `index`, through the adopted instance
 * when the slot has been adopted (and straight onto the slot when it has not).
 *
 * @param {'enabled'|'type'|'period'|'color'|'lineWidth'|'lineStyle'|'onTop'} field
 * @returns {object} the next blob, or `cs` unchanged when the write cannot land
 */
export function writeAverageSlot(cs, index, field, value) {
  const overlays = Array.isArray(cs?.overlays) ? cs.overlays : []
  const slot = overlays[index]
  if (!isObj(slot)) return cs
  if (!isAdoptedSlot(slot)) {
    const next = overlays.map((o, i) => (i === index
      ? { ...o, [field]: field === 'period' ? (parseInt(value, 10) || o.period) : value }
      : o))
    return { ...cs, overlays: next }
  }
  const list = Array.isArray(cs.indicatorInstances) ? cs.indicatorInstances : []
  let hit = false
  const next = list.map((inst) => {
    if (!isObj(inst) || inst.instanceId !== slot.adopted || isTombstone(inst)) return inst
    hit = true
    const inputs = { ...(inst.inputs || {}) }
    const presentation = { ...(inst.presentation || {}) }
    let hidden = inst.hidden
    switch (field) {
      case 'enabled': hidden = value === false; break
      case 'type': inputs.maType = maTypeId(value); break
      case 'period': {
        const p = Math.floor(Number(value))
        if (!Number.isFinite(p) || p < MA_PERIOD_MIN) return inst
        inputs.period = Math.min(p, MA_PERIOD_MAX)
        break
      }
      case 'color': if (typeof value === 'string' && value) inputs.color = value; break
      case 'lineWidth': {
        const w = Number(value)
        if (w === 1) delete presentation.lineWidth
        else if (Number.isFinite(w) && w > 0) presentation.lineWidth = w
        break
      }
      case 'lineStyle':
        if (value === 'dashed' || value === 'dotted') presentation.lineStyle = value
        else delete presentation.lineStyle
        break
      case 'onTop':
        if (value === true) presentation.overlap = true
        else delete presentation.overlap
        break
      default: return inst
    }
    const out = { ...inst, inputs, hidden }
    if (Object.keys(presentation).length) out.presentation = presentation
    else delete out.presentation
    return out
  })
  return hit ? { ...cs, indicatorInstances: next } : cs
}

/**
 * The first slot whose average is GONE from the chart and can be restored, or -1.
 *
 * ⛔ `removed: true` NO LONGER MEANS THAT ON ITS OWN — every adopted slot carries it
 * (so an older client stops drawing the slot). A slot is restorable when the member
 * deleted it before adoption, or when its adopted instance has since been deleted.
 * An adopted slot whose instance is live is ON the chart and is not offered.
 */
export function revivableSlotIndex(cs) {
  const overlays = Array.isArray(cs?.overlays) ? cs.overlays : []
  const list = Array.isArray(cs?.indicatorInstances) ? cs.indicatorInstances : []
  const live = new Set(list.filter((i) => isObj(i) && !isTombstone(i)).map((i) => i.instanceId))
  return overlays.findIndex((s) => isObj(s) && s.removed === true
    && (!isAdoptedSlot(s) || !live.has(s.adopted)))
}

/**
 * Restore slot `index`: the slot becomes live and UNADOPTED again, and the next
 * read's fold (`adoptOverlayAverages`) turns it back into `ovl:<index>` with the
 * values the slot kept — replacing the tombstone ("a tombstone the slot has since
 * revived"). The member gets back the average they configured, not a fresh one.
 */
export function reviveSlot(cs, index) {
  const overlays = Array.isArray(cs?.overlays) ? cs.overlays : []
  if (!isObj(overlays[index])) return cs
  const next = overlays.map((o, i) => {
    if (i !== index) return o
    const { adopted, ...rest } = o
    return { ...rest, removed: false, enabled: true, ...(typeof adopted === 'string' ? { adoptAs: adopted } : {}) }
  })
  return adoptOverlayAverages({ ...cs, overlays: next })
}

/**
 * Remove every average matching `pred(view)` from a blob — the slot's legacy row
 * AND its adopted instance (tombstoned, so a global copy cannot leak back in).
 * `view` is `averageSlotView`'s reading, i.e. the average's CURRENT values.
 */
export function dropAverages(cs, pred) {
  if (!isObj(cs) || !Array.isArray(cs.overlays)) return cs
  const view = averageSlotView(cs)
  const ids = new Set()
  const overlays = []
  cs.overlays.forEach((slot, i) => {
    const v = view[i]
    if (v && pred(v)) {
      if (v.instanceId) { ids.add(v.instanceId); overlays.push(slot) }   // keep the adopted slot in place
      return                                                             // drop an unadopted one, as before
    }
    overlays.push(slot)
  })
  if (!ids.size && overlays.length === cs.overlays.length) return cs
  const list = Array.isArray(cs.indicatorInstances) ? cs.indicatorInstances : []
  return {
    ...cs,
    overlays,
    indicatorInstances: list.map((i) => (isObj(i) && ids.has(i.instanceId) ? { instanceId: i.instanceId, deleted: true } : i)),
  }
}

/** Recolour the average adopted from slot `index` (a chart THEME's MA palette). */
export function recolorAdoptedAverage(cs, index, color) {
  const slot = Array.isArray(cs?.overlays) ? cs.overlays[index] : null
  if (!isAdoptedSlot(slot)) return cs
  return writeAverageSlot(cs, index, 'color', color)
}

/** A user's volume-pane separator DRAG, as an authority the pane layout reads.
 *
 * ─── WHY THIS EXISTS (B5, the Flip C cutover) ──────────────────────────────
 *
 * Under `'bands'` there was exactly ONE writer of the price/volume stretch
 * factors — the block in `StockChart.updateChart` gated on
 * `lastAppliedVolPctRef.current !== pct`, whose entire purpose is the sentence
 * written above it: *"otherwise a periodic data-poll re-run would snap the pane
 * back and undo a user's drag."*
 *
 * Flip C added a SECOND writer that nothing gated. `binder.sync()` ends with
 * `applyPaneStretch(ctx.paneLayout)`, which reads the live factors and
 * overwrites every one that differs from `layout.above` — and `layout.above` is
 * derived from the SETTINGS percentage (`bandsAboveHeights`), deliberately and
 * necessarily so, because the layout writes pixel counts into those same factors
 * and reading them back would not survive its own output. `updateChart` runs
 * about once a second in extended hours. So: the user drags the divider, LWC
 * moves it (it emits no event), and the next sync puts it back. The divider is
 * advertised as draggable — `layout.panes.enableResize === true`, pinned by a
 * test — and it did not stay dragged.
 *
 * ⭐ THE FIX IS NOT A THIRD GATE, IT IS AN AUTHORITY. Suppressing the binder's
 * write would leave the layout believing a geometry the chart is not in, which
 * is precisely the disagreement `paneHeightMismatch` exists to shout about: the
 * drag would stick and every subsequent sync would report drift. Instead the
 * DRAG BECOMES THE SETTING the layout is computed from, so layout and renderer
 * agree by construction, `paneStretchPlan` stays a fixed point, and the same
 * number reaches `onVolumePaneResize` for the one surface that persists it.
 *
 * This is the shape `vertMarginsRef` already has for the price axis in the same
 * file — *"a user who has DRAGGED the price axis outranks the layout"*.
 *
 * ⚠️ AND THE LATCH MUST YIELD TO A REAL SETTINGS CHANGE, which is why it stores
 * `from`. A drag outranks the value it was measured against; it does not outrank
 * a NEW one. Without `from`, changing the volume-pane height in Settings (or a
 * persisted value arriving back as a prop) would be silently ignored for the
 * life of the chart — trading one stuck pane for another.
 *
 * ⛔ INTEGER PERCENT, ON PURPOSE. It is the same number `onVolumePaneResize`
 * persists, so a latched chart and a re-mounted chart that read the pref land in
 * the same place; a float here would make the pane jump by a few pixels the
 * first time the pref round-tripped. The cost is that a drag is quantised to 1%.
 */

/** Clamp used everywhere the volume pane's share is resolved. */
export const VOL_PCT_MIN = 8
export const VOL_PCT_MAX = 45

/** A percentage, or null — ⛔ NEVER `Number(x)` ALONE. `Number(null)`, `Number('')`
 *  and `Number(false)` are all 0, which this module's own tests caught latching a
 *  missing measurement as a deliberate 8% drag. That coercion has bitten this
 *  branch nine times now. Strings still coerce (a stored blob may carry '30'),
 *  which is the behaviour the `Math.min(45, Math.max(8, …))` this replaced had. */
function toPct(v) {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export function clampVolPct(pct) {
  const n = toPct(pct)
  if (n === null) return null
  return Math.min(VOL_PCT_MAX, Math.max(VOL_PCT_MIN, n))
}

/**
 * The volume pane's share the LAYOUT must be computed from.
 *
 * @param settingsPct the clamped settings/prop value (the standing authority)
 * @param latch       `{from, pct}` from `latchOnDrag`, or null
 */
export function resolveVolPanePct(settingsPct, latch) {
  const settings = clampVolPct(settingsPct)
  if (!latch || latch.from !== settings) return settings
  const dragged = clampVolPct(latch.pct)
  return dragged == null ? settings : dragged
}

/**
 * The latch a measured drag produces — or `null` when the measurement is not
 * evidence of one.
 *
 * `measuredPct` must already have passed the caller's "a pointer really went
 * down" gate; this only refuses measurements that cannot be a deliberate resize.
 *
 * ⛔ THE TWO REFERENCES ARE DIFFERENT AND BOTH ARE LOAD-BEARING. Movement is
 * judged against `appliedPct` — the height the pane is actually AT — because
 * that is what the user just dragged away from. But `from` records
 * `settingsPct`, the standing authority, because that is what the latch has to
 * out-rank and what it must yield to when it changes. Recording `appliedPct` as
 * `from` instead makes the SECOND drag of a session self-cancelling: `from`
 * would be the first drag's height, `resolveVolPanePct` would see it disagree
 * with the (unchanged) setting, drop the latch, and snap the pane back to the
 * setting mid-drag.
 *
 * @param settingsPct the settings/prop value in force (becomes `from`)
 * @param appliedPct  the share last applied to the renderer (the reference for
 *                    "did it move?")
 * @param measuredPct the pane's actual share now, as a percent
 */
export function latchOnDrag(settingsPct, appliedPct, measuredPct) {
  const settings = clampVolPct(settingsPct)
  const applied = toPct(appliedPct)
  const n = toPct(measuredPct)
  if (settings === null || applied === null || n === null) return null
  const pct = Math.round(n)
  // The same window the sampler has always used to decide a drag is real. A
  // measurement outside it is LWC's own minimum-height clamp on a short widget,
  // not a user — feeding that back is the "volume pane randomly triples in size"
  // ratchet the drag gate was added to stop.
  if (pct < 5 || pct > 60) return null
  if (Math.abs(pct - applied) < 2) return null
  return { from: settings, pct }
}

/** True when `latch` no longer describes the settings value in force. */
export function latchIsStale(latch, settingsPct) {
  return !!latch && latch.from !== clampVolPct(settingsPct)
}

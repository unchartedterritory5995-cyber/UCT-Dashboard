import { useEffect } from 'react'
import usePreferences from './usePreferences'
import { subscribeIndicatorAdds } from '../utils/chartBus'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { applyRowPatch } from '../components/chart/indicatorRegistry'
import * as engineRegistry from '../components/chart/engine/nativeRegistry'

/**
 * ⭐ THE VOICE BUS'S LISTENER. Mounted ONCE, in `voice/GlobalVoiceLayer.jsx`.
 *
 * ─── WHAT WAS BROKEN ────────────────────────────────────────────────────────
 *
 * `chartBus.addIndicator()` has emitted `uct:chart:add-indicator` since the
 * voice tool shipped and NOTHING has ever listened — `subscribeAll` had no call
 * site anywhere in `app/src`. Meanwhile the server already answers
 * `{"ok": true, "narration": "Adding atr."}` before the browser sees the action,
 * so Compass told the user it had added the indicator and the chart did not move.
 *
 * ─── WHY HERE AND NOT IN `StockChart` ───────────────────────────────────────
 *
 * ONE listener, for one event, doing one write.
 *
 * A subscriber per mounted chart would run SIXTEEN times on a 4×4 multi-chart
 * grid — sixteen writers racing on one preference for one spoken sentence. And
 * it would write a per-cell `settingsOverride` blob, when "add ATR to my chart"
 * plainly means the user's chart settings, which is the GLOBAL blob every chart
 * reads. `usePreferences`' SWR cache is module-global and keyed on the
 * preferences URL, so one write here re-renders every mounted `StockChart`
 * through the same path its own toolbar uses.
 *
 * It is mounted in the voice layer because that layer is exactly co-extensive
 * with the emitter: voice is paid-only, `GlobalVoiceLayer` is the paid-only
 * mount at the App root, and it renders once. Wherever a voice tool can fire
 * this event, this listener exists.
 *
 * ─── THE WRITE ──────────────────────────────────────────────────────────────
 *
 * ⛔ NO RAW `cs.indicators[id].enabled = true`. The routing rule — engine-owned
 * ids go through `instanceControls`, carved-out canvas sections write their
 * settings slice — is `indicatorRegistry.applyRowPatch`, already shipped and
 * already tested. It is IMPORTED, not re-implemented: a second copy of that rule
 * is the twin this phase is retiring, and getting it wrong for `volumeProfile`
 * (no definition ⇒ `setIndicatorEnabled` returns its input unchanged) is a
 * silent no-op that looks exactly like the bug being fixed.
 *
 * ⚠️ THE ROW IS BUILT FROM THE CATALOG, NOT LOOKED UP IN `listAllIndicators`.
 * That list is the SETTINGS TAB's list and is deliberately narrower — it skips a
 * definition with no declared inputs (`listEngineIndicators`: `if
 * (!declared.length) continue`), which is a perfectly good thing to say out loud
 * and would have silently done nothing. `applyRowPatch` reads exactly three
 * fields, and all three come off the catalog row.
 *
 * `setPrefMerged` (not `setPref`) because the updater runs INSIDE the SWR cache
 * update, so it composes with whatever a chart wrote a moment earlier instead of
 * blind-writing a snapshot over it. Returning `undefined` abandons the write, so
 * a refused write costs no request.
 */

/** The minimal `applyRowPatch` row for a catalog entry. `engineOwned` is the
 *  field that decides the lane — see `indicatorCatalog.CARVED_OUT_ROWS`, where it
 *  is called load-bearing for exactly this reason. */
function patchRowFor(row) {
  return row.engineOwned
    ? { engineOwned: true, defId: row.id }
    : { engineOwned: false, path: { kind: 'indicator', key: row.id } }
}

export default function useChartIndicatorBus() {
  const { setPrefMerged } = usePreferences()

  useEffect(() => subscribeIndicatorAdds((row) => {
    setPrefMerged('chart_settings', (current) => {
      const cs = mergeChartSettings(current)
      const next = applyRowPatch(patchRowFor(row), { enabled: true }, cs, engineRegistry)
      // `applyRowPatch` returns its input BY IDENTITY when the write is refused.
      // Persisting that would be a POST that changes nothing.
      return next === cs ? undefined : next
    })
  }), [setPrefMerged])
}

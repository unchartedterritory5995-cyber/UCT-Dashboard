/**
 * The chart bus's INDICATOR VOCABULARY — and the listener that honours it.
 *
 * ─── WHY THIS IS NOT IN `chartBus.js` ───────────────────────────────────────
 *
 * ⛔ MEASURED, TWICE, SAME TREE, ONE VARIABLE. `chartBus.js` is reachable from
 * the EAGER entry chunk (`useRealtimeSession` ← `CompassTodayTile` /
 * `CompassAssistButton` / …). When it statically imported `indicatorCatalog`, the
 * registry moved OUT of a lazily-loaded shared chunk and INTO the entry chunk:
 *
 *     index      +37.53 kB raw  / +12.98 kB gzip
 *     flipState  -37.34 kB raw  / -12.00 kB gzip
 *
 * i.e. ~13 kB gzip that every FREE user downloads on first paint for a chart and
 * a voice layer they cannot use. A `manualChunks` entry does NOT fix that — a
 * static import from an eager module must load before the entry runs, so
 * chunking it separately only changes which FILE it arrives in, not whether it
 * arrives. The import edge itself has to move.
 *
 * So it lives here, and this module is imported ONLY by `useChartIndicatorBus`,
 * which is imported only by `voice/GlobalVoiceLayer` — which is `lazy()` and
 * paid-gated. The chart registry rides the voice chunk, where it is already paid
 * for, and the entry bundle is unchanged.
 *
 * ─── THE SPLIT OF RESPONSIBILITY ────────────────────────────────────────────
 *
 * `chartBus.addIndicator` validates SHAPE — is this a well-formed indicator
 * token? This module validates VOCABULARY — is it something a chart can draw?
 *
 * That is not a compromise, it is the correct layering, and the bus already
 * works this way elsewhere: `openTicker` emits ANY non-empty symbol without
 * checking that it exists. The two vocabularies that DO live at the emitter
 * (9 timeframes, 5 chart types) are small CLOSED sets with nothing to derive
 * them from. The indicator vocabulary is the only one derived from the chart
 * module graph, and that is exactly why it cannot be free at the emitter.
 *
 * The emitter's return value has no user-visible effect either way: its only
 * caller discards it (`useRealtimeSession.js:319`), and the server has already
 * narrated "Adding <x>." before the browser sees the action.
 */

import { catalogRows } from '../components/chart/indicatorCatalog'
import { subscribeAll } from './chartBus'

/** Overlay slots and the anchored-VWAP DRAWING TOOL. Neither is a definition,
 *  and neither is an oversight — an MA overlay's identity is POSITIONAL (slot 0
 *  IS "the 9 EMA" to every blob ever written, and the definition registry has no
 *  concept of a slot), and AVWAP is a drawing, placed by clicking an anchor bar.
 *  They are NAMED here rather than silently tolerated, so a ninth has to be
 *  argued for instead of joining a quiet exemption — and `resolveIndicatorAdd`
 *  reports them as a DIFFERENT refusal class from a word that is not an
 *  indicator at all. */
const NON_DEFINITION_ALIASES = Object.freeze([
  'avwap', 'ma9', 'ma20', 'ma50', 'ma200', 'ema9', 'ema20', 'ema50',
])

/** Lower-cased id → catalog row. THE ONE `catalogRows()` CALL SITE in this
 *  module, so a mutation that narrows the derivation is visible to every
 *  assertion below rather than only to the one that happens to read it.
 *
 *  ⚠️ LOWER-CASED ON BOTH SIDES, AND THAT IS THE WHOLE POINT. `addIndicator`
 *  normalises with `.toLowerCase()`, so `williamsR` arrives as `williamsr` and
 *  `volumeProfile` as `volumeprofile`. A lookup by `row.id === indicator` would
 *  refuse exactly those two and nothing else — a bug that looks like thirteen
 *  working indicators. */
function lowerIndex(registry) {
  return new Map(catalogRows(registry).map(r => [r.id.toLowerCase(), r]))
}

/** The vocabulary a spoken "add X" can resolve to, split by WHY. Exported so the
 *  test pins the DERIVATION rather than a hand-copied list — this is what
 *  replaced `chartBus.ALLOWED_INDICATORS`, the enumeration site the B4 ledger
 *  retires. */
export function allowedIndicatorNames(registry) {
  return {
    indicators: [...lowerIndex(registry).keys()],
    aliases: [...NON_DEFINITION_ALIASES],
  }
}

/**
 * What a payload resolves to, and why it did not.
 *
 * `honoured` — a catalog row the chart can turn on.
 * `alias`    — one of the eight named non-definitions above. A legitimate thing
 *              to say; this surface cannot draw it.
 * `unknown`  — not an indicator. The server's `_INDICATOR_ALIASES` fallback
 *              (`raw.replace(" ", "")`) lands plenty of these here.
 *
 * @returns {{row: object|null, reason: 'honoured'|'alias'|'unknown'}}
 */
export function resolveIndicatorAdd(indicator, registry) {
  const key = String(indicator || '').trim().toLowerCase()
  const row = lowerIndex(registry).get(key) || null
  if (row) return { row, reason: 'honoured' }
  return { row: null, reason: NON_DEFINITION_ALIASES.includes(key) ? 'alias' : 'unknown' }
}

/**
 * ⭐ THE OTHER HALF — the one that had never existed.
 *
 * Everything about WHICH indicator lives here; everything about HOW a chart
 * stores it lives in `hooks/useChartIndicatorBus.js`, so the routing rule is not
 * duplicated into the bus.
 *
 * @param {(row: object) => void} onRow  called with the resolved catalog row
 * @param {object} [registry]            definition registry (defaults to native)
 * @returns {() => void} unsubscribe — CALL IT. A listener per remount is the
 *   class `lesson_teardown_must_undo_what_setup_created` names.
 */
export function subscribeIndicatorAdds(onRow, registry) {
  return subscribeAll({
    onIndicator: (detail) => {
      const { row } = resolveIndicatorAdd(detail && detail.indicator, registry)
      if (!row) return
      onRow(row)
    },
  })
}

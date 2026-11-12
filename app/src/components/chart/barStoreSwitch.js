// ── THE BARSTORE SWITCH (P3-S1, BARSTORE-SPEC.md "P3 slices") ─────────────────────
// ONE switch selects where a chart's bars come from:
//   off → chart/useLegacyChartBars.js   (the SWR / IDB / mem selector — production today)
//   on  → chart/useBarSnapshotBars.js   (the BarStore snapshot, data/barStore)
//
// ⛔ READ ONCE, AT MODULE LOAD. The value is a constant for the life of the page, so the
// chart's hook order can never change between renders (StockChart picks the hook ONCE at
// module scope) and two charts on one page can never disagree.
//
//   build const   VITE_BARSTORE === '1'           (Railway build arg on web; default unset → off)
//   per-browser   localStorage['uct.barStore']    '1' forces on, '0' forces off (wins over the build)
//
// ⭐ WHY THIS IS A FLAG (owner policy is "no new dark flags without a concrete safety reason"):
// the BarStore replaces the whole bar data path of every chart. It ships OFF so the owner can
// approve the live switch separately, after a per-browser soak (`uct.barStore=1`). It is
// removed ≤ 7 days after it reaches 100% (P3-S3 deletes the legacy hook and this module).

export const BARSTORE_STORAGE_KEY = 'uct.barStore'

/**
 * @param {{buildConst?: unknown, read?: (key: string) => (string|null|undefined)}} o
 * @returns {boolean}
 */
export function resolveBarStoreSwitch({ buildConst, read } = {}) {
  let v = null
  try { v = read ? read(BARSTORE_STORAGE_KEY) : null } catch { v = null }
  if (v === '1') return true
  if (v === '0') return false
  return buildConst === '1' || buildConst === 1 || buildConst === true
}

function _readStorage(key) {
  try { return globalThis.localStorage?.getItem(key) ?? null } catch { return null }
}

let _build
try { _build = import.meta.env.VITE_BARSTORE } catch { _build = undefined }

/** The switch, read once. */
export const BARSTORE = resolveBarStoreSwitch({ buildConst: _build, read: _readStorage })

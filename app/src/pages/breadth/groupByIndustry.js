// Back-compat shim. The grouping logic now lives in grouping/groupItems.js
// (generalized so the drill modal AND CustomScan share it). This wrapper keeps
// the original industry-only signature used by existing callers + tests.
import { groupItems, UNCLASSIFIED_GROUP } from './grouping/groupItems'

export { UNCLASSIFIED_GROUP }

export function groupItemsByIndustry(items, industries) {
  return groupItems(items, industries, { tickerOf: r => r.t, pctOf: r => r.pct })
}

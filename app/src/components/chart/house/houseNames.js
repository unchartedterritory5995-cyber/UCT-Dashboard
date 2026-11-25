// app/src/components/chart/house/houseNames.js
//
// ⭐ (owner ruling 2026-11-24, on Fred RS: "hide all that crap") UCT's OWN house indicators carry no data-source notes
// under the chart. TradingView shows none for them, and the owner vouches for these scripts and their data. A member's
// copy of a house entry is an ordinary user definition (`IndicatorHouseTab.buildPineCopy`), so it is recognised by
// what the house tab saves: the entry's NAME, on a copy whose script was never edited (`meta.scriptEdited !== true`,
// the same test `ownScriptCopyId` uses to reuse a copy).
//
// ⛔ The names are the house set's own (`housePineIndicators.json`), restated here only so the chart does not load the
// whole house file (it carries every script's source); `houseNames.test.js` pins the two lists equal.
export const HOUSE_INDICATOR_NAMES = Object.freeze(['Fred RS'])

const NAMES = new Set(HOUSE_INDICATOR_NAMES.map((n) => n.toLowerCase()))

/** Is this definition's meta an unedited member copy of a UCT house indicator? */
export function isHouseCopyMeta(meta) {
  return !!(meta && typeof meta === 'object' && meta.scriptEdited !== true
    && typeof meta.name === 'string' && NAMES.has(meta.name.trim().toLowerCase()))
}

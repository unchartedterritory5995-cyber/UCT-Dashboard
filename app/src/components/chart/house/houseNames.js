// app/src/components/chart/house/houseNames.js
//
// ⭐ (owner ruling 2026-11-24, on Fred RS: "hide all that crap") UCT's OWN house indicators carry no data-source notes
// under the chart. TradingView shows none for them, and the owner vouches for these scripts and their data. A member's
// copy of a house entry is an ordinary user definition (`IndicatorHouseTab.buildPineCopy`), so it is recognised by
// what the house tab saves: the entry's NAME, on a copy whose script was never edited (`meta.scriptEdited !== true`,
// the same test `ownScriptCopyId` uses to reuse a copy).
// ⭐ (owner, 2026-11-27: the notes are "ugly and horrible") AND BY ITS SCRIPT: a copy of the house script made any
// other way (pasted into Create Indicator as "RS Rating", or renamed) is the same script, byte for byte, so it is
// recognised by the sha256 the member door stamps on it (`meta.pineSourceSha256`, `memberPaneDefinition`), never edited.
//
// ⛔ The names and scripts are the house set's own (`housePineIndicators.json`), restated here only so the chart does not
// load the whole house file (it carries every script's source); `pane/attachedPineDisclosures.house.test.jsx` pins the
// lists equal.
export const HOUSE_INDICATOR_NAMES = Object.freeze(['Fred RS'])

/** sha256 of every house Pine script (`housePineIndicators.json` → `pineSha256`). */
export const HOUSE_SCRIPT_SHA256 = Object.freeze(['caa94fe31a8788c0f52ca571dbb1b3f8a7499dae913ed5e710720fc8662c5af0'])

const NAMES = new Set(HOUSE_INDICATOR_NAMES.map((n) => n.toLowerCase()))
const SCRIPTS = new Set(HOUSE_SCRIPT_SHA256)

/** Is this definition's meta an unedited member copy of a UCT house indicator (by its name, or by its script)? */
export function isHouseCopyMeta(meta) {
  if (!meta || typeof meta !== 'object' || meta.scriptEdited === true) return false
  if (typeof meta.name === 'string' && NAMES.has(meta.name.trim().toLowerCase())) return true
  return typeof meta.pineSourceSha256 === 'string' && SCRIPTS.has(meta.pineSourceSha256.toLowerCase())
}

// ─── ⭐⭐ (owner, 2026-11-27) — THE OWNER'S TRADINGVIEW SETTINGS ARE FRED RS'S UCT DEFAULTS ─────────────────────────────
//
// The owner's own Fred RS on TradingView (read live from their chart, 2026-11-27) is set off the script's defaults in
// four places: "Approximate Value of Comparative Symbol" 7200 (script 4200), "Offset (%)" 90 (script 80), the new-high
// "Type" 'Historical RS New Highs' (script 'RS New Highs') and its "Look-back" 30 (script 250). Everything else is the
// script's own. A NEW Fred RS instance is born with these four, through the door every UCT indicator uses for "the
// values a new copy gets" (`meta.createInputs`, `instanceControls.createInputsOf`), declared on load
// (`memberDocumentProjection.projectMemberDocument`). The SCRIPT is untouched, byte for byte, so its sha256 (the runtime
// allowlist, the run-half evidence, every parity capture) still names it.
//   · the declared defaults stay the script's: "Reset to defaults" in the settings restores the script's values, as
//     TradingView's "Reset settings" does (the owner's values are their TradingView "Save as default");
//   · the four values are MOVED settings to the run half, which serves a moved setting a drawing reads only on recorded
//     evidence (`runHalfSettingsAdmitted`): all four are admitted by the graded captures at moved settings
//     (`api/data/pine_runtime_allowlist.json`, sets a, b and e2), held by `house/houseCreateInputs.test.js`;
//   · an instance already on a chart keeps the values it holds: a default never moves a line already drawn.
const HOUSE_CREATE_INPUTS = Object.freeze({
  caa94fe31a8788c0f52ca571dbb1b3f8a7499dae913ed5e710720fc8662c5af0: Object.freeze({
    SpxValue: 7200, offset: 90, rsNewHigh: 'Historical RS New Highs', lookback: 30,
  }),
})

/** UCT's values for a NEW instance of a house copy (`meta.createInputs`), or null for anything else. */
export function houseCreateInputsOf(meta) {
  if (!isHouseCopyMeta(meta)) return null
  const sha = typeof meta.pineSourceSha256 === 'string' ? meta.pineSourceSha256.toLowerCase() : null
  return (sha && HOUSE_CREATE_INPUTS[sha]) || null
}

/** The key a document declares a Pine input under: a folded length is `param<N>` (`paramInputs.js`, its manifest
 *  entry's `sourceName` is the Pine name), every other setting is keyed by its Pine name. */
function declaredKeyOf(def, pineName) {
  const manifest = def.compute && def.compute.paramManifest && typeof def.compute.paramManifest === 'object'
    ? def.compute.paramManifest : {}
  for (const spec of Array.isArray(def.inputs) ? def.inputs : []) {
    if (!spec || typeof spec.key !== 'string') continue
    if (spec.fromParam) {
      const e = manifest[spec.fromParam]
      if (e && e.sourceName === pineName) return spec.key
    } else if (spec.key === pineName) return spec.key
  }
  return null
}

/** The document with its house values for new instances declared, keyed as the document declares each setting
 *  (unchanged when it is not a house copy, declares none of them, or already declares its own). In memory, like
 *  every load-time projection: it runs after every other one (`projectMemberDocument`), so a folded length is found. */
export function withHouseCreateInputs(def) {
  if (!def || typeof def !== 'object' || !def.meta || def.meta.createInputs) return def
  const ci = houseCreateInputsOf(def.meta)
  if (!ci) return def
  const out = {}
  for (const [name, value] of Object.entries(ci)) {
    const key = declaredKeyOf(def, name)
    if (key) out[key] = value
  }
  if (!Object.keys(out).length) return def
  return { ...def, meta: { ...def.meta, createInputs: out } }
}

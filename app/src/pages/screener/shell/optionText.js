// What a filter OPTION reads as, separate from what it IS. The option's label stays its
// identity (presets are matched and selected by it); only the text a member reads changes.
//
// Country options arrive as the ISO codes the snapshot stores (AE, BM, KY ...), which most
// members cannot read. The browser already knows every region's English name
// (Intl.DisplayNames), so no list is shipped and none can go stale.
const REGION_KEYS = new Set(['country'])
let names = null

export function regionName(code) {
  if (!code || typeof code !== 'string') return code
  try {
    names = names || new Intl.DisplayNames(['en'], { type: 'region' })
    const n = names.of(code.toUpperCase())
    // An unassigned code (ZZ) is named 'Unknown Region'; the code itself is the honest text.
    return n && n !== code.toUpperCase() && n !== 'Unknown Region' ? n : code
  } catch {
    return code
  }
}

export function optionText(filterKey, label) {
  if (!REGION_KEYS.has(filterKey) || label === 'Any' || label === 'Custom…') return label
  return regionName(label)
}

// The order a member scans a list in is the order of what they READ: sorted by code, the
// country list opened on "United Arab Emirates" (AE). 'Any' stays first and 'Custom…' last.
export function orderOptions(filterKey, labels) {
  if (!REGION_KEYS.has(filterKey)) return labels
  const fixed = l => l === 'Any' || l === 'Custom…'
  const named = labels.filter(l => !fixed(l))
    .sort((a, b) => optionText(filterKey, a).localeCompare(optionText(filterKey, b)))
  return [...labels.filter(l => l === 'Any'), ...named, ...labels.filter(l => l === 'Custom…')]
}

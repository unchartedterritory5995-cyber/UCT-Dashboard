// The one short setup line under a ticker in the Focus list. Honesty rules
// (spec §6.1): the head of base_render only; zero volume says "No trades today";
// a pivot distance ONLY when the row carries base_pivot_px, which the snapshot
// writes from the same detection that names the head structure (phase 2).
//
// When the screen asks for a structure (Base Structure contains X), every row it
// answers matched X: the filter reads base_matches, every structure the row
// satisfied. The render's head may name a different one ("Pocket pivots" led by
// "Ugly Double Bottom"), so the matched structure leads and the head follows as
// "also". The head's pivot then belongs to the head, never to the lead.
import { plainStructure } from './plainWords'

const fmtPx = p => (Math.abs(p) >= 10 ? Math.round(p).toString() : p.toFixed(2))

export function pivotDetail(price, pivot) {
  if (!Number.isFinite(price) || !Number.isFinite(pivot) || pivot <= 0) return null
  const pct = (price / pivot - 1) * 100
  if (Math.abs(pct) < 0.25) return `at pivot ${fmtPx(pivot)}`
  return `${Math.abs(pct).toFixed(1)}% ${pct < 0 ? 'below' : 'above'} pivot ${fmtPx(pivot)}`
}

// The structure library as the server ships it: the Base Structure filter's presets, each a
// label and the delimiter-wrapped value it matches. The filter is found by the column it reads,
// so no key or label list is typed here.
const STRUCTURE_COLUMN = 'base_matches'
const norm = s => String(s || '').trim().toLowerCase()

// A tooltip for a structure name: the library's description when the payload carries one,
// otherwise the textbook name when the plain name replaced it, otherwise the name itself.
const tooltipFor = (name, desc) => desc || name

const structureFilters = metaFilters => (metaFilters || []).filter(def => def?.column === STRUCTURE_COLUMN)

// Every structure name in the library. A name may itself hold " (" ("Cheat (3-C)"), so the
// render's head is found by name, not by cutting at the first parenthesis.
export function structureLabels(metaFilters) {
  return structureFilters(metaFilters).flatMap(def => (def.presets || []).filter(p => p.op === 'contains' && p.label).map(p => p.label))
}

// Active structure keys of a screen, as [{ value, label, title }], from its ANSWERED filters
// (never the live edit state: the rows on screen answer the filters they were asked with).
export function activeStructures(filters, metaFilters) {
  const out = []
  for (const def of structureFilters(metaFilters)) {
    const spec = filters?.[def.key]
    if (!spec || spec.op !== 'contains' || !spec.value) continue
    const preset = (def.presets || []).find(p => p.op === 'contains' && p.value === spec.value)
    if (!preset?.label) continue
    out.push({ value: spec.value, label: preset.label, title: tooltipFor(preset.label, preset.desc || preset.description) })
  }
  return out
}

// `structures`: { matched: activeStructures(...), labels: structureLabels(...) }, both optional.
export function setupLine(row, { matched = [], labels = [] } = {}) {
  if (row?.vol_ratio === 0) return { text: 'No trades today', detail: null, quiet: true, title: null }
  const render = row?.base_render
  if (!render) return { text: 'Not enough history for a base', detail: null, quiet: true, title: null }
  // Full render with the +N removed. The head is a library name the render opens with
  // ("Cheat (3-C) (Flat Base)" leads with "Cheat (3-C)"); failing that, the part before
  // " (". When that is empty, or the render opens with a parenthetical, the head would be
  // blank or misleading, so show the whole render instead.
  const full = String(render).replace(/\s*\+\d+\s*$/, '').trim()
  const named = (labels || []).filter(l => full === l || full.startsWith(`${l} (`))
    .sort((a, b) => b.length - a.length)[0]
  let head = named || full.split(' (')[0].trim()
  if (!head || full.startsWith('(')) head = full
  const detail = pivotDetail(row?.price, row?.base_pivot_px)
  const headPlain = plainStructure(head)
  const lead = (matched || []).find(m => m?.label)
  if (!lead || norm(lead.label) === norm(head)) {
    return { text: headPlain, detail, quiet: false, title: lead ? lead.title : tooltipFor(head, null) }
  }
  const leadPlain = plainStructure(lead.label)
  return {
    text: `${leadPlain} · also ${headPlain}`, detail: null, quiet: false, title: lead.title,
    lead: leadPlain, also: headPlain, alsoDetail: detail,
  }
}

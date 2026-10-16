// The one short setup line under a ticker in the Focus list. Honesty rules
// (spec §6.1): the head of base_render only; zero volume names the session it describes
// ("No trades on Oct 9", "today" only when bars_asof is today);
// a pivot distance ONLY when the row carries base_pivot_px, which the snapshot
// writes from the same detection that names the head structure (phase 2).
//
// When the screen asks for a structure (Base Structure contains X), every row it
// answers matched X: the filter reads base_matches, every structure the row
// satisfied. The render's head may name a different one ("Pocket pivots" led by
// "Ugly Double Bottom"), so the matched structure leads and the head follows as
// "also". The head's pivot then belongs to the head, never to the lead.
import { plainStructure, sentenceCase } from './plainWords'
import { isoDay, shortDay, sessionsMissed } from './dates'
import { etYmd } from '../../../lib/marketClock/etTime'

// Cents always (a whole-dollar pivot drops its ".00"). ⛔ Rounding to the dollar printed
// "1.3% above pivot 11" for a $10.54 pivot under a $10.68 price (ERIC, production
// 2026-10-16): any rounding can put the shown pivot on the wrong side of the price.
const fmtPx = p => p.toFixed(2).replace(/\.00$/, '')

// IBD's general buy zone: up to 5% above the pivot. Past it a breakout has RESOLVED, and a big
// "47.9% above pivot" reads as if the setup were still forming. The server applies the same 5%
// (base_catalog.IBD_BUY_ZONE) to stop NAMING a resolved double bottom or ascending base; this
// copy only words the distance. They are two statements of one published number, not wired.
export const EXTENDED_PAST_PIVOT_PCT = 5

// A pivot belongs to the bars it was read from. Once those bars are more than this many CLOSED
// sessions behind (dates.js sessionsMissed, read against the row's own bars_asof), the line is
// hidden and the distance is dated instead of measured against today's price.
export const PIVOT_STALE_SESSIONS = 2

// `asOf`: an "Oct 9"-style date when the pivot is stale; the detail then says when it was read
// instead of measuring a live price against it.
export function pivotDetail(price, pivot, { asOf = null } = {}) {
  if (!Number.isFinite(pivot) || pivot <= 0) return null
  if (asOf) return `pivot ${fmtPx(pivot)} as of ${asOf}`
  if (!Number.isFinite(price)) return null
  const pct = (price / pivot - 1) * 100
  if (Math.abs(pct) < 0.25) return `at pivot ${fmtPx(pivot)}`
  // Compared as the server does (close > pivot x 1.05), not on the rounded percentage, so a close
  // exactly on the zone's edge is inside it on both sides.
  if (price > pivot * (1 + EXTENDED_PAST_PIVOT_PCT / 100)) return `extended past pivot ${fmtPx(pivot)}`
  return `${Math.abs(pct).toFixed(1)}% ${pct < 0 ? 'below' : 'above'} pivot ${fmtPx(pivot)}`
}

// True when the row's bars are more than PIVOT_STALE_SESSIONS closed sessions behind. A row with
// no readable bars_asof cannot be aged, and is not called stale.
export function pivotIsStale(row, now = Date.now()) {
  if (!isoDay(row?.bars_asof)) return false
  return (sessionsMissed(null, now, row.bars_asof) ?? 0) > PIVOT_STALE_SESSIONS
}

const pivotDetailFor = (row, now) => pivotDetail(row?.price, row?.base_pivot_px,
  { asOf: pivotIsStale(row, now) ? shortDay(row.bars_asof) : null })

// Zero volume describes the session the row's numbers come from (bars_asof), which is today only
// when bars_asof says so: a Friday row read on Monday traded nothing on Friday, not "today".
function noTradesText(row, now) {
  const day = isoDay(row?.bars_asof)
  if (!day) return 'No trades in the last session'
  const nowMs = typeof now === 'number' ? now : now.getTime()
  return day === etYmd(nowMs) ? 'No trades today' : `No trades on ${shortDay(day)}`
}

// Empty structure columns: too little history (bases.MIN_HISTORY), or the structure step did not
// run for this row (snapshot_builder writes NULLs when it raises). The list payload carries nothing
// that tells those apart, so the wording claims neither.
export const NO_STRUCTURE_TEXT = 'No structure read'
const NO_STRUCTURE_TITLE = 'No structure for this stock in this build: too little price history, or the structure read did not run.'

// The structure library as the server ships it: the Base Structure filter's presets, each a
// label and the delimiter-wrapped value it matches. No structure label list is typed here.
const STRUCTURE_COLUMN = 'base_matches'
const norm = s => String(s || '').trim().toLowerCase()

// A tooltip for a structure name: the library's description when the payload carries one, led
// by the textbook name whenever the plain name replaced it (so the trader's term is never lost);
// with no description, the textbook name itself.
export function tooltipFor(name, desc) {
  if (!desc) return name
  return plainStructure(name) !== name ? `${name}: ${desc}` : desc
}

// ⛔ The meta payload's filter entries carry NO `column` field (filters.py `_build_shared_filters`
// ships key, label, category, type, presets, allow_custom, unit), so the filter is found by its
// server key; `column` is honoured only if a later payload ever carries it.
const STRUCTURE_KEY = 'base_structure'
const structureFilters = metaFilters => (metaFilters || [])
  .filter(def => def?.key === STRUCTURE_KEY || def?.column === STRUCTURE_COLUMN)

// Every structure name in the library. A name may itself hold " (" ("Cheat (3-C)"), so the
// render's head is found by name, not by cutting at the first parenthesis.
export function structureLabels(metaFilters) {
  return structureFilters(metaFilters).flatMap(def => (def.presets || []).filter(p => p.op === 'contains' && p.label).map(p => p.label))
}

// Each library structure's member-facing description (base_catalog.enum_options ships `desc` on
// every preset), keyed by label, for the head's tooltip.
export function structureDescs(metaFilters) {
  const out = {}
  for (const def of structureFilters(metaFilters)) {
    for (const p of def.presets || []) {
      const d = p?.desc || p?.description
      if (p?.op === 'contains' && p.label && d) out[p.label] = d
    }
  }
  return out
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

// The render's head structure: a library name the render opens with ("Cheat (3-C) (Flat Base)"
// leads with "Cheat (3-C)"); failing that, the part before " (". When that is empty, or the render
// opens with a parenthetical, the head would be blank or misleading, so the whole render instead.
export function renderHead(render, labels = []) {
  if (!render) return null
  const full = String(render).replace(/\s*\+\d+\s*$/, '').trim()
  const named = (labels || []).filter(l => full === l || full.startsWith(`${l} (`))
    .sort((a, b) => b.length - a.length)[0]
  let head = named || full.split(' (')[0].trim()
  if (!head || full.startsWith('(')) head = full
  return head
}

// The chart pane's pivot line: the head structure's own pivot, titled for it in plain words
// ("Flat base pivot"). None when the row has no pivot, and none when the pivot is stale, because
// a full-width line from an old read says "this level matters now" about bars that moved on.
export function pivotLine(row, { labels = [] } = {}, now = Date.now()) {
  const pivot = row?.base_pivot_px
  if (!Number.isFinite(pivot) || pivot <= 0 || pivotIsStale(row, now)) return null
  const head = renderHead(row?.base_render, labels)
  return { price: pivot, title: head ? `${sentenceCase(plainStructure(head))} pivot` : 'pivot' }
}

// `structures`: { matched: activeStructures(...), labels: structureLabels(...), descs: structureDescs(...) },
// all optional. `now` ages the row's bars_asof.
export function setupLine(row, { matched = [], labels = [], descs = {} } = {}, { now = Date.now() } = {}) {
  if (row?.vol_ratio === 0) return { text: noTradesText(row, now), detail: null, quiet: true, title: null }
  const head = renderHead(row?.base_render, labels)
  if (!head) return { text: NO_STRUCTURE_TEXT, detail: null, quiet: true, title: NO_STRUCTURE_TITLE }
  const detail = pivotDetailFor(row, now)
  const headPlain = plainStructure(head)
  const lead = (matched || []).find(m => m?.label)
  if (!lead || norm(lead.label) === norm(head)) {
    return { text: headPlain, detail, quiet: false, title: lead ? lead.title : tooltipFor(head, descs?.[head]) }
  }
  const leadPlain = plainStructure(lead.label)
  return {
    text: `${leadPlain} · also ${headPlain}`, detail: null, quiet: false, title: lead.title,
    lead: leadPlain, also: headPlain, alsoDetail: detail,
  }
}

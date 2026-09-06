/**
 * Research return-context marker (Seam 12 fix, Journal / Trade Lifecycle
 * Convergence V1 Phase A). Clicking Full Research / Ask AI / Compare from
 * TradeDetailPage.jsx / TradeDrawer.jsx / PositionDetailPage.jsx navigates
 * away with no way back except browser Back. This is the ONE shared
 * build/parse pair both the writers (those three surfaces) and the one
 * reader (ResearchPage.jsx's "Back to Trade/Position" link) use, so the
 * format can never drift between them.
 *
 * Deliberately NOT a full return-to-exact-state contract (a trade opened via
 * TradeDrawer's slide-over has no route of its own to reopen) -- `trade:{id}`
 * always resolves to the canonical /journal-2-0/trade/{id} detail page, which
 * shows the same trade regardless of whether it was opened via the drawer or
 * the full page. That is a correct, always-valid destination, not an
 * approximation.
 */

export function buildResearchReturnParam(kind, ref) {
  if (!kind || ref == null || ref === '') return null
  return `${kind}:${ref}`
}

export function withResearchReturnParam(path, kind, ref) {
  const marker = buildResearchReturnParam(kind, ref)
  if (!marker) return path
  const sep = path.includes('?') ? '&' : '?'
  return `${path}${sep}from=${encodeURIComponent(marker)}`
}

/** Returns { kind: 'trade'|'position', ref: string } or null. */
export function parseResearchReturnParam(value) {
  if (!value) return null
  const idx = value.indexOf(':')
  if (idx <= 0) return null
  const kind = value.slice(0, idx)
  const ref = value.slice(idx + 1)
  if (!ref) return null
  if (kind === 'trade') return { kind, ref }
  if (kind === 'position') return { kind, ref: ref.toUpperCase() }
  return null
}

export function researchReturnTarget(parsed) {
  if (!parsed) return null
  if (parsed.kind === 'trade') return `/journal-2-0/trade/${encodeURIComponent(parsed.ref)}`
  if (parsed.kind === 'position') return `/journal-2-0/position/${encodeURIComponent(parsed.ref)}`
  return null
}

export function researchReturnLabel(parsed) {
  if (!parsed) return null
  if (parsed.kind === 'trade') return 'Back to Trade'
  if (parsed.kind === 'position') return `Back to ${parsed.ref} Position`
  return null
}

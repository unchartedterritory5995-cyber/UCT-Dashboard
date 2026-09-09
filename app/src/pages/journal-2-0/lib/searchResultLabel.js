// ⛔⛔ A SEARCH RESULT MUST SAY WHAT IT IS (Wave M §8).
//
// ⚰️ THE DEFECT THIS CLOSES, measured 2026-09-08. A captured web source is
// stored as a `j2_note_documents` row whose passages are `j2_note_document_pages`
// rows, and `page_number` there is a **capture ordinal** — the second passage
// clipped from one Reuters article is `2`. Both search sections rendered that
// as `· p.2`, so Search told the member they had page 2 of a Reuters article.
// There is no page 2. There is no page 1. It is a web page they quoted twice.
//
// That is the exact thing the directive forbids — *"do not label capture_order
// as PDF page"* — and it is worse than cosmetic: a page number implies a
// paginated document exists behind it, which is a completeness claim about
// somebody else's content that Wave L deliberately refused to make.
//
// ⭐ ONE LABELLER FOR BOTH SECTIONS. Documents and Evidence render different
// rows from different indexes, and each was formatting its own title string.
// Two formatters over one truth is how they drift — and here the drift would be
// silent, because both spellings look plausible.

import { outcomeLabel } from './reviewOutcomes'

/** A captured web source: `page_number` is a capture ordinal, not a page. */
export const SOURCE_WEB = 'web'
/** A real paginated document (PDF): `page_number` is a page. */
export const SOURCE_ATTACHMENT = 'attachment'

/** Host only, for a compact and honest provenance line. Never the full URL —
 *  a search row is not the place to render somebody's tracking parameters. */
export function sourceDomain(url) {
  const raw = String(url || '').trim()
  if (!raw) return ''
  try {
    return new URL(raw).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/**
 * The title line for one search hit.
 *
 * @param {{sourceKind?: string, name?: string, documentName?: string,
 *          pageNumber?: number, sourceUrl?: string}} row
 * @param {{kind?: 'page'|'excerpt'|'review'}} opts  Which section renders it.
 * @returns {string}
 *
 * ⛔ A web hit carries NO page number in any form. Not "capture 2", not "p.2" —
 * the ordinal is an implementation detail of how we store passages and means
 * nothing to the member. What they need is which source it came from.
 */
export function searchResultTitle(row = {}, { kind = 'page' } = {}) {
  // ⛔⛔ O6 §8/§14: A REVIEW SAYS IT IS A REVIEW, FIRST WORD. This row is
  // the MEMBER's own conclusion about their thesis, and the one thing it must
  // never be mistaken for is something a source said. Labelling it "Document"
  // or letting it fall through to the untitled-document branch below would let
  // an answer read as though Reuters had written it. It also carries no page
  // and no domain, because it has neither.
  if (kind === 'review') {
    const thesis = (row.noteTitle || '').trim()
    return thesis ? `Thesis review · ${thesis}` : 'Thesis review'
  }

  const name = (row.name || row.documentName || '').trim()
  const isWeb = row.sourceKind === SOURCE_WEB

  if (isWeb) {
    const domain = sourceDomain(row.sourceUrl)
    const what = kind === 'excerpt' ? 'Saved passage' : 'Captured passage'
    if (name && domain) return `${what} · ${name} (${domain})`
    if (name) return `${what} · ${name}`
    if (domain) return `${what} from ${domain}`
    return what
  }

  const label = name || 'Document'
  const page = Number(row.pageNumber)
  // ⛔ Only a real document gets a page, and only when we actually have one.
  return Number.isFinite(page) && page > 0 ? `${label} · p.${page}` : label
}

/** The hover/title attribute — same truth, a little longer. */
export function searchResultHint(row = {}, { kind = 'page' } = {}) {
  if (kind === 'review') {
    // The outcome and the date, in the member's own vocabulary. ⛔ An outcome
    // with no date must not render "on " with nothing after it — an unfinished
    // sentence reads as a bug in the record it is describing.
    const outcome = outcomeLabel(row.outcome)
    const when = reviewDateText(row.completedAt)
    const parts = [searchResultTitle(row, { kind })]
    if (outcome) parts.push(when ? `${outcome} on ${when}` : outcome)
    else if (when) parts.push(when)
    return parts.join(' — ')
  }
  const inNote = row.noteTitle ? ` — in "${row.noteTitle}"` : ''
  return `${searchResultTitle(row, { kind })}${inNote}`
}

/** A completed-at timestamp as the member's own locale date, or '' when it is
 *  absent or unparseable. ⛔ NEVER a fabricated fallback like "today". */
export function reviewDateText(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString()
}

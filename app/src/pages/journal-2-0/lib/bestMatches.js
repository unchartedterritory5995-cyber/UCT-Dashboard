/**
 * Wave 10 (R-5, clause 13b) — "Best matches": ONE ranked list over the search
 * sections the sidebar has already fetched, by reciprocal-rank fusion.
 *
 * ⛔ THE SECTIONS STAY. G-119's reason for sectioning (a passage a member chose
 * to keep must not be buried under raw document pages) still holds, so Notes,
 * Documents, Evidence and Thesis reviews each keep their own list below. Best
 * matches is a short list ABOVE them, every row labelled with its kind.
 *
 * ⛔ FUSION, NOT CONCATENATION, AND NO NEW QUERY. Each section's list is the
 * server's own ranking of that kind; reciprocal-rank fusion scores an item
 * `1 / (k + rank)` in the list it came from (k = 60, the standard constant),
 * so the best hit of EVERY kind outranks the second-best of any kind. A
 * concatenation would hand all five places to whichever section came first --
 * the burying the sections exist to prevent. No score is compared across
 * kinds (FTS ranks from four indexes are not on one scale); only positions.
 *
 * Ties (same rank in two sections) break by kind: what the member wrote or
 * chose to keep (a note, a saved excerpt, a thesis review) before raw
 * document text.
 *
 * ⛔ A row the meaning search appended to the Notes list matched NO word of
 * the query (`matchKind: 'meaning'`, ruling D-H8), so it is not a "match" and
 * is left out here; it keeps its place, labelled, in the Notes section.
 */

export const BEST_MATCHES_LIMIT = 5
export const RRF_K = 60

export const KIND_NOTE = 'note'
export const KIND_EXCERPT = 'excerpt'
export const KIND_REVIEW = 'review'
export const KIND_PAGE = 'page'

/** The label every Best-matches row carries, so a mixed list never hides what a row IS. */
export const KIND_LABEL = Object.freeze({
  [KIND_NOTE]: 'Note',
  [KIND_EXCERPT]: 'Saved excerpt',
  [KIND_REVIEW]: 'Thesis review',
  [KIND_PAGE]: 'Document page',
})

// Tie-break order: member-written / member-kept before raw text.
const KIND_ORDER = [KIND_NOTE, KIND_EXCERPT, KIND_REVIEW, KIND_PAGE]

/** A stable identity for an item of a kind (the key the section already uses). */
export function bestMatchKey(kind, item) {
  if (kind === KIND_NOTE) return `note:${item?.id}`
  if (kind === KIND_PAGE) return `page:${item?.documentId}-${item?.pageNumber}`
  if (kind === KIND_EXCERPT) return `excerpt:${item?.excerptId}`
  if (kind === KIND_REVIEW) return `review:${item?.reviewId}`
  return `${kind}:?`
}

const isMeaning = (note) => note?.matchKind === 'meaning'

/**
 * `lists` = `{ note: [...], excerpt: [...], review: [...], page: [...] }`, each
 * in its section's own order. Returns the top `limit` as
 * `[{ kind, item, key, rank, score }]`, best first.
 */
export function fuseBestMatches(lists, { limit = BEST_MATCHES_LIMIT, k = RRF_K } = {}) {
  const byKey = new Map()
  for (const kind of KIND_ORDER) {
    const list = Array.isArray(lists?.[kind]) ? lists[kind] : []
    const eligible = kind === KIND_NOTE ? list.filter((n) => !isMeaning(n)) : list
    eligible.forEach((item, i) => {
      const key = bestMatchKey(kind, item)
      const rank = i + 1
      // The same item listed twice (a stale page merge) counts once, at its
      // first (better) rank.
      if (byKey.has(key)) return
      byKey.set(key, { kind, item, key, rank, score: 1 / (k + rank) })
    })
  }
  return [...byKey.values()]
    .sort((a, b) => (b.score - a.score)
      || (KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind))
      || (a.rank - b.rank))
    .slice(0, Math.max(0, limit))
}

/** How many kinds actually have a hit (Best matches shows only when >= 2). */
export function kindsWithHits(lists) {
  return KIND_ORDER.filter((kind) => {
    const list = Array.isArray(lists?.[kind]) ? lists[kind] : []
    return (kind === KIND_NOTE ? list.filter((n) => !isMeaning(n)) : list).length > 0
  }).length
}

/** Every rankable item the sections below list (meaning rows excluded, as above). */
export function rankableCount(lists) {
  return KIND_ORDER.reduce((sum, kind) => {
    const list = Array.isArray(lists?.[kind]) ? lists[kind] : []
    return sum + (kind === KIND_NOTE ? list.filter((n) => !isMeaning(n)).length : list.length)
  }, 0)
}

/**
 * The count line, honest by construction: it counts only what the sections
 * below list right now (a Notes list with more pages to load is counted as
 * loaded, and says "below"), never a total the member cannot see.
 */
export function bestMatchesCountText(shown, total) {
  if (shown >= total) return `Best matches · all ${total}, best first`
  return `Best matches · top ${shown} of the ${total} results below`
}

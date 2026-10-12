// ── UCT Agent NL: one typo-tolerant name matcher ───────────────────────────────────────────
//
// Natural Language & Intent Intelligence (N2). Pure. Used by capability resolvers for the member's
// OWN names (layouts, watchlists, saved screens, templates) and by the instant-command lexicon (N3).
// The names come from live state — nothing here lists a name or a phrase.
//
// matchName(query, names, { level })
//   → { kind: 'exact', name }            normalized equality (case, quotes, spacing, punctuation)
//   → { kind: 'fuzzy', name, distance }  ONE name is uniquely closest within the level's threshold
//   → { kind: 'several', names }         several names tie within the threshold (the caller asks)
//   → { kind: 'none' }
// level 'safe'   : reversible / read-only actions — the thresholds below
// level 'strict' : high-impact actions (confirm / irreversible) — at most ONE edit, words of 5+
//                  letters only; the caller must still CONFIRM (proposal or question), never apply
//
// Thresholds (Damerau–Levenshtein, optimal string alignment) per WORD: ≤3 letters → exact only;
// 4–7 → 1 edit; 8+ → 2 edits. A name matches when every word matches in order (same word count),
// so "swng board" ↔ "Swing Board" (1) but never "swing" ↔ "Swing Board" (that is a different rule).

export function normText(s) {
  return String(s || '').toLowerCase().replace(/[“”"'`‘’]/g, '').replace(/[^a-z0-9$.&+\- ]+/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Optimal-string-alignment distance (adjacent transpositions count 1). Bounded: returns max+1 early. */
export function editDistance(a, b, max = 3) {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > max) return max + 1
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let v = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2][j - 2] + 1)
      d[i][j] = v
      if (v < rowMin) rowMin = v
    }
    if (rowMin > max) return max + 1
  }
  return d[a.length][b.length]
}

/** The edits a WORD of this length may have at this level. */
export function allowedEdits(word, level = 'safe') {
  const n = word.length
  if (/^\d+$/.test(word)) return 0                                 // numbers are never "corrected"
  if (level === 'strict') return n >= 5 ? 1 : 0
  return n <= 3 ? 0 : n <= 7 ? 1 : 2
}

/** Word-by-word distance of query to name, or null when a word is over its threshold. */
function wordsDistance(q, n, level) {
  const qw = q.split(' ')
  const nw = n.split(' ')
  if (qw.length !== nw.length) return null
  let total = 0
  for (let i = 0; i < qw.length; i++) {
    const allow = allowedEdits(nw[i].length < qw[i].length ? nw[i] : qw[i], level)
    const dist = editDistance(qw[i], nw[i], allow)
    if (dist > allow) return null
    total += dist
  }
  return total
}

export function matchName(query, names, { level = 'safe' } = {}) {
  const q = normText(query)
  if (!q) return { kind: 'none' }
  const list = [...new Set((names || []).filter(Boolean))]
  const exact = list.filter(n => normText(n) === q)
  if (exact.length === 1) return { kind: 'exact', name: exact[0] }
  if (exact.length > 1) return { kind: 'several', names: exact }
  const scored = list.map(n => ({ name: n, distance: wordsDistance(q, normText(n), level) })).filter(x => x.distance != null && x.distance > 0)
  if (!scored.length) return { kind: 'none' }
  const best = Math.min(...scored.map(x => x.distance))
  const top = scored.filter(x => x.distance === best)
  if (top.length > 1) return { kind: 'several', names: top.map(x => x.name) }       // a tie: ask, never guess
  return { kind: 'fuzzy', name: top[0].name, distance: best }
}

// Search inside the OPEN chat (Discord-style): which lines match, and which letters to highlight.
// Pure functions; the panel renders the results and jumps to the line.

// What a line says, as searchable text (cards and receipts are searched by their lines too).
export function lineText(it) {
  if (!it) return ''
  if (it.role === 'proposal' || it.role === 'receipt') return [...(it.lines || []), ...(it.notes || [])].join(' · ')
  return String(it.text || '')
}

// Words to look for: case-insensitive, "$AAPL" = "AAPL", empty words dropped.
export function searchTerms(query) {
  return String(query || '').toLowerCase().split(/\s+/).map(w => w.replace(/^\$/, '')).filter(Boolean)
}

// Every term must appear (any order). Newest first, like Discord.
export function searchChat(items, query) {
  const terms = searchTerms(query)
  if (!terms.length) return []
  const out = []
  for (const it of items || []) {
    const text = lineText(it)
    const low = text.toLowerCase()
    if (text && terms.every(t => low.includes(t))) out.push({ it, text })
  }
  return out.reverse()
}

// Split text into plain and highlighted runs (overlapping hits merged).
export function highlightRuns(text, query) {
  const terms = searchTerms(query)
  const low = String(text || '').toLowerCase()
  const ranges = []
  for (const t of terms) {
    for (let i = low.indexOf(t); i !== -1; i = low.indexOf(t, i + t.length)) ranges.push([i, i + t.length])
  }
  ranges.sort((a, b) => a[0] - b[0])
  const merged = []
  for (const r of ranges) {
    const last = merged[merged.length - 1]
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1])
    else merged.push([...r])
  }
  const runs = []
  let at = 0
  for (const [a, b] of merged) {
    if (a > at) runs.push({ text: text.slice(at, a), hit: false })
    runs.push({ text: text.slice(a, b), hit: true })
    at = b
  }
  if (at < text.length) runs.push({ text: text.slice(at), hit: false })
  return runs
}

// A long line is shown around its first hit, with … where it was cut.
export function snippet(text, query, max = 220) {
  const s = String(text || '')
  if (s.length <= max) return s
  const first = Math.min(...searchTerms(query).map(t => s.toLowerCase().indexOf(t)).filter(i => i >= 0), s.length)
  let start = Math.max(0, Math.min(first - 60, s.length - max))
  let end = Math.min(s.length, start + max)
  // Never cut a word in half: start after a space, end before one.
  if (start > 0) { const sp = s.indexOf(' ', start); if (sp !== -1 && sp < first) start = sp + 1 }
  if (end < s.length) { const sp = s.lastIndexOf(' ', end); if (sp > first) end = sp }
  return `${start > 0 ? '…' : ''}${s.slice(start, end).trim()}${end < s.length ? '…' : ''}`
}

// app/src/pages/desk/articleProgress.js
//
// Where you left off in a long issue. Sunday Scans runs 11-26 minutes, so
// leaving mid-read and starting over is a real cost.
//
// ⛔ THE POSITION IS A HEADING, NOT A SCROLL OFFSET. An article carries up to 99
// lazily-loaded charts, so the page GROWS for seconds after mount — a restored
// pixel offset (or a percentage of scrollHeight) lands somewhere arbitrary and
// keeps moving. A heading id is stable the moment the HTML is in the DOM,
// regardless of what the images are doing. It also lets the UI say WHERE it put
// you ("picked up at Market Breadth Data") instead of asking you to trust a
// silent jump.
//
// Pure storage + pruning, no DOM: the reader owns the scrolling, this owns the
// remembering, and the split is what makes the rules below testable.

const KEY = 'uct.desk.article.progress'

// Enough entries to cover a real reading habit, few enough to stay small.
export const MAX_ENTRIES = 60
// A position older than this is not "where I left off", it is a different week.
export const MAX_AGE_MS = 60 * 24 * 3600 * 1000

// Below this you have barely started — restoring is more disruptive than
// helpful. Above it you have effectively finished, so send them to the top.
export const MIN_PCT = 0.05
export const MAX_PCT = 0.95

function readAll() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}')
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  } catch {
    // Corrupt or unavailable storage must never break the reader.
    return {}
  }
}

function writeAll(map) {
  try {
    localStorage.setItem(KEY, JSON.stringify(map))
  } catch {
    /* quota / private mode — losing a bookmark is not worth an error */
  }
}

/** Prune expired and least-recent entries. Exported so a test can pin the rules. */
export function prune(map, now = Date.now()) {
  const live = Object.entries(map)
    .filter(([, v]) => v && typeof v.at === 'number' && now - v.at <= MAX_AGE_MS)
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, MAX_ENTRIES)
  return Object.fromEntries(live)
}

/** Remember the reader's place. A finished (or barely started) article is
 *  CLEARED rather than stored, so it never offers to resume the end. */
export function save(slug, { sectionId, pct }, now = Date.now()) {
  if (!slug) return
  const map = readAll()
  if (!sectionId || !(pct > MIN_PCT) || pct >= MAX_PCT) delete map[slug]
  else map[slug] = { sectionId, pct, at: now }
  writeAll(prune(map, now))
}

/** Where they were, or null. Null when absent, expired, or out of range. */
export function load(slug, now = Date.now()) {
  if (!slug) return null
  const e = readAll()[slug]
  if (!e || typeof e.at !== 'number' || now - e.at > MAX_AGE_MS) return null
  if (!e.sectionId || !(e.pct > MIN_PCT) || e.pct >= MAX_PCT) return null
  return e
}

/** Finished, or explicitly sent back to the top. */
export function clear(slug) {
  if (!slug) return
  const map = readAll()
  if (slug in map) {
    delete map[slug]
    writeAll(map)
  }
}

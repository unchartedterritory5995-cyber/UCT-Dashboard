/**
 * Wave 5 — word count and reading time: what the note (or the selection) holds.
 *
 * WHAT COUNTS AS A WORD. A run of letters or digits, with the joiners a
 * trader's prose uses inside a word ("NVDA's", "long-term", "U.S.", "3.5%"'s
 * "3.5") — and each Han / Kana character on its own, since those scripts put
 * no spaces between words. Only TEXT the member wrote counts: a chart, a file
 * chip, an excerpt or a formula is not prose (a formula's LaTeX would count
 * "\frac" as a word). A line break and every other inline atom separate words
 * rather than glue them ("line one⏎line two" is four words, never three).
 *
 * READING TIME: 238 words a minute (the commonly cited adult average for
 * non-fiction), rounded, never under a minute for a note that has any words.
 */
export const WORDS_PER_MINUTE = 238

// CJK first, so a Han character is one word; otherwise letters/digits with
// inner joiners. `u` flag + \p{…}: Safari 11.1+, well inside the iOS 16 floor.
const WORD_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[\p{L}\p{N}](?:[\p{L}\p{N}'’._-]*[\p{L}\p{N}])?/gu

export function countWords(text) {
  if (!text) return 0
  let n = 0
  WORD_RE.lastIndex = 0
  while (WORD_RE.exec(text) !== null) n += 1
  return n
}

export function readingMinutes(words) {
  return words > 0 ? Math.max(1, Math.round(words / WORDS_PER_MINUTE)) : 0
}

// Every leaf reads as a SPACE: it separates the words on either side and adds
// none of its own (see the header).
const leafAsSpace = () => ' '

/** Words in [from, to) of a ProseMirror doc. */
export function wordsBetween(doc, from, to) {
  if (!doc || to <= from) return 0
  return countWords(doc.textBetween(from, to, '\n', leafAsSpace))
}

export function noteStats(doc) {
  const words = wordsBetween(doc, 0, doc?.content?.size ?? 0)
  return { words, minutes: readingMinutes(words) }
}

/** Words in the selection, or null for a caret (an empty selection). */
export function selectionWords(state) {
  const { from, to, empty } = state.selection
  return empty ? null : wordsBetween(state.doc, from, to)
}

const fmt = new Intl.NumberFormat('en-US')
const plural = (n, one, many) => `${fmt.format(n)} ${n === 1 ? one : many}`

/** The readout, in words: "1,204 words · 5 min read", or the selection's share. */
export function statsLabel({ words, minutes }, selected = null) {
  if (selected != null) return `${fmt.format(selected)} of ${plural(words, 'word', 'words')} selected`
  if (!words) return 'No words yet'
  return `${plural(words, 'word', 'words')} · ${minutes} min read`
}

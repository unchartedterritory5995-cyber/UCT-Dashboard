/**
 * Finish program, lane AI-FE (K3) -- the model's inline emphasis in an Ask answer.
 *
 * The model writes Markdown bold and italic (`**Planned entry:**`). The Ask panel and the block
 * inserted into a note both showed the asterisks as text. This file is the ONE reading of them,
 * used by both surfaces (AskPanel.jsx renders `<strong>` / `<em>` around plain text;
 * askInsert.js writes the editor's own `bold` / `italic` marks), so the panel and the note
 * cannot disagree about what was emphasised.
 *
 * Bold and italic only, with asterisks only:
 *   `*x*` italic, `**x**` bold, `***x***` both.
 * Underscores are never read (snake_case, file names). Nothing here produces HTML: the output
 * is plain strings plus two booleans.
 *
 * A pair is read ONLY when it is unmistakable. Anything else stays exactly as written:
 *   - the same number of asterisks opens and closes it, on ONE line;
 *   - the text inside starts and ends with a non-space and holds no asterisk;
 *   - the opening marker is not glued to a letter, digit or asterisk before it, and the closing
 *     marker is not glued to one after it (so `5*3*2`, `4%**`, a `* bullet` and a lone `*`
 *     footnote are left alone).
 * An unclosed pair in an answer that is still streaming therefore shows its asterisks until the
 * closing marker arrives.
 *
 * ⛔ No lookbehind in the pattern: the declared floor is iOS 16, and a lookbehind in a regex
 * literal is a syntax error before Safari 16.4 -- it would take the whole chunk down. The
 * character before a match is checked by hand.
 *
 * Citations: `styledParts` starts from `splitAnswer` (askCitation.js), which stays the only
 * authority on which `[n]` is a citation. A citation part passes through untouched. Emphasis
 * that runs across a citation hides both markers and styles the text on either side.
 */
import { splitAnswer } from './askCitation'

const PAIR_RE = /(\*{1,3})([^\s*](?:[^*\n]*?[^\s*])?)\1/g
const GLUED_RE = /[\p{L}\p{N}*]/u

/**
 * The answer as runs of characters to SHOW, in order. Marker characters are in no run.
 * @returns {Array<{start: number, end: number, bold: boolean, italic: boolean}>}
 */
export function emphasisRuns(answer) {
  const text = answer || ''
  const runs = []
  let plainFrom = 0
  let scanFrom = 0
  PAIR_RE.lastIndex = 0
  for (;;) {
    PAIR_RE.lastIndex = scanFrom
    const m = PAIR_RE.exec(text)
    if (!m) break
    const n = m[1].length
    const end = m.index + m[0].length
    const before = m.index > 0 ? text[m.index - 1] : ''
    const after = end < text.length ? text[end] : ''
    if ((before && GLUED_RE.test(before)) || (after && GLUED_RE.test(after))) {
      scanFrom = m.index + 1          // not a clean pair: look again one character on
      continue
    }
    if (m.index > plainFrom) runs.push({ start: plainFrom, end: m.index, bold: false, italic: false })
    runs.push({ start: m.index + n, end: end - n, bold: n >= 2, italic: n === 1 || n === 3 })
    plainFrom = end
    scanFrom = end
  }
  if (plainFrom < text.length) runs.push({ start: plainFrom, end: text.length, bold: false, italic: false })
  return runs
}

/**
 * `splitAnswer`'s parts, with each text part cut at the emphasis boundaries and the markers
 * removed. A citation part is returned as `splitAnswer` gave it.
 * @returns {Array<{text: string, source?: object, bold?: boolean, italic?: boolean}>}
 */
export function styledParts(answer, sources) {
  const text = answer || ''
  const runs = emphasisRuns(text)
  const out = []
  let offset = 0
  let r = 0
  for (const part of splitAnswer(text, sources)) {
    const from = offset
    const to = offset + part.text.length
    offset = to
    if (part.source) { out.push(part); continue }
    while (r < runs.length && runs[r].end <= from) r += 1
    for (let i = r; i < runs.length && runs[i].start < to; i += 1) {
      const a = Math.max(runs[i].start, from)
      const b = Math.min(runs[i].end, to)
      if (b > a) out.push({ text: text.slice(a, b), bold: runs[i].bold, italic: runs[i].italic })
    }
  }
  return out
}

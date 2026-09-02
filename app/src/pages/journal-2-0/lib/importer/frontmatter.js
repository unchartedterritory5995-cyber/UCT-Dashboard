/**
 * Shared YAML front-matter parsing for markdown-based adapters.
 *
 * A `--- ... ---` block anchored at byte 0 is a near-universal markdown
 * convention (Jekyll, Hugo, Obsidian, Bear, and plenty of hand-authored
 * vaults all use it) — not something specific to any one source platform.
 * It used to live only inside the Obsidian adapter (only Obsidian vaults
 * would ever have front matter, or so the assumption went); in fact ANY
 * dropped markdown file can carry it, including our own export and any
 * generic pile of .md files a member drops in. Both `generic.js` and
 * `obsidian.js` call this so the parsing (and its bugs, and its fixes)
 * exist in exactly one place.
 */

export const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

/**
 * Splits a YAML flow-sequence's inner text (the part between `[` and `]`,
 * or a bare comma-separated scalar list with no brackets at all) on
 * top-level commas — commas INSIDE a single- or double-quoted item are not
 * delimiters. A naive `.split(',')` mis-splits a correctly-quoted item like
 * `"reclaim, tight"` into two items at the comma inside the quotes (this
 * exact bug shipped in the Obsidian adapter's tag parsing).
 */
export function splitFlowSequence(inner) {
  const items = []
  let cur = ''
  let quote = null // '"' | "'" | null
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i]
    if (quote) {
      if (c === '\\' && quote === '"' && i + 1 < inner.length) {
        // A backslash escape is only meaningful inside a double-quoted
        // scalar (YAML single-quoted scalars escape a quote by doubling
        // it, handled by unquoteYamlScalar below, not here). Consume both
        // characters now so the escaped char can never be misread as the
        // one that closes the quote (e.g. a literal `\"` mid-string).
        cur += c + inner[i + 1]
        i += 1
        continue
      }
      cur += c
      if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      cur += c
      continue
    }
    if (c === ',') {
      items.push(cur.trim())
      cur = ''
      continue
    }
    cur += c
  }
  if (cur.trim()) items.push(cur.trim())
  return items.filter(Boolean)
}

/**
 * Unquotes + unescapes one YAML scalar (plain, single-quoted, or
 * double-quoted). The double-quoted branch mirrors `_yaml_scalar`'s
 * encoder in `api/services/journal_two/notes_export.py` closely enough to
 * round-trip our own export's escaping, and is otherwise just standard
 * YAML scalar syntax any other front matter would use too.
 */
export function unquoteYamlScalar(s) {
  if (!s) return s
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    return s.slice(1, -1).replace(/\\(.)/g, (_, ch) => {
      if (ch === 'n') return '\n'
      if (ch === 'r') return '\r'
      if (ch === 't') return '\t'
      return ch // handles \\ -> \ and \" -> ", falls back to literal otherwise
    })
  }
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) {
    return s.slice(1, -1).replace(/''/g, "'")
  }
  return s
}

const KEY_RE = /^([A-Za-z0-9_-]+):\s*(.*)$/

/**
 * Parses a frontmatter block's inner text (the text between the `---`
 * delimiters) into `{ fields, tags }`.
 *  - `tags` is always an array (possibly empty), handling all three forms
 *    real front matter uses: a bracketed flow sequence (`tags: [a, "b, c"]`),
 *    a bare comma-separated scalar (`tags: a, b`), or a YAML block sequence
 *    (`tags:` followed by `  - a` / `  - b` lines).
 *  - `fields` maps every other `key: value` line's lowercased key to its
 *    unquoted scalar string. Unrecognized keys are kept (and simply never
 *    read by a caller that doesn't ask for them) rather than dropped here —
 *    the "which keys matter" decision belongs to each adapter, not this
 *    shared parser.
 */
export function parseFrontmatterBlock(block) {
  const lines = block.split(/\r?\n/)
  const fields = {}
  let tags = []

  for (let i = 0; i < lines.length; i++) {
    const m = KEY_RE.exec(lines[i])
    if (!m) continue
    const key = m[1].toLowerCase()
    const rawValue = m[2].trim()

    if (key === 'tags') {
      if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
        tags = splitFlowSequence(rawValue.slice(1, -1)).map(unquoteYamlScalar).filter(Boolean)
      } else if (rawValue) {
        tags = splitFlowSequence(rawValue).map(unquoteYamlScalar).filter(Boolean)
      } else {
        // YAML block-sequence form: `tags:` followed by `  - item` lines.
        const collected = []
        let j = i + 1
        while (j < lines.length && /^\s*-\s+/.test(lines[j])) {
          collected.push(unquoteYamlScalar(lines[j].replace(/^\s*-\s+/, '').trim()))
          j++
        }
        tags = collected.filter(Boolean)
        i = j - 1
      }
      continue
    }

    if (rawValue) fields[key] = unquoteYamlScalar(rawValue)
  }

  return { fields, tags }
}

/**
 * Extracts a `--- ... ---` frontmatter block anchored at byte 0 (the `^`
 * anchor with no 'm' flag matches only the very start of the string).
 * Returns `{ fields, tags, body }` — `body` is the file text with the
 * frontmatter block (delimiters included) removed. Absent frontmatter
 * yields `{ fields: {}, tags: [], body: text }` — callers can always
 * destructure the same shape whether or not a block was present.
 */
export function extractFrontmatter(text) {
  const match = FRONTMATTER_RE.exec(text)
  if (!match) return { fields: {}, tags: [], body: text }
  const { fields, tags } = parseFrontmatterBlock(match[1])
  return { fields, tags, body: text.slice(match[0].length) }
}

/**
 * Merges front-matter `created`/`date` and `updated`/`modified` fields with
 * the vfile's own `lastModified` timestamp — front matter wins when
 * present (it's the note's REAL authored/edited time; `lastModified` is
 * only ever the zip entry's mtime, which for an exported note is whenever
 * the export ran, not whenever the note was last edited). Omits a key
 * entirely (rather than emitting `undefined`) when neither source can
 * supply it, so a doc with no derivable dates carries no date keys at all —
 * matching the pre-existing `datesFromLastModified` contract both adapters
 * already relied on.
 */
export function frontmatterDates(fields, lastModified) {
  const base =
    lastModified == null
      ? {}
      : { createdAt: new Date(lastModified).toISOString(), updatedAt: new Date(lastModified).toISOString() }
  const createdAt = fields.created || fields.date || base.createdAt
  const updatedAt = fields.updated || fields.modified || base.updatedAt
  const out = {}
  if (createdAt !== undefined) out.createdAt = createdAt
  if (updatedAt !== undefined) out.updatedAt = updatedAt
  return out
}

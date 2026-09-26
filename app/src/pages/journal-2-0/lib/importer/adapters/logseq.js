/**
 * Logseq adapter (wave 10, lane 10B, ruling R-18).
 *
 * A file-based Logseq graph is, like an Obsidian vault, a folder already on
 * the member's disk: `pages/*.md`, `journals/YYYY_MM_DD.md`, `assets/`, and
 * Logseq's own `logseq/` housekeeping directory (`config.edn`, `custom.css`,
 * `bak/`, `version-files/`). There is no export step.
 *
 * ⛔ Why an adapter: dropped as-is, that folder used to land on the Obsidian
 * adapter (its `[[` content heuristic), which imports EVERY `.md` it sees --
 * including `logseq/bak/**` and `logseq/version-files/**`, Logseq's own
 * backup copies -- so a member got each page two or three times. It also
 * left Logseq's `key:: value` property lines as literal text, `TODO` /
 * `DONE` as words instead of checkboxes, and titled every journal
 * `2026_09_22`.
 *
 * Detection: 0.95 when `logseq/config.edn` is present (Logseq writes it on
 * every graph). Registered AFTER the Obsidian adapter, so a folder carrying
 * BOTH `.obsidian/` and `logseq/` (one folder opened in both apps) still
 * ties to Obsidian, whose behaviour is unchanged.
 *
 * Parse = a Logseq pre-pass, then the Obsidian adapter's own parse over the
 * rewritten text (one wiki-link / embed / media implementation, not two):
 *  - only `pages/` and `journals/` notes are read; `logseq/` housekeeping and
 *    `.recycle/` (Logseq's deleted pages) are skipped silently;
 *  - page properties (`title::`, `tags::`, `alias::` in the leading lines)
 *    feed the title and tags; EVERY `key:: value` line is then removed;
 *  - `TODO` / `DOING` / `NOW` / `LATER` / `WAIT` / `WAITING` / `IN-PROGRESS`
 *    bullets become unticked task items, `DONE` ticked;
 *  - a journal's title is its date (`2026-09-22`) and so is its createdAt;
 *  - `[[Page]]` links are resolved against Logseq's own naming -- a page's
 *    `title::`, its decoded file name (`Setups___VCP.md` / `Setups%2FVCP.md`
 *    is `Setups/VCP`), its aliases, and a journal's default label
 *    (`Sep 22nd, 2026`) -- and handed to the Obsidian pass as a path link.
 * Import keys, and the link targets inside bodies, are `logseq:<path>`.
 */

import { obsidianAdapter } from './obsidian'
import { reportIgnoredFiles } from './reportIgnored'

const CONFIG_RE = /(^|\/)logseq\/config\.edn$/i
const NOTE_RE = /^(pages|journals)\/.+\.md$/i
const JOURNAL_RE = /^journals\/(\d{4})_(\d{2})_(\d{2})\.md$/i
const HOUSEKEEPING_RE = /^(logseq|\.recycle)\//i
const PROPERTY_RE = /^\s*(?:[-*+]\s+)?([A-Za-z][A-Za-z0-9_-]*)::(?:\s+(.*))?\s*$/
const FENCE_RE = /^\s*(```|~~~)/
const OPEN_TASK_RE = /^(\s*[-*+]\s+)(?:TODO|DOING|NOW|LATER|WAIT|WAITING|IN-PROGRESS)\s+/
const DONE_TASK_RE = /^(\s*[-*+]\s+)DONE\s+/
const LINK_RE = /\[\[([^\]|]+)\]\]/g
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export const logseqAdapter = {
  id: 'logseq',
  label: 'Logseq',
  detect,
  parse,
}

function detect(vfiles) {
  return vfiles.some((v) => CONFIG_RE.test(v.path)) ? 0.95 : 0
}

/**
 * @param {import('../intake').VFile[]} vfiles
 * @param {{onProgress?: (p: {phase: string, done: number, total: number}) => void}} [opts]
 * @returns {Promise<{docs: object[], warnings: string[]}>}
 */
async function parse(vfiles, opts = {}) {
  const config = vfiles.find((v) => CONFIG_RE.test(v.path))
  const root = config ? config.path.slice(0, config.path.length - 'logseq/config.edn'.length) : ''
  const rel = (p) => (p.startsWith(root) ? p.slice(root.length) : null)

  const noteFiles = vfiles.filter((v) => {
    const r = rel(v.path)
    return r !== null && NOTE_RE.test(r)
  })
  const assetFiles = vfiles.filter((v) => {
    const r = rel(v.path)
    return r !== null && /^assets\//i.test(r)
  })

  // Pass 1: read every note, its page properties, and the names it answers to.
  const notes = []
  const byName = new Map()
  const addName = (name, path) => {
    const key = String(name || '').trim().toLowerCase()
    if (key && !byName.has(key)) byName.set(key, path)
  }
  for (const v of noteFiles) {
    const text = (await readText(v)).replace(/\r\n?/g, '\n')
    const props = pageProperties(text)
    const r = rel(v.path)
    const journal = JOURNAL_RE.exec(r)
    const fileName = decodePageName(stripExt(basename(v.path)))
    let title
    let date = null
    if (journal) {
      const [, y, m, d] = journal
      date = { y: Number(y), m: Number(m), d: Number(d) }
      title = props.title || `${y}-${m}-${d}`
      addName(journalLabel(date), v.path)
      addName(`${y}-${m}-${d}`, v.path)
    } else {
      title = props.title || fileName
    }
    addName(title, v.path)
    addName(fileName, v.path)
    for (const a of props.alias) addName(a, v.path)
    notes.push({ vfile: v, text, props, title, date, journal: Boolean(journal) })
  }

  // Pass 2: rewrite each note into text the Obsidian pass reads correctly.
  const synthetic = notes.map((n) => {
    const out = rewriteNote(n.text, byName)
    const bytes = new TextEncoder().encode(out)
    return { path: n.vfile.path, size: bytes.length, lastModified: n.vfile.lastModified, bytes: async () => bytes }
  })
  const handed = [...synthetic, ...assetFiles]
  const result = await obsidianAdapter.parse(handed, opts)

  // The Obsidian pass reports what IT did not consume under its own label;
  // recompute that exact warning and replace it with this adapter's own.
  const consumed = new Set(noteFiles.map((v) => v.path))
  for (const doc of result.docs) for (const m of doc.media || []) consumed.add(m.ref)
  const obsidianIgnored = handed.filter((v) => !consumed.has(v.path))
  const obsidianNotice = new Set(reportIgnoredFiles(obsidianIgnored, obsidianAdapter.label))
  const warnings = result.warnings.filter((w) => !obsidianNotice.has(w))

  const meta = new Map(notes.map((n) => [n.vfile.path, n]))
  const docs = result.docs.map((doc) => {
    const path = doc.importKey.replace(/^obsidian:/, '')
    const n = meta.get(path)
    const out = {
      ...doc,
      importKey: `logseq:${path}`,
      html: String(doc.html || '').replace(/data-import-link="obsidian:/g, 'data-import-link="logseq:'),
      links: (doc.links || []).map((l) => ({ ...l, targetKey: String(l.targetKey).replace(/^obsidian:/, 'logseq:') })),
      folderPath: n?.journal ? ['Journals'] : [],
    }
    if (n) {
      out.title = n.title
      out.tags = [...new Set([...(doc.tags || []), ...n.props.tags])]
      if (n.date) {
        // A journal's date IS when it was written; anchored at noon ET
        // (16:00Z) so no time zone moves it to a neighbouring day.
        out.createdAt = new Date(Date.UTC(n.date.y, n.date.m - 1, n.date.d, 16, 0, 0)).toISOString()
      }
    }
    return out
  })

  const ignored = vfiles.filter((v) => {
    if (consumed.has(v.path)) return false
    const r = rel(v.path)
    if (r !== null && HOUSEKEEPING_RE.test(r)) return false
    return true
  })
  warnings.push(...reportIgnoredFiles(ignored, logseqAdapter.label))
  return { docs, warnings }
}

// ---------------------------------------------------------------------------
// the Logseq pre-pass
// ---------------------------------------------------------------------------

/** The page properties in a note's leading lines (before the first ordinary line). */
export function pageProperties(text) {
  const props = { title: '', tags: [], alias: [] }
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    const m = PROPERTY_RE.exec(line)
    if (!m) break
    const key = m[1].toLowerCase()
    const value = (m[2] || '').trim()
    if (key === 'title') props.title = value
    else if (key === 'tags') props.tags = splitRefs(value)
    else if (key === 'alias') props.alias = splitRefs(value)
  }
  return props
}

function splitRefs(value) {
  return value
    .split(',')
    .map((s) => s.trim().replace(/^#/, '').replace(/^\[\[/, '').replace(/\]\]$/, '').trim())
    .filter(Boolean)
}

/** Property lines out, task markers to checkboxes, `[[Page]]` to a path link -- never inside code fences. */
export function rewriteNote(text, byName) {
  const out = []
  let inFence = false
  for (const line of text.split('\n')) {
    if (FENCE_RE.test(line)) {
      inFence = !inFence
      out.push(line)
      continue
    }
    if (inFence) {
      out.push(line)
      continue
    }
    if (PROPERTY_RE.test(line)) continue
    let l = line.replace(OPEN_TASK_RE, '$1[ ] ').replace(DONE_TASK_RE, '$1[x] ')
    l = l.replace(LINK_RE, (whole, target) => {
      const path = byName.get(target.trim().toLowerCase())
      if (!path) return whole
      return `[[${stripExt(path)}|${target.trim()}]]`
    })
    out.push(l)
  }
  return out.join('\n')
}

/** `Setups___VCP` and `Setups%2FVCP` are both the page `Setups/VCP`. */
export function decodePageName(name) {
  let s = String(name).replace(/___/g, '/')
  try {
    s = decodeURIComponent(s)
  } catch {
    // a stray `%` that is not an escape stays as written
  }
  return s
}

/** Logseq's default journal title, e.g. `Sep 22nd, 2026`. */
export function journalLabel({ y, m, d }) {
  const suffix = d % 10 === 1 && d !== 11 ? 'st' : d % 10 === 2 && d !== 12 ? 'nd' : d % 10 === 3 && d !== 13 ? 'rd' : 'th'
  return `${MONTHS[m - 1]} ${d}${suffix}, ${y}`
}

// ---------------------------------------------------------------------------
// small helpers (self-contained per adapter, matching the existing pattern)
// ---------------------------------------------------------------------------

async function readText(vfile) {
  const bytes = await vfile.bytes()
  return new TextDecoder('utf-8').decode(bytes)
}

function basename(path) {
  return path.split('/').pop()
}

function stripExt(path) {
  const slash = path.lastIndexOf('/')
  const idx = path.lastIndexOf('.')
  return idx > slash + 1 ? path.slice(0, idx) : path
}

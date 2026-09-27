/**
 * Google Keep adapter (wave 10, lane 10B, ruling R-18).
 *
 * Keep has no export of its own; Google Takeout is the documented route
 * (takeout.google.com -> Deselect all -> Keep). Takeout writes, per note, a
 * `<name>.json` carrying the note's real structure AND a `<name>.html`
 * rendering of the same note, beside `Labels.txt` and any attachments, under
 * `Takeout/Keep/`.
 *
 * ⛔ Why this is an adapter and not "the generic path": the generic adapter
 * would import the `.html` twins, and they carry none of what makes a Keep
 * note a Keep note -- a checklist's ticked state, the labels, the created /
 * edited times -- and, worse, Takeout exports TRASHED notes too, with nothing
 * in the HTML saying so. The generic path imports a member's trash as live
 * notes. The JSON says `isTrashed`, so this adapter reads the JSON, skips the
 * trash and says how many it skipped.
 *
 * Detection: 0.9 for a `.json` under a `Keep/` directory (Takeout's own
 * layout), else 0.9 when a sampled `.json` is Keep-shaped (a member who drops
 * the files out of the folder). A JSON that is not Keep-shaped is never read
 * as a note -- it is reported as not imported, like any foreign file.
 *
 * Parse, per Keep-shaped JSON (not trashed):
 *  - title: the note's own title, else its first line / first list item,
 *    else the file name;
 *  - body: `textContent` as escaped paragraphs, or `listContent` as a task
 *    list in the same `contains-task-list` shape markdown-it writes, so
 *    `convert.js::mapCheckboxLists` turns it into ticked / unticked taskItems;
 *  - `labels[].name` -> tags; `createdTimestampUsec` / `userEditedTimestampUsec`
 *    -> createdAt / updatedAt;
 *  - `attachments[].filePath` -> media (an image inline, anything else an
 *    attachment chip), resolved beside the JSON. Takeout sometimes names the
 *    file with a different image extension than the JSON records (`.jpeg` vs
 *    `.jpg`); a same-stem image beside it is accepted;
 *  - `annotations` of source WEBLINK -> a link paragraph (http/https only).
 * The `.html` twin of every note and `Labels.txt` are consumed, never
 * reported as ignored -- they are Takeout's own copies of what the JSON says.
 */

import { reportIgnoredFiles } from './reportIgnored'

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|heic)$/i
const KEEP_DIR_JSON_RE = /(^|\/)Keep\/[^/]+\.json$/i
const SAMPLE_LIMIT = 20
const SAMPLE_MAX_BYTES = 256 * 1024
const TITLE_MAX = 80

export const keepAdapter = {
  id: 'keep',
  label: 'Google Keep',
  detect,
  parse,
}

// ---------------------------------------------------------------------------
// detection
// ---------------------------------------------------------------------------

function detect(vfiles) {
  if (vfiles.some((v) => KEEP_DIR_JSON_RE.test(v.path))) return 0.9
  return detectByContent(vfiles)
}

async function detectByContent(vfiles) {
  const candidates = vfiles
    .filter((v) => /\.json$/i.test(v.path) && v.size <= SAMPLE_MAX_BYTES)
    .slice(0, SAMPLE_LIMIT)
  for (const v of candidates) {
    try {
      if (isKeepNote(JSON.parse(await readText(v)))) return 0.9
    } catch {
      // An unreadable or non-JSON sample is not a verdict; never reject.
    }
  }
  return 0
}

/** A Keep note carries its text or its list AND a Keep timestamp. */
export function isKeepNote(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false
  const hasBody = 'textContent' in obj || 'listContent' in obj
  const hasStamp = 'userEditedTimestampUsec' in obj || 'createdTimestampUsec' in obj
  return hasBody && hasStamp
}

// ---------------------------------------------------------------------------
// parse
// ---------------------------------------------------------------------------

/**
 * @param {import('../intake').VFile[]} vfiles
 * @param {{onProgress?: (p: {phase: string, done: number, total: number}) => void}} [opts]
 * @returns {Promise<{docs: object[], warnings: string[]}>}
 */
async function parse(vfiles, opts = {}) {
  const { onProgress } = opts
  const warnings = []
  const byPath = new Map(vfiles.map((v) => [v.path, v]))
  const jsons = vfiles.filter((v) => /\.json$/i.test(v.path))

  const docs = []
  const consumed = new Set()
  let trashed = 0
  let done = 0
  for (const vfile of jsons) {
    try {
      const note = JSON.parse(await readText(vfile))
      if (isKeepNote(note)) {
        consumed.add(vfile.path)
        const twin = `${stripExt(vfile.path)}.html`
        if (byPath.has(twin)) consumed.add(twin)
        if (note.isTrashed === true) {
          trashed += 1
        } else {
          const doc = makeDoc(vfile, note, byPath)
          for (const m of doc.media) consumed.add(m.ref)
          docs.push(doc)
        }
      }
    } catch (err) {
      warnings.push(`Could not import "${vfile.path}": ${err?.message || err}`)
      consumed.add(vfile.path)
    }
    done += 1
    onProgress?.({ phase: 'parsing', done, total: jsons.length })
  }

  // Takeout's label index -- its contents are already on every note as tags.
  for (const v of vfiles) if (/(^|\/)Labels\.txt$/i.test(v.path)) consumed.add(v.path)

  if (trashed) {
    warnings.push(
      `Skipped ${trashed} ${trashed === 1 ? 'note' : 'notes'} that ${trashed === 1 ? 'was' : 'were'} ` +
        "in Google Keep's trash."
    )
  }
  const ignored = vfiles.filter((v) => !consumed.has(v.path))
  warnings.push(...reportIgnoredFiles(ignored, keepAdapter.label))
  return { docs, warnings }
}

function makeDoc(vfile, note, byPath) {
  const dir = dirOf(vfile.path)
  const media = []
  const parts = []

  if (Array.isArray(note.listContent) && note.listContent.length) {
    const items = note.listContent.map((item) => {
      const checked = item?.isChecked === true ? ' checked' : ''
      return (
        `<li class="task-list-item"><input class="task-list-item-checkbox" type="checkbox"${checked} disabled> ` +
        `${escapeHtml(String(item?.text ?? ''))}</li>`
      )
    })
    parts.push(`<ul class="contains-task-list">${items.join('')}</ul>`)
  } else if (typeof note.textContent === 'string' && note.textContent.trim()) {
    parts.push(textToHtml(note.textContent))
  }

  for (const att of Array.isArray(note.attachments) ? note.attachments : []) {
    const found = findAttachment(dir, att?.filePath, byPath)
    if (!found) continue
    const name = basename(found.path)
    if (IMAGE_EXT.test(found.path)) {
      media.push({ ref: found.path, vfile: found, kind: 'image', name })
      parts.push(`<p><img src="import-ref://${escapeAttr(found.path)}"></p>`)
    } else {
      media.push({ ref: found.path, vfile: found, kind: 'file', name })
      parts.push(
        `<p><a data-type="attachmentChip" data-import-ref="${escapeAttr(found.path)}" data-name="${escapeAttr(name)}" ` +
          `href="import-ref://${escapeAttr(found.path)}">${escapeHtml(name)}</a></p>`
      )
    }
  }

  for (const ann of Array.isArray(note.annotations) ? note.annotations : []) {
    const url = String(ann?.url || '')
    if (!/^https?:\/\//i.test(url)) continue
    const text = String(ann?.title || '').trim() || url
    parts.push(`<p><a href="${escapeAttr(url)}">${escapeHtml(text)}</a></p>`)
  }

  const tags = (Array.isArray(note.labels) ? note.labels : [])
    .map((l) => String(l?.name || '').trim())
    .filter(Boolean)

  return {
    importKey: `keep:${vfile.path}`,
    title: noteTitle(note, vfile.path),
    html: parts.join('\n'),
    tags,
    folderPath: ['Google Keep'],
    media,
    links: [],
    ...keepDates(note),
  }
}

function noteTitle(note, path) {
  const own = String(note.title || '').trim()
  if (own) return own
  let first = ''
  if (Array.isArray(note.listContent) && note.listContent.length) {
    first = String(note.listContent[0]?.text || '')
  } else if (typeof note.textContent === 'string') {
    first = note.textContent.split(/\r?\n/).find((l) => l.trim()) || ''
  }
  first = first.trim()
  if (first) return first.length > TITLE_MAX ? `${first.slice(0, TITLE_MAX - 1)}…` : first
  return stripExt(basename(path))
}

function keepDates(note) {
  const out = {}
  const created = usecToIso(note.createdTimestampUsec)
  const edited = usecToIso(note.userEditedTimestampUsec)
  if (created || edited) out.createdAt = created || edited
  if (edited || created) out.updatedAt = edited || created
  return out
}

function usecToIso(usec) {
  const n = Number(usec)
  if (!Number.isFinite(n) || n <= 0) return null
  return new Date(Math.floor(n / 1000)).toISOString()
}

function findAttachment(dir, filePath, byPath) {
  const rel = String(filePath || '').trim()
  if (!rel) return null
  const exact = dir ? `${dir}/${rel}` : rel
  if (byPath.has(exact)) return byPath.get(exact)
  if (!IMAGE_EXT.test(rel)) return null
  const stem = stripExt(exact).toLowerCase()
  for (const [p, v] of byPath) {
    if (IMAGE_EXT.test(p) && stripExt(p).toLowerCase() === stem) return v
  }
  return null
}

function textToHtml(text) {
  return String(text)
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('')
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

function dirOf(path) {
  const idx = path.lastIndexOf('/')
  return idx === -1 ? '' : path.slice(0, idx)
}

function stripExt(path) {
  const slash = path.lastIndexOf('/')
  const idx = path.lastIndexOf('.')
  return idx > slash + 1 ? path.slice(0, idx) : path
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, '&quot;')
}

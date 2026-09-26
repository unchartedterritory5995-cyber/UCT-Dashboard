/**
 * UCT Notebook export adapter.
 *
 * Our own export (`api/services/journal_two/notes_export.py`) writes plain
 * markdown + YAML front matter + a relative `attachments/` tree — no
 * Evernote `.enex`, no Notion hex-suffixed filenames, no Obsidian
 * `.obsidian/` directory or `[[wiki-links]]`. Before this adapter existed
 * that meant `detectAdapter()` had nothing to recognize and fell through to
 * the generic catch-all at its flat 0.1 floor (2026-09-02 adversarial audit,
 * finding A4) — functionally survivable once `generic.js` learned to strip
 * front matter (see below), but dishonest: a member re-importing their own
 * export saw it labeled "Files (Markdown, Text, HTML, Word)" and had no way
 * to know it was recognized at all.
 *
 * Detection: `_write_notes_archive` now writes an UNCONDITIONAL manifest,
 * `UCT_NOTEBOOK_EXPORT.json`, on every export (unlike `EXPORT_ISSUES.txt`,
 * which only appears when something was skipped and so can never serve as a
 * marker). Its presence — at the archive root, or nested one level under a
 * wrapper folder if a member re-zipped an already-extracted export from
 * Finder/Explorer — scores 0.97: deterministic and unambiguous, since
 * nothing else writes a file with this exact name.
 *
 * ⛔ The marker is deliberately NOT the only way this format imports
 * correctly. A member who pulls a handful of .md files out of an export (no
 * manifest, no attachments/ tree) drops through to plain content-based
 * detection same as any other loose markdown pile — there is no second,
 * weaker "looks like ours" heuristic here, because guessing at our own
 * front-matter shape (e.g. "has both `created:` and `updated:` keys") is
 * exactly the kind of narrow, overfit signal that misfires on genuine
 * Jekyll/Hugo/Bear vaults using the same ordinary convention. That subset
 * case is covered instead by the SHARED fix: `generic.js` and `obsidian.js`
 * both strip/honor YAML front matter now (title, tags, subtitle, ticker,
 * hero image, created/updated dates) and both resolve ordinary relative
 * attachment links, so a subset import still comes back correct — just
 * unlabeled as specifically "ours."
 *
 * Parse: our export has no wiki-link syntax and only ever produces `.md`
 * notes (images/attachments are referenced, never imported as their own
 * top-level doc) — `generic.js`'s fixed front-matter + attachment handling
 * already parses this shape correctly, so this adapter is a thin wrapper
 * around it rather than a third independent implementation. The only thing
 * it adds is excluding our own two non-note files (the manifest above, and
 * `EXPORT_ISSUES.txt` when present) from being misread as notes — generic.js
 * would otherwise import `EXPORT_ISSUES.txt` as an ordinary `.txt` note
 * (correct default behavior for someone ELSE'S arbitrary notes.txt, but
 * wrong for a file we know is our own manifest text, not member content).
 *
 * ⭐ Wave 8 lane 8C: the manifest now also says WHICH format the archive is (`"format"`,
 * written only when it is not Markdown — a Markdown export's bytes never moved):
 *   · `json` — every `.json` note is read as it was stored (`../uctJson.js`): the body
 *     verbatim, its bundled attachments relinked through the importer's own attachment
 *     path, a link to another note in the same archive re-pointed at that note's new id.
 *     This is the lossless round trip (ruling D-C3).
 *   · `html` — the generic HTML path, minus the page header the exporter puts above the
 *     body (the title stays the title; the subtitle becomes the subtitle; the header is not
 *     imported as note content).
 *   · anything else, or no `format` at all — Markdown, exactly as before.
 */

import { genericAdapter } from './generic'
import { noteKeyFor, parseUctJsonNote } from '../uctJson'

const MANIFEST_RE = /(^|\/)UCT_NOTEBOOK_EXPORT\.json$/
const ISSUES_RE = /(^|\/)EXPORT_ISSUES\.txt$/i
const JSON_NOTE_RE = /\.json$/i

export const uctAdapter = {
  id: 'uct-export',
  label: 'UCT Notebook Export',
  detect,
  parse,
}

function detect(vfiles) {
  return vfiles.some((v) => MANIFEST_RE.test(v.path)) ? 0.97 : 0
}

async function readText(vfile) {
  return new TextDecoder('utf-8').decode(await vfile.bytes())
}

/** The manifest's own JSON, or null (missing or unreadable — then it is Markdown). */
async function readManifest(vfiles) {
  const m = vfiles.find((v) => MANIFEST_RE.test(v.path))
  if (!m) return null
  try {
    return JSON.parse(await readText(m))
  } catch {
    return null
  }
}

async function parse(vfiles, opts = {}) {
  const manifest = await readManifest(vfiles)
  const format = typeof manifest?.format === 'string' ? manifest.format : 'md'
  const importable = vfiles.filter((v) => !MANIFEST_RE.test(v.path) && !ISSUES_RE.test(v.path))
  if (format === 'json') return parseJsonArchive(importable, opts)
  const result = await genericAdapter.parse(importable, opts)
  if (format === 'html') result.docs.forEach(stripPageHeader)
  return result
}

async function parseJsonArchive(vfiles, { onProgress } = {}) {
  const byPath = new Map(vfiles.map((v) => [v.path, v]))
  const notes = vfiles.filter((v) => JSON_NOTE_RE.test(v.path))
  const docs = []
  const warnings = []
  let done = 0
  for (const vfile of notes) {
    try {
      docs.push(parseUctJsonNote(await readText(vfile), vfile.path, byPath))
    } catch (err) {
      warnings.push(`Could not import "${vfile.path}": ${err?.message || err}`)
    }
    done += 1
    onProgress?.({ phase: 'parsing', done, total: notes.length })
  }
  // A link to a note that came in with this same import is re-pointed after the confirm
  // (`commit.js::rewriteBody`); `links` is what tells the commit a body has one.
  const arriving = new Set(docs.map((d) => d.importKey))
  for (const doc of docs) {
    doc.links = [...new Set(doc.noteLinkIds.map(noteKeyFor).filter((k) => arriving.has(k)))]
    delete doc.noteLinkIds
  }
  return { docs, warnings }
}

/** An exported web page, minus its page header: the header's title is already the note's
 *  title (the generic path reads the first heading), its subtitle becomes the subtitle, and
 *  none of it is imported as body text. A file that is not one of our pages is untouched. */
function stripPageHeader(doc) {
  if (typeof doc.html !== 'string' || !doc.html.includes('uct-note-header')) return
  const dom = new DOMParser().parseFromString(doc.html, 'text/html')
  const header = dom.querySelector('header.uct-note-header')
  if (!header) return
  const subtitle = header.querySelector('.uct-note-subtitle')?.textContent?.trim()
  if (subtitle && !doc.subtitle) doc.subtitle = subtitle
  header.remove()
  const body = dom.querySelector('div.uct-note-body')
  doc.html = body ? body.innerHTML : dom.body.innerHTML
  // The hero image lived in the header: a file the body no longer names is not uploaded.
  doc.media = (doc.media || []).filter((m) => doc.html.includes(`import-ref://${m.ref}`))
}

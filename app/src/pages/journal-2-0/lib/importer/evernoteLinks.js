/**
 * Evernote note-to-note links (connector fidelity Plan B, spec E-5/E-6).
 *
 * `isEvernoteNoteHref(href)` -- is this href a link to ANOTHER EVERNOTE NOTE (as opposed to a
 * web page)? True for:
 *   - `evernote:///view/…` and `evernote://view/…`, any case (the desktop app's deep link);
 *   - `https://www.evernote.com/shard/<s>/nl/<uid>/<guid>…` (an in-app note link);
 *   - `https://www.evernote.com/shard/<s>/sh/<guid>/…` (a shared note);
 *   - `https://www.evernote.com/l/…` (a public share link);
 * with or without `www.`, over http or https. Every other evernote.com page (pricing, help,
 * the home page) is an ordinary web link.
 *
 * Created by Task 6, which marks such anchors `data-evernote-link`; Task 7 adds the by-title
 * resolution here.
 *
 * ⚠️ LIMIT: in an .enex the link's TEXT is the only title source. ENEX carries no note ids, and
 * the `evernote:///view/…` GUIDs name nothing in the export. So a link labelled "click here"
 * resolves (here, or later by the server's heal) only if exactly one Evernote note is titled
 * exactly "click here"; otherwise it stays plain text.
 */

import { neutraliseAnchor } from './linkPolicy'
import { PY_WHITESPACE_CLASS, pyStrip } from '../linkSchemes'

const APP_LINK_RE = /^evernote:\/\/\/?view\//i
const WEB_LINK_RE = /^https?:\/\/(?:www\.)?evernote\.com\/(?:shard\/[^/]+\/(?:nl|sh)\/|l\/)./i

export function isEvernoteNoteHref(href) {
  if (typeof href !== 'string') return false
  const h = href.trim()
  return APP_LINK_RE.test(h) || WEB_LINK_RE.test(h)
}

// ---------------------------------------------------------------------------
// Task 7: note links resolved BY TITLE (spec E-5, §15 Q5)
// ---------------------------------------------------------------------------

/** The key kind the server heals by title (`link_keys.EVERNOTE_TITLE_KIND`). */
export const EVERNOTE_TITLE_KIND = 'evernote-title:'

// Python's whitespace (`str.isspace`): `PY_WHITESPACE_CLASS` and `pyStrip` live in ../linkSchemes.js
// (the link policy strips hrefs with them too); the title rules below read the same class.
const PY_WHITESPACE_RUN = new RegExp(`${PY_WHITESPACE_CLASS}+`)
export { PY_WHITESPACE_CLASS, pyStrip }

/** Trim + collapse whitespace to one space; case kept. Comparison is exact on the result. */
export function normTitle(s) {
  if (typeof s !== 'string') return ''
  return s.split(PY_WHITESPACE_RUN).filter(Boolean).join(' ')
}

/** `notes.MAX_TITLE_CHARS`: the server cuts an imported title to this many CODE POINTS (a test
 *  reads the constant out of notes.py, so the two cannot drift silently). */
export const SERVER_TITLE_MAX = 300

/**
 * The text an `evernote-title:` key carries, so it heals against the title the SERVER stored:
 * `(title or "Untitled").strip()[:300]` (notes.import_confirm), then `_norm_title` (link_keys).
 * Same order: strip, cut at 300 code points (`[...s]`; `.slice` would count UTF-16 units and
 * shift the cut by one per astral character), then normalise. \u26d4 Only for the cross-import key;
 * within one import the FULL title matches (the importKey names the note).
 */
export function titleKeyText(s) {
  return normTitle([...pyStrip(s)].slice(0, SERVER_TITLE_MAX).join(''))
}

const NOTE_LINK = 'a[data-evernote-link]'

/**
 * Resolves every `a[data-evernote-link]` in every doc BY ITS TEXT against the titles of the docs
 * in this import (Evernote exports carry no note ids, so a link names its note only by title):
 *   - exactly one doc has that title -> `data-import-link="<its importKey>"`;
 *   - none -> `data-import-link="evernote-title:<titleKeyText(text)>"`, which the server heals
 *     against the member's one Evernote note of that title, now or after a later import;
 *   - two or more -> the link becomes its content, with a warning naming it. Never a guess.
 *   - no text (an image-only link) -> the link becomes its content, with a warning: there is no
 *     title to resolve by.
 * Every kept target is pushed onto `doc.links` once (`{targetKey}`).
 *
 * A doc carrying `root` (the adapter's LIVE DOM, before `liftMediaOutOfLinks`) is worked on in
 * place and its resolved anchors keep `href` + `data-evernote-link`, so the lift still moves media
 * out of them; the caller then runs `settleEvernoteLinks(root)`. A doc with only `html` is parsed,
 * resolved, settled and written back.
 */
export function resolveEvernoteLinks(docs, warnings) {
  const keysByTitle = new Map()
  for (const d of docs) {
    const t = normTitle(d.title)
    if (!t) continue
    if (!keysByTitle.has(t)) keysByTitle.set(t, [])
    keysByTitle.get(t).push(d.importKey)
  }
  for (const d of docs) {
    const live = d.root || null
    const root = live || new DOMParser().parseFromString(`<!DOCTYPE html><html><body>${d.html || ''}</body></html>`, 'text/html').body
    const anchors = [...root.querySelectorAll(NOTE_LINK)]
    if (!anchors.length) continue
    const links = Array.isArray(d.links) ? d.links : (d.links = [])
    const seen = new Set(links.map((l) => l.targetKey))
    const keep = (targetKey) => {
      if (seen.has(targetKey)) return
      seen.add(targetKey)
      links.push({ targetKey })
    }
    for (const a of anchors) {
      const text = normTitle(a.textContent)
      if (!text) {
        // Left marked: the lift (live DOM) or the settle below makes it its content.
        warnings.push(`A link to another note in "${d.title}" was kept as its content: it has no text, and Evernote links name their note only by its title.`)
        if (!live) neutraliseAnchor(a)
        continue
      }
      const keys = keysByTitle.get(text) || []
      if (keys.length > 1) {
        neutraliseAnchor(a)
        warnings.push(`Link "${text}" in "${d.title}" was kept as text: more than one note is titled "${text}".`)
        continue
      }
      const targetKey = keys.length === 1 ? keys[0] : `${EVERNOTE_TITLE_KIND}${titleKeyText(a.textContent)}`
      a.setAttribute('data-import-link', targetKey)
      keep(targetKey)
    }
    if (!live) {
      settleEvernoteLinks(root)
      d.html = root.innerHTML
    }
  }
}

/** After the lift: a resolved note link drops its `evernote:`/evernote.com href and its marker
 *  (it is a `data-import-link` now); a marked link still unresolved becomes its content. */
export function settleEvernoteLinks(root) {
  for (const a of [...root.querySelectorAll(NOTE_LINK)]) {
    if (a.hasAttribute('data-import-link')) {
      a.removeAttribute('href')
      a.removeAttribute('data-evernote-link')
    } else {
      neutraliseAnchor(a)
    }
  }
}

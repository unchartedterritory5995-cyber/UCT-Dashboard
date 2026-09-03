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
 */

import { genericAdapter } from './generic'

const MANIFEST_RE = /(^|\/)UCT_NOTEBOOK_EXPORT\.json$/
const ISSUES_RE = /(^|\/)EXPORT_ISSUES\.txt$/i

export const uctAdapter = {
  id: 'uct-export',
  label: 'UCT Notebook Export',
  detect,
  parse,
}

function detect(vfiles) {
  return vfiles.some((v) => MANIFEST_RE.test(v.path)) ? 0.97 : 0
}

async function parse(vfiles, opts = {}) {
  const importable = vfiles.filter((v) => !MANIFEST_RE.test(v.path) && !ISSUES_RE.test(v.path))
  return genericAdapter.parse(importable, opts)
}

/**
 * The words an `importNotice` block reads as — the in-note marker for anything an import
 * could not bring over ("Couldn't copy chart.png").
 *
 * ⛔⛔ ONE COPY TABLE IN TWO FILES. `NOTICE_COPY` below is the client half; the server half is
 * `NOTICE_COPY` in `api/services/journal_two/import_notice.py`. `tests/test_import_notice.py`
 * IMPORTS this module in Node and asserts the tables, the reason list, the name fallback and
 * five sample derivations are equal on both sides.
 * ⛔ KEEP THIS FILE IMPORTABLE BY PLAIN NODE: no imports at all.
 *
 * The text is DERIVED from the node's attrs on every render, never stored, so a sentence
 * changed here reaches every note that already holds a notice.
 *   · an unknown reason reads as `unsupported` — never blank, never a crash;
 *   · a hyphenated code (`too-large`, the Obsidian plan's spelling) reads as its snake_case twin;
 *   · `fetch_failed` says "retrying" while `attempts < MEDIA_RETRY_MAX_ATTEMPTS`;
 *   · `{name}` falls back to `this item` ("This item" where it opens a sentence).
 * The " — open the original" link is the RENDERER's (importNoticeNode.js), and only for an
 * http(s) `sourceUrl`.
 */

/** `truncated`: a bounded read stopped at its cap; its count rides inside the name. */
export const SERVER_REASONS = Object.freeze(['too_large', 'storage_limit', 'unsupported', 'fetch_failed', 'unsafe', 'truncated'])
/** `storage_full` (Plan B R3): a file import's storage refusal — final, nothing retries a file import. */
export const CLIENT_REASONS = Object.freeze(['upload_failed', 'type_refused', 'unresolvable_src', 'decode_failed', 'missing_resource', 'storage_full'])
/** Plan C (the Obsidian plugin), plugin-only meanings, in snake_case. */
export const PLUGIN_REASONS = Object.freeze(['obsidian_plugin_outdated', 'obsidian_attachments_unavailable', 'not_found', 'sync_off'])
export const NOTICE_REASONS = Object.freeze([...SERVER_REASONS, ...CLIENT_REASONS, ...PLUGIN_REASONS])

export const MEDIA_RETRY_MAX_ATTEMPTS = 3
export const NAME_FALLBACK = 'this item'

/** `fetch_failed_retrying` is the `fetch_failed` sentence while a retry is still due. */
export const NOTICE_COPY = Object.freeze({
  fetch_failed_retrying: "Couldn't copy {name} — retrying on the next sync",
  fetch_failed: "Couldn't copy {name}",
  too_large: '{name} is too large to copy (limit 25 MB)',
  storage_limit: 'Not copied: storage limit. {name} will be copied once space frees up',
  unsupported: "{name} can't be shown here",
  unsafe: "{name} wasn't copied: its address isn't allowed",
  truncated: 'Only {name} came over',
  upload_failed: "Couldn't upload {name}",
  type_refused: "{name} is a file type that can't be stored here",
  unresolvable_src: "Couldn't find the image file for {name}",
  decode_failed: "{name} couldn't be read",
  // Written by both the file importer and the Notion converter (a live sync has no export).
  missing_resource: "{name} couldn't be found, so it wasn't copied",
  // Plan B R3: the file importer's storage refusal — final, never "will be copied".
  storage_full: 'Not copied: storage limit. Free up space and import again to bring {name} over',
  // Plan C (Obsidian plugin) — copy verbatim from the Plan C plan.
  obsidian_plugin_outdated: "{name} wasn't synced. Update the UCT Notebook Sync plugin in Obsidian to bring images and files over.",
  obsidian_attachments_unavailable: "{name} wasn't synced yet. It will be retried on the next sync.",
  not_found: "{name} wasn't found in the vault.",
  sync_off: "{name} wasn't synced because image and file sync is turned off in the plugin settings.",
})

/** The link words the renderer appends for a safe `sourceUrl`. */
export const OPEN_ORIGINAL = 'open the original'

function reasonOf(reason) {
  const code = typeof reason === 'string' ? reason.trim().replace(/-/g, '_') : ''
  return NOTICE_REASONS.includes(code) ? code : 'unsupported'
}

function attemptsOf(value) {
  return Number.isInteger(value) && value > 0 ? value : 0
}

/**
 * `template` with `{name}` filled. A REAL name is written exactly as given (whitespace
 * collapsed), wherever it falls. The FALLBACK is capitalised where it opens a sentence (the
 * template's start, or after ". ") and stays lowercase mid-sentence: a member-facing sentence
 * never starts lowercase (controller ruling, fix round 1). The server's `_fill` is the same
 * rule; split/join, never String#replace, so a name holding `$&` reads as typed.
 */
function fillName(template, name) {
  const real = typeof name === 'string' && name.trim() ? name.trim().split(/\s+/).join(' ') : null
  const parts = template.split('{name}')
  let out = parts[0]
  for (let i = 1; i < parts.length; i += 1) {
    const before = parts[i - 1]
    if (real !== null) out += real
    else if (before === '' || before.endsWith('. ')) out += NAME_FALLBACK.charAt(0).toUpperCase() + NAME_FALLBACK.slice(1)
    else out += NAME_FALLBACK
    out += parts[i]
  }
  return out
}

/** The sentence a notice's attrs read as (without the renderer's link). */
export function importNoticeText(attrs) {
  const a = attrs && typeof attrs === 'object' && !Array.isArray(attrs) ? attrs : {}
  let code = reasonOf(a.reason)
  if (code === 'fetch_failed' && attemptsOf(a.attempts) < MEDIA_RETRY_MAX_ATTEMPTS) code = 'fetch_failed_retrying'
  return fillName(NOTICE_COPY[code], a.name)
}

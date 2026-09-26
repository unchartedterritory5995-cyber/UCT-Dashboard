// ─── ONE PLACE THAT KNOWS WHERE A PUBLISHED NOTE LIVES (wave 8 seam S8-4) ────
//
// The noteShareLink.js idiom, for publish-to-web (lane 8B): the page URL a member
// copies and the route that renders it are the SAME fact, spelled once here.
// `App.jsx` routes on PUBLISHED_ROUTE and PUBLISHED_NOTE_ROUTE; lane 8B's Publish
// door builds its copyable URL from these; PublishedPage reads PUBLISHED_ENDPOINT.
//
// ⛔⛔ PUBLISHED_PATH IS ALSO READ BY THE SERVER. `api/main.py`'s
// PUBLIC_NOTE_PATH_PREFIXES marks every SPA path under it `X-Robots-Tag: noindex,
// nofollow` + `Referrer-Policy: no-referrer`, and tests/test_public_note_headers.py
// PARSES this file to hold the two equal. Renaming it here without the server turns
// that rail red, on purpose — a published page served without noindex is the failure.
//
// ⛔ The server read (`/api/j2/published*`) is PUBLIC by design and flag-gated
// server-side (NOTEBOOK_PUBLISH_ENABLED, dark until the owner's legal sign-off,
// ruling D-B9).

/** Where published notes live in the app. */
export const PUBLISHED_PATH = '/p'

/** A publication — one note, or a folder's index — by its slug. Derived, never retyped. */
export const PUBLISHED_ROUTE = `${PUBLISHED_PATH}/:slug`

/** One note inside a published folder. `pid` is the note's id WITHIN the publication,
 *  never a member's note id (ruling D-B7: no note id leaves on a public payload). */
export const PUBLISHED_NOTE_ROUTE = `${PUBLISHED_ROUTE}/n/:pid`

/** The public read on the server. No auth: a published page is public by definition. */
export const PUBLISHED_ENDPOINT = '/api/j2/published'

/** The member's own publish doors (lane 8B, api/routers/notebook_publish.py): list, publish a
 *  note or a folder, Update, change expiry, unpublish. Session- or paid-gated server-side. */
export const PUBLISH_ENDPOINT = '/api/j2/publish'

/** In-app path of a publication (`pid` given: one note inside a published folder). */
export function publishedPath(slug, pid) {
  const s = encodeURIComponent(String(slug ?? ''))
  return pid ? `${PUBLISHED_PATH}/${s}/n/${encodeURIComponent(String(pid))}` : `${PUBLISHED_PATH}/${s}`
}

/** The absolute URL the member copies and sends to somebody else. */
export function publishedUrl(slug, pid) {
  const origin = typeof window !== 'undefined' && window.location ? window.location.origin : ''
  return `${origin}${publishedPath(slug, pid)}`
}

// ─── THE ONE PUBLISH CALL, AND THE SENTENCES AROUND IT (wave 9, lane 9D) ─────
//
// ⛔⛔ ONE HELPER, TWO DOORS (ruling D-9D2, the three-copies lesson). The editor's Share
// door (NoteShareControls) and the sidebar's folder door (PublishFolderSheet) both publish
// through `publishTarget`, read "is there already a live page?" through
// `findLivePublication`, and say what becomes public in the SAME sentences below — moved
// here from NoteShareControls, never copied. A second copy of any of them is how the two
// doors would start to disagree about what a member is agreeing to.

/** The Share door's request: the member's session, JSON either way, and the SERVER's
 *  sentence on a refusal (`err.detail`, shown as it stands) with the status beside it.
 *  Moved here from NoteShareControls with the publish call (its share-link calls use it too). */
export async function requestJson(url, opts = {}) {
  const res = await fetch(url, {
    credentials: 'include',
    ...opts,
    headers: opts.body ? { 'Content-Type': 'application/json', ...(opts.headers || {}) } : opts.headers,
  })
  let body = null
  try { body = await res.json() } catch { body = null }
  if (!res.ok) {
    const detail = body && typeof body.detail === 'string' ? body.detail : null
    const err = new Error(detail || String(res.status))
    err.detail = detail
    err.status = res.status
    throw err
  }
  return body || {}
}

/** Put `text` on the clipboard. `false` when the browser would not: the address is on
 *  screen to copy by hand, and the sentence says so. */
export async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch { /* fall through: the address is on screen to copy by hand */ }
  return false
}

/** The live page this member already has for a note or a folder, or null. `pubs` is the
 *  `publications` list `GET PUBLISH_ENDPOINT` answers. */
export function findLivePublication(pubs, kind, targetId) {
  return (pubs || []).find((p) => p.kind === kind && p.targetId === targetId && p.state === 'active') || null
}

/** The owner's publish route for a note (`kind: 'note'`) or a folder (`kind: 'folder'`). */
export function publishRoute(kind, targetId) {
  const where = kind === 'note' ? 'notes' : 'folders'
  return `${PUBLISH_ENDPOINT}/${where}/${encodeURIComponent(String(targetId ?? ''))}`
}

/**
 * Publish a note or a folder: ONE POST, never an expiry (`{expiresInDays: null}` — the page
 * is changed in Settings), answering the publication as live. The server keeps one live page
 * per target: publishing what is already published answers that page, never a second one.
 * A refusal throws `requestJson`'s error, whose `detail` is the server's own sentence.
 */
export async function publishTarget(kind, targetId) {
  const b = await requestJson(publishRoute(kind, targetId), {
    method: 'POST', body: JSON.stringify({ expiresInDays: null }),
  })
  return { ...b.publication, state: 'active' }
}

/** What a published page exposes, said before anything is published. */
export const PUBLISH_PUBLIC_SENTENCE =
  'A published page can be read by anyone with its address, without signing in. Search engines are asked not to index it.'

/** What publishing a FOLDER takes with it (the server's MEMBER_CAP is 500). */
export const FOLDER_PUBLISH_SCOPE_SENTENCE =
  'Publishes up to 500 notes in this folder and the folders inside it. A note added later appears when you update the page in Settings.'

/** The sentence when a publish is refused and the server sent none of its own. */
export const PUBLISH_FAILED_SENTENCE = 'Could not publish. Try again.'

/** After a copy: the link is on the clipboard, or the member copies it by hand. */
export function pageCopiedSentence(copied) {
  return copied ? 'Page link copied.' : 'Copy the address above.'
}

/** After a publish: "Published." for a note, `Published "<folder>".` for a folder, then
 *  what happened to the link. */
export function publishedSentence(folderName, copied) {
  const what = folderName == null ? 'Published' : `Published "${folderName}"`
  return `${what}. ${pageCopiedSentence(copied)}`
}

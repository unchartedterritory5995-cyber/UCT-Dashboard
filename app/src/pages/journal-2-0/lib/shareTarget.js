// ⛔ THE MOBILE CAPTURE DOOR (Wave L Slice 4 §1).
//
// A phone share sheet hands us three strings and nothing else. This module is
// the only place that decides what those three strings MEAN, so the landing
// page stays a door — it chooses defaults, it does not own semantics — exactly
// like every other door since Slice 2.
//
// ⛔⛔ THE METHOD IS `GET`, AND THAT IS A LOAD-BEARING DECISION, NOT A DEFAULT.
// A `POST` share target is delivered to the page through a service worker
// `fetch` handler — it cannot work without one. `app/public/sw.js` is a
// deliberate KILL SWITCH (2026-04-26): the previous cache-first worker served
// stale JS/CSS bundles indefinitely after every Railway deploy, making shipped
// code invisible to existing members until they cleared site data by hand. It
// now installs, deletes every cache, unregisters itself, and has NO fetch
// handler on purpose. Choosing POST here would mean reintroducing one, and the
// outage class with it, to gain nothing this door needs: GET carries title,
// text and url perfectly well. `shareTarget.contract.test.js` fails if either
// half of that pair moves — the method, or the worker's fetch handler.
//
// ⭐ WHY THIS IS THE COMPETITIVE WIN (entry checkpoint §5). Obsidian's clipper
// cannot capture where the app is not installed and running locally. UCT's
// destination is server-side, so a capture made on a phone is already on the
// desktop before the member sits down.

/** The route the manifest points its share target at. Declared once. */
export const SHARE_ROUTE = '/journal/share'

/** ⛔ THE SINGLE AUTHORITY over the share parameter names. `manifest.json` is a
 *  static file that cannot import this, so the rail asserts the two AGREE
 *  rather than letting each state the names independently — a value with two
 *  authorities drifts, and here the drift is silent: the share sheet would hand
 *  us fields under names nothing reads, and the door would open blank. */
export const SHARE_PARAMS = { title: 'title', text: 'text', url: 'url' }

/** @see the header. Changing this to POST requires a service worker. */
export const SHARE_METHOD = 'GET'

/** Survives the sign-in round trip (§4). Session-scoped and consumed exactly
 *  once — a shared article is not something to leave lying in storage. */
export const PENDING_SHARE_KEY = 'uct.pendingShare.v1'

const URL_RE = /https?:\/\/[^\s<>"']+/gi

/** Trailing punctuation a human sentence leaves on a pasted link. Kept
 *  conservative: `)` is NOT stripped, because it is legal and common inside
 *  real URLs (Wikipedia disambiguation being the obvious case). */
function trimUrlTail(u) {
  return u.replace(/[.,;:!?'"]+$/, '')
}

/**
 * Every http(s) URL in a blob of text, in order.
 *
 * ⭐ THIS EXISTS BECAUSE THE `url` FIELD IS OFTEN EMPTY (§2, measured against
 * real share sheets). Chrome-on-Android sharing a page fills `url`; a great
 * many apps — news readers, Reddit, X, most messaging apps — put the link
 * INSIDE `text` and send no `url` at all. A door that only read `url` would
 * hand those members an empty dialog and look broken for the majority case.
 */
export function extractUrls(text) {
  const found = String(text || '').match(URL_RE) || []
  return found.map(trimUrlTail).filter(Boolean)
}

/** The text with `url` removed, tidied. Used only when the URL was found
 *  INSIDE the text — what remains is what the sending app wrote about it. */
function textWithoutUrl(text, url) {
  if (!url) return String(text || '').trim()
  return String(text || '')
    .replace(url, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

/**
 * Turn one share payload into the door's opening context.
 *
 * ⛔⛔ THE PROVENANCE RULING (§3), and it is the whole reason this function is
 * not two lines. There are two genuinely different payloads:
 *
 *   WITH a URL — the text is material FROM that source. It prefills the
 *   `passage` field, which is the member's act of quoting: byte-for-byte the
 *   same object a PDF excerpt already is, and citable because there is a URL to
 *   cite. Source mode.
 *
 *   WITHOUT a URL — there is no citable source and therefore NO document can
 *   exist; the web write path requires a URL and refuses without one. So this
 *   CANNOT be stored as a passage no matter how external its origin was. It
 *   opens in thought mode with the text prefilled, and the dialog's own
 *   "Saving something from the web? Capture a source" switch is one tap away.
 *
 * ⛔ The second case is NOT a claim that the member wrote it. It is the door
 * declining to decide: the dialog OFFERS both readings and the member's own
 * Save settles provenance — the identical ruling Slice 2b made for typed text
 * that looks like a link (`looksLikeUrl` offers, never switches). Silently
 * filing a URL-less share as a source would manufacture provenance; silently
 * asserting the member authored it would be the mirror lie. Only the member can
 * answer, so only the member is asked.
 */
export function parseShare({ title = '', text = '', url = '' } = {}) {
  const cleanTitle = String(title || '').trim()
  const cleanText = String(text || '').trim()
  const given = String(url || '').trim()

  // An explicit `url` field always wins — it is the sending app telling us
  // exactly what it shared, rather than us inferring it from prose.
  const inText = extractUrls(cleanText)
  const resolved = given || inText[0] || ''

  if (!resolved) {
    // No source to cite. Title and text are joined only when the title adds
    // something — a share whose text already starts with the title (common)
    // must not arrive duplicated.
    const parts = []
    if (cleanTitle && !cleanText.startsWith(cleanTitle)) parts.push(cleanTitle)
    if (cleanText) parts.push(cleanText)
    return { kind: 'thought', url: '', title: '', passage: '', thought: parts.join('\n\n') }
  }

  // The passage is what the sending app said ABOUT the link, never the link.
  const remainder = given ? cleanText : textWithoutUrl(cleanText, inText[0])
  // A "passage" identical to the title is the share sheet repeating itself, not
  // a quotation — keeping it would fabricate a quote the member never selected.
  const passage = remainder && remainder !== cleanTitle ? remainder : ''

  return { kind: 'source', url: resolved, title: cleanTitle, passage, thought: '' }
}

/** Read one share payload out of a query string. */
export function shareFromSearch(search) {
  const p = new URLSearchParams(search || '')
  return parseShare({
    title: p.get(SHARE_PARAMS.title) || '',
    text: p.get(SHARE_PARAMS.text) || '',
    url: p.get(SHARE_PARAMS.url) || '',
  })
}

/** Did the share sheet actually give us anything? An empty invocation opens a
 *  blank capture rather than erroring — that is still a usable outcome. */
export function shareIsEmpty(share) {
  return !share || (!share.url && !share.passage && !share.thought && !share.title)
}

// ── Carrying the share to the dialog (§4) ────────────────────────────────────
//
// ⛔ THE DEFECT THIS EXISTS TO PREVENT, and it is not hypothetical: `AuthGuard`
// redirects an unauthenticated visitor with `<Navigate to="/login" replace />`
// and NO record of where they were going. A member whose session lapsed —
// overwhelmingly likely on a phone that has not opened UCT in weeks, which is
// exactly the population this door is for — would share an article, be bounced
// to sign in, and land on the dashboard with the article gone. App.jsx already
// records this same class being fixed once for `/calendar?earnings=NVDA`.
//
// ⛔⛔ AND THE PAYLOAD NEVER RIDES A URL TO DO IT (privacy gate, 2026-09-08).
// The first version put the whole share into `/login?next=/journal/share?text=…`,
// duplicating the member's prose into a second request, the login page's address
// bar, and browser history. **It also never worked**: the only consumer,
// `takePendingShare`, read sessionStorage, so in the storage-blocked browser
// that carrier existed for, the payload arrived back on this page and died
// there — no capture was ever produced. It was privacy cost with no benefit.
//
// The two carriers that actually work are both in-process:
//   MEMORY   `/journal/share` → `/journal/notebook` is a client-side route
//            change with no page load, so a module variable survives it. This
//            is the primary path and needs no storage permission at all.
//   SESSION  the sign-in round trip IS a full page load, which clears memory.
//            sessionStorage survives it, in the same tab, on the member's own
//            device — and is cleared the moment it is consumed.

let _pendingShare = null

export function writePendingShare(share) {
  // Memory first: this is what the same-tab handoff actually uses, and it works
  // in a browser that refuses storage entirely.
  _pendingShare = share || null
  try {
    sessionStorage.setItem(PENDING_SHARE_KEY, JSON.stringify(share))
    return true
  } catch {
    // Private mode, blocked storage, quota. The same-tab capture still works;
    // only the sign-in round trip cannot be carried, and the page SAYS so
    // rather than pretending or leaking the payload into a URL to cover it.
    return false
  }
}

/** Read AND clear, from both carriers. Consumed exactly once — a share that
 *  reopened every time the app mounted would be a capture the member cannot
 *  dismiss. */
export function takePendingShare() {
  const fromMemory = _pendingShare
  _pendingShare = null

  let raw = null
  try {
    raw = sessionStorage.getItem(PENDING_SHARE_KEY)
    sessionStorage.removeItem(PENDING_SHARE_KEY)
  } catch { /* storage refused; memory may still hold it */ }

  if (fromMemory) return fromMemory
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch { return null }
}

/**
 * Take the shared text out of the visible URL as soon as it has been carried.
 *
 * ⛔ WHY THIS IS NOT THE WHOLE ANSWER, and must never be described as one. It
 * removes the payload from the address bar, from browser history (Back/Forward
 * cannot resurrect it), and from the `Referer` of any same-origin request the
 * page makes AFTER this point. It does NOT reach the request that already
 * happened: the GET that delivered the share has been seen by Railway's edge
 * before our code ran, and by our own access log (redacted there separately, in
 * `api/logging_redaction.py`). See the slice doc §10 for the residual.
 */
export function scrubShareUrlFromHistory(replaceFn, search) {
  // The caller passes the ROUTER's search so this works under a MemoryRouter as
  // well as in a browser; falling back to `window` keeps it usable standalone.
  const current = search !== undefined
    ? search
    : (typeof window !== 'undefined' ? window.location.search : '')
  if (!current) return false
  try {
    if (replaceFn) replaceFn(SHARE_ROUTE, { replace: true })
    else window.history.replaceState(null, '', SHARE_ROUTE)
    return true
  } catch { return false }
}

/** The detail payload for `openCapture` — the SAME channel and the SAME shape
 *  every other door uses. The share door prefills; it adds no field of its own.
 *
 * ⛔ `destination` is deliberately context-free. A phone share knows nothing
 * about which security the member is researching, so the dialog shows its
 * destination picker rather than guessing — a fast capture to the wrong place
 * is still a bad capture (Slice 2 §4). */
export function shareCaptureDetail(share) {
  return {
    source: 'share',
    initial: share?.kind === 'source'
      ? { url: share.url || '', title: share.title || '', passage: share.passage || '' }
      : { thought: share?.thought || '' },
  }
}

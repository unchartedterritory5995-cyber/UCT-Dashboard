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
 */

const APP_LINK_RE = /^evernote:\/\/\/?view\//i
const WEB_LINK_RE = /^https?:\/\/(?:www\.)?evernote\.com\/(?:shard\/[^/]+\/(?:nl|sh)\/|l\/)./i

export function isEvernoteNoteHref(href) {
  if (typeof href !== 'string') return false
  const h = href.trim()
  return APP_LINK_RE.test(h) || WEB_LINK_RE.test(h)
}

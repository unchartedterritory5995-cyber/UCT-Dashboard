/**
 * The in-page half of "a public note is never indexed and never leaks its address"
 * (wave 8 lane 8B; finding F-IN-PAGE-META of docs/notebook/share-links-authorization-proof.md).
 *
 * The server already sends `X-Robots-Tag: noindex, nofollow` and `Referrer-Policy:
 * no-referrer` on the SPA HTML under `/share/n/` and `/p/` (api/main.py,
 * PUBLIC_NOTE_PATH_PREFIXES) and on every public API response. A copy of the HTML served
 * WITHOUT those headers (a cache, a mirror, a saved page) says nothing, so the page says it
 * too. React 19 hoists these `<meta>` elements into `document.head`.
 *
 * Rendered in EVERY state of both public pages (loading, gone, the note itself): a crawler
 * that lands on a dead link must be told not to index it just as firmly as a live one.
 */
import { brandedTitle } from '../../../surfaces/brand.js'

export const PUBLIC_ROBOTS = 'noindex, nofollow'
export const PUBLIC_REFERRER = 'no-referrer'

/**
 * ⛔ F4 / A2R-09 (WCAG 2.4.2, Page Titled): `title` names what the page shows -- the note, the
 * published folder, or the dead link's own sentence -- and becomes the tab title as
 * "<title> — UCT Intelligence". Lane 10E-2's walk found both public pages carrying the
 * marketing title ("UCT Intelligence — 10 subscriptions in 1...") whatever note was open.
 * React 19 hoists the <title> into <head> ahead of index.html's, and takes it away again
 * when the page goes. Omitted (the loading state), the tab keeps what it had.
 */
export default function PublicPageMeta({ title = null }) {
  return (
    <>
      <meta name="robots" content={PUBLIC_ROBOTS} />
      <meta name="referrer" content={PUBLIC_REFERRER} />
      {title ? <title>{brandedTitle(title)}</title> : null}
    </>
  )
}

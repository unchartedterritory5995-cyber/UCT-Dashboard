/**
 * The ONE post-parse pass every client file-import adapter's HTML goes through before
 * conversion -- connector fidelity Plan B Task 3 (spec L-3, L-4, I-1, I-6).
 *
 * `finishDoc(doc)` mutates and returns `doc`. One DOMParser parse of `doc.html`, then, in
 * this order (pinned by postParse.test.js; Task 2's carry-forward):
 *   1. `extractDataUriImages` -- a `data:` image becomes an uploadable media item;
 *   2. `collectRemoteImages` -- every other `<img>` not already ours becomes a remote item
 *      (its src goes through `resolveHref` inside that pass);
 *   3. EVERY `a[href]`: `resolveHref(href, doc.sourceUrl)`, then the kept href is written
 *      back, or `neutraliseAnchor` (null = "render as text"). ⛔ Every anchor, no
 *      exceptions: the markdown lane's link gate (adapters/generic.js) deliberately lets
 *      `[t](javascript:x)` emit an anchor, and THIS is where it becomes text;
 *   4. `liftMediaOutOfLinks` -- after step 3, so a link emptied by the lift shows its
 *      RESOLVED href, never the raw relative one;
 *   5. `linkifyTextNodes` -- last: it only makes http(s)/mailto/www hrefs, which step 3
 *      would keep anyway, and it never runs inside a, code, pre, math or raw-text elements.
 * Then `doc.html = body.innerHTML` and the new items are appended to `doc.media`, deduped
 * by `ref` (first wins: an adapter's own item beats a pass's).
 *
 * A doc whose html is a held UCT JSON body (`uctJson.js::heldBody`, our own export) is
 * skipped: its body is already a TipTap doc and the marker is not HTML to rewrite.
 *
 * `parseImport(adapter, vfiles, opts)` -- `adapter.parse`, then `finishDoc` on every doc.
 * Whatever `adapter.parse` throws propagates unchanged.
 */
import { heldBody } from './uctJson'
import { linkifyTextNodes, resolveHref, neutraliseAnchor } from './linkPolicy'
import { extractDataUriImages, collectRemoteImages, liftMediaOutOfLinks } from './mediaRefs'

export function finishDoc(doc) {
  if (heldBody(doc.html)) return doc
  const body = new DOMParser().parseFromString(`<!DOCTYPE html><html><body>${doc.html || ''}</body></html>`, 'text/html').body
  const sourceUrl = typeof doc.sourceUrl === 'string' ? doc.sourceUrl : null
  const own = Array.isArray(doc.media) ? doc.media : []
  // The passes number their refs past what they can see, so they see the adapter's items.
  const media = [...own]

  extractDataUriImages(body, media)
  collectRemoteImages(body, media, sourceUrl)
  for (const a of [...body.querySelectorAll('a[href]')]) {
    const href = a.getAttribute('href')
    const resolved = resolveHref(href, sourceUrl)
    if (resolved === null) neutraliseAnchor(a)
    else if (resolved !== href) a.setAttribute('href', resolved)
  }
  liftMediaOutOfLinks(body)
  linkifyTextNodes(body)

  doc.html = body.innerHTML
  const seen = new Set()
  const merged = []
  for (const m of media) {
    if (seen.has(m.ref)) continue
    seen.add(m.ref)
    merged.push(m)
  }
  doc.media = merged
  return doc
}

export async function parseImport(adapter, vfiles, opts) {
  const result = await adapter.parse(vfiles, opts)
  for (const doc of result.docs) finishDoc(doc)
  return result
}

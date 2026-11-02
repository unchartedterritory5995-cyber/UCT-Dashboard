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
 *      back, or `neutraliseRefusedAnchor` (null = "render as text"; an empty one shows its
 *      URL, B-14). ⛔ Every anchor, no exceptions: the markdown lane's link gate (adapters/generic.js) deliberately lets
 *      `[t](javascript:x)` emit an anchor, and THIS is where it becomes text;
 *   4. `liftMediaOutOfLinks` -- after step 3, so a link emptied by the lift shows its
 *      RESOLVED href, never the raw relative one;
 *   5. `linkifyTextNodes` -- last: it only makes http(s)/mailto/www hrefs, which step 3
 *      would keep anyway, and it never runs inside a, code, pre, math or raw-text elements,
 *      nor inside the text a REFUSED link left (step 3's marker span, B-14 fix round 1),
 *      which `unwrapRefusedLinks` then unwraps.
 * Then `doc.html = body.innerHTML` and the new items are appended to `doc.media`, deduped
 * by `ref` (first wins: an adapter's own item beats a pass's).
 *
 * A doc whose html is a held UCT JSON body (`uctJson.js::heldBody`, our own export) is
 * skipped: its body is already a TipTap doc and the marker is not HTML to rewrite.
 *
 * `parseImport(adapter, vfiles, opts)` -- `adapter.parse`, then `finishDoc` on every doc,
 * `FINISH_CHUNK` at a time with a yield to the event loop between chunks; `opts.onProgress`
 * hears `{phase: 'finishing', done, total}` per chunk and `opts.isCancelled()` is asked
 * before each one. Whatever `adapter.parse` throws propagates unchanged.
 */
import { heldBody } from './uctJson'
import { linkifyTextNodes, resolveHref, neutraliseRefusedAnchor, unwrapRefusedLinks } from './linkPolicy'
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
    if (resolved === null) neutraliseRefusedAnchor(a)
    else if (resolved !== href) a.setAttribute('href', resolved)
  }
  liftMediaOutOfLinks(body)
  linkifyTextNodes(body)
  unwrapRefusedLinks(body)

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

/** Docs finished between two yields to the event loop (fix round 1: a few-thousand-note
 *  export finished in one synchronous run froze the tab). */
export const FINISH_CHUNK = 25

const yieldToLoop = () => new Promise((resolve) => setTimeout(resolve, 0))

export async function parseImport(adapter, vfiles, opts = {}) {
  const result = await adapter.parse(vfiles, opts)
  const { onProgress, isCancelled } = opts || {}
  const docs = result.docs
  for (let i = 0; i < docs.length; i += FINISH_CHUNK) {
    // Cancelled between chunks: stop finishing. The caller discards this scan anyway, so
    // half-finished docs never reach a commit; `cancelled` says so to any other caller.
    if (isCancelled?.()) return { ...result, cancelled: true }
    const end = Math.min(i + FINISH_CHUNK, docs.length)
    for (let j = i; j < end; j++) finishDoc(docs[j])
    onProgress?.({ phase: 'finishing', done: end, total: docs.length })
    if (end < docs.length) await yieldToLoop()
  }
  return result
}

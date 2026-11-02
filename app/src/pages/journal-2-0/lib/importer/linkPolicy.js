/**
 * ONE link policy for every client file-import path (Notion / Obsidian / Evernote / generic
 * exports parsed in the browser) -- connector fidelity Plan B Task 1 (spec L-3, L-4).
 *
 * ⛔ This is the client half of ONE rule. The server half is
 * `api/services/journal_two/note_connectors/convert/linkify.py` (`linkify_doc`,
 * `resolve_href`), and the two are pinned together by the shared vectors
 * `__fixtures__/linkify_vectors.json`, which `linkPolicy.test.js` and the server's
 * `test_linkify.py` both READ. Change a rule here, change it there, and add the vector.
 *
 * `linkifyTextNodes(root)` -- bare `http(s)://…`, `www.…`, `mailto:` and email addresses in
 * plain text become `<a href>`. The markdown lane's own linkify-it instance (`getLinkify`),
 * then:
 *   * keep a match only if its schema is `http:`/`https:`/`mailto:` (a bare email counts),
 *     or its schema is empty and its raw text starts with `www.` (href gets `https://`).
 *     Every other fuzzy domain is dropped: `NVDA.US`, `BRK.B`, `example.com`, `v2.3` are
 *     tickers and prose far more often than links; `ftp:` and `//` matches are dropped too;
 *   * ONE trim: cut at the first CJK/fullwidth punctuation mark or curly quote (linkify-it
 *     keeps `。` and `”` inside a path), strip trailing `.,:;!?` (linkify-it keeps a trailing
 *     `:`), and keep the result only if linkify-it matches it again as exactly one kept link
 *     spanning all of it;
 *   * never inside `a, code, pre`, math (`[data-type="inline-math"]`, `[data-type="block-math"]`,
 *     `[data-latex]`) or an attachment chip.
 *   Per DOM text node: a URL split by a `<b>` is two runs here (the server joins adjacent
 *   runs of one textblock); the vectors are single runs.
 *
 * `resolveHref(href, sourceUrl)` -- the href to keep, or `null` meaning "render as text".
 * The scheme is read the way a browser and TipTap's `isAllowedUri` read it (`hrefAsRead`):
 * `java<TAB>script:x` is `javascript:x`, never a "relative" href resolved against the source.
 * B-14: any other scheme -- and a `//host` or resolved relative href -- is kept only when
 * `../linkSchemes.js` `keptSchemeHref` gives it a door (http(s), mailto, tel, sms); the
 * shared `href_vectors` pin it to the server. A linkify match it would refuse is not made.
 *
 * `neutraliseAnchor(a)` -- replaces `a` with its children (formatting and media kept).
 * `neutraliseRefusedAnchor(a)` -- the same for a link `resolveHref` refused; an anchor with NO
 * visible content shows its href instead (`refusedLinkText`), so the URL is not lost. Never for
 * an unsafe scheme or a scheme-less href (as before).
 */
import { getLinkify } from './adapters/generic'
import { hrefAsRead, keptSchemeHref } from '../linkSchemes'

// ── linkify (L-3) ────────────────────────────────────────────────────────────

const KEEP_SCHEMAS = new Set(['http:', 'https:', 'mailto:'])
// The server's `_STOP_RE`, code point for code point (the vectors' `_doc` lists them).
const STOP_RE = /[\u3000\u3001\u3002\uFF0C\uFF1B\uFF1A\uFF01\uFF1F\uFF08\uFF09\u3010\u3011\u300C\u300D\u300E\u300F\u300A\u300B\u3008\u3009\u201C\u201D\u2018\u2019\u2026]/
const TRAIL_CHARS = '.,:;!?'
// Fix round 1: never an `<a>` inside a raw-text or foreign element (script, style,
// textarea, title, svg), where it would be text or a foreign node, not a link.
const SKIP_SELECTOR = 'a, code, pre, [data-type="inline-math"], [data-type="block-math"], [data-latex], [data-type="attachmentChip"], script, style, textarea, title, svg'

const kept = (m) => KEEP_SCHEMAS.has(m.schema) || (m.schema === '' && m.raw.slice(0, 4).toLowerCase() === 'www.')

function hrefFor(m, text) {
  if (m.schema === '') return 'https://' + text
  return text.toLowerCase().startsWith(m.schema) ? text : m.schema + text
}

// ⛔ A loop, never a `[.,:;!?]+$` regex: a backtracking engine retries that at every start
// position, so a long punctuation run INSIDE a URL is quadratic (the server measured 2.9 s
// for 32k dots before it switched to `rstrip`).
function stripTrailing(t) {
  let end = t.length
  while (end > 0 && TRAIL_CHARS.includes(t[end - 1])) end--
  return t.slice(0, end)
}

/** `[start, end, href]` per kept link in `text`, in order, non-overlapping. */
function matches(text) {
  const linkify = getLinkify()
  if (!linkify.pretest(text)) return []
  const out = []
  for (const m of linkify.match(text) || []) {
    if (!kept(m)) continue
    let t = text.slice(m.index, m.lastIndex)
    const stop = STOP_RE.exec(t)
    if (stop) t = t.slice(0, stop.index)
    t = stripTrailing(t)
    if (!t) continue
    const again = linkify.match(t) || []
    if (again.length !== 1 || again[0].index !== 0 || again[0].lastIndex !== t.length || !kept(again[0])) continue
    const href = hrefFor(again[0], t)
    // B-14: never make a link the href policy would turn back into text (`https://u:p@x`).
    if (keptSchemeHref(href) === null) continue
    out.push([m.index, m.index + t.length, href])
  }
  return out
}

/** Wraps every kept bare link in `root`'s plain text in `<a href>`, in place; returns how many. */
export function linkifyTextNodes(root) {
  const doc = root.ownerDocument
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */)
  const nodes = []
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const parent = n.parentElement
    if (parent && parent.closest(SKIP_SELECTOR)) continue
    nodes.push(n)
  }
  let made = 0
  for (const node of nodes) {
    const text = node.nodeValue
    const found = matches(text)
    if (!found.length) continue
    const frag = doc.createDocumentFragment()
    let pos = 0
    for (const [start, end, href] of found) {
      if (start > pos) frag.appendChild(doc.createTextNode(text.slice(pos, start)))
      const a = doc.createElement('a')
      a.setAttribute('href', href)
      a.textContent = text.slice(start, end)
      frag.appendChild(a)
      pos = end
      made++
    }
    if (pos < text.length) frag.appendChild(doc.createTextNode(text.slice(pos)))
    node.parentNode.replaceChild(frag, node)
  }
  return made
}

// ── href policy (L-4) ────────────────────────────────────────────────────────

// `hrefAsRead`: `href` as TipTap's `isAllowedUri` -- and a browser -- reads it. Defined in
// ../linkSchemes.js beside the kept-link allow-list that also reads it; re-exported here.
export { hrefAsRead }

const KEPT_PREFIXES = ['import-link://', 'import-ref://', '/journal', '/terminal?cmd=', '/api/j2/notes/attachments/']
const UNSAFE_SCHEMES = new Set(['javascript', 'data', 'vbscript', 'file'])
const APP_SCHEMES = new Set(['evernote', 'notion', 'obsidian', 'onenote'])
const SCHEME_RE = /^([a-zA-Z][a-zA-Z0-9+.-]*):/
const NOTION_ID_SRC = '[0-9a-fA-F]{32}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
const NOTION_SEGMENT_RE = new RegExp(`^(?:.*-)?(${NOTION_ID_SRC})$`)
const APP_HOST = 'uctintelligence.com'

/** The server's `canonical_notion_page_id`: the dashed lowercase UUID. */
function canonicalNotionId(id) {
  const h = id.replace(/-/g, '').toLowerCase()
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/** The server's `_notion_key` for the part of a `notion:` deep link after the scheme. */
function notionKey(rest) {
  const path = rest.split(/[?#]/, 1)[0]
  let end = path.length
  while (end > 0 && path[end - 1] === '/') end--
  const trimmed = path.slice(0, end)
  const segment = trimmed.slice(trimmed.lastIndexOf('/') + 1)
  const m = NOTION_SEGMENT_RE.exec(segment)
  return m ? `notion:${canonicalNotionId(m[1])}` : null
}

function resolveRelative(href, sourceUrl) {
  if (typeof sourceUrl !== 'string') return null
  let base
  try {
    base = new URL(sourceUrl.trim())
  } catch {
    return null
  }
  const host = base.hostname.toLowerCase()
  if ((base.protocol !== 'http:' && base.protocol !== 'https:') || !host) return null
  // ⛔ Never against our own origin: in the app a relative href lands on uctintelligence.com,
  // which is never what the source author meant.
  if (host === APP_HOST || host.endsWith('.' + APP_HOST)) return null
  // B-14: whitespace in a relative href is text; `new URL` would percent-encode it and the
  // server's `urljoin` would not, so the two runtimes could not agree on the result.
  if (hrefAsRead(href) !== href) return null
  try {
    const out = new URL(href, base)
    return out.protocol === 'http:' || out.protocol === 'https:' ? keptSchemeHref(out.href) : null
  } catch {
    return null
  }
}

/** The href to keep, or `null` meaning "render as text". The server's `resolve_href`. */
export function resolveHref(href, sourceUrl = null) {
  if (typeof href !== 'string') return null
  const h = href.trim()
  if (!h) return null
  if (KEPT_PREFIXES.some((p) => h.startsWith(p))) return h
  // ⛔ THE scheme guard: read as TipTap and a browser read it. `new URL` strips a tab too,
  // so without this `java<TAB>script:` would be resolved as "relative" and come back as
  // `javascript:`.
  const read = hrefAsRead(h)
  const m = SCHEME_RE.exec(read)
  if (m) {
    const scheme = m[1].toLowerCase()
    if (UNSAFE_SCHEMES.has(scheme)) return null
    if (APP_SCHEMES.has(scheme)) {
      const key = scheme === 'notion' ? notionKey(read.slice(m[0].length)) : null
      return key ? `import-link://${key}` : null
    }
    // B-14: a scheme the editor has no door for is text, never an inert link.
    return keptSchemeHref(h)
  }
  if (read.startsWith('//')) return keptSchemeHref('https:' + read)
  return resolveRelative(h, sourceUrl)
}

/** Replaces `a` with its children (bold, italic, media kept). Never `textContent`. */
export function neutraliseAnchor(a) {
  const parent = a.parentNode
  if (!parent) return
  while (a.firstChild) parent.insertBefore(a.firstChild, a)
  parent.removeChild(a)
}

/**
 * B-14: the text a REFUSED anchor with no visible content of its own shows -- its trimmed href,
 * so `<a href="ftp://x/f"></a>` keeps the URL as plain text instead of vanishing -- or null
 * when it has content (that stays), or when the href names no scheme (a relative or `#`
 * anchor, as before) or an UNSAFE one (never surfaced, as before).
 */
export function refusedLinkText(a) {
  if (a.textContent.trim() !== '' || a.querySelector('img, picture, video, audio, svg')) return null
  const href = (a.getAttribute('href') || '').trim()
  const m = SCHEME_RE.exec(hrefAsRead(href))
  return m && !UNSAFE_SCHEMES.has(m[1].toLowerCase()) ? href : null
}

/** A refused link becomes plain text: its content (`neutraliseAnchor`), or its URL when empty. */
export function neutraliseRefusedAnchor(a) {
  const text = refusedLinkText(a)
  if (text !== null) a.replaceChildren(a.ownerDocument.createTextNode(text))
  neutraliseAnchor(a)
}

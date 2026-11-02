/**
 * B-14 (controller ruling): every stored link has a DOOR -- the editor can open it -- or is
 * plain text. This is the client's ONE statement of the kept-link allow-list, read by both
 * halves that must agree on it:
 *   - the import link policy (`importer/linkPolicy.js` `resolveHref`, and its linkify pass),
 *     which keeps a link only when `keptSchemeHref` allows it, else renders its text;
 *   - the editor's door (`linkClickOpen.js` `openableLinkHref`), which opens `tel:`/`sms:`
 *     through `phoneHref`.
 *
 * ⛔ The server states the same rule once, in
 * `api/services/journal_two/note_connectors/convert/linkify.py` (`kept_scheme_href`). The two
 * are pinned by the shared `href_vectors` in `importer/__fixtures__/linkify_vectors.json`,
 * which `linkPolicy.test.js` and the server's `test_linkify.py` both READ. Change one, change
 * the other, add the vector.
 *
 * Kept:
 *   - `http:`/`https:` -- `//` + a host, no whitespace or invisible character, no userinfo
 *     (`user:pw@`), a port of at most 65535, and a numeric last label only as a dotted-quad
 *     IPv4 (a browser reads `1.2.3.999` as a parse failure and `1.2.3` as `1.2.0.3`);
 *   - `mailto:` -- an address with an `@`, no whitespace;
 *   - `tel:`/`sms:` -- a number: digits, an optional leading `+`, spaces `-` `.` `(` `)`.
 * Anything else (`ftp:`, `zoommtg:`, a custom app scheme, a bare `mailto:`/`tel:`) is text.
 */

// TipTap `isAllowedUri`'s UNICODE_WHITESPACE_PATTERN, and the server's
// `mddoc._LINK_URI_INVISIBLE_RE` (linkPolicy.test.js pins it to TipTap's, code point by code point).
// eslint-disable-next-line no-control-regex -- the control characters ARE the class
const INVISIBLE_RE = /[\u0000-\u0020\u00A0\u1680\u180E\u2000-\u2029\u205F\u3000]/g

/** `href` as TipTap's `isAllowedUri` -- and a browser -- reads it: invisible characters removed. */
export function hrefAsRead(href) {
  return href.replace(INVISIBLE_RE, '')

}
// U+FEFF is not in TipTap's class but IS in a JS `\s`, which the door's own checks
// (`webUrl`, the mailto rule) refuse: refusing it here keeps every kept link openable.
const BOM = String.fromCharCode(0xfeff)
const clean = (x) => hrefAsRead(x) === x && !x.includes(BOM)

const WEB_RE = /^https?:\/\/([^/?#]*)/i
// host[:port]: a bracketed IPv6 literal, or a name with none of the characters a URL parser
// treats as a delimiter or forbids in a host (`%` included: a percent-encoded host is decoded
// by the browser into something other than what the member read).
const AUTHORITY_RE = /^(\[[0-9A-Fa-f:.]+\]|[^[\]:@/?#\\%<>^|"`{}]+)(?::([0-9]*))?$/
const NUMERIC_LABEL_RE = /^(?:[0-9]+|0[xX][0-9A-Fa-f]*)$/
const IPV4_PART_RE = /^(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])$/
const MAILTO_RE = /^mailto:/i
const NUMBER_RE = /^(tel|sms):(\+?[0-9 ().-]*[0-9][0-9 ().-]*)$/i

function webHostOk(h) {
  const m = WEB_RE.exec(h)
  if (!m) return false
  const a = AUTHORITY_RE.exec(m[1])
  if (!a) return false
  const [, host, port] = a
  if (port && Number(port) > 65535) return false
  if (host.startsWith('[')) return true
  let labels = host.split('.')
  if (labels.length > 1 && labels[labels.length - 1] === '') labels = labels.slice(0, -1)
  if (NUMERIC_LABEL_RE.test(labels[labels.length - 1])) {
    return labels.length === 4 && labels.every((p) => IPV4_PART_RE.test(p))
  }
  return true
}

/** `h` (already trimmed) when its scheme has a door in the editor, else `null` (text). */
export function keptSchemeHref(h) {
  if (typeof h !== 'string') return null
  if (WEB_RE.test(h)) return clean(h) && webHostOk(h) ? h : null
  if (MAILTO_RE.test(h)) {
    const rest = h.slice('mailto:'.length)
    return rest.includes('@') && clean(rest) ? h : null
  }
  return NUMBER_RE.test(h) ? h : null
}

/**
 * The `tel:`/`sms:` href a door opens, or `null`: the number with only its digits and a
 * leading `+` (`tel:+1 555 0100` opens `tel:+15550100`).
 */
export function phoneHref(href) {
  if (typeof href !== 'string') return null
  const m = NUMBER_RE.exec(href.trim())
  if (!m) return null
  const num = m[2]
  return `${m[1].toLowerCase()}:${num.startsWith('+') ? '+' : ''}${num.replace(/[^0-9]/g, '')}`
}

/**
 * Media references for every client file-import path -- connector fidelity Plan B Task 2
 * (spec I-1, I-6).
 *
 * `IMAGE_EXT` -- the ONE "is this file an image" rule for every adapter (generic, notion,
 * obsidian, keep). heic/heif/avif/tiff/bmp/svg are images: the server's media policy
 * converts HEIC/TIFF/BMP/AVIF and stores SVG as a FILE (never inline), so the client only
 * has to say "image" and let the door decide.
 *
 * `extractDataUriImages(root, media)` -- every `<img src="data:…">` becomes an uploadable
 * media item; a `data:` URI is NEVER left inline. The grammar is the server's
 * `mddoc.DATA_URI_RE` and the decode its `engine._decode_data_uri` (base64 when a `;base64`
 * parameter is present, else percent-decoded TO BYTES like `unquote_to_bytes`). A non-image,
 * malformed or undecodable URI, or one over `MEDIA_SOURCE_MAX_BYTES`, is a FAILED item whose
 * ref stays on the `<img>` -- a visible notice later (Task 4), never a silent drop.
 *
 * `collectRemoteImages(root, media, sourceUrl)` -- every other `<img>` not already ours: its
 * src goes through `resolveHref` (the one link policy). A web URL becomes a remote item the
 * server's fetch door copies (`POST /api/j2/notes/media/fetch`, Task 5); anything else is an
 * `unresolvable_src` failure. Never a UCT-relative src: `/x.png` with no source URL would
 * load from uctintelligence.com.
 *
 * `liftMediaOutOfLinks(root)` -- an image or chip inside a link moves to just before it, so
 * the link and the media both survive (TipTap cannot hold an image inside a link mark).
 */
import SparkMD5 from 'spark-md5'
import { resolveHref, neutraliseAnchor } from './linkPolicy'

export const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|heic|heif|avif|tiff?)$/i

/** The server's `media_policy.MEDIA_SOURCE_MAX_BYTES` (= `notes._MAX_FILE_BYTES`, 25 MB). */
export const MEDIA_SOURCE_MAX_BYTES = 25 * 1024 * 1024
/** The server's `engine.DATA_URI_SLACK_CHARS`: room for the header and line breaks. */
const DATA_URI_SLACK_CHARS = 4096
const DATA_URI_MAX_CHARS = Math.floor((MEDIA_SOURCE_MAX_BYTES * 4) / 3) + DATA_URI_SLACK_CHARS

// `mddoc.DATA_URI_RE`, `_IMAGE_MIME_RE`, `_DATA_URI_MIME_EXT`, `_data_uri_ext`.
const DATA_URI_RE = /^\s*data:([^;,]*)((?:;[^;,]*)*),([\s\S]*)$/i
const DATA_PREFIX_RE = /^\s*data:/i
const IMAGE_MIME_RE = /^image\/[a-z0-9][a-z0-9.+-]*$/i
const MIME_EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/tiff': 'tif',
  'image/bmp': 'bmp',
  'image/avif': 'avif',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
}

function extForMime(mime) {
  const known = MIME_EXT[mime]
  if (known) return known
  return mime.split('/', 2)[1].split('+', 1)[0].replace(/[^a-z0-9]/g, '').slice(0, 10) || 'img'
}

const REF = 'import-ref://'
const OURS = [REF, '/api/j2/notes/attachments/']

function base64Bytes(payload) {
  const binary = atob(payload.replace(/\s+/g, '')) // throws on a non-base64 payload
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

const TOO_LARGE = { reason: 'too_large' }

function hexValue(code) {
  if (code >= 48 && code <= 57) return code - 48 // 0-9
  if (code >= 65 && code <= 70) return code - 55 // A-F
  if (code >= 97 && code <= 102) return code - 87 // a-f
  return -1
}

/**
 * `urllib.parse.unquote_to_bytes`: `%XX` is a byte, a stray `%` stays, the rest is UTF-8.
 * `{bytes}`, or `TOO_LARGE` the moment the output passes `cap`. ⛔ Decodes into ONE buffer
 * of at most `cap + 1` bytes and stops there: a ~35M-character URI under the length cap
 * must never become a 35M-element array (~280 MB) before it is refused.
 */
export function percentDecode(payload, cap = MEDIA_SOURCE_MAX_BYTES) {
  // A UTF-16 code unit is at most 3 UTF-8 bytes (a pair, 2 units, is 4); `%XX` is 3 -> 1.
  const out = new Uint8Array(Math.min(cap + 1, payload.length * 3))
  const enc = new TextEncoder()
  let pos = 0
  let i = 0
  while (i < payload.length) {
    if (payload.charCodeAt(i) === 37 /* % */) {
      const hi = hexValue(payload.charCodeAt(i + 1))
      const lo = hi < 0 ? -1 : hexValue(payload.charCodeAt(i + 2))
      if (lo >= 0) {
        if (pos >= cap) return TOO_LARGE
        out[pos++] = hi * 16 + lo
        i += 3
        continue
      }
    }
    const j = payload.indexOf('%', i + 1)
    const end = j === -1 ? payload.length : j
    const run = payload.slice(i, end)
    const { read, written } = enc.encodeInto(run, out.subarray(pos))
    pos += written
    // The buffer is cap + 1 (or the run's own upper bound), so it fills only past the cap.
    if (read < run.length || pos > cap) return TOO_LARGE
    i = end
  }
  return { bytes: out.slice(0, pos) }
}

/** `{bytes, mime}` for an image data URI, or `{reason}` (`too_large` | `decode_failed`). */
function decodeDataUri(src) {
  if (src.length > DATA_URI_MAX_CHARS) return { reason: 'too_large' }
  const m = DATA_URI_RE.exec(src)
  if (!m) return { reason: 'decode_failed' }
  const mime = m[1].trim().toLowerCase()
  if (!IMAGE_MIME_RE.test(mime)) return { reason: 'decode_failed' }
  const params = m[2].split(';').map((p) => p.trim().toLowerCase())
  let bytes
  try {
    if (params.includes('base64')) {
      bytes = base64Bytes(m[3])
    } else {
      const out = percentDecode(m[3])
      if (out.reason) return out
      bytes = out.bytes
    }
  } catch {
    return { reason: 'decode_failed' }
  }
  if (!bytes.length) return { reason: 'decode_failed' }
  if (bytes.length > MEDIA_SOURCE_MAX_BYTES) return { reason: 'too_large' }
  return { bytes, mime }
}

/** The next free `<prefix><n>` ref, counted past those already in `media`. */
function nextNumbered(media, prefix) {
  return `${prefix}${media.filter((m) => m.ref.startsWith(prefix)).length + 1}`
}

function failedItem(media, prefix, name, reason) {
  const item = { ref: nextNumbered(media, prefix), kind: 'image', name, failed: { reason, sourceUrl: null } }
  media.push(item)
  return item.ref
}

/** Every `<img src="data:…">` in `root` -> an uploadable media item, or a failed one. */
export function extractDataUriImages(root, media) {
  const known = new Set(media.map((m) => m.ref))
  for (const img of root.querySelectorAll('img[src]')) {
    const src = img.getAttribute('src')
    if (!DATA_PREFIX_RE.test(src)) continue
    const out = decodeDataUri(src)
    let ref
    if (out.reason) {
      ref = failedItem(media, 'bad-data-', null, out.reason)
    } else {
      const { bytes, mime } = out
      ref = `data-${SparkMD5.ArrayBuffer.hash(bytes.buffer).toLowerCase()}`
      if (!known.has(ref)) {
        const name = `image.${extForMime(mime)}`
        media.push({
          ref,
          kind: 'image',
          name,
          mime,
          vfile: { path: name, size: bytes.length, lastModified: null, bytes: async () => bytes },
        })
      }
    }
    known.add(ref)
    img.setAttribute('src', REF + ref)
  }
}

function lastSegment(url) {
  const seg = url.pathname.slice(url.pathname.lastIndexOf('/') + 1)
  if (!seg) return null
  try {
    return decodeURIComponent(seg)
  } catch {
    return seg
  }
}

/** The fetchable http(s) URL `src` names, or null. */
function remoteUrlFor(src, sourceUrl) {
  const resolved = resolveHref(src, sourceUrl)
  if (resolved === null) return null
  let url
  try {
    url = new URL(resolved)
  } catch {
    return null // a relative href resolveHref kept (`/journal…`) is not fetchable
  }
  return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
}

/** A media item's display name, bounded: a src can be megabytes long. */
export const MEDIA_NAME_MAX = 200
const boundedName = (s) => (s === null || s.length <= MEDIA_NAME_MAX ? s : s.slice(0, MEDIA_NAME_MAX - 1) + '…')

/**
 * Every other `<img>` not already ours -> a remote item (one per URL), or unresolvable.
 * A `data:` src is `extractDataUriImages`'s, never this pass's (run that one first).
 */
export function collectRemoteImages(root, media, sourceUrl = null) {
  const known = new Set(media.map((m) => m.ref))
  for (const img of root.querySelectorAll('img[src]')) {
    const src = img.getAttribute('src')
    const trimmed = src.trim()
    if (OURS.some((p) => trimmed.startsWith(p)) || DATA_PREFIX_RE.test(trimmed)) continue
    const url = remoteUrlFor(src, sourceUrl)
    let ref
    if (url) {
      ref = `remote-${SparkMD5.hash(url.href).toLowerCase()}`
      if (!known.has(ref)) {
        media.push({ ref, kind: 'image', name: boundedName(lastSegment(url)), remoteUrl: url.href })
        known.add(ref)
      }
    } else {
      ref = failedItem(media, 'unresolvable-', boundedName(src), 'unresolvable_src')
      known.add(ref)
    }
    img.setAttribute('src', REF + ref)
  }
}

const CHIP_SELECTOR = '[data-type="attachmentChip"]'
const MEDIA_SELECTOR = `img, ${CHIP_SELECTOR}`

/** Media inside a link moves, in order, to just before it; an emptied link is made whole. */
export function liftMediaOutOfLinks(root) {
  for (const a of [...root.querySelectorAll('a[href], a[data-evernote-link]')]) {
    // Outermost media only: a chip moves whole, with any image inside it. An adapter's chip is
    // itself `<a href="import-ref://…">`; its own media has `outer === a`, so a chip is never a
    // link to lift from.
    const found = [...a.querySelectorAll(MEDIA_SELECTOR)].filter((el) => {
      const outer = el.parentElement.closest(MEDIA_SELECTOR)
      return !outer || !a.contains(outer)
    })
    if (!found.length) continue
    for (const el of found) a.parentNode.insertBefore(el, a)
    if (a.textContent.trim()) continue
    const href = (a.getAttribute('href') || '').trim()
    if (a.hasAttribute('data-evernote-link') || !href) {
      neutraliseAnchor(a)
    } else {
      a.textContent = href
    }
  }
}

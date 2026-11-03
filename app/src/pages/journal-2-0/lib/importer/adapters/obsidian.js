/**
 * Obsidian adapter.
 *
 * Detection: two tiers.
 *  - 0.95 SYNCHRONOUS when the export contains a `.obsidian/` config
 *    directory (a vault marker Obsidian writes on every vault, exported or
 *    not) — no file content needs to be read for this signal.
 *  - 0.6 ASYNC, only checked when the `.obsidian/` marker is absent: samples
 *    up to `SAMPLE_LIMIT` `.md` files (skipping any over `SAMPLE_MAX_BYTES`)
 *    and scores 0.6 if any sampled file's content contains `[[` wiki-link
 *    syntax. `detect()` therefore returns either a plain number or a
 *    Promise<number> depending on which tier fires — `registry.js`'s
 *    `detectAdapter` normalizes both via `Promise.resolve(...)`, per the
 *    Task 9 review's async-tolerant contract. A `bytes()` failure on any
 *    sampled file is swallowed and counts as "no signal" from that file —
 *    the whole scan must never reject.
 *
 * Parse: every `.md` file in the vault becomes a doc (skipping `.obsidian/`
 * and `.trash/`). Frontmatter (`--- ... ---` at byte 0, parsed by the
 * shared `../frontmatter` module also used by the generic adapter) is
 * stripped from the body before markdown conversion; `tags` (bracketed
 * list, comma string, or YAML `- item` list, all quote-aware — a quoted
 * item containing a literal comma, e.g. `[swing, "reclaim, tight"]`, no
 * longer gets mis-split on that inner comma), `created`/`date` (created
 * wins) and `updated`/`modified` (updated wins) feed the doc directly;
 * `title`/`subtitle`/`ticker` feed the doc when present (an explicit
 * front-matter `title:` wins over an inferred `<h1>`); a `hero_image:`
 * pointing at a real file in the vault is surfaced as an actual leading
 * image in the body rather than left as inert YAML text with its file an
 * orphan in the archive.
 *
 * Ordinary CommonMark `![alt](path)` / `[text](path)` attachment references
 * (not just `![[wiki-embeds]]`) are resolved too, via the SAME
 * `resolveRelativeMedia` pass `generic.js` uses — real vaults mix both
 * forms (wiki-links are a per-vault Obsidian SETTING, not a guarantee; a
 * vault with "Use [[Wikilinks]]" turned off, or content pasted in from
 * elsewhere, links images the plain markdown way), and a vault fed through
 * this adapter used to drop every one of those silently.
 *
 * Wiki-syntax is pre-processed with regex passes BEFORE `mdToHtml`, applied
 * only OUTSIDE code — both fenced (```) blocks AND inline (`) spans (the raw
 * text is split on a combined regex that tries the fence alternative FIRST,
 * since fence content can itself contain single/double backticks — matching
 * inline-span first would slice a fence into pieces at its first backtick
 * run; code segments pass through byte-for-byte untouched so wiki syntax
 * inside a code sample, fenced or inline, is never rewritten), in this
 * fixed order:
 *   1. `![[target]]` embeds       -> `<img import-ref://...>` or an
 *                                     attachment chip (non-image target)
 *   2. `[[Target|alias]]`/`[[Target]]` links -> `<a data-import-link=...>`,
 *                                     or plain text when unresolvable
 *   3. `==highlight==`             -> `<mark>highlight</mark>`
 * then, on the whole body, `> [!type] Title` callouts become the editor's
 * callout node (`splitCalloutTitles` before markdown, `calloutsInHtml` after
 * it, the server lane's two halves; D2 item 1).
 * (Frontmatter extraction is pass 0, applied once to the raw file before
 * the fenced/inline code split, since a frontmatter block is only ever at
 * byte 0.)
 *
 * Resolution (Plan B Task 8): ONE resolver, `../obsidianResolve.js`, built once per
 * parse() and used by embeds, wikilinks, relative markdown links, images and
 * `obsidian://open` deep links alike. A wikilink or embed follows the server lane's rule
 * (`providers/obsidian.py::_resolve_in`): the exact note first, a `#`-holding file name
 * whole, no stem rule; ties go to the linking note's folder, then the attachment folder,
 * then the fewest folders, then sort order, so `[[Plan]]` beside `Notes/Plan.md` opens
 * that one, not the first `Plan.md` the drop listed.
 *  - `[[Note\|alias]]` in a table cell: the `\` escapes the pipe from the table (O-8).
 *  - a wikilink's text reads as Obsidian shows it: `Note > Heading`; a block id not at all.
 *  - `![[Other note]]` (an embedded NOTE) is a link to that note, never a file chip (O-11).
 *  - after `resolveRelativeMedia`, every relative `<a href>` left is resolved (O-5):
 *    a note -> a note link; any other vault file -> an attachment chip; a miss is left for
 *    the post-parse pass (`../postParse.js`), which makes it its text.
 *  - `obsidian://open?vault=<this vault>&file=<f>` -> the note `f` names. A deep link into a
 *    vault with another name (when this drop names its vault folder) is left for the
 *    post-parse pass, which makes it text.
 *  - `![](attachments/x.png)` from a note in a sub-folder: the dir-relative path misses, the
 *    resolver finds it from the vault root (I-9).
 * An unresolved link is the member's text with no link (`pending` is server-only, see the
 * parity rail): a one-shot drag-in has no later sync to heal a key it never stores.
 */

import { mdToHtml, mdInlineText, resolveRelativeMedia, dedupeMedia, markAttachmentChip } from './generic'
import { extractFrontmatter, frontmatterDates } from '../frontmatter'
import { reportIgnoredFiles } from './reportIgnored'
import { IMAGE_EXT } from '../mediaRefs'
import { NOTICE_REASONS } from '../importNotice'
import { makeObsidianResolver } from '../obsidianResolve'

/** The media ref of an embed of a file the vault does not hold (live audit F3): no vault path. */
const MISSING_REF_PREFIX = 'obsidian-missing:'
const SKIP_DIR_RE = /(^|\/)\.(obsidian|trash)\//i
// Fence alternative MUST come first — at a run of 3+ backticks it has to win
// over the inline-span alternative, or the inline pattern would consume just
// the fence's opening backticks and mis-split its content.
// D2 fix round 3, M-new-1: a `~~~` fence is code too, in the same order as the
// server's `_FENCE_SRC`. ⚰️ An embed in one became an <img> as code TEXT, uploaded.
const CODE_RE = /```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`/g
// ⛔ A target or alias never runs across a `[[` (D2 fix round 3, the server's
// `_WIKI_TARGET`/`_WIKI_ALIAS`): it keeps these patterns LINEAR. A target that could take
// `[` scanned the rest of a line of `[` at every one of them (80 KB: ~2 s, quadratic).
// Obsidian refuses `[` and `]` in a file name, so no real target holds `[[`.
// ⛔ Nor across a blank line or a fence line (D2 fix round 5, M-r4-1, and its follow-up),
// mirroring the server's `_WIKI_STOP`: Obsidian does not link across a paragraph break.
// ⚰️ `[[Plan|first\n\nsecond]]` made two links, one each side of the break (or of a fenced
// block). Such text is now left exactly as written.
//   - A blank line is a newline, then only spaces, tabs, `\r` and `>` quote prefixes, then a
//     newline: inside a blockquote or callout a line holding only `>` is a paragraph break.
//   - A fence is a fence LINE: a newline, up to 3 spaces, optional `>` prefixes, then ``` or
//     `~~~`. A one-line ``` run is an inline code span, which a link may hold whole
//     (`clearOfCode`), as it may hold a single-backtick one.
//   - Nor across a newline whose next line starts a block (D2 fix round 5 (final), ruling
//     A): after up to 3 spaces and optional `>` prefixes, a heading, a list item, a
//     thematic break, an HTML block start (`<`) or a fence; and (ruling B's corpus) a
//     setext underline, a line of `=`.
//   - A `>` that opens a DEEPER quote than the link's own line is a block start too; a
//     pattern cannot know the link's own line, so that one is `deepensQuote`.
// A single newline is still allowed. Each stop reads at most one line from a newline, so
// the patterns stay linear. The SAME source as the server's `_WIKI_STOP`.
const WIKI_STOP = '\\[\\[|\\n[ \\t\\r]*(?:>[ \\t\\r]*)*\\n|\\n {0,3}(?:>[ \\t]*)*(?:```|~~~|#{1,6}[ \\t]'
  + '|[-*+][ \\t]|\\d{1,9}[.)][ \\t]|(?:-[ \\t]*){3,}(?:\\r?\\n|$)|(?:\\*[ \\t]*){3,}(?:\\r?\\n|$)'
  + '|(?:_[ \\t]*){3,}(?:\\r?\\n|$)|=+[ \\t]*(?:\\r?\\n|$)|<)'
const EMBED_RE = new RegExp(`!\\[\\[((?:(?!${WIKI_STOP})[^\\]])+)\\]\\]`, 'g')
const WIKILINK_RE = new RegExp(
  `\\[\\[((?:(?!${WIKI_STOP})[^\\]|])+)(?:\\|((?:(?!${WIKI_STOP})[^\\]])+))?\\]\\]`, 'g')
// Plugin issue #3: a link whose alias is exactly ONE markdown image,
// `[[q.pdf|![](att/img.png)]]`. The image is the server's `_MD_LINK_OR_IMAGE_RE` with
// its `!`, source for source; the server splits this shape (`_alias_md_image`) into the
// image, then the link as `[[q.pdf]]` reads, and so does `transformWikiLinks`.
// ⚰️ WIKILINK_RE's alias stops at the image's `]`: the image showed, the link was raw text.
const ALIAS_MD_IMAGE_RE = new RegExp(
  `\\[\\[((?:(?!${WIKI_STOP})[^\\]|])+)\\|(!\\[(?:[^\\[\\]\\n]|\\[[^\\[\\]\\n]*\\])*\\]`
  + `\\(\\s*(?:<[^<>\\n]*>|[^\\s()<>]+)(?:\\s+(?:"[^"\\n]*"|'[^'\\n]*'))?\\s*\\))\\]\\]`, 'g')
// ⛔ A trader's prose is full of `==` COMPARISONS ("if rsi == 30 and macd == 0").
// The old `/==([^=\n]+)==/` highlighted the span between two comparisons and
// deleted both operators. A highlight now needs a non-space just inside each
// `==`, and neither marker may touch a letter, digit, `_` or another `=` on its
// outside. The leading context is CAPTURED, not a lookbehind: the iOS 16 floor
// cannot parse lookbehind (app/src/noRegexLookbehind.test.js). The server lane
// (`providers/obsidian.py`) uses the same rule; parity fixture `08-comparisons`.
const HIGHLIGHT_RE = /(^|[^=\p{L}\p{N}_])==(?=\S)([^=\n]*?\S)==(?![=\p{L}\p{N}_])/gu
// A vault note (the server's `_NOTE_EXT_RE`).
const NOTE_RE = /\.md$/i

const SAMPLE_LIMIT = 20
const SAMPLE_MAX_BYTES = 256 * 1024

export const obsidianAdapter = {
  id: 'obsidian',
  label: 'Obsidian',
  detect,
  parse,
}

// ---------------------------------------------------------------------------
// detection
// ---------------------------------------------------------------------------

function detect(vfiles) {
  const hasObsidianDir = vfiles.some((v) => /(^|\/)\.obsidian\//i.test(v.path))
  if (hasObsidianDir) return 0.95
  return detectByWikiLinkContent(vfiles)
}

async function detectByWikiLinkContent(vfiles) {
  const candidates = vfiles
    .filter((v) => /\.md$/i.test(v.path) && !SKIP_DIR_RE.test(v.path) && v.size <= SAMPLE_MAX_BYTES)
    .slice(0, SAMPLE_LIMIT)

  for (const v of candidates) {
    try {
      const text = await readText(v)
      if (text.includes('[[')) return 0.6
    } catch {
      // A single unreadable sample is not a verdict either way — move on.
      // (Never let detection reject; a bytes() failure counts as no signal.)
    }
  }
  return 0
}

// ---------------------------------------------------------------------------
// parse
// ---------------------------------------------------------------------------

/**
 * @param {import('../intake').VFile[]} vfiles
 * @param {{onProgress?: (p: {phase: string, done: number, total: number}) => void}} [opts]
 * @returns {Promise<{docs: object[], warnings: string[]}>}
 */
async function parse(vfiles, opts = {}) {
  const { onProgress } = opts
  const warnings = []
  const byPath = new Map(vfiles.map((v) => [v.path, v]))
  const resolver = await makeObsidianResolver(vfiles)
  const topFolder = dropTopFolder(vfiles)

  const items = vfiles.filter((v) => /\.md$/i.test(v.path) && !SKIP_DIR_RE.test(v.path))

  const docs = []
  let done = 0
  for (const vfile of items) {
    try {
      const doc = await makeDoc(vfile, byPath, resolver, topFolder)
      docs.push(doc)
    } catch (err) {
      warnings.push(`Could not import "${vfile.path}": ${err?.message || err}`)
    }
    done += 1
    onProgress?.({ phase: 'parsing', done, total: items.length })
  }

  // audit B4: name whatever this drop contained that the vault never
  // touched — neither a note, nor media a note referenced, nor Obsidian's
  // own `.obsidian/`/`.trash/` housekeeping. Most commonly another
  // platform's export dropped in the same batch (the Export Guide's own
  // "drop them all in together" advice), silently discarded before this fix.
  const consumed = new Set(items.map((v) => v.path))
  for (const doc of docs) {
    for (const m of doc.media || []) consumed.add(m.ref)
  }
  const ignored = vfiles.filter((v) => !consumed.has(v.path) && !SKIP_DIR_RE.test(v.path))
  warnings.push(...reportIgnoredFiles(ignored, obsidianAdapter.label))

  return { docs, warnings }
}

async function makeDoc(vfile, byPath, resolver, topFolder = null) {
  const raw = await readText(vfile)
  const { fields, tags, body } = extractFrontmatter(raw)

  const resolve = (target, opts) => resolver.resolve(target, vfile.path, opts)
  // The wiki passes run under the safety net (`guardedPreprocess`, D2 fix round 5); each
  // round gets fresh `media`/`links`, and the kept round's lists carry on into the passes
  // below (`resolveRelativeMedia`, `resolveVaultAnchors`).
  const guarded = guardedPreprocess(body, { byPath, resolve, topFolder })
  const { media, links } = guarded
  const ctx = { byPath, resolve, media, links, topFolder }
  let html = guarded.html
  if (fields.hero_image) {
    // Same reasoning as generic.js's identical block: a front-matter cover
    // image is real authored content, not metadata to discard. Prepending
    // it lets it ride the SAME resolveRelativeMedia pass below as every
    // other image, rather than inventing a second resolution path.
    html = `<p><img src="${escapeAttr(fields.hero_image)}"></p>\n${html}`
  }

  const dir = dirOf(vfile.path)
  // Wiki-embeds (`![[chart.png]]`) are already resolved above by
  // transformEmbeds; this second pass catches ordinary CommonMark
  // `![alt](path)` / `[text](path)` references (our own export's shape,
  // and plenty of real vaults') that the wiki-syntax pass never touches.
  // Anything already rewritten to `import-ref://...` is skipped by
  // resolveRelativeMedia's own absolute-scheme check, so this can't
  // double-resolve or duplicate a media entry.
  // I-9: a src that misses beside the note is looked up the Obsidian way (vault root,
  // attachment folder, by name). A note is never an image.
  const fallbackResolve = (rel) => {
    const hit = resolve(rel, { decode: true })
    return hit && !NOTE_RE.test(hit) ? hit : null
  }
  const resolved = resolveRelativeMedia(html, dir, byPath, { fallbackResolve })
  resolved.html = resolveVaultAnchors(resolved.html, ctx, resolver.rootOf(vfile.path))
  const allMedia = dedupeMedia([...media, ...resolved.media])
  const title = fields.title || extractH1Title(resolved.html) || filenameSansExt(basename(vfile.path))

  return {
    importKey: `obsidian:${vfile.path}`,
    title,
    html: resolved.html,
    tags,
    subtitle: fields.subtitle,
    ticker: fields.ticker,
    folderPath: dir ? dir.split('/') : [],
    media: allMedia,
    links,
    ...frontmatterDates(fields, vfile.lastModified),
  }
}

// ---------------------------------------------------------------------------
// The safety net (D2 fix round 5 (final), ruling B)
// ---------------------------------------------------------------------------
// The stops keep a wikilink out of every block shape they name; this catches any shape
// they do not (a setext underline, an empty heading or list item, a table). Each held link
// or image a wikilink or embed match writes is tagged with its own number; after the
// markdown parse, each must come back as exactly ONE element. A match whose piece did not is left exactly as
// written, keyed by pattern, matched text and occurrence (so the other links in the note
// stay), and the note is converted again, at most NET_ROUNDS times. The server's net
// (`providers/obsidian.py::convert_obsidian_markdown`) catches the same shapes by the key
// its cut markdown link shows; the client writes keys only as attributes, so it checks the
// element instead. The tags never reach the stored html.
const NET_ATTR = 'data-uct-obsidian-net'
const NET_ATTR_RE = / data-uct-obsidian-net="\d+"/g
const NET_ROUNDS = 4

function guardedPreprocess(body, baseCtx) {
  let refused = new Set()
  for (let round = 0; ; round += 1) {
    const net = { refused, pieces: [], seen: new Map(), current: null }
    const ctx = { ...baseCtx, media: [], links: [], net }
    const html = calloutsInHtml(mdToHtml(splitCalloutTitles(preprocessWikiSyntax(body, ctx))))
    const fresh = brokenPieces(html, net).filter((key) => !refused.has(key))
    if (!fresh.length || round + 1 >= NET_ROUNDS) {
      return { html: html.replace(NET_ATTR_RE, ''), media: ctx.media, links: ctx.links }
    }
    refused = new Set([...refused, ...fresh])
  }
}

// The keys of the matches whose shown piece did not come back as exactly one element. A
// block that cuts a held `<a>` makes the HTML parser close it and open a copy on the far
// side (two elements); one that swallows it leaves none. One walk of the parsed html.
function brokenPieces(html, net) {
  if (!net.pieces.some((p) => p.shown)) return []
  const count = new Map()
  for (const el of new DOMParser().parseFromString(html, 'text/html').querySelectorAll(`[${NET_ATTR}]`)) {
    const id = el.getAttribute(NET_ATTR)
    count.set(id, (count.get(id) || 0) + 1)
  }
  const bad = new Set()
  net.pieces.forEach((piece, id) => {
    if (piece.shown && count.get(String(id)) !== 1) bad.add(piece.key)
  })
  return [...bad]
}

// ---------------------------------------------------------------------------
// wiki-syntax pre-processing (outside fenced AND inline code, in fixed order)
// ---------------------------------------------------------------------------

// ⛔ D2 fix round 3, N-I2: the embed and wikilink passes run over the WHOLE note with
// code protected (the server's rule, `providers/obsidian.py::_clear_of_code`): a match
// may CONTAIN whole code spans, never start, end or sit inside one. ⚰️ They ran per
// code-split segment, so `[[q.pdf|the `q3` deck]]` was cut at its code span and never
// found: raw brackets, no chip, the file never uploaded. The highlight pass still runs
// only outside code. Held placeholders hold no backtick, so the code spans left in the
// text after a pass are exactly the ones it did not swallow whole.
function preprocessWikiSyntax(text, ctx) {
  const held = []
  const lists = [] // lists[i]: what piece i adds to `media` / `links` once it is SHOWN
  const shown = new Set()
  const open = holdOpenFor(text)
  const net = ctx.net
  const hctx = {
    ...ctx,
    hold: (html, list) => {
      lists[held.length] = list
      // The safety net's tag: this piece's own number, on its element (see NET_ATTR).
      if (net?.current && /^<(a|img)\b/.test(html)) {
        html = html.replace(/^<(a|img)\b/, `<$1 ${NET_ATTR}="${net.pieces.length}"`)
        net.pieces.push({ key: net.current, index: held.length })
      }
      return holdMarkup(held, html, open)
    },
    // A string that is exactly one placeholder this note made (an embed already
    // held): only the importer writes a run of `open`'s length (see below).
    isHeld: (s) => {
      const m = HELD_ONLY_RE.exec(s)
      return !!m && m[1].length === open.length
    },
  }
  let out = text
  out = transformEmbeds(out, hctx)
  out = transformWikiLinks(out, hctx)
  out = transformOutsideCode(out, transformHighlights)
  out = releaseMarkup(out, held, open, shown)
  // ⛔ D2 item 4: a piece's media entry or link is listed only when the piece is
  // released into the note. `[[![[img.png]]|al.ias]]` shows the alias, so the
  // image placeholder is dropped and nothing uploads a file no node references.
  // In index order, which is the order the passes made them (embeds, then links).
  for (let i = 0; i < held.length; i += 1) if (shown.has(i)) lists[i]?.()
  for (const piece of net?.pieces || []) piece.shown = shown.has(piece.index)
  return out
}

function codeSpans(text) {
  return [...text.matchAll(CODE_RE)].map((m) => [m.index, m.index + m[0].length])
}

// `[at, end)` cuts no code span and lies inside none; it may contain whole ones.
// Spans are sorted and disjoint, so their ends are sorted too: binary-search the first
// span ending after `at`.
function clearOfCode(at, end, spans) {
  let lo = 0
  let hi = spans.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (spans[mid][1] <= at) lo = mid + 1
    else hi = mid
  }
  for (let k = lo; k < spans.length && spans[k][0] < end; k += 1) {
    const [cs, ce] = spans[k]
    if (!(at <= cs && ce <= end && !(cs === at && ce === end))) return false
  }
  return true
}

const QUOTE_PREFIX_DEPTH_RE = / {0,3}((?:>[ \t]*)*)/y

// How many `>` prefixes open the line holding `at`.
function quoteDepth(text, at) {
  QUOTE_PREFIX_DEPTH_RE.lastIndex = at > 0 ? text.lastIndexOf('\n', at - 1) + 1 : 0
  const m = QUOTE_PREFIX_DEPTH_RE.exec(text)
  return m ? m[1].split('>').length - 1 : 0
}

// `text.slice(start, end)` crosses a newline into a line with MORE `>` prefixes than its
// first line: a quote that begins inside the link (ruling A). Mirrors
// `providers/obsidian.py::_deepens_quote`; only a match holding a newline scans.
function deepensQuote(text, start, end) {
  let nl = text.indexOf('\n', start)
  if (nl === -1 || nl >= end) return false
  const depth = quoteDepth(text, start)
  while (nl !== -1 && nl < end) {
    if (quoteDepth(text, nl + 1) > depth) return true
    nl = text.indexOf('\n', nl + 1)
  }
  return false
}

// `text.replace(re, fn)`, taking only matches `clearOfCode`; a refused match is left as
// written and the scan resumes one character after its start. `wiki`: a wikilink-shaped
// pattern, whose match must also not open a deeper quote (`deepensQuote`). `net`: the
// safety net's run (`guardedPreprocess`): a refused match is left as written, and the
// pieces a taken one holds are tagged with its key. Mirrors
// `providers/obsidian.py::_sub_clear_of_code`.
function replaceClearOfCode(text, re, fn, wiki = false, net = null) {
  const spans = codeSpans(text)
  const rx = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`)
  let out = ''
  let last = 0
  let pos = 0
  for (;;) {
    rx.lastIndex = pos
    const m = rx.exec(text)
    if (!m) break
    const end = m.index + m[0].length
    if (clearOfCode(m.index, end, spans) && !(wiki && deepensQuote(text, m.index, end))) {
      let piece
      if (!net) {
        piece = fn(...m)
      } else {
        const seenKey = JSON.stringify([re.source, m[0]])
        const nth = net.seen.get(seenKey) || 0
        net.seen.set(seenKey, nth + 1)
        const key = JSON.stringify([re.source, m[0], nth])
        if (net.refused.has(key)) {
          piece = m[0]
        } else {
          const outer = net.current
          net.current = key
          piece = fn(...m)
          net.current = outer
        }
      }
      out += text.slice(last, m.index) + piece
      last = end
      pos = end > m.index ? end : end + 1
    } else {
      pos = m.index + 1
    }
  }
  return out + text.slice(last)
}

// ⛔ The embed and wikilink passes emit finished HTML (`<a ...>`, `<img>`, an
// entity-encoded unresolved name), and the callout and highlight passes after
// them ESCAPE their text. So each finished piece is HELD: the pass writes a
// placeholder of noncharacter and private-use code points (no `&`, `<`, `>`,
// `=` or ASCII digit for a later pass to escape or match), and the real markup
// goes back in only after every pass has run, right before `mdToHtml`.
// ⚰️ D1 fix round 2 wrote `&#46;` straight into the text, and a highlight or
// callout title escaped it again into a visible `&#46;`; a link inside
// `==...==` lost the highlight, and one in a callout title showed as escaped
// `<a>` markup (D1 fix round 3, N1/N2).
//
// ⛔ The OPEN is chosen PER SEGMENT so it can never be the member's own text:
// a run of U+FDD0 (a Unicode noncharacter, reserved for internal use like
// this) one longer than the longest U+FDD0 run already in the segment. The
// passes only ever ADD placeholders and never join two member runs, so a
// U+FDD0 run followed by index digits and the close that is at least `open`
// long ends in OUR open; whatever comes before that is the member's own text,
// put back unchanged. A shorter run is the member's and is left alone.
// The release regex is CONSTANT-SIZE and the length is checked in code: the
// open can be any length (a 40,000-long member run makes a 40,001-long open),
// and V8 refuses a regex of 32,768+ characters, which failed the whole note
// (D1 re-review M-a, fix round 5). The cost is placeholder size,
// O(links x longest run).
// ⚰️ D1 fix round 3 used a fixed U+E000 open, so a member's own
// `U+E000 U+E010 U+E001` was swapped for another link's markup: a duplicate
// link appeared and their text was lost (D1 re-review P1, fix round 4).
//
// ⛔ Release is RECURSIVE: a held piece can contain an EARLIER placeholder
// (`[[![[img.png]]]]` holds the embed's `<img>`, then holds the outer
// unresolved name, whose text is that first placeholder). A piece only ever
// contains placeholders created before it, so the recursion ends.
// ⚰️ One flat pass left U+FDD0 U+E010 U+E001 in the stored text and lost
// the image (D1 re-review M-b, fix round 5).
const HOLD_SENTINEL = '\uFDD0'
const HOLD_CLOSE = '\uE001'
const HOLD_RE = /(\uFDD0+)([\uE010-\uE019]+)\uE001/g
// A string that is one whole placeholder and nothing else (`isHeld`, D2 fix round 1 (e)).
const HELD_ONLY_RE = new RegExp(`^${HOLD_RE.source}$`)

function holdOpenFor(segment) {
  let longest = 0
  for (const m of segment.matchAll(/\uFDD0+/g)) longest = Math.max(longest, m[0].length)
  return HOLD_SENTINEL.repeat(longest + 1)
}

function holdMarkup(held, html, open) {
  held.push(html)
  const digits = String(held.length - 1).replace(/[0-9]/g, (d) => String.fromCharCode(0xe010 + Number(d)))
  return open + digits + HOLD_CLOSE
}

function releaseMarkup(text, held, open, shown) {
  return text.replace(HOLD_RE, (whole, run, digits) => {
    if (run.length < open.length) return whole
    const idx = Number(digits.replace(/[\uE010-\uE019]/g, (c) => String(c.charCodeAt(0) - 0xe010)))
    if (idx >= held.length) return whole
    shown.add(idx)
    return run.slice(0, run.length - open.length) + releaseMarkup(held[idx], held, open, shown)
  })
}

/** Splits on fenced (```) AND inline (`) code and runs `fn` over each non-code segment only; code segments pass through untouched, byte-for-byte. */
function transformOutsideCode(text, fn) {
  CODE_RE.lastIndex = 0
  let result = ''
  let lastIndex = 0
  let m
  while ((m = CODE_RE.exec(text))) {
    result += fn(text.slice(lastIndex, m.index))
    result += m[0]
    lastIndex = CODE_RE.lastIndex
  }
  result += fn(text.slice(lastIndex))
  return result
}

function transformEmbeds(text, ctx) {
  return replaceClearOfCode(text, EMBED_RE, (_, rawTarget) => {
    // A trailing `|width` (Obsidian's embed-sizing syntax) is not a target
    // segment — strip it before resolving.
    const written = rawTarget.split('|')[0].trim()
    // O-8: the resolver drops a table-escaped pipe's `\` itself; this copy is the TEXT.
    const target = stripEscapedPipe(written)
    const resolvedPath = ctx.resolve(written)
    if (!resolvedPath) {
      // A missing NOTE reads as the note's name (`![[Ghost#Risk]]`, `![[Ghost.md]]`
      // -> `Ghost`), as the server's pending link does (D2 item 8,
      // `providers/obsidian.py::_transform_wiki_and_embeds`). Never a broken <img>.
      const bare = unresolvedBareTarget(target)
      if (!bare) return ctx.hold(unresolvedText(target))
      if (NOTE_RE.test(bare) || !isAttachmentName(bare)) {
        return ctx.hold(unresolvedText(bare.replace(NOTE_RE, '')))
      }
      // Live audit 2026-11-03, F3: a missing FILE is the live lane's notice. The plugin sends
      // it as a `missing` ref named by this same bare target, and the server writes
      // "<name> wasn't found in the vault." A failed media item (no bytes, no request) is
      // what the commit turns into that notice in place, listed under "Couldn't be copied"
      // and counted in Needs attention. ⚰️ It was the name as plain text: nothing said the
      // file was missing. Its ref is this adapter's own scheme, never a vault path.
      const ref = `${MISSING_REF_PREFIX}${bare}`
      return ctx.hold(`<img src="import-ref://${escapeAttr(ref)}">`,
        () => ctx.media.push({ ref, kind: 'image', name: basename(bare),
          failed: { reason: NOTICE_REASONS.notFound, sourceUrl: null } }))
    }

    const name = basename(resolvedPath)
    if (NOTE_RE.test(resolvedPath)) {
      // O-11: an embed of a NOTE is a link to that note, never an attachment chip that
      // would upload the `.md` as a file. It reads by the note's name, as the server
      // lane's does (`providers/obsidian.py`, Task 13).
      return noteLink(resolvedPath, name.replace(NOTE_RE, ''), ctx)
    }
    if (IMAGE_EXT.test(resolvedPath)) {
      const vfile = ctx.byPath.get(resolvedPath)
      return ctx.hold(`<img src="import-ref://${escapeAttr(resolvedPath)}">`,
        () => ctx.media.push({ ref: resolvedPath, vfile, kind: 'image', name }))
    }
    return fileChip(resolvedPath, name, ctx)
  }, true, ctx.net)
}

/**
 * A vault file that is not a note: an attachment chip, held, whose media item is listed
 * once the piece is shown (D2 item 4). The chip shows the file's NAME; `label` (the
 * rendered text of a wikilink's alias, D2 item 6) rides `data-label` when it differs.
 * ONE writer for every chip this adapter makes: an embed (`![[deck.pdf]]`) and a wikilink
 * to a file (`[[deck.pdf|the deck]]`, Plan B Task 8 fix round 1 and D2 fix round 1, I3).
 * `resolveVaultAnchors` turns a relative markdown link into the same attributes.
 */
function fileChip(resolvedPath, name, ctx, label = '') {
  const vfile = ctx.byPath.get(resolvedPath)
  const labelAttr = label && label !== name ? ` data-label="${escapeAttr(label)}"` : ''
  return ctx.hold(`<a data-type="attachmentChip" data-import-ref="${escapeAttr(resolvedPath)}" data-name="${escapeAttr(name)}"${labelAttr} href="import-ref://${escapeAttr(resolvedPath)}">${escapeHtml(name)}</a>`,
    () => ctx.media.push({ ref: resolvedPath, vfile, kind: 'file', name }))
}

/** A note link, held; listed in `links` once shown. */
function noteLink(resolvedPath, display, ctx) {
  const targetKey = `obsidian:${resolvedPath}`
  return ctx.hold(`<a data-import-link="${escapeAttr(targetKey)}">${escapeHtml(display)}</a>`,
    () => ctx.links.push({ targetKey }))
}

/** O-8: `[[Note\|alias]]` in a table cell -- the `\` escapes the pipe, it is not the name. */
function stripEscapedPipe(target) {
  return target.endsWith('\\') ? target.slice(0, -1).trimEnd() : target
}

function transformWikiLinks(text, ctx) {
  const piece = (rawTarget, rawAlias) => {
    // O-8: `[[Note\|alias]]` in a table cell -- the `\` escapes the pipe, it is not the
    // name. The resolver drops it for the lookup; `stripEscapedPipe` keeps it out of the text.
    const written = rawTarget.trim()
    const target = stripEscapedPipe(written)
    // D2 fix round 5 follow-up: an alias that runs onto the next line of a blockquote or
    // callout carries that line's `>` prefix, which is block syntax, not link text. The
    // server's markdown link loses it in the parse; the held link here never reaches one.
    const alias = rawAlias ? rawAlias.replace(/\n[ \t]*(?:>[ \t]?)+/g, '\n').trim() : ''
    if (alias && ctx.isHeld?.(alias)) {
      // D2 fix round 1 (e): an embed in alias position, `[[Plan|![[img.png]]]]`, is the
      // embed and then the link to Plan as `[[Plan]]` reads -- both kept, as the server
      // lane writes it. ⚰️ The image went inside the link and the link was lost.
      return alias + piece(rawTarget, '')
    }
    const resolvedPath = ctx.resolve(written)
    // A missing FILE whose name holds `#` (`[[report #2.pdf]]`) keeps its name;
    // anything else reads as Obsidian shows it (`wikilinkDisplay`, D2 item 8).
    const fileName = !resolvedPath && unresolvedBareTarget(target) !== stripFragment(target)
    const display = alias || (fileName ? target : wikilinkDisplay(target))
    if (!resolvedPath) return ctx.hold(unresolvedText(display))

    if (!NOTE_RE.test(resolvedPath)) {
      // A wikilink to a FILE (`[[q.pdf]]`, `[[q.pdf|the deck]]`, `[[chart.png]]`) is the
      // file chip (D2 fix round 1, I3; Plan B Task 8 fix round 1), as the server lane
      // makes it for the plugin's non-embed ref: no doc carries a note key for it, so a
      // note link would be dead. The alias, as rendered text, is its label (D2 item 6).
      return fileChip(resolvedPath, basename(resolvedPath), ctx, alias ? mdInlineText(alias).trim() : '')
    }
    return noteLink(resolvedPath, display, ctx)
  }
  // The image stays as written, for the markdown parse to read as any markdown image.
  const split = replaceClearOfCode(text, ALIAS_MD_IMAGE_RE,
    (_, rawTarget, image) => image + piece(rawTarget, ''), true, ctx.net)
  return replaceClearOfCode(split, WIKILINK_RE, (_, rawTarget, rawAlias) => piece(rawTarget, rawAlias),
    true, ctx.net)
}

// ---------------------------------------------------------------------------
// callouts (D2 item 1): THE server lane's two halves, step for step
// (`providers/obsidian.py::_split_callout_titles` / `_callouts_in_doc`).
// Before markdown: the marker line is split from the callout's body with an
// empty quote line, or markdown-it folds title and body into ONE paragraph.
// After it: each blockquote whose first paragraph opens with `[!type]` becomes
// the editor's callout node (`calloutNode.js`, an `<aside data-variant>`):
// `variant` from the type, the title (or the type, capitalised) as a bold
// first paragraph, then the rest of the quote. The fold marker `+`/`-` is
// dropped, as the server drops it. Fenced code is never touched.
// ⚰️ The client wrote `> **Title**`, a blockquote, and its marker regex let
// `\s*` run across the line end, so an untitled `> [!tip]` took the NEXT line
// as its title (parity fixtures 12, 16, 17).
// `[^\n]` stands for Python's `.`, which (unlike JS's) matches `\r`.
// ---------------------------------------------------------------------------
const CALLOUT_FENCE_RE = /```[\s\S]*?```|~~~[\s\S]*?~~~/g
const CALLOUT_LINE_RE = /^([ \t]{0,3}(?:>[ \t]?)+)\[![A-Za-z0-9_-]+\][+-]?[^\n]*$/
const QUOTE_PREFIX_RE = /^[ \t]{0,3}>/
const CALLOUT_MARK_RE = /^\[!([A-Za-z0-9_-]+)\][+-]?[ \t]*/
// Obsidian's callout types -> the editor's five (`calloutNode.js::CALLOUT_VARIANTS`).
// Any other type is a `note`. Mirrors `providers/obsidian.py::_CALLOUT_VARIANTS`.
const CALLOUT_VARIANTS = {
  note: 'note', info: 'info', success: 'success', warning: 'warning', danger: 'danger',
  tip: 'success', caution: 'warning', important: 'warning', bug: 'danger', failure: 'danger',
}

function splitCalloutTitles(text) {
  const linesPass = (part) => {
    const lines = part.split('\n')
    const out = []
    lines.forEach((line, i) => {
      out.push(line)
      const m = CALLOUT_LINE_RE.exec(line)
      const opensQuote = i === 0 || !QUOTE_PREFIX_RE.test(lines[i - 1])
      if (m && opensQuote && i + 1 < lines.length && QUOTE_PREFIX_RE.test(lines[i + 1])) {
        out.push(m[1].replace(/\s+$/, ''))
      }
    })
    return out.join('\n')
  }
  let result = ''
  let last = 0
  for (const m of text.matchAll(CALLOUT_FENCE_RE)) {
    result += linesPass(text.slice(last, m.index)) + m[0]
    last = m.index + m[0].length
  }
  return result + linesPass(text.slice(last))
}

function calloutsInHtml(html) {
  if (!html.includes('[!')) return html
  const doc = new DOMParser().parseFromString(html, 'text/html')
  // Innermost first, as the server converts a node's children before the node.
  for (const quote of [...doc.querySelectorAll('blockquote')].reverse()) {
    const first = quote.firstElementChild
    const lead = first?.tagName === 'P' ? first.firstChild : null
    if (!lead || lead.nodeType !== 3) continue // TEXT_NODE, with no mark around it
    const m = CALLOUT_MARK_RE.exec(lead.data)
    if (!m) continue
    const kind = m[1]
    lead.data = lead.data.slice(m[0].length)
    if (!lead.data) lead.remove()
    const title = doc.createElement('p')
    const bold = doc.createElement('strong')
    if ((first.textContent || '').trim()) {
      while (first.firstChild) bold.appendChild(first.firstChild)
    } else {
      bold.textContent = capitalize(kind)
    }
    title.appendChild(bold)
    const aside = doc.createElement('aside')
    aside.setAttribute('data-variant', CALLOUT_VARIANTS[kind.toLowerCase()] || 'note')
    aside.appendChild(title)
    first.remove()
    while (quote.firstChild) aside.appendChild(quote.firstChild)
    quote.replaceWith(aside)
  }
  return doc.body.innerHTML
}

function transformHighlights(text) {
  return text.replace(HIGHLIGHT_RE, (_, lead, inner) => `${lead}<mark>${escapeHtml(inner)}</mark>`)
}

// ---------------------------------------------------------------------------
// relative and deep-link anchors (O-5, `obsidian://`), after resolveRelativeMedia
// ---------------------------------------------------------------------------

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i
const OBSIDIAN_URI_RE = /^obsidian:/i

/**
 * Every `<a href>` resolveRelativeMedia left relative, and every `obsidian://open` link:
 * a note -> `data-import-link` (pushed onto `links`); any other vault file -> an attachment
 * chip plus its media item; an image target is left (images ride `<img>`). A miss is left
 * as written, for the post-parse pass to make it text. Never resolved against a web origin.
 */
function resolveVaultAnchors(html, ctx, root) {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  for (const a of [...doc.querySelectorAll('a[href]')]) {
    const href = a.getAttribute('href') || ''
    let resolvedPath = null
    if (OBSIDIAN_URI_RE.test(href)) {
      resolvedPath = resolveDeepLink(href, ctx, root)
      if (!resolvedPath || !NOTE_RE.test(resolvedPath)) continue
    } else {
      if (!href || href.startsWith('#') || href.startsWith('//') || SCHEME_RE.test(href)) continue
      resolvedPath = ctx.resolve(href, { decode: true })
      if (!resolvedPath || IMAGE_EXT.test(resolvedPath)) continue
    }
    if (NOTE_RE.test(resolvedPath)) {
      const targetKey = `obsidian:${resolvedPath}`
      a.removeAttribute('href')
      a.setAttribute('data-import-link', targetKey)
      ctx.links.push({ targetKey })
      continue
    }
    const vfile = ctx.byPath.get(resolvedPath)
    if (!vfile) continue
    // Post-merge fix 3: the same chip, label included, as the beside-the-note path writes.
    const name = markAttachmentChip(a, resolvedPath)
    ctx.media.push({ ref: resolvedPath, vfile, kind: 'file', name })
  }
  return doc.body.innerHTML
}

/** `obsidian://open?vault=<v>&file=<f>` -> the path `f` names, as a wikilink target
 *  (`URLSearchParams` has already decoded it once). A drop whose vault folder has a name
 *  answers only for that name; another vault's link is not this import's to resolve.
 *
 *  Plan B final review, fix 2: with NO vault root (no `.obsidian/` above the note) a `vault`
 *  parameter must equal the drop's top folder name (`dropTopFolder`: the one first path
 *  segment every dropped file shares), compared EXACTLY -- case-sensitive, after trimming
 *  whitespace, as Obsidian matches a vault by its name. A drop with no single top folder, or
 *  a different name, cannot show the link is into THIS vault, so it stays text: resolving
 *  `vault=Personal&file=Plan` by name across the whole drop opened the wrong vault's note.
 *  No `vault` parameter at all: resolved as before. With a vault root the comparison is
 *  unchanged (the root folder's name, any case). */
function resolveDeepLink(href, ctx, root) {
  let url
  try {
    url = new URL(href)
  } catch {
    return null
  }
  if (url.hostname.toLowerCase() !== 'open') return null
  const file = (url.searchParams.get('file') || '').trim()
  const vault = (url.searchParams.get('vault') || '').trim()
  if (!file) return null
  if (root && vault && vault.toLowerCase() !== basename(root).toLowerCase()) return null
  if (!root && vault && vault !== ctx.topFolder) return null
  return ctx.resolve(file)
}

/** The first path segment every file in the drop shares (the folder the member dropped),
 *  or null when files sit at the drop top or under different folders. */
function dropTopFolder(vfiles) {
  let top = null
  for (const v of vfiles) {
    const path = String(v.path || '')
    const slash = path.indexOf('/')
    if (slash <= 0) return null
    const seg = path.slice(0, slash)
    if (top === null) top = seg
    else if (seg !== top) return null
  }
  return top
}

function stripFragment(target) {
  const idx = target.indexOf('#')
  return idx === -1 ? target : target.slice(0, idx).trim()
}

/**
 * What a wikilink with no alias shows, as Obsidian shows it: `Note#Risk` reads
 * `Note > Risk`; a block reference (`Note#^abc123`) reads just `Note`;
 * `[[#Risk]]` (this note's own heading) reads `Risk`. Mirrors
 * `providers/obsidian.py::_wikilink_display` (D2 item 8). ⚰️ It showed the
 * target as written, `Note#Risk`.
 */
function wikilinkDisplay(rawTarget) {
  const idx = rawTarget.indexOf('#')
  if (idx === -1) return rawTarget
  const note = rawTarget.slice(0, idx).trim()
  const anchor = rawTarget.slice(idx + 1).trim()
  if (anchor.startsWith('^') || !anchor) return note || rawTarget
  return note ? `${note} > ${anchor}` : anchor
}

// THE extensions an unresolved target reads as a FILE, not a note. ⛔ The same
// list as `providers/obsidian.py::_UNSENT_ATTACHMENT_EXTS`, pinned against it by
// `test_obsidian_provider.py::test_the_client_attachment_extensions_are_the_servers`.
const ATTACHMENT_EXTS = new Set((
  'png jpg jpeg gif webp bmp svg heic heif tif tiff avif ' +
  'pdf doc docx xls xlsx ppt pptx odt ods odp rtf csv tsv txt json xml ' +
  'zip 7z rar gz tar ' +
  'mp3 m4a wav ogg flac aac opus ' +
  'mp4 mov m4v webm mkv avi ' +
  'canvas epub'
).split(' '))

function isAttachmentName(path) {
  const name = basename(path)
  const idx = name.lastIndexOf('.')
  return idx > 0 && ATTACHMENT_EXTS.has(name.slice(idx + 1).toLowerCase())
}

/**
 * The name an UNRESOLVED target stands for, for the fallbacks that ask "is
 * this a file?": the FULL text when it holds a `#` and its own extension is an
 * attachment's (`my chart #1 (v2).png` is a file NAME), else the target with its
 * anchor split off. Mirrors `providers/obsidian.py::_unresolved_bare_target`.
 */
function unresolvedBareTarget(target) {
  const whole = target.trim()
  if (whole.includes('#') && isAttachmentName(whole)) return whole
  return stripFragment(whole)
}

// ---------------------------------------------------------------------------
// small path/text helpers (mirrors adapters/generic.js and adapters/notion.js
// — kept self-contained per-adapter, matching the existing pattern rather
// than sharing internals)
// ---------------------------------------------------------------------------

async function readText(vfile) {
  const bytes = await vfile.bytes()
  return new TextDecoder('utf-8').decode(bytes)
}

function basename(path) {
  return path.split('/').pop()
}

function dirOf(path) {
  const idx = path.lastIndexOf('/')
  return idx === -1 ? '' : path.slice(0, idx)
}

function filenameSansExt(name) {
  const idx = name.lastIndexOf('.')
  return idx > 0 ? name.slice(0, idx) : name
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

function extractH1Title(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const h1 = doc.querySelector('h1')
  const text = h1?.textContent?.trim()
  return text || null
}

// An unresolved wikilink/embed reads as its plain text, and must STAY plain
// text: markdown-it's linkify would turn `Ghost.Name` (`.name` is a real TLD)
// into a link to `http://Ghost.Name`, a wrong link where the member wrote a
// note name (D1 fix round 2). An entity-encoded dot is a separate token that
// linkify never sees; it renders as `.`. Always HELD (`holdMarkup`), so no
// later pass escapes the entity into visible text.
function unresolvedText(s) {
  return escapeHtml(s).replace(/\./g, '&#46;')
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, '&quot;')
}

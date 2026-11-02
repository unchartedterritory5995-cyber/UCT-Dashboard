import { generateJSON, getSchema } from '@tiptap/core'
import { Fragment } from '@tiptap/pm/model'
import { buildExtensions, extractPlainText } from '../tiptap'
import { heldBody } from './uctJson'

const BANNED_TAGS = new Set(['SCRIPT', 'IFRAME', 'FORM', 'OBJECT', 'EMBED', 'STYLE', 'LINK', 'META'])

export function sanitizeHtml(html) {
  return sanitizeDoc(new DOMParser().parseFromString(html || '', 'text/html')).body.innerHTML
}

function sanitizeDoc(doc) {
  // Remove banned tags by checking tagName.toUpperCase() to handle SVG/MathML foreign content
  ;[...doc.getElementsByTagName('*')].forEach((el) => {
    if (BANNED_TAGS.has(el.tagName.toUpperCase())) el.remove()
  })
  doc.querySelectorAll('*').forEach((el) => {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase()
      const val = (attr.value || '').trim().toLowerCase()
      if (name.startsWith('on')) el.removeAttribute(attr.name)
      if ((name === 'href' || name === 'src') &&
          (val.startsWith('javascript:') || val.startsWith('data:text'))) {
        el.removeAttribute(attr.name)
      }
    }
  })
  mapCheckboxLists(doc)
  mapCalloutsAndToggles(doc)
  mapMathCode(doc)
  rewriteImportLinks(doc)
  return doc
}

// Wave 8 lane 8C: our web-page export writes a formula as its TeX in `<code class="math">`
// (a display equation inside a `<pre>`, ruling D-C2). Here that becomes the math node's own
// HTML (`mathNodes.js` parses `span|div[data-type=…-math][data-latex]`), so a formula
// re-imports as a formula, not as a code span holding its source.
export function mapMathCode(doc) {
  doc.querySelectorAll('code.math').forEach((code) => {
    const latex = code.textContent || ''
    const pre = code.parentElement?.tagName === 'PRE' && code.parentElement.children.length === 1
      ? code.parentElement : null
    const el = doc.createElement(pre ? 'div' : 'span')
    el.setAttribute('data-type', pre ? 'block-math' : 'inline-math')
    el.setAttribute('data-latex', latex)
    ;(pre || code).replaceWith(el)
  })
}

// The adapters (Notion/Obsidian) emit `<a data-import-link="<targetKey>">` for
// a doc-to-doc link, deliberately WITHOUT an href (the raw export-relative
// path has no meaning post-import). generateJSON only turns an <a> into a
// Link mark when it has an href the Link extension accepts, so here we stamp
// a temporary `href="import-link://<targetKey>"` placeholder — the Link
// extension's isAllowedUri (tiptap.js) explicitly allows that scheme. Task
// 13's rewriteBody resolves it to the real note URL (or drops the mark) once
// the target's real note id is known post-confirm.
export function rewriteImportLinks(doc) {
  doc.querySelectorAll('a[data-import-link]').forEach((a) => {
    const key = a.getAttribute('data-import-link')
    if (key) a.setAttribute('href', `import-link://${key}`)
    a.removeAttribute('data-import-link')
  })
}

// A leading emoji + optional single trailing space, e.g. "\u{1F4A1} tip".
// One grapheme + an optional variation selector (built via fromCharCode
// rather than embedded as a literal source character, which is invisible
// and easy to corrupt in an editor) — covers the overwhelming majority of
// Notion's own callout icon set (single-codepoint emoji). A ZWJ/skin-tone-
// modifier sequence simply doesn't match, and the whole line is kept as body
// text with the default emoji — degraded, never dropped.
const VARIATION_SELECTOR_16 = String.fromCharCode(0xfe0f)
const LEADING_EMOJI_RE = new RegExp(`^(\\p{Extended_Pictographic}${VARIATION_SELECTOR_16}?)[ \\t]*`, 'u')

// Notion's classic Markdown export represents a callout as `<aside>…</aside>`
// (emoji inline as the leading character of the text) and a toggle as
// `<details><summary>…</summary>…</details>` — see calloutNode.js/
// toggleNode.js for the evidence this is built against. Both HTML islands
// pass through `mdToHtml` untouched (per notion.js's own docstring, "for the
// converter" — this is that converter); this is where they become something
// the Callout/Toggle node schemas can parse.
export function mapCalloutsAndToggles(doc) {
  doc.querySelectorAll('aside').forEach((aside) => {
    aside.setAttribute('data-type', 'callout')
    const first = aside.childNodes[0]
    if (first && first.nodeType === 3) { // TEXT_NODE
      const trimmed = first.textContent.replace(/^\s+/, '')
      const m = LEADING_EMOJI_RE.exec(trimmed)
      if (m) {
        aside.setAttribute('data-emoji', m[1])
        first.textContent = trimmed.slice(m[0].length)
      }
    }
  })

  doc.querySelectorAll('details').forEach((details) => {
    details.setAttribute('data-type', 'toggle')
    // Imported toggles start OPEN regardless of the source's own `open`
    // attribute (classic export never carries it meaningfully): a freshly
    // migrated library should read as "everything arrived", not require
    // clicking every toggle to confirm nothing was lost.
    details.setAttribute('data-open', 'true')

    let summary = details.querySelector(':scope > summary')
    if (!summary) {
      // Malformed/older source with no <summary> — synthesize an empty one
      // rather than dropping the whole block (the toggle schema requires
      // exactly one toggleSummary child).
      summary = doc.createElement('summary')
      details.insertBefore(summary, details.firstChild)
    }
    summary.setAttribute('data-type', 'toggleSummary')

    const wrap = doc.createElement('div')
    wrap.setAttribute('data-type', 'toggleContent')
    let node = summary.nextSibling
    while (node) {
      const next = node.nextSibling
      wrap.appendChild(node)
      node = next
    }
    details.appendChild(wrap)
  })
}

export function mapCheckboxLists(doc) {
  doc.querySelectorAll('li').forEach((li) => {
    const box = li.querySelector(':scope > input[type=checkbox], :scope > p > input[type=checkbox], :scope > label > input[type=checkbox], :scope > p > label > input[type=checkbox]')
    if (!box && !li.classList.contains('task-list-item')) return
    li.setAttribute('data-type', 'taskItem')
    li.setAttribute('data-checked', box?.checked || box?.hasAttribute('checked') ? 'true' : 'false')
    box?.remove()
  })
  // Wave 10 (lane 10B, found by the R-18 census's Logseq fixture): a list that
  // MIXES plain bullets and to-dos -- ordinary in Obsidian, Notion, Logseq and
  // Roam Markdown -- used to have its whole <ul> typed `taskList`. TipTap's
  // schema allows only taskItems in a taskList, so every plain bullet was
  // lifted out and an EMPTY unticked to-do was left in its place. The list is
  // now split into runs in the source's own order -- taskList / bulletList /
  // taskList -- the rule the server lane already follows
  // (`__fixtures__/server_convert/02-mixed-task-list.json`, from `mddoc.py`).
  const isTask = (li) => li.getAttribute('data-type') === 'taskItem'
  doc.querySelectorAll('ul').forEach((ul) => {
    const items = [...ul.children].filter((c) => c.tagName === 'LI')
    if (!items.some(isTask)) return
    if (items.every(isTask)) {
      ul.setAttribute('data-type', 'taskList')
      return
    }
    // ⛔ EVERY child moves, in order -- not only the <li>s (review I-1). An
    // indented sub-list written as a DIRECT child <ul> (what contenteditable
    // indent emits) or a stray text run sits between items; filtering to LI
    // and then removing the original <ul> deleted them silently. A non-LI
    // node rides with the run it sits in (a plain run when it comes first).
    let run = null
    let runIsTask = null
    for (const node of [...ul.childNodes]) {
      const isLi = node.nodeType === 1 && node.tagName === 'LI'
      const task = isLi ? isTask(node) : runIsTask ?? false
      if (!run || (isLi && task !== runIsTask)) {
        run = doc.createElement('ul')
        if (task) run.setAttribute('data-type', 'taskList')
        ul.parentNode.insertBefore(run, ul)
        runIsTask = task
      }
      run.appendChild(node)
    }
    ul.remove()
  })
}

// ── D2 item 5: a block atom splitting a paragraph ───────────────────────────
//
// An image or an attachment chip is a BLOCK node, so ProseMirror's parser closes the
// paragraph around it. Two artifacts came of that, in every file importer:
//   (a) `<p><img></p>` (a markdown image alone on its line) left an EMPTY paragraph
//       before the image: the `<p>` was opened explicitly, then closed with nothing in it;
//   (b) the text before the atom lost its trailing space (`Read ` read `Read`), because
//       the parser strips trailing whitespace from a block it closes.
// The server lane hoists the atom and keeps both texts as written (`mddoc._wrap_paragraph`).
// Here each such edge gets a MARKER before parsing, and the marker comes out after: for
// (a) a marker text where the empty paragraph would be (that paragraph is then dropped,
// unless the schema needs it, e.g. a list item's first paragraph), and for (b) a marker
// right after the trailing space, so the space is no longer trailing when the parser
// closes the block. Nothing else in the parse changes.
// ⛔ The marker is a Unicode noncharacter the note does NOT contain (the first of
// U+FDD0-U+FDEF absent from the HTML), so the member's own text is never taken for it.
// A note holding all 32 keeps today's parse.
const BLOCK_ATOMS = 'img, a[data-type="attachmentChip"]'
const WS_END_RE = /[ \t\r\n\f]$/
const NON_WS_RE = /[^ \t\r\n\f]/

function pickMarker(html) {
  for (let code = 0xfdd0; code <= 0xfdef; code += 1) {
    const ch = String.fromCharCode(code)
    if (!html.includes(ch)) return ch
  }
  return null
}

function lastTextIn(node) {
  if (!node) return null
  if (node.nodeType === 3) return node
  for (let child = node.lastChild; child; child = child.previousSibling) {
    const found = lastTextIn(child)
    if (found) return found
  }
  return null
}

function markBlockAtomEdges(doc, marker) {
  let marked = 0
  for (const atom of doc.body.querySelectorAll(BLOCK_ATOMS)) {
    let prev = atom.previousSibling
    while (prev && prev.nodeType === 3 && !NON_WS_RE.test(prev.data)) prev = prev.previousSibling
    if (!prev) {
      // (a) the atom opens its paragraph: mark the paragraph the parser would leave empty.
      if (atom.parentElement?.tagName === 'P') {
        atom.before(doc.createTextNode(marker))
        marked += 1
      }
      continue
    }
    // (b) the text right before the atom ends in whitespace: keep it from trailing.
    const text = lastTextIn(atom.previousSibling)
    if (text && WS_END_RE.test(text.data) && NON_WS_RE.test(text.data)) {
      text.data += marker
      marked += 1
    }
  }
  return marked
}

function isBlank(node) {
  return (node.content || []).every((c) => c.type === 'text' && !NON_WS_RE.test(c.text))
}

// Takes the marker out of every text, and drops a paragraph the marker left blank, unless
// its parent's schema needs it there. Returns [the cleaned node, whether it held a marker].
function dropMarker(node, marker, schema) {
  if (!Array.isArray(node.content)) return [node, false]
  let had = false
  const content = [] // { node, ours }: `ours` is a blank paragraph only the marker made
  for (const child of node.content) {
    if (child.type === 'text' && typeof child.text === 'string' && child.text.includes(marker)) {
      had = true
      const text = child.text.split(marker).join('')
      if (text) content.push({ node: { ...child, text }, ours: false })
      continue
    }
    const [clean, childHad] = dropMarker(child, marker, schema)
    content.push({ node: clean, ours: childHad && clean.type === 'paragraph' && isBlank(clean) })
  }
  let kept = content.filter((c) => !c.ours)
  if (kept.length !== content.length) {
    const type = schema.nodes[node.type]
    if (!type || !type.validContent(Fragment.fromJSON(schema, kept.map((c) => c.node)))) kept = content
  }
  const out = { ...node }
  if (kept.length) out.content = kept.map((c) => c.node)
  else delete out.content
  return [out, had]
}

let _ext
let _schema
export function htmlToNote(html) {
  // A body the importer already holds (a note from our own JSON export) is answered with
  // that body, never re-derived from HTML it does not have (`uctJson.js::heldBody`).
  const held = heldBody(html)
  if (held) return { bodyJson: held, bodyPlain: extractPlainText(held) }
  _ext = _ext || buildExtensions()
  const doc = sanitizeDoc(new DOMParser().parseFromString(html || '', 'text/html'))
  // ⛔ Picked against the DECODED document, never the raw string: a noncharacter written
  // as an entity (`&#xFDD0;`) is only a character once parsed (D2 fix round 1, M1). The
  // serializer writes every text and attribute character back as itself (it escapes only
  // `&`, `<`, `>`, `"` and U+00A0), so `innerHTML` holds each one the member wrote.
  const marker = pickMarker(doc.body.innerHTML)
  const marked = marker ? markBlockAtomEdges(doc, marker) : 0
  let bodyJson = generateJSON(doc.body.innerHTML, _ext)
  if (marked) {
    _schema = _schema || getSchema(_ext)
    bodyJson = dropMarker(bodyJson, marker, _schema)[0]
  }
  return { bodyJson, bodyPlain: extractPlainText(bodyJson) }
}

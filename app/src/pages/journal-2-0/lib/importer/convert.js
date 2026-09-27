import { generateJSON } from '@tiptap/core'
import { buildExtensions, extractPlainText } from '../tiptap'
import { heldBody } from './uctJson'

const BANNED_TAGS = new Set(['SCRIPT', 'IFRAME', 'FORM', 'OBJECT', 'EMBED', 'STYLE', 'LINK', 'META'])

export function sanitizeHtml(html) {
  const doc = new DOMParser().parseFromString(html || '', 'text/html')
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
  return doc.body.innerHTML
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
    li.closest('ul')?.setAttribute('data-type', 'taskList')
  })
}

let _ext
export function htmlToNote(html) {
  // A body the importer already holds (a note from our own JSON export) is answered with
  // that body, never re-derived from HTML it does not have (`uctJson.js::heldBody`).
  const held = heldBody(html)
  if (held) return { bodyJson: held, bodyPlain: extractPlainText(held) }
  _ext = _ext || buildExtensions()
  const bodyJson = generateJSON(sanitizeHtml(html), _ext)
  return { bodyJson, bodyPlain: extractPlainText(bodyJson) }
}

import { generateJSON } from '@tiptap/core'
import { buildExtensions, extractPlainText } from '../tiptap'

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
  rewriteImportLinks(doc)
  return doc.body.innerHTML
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
  _ext = _ext || buildExtensions()
  const bodyJson = generateJSON(sanitizeHtml(html), _ext)
  return { bodyJson, bodyPlain: extractPlainText(bodyJson) }
}

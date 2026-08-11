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
  return doc.body.innerHTML
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

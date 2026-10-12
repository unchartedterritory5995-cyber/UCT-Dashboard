// Notebook P1: the style editor writes an outline as text. A line starting "## " is a heading; a line
// that is exactly {{block:id}} is a block placeholder; an empty line is an empty paragraph.
// Pure: no imports. docToOutlineText(outlineTextToDoc(t)) === t for text made of those three line kinds.
// ⛔ The text format is LOSSY for anything richer (lists, marks, links, images, other headings). A caller
// must ask outlineIsExpressible(doc) before it shows a stored outline as text, and must never save a doc
// that went through the text box unless the member changed the text.
const PH = /^\{\{block:[a-zA-Z][a-zA-Z0-9_]{0,40}\}\}$/
const text = (n) => (n.content || []).filter((c) => c.type === 'text').map((c) => c.text || '').join('')

export function outlineTextToDoc(src) {
  const lines = String(src || '').split('\n')
  if (lines.length === 1 && lines[0] === '') return { type: 'doc', content: [] }
  const content = []
  for (const line of lines) {
    if (line.startsWith('## ')) {
      const t = line.slice(3)
      if (!t.trim()) continue                    // a bare "## " would be an empty text node, which the schema refuses
      content.push({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: t }] })
    } else if (!line.trim()) {
      content.push({ type: 'paragraph' })
    } else {
      content.push({ type: 'paragraph', content: [{ type: 'text', text: PH.test(line.trim()) ? line.trim() : line }] })
    }
  }
  return { type: 'doc', content }
}

export function docToOutlineText(doc) {
  return (doc?.content || []).map((n) => {
    if (n.type === 'heading') return `## ${text(n)}`
    return text(n)
  }).join('\n')
}

/** True when the text format can hold `doc` without losing anything: only h2 headings and paragraphs
 *  made of unmarked, single-line text, none of which would read back as a different line kind. */
export function outlineIsExpressible(doc) {
  if (doc == null) return true
  if (typeof doc !== 'object' || doc.type !== 'doc') return false
  if (doc.content == null) return true
  if (!Array.isArray(doc.content)) return false
  return doc.content.every((n) => {
    if (!n || typeof n !== 'object') return false
    if (n.type !== 'heading' && n.type !== 'paragraph') return false
    if (n.type === 'heading' && (n.attrs?.level ?? 2) !== 2) return false
    const kids = n.content ?? []
    if (!Array.isArray(kids)) return false
    const plain = kids.every((c) => c && c.type === 'text' && typeof c.text === 'string'
      && !(c.marks && c.marks.length) && !c.text.includes('\n'))
    if (!plain) return false
    const t = kids.map((c) => c.text).join('')
    if (n.type === 'heading') return t.trim() !== ''
    return !t.startsWith('## ') && (t === '' || t.trim() !== '')
  })
}

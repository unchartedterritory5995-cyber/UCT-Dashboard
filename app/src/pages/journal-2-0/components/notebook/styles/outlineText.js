// Notebook P1: the style editor writes an outline as text. A line starting "## " is a heading; a line
// that is exactly {{block:id}} is a block placeholder; an empty line is an empty paragraph.
// Pure: no imports. docToOutlineText(outlineTextToDoc(t)) === t for text made of those three line kinds.
const PH = /^\{\{block:[a-zA-Z][a-zA-Z0-9_]{0,40}\}\}$/
const text = (n) => (n.content || []).filter((c) => c.type === 'text').map((c) => c.text || '').join('')

export function outlineTextToDoc(src) {
  const lines = String(src || '').split('\n')
  if (lines.length === 1 && lines[0] === '') return { type: 'doc', content: [] }
  return {
    type: 'doc',
    content: lines.map((line) => {
      if (line.startsWith('## ')) {
        return { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: line.slice(3) }] }
      }
      if (!line.trim()) return { type: 'paragraph' }
      return { type: 'paragraph', content: [{ type: 'text', text: PH.test(line.trim()) ? line.trim() : line }] }
    }),
  }
}

export function docToOutlineText(doc) {
  return (doc?.content || []).map((n) => {
    if (n.type === 'heading') return `## ${text(n)}`
    return text(n)
  }).join('\n')
}

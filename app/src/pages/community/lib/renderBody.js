import { generateHTML } from '@tiptap/core'
import { buildCommunityExtensions } from './tiptapExtensions'

const EXTENSIONS = buildCommunityExtensions()

// Defense-in-depth vs stored XSS: bodies are user-supplied JSON POSTed to the
// API, so a crafted doc could carry javascript: hrefs or foreign image srcs.
// Whitelist link/image destinations before generating HTML.
function sanitizeNode(node) {
  if (!node || typeof node !== 'object') return node
  if (Array.isArray(node.marks)) {
    node.marks = node.marks.filter((m) => {
      if (m?.type !== 'link') return true
      const href = m?.attrs?.href || ''
      return href.startsWith('https://')
    })
  }
  if (node.type === 'image') {
    const src = node?.attrs?.src || ''
    if (!src.startsWith('/api/community/images/') && !src.startsWith('https://')) return null
  }
  if (Array.isArray(node.content)) {
    node.content = node.content.map(sanitizeNode).filter(Boolean)
  }
  return node
}

export function renderBodyHTML(bodyJson) {
  if (!bodyJson) return ''
  try {
    const doc = sanitizeNode(JSON.parse(bodyJson))
    if (!doc || doc.type !== 'doc') return ''
    return generateHTML(doc, EXTENSIONS)
  } catch {
    return ''
  }
}

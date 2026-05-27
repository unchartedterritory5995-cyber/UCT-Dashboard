/**
 * Journal 2.0 — Notebook TipTap configuration.
 * Spec: docs/superpowers/specs/2026-05-26-notebook-design.md §5.3
 */

import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import { SlashMenuExtension } from '../components/notebook/SlashMenu'

export function buildExtensions({ placeholder = 'Start writing… or type / for blocks' } = {}) {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
    }),
    Image.configure({ inline: false, allowBase64: false }),
    Link.configure({
      openOnClick: false,
      autolink: true,
      protocols: ['https'],
      HTMLAttributes: { rel: 'noreferrer', target: '_blank' },
    }),
    Placeholder.configure({ placeholder }),
    SlashMenuExtension,
  ]
}

/**
 * Upload an image File to /api/j2/notes/{noteId}/images and return
 * the public URL. Used by the editor's drag-paste handler + the
 * toolbar "insert image" button.
 */
export async function uploadInlineImage(noteId, file) {
  const fd = new FormData()
  fd.append('file', file)
  const res = await fetch(`/api/j2/notes/${noteId}/images`, {
    method: 'POST', credentials: 'include', body: fd,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.detail || `Upload failed (${res.status})`)
  }
  return res.json() // { url, width, height }
}

/**
 * Walk a TipTap doc and concatenate every text node, space-separated.
 * Mirrors the server's extract_plain_text in notes.py.
 */
export function extractPlainText(doc) {
  if (!doc || typeof doc !== 'object') return ''
  const out = []
  const walk = (node) => {
    if (!node || typeof node !== 'object') return
    if (node.type === 'text' && typeof node.text === 'string') out.push(node.text)
    for (const child of node.content || []) walk(child)
  }
  walk(doc)
  return out.filter(Boolean).join(' ')
}

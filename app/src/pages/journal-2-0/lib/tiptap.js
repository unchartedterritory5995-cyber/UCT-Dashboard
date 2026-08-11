/**
 * Journal 2.0 — Notebook TipTap configuration.
 * Spec: docs/superpowers/specs/2026-05-26-notebook-design.md §5.3
 */

import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table'
import { TaskList, TaskItem } from '@tiptap/extension-list'
import { SlashMenuExtension } from '../components/notebook/SlashMenu'
import { VideoTimestamp } from './videoTimestampNode'
import { AttachmentChip } from './attachmentChip'
import { fmtTime } from '../../../components/video/playerUtils'

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
      // '/journal...' is the shipped internal-note-link form; 'import-link://<targetKey>'
      // is the TEMPORARY placeholder the import pipeline round-trips through generateJSON
      // before rewriteBody resolves it. Without this allowance the Link mark is stripped
      // at parse time and every wiki-link import silently dies.
      isAllowedUri: (url, ctx) => url.startsWith('/journal') || url.startsWith('import-link://') || ctx.defaultValidate(url),
      HTMLAttributes: { rel: 'noreferrer', target: '_blank' },
    }),
    Placeholder.configure({ placeholder }),
    Table.configure({ resizable: false }), TableRow, TableHeader, TableCell,
    TaskList, TaskItem.configure({ nested: true }),
    AttachmentChip,
    SlashMenuExtension,
    VideoTimestamp,
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
    if (node.type === 'videoTimestamp') out.push(`[${fmtTime(node.attrs?.seconds || 0)}]`)
    if (node.type === 'attachmentChip') out.push(`[file: ${node.attrs?.name || 'file'}]`)
    for (const child of node.content || []) walk(child)
  }
  walk(doc)
  return out.filter(Boolean).join(' ')
}

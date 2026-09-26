/**
 * Journal 2.0 — Notebook TipTap configuration.
 * Spec: docs/superpowers/specs/2026-05-26-notebook-design.md §5.3
 */

import StarterKit from '@tiptap/starter-kit'
import { TextStyle, FontFamily, FontSize } from '@tiptap/extension-text-style'
import { ResizableImage } from './resizableImage'
import Link from '@tiptap/extension-link'
import { NotebookPlaceholder } from './notebookPlaceholder'
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table'
import { TaskList, TaskItem } from '@tiptap/extension-list'
import { SlashMenuExtension } from '../components/notebook/SlashMenu'
import { EmojiMenuExtension } from '../components/notebook/EmojiMenu'
import { VideoTimestamp } from './videoTimestampNode'
import { AttachmentChip } from './attachmentChip'
import { WidgetEmbed } from './widgetEmbedNode'
import { Callout } from './calloutNode'
import { Toggle, ToggleSummary, ToggleContent } from './toggleNode'
import { NoteFind } from './noteFindExtension'
import { NoteLink } from './noteLinkNode'
import { NoteLinkMenuExtension } from '../components/notebook/NoteLinkMenu'
import { FinancialFact } from './financialFactNode'
import { DocumentExcerpt } from './documentExcerptNode'
import { AskInsert } from './askInsertNode'
import { AskCitation } from './askCitationNode'
import { PasteContainers } from './pasteContainers'
import { NotebookCodeBlock } from './codeBlockNode'
import { Mathematics } from './mathNodes'
import { TextColor, NotebookHighlight } from './textColor'
import { fmtTime } from '../../../components/video/playerUtils'
import { citationLeafText } from './askCitation'
import { getSchema } from '@tiptap/core'
// Wave 5: how the newer content reads on EVERY surface that renders a note
// body — imported here because every one of them builds from this roster.
import './noteContent.css'

export function buildExtensions({ placeholder = 'Start writing… or type / for blocks and charts' } = {}) {
  return [
    StarterKit.configure({
      // Wave 5: H4–H6. ⛔ With [1, 2, 3], TipTap renders a stored level-4
      // heading as <h1> (renderHTML falls back to levels[0]) and an imported
      // or pasted <h4>–<h6> parses as a plain paragraph -- the level is lost.
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      // Wave 5: replaced by NotebookCodeBlock below (same node name, same
      // `language` attr, same HTML) — lowlight highlighting + a language
      // picker. Two `codeBlock` extensions would register two node types of
      // one name; the stock one must be off.
      codeBlock: false,
      // StarterKit v3 bundles its own unconfigured Link internally. Schema-level
      // mark parsing dedups (our explicit Link below wins), but ProseMirror
      // PLUGINS are NOT deduped — both copies register a click handler, and
      // StarterKit's default openOnClick:true fires after ours returns false,
      // calling window.open(href) on every link click and defeating the
      // explicit openOnClick:false below. Disabling it here is load-bearing.
      link: false,
    }),
    // ⛔ Listed where StarterKit's own code block sat (first), so its plugins
    // keep the order they had — including the VS Code paste handler, which
    // PasteContainers (last) must still precede. See PasteContainers below.
    NotebookCodeBlock,
    // Text styling: a shared TextStyle mark carrying font-family + font-size,
    // driven by the editor toolbar's Font + Size dropdowns.
    TextStyle,
    FontFamily,
    FontSize,
    // Wave 5: text colour + highlight, stored as a palette NAME and rendered
    // through classes (textColor.js), so a colour follows the member's theme.
    TextColor,
    NotebookHighlight,
    ResizableImage.configure({ inline: false, allowBase64: false }),
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
    // G-035: NotebookPlaceholder, not the stock @tiptap/extension-placeholder --
    // see the header comment on notebookPlaceholder.js for the measured reason.
    NotebookPlaceholder.configure({ placeholder }),
    Table.configure({ resizable: false }), TableRow, TableHeader, TableCell,
    TaskList, TaskItem.configure({ nested: true }),
    AttachmentChip,
    SlashMenuExtension,
    // Wave 5: `:` emoji picker -- inserts plain Unicode text (no node type).
    EmojiMenuExtension,
    VideoTimestamp,
    // ⚠️ Never remove: TipTap DROPS unknown node types at parse time, so
    // unregistering WidgetEmbed would delete every embed from every note on
    // next open. Unknown WIDGETS are handled inside its node view.
    WidgetEmbed,
    // Notion's two most common structural blocks (callouts and toggles) —
    // see calloutNode.js / toggleNode.js. Same "never remove" rule as
    // WidgetEmbed above once notes containing these exist.
    Callout,
    Toggle, ToggleSummary, ToggleContent,
    // Wave B: find-in-note. Decorations only -- never touches doc content
    // (see noteFindExtension.js's own header for why that's structural, not
    // a convention).
    NoteFind,
    // Wave D: internal note-to-note links. Same "never remove" rule as
    // WidgetEmbed above -- TipTap drops unknown node types at parse time.
    NoteLink,
    NoteLinkMenuExtension,
    // Wave F: captured financial fact cards. Same "never remove" rule as
    // WidgetEmbed/NoteLink above -- TipTap drops unknown node types at parse
    // time.
    FinancialFact,
    DocumentExcerpt,
    // Wave 5: inline + block math (inlineMath / blockMath leaves, KaTeX loaded
    // lazily). Same "never remove" rule as WidgetEmbed above once notes hold
    // formulas. Both nodes are rows in the citation tables (askCitation.js
    // citationLeafText ⇄ note_citation_text.py _ATOM_TEXT).
    Mathematics,
    // G-064: an inserted Ask Notebook answer and its citation chips. Same
    // "never remove" rule as WidgetEmbed above -- TipTap drops unknown node
    // types at parse time, and the flag gates only the Insert button.
    AskInsert,
    AskCitation,
    // Paste/copy for the three `defining` containers (askInsert, callout,
    // toggle): a container OPEN at a slice edge travels as plain content, a
    // whole one keeps its wrapper -- see pasteContainers.js. It is the ONLY
    // transformPasted/transformCopied in this roster; add a container to its
    // PASTE_CONTAINERS set rather than a second hook on the node.
    // ⛔ ITS POSITION HERE IS LOAD-BEARING. TipTap builds plugins from the
    // REVERSED extension list, so among same-priority extensions the LAST one
    // listed handles a paste FIRST. Last here puts its handlePaste after Link's
    // (priority 1000) and BEFORE prosemirror-tables' cell paste and the code
    // block's VS Code handler -- so a multi-line paste into a toggle title is
    // placed by pasteContainers and never reaches the VS Code handler, whose
    // behaviour inside a title has never been measured. Moving it earlier in
    // this array reverses that order.
    // Rail: pasteContainers.unit.test.js ("handles a paste after Link ...").
    PasteContainers,
  ]
}

// Mirrors _ALLOWED_IMAGE_MIMES / _ALLOWED_FILE_MIMES in
// api/services/journal_two/notes.py — the server is the real gate (it
// checks Content-Type, not the client's guess), this is only so the
// editor's drop/paste handlers know which files to even attempt.
export const ALLOWED_IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
export const ALLOWED_ATTACHMENT_MIMES = new Set([
  'application/pdf', 'text/plain', 'text/csv', 'text/markdown', 'application/zip',
  'audio/mpeg', 'audio/mp4',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
])

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
 * Upload a non-image file (PDF/txt/csv/md/zip/mp3/m4a/docx/xlsx) to
 * /api/j2/notes/{noteId}/attachments and return {url, name, size}. The
 * backend endpoint has existed since before this wave; this is its first
 * frontend caller (Wave I — the editor's paste/drop handlers were
 * image-only, so a member could never reach it).
 */
export async function uploadNoteAttachment(noteId, file) {
  const fd = new FormData()
  fd.append('file', file)
  const res = await fetch(`/api/j2/notes/${noteId}/attachments`, {
    method: 'POST', credentials: 'include', body: fd,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.detail || `Upload failed (${res.status})`)
  }
  return res.json() // { url, name, size }
}

/**
 * What a LEAF node reads as in the plain text: the citation text's own leaf
 * table (askCitation.js::citationLeafText -- chip, excerpt, widget, hard
 * break, formulas) plus the ONE leaf the search text reads and a citation does
 * not: a video timestamp, "[1:15]". Derived, never restated. The server twin
 * is notes.py::_PLAIN_LEAF_TEXT ({**_ATOM_TEXT, videoTimestamp}); the parity
 * rails pin that the one extra is the same on both sides.
 */
export function plainLeafText(node) {
  if (node?.type?.name === 'videoTimestamp') return `[${fmtTime(node.attrs?.seconds || 0)}]`
  return citationLeafText(node)
}

// One space between blocks: FTS5 tokenizes on non-alphanumerics, so the
// separator only has to keep two blocks' words apart.
export const PLAIN_TEXT_BLOCK_SEPARATOR = ' '

let plainSchema = null
/**
 * The app's REAL editor schema, built once from `buildExtensions()` on first
 * use. It answers "is this a leaf / inline / a textblock" for the plain text
 * (the classification the server's citation tables are pinned to,
 * askCitation.schemaParity.test.js) and "which note types can this bundle
 * read" for the schema header (notebookSchema.js::declaredNotebookSchema).
 */
export function editorSchema() {
  if (!plainSchema) plainSchema = getSchema(buildExtensions())
  return plainSchema
}
function nodeTypeOf(name) {
  return typeof name === 'string' ? editorSchema().nodes[name] || null : null
}

const isInlineLeafJson = (child) => {
  if (!child || typeof child !== 'object') return false
  if (child.type === 'text') return true
  const t = nodeTypeOf(child.type)
  return !!(t && t.isLeaf && t.isInline)
}

/**
 * The note's plain text -- ProseMirror's own
 * `doc.textBetween(0, size, ' ', plainLeafText)`, walked over the JSON so a
 * doc the schema would refuse (an unknown node from an import) still reads.
 * Mirrors the server's extract_plain_text in notes.py -- PINNED, not promised:
 * both read tests/fixtures_plain_text.json (plainText.parity.test.js ⇄
 * tests/test_plain_text_parity.py), and the JS rail also runs the REAL
 * textBetween over every schema-valid fixture and asserts this equals it.
 *
 * textBetween's rules: text runs inside one textblock join with NOTHING (a
 * mark is invisible, so "**NV**DA" reads "NVDA"); every textblock, an empty
 * one included, is preceded by one separator except the first; a container
 * adds nothing; a BLOCK leaf gets a separator only when it reads as text, an
 * inline leaf never. A type the schema does not know is a textblock when it
 * holds inline content -- the server's `_is_textblock` inference.
 * ⚰️ Until 2026-09-23 every text node was joined with a space, so a partly
 * bold word was indexed as two words and a search for it missed the note.
 */
export function extractPlainText(doc) {
  if (!doc || typeof doc !== 'object') return ''
  let text = ''
  let first = true
  const separator = () => {
    if (first) first = false
    else text += PLAIN_TEXT_BLOCK_SEPARATOR
  }
  const walk = (node) => {
    if (!node || typeof node !== 'object') return
    if (node.type === 'text') {
      if (typeof node.text === 'string') text += node.text
      return
    }
    const type = nodeTypeOf(node.type)
    const attrs = node.attrs && typeof node.attrs === 'object' && !Array.isArray(node.attrs) ? node.attrs : {}
    if (type && type.isLeaf) {
      const leaf = plainLeafText({ type: { name: node.type }, attrs })
      if (leaf && !type.isInline) separator()
      text += leaf
      return
    }
    const children = Array.isArray(node.content) ? node.content : []
    const textblock = type ? type.isTextblock : children.some(isInlineLeafJson)
    if (textblock) separator()
    for (const child of children) walk(child)
  }
  for (const child of Array.isArray(doc.content) ? doc.content : []) walk(child)
  return text
}

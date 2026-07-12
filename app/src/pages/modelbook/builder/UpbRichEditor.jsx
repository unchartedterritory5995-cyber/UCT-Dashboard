import { useEditor, EditorContent, Extension, ReactRenderer } from '@tiptap/react'
import Suggestion from '@tiptap/suggestion'
import { useEffect, useImperativeHandle, useMemo, useRef, useState, forwardRef } from 'react'
import { buildExtensions, extractPlainText } from '../../journal-2-0/lib/tiptap'
import slashStyles from '../../journal-2-0/components/notebook/SlashMenu.module.css'

// Thin TipTap editor for My Playbook entries. Reuses the Notebook's extension
// set (buildExtensions — a plain module, cross-import precedent established by
// community) but is NOT NoteEditorPage: that component is hard-wired to the
// /api/j2/notes autosave. Only the ~80-line autosave core is re-implemented
// here, copying NoteEditorPage's latest-callback-ref pattern (the
// feedback_tiptap_onupdate_stale_closure lesson): TipTap freezes the onUpdate
// closure at editor-creation time, so every scheduled save dereferences
// through refs that are re-pointed EVERY render.

const AUTOSAVE_MS = 800
// Backoff schedule for transient (5xx / network) save failures. After the
// last entry, retries continue at the cap until the user edits or unmounts.
// 4xx errors bypass retry entirely.
const RETRY_BACKOFFS_MS = [1000, 2000, 4000, 8000, 15000, 30000]

// ── Slash menu (filtered clone) ───────────────────────────────────────────────
// The Notebook's SlashMenuExtension hardcodes an 'Image' item that dispatches
// 'uct:notebook-open-image-picker' — the builder has no inline image upload in
// v1, so a user picking it would see nothing happen (silent no-op, but it
// LOOKS broken). Per the spec we build the extensions array WITH a filtered
// menu instead: same items, same styles (imported from the Notebook's css
// module), minus the Image entry.
const SLASH_ITEMS = [
  {
    title: 'Heading 1',
    description: 'Big section heading',
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setNode('heading', { level: 1 }).run(),
  },
  {
    title: 'Heading 2',
    description: 'Medium section heading',
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run(),
  },
  {
    title: 'Heading 3',
    description: 'Small section heading',
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setNode('heading', { level: 3 }).run(),
  },
  {
    title: 'Bullet list',
    description: 'Unordered list',
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    title: 'Numbered list',
    description: 'Ordered list',
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  {
    title: 'Quote',
    description: 'Italic indented block',
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
  },
  {
    title: 'Code block',
    description: 'Monospace block',
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
  },
  {
    title: 'Divider',
    description: 'Horizontal rule',
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
  },
]

const SlashList = forwardRef((props, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const items = props.items

  useEffect(() => setSelectedIndex(0), [items])

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === 'ArrowUp') {
        setSelectedIndex((selectedIndex + items.length - 1) % items.length)
        return true
      }
      if (event.key === 'ArrowDown') {
        setSelectedIndex((selectedIndex + 1) % items.length)
        return true
      }
      if (event.key === 'Enter') {
        const item = items[selectedIndex]
        if (item) props.command(item)
        return true
      }
      return false
    },
  }))

  if (!items.length) return null

  return (
    <div className={slashStyles.menu}>
      {items.map((item, i) => (
        <button
          key={item.title}
          type="button"
          className={`${slashStyles.item} ${i === selectedIndex ? slashStyles.itemActive : ''}`}
          onMouseDown={(e) => { e.preventDefault(); props.command(item) }}
          onMouseEnter={() => setSelectedIndex(i)}
        >
          <div className={slashStyles.itemTitle}>{item.title}</div>
          <div className={slashStyles.itemDesc}>{item.description}</div>
        </button>
      ))}
    </div>
  )
})
SlashList.displayName = 'SlashList'

const UpbSlashMenuExtension = Extension.create({
  name: 'upbSlashMenu',
  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        char: '/',
        startOfLine: false,
        command: ({ editor, range, props }) => {
          props.command({ editor, range })
        },
        items: ({ query }) => {
          const q = (query || '').toLowerCase()
          if (!q) return SLASH_ITEMS
          return SLASH_ITEMS.filter((it) => it.title.toLowerCase().includes(q))
        },
        render: () => {
          let component
          let popup
          return {
            onStart: (props) => {
              component = new ReactRenderer(SlashList, {
                props,
                editor: props.editor,
              })
              popup = document.createElement('div')
              popup.className = slashStyles.popupWrap
              popup.style.position = 'fixed'
              popup.style.zIndex = 9999
              const rect = props.clientRect?.()
              if (rect) {
                popup.style.left = `${rect.left}px`
                popup.style.top = `${rect.bottom + 6}px`
              }
              popup.appendChild(component.element)
              document.body.appendChild(popup)
            },
            onUpdate(props) {
              component?.updateProps(props)
              const rect = props.clientRect?.()
              if (rect && popup) {
                popup.style.left = `${rect.left}px`
                popup.style.top = `${rect.bottom + 6}px`
              }
            },
            onKeyDown(props) {
              if (props.event.key === 'Escape') {
                popup?.remove()
                component?.destroy()
                return true
              }
              return component?.ref?.onKeyDown?.(props) ?? false
            },
            onExit() {
              popup?.remove()
              component?.destroy()
            },
          }
        },
      }),
    ]
  },
})

const EMPTY_DOC = { type: 'doc', content: [] }

// docJson     — TipTap doc JSON (object) or null for a fresh entry.
// contentKey  — content identity (e.g. the entry id). The editor instance and
//               the one-shot setContent effect are keyed on it; MUST change
//               whenever docJson refers to a different record.
// onSave      — async ({ bodyJson, bodyPlain }) => …; reject to trigger the
//               retry backoff (attach err.status — 4xx skips retry).
// readOnly    — renders the same extensions with editable:false; no autosave.
export default function UpbRichEditor({ docJson, contentKey, placeholder, onSave, readOnly = false }) {
  const saveTimerRef = useRef(null)
  const retryTimerRef = useRef(null)
  const retryAttemptsRef = useRef(0)
  const lastSavedRef = useRef(null)
  // Latest-callback refs. TipTap's useEditor freezes the `onUpdate` closure at
  // editor-creation time and setTimeout fires whichever closure was scheduled
  // — both routes would capture stale props. Reading through these refs
  // guarantees every save runs with the latest closures (re-pointed after
  // every render below).
  const scheduleAutosaveRef = useRef(() => {})
  const commitSaveRef = useRef(async () => {})

  const extensions = useMemo(() => {
    const exts = buildExtensions(placeholder ? { placeholder } : {})
      .filter(e => e?.name !== 'slashMenu')
    exts.push(UpbSlashMenuExtension)
    return exts
  }, [placeholder])

  const scheduleAutosave = () => {
    if (readOnly) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    // Fresh user edit supersedes any in-flight retry — reset the backoff
    // counter so we don't waste a 30s wait on content the user just changed.
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }
    retryAttemptsRef.current = 0
    saveTimerRef.current = setTimeout(() => commitSaveRef.current(), AUTOSAVE_MS)
  }

  const editor = useEditor({
    extensions,
    content: docJson || EMPTY_DOC,
    editable: !readOnly,
    onUpdate: () => scheduleAutosaveRef.current(),
  }, [contentKey])

  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.setEditable(!readOnly)
  }, [editor, readOnly])

  // Baseline for the no-op save check — reset per record, mirroring
  // NoteEditorPage's lastSavedRef seeding on note?.id.
  useEffect(() => {
    lastSavedRef.current = JSON.stringify(docJson || EMPTY_DOC)
    retryAttemptsRef.current = 0
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentKey])

  // Push fresh body into the editor when the record loads (one-shot per key).
  // Depends on `editor` so it re-runs once the instance is actually ready.
  // When a content-bearing doc opens, the editor is re-created (useEditor
  // keyed on contentKey) and for a tick `editor.commands` can throw because
  // the ProseMirror view isn't mounted yet — guard + try/catch make it safe;
  // the editor was already created with this content via useEditor's
  // `content` option, so a swallowed first attempt still shows the doc.
  useEffect(() => {
    if (!editor || editor.isDestroyed || !docJson || editor.isFocused) return
    try {
      const current = JSON.stringify(editor.getJSON())
      const fresh = JSON.stringify(docJson)
      if (current !== fresh) editor.commands.setContent(docJson, false)
    } catch {
      /* editor view not mounted yet — content already loaded via useEditor */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentKey, editor])

  const commitSave = async () => {
    if (!editor || editor.isDestroyed || readOnly) return
    saveTimerRef.current = null
    retryTimerRef.current = null

    const bodyJson = editor.getJSON()
    const serialized = JSON.stringify(bodyJson)
    if (serialized === lastSavedRef.current) {
      retryAttemptsRef.current = 0
      return
    }
    try {
      await onSave?.({ bodyJson, bodyPlain: extractPlainText(bodyJson) })
      lastSavedRef.current = serialized
      retryAttemptsRef.current = 0
    } catch (e) {
      const status = e?.status
      // No status = network/fetch error; 5xx = backend down or restarting.
      // Both are worth retrying. 4xx = real client/validation error — won't
      // get better on retry, so stop.
      const retryable = !status || status >= 500
      if (!retryable) {
        console.error('playbook autosave failed (non-retryable)', e)
        retryAttemptsRef.current = 0
        return
      }
      const attempt = retryAttemptsRef.current
      const delay = RETRY_BACKOFFS_MS[Math.min(attempt, RETRY_BACKOFFS_MS.length - 1)]
      retryAttemptsRef.current = attempt + 1
      console.warn(`playbook autosave failed (retry ${attempt + 1} in ${delay}ms)`, e)
      retryTimerRef.current = setTimeout(() => commitSaveRef.current(), delay)
    }
  }

  // Keep latest-callback refs pointed at the freshest closures every render.
  // Anything that captured these earlier (TipTap onUpdate, scheduled
  // timeouts, unmount cleanup) dereferences through the ref and gets the
  // current props — fixing the "first keystroke not saved" + "unmount saves
  // stale values" bugs.
  scheduleAutosaveRef.current = scheduleAutosave
  commitSaveRef.current = commitSave

  // Flush on unmount if a save is pending.
  useEffect(() => () => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      commitSaveRef.current()
    }
  }, [])

  return <EditorContent editor={editor} />
}

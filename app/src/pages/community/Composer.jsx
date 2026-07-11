// app/src/pages/community/Composer.jsx
import { useState, useRef, useEffect } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import { buildCommunityExtensions } from './lib/tiptapExtensions'
import { extractTickers } from './lib/tickerMention'
import { apiCall } from './hooks/useCommunity'
import styles from './Community.module.css'

async function uploadImage(file) {
  const fd = new FormData()
  fd.append('file', file)
  return apiCall('/api/community/images', fd) // -> {url, width, height}
}

export default function Composer({ onSubmit, placeholder = 'Share your thinking…',
                                   submitLabel = 'Post', busy = false,
                                   mode = 'default', onTyping }) {
  const [error, setError] = useState(null)
  const chat = mode === 'chat'
  // latest-callback ref: TipTap keymap closures capture stale props (memory:
  // feedback_tiptap_onupdate_stale_closure) — route through a ref instead.
  const submitRef = useRef(() => {})

  const editor = useEditor({
    extensions: buildCommunityExtensions(placeholder, { mentions: chat }),
    editorProps: {
      handleKeyDown(view, event) {
        if (chat && event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault()
          submitRef.current()
          return true
        }
        return false
      },
      handlePaste(view, event) {
        const items = event.clipboardData?.items
        if (!items) return false
        for (const item of items) {
          if (item.kind === 'file' && item.type.startsWith('image/')) {
            event.preventDefault()
            const file = item.getAsFile()
            if (file)
              uploadImage(file)
                .then(({ url }) => editor?.chain().focus().setImage({ src: url, alt: '' }).run())
                .catch((e) => setError(e.message))
            return true
          }
        }
        return false
      },
      handleDrop(view, event) {
        const file = event.dataTransfer?.files?.[0]
        if (file && file.type.startsWith('image/')) {
          event.preventDefault()
          uploadImage(file)
            .then(({ url }) => editor?.chain().focus().setImage({ src: url, alt: '' }).run())
            .catch((e) => setError(e.message))
          return true
        }
        return false
      },
    },
    onUpdate() { if (chat && onTyping) onTyping() },
  })

  const submit = async () => {
    if (!editor || busy) return
    if (editor.isEmpty) { if (!chat) setError('Write something first'); return }
    setError(null)
    const doc = editor.getJSON()
    try {
      await onSubmit(JSON.stringify(doc), extractTickers(doc))
      editor.commands.clearContent()
      if (chat) editor.commands.focus()
    } catch (e) {
      setError(e.message === 'acknowledgment_required'
        ? 'Accept the community guidelines first' : e.message)
    }
  }
  useEffect(() => { submitRef.current = submit })

  return (
    <div className={`${styles.composer} ${chat ? styles.composerChat : ''}`}>
      <EditorContent editor={editor} className={styles.composerEditor} />
      <div className={styles.composerFoot}>
        {error && <span className={styles.composerError}>{error}</span>}
        {!chat && <span className={styles.composerHint}>$ for tickers · paste charts directly</span>}
        <button className={styles.composerSubmit} onClick={submit} disabled={busy}>
          {chat ? 'Send' : submitLabel}
        </button>
      </div>
    </div>
  )
}

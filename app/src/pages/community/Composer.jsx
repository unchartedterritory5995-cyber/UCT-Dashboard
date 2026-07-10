// app/src/pages/community/Composer.jsx
import { useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import { buildCommunityExtensions } from './lib/tiptapExtensions'
import { extractTickers } from './lib/tickerMention'
import { apiCall } from './hooks/useCommunity'
import styles from './Community.module.css'

async function uploadImage(file) {
  const fd = new FormData()
  fd.append('file', file)
  return apiCall('/api/community/images', fd)   // -> {url, width, height}
}

export default function Composer({ onSubmit, placeholder = 'Share your thinking…',
                                   submitLabel = 'Post', busy = false }) {
  const [error, setError] = useState(null)

  const editor = useEditor({
    extensions: buildCommunityExtensions(placeholder),
    editorProps: {
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
  })

  const submit = async () => {
    if (!editor || busy) return
    const doc = editor.getJSON()
    const isEmpty = editor.isEmpty
    if (isEmpty) { setError('Write something first'); return }
    setError(null)
    try {
      await onSubmit(JSON.stringify(doc), extractTickers(doc))
      editor.commands.clearContent()
    } catch (e) {
      setError(e.message === 'acknowledgment_required'
        ? 'Accept the community guidelines first' : e.message)
    }
  }

  return (
    <div className={styles.composer}>
      <EditorContent editor={editor} className={styles.composerEditor} />
      <div className={styles.composerFoot}>
        {error && <span className={styles.composerError}>{error}</span>}
        <span className={styles.composerHint}>$ for tickers · paste charts directly</span>
        <button className={styles.composerSubmit} onClick={submit} disabled={busy}>
          {submitLabel}
        </button>
      </div>
    </div>
  )
}

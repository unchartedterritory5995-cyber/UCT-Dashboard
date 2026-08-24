import { useEffect, useState, useCallback, useRef } from 'react'
import { formatETDate } from '../../utils/timeAgo'
import styles from './VoiceDocumentsPanel.module.css'

/**
 * Upload + manage documents (PDFs, transcripts, research notes) that
 * the voice assistant can search via ask_document.
 *
 * Drop a file, paste text, or use the file picker. Lists all docs with
 * chunk count + size. Delete removes the doc + all its embeddings.
 */
export default function VoiceDocumentsPanel() {
  const [docs, setDocs] = useState([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [pasteTitle, setPasteTitle] = useState('')
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef(null)

  const loadDocs = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/voice/documents', { credentials: 'include' })
      if (r.ok) {
        const j = await r.json()
        setDocs(j.documents || [])
      }
    } catch (e) {
      setError(e?.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadDocs() }, [loadDocs])

  const uploadFile = useCallback(async (file, title) => {
    if (!file) return
    setUploading(true)
    setError(null)
    setSuccess(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      if (title) fd.append('title', title)
      const r = await fetch('/api/voice/documents/upload', {
        method: 'POST', credentials: 'include', body: fd,
      })
      const j = await r.json()
      if (!r.ok || !j.ok) {
        throw new Error(j.error || j.detail || `HTTP ${r.status}`)
      }
      setSuccess(`Ingested "${j.title}" — ${j.chunks} chunks indexed.`)
      await loadDocs()
    } catch (e) {
      setError(e?.message || 'Upload failed')
    } finally {
      setUploading(false)
    }
  }, [loadDocs])

  const uploadText = useCallback(async () => {
    if (!pasteText.trim() || !pasteTitle.trim()) {
      setError('Title and text are both required.')
      return
    }
    setUploading(true)
    setError(null)
    setSuccess(null)
    try {
      const r = await fetch('/api/voice/documents/ingest-text', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: pasteTitle, text: pasteText }),
      })
      const j = await r.json()
      if (!r.ok || !j.ok) {
        throw new Error(j.error || j.detail || `HTTP ${r.status}`)
      }
      setSuccess(`Ingested "${j.title}" — ${j.chunks} chunks indexed.`)
      setPasteText('')
      setPasteTitle('')
      await loadDocs()
    } catch (e) {
      setError(e?.message || 'Ingest failed')
    } finally {
      setUploading(false)
    }
  }, [pasteText, pasteTitle, loadDocs])

  const deleteDoc = useCallback(async (docId) => {
    if (!window.confirm('Delete this document and all its embeddings?')) return
    try {
      const r = await fetch(`/api/voice/documents/${docId}`, {
        method: 'DELETE', credentials: 'include',
      })
      if (r.ok) await loadDocs()
    } catch (e) {
      setError(e?.message || 'Delete failed')
    }
  }, [loadDocs])

  const onDrop = useCallback((e) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) uploadFile(file, file.name.replace(/\.[^.]+$/, ''))
  }, [uploadFile])

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <h3 className={styles.title}>Voice documents</h3>
        <button
          type="button"
          onClick={loadDocs}
          className={styles.refresh}
          disabled={loading}
        >
          {loading ? '...' : 'Refresh'}
        </button>
      </div>
      <p className={styles.subtitle}>
        Upload PDFs, transcripts, or research notes. The assistant can
        search them via <code>ask_document</code>. Max 10 MB per file.
      </p>

      {error && <div className={styles.error}>{error}</div>}
      {success && <div className={styles.success}>{success}</div>}

      {/* Drop zone */}
      <div
        className={`${styles.dropzone} ${dragOver ? styles.dropzoneActive : ''} ${uploading ? styles.busy : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        <div className={styles.dropzoneText}>
          {uploading
            ? 'Uploading and chunking…'
            : 'Drag a PDF or text file here, or '}
          {!uploading && (
            <button
              type="button"
              className={styles.pickerBtn}
              onClick={() => fileInputRef.current?.click()}
            >
              choose a file
            </button>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.txt,.md,.json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) uploadFile(f, f.name.replace(/\.[^.]+$/, ''))
            e.target.value = ''
          }}
        />
      </div>

      {/* Paste fallback */}
      <details className={styles.pasteWrap}>
        <summary className={styles.pasteSummary}>
          Or paste text directly
        </summary>
        <div className={styles.pasteFields}>
          <input
            type="text"
            className={styles.input}
            placeholder="Title (e.g. NVDA Q4 earnings call)"
            value={pasteTitle}
            onChange={(e) => setPasteTitle(e.target.value)}
          />
          <textarea
            className={styles.textarea}
            placeholder="Paste the document content…"
            rows={6}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
          />
          <button
            type="button"
            className="btn btn-primary"
            onClick={uploadText}
            disabled={uploading || !pasteText.trim() || !pasteTitle.trim()}
          >
            Ingest text
          </button>
        </div>
      </details>

      {/* Doc list */}
      <h4 className={styles.sectionTitle}>
        Your documents ({docs.length})
      </h4>
      {docs.length === 0 && !loading && (
        <div className={styles.empty}>No documents uploaded yet.</div>
      )}
      {docs.length > 0 && (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Title</th>
              <th>Type</th>
              <th>Chunks</th>
              <th>Size</th>
              <th>Added</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {docs.map((d) => (
              <tr key={d.id}>
                <td className={styles.docTitle}>
                  <span className={styles.docId}>#{d.id}</span>
                  {d.title}
                </td>
                <td>{d.source_type}</td>
                <td>{d.chunk_count}</td>
                <td>{Math.round((d.char_count || 0) / 1000)}k chars</td>
                <td className={styles.docDate}>
                  {d.created_at ? formatETDate(d.created_at) : '—'}
                </td>
                <td>
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={() => deleteDoc(d.id)}
                    aria-label={`Delete document ${d.title}`}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

/**
 * View + edit the Compass Trader Profile (markdown blob).
 *
 * Props:
 *   profile: string (markdown)
 *   onSave(next: string): Promise<void>
 *   onClear(): Promise<void>
 *   importSources?: Array<{ id, name }>   // unified mode only — accounts to seed from
 *   onImport?(accountId: string): Promise<void>
 */

import { useState } from 'react'

export default function TraderProfileEditor({
  profile, onSave, onClear, importSources, onImport,
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(profile || '')
  const [saving, setSaving] = useState(false)
  const [importId, setImportId] = useState('')
  const [importing, setImporting] = useState(false)
  const canImport = Array.isArray(importSources) && importSources.length > 0 && !!onImport

  const doImport = async () => {
    if (!importId) return
    setImporting(true)
    try {
      await onImport(importId)
      setImportId('')
    } finally {
      setImporting(false)
    }
  }

  const startEdit = () => {
    setDraft(profile || '')
    setEditing(true)
  }

  const save = async () => {
    setSaving(true)
    try {
      await onSave(draft)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  const clear = async () => {
    if (!window.confirm('Clear the Trader Profile? Compass will rebuild from scratch on next review.')) return
    await onClear()
  }

  return (
    <section
      style={{
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: '12px 16px',
        margin: '16px 0',
        background: 'var(--bg-elevated, rgba(255,255,255,0.02))',
      }}
    >
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontSize: 14, color: 'var(--ut-gold, #c9a84c)' }}>
          Compass's notes on you
        </h3>
        <div style={{ display: 'flex', gap: 6 }}>
          {!editing && (
            <>
              <button type="button" onClick={startEdit} style={btn()}>Edit</button>
              <button type="button" onClick={clear} style={btn('var(--loss, #ef4444)')}>Clear</button>
            </>
          )}
          {editing && (
            <>
              <button type="button" onClick={() => setEditing(false)} style={btn()} disabled={saving}>
                Cancel
              </button>
              <button type="button" onClick={save} style={btn('var(--ut-gold, #c9a84c)')} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </>
          )}
        </div>
      </header>
      {editing ? (
        <textarea
          aria-label="Trader Profile"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          style={{
            width: '100%', minHeight: 280, marginTop: 8, padding: 10,
            background: 'var(--bg)', color: 'var(--text-bright)',
            border: '1px solid var(--border)', borderRadius: 6,
            fontFamily: 'var(--font-mono, monospace)', fontSize: 12,
            lineHeight: 1.5,
          }}
        />
      ) : profile ? (
        <pre
          style={{
            whiteSpace: 'pre-wrap', marginTop: 8, padding: 10,
            background: 'transparent', color: 'var(--text-bright)',
            border: '1px dashed var(--border)', borderRadius: 6,
            fontFamily: 'var(--font-mono, monospace)', fontSize: 12,
            lineHeight: 1.5,
          }}
        >{profile}</pre>
      ) : (
        <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 8 }}>
          Compass hasn't built a profile yet — generate your first weekly review and it'll start.
        </p>
      )}
      {!editing && canImport && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
          <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
            Seed from an account:
          </span>
          <select
            aria-label="Import profile from account"
            value={importId}
            onChange={(e) => setImportId(e.target.value)}
            style={{
              padding: '4px 8px', fontSize: 11,
              background: 'var(--bg)', color: 'var(--text-bright)',
              border: '1px solid var(--border)', borderRadius: 6,
            }}
          >
            <option value="">Choose account…</option>
            {importSources.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={doImport}
            disabled={!importId || importing}
            style={btn('var(--ut-gold, #c9a84c)')}
          >
            {importing ? 'Importing…' : 'Import'}
          </button>
        </div>
      )}
    </section>
  )
}

function btn(color) {
  return {
    padding: '4px 10px',
    fontSize: 11,
    background: 'transparent',
    color: color || 'var(--text-bright)',
    border: `1px solid ${color || 'var(--border)'}`,
    borderRadius: 6,
    cursor: 'pointer',
  }
}

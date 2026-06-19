// app/src/pages/desk/TeamSection.jsx
// The Desk → Team: "Meet the Team" admin-managed member cards (photo, name,
// role, bio, links). Photos upload server-side (Pillow→WebP).
import { useState, useRef, useCallback } from 'react'
import useSWR from 'swr'
import { useAuth } from '../../context/AuthContext'
import Sheet from '../../components/mobile/Sheet'
import { TeamIcon, PlusIcon } from '../education/icons'
import styles from './Desk.module.css'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null))

const photoUrl = (m) => (m.has_photo ? `/api/desk/team/${m.id}/photo` : null)

export default function TeamSection() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const { data, isLoading, mutate } = useSWR('/api/desk/team', fetcher)
  const [editing, setEditing] = useState(null)

  const team = (data?.team || []).filter((m) => isAdmin || m.enabled)

  const handleDelete = useCallback(async (m) => {
    if (!window.confirm(`Remove ${m.name}?`)) return
    await fetch(`/api/desk/team/${m.id}`, { method: 'DELETE', credentials: 'include' })
    mutate()
  }, [mutate])

  return (
    <div className={styles.section}>
      <div className={styles.sectionHead}>
        <div className={styles.sectionHeadMain}>
          <span className={styles.sectionIcon} aria-hidden="true"><TeamIcon /></span>
          <div>
            <div className={styles.eyebrow}>UCT INTELLIGENCE</div>
            <h1 className={styles.sectionTitle}>Meet the Team</h1>
            <div className={styles.sectionSub}>The people behind Uncharted Territory</div>
          </div>
        </div>
        {isAdmin && (
          <button className={styles.goldBtn} onClick={() => setEditing({})}>
            <PlusIcon /> Add member
          </button>
        )}
      </div>

      {isLoading && <div className={styles.note}>Loading…</div>}

      {!isLoading && team.length === 0 && (
        <div className={styles.empty}>
          <span className={styles.emptyIcon} aria-hidden="true"><TeamIcon size={30} /></span>
          <div className={styles.emptyTitle}>The team page is coming together</div>
          <div className={styles.emptyText}>
            {isAdmin
              ? 'Add your first team member — name, role, a short bio, and a photo.'
              : 'Meet the team — coming soon.'}
          </div>
          {isAdmin && (
            <button className={styles.goldBtn} onClick={() => setEditing({})}>
              <PlusIcon /> Add the first member
            </button>
          )}
        </div>
      )}

      {team.length > 0 && (
        <div className={styles.teamGrid}>
          {team.map((m) => (
            <article key={m.id} className={styles.teamCard}>
              {photoUrl(m)
                ? <img className={styles.teamPhoto} src={photoUrl(m)} alt={m.name} loading="lazy" />
                : <div className={styles.teamPhotoFallback} aria-hidden="true">
                    {(m.name || '?')[0].toUpperCase()}
                  </div>}
              <div className={styles.teamName}>{m.name}</div>
              {m.role && <div className={styles.teamRole}>{m.role}</div>}
              {m.bio && <div className={styles.teamBio}>{m.bio}</div>}
              <div className={styles.teamLinks}>
                {m.twitter_url && <a href={m.twitter_url} target="_blank" rel="noopener noreferrer">X</a>}
                {m.substack_url && <a href={m.substack_url} target="_blank" rel="noopener noreferrer">Substack</a>}
                {m.link_url && <a href={m.link_url} target="_blank" rel="noopener noreferrer">Link</a>}
                {m.email && <a href={`mailto:${m.email}`}>Email</a>}
              </div>
              {isAdmin && (
                <div className={styles.cardAdmin}>
                  <button className={styles.adminLink} onClick={() => setEditing(m)}>Edit</button>
                  <button className={styles.adminLinkDanger} onClick={() => handleDelete(m)}>Delete</button>
                  {!m.enabled && <span className={styles.hiddenTag}>hidden</span>}
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      {editing && (
        <MemberForm
          member={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); mutate() }}
        />
      )}
    </div>
  )
}

function MemberForm({ member, onClose, onSaved }) {
  const isNew = !member?.id
  const [form, setForm] = useState({
    name: member?.name || '',
    role: member?.role || '',
    bio: member?.bio || '',
    twitter_url: member?.twitter_url || '',
    substack_url: member?.substack_url || '',
    email: member?.email || '',
    link_url: member?.link_url || '',
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const fileRef = useRef(null)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const submit = async () => {
    setBusy(true); setErr('')
    try {
      const url = isNew ? '/api/desk/team' : `/api/desk/team/${member.id}`
      const method = isNew ? 'POST' : 'PATCH'
      const r = await fetch(url, {
        method, credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        throw new Error(j.detail || 'Save failed')
      }
      const saved = await r.json()
      const memberId = saved.id || member?.id
      // Upload photo if one was picked.
      const file = fileRef.current?.files?.[0]
      if (file && memberId) {
        const fd = new FormData()
        fd.append('file', file)
        await fetch(`/api/desk/team/${memberId}/photo`, {
          method: 'POST', credentials: 'include', body: fd,
        })
      }
      onSaved()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <Sheet open onClose={onClose} variant="auto" title={isNew ? 'Add member' : 'Edit member'}>
      <div className={styles.form}>
        <div className={styles.field}>
          <span className={styles.label}>Name</span>
          <input className={styles.input} value={form.name} onChange={set('name')} />
        </div>
        <div className={styles.field}>
          <span className={styles.label}>Role / title</span>
          <input className={styles.input} value={form.role} onChange={set('role')}
                 placeholder="Founder · Head Trader" />
        </div>
        <div className={styles.field}>
          <span className={styles.label}>Bio</span>
          <textarea className={styles.textarea} value={form.bio} onChange={set('bio')} rows={3} />
        </div>
        <div className={styles.field}>
          <span className={styles.label}>Photo</span>
          <input ref={fileRef} className={styles.input} type="file" accept="image/*" />
        </div>
        <div className={styles.field}>
          <span className={styles.label}>X / Twitter URL (optional)</span>
          <input className={styles.input} value={form.twitter_url} onChange={set('twitter_url')} />
        </div>
        <div className={styles.field}>
          <span className={styles.label}>Substack URL (optional)</span>
          <input className={styles.input} value={form.substack_url} onChange={set('substack_url')} />
        </div>
        <div className={styles.field}>
          <span className={styles.label}>Email (optional)</span>
          <input className={styles.input} value={form.email} onChange={set('email')} />
        </div>
        {err && <div className={styles.formErr}>{err}</div>}
        <div className={styles.formActions}>
          <button className={styles.cancelBtn} onClick={onClose} disabled={busy}>Cancel</button>
          <button className={styles.saveBtn} onClick={submit} disabled={busy || !form.name}>
            {busy ? 'Saving…' : isNew ? 'Add member' : 'Save changes'}
          </button>
        </div>
      </div>
    </Sheet>
  )
}

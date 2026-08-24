// app/src/pages/desk/TeamSection.jsx
// The Desk → Team: "Meet the Team" admin-managed member cards. A compact card
// (photo, name, role, years trading, one-line style) opens a full profile sheet
// with the trader's bio, trading style, and teaching focus. Photos upload
// server-side (Pillow→WebP).
import { useState, useRef, useCallback } from 'react'
import DeskSectionSkeleton from './DeskSectionSkeleton'
import useSWR from 'swr'
import { useAuth } from '../../context/AuthContext'
import Sheet from '../../components/mobile/Sheet'
import { TeamIcon, PlusIcon } from '../education/icons'
import styles from './Desk.module.css'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null))

const photoUrl = (m) => (m.has_photo ? `/api/desk/team/${m.id}/photo` : null)

// Split the sheet's newline-separated style/focus text into clean bullet lines.
const bullets = (text) =>
  (text || '')
    .split('\n')
    .map((l) => l.replace(/^[•\-\s]+/, '').trim())
    .filter(Boolean)

// A short one-liner for the card: first sentence/line of the trading style.
const tagline = (m) => {
  const first = bullets(m.trading_style)[0] || ''
  if (!first) return ''
  const sentence = first.split(/(?<=[.!?])\s/)[0]
  return sentence.length > 90 ? sentence.slice(0, 87).trimEnd() + '…' : sentence
}

export default function TeamSection() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const { data, isLoading, mutate } = useSWR('/api/desk/team', fetcher)
  const [editing, setEditing] = useState(null)
  const [viewing, setViewing] = useState(null)
  const [syncing, setSyncing] = useState(false)

  const team = (data?.team || []).filter((m) => isAdmin || m.enabled)

  const handleDelete = useCallback(async (m) => {
    if (!window.confirm(`Remove ${m.name}?`)) return
    await fetch(`/api/desk/team/${m.id}`, { method: 'DELETE', credentials: 'include' })
    mutate()
  }, [mutate])

  // Admin: re-pull every member's avatar from their live X profile (only_missing=0).
  const refreshFromX = useCallback(async () => {
    if (!window.confirm('Refresh all member avatars from their X profiles?')) return
    setSyncing(true)
    try {
      const r = await fetch('/api/desk/team/refresh-photos-from-x?only_missing=0',
        { method: 'POST', credentials: 'include' })
      const j = await r.json().catch(() => ({}))
      if (r.ok) {
        alert(`Avatars refreshed: ${j.updated} updated, ${j.failed} failed.`)
        mutate()
      } else {
        alert(j.detail || 'Refresh failed')
      }
    } finally { setSyncing(false) }
  }, [mutate])

  return (
    <div className={styles.section}>
      <div className={styles.sectionHead}>
        <div className={styles.sectionHeadMain}>
          <span className={styles.sectionIcon} aria-hidden="true"><TeamIcon /></span>
          <div>
            <div className={styles.eyebrow}>UCT INTELLIGENCE</div>
            <h1 className={styles.sectionTitle}>Meet the Team</h1>
            <div className={styles.sectionSub}>The traders behind Uncharted Territory</div>
          </div>
        </div>
        {isAdmin && (
          <div className={styles.headActions}>
            <button className="btn btn-ghost" onClick={refreshFromX} disabled={syncing}>
              {syncing ? 'Refreshing…' : 'Refresh avatars from X'}
            </button>
            <button className="btn btn-primary" onClick={() => setEditing({})}>
              <PlusIcon /> Add member
            </button>
          </div>
        )}
      </div>

      {isLoading && <DeskSectionSkeleton cards={8} />}

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
            <button className="btn btn-primary" onClick={() => setEditing({})}>
              <PlusIcon /> Add the first member
            </button>
          )}
        </div>
      )}

      {team.length > 0 && (
        <div className={styles.teamGrid}>
          {team.map((m) => {
            const tag = tagline(m)
            return (
              <article
                key={m.id}
                className={styles.teamCard}
                role="button"
                tabIndex={0}
                onClick={() => setViewing(m)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setViewing(m) } }}
              >
                {photoUrl(m)
                  ? <img className={styles.teamPhoto} src={photoUrl(m)} alt={m.name} loading="lazy" />
                  : <div className={styles.teamPhotoFallback} aria-hidden="true">
                      {(m.name || '?')[0].toUpperCase()}
                    </div>}
                <div className={styles.teamName}>{m.name}</div>
                {m.role && <div className={styles.teamRole}>{m.role}</div>}
                {m.years_trading && <div className={styles.teamYears}>{m.years_trading} trading</div>}
                {tag && <div className={styles.teamTagline}>“{tag}”</div>}
                <span className={styles.teamMore}>View profile →</span>
                {isAdmin && (
                  <div className={styles.cardAdmin} onClick={(e) => e.stopPropagation()}>
                    <button className={styles.adminLink} onClick={() => setEditing(m)}>Edit</button>
                    <button className={styles.adminLinkDanger} onClick={() => handleDelete(m)}>Delete</button>
                    {!m.enabled && <span className={styles.hiddenTag}>hidden</span>}
                  </div>
                )}
              </article>
            )
          })}
        </div>
      )}

      {viewing && (
        <MemberProfile member={viewing} onClose={() => setViewing(null)} />
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

function MemberProfile({ member: m, onClose }) {
  const style = bullets(m.trading_style)
  const focus = bullets(m.teaching_focus)
  return (
    <Sheet open onClose={onClose} variant="auto" title="Trader profile">
      <div className={styles.profile}>
        <div className={styles.profileHead}>
          {photoUrl(m)
            ? <img className={styles.profilePhoto} src={photoUrl(m)} alt={m.name} />
            : <div className={styles.profilePhotoFallback} aria-hidden="true">
                {(m.name || '?')[0].toUpperCase()}
              </div>}
          <div className={styles.profileHeadText}>
            <div className={styles.profileName}>{m.name}</div>
            {m.role && <div className={styles.profileRole}>{m.role}</div>}
            {m.years_trading && <div className={styles.profileYears}>{m.years_trading} trading</div>}
            <div className={styles.profileLinks}>
              {m.twitter_url && <a href={m.twitter_url} target="_blank" rel="noopener noreferrer">X</a>}
              {m.substack_url && <a href={m.substack_url} target="_blank" rel="noopener noreferrer">Substack</a>}
              {m.link_url && <a href={m.link_url} target="_blank" rel="noopener noreferrer">Link</a>}
              {m.email && <a href={`mailto:${m.email}`}>Email</a>}
            </div>
          </div>
        </div>

        {m.bio && (
          <section className={styles.profileBlock}>
            <h3 className={styles.profileLabel}>Bio</h3>
            <p className={styles.profileBio}>{m.bio}</p>
          </section>
        )}

        {style.length > 0 && (
          <section className={styles.profileBlock}>
            <h3 className={styles.profileLabel}>Trading Style</h3>
            <ul className={styles.profileList}>
              {style.map((b, i) => <li key={i}>{b}</li>)}
            </ul>
          </section>
        )}

        {focus.length > 0 && (
          <section className={styles.profileBlock}>
            <h3 className={styles.profileLabel}>Teaching Focus</h3>
            <ul className={styles.profileList}>
              {focus.map((b, i) => <li key={i}>{b}</li>)}
            </ul>
          </section>
        )}
      </div>
    </Sheet>
  )
}

function MemberForm({ member, onClose, onSaved }) {
  const isNew = !member?.id
  const [form, setForm] = useState({
    name: member?.name || '',
    role: member?.role || '',
    years_trading: member?.years_trading || '',
    bio: member?.bio || '',
    trading_style: member?.trading_style || '',
    teaching_focus: member?.teaching_focus || '',
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
                 placeholder="Founder · Momentum Swing Trader" />
        </div>
        <div className={styles.field}>
          <span className={styles.label}>Time trading</span>
          <input className={styles.input} value={form.years_trading} onChange={set('years_trading')}
                 placeholder="6 Years" />
        </div>
        <div className={styles.field}>
          <span className={styles.label}>Bio</span>
          <textarea className={styles.textarea} value={form.bio} onChange={set('bio')} rows={4} />
        </div>
        <div className={styles.field}>
          <span className={styles.label}>Trading style <span className={styles.hint}>(one point per line)</span></span>
          <textarea className={styles.textarea} value={form.trading_style} onChange={set('trading_style')} rows={5} />
        </div>
        <div className={styles.field}>
          <span className={styles.label}>Teaching focus <span className={styles.hint}>(one point per line)</span></span>
          <textarea className={styles.textarea} value={form.teaching_focus} onChange={set('teaching_focus')} rows={5} />
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
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={busy || !form.name}>
            {busy ? 'Saving…' : isNew ? 'Add member' : 'Save changes'}
          </button>
        </div>
      </div>
    </Sheet>
  )
}

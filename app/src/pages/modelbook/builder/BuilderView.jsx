import { useEffect, useState } from 'react'
import useSWR from 'swr'
import Sheet from '../../../components/mobile/Sheet'
import { TEMPLATES } from './upbTemplates'
import UpbEntryPage from './UpbEntryPage'
import styles from './BuilderView.module.css'

// My Playbook — the user-built 7th Model Book section. Three screens in one
// in-page tree (mini-hub of sections → section → entry); no react-router
// imports (ModelBook.test.jsx mocks react-router-dom with ONLY useLocation),
// no window-level key listeners (ModelBook's global keydown stays live).
// Receives { onExit } only — back to the Model Book hub.

const fetcher = url => fetch(url, { credentials: 'include' }).then(r => r.json())

// JSON fetch that REJECTS on failure with err.status attached (duplicated in
// UpbEntryPage.jsx — tiny helper, kept per-file to avoid an import cycle).
async function upbFetch(url, method = 'GET', body) {
  const r = await fetch(url, {
    method,
    credentials: 'include',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!r.ok) {
    let detail = ''
    try { detail = (await r.json())?.detail || '' } catch { /* non-JSON error body */ }
    const err = new Error(detail || `Request failed (${r.status})`)
    err.status = r.status
    throw err
  }
  return r.json()
}

// Server accent enum, cycled round-robin as sections are created.
const ACCENT_CYCLE = ['gold', 'green', 'blue', 'red', 'purple', 'teal']

// Ghost suggestion cards for sections the user hasn't created yet — rendered
// from code (no physical seeded rows); tapping one creates that section.
const SUGGESTED_SECTIONS = [
  { title: 'My Setups', blurb: 'The patterns you actually trade, defined in your own words.' },
  { title: 'Trades That Taught Me', blurb: 'The wins and losses that changed how you trade.' },
  { title: 'Market Studies', blurb: 'Deep dives on moves, themes, and market character.' },
]

const POSITIONING_LINE =
  'Notebook is where you think day to day — your Playbook is the reference manual of setups you’d trade again.'

// Epoch seconds (server) or ms → short date.
function fmtDate(ts) {
  if (!ts) return ''
  const ms = ts > 1e12 ? ts : ts * 1000
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function accentClass(accent) {
  switch (accent) {
    case 'green': return styles.accGreen
    case 'blue': return styles.accBlue
    case 'red': return styles.accRed
    case 'purple': return styles.accPurple
    case 'teal': return styles.accTeal
    default: return styles.accGold
  }
}

// ── Mini-hub — the user's own hub of sections ─────────────────────────────────
function MiniHub({ overview, mutateOverview, onExit, onOpenSection }) {
  const sections = overview?.sections || []
  const totals = overview?.totals || null

  const [creating, setCreating] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  // Up to 3 suggestions the user hasn't created yet.
  const suggestions = SUGGESTED_SECTIONS.filter(
    sug => !sections.some(s => (s.title || '').trim().toLowerCase() === sug.title.toLowerCase()),
  ).slice(0, 3)

  async function createSection(title) {
    if (busy || !title) return
    setBusy(true)
    setErr(null)
    try {
      const accent = ACCENT_CYCLE[sections.length % ACCENT_CYCLE.length]
      const j = await upbFetch('/api/upb/sections', 'POST', { title, accent })
      await mutateOverview()
      setCreating(false)
      setNewTitle('')
      if (j?.section?.id) onOpenSection(j.section.id)
    } catch (e) {
      setErr(e?.message || 'Could not create the section')
    } finally {
      setBusy(false)
    }
  }

  const empty = sections.length === 0
  // Cascade index continues across user cards → ghosts → the new-section card.
  const ghostBase = sections.length
  const newIdx = ghostBase + suggestions.length

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={onExit}>‹ Model Book</button>
        <h1 className={styles.heading}>My Playbook</h1>
        {totals != null && totals.entries > 0 && (
          <span className={styles.count}>{totals.entries} entries · {totals.charts} charts</span>
        )}
      </div>

      {empty && <p className={styles.positioning}>{POSITIONING_LINE}</p>}

      <div className={styles.grid}>
        {sections.map((s, i) => (
          <button
            key={s.id}
            type="button"
            className={`${styles.secCard} ${accentClass(s.accent)}`}
            style={{ '--i': i }}
            onClick={() => onOpenSection(s.id)}
          >
            <span className={styles.secCardLabel}>{s.title}</span>
            <span className={styles.secCardBlurb}>{s.blurb || ' '}</span>
            <span className={styles.secCardMeta}>
              {s.entry_count} {s.entry_count === 1 ? 'entry' : 'entries'} · {s.chart_count} {s.chart_count === 1 ? 'chart' : 'charts'}
            </span>
            <span className={styles.secCardCta}>Open →</span>
          </button>
        ))}

        {suggestions.map((sug, i) => (
          <button
            key={sug.title}
            type="button"
            className={`${styles.secCard} ${styles.secCardGhost}`}
            style={{ '--i': ghostBase + i }}
            onClick={() => createSection(sug.title)}
            disabled={busy}
          >
            <span className={styles.secCardLabel}>{sug.title}</span>
            <span className={styles.secCardBlurb}>{sug.blurb}</span>
            <span className={styles.secCardCta}>Tap to start</span>
          </button>
        ))}

        {creating ? (
          <div className={`${styles.secCard} ${styles.secCardNew}`} style={{ '--i': newIdx }}>
            <input
              className={styles.newInput}
              autoFocus
              value={newTitle}
              placeholder="Section title…"
              aria-label="New section title"
              onChange={e => setNewTitle(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && newTitle.trim()) createSection(newTitle.trim())
                if (e.key === 'Escape') { setCreating(false); setNewTitle(''); setErr(null) }
              }}
            />
            {err && <span className={styles.formErr}>{err}</span>}
            <span className={styles.newActions}>
              <button
                className={styles.primaryBtn}
                type="button"
                disabled={!newTitle.trim() || busy}
                onClick={() => createSection(newTitle.trim())}
              >
                {busy ? 'Creating…' : 'Create'}
              </button>
              <button
                className={styles.ghostBtn}
                type="button"
                onClick={() => { setCreating(false); setNewTitle(''); setErr(null) }}
              >Cancel</button>
            </span>
          </div>
        ) : (
          <button
            type="button"
            className={`${styles.secCard} ${styles.secCardNew}`}
            style={{ '--i': newIdx }}
            onClick={() => setCreating(true)}
          >
            <span className={styles.secCardLabel}>+ New section</span>
          </button>
        )}
      </div>

      {empty && (
        <p className={styles.builderHint}>
          Or open the firm&rsquo;s Setup Library and tap &ldquo;Add to my playbook&rdquo; on any setup you trade.
        </p>
      )}
    </div>
  )
}

// ── Section screen — entries of one section ───────────────────────────────────
function SectionScreen({ section, sectionId, onBack, onOpenEntry, mutateOverview }) {
  const { data, mutate } = useSWR(`/api/upb/sections/${sectionId}/entries`, fetcher, { revalidateOnFocus: false })
  const entries = data?.entries || []

  const [pickerOpen, setPickerOpen] = useState(false)
  const [busyTpl, setBusyTpl] = useState(null)
  const [pickerErr, setPickerErr] = useState(null)

  // Inline owner edits: title / blurb (null = not editing, else the draft).
  const [titleDraft, setTitleDraft] = useState(null)
  const [blurbDraft, setBlurbDraft] = useState(null)

  async function commitField(field, draft, close) {
    close()
    const v = (draft ?? '').trim()
    const current = (section?.[field] || '').trim()
    if (field === 'title' && !v) return           // titles can't be blanked
    if (v === current) return
    try {
      await upbFetch(`/api/upb/sections/${sectionId}`, 'PUT', { [field]: v })
    } catch (e) {
      console.warn('playbook section save failed', e)
    }
    mutateOverview?.()
  }

  async function delSection() {
    if (!window.confirm(`Delete "${section?.title || 'this section'}" and all its entries?`)) return
    try {
      await upbFetch(`/api/upb/sections/${sectionId}`, 'DELETE')
    } catch (e) {
      console.warn('playbook section delete failed', e)
    }
    mutateOverview?.()
    onBack()
  }

  async function pickTemplate(t) {
    if (busyTpl) return
    setBusyTpl(t.key)
    setPickerErr(null)
    try {
      const j = await upbFetch(`/api/upb/sections/${sectionId}/entries`, 'POST', {
        title: '',
        body_json: t.doc(),
      })
      setPickerOpen(false)
      mutate()
      mutateOverview?.()
      if (j?.entry?.id) onOpenEntry(j.entry.id)
    } catch (e) {
      setPickerErr(e?.message || 'Could not create the entry')
    } finally {
      setBusyTpl(null)
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={onBack}>‹ My Playbook</button>
        {titleDraft != null ? (
          <input
            className={styles.secTitleInput}
            autoFocus
            value={titleDraft}
            aria-label="Section title"
            onChange={e => setTitleDraft(e.target.value)}
            onBlur={() => commitField('title', titleDraft, () => setTitleDraft(null))}
            onKeyDown={e => {
              if (e.key === 'Enter') commitField('title', titleDraft, () => setTitleDraft(null))
              if (e.key === 'Escape') setTitleDraft(null)
            }}
          />
        ) : (
          <button
            className={styles.secTitleBtn}
            type="button"
            title="Rename section"
            onClick={() => setTitleDraft(section?.title || '')}
          >
            {section?.title || 'Section'}
          </button>
        )}
        <button className={styles.primaryBtn} onClick={() => setPickerOpen(true)}>+ New entry</button>
        <button className={styles.dangerBtn} onClick={delSection}>Delete section</button>
      </div>

      <div className={styles.secBlurbRow}>
        {blurbDraft != null ? (
          <input
            className={styles.secBlurbInput}
            autoFocus
            value={blurbDraft}
            aria-label="Section blurb"
            onChange={e => setBlurbDraft(e.target.value)}
            onBlur={() => commitField('blurb', blurbDraft, () => setBlurbDraft(null))}
            onKeyDown={e => {
              if (e.key === 'Enter') commitField('blurb', blurbDraft, () => setBlurbDraft(null))
              if (e.key === 'Escape') setBlurbDraft(null)
            }}
          />
        ) : (
          <button
            className={`${styles.secBlurbBtn} ${!section?.blurb ? styles.secBlurbEmpty : ''}`}
            type="button"
            title="Edit blurb"
            onClick={() => setBlurbDraft(section?.blurb || '')}
          >
            {section?.blurb || 'Add a blurb…'}
          </button>
        )}
      </div>

      {entries.length === 0 ? (
        <p className={styles.emptyLead}>No entries yet — pick a template and write the first one.</p>
      ) : (
        <div className={styles.entryGrid}>
          {entries.map((e, i) => (
            <button
              key={e.id}
              type="button"
              className={styles.entryCard}
              style={{ '--i': i }}
              onClick={() => onOpenEntry(e.id)}
            >
              <span className={styles.entryTitle}>{e.title || 'Untitled entry'}</span>
              {e.snippet && <span className={styles.entrySnippet}>{e.snippet}</span>}
              <span className={styles.entryMeta}>
                {e.chart_count > 0 && (
                  <span>{e.chart_count} {e.chart_count === 1 ? 'chart' : 'charts'}</span>
                )}
                {e.note_link_count > 0 && (
                  <span>{e.note_link_count} {e.note_link_count === 1 ? 'note' : 'notes'}</span>
                )}
                <span>{fmtDate(e.updated_at)}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      <Sheet open={pickerOpen} onClose={() => setPickerOpen(false)} title="Start from a template">
        {pickerErr && <div className={styles.pickerErr}>{pickerErr}</div>}
        {TEMPLATES.map(t => (
          <button
            key={t.key}
            type="button"
            className={styles.tplRow}
            onClick={() => pickTemplate(t)}
            disabled={!!busyTpl}
          >
            <span className={styles.tplLabel}>{t.label}</span>
            <span className={styles.tplDesc}>{t.description}</span>
          </button>
        ))}
      </Sheet>
    </div>
  )
}

// ── Shell — screen switch ─────────────────────────────────────────────────────
export default function BuilderView({ onExit }) {
  // Hub badge + mini-hub cards in one call; kept mounted at the shell so every
  // screen can nudge the counts (mutateOverview) after a mutation.
  const { data: overview, mutate: mutateOverview } = useSWR('/api/upb/overview', fetcher, { revalidateOnFocus: false })

  const [sectionId, setSectionId] = useState(null)
  const [entryId, setEntryId] = useState(null)

  // If the open section vanishes from the overview (deleted in another tab),
  // fall back to the mini-hub rather than a ghost screen.
  const sections = overview?.sections || []
  const section = sections.find(s => s.id === sectionId) || null
  const overviewLoaded = !!overview?.sections
  useEffect(() => {
    if (sectionId && overviewLoaded && !section) {
      setSectionId(null)
      setEntryId(null)
    }
  }, [sectionId, overviewLoaded, section])

  // All hooks above; screen branches below (rules of hooks hold).
  if (entryId) {
    return (
      <UpbEntryPage
        entryId={entryId}
        onBack={() => { setEntryId(null); mutateOverview() }}
      />
    )
  }
  if (sectionId && section) {
    return (
      <SectionScreen
        section={section}
        sectionId={sectionId}
        onBack={() => { setSectionId(null); mutateOverview() }}
        onOpenEntry={setEntryId}
        mutateOverview={mutateOverview}
      />
    )
  }
  return (
    <MiniHub
      overview={overview}
      mutateOverview={mutateOverview}
      onExit={onExit}
      onOpenSection={setSectionId}
    />
  )
}

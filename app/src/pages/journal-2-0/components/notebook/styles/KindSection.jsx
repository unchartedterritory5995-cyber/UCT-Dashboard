// Notebook P1 (spec P1.4): New note -> pick a kind -> its default style applies; "Choose another
// style" shows the others with a preview built from the member's own data (their latest ticker).
// A lazy chunk (NotebookTab lazyView). It creates nothing itself: onKind/onStyle go to createNote.
// ⛔ The switch is read in ONE place per layer: NotebookTab mounts this only while journalStylesEnabled(),
// and the hook refuses to fetch with it off. This file restates neither (a guard repeated is a guard unproved).
import { useState } from 'react'
import UIcon, { UICON_NAMES } from '../../../../../components/ui/UIcon'
import useJournalStyles from '../../../hooks/useJournalStyles'
import { defaultStyleFor, stylesOfKind, previewJournalStyle } from '../../../lib/journalStyles'
import { kindIcon } from '../../../lib/noteKinds'
import TemplatePreview from '../TemplatePreview'
import styles from './KindSection.module.css'

const iconOf = (k) => (UICON_NAMES.includes(kindIcon(k)) ? kindIcon(k) : 'document')

export default function KindSection({ onKind, onStyle, busy = false }) {
  const { data, error, isLoading } = useJournalStyles()
  const [openKind, setOpenKind] = useState(null)
  const [preview, setPreview] = useState(null)   // { style, loading, body, ticker, error }

  if (isLoading) return <p className={styles.status} role="status">Loading kinds of note…</p>
  if (error || !data) return <p className={styles.status} role="alert">Couldn't load your journal styles.</p>

  const showPreview = async (style) => {
    setPreview({ style, loading: true })
    try {
      const out = await previewJournalStyle({ styleId: style.id })
      setPreview({ style, loading: false, body: out.bodyJson, ticker: out.ticker })
    } catch (e) {
      setPreview({ style, loading: false, error: e.message || "Couldn't build the preview." })
    }
  }
  // A create needs the network (the server composes the note); offline says so instead of failing late.
  const offline = data.fromCache === true

  return (
    <section className={styles.wrap} aria-labelledby="kind-section-h">
      <h3 id="kind-section-h" className={styles.h}>Start from a kind of note</h3>
      {offline && <p className={styles.status} role="status">You're offline. These are your saved styles; a new note needs a connection.</p>}
      <div role="group" aria-label="Start from a kind of note" className={styles.grid}>
        {data.kinds.map((k) => {
          const def = defaultStyleFor(data, k.id)
          return (
            <div key={k.id} className={styles.kind}>
              <button type="button" className={styles.kindBtn} disabled={busy || offline} aria-label={`New ${k.name}`}
                onClick={() => onKind(k.id)}>
                <UIcon name={iconOf(k)} size={16} gold={false} />
                <span className={styles.kindName}>{k.name}</span>
                <span className={styles.kindStyle}>{def ? def.name : 'No style yet'}</span>
              </button>
              <button type="button" className={styles.another} aria-expanded={openKind === k.id}
                aria-label={`Choose another style for ${k.name}`}
                onClick={() => setOpenKind(openKind === k.id ? null : k.id)}>
                Choose another style
              </button>
              {openKind === k.id && (
                <ul className={styles.list} aria-label={`Styles for ${k.name}`}>
                  {stylesOfKind(data, k.id).map((s) => (
                    <li key={s.id} className={styles.row}>
                      <span className={styles.rowName}>{s.name}{s.builtin ? ' · Built-in' : ''}{s.isDefault ? ' · Default' : ''}</span>
                      <button type="button" className={styles.rowBtn} aria-label={`Preview ${s.name}`} onClick={() => showPreview(s)}>Preview</button>
                      <button type="button" className={styles.rowBtn} disabled={busy || offline} aria-label={`Use ${s.name}`} onClick={() => onStyle(s.id)}>Use</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        })}
      </div>
      {preview && (
        <TemplatePreview open onClose={() => setPreview(null)} title={preview.style.name}
          subtitle={preview.ticker ? `Shown with ${preview.ticker}, from your notes.` : 'Add a ticker to see the chart block.'}
          body={preview.body} loading={preview.loading} loadError={preview.error}
          useLabel="Use this style" busy={busy || offline}
          onUse={() => { const id = preview.style.id; setPreview(null); onStyle(id) }} />
      )}
    </section>
  )
}

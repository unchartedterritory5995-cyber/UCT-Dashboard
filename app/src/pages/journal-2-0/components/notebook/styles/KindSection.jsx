// Notebook P1 (spec P1.4): New note -> pick a kind -> its default style applies; "Choose another
// style" shows the others with a preview built from the member's own data (their latest ticker).
// A lazy chunk (NotebookTab lazyView). It creates nothing itself: onKind/onStyle go to createNote.
// ⛔ The switch is read in ONE place per layer: NotebookTab mounts this only while journalStylesEnabled(),
// and the hook refuses to fetch with it off. This file restates neither (a guard repeated is a guard unproved).
import { useId, useRef, useState } from 'react'
import UIcon, { UICON_NAMES } from '../../../../../components/ui/UIcon'
import useJournalStyles from '../../../hooks/useJournalStyles'
import { defaultStyleFor, stylesOfKind, previewJournalStyle } from '../../../lib/journalStyles'
import { kindIcon } from '../../../lib/noteKinds'
import { BLOCK_KINDS, blockLabel, tfWord } from '../../../lib/journalBlocks'
import { WIDGET_REGISTRY } from '../../../../../widgets/registry'
import TemplatePreview from '../TemplatePreview'
import styles from './KindSection.module.css'

const iconOf = (k) => (UICON_NAMES.includes(kindIcon(k)) ? kindIcon(k) : 'document')

// How a style's preview names a block. TemplatePreview (in the Notebook's first-open closure) draws no widget
// and knows no block catalog, so each widgetEmbed is swapped, here, for a one-line italic paragraph:
// the chart with its ticker, a style block by its catalog name, any other widget this app KNOWS by its own
// name, and only a block this bundle does not know at all as one from a newer version.
const KNOWN_BLOCKS = new Set(BLOCK_KINDS.map((b) => b.id))
function blockLine(node) {
  const id = node.attrs?.widgetId
  const p = node.attrs?.params || {}
  if (id === 'chart' && p.symbol) return `Chart · ${p.symbol} · ${tfWord(p.tf)}`
  if (KNOWN_BLOCKS.has(id)) return blockLabel(id)
  return WIDGET_REGISTRY[id]?.labels?.header || blockLabel(id)
}
const labelled = (n) => {
  if (n?.type === 'widgetEmbed') return { type: 'paragraph', content: [{ type: 'text', text: blockLine(n), marks: [{ type: 'italic' }] }] }
  return Array.isArray(n?.content) ? { ...n, content: n.content.map(labelled) } : n
}

export default function KindSection({ onCreate, busy = false, autoFocusFirst = false }) {
  const headingId = useId()
  const focusedRef = useRef(false)
  const { data, error, isLoading } = useJournalStyles()
  const [openKind, setOpenKind] = useState(null)
  const [preview, setPreview] = useState(null)   // { style, loading, body, ticker, error }

  if (isLoading) return <p className={styles.status} role="status">Loading kinds of note…</p>
  if (error || !data) return <p className={styles.status} role="alert">Couldn't load your journal styles.</p>

  const showPreview = async (style) => {
    setPreview({ style, loading: true })
    try {
      const out = await previewJournalStyle({ styleId: style.id })
      setPreview({ style, loading: false, body: labelled(out.bodyJson), ticker: out.ticker })
    } catch (e) {
      setPreview({ style, loading: false, error: e.message || "Couldn't build the preview." })
    }
  }
  // A create needs the network (the server composes the note); offline says so instead of failing late.
  const offline = data.fromCache === true

  return (
    <section className={styles.wrap} aria-labelledby={headingId}>
      <h3 id={headingId} className={styles.h}>Start from a kind of note</h3>
      {offline && <p className={styles.status} role="status">You're offline. These are your saved styles; a new note needs a connection.</p>}
      <div role="group" aria-label="Start from a kind of note" className={styles.grid}>
        {data.kinds.map((k, i) => {
          const def = defaultStyleFor(data, k.id)
          return (
            <div key={k.id} className={styles.kind}>
              <button type="button" className={styles.kindBtn} disabled={busy || offline} aria-label={`New ${k.name}`}
                ref={i === 0 && autoFocusFirst ? (el) => { if (el && !focusedRef.current) { focusedRef.current = true; el.focus() } } : undefined}
                onClick={() => onCreate({ kindId: k.id })}>
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
                stylesOfKind(data, k.id).length === 0 ? (
                  <p className={styles.status}>No styles for this kind yet.</p>
                ) : (
                <ul className={styles.list} aria-label={`Styles for ${k.name}`}>
                  {stylesOfKind(data, k.id).map((s) => (
                    <li key={s.id} className={styles.row}>
                      <span className={styles.rowName}>{s.name}{s.builtin ? ' · Built-in' : ''}{s.isDefault ? ' · Default' : ''}</span>
                      <button type="button" className={styles.rowBtn} aria-label={`Preview ${s.name}`} onClick={() => showPreview(s)}>Preview</button>
                      <button type="button" className={styles.rowBtn} disabled={busy || offline} aria-label={`Use ${s.name}`} onClick={() => onCreate({ styleId: s.id })}>Use</button>
                    </li>
                  ))}
                </ul>
                )
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
          onUse={() => { const id = preview.style.id; setPreview(null); onCreate({ styleId: id }) }} />
      )}
    </section>
  )
}

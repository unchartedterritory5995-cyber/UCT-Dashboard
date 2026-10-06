import { useEffect, useState } from 'react'
import Sheet from '../../../components/mobile/Sheet'
import { saveForkOffer, saveFork } from './saveForkApi'
import styles from './SaveForkDialog.module.css'
import Input from '../../../components/ui/Input'

// SaveForkDialog — the save-time fork (AC-11 / UC-4). On open it asks the
// server what this result set can BECOME — a frozen list, a re-runnable
// screen, or a standing alert — and renders all three, every time, whether or
// not a given one is switched on. An unavailable choice is shown disabled
// WITH its reason, never hidden: the member should see the whole shape of the
// feature, not just today's slice of it.
//
// ⛔ NO DEFAULT SELECTION. The server's own rule is "no code path that
// silently defaults to one choice" (a POST with no choice is a 400) — this
// dialog mirrors that by starting with nothing picked and refusing to enable
// Save until the member has explicitly clicked one.
export default function SaveForkDialog({ open, onClose, spec, fetcher = fetch, onSaved }) {
  const [choices, setChoices] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [picked, setPicked] = useState(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  // Fresh ask every time the dialog opens — the three choices are computed
  // live on the server (a feature flag can flip between opens), so a stale
  // answer from a previous open would be a lie about what is available now.
  useEffect(() => {
    if (!open) return undefined
    let live = true
    setChoices(null)
    setLoadError('')
    setPicked(null)
    setName('')
    setNote('')
    saveForkOffer(fetcher).then(offer => {
      if (!live) return
      if (offer?.choices) setChoices(offer.choices)
      else setLoadError('Could not load the save options.')
    })
    return () => { live = false }
  }, [open, fetcher])

  if (!open) return null

  const confirm = async () => {
    if (!picked || busy) return
    setBusy(true)
    setNote('')
    try {
      const out = await saveFork({ choice: picked, name: name.trim() || undefined, spec }, fetcher)
      setNote(savedMessage(picked))
      onSaved?.(out)
    } catch (e) {
      setNote(e?.message || 'Could not save.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} onClose={onClose} variant="auto" title="Save this screen"
      ariaLabel="Save this screen" maxWidth={520}
      footer={(
        <div className={styles.footer}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
            {note ? 'Close' : 'Cancel'}
          </button>
          <button type="button" className="btn btn-primary btn-sm"
            disabled={!picked || busy} onClick={confirm}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}>
      <p className={styles.intro}>What should this become?</p>

      {loadError && <p role="alert" className={styles.error}>{loadError}</p>}

      {choices && (
        <div className={styles.name}>
          <label htmlFor="save-fork-name" className={styles.nameLabel}>Name (optional)</label>
          <Input id="save-fork-name" type="text" className={styles.nameInput}
            value={name} onChange={e => setName(e.target.value)} placeholder="Untitled screen" />
        </div>
      )}

      {choices && (
        <div role="radiogroup" aria-label="What should this become?" className={styles.choices}>
          {choices.map(c => {
            const disabled = !c.available
            const selected = picked === c.id
            return (
              <button type="button" key={c.id} role="radio" aria-checked={selected}
                disabled={disabled}
                className={`${styles.choice} ${selected ? styles.choiceSelected : ''}`}
                onClick={() => !disabled && setPicked(c.id)}>
                <span className={styles.choiceLabel}>{c.label}</span>
                <span className={styles.choiceDetail}>{c.detail}</span>
                {disabled && c.reason && (
                  <span className={styles.choiceReason}>{c.reason}</span>
                )}
              </button>
            )
          })}
        </div>
      )}

      {note && <p role="status" className={styles.note}>{note}</p>}
    </Sheet>
  )
}

function savedMessage(choice) {
  if (choice === 'frozen_list') return 'Saved as a frozen list.'
  if (choice === 'definition') return 'Saved as a re-runnable screen.'
  if (choice === 'standing_alert') return 'Saved as a standing alert.'
  return 'Saved.'
}

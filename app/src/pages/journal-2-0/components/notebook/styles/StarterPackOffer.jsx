// P5 Task 5: "How do you trade?", the starter pack offer (R-P5-5). A lazy-only module: KindSection and the
// Styles manager import it, and both are lazy chunks. It renders nothing while the starter-packs switch is off.
//   · WHEN IT SHOWS BY ITSELF (useStarterPackOffer): the switch is on, the member has no styles of their own,
//     and `notebook_starter_pack` is unset. The decision is LATCHED for the mount: installing a pack gives the
//     member styles and sets the preference, and the result must stay on screen, not vanish with the card.
//   · The Styles manager's "Starter packs" link opens it whenever the switch is on, whatever the preference says.
//   · Choosing a pack installs it, writes {state:'installed', pack}, and says what was added, already had and
//     skipped (with the server's sentence for why, e.g. the style limit). A failed install writes nothing.
//   · "Not now" writes {state:'dismissed'} (only when there is no answer yet: it never overwrites an install)
//     and closes the card. A dismissed offer does not come back unasked.
import { useId, useState } from 'react'
import { useSWRConfig } from 'swr'
import usePreferences from '../../../../../hooks/usePreferences'
import { STYLES_URL } from '../../../lib/journalStyles'
import { starterPacksEnabled } from '../../../lib/starterPacksFlag'
import { PACKS, installStarterPack, readStarterPackState, writeStarterPackState } from '../../../lib/starterPacks'
import { logIfUnexpected } from './styleErrors'
import styles from './StarterPackOffer.module.css'

export const OFFER_TITLE = 'How do you trade?'
export const OFFER_LINE = 'Pick one and we will add three styles you can change.'
export const OFFER_FAILED = "Couldn't add that pack. Nothing was changed."

/** Whether the offer is open, for a surface that holds one. `data` is the journal-styles list (or undefined
 *  while it loads). `open()` is the manager's link; `close()` is "Not now"; `reset()` forgets the latch, so a
 *  surface that closes and opens again (the manager's sheet) asks R-P5-5 afresh. */
export function useStarterPackOffer(data) {
  const on = starterPacksEnabled()
  const { prefs, loading, readFailed } = usePreferences(on)
  const [mode, setMode] = useState(null)              // null: undecided, 'open', 'closed'
  const eligible = on && Boolean(data) && !loading && !readFailed
    && readStarterPackState(prefs) === null
    && !(data.styles || []).some((s) => !s.builtin)
  // Latch the first yes for this mount (a state update while rendering this same component is allowed, and
  // runs once: the next render sees 'open').
  if (mode === null && eligible) setMode('open')
  return {
    on,
    show: on && mode === 'open',
    open: () => { if (on) setMode('open') },
    close: () => setMode('closed'),
    reset: () => setMode(null),
  }
}

const join = (list) => list.join(', ')

/** The answer's lines, in the order a member reads them. Only non-empty lists get a line. */
export function resultLines(out) {
  const lines = []
  const added = (out?.installed || []).map((i) => i?.title).filter(Boolean)
  const had = (out?.alreadyHad || []).filter(Boolean)
  const skipped = (out?.skipped || []).map((s) => (typeof s === 'string' ? { title: s } : s)).filter((s) => s?.title)
  if (added.length) lines.push(`Added: ${join(added)}. They are in your Styles.`)
  if (had.length) lines.push(`Already had: ${join(had)}.`)
  // Rows refused for the same reason share one line (a member at the style limit has all three refused).
  const byReason = new Map()
  for (const s of skipped) {
    const reason = String(s.reason || '').trim()
    if (!byReason.has(reason)) byReason.set(reason, [])
    byReason.get(reason).push(s.title)
  }
  for (const [reason, titles] of byReason) lines.push(`Skipped: ${join(titles)}.${reason ? ` ${reason}` : ''}`)
  return lines
}

export default function StarterPackOffer({ onClose, offline = false }) {
  const headingId = useId()
  const { mutate } = useSWRConfig()
  const { prefs, setPrefMerged } = usePreferences(starterPacksEnabled())
  const [busy, setBusy] = useState(false)
  const [lines, setLines] = useState(null)              // the last install's answer, as sentences
  const [failed, setFailed] = useState(false)

  if (!starterPacksEnabled()) return null

  const choose = async (pack) => {
    setBusy(true); setFailed(false); setLines(null)
    let out
    try {
      out = await installStarterPack(pack)
    } catch (e) {
      logIfUnexpected(e)                                  // a bug of ours is logged; the member reads one sentence
      setFailed(true)
      setBusy(false)
      return
    }
    await writeStarterPackState(setPrefMerged, { state: 'installed', pack })
    mutate(STYLES_URL)                                    // the new styles appear in the lists behind this card
    setLines(resultLines(out))
    setBusy(false)
  }
  const notNow = () => {
    if (readStarterPackState(prefs) === null) writeStarterPackState(setPrefMerged, { state: 'dismissed' })
    onClose?.()
  }

  return (
    <section className={styles.card} aria-labelledby={headingId}>
      <h3 id={headingId} className={styles.title}>{OFFER_TITLE}</h3>
      <p className={styles.line}>{OFFER_LINE}</p>
      <div className={styles.packs}>
        {PACKS.map((p) => (
          <button key={p.key} type="button" className={styles.pack} disabled={busy || offline}
            onClick={() => choose(p.key)}>{p.label}</button>
        ))}
        <button type="button" className={styles.quiet} disabled={busy} onClick={notNow}>
          {lines ? 'Done' : 'Not now'}
        </button>
      </div>
      {offline && <p className={styles.line}>You're offline. Adding a pack needs a connection.</p>}
      <div role="status" aria-live="polite">
        {lines && lines.map((l) => <p key={l} className={styles.result}>{l}</p>)}
      </div>
      {failed && <p role="alert" className={styles.error}>{OFFER_FAILED}</p>}
    </section>
  )
}

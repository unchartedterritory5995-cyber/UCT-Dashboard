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
//   · A write of the answer that did not land is SAID (OFFER_NOT_SAVED), never passed off as saved: "Not now"
//     then keeps the card open so it can be pressed again.
//   · ONE OFFER PER PAGE (ruling P5-T10-R2). Every surface that can hold the card (the empty notebook's inline
//     picker, the New note sheet's, the Styles manager) shares ONE decision through `offerStore`, and only the
//     surface that opened last renders the card. So a page has one card, one Not now and one install path.
import { useEffect, useId, useState, useSyncExternalStore } from 'react'
import { useSWRConfig } from 'swr'
import usePreferences from '../../../../../hooks/usePreferences'
import { STYLES_URL } from '../../../lib/journalStyles'
import { starterPacksEnabled } from '../../../lib/starterPacksFlag'
import { PACKS, installStarterPack, readStarterPackState, writeStarterPackState } from '../../../lib/starterPacks'
import { logIfUnexpected } from './styleErrors'
import styles from './StarterPackOffer.module.css'

export const OFFER_TITLE = 'How do you trade?'
export const OFFER_LINE = 'Pick one and we will add three styles you can change.'
// A lost answer (a 200 the connection dropped) also lands here; a retry is safe, the server says alreadyHad.
export const OFFER_FAILED = "Couldn't confirm that pack. Try again; nothing is added twice."
export const OFFER_EMPTY = 'Nothing was added. This pack has no styles to add right now.'
export const OFFER_NOT_SAVED = "Couldn't save your answer, so this card may ask again."

// The page's ONE decision. `mode`: null undecided, 'open', 'closed'. `hosts`: the surfaces showing now, in the
// order they opened; the last one owns the card. The OWNER leaving forgets the decision, so the ones still on
// screen ask R-P5-5 afresh (and a surface closed from outside cannot leave a stale 'open' behind). Another
// surface leaving changes nothing, so the owner's answer lines stay on screen.
const offerStore = { mode: null, hosts: [], subs: new Set() }
const emit = () => offerStore.subs.forEach((f) => f())
const setOfferMode = (m) => { if (offerStore.mode !== m) { offerStore.mode = m; emit() } }
const subscribe = (f) => { offerStore.subs.add(f); return () => offerStore.subs.delete(f) }
const readMode = () => offerStore.mode
const readOwner = () => offerStore.hosts.at(-1) ?? null

/** Whether the offer shows on THIS surface. `data` is the journal-styles list (or undefined while it loads);
 *  `active` is whether the surface is on screen (the manager passes `open`). `open()` is the manager's link;
 *  `close()` is "Not now"; `reset()` forgets the decision. `settled` says the decision for this surface has
 *  been made (the walk waits for it before it reads an absence). */
export function useStarterPackOffer(data, active = true) {
  const id = useId()
  const on = starterPacksEnabled()
  const { prefs, loading, readFailed } = usePreferences(on)
  const mode = useSyncExternalStore(subscribe, readMode, readMode)
  const owner = useSyncExternalStore(subscribe, readOwner, readOwner)
  const ready = Boolean(data) && !loading
  const eligible = on && ready && !readFailed
    && readStarterPackState(prefs) === null
    && !(data.styles || []).some((s) => !s.builtin)
  useEffect(() => {
    if (!active) return undefined
    offerStore.hosts.push(id)
    emit()
    return () => {
      if (readOwner() === id) offerStore.mode = null
      offerStore.hosts = offerStore.hosts.filter((h) => h !== id)
      emit()
    }
  }, [active, id])
  // Latch the first yes for the page: once open, installing (which gives the member styles) keeps the card.
  useEffect(() => { if (active && eligible && mode === null) setOfferMode('open') }, [active, eligible, mode])
  return {
    on,
    show: on && active && mode === 'open' && owner === id,
    settled: !on || (ready && (!eligible || mode !== null)),
    open: () => { if (on) setOfferMode('open') },
    close: () => setOfferMode('closed'),
    reset: () => setOfferMode(null),
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
  const [notSaved, setNotSaved] = useState(false)       // the answer's write did not land

  if (!starterPacksEnabled()) return null

  // setPrefMerged resolves {ok: true} only when the server took the write (usePreferences postPref).
  const choose = async (pack) => {
    setBusy(true); setFailed(false); setNotSaved(false); setLines(null)
    let out
    try {
      out = await installStarterPack(pack)
    } catch (e) {
      logIfUnexpected(e)                                  // a bug of ours is logged; the member reads one sentence
      setFailed(true)
      setBusy(false)
      return
    }
    const saved = await writeStarterPackState(setPrefMerged, { state: 'installed', pack })
    mutate(STYLES_URL)                                    // the new styles appear in the lists behind this card
    const said = resultLines(out)
    setLines(said.length ? said : [OFFER_EMPTY])
    setNotSaved(saved?.ok !== true)
    setBusy(false)
  }
  const notNow = async () => {
    if (readStarterPackState(prefs) === null) {
      setBusy(true); setNotSaved(false)
      const saved = await writeStarterPackState(setPrefMerged, { state: 'dismissed' })
      setBusy(false)
      if (saved?.ok !== true) { setNotSaved(true); return }   // the card stays, so Not now can be pressed again
    }
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
      {notSaved && <p role="alert" className={styles.error}>{OFFER_NOT_SAVED}</p>}
    </section>
  )
}

// P0.8: "Capture from anywhere" -- the three ways in that live in Settings, pointed at from
// inside the Notebook (under the import dropzone, and on the first-run welcome).
//
// ⛔ A DOOR SHOWS EXACTLY WHEN ITS SETTINGS CARD WOULD RENDER, because it asks the card's own
// endpoint through the card's own fetcher (INBOUND_EMAIL_URL + inboundEmailFetcher,
// PERSONAL_API_URL + personalApiFetcher: exported by the cards, one authority). A 404 is
// "switched off" (the fetcher maps it to `dark`), a 402 is "needs a paid plan" (`unpaid`), and an
// answer that is not there yet, or a failure that is not a 404 (a 502 in a deploy swap), leaves the
// gate UNKNOWN and hides the door: the cards' own M-2 rule. There is deliberately no Notebook flag
// here; the endpoints are the gate. SWR dedupes the same key, so mounted beside the Settings cards
// this adds no request.
//
// ⛔ The browser extension has no gate (BrowserCaptureCard asks nothing before it renders), and the
// listing is published unlisted, so its link is the only way a member finds it.
import { useId, useState } from 'react'
import useSWR from 'swr'
import { INBOUND_EMAIL_URL, inboundEmailFetcher } from '../InboundEmailCard'
import { PERSONAL_API_URL, personalApiFetcher } from '../PersonalApiCard'
import { CAPTURE_INSTALL_URL } from '../BrowserCaptureCard'
import ShortcutHowTo, { ConnectionsLink } from './ShortcutHowTo'
import styles from './CaptureDoors.module.css'

const ONCE = Object.freeze({ revalidateOnFocus: false, shouldRetryOnError: false })
const live = (d) => Boolean(d) && !d.dark && !d.unpaid

export default function CaptureDoors({ compact = false }) {
  const headingId = useId()
  const [howTo, setHowTo] = useState(false)
  const { data: emailGate } = useSWR(INBOUND_EMAIL_URL, inboundEmailFetcher, ONCE)
  const { data: apiGate } = useSWR(PERSONAL_API_URL, personalApiFetcher, ONCE)
  const email = live(emailGate)
  const shortcut = live(apiGate)
  return (
    <section className={compact ? styles.compact : styles.box} aria-labelledby={headingId}>
      <h3 id={headingId} className={styles.heading}>Capture from anywhere</h3>
      <ul className={styles.list}>
        {email && (
          <li className={styles.item}>
            <ConnectionsLink className={styles.door}>Email to Notebook</ConnectionsLink>
            <span className={styles.what}>: forward an email and it becomes a note.</span>
          </li>
        )}
        <li className={styles.item}>
          <a className={styles.door} href={CAPTURE_INSTALL_URL} target="_blank" rel="noopener noreferrer">
            Browser extension<span className={styles.srOnly}> (opens in a new tab)</span>
          </a>
          <span className={styles.what}>: save a web page or a selection in one click.</span>
        </li>
        {shortcut && (
          <li className={styles.item}>
            <button type="button" className={styles.door} onClick={() => setHowTo(true)}>iPhone Shortcut</button>
            <span className={styles.what}>: send text from your phone.</span>
          </li>
        )}
      </ul>
      {howTo && <ShortcutHowTo onClose={() => setHowTo(false)} />}
    </section>
  )
}

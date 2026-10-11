// P0.8: the iPhone Shortcut how-to, opened from the "Capture from anywhere" box (CaptureDoors).
//
// ⛔ EVERY STEP COMES FROM docs/notebook/ios-shortcuts.md (its sections 1 and 2) and from nowhere
// else: the address, the header and the one field named below are the ones that doc names, and
// ShortcutHowTo.test.jsx reads the doc and holds this copy to it. Nothing here is invented.
// This sheet teaches the "Append to today's note" Shortcut only. The doc's second Shortcut
// (a share-sheet "Save to UCT") is built the same way and is left in the doc.
//
// ⛔ Member-facing words. The card in Settings is called "Connect apps & shortcuts" and its button
// says "Make a token", so those are the words used for finding it; the rest says "key".
//
// ⭐ The "Make a key" link goes to Settings > Connections, which Settings already deep-links with
// `?section=connections` (BrokerConnectionsCard and Support use the same address). It is a router
// <Link> inside the app and a plain anchor where there is no router (a unit test), so the sheet
// never throws for want of one.
import { Link, useInRouterContext } from 'react-router-dom'
import Sheet from '../../../../components/mobile/Sheet'
import styles from './ShortcutHowTo.module.css'

/** Where "Make a key" goes: the Settings section the key is made in. One address for every door. */
export const CONNECTIONS_PATH = '/settings?section=connections'

/** The sheet's title (and so its accessible name). */
export const SHORTCUT_SHEET_TITLE = 'Send notes from your iPhone'

const step = (id, title, body, details) =>
  Object.freeze({ id, title, body, ...(details ? { details: Object.freeze(details) } : {}) })

/**
 * The steps, in the order a member walks them. Backticks mark text to type or tap exactly as
 * written. Frozen all the way down: the test reads this array, and so does the sheet.
 */
export const SHORTCUT_STEPS = Object.freeze([
  step(
    'key',
    'Make a key',
    'In UCT, open Settings, then Connections, then Connect apps & shortcuts. Name the key (for example, iPhone Shortcuts) and tap `Make a token`. Then tap `Copy`. The key is shown only once, so copy it before you leave.',
  ),
  step(
    'app',
    'Open the Shortcuts app',
    "On your iPhone, open the Shortcuts app and tap `+` to start a new Shortcut. Name it `Append to today's note`.",
  ),
  step('actions', 'Add the actions', 'Add these actions, in this order:', [
    'Text. This holds your key (you paste it in the next step).',
    'Dictate Text. Set Stop Listening to After Pause. If you would rather type, use Ask for Input instead.',
    'Get Contents of URL. Set the URL to `https://uctintelligence.com/api/j2/personal/daily/append`. Tap Show More and set Method to POST.',
    'Still in Get Contents of URL, set Request Body to JSON and add one Text field named `markdown`. Its value is the Dictated Text.',
    "Optional: to see UCT's reply when something goes wrong, add Get Dictionary Value for the key `detail`, then an If action that shows that value when there is one. Otherwise it can show the notification `Added to today's note.`",
  ]),
  step('paste', 'Paste the key', 'Now connect the key to the Shortcut:', [
    'Paste your key into the Text action at the top. Tap its output and rename it `UCT key`.',
    'In Get Contents of URL, open Headers and add a header named `Authorization`. For its value, type `Bearer ` (with a space after it), then insert `UCT key`.',
  ]),
  step(
    'test',
    'Test it',
    'Run the Shortcut and say something, for example "NVDA reclaimed VWAP on volume". Then open today\'s note in UCT. Today means New York time, not your phone\'s.',
    [
      "If it says your key is missing, expired or revoked, make a new one in Connect apps & shortcuts and paste it into your Shortcut again.",
    ],
  ),
])

/** Said under the steps. Wording follows the doc's warning about sharing a Shortcut. */
export const SHORTCUT_WARNING =
  'Never share this Shortcut. It carries your key, and anyone who has the key can add to your Notebook for up to a year. If you shared it by mistake, revoke that key in Connect apps & shortcuts, make a new one, and paste it into your own copy.'

/** Renders `like this` runs as <code>. Plain text everywhere else. */
function rich(text) {
  return text.split('`').map((part, i) => (i % 2 ? <code key={i} className={styles.code}>{part}</code> : part))
}

/** A link to Settings > Connections: a router link in the app, a plain anchor without a router. */
export function ConnectionsLink({ children, onClick, className }) {
  const inRouter = useInRouterContext()
  return inRouter
    ? <Link to={CONNECTIONS_PATH} className={className} onClick={onClick}>{children}</Link>
    : <a href={CONNECTIONS_PATH} className={className} onClick={onClick}>{children}</a>
}

export default function ShortcutHowTo({ onClose }) {
  return (
    <Sheet open onClose={onClose} variant="auto" title={SHORTCUT_SHEET_TITLE} labelledByTitle>
      <div className={styles.body}>
        <ol className={styles.steps} aria-label="Steps">
          {SHORTCUT_STEPS.map((s) => (
            <li key={s.id} className={styles.step}>
              <p className={styles.stepTitle}><strong>{s.title}</strong></p>
              <p className={styles.text}>{rich(s.body)}</p>
              {s.id === 'key' && (
                <p className={styles.linkRow}>
                  <ConnectionsLink className={styles.link} onClick={onClose}>Make a key in Settings</ConnectionsLink>
                </p>
              )}
              {s.details && (
                <ul className={styles.details}>
                  {s.details.map((d) => <li key={d} className={styles.text}>{rich(d)}</li>)}
                </ul>
              )}
            </li>
          ))}
        </ol>
        <p className={styles.warning}>{SHORTCUT_WARNING}</p>
      </div>
    </Sheet>
  )
}

// UCT Terminal — the first-run orientation (Wave 2, audit 2026-10-08).
//
// A brand-new member used to land on one bare CAL panel with nothing but the input placeholder
// to say what the terminal is. This is a short card under the command bar for a member with NO
// saved board yet: how a command is shaped, where every function is listed, and how panels
// follow each other. It is dismissible, and the dismissal is remembered on the member's account
// (`terminal_orientation_seen`), so it never returns on another device. A member who already has
// a board never sees it. Since 2026-10-08 the board behind it is the two-panel first-visit board
// (CAL beside an SPY overview, boardModel `firstVisitLayout`).
import { useEffect, useState } from 'react'
import usePreferences from '../../hooks/usePreferences'
import { TERMINAL_LAYOUT_PREF } from './useTerminalLayout'
import styles from './TerminalShell.module.css'

export const ORIENTATION_PREF = 'terminal_orientation_seen'

export default function FirstRunCard({ onTry }) {
  const { prefs, setPref, loading } = usePreferences()
  // Eligibility is decided ONCE, when preferences have loaded: a member with no saved board.
  // The first command saves a board, and the card must not vanish under the member's cursor.
  const [eligible, setEligible] = useState(null)
  useEffect(() => {
    if (loading || eligible !== null) return
    setEligible(prefs?.[TERMINAL_LAYOUT_PREF] == null && !prefs?.[ORIENTATION_PREF])
  }, [loading, prefs, eligible])
  const [dismissed, setDismissed] = useState(false)
  if (!eligible || dismissed || prefs?.[ORIENTATION_PREF]) return null
  const dismiss = () => { setDismissed(true); setPref(ORIENTATION_PREF, '1') }
  const tryIt = (cmd) => (
    <button type="button" className={styles.chip} onClick={() => onTry?.(cmd)} data-testid={`terminal-firstrun-try-${cmd.replace(/\s+/g, '-')}`}>{cmd}</button>
  )
  return (
    <section className={styles.firstRun} aria-labelledby="terminal-firstrun-title" data-testid="terminal-firstrun">
      <h2 id="terminal-firstrun-title" className={styles.firstRunTitle}>New to the terminal? Three things to know</h2>
      <ul className={styles.firstRunList}>
        <li>Type a ticker, then a function, and press Enter: {tryIt('NVDA GP')} opens a chart, {tryIt('NVDA DES')} the company.</li>
        <li>{tryIt('HELP')} lists every function in plain words. The list on the left does too.</li>
        <li>Panels of the same colour follow each other: change the ticker in one and the rest of its group changes with it.</li>
      </ul>
      <button type="button" className={styles.chip} onClick={dismiss} data-testid="terminal-firstrun-dismiss">Got it, hide this</button>
    </section>
  )
}

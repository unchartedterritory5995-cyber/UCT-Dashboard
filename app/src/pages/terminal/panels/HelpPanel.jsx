// HELP — the function list, DERIVED from the registry (never a second list), plus the syntax.
import { FUNCTIONS, FUNCTION_GROUPS, ABSENT, BY_CODE } from '../functions'
import styles from '../TerminalShell.module.css'

export default function HelpPanel({ focusCode = null, onRun }) {
  // `HELP GP` — the registry-validated code args.js applied (an unknown one is echoed, not shown).
  const focus = focusCode && BY_CODE[focusCode] ? focusCode : null
  const rows = focus ? [BY_CODE[focus]] : FUNCTIONS
  return (
    <div className={styles.help} data-testid="terminal-help">
      <p className={styles.helpSyntax}>
        Type <kbd>TICKER</kbd> for an overview, <kbd>TICKER FUNC</kbd> for a function
        (<kbd>NVDA GP</kbd>, <kbd>AAPL FA</kbd>), or a bare <kbd>FUNC</kbd> for a market-wide one
        (<kbd>CAL</kbd>, <kbd>BRD</kbd>). Arguments follow the code: <kbd>NVDA GP W</kbd> (weekly),
        <kbd>CAL TODAY</kbd>, <kbd>CAL NEXT</kbd>. <kbd>$CAL</kbd> forces a ticker. Saved things open by
        address (<kbd>L:12</kbd>, <kbd>W:3</kbd>).
      </p>
      {FUNCTION_GROUPS.map((g) => {
        const inGroup = rows.filter((f) => f.group === g)
        if (!inGroup.length) return null
        return (
          <section key={g}>
            <h3 className={styles.helpGroup}>{g}</h3>
            <ul className={styles.helpList}>
              {inGroup.map((f) => (
                <li key={f.code}>
                  <button type="button" className={styles.helpRow} onClick={() => onRun?.(f.code)}>
                    <span className={styles.code}>{f.code}</span>
                    <span>{f.label}</span>
                    <span className={styles.helpScope}>
                      {[f.ticker && 'security', f.market && 'market'].filter(Boolean).join(' · ')}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
      {!focus && Object.keys(ABSENT).length > 0 && (
        <section>
          <h3 className={styles.helpGroup}>Not on this release</h3>
          <ul className={styles.helpList}>
            {Object.entries(ABSENT).map(([code, why]) => (
              <li key={code} className={styles.helpAbsent}><span className={styles.code}>{code}</span> {why}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

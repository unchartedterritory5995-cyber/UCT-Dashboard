// HELP — the ONE-PAGE ADDRESS SPACE (lane T3, P13): the syntax, every published grammar
// rule, the suggestion ranking (with its Reset), the keyboard bindings, the saved-item
// address prefixes, and the numbered function list (row <GO>: type `3` + Enter).
//
// ⛔ NOTHING HERE IS A SECOND LIST. Functions come from the registry, rules and prefixes from
// grammar.js, keys from the shortcut registry's own declarations — each railed to its source.
import { useEffect, useMemo } from 'react'
import { FUNCTIONS, FUNCTION_GROUPS, ABSENT, BY_CODE } from '../functions'
import {
  ADDRESS_PREFIXES, ALIAS_RULE, ASK_RULE, CHANNEL_RULE, COLLISION_RULE, COMPARE_RULE, RANKING_ORDER,
  ROW_RULE, TICKER_COLLISIONS,
} from '../grammar'
import { SHORTCUTS } from '../../command/shortcutRegistry'
import styles from '../TerminalShell.module.css'

/** The bindings a terminal user has, read from the declarations (never retyped). */
export const HELP_SHORTCUT_IDS = ['terminal.focus', 'terminal.panel1', 'terminal.panel2',
  'terminal.panel3', 'terminal.panel4', 'palette.toggle']

/** Pure: a declaration's chord as the keys a member presses. */
export function chordLabel(d) {
  const c = d.chord
  const mods = []
  if (c.mod === 'either') mods.push('Ctrl/Cmd')
  if (c.mod === 'platform') mods.push('Ctrl (Cmd on Mac)')
  if (c.ctrl) mods.push('Ctrl')
  if (c.meta) mods.push('Cmd')
  if (c.alt) mods.push('Alt')
  if (c.shift) mods.push('Shift')
  const key = c.code ? c.code.replace(/^Key|^Digit/, '') : String(c.keys[0]).toUpperCase()
  return [...mods, key].join('+')
}

export default function HelpPanel({ args = [], onRun, onRows, onResetRanking, hasStats = false }) {
  const focus = args[0] && BY_CODE[args[0]] ? args[0] : null
  const rows = focus ? [BY_CODE[focus]] : FUNCTIONS
  // The numbered order = the order rendered (grouped), so "3" opens the row labelled 3.
  const ordered = useMemo(() => FUNCTION_GROUPS.flatMap((g) => rows.filter((f) => f.group === g)), [rows])
  useEffect(() => { onRows?.(ordered.map((f) => f.code)) }, [onRows, ordered])
  const keys = HELP_SHORTCUT_IDS.map((id) => SHORTCUTS.find((d) => d.id === id)).filter(Boolean)
  let n = 0
  return (
    <div className={styles.help} data-testid="terminal-help">
      <p className={styles.helpSyntax}>
        Type <kbd>TICKER</kbd> for an overview, <kbd>TICKER FUNC</kbd> for a function
        (<kbd>NVDA GP</kbd>, <kbd>AAPL FA</kbd>), or a bare <kbd>FUNC</kbd> for a market-wide one
        (<kbd>CAL</kbd>, <kbd>BRD</kbd>). <kbd>$CAL</kbd> forces a ticker. Saved things open by
        address (<kbd>L:12</kbd>, <kbd>W:3</kbd>). The line above the input says what Enter will do.
      </p>
      {!focus && (
        <section data-testid="terminal-help-rules">
          <h3 className={styles.helpGroup}>Rules</h3>
          {[COLLISION_RULE, CHANNEL_RULE, COMPARE_RULE, ASK_RULE, ALIAS_RULE, ROW_RULE].map((r) => (
            <p key={r} className={styles.helpRule}>{r}</p>
          ))}
          <p className={styles.helpRule}>Codes that are also tickers: {TICKER_COLLISIONS.join(', ')}.</p>
          <h3 className={styles.helpGroup}>Suggestion order</h3>
          <ol className={styles.helpRule} data-testid="terminal-help-ranking">
            {RANKING_ORDER.map((r) => <li key={r.key}>{r.label}</li>)}
          </ol>
          <button type="button" className={styles.helpRow} onClick={() => onResetRanking?.()}
            disabled={!onResetRanking || !hasStats} data-testid="terminal-reset-ranking">
            <span>Reset my ranking</span>
            <span className={styles.helpScope}>{hasStats ? 'forget my command counts' : 'nothing learned yet'}</span>
          </button>
          <h3 className={styles.helpGroup}>Keys</h3>
          <table className={styles.helpTable} data-testid="terminal-help-keys">
            <tbody>
              {keys.map((d) => (
                <tr key={d.id}><td><kbd>{chordLabel(d)}</kbd></td><td>{d.why.split('. ')[0]}.</td></tr>
              ))}
            </tbody>
          </table>
          <h3 className={styles.helpGroup}>Addresses</h3>
          <table className={styles.helpTable} data-testid="terminal-help-addresses">
            <tbody>
              {ADDRESS_PREFIXES.map((a) => (
                <tr key={a.prefix}><td><kbd>{a.prefix}:id</kbd></td><td>{a.label}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {FUNCTION_GROUPS.map((g) => {
        const inGroup = rows.filter((f) => f.group === g)
        if (!inGroup.length) return null
        return (
          <section key={g}>
            <h3 className={styles.helpGroup}>{g}</h3>
            <ul className={styles.helpList}>
              {inGroup.map((f) => {
                n += 1
                return (
                  <li key={f.code}>
                    <button type="button" className={styles.helpRow} onClick={() => onRun?.(f.code)}>
                      <span className={styles.rowNum} aria-hidden="true">{n}</span>
                      <span className={styles.code}>{f.code}</span>
                      <span>{f.label}</span>
                      <span className={styles.helpScope}>
                        {[f.ticker && 'security', f.market && 'market'].filter(Boolean).join(' · ')}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
      {!focus && (
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

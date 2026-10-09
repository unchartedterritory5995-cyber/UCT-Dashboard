// HELP — the ONE-PAGE ADDRESS SPACE (lane T3, P13): the syntax, every published grammar
// rule, the suggestion ranking (with its Reset), the keyboard bindings, the saved-item
// address prefixes, and the numbered function list (row <GO>: type `3` + Enter).
//
// ⛔ NOTHING HERE IS A SECOND LIST. Functions come from the registry, rules and prefixes from
// grammar.js, keys from the shortcut registry's own declarations — each railed to its source.
import { useEffect, useMemo } from 'react'
import { FUNCTIONS, FUNCTION_GROUPS, ABSENT, BY_CODE, aliasesOf, exampleFor, flagOn } from '../functions'
import {
  ADDRESS_PREFIXES, ALIAS_RULE, ASK_RULE, BOARD_RULE, CHANNEL_RULE, COLLISION_RULE, COMPARE_RULE, RANKING_ORDER,
  ROW_RULE, START_HERE, TICKER_COLLISIONS,
} from '../grammar'
import { SHORTCUTS } from '../../command/shortcutRegistry'
import { boardableCodes } from '../scanBoard'
import { ARG_KINDS } from '../args'
import { COMMAND_LINE_KEYS } from '../CommandLine'
import styles from '../TerminalShell.module.css'

/** The bindings a terminal user has, read from the declarations (never retyped). */
export const HELP_SHORTCUT_IDS = ['terminal.focus', 'palette.toggle', 'terminal.panel1', 'terminal.panel2',
  'terminal.panel3', 'terminal.panel4', 'terminal.panelPrev', 'terminal.panelNext',
  'terminal.count1', 'terminal.count2', 'terminal.count3', 'terminal.count4',
  'terminal.panelMoveLeft', 'terminal.panelMoveRight', 'terminal.panelMaximise', 'terminal.panelClose',
  'terminal.panelUndoClose', 'terminal.panelDuplicate', 'terminal.panelLink', 'terminal.boards',
  'terminal.recents', 'terminal.keys']

const CODE_LABEL = { BracketLeft: '[', BracketRight: ']', Slash: '/' }

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
  const key = c.code ? (CODE_LABEL[c.code] || c.code.replace(/^Key|^Digit/, '')) : String(c.keys[0]).toUpperCase()
  return [...mods, key].join('+')
}

/** The flag that gates a code, if any. HELP lists codes with no security in hand, so the
 *  variant that would actually run from HELP is the MARKET one when the code has one (the
 *  same selection `variantFor`/`resolvePanel` make for a ticker-less command) — the ticker
 *  variant's flag is read only as a fallback, for a ticker-only code. A code with neither
 *  carries no flag and HELP shows no marker for it at all.
 *  FLOW is why this order matters: its market door (`/options-flow`, bare `FLOW`) carries no
 *  flag and always runs, while its ticker panel is gated by `researchFlowTabEnabled` — reading
 *  the ticker flag first made HELP say "not enabled" for a code that works when typed bare. */
function flagFor(f) {
  return f.market?.flag || f.ticker?.flag || null
}

/** What HELP says a variant is: `security` / `market`, and "(opens a page)" when running it leaves the
 *  terminal for a page of its own (a `leavesTerminal` door). The rail's hover already said so; the list
 *  a new member reads did not, so JRNL, LIVE, GEX or EXP pulled them out of the terminal unannounced
 *  (audit 2026-10-08). Read from the registry, never typed. */
export function scopeLabel(f) {
  const one = (v, name) => (v ? (v.door && v.leavesTerminal ? `${name} (opens a page)` : name) : null)
  return [one(f.ticker, 'security'), one(f.market, 'market')].filter(Boolean).join(' · ')
}

/** The keyboard sheet: every terminal binding (from the registry's own declarations) and the
 *  command line's keys. HELP prints it; Alt+/ shows the same element over the board. */
export function KeysTable() {
  const keys = HELP_SHORTCUT_IDS.map((id) => SHORTCUTS.find((d) => d.id === id)).filter(Boolean)
  return (
    <>
      <table className={styles.helpTable} data-testid="terminal-help-keys" aria-label="Terminal keyboard shortcuts">
        <tbody>
          {keys.map((d) => (
            <tr key={d.id}><td><kbd>{chordLabel(d)}</kbd></td><td>{d.why.split('. ')[0]}.</td></tr>
          ))}
        </tbody>
      </table>
      <h3 className={styles.helpGroup}>In the command line</h3>
      <table className={styles.helpTable} data-testid="terminal-help-cmdkeys" aria-label="Command line keys">
        <tbody>
          {COMMAND_LINE_KEYS.map((k) => (
            <tr key={k.keys}><td><kbd>{k.keys}</kbd></td><td>{k.does}</td></tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

/** Pure: what `HELP <code>` says a code's arguments are, per variant, from args.js's own `takes`
 *  text (audit 2026-10-08, HELP P2: `HELP GP` showed the label only). Never retyped. */
export function argsLines(f) {
  const line = (v, how) => {
    if (!v) return null
    const takes = [...new Set((v.args || []).map((a) => ARG_KINDS[a.kind]?.takes).filter(Boolean))]
    return `${how}: ${takes.length ? `takes ${takes.join(' or ')}` : 'takes no arguments'}.`
  }
  return [line(f.ticker, `With a ticker (NVDA ${f.code})`), line(f.market, `Market-wide (${f.code})`)].filter(Boolean)
}

/** Pure: the short "takes …" a HELP row shows beside its example, from args.js's own `takes`
 *  (both variants, once each), or null when the code takes nothing. `MINE` is left out: it is
 *  a chip in the panel, not something a new member needs on the list. */
export function takesLine(f) {
  const kinds = [...(f.ticker?.args || []), ...(f.market?.args || [])].map((a) => a.kind)
    .filter((k) => k !== 'mine' && k !== 'symbol')
  const takes = [...new Set(kinds.map((k) => ARG_KINDS[k]?.takes).filter(Boolean))]
  const symbols = [...(f.ticker?.args || []), ...(f.market?.args || [])].some((a) => a.kind === 'symbol')
  if (symbols) takes.push('tickers to compare')
  return takes.length ? takes.join(', ') : null
}

export default function HelpPanel({ focusCode = null, onRun, onRows, onResetRanking, hasStats = false, auth = null }) {
  // `HELP GP` — the registry-validated code args.js applied (an unknown one is echoed, not shown).
  const focus = focusCode && BY_CODE[focusCode] ? BY_CODE[focusCode].code : null
  const rows = focus ? [BY_CODE[focus]] : FUNCTIONS
  // The numbered order = the order rendered (grouped), so "3" opens the row labelled 3.
  const ordered = useMemo(() => FUNCTION_GROUPS.flatMap((g) => rows.filter((f) => f.group === g)), [rows])
  useEffect(() => { onRows?.(ordered.map((f) => f.code)) }, [onRows, ordered])
  // Quality pass 2026-10-05: until the sign-in payload has ARRIVED every flag reads false, so
  // every gated code flashed "not enabled" for a moment on open. While it is still loading (or
  // the first read failed transiently) HELP shows no marker at all, never a guess.
  const flagsKnown = !(auth?.loading || auth?.authTransient)
  let n = 0
  return (
    <div className={styles.help} data-testid="terminal-help">
      {/* Owner decision 2026-10-08 (product item #1): a new member opens HELP to find out where
          to begin, so the first thing it shows is the handful of daily functions, each with an
          example that runs on click. Not numbered: the numbered rows are the full list below. */}
      {!focus && (
        <section data-testid="terminal-help-start" aria-labelledby="terminal-help-start-title">
          <h3 id="terminal-help-start-title" className={styles.helpGroup}>Start here</h3>
          <ul className={styles.helpList}>
            {START_HERE.map((s) => (
              <li key={s.code}>
                <button type="button" className={styles.helpRow} onClick={() => onRun?.(s.example)}
                  data-testid={`terminal-help-start-${s.code}`} aria-label={`${s.what}. Run ${s.example}`}>
                  <span className={styles.code}>{s.code}</span>
                  <span>{s.what}</span>
                  <kbd>{s.example}</kbd>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className={styles.helpSyntax}>
        Type <kbd>TICKER</kbd> for an overview, <kbd>TICKER FUNC</kbd> for a function
        (<kbd>NVDA GP</kbd>, <kbd>AAPL FA</kbd>), or a bare <kbd>FUNC</kbd> for a market-wide one
        (<kbd>CAL</kbd>, <kbd>BRD</kbd>). Arguments follow the code: <kbd>NVDA GP W</kbd> (weekly),
        <kbd>CAL TODAY</kbd>, <kbd>CAL NEXT</kbd>. <kbd>$CAL</kbd> forces a ticker. Saved things open by
        address (<kbd>L:12</kbd>, <kbd>W:3</kbd>). The line above the input says what Enter will do.
      </p>
      {focus && (
        <section data-testid="terminal-help-args">
          {argsLines(BY_CODE[focus]).map((l) => <p key={l} className={styles.helpRule}>{l}</p>)}
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
                const flag = flagFor(f)
                // A code with no `flag` carries no marker — it's always available. One that
                // has one is gated by the EXACT same helper + auth source `resolvePanel` uses
                // (functions.js::flagOn over AuthContext), so HELP never disagrees with the
                // real gate a member hits when they run the code.
                const enabled = flag && flagsKnown ? flagOn(auth, flag) : null
                return (
                  <li key={f.code}>
                    <button type="button" data-panel-row className={`${styles.helpRow} ${styles.helpFnRow}`} onClick={() => onRun?.(f.code)}>
                      <span className={styles.rowNum} aria-hidden="true">{n}</span>
                      <span className={styles.code}>{f.code}</span>
                      <span>
                        {f.label}
                        {aliasesOf(f.code).length > 0 && (
                          <span className={styles.helpScope} data-testid={`terminal-help-alias-${f.code}`}>
                            {' '}(also {aliasesOf(f.code).join(', ')})
                          </span>
                        )}
                        <span className={styles.helpExample} data-testid={`terminal-help-example-${f.code}`}>
                          <kbd>{exampleFor(f)}</kbd>
                          {takesLine(f) && <> · takes {takesLine(f)}</>}
                          {f.note && <> · {f.note}</>}
                        </span>
                      </span>
                      <span className={styles.helpScope}>
                        {scopeLabel(f)}
                        {enabled != null && (
                          <span
                            className={enabled ? styles.helpFlagOn : styles.helpFlagOff}
                            data-testid={`terminal-help-flag-${f.code}`}
                          >
                            {' · '}{enabled ? 'enabled' : 'not enabled'}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
      {/* Audit 2026-10-08 (HELP P2): the reference material (rules, ranking, keys, addresses) used
          to come BEFORE the function list, which is what a new member opens HELP for. It follows it.
          Wave 5: and it is folded under a closed "Advanced" disclosure (a native <details>, so the
          summary is a focusable control that Enter/Space toggles), leaving "Start here" and the
          function list as what a new member sees. */}
      {!focus && (
        <details className={styles.helpAdvanced} data-testid="terminal-help-advanced">
          <summary className={styles.helpGroup} data-testid="terminal-help-advanced-toggle">Advanced: rules, keys and addresses</summary>
          <section data-testid="terminal-help-rules">
            <h3 className={styles.helpGroup}>Rules</h3>
            {[COLLISION_RULE, CHANNEL_RULE, COMPARE_RULE, ASK_RULE, ALIAS_RULE, ROW_RULE, BOARD_RULE].map((r) => (
              <p key={r} className={styles.helpRule}>{r}</p>
            ))}
            {/* BOARD's entry names the codes the list panels' "Board of" menu offers — the SAME list
                the menu reads (scanBoard.boardableCodes), never a copy, and only once flags are known. */}
            {flagsKnown && (
              <p className={styles.helpRule} data-testid="terminal-help-board-codes">
                The &ldquo;Board of&rdquo; menu on a list (MOST, the screener, RRG) offers:{' '}
                {boardableCodes(auth).map((c, i) => (
                  <span key={c.code}>{i ? ', ' : ''}<kbd>{c.code}</kbd> {c.label.toLowerCase()}</span>
                ))}. Any other per-security code works when typed (<kbd>BOARD OWN</kbd>).
              </p>
            )}
            <p className={styles.helpRule}>Codes that are also tickers: {TICKER_COLLISIONS.join(', ')}.</p>
            <h3 className={styles.helpGroup}>Suggestion order</h3>
            <ol className={styles.helpRule} data-testid="terminal-help-ranking">
              {RANKING_ORDER.map((r) => <li key={r.key}>{r.label}</li>)}
            </ol>
            <button type="button" data-panel-row className={`${styles.helpRow} ${styles.helpRowPlain}`} onClick={() => onResetRanking?.()}
              disabled={!onResetRanking || !hasStats} data-testid="terminal-reset-ranking">
              <span>Reset my ranking</span>
              <span className={styles.helpScope}>{hasStats ? 'forget my command counts' : 'nothing learned yet'}</span>
            </button>
            <h3 className={styles.helpGroup}>Keys</h3>
            <KeysTable />
            <h3 className={styles.helpGroup}>Addresses</h3>
            <table className={styles.helpTable} data-testid="terminal-help-addresses" aria-label="Address prefixes">
              <tbody>
                {ADDRESS_PREFIXES.map((a) => (
                  <tr key={a.prefix}><td><kbd>{a.prefix}:id</kbd></td><td>{a.label}</td></tr>
                ))}
              </tbody>
            </table>
          </section>
        </details>
      )}
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

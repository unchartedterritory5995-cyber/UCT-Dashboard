// UCT Terminal — ONE way to say "this is not a ticker we know", for every one-stock panel.
//
// Wave 2 (api/services/symbol_presence.py) made four reads say so for a DEFINITE miss:
// `/api/snapshot/{t}`, `/api/fundamentals/{t}`, `/api/ticker-meta/{t}` and
// `/api/research/snapshot/{sym}` gain the additive fields
//   { not_found: true, message: "No data for ZZQXV — check the ticker", suggestions: [...] }
// while their existing fields stay exactly as they were. Before wave 4 nothing drew them, so a
// mistyped symbol painted an empty card that read like a real company with nothing on file.
//
// `notFoundOf(payload)` is the one reader of that marker; `<TickerNotFound>` the one drawing of
// it. The security headline (inline) and the DES body (block) both use these two, so the copy and
// the suggestion buttons cannot drift between panels.
//
// Suggestions LOAD the name (`$SYM`, the same thing typing a row number does). Inside a terminal
// panel the run wire comes from the panel context; a caller outside it (the frame's headline) may
// hand one in as `onRun`; with neither, the names render as plain text, never a dead button.
import { usePanelRun } from './terminalPanel'
import PanelState from './PanelState'
import styles from './TickerNotFound.module.css'

const SYM_RE = /^[A-Z0-9][A-Z0-9.\-^=]{0,14}$/

/** `{message, suggestions}` when `payload` carries the wave-2 `not_found` marker, else null. */
export function notFoundOf(payload, sym = '') {
  if (!payload || typeof payload !== 'object' || payload.not_found !== true) return null
  const name = String(sym || payload.sym || payload.symbol || payload.ticker || '').trim().toUpperCase()
  const message = typeof payload.message === 'string' && payload.message.trim()
    ? payload.message.trim()
    : `No data for ${name || 'this symbol'}: check the ticker`
  const suggestions = Array.isArray(payload.suggestions)
    ? [...new Set(payload.suggestions
      .map((s) => String((s && typeof s === 'object' ? s.symbol || s.ticker : s) || '').trim().toUpperCase())
      .filter((s) => SYM_RE.test(s) && s !== name))].slice(0, 8)
    : []
  return { message, suggestions }
}

function Suggestions({ names, run }) {
  if (!names.length) return null
  return (
    <span className={styles.suggest} data-testid="ticker-not-found-suggestions">
      <span className={styles.label}>Did you mean</span>
      {names.map((s, i) => (
        <span key={s} className={styles.item}>
          {run
            ? (
              <button type="button" className={styles.link} onClick={() => run(`$${s}`)}
                aria-label={`Load ${s}`} title={`Load ${s} into the linked panels`}
                data-testid={`ticker-suggestion-${s}`}>{s}</button>
            )
            : <b className={styles.plain} data-testid={`ticker-suggestion-${s}`}>{s}</b>}
          {i < names.length - 1 ? <span aria-hidden="true">,</span> : null}
        </span>
      ))}
      <span aria-hidden="true">?</span>
    </span>
  )
}

/**
 * The not-found notice. `variant="inline"` is one line (the headline); `"block"` is the panel's
 * own empty state (PanelState, kind "input": the member needs to type a different ticker).
 * Renders nothing when `payload` carries no marker.
 */
export default function TickerNotFound({ sym, payload, onRun = null, variant = 'block', testId = 'ticker-not-found' }) {
  const ctxRun = usePanelRun()
  const nf = notFoundOf(payload, sym)
  if (!nf) return null
  const run = onRun || ctxRun
  if (variant === 'inline') {
    return (
      <span className={styles.inline} data-testid={testId}>
        <span className={styles.message}>{nf.message}</span>
        <Suggestions names={nf.suggestions} run={run} />
      </span>
    )
  }
  return (
    <PanelState kind="input" title={nf.message} role="status" testId={testId}>
      {nf.suggestions.length ? <Suggestions names={nf.suggestions} run={run} /> : null}
    </PanelState>
  )
}

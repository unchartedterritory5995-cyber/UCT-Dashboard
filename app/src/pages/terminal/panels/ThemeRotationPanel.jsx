// Theme rotation: which UCT themes are rotating in and which are rotating out (data wave 4).
//
// ⭐ NO NEW ROUTE. `GET /api/theme-rotation` (paid, no flag): each theme's 1 week strength rank
// against its 1 month strength rank, among all themes. The Theme Tracker page read this and drew
// none of it; THMS shows returns by period and never this. The pure half is themeRotationModel.js,
// re-exported below.
//
// ⛔ BOTH LISTS EMPTY IS TWO DIFFERENT FACTS. With themes ranked it means "nothing moved 20 points";
// with none ranked the server has not worked the returns out yet, and the panel says that and asks
// again (the server sends the same two empty lists for both, so the model reads `rankings`).
// ⛔ A failed read is an error with Retry, never "nothing is rotating". SWR keeps the last answer
// through a failed refresh, and the panel then says it is showing the last read.
// The lists are never cut by the server (every theme past the threshold is sent), so nothing here
// says "showing N of M".
import { useMemo, useState } from 'react'
import {
  PanelCommand, PanelSkeleton, PanelState, panelAsOf, useInTerminalPanel, usePanelFreshness,
} from '../../../components/terminal'
import { formatNumber, formatPercent, formatTimeEt } from '../../../lib/presentation/presentationPrimitives'
import { canRetry, failureKind, failureText, isWarmingError, useMarketRead } from './marketRead'
import { usePanelWriteBack } from './commandWriteBack'
import useWarmingPoll from './warmingPoll'
import WarmingState from './WarmingState'
import { imovCommand } from './imovModel'
import { groupDrillCommand } from './groupDrillModel'
import {
  ROTATION_POLL_MS, ROTATION_SIDES, ROTATION_THRESHOLD, THEME_ROTATION_CODE, THEME_ROTATION_URL, deltaText,
  normRotationSide, rankMoveText, rotationCommandArgs, rotationRead, rotationSummary,
} from './themeRotationModel'
import styles from './marketPanels.module.css'

export {
  ROTATION_POLL_MS, ROTATION_SIDES, ROTATION_SIDE_WORDS, ROTATION_THRESHOLD, THEME_ROTATION_CODE, THEME_ROTATION_URL,
  deltaText, normRotationSide, parseRotationSide, rankMoveText, rotationCommandArgs, rotationRead, rotationSummary,
} from './themeRotationModel'

const SOURCE = 'UCT theme tracker (rotation ranks)'
const WHAT = 'Theme rotation'
const NA = 'n/a'
const count = (n) => formatNumber(n, { decimals: 0 })
const tone = (v) => (v > 0 ? styles.up : v < 0 ? styles.down : undefined)
const pct = (v) => formatPercent(v, { decimals: 1, signed: true, absent: NA })

function RotationTable({ side, rows }) {
  const rotatingIn = side === 'in'
  return (
    <div className={styles.tableBox}>
      <table className={styles.table} data-testid={`terminal-trot-${side}`}>
        <caption className={styles.caption}>{rotatingIn ? 'Rotating in' : 'Rotating out'} ({count(rows.length)})</caption>
        <thead>
          <tr>
            <th scope="col" className={styles.wrapCell} title="Click a theme to see which of its stocks drive it">Theme</th>
            <th scope="col" title="1 week strength rank less 1 month strength rank, in percentile points">Rank change</th>
            <th scope="col" className={styles.phoneHide} title="Strength rank among all themes, 0 weakest to 100 strongest: over 1 month, then over 1 week">Rank, 1M to 1W</th>
            <th scope="col" title="The theme's return over the last week">1W return</th>
            <th scope="col" className={styles.phoneHide} title="The theme's return over the last month">1M return</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.key} data-testid={`terminal-trot-row-${r.themeKey}`} data-side={side}>
              <td className={styles.wrapCell}>
                <span className={styles.rowNum} aria-hidden="true">{i + 1}</span>
                <PanelCommand cmd={imovCommand({ theme: { ticker: r.themeKey, name: r.name }, win: '1W' })}
                  label={`Open the stocks driving ${r.name}`}>{r.name}</PanelCommand>
                {' '}
                {/* the span carries the small muted type: the link itself inherits its font and color */}
                <span className={styles.muted}>
                  <PanelCommand cmd={groupDrillCommand({ kind: 'theme', name: r.name, range: '1M' })}
                    label={`Open the stocks of ${r.name}, ranked`}>stocks</PanelCommand>
                </span>
              </td>
              <td className={tone(r.delta)}>{deltaText(r) ?? NA}</td>
              <td className={styles.phoneHide}>{rankMoveText(r) ?? NA}</td>
              <td className={tone(r.ret1w)}>{pct(r.ret1w)}</td>
              <td className={`${styles.phoneHide} ${tone(r.ret1m) || ''}`}>{pct(r.ret1m)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function ThemeRotationPanel({ side: sideProp = null }) {
  const inPanel = useInTerminalPanel()
  const writeBack = usePanelWriteBack()
  const code = inPanel?.code || THEME_ROTATION_CODE
  // A new `TROT OUT` remounts the panel (the shell keys the body on code + args), so the typed word
  // only ever seeds the state.
  const [side, setSide] = useState(() => normRotationSide(sideProp))
  const read = useMarketRead(THEME_ROTATION_URL, { refreshInterval: ROTATION_POLL_MS })
  const view = useMemo(() => rotationRead(read.body), [read.body])
  // A cold theme cache answers with nothing ranked (or a 503 that says warming): ask again briefly.
  const warming = (!!read.body && view.state === 'warming') || (!read.body && isWarmingError(read.error))
  const warmPoll = useWarmingPoll(warming, read.retry)
  usePanelFreshness(view.state === 'ok' ? panelAsOf(SOURCE, view.generatedAt) : null)

  // A chip writes itself into the command (`TROT OUT`) where the registry takes the word, so a
  // reload keeps it; otherwise it is plain component state (commandWriteBack.js).
  const pick = (next) => { setSide(next); writeBack(rotationCommandArgs({ side: next })) }

  const toolbar = (
    <div className={styles.toolbar} role="toolbar" aria-label="Theme rotation controls">
      <div className={styles.group} role="group" aria-label="Lists">
        {Object.entries(ROTATION_SIDES).map(([key, s]) => (
          <button key={key} type="button" className={styles.chip} aria-pressed={key === side} onClick={() => pick(key)}
            data-testid={`terminal-trot-side-${key}`}>{s.chip}</button>
        ))}
      </div>
    </div>
  )

  if (read.loading) return <PanelSkeleton label="Loading theme rotation" testId="terminal-trot-loading" />
  if (warming) {
    return <WarmingState what="the theme returns the ranks are built from" gaveUp={warmPoll.gaveUp} onRetry={warmPoll.retry} testId="terminal-trot-warming" />
  }
  if (!read.body) {
    return (
      <PanelState kind={failureKind(read.error)} title={failureText(read.error, WHAT)} testId="terminal-trot-error"
        action={canRetry(read.error) ? <button type="button" className={styles.chip} onClick={read.retry}>Retry</button> : null}>
        {canRetry(read.error) ? `That is not the same as no theme rotating. Retry, or run ${code} again.` : null}
      </PanelState>
    )
  }
  if (view.state !== 'ok') {
    return (
      <PanelState kind="error" title="Theme rotation came back in a form this panel cannot read." testId="terminal-trot-error"
        action={<button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
        That is not the same as no theme rotating. Retry, or run {code} again.
      </PanelState>
    )
  }

  const showIn = side !== 'out'
  const showOut = side !== 'in'
  const none = view.rotatingIn.length === 0 && view.rotatingOut.length === 0
  return (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-trot" data-side={side}>
      {toolbar}
      {read.error && <p className={styles.note} role="status" data-testid="terminal-trot-stale">{failureText(read.error, WHAT)} Showing the last read.</p>}
      {none ? (
        <PanelState kind="empty" compact role="status" testId="terminal-trot-empty" title="No theme is rotating in or out right now.">
          All {count(view.ranked)} themes were ranked, and none has moved {ROTATION_THRESHOLD} or more rank points between its
          1 month and 1 week strength. That is what the server worked out, not a failed read.
        </PanelState>
      ) : (
        <>
          <div className={styles.head}>
            <span className={styles.lede} data-testid="terminal-trot-summary">{rotationSummary(view)}</span>
          </div>
          {showIn && view.rotatingIn.length > 0 ? <RotationTable side="in" rows={view.rotatingIn} /> : null}
          {showIn && view.rotatingIn.length === 0 ? <p className={styles.muted} data-testid="terminal-trot-no-in">No theme is rotating in right now.</p> : null}
          {showOut && view.rotatingOut.length > 0 ? <RotationTable side="out" rows={view.rotatingOut} /> : null}
          {showOut && view.rotatingOut.length === 0 ? <p className={styles.muted} data-testid="terminal-trot-no-out">No theme is rotating out right now.</p> : null}
        </>
      )}
      <p className={styles.muted} data-testid="terminal-trot-method">
        Every UCT theme is ranked by its return among all themes, from 0 (weakest) to 100 (strongest), once over the last
        week and once over the last month. Rank change is the 1 week rank less the 1 month rank. A theme is rotating in
        when it has climbed {ROTATION_THRESHOLD} points or more (stronger lately than over the month) and rotating out when
        it has dropped {ROTATION_THRESHOLD} or more. Biggest move first. A theme can rotate in while its return is still
        negative: the rank compares it with the other themes. A sign (+/-) marks every change, so color is never the only
        signal. Click a theme to see which of its stocks drive it; "stocks" opens every stock of the theme, ranked.
        {view.generatedAt ? ` Ranks worked out at ${formatTimeEt(view.generatedAt, { zoneSuffix: 'ET', absent: '' })}; the server refreshes them every 15 minutes.` : ''}
      </p>
    </div>
  )
}

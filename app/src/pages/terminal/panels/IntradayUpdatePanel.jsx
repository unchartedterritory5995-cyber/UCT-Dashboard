// IDAY: the latest AI-written intraday market update (data wave 6).
//
// ⭐ NO NEW ROUTE. `GET /api/intraday-update` (paid, no flag). The UCT Intelligence engine, an AI
// model, reads the market after the open, at midday and before the close, and posts one small
// update each time; the server keeps it for 4 hours and serves it as sent. The dashboard bar that
// read it lost its mount, so no screen showed it. The pure half is intradayUpdateModel.js,
// re-exported below.
//
// ⛔ OWNER RULING 2026-11-17: THE MARKET PHASE AND THE SESSION NOTE ONLY, labelled as AI-written
// with the time it was written. Nothing else of the update is read (the model's header), so
// nothing else can be drawn, and the copy does not name what is not shown.
// ⛔ EVERY WORD HERE IS AI-WRITTEN, AND THE PANEL SAYS SO AND SAYS WHEN IT WAS WRITTEN. The notes
// are drawn as text (React children), never as markup.
// ⛔ NO UPDATE ON HAND IS ITS OWN STATE (`{}` from the route), not an error and not a quiet market.
// ⛔ A failed read is an error with Retry. SWR keeps the last answer through a failed refresh, and
// the panel then says it is showing the last read.
//
// The route returns one in-memory cache entry and builds nothing on the request, so it answers at
// once on a cold cache (with `{}`, the "no update on hand" state).
import { useMemo } from 'react'
import {
  PanelCommand, PanelSkeleton, PanelState, panelAsOf, useInTerminalPanel, usePanelFreshness,
} from '../../../components/terminal'
import { formatTimeEt } from '../../../lib/presentation/presentationPrimitives'
import { canRetry, failureKind, failureText, useMarketRead } from './marketRead'
import {
  INTRADAY_KEEP_HOURS, INTRADAY_MODES, INTRADAY_POLL_MS, INTRADAY_UPDATE_CODE, INTRADAY_UPDATE_URL, intradayRead,
} from './intradayUpdateModel'
import styles from './marketPanels.module.css'
import form from './panelForm.module.css'

export {
  INTRADAY_KEEP_HOURS, INTRADAY_MODES, INTRADAY_POLL_MS, INTRADAY_UPDATE_CODE, INTRADAY_UPDATE_URL, NOTE_MAX, intradayRead, writtenAtOf,
} from './intradayUpdateModel'

const SOURCE = 'UCT Intelligence engine (AI-written)'
const WHAT = 'The intraday update'
const CUT = ' (cut here; the note runs longer)'
const clock = (iso) => (iso ? formatTimeEt(iso, { zoneSuffix: 'ET', absent: '' }) : '')
const SCHEDULE = Object.values(INTRADAY_MODES).map((m) => `${m.when} (${m.due})`)
/** "after the open (about 9:45 AM ET), at midday (12:00 PM ET) and before the close (2:30 PM ET)" */
const SCHEDULE_WORDS = `${SCHEDULE.slice(0, -1).join(', ')} and ${SCHEDULE[SCHEDULE.length - 1]}`

/** When the update was written, as one sentence, or the sentence that says it does not say. */
function writtenWords(view) {
  const at = clock(view.writtenAt)
  const run = view.modeLabel ? `${view.modeLabel} run` : 'An intraday run'
  if (!at) return `${run}. The update does not say when it was written.`
  return `${run}, written at ${at}${view.day ? ` on ${view.day}` : ''}.`
}

export default function IntradayUpdatePanel() {
  const inPanel = useInTerminalPanel()
  const code = inPanel?.code || INTRADAY_UPDATE_CODE
  const read = useMarketRead(INTRADAY_UPDATE_URL, { refreshInterval: INTRADAY_POLL_MS })
  const view = useMemo(() => intradayRead(read.body), [read.body])
  const ok = view.state === 'ok'
  usePanelFreshness(ok ? panelAsOf(SOURCE, view.writtenAt) : null)

  if (read.loading) return <PanelSkeleton label="Loading the intraday update" testId="terminal-iday-loading" />
  if (!read.body) {
    return (
      <PanelState kind={failureKind(read.error)} title={failureText(read.error, WHAT)} testId="terminal-iday-error"
        action={canRetry(read.error) ? <button type="button" className={styles.chip} onClick={read.retry}>Retry</button> : null}>
        {canRetry(read.error) ? `That is not the same as no update. Retry, or run ${code} again.` : null}
      </PanelState>
    )
  }
  if (view.state === 'failed') {
    return (
      <PanelState kind="error" title="The intraday update came back in a form this panel cannot read." testId="terminal-iday-error"
        action={<button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
        That is not the same as no update. Retry, or run {code} again.
      </PanelState>
    )
  }

  const stale = read.error
    ? <p className={styles.note} role="status" data-testid="terminal-iday-stale">{failureText(read.error, WHAT)} Showing the last read.</p>
    : null
  if (view.state === 'none') {
    return (
      <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-iday" data-state="none">
        {stale}
        <PanelState kind="empty" role="status" testId="terminal-iday-none" title="No intraday update is on hand right now."
          action={<button type="button" className={styles.chip} onClick={read.retry}>Check again</button>}>
          An AI model writes one on trading days {SCHEDULE_WORDS}. The server keeps each one for {INTRADAY_KEEP_HOURS} hours,
          so there is none overnight, at a weekend, before the first run of the day, or just after the server restarts.
          This panel checks again every 5 minutes. That is not a failed read, and it says nothing about the market.
        </PanelState>
      </div>
    )
  }

  return (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-iday" data-state="ok" data-mode={view.mode || 'unknown'}>
      {stale}
      <p className={styles.callLine} data-testid="terminal-iday-written">
        <span className={styles.badge}>AI-written</span>
        <span>{writtenWords(view)}</span>
      </p>
      <p className={styles.note} data-testid="terminal-iday-ai">
        An AI model wrote everything below. No person checked or edited it, and no rule on this site tests what it says.
        Read it as one opinion to weigh, not as a signal or a recommendation.
      </p>
      {!view.hasText ? (
        <PanelState kind="empty" compact role="status" testId="terminal-iday-blank" title="This update carries no market phase and no session note.">
          That is what the AI sent, not a failed read.
        </PanelState>
      ) : null}
      {view.phase || view.phaseNote ? (
        <section className={styles.wrap} aria-label="The AI's read of the market phase">
          <div className={styles.head}><span className={styles.lede}>The AI&apos;s read of the market phase</span></div>
          <dl className={styles.fields} data-testid="terminal-iday-phase">
            <dt>Phase</dt>
            <dd>{view.phase || 'Not given'}</dd>
            {view.phaseNote ? (
              <>
                <dt>Its reason</dt>
                <dd>{view.phaseNote}{view.phaseNoteCut ? CUT : ''}</dd>
              </>
            ) : null}
          </dl>
        </section>
      ) : null}
      {view.sessionNote ? (
        <section className={styles.wrap} aria-label="The AI's note on the session">
          <div className={styles.head}><span className={styles.lede}>The AI&apos;s note on the session</span></div>
          <p className={form.quote} data-testid="terminal-iday-session">{view.sessionNote}{view.sessionNoteCut ? CUT : ''}</p>
        </section>
      ) : null}
      <p className={styles.muted} data-testid="terminal-iday-regm">
        The AI&apos;s phase is its own label, not the site&apos;s market regime. The site&apos;s regime and the UCT Exposure
        are on <PanelCommand cmd="REGM" label="Open the market regime">REGM</PanelCommand>.
      </p>
      <p className={styles.muted} data-testid="terminal-iday-method">
        An AI model (the UCT Intelligence engine) reads the market on trading days {SCHEDULE_WORDS} and writes this update
        each time. The server shows the latest one as it was sent and keeps it for {INTRADAY_KEEP_HOURS} hours; this panel
        checks for a newer one every 5 minutes. This panel shows the market phase and the session note; the update&apos;s
        other details are not shown here.
      </p>
    </div>
  )
}

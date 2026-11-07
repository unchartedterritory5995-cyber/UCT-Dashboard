/**
 * DrillPlayer — the session runner (spec §7.2, §13.2 T1-T4, §13.7 D5-D7, D9-D12, D18).
 *
 * A fullscreen Sheet: a 44px top bar (close · ten-segment progress strip · a
 * combo chip hidden until x2 · for a reviewer, the "Feedback on this screen"
 * door, which names the question / reveal / end screen it was left on) · the question (16px/600, two lines at most) ·
 * ONE StockChart mounted for the whole session, locked down (studyMode,
 * barsOverride, sym = the item id, frozen, no watermark, no live updates, no
 * feeds) and hidden with visibility:hidden on items without a chart, never
 * unmounted · the drill body · the reveal panel · a sticky bar with ONE
 * morphing button, Check → Continue. A drill that declares `unscored`
 * (WalkthroughDrill, §13.9 #1) drives that button itself: it reads Continue
 * from the start, enables when the last step is on screen, posts the attempt
 * as seen and moves on with no verdict and no reveal card.
 *
 *   <DrillPlayer open onClose={fn} initial={setPayload?} sessionId={id?} profile={p}
 *                weekDots={[..]} onFinished={fn} onKeepPractising={fn} />
 *
 * `initial` is a set payload (PractiseSheet hands one over); without it the
 * player loads Today's Study. Closing mid-session asks once: "Leave? Your
 * answers so far are saved." Keyboard: 1-4 pick a choice, arrows move inside
 * the radiogroup, Enter is Check / Continue, Escape belongs to the Sheet.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { tapDayKey } from './chartTapTime'
import Sheet from '../../components/mobile/Sheet'
import StickyActionBar from '../../components/mobile/StickyActionBar'
import StockChart from '../../components/StockChart'
import useSessionChartSettings from '../../components/chart/pane/useSessionChartSettings'
import { SkeletonBlock, SkeletonLine } from '../../components/Skeleton'
import UIcon from '../../components/ui/UIcon'
import { pauseOtherAudio } from '../../components/video/audioExclusivity'
import LoadFailed, { loadFailedSentence } from '../journal-2-0/components/LoadFailed'
import useStudySession from './useStudySession'
import { studySettingsOverride } from './studyChartLook'
import { slingshotInstances } from './slingshotOverlay'
import { studyOpenMarkers } from './studyOverlays'
import { drillFor, isUnscoredDrill } from './drills'
import { itemHasChart, questionOf } from './drills/types'
import RevealCard from './RevealCard'
import EndCard from './EndCard'
import ScreenFeedback from './ScreenFeedback'
import { drillScreen } from './screenFeedbackHelpers'
import { comboFeedback, feedbackPrefs, tapFeedback } from './studyFeedback'
import StudyMark from '../../components/study/StudyMark'
import { spot, rayAt, arrowAt } from '../../lab/pointers'
import { StartButton } from '../../lab/StartCard'
import JourneyStrip from './JourneyStrip'
import RevealTakeover from './RevealTakeover'
import { barStats } from './drillLook'
import { memberSettingsOverride } from './studyChartLook'
import { setupName } from './challenges/challengeBank'
import d5 from '../../lab/duo.module.css'
import styles from './DrillPlayer.module.css'
import { registerShortcuts } from '../command/shortcutRegistry'

export const LEAVE_COPY = 'Leave? Your answers so far are saved.'
export const CHART_SLOW_MS = 2000
export const CHART_SKIP_MS = 6000
export const CHART_HEIGHT = 380
export const SET_SIZE = 10

/** The chip over the chart: the skill in the member's words (the workbench's question chip). */
export function skillChip(skillId) {
  const id = String(skillId || '')
  if (!id) return ''
  if (id.startsWith('setup.')) return setupName(id)
  if (id === 'vocab.candle') return 'Candle name'
  if (id === 'vocab.chart') return 'Chart word'
  if (id === 'read.cycle') return 'Cycle of price action'
  if (id === 'read.events') return 'Chart event'
  if (id === 'read.bases') return 'Base'
  if (id === 'read.levels') return 'Levels and lines'
  if (id.startsWith('size.')) return 'Sizing'
  if (id.startsWith('regime.')) return 'Regime'
  return id.split('.').pop().replace(/_/g, ' ')
}

// The chart look lives in ./studyChartLook (the house look + the study gates);
// re-exported so older importers keep working.
export { studySettingsOverride }

function ProgressStrip({ index, total, results, items }) {
  const n = Math.max(total, 1)
  const shown = Math.min(index + 1, n)
  return (
    <ol className={styles.progress} aria-label={`Question ${shown} of ${n}`} data-testid="progress-strip">
      <span className={styles.srOnly}>Question {shown} of {n}</span>
      {Array.from({ length: n }, (_, i) => {
        const it = items[i]
        const r = it ? results[it.id] : null
        const cls = i < index || r?.answered ? styles.segDone : i === index ? styles.segCurrent : styles.seg
        return <li key={i} className={cls} aria-hidden="true" />
      })}
    </ol>
  )
}


export default function DrillPlayer({
  open = true,
  onClose,
  initial = null,
  sessionId = null,
  profile = null,
  weekDots = [],
  onFinished,
  onKeepPractising,
  fetcher,
  reviewer = false,            // an admin: the reveal card carries the verdict row (quiz = review)
}) {
  const s = useStudySession(fetcher ? { initial, sessionId, fetcher } : { initial, sessionId })
  const item = s.current
  const mod = useMemo(() => drillFor(item?.type), [item?.type])
  const unscored = isUnscoredDrill(mod)               // a walk-through: Continue, never Check
  const [phase, setPhase] = useState('answer')          // answer | checking | reveal | failed
  const [result, setResult] = useState(null)
  const [postError, setPostError] = useState(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [chartWait, setChartWait] = useState(0)          // 0 fresh · 1 slow (2s) · 2 offer skip (6s)
  const [chartItemId, setChartItemId] = useState(null)   // the item whose bars are on the ONE chart
  const [badge, setBadge] = useState(null)
  const leaveAsked = useRef(false)
  const crosshair = useRef(null)
  const prefs = useMemo(() => feedbackPrefs(profile), [profile])

  useEffect(() => { if (open) pauseOtherAudio() }, [open])

  // A new item resets the phase and the chart wait.
  useEffect(() => {
    setPhase('answer')
    setResult(null)
    setPostError(null)
    setChartWait(0)
  }, [item?.id])

  const needsChart = !!item && itemHasChart(item)
  const chartBarsForItem = item ? s.barsFor(item.id) : null

  // Fetch bars the set did not inline; run the D7 timers while they are missing.
  useEffect(() => {
    if (!needsChart || !item) return undefined
    if (chartBarsForItem && chartBarsForItem.length) {
      setChartItemId(item.id)
      return undefined
    }
    let alive = true
    s.ensureBars(item.id).catch(() => {})
    const t1 = setTimeout(() => { if (alive) setChartWait(1) }, CHART_SLOW_MS)
    const t2 = setTimeout(() => { if (alive) setChartWait(2) }, CHART_SKIP_MS)
    return () => { alive = false; clearTimeout(t1); clearTimeout(t2) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsChart, item?.id, chartBarsForItem])

  const chartBars = chartItemId ? s.barsFor(chartItemId) : null
  const chartMounted = !!(chartItemId && chartBars && chartBars.length)
  const chartVisible = needsChart && chartItemId === item?.id && chartMounted
  const chartItem = chartItemId ? s.items.find((it) => it.id === chartItemId) || item : null
  const chartOpts = chartItem?.prompt_json?.chart
  // A Slingshot item carries the E4H (4-EMA of highs) beside the house averages,
  // before and after the reveal: the line the trigger is judged against.
  const studyOverride = useMemo(
    () => memberSettingsOverride(chartOpts, { instances: slingshotInstances(chartItem) }),
    [chartOpts, chartItem],
  )
  // ⭐ Policy A (2026-11-02): an exhibit has no stored settings of its own, so an
  // edit made on it (a legend hide, a scale toggle) stays on THIS chart for the
  // session instead of falling through to the member's global chart_settings.
  const sessionChart = useSessionChartSettings(studyOverride, chartItemId || null)
  const entryDate = chartBars?.[0]?.t ?? null
  const exitDate = chartBars?.length ? chartBars[chartBars.length - 1].t : null

  const state = item ? s.getState(item.id) : null
  const setState = useCallback((v) => { if (item) s.setState(item.id, typeof v === 'function' ? v(s.getState(item.id)) : v) }, [item, s])
  const locked = phase !== 'answer'
  const answerable = !!item && !locked && mod.isAnswerable(state, item)
  const reveal = result?.reveal || null
  // THE WORKBENCH LOOK (owner, 2026-11-04: "it looks nothing like the work we did in the local host"): the forward
  // bars run on one at a time after the verdict instead of appearing at once, and a chart item carries the pointer
  // at the candle in question, then the verdict colour and the low-of-day ray on the reveal.
  // Round 17 (owner, batch 16): the forward bars land at once (the run-on was "UGLY"), and the pointer is the full
  // workbench pointer: a halo on the candle, an arrow into it, the label; green or red with the low-of-day ray on the reveal.
  const forwardCount = phase === 'reveal' && Array.isArray(reveal?.forward_bars) ? reveal.forward_bars.length : 0
  const baseLen = Math.max(0, (chartBars?.length || 0) - forwardCount)
  const shownBars = chartBars
  const pointer = useMemo(() => {
    if (!chartVisible || !chartBars?.length || item?.type !== 'spot' || baseLen < 2) return null
    const i = baseLen - 1
    if (phase === 'reveal' && result) {
      const color = result.correct ? '#2faf68' : '#df4646'
      return [...spot(chartBars, i, { label: result.correct ? 'you were right' : 'the answer', id: 'pt', color, halo: true }), ...arrowAt(chartBars, i, { id: 'pta', color }), ...rayAt(chartBars[i], 'l', { id: 'ptl', label: '' })]
    }
    return [...spot(chartBars, i, { label: 'this candle', id: 'pt', halo: true }), ...arrowAt(chartBars, i, { id: 'pta' })]
  }, [chartVisible, chartBars, item?.type, baseLen, phase, result])
  // the facts a trader reads before answering, from the bars in hand (the question's own window, not the forward bars)
  const stats = useMemo(() => (needsChart && chartBars?.length ? barStats(chartBars.slice(0, baseLen || chartBars.length)) : []), [needsChart, chartBars, baseLen])

  // The bars the item wants looked at (an hourly Go Signal's first three bars of the ruled session), a white
  // dot under each, on the question AND the reveal: they say where to look, never what the answer is.
  const openMarkers = useMemo(() => (chartVisible ? studyOpenMarkers(item, chartBars) : null), [chartVisible, item, chartBars])
  const modAnnotations = useMemo(
    () => (chartVisible && mod.annotationsFor ? mod.annotationsFor(state, item, reveal, chartBars) : null),
    [chartVisible, mod, state, item, reveal, chartBars],
  )
  const annotations = useMemo(() => (modAnnotations || pointer ? [...(modAnnotations || []), ...(pointer || [])] : null), [modAnnotations, pointer])

  const onCrosshairMove = useCallback((payload) => { crosshair.current = payload }, [])

  const tapAt = useCallback((times, price) => {
    if (!chartVisible || locked || !mod.onChartTap || !item) return
    const keys = (Array.isArray(times) ? times : [times]).filter((t) => t != null).map(String)
    const barIndex = chartBars.findIndex((b) => keys.includes(String(b.t)))
    const time = barIndex >= 0 ? chartBars[barIndex].t : keys[0] ?? null
    const next = mod.onChartTap(state, { time, price, barIndex: barIndex >= 0 ? barIndex : null }, item, chartBars)
    if (next !== state) { setState(next); tapFeedback(prefs) }
  }, [chartVisible, locked, mod, item, chartBars, state, setState, prefs])

  // The library's click, which fires for a mouse click AND a touch tap. A touch never moves the crosshair, so the
  // container click below (which reads the crosshair) got nothing on a phone: a member tapping a candle saw no
  // placement. Measured on the Study workbench, 2026-11-03. The library hands back the bar's time directly.
  const lastLibTap = useRef(0)
  const onChartTapLib = useCallback((p) => {
    if (!p || p.time == null) return
    lastLibTap.current = Date.now()
    tapAt([p.time, tapDayKey(p.time)], p.price)
  }, [tapAt])

  // Mouse fallback through the crosshair (an older chart, or a click the library did not report).
  const onChartClick = useCallback(() => {
    if (Date.now() - lastLibTap.current < 400) return   // the library already handled this click
    const c = crosshair.current
    if (!c) return
    tapAt([c.day, c.time], c.cursorPrice)
  }, [tapAt])

  const advance = useCallback(() => { s.next() }, [s])

  const check = useCallback(async () => {
    if (!item || !answerable || phase !== 'answer') return
    setPhase('checking')
    const answer = mod.answerFromState(state, item)
    const res = await s.answer(answer, Date.now() - (s.startedAt.current || Date.now()))
    if (unscored) {
      // A walk-through (§13.9 #1): the attempt is posted so the server records
      // it as seen, then straight on to the next item. No verdict, no reveal
      // card, no combo; a failed post stays in the outbox and replays.
      setResult(res?.failed ? null : res)
      advance()
      return
    }
    if (res?.failed) {
      setPostError(res.error)
      setPhase('failed')
      return
    }
    setResult(res)
    if (res?.badge) setBadge(res.badge)
    else if (Array.isArray(res?.badges) && res.badges.length) setBadge(res.badges[0])
    comboFeedback(res.correct ? s.combo + 1 : 0, prefs)
    setPhase('reveal')
  }, [item, answerable, phase, mod, state, s, prefs, unscored, advance])

  const primary = useCallback(() => {
    if (phase === 'answer') check()
    else if (phase === 'reveal' || phase === 'failed') advance()
  }, [phase, check, advance])

  const requestClose = useCallback(() => {
    if (s.finished || !s.items.length || leaveAsked.current) { onClose?.(); return }
    setConfirmOpen(true)
  }, [s.finished, s.items.length, onClose])

  // Keyboard (D18): digits pick a choice, Enter is the one button; inputs keep their keys.
  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => {
      const t = e.target
      const tag = t?.tagName
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || t?.isContentEditable
      if (e.key === 'Enter') {
        if (typing && tag === 'TEXTAREA') return
        if (t?.getAttribute?.('data-testid') === 'tap-keyboard-cursor') return
        if (confirmOpen) return
        e.preventDefault()
        primary()
        return
      }
      if (typing || locked || !item) return
      if (/^[1-4]$/.test(e.key) && mod.choicesOf) {
        const list = mod.choicesOf(item)
        const choice = list[Number(e.key) - 1]
        if (choice != null) { e.preventDefault(); setState({ ...(state || {}), choice }) }
      }
    }
    // drill.primary: Enter. drill.choice: a BARE 1-4 (a modified digit is the browser's tab key).
    return registerShortcuts({ 'drill.primary': onKey, 'drill.choice': onKey })
  }, [open, primary, locked, item, mod, state, setState, confirmOpen])

  useEffect(() => { if (s.finished) onFinished?.(s.summary) }, [s.finished]) // eslint-disable-line react-hooks/exhaustive-deps

  const combo = s.combo
  const label = !unscored && (phase === 'answer' || phase === 'checking') ? 'Check' : 'Continue'
  const framing = item && needsChart && mod.framingOf ? mod.framingOf(item) : ''
  // round 17: the bar count is gone from the framing (the chart facts carry the window); the rest of the sentence stays
  const framingShort = framing ? framing.replace(/^[A-Za-z]+ chart, \d+ bars ending at the cutoff date\.\s*/, '').trim() : ''
  const Overlay = mod.ChartOverlay

  let body
  if (s.status === 'loading') {
    body = (
      <div className={styles.loading} data-testid="study-loading">
        <SkeletonLine width="70%" height={18} />
        <SkeletonBlock height={CHART_HEIGHT} />
        <SkeletonLine height={52} />
        <SkeletonLine height={52} />
      </div>
    )
  } else if (s.status === 'error') {
    body = (
      <div className={styles.loading}>
        <LoadFailed what="today's Study" error={s.error} onRetry={s.reload} />
      </div>
    )
  } else if (s.finished) {
    body = (
      <EndCard
        correct={s.summary.correct}
        total={s.summary.total}
        xp={s.summary.xp}
        weekDots={weekDots}
        badge={badge}
        profile={profile}
        onDone={() => onClose?.()}
        onKeepPractising={onKeepPractising}
      />
    )
  } else if (item) {
    body = (
      <>
        <div className={`${d5.ask} ${styles.ask}`}>
          <StudyMark mood={phase === 'reveal' && result ? (result.correct ? 'happy' : 'oops') : 'live'} size={112} />
          <div className={`${d5.bubble} ${styles.bubble}`}><h2 className={styles.question} id="study-question">{questionOf(item)}</h2></div>
        </div>
        {needsChart ? (
          <div className={styles.qLine}>
            {skillChip(item.skill_id) && <span className={d5.qSetup}>{skillChip(item.skill_id)}</span>}
            {framingShort && <span className={styles.framingSm}>{framingShort}</span>}
          </div>
        ) : (framing && <p className={styles.framing}>{framing}</p>)}
        <div className={`${styles.chartRow} ${needsChart && stats.length > 0 ? styles.chartRowFacts : ''}`}>
        <div
          className={`${styles.chartBox} ${needsChart ? '' : styles.chartHidden}`}
          aria-hidden={!needsChart}
          data-testid="chart-box"
          data-chart-visible={chartVisible ? '1' : '0'}
          onClick={onChartClick}
        >
          {chartMounted && (
            <StockChart
              sym={chartItemId}
              tf={chartItem?.bars?.tf || chartItem?.prompt_json?.tf || 'D'}
              height={CHART_HEIGHT}
              studyMode
              barsOverride={shownBars}
              frozen
              hideWatermark
              showBrandMark={false}
              liveUpdates={false}
              backgroundWarm={false}
              disablePatterns
              hideJournalOverlay
              hideCompare
              hideLegend
              showDrawingTools={false}
              entryDate={entryDate}
              exitDate={exitDate}
              exactDateRange
              settingsOverride={sessionChart.settingsOverride}
              onSettingsPersist={sessionChart.onSettingsPersist}
              annotations={annotations}
              annotationsVisible={!!annotations}
              markers={openMarkers}
              onCrosshairMove={onCrosshairMove}
              onChartTap={onChartTapLib}
            />
          )}
          {needsChart && !chartVisible && (
            <div className={styles.chartSkeleton} data-testid="chart-skeleton">
              <SkeletonBlock height={CHART_HEIGHT} />
              {chartWait >= 1 && <p className={styles.chartSlow} role="status">Still loading the chart</p>}
              {chartWait >= 2 && (
                <button type="button" className={styles.ghost} onClick={() => s.defer()}>Skip this one</button>
              )}
            </div>
          )}
          {chartVisible && Overlay && (
            <Overlay item={item} state={state} setState={setState} locked={locked} reveal={reveal} bars={chartBars} />
          )}
        </div>
        {needsChart && stats.length > 0 && (
          <div className={styles.facts} data-testid="chart-stats">
            <div className={styles.factsHead}>The read on this chart</div>
            <table className={styles.factsTable}>
              <tbody>
                {stats.map((st) => (
                  <tr key={st.id} className={styles[`row_${st.tone}`] || ''}>
                    <th scope="row">{st.label}</th>
                    <td className={styles.factVal}>{st.value}</td>
                    <td className={styles.gauge}><span className={styles.gaugeBar} style={{ width: `${Math.min(100, (Math.abs(st.num || 0) / 30) * 100)}%` }} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        </div>
        <div className={styles.body}>
          <mod.Body item={item} state={state} setState={setState} locked={locked} reveal={reveal} />
        </div>
        {phase === 'failed' && (
          <p className={styles.failed} role="status" data-testid="post-failed">
            {loadFailedSentence([{ what: 'your answer', error: postError }])} It is saved on this device and will be sent when the connection is back.
          </p>
        )}
      </>
    )
  }

  return (
    <Sheet
      open={open}
      onClose={requestClose}
      variant="fullscreen"
      dismissOnBackdrop={false}
      ariaLabel="Study"
      className={styles.panel}
      bodyClassName={styles.sheetBody}
    >
      <div className={styles.top}>
        <button type="button" className={styles.close} onClick={requestClose} aria-label="Close">
          <UIcon name="x" size={18} gold={false} />
        </button>
        <JourneyStrip index={s.index} total={s.items.length || SET_SIZE} results={s.results} items={s.items} />
        {combo >= 2 && !s.finished ? (
          <span className={styles.combo} data-testid="combo-chip" aria-label={`Combo ${combo}`}>x{combo}</span>
        ) : (
          <span className={styles.comboGhost} aria-hidden="true" />
        )}
        {reviewer && (
          <ScreenFeedback compact screen={drillScreen({ finished: s.finished, phase })}
            context={item && !s.finished
              ? { item_id: item.id, skill_id: item.skill_id || null, type: item.type || null, question: s.index + 1 }
              : { set_size: s.items.length || null }} />
        )}
      </div>

      <div className={styles.scroll}><div className={`${d5.lesson} ${styles.lessonIn}`}>{body}</div></div>

      {!s.finished && s.status === 'ready' && item && phase === 'reveal' && result && !unscored && (
        <RevealTakeover correct={!!result.correct} reveal={reveal} item={item} profile={profile}
          attemptId={result.attempt_id ?? null} reviewer={reviewer} onContinue={primary} label={label} />
      )}
      {!s.finished && s.status === 'ready' && item && !(phase === 'reveal' && result && !unscored) && (
        <div className={styles.bottom}>
          {phase === 'reveal' && result && (
            <RevealCard correct={!!result.correct} reveal={reveal} item={item} profile={profile}
              attemptId={result.attempt_id ?? null} reviewer={reviewer} />
          )}
          <StickyActionBar className={styles.bar}>
            <StartButton
              icon={label === 'Check' ? 'check' : 'play'}
              label={label}
              onClick={primary}
              hotkey={false}
              disabled={phase === 'checking' || (phase === 'answer' && !answerable)}
              ariaLabel={label}
              testId="primary-action"
              className={styles.primaryBtn}
            />
          </StickyActionBar>
        </div>
      )}

      {confirmOpen && (
        <div className={styles.confirmBackdrop}>
          <div className={styles.confirm} role="alertdialog" aria-modal="true" aria-label="Leave this set?">
            <p className={styles.confirmText}>{LEAVE_COPY}</p>
            <div className={styles.confirmActions}>
              <button type="button" className={styles.ghost} onClick={() => { leaveAsked.current = true; setConfirmOpen(false) }} autoFocus>Stay</button>
              <button type="button" className={styles.primary} onClick={() => { setConfirmOpen(false); onClose?.() }}>Leave</button>
            </div>
          </div>
        </div>
      )}
    </Sheet>
  )
}

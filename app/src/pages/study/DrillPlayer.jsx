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
import Sheet from '../../components/mobile/Sheet'
import StickyActionBar from '../../components/mobile/StickyActionBar'
import StockChart from '../../components/StockChart'
import { SkeletonBlock, SkeletonLine } from '../../components/Skeleton'
import UIcon from '../../components/ui/UIcon'
import { pauseOtherAudio } from '../../components/video/audioExclusivity'
import LoadFailed, { loadFailedSentence } from '../journal-2-0/components/LoadFailed'
import useStudySession from './useStudySession'
import useHouseChart from './useHouseChart'
import { studySettingsOverride } from './studyChartLook'
import { drillFor, isUnscoredDrill } from './drills'
import { itemHasChart, questionOf } from './drills/types'
import RevealCard from './RevealCard'
import EndCard from './EndCard'
import ScreenFeedback from './ScreenFeedback'
import { drillScreen } from './screenFeedbackHelpers'
import { comboFeedback, feedbackPrefs, tapFeedback } from './studyFeedback'
import styles from './DrillPlayer.module.css'
import { registerShortcuts } from '../command/shortcutRegistry'

export const LEAVE_COPY = 'Leave? Your answers so far are saved.'
export const CHART_SLOW_MS = 2000
export const CHART_SKIP_MS = 6000
export const CHART_HEIGHT = 240
export const SET_SIZE = 10

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
  const houseSettings = useHouseChart(fetcher)
  const settingsOverride = useMemo(() => studySettingsOverride(chartOpts, houseSettings), [chartOpts, houseSettings])
  const entryDate = chartBars?.[0]?.t ?? null
  const exitDate = chartBars?.length ? chartBars[chartBars.length - 1].t : null

  const state = item ? s.getState(item.id) : null
  const setState = useCallback((v) => { if (item) s.setState(item.id, typeof v === 'function' ? v(s.getState(item.id)) : v) }, [item, s])
  const locked = phase !== 'answer'
  const answerable = !!item && !locked && mod.isAnswerable(state, item)
  const reveal = result?.reveal || null

  const annotations = useMemo(
    () => (chartVisible && mod.annotationsFor ? mod.annotationsFor(state, item, reveal, chartBars) : null),
    [chartVisible, mod, state, item, reveal, chartBars],
  )

  const onCrosshairMove = useCallback((payload) => { crosshair.current = payload }, [])

  const onChartClick = useCallback(() => {
    if (!chartVisible || locked || !mod.onChartTap || !item) return
    const c = crosshair.current
    if (!c) return
    const time = c.day || c.time
    const barIndex = chartBars.findIndex((b) => String(b.t) === String(time))
    const next = mod.onChartTap(state, { time, price: c.cursorPrice, barIndex: barIndex >= 0 ? barIndex : null }, item, chartBars)
    if (next !== state) { setState(next); tapFeedback(prefs) }
  }, [chartVisible, locked, mod, item, chartBars, state, setState, prefs])

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
        <h2 className={styles.question} id="study-question">{questionOf(item)}</h2>
        {framing && <p className={styles.framing}>{framing}</p>}
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
              barsOverride={chartBars}
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
              settingsOverride={settingsOverride}
              annotations={annotations}
              annotationsVisible={!!annotations}
              onCrosshairMove={onCrosshairMove}
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
        <ProgressStrip index={s.index} total={s.items.length || SET_SIZE} results={s.results} items={s.items} />
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

      <div className={styles.scroll}>{body}</div>

      {!s.finished && s.status === 'ready' && item && (
        <div className={styles.bottom}>
          {phase === 'reveal' && result && (
            <RevealCard correct={!!result.correct} reveal={reveal} item={item} profile={profile}
              attemptId={result.attempt_id ?? null} reviewer={reviewer} />
          )}
          <StickyActionBar className={styles.bar}>
            <button
              type="button"
              className={styles.primary}
              onClick={primary}
              disabled={phase === 'checking' || (phase === 'answer' && !answerable)}
              data-testid="primary-action"
            >
              {label}
            </button>
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

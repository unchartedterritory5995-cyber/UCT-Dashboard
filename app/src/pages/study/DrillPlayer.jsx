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
import useStudySession, { isUnscoredItem, normalizeBars } from './useStudySession'
import useChartSurfaceSettings from '../../components/chart/pane/useChartSurfaceSettings'
import { paneLookProps } from '../../components/chart/pane/paneLook'
import usePreferences from '../../hooks/usePreferences'
import { useIsPhone } from '../../hooks/useBreakpoint'
import { studySettingsOverride } from './studyChartLook'
import { slingshotInstances } from './slingshotOverlay'
import { isRsPairItem, primeRsColumns, rsInstances, rsMarkMarkers, rsPairKey, rsRevealPrimed } from './studyRsOverlay'
import { studyOpenMarkers } from './studyOverlays'
import { drillFor, isUnscoredDrill } from './drills'
import { brandWords, itemHasChart, questionOf } from './drills/types'
import RevealCard from './RevealCard'
import { EndHard } from './ui/EndLooks'
import NewTrophies from './ui/NewTrophies'
import ScreenFeedback from './ScreenFeedback'
import { drillScreen } from './screenFeedbackHelpers'
import { comboFeedback, feedbackPrefs, tapFeedback } from './studyFeedback'
import { rayAt } from '../../lab/pointers'
import { calloutLook, hardCallouts } from './ui/callout'
import ChartKey from './ui/ChartKey'
import { SymbolBadge } from './ui/StudyChart'
import brandMark from '../../components/intro/assets/compass-mark.webp'
import { reviewTrade } from './challenges/hardMode'
import { tradeAnnotations, tradeMarkers } from './challenges/tradeMarks'
import { HudCombo } from './ui/HudLooks'
import StudyButton from './ui/StudyButton'
import sa from './ui/answerLooks.module.css'
import s2 from './ui/study.module.css'
import { CORRECT_WORD, WRONG_WORD } from './RevealTakeover'
import { answerWord } from './revealCardHelpers'
import Prompt from './ui/Prompt'
import VerdictTakeover from './ui/VerdictTakeover'
import UiStamp from './ui/Stamp'
import { barStats } from './drillLook'
import { memberSettingsOverride } from './studyChartLook'
import { SETUP_SKILLS, setupName } from './challenges/challengeBank'
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
  if (id === 'read.rs') return 'Relative strength'
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
  const takeoverOpen = useRef(false)   // the verdict holds the screen: Enter belongs to its button, not to Continue
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
  // the chart's ticker, shown before answering in a lesson (the owner, 2026-11-08 "Yes"; the challenges never carry it)
  const ticker = (chartItem?.ticker || item?.ticker || null)
  const chartOpts = chartItem?.prompt_json?.chart
  const chartTf = chartItem?.bars?.tf || chartItem?.prompt_json?.tf || 'D'
  // RS 4-09: an RS drill draws the REAL UCT RS pane from the columns the item carries (studyRsOverlay). Primed
  // into the server lane's cache HERE, in render, ahead of StockChart's bind: the chart's sym is the item id, so
  // an unprimed rsLine would fetch /api/signature/columns. A TAP or red-day item's prompt blanks the dots (a dot is
  // the answer, or gives it away), and so does a leader item's on BOTH lines (only the leader can have a new-high dot);
  // once scored, the reveal's own columns (reveal.rs / reveal.rs_pair) replace them on the same chart.
  const rsRevealed = phase === 'reveal' && !!result && chartItemId === item?.id
  const rsReveal = rsRevealed ? result.reveal || null : null
  const rsPrimed = useMemo(
    () => (chartItem && chartItemId ? primeRsColumns(chartItem, chartItemId, chartTf, { reveal: rsReveal, revealed: rsRevealed }) : []),
    [chartItem, chartItemId, chartTf, rsReveal, rsRevealed],
  )
  const rsKey = useMemo(() => rsPairKey(rsPrimed), [rsPrimed])
  // A Slingshot item carries the E4H (4-EMA of highs) beside the house averages,
  // before and after the reveal: the line the trigger is judged against.
  const studyOverride = useMemo(() => {
    const own = [...(slingshotInstances(chartItem) || []), ...(rsInstances(rsPrimed) || [])]
    return memberSettingsOverride(chartOpts, { instances: own.length ? own : null })
  }, [chartOpts, chartItem, rsPrimed])
  // ⭐ Policy A (2026-11-02): an exhibit has no stored settings of its own, so an
  // edit made on it (a legend hide, a scale toggle) stays on THIS chart for the
  // session instead of falling through to the member's global chart_settings.
  // An RS reveal starts a fresh session blob, so an edit made on the prompt cannot pin the blank-dot line.
  const rsRevealKey = rsRevealPrimed(rsPrimed) ? ':rs-reveal' : ''
  const sessionChart = useSessionChartSettings(studyOverride, chartItemId ? `${chartItemId}${rsRevealKey}` : null)
  // Rule 1 of the owner's principles (docs/study/OWNER_PRINCIPLES.md): every Study chart is the member's own Charts-tab
  // widget, with our logo and their legend, the look the challenges' widget charts already wear (ChallengeChart)
  const surface = useChartSurfaceSettings()
  const phone = useIsPhone()
  const { prefs: chartPrefs } = usePreferences(true)
  const lookProps = useMemo(() => paneLookProps({ cs: surface.cs, theme: surface.theme, prefs: chartPrefs }), [surface.cs, surface.theme, chartPrefs])
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
  // One pointer everywhere (rule 4; the owner, 2026-11-08: one design for every mode): Hard mode's callout at the candle
  // in question, gold while asking, green or red after. After a scored answer on a setup with a plan, the trade is drawn
  // on the chart (the levels, BOUGHT, the targets, STOPPED OUT) and named in the chart key under it, as in Hard mode;
  // otherwise the low of the candle stays marked with a ray.
  const keyTrade = useMemo(() => {
    if (phase !== 'reveal' || !reveal?.trade || !chartBars?.length || baseLen < 1) return null
    return reviewTrade(reveal.trade, chartBars[baseLen - 1], normalizeBars(reveal.forward_bars))
  }, [phase, reveal, chartBars, baseLen])
  const pointer = useMemo(() => {
    if (!chartVisible || !chartBars?.length || item?.type !== 'spot' || baseLen < 2) return null
    // a which-line-leads item asks about two RS lines, not a candle: no pointer
    if (isRsPairItem(item)) return null
    if (phase !== 'reveal' || !result) return null
    return (keyTrade && tradeAnnotations(keyTrade, chartBars[baseLen - 1], chartBars)) || rayAt(chartBars[baseLen - 1], 'l', { id: 'ptl', label: '' })
  }, [chartVisible, chartBars, item, baseLen, phase, result, keyTrade])
  const callouts = useMemo(() => {
    if (!chartVisible || !chartBars?.length || item?.type !== 'spot' || baseLen < 2) return null
    if (isRsPairItem(item)) return null
    const tone = phase === 'reveal' && result ? (result.correct ? 'ok' : 'bad') : 'ask'
    // N068 ("detailing the question much more"): a setup chart's pointer names the setup asked about
    const asked = SETUP_SKILLS[item?.skill_id] ? `${SETUP_SKILLS[item.skill_id]} here?` : 'This candle'
    return hardCallouts({ index: baseLen - 1, label: tone === 'ask' ? asked : tone === 'ok' ? 'You were right' : 'The answer', tone })
  }, [chartVisible, chartBars, item, baseLen, phase, result])
  const calloutStyle = useMemo(() => calloutLook(phone), [phone])
  // the facts a trader reads before answering, from the bars in hand (the question's own window, not the forward bars)
  const stats = useMemo(() => (needsChart && chartBars?.length ? barStats(chartBars.slice(0, baseLen || chartBars.length)) : []), [needsChart, chartBars, baseLen])

  // The bars the item wants looked at (an hourly Go Signal's first three bars of the ruled session), a white
  // dot under each, on the question AND the reveal: they say where to look, never what the answer is.
  const openMarkers = useMemo(() => (chartVisible ? studyOpenMarkers(item, chartBars) : null), [chartVisible, item, chartBars])
  // An RS red-day item marks the session it asks about (prompt_json.chart.mark): a small muted dot under that bar; the
  // trade's action items join them on the reveal (challenges/tradeMarks.tradeMarkers), in the time order the chart wants
  const chartMarkers = useMemo(() => {
    const rs = chartVisible ? rsMarkMarkers(item, chartBars) : null
    const trade = phase === 'reveal' && result && item?.type === 'spot' ? (tradeMarkers(keyTrade, chartBars, baseLen) || []) : []
    const all = [...(openMarkers || []), ...(rs || []), ...trade]
    return all.length ? all.sort((a, b) => String(a.time).localeCompare(String(b.time))) : null
  }, [chartVisible, item, chartBars, openMarkers, phase, result, keyTrade, baseLen])
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
      if (takeoverOpen.current) return
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

  const scoredReveal = !s.finished && s.status === 'ready' && !!item && phase === 'reveal' && !!result && !unscored
  const [dismissedTakeover, setDismissedTakeover] = useState(null)
  const showTakeover = scoredReveal && dismissedTakeover !== item?.id
  takeoverOpen.current = showTakeover
  const answerKey = scoredReveal ? (() => { const w = brandWords(answerWord(reveal) || ''); return w ? w.charAt(0).toUpperCase() + w.slice(1) : '' })() : ''
  const hudResults = useMemo(() => s.items.slice(0, s.index).map((it) => s.results[it.id]?.correct !== false), [s.items, s.index, s.results])
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
    // the same end screen as every game (the owner, 2026-11-08: one design for every mode): the coin, the stat crests,
    // the level bar from the set's own XP, the trophies the set earned, the run as cards
    const scored = s.items.filter((it) => !isUnscoredItem(it) && !s.results[it.id]?.unscored)
    const p = s.summary.progress
    const level = p && Number.isFinite(Number(p.xp)) ? { before: Number(p.xp) - s.summary.xp, after: Number(p.xp) } : null
    const trophies = Object.values(s.results || {}).flatMap((r) => r?.progress?.badges_new || [])
    body = (
      <div className={s2.kit}>
        <EndHard right={s.summary.correct} total={s.summary.total} xp={s.summary.xp} testIdPrefix="lesson" doneWord="right" unit="right in this set"
          showSetups={false} medal={false} againLabel="Keep practising" onAgain={() => (onKeepPractising ? onKeepPractising() : onClose?.())} onBack={() => onClose?.()}
          results={scored.map((it) => s.results[it.id]?.correct === true)}
          log={scored.map((it) => ({ name: (skillChip(it.skill_id) || 'Question').replace(/^./, (c) => c.toUpperCase()), ticker: it.ticker || '', ok: s.results[it.id]?.correct === true }))}
          level={level}>
          {/* the score is the coin's and the line under the verdict; this copy is for screen readers and the tests */}
          <span data-testid="end-score" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}>{s.summary.correct} of {s.summary.total}</span>
          {profile?.streak ? <>A <b>{Number(profile.streak)}-day</b> streak. Come back tomorrow to keep it.</> : null}
          <NewTrophies ids={trophies} />
        </EndHard>
      </div>
    )
  } else if (item) {
    body = (
      <>
        {/* Hard mode's question header (the owner, 2026-11-08: one design for every mode): the eyebrow names the setup,
            the question is the headline, the framing is the detail under it */}
        {scoredReveal ? (
          <div className={`${s2.kit} ${styles.askHead}`}>
            <Prompt mood={result.correct ? 'happy' : 'oops'} tone={result.correct ? 'ok' : 'bad'} size={phone ? 40 : 48}
              title={result.correct ? CORRECT_WORD : WRONG_WORD}
              sub={answerKey ? <>{result.correct ? 'You said' : 'The answer:'} <b>{answerKey}</b></> : null}
              seal={<UiStamp ok={!!result.correct} inline />} />
            {chartVisible && rsKey ? <p className={sa.lDetail} data-testid="rs-pair-key">{rsKey[0]} is the upper RS line, {rsKey[1]} the lower.</p> : null}
          </div>
        ) : (
        <div className={`${sa.area} ${styles.askHead}`}>
          <div className={sa.lHead}>
            <span className={sa.lEyebrow}>{skillChip(item.skill_id) || 'Lesson'}</span>
            <h2 className={sa.lQ} id="study-question">{questionOf(item)}</h2>
            {(needsChart ? framingShort : framing) ? <p className={sa.lDetail}>{needsChart ? framingShort : framing}</p> : null}
            {chartVisible && rsKey ? <p className={sa.lDetail} data-testid="rs-pair-key">{rsKey[0]} is the upper RS line, {rsKey[1]} the lower.</p> : null}
          </div>
        </div>
        )}
        <div className={`${styles.chartRow} ${needsChart && stats.length > 0 ? styles.chartRowFacts : ''}`}>
        <div
          className={`${styles.chartBox} ${needsChart ? '' : styles.chartHidden}`}
          aria-hidden={!needsChart}
          data-testid="chart-box"
          data-chart-visible={chartVisible ? '1' : '0'}
          onClick={onChartClick}
        >
          {chartMounted && ticker && needsChart ? (
            <div className={styles.chartHead} data-testid="chart-identity">
              <SymbolBadge symbol={ticker} masked={false} />
              <span className={styles.chartBrand}><img src={brandMark} alt="" />UCT Intelligence</span>
            </div>
          ) : null}
          {chartMounted && (
            <StockChart
              {...lookProps}
              sym={chartItemId}
              tf={chartTf}
              height={CHART_HEIGHT}
              studyMode
              barsOverride={shownBars}
              frozen
              hideWatermark={!ticker || phone}
              watermark={ticker || null}
              showBrandMark
              liveUpdates={false}
              backgroundWarm={false}
              disablePatterns
              hideJournalOverlay
              hideCompare
              hideLegend={phone}
              showDrawingTools={false}
              entryDate={entryDate}
              exitDate={exitDate}
              exactDateRange
              settingsOverride={sessionChart.settingsOverride}
              onSettingsPersist={sessionChart.onSettingsPersist}
              annotations={annotations}
              callouts={callouts && callouts.length ? callouts : null}
              calloutLook={calloutStyle}
              annotationsVisible={!!annotations}
              annotationsTextVisible={!!annotations}
              markers={chartMarkers}
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
        {keyTrade && needsChart ? <ChartKey trade={keyTrade} testId="drill-key" /> : null}
        <div className={styles.body}>
          <mod.Body item={item} state={state} setState={setState} locked={locked} reveal={reveal} />
        </div>
        {phase === 'reveal' && result && (
          <RevealCard correct={!!result.correct} reveal={reveal} item={item} profile={profile}
            attemptId={result.attempt_id ?? null} reviewer={reviewer} hideVerdict={!unscored} className={styles.revealIn}
            picked={state?.choice ?? null} />
        )}
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
        <div className={`${s2.kit} ${styles.hudSlot}`}>
          <HudCombo label="Lesson" unit="Question" scoreWord="right" stepTestId="progress-strip" live={!s.finished}
            step={s.index} total={s.items.length || SET_SIZE} results={hudResults} />
        </div>
        {reviewer && (
          <ScreenFeedback compact screen={drillScreen({ finished: s.finished, phase })}
            context={item && !s.finished
              ? { item_id: item.id, skill_id: item.skill_id || null, type: item.type || null, question: s.index + 1 }
              : { set_size: s.items.length || null }} />
        )}
      </div>

      <div className={styles.scroll}><div className={`${d5.lesson} ${styles.lessonIn}`}>{body}</div></div>

      {showTakeover ? (
        <VerdictTakeover ok={!!result.correct} title={result.correct ? CORRECT_WORD : WRONG_WORD} answer={answerKey || null}
          xp={Number(result.progress?.xp_gained || 0)} label="See the lesson" onContinue={() => setDismissedTakeover(item.id)} testId="drill-takeover" />
      ) : null}
      {scoredReveal ? <span key={`f-${s.index}`} className={`${s2.flash} ${result.correct ? s2.ok : s2.bad}`} aria-hidden="true" /> : null}
      {!s.finished && s.status === 'ready' && item && (
        <div className={styles.bottom}>
          <StickyActionBar className={styles.bar}>
            <div className={`${s2.kit} ${sa.area} ${styles.footIn} ${scoredReveal ? (result.correct ? styles.footOk : styles.footBad) : ''}`}>
              <StudyButton kind={phase === 'reveal' && result && !unscored ? (result.correct ? 'good' : 'bad') : 'primary'} size="xl" arrow wide
                onClick={primary} disabled={phase === 'checking' || (phase === 'answer' && !answerable)} busy={phase === 'checking'}
                ariaLabel={label} testId="primary-action">{label}</StudyButton>
            </div>
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

// app/src/components/research/EarningsResearchModal.jsx
//
// The launch earnings modal (spec §4). Two-pane glass on desktop/tablet, the
// existing mobile Sheet on a phone. The SHELL owns: identity, lifecycle,
// section switching, keyboard, focus, the pinned actions and the §12 line.
// It owns NO section data — each panel fetches its own, keyed off the SETTLED
// symbol so arrow-stepping cannot start a fetch storm. The banner's live price
// is the one deliberate exception (controller amendment, P2 T6): it follows
// the RAW un-debounced symbol so the header number never lags the header name.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import CompanyLogo from '../CompanyLogo'
import TickerPopup from '../TickerPopup'
import UIcon from '../ui/UIcon'
import Sheet from '../mobile/Sheet'
import { useIsPhone } from '../../hooks/useBreakpoint'
import { IdentityBanner, VerdictChip } from '../research-kit'
import { NOT_ADVICE, SETUP_GRADE_INFO } from '../../constants/disclaimer'
import useExpectedMove from '../../hooks/useExpectedMove'
import useSettledSym from '../../hooks/useSettledSym'
import useLivePrices from '../../hooks/useLivePrices'
import {
  ACTUALS_POLL_MS, computeLifecycle, countdownText, shouldPollActuals, windowStart,
} from '../../pages/calendar/earningsLifecycle'
import { normalizeSection } from './railSections'
import SectionTabs, { panelIdFor, panelLabelledBy } from './SectionTabs'
import SetupSection from './sections/SetupSection'
import EarningsHistorySection from './sections/EarningsHistorySection'
import BriefSection from './sections/BriefSection'
import ProfileSection from './sections/ProfileSection'
import CatalystsSection from './sections/CatalystsSection'
import CallSection from './sections/CallSection'
import FilingsTab from '../../pages/research/tabs/FilingsTab'
import QuoteStrip from './QuoteStrip'
import FinancialsSection from './sections/FinancialsSection'
import AnalystsSection from './sections/AnalystsSection'
import NewsSection from './sections/NewsSection'
import AskAiSection from './sections/AskAiSection'
import styles from './EarningsResearchModal.module.css'

// Exported so a rail can assert every SECTIONS id has a panel behind it. A tab
// with no panel renders `<undefined/>`, and the modal's own tests cannot see it
// because the canvas is empty for every section without data providers.
export const PANELS = {
  setup: SetupSection,
  // The /charts Profile widget's dossier, in the modal (owner, 2026-08-21).
  profile: ProfileSection,
  history: EarningsHistorySection,
  brief: BriefSection,
  call: CallSection,
  // Composite: the snapshot, the statement panels and the grids were three
  // separate rail entries asking one question.
  financials: FinancialsSection,
  analysts: AnalystsSection,
  // Our generated catalysts beside the outside-links News feed.
  catalysts: CatalystsSection,
  news: NewsSection,
  filings: FilingsTab,
  // Composes the app's existing AI Search, scoped to this company. Last in the
  // rail because it answers a question the reader brought rather than presenting
  // what we hold.
  ai: AskAiSection,
}

const fmtEps = (v) => (v == null ? null : `${v < 0 ? '-' : ''}$${Math.abs(v).toFixed(2)}`)

/** The PRINTED/POST result line — pure data, never a claim (§4.2). */
function resultLine(row) {
  const act = fmtEps(row?.reported_eps)
  const est = fmtEps(row?.eps_estimate)
  if (!act) return 'Reported'
  const head = est ? `${act} vs ${est} est` : act
  return row?.surprise_pct ? `${head} · ${row.surprise_pct}` : head
}

/** `$X.XX ▲Y.Y%` — the banner price slot. `null`/`undefined` distinguished
 *  from a legitimate 0 throughout (a stock CAN be flat, or an EPS-adjacent
 *  quote can genuinely be $0.00) — this is the phantom-zero trap that has
 *  bitten this branch six times already. */
function fmtLivePrice(live) {
  if (!live || live.price == null) return null
  const price = `$${live.price.toFixed(2)}`
  if (live.change_pct == null) return price
  const arrow = live.change_pct >= 0 ? '▲' : '▼'
  return `${price} ${arrow}${Math.abs(live.change_pct).toFixed(1)}%`
}

/** A grade input's weight as a percent, or an em dash when the weight itself
 *  is unknown — `Math.round(null * 100)` is `0`, which would render a
 *  confident "0%" for a factor that was never actually weighted at zero.
 *  This phantom-zero trap has bitten seven tasks on this branch (review
 *  round 1, item 5); guard it explicitly rather than trusting the arithmetic. */
function fmtInputWeight(weight) {
  return weight == null ? '—' : `${Math.round(weight * 100)}%`
}

/** The Setup Grade chip's info-tip breakdown text. `grade.inputs` is
 *  contractually an array today (the mocked `useExpectedMove` in this suite's
 *  own test always returns `grade: null`, so nothing exercises this branch
 *  currently) but a cached older response or a future payload variant could
 *  omit it — an unguarded `.map` there takes the WHOLE MODAL down (review
 *  round 1, item 5), not just the chip. */
function gradeBreakdownText(grade) {
  const inputs = Array.isArray(grade?.inputs) ? grade.inputs : []
  return `${SETUP_GRADE_INFO.text}\n${inputs
    .map((i) => `${i.label} (${fmtInputWeight(i.weight)}): ${i.detail ?? 'unavailable'}`)
    .join('\n')}`
}

const FOCUSABLE = 'button:not([disabled]), a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

/**
 * Pure: which two elements a Tab-trap should wrap focus between, given the
 * container and the currently-focused element. Extracted from `onTrapKey` so
 * the WRAP DECISION is unit-testable without a real browser layout engine —
 * jsdom never computes layout, so `offsetParent` is always `null` and a naive
 * DOM-level test can't tell a correct trap from a gutted one (review round 1,
 * item 1). Visibility is approximated via `offsetParent`, with the currently
 * active element always eligible (so at minimum the element that just
 * received focus is trap-able even under jsdom's null-everywhere default).
 * Returns `null` when there is nothing to trap between.
 */
export function resolveTrapTargets(container, activeElement) {
  if (!container) return null
  const items = [...container.querySelectorAll(FOCUSABLE)].filter(
    (el) => el.offsetParent !== null || el === activeElement,
  )
  if (!items.length) return null
  return { first: items[0], last: items[items.length - 1], items }
}

export default function EarningsResearchModal({
  row, label, reportDate = null, timing = null,
  section = null, onSectionChange,
  onClose,
  onStepPrev = null, onStepNext = null, stepping = false,
  onPollActuals = null, isTodayReporter = false, enrichReady = true,
  nowMs,
}) {
  // Click-triggered conditional rendering — the sanctioned useIsPhone case: the
  // modal mounts as the direct result of a tap, so matchMedia is already
  // meaningful at that mount. Everything ELSE responsive here is CSS @media.
  const isPhone = useIsPhone()
  const panelRef = useRef(null)
  const sym = row?.sym || ''

  const active = normalizeSection(section)
  const { settled: settledSym } = useSettledSym(sym)

  // The banner price is the ONE exception to the settled-symbol rule (§4.4
  // amendment): it rides the shared useLivePrices pool keyed off the RAW sym,
  // so the header number changes in lockstep with the header name while the
  // user steps, instead of lagging 200ms behind like the section panels do.
  const { prices: livePrices } = useLivePrices(sym ? [sym] : [])
  // The RAW quote as well as the banner's formatted string: the Setup canvas
  // draws a "now" marker on two range tracks and used to take it from the
  // expected-move payload's `spot` — a different endpoint, a different
  // vintage, and so a second number on screen claiming to be the same thing.
  // Handed down rather than re-read so there is one authority per modal.
  const liveQuote = livePrices[sym] ?? null
  const livePrice = fmtLivePrice(liveQuote)

  // One tick per minute is enough for a countdown; nowMs may be injected.
  // This project's lint config forbids the ref-during-render escape hatch
  // (react-hooks/refs), so a changing injected nowMs is synced the ordinary
  // way — an existing, accepted pattern elsewhere in this codebase (e.g.
  // pages/calendar/CalendarHeader.jsx trips the same set-state-in-effect rule
  // for the same reason: syncing local state to a prop that can change).
  const [tick, setTick] = useState(() => nowMs ?? Date.now())
  useEffect(() => {
    if (nowMs != null) { setTick(nowMs); return undefined }
    const id = setInterval(() => setTick(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [nowMs])

  const { data: em } = useExpectedMove(settledSym, reportDate)
  const grade = em?.grade || null

  const reported = row?.reported_eps != null
  const lifecycle = computeLifecycle({
    nowMs: tick, reportDate, timing, timeEt: row?.time_et,
    reported, recapPresent: false, callStartMs: null,
  })
  const start = useMemo(() => windowStart({ reportDate, timing, timeEt: row?.time_et }),
                        [reportDate, timing, row?.time_et])

  // ── §4.5 IMMINENT actuals poll — modal-open + today-reporter ONLY ──────────
  useEffect(() => {
    if (!onPollActuals) return undefined
    if (!shouldPollActuals({ lifecycle, isTodayReporter, modalOpen: true })) return undefined
    const id = setInterval(onPollActuals, ACTUALS_POLL_MS)
    return () => clearInterval(id)
  }, [lifecycle, isTodayReporter, onPollActuals])

  // ── Escape + arrow stepping. Ignored while focus is in a text field. ───────
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { onClose?.(); return }
      const t = e.target
      const tag = (t?.tagName || '').toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || t?.isContentEditable) return
      // ⛔ A TABLIST OWNS ITS OWN ARROW KEYS. The roving tabindex moves between
      // tabs on ArrowLeft/Right, and this listener steps to a different
      // REPORTER on the same keys — so both fired on one press. The tab
      // handler calls preventDefault(), which does not stop the event reaching
      // window. Verified live: → on the focused Setup tab moved DELL to CRDO,
      // a different company, while the reader was only trying to change tab.
      //
      // Latent while the navigator was a VERTICAL rail (nextIndex has always
      // accepted Left/Right), and made reachable the day it became a
      // horizontal tab row, where ←/→ is the natural key. This guard belongs
      // in the same list as the fields above: it is the same rule — an element
      // that owns these keys keeps them.
      if (typeof t?.closest === 'function' && t.closest('[role="tablist"]')) return
      if (e.key === 'ArrowRight' && onStepNext) { e.preventDefault(); onStepNext() }
      if (e.key === 'ArrowLeft' && onStepPrev) { e.preventDefault(); onStepPrev() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, onStepNext, onStepPrev])

  // ── Focus trap. Sheet focuses its panel but does NOT trap, so both paths
  //    need this. Restores focus on unmount via the mount-time activeElement.
  useEffect(() => {
    const restore = document.activeElement
    const node = panelRef.current
    node?.focus?.()
    return () => { if (restore && typeof restore.focus === 'function') restore.focus() }
  }, [])

  const onTrapKey = useCallback((e) => {
    if (e.key !== 'Tab') return
    const targets = resolveTrapTargets(panelRef.current, document.activeElement)
    if (!targets) return
    const { first, last } = targets
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }, [])

  // ── Desktop body-scroll lock (review round 1, item 3). The phone branch
  //    gets this for free from Sheet's own `lockScroll` (default true) — it
  //    would be double-locked (and its restore value clobbered by ours) if we
  //    ran this there too, so it is gated to the non-phone path. Captures and
  //    restores the PRIOR value rather than hardcoding '' — a caller that
  //    already had some other overflow set (e.g. a sibling scroll lock) must
  //    get that back, not an unconditional reset. Mirrors the old
  //    components/tiles/EarningsModal.jsx:163-165 idiom this replaces.
  useEffect(() => {
    if (isPhone) return undefined
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [isPhone])

  const Panel = PANELS[active]

  const stepper = (onStepPrev || onStepNext) ? (
    <>
      <button type="button" className={styles.stepBtn} onClick={onStepPrev}
              disabled={!onStepPrev} aria-label="Previous reporter">
        <UIcon name="chevronRight" size={14} gold={false} className={styles.stepPrevIcon} />
      </button>
      <button type="button" className={styles.stepBtn} onClick={onStepNext}
              disabled={!onStepNext} aria-label="Next reporter">
        <UIcon name="chevronRight" size={14} gold={false} />
      </button>
    </>
  ) : null

  const gradeChip = grade ? (
    <VerdictChip
      size="sm"
      tone="neutral"
      label={grade.basis ? `Setup Grade ${grade.letter} · ${grade.basis}` : `Setup Grade ${grade.letter}`}
      info={{ ...SETUP_GRADE_INFO, text: gradeBreakdownText(grade) }}
    />
  ) : null

  // GATE b: `as="div"` — the modal is not sectioning content, so a <header>/
  // <footer> here would read as a second page-level banner/contentinfo beside
  // the app's own (see the kit docblocks for the full landmark-scope reasoning).
  const banner = (
    <IdentityBanner
      as="div"
      // Reserves the corner the modal's own absolutely-positioned close button
      // occupies. Without it the 44x44 button sits ON TOP of the trailing
      // stepper chevron — the "next reporter" control was unreachable in the
      // corner, which is why only one chevron appeared to exist.
      className={styles.banner}
      logo={<CompanyLogo sym={sym} size={34} tile />}
      sym={sym}
      company={row?.company}
      sector={row?.sector}
      lifecycle={lifecycle}
      timingText={label}
      resultText={resultLine(row)}
      countdown={countdownText(tick, start)}
      price={livePrice}
      grade={gradeChip}
      stepper={stepper}
    />
  )

  const body = (
    <>
      {banner}
      {/* ONE sub-head band, not two. The session line and the chart action used
          to be a strip and a 44px pinned footer at opposite ends of the modal,
          which is two full-width bands of chrome for two small things. They
          share a row now: both are about the IDENTITY above them, not about
          whichever section happens to be open.

          The row is rendered unconditionally and QuoteStrip returns null on a
          symbol with no quote payload — so "View chart" survives an absent
          quote, which it would not if it lived inside the strip. */}
      <div className={styles.subhead} data-testid="erm-subhead">
        {/* A +2% that opened at the high and faded is a different day from one
            that closed on it, and the banner's single price cannot say which. */}
        <QuoteStrip sym={settledSym} />
        <TickerPopup sym={sym} as="button" className={styles.btnChart}>View chart</TickerPopup>
      </div>

      <SectionTabs active={active} onSelect={onSectionChange} idPrefix="erm-rail" />

      <div
        className={styles.canvas}
        data-testid="erm-canvas"
        // Every other section is a DOCUMENT: it grows and the canvas scrolls
        // it. Ask AI is a chat — a scrolling body with the input pinned under
        // it — so it has to be BOUNDED by the canvas instead of growing it,
        // or the input ends up below the canvas's own scroll fold. The CSS
        // hook is here rather than in the section because the canvas is the
        // element that has to change, and this stylesheet owns it.
        data-section={active}
        role="tabpanel"
        // ONE panel id, because there is only ever one panel mounted. The
        // per-section id it used to carry had to be restated by every tab's
        // `aria-controls`; deriving the LABEL from the tab rules instead
        // (panelLabelledBy) leaves one authority over the naming scheme.
        id={panelIdFor('erm-rail')}
        aria-labelledby={panelLabelledBy(active, 'erm-rail')}
        tabIndex={0}
      >
        {/* GATE c: the inactive panels are UNMOUNTED, never display:none —
            an ECharts instance that mounts at zero width never recovers. */}
        <Panel
          sym={settledSym}
          row={row}
          reportDate={reportDate}
          timing={timing}
          lifecycle={lifecycle}
          expectedMove={em}
          livePrice={liveQuote}
          stepping={stepping}
          enrichReady={enrichReady}
        />
      </div>

      {/* §12: the standing line, and nothing else. It was sharing a 44px
          pinned row with the chart button; with the button moved up beside the
          quote line this is a hairline caption instead of a fourth band. */}
      <div className={styles.footer} data-testid="erm-footer">
        <p className={styles.notAdvice} data-testid="erm-not-advice">{NOT_ADVICE}</p>
      </div>
    </>
  )

  if (isPhone) {
    return (
      <Sheet open onClose={onClose} variant="bottom-sheet"
             ariaLabel={`${sym} earnings report`} className={styles.sheet}>
        {/* Sheet's drag-to-dismiss is already confined to its grip element, so
            canvas scrolling never fights the gesture (§4.4). */}
        <div ref={panelRef} tabIndex={-1} onKeyDown={onTrapKey} className={styles.phoneBody}
             data-testid="erm-phone-body">
          {body}
        </div>
      </Sheet>
    )
  }

  return (
    <div className={styles.backdrop} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.() }}>
      <div
        ref={panelRef}
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label={`${sym} earnings report`}
        tabIndex={-1}
        onKeyDown={onTrapKey}
      >
        <button type="button" className={styles.close} onClick={onClose} aria-label="Close">×</button>
        {body}
      </div>
    </div>
  )
}

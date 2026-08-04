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
import { useNavigate } from 'react-router-dom'

import CompanyLogo from '../CompanyLogo'
import TickerPopup from '../TickerPopup'
import UIcon from '../ui/UIcon'
import Sheet from '../mobile/Sheet'
import { useIsPhone } from '../../hooks/useBreakpoint'
import { useIsPaid } from '../../context/AuthContext'
import { IdentityBanner, PinnedFooter, SectionRail, VerdictChip } from '../research-kit'
import { NOT_ADVICE, SETUP_GRADE_INFO } from '../../constants/disclaimer'
import useExpectedMove from '../../hooks/useExpectedMove'
import useSettledSym from '../../hooks/useSettledSym'
import useLivePrices from '../../hooks/useLivePrices'
import {
  ACTUALS_POLL_MS, computeLifecycle, countdownText, shouldPollActuals, windowStart,
} from '../../pages/calendar/earningsLifecycle'
import { SECTIONS, normalizeSection, railLinks } from './railSections'
import SetupSection from './sections/SetupSection'
import EarningsHistorySection from './sections/EarningsHistorySection'
import BriefSection from './sections/BriefSection'
import CallSection from './sections/CallSection'
import styles from './EarningsResearchModal.module.css'

const PANELS = {
  setup: SetupSection,
  history: EarningsHistorySection,
  brief: BriefSection,
  call: CallSection,
}

const FOCUSABLE = 'button:not([disabled]), a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

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

export default function EarningsResearchModal({
  row, label, reportDate = null, timing = null,
  section = null, onSectionChange,
  onClose,
  onStepPrev = null, onStepNext = null, stepping = false,
  onPollActuals = null, isTodayReporter = false,
  nowMs,
}) {
  const navigate = useNavigate()
  const isPaid = useIsPaid()
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
  const livePrice = fmtLivePrice(livePrices[sym])

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
    const node = panelRef.current
    if (!node) return
    const items = [...node.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement)
    if (!items.length) return
    const first = items[0]
    const last = items[items.length - 1]
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }, [])

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
      info={{
        ...SETUP_GRADE_INFO,
        text: `${SETUP_GRADE_INFO.text}\n${grade.inputs
          .map((i) => `${i.label} (${Math.round(i.weight * 100)}%): ${i.detail ?? 'unavailable'}`)
          .join('\n')}`,
      }}
    />
  ) : null

  // GATE b: `as="div"` — the modal is not sectioning content, so a <header>/
  // <footer> here would read as a second page-level banner/contentinfo beside
  // the app's own (see the kit docblocks for the full landmark-scope reasoning).
  const banner = (
    <IdentityBanner
      as="div"
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
      <div className={styles.panes}>
        <SectionRail
          sections={SECTIONS}
          links={railLinks(sym)}
          active={active}
          onSelect={onSectionChange}
          idPrefix="erm-rail"
          ariaLabel="Report sections"
          className={styles.rail}
        />
        <div
          className={styles.canvas}
          data-testid="erm-canvas"
          role="tabpanel"
          id={`erm-rail-panel-${active}`}
          aria-labelledby={`erm-rail-tab-${active}`}
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
            stepping={stepping}
          />
        </div>
      </div>
      <PinnedFooter as="div" ariaLabel="Actions" className={styles.footer}>
        <span data-testid="erm-footer" className={styles.footerInner}>
          <TickerPopup sym={sym} as="button" className={styles.btnChart}>View Chart</TickerPopup>
          <button type="button" className={styles.btnReport}
                  onClick={() => { onClose?.(); navigate(`/research/${sym}`) }}>
            {isPaid ? 'Open full report →'
                    : <><UIcon name="lock" size={13} gold={false} /> Unlock full research →</>}
          </button>
        </span>
      </PinnedFooter>
      {/* §12: the standing line lives BELOW the actions, as the modal's own
          sub-line rather than a PinnedFooter child, so it can never compete
          with the CTAs for the pinned row's horizontal space. */}
      <p className={styles.notAdvice} data-testid="erm-not-advice">{NOT_ADVICE}</p>
    </>
  )

  if (isPhone) {
    return (
      <Sheet open onClose={onClose} variant="bottom-sheet"
             ariaLabel={`${sym} earnings report`} className={styles.sheet}>
        {/* Sheet's drag-to-dismiss is already confined to its grip element, so
            canvas scrolling never fights the gesture (§4.4). */}
        <div ref={panelRef} tabIndex={-1} onKeyDown={onTrapKey} className={styles.phoneBody}>
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

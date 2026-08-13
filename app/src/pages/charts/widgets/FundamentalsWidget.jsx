import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useWorkspace } from '../WorkspaceContext'
import SymbolSearch from '../../../components/chart/SymbolSearch'
import useEarningsTable from '../../../hooks/useEarningsTable'
import useFundamentalSnapshot from '../../../hooks/useFundamentalSnapshot'
import AnalystPanel from '../../../components/fundamentals/AnalystPanel'
import OwnershipPanel from '../../../components/fundamentals/OwnershipPanel'
import { sendCaptureToJournal } from '../../journal-2-0/lib/sendToJournal'
import { useJournalToast, JournalToast } from '../../journal-2-0/lib/useJournalToast'
import UIcon from '../../../components/ui/UIcon'
import usePreferences, { parsePref } from '../../../hooks/usePreferences'
import { menuThemeVars } from '../../../utils/dividerColor'
import FundamentalsSettingsPanel from './FundamentalsSettingsPanel'
import { FUNDAMENTALS_SETTINGS_KEY, mergeFundamentalsSettings, fundamentalsStyleVars, fundamentalsDefaultsForTheme } from './fundamentalsSettings'
import styles from './FundamentalsWidget.module.css'

function fmtSales(v) {
  if (v == null) return '—'
  if (Math.abs(v) >= 1e12) return `$${(v / 1e12).toFixed(2)}T`
  if (Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(1)}B`
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(0)}M`
  return `$${v}`
}
function fmtEps(v) { return v == null ? '—' : v.toFixed(2) }
function fmtPct(v) { return v == null ? '' : `${v > 0 ? '+' : ''}${v}%` }
function pctClass(v) { return v == null ? '' : v >= 0 ? styles.pos : styles.neg }

function RevisionMark({ dir }) {
  if (dir === 'up') return <span className={`${styles.rev} ${styles.revUp}`} aria-label="estimate raised">▲</span>
  if (dir === 'down') return <span className={`${styles.rev} ${styles.revDown}`} aria-label="estimate cut">▼</span>
  return null
}

function AnnualTable({ rows }) {
  if (!rows?.length) return null
  // Backend sends oldest→newest with forward estimates last; show newest first
  // so the forward-estimate years lead and the oldest year sits at the bottom.
  const ordered = rows.slice().reverse()
  return (
    <table className={styles.annual}>
      <thead>
        <tr>
          <th className={styles.left}>Year</th>
          <th>EPS</th><th>% Chg</th>
          <th>Sales</th><th>% Chg</th>
        </tr>
      </thead>
      <tbody>
        {ordered.map(r => (
          <tr key={r.year} className={r.estimate ? styles.estRow : ''}>
            <td className={styles.left}>{r.year}{r.estimate ? ' e' : ''}</td>
            <td>{fmtEps(r.eps)}</td>
            <td className={pctClass(r.eps_chg_pct)}>{fmtPct(r.eps_chg_pct)}<RevisionMark dir={r.eps_revision} /></td>
            <td>{fmtSales(r.sales)}</td>
            <td className={pctClass(r.sales_chg_pct)}>{fmtPct(r.sales_chg_pct)}<RevisionMark dir={r.sales_revision} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// Shrink-to-fit: a quarter card's rows are nowrap tabular figures, so a big
// number ("$23.9B / $20.0B +19.5%") can outgrow the card and clip at its right
// edge. The card's text is authored in em off the block font-size (see the CSS),
// so nudging the block's inline font-size down until scrollWidth fits clientWidth
// scales every row proportionally. Re-runs on data change AND card resize.
function useShrinkToFit(dep) {
  const ref = useRef(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    let raf = 0
    const fit = () => {
      el.style.fontSize = ''   // reset to the CSS-authored size, then re-measure
      const base = parseFloat(getComputedStyle(el).fontSize) || 11
      let size = base
      for (let i = 0; i < 4 && el.scrollWidth > el.clientWidth && size > 7.5; i++) {
        size = Math.max(7.5, Math.floor(size * (el.clientWidth / el.scrollWidth) * 10) / 10)
        el.style.fontSize = `${size}px`
      }
    }
    fit()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(fit) })
    ro.observe(el)
    return () => { ro.disconnect(); cancelAnimationFrame(raf) }
  }, [dep])
  return ref
}

function QuarterBlock({ q }) {
  const fitRef = useShrinkToFit(q)
  if (!q.reported) {
    return (
      <div ref={fitRef} className={`${styles.qBlock} ${styles.qNext}`}>
        <div className={styles.qHead}>
          <span className={styles.qLabel}>{q.label || 'Next'}</span>
          {/* Prefer the scheduled report date; fall back to the fiscal period end
              so a forward card always shows a truthful date (the estimate source
              only stamps a report date on the nearest quarter). */}
          <span className={styles.qDate} title={q.report_date ? 'Expected report date' : q.period_end ? 'Fiscal period end' : undefined}>{q.report_date || q.period_end}</span>
        </div>
        <div className={styles.qRow}><span className={styles.muted}>EPS</span> <span>{fmtEps(q.eps_estimate)}</span> <span className={styles.est}>est</span> <span className={pctClass(q.eps_est_chg_pct)}>{fmtPct(q.eps_est_chg_pct)}</span></div>
        <div className={styles.qRow}><span className={styles.muted}>Rev</span> <span>{fmtSales(q.rev_estimate)}</span> <span className={styles.est}>est</span> <span className={pctClass(q.rev_est_chg_pct)}>{fmtPct(q.rev_est_chg_pct)}</span></div>
      </div>
    )
  }
  return (
    <div ref={fitRef} className={styles.qBlock}>
      <div className={styles.qHead}><span className={styles.qLabel}>{q.label}</span></div>
      <div className={styles.qRow}>
        <span className={styles.muted}>EPS</span> <span>{fmtEps(q.eps_actual)}</span>
        <span className={styles.slash}>/</span> <span>{fmtEps(q.eps_estimate)}</span>
        <span className={pctClass(q.eps_surprise_pct)}>{fmtPct(q.eps_surprise_pct)}</span>
      </div>
      <div className={styles.qRow}>
        <span className={styles.muted}>Rev</span> <span>{fmtSales(q.rev_actual)}</span>
        <span className={styles.slash}>/</span> <span>{fmtSales(q.rev_estimate)}</span>
        <span className={pctClass(q.rev_surprise_pct)}>{fmtPct(q.rev_surprise_pct)}</span>
      </div>
    </div>
  )
}

export default function FundamentalsWidget({
  color, opts, onOptsChange,
  // Frozen-embed mode (journal host): `frozen` carries the captured payload
  // ({symbol, data, company, settings}) — reported rows are immutable, so a
  // March capture re-renders March's table verbatim, no fetch. readOnly
  // strips the view tabs and the ⚙ (which writes the GLOBAL settings pref —
  // an embed must never reach it). journalDoor=false inside embeds.
  frozen = null, readOnly = false, journalDoor = true,
}) {
  const { groupSyms, setGroupSym } = useWorkspace()
  const sym = frozen?.symbol || groupSyms?.[color] || null
  const { data: liveData } = useEarningsTable(frozen ? null : sym)
  const data = frozen?.data ?? liveData

  // ── Fundamentals appearance settings (⚙ panel) — mirrors the watchlist's ──
  const { prefs, setPref } = usePreferences()
  // Uncustomized (no saved pref) → the DEFAULTS FOR THE CURRENT APP THEME (light →
  // white canvas + dark text), so the ⚙ swatches and the surface follow the theme.
  const fwSettings = useMemo(
    () => mergeFundamentalsSettings(frozen?.settings ?? parsePref(prefs?.[FUNDAMENTALS_SETTINGS_KEY], null) ?? fundamentalsDefaultsForTheme(prefs?.theme)),
    [prefs, frozen],
  )
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsBtnRef = useRef(null)
  const rootRef = useRef(null)
  const patchSettings = useCallback((patch) => {
    setPref(FUNDAMENTALS_SETTINGS_KEY, JSON.stringify({ ...fwSettings, ...patch }))
  }, [fwSettings, setPref])
  const resetSettings = useCallback(() => {
    setPref(FUNDAMENTALS_SETTINGS_KEY, JSON.stringify(fundamentalsDefaultsForTheme(prefs?.theme)))
  }, [setPref, prefs])
  const fwStyle = useMemo(() => fundamentalsStyleVars(fwSettings), [fwSettings])
  // Canvas-matched palette for the settings panel itself (same mechanism as the
  // chart/watchlist popup menus).
  const fwMenuVars = useMemo(() => {
    const canvas = fwSettings.bgMode === 'gradient' ? (fwSettings.bgGradient?.top || fwSettings.bg) : fwSettings.bg
    return menuThemeVars(canvas) || {}
  }, [fwSettings])
  // Company name for the header — from the shared snapshot (already fetched for
  // this ticker elsewhere, so SWR dedupes: no extra request).
  const { data: snap } = useFundamentalSnapshot(frozen ? null : sym)
  const company = frozen?.company || (snap?.name && snap.name !== sym ? snap.name : null)
  const [journalMsg, setJournalMsg] = useJournalToast()
  // View choice persists per-widget through the workspace layout save path
  // (same opts mechanism ChartWidget uses for its timeframe). Default = quarterly.
  const view = ['annual', 'quarterly', 'analyst', 'ownership'].includes(opts?.view) ? opts.view : 'quarterly'
  const setView = useCallback((next) => {
    if (next === (opts?.view || 'quarterly')) return
    onOptsChange?.({ ...(opts || {}), view: next })
  }, [opts, onOptsChange])

  if (!sym) return (
    <div className={styles.pick}>
      <div className={styles.hint}>Pick a ticker — or match a chart's color to follow it.</div>
      <SymbolSearch sym={sym} onSymbolChange={(s) => s && setGroupSym(color, s.toUpperCase())} />
    </div>
  )

  const hasAnnual = data?.annual?.length
  const hasQ = data?.quarterly?.length

  // Resolve the effective view. Analyst/Ownership have their own data sources and
  // are always available; the earnings-table views fall back to whichever section
  // actually has data.
  const isPanelView = view === 'analyst' || view === 'ownership'
  const effectiveView = isPanelView ? view
    : view === 'annual' ? (hasAnnual ? 'annual' : 'quarterly')
    : (hasQ ? 'quarterly' : 'annual')

  // Earnings-table views need the earnings fetch; the panel views do not.
  if (!isPanelView) {
    if (!data) return <div className={styles.hint}>Loading {sym}…</div>
    if (!hasAnnual && !hasQ) return <div className={styles.hint}>No fundamentals for {sym}.</div>
  }

  return (
    <div ref={rootRef} className={styles.root} style={fwStyle}>
      {settingsOpen && (
        <FundamentalsSettingsPanel
          settings={fwSettings}
          onChange={patchSettings}
          onReset={resetSettings}
          onClose={() => setSettingsOpen(false)}
          gearEl={settingsBtnRef.current}
          hostEl={rootRef.current}
          themeVars={fwMenuVars}
        />
      )}
      <div className={styles.header}>
        <div className={styles.company}>
          <span className={styles.companySym}>{sym}</span>
          {company && <span className={styles.companyName}>{company}</span>}
        </div>
        {!readOnly && (
        <div className={styles.toggle} role="tablist" aria-label="Fundamentals view">
        <button
          type="button"
          role="tab"
          aria-selected={effectiveView === 'quarterly'}
          className={`${styles.toggleBtn} ${effectiveView === 'quarterly' ? styles.toggleBtnActive : ''}`}
          onClick={() => setView('quarterly')}
          disabled={!hasQ}
        >
          Quarterly
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={effectiveView === 'annual'}
          className={`${styles.toggleBtn} ${effectiveView === 'annual' ? styles.toggleBtnActive : ''}`}
          onClick={() => setView('annual')}
          disabled={!hasAnnual}
        >
          Annual
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={effectiveView === 'analyst'}
          className={`${styles.toggleBtn} ${effectiveView === 'analyst' ? styles.toggleBtnActive : ''}`}
          onClick={() => setView('analyst')}
        >
          Analyst
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={effectiveView === 'ownership'}
          className={`${styles.toggleBtn} ${effectiveView === 'ownership' ? styles.toggleBtnActive : ''}`}
          onClick={() => setView('ownership')}
        >
          Ownership
        </button>
        </div>
        )}
        {/* → Journal: freeze the displayed reported rows into the note (payload
            capture — owner decision; the rows are immutable, few KB). Earnings-
            table views only: analyst/ownership panels have no as-of data. */}
        {journalDoor && !readOnly && !isPanelView && (hasAnnual || hasQ) && (
          <button
            type="button"
            className={styles.gearBtn}
            onClick={async () => {
              setJournalMsg('sending…')
              setJournalMsg(await sendCaptureToJournal('fundamentals', {
                symbol: sym, view: effectiveView, company,
                settings: fwSettings,
                data: { annual: data?.annual || [], quarterly: data?.quarterly || [] },
              }, { label: `${sym} fundamentals` }))
            }}
            title="Send these financials to Journal"
            aria-label="Send these financials to Journal"
          ><UIcon name="journal" size={13} /></button>
        )}
        <JournalToast msg={journalMsg} />
        {/* ⚙ Fundamentals settings — writes the GLOBAL pref; never inside an embed. */}
        {!readOnly && (
        <button
          ref={settingsBtnRef}
          type="button"
          className={`${styles.gearBtn}${settingsOpen ? ' ' + styles.gearBtnActive : ''}`}
          onClick={() => setSettingsOpen(o => !o)}
          title="Fundamentals settings"
        ><UIcon name="gear" size={13} /></button>
        )}
      </div>

      {effectiveView === 'analyst' ? (
        <AnalystPanel sym={sym} />
      ) : effectiveView === 'ownership' ? (
        <OwnershipPanel sym={sym} />
      ) : effectiveView === 'annual' ? (
        <AnnualTable rows={data.annual} />
      ) : (
        <div className={styles.qStrip}>
          {data.quarterly.map((q, i) => <QuarterBlock key={q.label || i} q={q} />)}
        </div>
      )}
    </div>
  )
}

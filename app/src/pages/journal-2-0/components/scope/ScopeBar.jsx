/**
 * ScopeBar — Journal 2.0 P3 §6, the ONE global Scope filter UI.
 *
 * Drives every J2 aggregate surface (journal / calendar / analytics) through
 * the URL-backed `useScope` hook. Six facets: account · date range · symbol ·
 * side · setup · tag. Mirrors `components/FiltersPanel.jsx`'s desktop-inline /
 * mobile-bottom-`Sheet` split.
 *
 * Behaviors (spec §6 "Active scope is LOUD"):
 *   - "Loud active" keys on FILTER facets ONLY (date/symbol/side/setup/tag),
 *     EXCLUDING account — an account is always selected, so it must never make
 *     the bar permanently gold. When a filter is set: the bar fills gold, a
 *     Clear button appears (clearScope), and — when resultCount/totalCount are
 *     provided — "N of M trades" shows.
 *   - `dateApplies=false` (Calendar): the date facet renders muted/disabled with
 *     an explanatory note; every other facet is normal.
 *   - Touch: a one-line chip summary opens a bottom-`Sheet` with all facets +
 *     a "Clear all" footer. CSS `@media` owns responsive layout; `useIsTouch`
 *     only picks the click-triggered Sheet-vs-inline render (the first-paint
 *     stale gotcha).
 *   - On mount: a shared link carrying `sc_acct` (read RAW from the URL, since
 *     `useScope` overrides `scope.acct` with the live account) that differs from
 *     the live account switches the account ONCE (ran-once ref, no loop).
 *   - NO emoji — every glyph is a `<UIcon>` (funnel/chevron/×).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import useScope from '../../hooks/useScope'
import useJ2SelectedAccount from '../../hooks/useJ2SelectedAccount'
import useJ2Settings from '../../hooks/useJ2Settings'
import {
  scopeFromSearchParams,
  scopeToSearchParams,
} from '../../../../lib/journal-2-0/scope'
import Sheet from '../../../../components/mobile/Sheet'
import { useIsTouch } from '../../../../hooks/useBreakpoint'
import UIcon from '../../../../components/ui/UIcon'
import styles from './ScopeBar.module.css'

/** The canonical scope URL keys — the only keys a preset write may touch. */
const SC_KEYS = ['sc_acct', 'sc_from', 'sc_to', 'sc_sym', 'sc_side', 'sc_setup', 'sc_tag', 'sc_v']

const ALL_ACCOUNTS = '_all_'
const PRESETS = ['Today', 'Week', 'Month', 'YTD', 'All']

/**
 * Build the server-authoritative export URL for the ACTIVE scope. `apiParams`
 * (snake_case, from `useScope`) already carries the whole FilterSpec —
 * account_id/date_from/date_to/symbol/sides/setups/tags — so the download ==
 * exactly what's on screen. URLSearchParams encodes each value ONCE (the codec
 * already member-encoded multi-value facets; never hand-concatenate → no
 * double-encode).
 *
 * `limit`/`offset` are DELIBERATELY excluded: the codec always emits them
 * (`DEFAULT_PAGE_SIZE`/0 — correct for the trades TABLE's page window), but the
 * export is intentionally the FULL match set. Passing them through would apply
 * `spec.limit` in `export_trades` and silently truncate the download to one
 * page (the B5 pagination leak). Omitting them leaves `spec.limit` None on the
 * server → unbounded.
 */
function buildExportUrl(format, apiParams) {
  const params = new URLSearchParams()
  params.set('format', format)
  for (const [k, v] of Object.entries(apiParams || {})) {
    if (k === 'limit' || k === 'offset') continue
    if (v == null || v === '') continue
    params.set(k, String(v))
  }
  return `/api/j2/trades/export?${params.toString()}`
}

/**
 * Navigate an anchor to the export endpoint so the browser downloads the
 * server-authoritative file (the backend's `Content-Disposition: attachment`
 * names it). Same-origin GET → the session cookie rides along.
 */
function triggerExport(format, apiParams) {
  const a = document.createElement('a')
  a.href = buildExportUrl(format, apiParams)
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

/** Local-timezone YYYY-MM-DD (avoids the toISOString UTC-shift day-boundary bug). */
function localIso(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Resolve a preset label → [from, to] (null clears a bound). */
function presetRange(key) {
  const today = new Date()
  const iso = localIso(today)
  const daysAgo = (n) => {
    const d = new Date(today)
    d.setDate(d.getDate() - n)
    return localIso(d)
  }
  switch (key) {
    case 'Today':
      return [iso, iso]
    case 'Week':
      return [daysAgo(6), iso]
    case 'Month':
      return [daysAgo(29), iso]
    case 'YTD':
      return [`${today.getFullYear()}-01-01`, iso]
    case 'All':
    default:
      return [null, null]
  }
}

// ── shared facet sub-components (module scope so they never remount) ──────────

function AccountSelect({ value, accounts, onChange }) {
  return (
    <select
      aria-label="Account"
      className={styles.select}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value={ALL_ACCOUNTS}>All Accounts</option>
      {accounts.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name || a.id}
        </option>
      ))}
    </select>
  )
}

function DateFacet({ from, to, dateApplies, onChange, onPreset }) {
  return (
    <div className={styles.dateFacet}>
      <div className={styles.dateInputs}>
        <label className={styles.inline}>
          <span className={styles.miniLabel}>From</span>
          <input
            type="date"
            aria-label="From date"
            className={styles.input}
            value={from || ''}
            disabled={!dateApplies}
            onChange={(e) => onChange('from', e.target.value || null)}
          />
        </label>
        <label className={styles.inline}>
          <span className={styles.miniLabel}>To</span>
          <input
            type="date"
            aria-label="To date"
            className={styles.input}
            value={to || ''}
            disabled={!dateApplies}
            onChange={(e) => onChange('to', e.target.value || null)}
          />
        </label>
      </div>
      {dateApplies ? (
        <div className={styles.presets}>
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              className={styles.presetBtn}
              onClick={() => onPreset(p)}
            >
              {p}
            </button>
          ))}
        </div>
      ) : (
        <p className={styles.dateNote}>The calendar sets its own dates.</p>
      )}
    </div>
  )
}

function SymbolInput({ value, onChange, inputRef }) {
  return (
    <input
      ref={inputRef}
      type="text"
      className={styles.input}
      aria-label="Symbol starts-with filter"
      placeholder="Symbol…"
      value={value || ''}
      onChange={(e) => onChange(e.target.value || null)}
    />
  )
}

function SideToggles({ sides, onToggle }) {
  return (
    <div className={styles.sideFacet}>
      {['Long', 'Short'].map((s) => {
        const on = sides.includes(s)
        return (
          <button
            key={s}
            type="button"
            aria-pressed={on}
            className={`${styles.sideBtn} ${on ? styles.sideBtnActive : ''}`}
            onClick={() => onToggle(s)}
          >
            {s}
          </button>
        )
      })}
    </div>
  )
}

function CheckList({ options, selected, onToggle, emptyHint }) {
  if (!options || options.length === 0) {
    return <p className={styles.hint}>{emptyHint}</p>
  }
  return (
    <div className={styles.checkList}>
      {options.map((o) => (
        <label key={o} className={styles.checkRow}>
          <input
            type="checkbox"
            checked={selected.includes(o)}
            onChange={() => onToggle(o)}
          />
          <span>{o}</span>
        </label>
      ))}
    </div>
  )
}

/** Desktop anchored dropdown for the checkbox-list facets (setup / tag). */
function FacetPopover({ label, count, children }) {
  const [open, setOpen] = useState(false)
  const popRef = useRef(null)
  const btnRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e) => {
      if (popRef.current?.contains(e.target)) return
      if (btnRef.current?.contains(e.target)) return
      setOpen(false)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className={styles.popoverWrap}>
      <button
        ref={btnRef}
        type="button"
        className={`${styles.popoverBtn} ${count > 0 ? styles.popoverBtnActive : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        {label}
        {count > 0 ? ` (${count})` : ''}
        <UIcon name="chevronDown" size={12} className={styles.caret} />
      </button>
      {open && (
        <div ref={popRef} className={styles.popover}>
          {children}
        </div>
      )}
    </div>
  )
}

/**
 * Export control — two buttons (CSV / JSON) that download the SCOPED file from
 * the backend endpoint. `apiParams` carries the active scope; the server does
 * the filtering + quoting (authoritative). `variant='sheet'` widens the buttons
 * for the mobile Sheet footer.
 */
function ExportControls({ apiParams, variant }) {
  const cls = variant === 'sheet' ? styles.exportGroupSheet : styles.exportGroup
  const btn = variant === 'sheet' ? styles.exportBtnSheet : styles.exportBtn
  return (
    <div className={cls}>
      <button
        type="button"
        className={btn}
        onClick={() => triggerExport('csv', apiParams)}
      >
        <UIcon name="download" size={13} className={styles.exportGlyph} />
        Export CSV
      </button>
      <button
        type="button"
        className={btn}
        onClick={() => triggerExport('json', apiParams)}
      >
        <UIcon name="download" size={13} className={styles.exportGlyph} />
        Export JSON
      </button>
    </div>
  )
}

/** All facets stacked as labelled sections — used inside the mobile Sheet. */
function ScopeContent({
  scope,
  accounts,
  setupOptions,
  tagOptions,
  dateApplies,
  onAccount,
  onDate,
  onPreset,
  onSymbol,
  onSide,
  onToggleSetup,
  onToggleTag,
}) {
  return (
    <div className={styles.sheetContent}>
      <section className={styles.section}>
        <h4 className={styles.sectionTitle}>Account</h4>
        <AccountSelect value={scope.acct ?? ALL_ACCOUNTS} accounts={accounts} onChange={onAccount} />
      </section>
      <section className={styles.section}>
        <h4 className={styles.sectionTitle}>Date Range</h4>
        <DateFacet
          from={scope.from}
          to={scope.to}
          dateApplies={dateApplies}
          onChange={onDate}
          onPreset={onPreset}
        />
      </section>
      <section className={styles.section}>
        <h4 className={styles.sectionTitle}>Symbol</h4>
        <SymbolInput value={scope.symbol} onChange={onSymbol} />
      </section>
      <section className={styles.section}>
        <h4 className={styles.sectionTitle}>Side</h4>
        <SideToggles sides={scope.sides} onToggle={onSide} />
      </section>
      <section className={styles.section}>
        <h4 className={styles.sectionTitle}>Setup</h4>
        <CheckList
          options={setupOptions}
          selected={scope.setups}
          onToggle={onToggleSetup}
          emptyHint="No setups defined."
        />
      </section>
      <section className={styles.section}>
        <h4 className={styles.sectionTitle}>Tag</h4>
        <CheckList
          options={tagOptions}
          selected={scope.tags}
          onToggle={onToggleTag}
          emptyHint="No tags defined."
        />
      </section>
    </div>
  )
}

// ── main component ───────────────────────────────────────────────────────────

export default function ScopeBar({
  surface,
  dateApplies = true,
  resultCount = null,
  totalCount = null,
}) {
  const { scope, setFacet, toggleMember, clearScope, apiParams } = useScope()
  const { accountId, accounts } = useJ2SelectedAccount()
  const { settings } = useJ2Settings()
  const isTouch = useIsTouch()
  const [searchParams, setSearchParams] = useSearchParams()

  const [sheetOpen, setSheetOpen] = useState(false)
  const symbolRef = useRef(null)

  const setupOptions = useMemo(() => settings?.setups ?? [], [settings])
  const tagOptions = useMemo(() => {
    const mistake = settings?.mistakeTags ?? []
    const emotion = settings?.emotionTags ?? []
    return Array.from(new Set([...mistake, ...emotion]))
  }, [settings])

  // "Loud active" = any FILTER facet set (EXCLUDING account).
  const filterFacetCount =
    (scope.from || scope.to ? 1 : 0) +
    (scope.symbol ? 1 : 0) +
    (scope.sides.length ? 1 : 0) +
    (scope.setups.length ? 1 : 0) +
    (scope.tags.length ? 1 : 0)
  const filtersActive = filterFacetCount > 0
  const showCount = filtersActive && resultCount != null && totalCount != null

  // ── facet callbacks ────────────────────────────────────────────────────────
  const onAccount = useCallback((v) => setFacet('acct', v), [setFacet])
  const onSymbol = useCallback((v) => setFacet('symbol', v), [setFacet])
  const onSide = useCallback((s) => toggleMember('sides', s), [toggleMember])
  const onToggleSetup = useCallback((s) => toggleMember('setups', s), [toggleMember])
  const onToggleTag = useCallback((t) => toggleMember('tags', t), [toggleMember])
  const onDate = useCallback((which, val) => setFacet(which, val), [setFacet])

  // Presets set BOTH date bounds — must be ONE atomic URL write (two sequential
  // setFacet calls would clobber, since react-router's functional updater reads
  // the pre-render searchParams). Rebuild all sc_* via the A6 codec, preserving
  // every non-scope param (j2tab, calendar view, ins, …).
  const onPreset = useCallback(
    (label) => {
      const [from, to] = presetRange(label)
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          for (const k of SC_KEYS) next.delete(k)
          const nextScope = { ...scopeFromSearchParams(prev), acct: scope.acct, from, to }
          for (const [k, v] of scopeToSearchParams(nextScope).entries()) next.set(k, v)
          return next
        },
        { replace: true },
      )
    },
    [setSearchParams, scope.acct],
  )

  // ── `/` hotkey focuses the symbol input (desktop) ──────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== '/') return
      const el = document.activeElement
      const tag = el?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return
      if (symbolRef.current) {
        e.preventDefault()
        symbolRef.current.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // ── on-mount shared-link account hydration (ran-once) ──────────────────────
  const hydratedRef = useRef(false)
  useEffect(() => {
    if (hydratedRef.current) return
    hydratedRef.current = true
    const rawScAcct = searchParams.get('sc_acct')
    if (rawScAcct && rawScAcct !== accountId) {
      setFacet('acct', rawScAcct)
    }
    // Mount-only: reads the initial URL vs the initial live account, once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── chip summary for touch ─────────────────────────────────────────────────
  const chipSummary = useMemo(() => {
    const acctName = scope.acct
      ? accounts.find((a) => a.id === scope.acct)?.name || 'Account'
      : null
    if (!acctName && !filtersActive) return 'All trades'
    const parts = []
    if (acctName) parts.push(acctName)
    if (filtersActive) parts.push(`${filterFacetCount} filter${filterFacetCount === 1 ? '' : 's'}`)
    return parts.join(' · ')
  }, [scope.acct, accounts, filtersActive, filterFacetCount])

  // ── touch: chip + bottom Sheet ─────────────────────────────────────────────
  if (isTouch) {
    return (
      <>
        <button
          type="button"
          aria-label="Edit scope"
          className={`${styles.chip} ${filtersActive ? styles.chipActive : ''}`}
          onClick={() => setSheetOpen(true)}
        >
          <UIcon name="screener" size={14} className={styles.filterGlyph} />
          <span className={styles.chipText}>{chipSummary}</span>
          <UIcon name="chevronDown" size={13} className={styles.caret} />
        </button>
        <Sheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          variant="bottom-sheet"
          title="Scope"
          ariaLabel="Scope filters"
          footer={
            <div className={styles.sheetFooter}>
              <ExportControls apiParams={apiParams} variant="sheet" />
              {filtersActive ? (
                <button
                  type="button"
                  className={styles.sheetClearAll}
                  onClick={() => {
                    clearScope()
                  }}
                >
                  Clear all
                </button>
              ) : null}
            </div>
          }
        >
          <div className={styles.sheetBody}>
            <ScopeContent
              scope={scope}
              accounts={accounts}
              setupOptions={setupOptions}
              tagOptions={tagOptions}
              dateApplies={dateApplies}
              onAccount={onAccount}
              onDate={onDate}
              onPreset={onPreset}
              onSymbol={onSymbol}
              onSide={onSide}
              onToggleSetup={onToggleSetup}
              onToggleTag={onToggleTag}
            />
          </div>
        </Sheet>
      </>
    )
  }

  // ── desktop: inline bar ────────────────────────────────────────────────────
  return (
    <div
      role="region"
      aria-label={`Scope filters${surface ? ` — ${surface}` : ''}`}
      className={`${styles.bar} ${filtersActive ? styles.barActive : ''}`}
    >
      <UIcon name="screener" size={15} className={styles.filterGlyph} />

      <div className={styles.facet}>
        <AccountSelect value={scope.acct ?? ALL_ACCOUNTS} accounts={accounts} onChange={onAccount} />
      </div>

      <div className={styles.facet}>
        <DateFacet
          from={scope.from}
          to={scope.to}
          dateApplies={dateApplies}
          onChange={onDate}
          onPreset={onPreset}
        />
      </div>

      <div className={styles.facet}>
        <SymbolInput value={scope.symbol} onChange={onSymbol} inputRef={symbolRef} />
      </div>

      <div className={styles.facet}>
        <SideToggles sides={scope.sides} onToggle={onSide} />
      </div>

      <FacetPopover label="Setup" count={scope.setups.length}>
        <CheckList
          options={setupOptions}
          selected={scope.setups}
          onToggle={onToggleSetup}
          emptyHint="No setups defined."
        />
      </FacetPopover>

      <FacetPopover label="Tag" count={scope.tags.length}>
        <CheckList
          options={tagOptions}
          selected={scope.tags}
          onToggle={onToggleTag}
          emptyHint="No tags defined."
        />
      </FacetPopover>

      <div className={styles.spacer} />

      {showCount && (
        <span className={styles.count}>
          {resultCount} of {totalCount} trades
        </span>
      )}

      <ExportControls apiParams={apiParams} />

      {filtersActive && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={clearScope}>
          <UIcon name="x" size={13} className={styles.clearGlyph} />
          Clear
        </button>
      )}
    </div>
  )
}

// UCT Terminal — the shell (TERMINAL-NEXT, owner rulings 2026-10-02).
//
// ONE command line (`TICKER FUNC`), a linked 1/2/4-panel grid, and a left rail whose first
// section is the Calendar. Every panel renders an EXISTING component (panels.jsx); every
// function code comes from ONE registry (functions.js); the security link is the /charts
// colour group (useTerminalLayout.js). Reached only through `TerminalRoute` in App.jsx,
// which renders this for a member the `terminal-next` cohort admits and sends anyone else
// to `/calendar` (terminalGate.js).
//
// Phone (≤640): a single panel — the focused one — under a pinned command line, with the
// function list in a Sheet. Touch tier (≤1024): every control is at least `--tap-min`.
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import ErrorBoundary from '../../components/ErrorBoundary'
import Sheet from '../../components/mobile/Sheet'
import { useIsPhone } from '../../hooks/useBreakpoint'
import useDoorParam from '../../hooks/useDoorParam'
import jsonFetcher from '../../utils/jsonFetcher'
import CommandLine from './CommandLine'
import HelpPanel from './panels/HelpPanel'
import parseCommand from './parseCommand'
import { BY_CODE, FUNCTIONS, FUNCTION_GROUPS, fillDoor, researchHref, variantFor } from './functions'
import { panelComponent, URL_OWNING_PANELS } from './panels'
import useTerminalLayout, { GROUP_DOT, PANEL_COUNTS, nextGroup, panelSym } from './useTerminalLayout'
import { TERMINAL_CALENDAR_PATH } from './terminalGate'
import styles from './TerminalShell.module.css'

/** Pure: what a stored panel renders — the variant, its security, and why not if it can't. */
export function resolvePanel(panel, groups, auth) {
  const fn = BY_CODE[panel?.code]
  if (!fn) return { state: 'unknown', fn: null }
  const sym = panelSym(panel, groups)
  const variant = (sym && fn.ticker) ? fn.ticker : (fn.market?.panel ? fn.market : null)
  if (!variant) return { state: 'needs-ticker', fn, sym }
  if (variant.flag && auth?.[variant.flag] !== true) return { state: 'disabled', fn, sym, variant }
  return { state: 'ready', fn, sym: variant === fn.ticker ? sym : null, variant }
}

function Panel({ index, panel, focused, groups, auth, onFocus, onCycleGroup, onRun, hidden }) {
  const r = resolvePanel(panel, groups, auth)
  const Comp = r.state === 'ready' ? panelComponent(r.variant.panel) : null
  const title = [r.sym, panel.code].filter(Boolean).join(' ')
  const full = r.state === 'ready' && r.sym && r.variant.section ? researchHref(r.sym, r.variant.section) : null
  return (
    <section
      className={`${styles.panel} ${focused ? styles.panelFocused : ''}`}
      hidden={hidden}
      onMouseDown={onFocus}
      onFocusCapture={onFocus}
      aria-label={`Panel ${index + 1}: ${title || 'empty'}`}
      data-testid={`terminal-panel-${index}`}
      data-code={panel.code}
      data-focused={focused ? 'true' : 'false'}
    >
      <header className={styles.panelHead}>
        <button
          type="button"
          className={styles.groupDot}
          style={{ '--dot': GROUP_DOT[panel.group] }}
          onClick={(e) => { e.stopPropagation(); onCycleGroup() }}
          aria-label={panel.group === 'N' ? 'Not linked — tap to link' : `Linked to group ${panel.group} — tap to change`}
          title={panel.group === 'N' ? 'Not linked' : `Group ${panel.group}`}
          data-testid={`terminal-group-${index}`}
        >
          <span aria-hidden="true">{panel.group === 'N' ? '' : panel.group}</span>
        </button>
        <span className={styles.panelTitle}>
          <span className={styles.code}>{title}</span>
          <span className={styles.panelLabel}>{r.fn?.label || ''}</span>
        </span>
        {full && <Link className={styles.panelLink} to={full}>Full page</Link>}
      </header>
      <div className={styles.panelBody}>
        {r.state === 'ready' && Comp && (
          <ErrorBoundary key={`${panel.code}:${r.sym || ''}`}>
            <Suspense fallback={<div className={styles.panelEmpty}>Loading {panel.code}…</div>}>
              {r.variant.panel === 'Help'
                ? <Comp args={panel.args} onRun={onRun} />
                : <Comp sym={r.sym || undefined} {...(r.variant.props || {})} />}
            </Suspense>
          </ErrorBoundary>
        )}
        {r.state === 'needs-ticker' && (
          <div className={styles.panelEmpty}>Type a ticker for {panel.code} — e.g. <kbd>NVDA {panel.code}</kbd></div>
        )}
        {r.state === 'disabled' && (
          <div className={styles.panelEmpty}>{panel.code} is not enabled for your account yet.</div>
        )}
        {r.state === 'unknown' && (
          <div className={styles.panelEmpty}>Unknown function {panel.code}. Type <kbd>HELP</kbd>.</div>
        )}
      </div>
    </section>
  )
}

export default function TerminalShell() {
  const auth = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const isPhone = useIsPhone()
  const { layout, groups, save, setGroupSym, loading } = useTerminalLayout()
  const [notice, setNotice] = useState(null)
  const [fnSheet, setFnSheet] = useState(false)
  const inputRef = useRef(null)
  const layoutRef = useRef(layout)
  layoutRef.current = layout

  const count = layout.count
  const focus = Math.min(layout.focus, count - 1)

  const openCalendarPath = useCallback((extra) => {
    const p = new URLSearchParams(location.search)
    for (const [k, v] of Object.entries(extra || {})) p.set(k, v)
    const q = p.toString()
    if (location.pathname !== TERMINAL_CALENDAR_PATH || extra) {
      navigate(`${TERMINAL_CALENDAR_PATH}${q ? `?${q}` : ''}`, { replace: !extra })
    }
  }, [location.pathname, location.search, navigate])

  const run = useCallback((text) => {
    const cmd = parseCommand(text)
    setNotice(null)
    if (!cmd.ok) {
      if (cmd.error !== 'empty') setNotice({ kind: 'error', text: cmd.error, sym: cmd.sym, suggestions: cmd.suggestions || [] })
      return
    }
    if (cmd.type === 'address') {
      if (auth.addressSpaceEnabled !== true) {
        setNotice({ kind: 'error', text: `Saved-item addresses (${cmd.address}) are not enabled for your account yet.` })
        return
      }
      jsonFetcher(`/api/address/resolve?a=${encodeURIComponent(cmd.address)}`)
        .then((row) => {
          if (row?.to) navigate(row.to)
          else setNotice({ kind: 'error', text: `Nothing at ${cmd.address}.` })
        })
        .catch(() => setNotice({ kind: 'error', text: `Nothing at ${cmd.address} that you can open.` }))
      return
    }

    const cur = layoutRef.current
    const at = Math.min(cur.focus, cur.count - 1)
    const panel = cur.panels[at]
    let sym = cmd.sym
    let { variant, scope, reason, ignoredTicker } = variantFor(cmd.code, !!sym)
    if (!variant && reason === 'needs-ticker') {
      sym = panelSym(panel, groups)
      if (sym) { variant = BY_CODE[cmd.code].ticker; scope = 'ticker' }
    }
    if (!variant) {
      setNotice({ kind: 'error', text: `${cmd.code} needs a ticker — e.g. NVDA ${cmd.code}.` })
      return
    }
    if (variant.flag && auth[variant.flag] !== true) {
      setNotice({ kind: 'error', text: `${cmd.code} is not enabled for your account yet.` })
      return
    }
    if (variant.door) {
      const to = fillDoor(variant.door, { sym, args: cmd.args })
      if (!to) {
        setNotice({ kind: 'error', text: `${cmd.code} needs ${variant.needsArg || 'a ticker'}.` })
        return
      }
      navigate(to)
      return
    }

    // A panel that owns the URL (the calendar) appears at most once: re-use its slot.
    let target = at
    if (URL_OWNING_PANELS.has(variant.panel)) {
      const existing = cur.panels.slice(0, cur.count).findIndex((p, i) => {
        if (i === at) return false
        const r = resolvePanel(p, groups, auth)
        return r.state === 'ready' && r.variant.panel === variant.panel
      })
      if (existing >= 0) target = existing
    }
    const prev = cur.panels[target]
    const panels = cur.panels.slice()
    panels[target] = {
      ...prev,
      code: cmd.code,
      args: cmd.args || [],
      sym: prev.group === 'N' && scope === 'ticker' ? sym : prev.sym,
    }
    if (scope === 'ticker' && prev.group !== 'N') setGroupSym(prev.group, sym)
    save({ ...cur, focus: target, panels })
    if (ignoredTicker) setNotice({ kind: 'info', text: `${cmd.code} is market-wide; ${cmd.sym} was not applied.` })
    if (variant.panel === 'Calendar') {
      openCalendarPath(variant.params?.earnings && sym ? { earnings: sym } : null)
    }
  }, [auth, groups, navigate, openCalendarPath, save, setGroupSym])

  // A deep link `/terminal?cmd=NVDA%20GP` runs once and is stripped (TERM-038's door hook).
  useDoorParam('cmd', run, { ready: !loading })

  // `/terminal/calendar` IS the Calendar section: arriving there shows the calendar in the
  // focused panel unless a visible panel already does. Waits for the stored layout, so it
  // never saves the default over a member's real one.
  const enteredCalendar = useRef(false)
  useEffect(() => {
    if (loading || enteredCalendar.current) return
    if (location.pathname !== TERMINAL_CALENDAR_PATH) return
    enteredCalendar.current = true
    const cur = layoutRef.current
    const visible = cur.panels.slice(0, cur.count)
    const at = visible.findIndex((p) => p.code === 'CAL')
    if (at >= 0) {
      if (at !== cur.focus) save({ ...cur, focus: at })
      return
    }
    const panels = cur.panels.slice()
    const f = Math.min(cur.focus, cur.count - 1)
    panels[f] = { ...panels[f], code: 'CAL', args: [] }
    save({ ...cur, panels })
  }, [loading, location.pathname, save])

  useEffect(() => {
    if (!isPhone) inputRef.current?.focus()
  }, [isPhone])

  const setCount = (n) => save({ ...layout, count: n, focus: Math.min(layout.focus, n - 1) })
  const setFocus = (i) => { if (i !== layout.focus) save({ ...layout, focus: i }) }
  const cycleGroup = (i) => {
    const panels = layout.panels.slice()
    const p = panels[i]
    const g = nextGroup(p.group)
    // Leaving a group keeps the security the panel was showing, so unlinking never blanks it.
    panels[i] = { ...p, group: g, sym: g === 'N' ? (panelSym(p, groups) || p.sym) : p.sym }
    save({ ...layout, panels })
  }

  const railGroups = useMemo(() => FUNCTION_GROUPS.map((g) => ({
    g, fns: FUNCTIONS.filter((f) => f.group === g),
  })), [])
  const focusedCode = layout.panels[focus]?.code

  const visible = layout.panels.slice(0, count)
  return (
    <div className={styles.shell} data-phone={isPhone ? 'true' : 'false'} data-testid="terminal-shell">
      <div className={styles.bar}>
        <CommandLine onSubmit={run} inputRef={inputRef} />
        {isPhone ? (
          <button type="button" className={styles.barBtn} onClick={() => setFnSheet(true)} data-testid="terminal-fn-button">
            Functions
          </button>
        ) : (
          <div className={styles.counts} role="group" aria-label="Panels">
            {PANEL_COUNTS.map((n) => (
              <button
                key={n}
                type="button"
                className={`${styles.barBtn} ${count === n ? styles.barBtnOn : ''}`}
                aria-pressed={count === n}
                onClick={() => setCount(n)}
                data-testid={`terminal-count-${n}`}
              >{n}</button>
            ))}
          </div>
        )}
      </div>
      {notice && (
        <div className={`${styles.notice} ${notice.kind === 'error' ? styles.noticeError : ''}`} role="status" data-testid="terminal-notice">
          <span>{notice.text}</span>
          {notice.suggestions?.length > 0 && (
            <span className={styles.noticeSuggest}>
              Did you mean
              {notice.suggestions.map((c) => (
                <button key={c} type="button" className={styles.chip}
                  onClick={() => run(notice.sym ? `${notice.sym} ${c}` : c)}>{c}</button>
              ))}
            </span>
          )}
          <button type="button" className={styles.noticeClose} onClick={() => setNotice(null)} aria-label="Dismiss">×</button>
        </div>
      )}
      <div className={styles.body}>
        {!isPhone && (
          <nav className={styles.rail} aria-label="Terminal functions">
            {railGroups.map(({ g, fns }) => (
              <div key={g} className={g === 'Calendar' ? styles.railSectionPrimary : styles.railSection}>
                <div className={styles.railHead}>{g}</div>
                {fns.map((f) => (
                  <button
                    key={f.code}
                    type="button"
                    className={`${styles.railItem} ${focusedCode === f.code ? styles.railItemOn : ''}`}
                    onClick={() => run(f.code)}
                    title={f.label}
                    data-testid={`terminal-rail-${f.code}`}
                  >
                    <span className={styles.code}>{f.code}</span>
                    <span className={styles.railLabel}>{f.label}</span>
                  </button>
                ))}
              </div>
            ))}
          </nav>
        )}
        <div className={styles.grid} data-count={isPhone ? 1 : count} data-testid="terminal-grid">
          {visible.map((p, i) => (
            (!isPhone || i === focus) && (
              <Panel
                key={i}
                index={i}
                panel={p}
                focused={i === focus}
                groups={groups}
                auth={auth}
                onFocus={() => setFocus(i)}
                onCycleGroup={() => cycleGroup(i)}
                onRun={run}
              />
            )
          ))}
        </div>
      </div>
      <Sheet open={fnSheet} onClose={() => setFnSheet(false)} title="Functions" variant="bottom-sheet">
        <HelpPanel onRun={(code) => { setFnSheet(false); run(code) }} />
      </Sheet>
    </div>
  )
}

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
import { BY_CODE, FUNCTIONS, FUNCTION_GROUPS, fillDoor, flagOn, researchHref, variantFor } from './functions'
import { applyArgs, argsEcho } from './args'
import { panelComponent, panelNameFor, URL_OWNING_PANELS } from './panels'
import useTerminalLayout, { GROUP_DOT, PANEL_COUNTS, nextGroup, panelSym } from './useTerminalLayout'
import { TERMINAL_CALENDAR_PATH } from './terminalGate'
import styles from './TerminalShell.module.css'

/** Pure: what a stored panel renders — the variant, the panel it names (a component, or a
 *  panel-set page), its security, the props its honoured args produce, and why not if it can't. */
export function resolvePanel(panel, groups, auth) {
  const fn = BY_CODE[panel?.code]
  if (!fn) return { state: 'unknown', fn: null }
  const sym = panelSym(panel, groups)
  const variant = (sym && panelNameFor(fn.ticker)) ? fn.ticker : (panelNameFor(fn.market) ? fn.market : null)
  if (!variant) return { state: 'needs-ticker', fn, sym }
  if (!flagOn(auth, variant.flag)) return { state: 'disabled', fn, sym, variant }
  const { props } = applyArgs(variant, panel.args)
  return { state: 'ready', fn, sym: variant === fn.ticker ? sym : null, variant, name: panelNameFor(variant), props }
}

/** The page a panel's "Full page" link opens: the research section, the market panel's own
 *  page, or the embedded surface's route. */
function fullHref(r) {
  if (r.state !== 'ready') return null
  if (r.sym && r.variant.section) return researchHref(r.sym, r.variant.section)
  return r.variant.full || r.variant.surface || null
}

/** What a panel shows when the component inside it throws: the rest of the shell lives on. */
function PanelCrashed({ code }) {
  return (
    <div className={styles.panelEmpty} role="alert" data-testid="terminal-panel-crashed">
      {code} hit an error and stopped. The other panels are unaffected; run {code} again to retry.
    </div>
  )
}

function Panel({ index, panel, focused, groups, auth, onFocus, onCycleGroup, onRun, hidden }) {
  const r = resolvePanel(panel, groups, auth)
  const Comp = r.state === 'ready' ? panelComponent(r.name) : null
  const title = [r.sym, panel.code, ...(panel.args || [])].filter(Boolean).join(' ')
  const full = fullHref(r)
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
          <ErrorBoundary
            key={`${panel.code}:${r.sym || ''}:${(panel.args || []).join(' ')}`}
            fallback={<PanelCrashed code={panel.code} />}
          >
            <Suspense fallback={<div className={styles.panelEmpty}>Loading {panel.code}…</div>}>
              {r.name === 'Help'
                ? <Comp {...r.props} onRun={onRun} />
                : <Comp sym={r.sym || undefined} {...(r.variant.props || {})} {...r.props} />}
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
    // `null` removes a param (`CAL TODAY` clears `?week=` back to the current week).
    for (const [k, v] of Object.entries(extra || {})) { if (v == null) p.delete(k); else p.set(k, v) }
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
    if (!flagOn(auth, variant.flag)) {
      setNotice({ kind: 'error', text: `${cmd.code} is not enabled for your account yet.` })
      return
    }
    if (variant.door) {
      const to = fillDoor(variant.door, { sym, args: cmd.args })
      if (!to) {
        setNotice({ kind: 'error', text: `${cmd.code} needs ${variant.needsArg || 'a ticker'}.` })
        return
      }
      // A door leaves the shell, so an argument it cannot carry would vanish with no one to
      // say so: refuse instead, and say which token (V6a, never silent).
      const leftover = applyArgs(variant, cmd.args)
      if (leftover.ignored.length) {
        setNotice({ kind: 'error', text: argsEcho(cmd.code, leftover) })
        return
      }
      navigate(to)
      return
    }
    const name = panelNameFor(variant)
    if (!name) {
      setNotice({ kind: 'error', text: `${cmd.code} has no panel on this release.` })
      return
    }
    // V6a: every token after the code is APPLIED or said to be NOT applied, never dropped.
    const applied = applyArgs(variant, cmd.args)
    const echo = argsEcho(cmd.code, applied)

    // A panel that owns the URL (the calendar, the screener page) appears at most once:
    // re-use its slot.
    let target = at
    if (URL_OWNING_PANELS.has(name)) {
      const existing = cur.panels.slice(0, cur.count).findIndex((p, i) => {
        if (i === at) return false
        const r = resolvePanel(p, groups, auth)
        return r.state === 'ready' && r.name === name
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
    const said = [ignoredTicker && `${cmd.code} is market-wide; ${cmd.sym} was not applied.`, echo].filter(Boolean)
    if (said.length) setNotice({ kind: applied.ignored.length ? 'error' : 'info', text: said.join(' ') })
    if (name === 'Calendar') {
      const extra = { ...applied.params, ...(variant.params?.earnings && sym ? { earnings: sym } : {}) }
      openCalendarPath(Object.keys(extra).length ? extra : null)
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

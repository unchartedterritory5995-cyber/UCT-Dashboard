// UCT Terminal — the shell (TERMINAL-NEXT, owner rulings 2026-10-02).
//
// ONE command line (`TICKER FUNC`), a linked 1–4 panel grid, and a left rail whose first
// section is the Calendar. Every panel renders an EXISTING component (panels.jsx); every
// function code comes from ONE registry (functions.js). Reached only through `TerminalRoute`
// in App.jsx, which renders this for a member the `terminal-next` cohort admits and sends
// anyone else to `/calendar` (terminalGate.js).
//
// Lane T2 (boards, persistence, recovery) — the board model is boardModel.js, persisted by
// useTerminalLayout.js on the TERM-021 versioned store:
//   * channels, not colour letters: each panel joins a channel record (A–D are the /charts
//     groups; E and later are the terminal's own), or is unlinked;
//   * panel close + undo-close, duplicate, and pop-out (a frozen copy in its own window;
//     the board remembers it is out);
//   * named boards at `B:<slug>`, a share link (`/terminal?board=`), per-ticker presets
//     (a bare ticker can open a board), "Back to my layout" after any board opens;
//   * a board-level density, recents by kind, and the keep-the-classic-calendar choice;
//   * an unreadable stored layout is never saved over: the member is told and chooses.
//
// Phone (≤640): a single panel — the focused one — under a pinned command line, with the
// function list in a Sheet. Touch tier (≤1024): every control is at least `--tap-min`.
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import ErrorBoundary from '../../components/ErrorBoundary'
import ContextPopover from '../../components/mobile/ContextPopover'
import Sheet from '../../components/mobile/Sheet'
import { useIsPhone } from '../../hooks/useBreakpoint'
import useDoorParam from '../../hooks/useDoorParam'
import jsonFetcher from '../../utils/jsonFetcher'
import CommandLine from './CommandLine'
import HelpPanel from './panels/HelpPanel'
import parseCommand from './parseCommand'
import { BY_CODE, FUNCTIONS, FUNCTION_GROUPS, fillDoor, researchHref, variantFor } from './functions'
import { panelComponent, URL_OWNING_PANELS } from './panels'
import useTerminalLayout from './useTerminalLayout'
import {
  BOARD_ADDRESS_RE, DENSITIES, MAX_VISIBLE, PANEL_COUNTS, activeChannelOf, addChannel, applyChannelSym,
  closePanel, decodePopout, decodeShare, deleteBoard, duplicatePanel, encodeShare, findBoard, isCompatChannel,
  isLinkable, markOpened, openBoard, panelChannel, panelSym, popoutHref, presetFor, saveBoard, setCount as countTo,
  setDensity, setKeepCalendar, setPanelChannel, setPopout, setPreset, shareHref, toggleFavorite, undoClose,
} from './boardModel'
import { BoardsMenu, RecentsMenu } from './BoardsMenu'
import { pushFunctionRecent, readFunctionRecents } from './recents'
import { TERMINAL_CALENDAR_PATH } from './terminalGate'
import styles from './TerminalShell.module.css'

/** Pure: what a stored panel renders — the variant, its security, and why not if it can't. */
export function resolvePanel(panel, syms, auth) {
  const fn = BY_CODE[panel?.code]
  if (!fn) return { state: 'unknown', fn: null }
  const sym = panelSym(panel, syms)
  const variant = (sym && fn.ticker) ? fn.ticker : (fn.market?.panel ? fn.market : null)
  if (!variant) return { state: 'needs-ticker', fn, sym }
  if (variant.flag && auth?.[variant.flag] !== true) return { state: 'disabled', fn, sym, variant }
  return { state: 'ready', fn, sym: variant === fn.ticker ? sym : null, variant }
}

/** Pure: is this input a bare ticker (the one form a per-ticker preset may answer)? */
export function isBareTicker(text, cmd) {
  return !!(cmd?.ok && cmd.type === 'function' && cmd.code === 'DES' && cmd.sym
    && String(text || '').trim().split(/\s+/).length === 1)
}

function channelOf(layout, id) {
  return layout.channels.find((c) => c.id === id) || null
}

function Panel({
  index, panel, focused, syms, auth, channel, onFocus, onChannelMenu, onRun, onClose, onDuplicate,
  onPopout, onBringBack, canClose, isPhone, standalone,
}) {
  const r = resolvePanel(panel, syms, auth)
  const Comp = r.state === 'ready' && !panel.popout ? panelComponent(r.variant.panel) : null
  const title = [r.sym, panel.code].filter(Boolean).join(' ')
  const full = r.state === 'ready' && r.sym && r.variant.section ? researchHref(r.sym, r.variant.section) : null
  const linkable = isLinkable(panel)
  const dot = channel?.color || 'var(--border)'
  return (
    <section
      className={`${styles.panel} ${focused ? styles.panelFocused : ''}`}
      onMouseDown={onFocus}
      onFocusCapture={onFocus}
      aria-label={`Panel ${index + 1}: ${title || 'empty'}`}
      data-testid={`terminal-panel-${index}`}
      data-code={panel.code}
      data-channel={panelChannel(panel) || ''}
      data-focused={focused ? 'true' : 'false'}
    >
      <header className={styles.panelHead}>
        {standalone ? null : linkable ? (
          <button
            type="button"
            className={styles.groupDot}
            style={{ '--dot': dot }}
            onClick={(e) => { e.stopPropagation(); onChannelMenu(e) }}
            aria-label={channel ? `Linked to ${channel.name} — change` : 'Not linked — link to a group'}
            title={channel ? channel.name : 'Not linked'}
            data-testid={`terminal-group-${index}`}
          >
            <span aria-hidden="true">{channel ? channel.id : ''}</span>
          </button>
        ) : (
          <span className={styles.groupDotStatic} title="This function does not follow a security"
            aria-label="Does not follow a security" data-testid={`terminal-group-${index}`} />
        )}
        <span className={styles.panelTitle}>
          <span className={styles.code}>{title}</span>
          <span className={styles.panelLabel}>{r.fn?.label || ''}</span>
        </span>
        {full && <Link className={styles.panelLink} to={full}>Full page</Link>}
        {!standalone && (
          <span className={styles.panelActions}>
            {!isPhone && (
              <button type="button" className={styles.panelAct} onClick={onDuplicate}
                aria-label={`Duplicate panel ${index + 1}`} title="Duplicate" data-testid={`terminal-dup-${index}`}>⧉</button>
            )}
            {!isPhone && r.state === 'ready' && !panel.popout && (
              <button type="button" className={styles.panelAct} onClick={onPopout}
                aria-label={`Pop out panel ${index + 1}`} title="Pop out" data-testid={`terminal-popout-${index}`}>↗</button>
            )}
            {canClose && (
              <button type="button" className={styles.panelAct} onClick={onClose}
                aria-label={`Close panel ${index + 1}`} title="Close" data-testid={`terminal-close-${index}`}>×</button>
            )}
          </span>
        )}
      </header>
      <div className={styles.panelBody}>
        {panel.popout && (
          <div className={styles.panelEmpty} data-testid={`terminal-popped-${index}`}>
            {panel.code} is open in its own window.{' '}
            <button type="button" className={styles.chip} onClick={onBringBack}>Bring it back</button>
          </div>
        )}
        {Comp && (
          <ErrorBoundary key={`${panel.code}:${r.sym || ''}`}>
            <Suspense fallback={<div className={styles.panelEmpty}>Loading {panel.code}…</div>}>
              {r.variant.panel === 'Help'
                ? <Comp args={panel.args} onRun={onRun} />
                : <Comp sym={r.sym || undefined} {...(r.variant.props || {})} />}
            </Suspense>
          </ErrorBoundary>
        )}
        {!panel.popout && r.state === 'needs-ticker' && (
          <div className={styles.panelEmpty}>Type a ticker for {panel.code} — e.g. <kbd>NVDA {panel.code}</kbd></div>
        )}
        {!panel.popout && r.state === 'disabled' && (
          <div className={styles.panelEmpty}>{panel.code} is not enabled for your account yet.</div>
        )}
        {!panel.popout && r.state === 'unknown' && (
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
  const {
    layout, layoutStatus, syms, save, replaceStoredLayout, library, libraryStatus, saveLibrary,
    setGroupSym, loading,
  } = useTerminalLayout()
  const [notice, setNotice] = useState(null)
  const [sheet, setSheet] = useState(null)           // 'functions' | 'boards' | 'recents' | null
  const [channelMenu, setChannelMenu] = useState(null) // { index, anchor }
  const [functionRecents, setFunctionRecents] = useState(() => readFunctionRecents())
  const inputRef = useRef(null)
  const layoutRef = useRef(layout)
  layoutRef.current = layout
  const symsRef = useRef(syms)
  symsRef.current = syms
  const libraryRef = useRef(library)
  libraryRef.current = library
  const previousRef = useRef(null)                   // the board before a board was opened
  const [currentBoard, setCurrentBoard] = useState(null)

  const popoutToken = useMemo(() => new URLSearchParams(location.search).get('popout'), [location.search])
  const popoutPanel = useMemo(() => (popoutToken ? decodePopout(popoutToken) : null), [popoutToken])

  const count = layout.count
  const focus = Math.min(layout.focus, count - 1)
  const libraryWritable = libraryStatus !== 'unreadable' && libraryStatus !== 'newer'

  const openCalendarPath = useCallback((extra) => {
    const p = new URLSearchParams(location.search)
    for (const [k, v] of Object.entries(extra || {})) p.set(k, v)
    const q = p.toString()
    if (location.pathname !== TERMINAL_CALENDAR_PATH || extra) {
      navigate(`${TERMINAL_CALENDAR_PATH}${q ? `?${q}` : ''}`, { replace: !extra })
    }
  }, [location.pathname, location.search, navigate])

  /** Set a channel's security: A–D through `charts_workspace_groups`, history in the board. */
  const commitChannelSym = useCallback((next, channelId, sym) => {
    if (isCompatChannel(channelId)) setGroupSym(channelId, sym)
    return applyChannelSym(next, channelId, sym)
  }, [setGroupSym])

  /** Open a board snapshot (named, shared or preset), remembering the board it replaces. */
  const openSnapshot = useCallback((snapshot, { sym, name, boardId, actions = [] } = {}) => {
    previousRef.current = { layout: layoutRef.current, syms: symsRef.current }
    const { layout: next, compatSyms } = openBoard(snapshot, { sym })
    for (const [ch, s] of Object.entries(compatSyms)) setGroupSym(ch, s)
    save(next)
    setCurrentBoard(name || null)
    if (boardId) saveLibrary(markOpened(libraryRef.current, boardId))
    setNotice({
      kind: 'info',
      text: `Opened ${name || 'board'}${sym ? ` for ${sym}` : ''}.`,
      actions: [...actions, { label: 'Back to my layout', id: 'revert' }],
    })
  }, [save, saveLibrary, setGroupSym])

  const revertLayout = useCallback(() => {
    const prev = previousRef.current
    if (!prev) return
    previousRef.current = null
    for (const ch of ['A', 'B', 'C', 'D']) if (prev.syms?.[ch]) setGroupSym(ch, prev.syms[ch])
    save(prev.layout)
    setCurrentBoard(null)
    setNotice({ kind: 'info', text: 'Back to your layout.' })
  }, [save, setGroupSym])

  const openNamed = useCallback((ref, opts = {}) => {
    const board = typeof ref === 'string' ? findBoard(libraryRef.current, ref) : ref
    if (!board) {
      setNotice({ kind: 'error', text: `No board at ${ref}. Open Boards to see yours.` })
      return false
    }
    openSnapshot(board.layout, { ...opts, name: board.name, boardId: board.id })
    return true
  }, [openSnapshot])

  const run = useCallback((text) => {
    const raw = String(text ?? '').trim()
    setNotice(null)
    if (BOARD_ADDRESS_RE.test(raw)) { openNamed(raw); return }
    const cmd = parseCommand(text)
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

    // A per-ticker preset (V14): a bare ticker opens the member's board for it.
    if (isBareTicker(raw, cmd)) {
      const board = presetFor(libraryRef.current, cmd.sym)
      if (board) { openNamed(board, { sym: cmd.sym }); return }
    }

    const cur = layoutRef.current
    const at = Math.min(cur.focus, cur.count - 1)
    const panel = cur.panels[at]
    let sym = cmd.sym
    let { variant, scope, reason, ignoredTicker } = variantFor(cmd.code, !!sym)
    if (!variant && reason === 'needs-ticker') {
      sym = panelSym(panel, symsRef.current)
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
    setFunctionRecents(pushFunctionRecent(cmd.code))
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
        const r = resolvePanel(p, symsRef.current, auth)
        return r.state === 'ready' && r.variant.panel === variant.panel
      })
      if (existing >= 0) target = existing
    }
    const prev = cur.panels[target]
    const channel = prev.linkable === false ? null : panelChannel(prev)
    const panels = cur.panels.slice()
    const { popout: _popout, ...prevKept } = prev
    panels[target] = {
      ...prevKept,
      code: cmd.code,
      args: cmd.args || [],
      sym: !channel && scope === 'ticker' ? sym : prev.sym,
    }
    let next = { ...cur, focus: target, panels }
    if (scope === 'ticker' && channel) next = commitChannelSym(next, channel, sym)
    save(next)
    if (ignoredTicker) setNotice({ kind: 'info', text: `${cmd.code} is market-wide; ${cmd.sym} was not applied.` })
    if (variant.panel === 'Calendar') {
      openCalendarPath(variant.params?.earnings && sym ? { earnings: sym } : null)
    }
  }, [auth, commitChannelSym, navigate, openCalendarPath, openNamed, save])

  // A deep link `/terminal?cmd=NVDA%20GP` runs once and is stripped (TERM-038's door hook).
  useDoorParam('cmd', run, { ready: !loading && !popoutToken })

  // A share link `/terminal?board=<token>` opens that board once (V3), offering to keep it.
  const applyShared = useCallback((token) => {
    const shared = decodeShare(token)
    if (!shared) { setNotice({ kind: 'error', text: 'That board link could not be read.' }); return }
    openSnapshot(shared.layout, { name: `shared board "${shared.name}"`, actions: [{ label: 'Save to my boards', id: 'save-shared', name: shared.name }] })
  }, [openSnapshot])
  useDoorParam('board', applyShared, { ready: !loading && !popoutToken })

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
    if (!isPhone && !popoutToken) inputRef.current?.focus()
  }, [isPhone, popoutToken])

  // ── the panel lifecycle ──
  const onClose = (i) => {
    const res = closePanel(layout, i)
    if (!res.ok) return
    save(res.layout)
    setNotice({ kind: 'info', text: `Closed ${layout.panels[i].code}.`, actions: [{ label: 'Undo', id: 'undo-close' }] })
  }
  const onUndoClose = () => {
    const res = undoClose(layoutRef.current)
    if (res.ok) { save(res.layout); setNotice(null) }
  }
  const onDuplicate = (i) => {
    const res = duplicatePanel(layout, i)
    if (!res.ok) { setNotice({ kind: 'error', text: `This board already shows ${MAX_VISIBLE} panels. Close one to make room.` }); return }
    save(res.layout)
  }
  const onPopout = (i) => {
    const p = layout.panels[i]
    const win = typeof window.open === 'function'
      ? window.open(popoutHref(p, panelSym(p, syms)), `uct-terminal-${p.id}`, 'popup,width=960,height=720')
      : null
    if (!win) { setNotice({ kind: 'error', text: 'Your browser blocked the pop-out window. Allow pop-ups for this site and try again.' }); return }
    save(setPopout(layout, i, true))
  }

  const pickChannel = (i, id) => save(setPanelChannel(layoutRef.current, i, id, symsRef.current))
  const newChannel = (i) => {
    const { layout: withNew, id } = addChannel(layoutRef.current)
    if (!id) { setNotice({ kind: 'error', text: 'This board has the most groups it can hold.' }); return }
    save(setPanelChannel(withNew, i, id, symsRef.current))
  }
  const retargetChannel = (sym, channelId) => {
    setSheet(null)
    save(commitChannelSym(layoutRef.current, channelId, sym))
  }

  const setCount = (n) => save(countTo(layout, n))
  const setFocus = (i) => { if (i !== layout.focus) save({ ...layout, focus: i }) }

  // ── the library ──
  const onSaveBoard = (name) => {
    const res = saveBoard(library, name, layout, syms)
    if (!res.ok) {
      setNotice({ kind: 'error', text: res.reason === 'full' ? 'You have the most saved boards allowed. Delete one first.' : 'Name the board first.' })
      return
    }
    if (saveLibrary(res.library)) {
      setCurrentBoard(res.board.name)
      setNotice({ kind: 'info', text: `Saved as ${res.board.name} — open it any time with B:${res.board.slug}.` })
    }
  }
  const noticeAction = (a) => {
    if (a.id === 'undo-close') onUndoClose()
    else if (a.id === 'revert') revertLayout()
    else if (a.id === 'save-shared') onSaveBoard(a.name)
  }

  const railGroups = useMemo(() => FUNCTION_GROUPS.map((g) => ({
    g, fns: FUNCTIONS.filter((f) => f.group === g),
  })), [])
  const focusedCode = layout.panels[focus]?.code
  const guarded = layoutStatus === 'unreadable' || layoutStatus === 'newer'

  // ── a popped-out panel: one frozen panel, no board, nothing written ──
  if (popoutToken) {
    return (
      <div className={styles.shell} data-testid="terminal-popout">
        <div className={styles.grid} data-count="1">
          {popoutPanel ? (
            <Panel index={0} panel={popoutPanel} focused={false} syms={{}} auth={auth} channel={null}
              onFocus={() => {}} onRun={() => {}} standalone isPhone={isPhone} />
          ) : <div className={styles.panelEmpty}>This pop-out link could not be read.</div>}
        </div>
      </div>
    )
  }

  const visible = layout.panels.slice(0, count)
  const menuIndex = channelMenu?.index
  const menuPanel = menuIndex != null ? layout.panels[menuIndex] : null
  const activeId = activeChannelOf(layout)
  return (
    <div className={styles.shell} data-phone={isPhone ? 'true' : 'false'} data-density={layout.density}
      data-testid="terminal-shell">
      <div className={styles.bar}>
        <CommandLine onSubmit={run} inputRef={inputRef} />
        {isPhone && (
          <button type="button" className={styles.barBtn} onClick={() => setSheet('functions')} data-testid="terminal-fn-button">
            Functions
          </button>
        )}
        <button type="button" className={styles.barBtn} onClick={() => setSheet('recents')} data-testid="terminal-recents-button">
          Recents
        </button>
        <button type="button" className={styles.barBtn} onClick={() => setSheet('boards')} data-testid="terminal-boards-button">
          {currentBoard ? `Board: ${currentBoard}` : 'Boards'}
        </button>
        {!isPhone && layout.closed.length > 0 && (
          <button type="button" className={styles.barBtn} onClick={onUndoClose} data-testid="terminal-undo-close"
            title={`Re-open ${layout.closed[0].panel.code}`}>Undo close</button>
        )}
        {!isPhone && (
          <div className={styles.counts} role="group" aria-label="Density">
            {DENSITIES.map((d) => (
              <button key={d} type="button" className={`${styles.barBtn} ${layout.density === d ? styles.barBtnOn : ''}`}
                aria-pressed={layout.density === d} onClick={() => save(setDensity(layout, d))}
                title={`${d[0].toUpperCase()}${d.slice(1)} density`} data-testid={`terminal-density-${d}`}>
                {d === 'comfortable' ? 'Aa' : d === 'compact' ? 'Ab' : 'ab'}
              </button>
            ))}
          </div>
        )}
        {!isPhone && (
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
      {guarded && (
        <div className={`${styles.notice} ${styles.noticeError}`} role="alert" data-testid="terminal-unreadable">
          <span>
            {layoutStatus === 'newer'
              ? 'Your saved terminal was saved by a newer version of the app. Reload to use it.'
              : 'Your saved terminal layout could not be read.'}
            {' '}It has not been changed. This session is using a fresh board, and nothing you do here is saved yet.
          </span>
          <button type="button" className={styles.chip} onClick={() => setSheet('boards')}>Version history</button>
          {layoutStatus === 'unreadable' && (
            <button type="button" className={styles.chip} onClick={replaceStoredLayout} data-testid="terminal-start-fresh">
              Start fresh (replace it)
            </button>
          )}
        </div>
      )}
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
          {notice.actions?.map((a) => (
            <button key={a.id} type="button" className={styles.chip} onClick={() => noticeAction(a)}
              data-testid={`terminal-notice-${a.id}`}>{a.label}</button>
          ))}
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
                key={p.id}
                index={i}
                panel={p}
                focused={i === focus}
                syms={syms}
                auth={auth}
                channel={channelOf(layout, panelChannel(p))}
                onFocus={() => setFocus(i)}
                onChannelMenu={(e) => {
                  const r = e.currentTarget.getBoundingClientRect?.() || { left: 0, bottom: 0 }
                  setChannelMenu({ index: i, anchor: { x: r.left, y: r.bottom + 4 } })
                }}
                onRun={run}
                onClose={() => onClose(i)}
                onDuplicate={() => onDuplicate(i)}
                onPopout={() => onPopout(i)}
                onBringBack={() => save(setPopout(layout, i, false))}
                canClose={count > 1}
                isPhone={isPhone}
              />
            )
          ))}
        </div>
      </div>
      <ContextPopover
        open={!!menuPanel}
        onClose={() => setChannelMenu(null)}
        anchor={channelMenu?.anchor}
        title="Link this panel"
        items={menuPanel ? [
          ...layout.channels.map((c) => ({
            key: c.id,
            label: `${c.name}${syms[c.id] ? ` · ${syms[c.id]}` : ''}${panelChannel(menuPanel) === c.id ? ' (this panel)' : ''}${c.id === activeId ? ' · active' : ''}`,
            icon: c.id,
            onClick: () => pickChannel(menuIndex, c.id),
          })),
          { key: 'new', label: 'New group', icon: '+', onClick: () => newChannel(menuIndex) },
          { key: 'none', label: 'Not linked (keep this security)', icon: '·', onClick: () => pickChannel(menuIndex, null) },
        ] : []}
      />
      <Sheet open={sheet === 'functions'} onClose={() => setSheet(null)} title="Functions" variant="bottom-sheet">
        <HelpPanel onRun={(code) => { setSheet(null); run(code) }} />
      </Sheet>
      <Sheet open={sheet === 'boards'} onClose={() => setSheet(null)} title="Boards">
        <BoardsMenu
          library={library}
          libraryWritable={libraryWritable}
          currentName={currentBoard}
          onSave={onSaveBoard}
          onOpen={(b) => { setSheet(null); openNamed(b) }}
          onDelete={(b) => saveLibrary(deleteBoard(library, b.id))}
          onPreset={(sym, id) => saveLibrary(setPreset(library, sym === '*' ? '*' : sym, id))}
          onKeepCalendar={(on) => saveLibrary(setKeepCalendar(library, on))}
          onShareCurrent={() => `${window.location.origin}${shareHref(encodeShare(currentBoard || 'My terminal board', layout, syms))}`}
          onRestored={() => setNotice({ kind: 'info', text: 'Restored an earlier version of your terminal.' })}
        />
      </Sheet>
      <Sheet open={sheet === 'recents'} onClose={() => setSheet(null)} title="Recents">
        <RecentsMenu
          layout={layout}
          library={library}
          functionRecents={functionRecents}
          onRun={(textOrSym, channelId) => {
            if (channelId) { retargetChannel(textOrSym, channelId); return }
            setSheet(null)
            run(textOrSym)
          }}
          onOpenBoard={(b) => { setSheet(null); openNamed(b) }}
          onToggleFavorite={(code) => saveLibrary(toggleFavorite(library, code))}
        />
      </Sheet>
    </div>
  )
}

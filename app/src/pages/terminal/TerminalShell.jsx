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
//
// Lane T3 (the grammar): ONE parser (parseCommand.js) behind this command line AND the
// Ctrl/Cmd-K palette; channel targeting (`@B …`), row <GO>, ASK → AI Search, member aliases,
// comparison modes, the interpreted-parse echo, a published ranking fed by server-side
// command counts, Alt+1..4 panel focus, and ⭐ EVERY COMMAND IS A URL: `?cmd=` reflects the
// focused panel and re-runs on load and on back/forward (the URL-state block below).
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import ErrorBoundary from '../../components/ErrorBoundary'
import ContextPopover from '../../components/mobile/ContextPopover'
import Sheet from '../../components/mobile/Sheet'
import FreshnessBadge from '../../components/provenance/FreshnessBadge'
import { useIsPhone } from '../../hooks/useBreakpoint'
import useDoorParam from '../../hooks/useDoorParam'
import jsonFetcher from '../../utils/jsonFetcher'
import { registerShortcuts } from '../command/shortcutRegistry'
import CommandLine from './CommandLine'
import HelpPanel from './panels/HelpPanel'
import { PanelFreshnessContext } from './panelFreshness'
import parseCommand from './parseCommand'
import { BY_CODE, FUNCTIONS, FUNCTION_GROUPS, fillDoor, flagOn, researchHref, variantFor } from './functions'
import { applyArgs, argsEcho } from './args'
import { panelComponent, panelNameFor, URL_OWNING_PANELS } from './panels'
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
import L0Strip from './L0Strip'
import styles from './TerminalShell.module.css'

/** Pure: what a stored panel renders — the variant, the panel it names (a component, or a
 *  panel-set page), its security, the props its honoured args produce, and why not if it can't.
 *  `syms` is the channel-id → security map (A–D from the /charts groups, E+ from the board). */
export function resolvePanel(panel, syms, auth) {
  const fn = BY_CODE[panel?.code]
  if (!fn) return { state: 'unknown', fn: null }
  const sym = panelSym(panel, syms)
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

/** Pure: the command text that reproduces a stored panel — what `?cmd=` carries. The
 *  security comes from the panel's CHANNEL (`syms`, the channel-id → security map), or from
 *  the panel itself when it is unlinked. */
export function panelCommandText(panel, syms) {
  if (!panel || !BY_CODE[panel.code]) return ''
  const sym = BY_CODE[panel.code].ticker ? panelSym(panel, syms) : null
  return [sym, panel.code, ...(panel.args || [])].filter(Boolean).join(' ')
}

/** Pure: which visible panel a command channel addresses. `@1`…`@4` is a panel slot; a
 *  letter is a channel id on this board (`layout.channels`; A–D are the /charts groups), and
 *  addresses the first visible panel that joined that channel (`panelChannel`). */
export function channelTarget(channel, layout) {
  const visible = layout.panels.slice(0, layout.count)
  if (/^\d$/.test(channel)) {
    const i = Number(channel) - 1
    return i >= 0 && i < visible.length ? { index: i }
      : { error: `Panel ${channel} is not on screen (this board shows ${visible.length}).` }
  }
  const ch = channelOf(layout, channel)
  if (!ch) return { error: `This board has no group ${channel}.` }
  const i = visible.findIndex((p) => panelChannel(p) === ch.id)
  return i >= 0 ? { index: i } : { error: `No panel on screen is linked to ${ch.name}.` }
}

/** The telemetry key for a command: its code or alias, or its kind. Never a ticker or text. */
export function telemetryKey(cmd) {
  if (!cmd?.ok) return null
  if (cmd.alias) return cmd.alias
  if (cmd.type === 'function') return cmd.code
  return { ask: 'ASK', address: 'ADDR', row: 'ROW' }[cmd.type] || null
}

/** Pure: is this input a bare ticker (the one form a per-ticker preset may answer)? */
export function isBareTicker(text, cmd) {
  return !!(cmd?.ok && cmd.type === 'function' && cmd.code === 'DES' && cmd.sym
    && String(text || '').trim().split(/\s+/).length === 1)
}

/** Which list a panel's published rows belong to: the panel and what it is showing. A
 *  popped-out panel shows no list here. */
function rowsOwner(panel) {
  if (!panel || panel.popout) return null
  return `${panel.id}|${panel.code}|${(panel.args || []).join(' ')}`
}

function channelOf(layout, id) {
  return layout.channels.find((c) => c.id === id) || null
}

export function Panel({
  index, panel, focused, syms, auth, channel, onFocus, onChannelMenu, onRun, onRows, helpProps,
  onClose, onDuplicate, onPopout, onBringBack, canClose, isPhone, standalone,
}) {
  const r = resolvePanel(panel, syms, auth)
  const Comp = r.state === 'ready' && !panel.popout ? panelComponent(r.name) : null
  const title = [r.sym, panel.code, ...(panel.args || [])].filter(Boolean).join(' ')
  const full = fullHref(r)
  const linkable = isLinkable(panel)
  const dot = channel?.color || 'var(--border)'
  // Only the FOCUSED panel publishes its numbered rows (row <GO> addresses the focused list),
  // tagged with what it is showing so a list it no longer shows cannot be run.
  const owner = rowsOwner(panel)
  const rowsProp = useMemo(() => (focused && onRows ? (rows) => onRows(rows, owner) : undefined),
    [focused, onRows, owner])
  // V8 — panel freshness badges. OPT-IN: a panel that never calls `usePanelFreshness` never
  // calls this setter, so `freshness` stays null and no badge renders (`panelFreshness.js`).
  // The Provider below is keyed identically to the body's ErrorBoundary, so switching the
  // panel's security/args unmounts the old subtree (running `usePanelFreshness`'s cleanup,
  // which clears this via the same setter) before the new one mounts — never a stale badge
  // held over from the previous security.
  const [freshness, setFreshness] = useState(null)
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
          {freshness && (
            <span className={styles.panelFreshness} data-testid={`terminal-panel-freshness-${index}`}>
              <FreshnessBadge {...freshness} />
            </span>
          )}
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
          <ErrorBoundary
            key={`${panel.code}:${r.sym || ''}:${(panel.args || []).join(' ')}`}
            fallback={<PanelCrashed code={panel.code} />}
          >
            {/* V8: a fresh Provider per panel identity (same key as the ErrorBoundary above) so
                switching security/args clears a stale badge rather than carrying the previous
                security's freshness into the next one's loading state. */}
            <PanelFreshnessContext.Provider value={setFreshness} key={`${panel.code}:${r.sym || ''}:${(panel.args || []).join(' ')}`}>
              <Suspense fallback={<div className={styles.panelEmpty}>Loading {panel.code}…</div>}>
                {r.name === 'Help'
                  ? <Comp {...r.props} onRun={onRun} onRows={rowsProp} {...helpProps} auth={auth} />
                  : r.name === 'Move'
                    ? <Comp sym={r.sym || undefined} onRun={onRun} onRows={rowsProp} />
                    : <Comp sym={r.sym || undefined} {...(r.variant.props || {})} {...r.props} />}
              </Suspense>
            </PanelFreshnessContext.Provider>
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
  const [boardsOpenToVersions, setBoardsOpenToVersions] = useState(false)
  // Keyed by the panel's STABLE `id` (never a positional index): `onClose`/`onDuplicate`/
  // `undoClose`/`setCount` all reshuffle `layout.panels`, and this popover is non-modal, so a
  // click can land long after a close/duplicate shifted every index behind it. Resolving by id
  // at click time means a closed panel's menu just stops matching anything (closes, no-ops)
  // instead of silently relinking whatever panel now sits at the old index.
  const [channelMenu, setChannelMenu] = useState(null) // { panelId, anchor }
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

  // The focused panel's numbered list (row <GO>): the command strings it published.
  // Tagged with the publishing panel (`rowsOwner`), so row <GO> never runs a stale list.
  const rowsRef = useRef({ owner: null, rows: [] })
  const onRows = useCallback((rows, owner) => {
    rowsRef.current = { owner: owner ?? null, rows: Array.isArray(rows) ? rows : [] }
  }, [])

  // V6b / V17: the member's aliases and command counts (server-owned, owner-scoped). A failed
  // read leaves the grammar working without them — never an error on the command line.
  const [aliases, setAliases] = useState({})
  const [stats, setStats] = useState({})
  const loadAliases = useCallback(() => jsonFetcher('/api/terminal/aliases')
    .then((d) => setAliases(d?.aliases && typeof d.aliases === 'object' ? d.aliases : {}))
    .catch(() => {}), [])
  const loadStats = useCallback(() => jsonFetcher('/api/terminal/commands/stats')
    .then((d) => setStats(d?.stats && typeof d.stats === 'object' ? d.stats : {}))
    .catch(() => {}), [])
  useEffect(() => { loadAliases(); loadStats() }, [loadAliases, loadStats])
  const aliasesRef = useRef(aliases)
  aliasesRef.current = aliases

  const countCommand = useCallback((cmd) => {
    const key = telemetryKey(cmd)
    if (!key) return
    jsonFetcher('/api/terminal/commands/event', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }),
    }).then(() => setStats((s) => ({ ...s, [key]: { n: (s[key]?.n || 0) + 1, last: Date.now() / 1000 } })))
      .catch(() => {})
  }, [])
  const resetRanking = useCallback(() => jsonFetcher('/api/terminal/commands/stats', { method: 'DELETE' })
    .then(() => {
      setStats({})
      setNotice({ kind: 'info', text: 'Personal ranking reset: suggestions now follow the published order alone.' })
    })
    .catch(() => setNotice({ kind: 'error', text: 'Could not reset your ranking just now; nothing was changed.' })), [])

  // Set by a member-typed command, read by the URL sync: their command earns a history entry.
  const userRunRef = useRef(false)

  const openCalendarPath = useCallback((extra) => {
    const p = new URLSearchParams(location.search)
    p.delete('cmd')   // the calendar owns this URL; a stale shell command must not ride along
    // `null` removes a param (`CAL TODAY` clears `?week=` back to the current week).
    for (const [k, v] of Object.entries(extra || {})) { if (v == null) p.delete(k); else p.set(k, v) }
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
    // FIX 4: unconditional, not `if (prev.syms?.[ch])` — a previously-UNLINKED channel's
    // `syms[ch]` is falsy (null), and skipping the call left a board-injected ticker stuck
    // on it. Always tell the channel what it used to be, including empty.
    for (const ch of ['A', 'B', 'C', 'D']) setGroupSym(ch, prev.syms?.[ch] || '')
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

  /** Run one command line. Returns the panel text it put in a panel, or null. A board
   *  address (`B:<slug>`) opens that board; everything else goes through the ONE parser. */
  const run = useCallback((text, { fromUrl = false } = {}) => {
    const raw = String(text ?? '').trim()
    setNotice(null)
    if (BOARD_ADDRESS_RE.test(raw)) { openNamed(raw); return null }
    const cmd = parseCommand(raw, { aliases: aliasesRef.current })
    if (!cmd.ok) {
      if (cmd.error !== 'empty') setNotice({ kind: 'error', text: cmd.error, sym: cmd.sym, suggestions: cmd.suggestions || [] })
      return null
    }
    if (cmd.type.startsWith('alias-')) {
      // ⛔ Never from a URL: a shared link must not define or delete an alias for its clicker.
      if (fromUrl) {
        setNotice({ kind: 'error', text: 'Aliases are defined at the command line, not from a link.' })
        return null
      }
      if (cmd.type === 'alias-list') {
        const list = Object.entries(aliasesRef.current)
        setNotice({ kind: 'info', text: list.length
          ? `Your aliases: ${list.map(([n, e]) => `${n} = ${e}`).join(' · ')}`
          : 'You have no aliases yet. ALIAS NAME = command saves one.' })
        return null
      }
      const path = `/api/terminal/aliases/${encodeURIComponent(cmd.name)}`
      const req = cmd.type === 'alias-define'
        ? jsonFetcher(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ expansion: cmd.expansion }) })
        : jsonFetcher(path, { method: 'DELETE' })
      req.then(() => {
        setNotice({ kind: 'info', text: cmd.type === 'alias-define'
          ? `Saved alias ${cmd.name} = ${cmd.expansion}` : `Removed alias ${cmd.name}.` })
        loadAliases()
      }).catch((err) => setNotice({ kind: 'error', text: cmd.type === 'alias-delete'
        ? `You have no alias ${cmd.name}.`
        : err?.status === 409 ? `${cmd.name} is refused: it is a real ticker (or you are at the alias limit). An alias may never shadow a security.`
          : `${cmd.name} was not saved just now; try again.` }))
      return null
    }
    if (cmd.type === 'row') {
      // Only the list the focused panel shows NOW: a list published by a panel since closed,
      // replaced, popped out or unfocused is not addressable.
      const lay = layoutRef.current
      const owner = rowsOwner(lay.panels[Math.min(lay.focus, lay.count - 1)])
      const rows = owner && rowsRef.current.owner === owner ? rowsRef.current.rows : []
      const target = rows[cmd.n - 1]
      if (!target) {
        setNotice({ kind: 'error', text: rows.length
          ? `There is no row ${cmd.n} here (rows 1-${rows.length}).`
          : 'The focused panel has no numbered list. HELP shows one.' })
        return null
      }
      countCommand(cmd)
      return run(target)
    }
    countCommand(cmd)
    if (cmd.type === 'ask') {
      navigate(`/ai-search?q=${encodeURIComponent(cmd.question)}`)
      return null
    }
    if (cmd.type === 'address') {
      if (auth.addressSpaceEnabled !== true) {
        setNotice({ kind: 'error', text: `Saved-item addresses (${cmd.address}) are not enabled for your account yet.` })
        return null
      }
      jsonFetcher(`/api/address/resolve?a=${encodeURIComponent(cmd.address)}`)
        .then((row) => {
          if (row?.to) navigate(row.to)
          else setNotice({ kind: 'error', text: `Nothing at ${cmd.address}.` })
        })
        .catch(() => setNotice({ kind: 'error', text: `Nothing at ${cmd.address} that you can open.` }))
      return null
    }

    // A per-ticker preset (V14): a bare ticker opens the member's board for it.
    if (isBareTicker(raw, cmd)) {
      const board = presetFor(libraryRef.current, cmd.sym)
      if (board) { openNamed(board, { sym: cmd.sym }); return null }
    }

    const cur = layoutRef.current
    let at = Math.min(cur.focus, cur.count - 1)
    if (cmd.channel) {
      const t = channelTarget(cmd.channel, cur)
      if (t.error) { setNotice({ kind: 'error', text: t.error }); return null }
      at = t.index
    }
    const panel = cur.panels[at]
    let sym = cmd.sym
    let { variant, scope, reason, ignoredTicker } = variantFor(cmd.code, !!sym)
    if (!variant && reason === 'needs-ticker') {
      sym = panelSym(panel, symsRef.current)
      if (sym) { variant = BY_CODE[cmd.code].ticker; scope = 'ticker' }
    }
    if (!variant) {
      setNotice({ kind: 'error', text: `${cmd.code} needs a ticker — e.g. NVDA ${cmd.code}.` })
      return null
    }
    if (!flagOn(auth, variant.flag)) {
      setNotice({ kind: 'error', text: `${cmd.code} is not enabled for your account yet.` })
      return null
    }
    setFunctionRecents(pushFunctionRecent(cmd.code))
    if (cmd.code === 'CMP' && cmd.compareMode === 'sector' && variant.door) {
      // FIX 2: `NVDA CMP SECTOR FOO` carries `cmd.args = ['SECTOR', 'FOO']` — this branch
      // only ever reads `sym` (the comparator is resolved server-side), so `FOO` was silently
      // dropped with no echo, unlike the AMD path below which refuses + reports via `argsEcho`.
      // `SECTOR` is the mode marker (consumed by definition, like a door's `{argN}`); anything
      // AFTER it is a genuine leftover and gets the same refuse-and-say-so treatment.
      const leftover = cmd.args.slice(1)
      if (leftover.length) {
        setNotice({ kind: 'error', text: argsEcho(cmd.code, { applied: [], ignored: leftover, takes: [] }) })
        return null
      }
      // V18: vs sector — the server resolves the security's sector ETF, then the SAME door.
      setNotice({ kind: 'info', text: `Finding ${sym}'s sector ETF…` })
      jsonFetcher(`/api/terminal/compare-target?sym=${encodeURIComponent(sym)}&mode=sector`)
        .then((d) => {
          const to = d?.comparator ? fillDoor(variant.door, { sym, args: [d.comparator] }) : null
          if (to) navigate(to)
          else setNotice({ kind: 'error', text: `No sector ETF is known for ${sym}.` })
        })
        .catch(() => setNotice({ kind: 'error', text: `No sector ETF is known for ${sym}; try ${sym} CMP XLK.` }))
      return null
    }
    if (variant.door) {
      const to = fillDoor(variant.door, { sym, args: cmd.args })
      if (!to) {
        setNotice({ kind: 'error', text: `${cmd.code} needs ${variant.needsArg || 'a ticker'}.` })
        return null
      }
      // A door leaves the shell, so an argument it cannot carry would vanish with no one to
      // say so: refuse instead, and say which token (V6a, never silent).
      const leftover = applyArgs(variant, cmd.args)
      if (leftover.ignored.length) {
        setNotice({ kind: 'error', text: argsEcho(cmd.code, leftover) })
        return null
      }
      navigate(to)
      return null
    }
    const name = panelNameFor(variant)
    if (!name) {
      setNotice({ kind: 'error', text: `${cmd.code} has no panel on this release.` })
      return null
    }
    // V6a: every token after the code is APPLIED or said to be NOT applied, never dropped.
    const applied = applyArgs(variant, cmd.args)
    const echo = argsEcho(cmd.code, applied)

    // A panel that owns the URL (the calendar, the screener page) appears at most once:
    // re-use its slot.
    let target = at
    let redirectedFrom = null
    if (URL_OWNING_PANELS.has(name)) {
      const existing = cur.panels.slice(0, cur.count).findIndex((p, i) => {
        if (i === at) return false
        const r = resolvePanel(p, symsRef.current, auth)
        return r.state === 'ready' && r.name === name
      })
      // FIX 3: `cmd.channel` means the member EXPLICITLY aimed this at a panel (`@B`/`@2`).
      // Silently honouring the URL-owning re-use rule instead jumps focus to the EXISTING
      // panel elsewhere on the board with no word said — the explicit target intent is just
      // discarded. Keep the re-use rule (a URL-owning panel still appears at most once), but
      // say so when it overrode an explicit target.
      if (existing >= 0) { if (cmd.channel && existing !== at) redirectedFrom = cmd.channel; target = existing }
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
    const said = [
      ignoredTicker && `${cmd.code} is market-wide; ${cmd.sym} was not applied.`,
      redirectedFrom && `${name} is already open elsewhere on this board; @${redirectedFrom} was redirected there instead of opening a second copy.`,
      echo,
    ].filter(Boolean)
    if (said.length) setNotice({ kind: applied.ignored.length ? 'error' : 'info', text: said.join(' ') })
    if (name === 'Calendar') {
      const extra = { ...applied.params, ...(variant.params?.earnings && sym ? { earnings: sym } : {}) }
      openCalendarPath(Object.keys(extra).length ? extra : null)
      return null
    }
    return [scope === 'ticker' ? sym : null, cmd.code, ...(cmd.args || [])].filter(Boolean).join(' ')
  }, [auth, commitChannelSym, navigate, openCalendarPath, openNamed, save, countCommand, loadAliases])

  const runTyped = useCallback((text) => { userRunRef.current = true; return run(text) }, [run])

  // ── V6d: EVERY COMMAND IS A URL ──────────────────────────────────────────────
  // `?cmd=` reflects the focused panel. An arriving `?cmd=` (a link, a palette pick, back/
  // forward) runs; the shell then writes the focused panel's command back. ⛔ H14: each
  // effect writes only when the URL and the panel DISAGREE; a pending URL command blocks the
  // write-back until its panel has caught up; a URL-owning panel (the calendar) is never
  // written over; and a write budget stops any ping-pong cold.
  const runRef = useRef(run)
  runRef.current = run
  const urlCmdRef = useRef(undefined)      // the last `?cmd=` value acted on or written
  const pendingRef = useRef(null)          // the panel text an arriving URL command will show
  const writesRef = useRef([])
  const urlSyncTrippedRef = useRef(false) // H14: true once the write-budget notice has fired
  const urlCmd = new URLSearchParams(location.search).get('cmd')
  // A pop-out window is one frozen panel: it neither runs nor writes `?cmd=`.
  useEffect(() => {
    if (loading || popoutToken || !urlCmd || urlCmd === urlCmdRef.current) return
    urlCmdRef.current = urlCmd
    pendingRef.current = runRef.current(urlCmd, { fromUrl: true }) || null
  }, [loading, popoutToken, urlCmd])

  const focusedPanel = layout.panels[focus]
  const focusedText = panelCommandText(focusedPanel, syms)
  const focusedOwnsUrl = URL_OWNING_PANELS.has(resolvePanel(focusedPanel, syms, auth).name)
  useEffect(() => {
    if (loading || popoutToken || focusedOwnsUrl || !focusedText) return
    if (pendingRef.current && pendingRef.current !== focusedText) return
    pendingRef.current = null
    if (urlCmd === focusedText) { urlCmdRef.current = urlCmd; return }
    const now = Date.now()
    writesRef.current = writesRef.current.filter((t) => now - t < 2000)
    if (writesRef.current.length >= 6) {
      console.warn('[terminal] ?cmd= write budget spent; URL sync paused (H14)')
      // H14: console.warn alone is invisible to the member — bookmarking/back/forward/copy-link
      // go stale with zero signal. Surface it once via the same notice idiom used everywhere
      // else in this file, so it is dismissable like any other notice.
      if (!urlSyncTrippedRef.current) {
        urlSyncTrippedRef.current = true
        setNotice({ kind: 'error', text: 'The address bar stopped following your panels (too many changes too fast). Reload the page to restore it.' })
      }
      return
    }
    writesRef.current.push(now)
    const p = new URLSearchParams(location.search)
    p.set('cmd', focusedText)
    urlCmdRef.current = focusedText
    const push = userRunRef.current
    userRunRef.current = false
    navigate({ pathname: location.pathname, search: `?${p.toString()}`, hash: location.hash }, { replace: !push })
  }, [loading, popoutToken, focusedOwnsUrl, focusedText, urlCmd, location.pathname, location.search, location.hash, navigate])

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
  //
  // FIX 1: `BY_CODE[code]?.ticker?.panel`/`?.market?.panel === 'Calendar'` is true for BOTH
  // `CAL` and `ERN` (ERN opens the calendar's own earnings modal — functions.js). Treating
  // only `p.code === 'CAL'` as "already the calendar" meant this effect — firing on the SAME
  // route remount that `TICKER ERN` just ran against (`/terminal` -> `/terminal/calendar`
  // re-matches a different <Route>, remounting TerminalShell and resetting this ref) — never
  // recognised the just-created ERN panel as satisfying "a visible panel already shows the
  // calendar", so the `at < 0` fallback injected a bare CAL into the focused panel and
  // clobbered the ERN panel's identity (`data-code`, the header, and the `?cmd=`/stored-layout
  // text all reverted to CAL even though the earnings modal still opened via `?earnings=`,
  // masking the loss). Recognising ERN here means `at >= 0` and the fallback never runs.
  const isCalendarCode = (code) => {
    const fn = BY_CODE[code]
    return fn?.ticker?.panel === 'Calendar' || fn?.market?.panel === 'Calendar'
  }
  const enteredCalendar = useRef(false)
  useEffect(() => {
    if (loading || enteredCalendar.current) return
    if (location.pathname !== TERMINAL_CALENDAR_PATH) return
    enteredCalendar.current = true
    const cur = layoutRef.current
    const visible = cur.panels.slice(0, cur.count)
    const at = visible.findIndex((p) => isCalendarCode(p.code))
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

  // FIX 5: the real browser window a pop-out opens, keyed by the panel's STABLE id (the same
  // id-keying idiom as `channelMenu` above — an index would go stale across a close/reorder).
  // `window.open()`'s return value was previously discarded entirely, so "Bring it back" and
  // panel-close could toggle the board's OWN `popout` flag but never touch the real orphaned
  // window, which stayed open on screen regardless.
  const popoutWindowsRef = useRef({})
  const closePopoutWindow = (panelId) => {
    const handle = popoutWindowsRef.current[panelId]
    delete popoutWindowsRef.current[panelId]
    if (handle && !handle.closed) handle.close()
  }

  // ── the panel lifecycle ──
  const onClose = (i) => {
    const res = closePanel(layout, i)
    if (!res.ok) return
    closePopoutWindow(layout.panels[i].id)
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
    popoutWindowsRef.current[p.id] = win
    save(setPopout(layout, i, true))
  }
  const onBringBack = (i) => {
    closePopoutWindow(layout.panels[i].id)
    save(setPopout(layout, i, false))
  }

  // Resolve the menu's target panel by STABLE id, at the moment of the click — never by the
  // index captured when the menu opened (FIX: see the channelMenu state comment above). If the
  // panel was closed in the meantime, the lookup fails and this is a no-op: no silent relink.
  const panelIndexById = (panelId) => layoutRef.current.panels.findIndex((p) => p.id === panelId)
  const pickChannel = (panelId, id) => {
    const i = panelIndexById(panelId)
    if (i < 0) return
    save(setPanelChannel(layoutRef.current, i, id, symsRef.current))
  }
  const newChannel = (panelId) => {
    const i = panelIndexById(panelId)
    if (i < 0) return
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

  // V4: Alt+1..4 focuses that panel — from the command line too (declared inEditable).
  const setFocusRef = useRef(null)
  setFocusRef.current = (i) => { if (i < count) setFocus(i) }
  useEffect(() => registerShortcuts({
    'terminal.panel1': (e) => { e.preventDefault(); setFocusRef.current?.(0) },
    'terminal.panel2': (e) => { e.preventDefault(); setFocusRef.current?.(1) },
    'terminal.panel3': (e) => { e.preventDefault(); setFocusRef.current?.(2) },
    'terminal.panel4': (e) => { e.preventDefault(); setFocusRef.current?.(3) },
  }), [])

  const railGroups = useMemo(() => FUNCTION_GROUPS.map((g) => ({
    g, fns: FUNCTIONS.filter((f) => f.group === g),
  })), [])
  const focusedCode = layout.panels[focus]?.code
  const helpProps = { onResetRanking: resetRanking, hasStats: Object.keys(stats).length > 0 }
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
  const menuPanelId = channelMenu?.panelId
  const menuPanel = menuPanelId != null ? layout.panels.find((p) => p.id === menuPanelId) || null : null
  const activeId = activeChannelOf(layout)
  return (
    <div className={styles.shell} data-phone={isPhone ? 'true' : 'false'} data-density={layout.density}
      data-testid="terminal-shell">
      <div className={styles.bar}>
        <L0Strip layout={layout} isPhone={isPhone} />
        <CommandLine onSubmit={runTyped} inputRef={inputRef} aliases={aliases} stats={stats} />
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
      {isPhone && (
        <div className={styles.phoneBar}>
          <div className={styles.phoneSwitcher} role="tablist" aria-label="Panels" data-testid="terminal-phone-switcher">
            {visible.map((p, i) => (
              <button
                key={p.id}
                type="button"
                role="tab"
                className={`${styles.barBtn} ${i === focus ? styles.barBtnOn : ''}`}
                aria-selected={i === focus}
                onClick={() => setFocus(i)}
                data-testid={`terminal-phone-switch-${i}`}
              >{p.code}</button>
            ))}
          </div>
          <div className={styles.counts} role="group" aria-label="Panels">
            {PANEL_COUNTS.map((n) => (
              <button
                key={n}
                type="button"
                className={`${styles.barBtn} ${count === n ? styles.barBtnOn : ''}`}
                aria-pressed={count === n}
                onClick={() => setCount(n)}
                data-testid={`terminal-phone-count-${n}`}
              >{n}</button>
            ))}
          </div>
        </div>
      )}
      {guarded && (
        <div className={`${styles.notice} ${styles.noticeError}`} role="alert" data-testid="terminal-unreadable">
          <span>
            {layoutStatus === 'newer'
              ? 'Your saved terminal was saved by a newer version of the app. Reload to use it.'
              : 'Your saved terminal layout could not be read.'}
            {' '}It has not been changed. This session is using a fresh board, and nothing you do here is saved yet.
          </span>
          <button type="button" className={styles.chip} onClick={() => { setBoardsOpenToVersions(true); setSheet('boards') }}>Version history</button>
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
                  onClick={() => runTyped(notice.sym ? `${notice.sym} ${c}` : c)}>{c}</button>
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
                    onClick={() => runTyped(f.code)}
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
                  setChannelMenu({ panelId: p.id, anchor: { x: r.left, y: r.bottom + 4 } })
                }}
                onRun={runTyped}
                onRows={onRows}
                helpProps={helpProps}
                onClose={() => onClose(i)}
                onDuplicate={() => onDuplicate(i)}
                onPopout={() => onPopout(i)}
                onBringBack={() => onBringBack(i)}
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
            onClick: () => pickChannel(menuPanelId, c.id),
          })),
          { key: 'new', label: 'New group', icon: '+', onClick: () => newChannel(menuPanelId) },
          { key: 'none', label: 'Not linked (keep this security)', icon: '·', onClick: () => pickChannel(menuPanelId, null) },
        ] : []}
      />
      <Sheet open={sheet === 'functions'} onClose={() => setSheet(null)} title="Functions" variant="bottom-sheet">
        <HelpPanel onRun={(code) => { setSheet(null); runTyped(code) }} {...helpProps} auth={auth} />
      </Sheet>
      <Sheet open={sheet === 'boards'} onClose={() => { setSheet(null); setBoardsOpenToVersions(false) }} title="Boards">
        <BoardsMenu
          library={library}
          libraryWritable={libraryWritable}
          currentName={currentBoard}
          openToVersions={boardsOpenToVersions}
          onSave={onSaveBoard}
          onOpen={(b) => { setSheet(null); openNamed(b) }}
          onDelete={(b) => {
            saveLibrary(deleteBoard(library, b.id))
            if (b.name === currentBoard) setCurrentBoard(null)
          }}
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
            runTyped(textOrSym)
          }}
          onOpenBoard={(b) => { setSheet(null); openNamed(b) }}
          onToggleFavorite={(code) => saveLibrary(toggleFavorite(library, code))}
        />
      </Sheet>
    </div>
  )
}

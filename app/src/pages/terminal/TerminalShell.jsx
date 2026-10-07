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
import Provenance from '../../components/provenance/Provenance'
import { PanelFreshnessContext, PanelSkeleton, PanelState, TerminalPanelContext } from '../../components/terminal'
import UIcon from '../../components/ui/UIcon'
import { useIsPhone } from '../../hooks/useBreakpoint'
import useDoorParam from '../../hooks/useDoorParam'
import jsonFetcher from '../../utils/jsonFetcher'
import { registerShortcuts } from '../command/shortcutRegistry'
import CommandLine from './CommandLine'
import HelpPanel, { KeysTable } from './panels/HelpPanel'
import parseCommand, { normalizeInput } from './parseCommand'
import { BY_CODE, FUNCTIONS, FUNCTION_GROUPS, depthPanelOf, fillDoor, flagOn, researchHref, variantFor } from './functions'
import { applyArgs, argsEcho } from './args'
import { COMMAND_PANELS, FLUSH_PANELS, panelComponent, panelNameFor, URL_OWNING_PANELS } from './panels'
import useTerminalLayout from './useTerminalLayout'
import useCommandHistory from './commandHistory'
import {
  BOARD_ADDRESS_RE, CLOSED_MAX, DENSITIES, MAX_VISIBLE, PANEL_COUNTS, activeChannelOf, addChannel, applyChannelSym,
  closePanel, decodePopout, decodeShare, deleteBoard, duplicatePanel, encodeShare, findBoard, isCompatChannel,
  isLinkable, markOpened, movePanel, nextLinkChannel, reorderPanel, openBoard, panelChannel, panelSym, popoutHref, presetFor,
  recentSecurities, saveBoard, setCount as countTo,
  setDensity, setKeepCalendar, setPanelChannel, setPopout, setPreset, shareHref, toggleFavorite, undoClose,
} from './boardModel'
import { BoardsMenu, RecentsMenu } from './BoardsMenu'
import { pushFunctionRecent, readFunctionRecents } from './recents'
import { TERMINAL_CALENDAR_PATH, TERMINAL_PATH } from './terminalGate'
import L0Strip from './L0Strip'
import { brandedTitle } from '../../surfaces/brand'
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
  if (r.sym && r.variant.section) return researchHref(r.sym, r.variant.section, depthPanelOf(r.variant))
  return r.variant.full || r.variant.surface || null
}

/** What a failed ALIAS / UNALIAS says (audit #13): "not switched on", "refused" and "try again"
 *  are different facts, and only a transient failure is worth retrying. */
export function aliasFailure(cmd, status) {
  if (status === 404 && cmd.type === 'alias-delete') return `You have no alias ${cmd.name}.`
  if (status === 404 || status === 503) return 'Aliases are not enabled on this server yet.'
  if (status === 401 || status === 403) return 'Sign in again to save aliases.'
  if (cmd.type === 'alias-delete') return `${cmd.name} was not removed just now; try again.`
  if (status === 409) return `${cmd.name} is refused: it is a real ticker (or you are at the alias limit). An alias may never shadow a security.`
  if (status === 400 || status === 422) return `${cmd.name} was refused by the server: check the name and the command it stands for.`
  return `${cmd.name} was not saved just now; try again.`
}

/** What a panel shows when the component inside it throws: the rest of the shell lives on. */
function PanelCrashed({ code }) {
  return (
    <PanelState kind="error" role="alert" testId="terminal-panel-crashed"
      title={`${code} hit an error and stopped.`}>
      The other panels are unaffected; run {code} again to retry.
    </PanelState>
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
  // Only a panel that FOLLOWS a security can be a group's target: CAL and HELP carry a
  // channel record but no security variant, and a command aimed at the group must not
  // overwrite the calendar that happens to sit first in it.
  const i = visible.findIndex((p) => panelChannel(p) === ch.id && isLinkable(p))
  return i >= 0 ? { index: i } : { error: `No panel on screen is linked to ${ch.name}.` }
}

/** The same-origin channel a pop-out window and its board talk on (audit #23), or null. */
export const POPOUT_BUS = 'uct-terminal-popout'
function openPopoutBus() {
  try { return typeof BroadcastChannel === 'function' ? new BroadcastChannel(POPOUT_BUS) : null } catch { return null }
}

/** H14's `?cmd=` write budget: at most this many URL writes inside this sliding window. */
export const URL_WRITE_BUDGET = 6
export const URL_WRITE_WINDOW_MS = 2000

/** Per-tab memory of "my layout" while an opened board is on screen (audit #10): a reload
 *  after a shared link must still be able to go back. Every access wrapped. */
const REVERT_KEY = 'uct.terminal.revertLayout'
function readRevert() {
  try {
    const v = JSON.parse(window.sessionStorage.getItem(REVERT_KEY) || 'null')
    return v && typeof v === 'object' && v.layout ? v : null
  } catch { return null }
}
function writeRevert(v) {
  try {
    if (v) window.sessionStorage.setItem(REVERT_KEY, JSON.stringify(v))
    else window.sessionStorage.removeItem(REVERT_KEY)
  } catch { /* storage off */ }
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

/** A published row that names ONE security with the `$` escape (`$NVDA`): row <GO> loads it into
 *  the linked group (Shift+Enter's path) instead of opening DES over the list that published it. */
export function isLoadRow(text) {
  return /^\$[A-Z][A-Z0-9]{0,5}(?:[.-][A-Z]{1,2})?$/.test(String(text || '').trim())
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

/** The FreshnessBadge props a panel report may carry — everything but `source`. */
const BADGE_KEYS = ['freshnessClass', 'asOf', 'age', 'sessionState', 'sessionStale', 'fields']

/**
 * TERM-019 / TERM-050 — the ONE place a terminal panel says where its numbers came from and how
 * old they are. A panel reports `{ source, ...FreshnessBadge props }` through
 * `usePanelFreshness` (components/terminal/terminalPanel.js); this renders that report with S8's
 * own two primitives and nothing of its own: the source through `<Provenance>` (its disclosure
 * carries the source and, when the panel gave one, the observed instant — `observedAt`, or the
 * badge's own `asOf`), the age through
 * `<FreshnessBadge>`.
 *
 * ⛔ A SOURCE WITH NO AGE SAYS SO. A panel that can name its source but was handed no as-of gets
 * the badge's own "undated" clause — never a blank, which would read as "fresh".
 */
export function PanelProvenance({ report, index }) {
  const source = typeof report?.source === 'string' && report.source.trim() ? report.source.trim() : null
  const badge = {}
  for (const k of BADGE_KEYS) if (report?.[k] != null && report[k] !== false) badge[k] = report[k]
  const hasAge = Object.keys(badge).length > 0
  if (!source && !hasAge) return null
  return (
    <span className={styles.panelMeta} data-testid={`terminal-panel-freshness-${index}`}>
      {source && (
        <span className={styles.panelSource} data-testid={`terminal-panel-source-${index}`}>
          <Provenance
            value={`Source: ${source}`}
            provenance={{ sourceActivity: source, timestamp: report.observedAt || badge.asOf || null }}
          />
        </span>
      )}
      <FreshnessBadge {...(hasAge ? badge : { age: { asOfDate: null } })} />
    </span>
  )
}

export function Panel({
  index, panel, focused, syms, auth, channel, onFocus, onChannelMenu, onRun, onRows, helpProps,
  onClose, onDuplicate, onPopout, onBringBack, canClose, isPhone, standalone, hidden = false,
  density = 'comfortable', domId, canMaximise = false, maximised = false, onMaximise,
  reorder = null,
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
  // calls this setter, so `freshness` stays null and no badge renders (`components/terminal/terminalPanel.js`).
  // The Provider below is keyed identically to the body's ErrorBoundary, so switching the
  // panel's security/args unmounts the old subtree (running `usePanelFreshness`'s cleanup,
  // which clears this via the same setter) before the new one mounts — never a stale badge
  // held over from the previous security.
  const [freshness, setFreshness] = useState(null)
  // ONE header per panel: what the embedded component learns about the frame it sits in, so a
  // page can drop its own title and page padding (components/terminal/terminalPanel.js).
  const flush = !!(r.name && FLUSH_PANELS.has(r.name))
  const frame = useMemo(() => ({ code: panel.code, density, inset: !flush }), [panel.code, density, flush])
  const identity = `${panel.code}:${r.sym || ''}:${(panel.args || []).join(' ')}`
  return (
    <section
      className={`${styles.panel} ${focused ? styles.panelFocused : ''} ${reorder?.dropTarget ? styles.panelDropTarget : ''} ${reorder?.dragging ? styles.panelDragging : ''}`}
      onMouseDown={onFocus}
      onFocusCapture={onFocus}
      aria-label={`Panel ${index + 1}: ${title || 'empty'}`}
      id={domId}
      data-testid={`terminal-panel-${index}`}
      data-code={panel.code}
      data-channel={panelChannel(panel) || ''}
      data-focused={focused ? 'true' : 'false'}
      hidden={hidden}
      data-drop-target={reorder?.dropTarget ? 'true' : undefined}
      onDragOver={reorder?.onDragOver}
      onDragLeave={reorder?.onDragLeave}
      onDrop={reorder?.onDrop}
    >
      <header className={styles.panelHead}>
        {reorder?.canMove && (
          // The reorder handle. Drag it onto another panel (mouse); or tap/click it for a "Move to
          // panel N" menu (touch: HTML5 drag never fires there); or focus it and press ←/→.
          <button
            type="button"
            className={styles.panelGrip}
            draggable
            onDragStart={reorder.onDragStart}
            onDragEnd={reorder.onDragEnd}
            onClick={(e) => { e.stopPropagation(); reorder.onMenu(e) }}
            onKeyDown={reorder.onKeyDown}
            aria-haspopup="menu"
            aria-keyshortcuts="Alt+Shift+[ Alt+Shift+]"
            aria-label={`Move panel ${index + 1}: drag it, choose a place, or press the left and right arrows`}
            title="Move: drag onto another panel, click for a list, or ←/→ (Alt+Shift+[ / ])"
            data-testid={`terminal-grip-${index}`}
            data-grip-id={panel.id}
          >
            <UIcon name="menu" size={12} gold={false} />
          </button>
        )}
        {standalone ? null : linkable ? (
          <button
            type="button"
            className={styles.groupDot}
            style={{ '--dot': dot }}
            onClick={(e) => { e.stopPropagation(); onChannelMenu(e) }}
            aria-label={channel ? `Linked to ${channel.name} — change` : 'Not linked — link to a group'}
            aria-keyshortcuts="Alt+L"
            title={`${channel ? channel.name : 'Not linked'} (Alt+L: next group)`}
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
          {freshness && <PanelProvenance report={freshness} index={index} />}
        </span>
        {full && <Link className={styles.panelLink} to={full}>Full page</Link>}
        {!standalone && (
          <span className={styles.panelActions}>
            {canMaximise && (
              <button type="button" className={styles.panelAct} onClick={onMaximise}
                aria-pressed={maximised} aria-keyshortcuts="Alt+M"
                aria-label={`${maximised ? 'Restore' : 'Maximise'} panel ${index + 1}`}
                title={`${maximised ? 'Restore the board' : 'Maximise'} (Alt+M)`} data-testid={`terminal-max-${index}`}>
                <UIcon name={maximised ? 'collapse' : 'expand'} size={14} gold={false} />
              </button>
            )}
            {!isPhone && (
              <button type="button" className={styles.panelAct} onClick={onDuplicate} aria-keyshortcuts="Alt+C"
                aria-label={`Duplicate panel ${index + 1}`} title="Duplicate (Alt+C)" data-testid={`terminal-dup-${index}`}>
                <UIcon name="copy" size={14} gold={false} />
              </button>
            )}
            {!isPhone && r.state === 'ready' && !panel.popout && (
              <button type="button" className={styles.panelAct} onClick={onPopout}
                aria-label={`Pop out panel ${index + 1}`} title="Pop out" data-testid={`terminal-popout-${index}`}>
                <UIcon name="popOut" size={14} gold={false} />
              </button>
            )}
            {canClose && (
              <button type="button" className={styles.panelAct} onClick={onClose} aria-keyshortcuts="Alt+X"
                aria-label={`Close panel ${index + 1}`} title="Close (Alt+X)" data-testid={`terminal-close-${index}`}>
                <UIcon name="x" size={14} gold={false} />
              </button>
            )}
          </span>
        )}
      </header>
      <div className={`${styles.panelBody} ${flush && !panel.popout ? styles.panelBodyFlush : ''}`}
        data-inset={flush && !panel.popout ? 'flush' : 'inset'} data-testid={`terminal-body-${index}`}>
        {panel.popout && (
          <PanelState kind="paused" testId={`terminal-popped-${index}`}
            title={`${panel.code} is open in its own window.`}
            action={<button type="button" className={styles.chip} onClick={onBringBack}>Bring it back</button>} />
        )}
        {Comp && (
          <ErrorBoundary key={identity} fallback={<div className={styles.panelState}><PanelCrashed code={panel.code} /></div>}>
            {/* V8: a fresh Provider per panel identity (same key as the ErrorBoundary above) so
                switching security/args clears a stale badge rather than carrying the previous
                security's freshness into the next one's loading state. */}
            <PanelFreshnessContext.Provider value={setFreshness} key={identity}>
              <TerminalPanelContext.Provider value={frame}>
                {/* ONE loading treatment: the same skeleton a panel shows while its own data
                    loads (components/terminal/PanelSkeleton), never a "Loading CODE..." line
                    followed by a second, different loader. */}
                <Suspense fallback={<PanelSkeleton label={`Loading ${panel.code}`} shape={flush ? 'chart' : 'rows'}
                  testId={`terminal-loading-${index}`} />}>
                  {r.name === 'Help'
                    ? <Comp {...r.props} onRun={onRun} onRows={rowsProp} {...helpProps} auth={auth} />
                    : COMMAND_PANELS.has(r.name)
                      ? <Comp sym={r.sym || undefined} {...(r.variant.props || {})} {...r.props} onRun={onRun} onRows={rowsProp} />
                      : <Comp sym={r.sym || undefined} {...(r.variant.props || {})} {...r.props} />}
                </Suspense>
              </TerminalPanelContext.Provider>
            </PanelFreshnessContext.Provider>
          </ErrorBoundary>
        )}
        {!panel.popout && r.state === 'needs-ticker' && (
          <PanelState kind="input" title={`${panel.code} needs a ticker.`}>
            Type one first, e.g. <kbd>NVDA {panel.code}</kbd>
          </PanelState>
        )}
        {!panel.popout && r.state === 'disabled' && (
          <PanelState kind="locked" title={`${panel.code} is not enabled for your account yet.`} />
        )}
        {!panel.popout && r.state === 'unknown' && (
          <PanelState kind="empty" title={`Unknown function ${panel.code}.`}>
            Type <kbd>HELP</kbd> for the list.
          </PanelState>
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
  const commandHistory = useCommandHistory()
  const [notice, setNotice] = useState(null)
  const [sheet, setSheet] = useState(null)           // 'functions' | 'boards' | 'recents' | null
  const [boardsOpenToVersions, setBoardsOpenToVersions] = useState(false)
  // Keyed by the panel's STABLE `id` (never a positional index): `onClose`/`onDuplicate`/
  // `undoClose`/`setCount` all reshuffle `layout.panels`, and this popover is non-modal, so a
  // click can land long after a close/duplicate shifted every index behind it. Resolving by id
  // at click time means a closed panel's menu just stops matching anything (closes, no-ops)
  // instead of silently relinking whatever panel now sits at the old index.
  const [channelMenu, setChannelMenu] = useState(null) // { panelId, anchor }
  // Reorder (daily-use leftover #2). Same id-keyed rule as the channel menu: a move resolves the
  // panel by its STABLE id at the moment it lands, never by an index captured earlier.
  const [moveMenu, setMoveMenu] = useState(null)       // { panelId, anchor }
  const [dragId, setDragId] = useState(null)           // the panel being dragged
  const [dropAt, setDropAt] = useState(null)           // the slot it would land in
  const [functionRecents, setFunctionRecents] = useState(() => readFunctionRecents())
  // Maximise is a VIEW state, never saved to the board: the focused panel fills the grid and
  // the others stay mounted and hidden (as on a phone), so restoring reloads nothing.
  const [zoomed, setZoomed] = useState(false)
  const inputRef = useRef(null)
  const layoutRef = useRef(layout)
  layoutRef.current = layout
  const symsRef = useRef(syms)
  symsRef.current = syms
  const libraryRef = useRef(library)
  libraryRef.current = library
  // The member's OWN board from before the first board was opened (not the previous board:
  // opening a preset then another leaves "Back to my layout" pointing at the member's layout).
  const previousRef = useRef(undefined)
  if (previousRef.current === undefined) previousRef.current = readRevert()
  const [hasRevert, setHasRevert] = useState(() => !!previousRef.current)
  const [currentBoard, setCurrentBoard] = useState(null)
  // Every run gets a number; an async answer (an address resolve, a sector lookup, an alias
  // save) acts only if no later run — and no unmount — happened since (audit #12).
  const runSeqRef = useRef(0)
  useEffect(() => () => { runSeqRef.current += 1 }, [])

  const popoutToken = useMemo(() => new URLSearchParams(location.search).get('popout'), [location.search])
  const popoutPanel = useMemo(() => (popoutToken ? decodePopout(popoutToken) : null), [popoutToken])

  const count = layout.count
  const focus = Math.min(layout.focus, count - 1)
  const libraryWritable = libraryStatus !== 'unreadable' && libraryStatus !== 'newer'

  // The focused panel's numbered list (row <GO>): the command strings it published.
  // Tagged with the publishing panel (`rowsOwner`), so row <GO> never runs a stale list.
  const rowsRef = useRef({ owner: null, rows: [] })
  // `loadSecurity` is declared after `run` (it falls back to it), so `run`'s row <GO> reaches it here.
  const loadSecurityRef = useRef(null)
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
  // A route change the shell itself started (into or out of the calendar): until the router
  // lands on it, the URL write-back must not act on the location it is leaving — a render
  // from the board save can commit first, and writing then would undo the navigation.
  const pendingNavRef = useRef(null)

  const openCalendarPath = useCallback((extra) => {
    const p = new URLSearchParams(location.search)
    p.delete('cmd')   // the calendar owns this URL; a stale shell command must not ride along
    // `null` removes a param (`CAL TODAY` clears `?week=` back to the current week).
    for (const [k, v] of Object.entries(extra || {})) { if (v == null) p.delete(k); else p.set(k, v) }
    const q = p.toString()
    if (location.pathname !== TERMINAL_CALENDAR_PATH || extra) {
      pendingNavRef.current = TERMINAL_CALENDAR_PATH
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
    if (!previousRef.current) {
      previousRef.current = { layout: layoutRef.current, syms: symsRef.current }
      writeRevert(previousRef.current)
      setHasRevert(true)
    }
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
    writeRevert(null)
    setHasRevert(false)
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
  const run = useCallback((text, { fromUrl = false, slot = null } = {}) => {
    const raw = normalizeInput(text)
    setNotice(null)
    const seq = ++runSeqRef.current
    const current = () => seq === runSeqRef.current
    // A command that ARRIVED in the URL (a link, the palette, back/forward) and leaves the
    // shell REPLACES that entry, so Back does not land on it and bounce forward again.
    const go = (to) => (fromUrl ? navigate(to, { replace: true }) : navigate(to))
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
        loadAliases()
        if (!current()) return
        setNotice({ kind: 'info', text: cmd.type === 'alias-define'
          ? `Saved alias ${cmd.name} = ${cmd.expansion}` : `Removed alias ${cmd.name}.` })
      }).catch((err) => {
        if (!current()) return
        setNotice({ kind: 'error', text: aliasFailure(cmd, err?.status) })
      })
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
      // A `$SYM` row (MOST's list) LOADS the name into the linked group and keeps every
      // panel's function, exactly as clicking that row does — it never turns the list into DES.
      if (!fromUrl && isLoadRow(target) && loadSecurityRef.current) return loadSecurityRef.current(target)
      return run(target, { fromUrl })
    }
    countCommand(cmd)
    if (cmd.type === 'ask') {
      go(`/ai-search?q=${encodeURIComponent(cmd.question)}`)
      return null
    }
    if (cmd.type === 'address') {
      if (auth.addressSpaceEnabled !== true) {
        setNotice({ kind: 'error', text: `Saved-item addresses (${cmd.address}) are not enabled for your account yet.` })
        return null
      }
      jsonFetcher(`/api/address/resolve?a=${encodeURIComponent(cmd.address)}`)
        .then((row) => {
          if (!current()) return            // the member moved on: a late answer goes nowhere
          if (row?.to) go(row.to)
          else setNotice({ kind: 'error', text: `Nothing at ${cmd.address}.` })
        })
        .catch(() => { if (current()) setNotice({ kind: 'error', text: `Nothing at ${cmd.address} that you can open.` }) })
      return null
    }

    // A per-ticker preset (V14): a bare ticker opens the member's board for it.
    if (isBareTicker(raw, cmd)) {
      const board = presetFor(libraryRef.current, cmd.sym)
      if (board) { openNamed(board, { sym: cmd.sym }); return null }
    }

    const cur = layoutRef.current
    let at = Math.min(cur.focus, cur.count - 1)
    // A URL command names the panel SLOT it was showing in (`&p=N`): back/forward puts the
    // command back where it was, not into whichever panel is focused now. A slot this board
    // no longer shows falls back to the focused panel.
    if (!cmd.channel && Number.isInteger(slot) && slot >= 1 && slot <= cur.count) at = slot - 1
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
    // Recents record a function that RAN (round 3): every refusal below returns before `ran()`.
    const ran = () => setFunctionRecents(pushFunctionRecent(cmd.code))
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
      ran()
      // V18: vs sector — the server resolves the security's sector ETF, then the SAME door.
      setNotice({ kind: 'info', text: `Finding ${sym}'s sector ETF…` })
      jsonFetcher(`/api/terminal/compare-target?sym=${encodeURIComponent(sym)}&mode=sector`)
        .then((d) => {
          if (!current()) return            // the member moved on: a late answer goes nowhere
          const to = d?.comparator ? fillDoor(variant.door, { sym, args: [d.comparator] }) : null
          if (to) go(to)
          else setNotice({ kind: 'error', text: `No sector ETF is known for ${sym}; try ${sym} CMP XLK.` })
        })
        .catch((err) => {
          if (!current()) return
          // "Not switched on here" and "the lookup failed" are not "there is no sector ETF".
          setNotice({ kind: 'error', text: err?.status === 404
            ? `Comparing with a sector ETF is not enabled on this server yet; try ${sym} CMP XLK.`
            : `Could not look up ${sym}'s sector ETF just now; try again, or ${sym} CMP XLK.` })
        })
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
      // …and the same for a TICKER a market-wide door cannot carry (`NVDA DASH`): say so, and
      // let the member open it without the ticker in one click.
      if (ignoredTicker) {
        setNotice({ kind: 'error', text: `${cmd.code} is market-wide; ${cmd.sym} is ignored.`,
          actions: [{ label: `Open ${cmd.code} without ${cmd.sym}`, id: 'go', to }] })
        return null
      }
      ran()
      go(to)
      return null
    }
    const name = panelNameFor(variant)
    if (!name) {
      setNotice({ kind: 'error', text: `${cmd.code} has no panel on this release.` })
      return null
    }
    ran()
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
      // The function's label, never the panel's internal name (`surfaceScreener`, round 3).
      redirectedFrom && `${BY_CODE[cmd.code].label} is already open in panel ${target + 1}; @${redirectedFrom} was redirected there instead of opening a second copy.`,
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

  // Round 3: the ref holds the panel text the typed command PUT on screen (null when it opened
  // nothing). It used to be a bare `true` that a refused command left set, so the member's next
  // panel click or count change became a Back-button entry.
  /** Shift+Enter on a bare ticker: load it into the focused panel's group and KEEP every
   *  panel's function (a plain Enter turns the focused panel into DES). Anything that is not a
   *  bare ticker runs exactly as Enter would. */
  const loadSecurity = useCallback((text) => {
    const raw = normalizeInput(text)
    const cmd = parseCommand(raw, { aliases: aliasesRef.current })
    if (!isBareTicker(raw, cmd)) return run(text)
    setNotice(null)
    runSeqRef.current += 1
    const cur = layoutRef.current
    const at = Math.min(cur.focus, cur.count - 1)
    const p = cur.panels[at]
    const sym = cmd.sym
    if (isLinkable(p) && !panelChannel(p)) {
      const panels = cur.panels.slice()
      panels[at] = { ...p, sym }
      save({ ...cur, panels })
      setNotice({ kind: 'info', text: `Loaded ${sym} in panel ${at + 1}, which is not linked; it stays on ${p.code}.` })
      return null
    }
    const ch = isLinkable(p) ? panelChannel(p) : activeChannelOf(cur)
    save(commitChannelSym(cur, ch, sym))
    const following = cur.panels.slice(0, cur.count)
      .map((q, i) => (isLinkable(q) && panelChannel(q) === ch ? i + 1 : null)).filter(Boolean)
    const name = channelOf(cur, ch)?.name || `group ${ch}`
    setNotice({ kind: 'info', text: following.length
      ? `Loaded ${sym} into ${name}: panel${following.length > 1 ? 's' : ''} ${following.join(', ')} kept ${following.length > 1 ? 'their functions' : 'its function'}.`
      : `Loaded ${sym} into ${name}; no panel on screen follows that group yet.` })
    return null
  }, [run, save, commitChannelSym])
  loadSecurityRef.current = loadSecurity

  const runTyped = useCallback((text, opts) => {
    userRunRef.current = null
    const out = opts?.keepFunction ? loadSecurity(text) : run(text)
    userRunRef.current = out || null
    return out
  }, [run, loadSecurity])

  // ── V6d: EVERY COMMAND IS A URL ──────────────────────────────────────────────
  // `?cmd=` reflects the focused panel. An arriving `?cmd=` (a link, a palette pick, back/
  // forward) runs; the shell then writes the focused panel's command back. ⛔ H14: each
  // effect writes only when the URL and the panel DISAGREE; a pending URL command blocks the
  // write-back until its panel has caught up; a URL-owning panel (the calendar) is never
  // written over; and a write budget stops any ping-pong cold.
  const runRef = useRef(run)
  runRef.current = run
  //
  // `&p=N` (audit #3) names the panel slot the command was showing in, so back/forward puts
  // an old command back into ITS panel, not whichever one is focused now. Written only on a
  // board of two or more panels (a one-panel board has nowhere else to put it).
  const urlCmdRef = useRef(undefined)      // the last `?cmd=`+slot key acted on or written
  const pendingRef = useRef(null)          // the panel text an arriving URL command will show
  const urlJustRanRef = useRef(false)      // an arriving URL command ran in this commit
  const writesRef = useRef([])
  const urlSyncTrippedRef = useRef(false) // H14: true once the write-budget notice has fired
  const [syncTick, setSyncTick] = useState(0)   // re-runs the write-back once the budget frees
  const syncTimerRef = useRef(null)
  useEffect(() => () => clearTimeout(syncTimerRef.current), [])
  const urlParams = new URLSearchParams(location.search)
  const urlCmd = urlParams.get('cmd')
  const urlSlot = /^[1-9]$/.test(urlParams.get('p') || '') ? Number(urlParams.get('p')) : null
  const urlKey = urlCmd ? `${urlCmd}\u0000${urlSlot ?? ''}` : null
  // A pop-out window is one frozen panel: it neither runs nor writes `?cmd=`.
  useEffect(() => {
    if (loading || popoutToken || !urlKey || urlKey === urlCmdRef.current) return
    urlCmdRef.current = urlKey
    urlJustRanRef.current = true
    pendingRef.current = runRef.current(urlCmd, { fromUrl: true, slot: urlSlot }) || null
  }, [loading, popoutToken, urlKey, urlCmd, urlSlot])

  const focusedPanel = layout.panels[focus]
  const focusedText = panelCommandText(focusedPanel, syms)
  const focusedOwnsUrl = URL_OWNING_PANELS.has(resolvePanel(focusedPanel, syms, auth).name)
  const wantSlot = count > 1 ? focus + 1 : null
  useEffect(() => {
    const justRan = urlJustRanRef.current
    urlJustRanRef.current = false
    if (loading || popoutToken) return
    if (pendingNavRef.current) {
      if (location.pathname !== pendingNavRef.current) return
      pendingNavRef.current = null
    }
    if (pendingRef.current && pendingRef.current !== focusedText) return
    pendingRef.current = null
    const writeUrl = (mutate, replace) => {
      const p = new URLSearchParams(location.search)
      mutate(p)
      const q = p.toString()
      navigate({ pathname: location.pathname, search: q ? `?${q}` : '', hash: location.hash }, { replace })
    }
    if (focusedOwnsUrl || !focusedText) {
      userRunRef.current = null
      // Audit #1: a URL-owning panel (the calendar) never carries ANOTHER panel's `?cmd=` —
      // left there, a reload replayed that command INTO the calendar. Drop it, in place.
      // (Not in the commit an arriving command ran in: its own navigation is still landing.)
      if (focusedOwnsUrl && urlCmd != null && !justRan) {
        urlCmdRef.current = undefined
        writeUrl((p) => { p.delete('cmd'); p.delete('p') }, true)
      }
      return
    }
    const key = `${focusedText}\u0000${wantSlot ?? ''}`
    if (urlKey === key) { urlCmdRef.current = urlKey; userRunRef.current = null; return }
    const now = Date.now()
    writesRef.current = writesRef.current.filter((t) => now - t < URL_WRITE_WINDOW_MS)
    if (writesRef.current.length >= URL_WRITE_BUDGET) {
      console.warn('[terminal] ?cmd= write budget spent; URL sync paused (H14)')
      // H14: console.warn alone is invisible to the member — bookmarking/back/forward/copy-link
      // go stale with zero signal. Say so once, ACCURATELY: the budget is a sliding window, so
      // the address bar catches up by itself, and the trailing write below makes that true.
      if (!urlSyncTrippedRef.current) {
        urlSyncTrippedRef.current = true
        setNotice({ kind: 'info', id: 'url-sync',
          text: 'The address bar paused for a moment (your panels changed very fast). It catches up with the focused panel by itself.' })
      }
      clearTimeout(syncTimerRef.current)
      const wait = Math.max(50, URL_WRITE_WINDOW_MS - (now - writesRef.current[0]) + 50)
      syncTimerRef.current = setTimeout(() => setSyncTick((n) => n + 1), wait)
      return
    }
    writesRef.current.push(now)
    urlCmdRef.current = key
    const push = userRunRef.current != null && userRunRef.current === focusedText
    userRunRef.current = null
    writeUrl((p) => {
      p.set('cmd', focusedText)
      if (wantSlot) p.set('p', String(wantSlot)); else p.delete('p')
    }, !push)
    if (urlSyncTrippedRef.current) {
      // Caught up: the next trip may say so again, and the pause notice is no longer true.
      urlSyncTrippedRef.current = false
      setNotice((n) => (n?.id === 'url-sync' ? null : n))
    }
  }, [loading, popoutToken, focusedOwnsUrl, focusedText, wantSlot, urlKey, urlCmd, location.pathname, location.search, location.hash, navigate, syncTick])

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
    // Audit #4: an EMPTY slot (a panel showing nothing this build knows) takes the calendar
    // first; otherwise the focused panel does — but what it showed goes on the undo list and
    // the member is told, with an Undo, instead of losing it in silence.
    const empty = visible.findIndex((p) => !BY_CODE[p.code])
    const f = empty >= 0 ? empty : Math.min(cur.focus, cur.count - 1)
    const panels = cur.panels.slice()
    const replaced = panels[f]
    panels[f] = { ...replaced, code: 'CAL', args: [] }
    if (empty >= 0 || !BY_CODE[replaced.code]) { save({ ...cur, focus: f, panels }); return }
    const { popout: _p, ...kept } = replaced
    const closed = [{ panel: kept, index: f }, ...cur.closed].slice(0, CLOSED_MAX)
    save({ ...cur, focus: f, panels, closed })
    setNotice({ kind: 'info', text: `Opened the calendar in panel ${f + 1}, in place of ${panelCommandText(replaced, symsRef.current) || replaced.code}.`,
      actions: [{ label: 'Undo', id: 'undo-calendar', panelId: replaced.id, panel: kept }] })
  }, [loading, location.pathname, save])

  // The way back out: once a board that showed the calendar no longer does (its panel now runs
  // another command, or was closed), leave `/terminal/calendar` and drop the calendar's own
  // params. Left there, `?earnings=` kept the earnings window open over every later command and
  // re-opened it on reload, and a reload re-mounted the calendar over the member's panel.
  // Only a transition from "had a calendar" counts, so the arrival above (which adds the
  // calendar one commit later) never reads as a departure.
  const hadCalendarRef = useRef(false)
  useEffect(() => {
    if (loading || popoutToken) return
    const hasCal = layout.panels.slice(0, layout.count).some((p) => isCalendarCode(p.code))
    if (hasCal) { hadCalendarRef.current = true; return }
    const had = hadCalendarRef.current
    hadCalendarRef.current = false
    if (!had || location.pathname !== TERMINAL_CALENDAR_PATH || pendingNavRef.current) return
    const p = new URLSearchParams(location.search)
    const kept = new URLSearchParams()
    for (const k of ['cmd', 'p']) { const v = p.get(k); if (v != null) kept.set(k, v) }
    const q = kept.toString()
    pendingNavRef.current = TERMINAL_PATH
    navigate(`${TERMINAL_PATH}${q ? `?${q}` : ''}`, { replace: true })
  }, [loading, popoutToken, layout, location.pathname, location.search, navigate])

  // The tab names the terminal. The shell's per-page titles key off the sidebar, whose entry
  // still points at /calendar, so /terminal was left with the coming-soon page's title. The
  // title it found is put back on the way out, so the next page is not mislabelled either.
  useEffect(() => {
    const before = document.title
    document.title = brandedTitle('UCT Terminal')
    return () => { document.title = before }
  }, [])

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
    const cur = layoutRef.current
    const res = undoClose(cur)
    if (!res.ok) return
    save(res.layout)
    // Round 3: on a full board the re-opened panel pushes the last one OFF the board (it stays
    // in the layout, unseen). That used to happen in silence — say where each one went.
    const back = res.layout.panels[res.layout.focus]
    const parked = cur.count >= MAX_VISIBLE ? cur.panels[cur.count - 1] : null
    setNotice({ kind: 'info', text: `Re-opened ${back.code} in panel ${res.layout.focus + 1}.${parked
      ? ` ${parked.code} moved off the board to make room; close a panel to bring it back.` : ''}` })
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
  /** Save the board on screen. Returns what was said, so the Boards sheet (which covers the
   *  notice line) can show it too (round 3). */
  const onSaveBoard = (name) => {
    const res = saveBoard(library, name, layout, syms)
    let said
    if (!res.ok) {
      said = { kind: 'error', text: res.reason === 'full' ? 'You have the most saved boards allowed. Delete one first.' : 'Name the board first.' }
    } else if (!saveLibrary(res.library)) {
      // Round 3: an unreadable library is never written over — and that used to be silent.
      said = { kind: 'error', text: 'Your saved boards could not be read, so this board was not saved. Open Boards, then Version history, to restore them.' }
    } else {
      const replaced = library.boards.some((b) => b.id === res.board.id)
      setCurrentBoard(res.board.name)
      said = { kind: 'info', text: `${replaced ? `Replaced your board ${res.board.name} with this one` : `Saved as ${res.board.name}`} — open it any time with B:${res.board.slug}.` }
    }
    setNotice(said)
    return said
  }
  /** Undo the calendar that `/terminal/calendar` put over a panel (audit #4): the panel comes
   *  back where it was, off the closed list, and the shell leaves the calendar route. */
  const onUndoCalendar = (a) => {
    const cur = layoutRef.current
    const i = cur.panels.findIndex((p) => p.id === a.panelId)
    if (i < 0 || !isCalendarCode(cur.panels[i].code)) { setNotice(null); return }
    const panels = cur.panels.slice()
    panels[i] = { ...a.panel, id: a.panelId }
    const at = cur.closed.findIndex((c) => c.panel.id === a.panelId)
    const closed = at >= 0 ? [...cur.closed.slice(0, at), ...cur.closed.slice(at + 1)] : cur.closed
    const next = { ...cur, focus: Math.min(i, cur.count - 1), panels, closed }
    save(next)
    setNotice(null)
    if (location.pathname === TERMINAL_CALENDAR_PATH) {
      // Leave the calendar's route, already carrying the restored panel's command, so the
      // URL write-back has nothing left to correct.
      const p = new URLSearchParams(location.search)
      const text = panelCommandText(panels[i], symsRef.current)
      if (text) p.set('cmd', text); else p.delete('cmd')
      if (next.count > 1) p.set('p', String(next.focus + 1)); else p.delete('p')
      urlCmdRef.current = text ? `${text}\u0000${next.count > 1 ? next.focus + 1 : ''}` : undefined
      const q = p.toString()
      pendingNavRef.current = TERMINAL_PATH
      navigate(`${TERMINAL_PATH}${q ? `?${q}` : ''}`, { replace: true })
    }
  }
  const noticeAction = (a) => {
    if (a.id === 'undo-close') onUndoClose()
    else if (a.id === 'undo-calendar') onUndoCalendar(a)
    else if (a.id === 'revert') revertLayout()
    else if (a.id === 'save-shared') onSaveBoard(a.name)
    else if (a.id === 'go' && a.to) { navigate(a.to); return }
    // A notice action is a detour: focus goes back to the command line (audit #24).
    if (!isPhone) inputRef.current?.focus()
  }

  // V4: Alt+1..4 focuses that panel — from the command line too (declared inEditable) —
  // and Alt+[ / Alt+] step to the previous / next panel, wrapping around.
  const setFocusRef = useRef(null)
  setFocusRef.current = (i) => {
    if (i < count) { setFocus(i); return }
    // Round 3: Alt+3 on a two-panel board used to do nothing at all.
    setNotice({ kind: 'info', text: `Panel ${i + 1} is not on screen: this board shows ${count}. Choose ${i + 1} panels to add it.` })
  }
  const stepFocusRef = useRef(null)
  stepFocusRef.current = (d) => { if (count > 1) setFocus((focus + d + count) % count) }
  useEffect(() => registerShortcuts({
    'terminal.panel1': (e) => { e.preventDefault(); setFocusRef.current?.(0) },
    'terminal.panel2': (e) => { e.preventDefault(); setFocusRef.current?.(1) },
    'terminal.panel3': (e) => { e.preventDefault(); setFocusRef.current?.(2) },
    'terminal.panel4': (e) => { e.preventDefault(); setFocusRef.current?.(3) },
    'terminal.panelPrev': (e) => { e.preventDefault(); stepFocusRef.current?.(-1) },
    'terminal.panelNext': (e) => { e.preventDefault(); stepFocusRef.current?.(1) },
  }), [])

  // Daily-use keys (2026-10-06): every panel action and both sheets, one keystroke each. The
  // handlers live in a ref so the ONE registration always calls today's closures. A panel
  // action never fires under an open sheet (it would change the board behind a modal), and a
  // pop-out window has no board to change.
  const keyActionsRef = useRef({})
  useEffect(() => {
    const act = (name) => (e) => {
      e.preventDefault()
      keyActionsRef.current[name]?.()
    }
    return registerShortcuts({
      'terminal.panelMoveLeft': act('moveLeft'),
      'terminal.panelMoveRight': act('moveRight'),
      'terminal.panelMaximise': act('maximise'),
      'terminal.panelClose': act('close'),
      'terminal.panelUndoClose': act('undoClose'),
      'terminal.panelDuplicate': act('duplicate'),
      'terminal.panelLink': act('link'),
      'terminal.boards': act('boards'),
      'terminal.recents': act('recents'),
      'terminal.keys': act('keys'),
      'terminal.count1': act('count1'),
      'terminal.count2': act('count2'),
      'terminal.count3': act('count3'),
      'terminal.count4': act('count4'),
    })
  }, [])
  useEffect(() => { if (count <= 1) setZoomed(false) }, [count])

  // ── pop-outs (audit #23): the board learns when a member closes the window THEMSELVES,
  // and a pop-out's HELP / MOVE rows run in THIS shell (one BroadcastChannel, same origin).
  const runTypedRef = useRef(runTyped)
  runTypedRef.current = runTyped
  const unPopById = useCallback((panelId) => {
    delete popoutWindowsRef.current[panelId]
    const cur = layoutRef.current
    const i = cur.panels.findIndex((p) => p.id === panelId)
    if (i >= 0 && cur.panels[i].popout) save(setPopout(cur, i, false))
  }, [save])
  useEffect(() => {
    if (popoutToken) return undefined
    const bus = openPopoutBus()
    if (bus) {
      bus.onmessage = (ev) => {
        const m = ev?.data || {}
        if (m.type === 'run' && typeof m.text === 'string') {
          try { window.focus() } catch { /* */ }
          runTypedRef.current(m.text)
        } else if (m.type === 'closed' && typeof m.id === 'string') unPopById(m.id)
      }
    }
    const poll = setInterval(() => {
      for (const [id, win] of Object.entries(popoutWindowsRef.current)) {
        if (!win || win.closed) unPopById(id)
      }
    }, 1000)
    return () => { clearInterval(poll); try { bus?.close() } catch { /* */ } }
  }, [popoutToken, unPopById])
  useEffect(() => {
    if (!popoutToken) return undefined
    const id = String(window.name || '').replace(/^uct-terminal-/, '')
    const onHide = () => {
      const bus = openPopoutBus()
      try { bus?.postMessage({ type: 'closed', id }); bus?.close() } catch { /* */ }
    }
    window.addEventListener('pagehide', onHide)
    return () => window.removeEventListener('pagehide', onHide)
  }, [popoutToken])
  const popoutRun = useMemo(() => {
    if (!popoutToken || typeof BroadcastChannel !== 'function') return undefined
    return (text) => {
      const bus = openPopoutBus()
      try { bus?.postMessage({ type: 'run', text: String(text) }); bus?.close() } catch { /* */ }
    }
  }, [popoutToken])

  const toggleSheet = (name) => {
    setBoardsOpenToVersions(false)
    setSheet((cur) => (cur === name ? null : name))
  }
  const panelKey = (fn) => () => { if (!popoutToken && !sheet) fn() }
  const focusedName = layout.panels[focus]?.code || 'This panel'
  const onMovePanel = (d) => {
    const res = movePanel(layout, focus, d)
    if (!res.ok) {
      setNotice({ kind: 'info', text: count < 2 ? 'This board shows one panel: there is nowhere to move it.'
        : `${focusedName} is already the ${d < 0 ? 'first' : 'last'} panel.` })
      return
    }
    save(res.layout)
    setNotice({ kind: 'info', text: `Moved ${focusedName} to panel ${res.to + 1}.` })
  }
  /** Move the panel with this id to visible slot `to` (drag-and-drop, the Move menu, or ←/→ on
   *  its handle). Saved like any other board change; focus follows the panel. */
  const onReorder = (panelId, to, { refocusGrip = false } = {}) => {
    const cur = layoutRef.current
    const from = cur.panels.slice(0, cur.count).findIndex((p) => p.id === panelId)
    if (from < 0) return
    const res = reorderPanel(cur, from, to)
    if (!res.ok) {
      if (to < 0 || to >= cur.count) {
        setNotice({ kind: 'info', text: `${cur.panels[from].code} is already the ${to < 0 ? 'first' : 'last'} panel.` })
      }
      return
    }
    save(res.layout)
    setNotice({ kind: 'info', text: `Moved ${cur.panels[from].code} to panel ${res.to + 1}.` })
    if (refocusGrip) {
      // Keyboard moves keep focus on the same handle, wherever its panel now sits.
      const id = String(panelId).replace(/["\\]/g, '')
      requestAnimationFrame(() => document.querySelector(`[data-grip-id="${id}"]`)?.focus())
    }
  }
  const PANEL_DRAG_TYPE = 'application/x-uct-terminal-panel'
  const reorderFor = (p, i) => {
    if (popoutToken || count < 2) return null
    const draggedId = (e) => dragId || e?.dataTransfer?.getData?.(PANEL_DRAG_TYPE) || null
    return {
      canMove: true,
      dragging: dragId === p.id,
      dropTarget: dragId != null && dragId !== p.id && dropAt === i,
      onDragStart: (e) => {
        try {
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData(PANEL_DRAG_TYPE, p.id)
          e.dataTransfer.setData('text/plain', panelCommandText(p, syms) || p.code)
        } catch { /* a browser that refuses dataTransfer still has dragId */ }
        setDragId(p.id)
      },
      onDragEnd: () => { setDragId(null); setDropAt(null) },
      onDragOver: (e) => {
        if (!dragId) return
        e.preventDefault()
        try { e.dataTransfer.dropEffect = 'move' } catch { /* */ }
        if (dropAt !== i) setDropAt(i)
      },
      onDragLeave: (e) => {
        if (dropAt === i && !e.currentTarget.contains(e.relatedTarget)) setDropAt(null)
      },
      onDrop: (e) => {
        const id = draggedId(e)
        setDragId(null)
        setDropAt(null)
        if (!id) return
        e.preventDefault()
        onReorder(id, i)
      },
      onMenu: (e) => {
        const r = e.currentTarget.getBoundingClientRect?.() || { left: 0, bottom: 0 }
        setMoveMenu({ panelId: p.id, anchor: { x: r.left, y: r.bottom + 4 } })
      },
      onKeyDown: (e) => {
        const d = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key]
        if (d === undefined || e.altKey || e.ctrlKey || e.metaKey) return
        e.preventDefault()
        e.stopPropagation()
        onReorder(p.id, i + d, { refocusGrip: true })
      },
    }
  }
  const onMaximise = (i = focus) => {
    if (isPhone) return
    if (count < 2) { setNotice({ kind: 'info', text: 'This board shows one panel, so it is already full size.' }); return }
    if (zoomed && i === focus) { setZoomed(false); return }
    if (i !== focus) setFocus(i)
    setZoomed(true)
  }
  const onLinkNext = () => {
    const next = nextLinkChannel(layout, focus)
    if (next === undefined) {
      setNotice({ kind: 'info', text: `${focusedName} does not follow a security, so it has no group to change.` })
      return
    }
    const shown = panelSym(layout.panels[focus], syms)
    save(setPanelChannel(layout, focus, next, syms))
    const ch = next ? channelOf(layout, next) : null
    setNotice({ kind: 'info', text: ch
      ? `Panel ${focus + 1} now follows ${ch.name}${syms[next] ? ` (${syms[next]})` : ''}.`
      : `Panel ${focus + 1} is not linked now${shown ? `; it keeps ${shown}` : ''}.` })
  }
  keyActionsRef.current = {
    moveLeft: panelKey(() => onMovePanel(-1)),
    moveRight: panelKey(() => onMovePanel(1)),
    maximise: panelKey(() => onMaximise()),
    close: panelKey(() => {
      if (count <= 1) { setNotice({ kind: 'info', text: 'The last panel on a board cannot close.' }); return }
      onClose(focus)
    }),
    undoClose: panelKey(() => {
      if (!layout.closed.length) { setNotice({ kind: 'info', text: 'Nothing to re-open: no panel has been closed on this board.' }); return }
      onUndoClose()
    }),
    duplicate: panelKey(() => onDuplicate(focus)),
    // The panel-count key (Alt+Shift+1..4): the bar's 1-4 buttons, from the keyboard, and it
    // says the count it set (or that the board already shows that many).
    ...Object.fromEntries(PANEL_COUNTS.map((n) => [`count${n}`, panelKey(() => {
      const plural = `${n} panel${n === 1 ? '' : 's'}`
      if (n === count) { setNotice({ kind: 'info', text: `This board already shows ${plural}.` }); return }
      setCount(n)
      setNotice({ kind: 'info', text: `This board now shows ${plural}.` })
    })])),
    link: panelKey(onLinkNext),
    boards: () => { if (!popoutToken) toggleSheet('boards') },
    recents: () => { if (!popoutToken) toggleSheet('recents') },
    keys: () => { if (!popoutToken) toggleSheet('keys') },
  }

  const railGroups = useMemo(() => FUNCTION_GROUPS.map((g) => ({
    g, fns: FUNCTIONS.filter((f) => f.group === g),
  })), [])
  const focusedCode = layout.panels[focus]?.code
  const recentTickers = useMemo(() => recentSecurities(layout, 8), [layout])
  const helpProps = { onResetRanking: resetRanking, hasStats: Object.keys(stats).length > 0 }
  const guarded = layoutStatus === 'unreadable' || layoutStatus === 'newer'

  // ── a popped-out panel: one frozen panel, no board, nothing written ──
  if (popoutToken) {
    return (
      <div className={styles.shell} data-testid="terminal-popout">
        <div className={styles.grid} data-count="1">
          {popoutPanel ? (
            <Panel index={0} panel={popoutPanel} focused={false} syms={{}} auth={auth} channel={null}
              onFocus={() => {}} onRun={popoutRun} standalone isPhone={isPhone} />
          ) : (
            <div className={styles.popoutMissing}>
              <PanelState kind="error" role="status" title="This pop-out link could not be read." />
            </div>
          )}
        </div>
      </div>
    )
  }

  const visible = layout.panels.slice(0, count)
  const zoom = zoomed && !isPhone && count > 1
  const panelDomId = (p) => `terminal-panel-body-${p.id}`
  // ARIA tabs: ←/→ (and Home/End) move between panel tabs, with ONE Tab stop (roving tabindex).
  const onSwitcherKey = (e) => {
    const n = visible.length
    if (n < 2) return
    const to = { ArrowRight: (focus + 1) % n, ArrowLeft: (focus - 1 + n) % n, Home: 0, End: n - 1 }[e.key]
    if (to === undefined) return
    e.preventDefault()
    setFocus(to)
    e.currentTarget.querySelectorAll('[role="tab"]')[to]?.focus()
  }
  const moveFrom = moveMenu ? visible.findIndex((q) => q.id === moveMenu.panelId) : -1
  const movePanelRec = moveFrom >= 0 ? visible[moveFrom] : null
  const menuPanelId = channelMenu?.panelId
  const menuPanel = menuPanelId != null ? layout.panels.find((p) => p.id === menuPanelId) || null : null
  const activeId = activeChannelOf(layout)
  // The notice line. It renders in the page flow under the bar — EXCEPT while a sheet is open:
  // a Sheet is a modal portal over the page, so a notice raised from inside one (a board saved,
  // a group retargeted from Recents) used to land underneath it, unseen. While a sheet is open
  // the same notice renders at the top of that sheet instead. One element, one place at a time.
  const noticeEl = notice ? (
        <div className={`${styles.notice} ${notice.kind === 'error' ? styles.noticeError : ''}`} role={notice.kind === 'error' ? 'alert' : 'status'} data-testid="terminal-notice">
          <span>{notice.text}</span>
          {notice.suggestions?.length > 0 && (
            <span className={styles.noticeSuggest}>
              Did you mean
              {notice.suggestions.map((c) => (
                <button key={c} type="button" className={styles.chip}
                  onClick={() => { runTyped(notice.sym ? `${notice.sym} ${c}` : c); if (!isPhone) inputRef.current?.focus() }}>{c}</button>
              ))}
            </span>
          )}
          {notice.actions?.map((a) => (
            <button key={a.id} type="button" className={styles.chip} onClick={() => noticeAction(a)}
              data-testid={`terminal-notice-${a.id}`}>{a.label}</button>
          ))}
          <button type="button" className={styles.noticeClose} onClick={() => setNotice(null)} aria-label="Dismiss">
            <UIcon name="x" size={14} gold={false} />
          </button>
        </div>
  ) : null
  return (
    <div className={styles.shell} data-phone={isPhone ? 'true' : 'false'} data-density={layout.density}
      data-testid="terminal-shell">
      <div className={styles.bar}>
        <L0Strip layout={layout} isPhone={isPhone} />
        <CommandLine onSubmit={runTyped} inputRef={inputRef} aliases={aliases} stats={stats} boards={library.boards}
          recentTickers={recentTickers} history={commandHistory.history} onHistory={commandHistory.push} />
        {isPhone && (
          <button type="button" className={styles.barBtn} onClick={() => setSheet('functions')} data-testid="terminal-fn-button">
            Functions
          </button>
        )}
        <button type="button" className={styles.barBtn} onClick={() => setSheet('recents')} data-testid="terminal-recents-button"
          aria-keyshortcuts="Alt+R" title="Recents (Alt+R)">
          Recents
        </button>
        <button type="button" className={styles.barBtn} onClick={() => setSheet('boards')} data-testid="terminal-boards-button"
          aria-keyshortcuts="Alt+O" title="Boards (Alt+O)">
          {currentBoard ? `Board: ${currentBoard}` : 'Boards'}
        </button>
        {!isPhone && layout.closed.length > 0 && (
          <button type="button" className={styles.barBtn} onClick={onUndoClose} data-testid="terminal-undo-close"
            aria-keyshortcuts="Alt+Z" title={`Re-open ${layout.closed[0].panel.code} (Alt+Z)`}>Undo close</button>
        )}
        {zoom && (
          <button type="button" className={styles.barBtn} onClick={() => { setZoomed(false); inputRef.current?.focus() }}
            data-testid="terminal-restore-board" aria-keyshortcuts="Alt+M" title="Show every panel again (Alt+M)">
            Show all {count} panels
          </button>
        )}
        {hasRevert && (
          <button type="button" className={styles.barBtn} onClick={() => { revertLayout(); if (!isPhone) inputRef.current?.focus() }}
            data-testid="terminal-revert-layout" title="Return to the board you had before you opened one">Back to my layout</button>
        )}
        {!isPhone && (
          <div className={styles.counts} role="group" aria-label="Density">
            {DENSITIES.map((d) => (
              <button key={d} type="button" className={`${styles.barBtn} ${layout.density === d ? styles.barBtnOn : ''}`}
                aria-pressed={layout.density === d} onClick={() => save(setDensity(layout, d))}
                title={`${d[0].toUpperCase()}${d.slice(1)} density`} aria-label={`${d[0].toUpperCase()}${d.slice(1)} density`}
                data-testid={`terminal-density-${d}`}>
                {d === 'comfortable' ? 'Aa' : d === 'compact' ? 'Ab' : 'ab'}
              </button>
            ))}
          </div>
        )}
        {!isPhone && (
          <div className={styles.counts} role="group" aria-label={`Panels: this board shows ${count}`} data-count={count}>
            {PANEL_COUNTS.map((n) => (
              <button
                key={n}
                type="button"
                className={`${styles.barBtn} ${count === n ? styles.barBtnOn : ''}`}
                aria-pressed={count === n}
                onClick={() => setCount(n)}
                aria-label={`Show ${n} panel${n === 1 ? '' : 's'}`}
                aria-keyshortcuts={`Alt+Shift+${n}`}
                title={`Show ${n} panel${n === 1 ? '' : 's'} (Alt+Shift+${n})`}
                data-testid={`terminal-count-${n}`}
              >{n}</button>
            ))}
          </div>
        )}
      </div>
      {isPhone && (
        <div className={styles.phoneBar}>
          <div className={styles.phoneSwitcher} role="tablist" aria-label="Panels" data-testid="terminal-phone-switcher"
            onKeyDown={onSwitcherKey}>
            {visible.map((p, i) => (
              <button
                key={p.id}
                type="button"
                role="tab"
                className={`${styles.barBtn} ${i === focus ? styles.barBtnOn : ''}`}
                aria-selected={i === focus}
                aria-controls={panelDomId(p)}
                tabIndex={i === focus ? 0 : -1}
                onClick={() => setFocus(i)}
                data-testid={`terminal-phone-switch-${i}`}
              >{panelCommandText(p, syms) || p.code}</button>
            ))}
          </div>
          {/* The phone's own way back from a close. The bar's "Undo close" is desktop-only (no room
              beside the command line), and the close notice's Undo is gone once that notice is
              dismissed or replaced — so while anything is on the undo stack, the panel switcher
              carries it, as a short button on the 44px floor. */}
          {layout.closed.length > 0 && (
            <button type="button" className={styles.barBtn} onClick={onUndoClose}
              data-testid="terminal-phone-undo-close"
              aria-label={`Undo close: re-open ${layout.closed[0].panel.code}`}
              title={`Re-open ${layout.closed[0].panel.code}`}>Undo</button>
          )}
          <div className={styles.counts} role="group" aria-label={`Panels: this board shows ${count}`} data-count={count}>
            {PANEL_COUNTS.map((n) => (
              <button
                key={n}
                type="button"
                className={`${styles.barBtn} ${count === n ? styles.barBtnOn : ''}`}
                aria-pressed={count === n}
                onClick={() => setCount(n)}
                aria-label={`Show ${n} panel${n === 1 ? '' : 's'}`}
                aria-keyshortcuts={`Alt+Shift+${n}`}
                title={`Show ${n} panel${n === 1 ? '' : 's'} (Alt+Shift+${n})`}
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
      {!sheet && noticeEl}
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
                    onClick={() => { runTyped(f.code); if (!isPhone) inputRef.current?.focus() }}
                    title={(f.market ? f.market.leavesTerminal : f.ticker?.leavesTerminal) ? `${f.label} (opens a page outside the terminal)` : f.label}
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
        <div className={styles.grid} data-count={isPhone || zoom ? 1 : count} data-maximised={zoom ? 'true' : 'false'}
          data-testid="terminal-grid">
          {/* Phone shows one panel at a time, but the others stay MOUNTED and hidden, so
              switching back does not refetch or reset them. Their SWR polling keeps running. */}
          {visible.map((p, i) => (
              <Panel
                key={p.id}
                hidden={(isPhone || zoom) && i !== focus}
                domId={panelDomId(p)}
                canMaximise={!isPhone && count > 1}
                maximised={zoom && i === focus}
                onMaximise={() => onMaximise(i)}
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
                density={layout.density}
                reorder={reorderFor(p, i)}
              />
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
          { key: 'new', label: 'New group', icon: <UIcon name="plus" size={12} gold={false} />, onClick: () => newChannel(menuPanelId) },
          { key: 'none', label: 'Not linked (keep this security)', icon: <UIcon name="pin" size={12} gold={false} />, onClick: () => pickChannel(menuPanelId, null) },
        ] : []}
      />
      <ContextPopover
        open={!!movePanelRec}
        onClose={() => setMoveMenu(null)}
        anchor={moveMenu?.anchor}
        title={movePanelRec ? `Move ${movePanelRec.code} (panel ${moveFrom + 1})` : 'Move panel'}
        items={movePanelRec ? visible.map((q, k) => ({
          key: q.id,
          label: k === moveFrom ? `Panel ${k + 1} (here now)` : `To panel ${k + 1} (where ${q.code} is now)`,
          icon: String(k + 1),
          onClick: () => { setMoveMenu(null); if (k !== moveFrom) onReorder(movePanelRec.id, k) },
        })) : []}
      />
      <Sheet open={sheet === 'functions'} onClose={() => setSheet(null)} title="Functions" variant="bottom-sheet">
        {noticeEl}
        <HelpPanel onRun={(code) => { setSheet(null); runTyped(code) }} {...helpProps} auth={auth} />
      </Sheet>
      <Sheet open={sheet === 'boards'} onClose={() => { setSheet(null); setBoardsOpenToVersions(false) }} title="Boards">
        {noticeEl}
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
      <Sheet open={sheet === 'keys'} onClose={() => setSheet(null)} title="Keyboard">
        {sheet === 'keys' && (
          <div className={styles.help} data-testid="terminal-keys-sheet">
            <KeysTable />
          </div>
        )}
      </Sheet>
      <Sheet open={sheet === 'recents'} onClose={() => setSheet(null)} title="Recents">
        {noticeEl}
        <RecentsMenu
          layout={layout}
          library={library}
          libraryWritable={libraryWritable}
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

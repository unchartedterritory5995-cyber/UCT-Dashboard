// UCT Terminal — the new shell's chrome: boards in tabs (behind TERMINAL_BOARD_TABS_ENABLED).
//
// Drawn by TerminalShell INSTEAD of its top bar and its left rail when the switch is on. It is
// chrome only: the board engine (the layout hook, the grid, the panels, the command line, saved
// boards, versions, share, pop-out, groups, shortcuts) stays in the shell, which hands this
// component its state and handlers. With the switch off this file is never mounted, so its
// store hook (useBoardTabs) never runs.
//
//   row 1   the open boards as a real tablist · "+" · the one box (the shell's own CommandLine,
//           passed in as `box`) · "Add a block" · "Edit board"
//   row 2   the board's name, "A UCT board, yours to change" on a ready-made one, rename, close
//   row 3   only while "Edit board" is on: panel count, density, undo close, put it back, version
//           history, save, reset to UCT default, recent
//
// The close and rename controls sit in row 2, not inside the tabs: a tablist may hold only tabs.
// A focused tab also takes Delete (close) and F2 (rename).
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Sheet from '../../components/mobile/Sheet'
import FieldError from '../../components/ui/FieldError'
import Input from '../../components/ui/Input'
import UIcon from '../../components/ui/UIcon'
import { DENSITIES, DENSITY_LABELS, PANEL_COUNTS, boardSnapshot, renameBoard } from './boardModel'
import { FUNCTIONS, FUNCTION_GROUPS, flagOn } from './functions'
import { STARTER_BOARDS } from './starterBoards'
import { defaultStockBoard } from './stockBoards'
import { stockBoardRefusal, stockTicker } from './stockBoardModel'
import useBoardTabs from './useBoardTabs'
import {
  BLANK_NAME, MAX_TABS, OWN_NAME, TABS_FULL_TEXT, TAB_NAME_MAX, activeTab, blankBoard, boardSignature, canRename,
  differsFromDefault, findTab, savedBoardOf, stockSymOf, tabBase, tabLabel, tabUnsaved,
} from './boardTabs'
import styles from './BoardTabsChrome.module.css'

/** What a ready-made board says under its name (the brief's words). */
export const UCT_BOARD_LINE = 'A UCT board, yours to change'
export const BOX_PLACEHOLDER = 'Search a ticker or a tool, or type a code'
/** Stamped on <html> while the tabs chrome is mounted (FeedbackWidget and FloatingOrb read it). */
export const BOTTOM_BOX_ATTR = 'data-terminal-bottom-box'

const isReadyMade = (tab) => !!tab && (tab.kind === 'starter' || tab.kind === 'stock')

/**
 * "Add a block": every tool, plain name first and its code as a small grey shortcut, grouped as
 * the registry groups them, with a filter box. Read from `functions.js`, never a second list.
 * A tool this account does not have is left out once the sign-in payload has arrived.
 */
export function ToolsList({ auth = null, onPick }) {
  const [q, setQ] = useState('')
  const uid = useId()
  const flagsKnown = !(auth?.loading || auth?.authTransient)
  const needle = q.trim().toLowerCase()
  const groups = useMemo(() => FUNCTION_GROUPS.map((g) => ({
    g,
    fns: FUNCTIONS.filter((f) => {
      if (f.group !== g) return false
      const variants = [f.market, f.ticker].filter(Boolean)
      if (flagsKnown && variants.length && !variants.some((v) => !v.flag || flagOn(auth, v.flag))) return false
      return !needle || f.label.toLowerCase().includes(needle) || f.code.toLowerCase().includes(needle)
    }),
  })).filter((x) => x.fns.length), [auth, flagsKnown, needle])
  return (
    <div className={styles.tools} data-testid="terminal-tools">
      <label className={styles.fieldLabel} htmlFor={`${uid}-filter`}>Find a tool</label>
      <Input id={`${uid}-filter`} type="search" className={styles.field} value={q} onChange={(e) => setQ(e.target.value)}
        placeholder="Type a name or a code" autoComplete="off" data-testid="terminal-tools-filter" />
      {groups.length === 0 && (
        <p className={styles.note} role="status" data-testid="terminal-tools-empty">No tool matches “{q.trim()}”.</p>
      )}
      {groups.map(({ g, fns }, gi) => (
        <section key={g} aria-labelledby={`${uid}-g${gi}`}>
          <h3 id={`${uid}-g${gi}`} className={styles.groupHead}>{g}</h3>
          <ul className={styles.list}>
            {fns.map((f) => (
              <li key={f.code}>
                <button type="button" className={styles.row} onClick={() => onPick?.(f.code)} data-testid={`terminal-tool-${f.code}`}>
                  <span className={styles.rowName}>{f.label}</span>
                  <span className={styles.rowCode}>{f.code}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

export default function BoardTabsChrome({
  apiRef, addBlockRef = null, layout, syms, layoutStatus, library, libraryWritable = true, save, setGroupSym, saveLibrary,
  isPhone = false, box = null, status = null, editing = false, onEditing,
  onAddBlock, onOpenStarter, onOpenStock, onOpenSaved, onNotice, onCurrent,
  onCount, onDensity, onUndoClose, hasRevert = false, onRevert, onVersions, onBoards, onRecents,
  zoom = false, onShowAll,
}) {
  const tabs = useBoardTabs({ layout, syms, layoutStatus, library, save, setGroupSym })
  const { doc } = tabs
  const tab = activeTab(doc)
  const uid = useId()
  const stripRef = useRef(null)
  const plusRef = useRef(null)
  const [plusOpen, setPlusOpen] = useState(false)
  const [stock, setStock] = useState('')
  const [stockError, setStockError] = useState(null)
  const [confirm, setConfirm] = useState(null)       // { kind: 'close' | 'reset', id }
  const [renaming, setRenaming] = useState(null)     // { id, value }
  // The board as it stood when "Edit board" was switched on (or this tab was selected while it
  // was on): what "Put it back the way it was" returns to. Held for this visit only.
  const [baseline, setBaseline] = useState(null)     // { id, snap }

  // The shell opens every board through this (TerminalShell.openSnapshot) while the chrome is up.
  useLayoutEffect(() => {
    if (!apiRef) return undefined
    apiRef.current = { open: tabs.open, markSaved: tabs.markSaved }
    return () => { apiRef.current = null }
  }, [apiRef, tabs.open, tabs.markSaved])

  // On a phone the box is the bottom row of the screen. The app's two floating buttons (Help,
  // the voice orb) dock in the bottom corners, so they step up over it while this chrome is
  // mounted: their own stylesheets read this attribute at phone width, as they do for the chart
  // shell's bottom toolbar.
  useEffect(() => {
    const root = document.documentElement
    root.setAttribute(BOTTOM_BOX_ATTR, '')
    return () => root.removeAttribute(BOTTOM_BOX_ATTR)
  }, [])

  const snapshot = useMemo(() => boardSnapshot(layout, syms), [layout, syms])
  const ctx = useMemo(() => ({ layout: snapshot, library }), [snapshot, library])
  const liveSym = tab?.kind === 'stock' ? stockSymOf(snapshot) : null
  const label = tab ? tabLabel(tab, liveSym) : null
  const full = !!doc && doc.tabs.length >= MAX_TABS
  const count = layout.count

  // The Boards menu's "open now" marks and its save field follow the selected tab.
  const boardName = !tab || tab.kind === 'blank' || (tab.kind === 'own' && tab.name === OWN_NAME) ? null : tab.name
  const starterId = isReadyMade(tab) ? tab.ref : null
  useEffect(() => { if (tab) onCurrent?.({ board: boardName, starter: starterId }) },
    [tab?.id, boardName, starterId])   // eslint-disable-line react-hooks/exhaustive-deps

  const tabId = tab?.id || null
  useEffect(() => {
    if (!editing || !tabId) { setBaseline(null); return }
    setBaseline({ id: tabId, snap: tabs.currentSnap() })
  }, [editing, tabId])   // eslint-disable-line react-hooks/exhaustive-deps

  // The selected tab stays in view when the strip scrolls sideways (a phone, many tabs).
  useEffect(() => {
    const el = stripRef.current?.querySelector('[aria-selected="true"]')
    el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [tabId, doc?.tabs.length])

  const focusSelected = () => requestAnimationFrame(() => stripRef.current?.querySelector('[aria-selected="true"]')?.focus())

  const snapOf = (t) => (t.id === doc.active ? snapshot : t.copy)
  const requestClose = (id) => {
    const t = doc && findTab(doc, id)
    if (!t || doc.tabs.length < 2) return
    const snap = snapOf(t)
    if (snap && tabUnsaved(t, snap, { layout: snap, library })) { setConfirm({ kind: 'close', id }); return }
    tabs.close(id)
    focusSelected()
  }
  const startRename = (id) => {
    const t = doc && findTab(doc, id)
    if (canRename(t)) setRenaming({ id, value: t.name })
  }
  const submitRename = () => {
    const t = renaming && doc && findTab(doc, renaming.id)
    const name = String(renaming?.value || '').trim().slice(0, TAB_NAME_MAX)
    setRenaming(null)
    if (!t || !name || name === t.name) return
    if (t.kind === 'saved') {
      // A saved board is renamed by the board model, in the member's saved boards; the tab follows.
      const board = savedBoardOf(t, library)
      if (board) {
        const next = renameBoard(library, board.id, name)
        if (next === library) { onNotice?.({ kind: 'error', text: `You already have a saved board named ${name}. Pick another name.` }); return }
        if (!libraryWritable || !saveLibrary(next)) {
          onNotice?.({ kind: 'error', text: 'Your saved boards could not be read, so the board was not renamed.' })
          return
        }
      }
    }
    tabs.rename(t.id, name)
    onNotice?.({ kind: 'info', text: `Renamed to ${name}.` })
  }

  const onTabKey = (e) => {
    const list = [...(stripRef.current?.querySelectorAll('[role="tab"]') || [])]
    const at = list.indexOf(document.activeElement)
    if (at < 0) return
    const id = doc.tabs[at]?.id
    if (e.key === 'Delete' && id) { e.preventDefault(); requestClose(id); return }
    if (e.key === 'F2' && id) { e.preventDefault(); if (id !== doc.active) tabs.select(id); startRename(id); return }
    const n = list.length
    const to = { ArrowRight: (at + 1) % n, ArrowLeft: (at - 1 + n) % n, Home: 0, End: n - 1 }[e.key]
    if (to === undefined) return
    e.preventDefault()
    list[to]?.focus()
  }

  const openFromPlus = (fn) => { setPlusOpen(false); setStock(''); setStockError(null); fn() }
  const openBlank = () => openFromPlus(() => {
    const res = tabs.open(blankBoard(layout), { name: BLANK_NAME, tab: { kind: 'blank' } })
    onNotice?.(res.ok
      ? { kind: 'info', text: 'Opened a new board. Use Add a block to fill it.' }
      : { kind: 'error', text: res.text })
  })
  const submitStock = (e) => {
    e.preventDefault()
    const board = defaultStockBoard()
    const refusal = stockBoardRefusal(layout, board, stock)
    if (refusal) { setStockError(refusal); return }
    openFromPlus(() => onOpenStock?.(board, stockTicker(stock)))
  }

  const base = tab ? tabBase(tab, ctx) : null
  const canReset = isReadyMade(tab) && differsFromDefault(tab, snapshot, ctx)
  const canPutBack = !!baseline && baseline.id === tabId
    && boardSignature(baseline.snap, { own: true }) !== boardSignature(snapshot, { own: true })
  const putBack = () => {
    if (canPutBack) {
      tabs.replaceActive(baseline.snap)
      onNotice?.({ kind: 'info', text: 'Put the board back the way it was when you started editing.' })
    } else onRevert?.()
  }
  const confirmTab = confirm && doc ? findTab(doc, confirm.id) : null
  const doConfirm = () => {
    const c = confirm
    setConfirm(null)
    if (!c || !confirmTab) return
    if (c.kind === 'close') { tabs.close(c.id); focusSelected(); return }
    if (c.kind === 'reset' && base) {
      tabs.replaceActive(base)
      onNotice?.({ kind: 'info', text: `${confirmTab.name} is back to the UCT default.` })
    }
  }
  const confirmName = confirmTab ? (tabLabel(confirmTab, confirmTab.id === tabId ? liveSym : null).text) : ''

  const guardedTabs = tabs.status === 'unreadable' || tabs.status === 'newer'
  const title = !tab ? '' : tab.kind === 'stock' && label?.small ? `${label.text} · ${tab.name}` : tab.name

  return (
    <div className={styles.chrome} data-editing={editing ? 'true' : 'false'} data-testid="terminal-tabs-chrome">
      <div className={styles.top}>
        <div className={styles.tabsWrap}>
          {doc ? (
            <div className={styles.tabs} role="tablist" aria-label="Open boards" ref={stripRef} onKeyDown={onTabKey}
              data-testid="terminal-tabs" data-count={doc.tabs.length}>
              {doc.tabs.map((t, i) => {
                const on = t.id === doc.active
                const l = tabLabel(t, on ? liveSym : null)
                return (
                  <button key={t.id} type="button" role="tab" aria-selected={on} tabIndex={on ? 0 : -1}
                    className={`${styles.tab} ${on ? styles.tabOn : ''}`}
                    onClick={() => { if (!on) tabs.select(t.id) }}
                    onDoubleClick={() => startRename(t.id)}
                    title={canRename(t) ? `${t.name} (F2 renames, Delete closes)` : `${t.name} (Delete closes)`}
                    data-kind={t.kind} data-testid={`terminal-tab-${i}`}>
                    <span className={styles.tabText}>{l.text}</span>
                    {l.small && <span className={styles.tabSmall}>{l.small}</span>}
                  </button>
                )
              })}
            </div>
          ) : <div className={styles.tabs} ref={stripRef} data-testid="terminal-tabs-loading" />}
          <button type="button" ref={plusRef} className={styles.plus} onClick={() => setPlusOpen(true)}
            aria-haspopup="dialog" aria-expanded={plusOpen} aria-label="Open a board in a new tab"
            title={full ? TABS_FULL_TEXT : 'Open a board in a new tab'} disabled={!doc} data-testid="terminal-tab-add">
            <UIcon name="plus" size={14} gold={false} />
          </button>
        </div>
        <div className={styles.box} data-testid="terminal-box">{box}</div>
        <div className={styles.actions}>
          <button type="button" ref={addBlockRef} className={styles.btn} onClick={onAddBlock} aria-haspopup="dialog" data-testid="terminal-add-block">
            <UIcon name="plus" size={14} gold={false} />
            <span>Add a block</span>
          </button>
          <button type="button" className={`${styles.btn} ${editing ? styles.btnOn : ''}`} aria-pressed={editing}
            onClick={() => onEditing?.(!editing)} data-testid="terminal-edit-board">
            <UIcon name="edit" size={14} gold={false} />
            <span>Edit board</span>
          </button>
        </div>
      </div>

      <div className={styles.titleRow}>
        {renaming && tab && renaming.id === tab.id ? (
          <form className={styles.rename} onSubmit={(e) => { e.preventDefault(); submitRename() }}>
            <label className="sr-only" htmlFor={`${uid}-rename`}>Board name</label>
            <Input id={`${uid}-rename`} className={styles.field} value={renaming.value} maxLength={TAB_NAME_MAX} autoFocus
              onChange={(e) => setRenaming({ id: renaming.id, value: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); setRenaming(null) } }}
              data-testid="terminal-tab-rename-input" />
            <button type="submit" className={styles.btn} data-testid="terminal-tab-rename-save">Save name</button>
            <button type="button" className={styles.btn} onClick={() => setRenaming(null)}>Cancel</button>
          </form>
        ) : (
          <>
            <h2 className={styles.boardName} data-testid="terminal-board-title">{title}</h2>
            {isReadyMade(tab) && <span className={styles.boardLine} data-testid="terminal-board-uct">{UCT_BOARD_LINE}</span>}
          </>
        )}
        {status && <div className={styles.status} data-testid="terminal-tabs-status">{status}</div>}
        <span className={styles.titleActions}>
          {zoom && (
            <button type="button" className={styles.btn} onClick={onShowAll} data-testid="terminal-restore-board"
              aria-keyshortcuts="Alt+M" title="Show every panel again (Alt+M)">Show all {count} panels</button>
          )}
          {tab && canRename(tab) && !renaming && (
            <button type="button" className={styles.iconBtn} onClick={() => startRename(tab.id)}
              aria-label={`Rename ${tab.name}`} title="Rename this board" data-testid="terminal-tab-rename">
              <UIcon name="edit" size={14} gold={false} />
            </button>
          )}
          {doc && doc.tabs.length > 1 && tab && (
            <button type="button" className={styles.iconBtn} onClick={() => requestClose(tab.id)}
              aria-label={`Close the tab ${label?.text || tab.name}`} title="Close this tab" data-testid="terminal-tab-close">
              <UIcon name="x" size={14} gold={false} />
            </button>
          )}
        </span>
      </div>
      {full && <p className={styles.note} data-testid="terminal-tabs-full">{TABS_FULL_TEXT}</p>}

      {guardedTabs && (
        <div className={styles.warn} role="alert" data-testid="terminal-tabs-unreadable">
          <span>
            {tabs.status === 'newer'
              ? 'Your open boards were saved by a newer version of the app. Reload to use them.'
              : 'Your list of open boards could not be read.'}
            {' '}It has not been changed. This visit shows the board on screen, and tabs you open now are not kept.
          </span>
          {tabs.canStartFresh && (
            <button type="button" className={styles.btn} onClick={tabs.startFresh} data-testid="terminal-tabs-start-fresh">
              Keep these tabs (replace it)
            </button>
          )}
        </div>
      )}

      {editing && (
        <div className={styles.editBar} role="group" aria-label="Edit this board" data-testid="terminal-edit-bar">
          {!isPhone && (
            <div className={styles.seg} role="group" aria-label={`Panels: this board shows ${count}`} data-count={count}>
              {PANEL_COUNTS.map((n) => (
                <button key={n} type="button" className={`${styles.btn} ${count === n ? styles.btnOn : ''}`}
                  aria-pressed={count === n} onClick={() => onCount?.(n)}
                  aria-label={`Show ${n} panel${n === 1 ? '' : 's'}`} aria-keyshortcuts={`Alt+Shift+${n}`}
                  title={`Show ${n} panel${n === 1 ? '' : 's'} (Alt+Shift+${n})`} data-testid={`terminal-count-${n}`}>{n}</button>
              ))}
            </div>
          )}
          {!isPhone && (
            <div className={styles.seg} role="group" aria-label="Density">
              {DENSITIES.map((d) => (
                <button key={d} type="button" className={`${styles.btn} ${layout.density === d ? styles.btnOn : ''}`}
                  aria-pressed={layout.density === d} onClick={() => onDensity?.(d)}
                  aria-label={`${d[0].toUpperCase()}${d.slice(1)} density`} title={`${d[0].toUpperCase()}${d.slice(1)} density`}
                  data-testid={`terminal-density-${d}`}>{DENSITY_LABELS[d]}</button>
              ))}
            </div>
          )}
          {!isPhone && layout.closed.length > 0 && (
            <button type="button" className={styles.btn} onClick={onUndoClose} data-testid="terminal-undo-close"
              aria-keyshortcuts="Alt+Z" title={`Re-open ${layout.closed[0].panel.code} (Alt+Z)`}>Undo close</button>
          )}
          {(canPutBack || hasRevert) && (
            <button type="button" className={styles.btn} onClick={putBack} data-testid="terminal-revert-layout">
              Put it back the way it was
            </button>
          )}
          {canReset && (
            <button type="button" className={styles.btn} onClick={() => setConfirm({ kind: 'reset', id: tab.id })}
              data-testid="terminal-reset-default">Reset to UCT default</button>
          )}
          <button type="button" className={styles.btn} onClick={onBoards} data-testid="terminal-boards-button"
            aria-keyshortcuts="Alt+O" title="Save this board, save it under a new name, or share it (Alt+O)">Save board</button>
          <button type="button" className={styles.btn} onClick={onVersions} data-testid="terminal-edit-versions">Version history</button>
          <button type="button" className={styles.btn} onClick={onRecents} data-testid="terminal-recents-button"
            aria-keyshortcuts="Alt+R" title="Recents (Alt+R)">Recent</button>
        </div>
      )}

      <Sheet open={plusOpen} onClose={() => { setPlusOpen(false); setStockError(null) }} title="Open a board" labelledByTitle maxWidth={420}
        returnFocusTo={plusRef}>
        <div className={styles.menu} data-testid="terminal-plus-menu">
          {full && <p className={styles.warn} role="status" data-testid="terminal-plus-full">{TABS_FULL_TEXT}</p>}
          <section aria-labelledby={`${uid}-ready`}>
            <h3 id={`${uid}-ready`} className={styles.groupHead}>Ready-made boards</h3>
            <ul className={styles.list}>
              {STARTER_BOARDS.map((s) => (
                <li key={s.id}>
                  <button type="button" className={styles.row} disabled={full} onClick={() => openFromPlus(() => onOpenStarter?.(s))}
                    data-testid={`terminal-plus-starter-${s.id}`}>
                    <span className={styles.rowName}>{s.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <section aria-labelledby={`${uid}-stock`}>
            <h3 id={`${uid}-stock`} className={styles.groupHead}>A stock…</h3>
            <form className={styles.inline} onSubmit={submitStock}>
              <label className="sr-only" htmlFor={`${uid}-ticker`}>Ticker for the stock board</label>
              <Input id={`${uid}-ticker`} className={styles.field} value={stock} maxLength={10} autoComplete="off" autoCapitalize="characters"
                placeholder="Ticker, like NVDA" disabled={full} error={stockError || undefined}
                onChange={(e) => { setStock(e.target.value); setStockError(null) }} data-testid="terminal-plus-stock" />
              <button type="submit" className={styles.btn} disabled={full || !stock.trim()} data-testid="terminal-plus-stock-open">Open</button>
            </form>
            <FieldError forId={`${uid}-ticker`} className={styles.fieldError} data-testid="terminal-plus-stock-error">{stockError}</FieldError>
          </section>
          <section aria-labelledby={`${uid}-mine`}>
            <h3 id={`${uid}-mine`} className={styles.groupHead}>My boards</h3>
            {library.boards.length === 0
              ? <p className={styles.note}>You have no saved boards yet. Edit board, then Save board, keeps one.</p>
              : (
                <ul className={styles.list}>
                  {library.boards.map((b) => (
                    <li key={b.id}>
                      <button type="button" className={styles.row} disabled={full} onClick={() => openFromPlus(() => onOpenSaved?.(b))}
                        data-testid={`terminal-plus-saved-${b.slug}`}>
                        <span className={styles.rowName}>{b.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
          </section>
          <button type="button" className={styles.row} disabled={full} onClick={openBlank} data-testid="terminal-plus-blank">
            <span className={styles.rowName}>Blank</span>
          </button>
        </div>
      </Sheet>

      <Sheet open={!!confirmTab} onClose={() => setConfirm(null)} maxWidth={420} labelledByTitle
        title={confirm?.kind === 'reset' ? 'Reset this board?' : 'Close this board?'}>
        {confirmTab && (
          <div className={styles.menu} data-testid="terminal-tab-confirm">
            <p className={styles.confirmText}>
              {confirm.kind === 'reset'
                ? `${confirmName} will go back to the board UCT made. The changes you made to it will be gone.`
                : `${confirmName} has changes that are not saved anywhere. If you close it, they are gone.`}
            </p>
            <div className={styles.inline}>
              <button type="button" className={`${styles.btn} ${styles.btnOn}`} onClick={doConfirm} data-testid="terminal-tab-confirm-yes">
                {confirm.kind === 'reset' ? 'Reset it' : 'Close it'}
              </button>
              <button type="button" className={styles.btn} onClick={() => setConfirm(null)} data-testid="terminal-tab-confirm-no">
                {confirm.kind === 'reset' ? 'Keep my changes' : 'Keep it open'}
              </button>
            </div>
          </div>
        )}
      </Sheet>
    </div>
  )
}

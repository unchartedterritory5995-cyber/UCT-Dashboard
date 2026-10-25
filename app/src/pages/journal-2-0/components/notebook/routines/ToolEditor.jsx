import { useCallback, useEffect, useId, useRef, useState } from 'react'
import Sheet from '../../../../../components/mobile/Sheet'
import {
  archiveTool, createTool, deleteTool, duplicateTool, getTool, saveTool, undeleteTool, unarchiveTool,
} from '../../../lib/toolsCrud'
import { ArchivePanel, DeletePanel, DeletedPanel, ManageSection, UsedInPanel } from './ToolManage'
import { COPY, fieldOf, restoredSentence } from './toolEditorLib'
import styles from './routines.module.css'

/**
 * The frame both editors share (Task 9.16): ONE Sheet, the form, Save, and the item's own management (Used in,
 * Duplicate, Archive, then Restore and Delete permanently from the archive, with Undo after a delete).
 *
 * `spec` is the kind's own part: `{kind, titles: {new, edit, view}, blank(), fromTool(tool), body(draft, mode),
 * check(draft) -> {field: sentence}, liveCheck?(draft), archivedText}`. `renderForm({draft, setDraft, error, mode,
 * say, rebase})` draws the fields and `renderSummary(tool)` the read-only view (an archived item, a check-in tracker).
 *
 * The rules it keeps, mirroring the widget builder and My tools:
 *   * Save creates, or saves with If-Match: <etag>. A conflict keeps the draft and offers Reload; a field refusal
 *     shows the server's sentence beside that field (and focus goes there); anything else shows in the notice line.
 *   * ONE always-mounted live region (the notice line, visible while it says something), its text in a keyed child so
 *     the same sentence twice is read twice.
 *   * aria-disabled plus a guard, never `disabled`, so a control is still found and explained.
 *   * Escape goes back one level (a question or a panel back to the form); at the form the Sheet's own Escape asks
 *     "Keep your changes?" only when something changed, and otherwise closes.
 *   * `handOff(message)`: opened from a placed block, a tool that cannot be read closes the editor and the block's own
 *     line says why, rather than leaving an empty sheet.
 */
export default function ToolEditor({
  spec, toolId = null, onSaved, onClose, handOff = null, navigate = null, renderForm, renderSummary,
}) {
  const { kind } = spec
  const uid = useId()
  const [phase, setPhase] = useState(toolId ? 'loading' : 'ready')
  const [failure, setFailure] = useState(null)
  const [tool, setTool] = useState(null)
  const [draft, setDraftState] = useState(() => spec.blank())
  const [baseline, setBaseline] = useState(() => JSON.stringify(spec.body(spec.blank(), toolId ? 'edit' : 'new')))
  const [errors, setErrors] = useState({})
  const [notice, setNotice] = useState({ n: 0, text: '', reload: false })
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [level, setLevel] = useState('main')
  const savingRef = useRef(false)
  const busyRef = useRef(false)
  const rootRef = useRef(null)
  const openerRef = useRef(null)
  const focusNext = useRef(null)
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])

  const mode = tool || toolId ? 'edit' : 'new'
  const readOnly = !!tool && (tool.archived === true || tool.readOnly === true)
  const bodyKey = JSON.stringify(spec.body(draft, mode))
  const dirty = !readOnly && phase === 'ready' && bodyKey !== baseline

  const say = useCallback((text, extra = {}) => {
    setNotice((n) => ({ n: n.n + 1, text: String(text || ''), reload: !!extra.reload }))
  }, [])

  // ── the draft ──────────────────────────────────────────────────────────────────────────────────
  /** `next` is a draft or `(prev) => draft`. `rebase` (a draft, not a function): it is the starting point (a starter
   *  asked for at open), so it counts as no change yet. Stable, so a form's effects never re-run because of it. */
  const modeRef = useRef(mode)
  modeRef.current = mode
  const setDraft = useCallback((next, { rebase = false } = {}) => {
    if (rebase && typeof next !== 'function') {
      setDraftState(next)
      setBaseline(JSON.stringify(spec.body(next, modeRef.current)))
      return
    }
    setDraftState(next)
  }, [spec])
  // An edit answers the refusals it may have fixed: a server sentence goes with any change; a client one stays only
  // while the draft still fails it.
  const firstDraft = useRef(true)
  useEffect(() => {
    if (firstDraft.current) { firstDraft.current = false; return }
    setErrors((errs) => {
      const c = spec.check(draft)
      const out = {}
      for (const [f, e] of Object.entries(errs)) if (e.source === 'client' && c[f]) out[f] = { text: c[f], source: 'client' }
      return Object.keys(out).length === Object.keys(errs).length && Object.keys(out).every((f) => out[f].text === errs[f].text) ? errs : out
    })
  }, [draft, spec])

  const adopt = useCallback((t) => {
    setTool(t)
    const d = spec.fromTool(t)
    setDraftState(d)
    setBaseline(JSON.stringify(spec.body(d, 'edit')))
    setErrors({})
  }, [spec])

  // ── loading ────────────────────────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setPhase('loading')
    const got = await getTool(kind, toolId)
    if (!alive.current) return
    if (got.ok) { adopt(got.data); setPhase('ready'); return }
    if (handOff) { handOff(got.message); return }
    setFailure(got)
    setPhase('failed')
  }, [kind, toolId, adopt, handOff])
  useEffect(() => { if (toolId) load() }, [])            // eslint-disable-line react-hooks/exhaustive-deps

  // ── focus ──────────────────────────────────────────────────────────────────────────────────────
  const fieldEl = (f) => rootRef.current?.querySelector(`[data-field="${f}"]`) || null
  useEffect(() => {
    const want = focusNext.current
    if (!want) return
    focusNext.current = null
    // A selector, an element, or a level's opener `{el, key}`: an opener that was re-rendered meanwhile (the footer's
    // Cancel is not drawn while a question shows) is found again by its `data-focus-key`, within the whole sheet.
    const panel = rootRef.current?.closest('[data-sheet-panel]') || rootRef.current
    let el = null
    if (typeof want === 'string') el = rootRef.current?.querySelector(want)
    else if (want.el !== undefined) el = want.el?.isConnected ? want.el : (want.key ? panel?.querySelector(`[data-focus-key="${want.key}"]`) : null)
    else el = want
    if (el && el.isConnected && typeof el.focus === 'function') el.focus()
  })
  const push = (to, from) => {
    const el = from || (typeof document !== 'undefined' ? document.activeElement : null)
    openerRef.current = { el, key: el?.getAttribute?.('data-focus-key') || null }
    setLevel(to)
  }
  const back = useCallback(() => {
    setLevel('main')
    focusNext.current = openerRef.current
  }, [])
  const levelRef = useRef(level)
  levelRef.current = level
  useEffect(() => {
    const isTop = () => {
      const panel = rootRef.current?.closest('[data-sheet-panel]')
      const panels = document.querySelectorAll('[data-sheet-panel]')
      return !!panel && panels[panels.length - 1] === panel
    }
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      const lvl = levelRef.current
      if (lvl === 'main' || lvl === 'deleted' || !isTop()) return
      e.preventDefault()
      e.stopPropagation()
      back()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [back])

  // ── closing ────────────────────────────────────────────────────────────────────────────────────
  const close = (focusTo) => onClose?.(focusTo)
  /** Cancel, the Sheet's ×, its backdrop and its Escape. `from` is a clicked element, a click event (the ×), or
   *  nothing (Escape: the focused element is where to come back to). */
  const requestClose = (from) => {
    if (savingRef.current) return
    if (level === 'deleted' || !dirty) { close(); return }
    if (level === 'ask') return
    const el = typeof Element !== 'undefined' && from instanceof Element ? from
      : typeof Element !== 'undefined' && from?.currentTarget instanceof Element ? from.currentTarget : null
    push('ask', el)
  }

  // ── saving ─────────────────────────────────────────────────────────────────────────────────────
  const save = async () => {
    if (savingRef.current || readOnly || phase !== 'ready') return
    setLevel('main')
    const c = spec.check(draft)
    const fields = Object.keys(c)
    if (fields.length) {
      setErrors(Object.fromEntries(fields.map((f) => [f, { text: c[f], source: 'client' }])))
      focusNext.current = fieldEl(fields[0])
      return
    }
    if (mode === 'edit' && !dirty) { close(); return }
    savingRef.current = true
    setSaving(true)
    const body = spec.body(draft, mode)
    const got = mode === 'edit' ? await saveTool(kind, tool.id, tool.etag, body) : await createTool(kind, body)
    savingRef.current = false
    if (!alive.current) return
    setSaving(false)
    if (got.ok) {
      try { onSaved?.(got.data) } catch { /* the caller's own work never blocks closing */ }
      close()
      return
    }
    if (got.code === 'conflict') { say(got.message || COPY.conflict, { reload: true }); return }
    const f = got.code === 'invalid' ? fieldOf(kind, got.message) : null
    if (f && fieldEl(f)) {
      setErrors({ [f]: { text: got.message, source: 'server' } })
      focusNext.current = fieldEl(f)
      return
    }
    say(got.message)
  }
  const reload = async () => {
    if (busyRef.current || !tool) return
    busyRef.current = true
    setBusy(true)
    const got = await getTool(kind, tool.id)
    busyRef.current = false
    if (!alive.current) return
    setBusy(false)
    if (got.ok) { adopt(got.data); say(COPY.reloaded); focusNext.current = '[data-field="name"]'; return }
    say(got.message)
  }

  // ── managing ───────────────────────────────────────────────────────────────────────────────────
  /** One action at a time: `run` answers the toolsCrud result. */
  const act = async (run, onOk) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    const got = await run()
    busyRef.current = false
    if (!alive.current) return
    setBusy(false)
    if (got.ok) onOk(got.data)
    else say(got.message)
    return got
  }
  const name = String(tool?.name || '')
  const manage = {
    duplicate: () => {
      if (dirty) return
      act(() => duplicateTool(kind, tool.id), (copy) => {
        adopt(copy)
        say(`Made a copy. You are editing “${copy?.name || ''}”.`)
        focusNext.current = '[data-field="name"]'
      })
    },
    archive: (el) => { if (!dirty) push('archive', el) },
    confirmArchive: () => act(() => archiveTool(kind, tool.id), (t) => {
      adopt(t)
      setLevel('main')
      say(`Archived “${t?.name || name}”.`)
      focusNext.current = '[data-manage="restore"]'
    }),
    restore: () => act(() => unarchiveTool(kind, tool.id), (t) => {
      adopt(t)
      say(restoredSentence(t?.name || name))
      focusNext.current = '[data-field="name"]'
    }),
    remove: (el) => push('delete', el),
    confirmDelete: (typed) => act(() => deleteTool(kind, tool.id, typed), () => setLevel('deleted')),
    undo: () => act(() => undeleteTool(kind, tool.id), (t) => {
      adopt(t)
      setLevel('main')
      say(`Brought back “${t?.name || name}”. It is still archived.`)
      focusNext.current = '[data-manage="restore"]'
    }),
    usedIn: (el) => { if (!dirty) push('usedIn', el) },
  }

  // ── render ─────────────────────────────────────────────────────────────────────────────────────
  const errorOf = (f) => (errors[f] || (spec.liveCheck?.(draft)?.[f] ? { text: spec.liveCheck(draft)[f] } : null))
  const error = (f) => {
    const e = errorOf(f)
    return e ? { text: e.text, id: `${uid}-err-${f}` } : null
  }
  const title = mode === 'new' ? spec.titles.new : readOnly ? spec.titles.view : spec.titles.edit
  const rebase = useCallback((d) => setDraft(d, { rebase: true }), [setDraft])

  let content
  if (phase === 'loading') content = <p className={styles.hint}>{COPY.loading}</p>   // M-6: no second live region
  else if (phase === 'failed') {
    content = (
      <div className={styles.stateBox}>
        <p className={styles.sentence}>{failure?.message || COPY.loadFailed}</p>
        {failure?.code !== 'unavailable' && failure?.code !== 'paid' && failure?.code !== 'missing' && (
          <button type="button" className={styles.btn} onClick={load}>Try again</button>
        )}
      </div>
    )
  } else {
    content = (
      <>
        <div className={styles.mainLevel} hidden={level !== 'main'} data-level="main">
          {readOnly ? renderSummary(tool) : renderForm({ draft, setDraft, error, mode, say, rebase })}
          {tool && tool.readOnly !== true && (
            <ManageSection kind={kind} tool={tool} dirty={dirty} busy={busy} manage={manage} archivedText={spec.archivedText} />
          )}
        </div>
        {level === 'ask' && (
          <section className={styles.panel} aria-labelledby={`${uid}-ask`}>
            <h3 id={`${uid}-ask`} className={styles.panelTitle} tabIndex={-1} data-panel-heading="">{COPY.keep}</h3>
            <p className={styles.hint}>{COPY.keepHint}</p>
            <div className={styles.actions}>
              <button type="button" className={styles.btnPrimary} onClick={save}>Save them</button>
              <button type="button" className={styles.btn} onClick={() => close()}>Discard them</button>
              <button type="button" className={styles.btn} onClick={back}>Keep editing</button>
            </div>
          </section>
        )}
        {level === 'archive' && (
          <ArchivePanel kind={kind} tool={tool} busy={busy} onBack={back} onConfirm={manage.confirmArchive} />
        )}
        {level === 'delete' && (
          <DeletePanel kind={kind} tool={tool} busy={busy} onBack={back} onConfirm={manage.confirmDelete} />
        )}
        {level === 'deleted' && (
          <DeletedPanel tool={tool} busy={busy} onUndo={manage.undo} onClose={() => close()} />
        )}
        {level === 'usedIn' && (
          <UsedInPanel kind={kind} tool={tool} onBack={back} navigate={navigate} onNavigate={() => close()} />
        )}
      </>
    )
  }

  const showFooter = phase === 'ready' && level === 'main'
  const footer = !showFooter ? null : readOnly ? (
    <div className={styles.footer}>
      <button type="button" className={styles.btnPrimary} onClick={() => close()}>Close</button>
    </div>
  ) : (
    <div className={styles.footer}>
      <button type="button" className={styles.btn} data-focus-key="cancel" onClick={(e) => requestClose(e.currentTarget)}>Cancel</button>
      <button type="button" className={styles.btnPrimary} onClick={save} aria-disabled={saving || undefined}
        aria-busy={saving || undefined} data-testid="tool-editor-save">
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  )

  return (
    <Sheet open onClose={requestClose} title={<h2 className={styles.dialogTitle}>{title}</h2>} labelledByTitle
      maxWidth={640} className={styles.sheetPanel} footer={footer}>
      <div ref={rootRef} className={styles.root} data-testid={`${kind}-editor`}>
        {/* The ONE live region: always mounted, visible while it says something. */}
        <div className={notice.text ? styles.notice : styles.liveIdle} role="status" data-testid="tool-editor-live">
          <span key={notice.n}>{notice.text}</span>
        </div>
        {notice.reload && notice.text && tool && level === 'main' && (
          <div className={styles.noticeActions}>
            <button type="button" className={styles.btn} onClick={reload} aria-disabled={busy || undefined}>Reload</button>
          </div>
        )}
        {content}
      </div>
    </Sheet>
  )
}

// Audit 2026-11-05, spec S16 (M2): the 60-second first run. A LAZY chunk: FirstRunGate (the sheet, on a member's
// first Notebook visit and from Settings) and FirstRunInlineSlot (Research Home's inline ask after a Skip) fetch it
// only when it will show.
//
// Step 1 asks two things and promises one: "How do you trade?" (the starter packs, asked HERE with a preview of what
// each adds), "Three tickers you're watching right now" (autocomplete from /api/ticker-search), and "Your notes are
// always yours to export." Build my Notebook writes, each through its EXISTING door:
//   * the names into ONE "My names" watchlist (lib/myNames.js: the watchlist API, added to when it exists);
//   * the chosen pack (lib/starterPacks.js: the starter-pack API; idempotent, "already had" is never copied twice),
//     with Undo (the Template's own soft delete, which "Recently deleted" can bring back);
//   * today's plan note (lib/dailyNote.js: the daily note door, one per member per ET day on the server), then
//     `invalidateNoteViews` so the lists show it.
// ⛔ A DOUBLE PRESS BUILDS ONCE: the press is latched before the first await, and each door is idempotent anyway.
// Step 2 is M2's build list, row by row in 1.2 s (all at once under prefers-reduced-motion), ending with the "Try it"
// row -- the first "aha". Telemetry: `first_run_completed` (counts and the pack key, never the tickers) and
// `first_run_skipped`.
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useSWRConfig } from 'swr'
import Sheet from '../../../../components/mobile/Sheet'
import usePreferences from '../../../../hooks/usePreferences'
import { claimFirstRunStage } from '../../../../components/firstRun/firstRunStage'
import { NOTEBOOK_EVENTS, trackNotebookEvent } from '../../lib/notebookTelemetry'
import { addMyNames, cleanSymbols, MY_NAMES_LIST } from '../../lib/myNames'
import { installStarterPack, writeStarterPackState, STARTER_PACK_PREF } from '../../lib/starterPacks'
import { STYLES_URL } from '../../lib/journalStyles'
import { DAILY_FOLDER_NOTICE, DAILY_TEMPLATE_PREF, openDailyNote } from '../../lib/dailyNote'
import { invalidateNoteViews } from '../../lib/offline/invalidateNoteViews'
import { FIRST_RUN_MARKS } from '../../lib/firstRun'
import styles from './FirstRunSheet.module.css'

/** M2's words, verbatim where M2 has them. */
export const FIRST_RUN_COPY = Object.freeze({
  title: 'Make the Notebook yours',
  time: 'about 60 seconds',
  skip: 'Skip',
  trade: 'How do you trade?',
  names: "Three tickers you're watching right now",
  promise: 'We use these to fill your daily plan, earnings, and setups. You can change them anytime. Your notes are always yours to export.',
  skipForNow: 'Skip for now',
  build: 'Build my Notebook →',
  building: 'Building…',
  step1: 'Step 1 of 2',
  step2: 'Step 2 of 2',
  done: 'Done',
})

/** M2's five answers, in M2's order. The keys are the starter packs' own (lib/starterPacks.js PACKS). */
export const FIRST_RUN_PACKS = Object.freeze([
  { key: 'swing', label: 'Swing' },
  { key: 'day', label: 'Day' },
  { key: 'options', label: 'Options' },
  { key: 'earnings', label: 'Earnings' },
  { key: 'prop', label: 'Prop / funded' },
])
const packLabel = (key) => FIRST_RUN_PACKS.find((p) => p.key === key)?.label || key

export const MAX_NAMES = 3
const NOOP = () => {}
/** Each step-2 row starts this long after the one before; with a 300 ms fade, four rows land in 1.2 s (<= 1.5 s). */
export const ROW_STAGGER_MS = 300

const GALLERY_URL = '/api/j2/template-gallery'
const SEARCH_URL = '/api/ticker-search'

const reducedMotion = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** The titles a pack adds (the preview), read from the Template library's own list. [] when it cannot be read. */
async function packTitles(pack) {
  try {
    const res = await fetch(`${GALLERY_URL}?type=style&trading_style=${encodeURIComponent(pack)}`, { credentials: 'include' })
    if (!res.ok) return []
    const body = await res.json()
    const rows = Array.isArray(body?.templates) ? body.templates : []
    const firm = rows.filter((t) => t?.kind === 'firm')
    return (firm.length ? firm : rows).map((t) => t?.title).filter((t) => typeof t === 'string' && t).slice(0, 3)
  } catch {
    return []
  }
}

/** Step 1's ticker field: chips, typing, and suggestions from /api/ticker-search (the SymbolSearch backend). */
function NamesField({ names, setNames, disabled }) {
  const uid = useId()
  const [q, setQ] = useState('')
  const [hits, setHits] = useState([])
  const [active, setActive] = useState(-1)
  const inputRef = useRef(null)
  const full = names.length >= MAX_NAMES

  useEffect(() => {
    const term = q.trim().replace(/^\$/, '')
    if (!term || full) { setHits([]); return undefined }
    let alive = true
    const t = setTimeout(() => {
      fetch(`${SEARCH_URL}?q=${encodeURIComponent(term)}&limit=6`, { credentials: 'include' })
        .then((r) => (r.ok ? r.json() : { results: [] }))
        .then((b) => {
          if (!alive) return
          const rows = (Array.isArray(b?.results) ? b.results : []).filter((r) => r?.ticker && !names.includes(r.ticker))
          setHits(rows)
          setActive(rows.length ? 0 : -1)
        })
        .catch(() => { if (alive) setHits([]) })
    }, 150)
    return () => { alive = false; clearTimeout(t) }
  }, [q, full, names])

  const take = (raw) => {
    const [sym] = cleanSymbols([raw])
    if (!sym || names.includes(sym) || full) return
    setNames([...names, sym])
    setQ('')
    setHits([])
    setActive(-1)
    inputRef.current?.focus()
  }
  const onKey = (e) => {
    if (e.key === 'ArrowDown' && hits.length) { e.preventDefault(); setActive((a) => (a + 1) % hits.length) }
    else if (e.key === 'ArrowUp' && hits.length) { e.preventDefault(); setActive((a) => (a <= 0 ? hits.length - 1 : a - 1)) }
    else if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
      if (!q.trim()) return
      e.preventDefault()
      take(active >= 0 && hits[active] ? hits[active].ticker : q)
    } else if (e.key === 'Escape' && hits.length) { e.stopPropagation(); setHits([]) }
    else if (e.key === 'Backspace' && !q && names.length) setNames(names.slice(0, -1))
  }
  const listId = `${uid}-list`
  return (
    <div className={styles.names}>
      <ul className={styles.chips} aria-label="Your tickers">
        {names.map((n) => (
          <li key={n} className={styles.nameChip}>
            {n}
            <button type="button" className={styles.remove} aria-label={`Remove ${n}`} disabled={disabled}
              onClick={() => setNames(names.filter((x) => x !== n))}>×</button>
          </li>
        ))}
      </ul>
      {!full && (
        <div className={styles.combo}>
          <label htmlFor={`${uid}-input`} className="sr-only">Add a ticker</label>
          <input id={`${uid}-input`} ref={inputRef} className={styles.input} value={q} disabled={disabled}
            placeholder={names.length ? 'Add another' : 'NVDA'} autoComplete="off" spellCheck={false}
            role="combobox" aria-expanded={hits.length > 0} aria-controls={listId} aria-autocomplete="list"
            aria-activedescendant={active >= 0 && hits[active] ? `${listId}-${active}` : undefined}
            onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} />
          <ul id={listId} role="listbox" aria-label="Matching tickers" className={styles.listbox} hidden={!hits.length}>
            {hits.map((h, i) => (
              <li key={h.ticker} id={`${listId}-${i}`} role="option" aria-selected={i === active}
                className={i === active ? `${styles.option} ${styles.optionActive}` : styles.option}
                onMouseDown={(e) => { e.preventDefault(); take(h.ticker) }}>
                <span className={styles.optionSym}>{h.ticker}</span>
                {h.name && <span className={styles.optionName}>{h.name}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/**
 * The first run's body: step 1 (the two questions), Build, step 2 (the build list). `variant` is 'sheet' (inside the
 * first-run Sheet) or 'inline' (Home's ask after a Skip). `mark(id)` records a FIRST_RUN_MARKS id on the account.
 */
export function FirstRunFlow({ variant = 'sheet', mark, onSkip, onDone, onOpenNote, startedAt, onBusyChange }) {
  const uid = useId()
  const { mutate } = useSWRConfig()
  const { prefs, setPrefMerged } = usePreferences()
  const [pack, setPack] = useState(null)
  const [preview, setPreview] = useState({})        // pack -> titles
  const [names, setNames] = useState([])
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [undone, setUndone] = useState(false)
  const [status, setStatus] = useState('')
  const [undoing, setUndoing] = useState(false)
  const undoPressed = useRef(false)
  // Review minor 7: while Build runs, the sheet's Escape and ✕ wait for it (FirstRunSheet reads this).
  useEffect(() => { onBusyChange?.(busy) }, [busy, onBusyChange])
  const pressed = useRef(false)
  const t0 = useRef(startedAt ?? Date.now())

  useEffect(() => {
    if (!pack || preview[pack]) return undefined
    let alive = true
    packTitles(pack).then((titles) => { if (alive) setPreview((p) => ({ ...p, [pack]: titles })) })
    return () => { alive = false }
  }, [pack, preview])

  const build = useCallback(async () => {
    if (pressed.current) return                     // a double press builds once
    pressed.current = true
    setBusy(true)
    setStatus(FIRST_RUN_COPY.building)
    const out = { names: null, pack: null, plan: null }
    if (names.length) {
      try { out.names = { ok: true, ...(await addMyNames(names)), symbols: names } } catch { out.names = { ok: false } }
    }
    if (pack) {
      try {
        const got = await installStarterPack(pack)
        await writeStarterPackState((_key, updater) => setPrefMerged(STARTER_PACK_PREF, updater), { state: 'installed', pack })
        mutate(STYLES_URL)
        out.pack = { ok: true, key: pack, installed: got?.installed || [], alreadyHad: got?.alreadyHad || [] }
      } catch {
        out.pack = { ok: false, key: pack }
      }
    }
    try {
      const tid = typeof prefs?.[DAILY_TEMPLATE_PREF] === 'string' && prefs[DAILY_TEMPLATE_PREF] ? prefs[DAILY_TEMPLATE_PREF] : undefined
      // Tier 3b fix round 1 (I9): the day's note starts with the Today home's plan, names included.
      const { note, created = false } = await openDailyNote({ templateId: tid, seedToday: true })
      invalidateNoteViews()
      out.plan = { ok: Boolean(note?.id), note, created }
    } catch {
      out.plan = { ok: false }
    }
    mark?.(FIRST_RUN_MARKS.built)
    trackNotebookEvent(NOTEBOOK_EVENTS.FIRST_RUN_COMPLETED, {
      names: out.names?.ok ? names.length : 0, pack: out.pack?.ok ? pack : 'none', plan: out.plan?.ok === true,
      ms: Date.now() - t0.current,
    })
    setResult(out)
    setStatus('')
    setBusy(false)
  }, [names, pack, prefs, setPrefMerged, mutate, mark])

  const skip = () => {
    trackNotebookEvent(NOTEBOOK_EVENTS.FIRST_RUN_SKIPPED, { step: 1 })
    mark?.(variant === 'inline' ? FIRST_RUN_MARKS.inlineClosed : FIRST_RUN_MARKS.skipped)
    onSkip?.()
  }

  const undoPack = async () => {
    if (undoPressed.current) return                 // review minor 8: a double press removes once
    undoPressed.current = true
    setUndoing(true)
    const ids = (result?.pack?.installed || []).map((i) => i?.styleId).filter(Boolean)
    try {
      for (const id of ids) {
        const res = await fetch(`${STYLES_URL}/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'include' })
        if (!res.ok) throw new Error(String(res.status))
      }
      await writeStarterPackState((_key, updater) => setPrefMerged(STARTER_PACK_PREF, updater), { state: 'dismissed' })
      mutate(STYLES_URL)
      setUndone(true)
      setStatus('Templates removed. They are in Recently deleted if you want them back.')
    } catch {
      undoPressed.current = false                    // a failed undo can be pressed again
      setStatus("Couldn't remove the templates. Try again from Manage templates.")
    } finally {
      setUndoing(false)
    }
  }

  if (result) {
    // Done closes the first run on the Today home when the Notebook has one (S15), else on today's plan; "Open it"
    // opens today's plan; a link that goes elsewhere only closes it.
    const planNote = result.plan?.ok ? result.plan.note : null
    return <BuildList result={result} undone={undone} undoing={undoing} status={status} onUndo={undoPack} names={names}
      onDone={() => onDone?.(planNote, 'done')} onOpen={() => onDone?.(planNote, 'open')}
      onLeave={() => onDone?.(null, 'leave')} canOpen={Boolean(onOpenNote)} />
  }

  const titles = pack ? preview[pack] : null
  return (
    <div className={styles.flow} data-first-run-step="1">
      <p className={styles.meta}>
        <span>{FIRST_RUN_COPY.step1}</span>
        <span aria-hidden="true">·</span>
        <span>{FIRST_RUN_COPY.time}</span>
        <span aria-hidden="true">·</span>
        <button type="button" className={styles.textBtn} onClick={skip} disabled={busy}>{FIRST_RUN_COPY.skip}</button>
      </p>
      <fieldset className={styles.question}>
        <legend className={styles.legend}>{FIRST_RUN_COPY.trade}</legend>
        <div className={styles.packs}>
          {FIRST_RUN_PACKS.map((p) => (
            <button key={p.key} type="button" className={styles.pack} aria-pressed={pack === p.key} disabled={busy}
              onClick={() => setPack(pack === p.key ? null : p.key)}>{p.label}</button>
          ))}
        </div>
        {pack && (
          <p className={styles.previewLine} id={`${uid}-preview`}>
            {titles == null ? 'Checking what it adds…'
              : titles.length ? `Adds ${packLabel(pack)} templates: ${titles.join(' · ')}. You can undo it.`
                : `Adds the ${packLabel(pack)} templates. You can undo it.`}
          </p>
        )}
      </fieldset>
      <div className={styles.question} role="group" aria-labelledby={`${uid}-names`}>
        <p className={styles.legend} id={`${uid}-names`}>{FIRST_RUN_COPY.names}</p>
        <NamesField names={names} setNames={setNames} disabled={busy} />
      </div>
      <p className={styles.promise}>{FIRST_RUN_COPY.promise}</p>
      <div className={styles.actions}>
        <button type="button" className="btn btn-secondary btn-sm" onClick={skip} disabled={busy}>{FIRST_RUN_COPY.skipForNow}</button>
        <button type="button" className="btn btn-primary btn-sm" onClick={build} disabled={busy} aria-busy={busy}>
          {busy ? FIRST_RUN_COPY.building : FIRST_RUN_COPY.build}
        </button>
      </div>
      <p className={styles.status} role="status" aria-live="polite">{status}</p>
    </div>
  )
}

/** Where the first run closes (S15): Done lands on the Today home when the Notebook has one, else on today's plan;
 *  "Open it" always opens today's plan; a link that went elsewhere only closes. */
function closeOnto({ note, how, onOpenNote, onOpenToday }) {
  if (how === 'leave') return
  if (how !== 'open' && onOpenToday) { onOpenToday(); return }
  if (note && onOpenNote) onOpenNote(note)
}

/** Step 2: M2's build list, one row at a time (<= 1.5 s), then Done. */
function BuildList({ result, undone, undoing, status, onUndo, onDone, onOpen, onLeave, canOpen, names }) {
  const headRef = useRef(null)
  const rows = []
  const n = result.names
  if (n?.ok) {
    rows.push(n.created
      ? `Watchlist "${MY_NAMES_LIST}" created with ${n.symbols.join(', ')}`
      : `Watchlist "${MY_NAMES_LIST}" now has ${n.symbols.join(', ')}`)
  } else if (n && !n.ok) rows.push("Couldn't save your tickers. Add them anytime in the Daily brief's Your names card.")
  else rows.push("No tickers yet. Add them anytime in the Daily brief's Your names card.")
  const p = result.pack
  if (p?.ok) {
    const added = p.installed.map((i) => i?.title).filter(Boolean)
    const label = packLabel(p.key)
    rows.push(added.length
      ? { text: `${label} templates added: ${added.join(' · ')}`, pack: true }
      : `${label} templates: you already have ${p.alreadyHad.join(' · ') || 'them'}`)
  } else if (p && !p.ok) rows.push("Couldn't add the templates. Nothing was added twice; try again from Manage templates.")
  const plan = result.plan
  rows.push(plan?.ok
    ? { text: `Today's plan written${plan.created ? `. ${DAILY_FOLDER_NOTICE}` : ''}`, plan: true }
    : "Couldn't write today's plan. Open today's note from the notes list to try again.")
  const sym = names[0] || 'NVDA'
  rows.push({ text: `Try it: draw entry, stop and target on ${sym}, and watch the setups board track it →`, tryIt: sym })

  const [shown, setShown] = useState(() => (reducedMotion() ? rows.length : 1))
  useEffect(() => {
    if (shown >= rows.length) return undefined
    const t = setTimeout(() => setShown((s) => s + 1), ROW_STAGGER_MS)
    return () => clearTimeout(t)
  }, [shown, rows.length])
  // Review minor 12: focus goes to the step's heading as soon as step 2 opens (the Build button that held it has gone),
  // and the rows are read as they land (the list is a polite live region). Focus is never moved again after that.
  useEffect(() => { headRef.current?.focus() }, [])

  return (
    <div className={styles.flow} data-first-run-step="2">
      <h3 className={styles.meta} ref={headRef} tabIndex={-1}>{FIRST_RUN_COPY.step2}</h3>
      <ul className={styles.built} aria-label="What was built" aria-live="polite">
        {rows.slice(0, shown).map((r, i) => {
          const row = typeof r === 'string' ? { text: r } : r
          return (
            <li key={row.text} className={styles.builtRow} data-row={i}>
              {row.tryIt ? (
                <Link className={styles.tryIt} to={`/journal/notebook/research/${encodeURIComponent(row.tryIt)}`}
                  onClick={() => onLeave?.()}>{row.text}</Link>
              ) : <span>{row.text}</span>}
              {row.pack && !undone && (
                <span className={styles.rowActions}>
                  {' ('}
                  <Link className={styles.textBtn} to="/journal/notebook?styles=1" onClick={() => onLeave?.()}>preview</Link>
                  {' · '}
                  <button type="button" className={styles.textBtn} onClick={onUndo} disabled={undoing}>undo</button>
                  {')'}
                </span>
              )}
              {row.plan && plan.note && canOpen && (
                <span className={styles.rowActions}>
                  {' '}
                  <button type="button" className={styles.textBtn} onClick={onOpen}>Open it</button>
                </span>
              )}
            </li>
          )
        })}
      </ul>
      <div className={styles.actions}>
        <button type="button" className="btn btn-primary btn-sm" onClick={onDone}>{FIRST_RUN_COPY.done}</button>
      </div>
      <p className={styles.status} role="status" aria-live="polite">{status}</p>
    </div>
  )
}

/** The first-run sheet (first visit, or Settings). It holds the first-run stage while open, so the Compass card and a
 *  tour offer wait for it. */
export default function FirstRunSheet({ open = true, onClose, onOpenNote, onOpenToday, mark }) {
  const startedAt = useRef(Date.now())
  useEffect(() => (open ? claimFirstRunStage() : undefined), [open])
  // Closing by Escape or the ✕ is a Skip: it is recorded as one, so Home asks inline.
  const closeAsSkip = () => {
    trackNotebookEvent(NOTEBOOK_EVENTS.FIRST_RUN_SKIPPED, { step: 1 })
    mark?.(FIRST_RUN_MARKS.skipped)
    onClose?.()
  }
  const [built, setBuilt] = useState(false)
  const [building, setBuilding] = useState(false)
  const markWrap = useCallback((id) => {
    if (id === FIRST_RUN_MARKS.built) setBuilt(true)
    mark?.(id)
  }, [mark])
  return (
    // Review minor 7: Escape or ✕ while Build runs does nothing (the build finishes and step 2 shows what was made);
    // never a Skip recorded over a build.
    <Sheet open={open} onClose={building ? NOOP : built ? onClose : closeAsSkip} title={FIRST_RUN_COPY.title} ariaLabel={FIRST_RUN_COPY.title} maxWidth={520}>
      {open && (
        <FirstRunFlow variant="sheet" mark={markWrap} startedAt={startedAt.current} onOpenNote={onOpenNote} onBusyChange={setBuilding}
          onSkip={onClose} onDone={(note, how) => { onClose?.(); closeOnto({ note, how, onOpenNote, onOpenToday }) }} />
      )}
    </Sheet>
  )
}

/** Home's inline ask after a Skip (S16 -> S17): the same two questions, in the page, with a way to close it. */
export function FirstRunInline({ mark, onOpenNote, onOpenToday, onClose }) {
  const uid = useId()
  return (
    <section className={styles.inline} aria-labelledby={`${uid}-title`} data-first-run-inline="">
      <h2 id={`${uid}-title`} className={styles.inlineTitle}>{FIRST_RUN_COPY.title}</h2>
      <FirstRunFlow variant="inline" mark={mark} onOpenNote={onOpenNote} onSkip={onClose}
        onDone={(note, how) => { onClose?.(); closeOnto({ note, how, onOpenNote, onOpenToday }) }} />
    </section>
  )
}

// Notebook import wizard — drop an export (Notion/Obsidian/Evernote/plain
// files, zipped or not) -> auto-detect -> preview -> commit -> summary.
// Spec: docs/superpowers/specs/2026-08-11-notebook-import-design.md (Task 14)
//
// Every `lib/importer/*` module is loaded via a dynamic `import()` INSIDE the
// handlers below, on purpose: those modules pull in fflate/markdown-it/
// mammoth/tiptap's `generateJSON`, which would otherwise ride along in the
// Notebook tab's main chunk for every user who never imports anything.
import { Component, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import Sheet from '../../../../../components/mobile/Sheet'
import UIcon from '../../../../../components/ui/UIcon'
import { useIsTouch } from '../../../../../hooks/useBreakpoint'
import useJ2NoteFolders from '../../../hooks/useJ2NoteFolders'
import ConnectTilesCompact from '../../connectors/ConnectTilesCompact'
import ExportGuide from './ExportGuide'
import styles from './ImportWizard.module.css'

// ---------------------------------------------------------------------------
// Best-effort client-side content hash — used ONLY to estimate the
// "unchanged" bucket in the preview. The confirm endpoint computes its own
// SHA-256 fingerprint server-side (api/services/journal_two/notes.py
// `_import_payload_hash`) and that is what actually decides create/update/
// skip; this is a UX estimate, not a source of truth, so any mismatch just
// shows a doc as "update" instead of "unchanged" — never the reverse.
// ---------------------------------------------------------------------------

function jsonStringEscape(s) {
  let out = '"'
  for (const ch of s) {
    const code = ch.codePointAt(0)
    if (ch === '"') out += '\\"'
    else if (ch === '\\') out += '\\\\'
    else if (code === 0x08) out += '\\b'
    else if (code === 0x0c) out += '\\f'
    else if (code === 0x0a) out += '\\n'
    else if (code === 0x0d) out += '\\r'
    else if (code === 0x09) out += '\\t'
    else if (code < 0x20 || code > 0x7e) {
      if (code > 0xffff) {
        const c = code - 0x10000
        const hi = 0xd800 + (c >> 10)
        const lo = 0xdc00 + (c & 0x3ff)
        out += `\\u${hi.toString(16).padStart(4, '0')}\\u${lo.toString(16).padStart(4, '0')}`
      } else {
        out += `\\u${code.toString(16).padStart(4, '0')}`
      }
    } else {
      out += ch
    }
  }
  return `${out}"`
}

function canonicalJson(value) {
  if (value === null || value === undefined) return 'null'
  const t = typeof value
  if (t === 'number' || t === 'boolean') return JSON.stringify(value)
  if (t === 'string') return jsonStringEscape(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (t === 'object') {
    const keys = Object.keys(value).sort()
    return `{${keys.map((k) => `${jsonStringEscape(k)}:${canonicalJson(value[k])}`).join(',')}}`
  }
  return 'null'
}

async function computeImportHash(doc) {
  if (!globalThis.crypto?.subtle) return null
  const basis = canonicalJson({
    title: doc.title || '',
    subtitle: doc.subtitle || null,
    bodyJson: doc.bodyJson || {},
    tags: [...(doc.tags || [])].sort(),
    ticker: doc.ticker || null,
    folderPath: doc.folderPath || [],
    updatedAt: doc.updatedAt || '',
  })
  try {
    const bytes = new TextEncoder().encode(basis)
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
  } catch {
    return null
  }
}

async function classifyDocs(docs, existingMap) {
  const status = {}
  for (const doc of docs) {
    const ex = existingMap[doc.importKey]
    if (!ex) { status[doc.importKey] = 'create'; continue }
    const hash = ex.importHash ? await computeImportHash(doc) : null
    status[doc.importKey] = hash && hash === ex.importHash ? 'unchanged' : 'update'
  }
  return status
}

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

function hasLikelyArchive(fileList) {
  return [...(fileList || [])].some((f) => /\.zip$/i.test(f?.name || ''))
}

function readableError(err) {
  if (err?.name === 'ImportLimitError') return err.message
  return `Something went wrong while reading your files: ${err?.message || String(err)}`
}

function phaseLabel(phase) {
  if (phase === 'convert') return 'Converting notes'
  if (phase === 'confirm') return 'Saving notes'
  if (phase === 'commit') return 'Uploading media & links'
  return 'Working'
}

function pluralize(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

// A member migrating a decade of Evernote/Notion arrives with thousands of
// notes (measured: 5,000 unvirtualized rows stalled every checkbox click for
// several seconds and froze the tab mid-render — Task 3,
// docs/superpowers/plans/2026-09-02-closing-the-transfer-gap.md). The notes
// list below is virtualized specifically for that reason: only the rows
// scrolled into view are ever mounted, so the DOM node count — and the cost
// of every single checkbox toggle — stays flat regardless of import size.
// Fixed row heights (not `measureElement`) match the existing virtualized
// idiom in `pages/screener/shell/VirtualResults.jsx`; titles are truncated
// to one line (`.noteTitle`) so a real height never disagrees with these.
// ⛔ Touch tier is <=1024px, NOT <=640px (see CLAUDE.md) — the CSS module's
// own `@media (max-width: 1024px)` block floors `.noteRow`/`.groupBulkBtn` to
// the 44px tap target, so the estimate must switch with `useIsTouch()` or a
// touch viewport's REAL rows (44px) disagree with the virtualizer's assumed
// height and start overlapping.
const NOTE_ROW_H = 28
const NOTE_ROW_H_TOUCH = 44
const NOTE_HEADER_H = 34
const NOTE_HEADER_H_TOUCH = 44

// ---------------------------------------------------------------------------
// error boundary — a conversion crash must not take down the Notebook tab
// ---------------------------------------------------------------------------

class ImportWizardBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('ImportWizard crashed', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div className={styles.crash}>
          <UIcon name="warning" size={26} gold={false} className={styles.crashIcon} />
          <p>Something went wrong while importing.</p>
          <p className={styles.crashDetail}>
            {String(this.state.error?.message || this.state.error)}
          </p>
          <button type="button" className="btn btn-secondary" onClick={this.props.onClose}>
            Close
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

// ---------------------------------------------------------------------------
// main component
// ---------------------------------------------------------------------------

export default function ImportWizard({ open, onClose, onImported }) {
  const isTouch = useIsTouch()
  const { folders, create: createFolder } = useJ2NoteFolders()

  const [step, setStep] = useState('drop') // drop | scanning | preview | running | summary | error
  const [scanMessage, setScanMessage] = useState('')
  const [error, setError] = useState(null)
  const [guideOpen, setGuideOpen] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  const [sourceLabel, setSourceLabel] = useState('')
  const [docs, setDocs] = useState([])
  const [docStatus, setDocStatus] = useState({})
  const [warnings, setWarnings] = useState([])
  const [excludedFolders, setExcludedFolders] = useState(() => new Set())
  // Per-note exclusion — the finer-grained sibling of excludedFolders. Keyed
  // by importKey (stable across a re-scan of the same source), holding the
  // notes the member unchecked INSIDE a folder that is otherwise kept. Both
  // sets are separate axes that meet in ONE place (`visibleDocs` below) —
  // there is no second "what to send" payload anywhere downstream of it.
  const [excludedNotes, setExcludedNotes] = useState(() => new Set())
  const [destChoice, setDestChoice] = useState('__new__')

  const [progress, setProgress] = useState(null)
  const [summaryResult, setSummaryResult] = useState(null)

  // ── post-migration enrichment (spec §8.1) ────────────────────────────────
  // `enrichScan`: null (not yet run) | {status: 'scanning'|'ready'|'none', candidates, scanned}
  // `enrichApply`: null | {status: 'applying'|'done'|'undoing'|'undone', done, total, records, failures}
  // `records` holds {noteId, ticker, bodyAfter} — `bodyAfter` is exactly what
  // `addChartEmbed` returned, which is what `revertChartEmbed` needs to undo
  // ONLY that one append (see lib/importer/enrichment.js).
  const [enrichScan, setEnrichScan] = useState(null)
  const [enrichApply, setEnrichApply] = useState(null)

  const fileInputRef = useRef(null)
  const dirInputRef = useRef(null)
  const notesListRef = useRef(null)

  // Cancel token for the async scan/confirm pipelines. Sheet's Escape handler
  // (and the backdrop, when enabled) call onClose unconditionally — if that
  // happens mid-scan or mid-confirm, `open` flips false, resetAll() bumps this
  // ref, and the still-in-flight pipeline (which is running against the SAME
  // mounted component instance, not a fresh one) checks it after every await
  // and bails before touching state again. Without this, a cancelled scan can
  // still land setDocs/setStep('preview') — or worse, a cancelled confirm can
  // still call onImported — after the user believed they'd backed out.
  const generationRef = useRef(0)

  const resetAll = useCallback(() => {
    generationRef.current += 1
    setStep('drop')
    setScanMessage('')
    setError(null)
    setGuideOpen(false)
    setDragOver(false)
    setSourceLabel('')
    setDocs([])
    setDocStatus({})
    setWarnings([])
    setExcludedFolders(new Set())
    setExcludedNotes(new Set())
    setDestChoice('__new__')
    setProgress(null)
    setSummaryResult(null)
    setEnrichScan(null)
    setEnrichApply(null)
  }, [])

  // Fresh state every time the wizard is reopened.
  useEffect(() => {
    if (!open) resetAll()
  }, [open, resetAll])

  // Sheet calls this unconditionally on Escape (it doesn't consult
  // dismissOnBackdrop) — no-op it during scanning/running so Escape can't
  // race the pipeline the same way the backdrop guard already prevents a
  // stray click from doing.
  const handleSheetClose = useCallback(() => {
    if (step === 'scanning' || step === 'running') return
    onClose?.()
  }, [step, onClose])

  // ── scan pipeline (drop -> preview) ──────────────────────────────────────

  const beginScan = useCallback(async (getExpanded, archiveHint) => {
    const gen = generationRef.current
    const cancelled = () => generationRef.current !== gen

    setStep('scanning')
    setError(null)
    // Render the scanning state FIRST, then defer the heavy work past a
    // paint — expandArchives runs unzipSync synchronously and can freeze the
    // tab for the duration of a large export with no chance to repaint.
    setScanMessage(archiveHint
      ? 'Unpacking archive — this can take a moment for large exports…'
      : 'Reading your files…')
    await new Promise((r) => setTimeout(r, 0))
    if (cancelled()) return
    try {
      const { files: vfiles, warnings: expandWarnings } = await getExpanded()
      if (cancelled()) return

      const { detectAdapter } = await import('../../../lib/importer/registry')
      const { adapter } = await detectAdapter(vfiles)
      if (cancelled()) return
      setScanMessage(`Reading ${adapter.label}…`)

      const { docs: rawDocs, warnings: parseWarnings } = await adapter.parse(vfiles, {
        onProgress: (p) => {
          if (cancelled()) return
          setScanMessage(`Reading ${adapter.label} — ${p.done}/${p.total}…`)
        },
      })
      if (cancelled()) return

      // The preview only needs a title/folder/verdict per note — full HTML ->
      // TipTap body conversion (`htmlToNote`, the real per-note cost: a
      // DOMParser sanitize pass + `generateJSON`) is NOT one of those, and
      // measured (profile below) it was the entire two-minute stall: a
      // 5,000-note first-time import converted every body up front, before
      // even asking the server which importKeys already exist. A 'create'
      // verdict (no existing note to compare against — the common case for
      // exactly the decade-of-history import this is about) needs no
      // fingerprint at all; only a genuine re-import match needs the hash
      // that `classifyDocs` computes FROM a converted body. So: check
      // existing-ness first (importKey only, no bodyJson needed), convert
      // ONLY the notes that need a hash to decide update-vs-unchanged, and
      // leave the rest unconverted — `bodyJson` is filled in lazily, per
      // visible note, right before confirm (see handleConfirm), so a note
      // the member excludes on this screen never pays this cost at all.
      const { checkExisting } = await import('../../../lib/importer/commit')
      const { existing, truncated, checked, total } = await checkExisting(rawDocs)
      if (cancelled()) return
      // audit B1: the server tells us honestly when it could not check every
      // note for a duplicate — surface that instead of letting the tail
      // silently reclassify as "create" and duplicate an existing note.
      const checkWarnings = truncated
        ? [`Only the first ${checked.toLocaleString()} of ${total.toLocaleString()} notes could be ` +
           'checked against your existing notebook — the rest will import as new notes even if ' +
           'they already exist. Re-run the import afterward to catch any duplicates.']
        : []

      const { htmlToNote } = await import('../../../lib/importer/convert')
      if (cancelled()) return
      const needsHash = rawDocs.filter((d) => existing[d.importKey]?.importHash)
      let hashed = 0
      for (const doc of needsHash) {
        const { bodyJson, bodyPlain } = htmlToNote(doc.html)
        doc.bodyJson = bodyJson
        doc.bodyPlain = bodyPlain
        hashed += 1
        if (hashed % 10 === 0) {
          setScanMessage(`Checking ${hashed}/${needsHash.length} against your existing notes…`)
          await new Promise((r) => setTimeout(r))
          if (cancelled()) return
        }
      }

      const status = await classifyDocs(rawDocs, existing)
      if (cancelled()) return

      setDocs(rawDocs)
      setDocStatus(status)
      setWarnings([...expandWarnings, ...parseWarnings, ...checkWarnings])
      setSourceLabel(adapter.label)
      setExcludedFolders(new Set())
      setExcludedNotes(new Set())
      setStep('preview')
    } catch (err) {
      if (cancelled()) return
      setError(readableError(err))
      setStep('error')
    }
  }, [])

  const handleInputFiles = useCallback(async (fileList) => {
    if (!fileList || fileList.length === 0) return
    const archiveHint = hasLikelyArchive(fileList)
    await beginScan(async () => {
      const intake = await import('../../../lib/importer/intake')
      const vfiles0 = intake.fromFileList(fileList)
      return intake.expandArchives(vfiles0)
    }, archiveHint)
  }, [beginScan])

  const handleNativeDrop = useCallback(async (dataTransfer) => {
    if (!dataTransfer) return
    const archiveHint = hasLikelyArchive(dataTransfer.files)
    await beginScan(async () => {
      const intake = await import('../../../lib/importer/intake')
      const vfiles0 = await intake.collectDropped(dataTransfer)
      return intake.expandArchives(vfiles0)
    }, archiveHint)
  }, [beginScan])

  // ── drag & drop handlers (dropzone) ──────────────────────────────────────

  const onDragEnter = (e) => {
    if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); setDragOver(true) }
  }
  const onDragOver = (e) => {
    if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); setDragOver(true) }
  }
  const onDragLeave = (e) => {
    if (e.currentTarget.contains(e.relatedTarget)) return
    setDragOver(false)
  }
  const onDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    handleNativeDrop(e.dataTransfer)
  }

  // ── derived preview data ─────────────────────────────────────────────────

  const topFolders = useMemo(() => {
    const set = new Set()
    for (const d of docs) if (d.folderPath?.length) set.add(d.folderPath[0])
    return [...set].sort()
  }, [docs])

  // Folder exclusion first (whole-folder axis) — this is what the "Skip
  // folders" checkboxes drive.
  const folderFilteredDocs = useMemo(
    () => docs.filter((d) => !(d.folderPath?.length && excludedFolders.has(d.folderPath[0]))),
    [docs, excludedFolders]
  )

  // The set that actually gets imported: folder exclusion AND per-note
  // exclusion compose HERE, and only here. previewCounts/mediaCount/
  // folderCount and the confirm payload (`handleConfirm` below) all read
  // this same value, so there is exactly one definition of "what's
  // excluded" for the whole preview step — never a second list to drift.
  const visibleDocs = useMemo(
    () => folderFilteredDocs.filter((d) => !excludedNotes.has(d.importKey)),
    [folderFilteredDocs, excludedNotes]
  )

  const previewCounts = useMemo(() => {
    const c = { create: 0, update: 0, unchanged: 0 }
    for (const d of visibleDocs) {
      const s = docStatus[d.importKey] || 'create'
      c[s] += 1
    }
    return c
  }, [visibleDocs, docStatus])

  const mediaCount = useMemo(
    () => visibleDocs.reduce((n, d) => n + (d.media?.length || 0), 0),
    [visibleDocs]
  )
  const folderCount = useMemo(() => {
    const set = new Set()
    for (const d of visibleDocs) if (d.folderPath?.length) set.add(d.folderPath.join('/'))
    return set.size
  }, [visibleDocs])

  // Notes the member excluded on the preview screen (a folder unchecked, or
  // a note unchecked individually) — a deliberate choice, not something that
  // went wrong. Named on the arrival screen anyway (spec §9: "is it *all*
  // here?") so the counts on that screen always reconcile against `docs`.
  const excludedCount = docs.length - visibleDocs.length

  // The arrival screen's per-folder breakdown (spec §9: "counts by
  // notebook/folder"). DERIVED, at render time, from the same two values the
  // rest of the summary reads — `visibleDocs` (what was actually submitted)
  // crossed with `summaryResult.outcomes` (what the server actually did with
  // each one) — never restated from the preview's pre-import `docStatus`
  // guess, which can disagree with reality (a 'create' can still fail).
  // `arrived + unchanged + attention` always sums to the folder's row count;
  // a note with no server-reported outcome yet (summaryResult is null,
  // mid-run) simply isn't counted anywhere until it resolves.
  const folderBreakdown = useMemo(() => {
    if (!summaryResult) return []
    const map = new Map()
    for (const d of visibleDocs) {
      const label = d.folderPath?.length ? d.folderPath.join(' / ') : 'Unfiled'
      if (!map.has(label)) map.set(label, { label, arrived: 0, unchanged: 0, attention: 0 })
      const bucket = map.get(label)
      const outcome = summaryResult.outcomes?.[d.importKey]
      if (outcome === 'created' || outcome === 'updated') bucket.arrived += 1
      else if (outcome === 'skipped') bucket.unchanged += 1
      else if (outcome === 'failed' || outcome === 'batch_failed') bucket.attention += 1
    }
    return [...map.values()].sort((a, b) => a.label.localeCompare(b.label))
  }, [visibleDocs, summaryResult])

  const rootFolders = useMemo(() => folders.filter((f) => !f.parentId), [folders])

  const importedFolderName = sourceLabel ? `Imported from ${sourceLabel}` : ''
  const existingImportedFolder = useMemo(
    () => rootFolders.find((f) => f.name === importedFolderName) || null,
    [rootFolders, importedFolderName]
  )

  // Once a root folder already named "Imported from {label}" is known (e.g. a
  // re-import of the same source), snap the still-default '__new__' choice to
  // it so the select shows the REAL folder as selected instead of a
  // duplicate-looking "create new" option pointing at a name that already
  // exists. Only auto-switches away from the untouched default — never
  // overrides an explicit user pick.
  useEffect(() => {
    if (step !== 'preview' || destChoice !== '__new__' || !existingImportedFolder) return
    setDestChoice(existingImportedFolder.id)
  }, [step, destChoice, existingImportedFolder])

  const toggleExcludeFolder = (name) => {
    setExcludedFolders((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  // Notes grouped for the per-note picker, built from `folderFilteredDocs`
  // (NOT `docs`) — a note inside an already-excluded folder never shows up
  // here at all, so there is only ever one control that can exclude it.
  const noteGroups = useMemo(() => {
    const map = new Map()
    for (const d of folderFilteredDocs) {
      const key = d.folderPath?.length ? d.folderPath.join('/') : '__unfiled__'
      const label = d.folderPath?.length ? d.folderPath.join(' / ') : 'Unfiled'
      if (!map.has(key)) map.set(key, { key, label, docs: [] })
      map.get(key).docs.push(d)
    }
    return [...map.values()].sort((a, b) => a.label.localeCompare(b.label))
  }, [folderFilteredDocs])

  // The virtualizer needs one flat, index-addressable array — group headers
  // and note rows interleaved in display order — rather than the nested
  // noteGroups shape above, which is what a non-virtualized `.map().map()`
  // wants instead. Same data, two views; noteGroups stays because the bulk
  // "All"/"None" handlers close over `group.docs`.
  const flatNoteItems = useMemo(() => {
    const out = []
    for (const group of noteGroups) {
      out.push({ type: 'header', key: `h:${group.key}`, group })
      for (const d of group.docs) out.push({ type: 'note', key: d.importKey, doc: d, group })
    }
    return out
  }, [noteGroups])

  const noteRowH = isTouch ? NOTE_ROW_H_TOUCH : NOTE_ROW_H
  const noteHeaderH = isTouch ? NOTE_HEADER_H_TOUCH : NOTE_HEADER_H
  const rowVirtualizer = useVirtualizer({
    count: flatNoteItems.length,
    getScrollElement: () => notesListRef.current,
    estimateSize: (i) => (flatNoteItems[i]?.type === 'header' ? noteHeaderH : noteRowH),
    overscan: 12,
    // @tanstack/virtual-core's DEFAULT observeElementRect reads
    // offsetWidth/offsetHeight once, synchronously, then relies on
    // ResizeObserver for anything after — and jsdom both reports 0 for those
    // (no real layout engine) AND this repo's global test-setup stubs
    // ResizeObserver as a permanent no-op, so the default locks onto a 0×0
    // viewport forever and getVirtualItems() comes back empty: every note
    // row silently vanishes under vitest even though the data is there. A
    // real browser always measures `.notesList`'s genuine size (CSS caps it
    // at 280px) well before this matters, so falling back to an assumed
    // size only ever engages where there is truly nothing real to measure.
    observeElementRect: (instance, cb) => {
      const element = instance.scrollElement
      if (!element) return undefined
      const read = () => {
        const rect = element.getBoundingClientRect()
        cb({ width: rect.width || 400, height: rect.height || 4000 })
      }
      read()
      const RO = instance.targetWindow?.ResizeObserver
      if (!RO) return () => {}
      const observer = new RO(() => read())
      observer.observe(element)
      return () => observer.unobserve(element)
    },
  })

  const toggleExcludeNote = (importKey) => {
    setExcludedNotes((prev) => {
      const next = new Set(prev)
      if (next.has(importKey)) next.delete(importKey)
      else next.add(importKey)
      return next
    })
  }

  const selectAllNotes = () => setExcludedNotes(new Set())
  const selectNoNotes = () => setExcludedNotes(new Set(folderFilteredDocs.map((d) => d.importKey)))

  const selectAllInGroup = (groupDocs) => {
    setExcludedNotes((prev) => {
      const next = new Set(prev)
      for (const d of groupDocs) next.delete(d.importKey)
      return next
    })
  }
  const selectNoneInGroup = (groupDocs) => {
    setExcludedNotes((prev) => {
      const next = new Set(prev)
      for (const d of groupDocs) next.add(d.importKey)
      return next
    })
  }

  // ── confirm (preview -> running -> summary) ──────────────────────────────

  const lookupFolderIdByName = useCallback(async (name) => {
    try {
      const res = await fetch('/api/j2/note-folders', { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        const match = (data.folders || []).filter((f) => f.name === name && !f.parentId).pop()
        if (match) return match.id
      }
    } catch {
      // best-effort — fall through to unfiled
    }
    return null
  }, [])

  const resolveDestFolderId = useCallback(async () => {
    if (destChoice !== '__new__') return destChoice || null
    const name = `Imported from ${sourceLabel}`
    // Check what we already have BEFORE creating — this is the whole fix for
    // "re-importing the same source misfiles every note to Unfiled": a second
    // import of the same source reuses the "Imported from {label}" folder the
    // FIRST import created, rather than trying (and 400ing on the name
    // collision) to create it again.
    const already = rootFolders.find((f) => f.name === name)
    if (already) return already.id
    try {
      await createFolder(name)
    } catch {
      // Creation failed — most likely a race where the folder was created
      // between our `rootFolders` read and now (or the backend 400'd on a
      // name collision it saw that we didn't). Look it up rather than giving
      // up and silently routing the whole batch to Unfiled.
      return lookupFolderIdByName(name)
    }
    // useJ2NoteFolders().create() doesn't return the created row (it POSTs
    // then revalidates via SWR mutate()) — read it back by name.
    return lookupFolderIdByName(name)
  }, [destChoice, sourceLabel, rootFolders, createFolder, lookupFolderIdByName])

  const handleConfirm = useCallback(async () => {
    const gen = generationRef.current
    const cancelled = () => generationRef.current !== gen

    setStep('running')
    setProgress(null)
    await new Promise((r) => setTimeout(r, 0))
    if (cancelled()) return
    try {
      // Bodies deferred out of the scan step (see beginScan) get converted
      // here, lazily, over ONLY the notes the member is actually importing
      // (`visibleDocs` — folder exclusion + per-note exclusion already
      // applied). Anything excluded on the preview screen never pays this
      // cost at all. Real, honest progress (not a spinner) for whatever
      // conversion work is left — this is the "the wait is real" case: the
      // server needs every imported note's bodyJson, so this cannot be
      // skipped, only moved to the point it's actually needed.
      const needsBody = visibleDocs.filter((d) => !d.bodyJson)
      if (needsBody.length > 0) {
        const { htmlToNote } = await import('../../../lib/importer/convert')
        if (cancelled()) return
        let done = 0
        for (const doc of needsBody) {
          const { bodyJson, bodyPlain } = htmlToNote(doc.html)
          doc.bodyJson = bodyJson
          doc.bodyPlain = bodyPlain
          done += 1
          if (done % 10 === 0 || done === needsBody.length) {
            setProgress({ phase: 'convert', done, total: needsBody.length })
            await new Promise((r) => setTimeout(r))
            if (cancelled()) return
          }
        }
        setProgress(null)
      }

      const destFolderId = await resolveDestFolderId()
      if (cancelled()) return
      const { runImport } = await import('../../../lib/importer/commit')
      if (cancelled()) return
      const result = await runImport({
        source: sourceLabel,
        destFolderId,
        docs: visibleDocs,
        onProgress: (p) => {
          if (cancelled()) return
          setProgress(p)
        },
      })
      if (cancelled()) return
      setSummaryResult(result)
      setStep('summary')
      onImported?.()
    } catch (err) {
      if (cancelled()) return
      setError(readableError(err))
      setStep('error')
    }
  }, [resolveDestFolderId, sourceLabel, visibleDocs, onImported])

  // ── post-migration enrichment (spec §8.1) ────────────────────────────────
  // Fires once per completed import, automatically — it is a READ-ONLY scan
  // (no note is touched), so there is nothing to opt into yet at this point.
  // The opt-in gate is `handleApplyEnrichment` below, which is the one thing
  // that actually writes anything.
  useEffect(() => {
    if (step !== 'summary' || !summaryResult || enrichScan !== null) return
    const ids = summaryResult.importedNoteIds || []
    if (ids.length === 0) {
      setEnrichScan({ status: 'none', candidates: [], scanned: 0 })
      return
    }
    const gen = generationRef.current
    setEnrichScan({ status: 'scanning', candidates: [], scanned: 0 })
    ;(async () => {
      try {
        const { scanForTickers } = await import('../../../lib/importer/enrichment')
        const result = await scanForTickers(ids)
        if (generationRef.current !== gen) return
        setEnrichScan({ status: result.candidates.length > 0 ? 'ready' : 'none', ...result })
      } catch {
        // Best-effort: a failed scan just means no offer this time — it is
        // never worth blocking or re-litigating the arrival screen over.
        if (generationRef.current !== gen) return
        setEnrichScan({ status: 'none', candidates: [], scanned: 0 })
      }
    })()
  }, [step, summaryResult, enrichScan])

  const handleDismissEnrichment = useCallback(() => {
    setEnrichScan((prev) => (prev ? { ...prev, status: 'dismissed' } : prev))
  }, [])

  // Opt-in, one click, per-(note,ticker) — a note mentioning two tickers
  // gets two charts. Every success is recorded with the doc `addChartEmbed`
  // returned (`bodyAfter`), which is exactly what `handleUndoEnrichment`
  // needs to reverse ONLY that append (see lib/importer/enrichment.js).
  const handleApplyEnrichment = useCallback(async () => {
    if (!enrichScan || enrichScan.status !== 'ready' || enrichScan.candidates.length === 0) return
    const gen = generationRef.current
    const jobs = []
    for (const c of enrichScan.candidates) {
      for (const ticker of c.tickers) jobs.push({ noteId: c.id, title: c.title, ticker })
    }
    setEnrichApply({ status: 'applying', done: 0, total: jobs.length, records: [], failures: [] })
    const { addChartEmbed } = await import('../../../lib/importer/enrichment')
    const records = []
    const failures = []
    for (const job of jobs) {
      try {
        const bodyAfter = await addChartEmbed(job.noteId, job.ticker)
        records.push({ noteId: job.noteId, ticker: job.ticker, bodyAfter })
      } catch (err) {
        failures.push({ name: `${job.title} (${job.ticker})`, reason: err?.message || String(err) })
      }
      if (generationRef.current !== gen) return
      setEnrichApply({ status: 'applying', done: records.length + failures.length, total: jobs.length,
        records: [...records], failures: [...failures] })
    }
    if (generationRef.current !== gen) return
    setEnrichApply({ status: 'done', done: jobs.length, total: jobs.length, records, failures })
  }, [enrichScan])

  // A real undo: PUTs every touched note back to its exact pre-enrichment
  // body (see lib/importer/enrichment.js::revertChartEmbed), not a client-
  // side hide. Available as long as this screen is open.
  const handleUndoEnrichment = useCallback(async () => {
    if (!enrichApply || enrichApply.records.length === 0) return
    const gen = generationRef.current
    setEnrichApply((prev) => ({ ...prev, status: 'undoing' }))
    const { revertChartEmbed } = await import('../../../lib/importer/enrichment')
    const undoFailures = []
    for (const rec of enrichApply.records) {
      try {
        await revertChartEmbed(rec.noteId, rec.bodyAfter)
      } catch (err) {
        undoFailures.push({ name: rec.ticker, reason: err?.message || String(err) })
      }
    }
    if (generationRef.current !== gen) return
    setEnrichApply((prev) => ({ ...prev, status: 'undone', undoFailures }))
  }, [enrichApply])

  const importTotal = previewCounts.create + previewCounts.update

  const sheetTitle = {
    drop: 'Import notes',
    scanning: 'Import notes',
    preview: 'Review your import',
    running: 'Importing…',
    summary: 'Import complete',
    error: 'Import notes',
  }[step]

  return (
    <Sheet
      open={open}
      onClose={handleSheetClose}
      variant={isTouch ? 'fullscreen' : 'modal'}
      title={sheetTitle}
      maxWidth={640}
      dismissOnBackdrop={step !== 'scanning' && step !== 'running'}
    >
      <ImportWizardBoundary onClose={onClose}>
        <div className={styles.wrap}>
          {step === 'drop' && (
            <div className={styles.dropWrap}>
              <ConnectTilesCompact />
              <div
                className={`${styles.dropzone} ${dragOver ? styles.dropzoneActive : ''}`}
                onDragEnter={onDragEnter}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
              >
                <UIcon name="download" size={30} className={styles.dropIcon} />
                <p className={styles.dropTitle}>Drop your export here</p>
                <p className={styles.dropHint}>
                  A zip, a folder, or individual files — Notion, Obsidian, Evernote, or plain
                  Markdown / Text / HTML / Word.
                </p>
                <div className={styles.dropButtons}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <UIcon name="document" size={16} gold={false} />
                    Choose files
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => dirInputRef.current?.click()}
                  >
                    <UIcon name="library" size={16} gold={false} />
                    Choose a folder
                  </button>
                </div>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                multiple
                data-testid="import-file-input"
                className={styles.hiddenInput}
                onChange={(e) => {
                  // `e.target.files` is a LIVE FileList backed by the input's
                  // current value — clearing `value` (so picking the same
                  // file twice still fires onChange) empties it in place.
                  // Snapshot to a plain array FIRST, or the clear races the
                  // read and handleInputFiles sees zero files every time.
                  const files = Array.from(e.target.files || [])
                  e.target.value = ''
                  handleInputFiles(files)
                }}
              />
              <input
                ref={dirInputRef}
                type="file"
                multiple
                webkitdirectory=""
                data-testid="import-dir-input"
                className={styles.hiddenInput}
                onChange={(e) => {
                  // Same live-FileList hazard as import-file-input above.
                  const files = Array.from(e.target.files || [])
                  e.target.value = ''
                  handleInputFiles(files)
                }}
              />

              <div className={styles.accordion}>
                <button
                  type="button"
                  className={styles.accordionHeader}
                  onClick={() => setGuideOpen((v) => !v)}
                  aria-expanded={guideOpen}
                >
                  <UIcon name={guideOpen ? 'chevronDown' : 'chevronRight'} size={14} gold={false} />
                  How do I get my export file?
                </button>
                {guideOpen && <ExportGuide />}
              </div>
            </div>
          )}

          {step === 'scanning' && (
            <div className={styles.scanningWrap}>
              <div className={styles.spinner} aria-hidden="true" />
              <p>{scanMessage}</p>
            </div>
          )}

          {step === 'preview' && (
            <div className={styles.previewWrap}>
              <p className={styles.sourceLabel}>
                Detected source: <strong>{sourceLabel}</strong>
              </p>
              <p className={styles.summaryLine}>
                {pluralize(visibleDocs.length, 'note')} · {pluralize(folderCount, 'folder')} ·{' '}
                {pluralize(mediaCount, 'media item')} found
              </p>
              <p className={styles.countsLine}>
                Will create {previewCounts.create} · update {previewCounts.update} · unchanged{' '}
                {previewCounts.unchanged}
              </p>

              <div>
                <label className={styles.fieldLabel} htmlFor="import-dest-select">
                  Destination folder
                </label>
                <div>
                  <select
                    id="import-dest-select"
                    className={styles.destSelect}
                    value={destChoice}
                    onChange={(e) => setDestChoice(e.target.value)}
                  >
                    {/* Hidden once the folder already exists (e.g. a re-import
                        of the same source) — "create new" would just collide
                        with the real folder shown below, which is selected by
                        default in that case (see the snap-effect above). */}
                    {!existingImportedFolder && (
                      <option value="__new__">Imported from {sourceLabel}</option>
                    )}
                    {rootFolders.map((f) => (
                      <option key={f.id} value={f.id}>{f.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {topFolders.length > 0 && (
                <div className={styles.excludeWrap}>
                  <div className={styles.fieldLabel}>Skip folders</div>
                  {topFolders.map((name) => (
                    <label key={name} className={styles.excludeRow}>
                      <input
                        type="checkbox"
                        checked={!excludedFolders.has(name)}
                        onChange={() => toggleExcludeFolder(name)}
                      />
                      {name}
                    </label>
                  ))}
                </div>
              )}

              {folderFilteredDocs.length > 0 && (
                <div className={styles.notesWrap}>
                  <div className={styles.notesHeader}>
                    <span className={styles.fieldLabel}>
                      Notes to import ({visibleDocs.length} of {folderFilteredDocs.length} selected)
                    </span>
                    <div className={styles.notesBulkRow}>
                      <button type="button" className={styles.bulkBtn} onClick={selectAllNotes}>
                        <UIcon name="check" size={13} gold={false} />
                        Select all
                      </button>
                      <button type="button" className={styles.bulkBtn} onClick={selectNoNotes}>
                        <UIcon name="x" size={13} gold={false} />
                        Select none
                      </button>
                    </div>
                  </div>
                  <div className={styles.notesList} ref={notesListRef}>
                    <div style={{ position: 'relative', height: rowVirtualizer.getTotalSize(), width: '100%' }}>
                      {rowVirtualizer.getVirtualItems().map((vi) => {
                        const item = flatNoteItems[vi.index]
                        if (!item) return null
                        const rowStyle = {
                          position: 'absolute',
                          top: vi.start,
                          left: 0,
                          right: 0,
                          height: vi.size,
                        }
                        if (item.type === 'header') {
                          const group = item.group
                          return (
                            <div key={item.key} style={rowStyle} className={styles.notesGroupHeader}>
                              <span className={styles.notesGroupLabel}>{group.label}</span>
                              <button
                                type="button"
                                className={styles.groupBulkBtn}
                                onClick={() => selectAllInGroup(group.docs)}
                              >
                                All
                              </button>
                              <button
                                type="button"
                                className={styles.groupBulkBtn}
                                onClick={() => selectNoneInGroup(group.docs)}
                              >
                                None
                              </button>
                            </div>
                          )
                        }
                        const d = item.doc
                        return (
                          <label key={item.key} style={rowStyle} className={styles.noteRow}>
                            <input
                              type="checkbox"
                              checked={!excludedNotes.has(d.importKey)}
                              onChange={() => toggleExcludeNote(d.importKey)}
                            />
                            <span className={styles.noteTitle}>{d.title || 'Untitled'}</span>
                          </label>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )}

              {warnings.length > 0 && (
                <div className={styles.warningsWrap}>
                  <div className={styles.fieldLabel}>
                    <UIcon name="warning" size={13} gold={false} /> Warnings
                  </div>
                  <ul className={styles.warningsList}>
                    {warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className={styles.previewActions}>
                <button type="button" className="btn btn-secondary" onClick={() => setStep('drop')}>
                  Back
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleConfirm}
                  disabled={importTotal === 0}
                >
                  <UIcon name="download" size={16} gold={false} />
                  Import
                </button>
              </div>
            </div>
          )}

          {step === 'running' && (
            <div className={styles.runningWrap}>
              <div className={styles.spinner} aria-hidden="true" />
              <p>
                {progress
                  ? `${phaseLabel(progress.phase)} — ${progress.done}/${progress.total}…`
                  : 'Starting import…'}
              </p>
              {progress && progress.total > 0 && (
                <div className={styles.progressTrack}>
                  <div
                    className={styles.progressFill}
                    style={{ width: `${Math.min(100, Math.round((progress.done / progress.total) * 100))}%` }}
                  />
                </div>
              )}
            </div>
          )}

          {step === 'summary' && summaryResult && (
            <div className={styles.summaryWrap}>
              <UIcon name="check" size={26} gold={false} className={styles.successIcon} />
              <p className={styles.summaryHeadline}>
                Imported {summaryResult.created + summaryResult.updated} note
                {summaryResult.created + summaryResult.updated === 1 ? '' : 's'}.
              </p>
              <ul className={styles.summaryStats}>
                <li>Created: {summaryResult.created}</li>
                <li>Updated: {summaryResult.updated}</li>
                <li>Unchanged: {summaryResult.skipped}</li>
              </ul>
              {/* The arrival screen (spec §9): what came across, by folder —
                  derived straight from `summaryResult.outcomes`, never the
                  preview's pre-import guess. */}
              {folderBreakdown.length > 0 && (
                <div className={styles.folderBreakdown}>
                  <div className={styles.fieldLabel}>By folder</div>
                  <div className={styles.folderTableWrap}>
                    <table className={styles.folderTable}>
                      <thead>
                        <tr>
                          <th>Folder</th>
                          <th>Arrived</th>
                          <th>Unchanged</th>
                          <th>Needs attention</th>
                        </tr>
                      </thead>
                      <tbody>
                        {folderBreakdown.map((row) => (
                          <tr key={row.label}>
                            <td>{row.label}</td>
                            <td>{row.arrived}</td>
                            <td>{row.unchanged}</td>
                            <td>{row.attention > 0 ? row.attention : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {excludedCount > 0 && (
                <p className={styles.summaryLine}>
                  {pluralize(excludedCount, 'note')} left out of this import — you unchecked{' '}
                  {excludedCount === 1 ? 'it' : 'them'} on the previous screen.
                </p>
              )}

              {(summaryResult.failedBatches?.length > 0 || summaryResult.failures?.length > 0) && (
                <div className={styles.failures}>
                  <p className={styles.fieldLabel}>
                    <UIcon name="warning" size={13} gold={false} /> Needs attention
                  </p>
                  {summaryResult.failedBatches?.length > 0 && summaryResult.failedBatches.map((b, i) => (
                    <p key={`batch-${i}`} className={styles.crashDetail}>
                      {b.message} ({b.reason})
                    </p>
                  ))}
                  {summaryResult.failures?.length > 0 && (
                    <>
                      <p>Some notes couldn't be fully imported:</p>
                      <ul>
                        {summaryResult.failures.map((f, i) => (
                          <li key={i}>{f.name} — {f.reason}</li>
                        ))}
                      </ul>
                    </>
                  )}
                  <p className={styles.crashDetail}>
                    Nothing here is lost — running this import again retries only these notes;
                    everything already imported is safe and won't be duplicated.
                    {summaryResult.attentionKeys?.length > 0 &&
                      ' Some of the notes above already made it into your notebook — only a file or ' +
                      'link inside them needs another look.'}
                  </p>
                </div>
              )}

              {/* Honest failure reporting (spec §9): the adapters' own
                  ignored-file + duplicate-check-truncation warnings, carried
                  forward from the preview step so they are still visible
                  once the import has actually finished — not just fleeting
                  on a screen the member has already clicked past. */}
              {warnings.length > 0 && (
                <div className={styles.warningsWrap}>
                  <div className={styles.fieldLabel}>
                    <UIcon name="warning" size={13} gold={false} /> Not included in this import
                  </div>
                  <ul className={styles.warningsList}>
                    {warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Post-migration enrichment (spec §8.1) — opt-in, reversible. */}
              {enrichScan?.status === 'scanning' && (
                <p className={styles.summaryLine}>Checking your notes for tickers…</p>
              )}
              {enrichScan?.status === 'ready' && !enrichApply && (
                <div className={styles.enrichCard}>
                  <UIcon name="chart" size={18} gold={false} />
                  <p className={styles.enrichHeadline}>
                    We found {enrichScan.candidates.length} note
                    {enrichScan.candidates.length === 1 ? '' : 's'} mentioning tickers. Want the
                    live chart on them?
                  </p>
                  <p className={styles.crashDetail}>
                    This adds a live chart inside each note — nothing else changes, and you can
                    undo it right here.
                  </p>
                  <div className={styles.previewActions}>
                    <button type="button" className="btn btn-secondary" onClick={handleDismissEnrichment}>
                      Not now
                    </button>
                    <button type="button" className="btn btn-primary" onClick={handleApplyEnrichment}>
                      <UIcon name="chart" size={16} gold={false} />
                      Add live charts
                    </button>
                  </div>
                </div>
              )}
              {enrichApply?.status === 'applying' && (
                <p className={styles.summaryLine}>
                  Adding charts — {enrichApply.done}/{enrichApply.total}…
                </p>
              )}
              {enrichApply?.status === 'done' && (
                <div className={styles.enrichCard}>
                  <p className={styles.enrichHeadline}>
                    Added {enrichApply.records.length} live chart{enrichApply.records.length === 1 ? '' : 's'}{' '}
                    to {new Set(enrichApply.records.map((r) => r.noteId)).size} note
                    {new Set(enrichApply.records.map((r) => r.noteId)).size === 1 ? '' : 's'}.
                  </p>
                  {enrichApply.failures.length > 0 && (
                    <p className={styles.crashDetail}>
                      Couldn't add a chart for {enrichApply.failures.length}:{' '}
                      {enrichApply.failures.map((f) => f.name).join(', ')}.
                    </p>
                  )}
                  {enrichApply.records.length > 0 && (
                    <button type="button" className="btn btn-secondary" onClick={handleUndoEnrichment}>
                      Undo
                    </button>
                  )}
                </div>
              )}
              {enrichApply?.status === 'undoing' && (
                <p className={styles.summaryLine}>Undoing…</p>
              )}
              {enrichApply?.status === 'undone' && (
                <p className={styles.summaryLine}>
                  Undone — no charts were added.
                  {enrichApply.undoFailures?.length > 0 &&
                    ` (${enrichApply.undoFailures.length} couldn't be undone automatically — ` +
                    'remove them from the note directly.)'}
                </p>
              )}

              <button type="button" className="btn btn-primary" onClick={onClose}>
                Done
              </button>
            </div>
          )}

          {step === 'error' && (
            <div className={styles.errorWrap}>
              <UIcon name="warning" size={26} gold={false} className={styles.errorIcon} />
              <p>{error}</p>
              <button type="button" className="btn btn-secondary" onClick={() => setStep('drop')}>
                Try again
              </button>
            </div>
          )}
        </div>
      </ImportWizardBoundary>
    </Sheet>
  )
}

// The journal style editor (Notebook P1, spec P1.4): name, kind, outline, blocks, property defaults,
// and a live preview composed by the server from the member's own data. Native controls, visible labels.
// ⛔ Reorder works by KEYBOARD (Move up / Move down buttons); the drag handle is an extra, never the only way.
// ⛔ An unknown block id (a newer version's) is shown, kept, and can be reordered; it can't be toggled.
// ⛔ THE OUTLINE IS NEVER REWRITTEN UNLESS THE MEMBER CHANGED IT. The PUT is a patch: outline keys are sent
//    only when the member changed the outline choice or text. An outline plain text cannot hold faithfully
//    (lists, marks, links, images, other headings) is shown read-only, never round-tripped through the box.
// Cancel discards; Save calls createJournalStyle / updateJournalStyle and hands the saved style up.
import { useEffect, useMemo, useRef, useState } from 'react'
import UIcon from '../../../../../components/ui/UIcon'
import useJ2PropertyDefs from '../../../hooks/useJ2PropertyDefs'
import { useMemberTemplates } from '../../../lib/memberTemplates'
import { TEMPLATES } from '../../../lib/notebookTemplates'
import { BLOCK_KINDS, blockLabel, tfWord } from '../../../lib/journalBlocks'
import { NOTE_KIND_PROPERTY } from '../../../lib/noteKinds'
import { createJournalStyle, previewJournalStyle, updateJournalStyle } from '../../../lib/journalStyles'
import { DocBody } from '../TemplatePreview'
import { docToOutlineText, outlineIsExpressible, outlineTextToDoc } from './outlineText'
import { reportError } from './styleErrors'
import styles from './StylesManager.module.css'

const PREVIEW_DEBOUNCE_MS = 400
const KNOWN = new Set(BLOCK_KINDS.map((k) => k.id))
const kindOf = (id) => BLOCK_KINDS.find((k) => k.id === id)
const READ_ONLY_OUTLINE = "This outline has formatting the editor here can't keep. Edit it in a note and save the note's setup again."

/** The preview shows what the saved note would hold. A chart is a live widget, so here it is a line naming it. */
function previewDoc(doc) {
  const walk = (n) => {
    if (!n || typeof n !== 'object') return n
    if (n.type === 'widgetEmbed') {
      const p = n.attrs?.params || {}
      const word = n.attrs?.widgetId === 'chart' ? 'Chart' : 'Block'
      const text = `${word}${p.symbol ? ` of ${p.symbol}` : ''}${p.tf ? `, ${tfWord(p.tf)}` : ''}`
      return { type: 'paragraph', content: [{ type: 'text', text, marks: [{ type: 'bold' }] }] }
    }
    return Array.isArray(n.content) ? { ...n, content: n.content.map(walk) } : n
  }
  return walk(doc)
}

export default function StyleEditor({ style, kinds, onSaved, onCancel, offline = false, onDirtyChange }) {
  const isNew = !style?.id
  const initialMode = style?.outlineTemplateId ? 'template' : style?.outlineBodyJson?.content?.length ? 'text' : 'none'
  // A stored outline the text box cannot hold is shown read-only and kept exactly as it is.
  const readOnlyOutline = initialMode === 'text' && !outlineIsExpressible(style?.outlineBodyJson)

  const [name, setName] = useState(style?.name || '')
  const [kindId, setKindId] = useState(style?.kindId || kinds[0]?.id || '')
  const [mode, setMode] = useState(initialMode)
  const [templateId, setTemplateId] = useState(style?.outlineTemplateId || '')
  const [outlineText, setOutlineText] = useState(() => (readOnlyOutline ? '' : docToOutlineText(style?.outlineBodyJson)))
  const [blocks, setBlocks] = useState(() => (style?.blocks || []).map((b) => ({ ...b, settings: { ...(b.settings || {}) } })))
  const [properties, setProperties] = useState(() => ({ ...(style?.properties || {}) }))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [moved, setMoved] = useState('')                  // what a keyboard reorder says, for a screen reader
  const dragFrom = useRef(null)
  const rowRefs = useRef({})
  const pendingFocus = useRef(null)

  const { propertyDefs } = useJ2PropertyDefs()
  const { templates: memberTemplates, isLoading: templatesLoading, error: templatesError } = useMemberTemplates()
  const selectDefs = propertyDefs.filter((d) => d.type === 'select' && d.source === 'user_set' && d.id !== NOTE_KIND_PROPERTY)
  const templateMissing = mode === 'template' && Boolean(templateId) && !templatesLoading && !templatesError
    && !memberTemplates.some((t) => t.id === templateId)

  // ── what the outline is, and whether the member changed it ──
  const outlineKeyOf = (m, tid, text) => (m === 'template' ? `template:${tid}` : m === 'text' ? (readOnlyOutline ? 'text-readonly' : `text:${text}`) : 'none')
  const [initialOutlineKey] = useState(() => outlineKeyOf(initialMode, style?.outlineTemplateId || '', readOnlyOutline ? '' : docToOutlineText(style?.outlineBodyJson)))
  const outlineKey = outlineKeyOf(mode, templateId, outlineText)
  const outlineDirty = outlineKey !== initialOutlineKey
  const outline = useMemo(() => {
    if (!outlineDirty) return { tid: style?.outlineTemplateId ?? null, doc: style?.outlineBodyJson ?? null }
    if (mode === 'template') return { tid: templateId || null, doc: null }
    if (mode === 'text') {
      const doc = outlineText.trim() ? outlineTextToDoc(outlineText) : null
      return { tid: null, doc: doc && doc.content.length ? doc : null }
    }
    return { tid: null, doc: null }
  }, [outlineDirty, mode, templateId, outlineText, style])

  const cleanProperties = useMemo(
    () => Object.fromEntries(Object.entries(properties).filter(([, v]) => v !== '' && v != null)),
    [properties])
  // The body the server previews: the style as it would be saved (the outline as it IS unless changed).
  const draftBody = useMemo(() => ({
    name: name.trim() || 'Draft',
    kindId,
    outlineTemplateId: outline.tid,
    outlineBodyJson: outline.doc,
    blocks,
    properties: cleanProperties,
  }), [name, kindId, outline, blocks, cleanProperties])

  // ── has the member changed anything? (the manager asks before closing over unsaved work) ──
  const sig = JSON.stringify([name, kindId, outlineKey, blocks, cleanProperties])
  const [initialSig] = useState(() => sig)
  useEffect(() => { onDirtyChange?.(sig !== initialSig) }, [sig, initialSig, onDirtyChange])
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])

  // ── live preview ──
  const [preview, setPreview] = useState({ state: 'loading', data: null })
  const draftKey = JSON.stringify(draftBody)
  const latest = useRef(draftBody)
  latest.current = draftBody
  useEffect(() => {
    if (!kindId) return undefined
    let live = true
    const t = setTimeout(() => {
      previewJournalStyle({ style: latest.current })
        .then((data) => { if (live) setPreview({ state: 'ok', data }) })
        .catch((e) => { if (live) setPreview({ state: 'error', data: null, message: reportError(e) }) })
    }, PREVIEW_DEBOUNCE_MS)
    return () => { live = false; clearTimeout(t) }
  }, [draftKey, kindId])

  // After a keyboard move, focus stays on the moved row. The pressed button can have just become disabled
  // (the row reached an end of the list) and React relocates the row's element, so: the pressed button if
  // it still works, else the row's other move button, else the row itself.
  useEffect(() => {
    const pf = pendingFocus.current
    if (!pf) return
    pendingFocus.current = null
    const li = rowRefs.current[pf.id]
    if (!li) return
    const up = li.querySelector('[data-move="up"]')
    const down = li.querySelector('[data-move="down"]')
    const pressed = pf.dir === 'up' ? up : down
    const other = pf.dir === 'up' ? down : up
    const target = (pressed && !pressed.disabled && pressed) || (other && !other.disabled && other) || li
    target.focus()
  })

  const move = (from, to, dir) => {
    if (to < 0 || to >= blocks.length || from === to) return
    const next = blocks.slice()
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item)
    setBlocks(next)
    setMoved(`${blockLabel(item.block)} moved to position ${to + 1} of ${next.length}.`)
    pendingFocus.current = dir ? { id: item.block, dir } : null
  }
  const toggle = (i, on) => setBlocks((bs) => bs.map((b, j) => (j === i ? { ...b, enabled: on } : b)))
  const setSetting = (i, key, value) => setBlocks((bs) => bs.map((b, j) => (j === i ? { ...b, settings: { ...b.settings, [key]: value } } : b)))
  const addBlock = (id) => {
    const kind = kindOf(id)
    if (!kind) return
    const settings = Object.fromEntries(kind.settings.map((s) => [s.key, s.default]))
    setBlocks((bs) => [...bs, { block: id, enabled: true, settings }])
    setMoved(`${kind.label} added.`)
  }
  const addable = BLOCK_KINDS.filter((k) => !blocks.some((b) => b.block === k.id))

  const copyBuiltIn = (key) => {
    const t = TEMPLATES.find((x) => x.key === key)
    if (t) setOutlineText(docToOutlineText(t.build({})))
  }

  const save = async () => {
    if (!name.trim()) { setError('Give the style a name.'); return }
    if (mode === 'template' && !templateId) { setError('Choose one of your templates, or pick another outline option.'); return }
    setSaving(true); setError('')
    try {
      // A patch: the outline goes only when it is new, or the member changed it.
      const body = { name: name.trim(), kindId, blocks, properties: cleanProperties }
      if (isNew || outlineDirty) { body.outlineTemplateId = outline.tid; body.outlineBodyJson = outline.doc }
      const out = isNew ? await createJournalStyle(body) : await updateJournalStyle(style.id, body)
      onSaved(out.style)
    } catch (e) {
      setError(reportError(e))
    } finally {
      setSaving(false)
    }
  }

  const kindName = kinds.find((k) => k.id === kindId)?.name
  const pv = preview.data
  const pvEmpty = !pv?.bodyJson?.content?.length

  return (
    <form className={styles.editor} onSubmit={(e) => { e.preventDefault(); save() }} aria-label={isNew ? 'New style' : `Edit style ${style.name}`}>
      <div className={styles.field}>
        <label htmlFor="js-name">Name</label>
        <input id="js-name" type="text" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className={styles.field}>
        <label htmlFor="js-kind">Kind of note</label>
        <select id="js-kind" value={kindId} onChange={(e) => setKindId(e.target.value)}>
          {kinds.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
        </select>
      </div>

      <fieldset className={styles.fieldset}>
        <legend>Outline</legend>
        <label className={styles.radio}>
          <input type="radio" name="js-outline" checked={mode === 'none'} onChange={() => setMode('none')} /> No outline
        </label>
        <label className={styles.radio}>
          <input type="radio" name="js-outline" checked={mode === 'template'} onChange={() => setMode('template')} /> One of my templates
        </label>
        {mode === 'template' && (
          <div className={styles.field}>
            <label htmlFor="js-template">My template</label>
            <select id="js-template" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              <option value="">Choose a template</option>
              {templateMissing && <option value={templateId}>A template that was deleted</option>}
              {memberTemplates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            {templateMissing && <p className={styles.hint}>That template no longer exists.</p>}
            {!memberTemplates.length && !templateMissing && <p className={styles.hint}>You have no saved templates yet. Save a note as a template first.</p>}
          </div>
        )}
        <label className={styles.radio}>
          <input type="radio" name="js-outline" checked={mode === 'text'} onChange={() => setMode('text')} /> Write it here
        </label>
        {mode === 'text' && readOnlyOutline && <p className={styles.hint}>{READ_ONLY_OUTLINE}</p>}
        {mode === 'text' && !readOnlyOutline && (
          <>
            <div className={styles.field}>
              <label htmlFor="js-outline-text">Outline text</label>
              <textarea id="js-outline-text" rows={9} value={outlineText} onChange={(e) => setOutlineText(e.target.value)}
                aria-describedby="js-outline-help" />
              <p id="js-outline-help" className={styles.hint}>
                Start a line with ## for a heading. A line that is only {'{{block:chart}}'} puts that block there. A blank line is a blank line.
              </p>
            </div>
            <div className={styles.field}>
              <label htmlFor="js-builtin">Start from a built-in outline</label>
              <select id="js-builtin" value="" onChange={(e) => copyBuiltIn(e.target.value)}>
                <option value="">Choose one to copy its text</option>
                {TEMPLATES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
            </div>
          </>
        )}
      </fieldset>

      <fieldset className={styles.fieldset}>
        <legend>Blocks</legend>
        {blocks.length === 0 && <p className={styles.hint}>No blocks yet. Add one below.</p>}
        <ol className={styles.blocks} aria-label="Blocks in this style">
          {blocks.map((b, i) => {
            const known = KNOWN.has(b.block)
            const label = known ? blockLabel(b.block) : 'A block from a newer version'
            const kind = kindOf(b.block)
            return (
              <li
                key={b.block}
                ref={(el) => { if (el) rowRefs.current[b.block] = el; else delete rowRefs.current[b.block] }}
                tabIndex={-1}
                className={styles.blockRow}
                onDragOver={(e) => { if (dragFrom.current != null) e.preventDefault() }}
                onDrop={(e) => {
                  e.preventDefault()
                  const from = dragFrom.current
                  dragFrom.current = null
                  if (from != null) move(from, i)
                }}
              >
                <span className={styles.dragHandle} draggable
                  onDragStart={(e) => {
                    dragFrom.current = i
                    if (e.dataTransfer) { e.dataTransfer.setData('text/plain', String(i)); e.dataTransfer.effectAllowed = 'move' }   // Firefox starts no drag without data
                  }}
                  onDragEnd={() => { dragFrom.current = null }} aria-hidden="true" title="Drag to reorder">
                  <UIcon name="menu" size={16} gold={false} />
                </span>
                <label className={styles.blockLabel}>
                  <input type="checkbox" checked={Boolean(b.enabled)} disabled={!known}
                    aria-label={`Use ${label}`} onChange={(e) => toggle(i, e.target.checked)} />
                  <span>{label}</span>
                  {!known && <span className={styles.muted}> ({b.block})</span>}
                </label>
                {kind?.settings.map((s) => (
                  <select key={s.key} value={b.settings[s.key] ?? s.default} aria-label={`${s.label} for ${label}`}
                    onChange={(e) => setSetting(i, s.key, e.target.value)}>
                    {s.options.map((o) => <option key={o} value={o}>{tfWord(o)}</option>)}
                  </select>
                ))}
                <span className={styles.blockMoves}>
                  <button type="button" className={styles.iconBtn} aria-label={`Move ${label} up`} title="Move up" data-move="up"
                    disabled={i === 0} onClick={() => move(i, i - 1, 'up')}>
                    <UIcon name="chevronUp" size={16} gold={false} />
                  </button>
                  <button type="button" className={styles.iconBtn} aria-label={`Move ${label} down`} title="Move down" data-move="down"
                    disabled={i === blocks.length - 1} onClick={() => move(i, i + 1, 'down')}>
                    <UIcon name="chevronDown" size={16} gold={false} />
                  </button>
                </span>
              </li>
            )
          })}
        </ol>
        <p className={styles.srOnly} role="status" aria-live="polite">{moved}</p>
        <div className={styles.field}>
          <label htmlFor="js-add-block">Add a block</label>
          <select id="js-add-block" value="" disabled={!addable.length} onChange={(e) => addBlock(e.target.value)}>
            <option value="">{addable.length ? 'Choose a block' : 'Every block is already here'}</option>
            {addable.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
          </select>
        </div>
      </fieldset>

      {selectDefs.length > 0 && (
        <fieldset className={styles.fieldset}>
          <legend>Property defaults</legend>
          {selectDefs.map((d) => (
            <div className={styles.field} key={d.id}>
              <label htmlFor={`js-prop-${d.id}`}>{d.name}</label>
              <select id={`js-prop-${d.id}`} value={properties[d.id] ?? ''}
                onChange={(e) => setProperties((p) => ({ ...p, [d.id]: e.target.value }))}>
                <option value="">Leave empty</option>
                {(d.options || []).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </div>
          ))}
        </fieldset>
      )}

      <section className={styles.preview} aria-labelledby="js-preview-h">
        <h4 id="js-preview-h">Preview</h4>
        {preview.state === 'error' ? (
          <p role="alert" className={styles.error}>{preview.message}</p>
        ) : !pv ? (
          <p className={styles.hint}>Building the preview…</p>
        ) : (
          <>
            <p className={styles.hint}>
              {pv.ticker ? `Shown with ${pv.ticker}, from your notes.` : 'Add a ticker to a note to see the chart block.'}
            </p>
            {pvEmpty
              ? <p className={styles.hint}>A new {kindName || 'note'} from this style starts empty.</p>
              : <DocBody body={previewDoc(pv.bodyJson)} />}
          </>
        )}
      </section>

      {error && <p role="alert" className={styles.error}>{error}</p>}
      <div className={styles.actions}>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={saving || offline}>{saving ? 'Saving…' : 'Save style'}</button>
      </div>
    </form>
  )
}

import { Node, mergeAttributes } from '@tiptap/core'
import { NodeSelection, TextSelection, Selection, Plugin, PluginKey } from '@tiptap/pm/state'
import { ReactNodeViewRenderer } from '@tiptap/react'
import WidgetEmbedView from '../components/notebook/WidgetEmbedView'
import { buildWidgetEmbedAttrs } from './widgetEmbedCore'
import { isTraderBlock } from '../../../widgets/registry'
import { ReplaceStep } from '@tiptap/pm/transform'
import { EVENT_SCHEMAS, NOTEBOOK_EVENTS, trackNotebookEvent } from './notebookTelemetry'
import { insertDoorOpen, reportInsertedBlock } from './notebookUsage'

/** Follow-up A: while an insert door is open (lib/notebookUsage.js), the first widget a transaction ADDS is reported
 *  once as `block_inserted`. Only a ReplaceStep counts (an attribute change is not an insert). */
export function insertedBlockPlugin() {
  return new Plugin({
    appendTransaction(trs) {
      if (!insertDoorOpen()) return null
      for (const tr of trs) {
        if (!tr.docChanged) continue
        for (const step of tr.steps) {
          if (!(step instanceof ReplaceStep)) continue
          let id = null
          step.slice.content.descendants((n) => {
            if (id) return false
            if (n.type.name === 'widgetEmbed') { id = n.attrs.widgetId || 'custom'; return false }
            return true
          })
          if (id) { reportInsertedBlock(id); return null }
        }
      }
      return null
    },
  })
}

// ⚠️ NEVER remove this extension from buildExtensions(): TipTap DROPS unknown
// node types at parse time, so unregistering it would silently delete every
// embed from every note the next time one is opened. "Unknown widget" is a
// VALUE-level state (attrs.widgetId not in the registry) handled inside the
// node view's render chain — the node type itself must always exist.
//
// Object attrs are persisted as individual JSON data-attributes so copy/paste
// and the importer's generateJSON round-trip keep the full embed intact; the
// static renderHTML also carries the searchText line as text content so
// HTML pasted OUTSIDE the app degrades to something readable.
const jsonAttr = (name, dflt) => ({
  default: dflt,
  parseHTML: (el) => {
    const raw = el.getAttribute(name)
    if (raw == null) return dflt
    try { return JSON.parse(raw) } catch { return dflt }
  },
  renderHTML: (attrs) => {
    const key = name.replace(/^data-/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase())
    const v = attrs[key]
    return v == null ? {} : { [name]: JSON.stringify(v) }
  },
})

const stringAttr = (name, dflt = null) => ({
  default: dflt,
  parseHTML: (el) => el.getAttribute(name) ?? dflt,
  renderHTML: (attrs) => {
    const key = name.replace(/^data-/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase())
    const v = attrs[key]
    return v == null ? {} : { [name]: String(v) }
  },
})

// ⛔⛔ 13H-2 fix — Draw mode's focus-steal (measured, not guessed: the call
// stack recorded in docs/notebook/evidence/wave13-13h2/walk-69473964d-run7
// is `MouseDown.up -> selectClickedLeaf -> updateSelection -> view.focus()`,
// all in prosemirror-view/dist/index.js).
//
// widgetEmbed is `atom: true, selectable: true`. ProseMirror's OWN mousedown
// handler (registered on the editor's DOM root, gated by THIS function —
// `NodeView.stopEvent`) treats a mousedown anywhere inside a selectable atom
// as "maybe the user is about to click-select this node", and arms a
// mouseup listener that, on release, creates a NodeSelection and calls
// `view.focus()` — regardless of whether the mousedown landed on the
// chart's own canvas, an SVG drawing handle, or blank chrome. That listener
// is wired directly on `view.root` (bypassing this function entirely on
// mouseup), so the ONLY lever is stopping the mousedown itself.
// WidgetEmbedView listens for exactly that editor focus to mean "the member
// clicked back into their prose, exit Draw mode"
// (`editor.on('focus', exit)`), so every mousedown+mouseup on the chart's
// drawing surface while annotating was read as a deliberate "done drawing"
// and silently exited Draw mode after the very first mark.
//
// The fix: tell ProseMirror a mousedown landing on the chart's own rendered
// surface (`data-widget-embed-body` — the live canvas, its drawing overlay,
// any resize/crosshair handle the chart library draws as plain SVG/DOM) is
// not its business at all. Everything else in this function mirrors
// `@tiptap/core`'s own default `NodeView.prototype.stopEvent` (its
// INPUT/BUTTON/SELECT/TEXTAREA/contentEditable passthrough, and the
// click-to-select / drag / clipboard exceptions) — providing `stopEvent`
// at all REPLACES that default outright for this node type, so the toolbar's
// own buttons and the TF `<select>` must keep behaving exactly as they did
// before this fix.
export function widgetEmbedStopEvent({ event }) {
  const target = event?.target
  const tag = target && typeof target.tagName === 'string' ? target.tagName : ''
  const isInput = tag === 'INPUT' || tag === 'BUTTON' || tag === 'SELECT' || tag === 'TEXTAREA'
    || !!(target && target.isContentEditable)
  const isDragEvent = typeof event?.type === 'string' && event.type.startsWith('drag')
  // Default's own passthrough: an input-like element always owns its events,
  // except the drag/drop family (a draggable row dragged FROM a button, say).
  if (isInput && event.type !== 'drop' && !isDragEvent) return true
  // Tier 4 fix round 1 (review 4): the phone chart's full-screen link owns every event inside it. ProseMirror's
  // click-to-select would otherwise make a NodeSelection and focus the editor (raising the iOS keyboard) on the
  // way out of the note.
  if (!isDragEvent && target?.closest?.('[data-phone-chart-open]')) return true
  // The fix: WHILE THE MEMBER IS DRAWING, never let a mousedown on the chart's
  // own surface reach ProseMirror's click-to-select handling (its mouseup
  // refocuses the editor, which the embed reads as "done drawing").
  // ⛔ ONLY while drawing (`data-widget-embed-body="draw"`, WidgetEmbedView).
  // This stop was unconditional at first, and that took click-to-select away
  // from every block with every flag off: an archived image or a chart with no
  // caption could no longer be selected, deleted or dragged by mouse (finish
  // program, lane FE, I7). Out of Draw mode the body is the editor's to select.
  if (event?.type === 'mousedown' && target?.closest?.('[data-widget-embed-body="draw"]')) {
    return true
  }
  // Everything past here matches the untouched vendor default for a
  // selectable, non-dragging atom node: let a mousedown elsewhere in the
  // embed's chrome (frame border, toolbar background) still select the
  // node, and leave the drag/drop/clipboard family alone; stop anything
  // else (e.g. a stray keydown bubbling from inside the embed).
  if (isDragEvent || event?.type === 'drop' || event?.type === 'copy'
    || event?.type === 'paste' || event?.type === 'cut' || event?.type === 'mousedown') {
    return false
  }
  return true
}

/** Audit 2026-11-05, spec S3 (B7): the event a selected CHART receives when the member types over
 *  it -- `detail.text` is what they typed, upper-cased. WidgetEmbedView opens the chart's ticker
 *  search with it. Dispatched on the chart's own element and bubbles. */
export const CHART_EMBED_TYPE_EVENT = 'uct:chart-embed-type'

/** The selected node, when the selection is a NodeSelection on a CHART embed; else null. */
function selectedChart(state) {
  const sel = state.selection
  if (!(sel instanceof NodeSelection)) return null
  const n = sel.node
  return n?.type?.name === 'widgetEmbed' && n.attrs?.widgetId === 'chart' ? sel : null
}

function askChartToSearch(view, sel, text) {
  const outer = view.nodeDOM(sel.from)
  const target = outer?.querySelector?.('[data-widget-embed-view]') || outer || view.dom
  target.dispatchEvent(new CustomEvent(CHART_EMBED_TYPE_EVENT, {
    bubbles: true, detail: { text: String(text || '').toUpperCase() },
  }))
}

// ⛔⛔ Audit 2026-11-05, spec S3 (B7): A TYPED KEY NEVER REPLACES A SELECTED CHART. Click a chart and
// type "AMD": ProseMirror's default for text over a NodeSelection is to REPLACE the node, so the
// chart (with its plan, drawings and archive) became the letters. A printable key -- one character,
// no Ctrl/Cmd/Alt -- over a selected chart is taken here and handed to the chart's ticker search
// (the Charts page's type-to-search idiom). `handleTextInput` covers what never arrives as a
// keydown (IME, a phone keyboard). Delete and Backspace are not printable: they still remove the
// chart, and Undo restores it, exactly as before.
const chartTypeToSearchKey = new PluginKey('chartTypeToSearch')
export const chartTypeToSearchPlugin = () => new Plugin({
  key: chartTypeToSearchKey,
  props: {
    handleKeyDown(view, event) {
      // ⛔ Fix round 1 (review finding 4): Esc on a selected chart is "back to writing" -- the caret
      // lands just after the chart (a paragraph is made when the chart is the last block). An
      // insert selects the new chart, so without this the member's next sentence went to its
      // ticker search with no shown way out.
      if (event.key === 'Escape' && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const chart = selectedChart(view.state)
        if (!chart || !view.editable) return false
        const tr = view.state.tr
        const after = Selection.findFrom(tr.doc.resolve(chart.to), 1, true)
        if (after) {
          tr.setSelection(after)
        } else {
          const para = view.state.schema.nodes.paragraph?.createAndFill()
          if (!para) return false
          tr.insert(chart.to, para)
          tr.setSelection(TextSelection.create(tr.doc, chart.to + 1))
        }
        view.dispatch(tr.scrollIntoView())
        event.preventDefault()
        return true
      }
      if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return false
      if (typeof event.key !== 'string' || event.key.length !== 1 || event.key === ' ') return false
      const sel = selectedChart(view.state)
      if (!sel || !view.editable) return false
      event.preventDefault()
      askChartToSearch(view, sel, event.key)
      return true
    },
    handleTextInput(view, from, to, text) {
      const sel = selectedChart(view.state)
      if (!sel || !view.editable || sel.from !== from || sel.to !== to) return false
      askChartToSearch(view, sel, text.trim().slice(0, 1))
      return true
    },
  },
})

export const WidgetEmbed = Node.create({
  name: 'widgetEmbed',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      v: {
        default: 1,
        parseHTML: (el) => Number(el.getAttribute('data-v')) || 1,
        renderHTML: (attrs) => ({ 'data-v': String(attrs.v ?? 1) }),
      },
      widgetId: stringAttr('data-widget-id'),
      params: jsonAttr('data-params', {}),
      capturedAt: stringAttr('data-captured-at'),
      // Wave 4 chart identity: one per NODE (widgetEmbedCore.newEmbedId).
      // Default null — every embed stored before it simply lacks one, and
      // citations to those keep the widgetId|capturedAt fallback. Rendered as
      // a data- attribute so copy/paste and the importer round-trip keep it.
      // ⚠️ Schema-guard limit (wave-5 review N6): NOTEBOOK_TYPE_SCHEMA versions
      // node/mark TYPES, not attributes — an older bundle silently DROPS an
      // attr it does not know. embedId needs no row because absence has a
      // meaning (the fallback key). An attribute whose absence would change
      // what the note MEANS takes a row in NOTEBOOK_ATTR_SCHEMA (wave 13, `ta`
      // below); see docs/notebook/wave5-rollback.md, "Level 4".
      embedId: stringAttr('data-embed-id'),
      mode: stringAttr('data-mode', 'snapshot'),
      fallback: jsonAttr('data-fallback', null),
      // Frozen-to-image: renders the captured PNG at the embed's own size (no
      // live chart, no toolbar), still resizable via the corner handle.
      frozen: {
        default: false,
        parseHTML: (el) => el.getAttribute('data-frozen') === 'true',
        renderHTML: (attrs) => (attrs.frozen ? { 'data-frozen': 'true' } : {}),
      },
      tradeRef: stringAttr('data-trade-ref'),
      annotations: jsonAttr('data-annotations', []),
      caption: stringAttr('data-caption'),
      layout: jsonAttr('data-layout', { width: 'full', height: 320 }),
      searchText: stringAttr('data-search-text'),
      // ⛔⛔ NEVER-REVERT (wave 13 lane 13H-1, schema level 4 via
      // NOTEBOOK_ATTR_SCHEMA['widgetEmbed.ta']). The chart's plan data:
      // `{ v, setupTag, fingerprint, planBlock }` — shape and builders in
      // lib/chartPlan.js. Plan ROLES are not here: they ride the drawings in
      // `annotations` (a role on a horizontal line), which plan_extract reads.
      // Registered unconditionally (the chart-plan key, CHART_PLAN_FLAG, only
      // hides the doors), so a gate-off tab still declares 4 and never saves a
      // note without it. Removing this line drops the declaration to 3 and the
      // server then refuses this bundle's writes to every note that carries `ta`
      // — read-only, never stripped.
      ta: jsonAttr('data-ta', null),
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-widget-embed]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-widget-embed': '', class: 'uct-widget-embed' }),
      node.attrs.searchText || '[widget]',
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(WidgetEmbedView, { stopEvent: widgetEmbedStopEvent })
  },

  addProseMirrorPlugins() {
    return [chartTypeToSearchPlugin(), insertedBlockPlugin()]
  },

  addCommands() {
    return {
      insertWidgetEmbed: (widgetId, capture, extra) => ({ chain, dispatch }) => {
        const ok = chain()
          .insertContent({
            type: this.name,
            attrs: buildWidgetEmbedAttrs(widgetId, capture, extra),
          })
          .caretAfterWidgetEmbed()
          .run()
        // P5 Task 6: a trader block inserted for real (not an editor.can() dry run, which has no dispatch) counts
        // once as block_used. The eager registry decides what a block is (F8); only its id leaves, never params.
        // Wave 9 (Task 9.13): and only a kind in the event's closed enum (the BLOCK_KINDS ids, railed in
        // notebookTelemetry.test.js), so a live block (routine, tracker: W9-R4, no BLOCK_KINDS row) is never sent as
        // an out-of-enum kind. ⛔ The enum, never lib/journalBlocks: this module is on the Notebook's first open.
        if (ok && dispatch && isTraderBlock(widgetId) && EVENT_SCHEMAS.block_used.kind.values.has(widgetId)) {
          trackNotebookEvent(NOTEBOOK_EVENTS.BLOCK_USED, { kind: widgetId })
        }
        return ok
      },
      // insertContent leaves a NodeSelection ON a freshly inserted atom, so
      // the very NEXT keystroke replaced the embed the user just created —
      // caught typing prose right after a /chart insert on prod (the most
      // natural next action there is). Park the caret in the first text
      // position after the embed instead; when the embed is the last node,
      // give it a trailing paragraph to land in. Chain this after EVERY
      // programmatic embed insert (the single-embed command above does it
      // itself; the /mtf and /compare array inserts call it explicitly).
      caretAfterWidgetEmbed: () => ({ tr, dispatch, editor }) => {
        const sel = tr.selection
        if (!(sel instanceof NodeSelection) || sel.node.type.name !== this.name) return true
        if (!dispatch) return true
        const after = Selection.findFrom(tr.doc.resolve(sel.to), 1, true)
        if (after) {
          tr.setSelection(after)
          return true
        }
        const para = editor.schema.nodes.paragraph?.createAndFill()
        if (!para) return true
        tr.insert(sel.to, para)
        tr.setSelection(TextSelection.create(tr.doc, sel.to + 1))
        return true
      },
    }
  },
})

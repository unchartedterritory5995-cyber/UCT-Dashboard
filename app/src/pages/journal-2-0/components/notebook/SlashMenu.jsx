/**
 * Slash menu for the Notebook TipTap editor.
 *
 * Typing `/` opens a positioned dropdown of insertable blocks.
 * Arrow keys navigate, Enter inserts, Esc closes. Free-text after `/`
 * filters the list by label.
 */

import { Extension } from '@tiptap/react'
import Suggestion, { SuggestionPluginKey } from '@tiptap/suggestion'
import { ReactRenderer } from '@tiptap/react'
import { guardedCommand, sessionStillOpen } from '../../lib/suggestionSession'
import { useEffect, useImperativeHandle, useState, forwardRef } from 'react'
import { WIDGET_REGISTRY, JOURNAL_MENU_TYPES, tfText } from '../../../../widgets/registry'
import {
  parseChartSlashArgs, parseMtfSlashArgs, parseCompareSlashArgs, chartInsertNodes,
  parseVsSlashArgs, chartPlanEnabled, VS_BROAD, VS_KEYWORDS, parseDayToken,
} from '../../lib/widgetEmbedCore'
import { applyComboboxWiring } from '../../lib/comboboxWiring'
import { BLOCK_MATH, INLINE_MATH, insertMathAndEdit } from '../../lib/mathNodes'
import { inColumn, insertColumns } from '../../lib/columnsNode'
import { insertTableOfContents } from '../../lib/tableOfContentsNode'
import { insertReminder } from '../../lib/reminderItem'
import { DICTATE_EVENT } from '../../lib/dictationInsert'
import { WRITING_HELP_EVENT } from '../../lib/writingHelp'
import { VOICE_NOTE_EVENT } from '../../lib/voiceNote'
import { CANVAS_EVENT } from '../../lib/tradeCanvas'
import { TRANSCRIPT_EVENT, transcriptCaptureEnabled } from '../../lib/researchCapture'
import { STYLE_EVENT, PLAN_EVENT, journalStylesEnabled } from '../../lib/journalStylesFlag'
import { tier3Enabled } from '../../lib/tier3Flag'
import { WIDGET_KINDS, CAPTURE_KINDS } from '../../lib/notebookWidgets'
import { widgetsWaveOn, WIDGET_CHUNK_LOST, doorLostSentence } from '../../lib/notebookWidgetsFlags'
import { captureEnabled } from '../../../../widgets/captureRelease'
import { insertToolBlock } from '../../lib/toolEmbed'
import styles from './SlashMenu.module.css'

// Notebook P2a: a trader block (and the market context stamp) in the Planning a trade group, dark behind the
// switch (R-P2-1). Words and defaults are the registry's, already first-open; registry.test.js S20
// pins them to journalBlocks.js, which is NOT first-open (SlashMenu.blocks.test.jsx proves agreement).
// No params: buildWidgetEmbedAttrs -> normalizeParams fills every registry default.
const traderItem = (id, more) => ({
  title: WIDGET_REGISTRY[id].labels.menu,
  description: 'A trader block',
  keywords: ['block', 'trading'],
  available: journalStylesEnabled,
  trader: true,
  command: ({ editor, range }) => editor.chain().focus().deleteRange(range).insertWidgetEmbed(id).run(),
  ...more,
})

// Exported for the rails (SlashMenu.items.test.jsx): the block entries a bare
// `/` offers, and what each one inserts.
export const ITEMS = [
  {
    title: 'Heading 1',
    description: 'Big section heading',
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setNode('heading', { level: 1 }).run(),
  },
  {
    title: 'Heading 2',
    description: 'Medium section heading',
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run(),
  },
  {
    title: 'Heading 3',
    description: 'Small section heading',
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setNode('heading', { level: 3 }).run(),
  },
  {
    title: 'Heading 4',
    description: 'Sub-section heading — or type #### and a space',
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setNode('heading', { level: 4 }).run(),
  },
  {
    title: 'Heading 5',
    description: 'Minor heading — or type ##### and a space',
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setNode('heading', { level: 5 }).run(),
  },
  {
    title: 'Heading 6',
    description: 'Smallest heading, a label — or type ###### and a space',
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setNode('heading', { level: 6 }).run(),
  },
  {
    title: 'Bullet list',
    description: 'Unordered list',
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    title: 'Numbered list',
    description: 'Ordered list',
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  {
    title: 'Quote',
    description: 'Italic indented block',
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
  },
  {
    title: 'Code block',
    description: 'Monospace block',
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
  },
  {
    title: 'Divider',
    description: 'Horizontal rule',
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
  },
  {
    title: 'Table',
    description: '3x3 table with a header row',
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    // Wave 6: side-by-side columns (columnsNode.js). ⛔ Never offered inside a
    // column — columns do not nest — which `available` answers per session.
    title: '2 columns',
    description: 'Two side-by-side columns — they stack on a phone',
    available: ({ editor }) => !inColumn(editor?.state?.selection?.$from),
    command: ({ editor, range }) => insertColumns(editor, 2, range),
  },
  {
    title: '3 columns',
    description: 'Three side-by-side columns — they stack on a phone',
    available: ({ editor }) => !inColumn(editor?.state?.selection?.$from),
    command: ({ editor, range }) => insertColumns(editor, 3, range),
  },
  {
    // Wave 6: the note's headings, live -- each one a jump (tableOfContentsNode.js).
    title: 'Table of contents',
    description: 'Every heading in this note — choose one to jump to it',
    keywords: ['toc', 'contents', 'outline'],
    command: ({ editor, range }) => insertTableOfContents(editor, range),
  },
  {
    title: 'Checklist',
    description: 'Task list. Type @tomorrow for a reminder',
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleTaskList().run(),
  },
  {
    // P0.9: a due date, found from the slash menu. It types the "@" a member would have typed, which
    // opens the date list (lib/dateSuggest.js): one door, not a second picker.
    title: 'Due date',
    description: 'Add a due date: today, tomorrow or pick one',
    keywords: ['date', 'due', 'reminder', 'deadline'],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).insertContent('@').run(),
  },
  {
    // Tier 2 part B, item 12: a follow-up task with a date. It makes the task and types "@", which opens
    // the date list (lib/dateSuggest.js): one door for the date, not a second picker.
    title: 'Reminder',
    description: 'A follow-up task with a date',
    keywords: ['remind', 'reminder', 'follow up'],
    command: ({ editor, range }) => insertReminder(editor, range),
  },
  {
    title: 'Callout',
    description: 'Highlighted box — note, info, success, warning or danger',
    // Wave 6: a new callout is STYLED (its icon is the style control, a UIcon);
    // only an imported or older callout shows an emoji.
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).insertContent({
      type: 'callout',
      attrs: { variant: 'note' },
      content: [{ type: 'paragraph' }],
    }).run(),
  },
  {
    title: 'Toggle',
    description: 'Collapsible section',
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).insertContent({
      type: 'toggle',
      attrs: { open: true },
      content: [
        { type: 'toggleSummary', content: [{ type: 'text', text: 'Toggle' }] },
        { type: 'toggleContent', content: [{ type: 'paragraph' }] },
      ],
    }).run(),
  },
  {
    title: 'Inline math',
    description: 'A formula inside the sentence (LaTeX) — or type $x^2$ then a space',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run()
      insertMathAndEdit(editor, INLINE_MATH)
    },
  },
  {
    title: 'Math block',
    description: 'A displayed equation (LaTeX) — or type $$…$$ on its own line',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run()
      insertMathAndEdit(editor, BLOCK_MATH)
    },
  },
  {
    title: 'Emoji',
    description: 'Type : and a name — e.g. :rocket or :chart',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run()
      // The `:` must start a word for the emoji menu to arm (EmojiMenu.jsx).
      const { $from } = editor.state.selection
      const before = $from.parent.textBetween(Math.max(0, $from.parentOffset - 1), $from.parentOffset)
      editor.chain().insertContent(before && !/\s/.test(before) ? ' :' : ':').run()
    },
  },
  {
    title: 'Image',
    description: 'Insert an image from your computer',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run()
      // Trigger the editor's external file picker via a custom event.
      // ⛔ Wave 6 fix round 1, I5 — dispatched on THIS editor's own DOM root,
      // never `window`: with two panes open (split view) every mounted
      // editor shared one listener on `window`, so an image picked from the
      // side pane's Image item landed in the MAIN note. NoteEditorPage's
      // listener is bound to the same node (`editor.view.dom`), so only the
      // editor this command actually ran against ever answers.
      editor.view.dom.dispatchEvent(new CustomEvent('uct:notebook-open-image-picker', { bubbles: true }))
    },
  },
  {
    // Wave 7 lane H1: dictation. ⛔ The menu has no mic of its own: this asks
    // the toolbar mic of THIS editor to start — dispatched on this editor's own
    // DOM root, never `window` (the I5 rule above), so with split view open only
    // the pane the slash command ran in starts listening. Offered only while
    // that mic can actually dictate (a paid member, a browser that can record),
    // so it is never a dead item.
    title: 'Dictate',
    description: 'Speak, and your words go in at the cursor',
    keywords: ['voice', 'mic', 'speak', 'dictation'],
    available: ({ editor }) => editor?.storage?.uctJournalWidgets?.canDictate?.() === true,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run()
      editor.view.dom.dispatchEvent(new CustomEvent(DICTATE_EVENT, { bubbles: true }))
    },
  },
  {
    // Wave 7 lane H2: writing help over the WHOLE note (a slash command leaves
    // a caret, not a selection; the toolbar entry takes a selection). Dark
    // behind `notebook_writing_help_enabled` and paid-only — `canWritingHelp`
    // answers both — and dispatched on this editor's own DOM root (I5).
    title: 'Writing help',
    description: 'Summarize, rewrite, continue or translate — you preview before anything is added',
    keywords: ['summarize', 'rewrite', 'translate', 'continue', 'compass', 'ai'],
    available: ({ editor }) => editor?.storage?.uctJournalWidgets?.canWritingHelp?.() === true,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run()
      editor.view.dom.dispatchEvent(new CustomEvent(WRITING_HELP_EVENT, { bubbles: true }))
    },
  },
  {
    // Wave 11 lane 11A: /voice — record, upload or pick a Desk session, preview
    // the transcript, summary, tickers and action items, then add them to THIS
    // note (an editor transaction) or save them as a new one. Dark behind
    // `notebook_voice_notes_enabled` and paid-only — `canVoiceNote` answers both —
    // and dispatched on this editor's own DOM root (I5).
    title: 'Voice note',
    description: 'Record, upload or pick a Desk session — transcript, summary, tickers and tasks',
    keywords: ['voice', 'record', 'recording', 'meeting', 'audio', 'transcript', 'transcribe', 'upload'],
    available: ({ editor }) => editor?.storage?.uctJournalWidgets?.canVoiceNote?.() === true,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run()
      editor.view.dom.dispatchEvent(new CustomEvent(VOICE_NOTE_EVENT, { bubbles: true }))
    },
  },
  {
    // Wave 11 lane 11D: /canvas — make a trade-plan canvas (with this note's
    // ticker, in this note's folder) and put a link to it at the caret. Dark
    // behind `notebook_trade_canvas_enabled` — `canTradeCanvas` answers it, and
    // is false inside a canvas note — and dispatched on this editor's own DOM
    // root (I5), like Dictate and Writing help.
    title: 'Trade-plan canvas',
    description: 'A board for charts, entry/stop/target and notes — linked here',
    keywords: ['canvas', 'board', 'plan', 'trade', 'whiteboard', 'levels'],
    available: ({ editor }) => editor?.storage?.uctJournalWidgets?.canTradeCanvas?.() === true,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run()
      editor.view.dom.dispatchEvent(new CustomEvent(CANVAS_EVENT, { bubbles: true }))
    },
  },
  {
    // Wave 13 lane 13G-1: /transcript -- a passage of a call transcript UCT already holds,
    // saved as a cited excerpt and placed at the caret. Dark behind
    // `notebook_transcript_capture_enabled`, and dispatched on this editor's own DOM root (I5);
    // the sheet is TranscriptDoors' TranscriptInsertHost, mounted by the editor page.
    title: 'Transcript passage',
    description: 'Quote an earnings call, cited with the call, its date and the speaker turn',
    keywords: ['transcript', 'earnings', 'call', 'quote', 'excerpt', 'cite'],
    available: () => transcriptCaptureEnabled(),
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run()
      editor.view.dom.dispatchEvent(new CustomEvent(TRANSCRIPT_EVENT, { bubbles: true }))
    },
  },
  {
    // Notebook P1: /style -- switch this note to one of the member's journal styles, previewed first
    // (adds missing blocks only, never removes or moves their text). Dark behind
    // notebook_journal_styles_enabled; dispatched on this editor's own DOM root, like /canvas.
    title: 'Journal style',
    description: 'Switch to a style',
    available: journalStylesEnabled,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run()
      editor.view.dom.dispatchEvent(new CustomEvent(STYLE_EVENT, { bubbles: true }))
    },
  },
  traderItem('preEntryChecklist'),
  traderItem('priceStamps'),
  traderItem('positionSizing'),
  // Wave 10 (Task 10.20): /size, the position size calculator, while wave 10 is on.
  traderItem('sizeCalc', { cmd: 'size', description: 'Shares for your entry, stop and risk',
    keywords: ['size', 'shares', 'risk', 'calculator', 'position'], available: () => widgetsWaveOn(10) }),
  // P2b Task 12: My rules, the Daily prep pack and the post-trade review block. Each says what it
  // shows, so six neighbouring rows can be told apart (Task 12 review, finding 6).
  traderItem('myRules', { description: 'Your trading rules and their versions' }),
  traderItem('prepWire', { description: "The morning wire's read and exposure" }),
  traderItem('prepEarnings', { description: 'Who on your list reports earnings' }),
  traderItem('prepMovers', { description: 'How the names on your list are moving' }),
  traderItem('prepLevels', { description: 'The levels in your trade plans' }),
  traderItem('tradeReview', { description: 'Review a closed trade against your plan' }),
  // P2 Tier 3 (R-T3-1): CREATING a check-in needs both switches; one already in a note renders anyway.
  traderItem('moodCheckIn', { description: 'How you feel and how focused you are today',
    available: () => tier3Enabled() && journalStylesEnabled() }),
  traderItem('marketcontext', {
    // R-P2-8: a member's own stamp, captured NOW; it never sets builtin:regime_at_write. ⛔ R-RC-4:
    // the typed command leaves the note BEFORE the read is awaited (the /price rule). A failed read
    // inserts nothing and SAYS so in the note's toast (R-T12-2, the /vs pattern): the typed command
    // is already gone, so silence read as the command having done nothing. `fields` is normalizeParams'.
    title: 'Market context',
    description: 'Stamp the market as it is right now',
    keywords: ['block', 'trading', 'regime'],
    command: async ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run()
      let params
      try {
        const res = await fetch('/api/j2/trader-blocks/market-context', { credentials: 'include' })
        params = res.ok && await res.json()
      } catch { /* said below */ }
      // The read can outlive the editor (the member left the note): nothing to stamp, nobody to tell.
      if (editor.isDestroyed) return
      if (params) editor.chain().focus().insertWidgetEmbed('marketcontext', params).run()
      else editor.storage?.uctJournalWidgets?.notify?.(
        'Market context could not be read just now, so nothing was added. Try /market context again.', 'error')
    },
  }),
]

// A bare `/` offers the moments a member reaches for something (Notebook widgets Task 8): before the
// open, planning a trade, reviewing, then the everyday basics and everything else (UX pass 2026-10-10
// put trading first; this splits it by moment). Typing narrows the list exactly as before; the groups
// only order and label it. A block item not named here is "more".
export const SLASH_GROUPS = [
  { id: 'open', label: 'Before the open' },
  { id: 'plan', label: 'Planning a trade' },
  { id: 'review', label: 'Reviewing' },
  { id: 'widgets', label: 'Widgets' },
  { id: 'tools', label: 'Mine' },
  { id: 'mine', label: 'My presets' },
  { id: 'basics', label: 'Basics' },
  { id: 'more', label: 'More' },
]
const BASICS = new Set([
  'Heading 1', 'Heading 2', 'Heading 3', 'Bullet list', 'Numbered list', 'Checklist', 'Due date', 'Reminder', 'Quote',
  'Divider', 'Table', 'Callout', 'Toggle', 'Image',
])
const MOMENT_BLOCKS = { 'Trade-plan canvas': 'plan', 'Journal style': 'plan', 'Transcript passage': 'review' }

/** Which group a block item belongs to. Trader blocks plan a trade; so do the chart and fact captures. */
export function blockItemGroup(item) {
  if (item.trader) return 'plan'
  return MOMENT_BLOCKS[item.title] || (BASICS.has(item.title) ? 'basics' : 'more')
}

/** The bare-`/` list in SLASH_GROUPS order, each item tagged with its group. In each group the
 *  captures come first, then the blocks. A capture without its own group (chart, price, plan...)
 *  plans a trade; a snapshot widget item carries its kind's group. */
export function groupedSlashItems(blocks, captures) {
  const tagged = [...captures.map((it) => ({ ...it, group: it.group || 'plan' })),
    ...blocks.map((it) => ({ ...it, group: blockItemGroup(it) }))]
  return SLASH_GROUPS.flatMap((g) => tagged.filter((it) => it.group === g.id))
}

/** Does a block item answer the typed query (its title, or one of its keywords)? */
export function blockItemMatches(item, q) {
  if (!q) return true
  return item.title.toLowerCase().includes(q)
    || (Array.isArray(item.keywords) && item.keywords.some((k) => k.includes(q)))
}

/** The block items that answer a typed query, BEST FIRST: a title that starts with the query,
 *  then a title that contains it, then a keyword-only match -- each tier in menu order. Enter
 *  takes the top row, so `/transcript` must put "Transcript passage" above "Voice note", which
 *  only lists "transcript" as a keyword (found by the fin walk 2026-10-10: the Transcript
 *  passages tour tells the member to type /transcript, and Enter opened the voice recorder). */
export function rankedBlockItems(items, q) {
  if (!q) return items
  const tier = (it) => {
    const t = it.title.toLowerCase()
    if (t.startsWith(q)) return 0
    if (t.includes(q)) return 1
    return 2
  }
  return items
    .filter((it) => blockItemMatches(it, q))
    .map((it, i) => ({ it, i, t: tier(it) }))
    .sort((a, b) => a.t - b.t || a.i - b.i)
    .map((x) => x.it)
}

/** The block items offered where the caret is now (an item's `available`). */
export function blockItemsAvailable(editor) {
  return ITEMS.filter((it) => {
    if (typeof it.available !== 'function') return true
    try { return Boolean(it.available({ editor })) } catch { return false }
  })
}

// 'YYYY-MM-DD' → 'Mar 13, 2026' for menu previews (UTC parts — no TZ drift).
function fmtDayTitle(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''))
  if (!m) return iso
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
    .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

// ── Wave F: /price captures the note's own ticker's CURRENT price as an
// immutable financial fact -- mirrors /chart's own "type a symbol → instant
// insert, no modal" shape, but the resulting node holds a reference (factId)
// to a real backend row rather than reconstructable params: a fact capture
// is a real API call (checkpoint decision 30), so the command handler is
// async, unlike every other slash command in this file. ────────────────────
const FACT_SYMBOL_RE = /^[A-Za-z][A-Za-z.\-]{0,9}$/

export function factItems(query) {
  const raw = String(query || '')
  const tokens = raw.trim().split(/\s+/).filter(Boolean)
  const first = tokens[0]?.toLowerCase() || ''
  const singleToken = tokens.length <= 1
  // Same two-regime rail as widgetItems: a single token is a PREFIX match
  // (completion, nothing to eat yet); once args/prose follow, only the exact
  // type name matches (prefix + args would arm the Enter-trap this file's
  // own header comment warns about).
  if (singleToken ? !'price'.startsWith(first) : first !== 'price') return []
  const rest = singleToken ? '' : raw.trim().slice(first.length).trim()
  if (!rest) {
    return [{
      title: 'Price',
      cmd: 'price',
      description: 'Type a symbol — e.g. /price NVDA',
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).insertContent('/price ').run()
      },
    }]
  }
  const symTokens = rest.split(/\s+/).filter(Boolean)
  if (symTokens.length !== 1 || !FACT_SYMBOL_RE.test(symTokens[0])) return []
  const symbol = symTokens[0].toUpperCase()
  return [{
    title: `Price — ${symbol}`,
    cmd: 'price',
    description: 'Capture the current price as a financial fact',
    command: async ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run()
      const noteId = editor?.storage?.uctJournalWidgets?.noteId
      if (!noteId) return
      try {
        const res = await fetch(`/api/j2/notes/${noteId}/facts`, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ticker: symbol, factType: 'price' }),
        })
        if (!res.ok) return
        const { fact } = await res.json()
        editor.chain().focus().insertContent({ type: 'financialFact', attrs: { factId: fact.id } }).run()
      } catch {
        // A failed capture must not corrupt the note (directive §48) --
        // nothing was inserted; the member sees nothing changed and can retry.
      }
    },
  }]
}

// ── Notebook widgets Task 8: the fetch-and-freeze snapshot items, one per kind whose wave is on (the
// gate decides what is OFFERED, never whether a stored widget renders). ONE builder for the / menu and
// the widget palette. A kind that reads a symbol takes the /price matching: a bare prefix completes to
// `/ticker `, a valid symbol inserts, anything else offers nothing so Enter stays a newline.
const SNAPSHOT_SYMBOL_CMD = { tickerCard: 'ticker', tickerFlow: 'flow' }

/** The command for one snapshot: the typed range leaves at once (a palette has none, so it steps
 *  off a selected embed instead), "Adding …" shows at once and nothing goes in until the fetch answers, then the frozen widget
 *  goes in where the command was, mapped through anything the member typed meanwhile. A failed fetch
 *  inserts nothing and says so. Resolves `{ok, message}` for the palette's own status line. */
const widgetsFetch = () => import('../../lib/notebookWidgetsFetch')
// F2 cleanup: a lazy chunk that cannot load (lost after a deploy) is said, never silent; offline is offline.
const lost = () => (typeof navigator !== 'undefined' && navigator.onLine === false ? { ok: false, reason: 'offline' }
  : { ok: false, message: WIDGET_CHUNK_LOST })
// R58 (UX I-2): the inserts in flight, one per kind and settings, so a second Enter or click adds nothing. Per editor
// (review m-1): the same widget asked for in another note is that note's own insert.
const inflight = new WeakMap()
export function snapshotCommand(kind, params) {
  return async ({ editor, range }) => {
    const chain = editor.chain().focus()
    ;(range ? chain.deleteRange(range) : chain.caretAfterWidgetEmbed()).run()
    const key = kind.id + JSON.stringify(params)
    const adding = `Adding ${kind.title}…`
    const offline = `You're offline, so ${kind.title} was not added.`
    const failed = `${kind.title} could not be loaded just now, so nothing was added.`
    // Review I-3: "Adding …" is a busy toast (it stays until the result replaces it), and a second Enter says it again.
    const say = (m, tone = 'error') => editor.storage?.uctJournalWidgets?.notify?.(m, tone)
    say(adding, 'busy')
    const busy = inflight.get(editor) || new Set()
    inflight.set(editor, busy)
    if (busy.has(key)) return { ok: false, message: adding }
    busy.add(key)
    // Where the typed command was (its range's start once deleted); the palette's caret otherwise.
    let pos = range ? range.from : editor.state.selection.from
    const track = ({ transaction }) => { pos = transaction.mapping.map(pos) }
    editor.on('transaction', track)
    try {
      // A Task 16 kind fetches and builds through its lazily loaded capture module; a snapshot kind's fetch is lazy too
      // (Task 16D: first-open bytes). A chunk that cannot load answers `lost()`: offline when the browser says so, else
      // the reload sentence.
      const res = kind.capture
        ? await kind.capture(params).catch(lost)
        : await widgetsFetch().then((m) => m.fetchWidgetPayload(kind.id, params), lost)
      if (!res.ok) {
        if (editor.isDestroyed) return { ok: false, message: null }
        // A capture may name its own sentence (a news feed not built yet); otherwise offline vs failed.
        const message = res.message || (res.reason === 'offline'
          ? offline
          : failed)
        say(message)
        return { ok: false, message }
      }
      // The insert, and final review M-2's writability check, run in the module the fetch loads (first-open
      // bytes). `pos` is read when it runs, so anything typed meanwhile is mapped through.
      // Review N-2: a throw inside the insert says the failed sentence (it replaces the busy toast, never strands it).
      const landed = await widgetsFetch().then((m) => m.landSnapshot(editor, kind.id, { ...res.payload, ...params }, () => pos, kind.title),
        lost).catch(() => ({ ok: false, message: failed }))
      // Review m-3: the insert's chunk lost while offline is said as offline (lost() names no sentence for it).
      if (landed.reason) landed.message = offline
      if (landed.message) say(landed.message)
      return landed
    } finally {
      editor.off('transaction', track)
      busy.delete(key)
    }
  }
}

/** ONE background load per source, for the member's own rows (Task 17's pattern, shared by Task 20).
 *  ⛔ SYNCHRONOUS. Suggestion awaits items() before it draws anything, so a read here would hold the
 *  whole menu. `kick(editor)` answers what is already loaded and starts ONE background load when nothing is, or
 *  it is over 60 s old; a failed load waits 30 s before the next. The rows show on the next update.
 *  Final review M-3: the rows are the signed-in member's own, so the cache is KEYED to the member id the
 *  editor holds (`uid` in its storage, NoteEditorPage): a different id starts from nothing, and a load the
 *  previous member started lands in the previous member's slot, never the new one. */
function background(load) {
  let s
  const reset = (uid) => { s = { v: null, at: 0, failedAt: 0, loading: null, uid } }
  // Fix round 1 m-3: forget this member's rows (the next kick loads them again); a load in flight lands in the old slot.
  const drop = () => reset(s.uid)
  reset()
  const kick = (editor) => {
    const uid = editor?.storage?.uctJournalWidgets?.uid
    if (uid !== s.uid) reset(uid)
    const t = s
    const now = Date.now()
    if (!t.loading && now - t.failedAt >= 30000 && !(t.v && now - t.at < 60000)) {
      t.loading = load(uid)
        .then((v) => { t.v = v; t.at = Date.now() }, () => { t.failedAt = Date.now() })
        .finally(() => { t.loading = null })
    }
    return t.v
  }
  return { kick, wait: () => s.loading || Promise.resolve(), reset, drop }
}

/** Task 17 (wave 5): the member's own presets and chart sets, under "My presets". The rows and the sets
 *  come from lib/notebookSets.js, loaded only here and only while wave 5 is on (first-open bytes); a
 *  preset inserts through snapshotCommand, the one snapshot insert. */
const mine = background((uid) => import('../../lib/notebookSets').then(async (m) => {
  const doc = await m.loadSets({ fresh: true, uid })
  if (doc.failed) throw doc
  return { m, doc }
}))
export function mineItems(query, editor) {
  if (!widgetsWaveOn(5)) return []
  const v = mine.kick(editor)
  // The module's own copy wins (a save in this tab updates it at once), and only while it is this member's (R60).
  const doc = v && (v.m.peekSets(editor?.storage?.uctJournalWidgets?.uid) || v.doc)
  return doc ? [...v.m.presetRows(query, doc, 'mine', snapshotCommand), ...v.m.chartSetRows(query, doc, 'mine')] : []
}
/** Tests only: the load in flight (or none), and a clean slate. */
export const __mineLoad = () => mine.wait()
export const __resetMine = () => mine.reset()

/** Task 20 (wave 6): `/recap` lists the member's recent closed trades and `/screen` their saved screens, each
 *  row inserting a Trade recap or My screen today through snapshotCommand. The rows live in the module the
 *  snapshot insert already loads (lib/notebookWidgetsFetch.js), read only while wave 6 is on (first-open bytes). */
const picks = background(() => widgetsFetch().then(async (m) => ({ m, doc: await m.loadPicks() })))
export function pickItems(query, editor) {
  if (!widgetsWaveOn(6)) return []
  const v = picks.kick(editor)
  // Wave 10 (Task 10.21): `/actual` lists the same trades for Plan vs actual.
  return v ? v.m.pickRows(query, v.doc, snapshotCommand, { actual: widgetsWaveOn(10) }) : []
}
export const __picksLoad = () => picks.wait()
export const __resetPicks = () => picks.reset()

// ── Notebook widgets phase 2 (wave 8, Task 8.18): the "Mine" group. "Build a widget" first, the member's own widgets
// (at most BARE_ROWS on a bare `/`, every match when typed), "Manage my tools" last; `/widgets` opens the examples. The
// list comes through lib/builtWidgets (the ONE widget HTTP client) in this background loader, keyed to the member; that
// client, the builder and My tools are reached only by dynamic import (first-open bytes). A row inserts through
// snapshotCommand, the one snapshot insert ("Adding <name>…", then "<name> added."), with a failure said in the
// client's own words. The kept-draft offer is the builder's own reader (builderDraft.readDraft), never a second one.
const built = background((uid) => Promise.all([import('../../lib/builtWidgets'), widgetsFetch(),
  import('./widgetBuilder/builderDraft')]).then(async ([b, f, d]) => {
  // Fix round 1 m-3: a save, archive, delete or restore anywhere in this tab drops the rows (the client's one hook).
  b.onWidgetsChanged(dropBuilt)
  return { b, f, d, uid, list: await b.loadWidgetList() }
}))
function dropBuilt() { built.drop() }
const doorLost = (editor) => editor?.storage?.uctJournalWidgets?.notify?.(doorLostSentence(), 'error')
// The note page's router (NoteEditorPage puts it on the editor's storage), so a link out of the builder or My tools
// moves the router instead of loading the whole page (R-45, fix round 1 I-1).
const routerOf = (editor) => {
  const nav = editor?.storage?.uctJournalWidgets?.navigate
  return typeof nav === 'function' ? { navigate: nav } : {}
}
const toBuilder = ({ editor, range }) => {
  editor.chain().focus().deleteRange(range).run()
  return import('./widgetBuilder/openWidgetBuilder.js')
    .then((m) => { m.openWidgetBuilder({ editor, start: 'examples', ...routerOf(editor) }) }, () => doorLost(editor))
}
const TOOLS_ROW = {
  title: 'Manage my tools', cmd: 'tools', keywords: ['tools', 'my tools', 'manage', 'widgets'],
  description: 'Rename, copy, archive and restore your widgets',
  command: ({ editor, range }) => {
    editor.chain().focus().deleteRange(range).run()
    return import('./myTools/openMyTools.js').then((m) => { m.openMyTools({ editor, tab: 'widgets', ...routerOf(editor) }) }, () => doorLost(editor))
  },
}
const GALLERY_ROW = {
  title: 'Widget examples', cmd: 'widgets', keywords: ['widgets', 'examples', 'gallery'],
  description: 'Start from a ready-made widget', command: toBuilder,
}
function builtRow(v, w) {
  const title = typeof w.name === 'string' && w.name.trim() ? w.name.trim() : 'Widget'
  const kind = {
    id: v.b.BUILT_KIND, title,
    // Offline is said as the insert's own offline sentence; anything else in the client's words (a 402, busy, a cap).
    capture: (params) => v.b.runBuilt(params).then((got) => (got.ok ? { ok: true, payload: got.data }
      : got.code === 'offline' ? { ok: false, reason: 'offline' } : { ok: false, message: v.b.failureText(got.code, got.message) })),
  }
  return { title, defId: w.id, keywords: ['widget'], mark: v.b.MARK_YOURS, description: typeof w.summary === 'string' && w.summary ? w.summary : 'A widget you built',
    command: snapshotCommand(kind, { defId: w.id }) }
}
export function builtItems(query, editor) {
  if (!widgetsWaveOn(8)) return []
  const v = built.kick(editor)
  const q = String(query || '').trim().toLowerCase()
  const kept = v && v.d.readDraft(v.uid, null)
  const build = { title: 'Build a widget', cmd: 'build', keywords: ['build', 'widget', 'new widget', 'create'],
    description: kept ? v.d.RESUME_OFFER : 'Start from an example, or from blank', command: toBuilder }
  const rows = v ? v.list.map((w) => builtRow(v, w)) : []
  if (!q) return [build, ...rows.slice(0, v ? v.f.BARE_ROWS : 0), TOOLS_ROW].map((it) => ({ ...it, group: 'tools' }))
  return rankedBlockItems([GALLERY_ROW, build, ...rows, TOOLS_ROW], q)
}
/** Tests only: the load in flight (or none), and a clean slate. */
export const __builtLoad = () => built.wait()
export const __resetBuilt = () => built.reset()

// ── Notebook widgets phase 2 (wave 9, Task 9.19): routines and trackers in the "Mine" group. "Routine (remembered
// daily)" (/routine) and "Tracker (one value a day)" (/track) open the tool picker; after the widget rows come the
// member's own routines then trackers (at most BARE_ROWS of each on a bare `/`, every match when typed), each inserting
// its block at once, bound to the note's day (lib/toolEmbed, the one insert). The lists come through lib/toolsCrud (the
// ONE routine and tracker client) in this background loader, keyed to the member; that client and the picker are
// reached only by dynamic import (first-open bytes). A write through that client drops the rows (its one hook).
const toPicker = (kind) => ({ editor, range }) => {
  editor.chain().focus().deleteRange(range).run()
  return import('./routines/openToolPicker.js')
    .then((m) => { m.openToolPicker({ editor, kind, ...routerOf(editor) }) }, () => doorLost(editor))
}
const PICKER_ROWS = Object.freeze({
  routine: {
    title: 'Routine (remembered daily)', cmd: 'routine', description: 'Tick it every trading day; it never changes the note',
    keywords: ['routine', 'habit', 'daily', 'pre-market', 'rules', 'process'], command: toPicker('routine'),
  },
  tracker: {
    title: 'Tracker (one value a day)', cmd: 'track', description: 'Log sleep, focus or anything once a day',
    keywords: ['track', 'tracker', 'sleep', 'mood', 'log', 'habit'], command: toPicker('tracker'),
  },
})
const TOOL_ROW_WORDS = Object.freeze({
  routine: { keywords: ['routine'], description: "Your routine, for this note's day" },
  tracker: { keywords: ['tracker'], description: "Your tracker, for this note's day" },
})
const liveTool = (t) => t && typeof t === 'object' && typeof t.id === 'string' && t.id && !t.archived && !t.deleted
const tools = background(() => Promise.all([import('../../lib/toolsCrud'), widgetsFetch()]).then(async ([c, f]) => {
  // A create, save, archive, delete or restore through the client anywhere in this tab drops the rows.
  c.onToolsChanged(dropTools)
  const [r, t] = await Promise.all([c.listTools('routine'), c.listTools('tracker')])
  // Fix round 1 (m-3): EITHER read failing is a failed load. A kind is never cached as an empty list: the last good
  // rows stay (background() keeps them), the 30 s back-off reads again, and the picker item says its own failure line.
  if (!r.ok) throw r
  if (!t.ok) throw t
  return { f, routine: r.data.filter(liveTool), tracker: t.data.filter(liveTool) }
}))
function dropTools() { tools.drop() }
function toolRow(kind, tool) {
  const title = typeof tool.name === 'string' && tool.name.trim() ? tool.name.trim() : kind === 'routine' ? 'Routine' : 'Tracker'
  return { title, toolId: tool.id, ...TOOL_ROW_WORDS[kind],
    command: ({ editor, range }) => { insertToolBlock(editor, kind, tool, range) } }
}
/** The member's routine and tracker rows (wave 9), with the two picker items. Typed, every match in menu order: the
 *  ONE ranking is mineGroupItems', over the whole Mine group (widgets and tools together). */
export function toolItems(query, editor) {
  if (!widgetsWaveOn(9)) return []
  const v = tools.kick(editor)
  const q = String(query || '').trim().toLowerCase()
  const rows = (kind) => (v ? v[kind].map((t) => toolRow(kind, t)) : [])
  if (!q) {
    const n = v ? v.f.BARE_ROWS : 0
    return [PICKER_ROWS.routine, ...rows('routine').slice(0, n), PICKER_ROWS.tracker, ...rows('tracker').slice(0, n)]
      .map((it) => ({ ...it, group: 'tools' }))
  }
  return [PICKER_ROWS.routine, PICKER_ROWS.tracker, ...rows('routine'), ...rows('tracker')].filter((it) => blockItemMatches(it, q))
}
/** Tests only: the load in flight (or none), and a clean slate. */
export const __toolsLoad = () => tools.wait()
export const __resetTools = () => tools.reset()

/** The Mine group: the widget rows (wave 8), then the routine and tracker rows (wave 9) before "Manage my tools". With
 *  wave 9 off this is builtItems' answer exactly. Typed, the two lists are ranked together. */
export function mineGroupItems(query, editor) {
  const widgets = builtItems(query, editor)
  const own = toolItems(query, editor)
  if (!own.length) return widgets
  const q = String(query || '').trim().toLowerCase()
  if (q) return rankedBlockItems([...widgets, ...own], q)
  const manage = widgets.findIndex((it) => it.cmd === TOOLS_ROW.cmd)
  return manage < 0 ? [...widgets, ...own] : [...widgets.slice(0, manage), ...own, ...widgets.slice(manage)]
}

// ── Notebook widgets wave 10 (Task 10.21, spec 8): the ready-made widgets. A bare `/` lists at most eight under
// "Widgets" (the member's most used, then the defaults), then "All widgets…"; typed, every card is ranked with the
// blocks. The rows live in lib/builtInWidgets, reached only by this dynamic import (first-open bytes). Dark while
// wave 10 is off; a shelf that cannot be read leaves the defaults that need none (SHELF_UNREAD says so by name).
const builtIn = background(() => import('../../lib/builtInWidgets')
  .then(async (m) => ({ m, doc: await m.loadBuiltIn().catch(() => m.SHELF_UNREAD) })))
export function builtInItems(query, editor) {
  if (!widgetsWaveOn(8) || !widgetsWaveOn(10)) return []
  const v = builtIn.kick(editor)
  if (!v) return []
  const rows = v.m.builtInRows(query, v.doc, snapshotCommand, editor?.storage?.uctJournalWidgets?.uid)
  if (String(query || '').trim()) return rows
  const all = { title: v.m.ALL_WIDGETS, description: v.m.ALL_WIDGETS_HINT, command: toBuilder }
  return [...rows, all].map((it) => ({ ...it, group: 'widgets' }))
}
/** Tests only: the load in flight (or none), and a clean slate. */
export const __builtInLoad = () => builtIn.wait()
export const __resetBuiltIn = () => builtIn.reset()

export function snapshotWidgetItems(query) {
  const raw = String(query || '').trim()
  const tokens = raw.split(/\s+/).filter(Boolean)
  const first = tokens[0]?.toLowerCase() || ''
  const singleToken = tokens.length <= 1
  const out = []
  for (const kind of [...WIDGET_KINDS, ...CAPTURE_KINDS]) {
    // `held`: a kind Wave R keeps dark (captureRelease.js); no wave flag releases it.
    // `pick`: a kind that needs the member's choice (a trade, a screen) is listed by pickItems instead.
    // `built` (wave 8): a widget the member built is inserted from the builder or the Mine rows, never bare.
    // `dedicated` (wave 10): its only door is a POST, which this GET insert cannot reach; builtInItems lists it.
    if (kind.pick || kind.built || kind.dedicated || !widgetsWaveOn(kind.wave) || (kind.held && !captureEnabled())) continue
    const item = { title: kind.title, description: kind.description, group: kind.group }
    const cmd = kind.cmd || SNAPSHOT_SYMBOL_CMD[kind.id]
    // `/calendar` inserts today's day; `/calendar 3/13` that day; anything else after it offers nothing.
    if (kind.day && !singleToken) {
      const date = first === kind.id && tokens.length === 2 && parseDayToken(tokens[1])
      if (date) out.push({ ...item, cmd: first, title: `${kind.title} — ${fmtDayTitle(date)}`, command: snapshotCommand(kind, { date }) })
      continue
    }
    if (!cmd) {
      if (blockItemMatches(kind, raw.toLowerCase())) out.push({ ...item, command: snapshotCommand(kind, {}) })
      continue
    }
    if (singleToken ? !cmd.startsWith(first) : first !== cmd) continue
    const rest = singleToken ? '' : raw.slice(first.length).trim()
    if (!rest) {
      out.push({ ...item, cmd, description: `Type a symbol — e.g. /${cmd} NVDA`,
        command: ({ editor, range }) => { editor.chain().focus().deleteRange(range).insertContent(`/${cmd} `).run() } })
      continue
    }
    const sym = rest.replace(/^\$/, '')
    if (!FACT_SYMBOL_RE.test(sym)) continue
    const symbol = sym.toUpperCase()
    out.push({ ...item, cmd, title: `${kind.title} — ${symbol}`, command: snapshotCommand(kind, { symbol }) })
  }
  return out
}

// ── Tier 2 part A, item 9: /plan NVDA makes a Trade plan note for NVDA (the member's default
// Trade plan style, with their own levels and a dated price) and links it at the caret. The
// same two-regime matching as /price; dispatched on this editor's own DOM root (I5), like /canvas.
export function planItems(query) {
  if (!journalStylesEnabled()) return []
  const raw = String(query || '')
  const tokens = raw.trim().split(/\s+/).filter(Boolean)
  const first = tokens[0]?.toLowerCase() || ''
  const singleToken = tokens.length <= 1
  if (singleToken ? !'plan'.startsWith(first) : first !== 'plan') return []
  const rest = singleToken ? '' : raw.trim().slice(first.length).trim()
  if (!rest) {
    return [{
      title: 'Trade plan', cmd: 'plan', description: 'Type a symbol — e.g. /plan NVDA',
      command: ({ editor, range }) => { editor.chain().focus().deleteRange(range).insertContent('/plan ').run() },
    }]
  }
  const symTokens = rest.split(/\s+/).filter(Boolean)
  if (symTokens.length !== 1 || !FACT_SYMBOL_RE.test(symTokens[0].replace(/^\$/, ''))) return []
  const symbol = symTokens[0].replace(/^\$/, '').toUpperCase()
  return [{
    title: `Trade plan — ${symbol}`, cmd: 'plan',
    description: 'A Trade plan note with your levels and the price, linked here',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run()
      editor.view.dom.dispatchEvent(new CustomEvent(PLAN_EVENT, { bubbles: true, detail: { symbol } }))
    },
  }]
}

// ── G-062 (wave 10, lane G62): /consensus captures the note's own ticker's
// analyst price-target CONSENSUS -- the exact same shape as /price above
// (mirrored deliberately, not unified, so each command's own tests stay
// independent): a single-token prefix completes to the bare command; a
// trailing symbol produces the real capture item; the command handler is
// async for the same "a fact capture is a real API call" reason (checkpoint
// decision 30). Active since the owner's 2026-09-25 FMP licensing approval
// (docs/notebook/VENDOR-TERMS-2026-09-23.md §5 L5/L2) --
// `fact_registry.FACT_TYPES['analyst_price_target_consensus'].active`. ──────
export function consensusFactItems(query) {
  const raw = String(query || '')
  const tokens = raw.trim().split(/\s+/).filter(Boolean)
  const first = tokens[0]?.toLowerCase() || ''
  const singleToken = tokens.length <= 1
  if (singleToken ? !'consensus'.startsWith(first) : first !== 'consensus') return []
  const rest = singleToken ? '' : raw.trim().slice(first.length).trim()
  if (!rest) {
    return [{
      title: 'Analyst Consensus',
      cmd: 'consensus',
      description: 'Type a symbol — e.g. /consensus NVDA',
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).insertContent('/consensus ').run()
      },
    }]
  }
  const symTokens = rest.split(/\s+/).filter(Boolean)
  if (symTokens.length !== 1 || !FACT_SYMBOL_RE.test(symTokens[0])) return []
  const symbol = symTokens[0].toUpperCase()
  return [{
    title: `Analyst Consensus — ${symbol}`,
    cmd: 'consensus',
    description: 'Capture the analyst price-target consensus as a financial fact',
    command: async ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run()
      const noteId = editor?.storage?.uctJournalWidgets?.noteId
      if (!noteId) return
      try {
        const res = await fetch(`/api/j2/notes/${noteId}/facts`, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ticker: symbol, factType: 'analyst_price_target_consensus' }),
        })
        // Honest missing data: a 400 here is most likely
        // note_facts.create_fact_observation's "No analyst price target
        // consensus available" refusal (FMP unconfigured, or no consensus
        // for this ticker) -- never fabricate a number, just insert nothing,
        // same as /price's own failed-capture behaviour.
        if (!res.ok) return
        const { fact } = await res.json()
        editor.chain().focus().insertContent({ type: 'financialFact', attrs: { factId: fact.id } }).run()
      } catch {
        // A failed capture must not corrupt the note (directive §48) --
        // nothing was inserted; the member sees nothing changed and can retry.
      }
    },
  }]
}

// ── Widget embeds (Journal Widgets) ─────────────────────────────────────────
// Registry-driven: every menus.journal type appears here automatically. The
// query's trailing tokens are ARGUMENTS — `/chart AMD 15m` inserts an AMD 15m
// snapshot directly (speed is the whole feature: no modal, no picker).
export function widgetItems(query) {
  const raw = String(query || '')
  const tokens = raw.trim().split(/\s+/).filter(Boolean)
  const first = tokens[0]?.toLowerCase() || ''
  const singleToken = tokens.length <= 1
  const out = []
  for (const id of JOURNAL_MENU_TYPES) {
    // Two matching regimes (the first cut of the Enter-trap fix demanded the
    // exact word everywhere and killed discoverability — '/ch' showed nothing):
    // - SINGLE token: prefix match. '/ch' offers Chart, and its command
    //   COMPLETES the text to '/chart ' — there is no prose after the name
    //   yet, so nothing can be eaten.
    // - Once a SPACE exists (args/prose follow): the exact type name only.
    //   With allowSpaces keeping a mid-sentence '/' suggestion alive, prefix
    //   matching here ('/c NVDA…') armed an Enter trap on ordinary prose.
    if (singleToken ? !id.startsWith(first) : first !== id) continue
    if (id === 'chart') {
      const rest = singleToken ? '' : raw.trim().slice(first.length).trim()
      const args = parseChartSlashArgs(rest)
      if (args) {
        out.push({
          cmd: 'chart',
          title: `Chart — ${args.symbol} · ${tfText(args.tf)}${args.day ? ` @ ${fmtDayTitle(args.day)}` : ''}`,
          description: args.day
            ? 'Insert a chart anchored at that date'
            : 'Insert a frozen chart snapshot',
          command: ({ editor, range }) => {
            // settings: the user's RESOLVED own-chart blob, stamped into
            // editor storage by NoteEditorPage — frozen at insert so a March
            // embed never repaints when the user re-themes in April. Node
            // payload comes from chartInsertNodes — ONE builder shared with
            // the widget palette, never a second hand-written copy.
            const settings = editor.storage?.uctJournalWidgets?.chartSettings
            editor.chain().focus().deleteRange(range)
              .insertContent(chartInsertNodes('chart', args, settings))
              .caretAfterWidgetEmbed()
              .run()
          },
        })
      } else if (!rest) {
        // The hint renders ONLY for a bare '/chart' — once free text follows
        // that doesn't parse as SYMBOL [tf] [date], the menu must offer
        // NOTHING so Enter stays a newline and the prose survives.
        out.push({
          title: 'Chart',
          cmd: 'chart',
          description: 'Type a symbol — e.g. /chart AMD 15m or /chart AMD D 3/13',
          command: ({ editor, range }) => {
            editor.chain().focus().deleteRange(range).insertContent('/chart ').run()
          },
        })
      }
    }
  }

  // ── Composition presets (spec Phase 6 #4/#5): one action → N chart nodes.
  // Same two-regime matching + strictness contract as /chart: bare name
  // completes, valid args insert, anything else offers NOTHING (Enter stays
  // a newline — the '/chart looks great here' lesson).
  const restAfterName = singleToken ? '' : raw.trim().slice(first.length).trim()
  // Wave 13 lane 13H-2: the weekly stack (`/mtf AMD W`) and `/vs` are dark behind the
  // chart-plan gate -- read once per query, never a second flag.
  const planOn = chartPlanEnabled()
  if (singleToken ? 'mtf'.startsWith(first) : first === 'mtf') {
    const args = restAfterName ? parseMtfSlashArgs(restAfterName, { weekly: planOn }) : null
    if (args) {
      out.push({
        cmd: 'mtf',
        title: `MTF stack — ${args.symbol} · ${args.tfs.map(tfText).join(' / ')}${args.day ? ` @ ${fmtDayTitle(args.day)}` : ''}`,
        description: args.day ? 'Three charts, top-down, anchored at that date' : 'Three frozen charts, top-down',
        command: ({ editor, range }) => {
          const settings = editor.storage?.uctJournalWidgets?.chartSettings
          editor.chain().focus().deleteRange(range)
            .insertContent(chartInsertNodes('mtf', args, settings))
            .caretAfterWidgetEmbed()
            .run()
        },
      })
    } else if (!restAfterName) {
      out.push({
        title: 'MTF stack',
        cmd: 'mtf',
        description: planOn
          ? 'Type a symbol — e.g. /mtf AMD (D + 1h + 15m), /mtf AMD W (W + D + 1h); add a date to anchor'
          : 'Type a symbol — e.g. /mtf AMD (D + 1h + 15m; add a date to anchor)',
        command: ({ editor, range }) => {
          editor.chain().focus().deleteRange(range).insertContent('/mtf ').run()
        },
      })
    }
  }
  if (singleToken ? 'compare'.startsWith(first) : first === 'compare') {
    const args = restAfterName ? parseCompareSlashArgs(restAfterName) : null
    if (args) {
      const tfSuffix = args.tf !== 'D' ? ` · ${tfText(args.tf)}` : ''
      out.push({
        cmd: 'compare',
        title: `Before / after — ${args.symbol} @ ${fmtDayTitle(args.day)}${tfSuffix}`,
        description: `Two half-width ${args.tf === 'D' ? 'dailies' : `${tfText(args.tf)} charts`}: window ending that day vs now`,
        command: ({ editor, range }) => {
          const settings = editor.storage?.uctJournalWidgets?.chartSettings
          editor.chain().focus().deleteRange(range)
            .insertContent(chartInsertNodes('compare', args, settings))
            .caretAfterWidgetEmbed()
            .run()
        },
      })
    } else if (!restAfterName) {
      out.push({
        title: 'Before / after',
        cmd: 'compare',
        description: 'Type symbol + day — e.g. /compare AMD 3/13 (add 15m for intraday)',
        command: ({ editor, range }) => {
          editor.chain().focus().deleteRange(range).insertContent('/compare ').run()
        },
      })
    }
  }
  if (planOn && (singleToken ? 'vs'.startsWith(first) : first === 'vs')) {
    out.push(...vsItems(restAfterName))
  }
  return out
}

/** Wave 13 lane 13H-2 -- `/vs`: the stock beside SPY, QQQ, its sector ETF or its theme ETF,
 *  both frozen at the same `to` (chartInsertNodes('vs')). Without a benchmark the menu offers
 *  all four; `sector` / `theme` are resolved by the server at insert time
 *  (GET /api/j2/chart-plan/benchmarks), and a stock with no such ETF inserts NOTHING -- an
 *  honest miss, never a guessed benchmark (the /price failure contract). */
const VS_KEYWORD_TITLE = { sector: 'its sector ETF', theme: 'its theme ETF' }
function vsItems(rest) {
  if (!rest) {
    return [{
      title: 'Versus',
      cmd: 'vs',
      description: 'Type a symbol — e.g. /vs AMD (beside SPY, QQQ, its sector or theme ETF)',
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).insertContent('/vs ').run()
      },
    }]
  }
  const args = parseVsSlashArgs(rest)
  if (!args) return []
  const benches = args.bench ? [args.bench] : [...VS_BROAD, ...VS_KEYWORDS]
  const at = args.day ? ` @ ${fmtDayTitle(args.day)}` : ''
  const tfSuffix = args.tf !== 'D' ? ` · ${tfText(args.tf)}` : ''
  return benches.filter((b) => b !== args.symbol).map((bench) => ({
    cmd: 'vs',
    title: `Versus — ${args.symbol} vs ${VS_KEYWORD_TITLE[bench] || bench}${at}${tfSuffix}`,
    description: 'Two half-width charts frozen at the same moment',
    command: async ({ editor, range }) => {
      const settings = editor.storage?.uctJournalWidgets?.chartSettings
      editor.chain().focus().deleteRange(range).run()
      let benchmark = bench
      let label = null
      if (VS_KEYWORDS.includes(bench)) {
        try {
          const res = await fetch(`/api/j2/chart-plan/benchmarks?symbol=${encodeURIComponent(args.symbol)}`,
            { credentials: 'include' })
          // A failed lookup inserts nothing (directive §48: the note is untouched) -- and SAYS so,
          // through the note's own toast. The typed command is already gone, so silence here
          // read as the command having done nothing at all.
          const say = (text) => editor.storage?.uctJournalWidgets?.notify?.(text, 'error')
          const down = `The ${bench} ETF for ${args.symbol} could not be looked up just now, so nothing was added. Try /vs again.`
          if (!res.ok) { say(down); return }
          const body = await res.json()
          const hit = (body?.options || []).find((o) => o.key === bench)
          if (!hit?.symbol) {
            say(`${args.symbol} has no ${bench} ETF on file, so nothing was added. Try /vs ${args.symbol} SPY.`)
            return
          }
          benchmark = hit.symbol
          label = hit.label || null
        } catch {
          editor.storage?.uctJournalWidgets?.notify?.(
            `The ${bench} ETF for ${args.symbol} could not be looked up just now, so nothing was added. Try /vs again.`, 'error')
          return
        }
      }
      editor.chain().focus()
        .insertContent(chartInsertNodes('vs', { ...args, benchmark, label }, settings))
        .caretAfterWidgetEmbed()
        .run()
    },
  }))
}

/** The slash menu's rows for one query. `mine` is mineItems' answer (wave 5), empty otherwise: grouped
 *  under "My presets" on a bare `/`; typed, a preset row keeps its label and a chart set row does not.
 *  `builtIn` is builtInItems' answer (wave 10): bare, the "Widgets" group (a phase 1 widget listed there is not listed
 *  again under its moment); typed, ranked with the blocks, so a name match leads a keyword match. */
export function slashItems(query, editor, mine = [], builtIn = []) {
  const q = (query || '').toLowerCase()
  const widgets = widgetItems(query)
  const factCaptures = factItems(query)
  const consensusCaptures = consensusFactItems(query)
  const planCaptures = planItems(query)
  const snapshots = snapshotWidgetItems(query)
  // Wave 6: an item may say where it is NOT offered (`available`) —
  // today only columns, never inside a column (they do not nest). A
  // table of contents is an ordinary block and is offered anywhere.
  const here = blockItemsAvailable(editor)
  if (!q) {
    const listed = new Set(builtIn.map((it) => it.title))
    return groupedSlashItems(here, [...snapshots.filter((it) => !listed.has(it.title)), ...widgets, ...factCaptures,
      ...consensusCaptures, ...planCaptures, ...mine, ...builtIn])
  }
  // Widget/fact items match on their own tokenized rules (args after
  // the type name would defeat a plain substring filter).
  // ⛔ R-T12-1: a command the member has NAMED in full (`/price`, `/price st`) goes first --
  // ahead of a block whose title merely starts with the word ("Price stamps"), or Enter
  // inserts the block. A partial word (`/pri`) names nothing yet, so the blocks lead.
  // R-T12-4: but a block's FULL title ("/price stamps") names that block, and leads.
  // A typed list is not grouped, so a snapshot item's own group is dropped (no label).
  const captures = [...widgets, ...factCaptures, ...consensusCaptures, ...planCaptures,
    ...snapshots.map(({ group, ...it }) => it), // eslint-disable-line no-unused-vars
    ...mine.map(({ group, ...it }) => (it.cmd === 'preset' ? { ...it, group } : it))]
  const cmd = q.trim().split(/\s+/)[0]
  const blocks = rankedBlockItems([...here, ...builtIn], q)
  const exact = blocks.filter((it) => it.title.toLowerCase() === q.trim())
  return [...exact, ...captures.filter((it) => it.cmd === cmd),
    ...blocks.filter((it) => !exact.includes(it)), ...captures.filter((it) => it.cmd !== cmd)]
}

/** The menu's rows for one query, as the Suggestion asks for them. Waves 5, 6, 8 and 9 add the member's own rows
 *  (mineGroupItems, mineItems, pickItems): whatever is loaded, never awaited. M-3: the caches are keyed to the
 *  signed-in member the editor holds. Wave 10 adds the ready-made widgets (builtInItems), loaded the same way. */
export const menuItems = (query, editor) => slashItems(query, editor,
  [...mineGroupItems(query, editor), ...mineItems(query, editor), ...pickItems(query, editor)], builtInItems(query, editor))

export const SlashList = forwardRef((props, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const items = props.items
  const menuId = props.menuId || 'uct-slash-menu'

  useEffect(() => setSelectedIndex(0), [items])

  // ARIA combobox wiring: the render() closure points the EDITOR's
  // aria-activedescendant at the active option (the editor is the focused
  // element — an activedescendant on the unfocused listbox itself is inert).
  useEffect(() => {
    props.onActiveChange?.(items.length ? `${menuId}-opt-${selectedIndex}` : null)
  }, [selectedIndex, items, menuId]) // eslint-disable-line react-hooks/exhaustive-deps

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      // No matching items = no visible menu — every key must pass through to
      // the editor. Swallowing Enter/arrows here with an EMPTY list broke
      // normal typing the moment allowSpaces kept a mid-sentence '/'
      // suggestion alive past its first space.
      if (!items.length) return false
      if (event.key === 'ArrowUp') {
        setSelectedIndex((selectedIndex + items.length - 1) % items.length)
        return true
      }
      if (event.key === 'ArrowDown') {
        setSelectedIndex((selectedIndex + 1) % items.length)
        return true
      }
      if (event.key === 'Enter') {
        const item = items[selectedIndex]
        if (item) props.command(item)
        return true
      }
      return false
    },
  }))

  if (!items.length) return null

  return (
    <div className={styles.menu} role="listbox" id={menuId} aria-label="Insert block">
      {items.map((item, i) => {
        // A group label is visual only (aria-hidden): the options keep their own names, and the
        // listbox's children stay options for assistive tech.
        const label = item.group && item.group !== items[i - 1]?.group
          ? SLASH_GROUPS.find((g) => g.id === item.group)?.label : null
        return [
          label ? <div key={`g-${item.group}`} className={styles.groupLabel} aria-hidden="true">{label}</div> : null,
          <button
            key={`${i}:${item.title}`}
            type="button"
            role="option"
            id={`${menuId}-opt-${i}`}
            aria-selected={i === selectedIndex}
            className={`${styles.item} ${i === selectedIndex ? styles.itemActive : ''}`}
            onMouseDown={(e) => { e.preventDefault(); props.command(item) }}
            onMouseEnter={() => setSelectedIndex(i)}
          >
            <div className={styles.itemTitle}>
              {item.title}
              {/* The W8.8 walk fix: whose widget this row inserts (an example or the member's own), in the option's
                  own text, so it is part of its accessible name. */}
              {item.mark && <>{' '}<span className={styles.itemMark}>{item.mark}</span></>}
            </div>
            <div className={styles.itemDesc}>{item.description}</div>
          </button>,
        ]
      })}
    </div>
  )
})
SlashList.displayName = 'SlashList'

/** The slash Suggestion's command, exported so a rail can hand it a dead session's range.
 *  Guarded (lib/suggestionSession.js): an item chosen for a session that has ended never runs.
 *  The slash menu passes no pluginKey, so it lives under Suggestion's default key. */
export const slashCommand = guardedCommand(SuggestionPluginKey, ({ editor, range, props }) => {
  props.command({ editor, range })
})

export const SlashMenuExtension = Extension.create({
  name: 'slashMenu',
  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        char: '/',
        startOfLine: false,
        // Widget commands carry ARGUMENTS after the type name — `/chart AMD
        // 15m` must reach items() as one query. Space no longer exits the
        // suggestion; with zero matches the list renders nothing and (per the
        // guard in SlashList.onKeyDown) passes every key through.
        allowSpaces: true,
        command: slashCommand,
        items: ({ query, editor }) => menuItems(query, editor),
        render: () => {
          // One renderer object serves EVERY suggestion session, so all of
          // this closure state must reset in onStart.
          let component
          let popup
          let dismissed = false      // Esc hides for THIS session; next '/' re-arms
          let getRect = null
          let editorDom = null
          const MENU_ID = 'uct-slash-menu'

          // Fixed-position popup + a scrolling editor: without reposition the
          // menu detaches from the caret the moment the note scrolls (the app
          // scrolls the inner .main element, hence capture-phase). Clamp keeps
          // it inside the viewport; when it would cross the bottom edge it
          // flips above the caret.
          const position = () => {
            if (!popup || dismissed) return
            const rect = getRect?.()
            if (!rect) return
            const menuW = popup.offsetWidth || 0
            const menuH = popup.offsetHeight || 0
            const left = Math.max(8, Math.min(rect.left, window.innerWidth - menuW - 8))
            let top = rect.bottom + 6
            if (menuH && top + menuH > window.innerHeight - 8) {
              const above = rect.top - 6 - menuH
              top = above >= 8 ? above : Math.max(8, window.innerHeight - 8 - menuH)
            }
            popup.style.left = `${left}px`
            popup.style.top = `${top}px`
          }
          const onViewportChange = () => position()

          // The editor is the focused element, so it carries the combobox
          // wiring: role="combobox" + aria-autocomplete + aria-expanded +
          // aria-controls (naming the listbox) + aria-activedescendant
          // (tracking the highlighted option, reported by SlashList through
          // onActiveChange) -- shared with NoteLinkMenu.jsx via
          // applyComboboxWiring, since both popups need the identical
          // pairing. Cleared whenever the menu isn't offering items.
          const setActiveDescendant = (id) => {
            applyComboboxWiring(editorDom, { menuId: MENU_ID, activeId: id, showing: Boolean(id && !dismissed) })
          }

          return {
            onStart: (props) => {
              // Suggestion calls this after awaiting `items`; a session that ended meanwhile (the
              // trigger deleted, or a start and an end in one task) draws nothing.
              if (!sessionStillOpen(SuggestionPluginKey, props.editor, props.range)) return
              dismissed = false
              getRect = props.clientRect
              editorDom = props.editor?.view?.dom || null
              component = new ReactRenderer(SlashList, {
                props: { ...props, menuId: MENU_ID, onActiveChange: setActiveDescendant },
                editor: props.editor,
              })
              popup = document.createElement('div')
              popup.className = styles.popupWrap
              popup.style.position = 'fixed'
              popup.style.zIndex = 9999
              popup.appendChild(component.element)
              document.body.appendChild(popup)
              position()
              // Post-mount second pass: the first ran before layout knew the
              // menu's size, so the clamp/flip had nothing to measure.
              requestAnimationFrame(position)
              window.addEventListener('scroll', onViewportChange, true)
              window.addEventListener('resize', onViewportChange)
            },
            onUpdate(props) {
              getRect = props.clientRect
              component?.updateProps({ ...props, menuId: MENU_ID, onActiveChange: setActiveDescendant })
              position()
            },
            onKeyDown(props) {
              if (props.event.key === 'Escape') {
                // Hide, don't destroy: the suggestion session stays alive (the
                // '/' text is still there), so keep receiving updates silently
                // and let every key fall through to the editor. The next
                // '/' session re-arms via onStart.
                dismissed = true
                if (popup) popup.style.display = 'none'
                setActiveDescendant(null)
                return true
              }
              if (dismissed) return false
              return component?.ref?.onKeyDown?.(props) ?? false
            },
            onExit() {
              window.removeEventListener('scroll', onViewportChange, true)
              window.removeEventListener('resize', onViewportChange)
              setActiveDescendant(null)
              popup?.remove()
              component?.destroy()
              popup = null
              component = null
            },
          }
        },
      }),
    ]
  },
})

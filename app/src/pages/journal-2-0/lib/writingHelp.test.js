// Wave 7 lane H (H2) — writing help's client rules, on a REAL editor.
//
//  * the scope a member asks about (their selection, or the whole note);
//  * Accept is the ONE document write: an askInsert block with `action` +
//    `model` (ruling D-H1), replacing the selection only while it still holds
//    the words the draft came from, as ONE undo step;
//  * every way the stream can fail is a SENTENCE, never a silent no-op;
//  * an older bundle (no `action`/`model` attrs) still reads the block — the
//    no-schema-bump argument, measured rather than asserted.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import { buildExtensions } from './tiptap'
import { AskInsert } from './askInsertNode'
import { acceptWritingHelp, captureWritingHelpScope, draftParagraphs } from './writingHelp'
import { WH_MESSAGES, WRITING_HELP_CHOICES, streamWritingHelp } from './writingHelpStream'

const P = (t) => ({ type: 'paragraph', content: t ? [{ type: 'text', text: t }] : [] })
let editor
function make(content, extensions = buildExtensions()) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  editor = new Editor({ element: el, extensions, content: { type: 'doc', content } })
  return editor
}
afterEach(() => { editor?.destroy(); editor = null; document.body.innerHTML = ''; vi.restoreAllMocks() })

const at = (str) => {
  let hit = null
  editor.state.doc.descendants((n, pos) => {
    if (hit == null && n.isText) { const i = n.text.indexOf(str); if (i >= 0) hit = pos + i }
  })
  return hit
}
const select = (from, to) => editor.view.dispatch(
  editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)))
const inserts = () => {
  const out = []
  editor.state.doc.descendants((n) => { if (n.type.name === 'askInsert') out.push(n) })
  return out
}
const NOW = new Date('2026-09-25T13:41:00.000Z')

describe('captureWritingHelpScope', () => {
  it('a text selection is the passage, with its range', () => {
    make([P('I sold NVDA early.'), P('It was fear.')])
    const from = at('sold'); const to = at('early') + 'early'.length
    select(from, to)
    expect(captureWritingHelpScope(editor)).toEqual({
      scope: 'selection', text: 'sold NVDA early', range: { from, to }, originalText: 'sold NVDA early',
    })
  })

  it('a caret means the WHOLE note, paragraphs kept apart', () => {
    make([P('One.'), P('Two.')])
    select(at('One'), at('One'))
    const req = captureWritingHelpScope(editor)
    expect(req.scope).toBe('whole')
    expect(req.text).toBe('One.\n\nTwo.')
    expect(req.originalText).toBeNull()
  })

  it('a selected NODE is never the passage (it would be replaced) — whole note, after it', () => {
    make([P('Top'), { type: 'horizontalRule' }, P('Bottom')])
    let hr = null
    editor.state.doc.descendants((n, pos) => { if (n.type.name === 'horizontalRule') hr = pos })
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, hr)))
    const req = captureWritingHelpScope(editor)
    expect(req.scope).toBe('whole')
    expect(req.range.from).toBe(req.range.to)
  })
})

describe('draftParagraphs', () => {
  it('blank lines separate paragraphs; single newlines join', () => {
    expect(draftParagraphs('One\nline.\n\nTwo.\n\n\n')).toEqual(['One line.', 'Two.'])
    expect(draftParagraphs('   ')).toEqual([])
  })
})

describe('acceptWritingHelp — the one document write', () => {
  const draft = (over = {}) => ({
    draft: 'A tighter line.\n\nSecond thought.', action: 'rewrite', model: 'claude-sonnet-5',
    instruction: 'Rewrite — shorter', now: NOW, ...over,
  })

  it('replaces the selection with ONE askInsert carrying action + model + the existing attrs', () => {
    make([P('Before. I sold NVDA early because of fear. After.')])
    const from = at('I sold'); const to = at(' After')
    select(from, to)
    const req = captureWritingHelpScope(editor)
    const res = acceptWritingHelp(editor, { ...req, ...draft() })
    expect(res).toEqual({ ok: true, replaced: true })
    const [node] = inserts()
    expect(inserts()).toHaveLength(1)
    expect(node.attrs).toEqual({
      insertedAt: '2026-09-25T13:41:00.000Z', scope: 'selection', question: 'Rewrite — shorter',
      action: 'rewrite', model: 'claude-sonnet-5',
    })
    expect(node.childCount).toBe(2)
    expect(editor.state.doc.textContent).not.toContain('I sold NVDA early')
    expect(editor.state.doc.textContent).toContain('Before.')
    expect(editor.state.doc.textContent).toContain('After.')
  })

  it('ONE Ctrl+Z takes the whole block out and puts the selected words back', () => {
    make([P('Keep this. Replace this part.')])
    select(at('Replace'), at('part') + 'part'.length)
    const beforeText = editor.state.doc.textContent
    acceptWritingHelp(editor, { ...captureWritingHelpScope(editor), ...draft() })
    expect(inserts()).toHaveLength(1)
    editor.commands.undo()
    expect(inserts()).toHaveLength(0)
    expect(editor.state.doc.textContent).toBe(beforeText)
  })

  it('whole-note help lands at the caret and deletes nothing', () => {
    make([P('Alpha.'), P('Omega.')])
    select(at('Omega'), at('Omega'))
    const req = captureWritingHelpScope(editor)
    const res = acceptWritingHelp(editor, { ...req, ...draft({ action: 'summarize', instruction: 'Summarize' }) })
    expect(res).toEqual({ ok: true, replaced: false })
    expect(editor.state.doc.textContent).toContain('Alpha.')
    expect(editor.state.doc.textContent).toContain('Omega.')
    expect(inserts()[0].attrs.scope).toBe('whole')
  })

  it('⛔ a selection whose words CHANGED under the panel is never replaced — the draft goes after', () => {
    make([P('Original words here.')])
    select(at('Original'), at('here') + 'here'.length)
    const req = captureWritingHelpScope(editor)
    // the passage changes while Compass writes (a second device, a reconcile)
    editor.commands.insertContentAt(at('words'), 'new ')
    const res = acceptWritingHelp(editor, { ...req, ...draft() })
    expect(res).toEqual({ ok: true, replaced: false })
    // every word the member wrote survives, in order; the draft went in at the caret
    const text = editor.state.doc.textContent
    expect(text).toContain('Original new ')
    expect(text).toContain('words here.')
    expect(text.indexOf('Original new ')).toBeLessThan(text.indexOf('words here.'))
    expect(inserts()).toHaveLength(1)
  })

  it('a read-only editor takes nothing', () => {
    make([P('Locked.')])
    editor.setEditable(false, false)
    expect(acceptWritingHelp(editor, { ...draft(), scope: 'whole', range: { from: 1, to: 1 } }))
      .toEqual({ ok: false, reason: 'not-editable' })
    expect(inserts()).toHaveLength(0)
  })

  it('an empty draft inserts nothing', () => {
    make([P('x')])
    expect(acceptWritingHelp(editor, { ...draft({ draft: '  \n\n ' }), scope: 'whole', range: { from: 1, to: 1 } }))
      .toEqual({ ok: false, reason: 'empty' })
  })
})

describe('no schema bump — an older bundle still reads a writing-help block', () => {
  it('an editor whose askInsert has no action/model attrs keeps the block and its text', () => {
    const OldAskInsert = AskInsert.extend({
      addAttributes() {
        const a = { ...this.parent?.() }
        delete a.action
        delete a.model
        return a
      },
    })
    const OLD = buildExtensions().map((e) => (e.name === 'askInsert' ? OldAskInsert : e))
    make([{
      type: 'askInsert',
      attrs: { insertedAt: NOW.toISOString(), scope: 'selection', question: 'Rewrite — shorter',
               action: 'rewrite', model: 'claude-sonnet-5' },
      content: [P('Kept by an old bundle.')],
    }], OLD)
    expect(inserts()).toHaveLength(1)
    expect(editor.state.doc.textContent).toBe('Kept by an old bundle.')
    expect(inserts()[0].attrs.action).toBeUndefined()   // unknown attr dropped, node kept
  })

  it('an Ask insert with NO new attrs serializes to exactly the HTML it always did', () => {
    make([{ type: 'askInsert', attrs: { insertedAt: '2026-09-22T12:00:00.000Z', scope: 'note', question: 'Q?' },
            content: [P('Answer.')] }])
    const html = editor.getHTML()
    expect(html).toContain('data-type="ask-insert"')
    expect(html).not.toContain('data-action')
    expect(html).not.toContain('data-model')
  })

  it('a writing-help block round-trips through HTML with its provenance', () => {
    make([{ type: 'askInsert', attrs: { insertedAt: NOW.toISOString(), scope: 'whole', question: 'Summarize',
                                         action: 'summarize', model: 'claude-sonnet-5' },
            content: [P('Short.')] }])
    const html = editor.getHTML()
    expect(html).toContain('data-action="summarize"')
    expect(html).toContain('data-model="claude-sonnet-5"')
    editor.commands.setContent(html)
    expect(inserts()[0].attrs).toMatchObject({ action: 'summarize', model: 'claude-sonnet-5' })
  })
})

// ── the stream ───────────────────────────────────────────────────────────────

function sseResponse(events, { status = 200 } = {}) {
  const enc = new TextEncoder()
  const chunks = events.map((e) => enc.encode(`data: ${JSON.stringify(e)}\n\n`))
  let i = 0
  return {
    ok: status >= 200 && status < 300, status,
    json: async () => ({}),
    body: { getReader: () => ({ read: async () => (i < chunks.length ? { done: false, value: chunks[i++] } : { done: true }) }) },
  }
}
const errorResponse = (status, detail) => ({ ok: false, status, json: async () => (detail ? { detail } : {}) })
const REWRITE = WRITING_HELP_CHOICES.find((c) => c.id === 'rewrite-shorter')
const call = (over = {}) => streamWritingHelp({
  noteId: 'n1', choice: REWRITE, lang: 'es', scope: 'selection', text: 'Some words.', ...over,
})

describe('streamWritingHelp — every failure is a sentence', () => {
  it('streams start → deltas → final, and reports the model', async () => {
    global.fetch = vi.fn(async () => sseResponse([
      { type: 'start', action: 'rewrite', model: 'claude-sonnet-5', scope: 'selection', instruction: 'Rewrite — shorter' },
      { type: 'delta', text: 'Short' }, { type: 'delta', text: 'er.' },
      { type: 'final', text: 'Shorter.', action: 'rewrite', model: 'claude-sonnet-5' },
    ]))
    const seen = []
    const res = await call({ onDelta: (t) => seen.push(t) })
    expect(res).toEqual({ ok: true, text: 'Shorter.', model: 'claude-sonnet-5', action: 'rewrite',
                          instruction: 'Rewrite — shorter' })
    expect(seen).toEqual(['Short', 'Shorter.'])
    const [url, opts] = global.fetch.mock.calls[0]
    expect(url).toBe('/api/j2/notes/n1/writing-help/stream')
    expect(JSON.parse(opts.body)).toEqual({ action: 'rewrite', style: 'shorter', scope: 'selection', text: 'Some words.' })
  })

  it('the daily limit says the SERVER\'s sentence', async () => {
    global.fetch = vi.fn(async () => errorResponse(429, "You've used today's writing help — it resets at midnight ET"))
    expect((await call()).error).toBe("You've used today's writing help — it resets at midnight ET")
    global.fetch = vi.fn(async () => errorResponse(429))
    expect((await call()).error).toBe(WH_MESSAGES.budget)
  })

  it.each([
    [402, null, WH_MESSAGES.paid],
    [404, null, WH_MESSAGES.gone],
    [422, 'Pick a language to translate into.', 'Pick a language to translate into.'],
    [500, null, WH_MESSAGES.failed],
  ])('HTTP %s is a sentence', async (status, detail, sentence) => {
    global.fetch = vi.fn(async () => errorResponse(status, detail))
    expect(await call()).toEqual({ ok: false, error: sentence })
  })

  it('a network failure is a sentence; an abort is quiet', async () => {
    global.fetch = vi.fn(async () => { throw new TypeError('Failed to fetch') })
    expect(await call()).toEqual({ ok: false, error: WH_MESSAGES.network })
    global.fetch = vi.fn(async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e })
    expect(await call()).toEqual({ ok: false, aborted: true })
  })

  it('an error event mid-stream wins over the words that came before it', async () => {
    global.fetch = vi.fn(async () => sseResponse([
      { type: 'start', action: 'rewrite', model: 'm' }, { type: 'delta', text: 'half' },
      { type: 'error', detail: 'Something went wrong writing that. Nothing was changed in your note.' },
    ]))
    expect((await call()).error).toBe('Something went wrong writing that. Nothing was changed in your note.')
  })

  it('a stream that ends without its final event is a failure, not a draft', async () => {
    global.fetch = vi.fn(async () => sseResponse([{ type: 'start' }, { type: 'delta', text: 'cut off' }]))
    expect((await call()).error).toBe(WH_MESSAGES.failed)
  })

  it('an empty draft says so', async () => {
    global.fetch = vi.fn(async () => sseResponse([{ type: 'start' }, { type: 'final', text: '  ' }]))
    expect((await call()).error).toBe(WH_MESSAGES.empty)
  })

  it('nothing to work on, or too much, is refused before any request', async () => {
    global.fetch = vi.fn()
    expect((await call({ text: '  ' })).error).toBe(WH_MESSAGES.nothing)
    expect((await call({ text: 'x'.repeat(20001) })).error).toBe(WH_MESSAGES.tooLong)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('translate sends the language; the other actions do not', async () => {
    global.fetch = vi.fn(async () => sseResponse([{ type: 'final', text: 'Hola.' }]))
    const translate = WRITING_HELP_CHOICES.find((c) => c.id === 'translate')
    await call({ choice: translate, lang: 'es' })
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toMatchObject({ action: 'translate', lang: 'es' })
    expect(JSON.parse(global.fetch.mock.calls[0][1].body).style).toBeUndefined()
  })
})

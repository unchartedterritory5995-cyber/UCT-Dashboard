// Slash-menu widget matching — the two-regime rail. This area regressed twice
// (prefix matching armed an Enter trap on prose; the exact-match fix then
// killed '/ch' discoverability, found by the owner on prod). Single token =
// prefix match (completion, nothing to eat); with args/prose = exact name.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import { widgetItems, factItems, consensusFactItems, planItems, ITEMS, groupedSlashItems, blockItemGroup, rankedBlockItems,
  snapshotWidgetItems, SlashList, mineItems, slashItems, __mineLoad, __resetMine,
  pickItems, __picksLoad, __resetPicks } from './SlashMenu'
import { __resetSetsCache } from '../../lib/notebookSets'
import { render, screen, cleanup, waitFor, act } from '@testing-library/react'
import { createElement, useState } from 'react'
import Toast from '../Toast'
import { EditorContent } from '@tiptap/react'
import { CAPTURE_FLAG_KEY } from '../../../../widgets/captureRelease'
import { latchNotebookFlags, __resetNotebookFlags } from '../../lib/offline/notebookFlags'
// jsdom has no Range layout; an editor focus() scrolls the caret into view on the next frame.
if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => []
if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })
}
import { buildExtensions } from '../../lib/tiptap'
import { dateSuggestPluginKey } from '../../lib/dateSuggest'
import { PLAN_EVENT, journalStylesEnabled } from '../../lib/journalStylesFlag'

// /plan is gated on the journal-styles switch. Pass-through by default (every other test in this file runs
// against the real flag, i.e. off); the /plan block turns it on and the gate case turns it off again.
vi.mock('../../lib/journalStylesFlag', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, journalStylesEnabled: vi.fn(actual.journalStylesEnabled) }
})

const titles = (q) => widgetItems(q).map((i) => i.title)

describe('slash widget items', () => {
  it('a partial single token discovers Chart (the /ch case from prod)', () => {
    expect(titles('ch')).toEqual(['Chart'])
    expect(titles('c')).toEqual(['Chart', 'Before / after'])   // 'compare' shares the prefix
    expect(titles('chart')).toEqual(['Chart'])
    expect(titles('')).toEqual(['Chart', 'MTF stack', 'Before / after'])
  })

  it('valid args produce the insert item', () => {
    expect(titles('chart NVDA 15m')).toEqual(['Chart — NVDA · 15m'])
    expect(titles('chart amd')).toEqual(['Chart — AMD · D'])
  })

  it('an optional date token anchors the insert and shows in the title', () => {
    expect(titles('chart NVDA 15m 3/13/2026')).toEqual(['Chart — NVDA · 15m @ Mar 13, 2026'])
    expect(titles('chart NVDA 2026-03-13')).toEqual(['Chart — NVDA · D @ Mar 13, 2026'])
    expect(titles('chart NVDA 15m notaday')).toEqual([])
    // The inserted node carries the day as its anchor (params.to), not the
    // insert moment. (Wire: the shared chartInsertNodes builder →
    // insertContent — the same payload the widget palette inserts.)
    let captured = null
    const chain = {
      focus: () => chain, deleteRange: () => chain,
      insertContent: (nodes) => { captured = nodes; return chain },
      caretAfterWidgetEmbed: () => chain,
      run: () => {},
    }
    widgetItems('chart NVDA 15m 3/13/2026')[0]
      .command({ editor: { chain: () => chain, storage: {} }, range: {} })
    expect(captured).toHaveLength(1)
    expect(captured[0].type).toBe('widgetEmbed')
    expect(captured[0].attrs.widgetId).toBe('chart')
    expect(captured[0].attrs.params).toMatchObject({ symbol: 'NVDA', tf: '15', to: '2026-03-13' })
  })

  it('prose after the name offers NOTHING — Enter must stay a newline', () => {
    expect(titles('chart looks great here')).toEqual([])
    expect(titles('chart AMD notatf')).toEqual([])
    // Prefix + args never matches (the original Enter-trap shape).
    expect(titles('ch NVDA')).toEqual([])
    expect(titles('c looks')).toEqual([])
  })

  it('unrelated tokens match nothing', () => {
    expect(titles('head')).toEqual([])
    expect(titles('xyz')).toEqual([])
  })
})

describe('composition presets (/mtf, /compare)', () => {
  it('single-token discovery + bare-name hints', () => {
    expect(titles('m')).toEqual(['MTF stack'])
    expect(titles('mtf')).toEqual(['MTF stack'])
    expect(titles('comp')).toEqual(['Before / after'])
  })

  it('valid args produce one-action multi-insert items', () => {
    expect(titles('mtf AMD')).toEqual(['MTF stack — AMD · D / 1h / 15m'])
    expect(titles('compare NVDA 2026-03-13')).toEqual(['Before / after — NVDA @ Mar 13, 2026'])
    expect(titles('compare nvda 3/13/2026')).toEqual(['Before / after — NVDA @ Mar 13, 2026'])
    // Optional tf: compare at execution granularity (panel batch 3).
    expect(titles('compare nvda 3/13/2026 15m')).toEqual(['Before / after — NVDA @ Mar 13, 2026 · 15m'])
  })

  it('the strictness contract holds — prose parses as NOTHING', () => {
    expect(titles('mtf looks great here')).toEqual([])
    expect(titles('mtf AMD NVDA')).toEqual([])
    expect(titles('compare AMD notadate')).toEqual([])
    expect(titles('compare AMD')).toEqual([])
    expect(titles('m AMD')).toEqual([])                        // prefix + args never matches
  })

  it('/mtf inserts three chart nodes sharing the symbol; /compare a half-width pair', () => {
    const insertedBy = (q) => {
      let captured = null
      const chain = {
        focus: () => chain, deleteRange: () => chain,
        insertContent: (c) => { captured = c; return chain },
        insertWidgetEmbed: () => chain,
        // The new NodeSelection-exit rail (widgetEmbedInsert.test.jsx owns
        // its behavior); the SlashMenu paths chain it after the insert.
        caretAfterWidgetEmbed: () => chain,
        run: () => {},
      }
      widgetItems(q)[0].command({ editor: { chain: () => chain }, range: {} })
      return captured
    }
    const stack = insertedBy('mtf AMD')
    expect(stack.map((n) => n.type)).toEqual(['widgetEmbed', 'widgetEmbed', 'widgetEmbed'])
    expect(stack.map((n) => n.attrs.params.tf)).toEqual(['D', '60', '15'])
    // Frozen means anchored: preset inserts stamp the insert moment.
    for (const n of stack) expect(Number.isFinite(Number(n.attrs.params.to))).toBe(true)
    expect(new Set(stack.map((n) => n.attrs.params.symbol))).toEqual(new Set(['AMD']))

    // An explicit day anchors the whole stack at that date instead.
    expect(titles('mtf AMD 3/13/2026')).toEqual(['MTF stack — AMD · D / 1h / 15m @ Mar 13, 2026'])
    const anchored = insertedBy('mtf AMD 3/13/2026')
    expect(anchored.map((n) => n.attrs.params.to)).toEqual(['2026-03-13', '2026-03-13', '2026-03-13'])

    const pair = insertedBy('compare AMD 3/13/2026')
    expect(pair).toHaveLength(2)
    expect(pair.map((n) => n.attrs.layout.width)).toEqual(['half', 'half'])
    expect(pair[0].attrs.params.to).toBeTruthy()               // before: window ends that day
    expect(pair[1].attrs.params.to == null).toBe(true)         // after: the explicit rolling opt-out
    expect(pair[0].attrs.caption).toBe('before · 2026-03-13')

    // The optional tf reaches BOTH halves.
    const pair15 = insertedBy('compare AMD 3/13/2026 15m')
    expect(pair15.map((n) => n.attrs.params.tf)).toEqual(['15', '15'])
  })
})

describe('/price (Wave F financial fact capture)', () => {
  const factTitles = (q) => factItems(q).map((i) => i.title)

  it('single-token discovery + bare-name hint', () => {
    expect(factTitles('p')).toEqual(['Price'])
    expect(factTitles('price')).toEqual(['Price'])
    expect(factTitles('')).toEqual(['Price'])
  })

  it('a valid symbol produces the capture item', () => {
    expect(factTitles('price NVDA')).toEqual(['Price — NVDA'])
    expect(factTitles('price amd')).toEqual(['Price — AMD'])
  })

  it('prose or multiple tokens after the name match nothing', () => {
    expect(factTitles('price looks great here')).toEqual([])
    expect(factTitles('price NVDA AMD')).toEqual([])
    expect(factTitles('pr NVDA')).toEqual([])  // prefix + args never matches
  })

  it('unrelated tokens match nothing', () => {
    expect(factTitles('chart')).toEqual([])
    expect(factTitles('xyz')).toEqual([])
  })

  const realFetch = global.fetch
  beforeEach(() => { global.fetch = vi.fn() })
  afterEach(() => { global.fetch = realFetch })

  function makeChain(box) {
    const chain = {
      focus: () => chain, deleteRange: () => chain,
      insertContent: (c) => { box.inserted = c; return chain },
      run: () => {},
    }
    return chain
  }

  it('on success, POSTs the capture and inserts a financialFact node with the returned id', async () => {
    global.fetch.mockResolvedValue({
      ok: true, json: async () => ({ fact: { id: 'fact-123' } }),
    })
    const box = { inserted: null }
    const chain = makeChain(box)
    const editor = { chain: () => chain, storage: { uctJournalWidgets: { noteId: 'note-1' } } }
    await factItems('price NVDA')[0].command({ editor, range: {} })
    expect(global.fetch).toHaveBeenCalledWith('/api/j2/notes/note-1/facts', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ ticker: 'NVDA', factType: 'price' }),
    }))
    expect(box.inserted).toEqual({ type: 'financialFact', attrs: { factId: 'fact-123' } })
  })

  it('on a failed capture, inserts nothing (never a broken/partial node)', async () => {
    global.fetch.mockResolvedValue({ ok: false })
    const box = { inserted: null }
    const chain = makeChain(box)
    const editor = { chain: () => chain, storage: { uctJournalWidgets: { noteId: 'note-1' } } }
    await factItems('price NVDA')[0].command({ editor, range: {} })
    expect(box.inserted).toBeNull()
  })

  it('a network error never throws onto the caller and inserts nothing', async () => {
    global.fetch.mockRejectedValue(new Error('network down'))
    const box = { inserted: null }
    const chain = makeChain(box)
    const editor = { chain: () => chain, storage: { uctJournalWidgets: { noteId: 'note-1' } } }
    await expect(factItems('price NVDA')[0].command({ editor, range: {} })).resolves.toBeUndefined()
    expect(box.inserted).toBeNull()
  })

  it('with no noteId on editor storage, never calls fetch at all', async () => {
    const chain = makeChain({ inserted: null })
    const editor = { chain: () => chain, storage: {} }
    await factItems('price NVDA')[0].command({ editor, range: {} })
    expect(global.fetch).not.toHaveBeenCalled()
  })
})

// ── /consensus (G-062, wave 10 lane G62: analyst price-target consensus) ───
// Mirrors the /price suite above exactly -- same regimes, same fetch shape,
// same failure behaviour -- because consensusFactItems is a deliberate
// near-copy of factItems, not a unification of the two.
describe('/consensus (G-062 financial fact capture)', () => {
  const consensusTitles = (q) => consensusFactItems(q).map((i) => i.title)

  it('single-token discovery + bare-name hint', () => {
    expect(consensusTitles('c')).toEqual(['Analyst Consensus'])
    expect(consensusTitles('consensus')).toEqual(['Analyst Consensus'])
    expect(consensusTitles('')).toEqual(['Analyst Consensus'])
  })

  it('a valid symbol produces the capture item', () => {
    expect(consensusTitles('consensus NVDA')).toEqual(['Analyst Consensus — NVDA'])
    expect(consensusTitles('consensus amd')).toEqual(['Analyst Consensus — AMD'])
  })

  it('prose or multiple tokens after the name match nothing', () => {
    expect(consensusTitles('consensus looks great here')).toEqual([])
    expect(consensusTitles('consensus NVDA AMD')).toEqual([])
    expect(consensusTitles('con NVDA')).toEqual([])  // prefix + args never matches
  })

  it('unrelated tokens match nothing', () => {
    expect(consensusTitles('chart')).toEqual([])
    expect(consensusTitles('xyz')).toEqual([])
  })

  it('does not collide with /price — each command matches only its own word', () => {
    expect(factItems('consensus NVDA')).toEqual([])
    expect(consensusFactItems('price NVDA')).toEqual([])
  })

  const realFetch = global.fetch
  beforeEach(() => { global.fetch = vi.fn() })
  afterEach(() => { global.fetch = realFetch })

  function makeConsensusChain(box) {
    const chain = {
      focus: () => chain, deleteRange: () => chain,
      insertContent: (c) => { box.inserted = c; return chain },
      run: () => {},
    }
    return chain
  }

  it('on success, POSTs the consensus capture and inserts a financialFact node', async () => {
    global.fetch.mockResolvedValue({
      ok: true, json: async () => ({ fact: { id: 'fact-456' } }),
    })
    const box = { inserted: null }
    const chain = makeConsensusChain(box)
    const editor = { chain: () => chain, storage: { uctJournalWidgets: { noteId: 'note-1' } } }
    await consensusFactItems('consensus NVDA')[0].command({ editor, range: {} })
    expect(global.fetch).toHaveBeenCalledWith('/api/j2/notes/note-1/facts', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ ticker: 'NVDA', factType: 'analyst_price_target_consensus' }),
    }))
    expect(box.inserted).toEqual({ type: 'financialFact', attrs: { factId: 'fact-456' } })
  })

  it('on a failed capture (e.g. FMP has no consensus for this ticker), inserts nothing — an honest failure, never a fabricated number', async () => {
    global.fetch.mockResolvedValue({ ok: false })
    const box = { inserted: null }
    const chain = makeConsensusChain(box)
    const editor = { chain: () => chain, storage: { uctJournalWidgets: { noteId: 'note-1' } } }
    await consensusFactItems('consensus NVDA')[0].command({ editor, range: {} })
    expect(box.inserted).toBeNull()
  })

  it('a network error never throws onto the caller and inserts nothing', async () => {
    global.fetch.mockRejectedValue(new Error('network down'))
    const box = { inserted: null }
    const chain = makeConsensusChain(box)
    const editor = { chain: () => chain, storage: { uctJournalWidgets: { noteId: 'note-1' } } }
    await expect(consensusFactItems('consensus NVDA')[0].command({ editor, range: {} })).resolves.toBeUndefined()
    expect(box.inserted).toBeNull()
  })

  it('with no noteId on editor storage, never calls fetch at all', async () => {
    const chain = makeConsensusChain({ inserted: null })
    const editor = { chain: () => chain, storage: {} }
    await consensusFactItems('consensus NVDA')[0].command({ editor, range: {} })
    expect(global.fetch).not.toHaveBeenCalled()
  })
})

// ── Wave 5: the block entries a bare `/` offers ─────────────────────────────
describe('block entries (Wave 5)', () => {
  let editor
  afterEach(() => { editor?.destroy(); editor = null })
  // A real editor on the real roster: the command must insert what it says.
  const run = (title, content) => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    editor = new Editor({ element: el, extensions: buildExtensions(), content })
    const text = editor.state.doc.textContent
    const item = ITEMS.find((it) => it.title === title)
    expect(item, title).toBeTruthy()
    // `/q` typed at the end of the first paragraph is the range a slash command replaces.
    item.command({ editor, range: { from: 1 + text.length - 2, to: 1 + text.length } })
    return editor
  }
  const found = (ed, type) => { const o = []; ed.state.doc.descendants((n) => { if (n.type.name === type) o.push(n) }); return o }

  it('/math finds both formula entries', () => {
    const math = ITEMS.filter((it) => it.title.toLowerCase().includes('math')).map((it) => it.title)
    expect(math).toEqual(['Inline math', 'Math block'])
  })

  it('Inline math inserts an empty formula with its LaTeX editor open', () => {
    const ed = run('Inline math', '<p>Area /m</p>')
    expect(found(ed, 'inlineMath')).toHaveLength(1)
    expect(ed.view.dom.querySelector('input.uctMathInput')).not.toBe(null)
    expect(ed.state.doc.textContent).toBe('Area ')
  })

  it('Math block inserts an empty equation with its editor open', () => {
    const ed = run('Math block', '<p>/m</p>')
    expect(found(ed, 'blockMath')).toHaveLength(1)
    expect(ed.view.dom.querySelector('textarea.uctMathInput')).not.toBe(null)
  })
})

// UX pass 2026-10-10: a bare `/` leads with the trading blocks, then the everyday basics, then
// everything else. Filtering by typed text is unchanged; only the bare list is grouped. Notebook widgets
// Task 8 split Trading into the moments a member reaches for it; with no widget wave on, the trading
// captures and blocks all sit in Planning a trade (and Transcript passage in Reviewing).
describe('bare slash menu groups (planning first)', () => {
  const bare = () => groupedSlashItems(ITEMS, [...widgetItems(''), ...factItems(''), ...consensusFactItems('')])

  it('the first options are planning a trade, the headings come after them', () => {
    const items = bare()
    expect(items[0].title).toBe('Chart')
    expect(items[0].group).toBe('plan')
    const firstHeading = items.findIndex((i) => i.title === 'Heading 1')
    const lastPlan = items.map((i) => i.group).lastIndexOf('plan')
    expect(firstHeading).toBeGreaterThan(lastPlan)
  })

  it('groups appear in order plan, review, basics, more and never interleave', () => {
    const order = bare().map((i) => i.group).filter((g, i, a) => g !== a[i - 1])
    expect(order).toEqual(['plan', 'review', 'basics', 'more'])
  })

  it('no block is lost or duplicated by grouping', () => {
    const items = bare()
    const blockTitles = items.filter((i) => ITEMS.some((b) => b.title === i.title)).map((i) => i.title)
    expect(blockTitles.slice().sort()).toEqual(ITEMS.map((i) => i.title).sort())
    expect(new Set(items.map((i) => i.title)).size).toBe(items.length)
  })

  it('the deeper headings sit in More, the first three in Basics', () => {
    const byTitle = (t) => ITEMS.find((i) => i.title === t)
    expect(blockItemGroup(byTitle('Heading 1'))).toBe('basics')
    expect(blockItemGroup(byTitle('Heading 4'))).toBe('more')
    expect(blockItemGroup(byTitle('Trade-plan canvas'))).toBe('plan')
    expect(blockItemGroup(byTitle('Transcript passage'))).toBe('review')
    expect(blockItemGroup(byTitle('Journal style'))).toBe('plan')
  })
})

describe('a typed query ranks title matches above keyword-only matches', () => {
  const titles = (q) => rankedBlockItems(ITEMS, q).map((it) => it.title)

  it('⛔ /transcript puts Transcript passage above Voice note (Enter takes the top row)', () => {
    const t = titles('transcript')
    expect(t, 'non-vacuity: both items answer "transcript"').toEqual(expect.arrayContaining(['Transcript passage', 'Voice note']))
    expect(t.indexOf('Transcript passage')).toBeLessThan(t.indexOf('Voice note'))
    expect(t[0]).toBe('Transcript passage')
  })

  it('title-prefix, then title-contains, then keyword; menu order inside each tier', () => {
    const q = 'list'
    const got = rankedBlockItems(ITEMS, q)
    const tier = (it) => (it.title.toLowerCase().startsWith(q) ? 0 : it.title.toLowerCase().includes(q) ? 1 : 2)
    const tiers = got.map(tier)
    expect([...tiers].sort((a, b) => a - b)).toEqual(tiers)
    for (const t of [0, 1, 2]) {
      const inTier = got.filter((it) => tier(it) === t)
      const menuOrder = ITEMS.filter((it) => inTier.includes(it))
      expect(inTier).toEqual(menuOrder)
    }
  })

  it('the same items as the plain match, only reordered; a bare query is untouched', () => {
    const q = 'call'
    const plain = ITEMS.filter((it) => it.title.toLowerCase().includes(q) || (it.keywords || []).some((k) => k.includes(q)))
    expect(new Set(rankedBlockItems(ITEMS, q))).toEqual(new Set(plain))
    expect(rankedBlockItems(ITEMS, '')).toBe(ITEMS)
  })
})

// P0.9: a due date is findable. `@tomorrow ` with a trailing space was the only way in, and
// typing `@` showed nothing; the Checklist hint says so and a "Due date" slash item opens the
// same `@` list (one door, not a second picker).
describe('due dates are findable from the slash menu (P0.9)', () => {
  let editor
  afterEach(() => { editor?.destroy(); editor = null; document.body.innerHTML = '' })

  it('/due ranks "Due date" first', () => {
    expect(rankedBlockItems(ITEMS, 'due')[0].title).toBe('Due date')
  })

  it('reminder / deadline / date also find it', () => {
    for (const q of ['reminder', 'deadline', 'date']) {
      expect(rankedBlockItems(ITEMS, q).map((i) => i.title), q).toContain('Due date')
    }
  })

  it('the Checklist hint names the typed form', () => {
    const checklist = ITEMS.find((i) => i.title === 'Checklist')
    expect(checklist.description).toBe('Task list. Type @tomorrow for a reminder')
  })

  it('"Due date" sits with the basics, right after Checklist', () => {
    const titles = ITEMS.map((i) => i.title)
    expect(titles.indexOf('Due date')).toBe(titles.indexOf('Checklist') + 1)
    expect(blockItemGroup(ITEMS.find((i) => i.title === 'Due date'))).toBe('basics')
  })

  it('running it replaces "/due" with an "@" before the cursor, which opens the @ list', () => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    editor = new Editor({ element: el, extensions: buildExtensions(), content: '<p>Call broker /due</p>' })
    editor.commands.focus('end')
    const end = editor.state.selection.from
    const item = ITEMS.find((i) => i.title === 'Due date')
    item.command({ editor, range: { from: end - 4, to: end } })
    expect(editor.state.doc.textContent).toBe('Call broker @')
    const { from } = editor.state.selection
    expect(editor.state.doc.textBetween(from - 1, from)).toBe('@')
    // The same "@" a member would have typed: the date list is now open.
    expect(dateSuggestPluginKey.getState(editor.state).active).toBe(true)
  })
})

// ── Tier 2 part A: /plan NVDA makes a Trade plan note and links it at the caret ─────────────────────────────
describe('/plan (Tier 2 part A)', () => {
  const realFlag = journalStylesEnabled.getMockImplementation()
  beforeEach(() => { journalStylesEnabled.mockImplementation(() => true) })
  afterEach(() => { journalStylesEnabled.mockImplementation(realFlag) })

  it('bare /plan is a hint that re-types the command', () => {
    const [hint] = planItems('plan')
    expect(hint.cmd).toBe('plan'); expect(hint.title).toBe('Trade plan')
    const calls = []
    const chain = {
      focus: () => { calls.push('focus'); return chain },
      deleteRange: (r) => { calls.push(['deleteRange', r]); return chain },
      insertContent: (t) => { calls.push(['insertContent', t]); return chain },
      run: () => calls.push('run'),
    }
    hint.command({ editor: { chain: () => chain }, range: { from: 1, to: 6 } })
    expect(calls).toContainEqual(['insertContent', '/plan '])
  })
  it('/plan NVDA is the real item, upper-cased', () => {
    const [item] = planItems('plan nvda')
    expect(item.title).toBe('Trade plan — NVDA')
    expect(item.cmd).toBe('plan')
    expect(planItems('plan $amd')[0].title).toBe('Trade plan — AMD')
  })
  it('running it clears the typed text, then fires PLAN_EVENT with the symbol on the editor root', () => {
    const seen = []
    const dom = { dispatchEvent: (e) => seen.push({ type: e.type, detail: e.detail, bubbles: e.bubbles }) }
    const deleted = []
    const chain = { focus: () => chain, deleteRange: (r) => { deleted.push(r); return chain }, run: () => true }
    planItems('plan nvda')[0].command({ editor: { chain: () => chain, view: { dom } }, range: { from: 3, to: 12 } })
    expect(deleted).toEqual([{ from: 3, to: 12 }])
    expect(seen).toEqual([{ type: PLAN_EVENT, detail: { symbol: 'NVDA' }, bubbles: true }])
  })
  it('anything that does not parse returns nothing, so Enter stays a newline', () => {
    expect(planItems('plan nvda amd')).toEqual([])
    expect(planItems('plan 12$')).toEqual([])
    expect(planItems('planet')).toEqual([])
    expect(planItems('pla nvda')).toEqual([])   // prefix + args never matches (the Enter-trap shape)
    expect(planItems('chart')).toEqual([])
  })
  it('a prefix of the word is still a hint', () => { expect(planItems('pla')).toHaveLength(1) })
  it('a bare slash lists the Trade plan hint exactly once, like Price', () => {
    const hints = planItems('')
    expect(hints).toHaveLength(1)
    expect(hints[0].title).toBe('Trade plan')
    expect(hints[0].cmd).toBe('plan')
    const bare = groupedSlashItems(ITEMS, [...widgetItems(''), ...factItems(''), ...consensusFactItems(''), ...hints])
    expect(bare.filter((i) => i.cmd === 'plan')).toHaveLength(1)
    expect(bare.filter((i) => i.title === 'Trade plan')).toHaveLength(1)
    expect(bare.find((i) => i.cmd === 'plan').group).toBe('plan')
  })
  it('is OFF with the journal-styles switch: nothing is offered', () => {
    journalStylesEnabled.mockImplementation(() => false)
    expect(planItems('plan nvda')).toEqual([])
    expect(planItems('plan')).toEqual([])
    expect(planItems('pla')).toEqual([])
  })
})

// Tier 2 part B, item 12 (R-T2B-12): "/remind" -- a follow-up task with a date, through the @ date list.
describe('/remind', () => {
  let editor
  afterEach(() => { editor?.destroy(); editor = null; document.body.innerHTML = '' })
  it('the Reminder row is a Basics item and ranks first for "remind"', () => {
    const reminder = ITEMS.find((i) => i.title === 'Reminder')
    expect(reminder.keywords).toEqual(['remind', 'reminder', 'follow up'])
    expect(blockItemGroup(reminder)).toBe('basics')
    expect(rankedBlockItems(ITEMS, 'remind')[0].title).toBe('Reminder')
    expect(rankedBlockItems(ITEMS, 'follow').map((i) => i.title)).toContain('Reminder')
  })
  it('sits in Basics right after "Due date", in the menu and in the bare-slash order', () => {
    const titles = ITEMS.map((i) => i.title)
    expect(titles.indexOf('Reminder')).toBe(titles.indexOf('Due date') + 1)
    const basics = groupedSlashItems(ITEMS, []).filter((i) => i.group === 'basics').map((i) => i.title)
    expect(basics.indexOf('Reminder')).toBe(basics.indexOf('Due date') + 1)
  })
  it('running it replaces "/remind" with an unticked task that holds the lead and an "@", and the date list opens', () => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    editor = new Editor({ element: el, extensions: buildExtensions(), content: '<p>/remind</p>' })
    editor.commands.focus('end')
    const end = editor.state.selection.from
    ITEMS.find((i) => i.title === 'Reminder').command({ editor, range: { from: end - 7, to: end } })
    expect(editor.state.doc.textContent).toBe('Follow up @')
    expect(editor.isActive('taskItem')).toBe(true)
    expect(editor.getAttributes('taskItem').checked).toBe(false)
    expect(dateSuggestPluginKey.getState(editor.state).active).toBe(true)
  })
})

// Notebook widgets Task 8: the / menu grouped by moment, and the fetch-and-freeze snapshot items.
describe('snapshot widget items (Task 8)', () => {
  const WAVES_ON = { notebook_widgets_w1_enabled: true, notebook_widgets_w2_enabled: true, notebook_widgets_w3_enabled: true }
  const realFetch = global.fetch
  let editor
  beforeEach(() => { global.fetch = vi.fn() })
  afterEach(() => { global.fetch = realFetch; __resetNotebookFlags(); editor?.destroy(); editor = null })
  const mount = (content) => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    editor = new Editor({ element: el, extensions: buildExtensions(), content })
    return editor
  }
  // The range a slash command replaces: the trailing `/...` text of the first paragraph.
  const slashRange = (ed) => {
    const text = ed.state.doc.firstChild.textContent
    const at = text.lastIndexOf('/')
    return { from: 1 + at, to: 1 + text.length }
  }
  const embeds = (ed) => { const o = []; ed.state.doc.descendants((n) => { if (n.type.name === 'widgetEmbed') o.push(n) }); return o }
  const bare = () => groupedSlashItems(ITEMS, [...snapshotWidgetItems(''), ...widgetItems(''), ...factItems(''), ...consensusFactItems('')])

  it('snapshot_items_absent_when_wave_off', () => {
    expect(snapshotWidgetItems('')).toEqual([])
    expect(snapshotWidgetItems('ticker NVDA')).toEqual([])
    expect(snapshotWidgetItems('my')).toEqual([])
    // Control: the same queries answer once the waves are on.
    latchNotebookFlags(WAVES_ON)
    expect(snapshotWidgetItems('').length).toBeGreaterThan(0)
    expect(snapshotWidgetItems('ticker NVDA').map((i) => i.title)).toEqual(['Ticker card — NVDA'])
  })

  it('wave 2 on: My rules check and My recurring mistakes appear under Reviewing; wave 2 off: neither', () => {
    latchNotebookFlags({ notebook_widgets_w2_enabled: true })
    const on = snapshotWidgetItems('')
    const mine = on.filter((i) => ['My rules check', 'My recurring mistakes'].includes(i.title))
    expect(mine.map((i) => i.title).sort()).toEqual(['My recurring mistakes', 'My rules check'])
    expect(mine.every((i) => i.group === 'review')).toBe(true)
    const { container } = render(<SlashList items={groupedSlashItems(ITEMS, on)} command={() => {}} />)
    const labels = [...container.querySelectorAll('[aria-hidden="true"]')].map((n) => n.textContent)
    expect(labels).toContain('Reviewing')
    expect(screen.getByText('My rules check')).toBeInTheDocument()
    expect(screen.getByText('My recurring mistakes')).toBeInTheDocument()
    // Control: with wave 2 off (wave 1 on) neither is offered, but wave 1's Reviewing items still are.
    __resetNotebookFlags()
    latchNotebookFlags({ notebook_widgets_w1_enabled: true })
    const off = snapshotWidgetItems('').map((i) => i.title)
    expect(off).not.toContain('My rules check')
    expect(off).not.toContain('My recurring mistakes')
    expect(off).toContain('My P&L and stats')
  })

  it('wave 3 on: Market on my names under Before the open, /flow NVDA under Planning a trade; wave 3 off: neither', () => {
    latchNotebookFlags({ notebook_widgets_w3_enabled: true })
    const on = snapshotWidgetItems('')
    const names = on.find((i) => i.title === 'Market on my names')
    const flow = on.find((i) => i.title === 'Options flow on a ticker')
    expect(names.group).toBe('open')
    expect(flow.group).toBe('plan')
    expect(flow.description).toBe('Type a symbol — e.g. /flow NVDA')
    expect(snapshotWidgetItems('flow NVDA').map((i) => i.title)).toEqual(['Options flow on a ticker — NVDA'])
    expect(snapshotWidgetItems('flow nvda!')).toEqual([])
    const { container } = render(<SlashList items={groupedSlashItems(ITEMS, on)} command={() => {}} />)
    const labels = [...container.querySelectorAll('[aria-hidden="true"]')].map((n) => n.textContent)
    expect(labels).toEqual(expect.arrayContaining(['Before the open', 'Planning a trade']))
    expect(screen.getByText('Market on my names')).toBeInTheDocument()
    expect(screen.getByText('Options flow on a ticker')).toBeInTheDocument()
    // Control: with wave 3 off (waves 1 and 2 on) neither is offered, but wave 1's items still are.
    __resetNotebookFlags()
    latchNotebookFlags({ notebook_widgets_w1_enabled: true, notebook_widgets_w2_enabled: true })
    const off = snapshotWidgetItems('').map((i) => i.title)
    expect(off).not.toContain('Market on my names')
    expect(off).not.toContain('Options flow on a ticker')
    expect(snapshotWidgetItems('flow NVDA')).toEqual([])
    expect(off).toContain('My watchlist today')
  })

  it('a wave turns on only its own kinds', () => {
    latchNotebookFlags({ notebook_widgets_w1_enabled: true })
    const t = snapshotWidgetItems('').map((i) => i.title)
    expect(t).toEqual(expect.arrayContaining(['My watchlist today', 'Ticker card', 'My P&L and stats']))
    expect(t).not.toContain('My rules check')          // wave 2
    expect(t).not.toContain('Market on my names')      // wave 3
  })

  it('bare_slash_groups_in_order: the menu shows the five moment labels in order', () => {
    latchNotebookFlags(WAVES_ON)
    const items = bare()
    const order = items.map((i) => i.group).filter((g, i, a) => g !== a[i - 1])
    expect(order).toEqual(['open', 'plan', 'review', 'basics', 'more'])
    const { container } = render(<SlashList items={items} command={() => {}} />)
    const labels = [...container.querySelectorAll('[aria-hidden="true"]')].map((n) => n.textContent)
    expect(labels).toEqual(['Before the open', 'Planning a trade', 'Reviewing', 'Basics', 'More'])
    expect(screen.getByText('My watchlist today')).toBeInTheDocument()
    expect(screen.getByText('Ticker card')).toBeInTheDocument()
    expect(screen.getByText('My P&L and stats')).toBeInTheDocument()
    expect(screen.queryByText('Trading')).toBeNull()
  })

  it('with every wave off, the bare list keeps its old order, under Planning a trade first', () => {
    const items = bare()
    expect(items[0].title).toBe('Chart')
    expect(items[0].group).toBe('plan')
    expect(items.some((i) => i.group === 'open')).toBe(false)
    expect(items.some((i) => i.group === 'trading')).toBe(false)
    render(<SlashList items={items} command={() => {}} />)
    expect(screen.getByText('Planning a trade')).toBeInTheDocument()
    expect(screen.queryByText('Before the open')).toBeNull()
  })

  it('ticker_bare_completes: /ti offers Ticker card and completes the text to /ticker ', () => {
    latchNotebookFlags(WAVES_ON)
    // 'ti' also answers kinds whose words contain it ("reporting"), like any block; one item completes.
    const items = snapshotWidgetItems('ti').filter((i) => i.cmd === 'ticker')
    expect(items.map((i) => i.title)).toEqual(['Ticker card'])
    expect(items[0].description).toBe('Type a symbol — e.g. /ticker NVDA')
    const ed = mount('<p>/ti</p>')
    items[0].command({ editor: ed, range: slashRange(ed) })
    expect(ed.state.doc.textContent).toBe('/ticker ')
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('ticker_bad_symbol_offers_nothing: prose after /ticker offers nothing, so Enter stays a newline', () => {
    latchNotebookFlags(WAVES_ON)
    expect(snapshotWidgetItems('ticker looks great')).toEqual([])
    expect(snapshotWidgetItems('ticker 123')).toEqual([])
    expect(snapshotWidgetItems('tick NVDA')).toEqual([])   // prefix + args never matches
    expect(snapshotWidgetItems('tickers')).toEqual([])
    expect(snapshotWidgetItems('ticker $nvda').map((i) => i.title)).toEqual(['Ticker card — NVDA'])
  })

  it('failed_fetch_inserts_nothing: the typed command leaves, nothing goes in, and the note says so', async () => {
    latchNotebookFlags(WAVES_ON)
    global.fetch.mockResolvedValue({ ok: false, status: 500 })
    const ed = mount('<p>Plan /ticker NVDA</p>')
    const notify = vi.fn()
    ed.storage.uctJournalWidgets = { ...(ed.storage.uctJournalWidgets || {}), notify }
    await snapshotWidgetItems('ticker NVDA')[0].command({ editor: ed, range: slashRange(ed) })
    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(embeds(ed)).toHaveLength(0)
    expect(ed.state.doc.textContent).toBe('Plan ')
    expect(notify).toHaveBeenCalledWith('Ticker card could not be loaded just now, so nothing was added.', 'error')
  })

  // The note's own toast, driven by the editor's `notify` exactly as NoteEditorPage wires it.
  const withToast = (ed) => {
    const set = { current: null }
    function Host() {
      const [t, setT] = useState(null)
      set.current = setT
      return <Toast message={t?.message} tone={t?.tone} onDismiss={() => setT(null)} />
    }
    render(<Host />)
    ed.storage.uctJournalWidgets = { ...(ed.storage.uctJournalWidgets || {}),
      notify: (message, tone) => act(() => set.current({ message, tone })) }
  }

  it('R58 I-2: "Adding Ticker card…" shows the moment the command runs, then "Ticker card added."', async () => {
    latchNotebookFlags(WAVES_ON)
    let answer
    global.fetch.mockReturnValue(new Promise((r) => { answer = r }))
    const ed = mount('<p>Plan /ticker NVDA</p>')
    withToast(ed)
    const pending = snapshotWidgetItems('ticker NVDA')[0].command({ editor: ed, range: slashRange(ed) })
    expect(screen.getByRole('status')).toHaveTextContent('Adding Ticker card…')
    expect(embeds(ed)).toHaveLength(0)
    answer({ ok: true, status: 200, json: async () => ({ asOf: '2026-10-20T14:00:00Z', source: 'market', symbol: 'NVDA' }) })
    await pending
    expect(embeds(ed)).toHaveLength(1)
    expect(screen.getByRole('status')).toHaveTextContent('Ticker card added.')
  })

  it('R58 I-2: a second identical command while the first fetches inserts nothing; after it lands, one more does', async () => {
    latchNotebookFlags(WAVES_ON)
    let answer
    global.fetch.mockReturnValue(new Promise((r) => { answer = r }))
    const ed = mount('<p>Plan /ticker NVDA</p>')
    const item = snapshotWidgetItems('ticker NVDA')[0]
    const first = item.command({ editor: ed, range: slashRange(ed) })
    ed.commands.insertContentAt(ed.state.doc.content.size - 1, '/ticker NVDA')
    const second = await item.command({ editor: ed, range: slashRange(ed) })
    expect(second).toEqual({ ok: false, message: 'Adding Ticker card…' })
    answer({ ok: true, status: 200, json: async () => ({ asOf: '2026-10-20T14:00:00Z', source: 'market', symbol: 'NVDA' }) })
    await first
    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(embeds(ed)).toHaveLength(1)
    // Control: the guard lets go once the first insert has landed.
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ asOf: '2026-10-20T14:00:00Z', source: 'market', symbol: 'NVDA' }) })
    expect((await item.command({ editor: ed, range: null })).ok).toBe(true)
    expect(embeds(ed)).toHaveLength(2)
  })

  it('insert_places_widgetEmbed_with_frozen_params at the command position, even if the member typed meanwhile', async () => {
    latchNotebookFlags(WAVES_ON)
    let answer
    global.fetch.mockReturnValue(new Promise((r) => { answer = r }))
    const ed = mount('<p>Plan /ticker NVDA</p><p>tail</p>')
    const pending = snapshotWidgetItems('ticker NVDA')[0].command({ editor: ed, range: slashRange(ed) })
    // Nothing goes in until the fetch answers; the member types at the start of the note meanwhile.
    expect(embeds(ed)).toHaveLength(0)
    ed.chain().insertContentAt(1, 'Wait ').run()
    answer({ ok: true, status: 200, json: async () => ({
      asOf: '2026-10-20T14:00:00Z', source: 'market', symbol: 'NVDA', price: 181.5, changePct: 1.2,
    }) })
    await pending
    expect(global.fetch).toHaveBeenCalledWith('/api/j2/notebook-widgets/tickerCard?symbol=NVDA', expect.anything())
    const [node] = embeds(ed)
    expect(node).toBeTruthy()
    expect(node.attrs.widgetId).toBe('tickerCard')
    expect(node.attrs.mode).toBe('snapshot')
    expect(node.attrs.capturedAt).toBe('2026-10-20T14:00:00Z')
    expect(node.attrs.params).toMatchObject({ symbol: 'NVDA', price: 181.5, changePct: 1.2 })
    // Placed where the command was typed: right after the typed-into first paragraph, and "tail" stays last.
    const texts = []
    ed.state.doc.forEach((n) => texts.push(n.type.name === 'widgetEmbed' ? '[embed]' : n.textContent))
    expect(texts[0].trim()).toBe('Wait Plan')
    expect(texts[1]).toBe('[embed]')
    expect(texts[texts.length - 1]).toBe('tail')
  })

  it('a no-symbol kind inserts directly from the bare menu', async () => {
    latchNotebookFlags(WAVES_ON)
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({
      asOf: '2026-10-20T14:00:00Z', source: 'market', listLabel: 'Watchlist', rows: [], truncated: 0,
    }) })
    const item = snapshotWidgetItems('').find((i) => i.title === 'My watchlist today')
    expect(item.group).toBe('open')
    const ed = mount('<p>/my</p>')
    await item.command({ editor: ed, range: slashRange(ed) })
    expect(global.fetch).toHaveBeenCalledWith('/api/j2/notebook-widgets/myWatchlistToday', expect.anything())
    expect(embeds(ed).map((n) => n.attrs.widgetId)).toEqual(['myWatchlistToday'])
  })

  it('a note that turned read-only while the fetch ran gets nothing (final review M-2)', async () => {
    latchNotebookFlags(WAVES_ON)
    let answer
    global.fetch.mockReturnValue(new Promise((r) => { answer = r }))
    const ed = mount('<p>Plan /ticker NVDA</p>')
    const pending = snapshotWidgetItems('ticker NVDA')[0].command({ editor: ed, range: slashRange(ed) })
    ed.setEditable(false)
    answer({ ok: true, status: 200, json: async () => ({ asOf: '2026-10-20T14:00:00Z', source: 'market', symbol: 'NVDA' }) })
    const out = await pending
    expect(global.fetch).toHaveBeenCalledTimes(1)                    // non-vacuity: the fetch did answer
    expect(out).toEqual({ ok: false, message: null })
    expect(embeds(ed)).toHaveLength(0)
    // Control: the same answer lands while the note stays editable.
    ed.setEditable(true)
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ asOf: '2026-10-20T14:00:00Z', source: 'market', symbol: 'NVDA' }) })
    ed.commands.setContent('<p>Plan /ticker NVDA</p>')
    expect((await snapshotWidgetItems('ticker NVDA')[0].command({ editor: ed, range: slashRange(ed) })).ok).toBe(true)
    expect(embeds(ed)).toHaveLength(1)
  })

  it('/market and /marketcontext both reach Market context once W4 is on and the capture switch releases it', () => {
    latchNotebookFlags({ notebook_widgets_w4_enabled: true })
    localStorage.setItem(CAPTURE_FLAG_KEY, '1')
    try {
      expect(snapshotWidgetItems('market').map((i) => i.title)).toEqual(['Market context'])
      expect(snapshotWidgetItems('marketcontext').map((i) => i.title)).toEqual(['Market context'])
      // Control: a word that is neither the title nor the keyword offers nothing.
      expect(snapshotWidgetItems('marketcontextx')).toEqual([])
    } finally { localStorage.removeItem(CAPTURE_FLAG_KEY) }
  })
})

// Notebook widgets Task 17: the member's chart sets and presets, under "My presets", wave 5 only.
// mineItems is SYNCHRONOUS (fix round 1): it answers what is loaded and starts one background load.
describe('chart sets and presets (Task 17)', () => {
  const realFetch = global.fetch
  const SEMIS = { id: 's_1', name: 'Semis', charts: [{ symbol: 'NVDA', tf: 'D' }, { symbol: 'AMD', tf: '60' }] }
  const PRESET = { id: 'p_1', name: 'Flagged only', kind: 'myWatchlistToday', params: { list: 'flagged', share: false } }
  const W5 = { notebook_widgets_w1_enabled: true, notebook_widgets_w5_enabled: true }
  const PREFS = { notebook_chart_sets: JSON.stringify({ v: 1, sets: [SEMIS], presets: [PRESET] }) }
  let editor
  const prefsFetch = () => vi.fn(async (url, init = {}) => (url === '/api/auth/preferences' && !init.method
    ? { ok: true, status: 200, json: async () => PREFS }
    : { ok: false, status: 500, json: async () => ({}) }))
  beforeEach(() => { __resetSetsCache(); __resetMine(); global.fetch = prefsFetch() })
  afterEach(() => { global.fetch = realFetch; __resetNotebookFlags(); editor?.destroy(); editor = null })
  const loaded = async (q) => { mineItems(q); await __mineLoad(); return mineItems(q) }
  const labelsOf = (items) => {
    const { container, unmount } = render(<SlashList items={items} command={() => {}} />)
    const out = [...container.querySelectorAll('[aria-hidden="true"]')].map((n) => n.textContent)
    unmount()
    return out
  }

  it('slash_set_absent_when_w5_off', async () => {
    latchNotebookFlags({ notebook_widgets_w1_enabled: true })
    for (const q of ['set', 'set semis', 'preset', '']) expect(mineItems(q)).toEqual([])
    await __mineLoad()
    // Off, the menu never reads the preference at all.
    expect(global.fetch).not.toHaveBeenCalled()
    expect(slashItems('set', null).map((i) => i.title)).not.toContain('Manage chart sets')
    expect(labelsOf(slashItems('', null))).not.toContain('My presets')
    // Control: the same queries answer once wave 5 is on and the background load has landed.
    __resetNotebookFlags()
    latchNotebookFlags(W5)
    expect((await loaded('set')).map((i) => i.title)).toEqual(['Set — Semis', 'Manage chart sets'])
    expect(mineItems('set sem').map((i) => i.title)).toEqual(['Set — Semis'])
    expect(mineItems('set nope')).toEqual([])
  })

  it('answers at once, loads ONCE in the background, and backs off 30 s after a failure', async () => {
    latchNotebookFlags(W5)
    expect(mineItems('')).toEqual([])           // nothing loaded yet: no wait, no rows
    for (const q of ['s', 'se', 'set']) mineItems(q)
    await __mineLoad()
    expect(global.fetch).toHaveBeenCalledTimes(1)  // ONE shared read for every keystroke
    expect(mineItems('').length).toBe(3)
    // A failing endpoint is not asked again on every keystroke.
    __resetSetsCache(); __resetMine()
    global.fetch = vi.fn(async () => ({ ok: false, status: 502, json: async () => ({}) }))
    mineItems(''); await __mineLoad()
    for (const q of ['s', 'se', 'set']) mineItems(q)
    await __mineLoad()
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('a bare / shows the member presets and sets under "My presets"', async () => {
    latchNotebookFlags(W5)
    const items = slashItems('', null, await loaded(''))
    expect(labelsOf(items)).toContain('My presets')
    expect(items.filter((i) => i.group === 'mine').map((i) => i.title))
      .toEqual(['Preset — Flagged only', 'Set — Semis', 'Manage chart sets'])
  })

  it('/preset lists presets under "My presets" and inserts with the normal fetch-and-freeze', async () => {
    latchNotebookFlags(W5)
    const typed = slashItems('preset', null, await loaded('preset'))
    expect(typed[0]).toMatchObject({ title: 'Preset — Flagged only', group: 'mine' })
    expect(labelsOf(typed)).toContain('My presets')
    global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({
      asOf: '2026-10-20T14:00:00Z', source: 'market', listLabel: 'Flagged', rows: [], truncated: 0,
    }) }))
    const el = document.createElement('div')
    document.body.appendChild(el)
    editor = new Editor({ element: el, extensions: buildExtensions(), content: '<p>/preset</p>' })
    await typed[0].command({ editor, range: { from: 1, to: 1 + '/preset'.length } })
    expect(global.fetch).toHaveBeenCalledWith('/api/j2/notebook-widgets/myWatchlistToday?list=flagged', expect.anything())
    const embeds = []
    editor.state.doc.descendants((n) => { if (n.type.name === 'widgetEmbed') embeds.push(n) })
    expect(embeds.map((n) => n.attrs.widgetId)).toEqual(['myWatchlistToday'])
    expect(embeds[0].attrs.params.share).toBe(false)
  })

  // Through the REAL SlashMenuExtension and Suggestion: the read must never hold the menu.
  describe('the rendered menu while the read is pending', () => {
    let release
    beforeEach(() => {
      global.fetch = vi.fn((url) => (url === '/api/auth/preferences'
        ? new Promise((resolve) => { release = () => resolve({ ok: true, status: 200, json: async () => PREFS }) })
        : Promise.resolve({ ok: false, status: 500, json: async () => ({}) })))
    })
    afterEach(() => { cleanup(); document.querySelectorAll('#uct-slash-menu').forEach((n) => n.parentElement?.remove()) })
    const menus = () => [...document.querySelectorAll('#uct-slash-menu')].filter((n) => n.parentElement?.style.display !== 'none')
    const pressKey = (k) => editor.view.someProp('handleKeyDown', (f) => f(editor.view, new KeyboardEvent('keydown', { key: k })))
    async function typeSlash() {
      const el = document.createElement('div')
      document.body.appendChild(el)
      editor = new Editor({ element: el, extensions: buildExtensions(),
        content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Plan ' }] }] } })
      render(createElement(EditorContent, { editor }))
      editor.commands.focus('end', { scrollIntoView: false })
      await act(async () => { editor.commands.insertContent('/') })
    }

    it('a bare / renders Basics immediately while the preference read is pending', async () => {
      latchNotebookFlags(W5)
      await typeSlash()
      await waitFor(() => expect(menus()).toHaveLength(1))
      expect(menus()[0].parentElement.textContent).toContain('Basics')
      expect(screen.getByText('Heading 1')).toBeInTheDocument()
      expect(release).toBeTypeOf('function')   // control: the read really is still pending
      expect(menus()[0].parentElement.textContent).not.toContain('My presets')
    })

    it('a read that lands after Escape mounts no popup', async () => {
      latchNotebookFlags(W5)
      await typeSlash()
      await waitFor(() => expect(menus()).toHaveLength(1))
      await act(async () => { pressKey('Escape') })
      expect(menus()).toHaveLength(0)
      await act(async () => { release(); await __mineLoad() })
      expect(menus()).toHaveLength(0)
      expect(document.body.textContent).not.toContain('Set — Semis')
    })
  })
})

// Notebook widgets Task 20 (wave 6): the four kinds that need no choice insert directly; /recap and /screen list
// the member's own trades and screens (pickItems: synchronous, one background load, never awaited).
describe('wave 6 snapshot kinds (Task 20)', () => {
  const realFetch = global.fetch
  const W6 = { notebook_widgets_w6_enabled: true }
  const TRADES = Array.from({ length: 7 }, (_, i) => ({ id: `tr-${i}`, symbol: 'NVDA', side: 'Long', exitDate: `2026-10-0${i + 1}` }))
  const SCREENS = Array.from({ length: 6 }, (_, i) => ({ def_id: `u:${i}`, scannable: true, definition: { meta: { name: `Screen ${i}` } } }))
  const routes = (url) => {
    if (url === '/api/j2/trades?limit=10') return { trades: TRADES }
    if (url === '/api/user-definitions') return { definitions: SCREENS }
    return null
  }
  let editor
  beforeEach(() => {
    __resetPicks()
    global.fetch = vi.fn(async (url) => {
      const body = routes(url)
      return body ? { ok: true, status: 200, json: async () => body } : { ok: false, status: 500, json: async () => ({}) }
    })
  })
  afterEach(() => { global.fetch = realFetch; __resetNotebookFlags(); editor?.destroy(); editor = null })
  const loaded = async (q) => { pickItems(q); await __picksLoad(); return pickItems(q) }
  const DIRECT = ['My P&L calendar', 'My setup edge', 'Room buzz on my names', 'My earnings reactions']

  it('wave 6 off: none of the six is offered and nothing is read', async () => {
    latchNotebookFlags({ notebook_widgets_w1_enabled: true, notebook_widgets_w5_enabled: false })
    const titles = snapshotWidgetItems('').map((i) => i.title)
    for (const t of [...DIRECT, 'Trade recap', 'My screen today']) expect(titles).not.toContain(t)
    for (const q of ['', 'recap', 'screen', 'recap nvda']) expect(pickItems(q)).toEqual([])
    await __picksLoad()
    expect(global.fetch).not.toHaveBeenCalled()
    // Control: wave 1 is on, so its items still are.
    expect(titles).toContain('My watchlist today')
  })

  it('wave 6 on: the four direct kinds insert from the bare menu; Trade recap and My screen today never insert bare', () => {
    latchNotebookFlags(W6)
    const items = snapshotWidgetItems('')
    const titles = items.map((i) => i.title)
    expect(titles).toEqual(expect.arrayContaining(DIRECT))
    expect(titles).not.toContain('Trade recap')
    expect(titles).not.toContain('My screen today')
    const group = (t) => items.find((i) => i.title === t).group
    expect([group('Room buzz on my names'), group('My earnings reactions')]).toEqual(['open', 'open'])
    expect([group('My P&L calendar'), group('My setup edge')]).toEqual(['review', 'review'])
    expect(snapshotWidgetItems('buzz').map((i) => i.title)).toEqual(['Room buzz on my names'])
    expect(snapshotWidgetItems('edge').map((i) => i.title)).toEqual(['My setup edge'])
  })

  it('answers at once (nothing loaded yet), reads ONCE in the background, then lists the rows', async () => {
    latchNotebookFlags(W6)
    expect(pickItems('recap')).toEqual([])
    for (const q of ['r', 're', 'rec', 'recap']) pickItems(q)
    await __picksLoad()
    expect(global.fetch).toHaveBeenCalledTimes(2)       // the trades read and the screens read, once
    expect(pickItems('recap').map((i) => i.title)[0]).toBe('Recap — NVDA long, Oct 1')
    expect(pickItems('recap')).toHaveLength(7)
    expect(pickItems('screen').map((i) => i.title)).toEqual(SCREENS.map((r) => `Screen — ${r.definition.meta.name}`))
  })

  it('the rows are keyed to the signed-in member: another member never sees them (final review M-3)', async () => {
    latchNotebookFlags(W6)
    const as = (uid) => ({ storage: { uctJournalWidgets: { uid } } })
    pickItems('recap', as('member-a')); await __picksLoad()
    expect(pickItems('recap', as('member-a'))).toHaveLength(7)       // control: A's rows, loaded once
    expect(global.fetch).toHaveBeenCalledTimes(2)
    // Member B signs in in the same tab: nothing of A's, and B's own load starts.
    const held = []
    global.fetch = vi.fn((url) => new Promise((r) => { held.push(() => r({ ok: true, status: 200,
      json: async () => (url === '/api/j2/trades?limit=10' ? { trades: [TRADES[0]] } : { definitions: [] }) })) }))
    expect(pickItems('recap', as('member-b'))).toEqual([])
    await vi.waitFor(() => expect(held).toHaveLength(2))
    // A's tab state is not consulted again while B is signed in, and a load A started cannot land as B's.
    expect(pickItems('recap', as('member-b'))).toEqual([])
    held.forEach((go) => go()); await __picksLoad()
    expect(pickItems('recap', as('member-b'))).toHaveLength(1)
  })

  it("a load the previous member started never lands as the next member's rows (final review M-3)", async () => {
    latchNotebookFlags(W6)
    const as = (uid) => ({ storage: { uctJournalWidgets: { uid } } })
    const held = []
    global.fetch = vi.fn((url) => new Promise((r) => { held.push(() => r({ ok: true, status: 200, json: async () => routes(url) })) }))
    expect(pickItems('recap', as('member-a'))).toEqual([])           // A's load starts, still in flight
    await vi.waitFor(() => expect(held).toHaveLength(2))
    expect(pickItems('recap', as('member-b'))).toEqual([])           // B signs in: a fresh slot, B's own load
    await vi.waitFor(() => expect(held).toHaveLength(4))
    held.slice(0, 2).forEach((go) => go())                           // A's answer arrives first
    await new Promise((r) => setTimeout(r, 0))
    expect(pickItems('recap', as('member-b'))).toEqual([])           // ...and is not B's
    held.slice(2).forEach((go) => go()); await __picksLoad()
    expect(pickItems('recap', as('member-b'))).toHaveLength(7)       // control: B's own load lands
  })

  it('a failed load backs off 30 s: no read on every keystroke', async () => {
    latchNotebookFlags(W6)
    global.fetch = vi.fn(async () => ({ ok: false, status: 502, json: async () => ({}) }))
    pickItems(''); await __picksLoad()
    for (const q of ['r', 're', 'rec']) pickItems(q)
    await __picksLoad()
    expect(global.fetch).toHaveBeenCalledTimes(2)       // one load = the two reads; no second load
    expect(pickItems('recap')).toEqual([])
  })

  it('a bare / caps each at five, under Before the open and Reviewing', async () => {
    latchNotebookFlags(W6)
    const items = slashItems('', null, await loaded(''))
    expect(items.filter((i) => i.cmd === 'recap')).toHaveLength(5)
    expect(items.filter((i) => i.cmd === 'screen')).toHaveLength(5)
    expect(new Set(items.filter((i) => i.cmd === 'recap').map((i) => i.group))).toEqual(new Set(['review']))
    expect(new Set(items.filter((i) => i.cmd === 'screen').map((i) => i.group))).toEqual(new Set(['open']))
  })

  it('a recap row inserts Trade recap through the one fetch-and-freeze, with its tradeId', async () => {
    latchNotebookFlags(W6)
    const [row] = await loaded('recap')
    global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({
      asOf: '2026-10-20T14:00:00Z', source: 'manual', symbol: 'NVDA', side: 'Long', exitDate: '2026-10-01', bars: [],
    }) }))
    const el = document.createElement('div')
    document.body.appendChild(el)
    editor = new Editor({ element: el, extensions: buildExtensions(), content: '<p>/recap</p>' })
    await row.command({ editor, range: { from: 1, to: 1 + '/recap'.length } })
    expect(global.fetch).toHaveBeenCalledWith('/api/j2/notebook-widgets/tradeRecap?tradeId=tr-0', expect.anything())
    const embeds = []
    editor.state.doc.descendants((n) => { if (n.type.name === 'widgetEmbed') embeds.push(n) })
    expect(embeds.map((n) => n.attrs.widgetId)).toEqual(['tradeRecap'])
    expect(embeds[0].attrs.params).toMatchObject({ tradeId: 'tr-0', symbol: 'NVDA', share: false })
    expect(embeds[0].attrs.searchText).toBe('[trade recap: NVDA Long · 2026-10-01]')
  })

  it('a screen row inserts My screen today with its definitionId', async () => {
    latchNotebookFlags(W6)
    const row = (await loaded('screen')).find((i) => i.title === 'Screen — Screen 2')
    global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({
      asOf: '2026-10-20T14:00:00Z', source: 'market', name: 'Screen 2', hits: [], coverage: null, empty: 'x',
    }) }))
    const el = document.createElement('div')
    document.body.appendChild(el)
    editor = new Editor({ element: el, extensions: buildExtensions(), content: '<p>/screen</p>' })
    await row.command({ editor, range: { from: 1, to: 1 + '/screen'.length } })
    expect(global.fetch).toHaveBeenCalledWith('/api/j2/notebook-widgets/myScreenToday?definitionId=u%3A2', expect.anything())
  })
})

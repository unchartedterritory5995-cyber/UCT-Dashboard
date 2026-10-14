// Slash-menu widget matching — the two-regime rail. This area regressed twice
// (prefix matching armed an Enter trap on prose; the exact-match fix then
// killed '/ch' discoverability, found by the owner on prod). Single token =
// prefix match (completion, nothing to eat); with args/prose = exact name.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import { widgetItems, factItems, consensusFactItems, planItems, ITEMS, groupedSlashItems, blockItemGroup, rankedBlockItems } from './SlashMenu'
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
// everything else. Filtering by typed text is unchanged; only the bare list is grouped.
describe('bare slash menu groups (trading first)', () => {
  const bare = () => groupedSlashItems(ITEMS, [...widgetItems(''), ...factItems(''), ...consensusFactItems('')])

  it('the first options are trading, the headings come after them', () => {
    const items = bare()
    expect(items[0].title).toBe('Chart')
    expect(items[0].group).toBe('trading')
    const firstHeading = items.findIndex((i) => i.title === 'Heading 1')
    const lastTrading = items.map((i) => i.group).lastIndexOf('trading')
    expect(firstHeading).toBeGreaterThan(lastTrading)
  })

  it('groups appear in order trading, basics, more and never interleave', () => {
    const order = bare().map((i) => i.group).filter((g, i, a) => g !== a[i - 1])
    expect(order).toEqual(['trading', 'basics', 'more'])
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
    expect(blockItemGroup(byTitle('Trade-plan canvas'))).toBe('trading')
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
    expect(bare.find((i) => i.cmd === 'plan').group).toBe('trading')
  })
  it('is OFF with the journal-styles switch: nothing is offered', () => {
    journalStylesEnabled.mockImplementation(() => false)
    expect(planItems('plan nvda')).toEqual([])
    expect(planItems('plan')).toEqual([])
    expect(planItems('pla')).toEqual([])
  })
})

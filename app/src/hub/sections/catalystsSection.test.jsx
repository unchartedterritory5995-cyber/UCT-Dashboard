// Catalysts' controller — §3.6, the LAST section, and the one whose blockers were not code.
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import {
  createCatalystsSection, buildCatalystsFan, rowKey, CATALYSTS_MODE_ID,
} from './catalystsSection'
import { modesById, fanFor, PREVIEW_MODES } from '../registry'
import { validateSectionConfig } from '../contracts'

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const SRC = (...p) => readFileSync(path.join(HERE, ...p), 'utf8')

const ROWS = [
  { ticker: 'NVDA', tag: 'Earnings' },
  { ticker: 'TSLA', tag: 'Gapper' },
  { ticker: 'AMD', tag: 'Catalyst' },
]
const CTX = { mode: 'catalysts', symbol: null, navigate: vi.fn() }

/** A cursor stub with the shape `useHubCursor` returns. */
function cursorAt(index, count = ROWS.length) {
  return {
    index, count,
    next: vi.fn(), prev: vi.fn(), scrubTo: vi.fn(), paintCursor: vi.fn(),
  }
}

function make(over = {}) {
  const cursor = over.cursor || cursorAt(0)
  const reveal = vi.fn()
  const onFlag = vi.fn()
  const onNote = vi.fn()
  const config = createCatalystsSection({
    rows: ROWS, cursor, reveal, onFlag, onNote, ...over,
  })
  return { config, cursor, reveal, onFlag, onNote }
}

describe('the last mode leaves the preview', () => {
  it('⛔⛔ catalysts has LEFT PREVIEW_MODES', () => {
    expect(PREVIEW_MODES.has('catalysts')).toBe(false)
  })

  it('⭐ and only home and flow remain — NEITHER of them an unfinished build', () => {
    // `home` keeps a curated preview fan by owner ruling; `flow` is navigate-only by design and
    // its real fan is byte-identical to what the preview projection returns for it. If this set
    // ever grows, a section regressed.
    expect([...PREVIEW_MODES].sort()).toEqual(['flow', 'home'])
  })

  it('⛔ the registry hint it must now keep', () => {
    expect(modesById[CATALYSTS_MODE_ID].tapHint).toBe('tap: next row')
  })

  it('the config passes the section contract', () => {
    const { config } = make()
    expect(() => validateSectionConfig(config, 'catalystsSection')).not.toThrow()
    expect(config.id).toBe('catalysts')
  })
})

describe('tap walks the rows the member can SEE', () => {
  it('⛔⛔ tap advances the cursor AND reveals — a step nobody can see is not a step (R-15)', () => {
    const { config, cursor, reveal } = make()
    config.onTap(CTX)
    expect(cursor.next).toHaveBeenCalled()
    expect(reveal, 'the row was not scrolled into view. The tile can be longer than the viewport, '
      + 'so without the reveal the member\'s only feedback is the chip.').toHaveBeenCalled()
  })

  it('⛔ double-tap goes back, and also reveals', () => {
    const { config, cursor, reveal } = make({ cursor: cursorAt(2) })
    config.onDoubleTap(CTX)
    expect(cursor.prev).toHaveBeenCalled()
    expect(reveal).toHaveBeenCalled()
  })

  it('⛔ the scrub writes through the CURSOR STORE, not a private index', () => {
    // One position authority. A private preview index would let the chip and the painted row
    // disagree the moment anything else moved the cursor.
    const { config, cursor } = make({ cursor: cursorAt(0) })
    config.onScrub(CTX, { delta: 0.5, axis: 'y' })
    expect(cursor.scrubTo).toHaveBeenCalled()
    const pos = cursor.scrubTo.mock.calls[0][0]
    expect(pos).toBeGreaterThan(0)
    expect(pos).toBeLessThanOrEqual(1)
  })

  it('⛔ the wrong axis is ignored and a NaN delta is refused', () => {
    const { config, cursor } = make()
    config.onScrub(CTX, { delta: 0.5, axis: 'x' })
    config.onScrub(CTX, { delta: Number.NaN, axis: 'y' })
    expect(cursor.scrubTo).not.toHaveBeenCalled()
  })

  it('an empty list is inert and says so', () => {
    const { config, reveal } = make({ rows: [], cursor: cursorAt(0, 0) })
    expect(config.readout()).toBe('No catalysts')
    expect(() => config.onScrub(CTX, { delta: 1, axis: 'y' })).not.toThrow()
    expect(reveal).not.toHaveBeenCalled()
  })
})

describe('the chip says WHAT the row is, not merely where', () => {
  it('⛔ ticker and tag', () => {
    expect(make({ cursor: cursorAt(0) }).config.readout()).toBe('NVDA · Earnings')
    expect(make({ cursor: cursorAt(1) }).config.readout()).toBe('TSLA · Gapper')
  })

  it('a row with no tag still names the ticker', () => {
    const { config } = make({ rows: [{ ticker: 'SPY' }], cursor: cursorAt(0, 1) })
    expect(config.readout()).toBe('SPY')
  })

  it('rowKey is the ticker — the tile\'s own React key', () => {
    expect(rowKey({ ticker: 'NVDA' })).toBe('NVDA')
    expect(rowKey(null)).toBe('')
  })
})

describe('the fan carries the cursor\'s symbol, and drops what the tile does not have', () => {
  it('⛔⛔ catalysts.filter is DROPPED — there is no closed filter UI to open', () => {
    const ids = fanFor(make().config).map((a) => a.id)
    expect(ids, 'catalysts.filter is live. The registry says it "opens the tile\'s own filter UI", '
      + 'but the tag chips render unconditionally whenever there are rows — there is nothing to '
      + 'open, so the bubble can only answer a gesture with nothing observable.')
      .not.toContain('catalysts.filter')
  })

  it('⛔ THE CONTROL: the chips really are unconditional — read, not remembered', () => {
    // The justification for dropping a declared action must stay checkable. If the tile ever gains
    // a collapsed filter sheet, this goes red and the action becomes buildable again.
    const tile = SRC('..', '..', 'components', 'tiles', 'CatalystTable.jsx')
    expect(tile, 'the tag chips are no longer rendered unconditionally on rows — catalysts.filter '
      + 'may have something to open now, and dropping it should be revisited')
      .toMatch(/allRows\.length > 0 && \(\s*<div className=\{styles\.chipRow\}/)
  })

  it('⭐ but it stays DECLARED — dropped by the controller, not deleted', () => {
    expect((modesById[CATALYSTS_MODE_ID].fan || []).map((a) => a.id)).toContain('catalysts.filter')
  })

  it('⛔⛔ Chart it and Why carry the cursor\'s SYMBOL into their destinations', () => {
    const fan = buildCatalystsFan({ symbol: 'NVDA' })
    const chartIt = fan.find((a) => a.id === 'catalysts.chartIt')
    const why = fan.find((a) => a.id === 'catalysts.why')
    expect(chartIt.to, 'Chart it does not carry the symbol — the charts page reads no hub context, '
      + 'so the symbol has to ride the URL').toContain('NVDA')
    expect(why.to).toContain('NVDA')
    expect(why.to).toMatch(/^\/ai-search\?q=/)
  })

  it('without a symbol they fall back to the bare route rather than a broken link', () => {
    const fan = buildCatalystsFan({ symbol: null })
    expect(fan.find((a) => a.id === 'catalysts.why').to).not.toContain('undefined')
  })

  it('⛔⛔ Flag and Note carry real bodies', () => {
    const { config, onFlag, onNote } = make()
    const byId = Object.fromEntries(config.fan.map((a) => [a.id, a]))
    expect(typeof byId['catalysts.flag'].run).toBe('function')
    expect(typeof byId['catalysts.note'].run).toBe('function')
    byId['catalysts.flag'].run(CTX)
    expect(onFlag).toHaveBeenCalled()
  })

  it('⛔ EVERY run action in the shipped fan has a body — no silent bubbles', () => {
    const naked = fanFor(make().config)
      .filter((a) => a.kind === 'run' && !/\.voice$/.test(a.id) && typeof a.run !== 'function')
      .map((a) => a.id)
    expect(naked).toEqual([])
  })

  it('the flag label says which way it will go', () => {
    expect(buildCatalystsFan({ flagged: false }).find((a) => a.id === 'catalysts.flag').label)
      .toBe('Flag')
    expect(buildCatalystsFan({ flagged: true }).find((a) => a.id === 'catalysts.flag').label)
      .toBe('Unflag')
  })

  it('non-vacuity — the built fan is real and came from the registry', () => {
    const built = buildCatalystsFan({})
    expect(built.length).toBeGreaterThan(3)
    expect(built.map((a) => a.id)).toContain('catalysts.chartIt')
  })
})

describe('the three concurrent mounts cannot fight over the cursor', () => {
  it('⛔⛔ exactly ONE Dashboard render owns the hub', () => {
    // `{hero}` appears twice — desktop zone B and the mobile stack — and both are in the document.
    // The hub is coarse-pointer-only, so the MOBILE copy owns it. If both owned it, the cursor
    // would address whichever tree came first.
    const dash = SRC('..', '..', 'pages', 'Dashboard.jsx')
    const owners = [...dash.matchAll(/heroFor\((true|false)\)/g)].map((m) => m[1])
    expect(owners.length, 'the hero is no longer rendered through the heroFor factory — the two '
      + 'renders can no longer differ by the hubScope prop').toBe(2)
    expect(owners.filter((o) => o === 'true').length, 'more than one Dashboard render claims the '
      + 'hub, so two tiles would register the same mode and the last to mount would win').toBe(1)
  })

  it('⛔ Morning Wire\'s copy does NOT claim it', () => {
    const wire = SRC('..', '..', 'pages', 'MorningWire.jsx')
    expect(wire).toMatch(/<CatalystTable/)
    expect(wire, 'the Morning Wire tile now claims the hub too — that is a third registration')
      .not.toMatch(/<CatalystTable[^>]*hubScope/)
  })

  it('⛔ the rows carry a DOM identity, because a React key never reaches the document', () => {
    const tile = SRC('..', '..', 'components', 'tiles', 'CatalystTable.jsx')
    expect(tile, 'the row identity attribute is gone, so the cursor has nothing to paint or reveal')
      .toMatch(/data-catalyst-row-id=\{r\.ticker\}/)
  })

  it('⛔ node lookups are bounded by the OWNING instance\'s subtree, never document-wide', () => {
    // ⭐ This is what makes three concurrent mounts safe. A `document.querySelector` here would
    // silently address the desktop tree on a phone.
    //
    // ⚰️ AND THIS ASSERTION FAILED ON ITS FIRST RUN, on the section's own HEADER COMMENT, which
    // names `document.querySelector` precisely to explain why it must not be used. That is the
    // invented-citation trap `contractArity.test.js` already records against its own first
    // version — a detector matching the prose a few lines above the real call site. Comments are
    // stripped first, and the fixture below proves the stripping is load-bearing rather than
    // decorative.
    const stripComments = (t) => t
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')

    const raw = SRC('catalystsSection.js')
    expect(raw, 'the header no longer explains the global-query hazard — if that prose is gone, '
      + 'so is the reason the next reader will not reintroduce it').toMatch(/document\.querySelector/)

    const code = stripComments(raw)
    expect(code, 'the section queries the document instead of its own root ref — with three tiles '
      + 'mounted that addresses the wrong one').not.toMatch(/document\.querySelector/)
    expect(code).toMatch(/rootRef\?\.current\?\.querySelectorAll/)
  })
})

describe('the tile is not always there, and the section is honest about it', () => {
  it('⛔ Dashboard swaps the tile out on weekends AND market holidays', () => {
    // ~114 days a year the mode has no surface at all. Registration is mount-scoped, so the hub
    // simply falls back to the route-derived mode. Pinned so the fact cannot quietly change.
    const dash = SRC('..', '..', 'pages', 'Dashboard.jsx')
    expect(dash).toMatch(/heroState\s*===\s*'WEEKEND'\s*\?\s*<TheWeek\s*\/>/)
    expect(dash, 'heroState no longer folds holidays into WEEKEND — the ~114-day figure the '
      + 'section documents is wrong now').toMatch(/holidayToday\s*===\s*true\s*\?\s*'WEEKEND'/)
  })
})

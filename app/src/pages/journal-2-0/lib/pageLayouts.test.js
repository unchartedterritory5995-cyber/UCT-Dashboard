// P4a Task 3 — the page-layout model (lib/pageLayouts.js): pure functions over one
// preference blob, `journal_page_layout`. No React, no network: every case here is a
// value in, a value out.
import { describe, it, expect } from 'vitest'
import {
  LAYOUT_PREF, PHASES, PHASE_LABELS, PANELS, DEFAULT_LAYOUT,
  LAYOUT_VERSION, LAYOUT_MAX_ENTRIES, LAYOUT_MAX_ID_LENGTH, LAYOUT_MAX_BYTES,
  normalizeLayout, resolvePanels, movePanel, togglePanel, resetPage,
} from './pageLayouts'
import layoutsSource from './pageLayouts.js?raw'

const deepFreeze = (v) => {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v)
    Object.values(v).forEach(deepFreeze)
  }
  return v
}
const clone = (v) => JSON.parse(JSON.stringify(v))
const ids = (list) => list.map((e) => e.id)
const shownIds = (list) => list.filter((e) => e.shown).map((e) => e.id)

const TODAY_SHOWN = ['coachStrip', 'weekStrip', 'goalProgress', 'quickActions']
const TODAY_NEW = ['checklistToday', 'myRules', 'regime', 'todayNote', 'notices']
const TRADE_IDS = [
  'linkedNotes', 'entryContext', 'planGrade', 'outcome', 'chart',
  'beforeAfter', 'story', 'executions', 'review',
]

describe('the registry', () => {
  it('names the preference key, the three phases and their labels', () => {
    expect(LAYOUT_PREF).toBe('journal_page_layout')
    expect(PHASES).toEqual(['premarket', 'market', 'postclose'])
    expect(PHASE_LABELS).toEqual({ premarket: 'Premarket', market: 'Market', postclose: 'After close' })
  })

  it('lists the nine Today panels and the nine trade panels, in the brief order', () => {
    expect(PANELS.today.map((p) => p.id)).toEqual([...TODAY_SHOWN, ...TODAY_NEW])
    expect(PANELS.trade.map((p) => p.id)).toEqual(TRADE_IDS)
    expect(PANELS.today.find((p) => p.id === 'todayNote').label).toBe("Today's note")
  })

  it('is frozen, so nothing can change the registry at runtime', () => {
    expect(Object.isFrozen(PANELS)).toBe(true)
    expect(Object.isFrozen(PANELS.today)).toBe(true)
    expect(Object.isFrozen(PHASES)).toBe(true)
  })

  it('has no React import: it is a pure module that a lazy route can load', () => {
    expect(layoutsSource.length).toBeGreaterThan(500) // control: the raw read returned the module
    expect(layoutsSource).toContain('export function normalizeLayout')
    expect(layoutsSource).not.toMatch(/from\s+['"]react/)
    expect(layoutsSource).not.toMatch(/require\(\s*['"]react/)
    expect(layoutsSource).not.toMatch(/^\s*import\s/m)
  })
})

describe('DEFAULT_LAYOUT', () => {
  it('1. shows exactly the four of today for every phase, with the five new panels present and hidden', () => {
    expect(DEFAULT_LAYOUT.version).toBe(1)
    for (const phase of PHASES) {
      const list = DEFAULT_LAYOUT.today[phase]
      expect(shownIds(list)).toEqual(TODAY_SHOWN)
      expect(ids(list)).toEqual([...TODAY_SHOWN, ...TODAY_NEW])
      for (const id of TODAY_NEW) expect(list.find((e) => e.id === id)).toEqual({ id, shown: false })
    }
    expect(Object.keys(DEFAULT_LAYOUT.today)).toEqual([...PHASES])
  })

  it('shows all nine trade panels', () => {
    expect(shownIds(DEFAULT_LAYOUT.trade)).toEqual(TRADE_IDS)
    expect(ids(DEFAULT_LAYOUT.trade)).toEqual(TRADE_IDS)
  })
})

describe('normalizeLayout', () => {
  it('2. falls back to the default for null, junk, a wrong version and a malformed list', () => {
    expect(normalizeLayout(null)).toEqual(DEFAULT_LAYOUT)
    expect(normalizeLayout(undefined)).toEqual(DEFAULT_LAYOUT)
    expect(normalizeLayout('not json')).toEqual(DEFAULT_LAYOUT)
    expect(normalizeLayout('[]')).toEqual(DEFAULT_LAYOUT)
    expect(normalizeLayout([])).toEqual(DEFAULT_LAYOUT)
    expect(normalizeLayout(7)).toEqual(DEFAULT_LAYOUT)
    expect(normalizeLayout({ version: 2 })).toEqual(DEFAULT_LAYOUT)
    expect(normalizeLayout({ version: 1, today: 'x' })).toEqual(DEFAULT_LAYOUT)
  })

  it('parses a JSON string, as the preference store hands it over', () => {
    const saved = clone(DEFAULT_LAYOUT)
    saved.today.market = saved.today.market.map((e) => (e.id === 'regime' ? { ...e, shown: true } : e))
    const out = normalizeLayout(JSON.stringify(saved))
    expect(shownIds(out.today.market)).toEqual([...TODAY_SHOWN, 'regime'])
  })

  it('falls back per page and phase: one bad list does not cost the member the others', () => {
    const saved = clone(DEFAULT_LAYOUT)
    saved.today.premarket = 'oops'
    saved.today.postclose = saved.today.postclose.map((e) => (e.id === 'myRules' ? { ...e, shown: true } : e))
    delete saved.trade
    const out = normalizeLayout(saved)
    expect(out.today.premarket).toEqual(DEFAULT_LAYOUT.today.premarket)
    expect(shownIds(out.today.postclose)).toContain('myRules')
    expect(out.trade).toEqual(DEFAULT_LAYOUT.trade)
  })

  it('3. appends a registry id the saved list lacks at the END, with its default', () => {
    const saved = clone(DEFAULT_LAYOUT)
    saved.today.market = saved.today.market.filter((e) => e.id !== 'notices')
    const out = normalizeLayout(saved)
    expect(ids(out.today.market)).toEqual([...TODAY_SHOWN, ...TODAY_NEW])
    expect(out.today.market[out.today.market.length - 1]).toEqual({ id: 'notices', shown: false })
  })

  it('appends a missing panel that is shown by default as shown, not hidden', () => {
    const saved = clone(DEFAULT_LAYOUT)
    saved.trade = saved.trade.filter((e) => e.id !== 'review')
    const out = normalizeLayout(saved)
    expect(out.trade[out.trade.length - 1]).toEqual({ id: 'review', shown: true })
  })

  it('appends in registry order when several are missing, and leaves the saved order alone', () => {
    const saved = clone(DEFAULT_LAYOUT)
    saved.today.market = [{ id: 'quickActions', shown: true }, { id: 'coachStrip', shown: false }]
    const out = normalizeLayout(saved)
    expect(ids(out.today.market)).toEqual([
      'quickActions', 'coachStrip',
      'weekStrip', 'goalProgress', ...TODAY_NEW,
    ])
    expect(out.today.market[1].shown).toBe(false)
  })

  it('keeps unknown ids in place', () => {
    const saved = clone(DEFAULT_LAYOUT)
    saved.today.market.splice(2, 0, { id: 'futurePanel', shown: true })
    const out = normalizeLayout(saved)
    expect(ids(out.today.market).indexOf('futurePanel')).toBe(2)
  })

  it('keeps only entries shaped {id: string up to 40, shown: boolean}', () => {
    const long = 'x'.repeat(LAYOUT_MAX_ID_LENGTH + 1)
    const edge = 'y'.repeat(LAYOUT_MAX_ID_LENGTH)
    const saved = clone(DEFAULT_LAYOUT)
    saved.today.market = [
      { id: 'coachStrip', shown: true },
      { id: 'weekStrip', shown: 'yes' },
      { id: 7, shown: true },
      { id: long, shown: true },
      { id: edge, shown: false },
      null,
      'goalProgress',
      { shown: true },
    ]
    const out = normalizeLayout(saved).today.market
    expect(ids(out)).toContain(edge)
    expect(ids(out)).not.toContain(long)
    // the malformed weekStrip entry was dropped, so it comes back at the end with its default
    expect(out.find((e) => e.id === 'weekStrip')).toEqual({ id: 'weekStrip', shown: true })
    expect(ids(out).indexOf('weekStrip')).toBeGreaterThan(ids(out).indexOf('coachStrip'))
    for (const e of out) {
      expect(typeof e.id).toBe('string')
      expect(typeof e.shown).toBe('boolean')
      expect(e.id.length).toBeLessThanOrEqual(LAYOUT_MAX_ID_LENGTH)
    }
  })

  it('de-duplicates by first occurrence', () => {
    const saved = clone(DEFAULT_LAYOUT)
    saved.today.market = [
      { id: 'coachStrip', shown: false },
      { id: 'weekStrip', shown: true },
      { id: 'coachStrip', shown: true },
      { id: 'futurePanel', shown: true },
      { id: 'futurePanel', shown: false },
    ]
    const out = normalizeLayout(saved).today.market
    expect(ids(out).filter((id) => id === 'coachStrip')).toHaveLength(1)
    expect(out.find((e) => e.id === 'coachStrip').shown).toBe(false)
    expect(out.find((e) => e.id === 'futurePanel').shown).toBe(true)
  })

  it('is idempotent', () => {
    const saved = clone(DEFAULT_LAYOUT)
    saved.today.market.push({ id: 'futurePanel', shown: true })
    saved.trade = saved.trade.slice().reverse()
    const once = normalizeLayout(saved)
    expect(normalizeLayout(once)).toEqual(once)
  })

  it('does not hand back the shared default object', () => {
    const a = normalizeLayout(null)
    a.today.market[0].shown = false
    expect(DEFAULT_LAYOUT.today.market[0].shown).toBe(true)
    expect(normalizeLayout(null).today.market[0].shown).toBe(true)
  })

  it('exports the bounds the server validator is pinned to', () => {
    expect(LAYOUT_VERSION).toBe(1)
    expect(LAYOUT_MAX_ENTRIES).toBe(40)
    expect(LAYOUT_MAX_ID_LENGTH).toBe(40)
    expect(LAYOUT_MAX_BYTES).toBe(16384)
  })

  it('5. never returns a list the server would refuse: capped at LAYOUT_MAX_ENTRIES, registry panels always stay', () => {
    const saved = clone(DEFAULT_LAYOUT)
    // 40 unknown ids and no registry id at all: appending the nine would make 49
    saved.today.market = Array.from({ length: LAYOUT_MAX_ENTRIES }, (_, i) => ({ id: `future${i}`, shown: i % 2 === 0 }))
    const out = normalizeLayout(saved).today.market
    expect(out.length).toBeLessThanOrEqual(LAYOUT_MAX_ENTRIES)
    for (const p of PANELS.today) expect(ids(out)).toContain(p.id)
    // unknown ids are dropped from the END, so the earliest survive in their saved order
    const kept = ids(out).filter((id) => id.startsWith('future'))
    expect(kept).toEqual(Array.from({ length: kept.length }, (_, i) => `future${i}`))
    expect(kept).toHaveLength(LAYOUT_MAX_ENTRIES - PANELS.today.length)
  })

  it('caps a 40-entry list that lacks one registry id, and keeps that registry id', () => {
    const saved = clone(DEFAULT_LAYOUT)
    saved.trade = [
      ...PANELS.trade.slice(0, -1).map((p) => ({ id: p.id, shown: true })),
      ...Array.from({ length: LAYOUT_MAX_ENTRIES - (PANELS.trade.length - 1) }, (_, i) => ({ id: `future${i}`, shown: false })),
    ]
    expect(saved.trade).toHaveLength(LAYOUT_MAX_ENTRIES)
    const out = normalizeLayout(saved).trade
    expect(out).toHaveLength(LAYOUT_MAX_ENTRIES)
    expect(ids(out)).toContain('review')
    expect(ids(out)).not.toContain(`future${LAYOUT_MAX_ENTRIES - PANELS.trade.length}`)
  })

  it('6. carries unknown top-level fields and unknown phases through, and never renders them', () => {
    const saved = clone(DEFAULT_LAYOUT)
    saved.futureField = { x: [1, 2, { y: 'z' }] }
    saved.today.overnight = [{ id: 'nightPanel', shown: true }]
    saved.today.badPhase = 'oops'
    saved.today.badEntries = [{ id: 'ok', shown: true }, { id: 'no' }]
    const out = normalizeLayout(JSON.stringify(saved))
    expect(out.futureField).toEqual({ x: [1, 2, { y: 'z' }] })
    expect(out.today.overnight).toEqual([{ id: 'nightPanel', shown: true }])
    // a phase key survives only as a list of valid entries
    expect('badPhase' in out.today).toBe(false)
    expect('badEntries' in out.today).toBe(false)
    // the known shape is untouched
    expect(out.version).toBe(1)
    expect(Object.keys(out.today).filter((k) => PHASES.includes(k))).toEqual([...PHASES])
    // never rendered
    expect(resolvePanels(out, 'today', 'overnight')).toEqual([])
    expect(resolvePanels(out, 'today', 'market').map((p) => p.id)).not.toContain('nightPanel')
    // and the round trip through a mutator keeps it
    const toggled = togglePanel(out, 'today', 'market', 'regime')
    expect(toggled.futureField).toEqual(out.futureField)
    expect(toggled.today.overnight).toEqual(out.today.overnight)
    expect(normalizeLayout(toggled)).toEqual(toggled)
  })

  it('carried data is a copy and a hostile key cannot reach a prototype', () => {
    const saved = deepFreeze(JSON.parse('{"version":1,"__proto__":{"polluted":true},"keep":{"a":1}}'))
    const out = normalizeLayout(saved)
    expect(out.keep).toEqual({ a: 1 })
    expect(Object.isFrozen(out.keep)).toBe(false)
    expect({}.polluted).toBeUndefined()
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype)
  })
})

describe('resolvePanels', () => {
  it('returns {id, shown, label} in layout order, registry ids only', () => {
    const saved = clone(DEFAULT_LAYOUT)
    saved.today.market.splice(1, 0, { id: 'futurePanel', shown: true })
    const out = resolvePanels(saved, 'today', 'market')
    expect(out.map((p) => p.id)).toEqual([...TODAY_SHOWN, ...TODAY_NEW])
    expect(out[0]).toEqual({ id: 'coachStrip', shown: true, label: 'Coach notes' })
    expect(out.find((p) => p.id === 'notices')).toEqual({ id: 'notices', shown: false, label: 'Notices' })
  })

  it('follows the member order and the member visibility', () => {
    const moved = movePanel(DEFAULT_LAYOUT, 'today', 'market', 'quickActions', 'up')
    const out = resolvePanels(moved, 'today', 'market')
    expect(out.slice(0, 4).map((p) => p.id)).toEqual(['coachStrip', 'weekStrip', 'quickActions', 'goalProgress'])
  })

  it('reads a raw, un-normalized preference value too', () => {
    const out = resolvePanels(JSON.stringify({ version: 1, trade: [{ id: 'chart', shown: false }] }), 'trade')
    expect(out[0]).toEqual({ id: 'chart', shown: false, label: 'Chart' })
    expect(out).toHaveLength(TRADE_IDS.length)
  })

  it('answers an empty list for a page or phase that does not exist', () => {
    expect(resolvePanels(DEFAULT_LAYOUT, 'nope', 'market')).toEqual([])
    expect(resolvePanels(DEFAULT_LAYOUT, 'today', 'overnight')).toEqual([])
  })
})

describe('togglePanel, movePanel, resetPage', () => {
  const withFuture = () => {
    const l = clone(DEFAULT_LAYOUT)
    l.today.market.splice(2, 0, { id: 'futurePanel', shown: true })
    return l
  }

  it('toggles one panel on one phase only', () => {
    const out = togglePanel(DEFAULT_LAYOUT, 'today', 'market', 'regime')
    expect(out.today.market.find((e) => e.id === 'regime').shown).toBe(true)
    expect(out.today.premarket).toEqual(DEFAULT_LAYOUT.today.premarket)
    expect(out.today.postclose).toEqual(DEFAULT_LAYOUT.today.postclose)
    expect(out.trade).toEqual(DEFAULT_LAYOUT.trade)
    const back = togglePanel(out, 'today', 'market', 'regime')
    expect(back).toEqual(DEFAULT_LAYOUT)
  })

  it('ignores an id that is not in the list', () => {
    expect(togglePanel(DEFAULT_LAYOUT, 'today', 'market', 'nothingHere')).toEqual(DEFAULT_LAYOUT)
  })

  it('moves a panel up and down by one', () => {
    const up = movePanel(DEFAULT_LAYOUT, 'today', 'market', 'weekStrip', 'up')
    expect(ids(up.today.market).slice(0, 3)).toEqual(['weekStrip', 'coachStrip', 'goalProgress'])
    const down = movePanel(DEFAULT_LAYOUT, 'today', 'market', 'weekStrip', 'down')
    expect(ids(down.today.market).slice(0, 3)).toEqual(['coachStrip', 'goalProgress', 'weekStrip'])
    expect(up.today.premarket).toEqual(DEFAULT_LAYOUT.today.premarket)
  })

  it('4. keeps an unknown id through a toggle and a move, and resolvePanels never returns it', () => {
    const base = withFuture()
    const toggled = togglePanel(base, 'today', 'market', 'regime')
    expect(toggled.today.market.find((e) => e.id === 'futurePanel')).toEqual({ id: 'futurePanel', shown: true })

    const moved = movePanel(base, 'today', 'market', 'goalProgress', 'up')
    expect(moved.today.market.find((e) => e.id === 'futurePanel')).toEqual({ id: 'futurePanel', shown: true })
    // the unknown id has not moved: a member's hidden future panel is not reordered
    expect(ids(moved.today.market).indexOf('futurePanel')).toBe(2)
    // and the visible order did change, so the click was not a dead one
    expect(resolvePanels(moved, 'today', 'market').slice(0, 3).map((p) => p.id))
      .toEqual(['coachStrip', 'goalProgress', 'weekStrip'])

    for (const l of [base, toggled, moved]) {
      expect(resolvePanels(l, 'today', 'market').map((p) => p.id)).not.toContain('futurePanel')
    }
  })

  it('5. moving the first panel up and the last panel down is a no-op, not an error', () => {
    const upFirst = movePanel(DEFAULT_LAYOUT, 'today', 'market', 'coachStrip', 'up')
    expect(upFirst).toEqual(DEFAULT_LAYOUT)
    const downLast = movePanel(DEFAULT_LAYOUT, 'today', 'market', 'notices', 'down')
    expect(downLast).toEqual(DEFAULT_LAYOUT)
    const upTradeFirst = movePanel(DEFAULT_LAYOUT, 'trade', undefined, 'linkedNotes', 'up')
    expect(upTradeFirst).toEqual(DEFAULT_LAYOUT)
    const downTradeLast = movePanel(DEFAULT_LAYOUT, 'trade', undefined, 'review', 'down')
    expect(downTradeLast).toEqual(DEFAULT_LAYOUT)
  })

  it('treats an unknown id, an unknown direction and an unknown page as a no-op', () => {
    expect(movePanel(DEFAULT_LAYOUT, 'today', 'market', 'nothingHere', 'up')).toEqual(DEFAULT_LAYOUT)
    expect(movePanel(DEFAULT_LAYOUT, 'today', 'market', 'weekStrip', 'sideways')).toEqual(DEFAULT_LAYOUT)
    expect(movePanel(DEFAULT_LAYOUT, 'nope', 'market', 'weekStrip', 'up')).toEqual(DEFAULT_LAYOUT)
    expect(togglePanel(DEFAULT_LAYOUT, 'today', 'overnight', 'regime')).toEqual(DEFAULT_LAYOUT)
  })

  it('resets one page and phase to the default, and nothing else', () => {
    let l = togglePanel(DEFAULT_LAYOUT, 'today', 'market', 'regime')
    l = movePanel(l, 'today', 'market', 'weekStrip', 'down')
    l = togglePanel(l, 'today', 'premarket', 'notices')
    l = togglePanel(l, 'trade', undefined, 'chart')
    const out = resetPage(l, 'today', 'market')
    expect(out.today.market).toEqual(DEFAULT_LAYOUT.today.market)
    expect(out.today.premarket).toEqual(l.today.premarket)
    expect(out.trade).toEqual(l.trade)
    expect(resetPage(l, 'trade')).toEqual({ ...l, trade: DEFAULT_LAYOUT.trade })
  })

  it('3. a reset keeps unknown ids, after the default registry panels, in their saved order', () => {
    let l = withFuture()
    l.today.market.push({ id: 'futureTwo', shown: false })
    l = togglePanel(l, 'today', 'market', 'regime')
    const out = resetPage(l, 'today', 'market')
    expect(ids(out.today.market)).toEqual([...TODAY_SHOWN, ...TODAY_NEW, 'futurePanel', 'futureTwo'])
    expect(out.today.market.find((e) => e.id === 'futurePanel')).toEqual({ id: 'futurePanel', shown: true })
    expect(out.today.market.find((e) => e.id === 'futureTwo')).toEqual({ id: 'futureTwo', shown: false })
    expect(shownIds(out.today.market)).toEqual(TODAY_SHOWN.concat(['futurePanel']))
    expect(resolvePanels(out, 'today', 'market').map((p) => p.id)).not.toContain('futurePanel')
    // other phases are untouched
    expect(out.today.premarket).toEqual(l.today.premarket)
  })

  it('6. is pure: a deep-frozen input comes through every function unchanged', () => {
    const frozen = deepFreeze(withFuture())
    const before = JSON.stringify(frozen)
    expect(() => {
      togglePanel(frozen, 'today', 'market', 'regime')
      movePanel(frozen, 'today', 'market', 'weekStrip', 'down')
      movePanel(frozen, 'today', 'market', 'coachStrip', 'up')
      resetPage(frozen, 'today', 'market')
      resolvePanels(frozen, 'today', 'market')
      normalizeLayout(frozen)
      normalizeLayout(JSON.stringify(frozen))
    }).not.toThrow()
    expect(JSON.stringify(frozen)).toBe(before)
    deepFreeze(DEFAULT_LAYOUT)
    expect(() => movePanel(DEFAULT_LAYOUT, 'today', 'market', 'weekStrip', 'up')).not.toThrow()
  })

  it('7. a trade layout ignores the phase', () => {
    const a = togglePanel(DEFAULT_LAYOUT, 'trade', 'premarket', 'chart')
    const b = togglePanel(DEFAULT_LAYOUT, 'trade', 'postclose', 'chart')
    const c = togglePanel(DEFAULT_LAYOUT, 'trade', undefined, 'chart')
    expect(a).toEqual(b)
    expect(a).toEqual(c)
    expect(a.trade.find((e) => e.id === 'chart').shown).toBe(false)
    expect(a.today).toEqual(DEFAULT_LAYOUT.today)
    expect(resolvePanels(a, 'trade', 'premarket')).toEqual(resolvePanels(a, 'trade', 'postclose'))
    expect(ids(movePanel(DEFAULT_LAYOUT, 'trade', 'market', 'story', 'up').trade).slice(4, 8))
      .toEqual(['chart', 'story', 'beforeAfter', 'executions'])
  })
})

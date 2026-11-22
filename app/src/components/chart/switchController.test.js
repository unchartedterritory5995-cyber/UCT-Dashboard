// ⭐⭐ THE SWITCH CONTROLLER (imperative switch, stage 3): its rule table is pinned to the pass's own list of
// names, and its decisions are tested with a pass that only records what it was handed.
//
//   1. THE CENSUS. Every name `applyFrame` reads off its frame (StockChart.jsx, read from the syntax tree) has
//      exactly one rule in FRAME_RULES, and the table has no rule for a name the pass does not read. A new frame
//      name with no rule fails here by name; at run time the same gap refuses the switch (`unruled:<name>`).
//   2. THE DECISIONS. All or nothing: a frame is handed over whole or the switch is refused by name; a value is
//      carried only under its rule; the per-symbol layers are cleared in the pass; a pass of the replaced symbol
//      paints nothing until React has caught up; the catch-up is counted as a no-op or a repaint.
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'
import { FRAME_RULES, createSwitchController, switchControllerFor, isNone } from './switchController'

const HERE = dirname(fileURLToPath(import.meta.url))
const CHART = readFileSync(join(HERE, '..', 'StockChart.jsx'), 'utf8')

/** The names the module-level `applyFrame(ctx, frame)` takes off `frame` (its second statement). */
function frameNamesOf(src) {
  const ast = Parser.extend(jsx()).parse(src, { ecmaVersion: 'latest', sourceType: 'module' })
  const pass = ast.body.find((s) => s.type === 'FunctionDeclaration' && s.id && s.id.name === 'applyFrame')
  if (!pass) return null
  const st = pass.body.body.find((x) => x.type === 'VariableDeclaration' && x.declarations[0].init && x.declarations[0].init.name === 'frame')
  return st ? st.declarations[0].id.properties.map((p) => p.key.name) : null
}

describe('FRAME_RULES: one rule per name the pass reads off its frame', () => {
  const names = frameNamesOf(CHART)
  const KINDS = ['same', 'none', 'built', 'cleared', 'channel']

  it('the pass and its names were found (a census that finds nothing proves nothing)', () => {
    expect(names).toBeTruthy()
    expect(names.length).toBeGreaterThan(100)
    expect(names).toContain('sym')
    expect(names).toContain('__heavy')
  })

  it('every frame name has a rule', () => {
    expect(names.filter((n) => !FRAME_RULES[n])).toEqual([])
  })

  it('no rule is for a name the pass does not read', () => {
    expect(Object.keys(FRAME_RULES).filter((n) => !names.includes(n))).toEqual([])
  })

  it('every rule is one of the five kinds, with what its kind needs', () => {
    for (const [name, r] of Object.entries(FRAME_RULES)) {
      expect(KINDS, name).toContain(r.kind)
      if (r.kind === 'none') expect(typeof r.why, name).toBe('string')
      if (r.kind === 'built') expect(typeof r.from, name).toBe('function')
      if (r.kind === 'cleared' || r.kind === 'channel') expect(typeof r.value, name).toBe('function')
    }
  })

  it('the symbol, its bars and everything derived from them are BUILT; the per-symbol layers are CLEARED', () => {
    const kind = (n) => FRAME_RULES[n].kind
    for (const n of ['sym', '_exKey', '__heavy', 'volMaData', 'overlayData', 'sessionShadeBands', 'historyFromListing', 'listingUnserved', 'symbolMeta', 'mergedMarkers']) expect(kind(n), n).toBe('built')
    for (const n of ['allPriceLines', 'dpZones', 'swingPoints']) expect(kind(n), n).toBe('cleared')
    for (const n of ['_paintStoreDev', 'devOnScreen']) expect(kind(n), n).toBe('channel')
    // an indicator input of the symbol is never carried: it is "nothing", or the switch is refused
    for (const n of ['secondarySources', 'lowerTfSources', 'fundamentalSources', 'marketCapAuthoritySources', 'economicSources', 'calcFrames', 'comparisonData']) expect(kind(n), n).toBe('none')
  })

  it('self-check: the scan reads the syntax tree, so a name in a comment or a string is not a frame name', () => {
    const tiny = `
      // const { ghostA } = frame
      function applyFrame(ctx, frame) {
        const { aRef } = ctx
        const { sym, /* ghostB, */ cs } = frame
        const note = 'const { ghostC } = frame'
      }`
    expect(frameNamesOf(tiny)).toEqual(['sym', 'cs'])
    expect(frameNamesOf('function other() {}')).toBe(null)
  })
})

describe('isNone', () => {
  it.each([[null], [undefined], [false], [''], [[]], [new Map()], [new Set()], [{}]])('%j is nothing', (v) => expect(isNone(v)).toBe(true))
  it.each([[0], [true], ['x'], [[1]], [new Map([[1, 2]])], [new Set([1])], [{ a: 1 }], [() => {}]])('%j is something', (v) => expect(isNone(v)).toBe(false))
})

// ── the decisions, with a recording pass ─────────────────────────────────────────────────────────────────────
const ref = (v) => ({ current: v })
/** A frame as a React pass hands it: every ruled name present, "nothing" where the rule wants nothing. */
const reactFrame = (sym, over = {}) => {
  const f = {}
  for (const [name, r] of Object.entries(FRAME_RULES)) f[name] = r.kind === 'none' ? null : `${name}@${sym}`
  const bars = [{ t: 1 }, { t: 2 }]
  return {
    ...f, sym, resolvedTf: 'D', adjustTime: ADJ, comparisonData: [], _exKey: sym + '_D',
    __heavy: { committed: { displayBars: bars, filteredBars: bars } },
    ...over,
  }
}
const ADJ = (t) => t
let log
let passes
let layers
const fakeApply = (c, f) => {
  passes.push({ ctx: c, frame: f })
  log.push(`pass:${f.sym}`)
  // what the real pass does that the controller relies on
  c.lastCfgSigRef.current = `sig:${f.sym}:${(f.mergedMarkers || []).length}`
  c.prevPaintBarsRef.current = f.__heavy.committed.displayBars
  c._drawMetaRef.current(c._metaNowRef.current(), false, false)
}
const built = (sym) => {
  const bars = [{ t: 1, s: sym }, { t: 2, s: sym }]
  return {
    ok: true, sym, tf: 'D', bars, sessionBars: bars, filteredBars: bars, sessionAppliedBars: bars, displayBars: bars,
    ohlcBase: [{ time: 1 }, { time: 2 }], closeData: ['close', sym], hvcSet: new Set(), volData: ['vol', sym], volMaData: ['volMa', sym],
    newestBarIsForming: false,
  }
}
const fakeBuild = (snapshot, view) => (snapshot ? built(view.sym) : { ok: false, why: 'snapshot' })
const makeCtx = () => ({
  chartRef: ref({}), candleSeriesRef: ref({}), lastCfgSigRef: ref(null), prevPaintBarsRef: ref(null),
  _drawMetaRef: ref(() => log.push('drawMeta:react')), _metaNowRef: ref(() => ({ watermarkMeta: 'react' })),
  alertLineOptsRef: ref(['an alert of the old symbol']), wmLogoRef: ref('logo of the old symbol'),
})
const makeView = (sym, over = {}) => ({
  sym, tf: 'D', showExtended: false, recipes: { adjustTime: ADJ, plain: true },
  refuse: null,
  symbolRefusal: () => null,
  snapshot: (s) => ({ status: 'current', sym: s }),
  tail: (b) => ({ ok: true, ohlcData: [...b.ohlcBase, 'tail'], kind: 'none' }),
  overlayData: (bars) => ['overlay', bars[0].s],
  shadeBands: (bars) => ['bands', bars[0].s],
  listing: () => ({ historyFromListing: false, listingUnserved: false }),
  symbolMeta: (s) => ({ ticker: s }),
  laneShows: (s) => log.push(`lane:${s}`),
  closeChannel: () => log.push('channel:closed'),
  clearReadout: () => log.push('readout:cleared'),
  // (review of #2400) the chart's own pass of the symbol React shows, and the peeked metadata of the next one
  reactRepaint: () => log.push('react:repaint'),
  metaFor: (s) => ({ watermarkMeta: { name: `${s} Inc` }, mergedMarkers: [] }),
  drawMeta: () => { layers += 1; log.push('meta:drawn') },
  // the member's alert lines on a symbol (one alerts list for every symbol, held by the chart's last render)
  alertLines: (s) => [{ price: 3, title: 'Alert', of: s }],
  // the session tags (the Pre/Post chip, the RTH close): built for the next symbol, applied after its pass
  sessionTags: (b, s) => [{ price: 1, of: s }],
  applySessionTags: (tags) => log.push(`tags:${tags ? tags.map((t) => t.of).join(',') : 'none'}`),
  ...over,
})
/** A controller whose chart has painted `sym` through React once. */
const painted = (sym = 'AAA', viewOver = {}, frameOver = {}) => {
  const c = createSwitchController({ applyFrame: fakeApply, buildFrame: fakeBuild })
  const ctx = makeCtx()
  c.noteView(makeView(sym, viewOver))
  c.reactPass(ctx, reactFrame(sym, frameOver))
  log.length = 0
  passes.length = 0
  return { c, ctx }
}
beforeEach(() => { log = []; passes = []; layers = 0 })

describe('apply: the new symbol\'s frame, whole', () => {
  it('paints in today\'s order: the lane hears the symbol, the old channel closes, the pass runs (the new symbol\'s metadata drawn in it), the old readout is emptied', () => {
    const { c } = painted()
    expect(c.apply('BBB')).toBe('applied')
    expect(log.filter((l) => !/^tags:/.test(l))).toEqual(['lane:BBB', 'channel:closed', 'pass:BBB', 'meta:drawn', 'readout:cleared'])
  })

  it('hands the pass a frame of the new symbol: BUILT from its bars, CLEARED layers, a closed channel, the rest carried', () => {
    const { c } = painted()
    c.apply('BBB')
    const f = passes[0].frame
    expect(f.sym).toBe('BBB')
    expect(f._exKey).toBe('BBB_D')
    expect(f.volMaData).toEqual(['volMa', 'BBB'])
    expect(f.overlayData).toEqual(['overlay', 'BBB'])
    expect(f.sessionShadeBands).toEqual(['bands', 'BBB'])
    expect(f.symbolMeta).toEqual({ ticker: 'BBB' })
    expect(f.__heavy.committed._big).toEqual({ ohlcData: [{ time: 1 }, { time: 2 }, 'tail'], closeData: ['close', 'BBB'], volData: ['vol', 'BBB'] })
    expect(f.__heavy.committed.filteredBars[0].s).toBe('BBB')
    expect(f.__heavy.committed.data).toEqual({ newest_bar_is_forming: false })
    for (const n of ['allPriceLines', 'mergedMarkers', 'dpZones', 'swingPoints']) expect(f[n], n).toEqual([])
    expect(f.fadeCutoff).toBe(null)
    expect(f.devOnScreen.tail()).toBe(null)
    expect(f._paintStoreDev()).toBe(undefined)
    expect(f.cs).toBe('cs@AAA')            // SAME: the settings object itself
    expect(f.boldCandles).toBe('boldCandles@AAA')
  })

  it('the frame has exactly the names the React pass handed over (no name is dropped, none invented)', () => {
    const { c } = painted()
    c.apply('BBB')
    expect(Object.keys(passes[0].frame).sort()).toEqual(Object.keys(FRAME_RULES).sort())
  })

  it('the pass draws no metadata of the old symbol: its alerts, its logo and its markers are not handed over', () => {
    const { c, ctx } = painted()
    c.apply('BBB')
    const pc = passes[0].ctx
    // (review 2) the alert lines are the NEW symbol's: the alerts list is one for every symbol, so they are
    // readable outside a render and drawn in the frame of the paint (never the old symbol's)
    expect(pc.alertLineOptsRef.current).toEqual([{ price: 3, title: 'Alert', of: 'BBB' }])
    expect(pc.wmLogoRef.current).toBe(null)
    expect(pc._metaNowRef.current()).toEqual({ watermarkMeta: { name: 'BBB Inc' }, mergedMarkers: [] })   // the NEW symbol's, as held
    expect(layers).toBe(1)
    expect(log).not.toContain('drawMeta:react')
    // …and the chart's own refs are untouched (the React effects still own them)
    expect(ctx.alertLineOptsRef.current).toEqual(['an alert of the old symbol'])
    expect(ctx.wmLogoRef.current).toBe('logo of the old symbol')
    expect(pc.chartRef).toBe(ctx.chartRef)
  })

  it('publishes the applied key to its readers, after the paint', () => {
    const { c } = painted()
    const seen = []
    const off = c.subscribeApplied((k) => seen.push([k, log.includes('pass:BBB')]))
    c.apply('BBB')
    expect(seen).toEqual([['BBB_D', true]])
    expect(c.appliedKey()).toBe('BBB_D')
    off()
    c.apply('CCC')
    expect(seen).toHaveLength(1)
  })

  it('a token from canApply is used as built (the frame is built once per switch)', () => {
    let builds = 0
    const c = createSwitchController({ applyFrame: fakeApply, buildFrame: (s, v) => { builds += 1; return fakeBuild(s, v) } })
    c.noteView(makeView('AAA'))
    c.reactPass(makeCtx(), reactFrame('AAA'))
    const token = c.canApply('BBB')
    expect(token).toBeTruthy()
    expect(passes.filter((p) => p.frame.sym === 'BBB')).toHaveLength(0)   // asking paints nothing
    expect(c.apply('BBB', token)).toBe('applied')
    expect(builds).toBe(1)
  })
})

describe('refusals: named, counted, and nothing is painted', () => {
  const refused = (c, sym, why) => {
    expect(c.canApply(sym)).toBe(null)
    expect(c.apply(sym)).toBe(false)
    expect(passes).toHaveLength(0)
    expect(log).toEqual([])
    expect(c.diag.last).toEqual({ sym, ok: false, why })
    expect(c.diag.refused[why]).toBe(2)
  }
  it('a chart that has never painted', () => {
    const c = createSwitchController({ applyFrame: fakeApply, buildFrame: fakeBuild })
    refused(c, 'BBB', 'no-pass')
  })
  it('a chart without its series', () => {
    const { c, ctx } = painted()
    ctx.candleSeriesRef.current = null
    refused(c, 'BBB', 'no-chart')
  })
  it('the symbol already on screen', () => refused(painted().c, 'AAA', 'same-symbol'))
  it('what the chart itself refuses (a per-symbol layer it cannot clear)', () => refused(painted('AAA', { refuse: 'drawings' }).c, 'BBB', 'drawings'))
  it('what the new symbol refuses (the host\'s special kind)', () => refused(painted('AAA', { symbolRefusal: (s) => (s === 'BBB' ? 'host-symbol' : null) }).c, 'BBB', 'host-symbol'))
  it('a frame that does not build', () => refused(painted('AAA', { snapshot: () => null }).c, 'BBB', 'frame:snapshot'))
  it('a tail that needs the symbol\'s own state', () => refused(painted('AAA', { tail: () => ({ ok: false }) }).c, 'BBB', 'tail'))
  it('a commit whose pass has not run (the view is a symbol ahead of the frame)', () => {
    const { c } = painted()
    c.noteView(makeView('ZZZ'))
    refused(c, 'BBB', 'pass-behind')
  })
  it('recipes of another render than the frame', () => refused(painted('AAA', { recipes: { adjustTime: () => 0, plain: true } }).c, 'BBB', 'recipes-behind'))
  it.each([
    ['secondarySources', new Map([['SPY', {}]]), 'sources'],
    ['calcFrames', new Map([['f', {}]]), 'sources'],
    ['comparisonData', [{ time: 1, value: 2 }], 'comparison'],
    ['replayCutoff', '2026-01-02', 'replay'],
    ['studioPreview', { instanceId: 'p' }, 'studio-preview'],
    ['watermark', 'A custom label', 'watermark-label'],
    ['sessionPreviewLastBar', true, 'session-preview'],
  ])('a value that is carried only while it is nothing: %s', (name, value, why) => refused(painted('AAA', {}, { [name]: value }).c, 'BBB', why))
  it('a frame name with no rule refuses the switch by name (it never rides along)', () => refused(painted('AAA', {}, { aNewName: 1 }).c, 'BBB', 'unruled:aNewName'))
  it('a chart key that does not start with its symbol (the key is derived, never spelled here)', () => refused(painted('AAA', {}, { _exKey: 'D_AAA' }).c, 'BBB', 'key-shape'))
})

describe('the stale-render guard, and the catch-up', () => {
  it('after a switch, a pass of the replaced symbol is stale; the new symbol\'s pass is not', () => {
    const { c } = painted()
    expect(c.staleFor('AAA')).toBe(false)   // nothing pending
    c.apply('BBB')
    expect(c.pendingSym()).toBe('BBB')
    expect(c.pendingFrom()).toBe('AAA')
    expect(c.staleFor('AAA')).toBe(true)
    expect(c.staleFor('BBB')).toBe(false)
    expect(c.staleFor('CCC')).toBe(false)   // React moved to a third symbol: its pass paints
    expect(c.diag.stale).toBe(1)
  })

  it('the catch-up pass that changes nothing is counted a no-op, and ends the pending switch', () => {
    const { c, ctx } = painted()
    c.apply('BBB')
    const handed = passes[0].frame
    // React commits BBB: the same bars array, the same signature
    c.noteView(makeView('BBB'))
    c.reactPass(ctx, reactFrame('BBB', { __heavy: { committed: { displayBars: handed.__heavy.committed.displayBars } }, mergedMarkers: [] }))
    expect(c.diag.catchUp).toEqual({ noop: 1, repaint: 0 })
    expect(c.pendingSym()).toBe(null)
    expect(c.staleFor('AAA')).toBe(false)
  })

  it('a catch-up whose signature differs (the symbol has markers) is counted a repaint', () => {
    const { c, ctx } = painted()
    c.apply('BBB')
    const handed = passes[0].frame
    c.noteView(makeView('BBB'))
    c.reactPass(ctx, reactFrame('BBB', { __heavy: { committed: { displayBars: handed.__heavy.committed.displayBars } }, mergedMarkers: [{ time: 1 }] }))
    expect(c.diag.catchUp).toEqual({ noop: 0, repaint: 1 })
  })

  it('a catch-up over other bars (the row changed meanwhile) is counted a repaint', () => {
    const { c, ctx } = painted()
    c.apply('BBB')
    c.noteView(makeView('BBB'))
    c.reactPass(ctx, reactFrame('BBB', { mergedMarkers: [] }))
    expect(c.diag.catchUp).toEqual({ noop: 0, repaint: 1 })
  })

  it('a second switch before React caught up: still from the symbol React shows, and the first is forgotten', () => {
    const { c } = painted()
    c.apply('BBB')
    expect(c.apply('CCC')).toBe('applied')
    expect(c.pendingSym()).toBe('CCC')
    expect(c.pendingFrom()).toBe('AAA')
    expect(c.staleFor('AAA')).toBe(true)
    expect(c.apply('CCC')).toBe(false)      // already on screen
    expect(c.diag.last.why).toBe('same-symbol')
  })
})

describe('the numbers the harness reads', () => {
  it('asked = applied + refused, each refusal under its reason, each tail under its kind', () => {
    const { c } = painted('AAA', { tail: (b) => ({ ok: true, ohlcData: b.ohlcBase, kind: 'whitespace' }) })
    c.apply('BBB')
    c.canApply('BBB')            // same-symbol
    c.apply('CCC')
    const d = c.diag
    expect(d.applied).toBe(2)
    expect(d.refused).toEqual({ 'same-symbol': 1 })
    expect(d.asked).toBe(d.applied + Object.values(d.refused).reduce((a, b) => a + b, 0))
    expect(d.tail).toEqual({ whitespace: 2 })
  })
})

describe('the body\'s commits are counted (a switch that adds none rendered nothing)', () => {
  it('`views` moves once per view the chart writes, and a paint moves it not at all', () => {
    const { c } = painted()
    const n = c.diag.views
    c.apply('BBB')
    expect(c.diag.views).toBe(n)
    c.noteView(makeView('BBB'))
    expect(c.diag.views).toBe(n + 1)
  })
})

describe('review finding 1: going back to the symbol React still shows', () => {
  it('apply(the symbol the switch replaced) is the chart\'s OWN pass of it: the switch ends and nothing stays stripped', () => {
    const { c, ctx } = painted()
    c.apply('BBB')
    log.length = 0
    passes.length = 0
    expect(c.apply('AAA')).toBe('applied')
    // not a built frame: React's frame of AAA, by the chart's own pass; and (review round 2, L1) the server-compute
    // lane hears AAA again first, as on any switch (the paint told it BBB, and the body's `sym` never changes back)
    expect(log).toEqual(['lane:AAA', 'react:repaint'])
    expect(passes).toHaveLength(0)
    expect(c.pendingSym()).toBe(null)
    expect(c.staleFor('AAA')).toBe(false)
    // …and that pass is a full one: the signature and the painted bars were forgotten first
    expect(ctx.lastCfgSigRef.current).toBe(null)
    expect(ctx.prevPaintBarsRef.current).toBe(null)
    expect(c.diag.replayed).toBe(1)
  })
  it('canApply says yes to it (it never refuses the symbol React shows)', () => {
    const { c } = painted('AAA', { refuse: 'drawings' })
    // (a chart that refuses every other symbol still goes back to its own)
    const quiet = createSwitchController({ applyFrame: fakeApply, buildFrame: fakeBuild })
    quiet.noteView(makeView('AAA'))
    quiet.reactPass(makeCtx(), reactFrame('AAA'))
    quiet.apply('BBB')
    quiet.noteView(makeView('AAA', { refuse: 'drawings' }))
    expect(quiet.canApply('AAA')).toBeTruthy()
    expect(c.canApply('BBB')).toBe(null)
  })
  it('reconcile: the host shows the symbol React still shows while another is painted -> the same replay', () => {
    const { c } = painted()
    c.apply('BBB')
    log.length = 0
    c.reconcile('AAA')
    expect(log).toEqual(['lane:AAA', 'react:repaint'])
    expect(c.pendingSym()).toBe(null)
  })
  it('reconcile does nothing when the host shows the painted symbol, a third one, or nothing is pending', () => {
    const { c } = painted()
    c.reconcile('AAA')
    c.apply('BBB')
    log.length = 0
    c.reconcile('BBB')
    c.reconcile('CCC')
    expect(log).toEqual([])
    expect(c.pendingSym()).toBe('BBB')
  })
})

describe('the session tags are a layer the controller BUILDS (the browser A/B: `session-tags` refused every switch)', () => {
  it('the new symbol\'s tags are applied in the paint, after the pass', () => {
    const { c } = painted()
    c.apply('BBB')
    expect(log).toEqual(['lane:BBB', 'channel:closed', 'pass:BBB', 'meta:drawn', 'tags:BBB', 'readout:cleared'])
  })
  it('a symbol with no tag (inside the session) clears the old symbol\'s', () => {
    const { c } = painted('AAA', { sessionTags: () => null })
    c.apply('BBB')
    expect(log).toContain('tags:none')
  })
})

describe('review finding 5: the numbers add up', () => {
  const sum = (d) => d.applied + Object.values(d.refused).reduce((a, b) => a + b, 0)
  it('a frame built for a decision a sibling then vetoed is a refusal, `group-veto`', () => {
    const { c } = painted()
    c.canApply('BBB')            // built; the group says no; never painted
    c.canApply('CCC')            // the next press
    c.apply('CCC')
    c.apply('CCC')               // already on screen
    expect(c.diag.applied).toBe(1)
    expect(c.diag.refused).toEqual({ 'group-veto': 1, 'same-symbol': 1 })
    expect(c.diag.asked).toBe(sum(c.diag))
  })
  it('a frame built in the decision and painted by the round for the SAME press is one question', () => {
    const { c } = painted()
    c.canApply('BBB')
    c.apply('BBB')               // the round: no token
    expect(c.diag).toMatchObject({ asked: 1, applied: 1, refused: {} })
  })
  // (review round 2, H2) the round never paints; its switches are still questions this chart answered no to
  it('a switch shown by the round is counted a refusal, `round` (one question per press)', () => {
    const { c } = painted()
    c.noteRound('BBB')
    expect(c.diag).toMatchObject({ asked: 1, applied: 0, refused: { round: 1 } })
    expect(c.diag.last).toEqual({ sym: 'BBB', ok: false, why: 'round' })
    expect(passes).toHaveLength(0)
  })
  it('…and a frame the decision built for that same press (a sibling said no) is that press\'s `group-veto`, once', () => {
    const { c } = painted()
    c.canApply('BBB')            // the decision built it; a sibling said no
    c.noteRound('BBB')           // the round shows the same press
    expect(c.diag).toMatchObject({ asked: 1, applied: 0, refused: { 'group-veto': 1 } })
    c.canApply('CCC')            // the next press: nothing left open to count again
    expect(c.diag.refused).toEqual({ 'group-veto': 1 })
    expect(c.diag.asked).toBe(sum(c.diag))
  })
  it('`released` counts the body\'s releases', () => {
    const { c } = painted()
    c.noteReleased()
    c.noteReleased()
    expect(c.diag.released).toBe(2)
  })
})

describe('review finding 4: a closure that keeps the pass\'s box would be seen', () => {
  it('reads of the built box after its pass are counted (`lateBoxReads`); reads inside the pass are not', () => {
    const { c } = painted()
    c.apply('BBB')
    expect(c.diag.lateBoxReads).toBe(0)          // the pass itself read it (fakeApply does)
    const kept = passes[0].frame.__heavy          // what a closure installed in the pass would hold
    expect(kept.committed.displayBars.length).toBe(2)
    expect(c.diag.lateBoxReads).toBe(1)
  })
})

describe('review finding 2: the new symbol\'s metadata the app already holds is drawn in the frame', () => {
  it('the pass is handed the peeked metadata (the watermark\'s name), and the layers are drawn from it', () => {
    const { c } = painted()
    c.apply('BBB')
    expect(passes[0].ctx._metaNowRef.current().watermarkMeta).toEqual({ name: 'BBB Inc' })
    expect(log).toContain('meta:drawn')
    expect(log).not.toContain('drawMeta:react')   // never the old render's own draw of the old symbol
  })
  it('the alert lines are the new symbol\'s, and none when the chart draws none (the setting off, or no alert on it)', () => {
    const { c } = painted()
    c.apply('BBB')
    expect(passes[0].ctx.alertLineOptsRef.current.map((l) => l.of)).toEqual(['BBB'])
    const off = painted('AAA', { alertLines: () => [] }).c
    passes.length = 0
    off.apply('BBB')
    expect(passes[0].ctx.alertLineOptsRef.current).toEqual([])
  })
})

// (browser A/B of 3cf50f94d5) the numbers that say whether the key's task got shorter
describe('the key\'s task, as the controller sees it', () => {
  it('`heldViews` counts the body\'s commits while a switch is pending with the body still on the old symbol', () => {
    const { c } = painted()
    c.noteView(makeView('AAA'))            // nothing pending: not counted
    c.apply('BBB')
    c.noteView(makeView('AAA'))            // the held body committed (the old symbol): counted
    c.noteView(makeView('BBB'))            // the body's own render of the painted symbol: not counted
    expect(c.diag.heldViews).toBe(1)
  })
  it('`keyTask`: from this chart\'s question to the end of its paint, and to the end of the task (after its microtasks: React\'s sync render)', async () => {
    let t = 0
    const c = createSwitchController({ applyFrame: fakeApply, buildFrame: fakeBuild, now: () => t })
    c.noteView(makeView('AAA'))
    c.reactPass(makeCtx(), reactFrame('AAA'))
    t = 10
    const token = c.canApply('BBB')
    t = 14
    expect(c.apply('BBB', token)).toBe('applied')
    t = 23                                 // the rest of the key's task (the label's render) before its microtasks end
    for (let i = 0; i < 6; i++) await Promise.resolve()
    expect(c.diag.keyTask).toMatchObject({ n: 1, paint: [4], task: [13], paintMedian: 4, taskMedian: 13 })
  })
  it('`keyTask` times only a switch the decision asked first (a paint without its token is not one)', async () => {
    const c = createSwitchController({ applyFrame: fakeApply, buildFrame: fakeBuild, now: () => 0 })
    c.noteView(makeView('AAA'))
    c.reactPass(makeCtx(), reactFrame('AAA'))
    c.apply('BBB')
    for (let i = 0; i < 6; i++) await Promise.resolve()
    expect(c.diag.keyTask.n).toBe(0)
  })
})

describe('switchControllerFor', () => {
  it('one controller per owner, for its life', () => {
    const a = {}
    const deps = { applyFrame: fakeApply, buildFrame: fakeBuild }
    expect(switchControllerFor(a, deps)).toBe(switchControllerFor(a, deps))
    expect(switchControllerFor({}, deps)).not.toBe(switchControllerFor(a, deps))
  })
})

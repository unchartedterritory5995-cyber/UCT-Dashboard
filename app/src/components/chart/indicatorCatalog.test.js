import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  catalogRows, labelFor, longLabelFor, oscillatorIds, priceOverlayIds,
  CARVED_OUT_ROWS, unwiredKeys, NOT_IN_BLOB,
} from './indicatorCatalog'
import { CHART_DEFAULTS, mergeChartSettings } from './chartDefaults'
import { ENGINE_FLIPPED_DEF_IDS } from './engine/flipState'
import { setIndicatorEnabled, setIndicatorInput } from './engine/instanceControls'
import * as engineRegistry from './engine/nativeRegistry'

// ─── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
//
// SIX shipped lists label the same indicator six ways — `Bollinger Bands` and
// `BB`, `Stochastic` and `Stoch`, `Williams %R` and `W%R`. There is no
// convention to preserve, so B4 PICKS one — menus, region titles, compact strips
// and the keyboard help sheet take `meta.shortName`; the library dialog and the
// generated settings rows take `meta.name` — and this file is where the
// resulting visible diff is a DECISION somebody wrote down, not a string that
// changed under a refactor.
//
// ⭐ THE A-SIDE IS PARSED, NOT HAND-COPIED. This branch has already shipped the
// hand-copy defect twice: a "pinned against the installed bundle" test that
// pinned one hand-copy to another, and a slot rail that read a hand-copied
// `Set`. So `parseShippedLists()` below reads the six lists OUT OF THE SHIPPED
// SOURCE FILES and `SHIPPED` is proven equal to that parse by its own test case.
// `SHIPPED` is written down as well as parsed for exactly one reason: Tasks 3, 4
// and 8 DELETE these six regions, and when they do, the parse case is the one
// that has to be retired — the A-side it verified today survives as the frozen
// record of what shipped. Retiring the parse case is a deliberate act with an
// instruction attached (see `parseShippedLists`), not a silent green.

/** The repo root, found by walking up from wherever vitest was invoked — the
 *  same helper `engine/__tests__/enumerationSites.test.js` uses, and for the same
 *  reason (`import.meta.url` is an http: URL under this vite transform, and
 *  `process.cwd()` is `app/` for the documented runner). */
const ROOT = (() => {
  let dir = process.cwd()
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'app', 'src', 'components', 'StockChart.jsx'))) return dir
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  throw new Error(`indicatorCatalog: could not find the repo root from ${process.cwd()}`)
})()

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

/** Every regex below must match EXACTLY ONCE. A pattern that matches zero times
 *  returns `{}`, and every label loop over `{}` passes vacuously — which is the
 *  whole failure mode this file is built against. THROWS by name instead. */
function once(src, re, what) {
  const m = [...src.matchAll(re)]
  if (m.length !== 1) {
    throw new Error(
      `${what}: the shipped region matched ${m.length} times, expected exactly 1. ` +
      'If B4 has RETIRED this region, that is expected — delete this list from ' +
      'parseShippedLists() and say so in the comment on SHIPPED, which then stands ' +
      'alone as the frozen record of what shipped at d2733adc.',
    )
  }
  return m[0]
}

function pairList(src, name, what) {
  const m = once(src, new RegExp(`const ${name} = (\\[[^\\n]*\\])`, 'g'), what)
  const out = {}
  for (const p of m[1].matchAll(/\['([A-Za-z_]+)',\s*'([^']*)'\]/g)) out[p[1]] = p[2]
  return out
}

/** The six shipped lists, READ OUT OF THE SHIPPED SOURCE. */
function parseShippedLists() {
  const SC = read('app/src/components/StockChart.jsx')
  const TB = read('app/src/components/chart/ChartToolbar.jsx')
  const CR = read('app/src/components/chart/chartRegion.js')
  const KS = read('app/src/components/chart/keyboardShortcuts.js')

  const INDICATOR_LABELS = {}
  const crBody = once(CR, /export const INDICATOR_LABELS = \{([\s\S]*?)\n\}/g,
    'chartRegion.js::INDICATOR_LABELS')[1]
  for (const p of crBody.matchAll(/^\s*([A-Za-z_]+):\s*'([^']*)',/gm)) INDICATOR_LABELS[p[1]] = p[2]

  // The toolbar's fifteen hand-written rows: the id comes from the checkbox's
  // `isOn('<id>')` and the label from the `sIndicatorLabel` span in the same row.
  const TOOLBAR_ROWS = {}
  for (const p of TB.matchAll(
    /checked=\{isOn\('([A-Za-z]+)'\)\}[\s\S]{0,600}?<span className=\{styles\.sIndicatorLabel\}>([^<]*)<\/span>/g,
  )) TOOLBAR_ROWS[p[1]] = p[2]

  // The keyboard help sheet, narrowed to the rows that name an INDICATOR —
  // `toggle:ma`, `toggle:volume`, `toggle:log` and friends are not indicators.
  const SHORTCUTS = {}
  for (const p of KS.matchAll(
    /\{ keys: '([^']+)', command: 'toggle:([A-Za-z]+)', description: '([^']*)' \}/g,
  )) if (p[2] in CHART_DEFAULTS.indicators) SHORTCUTS[p[2]] = p[3]

  return {
    IND_OPTS: pairList(SC, 'IND_OPTS', 'StockChart.jsx::IND_OPTS'),
    OSC_OPTS: pairList(SC, 'OSC_OPTS', 'StockChart.jsx::OSC_OPTS'),
    TOOLBAR_OSC: pairList(TB, 'OSC', 'ChartToolbar.jsx::OSC'),
    INDICATOR_LABELS,
    TOOLBAR_ROWS,
    SHORTCUTS,
  }
}

// ⭐ GENERATED BY `parseShippedLists()` AT `d2733adc`, NOT TYPED. The case
// `the frozen A-side IS the shipped source` re-parses and compares, so this is a
// verified transcript rather than a second hand-copy. `git diff d2733adc..HEAD
// -- app/src/` touches only `enumerationSites.test.js`, so the working tree IS
// the shipped tree for all six of these regions.
const SHIPPED = {
  // ── the two right-click doors ────────────────────────────────────────────
  IND_OPTS: { rsi: 'RSI', macd: 'MACD', bb: 'Bollinger Bands', vwap: 'VWAP', stoch: 'Stochastic', atr: 'ATR', obv: 'OBV', adx: 'ADX' },
  OSC_OPTS: { rsi: 'RSI', macd: 'MACD', stoch: 'Stochastic', atr: 'ATR', mfi: 'MFI', cci: 'CCI', williamsR: 'Williams %R', adx: 'ADX', obv: 'OBV' },
  // ── the toolbar's second copy of OSC_OPTS, in another file ───────────────
  TOOLBAR_OSC: { rsi: 'RSI', macd: 'MACD', stoch: 'Stoch', atr: 'ATR', mfi: 'MFI', cci: 'CCI', williamsR: 'W%R', adx: 'ADX', obv: 'OBV' },
  // ── the region titles, and the right-click `Hide <label>` that reads them ─
  INDICATOR_LABELS: { rsi: 'RSI', macd: 'MACD', stoch: 'Stochastic', atr: 'ATR', cci: 'CCI', williamsR: 'Williams %R', mfi: 'MFI', adx: 'ADX', obv: 'OBV' },
  // ── the toolbar's fifteen hand-written rows ──────────────────────────────
  TOOLBAR_ROWS: { rsi: 'RSI', macd: 'MACD', bb: 'BB', vwap: 'VWAP', stoch: 'Stoch', atr: 'ATR', sar: 'SAR', ichimoku: 'Ichimoku', volumeProfile: 'Vol Profile', mfi: 'MFI', cci: 'CCI', williamsR: 'Williams %R', adx: 'ADX', obv: 'OBV', donchian: 'Donchian' },
  // ── the keyboard help sheet ──────────────────────────────────────────────
  SHORTCUTS: { vwap: 'Toggle session VWAP', rsi: 'Toggle RSI', macd: 'Toggle MACD', bb: 'Toggle Bollinger Bands' },
}

/** How each shipped list reads a catalog row. All six are menus, titles,
 *  compact strips or help text, so all six take the SHORT name — `longLabelFor`
 *  belongs to the library dialog and the generated settings rows, which are new
 *  surfaces, not replacements for any of these. */
const DERIVE = {
  IND_OPTS: (id) => labelFor(id),
  OSC_OPTS: (id) => labelFor(id),
  TOOLBAR_OSC: (id) => labelFor(id),
  INDICATOR_LABELS: (id) => labelFor(id),
  TOOLBAR_ROWS: (id) => labelFor(id),
  SHORTCUTS: (id) => `Toggle ${labelFor(id)}`,
}

// ⭐ THE SEVEN CELLS ADJUDICATION A7 NAMES. Every one is a label the user reads
// today changing to the label the definition already declares.
const A7_DIFF = [
  ['bb', 'IND_OPTS', 'Bollinger Bands', 'BB'],
  ['stoch', 'IND_OPTS', 'Stochastic', 'Stoch'],
  ['stoch', 'OSC_OPTS', 'Stochastic', 'Stoch'],
  ['stoch', 'INDICATOR_LABELS', 'Stochastic', 'Stoch'],
  ['williamsR', 'OSC_OPTS', 'Williams %R', '%R'],
  ['williamsR', 'INDICATOR_LABELS', 'Williams %R', '%R'],
  ['williamsR', 'TOOLBAR_OSC', 'W%R', '%R'],
]

// ⛔ AND THE THREE A7 DID NOT COUNT, BECAUSE IT SCOPED ITSELF TO FOUR OF THE SIX
// LISTS. Measured here against the shipped source, not inferred: the toolbar's
// fifteen rows and the keyboard help sheet each name indicators too, and each
// disagrees with the definitions in a cell A7's table has no row for. They are
// argued for HERE rather than discovered as a surprise in Task 4 or Task 8.
const BEYOND_A7 = [
  // Task 4 derives every help-sheet description as `Toggle ${labelFor(defId)}`,
  // which is a change a user reads in the `?` overlay. Two cells, not zero.
  ['bb', 'SHORTCUTS', 'Toggle Bollinger Bands', 'Toggle BB'],
  ['vwap', 'SHORTCUTS', 'Toggle session VWAP', 'Toggle VWAP'],
  // Task 8 RETIRES the toolbar's fifteen rows outright ("Manage indicators →"),
  // so no user watches this cell change — the row goes away and the generated
  // dialog's row, labelled `meta.name`, says `Williams %R` exactly as this one
  // does. It is listed because the catalog disagrees with the shipped string and
  // every such cell has to be named, not because it is a visible relabel.
  ['williamsR', 'TOOLBAR_ROWS', 'Williams %R', '%R'],
]

const DIFF = [...A7_DIFF, ...BEYOND_A7]

describe('the catalog covers every settings section, and nothing else', () => {
  it('has one row per definition plus one per carved-out key, in registry order', () => {
    const rows = catalogRows()
    const defIds = engineRegistry.listDefinitions().map(d => d.id)
    expect(rows.filter(r => !r.carvedOut).map(r => r.id)).toEqual(defIds)
    expect(rows.filter(r => r.carvedOut).map(r => r.id)).toEqual([...engineRegistry.CARVED_OUT_INDICATOR_KEYS])
    // …and together they are exactly the settings blob's sections. A sixteenth
    // section with neither a definition nor a carve-out row would silently lose
    // its control on every surface this catalog now feeds.
    expect([...rows.map(r => r.id)].sort()).toEqual(Object.keys(CHART_DEFAULTS.indicators).sort())
  })

  it('splits by placement target, not by a hand-written list', () => {
    expect(oscillatorIds()).toEqual(['rsi', 'macd', 'stoch', 'atr', 'mfi', 'cci', 'williamsR', 'adx', 'obv'])
    expect(priceOverlayIds()).toEqual(['bb', 'vwap', 'sar', 'ichimoku', 'donchian'])
    // Every definition is one or the other — `volume` is a target too, but no
    // NATIVE declares it (the migrator assigns it from cs.volumeOverlayIndicators).
    const both = [...oscillatorIds(), ...priceOverlayIds()].sort()
    expect(both).toEqual(engineRegistry.listDefinitions().map(d => d.id).sort())
  })

  it('…and BOTH filters are positive, which the fourteen shipped definitions cannot show', () => {
    // ⭐ MEASURED, NOT ASSUMED. Every native declares `pane` or `price`, so
    // `target === 'pane'` and `target !== 'price'` return the SAME nine ids and
    // the case above cannot tell them apart — the mutation the plan expected to
    // kill it is an equivalent mutant against this registry. `volume` is a REAL
    // third target (`instanceControls.placementFor` assigns it whenever a pane
    // oscillator is listed in `cs.volumeOverlayIndicators`), so a probe registry
    // that declares one is what makes "positive filter" a claim with a witness.
    const probe = {
      listDefinitions: () => [
        { id: 'p-pane', placement: { target: 'pane' } },
        { id: 'p-price', placement: { target: 'price' } },
        { id: 'p-volume', placement: { target: 'volume' } },
        { id: 'p-none' },
      ],
    }
    expect(oscillatorIds(probe)).toEqual(['p-pane'])
    expect(priceOverlayIds(probe)).toEqual(['p-price'])
  })
})

describe('the labels the six replaced lists showed — parsed, pinned, then diffed', () => {
  it('the frozen A-side IS the shipped source, character for character', () => {
    // ⛔ THE ONE CASE THAT MAKES EVERY OTHER CASE IN THIS BLOCK REAL. Without it
    // `SHIPPED` is a hand-copy and the whole file pins a hand-copy to a hand-copy
    // — twice-shipped on this branch already.
    expect(parseShippedLists()).toEqual(SHIPPED)
  })

  it('parsed six non-empty lists, so no loop below can pass over an empty table', () => {
    const sizes = Object.fromEntries(Object.entries(SHIPPED).map(([k, v]) => [k, Object.keys(v).length]))
    expect(sizes).toEqual({
      IND_OPTS: 8, OSC_OPTS: 9, TOOLBAR_OSC: 9, INDICATOR_LABELS: 9, TOOLBAR_ROWS: 15, SHORTCUTS: 4,
    })
    // Every list must be one this file knows how to derive, or a new list would
    // sit in SHIPPED unchecked.
    expect(Object.keys(SHIPPED).sort()).toEqual(Object.keys(DERIVE).sort())
  })

  it('reproduces every shipped label except the ten this file names', () => {
    const changed = new Set(DIFF.map(([id, list]) => `${list}::${id}`))
    const drift = []
    for (const [list, table] of Object.entries(SHIPPED)) {
      for (const [id, was] of Object.entries(table)) {
        if (changed.has(`${list}::${id}`)) continue
        const now = DERIVE[list](id)
        if (now !== was) drift.push(`${list}.${id}: shipped ${was}, derived ${now}`)
      }
    }
    expect(drift,
      'a label moved that neither adjudication A7 nor the BEYOND_A7 table signed off. ' +
      'Argue for it in one of those tables — do not update the string quietly.',
    ).toEqual([])
  })

  it('changes exactly the seven cells A7 names, to exactly the values it names', () => {
    expect(A7_DIFF.length, 'adjudication A7 names SEVEN cells').toBe(7)
    for (const [id, list, was, now] of A7_DIFF) {
      expect(DERIVE[list](id), `${list}.${id}`).toBe(now)
      expect(DERIVE[list](id), `${list}.${id} did not actually change`).not.toBe(was)
      expect(SHIPPED[list][id], `${list}.${id} was not what A7 recorded`).toBe(was)
    }
  })

  it('…and the three A7 undercounted are real changes too, not defensive padding', () => {
    for (const [id, list, was, now] of BEYOND_A7) {
      expect(DERIVE[list](id), `${list}.${id}`).toBe(now)
      expect(DERIVE[list](id), `${list}.${id} did not actually change`).not.toBe(was)
      expect(SHIPPED[list][id], `${list}.${id} is not what shipped`).toBe(was)
    }
  })

  it('the long label is meta.name, and it is what the library and the settings rows show', () => {
    expect(longLabelFor('rsi')).toBe('Relative Strength Index')
    expect(longLabelFor('stoch')).toBe('Stochastic Oscillator')
    expect(longLabelFor('vwap')).toBe('Session VWAP')
    // …and it is NOT the short one, or the two accessors are one accessor.
    expect(longLabelFor('rsi')).not.toBe(labelFor('rsi'))
  })

  it('an unknown id falls back to itself on both accessors, rather than rendering blank', () => {
    expect(labelFor('nosuchindicator')).toBe('nosuchindicator')
    expect(longLabelFor('nosuchindicator')).toBe('nosuchindicator')
  })

  it('the carved-out row carries the label its shipped toolbar row showed', () => {
    expect(CARVED_OUT_ROWS.map(r => [r.id, r.shortName])).toEqual([['volumeProfile', 'Vol Profile']])
  })
})

describe('the carved-out section keeps its row and never reaches the engine', () => {
  it('volumeProfile is in every generated list — this is the regression B3 Task 11 refused', () => {
    expect(catalogRows().map(r => r.id)).toContain('volumeProfile')
    expect(labelFor('volumeProfile')).toBe('Vol Profile')
    expect(longLabelFor('volumeProfile')).toBe('Volume Profile')
    // It is NOT a series, so it is in neither placement list — the lists that
    // feed the volume-overlay strip and the price-overlay ordering.
    expect(oscillatorIds()).not.toContain('volumeProfile')
    expect(priceOverlayIds()).not.toContain('volumeProfile')
  })

  it('carries a HAND-WRITTEN field table matching the settings section it draws from', () => {
    const row = catalogRows().find(r => r.id === 'volumeProfile')
    expect(row.fields.map(f => f.key)).toEqual(['bins', 'color', 'pocColor'])
    // …and every one of those keys really is in the blob, or the row renders a
    // control over `undefined`.
    const section = CHART_DEFAULTS.indicators.volumeProfile
    expect(row.fields.filter(f => !(f.key in section)).map(f => f.key)).toEqual([])
  })

  it('and it is the ONLY hand-written field table the catalog carries', () => {
    // ⛔ `indicatorRegistry.js` keeps the same rail for its own file
    // (`enumerationSites.test.js` → *a per-indicator field table came back*).
    // This is that rail for this file: `defSchema` is the field layer for
    // everything with a definition, so a SECOND table here would mean a second
    // source of truth for an indicator that already has one.
    expect(catalogRows().filter(r => r.fields).map(r => r.id)).toEqual(['volumeProfile'])
  })

  it('is engineOwned:false, and instanceControls refuses it BY IDENTITY', () => {
    const cs = mergeChartSettings(null)
    const row = catalogRows().find(r => r.id === 'volumeProfile')
    expect(row.engineOwned).toBe(false)
    // ⛔ There is no definition to instantiate. A row that routed here would
    // write an instance the binder drops and the canvas overlay would go dark.
    expect(setIndicatorEnabled(cs, row.id, true, engineRegistry)).toBe(cs)
    expect(setIndicatorInput(cs, row.id, 'bins', 32, engineRegistry)).toBe(cs)
    // …and the identity assertions above are not passing because NOTHING routes:
    // every other row is engine-owned and does move the blob.
    const rsi = catalogRows().find(r => r.id === 'rsi')
    expect(rsi.engineOwned).toBe(true)
    expect(rsi.fields, 'an engine-owned row derives its fields, it does not carry a table').toBeUndefined()
    expect(setIndicatorEnabled(cs, rsi.id, true, engineRegistry)).not.toBe(cs)
    expect(catalogRows().filter(r => r.engineOwned === r.carvedOut).map(r => r.id),
      'engineOwned and carvedOut must be opposites — a carved-out row that is engine-owned routes nowhere',
    ).toEqual([])
  })
})

describe('unwiredKeys — a control the legacy settings section cannot carry is greyed WITH A REASON', () => {
  it('greys ichimoku\'s three declared periods, which CHART_DEFAULTS has never carried', () => {
    const def = engineRegistry.getDefinition('ichimoku')
    expect([...unwiredKeys(def, ENGINE_FLIPPED_DEF_IDS)])
      .toEqual(['tenkanPeriod', 'kijunPeriod', 'senkouBPeriod'])
    // …and its five colours ARE in the blob, so they stay live.
    const greyed = unwiredKeys(def, ENGINE_FLIPPED_DEF_IDS)
    expect(def.inputs.map(i => i.key).filter(k => !greyed.has(k)))
      .toEqual(['tenkanColor', 'kijunColor', 'spanAColor', 'spanBColor', 'chikouColor'])
    expect(NOT_IN_BLOB).toMatch(/not wired/i)
  })

  it('leaves VWAP\'s four inputs LIVE — the control that proves the predicate is not over-wide', () => {
    const def = engineRegistry.getDefinition('vwap')
    expect(def.inputs.map(i => i.key)).toEqual(['color', 'opacity', 'lineStyle', 'lineWidth'])
    expect([...unwiredKeys(def, ENGINE_FLIPPED_DEF_IDS)]).toEqual([])
    // ⭐ AND FOR THE STRONG REASON, not the short-circuit: run it with an EMPTY
    // flip set and all four are still live, because the blob carries every one.
    expect([...unwiredKeys(def, new Set())]).toEqual([])
  })

  it('the flipped short-circuit is load-bearing, proven on one probe both ways', () => {
    // A definition whose section has no such key. `vwap` IS flipped, so its
    // hand-written block is gone and the instance is the authority — nothing to
    // grey. The same probe un-flipped is still drawn from the blob, so it is.
    const probe = { id: 'vwap', inputs: [{ key: 'notInTheBlob', type: 'int' }] }
    expect([...unwiredKeys(probe, ENGINE_FLIPPED_DEF_IDS)]).toEqual([])
    expect([...unwiredKeys(probe, new Set())]).toEqual(['notInTheBlob'])
  })

  it('is total over the registry — every definition answers, none throws', () => {
    const greyed = {}
    for (const def of engineRegistry.listDefinitions()) {
      const keys = [...unwiredKeys(def, ENGINE_FLIPPED_DEF_IDS)]
      if (keys.length) greyed[def.id] = keys
    }
    // ⭐ MEASURED, not asserted loosely: ichimoku is the ONLY definition whose
    // declared inputs outrun its settings section. A second one appearing here
    // is three more controls that write where nothing reads.
    expect(greyed).toEqual({ ichimoku: ['tenkanPeriod', 'kijunPeriod', 'senkouBPeriod'] })
  })
})

describe('the library needs a sentence per indicator, and the schema already allows one', () => {
  it('every definition declares a non-empty description and at least one tag', () => {
    const missing = engineRegistry.listDefinitions()
      .filter(d => !(typeof d.meta.description === 'string' && d.meta.description.trim().length >= 20)
                || !(Array.isArray(d.meta.tags) && d.meta.tags.length))
      .map(d => d.id)
    expect(missing,
      'the library dialog shows a one-line "what it tells you" per row (spec §6 novice layer). ' +
      'A row with no sentence renders a blank line, which is worse than no row.',
    ).toEqual([])
  })

  it('and every catalog row carries them through, carved-out included', () => {
    const thin = catalogRows().filter(r => !(r.description && r.description.length >= 20) || !r.tags.length)
    expect(thin.map(r => r.id)).toEqual([])
  })

  it('and adding them did not break registration — every definition still validates', () => {
    expect(engineRegistry.listDefinitions().length).toBe(14)
    for (const d of engineRegistry.listDefinitions()) {
      expect(d.meta.tier).toBe('free')
      expect(d.meta.repaint).toBe('non-repainting')
    }
  })
})

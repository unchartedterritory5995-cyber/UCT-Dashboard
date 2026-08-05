import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  catalogRows, labelFor, longLabelFor, oscillatorIds, priceOverlayIds,
  CARVED_OUT_ROWS, unwiredKeys, NOT_IN_BLOB,
} from './indicatorCatalog'
import { CHART_DEFAULTS, mergeChartSettings } from './chartDefaults'
import { ENGINE_OWNED } from './engine/flipState'
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
// `Set`. So `parseShippedLists()` below reads the STILL-SHIPPED lists OUT OF THE
// SHIPPED SOURCE FILES and `SHIPPED` is proven equal to that parse by its own
// test case. `SHIPPED` is written down as well as parsed for exactly one reason:
// Tasks 3, 4 and 8 DELETE these six regions, and when they do, the parse of that
// region is the thing that has to be retired — the A-side it verified survives
// as the frozen record of what shipped.
//
// ⭐ TASK 3 RAN THAT RETIREMENT ON FOUR OF THE SIX (`IND_OPTS`, `OSC_OPTS`,
// `ChartToolbar.OSC`, `chartRegion.INDICATOR_LABELS`). It was not a silent
// green: the parse THREW BY NAME with the instruction attached, and what
// replaced it (`RETIRED_BY_B4`) re-runs the same patterns and demands ZERO
// matches — a control that stops looking is a control that rots.
//
// ⭐ TASK 4 RAN IT ON A FIFTH, `SHORTCUTS`. That one did NOT throw — it went
// red on a comparison instead, because its regex still matches the help sheet's
// NON-indicator rows (`toggle:ma`, `toggle:volume`, `toggle:log`) and only the
// `in CHART_DEFAULTS.indicators` filter after it made the result a list of
// indicators. Its retirement entry therefore carries that filter too: the
// SAME regex AND the same filter, demanding zero. Only `TOOLBAR_ROWS` (Task 8)
// is still parsed live.

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

/** The KEYBOARD HELP SHEET's indicator rows, as a regex plus the filter that
 *  makes it a list of INDICATORS. Held as a pair because both halves are needed
 *  twice: `parseShippedLists` used them to pin the labels, and `RETIRED_BY_B4`
 *  now re-runs the identical pair demanding zero. The regex ALONE still matches
 *  `toggle:ma` / `toggle:volume` / `toggle:log`, which are hand-written on
 *  purpose and must stay — so a retirement check built on the regex alone would
 *  never go green and would be quietly deleted by whoever hit it. */
const SHORTCUT_ROW_RE = /\{ keys: '([^']+)', command: 'toggle:([A-Za-z]+)', description: '([^']*)' \}/g
const SHORTCUT_ROW_IS_INDICATOR = (m) => m[2] in CHART_DEFAULTS.indicators

/** The shipped lists THAT STILL EXIST, read out of the shipped source.
 *
 *  ⭐ FIVE OF THE ORIGINAL SIX ARE GONE — four retired by Task 3, the help sheet
 *  by Task 4. Task 3's four entries left this function the moment `once()` threw
 *  by name; the help sheet's left it when its parse went from four rows to zero
 *  and the comparison below went red. Neither is replaced by silence:
 *  `RETIRED_BY_B4` re-runs the SAME patterns and asserts they now match ZERO
 *  times, so "the region is gone" is checked rather than merely un-checked.
 *  `SHIPPED` keeps all six and now stands alone as the frozen record of what
 *  shipped at `d2733adc` for the retired five — which is what makes the DIFF
 *  tables below still mean something after the deletion.
 */
/** The toolbar's fifteen hand-written rows: the id came from the checkbox's
 *  `isOn('<id>')`, the label from the `sIndicatorLabel` span in the same row.
 *  ⛔ RETIRED BY B4 TASK 8 — the rows are one "Manage indicators →" launcher —
 *  so the pattern moves into `RETIRED_BY_B4` and is re-run demanding ZERO. */
const TOOLBAR_ROW_RE =
  /checked=\{isOn\('([A-Za-z]+)'\)\}[\s\S]{0,600}?<span className=\{styles\.sIndicatorLabel\}>([^<]*)<\/span>/g

/** Retired by Tasks 3 and 4, and PROVEN retired: the exact patterns
 *  `parseShippedLists` used to run, each of which must now find nothing. A
 *  control that merely stops looking is a control that rots; this one keeps
 *  looking and demands zero. The optional fourth element is the match filter the
 *  original parse applied — without it the help-sheet pattern would still find
 *  the non-indicator toggles it was never about. */
const RETIRED_BY_B4 = [
  ['StockChart.jsx::IND_OPTS', 'app/src/components/StockChart.jsx', /const\s+IND_OPTS\s*=\s*\[/g],
  ['StockChart.jsx::OSC_OPTS', 'app/src/components/StockChart.jsx', /const\s+OSC_OPTS\s*=\s*\[/g],
  // ⚠️ NAMED FOR ITS `SHIPPED` KEY, not for the identifier. The shipped constant
  // was `const OSC`; the frozen record calls it `TOOLBAR_OSC` because it was the
  // toolbar's second copy of `StockChart`'s `OSC_OPTS`. The case below pairs the
  // two lists by this name, so the two halves cannot drift apart.
  ['ChartToolbar.jsx::TOOLBAR_OSC (shipped as `const OSC`)',
    'app/src/components/chart/ChartToolbar.jsx', /const\s+OSC\s*=\s*\[/g],
  ['chartRegion.js::INDICATOR_LABELS', 'app/src/components/chart/chartRegion.js',
    /export\s+const\s+INDICATOR_LABELS\s*=\s*\{/g],
  ['keyboardShortcuts.js::SHORTCUTS (the four indicator rows)',
    'app/src/components/chart/keyboardShortcuts.js', SHORTCUT_ROW_RE, SHORTCUT_ROW_IS_INDICATOR],
  ['ChartToolbar.jsx::TOOLBAR_ROWS (the fifteen indicator rows)',
    'app/src/components/chart/ChartToolbar.jsx', TOOLBAR_ROW_RE],
]

/**
 * ⭐ THE FORMAT-INDEPENDENT HALF, BACKFILLED AT B4 TASK 6 — AND IT WAS MEASURED,
 * NOT THEORISED.
 *
 * The patterns above pin a DECLARATION, which means they pin its FORMATTING. A
 * reviewer put the full eight-entry `const IND_OPTS = [ … ]` back into
 * `StockChart.jsx` with only the spaces around `=` removed and got *"the regions
 * retired are GONE"* GREEN (rc=0) and the discovery scan GREEN (17 passed). A
 * second source of truth sat right back beside the derivation with nothing red.
 * The `\s*` above closes that exact hole; this closes the class.
 *
 * B4 Task 4 invented the treatment for its own four regions
 * (`RETIRED_BY_B4_TASK4` in `enumerationSites.test.js`, which killed a
 * behaviourally identical `KeyU` reintroduction on the MARKER alone) and did not
 * backfill it to Task 3's. This is that backfill: the retired lists carry LABEL
 * LITERALS the catalog no longer derives, and a quoted string cannot be
 * whitespace-mangled the way a declaration can. Reintroduce the list in ANY
 * formatting and its labels come with it.
 *
 * ⚠️ EACH ENTRY IS A LABEL THE CATALOG ACTIVELY DISAGREES WITH — that is what
 * makes it a second source of truth rather than a coincidence. `labelFor('bb')`
 * is `BB`, not `Bollinger Bands`; `labelFor('stoch')` is `Stoch`, not
 * `Stochastic`; `labelFor('williamsR')` is `%R`, not `Williams %R` or `W%R`.
 * Those four cells are exactly what the A7 / BEYOND_A7 tables below argue for.
 *
 * ⚠️ `OSC_OPTS` AS A BARE IDENTIFIER IS NOT USABLE HERE: `ChartToolbar.jsx`'s
 * surviving comment says "a second copy of `StockChart`'s `OSC_OPTS`", so an
 * identifier probe would find the explanation and report the deletion as a
 * regression. Quoted labels have no such twin — asserted below.
 */
const RETIRED_LABEL_LITERALS = [
  ['StockChart.jsx::IND_OPTS.bb', 'app/src/components/StockChart.jsx', "'Bollinger Bands'", 'bb'],
  ['StockChart.jsx::IND_OPTS+OSC_OPTS.stoch', 'app/src/components/StockChart.jsx', "'Stochastic'", 'stoch'],
  ['StockChart.jsx::OSC_OPTS.williamsR', 'app/src/components/StockChart.jsx', "'Williams %R'", 'williamsR'],
  ['ChartToolbar.jsx::OSC.williamsR', 'app/src/components/chart/ChartToolbar.jsx', "'W%R'", 'williamsR'],
]

// ⭐ GENERATED BY `parseShippedLists()` AT `d2733adc`, NOT TYPED. When it was
// written, `git diff d2733adc..HEAD -- app/src/` touched only
// `enumerationSites.test.js`, so the working tree WAS the shipped tree and the
// case `the frozen A-side IS the shipped source` re-parsed and compared every
// one of the six — a verified transcript, never a hand-copy.
// ⛔ FOUR OF THE SIX ARE NOW THE FROZEN RECORD ONLY (Task 3 deleted the
// regions). They stay live B-sides: the diff tables below derive against them,
// so a label moving without an argument is still a red test.
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
    // …and together they are exactly the definitions plus the carve-outs. ⭐ B5
    // TASK 9: this used to compare against `Object.keys(CHART_DEFAULTS.indicators)`
    // — the fifteen-section blob — which is ONE key now, so that comparison had
    // stopped being able to see a missing row. The blob's remaining section is
    // asserted to be exactly the carve-out set instead, which is the claim that
    // survived: a section with no definition and no carve-out row loses its
    // control on every surface this catalog feeds.
    expect([...rows.map(r => r.id)].sort())
      .toEqual([...defIds, ...engineRegistry.CARVED_OUT_INDICATOR_KEYS].sort())
    expect(Object.keys(CHART_DEFAULTS.indicators).sort())
      .toEqual([...engineRegistry.CARVED_OUT_INDICATOR_KEYS].sort())
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
  it('⭐ ALL SIX regions are retired now, and `SHIPPED` is the frozen record of what they showed', () => {
    // ⛔ WHAT THIS CASE USED TO BE, AND WHY IT COULD NOT SURVIVE ITS OWN SUBJECT.
    // It re-PARSED the still-shipped regions and compared them to `SHIPPED`, so
    // the frozen A-side was a verified transcript rather than a hand-copy — the
    // defect this branch shipped twice. Task 3 retired four of the six, Task 4 a
    // fifth, and B4 Task 8 the last one (`TOOLBAR_ROWS`). There is nothing left
    // to parse, so the parser is DELETED rather than left to return `{}`.
    //
    // ⚠️ AND THE PARSER'S "THROWS BY NAME ON ZERO MATCHES" GUARANTEE WAS FALSE
    // FOR THIS REGION, MEASURED. `TOOLBAR_ROWS` used a plain `matchAll`, so on
    // zero matches it degraded to `{}` and the comparison — not a throw — is what
    // went red. That is the same defect Task 4 found in the `SHORTCUTS` region.
    // It happened to fail loudly here; it would NOT have if the comparison had
    // been written as a subset or a length floor.
    //
    // What replaces it is `RETIRED_BY_B4`, which re-runs each region's OWN
    // pattern and demands ZERO — and this, which stops a region being dropped
    // from one side only:
    expect(RETIRED_BY_B4.map(([what]) => what.split('::')[1].split(' ')[0]).sort(),
      'a region is retired without a frozen record, or frozen without a retirement check — ' +
      'either way the DIFF tables below stop meaning anything for it',
    ).toEqual(Object.keys(SHIPPED).sort())
  })

  it('⭐ all six retired regions are GONE from the shipped source', () => {
    const survivors = RETIRED_BY_B4
      .map(([what, file, re, keep]) => {
        const hits = [...read(file).matchAll(re)]
        return [what, (keep ? hits.filter(keep) : hits).length]
      })
      .filter(([, n]) => n !== 0)
    expect(survivors,
      'a retired enumeration region is back in the shipped source. It is now derived from ' +
      '`indicatorCatalog.js`; a literal beside the derivation is a second source of truth.',
    ).toEqual([])
    // …and the scan is not vacuous: the files it reads are the real ones and the
    // derivations that replaced those regions are really there.
    expect(read('app/src/components/StockChart.jsx')).toContain('catalogRows().map((row)')
    expect(read('app/src/components/chart/ChartToolbar.jsx')).toContain('oscillatorIds().filter')
    expect(read('app/src/components/chart/keyboardShortcuts.js')).toContain('...INDICATOR_CHORDS.map(')
    // ⛔ AND THE HELP-SHEET PATTERN STILL MATCHES SOMETHING, or its zero above is
    // a broken regex rather than a retired region. The non-indicator toggles
    // (`toggle:ma`, `toggle:volume`, `toggle:log`, …) are still hand-written rows
    // in the same shape, which is exactly why the filter is part of the pair.
    const all = [...read('app/src/components/chart/keyboardShortcuts.js').matchAll(SHORTCUT_ROW_RE)]
    expect(all.length, 'the help-sheet row pattern matches nothing at all — the regex rotted')
      .toBeGreaterThanOrEqual(5)
  })

  it('⭐ …and they are gone in ANY FORMATTING — the labels, not the declaration', () => {
    const back = RETIRED_LABEL_LITERALS
      .filter(([, file, literal]) => read(file).includes(literal))
      .map(([what]) => what)
    expect(back,
      'a retired list is back in the shipped source. Its DECLARATION can be reformatted past ' +
      'the patterns above — measured: stripping the spaces around `=` in `const IND_OPTS = [` ' +
      'left both that check and the discovery scan GREEN — but its LABELS cannot. Derive them ' +
      'from `indicatorCatalog.js`; a literal beside the derivation is a second source of truth.',
    ).toEqual([])

    // ⛔ AND THE PROBE IS NOT VACUOUS IN THE OTHER DIRECTION. Each literal must
    // be one the catalog actively DISAGREES with, or its absence proves nothing:
    // a label the catalog happens to produce could reappear innocently.
    for (const [what, , literal, id] of RETIRED_LABEL_LITERALS) {
      expect(`'${labelFor(id)}'`, `${what}: the catalog now derives this very literal`).not.toBe(literal)
    }
    // …and the files really are the ones the derivation lives in.
    expect(read('app/src/components/StockChart.jsx')).toContain('catalogRows()')
    expect(read('app/src/components/chart/ChartToolbar.jsx')).toContain('labelFor(')
  })

  it('the frozen A-side is six non-empty lists, so no loop below can pass over an empty table', () => {
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
  it('⭐ NOTHING is greyed any more — ichimoku was the last one, and Task 6 flipped it', () => {
    // 🔴 INVERTED BY B5 TASK 6. This case read *"greys ichimoku's three declared
    // periods, which CHART_DEFAULTS has never carried"* — and it was right for as
    // long as `ichimoku` was un-flipped: its hand-written block called
    // `computeIchimoku(bars)` with NO arguments, so three number boxes reading
    // `undefined` and writing keys nobody read was the honest thing to grey.
    //
    // ⭐ THE FLIP IS WHAT WIRED THEM, and it did not need `activeWhen: false`.
    // `computeIchimoku(bars, tenkanPeriod, kijunPeriod, senkouBPeriod)` DOES
    // honour all three; the engine passes the INSTANCE's inputs, whose declared
    // defaults are the same 9/26/52 the no-argument call fell back to. So the
    // three become live controls that reach compute, at zero changed pixels —
    // asserted end to end in `generatedSettingsRows.test.jsx` and
    // `sarIchimokuFlipParity.test.js`.
    const def = engineRegistry.getDefinition('ichimoku')
    expect([...unwiredKeys(def, ENGINE_OWNED)]).toEqual([])
    // ⛔ THE CONTROL, AND WITHOUT IT THIS CASE IS UNFALSIFIABLE: a `unwiredKeys`
    // that returned an empty Set unconditionally would satisfy the line above
    // forever. With an EMPTY flip set — bypassing the short-circuit — the
    // predicate still answers non-empty.
    //
    // ⭐⭐ B5 TASK 9 CHANGED WHAT THAT ANSWER IS, AND STRENGTHENED IT. The
    // predicate asks "which declared inputs has the legacy blob no key for", and
    // the legacy blob HAS NO SECTIONS AT ALL any more — `CHART_DEFAULTS.indicators`
    // is `{volumeProfile}`. So for an UN-FLIPPED definition the honest answer is
    // "all of them", which is exactly right after the cutover: a definition that
    // is not flipped has no hand-written block reading a section that no longer
    // exists, so every one of its controls would write where nothing reads.
    expect([...unwiredKeys(def, new Set())]).toEqual(def.inputs.map(i => i.key))
    expect([...unwiredKeys(def, new Set())].length,
      'the predicate answers empty for an un-flipped definition — then the line above '
      + 'proves nothing').toBeGreaterThan(0)
    expect(NOT_IN_BLOB).toMatch(/not wired/i)
  })

  it('leaves VWAP\'s four inputs LIVE — the control that proves the predicate is not over-wide', () => {
    const def = engineRegistry.getDefinition('vwap')
    expect(def.inputs.map(i => i.key)).toEqual(['color', 'opacity', 'lineStyle', 'lineWidth'])
    expect([...unwiredKeys(def, ENGINE_OWNED)]).toEqual([])
    // ⭐ AND FOR THE STRONG REASON, not the short-circuit — which is now the ONLY
    // reason available, and that is itself the claim. B5 Task 9 deleted every
    // legacy section, so an un-flipped definition's controls are ALL unwired; the
    // short-circuit is what keeps a FLIPPED one's live, and it is load-bearing
    // rather than an optimisation.
    expect([...unwiredKeys(def, new Set())]).toEqual(def.inputs.map(i => i.key))
  })

  it('the flipped short-circuit is load-bearing, proven on one probe both ways', () => {
    // A definition whose section has no such key. `vwap` IS flipped, so its
    // hand-written block is gone and the instance is the authority — nothing to
    // grey. The same probe un-flipped is still drawn from the blob, so it is.
    const probe = { id: 'vwap', inputs: [{ key: 'notInTheBlob', type: 'int' }] }
    expect([...unwiredKeys(probe, ENGINE_OWNED)]).toEqual([])
    expect([...unwiredKeys(probe, new Set())]).toEqual(['notInTheBlob'])
  })

  it('is total over the registry — every definition answers, none throws', () => {
    const greyed = {}
    const greyedIfNothingFlipped = {}
    for (const def of engineRegistry.listDefinitions()) {
      const keys = [...unwiredKeys(def, ENGINE_OWNED)]
      if (keys.length) greyed[def.id] = keys
      const raw = [...unwiredKeys(def, new Set())]
      if (raw.length) greyedIfNothingFlipped[def.id] = raw
    }
    // 🔴 THE TOTALITY INVERTED AT B5 TASK 6, and the inversion is the interesting
    // half. It read `{ichimoku: [three periods]}` — ichimoku was the ONLY
    // definition whose declared inputs outran its settings section, and it is now
    // FLIPPED, so the map is empty and nothing in the app is greyed at all.
    expect(greyed).toEqual({})
    // ⛔ AND THE SAME WALK WITH AN EMPTY FLIP SET IS THE CONTROL, because an
    // `unwiredKeys` welded to `new Set()` would satisfy the line above for every
    // definition forever.
    //
    // ⭐⭐ B5 TASK 9 INVERTED THE CONTROL'S ANSWER, AND THE NEW ANSWER IS THE
    // WHOLE POINT OF THE TASK. It used to be `{ichimoku: [three periods]}` —
    // ichimoku was the ONE definition whose declared inputs outran its settings
    // section. There are no settings sections left: `CHART_DEFAULTS.indicators`
    // is `{volumeProfile}`, so an UN-FLIPPED definition has a key for nothing and
    // every one of its controls would write where nothing reads. Total, per
    // definition, derived rather than typed.
    expect(greyedIfNothingFlipped).toEqual(Object.fromEntries(
      engineRegistry.listDefinitions().map(d => [d.id, d.inputs.map(i => i.key)])))
    // …and that map is not empty, so `greyed` being `{}` above is the
    // short-circuit doing its job rather than the predicate having stopped.
    expect(Object.keys(greyedIfNothingFlipped)).toHaveLength(14)
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

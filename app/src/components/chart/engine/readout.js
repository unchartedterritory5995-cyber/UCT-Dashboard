// app/src/components/chart/engine/readout.js
//
// ─── THE CROSSHAIR LEGEND, FOR EVERY SERIES ON THE CHART ────────────────────
//
// ⛔ THE CARRY THIS CLOSED, AND WHY IT NEEDED ITS OWN GATE (B3, historical).
// `processCrosshair` used to read `rsiSeriesRef.current`. When the engine drew
// RSI that ref was null, the legend's RSI value stayed null, and the
// `RSI(14) 54.3` chip was simply absent. The pixel gate CANNOT SEE THAT: a
// headless capture has no cursor, so no chip is drawn on either side and the diff
// is 0 either way. A migration is not done when the picture matches; it is done
// when everything that reads the indicator still reads it.
//
// ⚠️ Both names in that paragraph are gone now — `rsiSeriesRef` was deleted at
// RSI's Flip B, and the nine `crosshairData.<indicator>` numeric fields at B4
// Task 10. It is kept because it is the REASON this module exists and the reason
// its gate is a DOM test rather than a pixel one, and that reason has not changed.
//
// PURE. No React, no lightweight-charts, no refs. It takes a list of entries and
// the crosshair event's `seriesData` map and returns rows.
//
// ─── THE SLOT BRIDGE IS GONE, AND WHAT REPLACED IT IS NOT WHAT WAS PLANNED ──
//
// 🔴 THIS HEADER USED TO SAY `LEGACY_SLOTS` WAS "deleted at B4, when the legend
// renders `engineChips()` directly". **THAT PLAN WOULD HAVE DELETED SIX CHIPS FOR
// EVERY USER.** Nine chips ship, and at B4 only three of them (RSI's line and
// MACD's line and signal) belonged to a FLIPPED definition, so only three came
// out of `engineChips`. The other six belonged to definitions that were NOT
// migrated, were drawn by hand-written legacy blocks, and had no bindings at all.
//
// ⭐ B5 TASK 5 MOVED THREE OF THOSE SIX ONTO THE ENGINE — Stochastic's %K and %D,
// and ATR — by MIGRATING their definitions, which is a change of SOURCE and not
// of text: the chips come off the same `plots[].legend` blocks, through this same
// pipeline, character for character.
//
// ⭐⭐ AND B5 TASK 6 MOVED THE LAST THREE — SAR, and Ichimoku's tenkan and kijun.
// **THE LEGACY LANE IS EMPTY, AND ITS MACHINERY IS DELETED**: `StockChart`'s
// `legacyChipEntriesRef`, `registerLegacyChip`, `csIndicatorsRef` and
// `LEGACY_CHIP_ORDER` have no callers and are gone. Every one of the nine chips
// now comes from `engineChips`, and the rendered text did not change by one
// character at either step — which is why the LANE is asserted separately and
// why **no pixel gate could ever have seen any of this** (a headless capture has
// no cursor).
//
// ⚠️ `chipsFrom`'S SECOND-SOURCE SHAPE STAYS, AND IT IS NOT VESTIGIAL. It takes
// an entry LIST and an `inputsFor` resolver rather than reading bindings itself,
// so `engineChips` is one caller of it and the next is Phase C's server lane —
// the same series-source-and-inputs seam, with the values arriving over the wire.
// Deleting the parameter would be deleting the reason the function was extracted.
//
// ⚠️ THE SURVIVORS ARE NAMED IN PROSE, NOT AS `<id>::<plotKey>` PAIRS, AND THE
// REASON HAS CHANGED — 🔴 THIS PARAGRAPH USED TO SAY THE DISCOVERY SCAN "does not
// strip comments", WHICH HAS BEEN FALSE SINCE B4 TASK 10 FIXED IT. It reads
// `stripComments(src)` now (`enumerationSites.test.js` → *"the scan reads CODE,
// not prose"*, whose own fixture is this file's old paragraph), so prose cannot
// flag a module however many ids it names. What survives is the HABIT and its
// reason: a comment that enumerates ids is the shape a reader mistakes for a
// list, and it is the shape the scan was once fooled by — so the words stay
// words. A premise that quietly stopped being true is exactly what this branch
// keeps finding, so it is corrected here rather than left to read as live.
//
// ⛔ AND "MIGRATE THOSE THREE THEN" WAS THE WRONG TURN FOR B4, AND IS THE RIGHT
// ONE FOR B5 — the difference is a decision, not an opinion. B4 shipped ZERO
// migrations because `docs/decisions/2026-08-03-engine-enabled-settings-migration.md`
// was OPEN and a migrated-but-un-flipped definition would have been engine-drawn
// for NOBODY. B5 Task 4 RESOLVED that record by deleting `engineEnabled`, and B5
// migrates and flips in ONE commit, so the intermediate state the objection was
// about is never created. `FLIPPED === MIGRATED` is still asserted both ways.
//
// THE ADJUDICATED DESIGN (A3), and it needed no migration at all: `engineChips`
// already turned *(series, definition, instance inputs)* into *(label, colour,
// decimals, text)*, and only the SERIES SOURCE was engine-specific. So the
// formatting half is extracted into `chipsFrom(entries, …)` and fed a SECOND
// series source — `StockChart`'s `legacyChipEntriesRef`, keyed `<defId>::<plotKey>`
// and registered at the legacy `addSeries` sites that were fated B5. One
// formatting pipeline, two lanes, and all six legacy chips were declared on their
// own definitions' `plots[].legend` instead of hand-written in the legend.
//
// ⭐ WHICH IS WHY B5'S MIGRATIONS COST THE LEGEND NOTHING. A definition that
// gains an engine binding starts producing its chip through `engineChips`, off
// the SAME declaration the legacy lane was already reading — so a flip retired
// its `registerLegacyChip` calls and changed not one character of the readout,
// six times over, until there were none left to retire.
// That is the property, and it is asserted rather than assumed: the nine chips
// are compared character for character at every flip, and the LANE each one comes
// from is a SEPARATE assertion, because a chip drawn twice is invisible in text.

// (`LEGACY_SLOTS`, `chipsBySlot` and the per-chip `slot` field were deleted here
//  by B4 Task 10 — the legend renders `crosshairData.chips` directly and there is
//  no `crosshairData.<indicator>` field left for a slot to name.)

// ⭐ THE ONE IMPORT THIS MODULE TAKES, AND IT KEEPS THE PURITY CLAIM INTACT.
// `semanticName` is a pure read of definition metadata over resolved inputs —
// no React, no LWC, no DOM, and crucially NO SOURCE GRAMMAR, which is the thing
// `sourceStemOf` below refuses to import and says why. See its header for why one
// naming rule is shared and the other is deliberately spelled twice.
import { formatCompact } from '../../../lib/presentation/presentationPrimitives'
import { untruncatedLabel } from './labelText'
import { semanticName, namesItselfSemantically } from './semanticName'
import { formatFundamentalValue, fundamentalFormatOfInstance } from './fundamentalFormat'
import { tfLabel } from '../timeframes'
import { safeCssColour } from './objectColour'
// ⭐ THE SECOND PURE IMPORT, AND IT KEEPS THE PURITY CLAIM TOO. `readoutSchema`
// resolves a definition's `readout[]` over scalars handed to it — no registry,
// no serverCompute, no DOM. The scalars themselves arrive through `opts.scalarsOf`
// (see `stampReadout`), so this module still imports no server lane.
import { readoutRows, readoutChipRows } from './readoutSchema'
import { paneTableFor } from './paneTable'
import { endLabelChipModel } from './endLabel'
import { inputsAsRead } from './legacyInputs'
import { identityTextFor } from './defSchema'

/** LWC's own default when a plot declares no `legend.decimals`. Two, because
 *  that is `seriesOptionsDefaults.priceFormat.precision` and a chip with no
 *  declared opinion should agree with the axis it sits above. */
const DEFAULT_DECIMALS = 2

function resolveRegistry(registry) {
  if (typeof registry === 'function') return registry
  if (registry && typeof registry.getDefinition === 'function') return (id) => registry.getDefinition(id)
  return () => null
}

/** The chip's leading text: an explicit label, or shortName + declared params
 *  resolved against THIS instance's inputs (falling back to the definition's
 *  declared defaults, which is what "unset means current default" means
 *  everywhere else in the engine). */
/** The chip's leading text: an explicit label, or shortName + declared params
 *  resolved against THIS instance's inputs (falling back to the definition's
 *  declared defaults, which is what "unset means current default" means
 *  everywhere else in the engine). */
/**
 * `sym:QQQ:close` → `QQQ`, for a definition that declares `meta.labelFrom`.
 *
 * ⛔ PARSED HERE RATHER THAN IMPORTED, and the duplication is deliberate and
 * one line long. This module's header is *"pure, no LWC, no DOM"* and it is the
 * formatting pipeline the LEGACY lane shares; pulling in `sourceRef` would drag
 * the whole source grammar — `parseSource`, the gravestone rules, the instance
 * resolver — into a function that needs the characters between two colons.
 * `symbolSource()` builds exactly `sym:<SYMBOL>:<field>` and `canonicalSymbol`
 * refuses a symbol containing `:`, so the middle segment IS the symbol.
 *
 * ⚠️ ANYTHING ELSE ANSWERS `null` and the ordinary stem applies — a bar field
 * (`close`) and an instance source (`@inst:rsi:1::rsi`) both have names that are
 * somebody else's to give.
 */
function sourceStemOf(def, inputs) {
  const declared = (def.inputs || []).find((i) => i && i.type === 'source')
  if (!declared) return null
  const raw = (inputs && inputs[declared.key] !== undefined) ? inputs[declared.key] : declared.default
  if (typeof raw !== 'string') return null
  // ⭐ An ECONOMIC series is named by its registry symbol (`econ:USCPI` -> USCPI).
  if (raw.startsWith('econ:')) {
    const s = raw.slice(5)
    return s && !s.includes(':') ? s : null
  }
  if (!raw.startsWith('sym:')) return null
  const parts = raw.split(':')
  return parts.length === 3 && parts[1] ? parts[1] : null
}

/**
 * ⭐⭐ ONE PLACE A CHIP'S VALUE BECOMES TEXT (2026-09-16).
 *
 * ⚰️ THE DEFECT THAT MADE IT NECESSARY: Dollar Volume's pane printed
 * `Dollar Volume 4609414802`. Ten digits in a readout nobody can parse at a
 * glance, over a chart whose own axis reads `4.61B` two inches to the right.
 *
 * ⛔ AND THE ANSWER IS A DECLARATION, NOT A SPECIAL CASE. `plots[].legend.compact`
 * says "this output is a MAGNITUDE — print it the way an axis would". The
 * definition knows that about itself; the legend cannot infer it from the number,
 * because 4,609,414,802 and 4609.41 are the same shape to a formatter.
 *
 * ⛔ AND IT IS NOT A CURRENCY FORMATTER. A `$` belongs to what the series IS, and
 * that is what its LABEL says (`$ Vol`); putting one here would print `$` in front
 * of a share count the day something else declares `compact`.
 *
 * ⚠️ `decimals` STILL GOVERNS THE ORDINARY PATH and is untouched for every plot
 * that declares no `compact` — which is all of them but one.
 */
// TERM-066: the ladder this grammar already had, passed to the one formatter.
const COMPACT_VALUE_TIERS = Object.freeze([
  Object.freeze({ at: 1e12, suffix: 'T', decimals: 2 }),
  Object.freeze({ at: 1e9, suffix: 'B', decimals: 2 }),
  Object.freeze({ at: 1e6, suffix: 'M', decimals: 1 }),
  Object.freeze({ at: 1e3, suffix: 'K', decimals: 1 }),
])
function compactValue(v) {
  const n = Math.abs(v)
  if (n >= 1e3) return formatCompact(v, { tiers: COMPACT_VALUE_TIERS })
  return `${Math.round(v)}`
}

/** A chip's VALUE as text — the one answer every legend surface reads.
 *
 *  ⛔ EXPORTED SO THERE IS EXACTLY ONE. Four surfaces used to write
 *  `value.toFixed(decimals)` themselves (the strip's chip, the price stack, each
 *  pane's readout, the volume pane's), which is four places for a format to drift
 *  and four places a new `legend` field has to be remembered in. */
export function chipValueText(chip) {
  if (!chip) return ''
  // ⭐ UCT RS split, F3 (2026-11-10) — A PLOT THAT DECLARED `legend.showValue:
  // false` PRINTS NO NUMBER ANYWHERE (`chipsFrom` stamps `valueHidden`): the chip
  // names the line (`UCT RS · SPY · 82`) and the number stays on the series. The
  // declaration wins over a resolved `valueText` too, because the volume strip's
  // copy would otherwise print what the definition asked to withhold.
  if (chip.valueHidden === true) return ''
  // ⭐⭐ A TEXT THE PANE ALREADY RESOLVED WINS OVER RE-DERIVING ONE.
  //
  // ⚰️ MEASURED ON PRODUCTION, 2026-09-16: `SMA 50` over the volume pane read
  // `17.2M` in the legend row and `17189110.14` in the header of its own popover
  // — one plot, one crosshair, two numbers. The units decision (`derivedTargetOf`
  // says this guest is averaging VOLUME, so it reads on volume's ladder) was being
  // applied where the ROW was built, and the menu was handed the raw chip and
  // formatted it a second time from scratch.
  //
  // ⛔ SO THE RESOLUTION TRAVELS ON THE CHIP. A surface that knows something this
  // module cannot — which pane a guest derived its way into — states the answer
  // once and every reader downstream prints THAT. Without this the fix would have
  // to be repeated at each call site, which is the drift this function exists to
  // end.
  if (typeof chip.valueText === 'string') return chip.valueText
  if (chip.value == null || !Number.isFinite(chip.value)) return ''
  // ⭐ A historical fundamental reads in its catalogue unit (`$365.0B`, `24.3%`),
  // formatted from the VALUE each time -- so a crosshair move re-reads correctly.
  if (typeof chip.format === 'string' && chip.format) {
    const text = formatFundamentalValue(chip.value, chip.format)
    // ⭐ An ECONOMIC value names the period it DESCRIBES (`334.13 · Aug 2026`) --
    // the bar it sits on is its RELEASE, not its period, and a reader must not
    // have to guess which.
    return typeof chip.observation === 'string' && chip.observation ? `${text} · ${chip.observation}` : text
  }
  if (chip.compact === true) return compactValue(chip.value)
  return chip.value.toFixed(Number.isInteger(chip.decimals) ? chip.decimals : DEFAULT_DECIMALS)
}

/** The name a PANE STRIP should print for an instance: its compact identity when
 *  the catalogue gave it one, else its full name.
 *
 *  ⭐ ONE READER, THREE CALL SITES. `chipsFrom`, the source-picker branch and the
 *  hidden-instance branch all name the same instance, and before this they each
 *  reached for `display.name` by hand — which is how a fourth would have drifted.
 *  ⛔ FULL IS THE FALLBACK, NEVER THE UNIVERSE: an instance stored before the
 *  compact name existed has only `name`, and that is a complete answer. */
const legendName = (inst) => {
  const d = inst && inst.display
  if (!d) return null
  return (typeof d.compact === 'string' && d.compact) ? d.compact
    : ((typeof d.name === 'string' && d.name) ? d.name : null)
}

function chipLabel(def, plot, inputs, displayName) {
  if (plot.legend && typeof plot.legend.label === 'string') return plot.legend.label
  // ⭐⭐ `meta.labelFrom: 'source'` — THE ONE DEFINITION WHOSE NAME IS NOT ITS OWN.
  // `dataSeries` plots whatever it is pointed at, so every instance of it would
  // print the same chip: a member with QQQ, SPY and UCTA50 on screen would read
  // "Series" three times. The stem comes from the SOURCE instead.
  //
  // ⚠️ SPELLED HERE AS WELL AS IN `sourceRef.instanceLabel` BECAUSE THERE ARE TWO
  // NAMING SURFACES AND THEY ARE NOT THE SAME FUNCTION — measured in a browser on
  // the originating branch: fixing `instanceLabel` alone left the pane legend
  // reading "Series 714.88" over a QQQ line. `instanceLabel` names an INSTANCE in
  // the source picker; this names a PLOT in the chip strip and the pane readout.
  // They agree by reading the same declaration rather than by one calling the
  // other — this module is pure and imports no source grammar.
  if (def.meta && def.meta.labelFrom === 'source') {
    // ⭐ A STORED DISPLAY NAME FIRST. An instance added through a catalogue door
    // carries one; one created any other way names itself from its source.
    //
    // ⭐⭐ AND THE **COMPACT** ONE WINS HERE, BECAUSE THIS IS THE PANE STRIP. The
    // caller hands the instance's compact identity when it has one — `US: Net H-L`
    // rather than the full `Net New 52-Week Highs-Lows · US`, which would push the
    // value off a legend row. A security has no compact/full distinction (both are
    // the ticker), so nothing else changes. ⛔ THE UNIVERSE ALONE IS NOT A NAME:
    // see `discoveryCatalog.semanticNamesFor` for what this replaced.
    if (typeof displayName === 'string' && displayName) return displayName
    const fromSource = sourceStemOf(def, inputs)
    if (fromSource) return fromSource
  }
  // ⭐⭐ `meta.nameFrom` — THE DEFINITION NAMES ITSELF FROM THE MEMBER'S OWN
  // CHOICE. A Moving Average is `EMA 9`, never `MA (9)` and never `Moving
  // Average #1`. Unlike `labelFrom: 'source'` directly above, this rule needs no
  // source grammar at all — it is definition metadata over resolved inputs — so it
  // is spelled ONCE in `engine/semanticName.js` and both naming surfaces call that
  // reader instead of agreeing by hand. See that module's header.
  const semantic = semanticName(def, inputs)
  if (semantic) return semantic
  // ⭐ SLICE 2 — a user definition's `shortName` is the builder's 12-character
  // chip CUT of its name; the strip shows the whole name (CSS ellipsis + the full
  // name in the chip's title do any truncating, visually). Natives are untouched.
  const name = untruncatedLabel(def, (def.meta && def.meta.shortName) || def.id)
  const params = (def.meta && def.meta.legendParams) || []
  if (!params.length) return name
  const declared = new Map((def.inputs || []).map(i => [i.key, i.default]))
  // 3-14: an option that is only a door to a text box prints the typed text (`UCT RS(XLK)`), never its code.
  const values = params.map(k => identityTextFor(def, k, (inputs && inputs[k] !== undefined ? inputs[k] : declared.get(k)), inputs))
  return `${name}(${values.join(', ')})`
}

// ─── THE PANE SUFFIX: WHAT THE LONG NAME IS MEASURED AGAINST (2026-11-06) ────
//
// ⚰️ MEASURED ON A REAL SCREENSHOT: the RS pane read `UCT Relative Strength
// 0.2477` with no benchmark anywhere on the chart. The chip label carries it —
// `chipLabel` prints `name(params)` from `meta.legendParams`, so the strip reads
// `UCT RS(SPY)` — but `paneReadoutLabel` prints `meta.name` + `chip.suffix` and
// deliberately drops the parameter list (`Relative Strength Index`, never
// `Relative Strength Index(14)`). A period is a SETTING and belongs in the
// settings dialog; a benchmark is WHAT THE LINE IS, and a pane that does not say
// it is a line a member cannot read.
//
// ⛔ THE RULE IS BY DECLARED INPUT TYPE, NOT BY DEFINITION. A `legendParams`
// entry whose input is a NAMED choice (`enum`, `string`) is identity and reads
// ` · <value>` after the long name, the grammar §31 already uses for a named
// source (`EMA 20 · QQQ`); a number (`int`, `float`) is a setting and stays out,
// which is what keeps every existing pane label byte-identical. A `source`
// input is excluded on purpose — its value is an address, and this module never
// prints one (see `siblingSuffixes`).
//
// ⭐ AND THE SERVER'S RESOLVED READING WINS OVER THE MEMBER'S REQUEST. When the
// caller hands a `opts.scalarsOf` reader and the definition's `readout[]` has a
// chip row keyed like the legend param (`key: 'benchmark'` reading
// `scalar:benchmark.resolved`), that row's text REPLACES the input value in the
// suffix — `· XLK` for a member who asked for `SECTOR`. Until the payload lands
// the input value stands, which is honest: that is what was asked for.
//
// ⛔ `chip.label` AND `chip.text` ARE NEVER TOUCHED HERE. The `name(params)`
// grammar is pinned byte-for-byte by three rails; this writes `chip.suffix`
// (the field `paneReadoutLabel` already prints) and `chip.readout` only.
const IDENTITY_INPUT_TYPES = new Set(['enum', 'string'])

// ─── AN OPTION THAT IS ONLY A DOOR TO A TEXT BOX (unit 3-09b, 2026-11-07) ───
//
// ⚰️ MEASURED: with "Your symbol" picked, the chip read `UCT RS · CUSTOM` until
// the server's resolved benchmark row replaced it. `CUSTOM` is the enum's CODE
// for "the member typed one"; it names nothing a member chose.
//
// ⭐ THE RULE IS DECLARED, NOT SPELLED HERE. A `string` input that declares
// `identityFor: '<enum key>'` and `activeWhen: {key: <enum key>, equals: <option>}`
// is that option's companion (`defSchema.validateIdentityFor` refuses a half
// pair). When the enum holds that option, its identity text is the companion's
// typed value, or the option's LABEL while the box is empty — never the code.
// Every other value, and every definition with no companion, reads exactly as
// before. The server's resolved row still replaces it in `stampReadout`.
// The pair's reader is `defSchema.identityTextFor`, shared with `sourceRef.instanceLabel`.
function identityTextOf(inp, raw, def, inputs) {
  return identityTextFor(def, inp.key, raw, inputs)
}

/** `legendParams` whose input is a named choice, resolved for THIS instance:
 *  `Map(key → value)`, declaration order. Empty for every numeric parameter. */
function legendIdentityParts(def, inputs) {
  const parts = new Map()
  const params = def && def.meta && Array.isArray(def.meta.legendParams) ? def.meta.legendParams : []
  if (!params.length) return parts
  const declared = new Map((def.inputs || [])
    .filter((i) => i && typeof i.key === 'string').map((i) => [i.key, i]))
  for (const k of params) {
    const inp = declared.get(k)
    if (!inp || !IDENTITY_INPUT_TYPES.has(inp.type)) continue
    const raw = (inputs && inputs[k] !== undefined) ? inputs[k] : inp.default
    if (typeof raw === 'string' && raw) parts.set(k, identityTextOf(inp, raw, def, inputs))
  }
  return parts
}

/**
 * Stamp a chip's pane suffix and, when a reader is present, its readout rows.
 *
 *   chip.suffix  = identity parts (` · SPY`) + the sibling suffix the
 *                  disambiguator may already have set (` (maLength 50)`) + the
 *                  remaining chip-flagged readout rows (` · 94`). Written only
 *                  when it is non-empty or a reader was given, so a chip with
 *                  nothing to say is byte-identical to before.
 *   chip.readout = every resolved readout row (`readoutSchema.readoutRows`),
 *                  `[]` when the definition declares none or the reader answers
 *                  nothing. Present only when a reader was given.
 *
 * ⛔ THE READER IS CALLED WITH THE INPUTS AS THE COMPUTE READS THEM (declared
 * defaults under the stored values — `resolvedInputsOf`), because that is what
 * `computeFor` keyed the server fetch with (`resolveInputs`); handing it the raw
 * stored object would miss the cache for every untouched instance.
 *
 * ⛔ NEVER THROWS. This runs on the rAF flush; a reader that throws is "no
 * scalars", exactly as a `lastValue` thunk that throws is "no fallback".
 */
function stampReadout(chip, def, inputs, opts) {
  if (!chip || !def) return chip
  const reader = (opts && typeof opts.scalarsOf === 'function') ? opts.scalarsOf : null
  const identity = legendIdentityParts(def, inputs)
  let rows = null
  // ⭐ DESIGN ROUND (2026-11-08) — the pane table (`meta.paneTable`), resolved from
  // the SAME scalars read the rows are, so the corner table and the Rating card
  // can never print two different numbers for one rank.
  let table = null
  const wantsTable = !!(def.meta && def.meta.paneTable)
  // ⭐ UCT RS split, U2 — the plot's line-end tag (`plots[].endLabel`), resolved from
  // the SAME scalars for the same reason as the table: the tag at the line's end
  // and the Rating card can never print two different ratings.
  const plot = (Array.isArray(def.plots) ? def.plots : []).find((p) => p && p.key === chip.plotKey) || null
  const endSpec = plot && plot.endLabel && typeof plot.endLabel === 'object' ? plot.endLabel : null
  let endLabel = null
  if (reader) {
    rows = []
    if ((Array.isArray(def.readout) && def.readout.length) || wantsTable || endSpec) {
      let scalars = null
      try { scalars = reader(def, resolvedInputsOf(def, inputs)) } catch { scalars = null }
      // A plain object or nothing: an array, a string or a number is not a
      // payload, and "nothing landed" prints no rows — not even a fallback.
      if (scalars && typeof scalars === 'object' && !Array.isArray(scalars)) {
        if (Array.isArray(def.readout) && def.readout.length) rows = readoutRows(def, scalars, { inputs })
        if (wantsTable) table = paneTableFor(def, scalars, { inputs })
        if (endSpec) endLabel = endLabelChipModel(endSpec, scalars, def, inputs)
      }
    }
  }
  const extra = []
  if (rows && rows.length) {
    for (const r of readoutChipRows(def, rows)) {
      if (identity.has(r.key)) identity.set(r.key, r.text)
      // ⭐ VA2 — a row's `chipPrefix` word rides the pane label only (`fast 91`).
      else extra.push(typeof r.chipText === 'string' && r.chipText ? r.chipText : r.text)
    }
  }
  const lead = [...identity.values()].map((v) => ` · ${v}`).join('')
  const sibling = typeof chip.suffix === 'string' ? chip.suffix : ''
  const tail = extra.map((t) => ` · ${t}`).join('')
  const suffix = `${lead}${sibling}${tail}`
  if (rows) chip.readout = rows
  if (suffix || rows) chip.suffix = suffix
  // Present only when the definition declares a table AND it resolves, so every
  // other chip keeps exactly the fields it had.
  if (table) chip.paneTable = table
  if (endLabel) chip.endLabel = endLabel
  return chip
}

/** A plot's colour for THIS instance. Mirrors `pool.resolvePlotForInstance`
 *  without importing it, because that module carries the LWC option vocabulary
 *  and the legend needs one field. */
function resolvePlotColor(plot, inputs, def) {
  // ⛔ THE CHIP WRITES THIS INTO CSS. A stored definition, a shared one, or a shared
  // layout's instance input may carry any string here — only `safeCssColour` values
  // leave (objectColour.js); anything else wears no colour.
  const refKey = plot.$refs && plot.$refs.color
  if (refKey) {
    if (inputs && inputs[refKey] !== undefined) return safeCssColour(inputs[refKey])
    const declared = (def.inputs || []).find(i => i && i.key === refKey)
    if (declared && declared.default !== undefined) return safeCssColour(declared.default)
  }
  return safeCssColour(plot.color)
}

/**
 * One chip per *(series, plot-that-declares-a-`legend`)*.
 *
 * THE ONE FORMATTING PIPELINE spec §6 asks for: a chip's label, its precision and
 * its colour all come out of `plots[].legend` + `meta.legendParams` + the
 * instance's own inputs, for the engine lane and the legacy lane alike.
 *
 * @param {object[]} entries `[{defId, plotKey, series, lastValue, instanceId}]`.
 *        The engine lane maps its BINDINGS in (`engineChips` below). ⚠️ It is the
 *        only caller in the tree as of B5 Task 6 — the legacy lane that was the
 *        second one is deleted — and the parameter stays because a second SOURCE
 *        with its own inputs is the seam Phase C's server lane needs. A plot with
 *        NO `legend` block emits nothing, which is how the un-declared plots stay
 *        chip-less — Ichimoku's `spanA`/`spanB`/`chikou`, every `hlines` guide,
 *        `adx`'s two directional lines and Donchian's two edges.
 *        ⚠️ THIS SENTENCE USED TO END *"…and the eight definitions with no chip
 *        at all"*, and the count was WRONG IN BOTH DIRECTIONS IN TURN: it was
 *        TEN when it said eight (`bb`, `vwap`, `mfi`, `cci`, `williamsR`, `adx`,
 *        `obv`, `donchian`, `avwap`, `atrBands`), and Task 2 (`43efeff6`) made it
 *        ZERO — every definition that binds a data plot now declares at least one
 *        chip, a totality gated by `__tests__/legendFromDefinitions.test.jsx`.
 *        The chip-less things left are PLOTS, not definitions, which is why they
 *        are now named rather than counted.
 * @param {Map} seriesData `crosshairMove` param's `seriesData` map.
 * @param {object|Function} registry
 * @param {Function} inputsFor `(defId, instanceId) => inputs`. The INSTANCE's own
 *        inputs for the engine lane; it was `cs.indicators[defId]` for the legacy
 *        lane, which had no instances. ⛔ Reading `cs.indicators[defId]` for BOTH
 *        would have been wrong the moment a second instance of one definition
 *        exists: two RSI lines at different periods would print the same number
 *        twice. That is the reason this is a PARAMETER and not a lookup inside.
 * @param {Function} [displayFor] `(defId, instanceId) => string|null`, the stored
 *        display name of the instance (a `labelFrom: 'source'` definition), and
 *        (3-09b) the sibling suffix when every copy in a colliding group has a
 *        distinct one (`UCT RS(SPY) · Line A`).
 * @param {object[]} [instances] the normalised instance list, for the sibling
 *        disambiguator's source words.
 * @param {{scalarsOf?: (def: object, inputs: object) => (object|null)}} [opts]
 *        Phase 2a: a reader for the scalars a server-lane envelope carried
 *        beside its columns (the caller binds `serverCompute.scalarsFor` to its
 *        ctx). Absent — every existing caller — the chips are byte-identical to
 *        before; present, each chip gains `readout` and `suffix`. See
 *        `stampReadout`.
 * @returns {{defId,plotKey,instanceId,label,color,decimals,value,text}[]} in the
 *        order the entries were given.
 */
/** The crosshair's bar time, from any row in `seriesData` (the candles always
 *  have one on a real bar). `undefined` when nothing is hovered. */
function hoveredTimeOf(seriesData) {
  if (!seriesData || typeof seriesData.values !== 'function') return undefined
  for (const d of seriesData.values()) {
    if (d && d.time !== undefined) return d.time
  }
  return undefined
}

export function chipsFrom(entries, seriesData, registry, inputsFor, displayFor, instances, opts) {
  const get = resolveRegistry(registry)
  const out = []
  // Kept BESIDE the chips rather than on them: a consumer that enumerates a
  // chip's keys must not start seeing a resolved-inputs blob it never had.
  const inputsByChip = new Map()
  // ⭐ 3-09b — and the instance's stored display name, beside them for the same
  // reason: the sibling pass prefers it as the suffix (`disambiguateSiblings`).
  const displayByChip = new Map()
  // The hovered bar's time, read off whichever series has a row there -- only a
  // gap-breaking binding (`valueAt`, `gapRuns.js`) asks for it.
  const hoveredTime = hoveredTimeOf(seriesData)

  for (const e of (Array.isArray(entries) ? entries : [])) {
    if (!e || !e.series) continue
    const def = get(e.defId)
    if (!def) continue
    const plot = (def.plots || []).find(p => p && p.key === e.plotKey)
    // No `legend` block at all ⇒ no chip. Emitting an undeclared chip here would
    // put a second, differently-formatted line into the readout for any plot
    // whose author never asked for one.
    if (!plot || !plot.legend || plot.legend.hide === true) continue

    const point = seriesData && typeof seriesData.get === 'function' ? seriesData.get(e.series) : null
    // ── THE DEVELOPING-BAR FALLBACK ──────────────────────────────────────────
    //
    // Legacy: `d?.value ?? (indicatorData.rsi.at(-1)?.value ?? null)`. The hovered
    // bar not carrying a point for this series is the NORMAL live case, not an
    // edge one: the bars push feed's writer B appends the developing candle
    // imperatively, so on an intraday chart the newest bar is on the candles and
    // not yet on the indicator until the next SWR refresh. Legacy printed the
    // last computed value there; a chip that printed NOTHING is a readout
    // regression no pixel gate can see — it only happens under a live tape.
    //
    // ⚠️ TWO SHAPES, ON PURPOSE. The engine lane hands a NUMBER —
    // `binding.lastValue`, the binder's own record of the final point it set on
    // this series, which is the same number `.at(-1)` reads. The legacy lane
    // hands a THUNK, because its entry is registered when the series is created
    // and the last computed value moves under it on every SWR refresh. A thunk
    // that throws is treated as "no fallback": this runs on the rAF flush, and a
    // throw here would take the whole legend down mid-hover.
    let value = point ? point.value : undefined
    // ⛔⛔ A FUNDAMENTAL LINE IS DRAWN AS SEVERAL RENDER SERIES (one per valid run,
    // `gapRuns.js`), so the primary has no row on an EARLIER run and the
    // developing-bar fallback below would print TODAY's value there -- and on a
    // canonical GAP it would print the last known value where the value is
    // unknown. The binding answers for its own bars instead: a number on a run,
    // NaN on a gap (the chip is dropped and the legend row shows no value), and
    // `undefined` only for a bar it has no row for, which keeps the fallback.
    if (typeof e.valueAt === 'function' && hoveredTime !== undefined) {
      const v = e.valueAt(hoveredTime)
      if (v !== undefined) {
        if (!Number.isFinite(v)) continue
        value = v
      }
    }
    if (!Number.isFinite(value)) {
      const fb = e.lastValue
      if (typeof fb === 'function') { try { value = fb() } catch { value = undefined } }
      else value = fb
    }
    if (!Number.isFinite(value)) continue

    const inputs = (typeof inputsFor === 'function' ? inputsFor(e.defId, e.instanceId) : null) || {}
    // The colour a chip wears is the colour the LINE wears, so it is resolved the
    // same way the binder resolves it — through this lane's own inputs, never the
    // definition default alone.
    const resolved = resolvePlotColor(plot, inputs, def)
    const decimals = Number.isInteger(plot.legend.decimals) ? plot.legend.decimals : DEFAULT_DECIMALS
    // ⭐ THE DECLARATION TRAVELS WITH THE CHIP — see `chipValueText`.
    const compact = plot.legend.compact === true
    // ⭐ F3 — and so does `showValue: false` (`valueHidden`): the chip keeps its
    // `value` (the line-end tag and the info-value reader still read the number),
    // and every surface that prints through `chipValueText` prints nothing.
    const valueHidden = plot.legend.showValue === false
    // ⭐ By INSTANCE, so an MA of a fundamental reads in the fundamental's unit.
    const format = fundamentalFormatOfInstance(
      (Array.isArray(instances) ? instances : []).find((i) => i && i.instanceId === e.instanceId) || { inputs },
      get, instances)
    // ⭐ 2026-09-28 — A SERIES CALCULATED ON ANOTHER TIMEFRAME SAYS SO, QUIETLY:
    // `SMA 200 · 1D`. Only a binding the binder computed in a HIGHER frame carries
    // `frame` (a chart-frame series has none), so an ordinary indicator's chip is
    // byte-identical to before.
    const frameSuffix = typeof e.frame === 'string' && e.frame ? ` · ${tfLabel(e.frame)}` : ''
    const displayName = typeof displayFor === 'function' ? displayFor(e.defId, e.instanceId) : null
    const label = chipLabel(def, plot, inputs, displayName) + frameSuffix
    // The observation period of the value under the crosshair (economic only).
    let observation = ''
    if (typeof e.observationAt === 'function' && hoveredTime !== undefined) {
      const o = e.observationAt(hoveredTime)
      if (typeof o === 'string') observation = o
    }

    out.push({
      defId: def.id,
      plotKey: plot.key,
      instanceId: e.instanceId || null,
      label,
      color: resolved,
      decimals,
      compact,
      ...(format ? { format } : {}),
      ...(observation ? { observation } : {}),
      ...(valueHidden ? { valueHidden: true } : {}),
      value,
      text: valueHidden ? label : `${label} ${chipValueText({ value, decimals, compact, format, observation })}`,
      ...(frameSuffix ? { frameSuffix } : {}),
    })
    inputsByChip.set(out.length - 1, inputs)
    if (typeof displayName === 'string' && displayName.trim()) displayByChip.set(out.length - 1, displayName.trim())
  }
  const chips = disambiguateSiblings(out, inputsByChip, registry, instances, displayByChip)
  // ⭐ AFTER the sibling pass, so the pane suffix composes with — never
  // overwrites — the ` (maLength 50)` a second copy earned. Label untouched.
  chips.forEach((c, i) => stampReadout(c, get(c.defId), inputsByChip.get(i), opts))
  return chips
}

/**
 * The suffix that tells a group of siblings apart — one per sibling, in the order
 * given: the inputs that DIFFER across the group (`" (fastPeriod 5)"`), or an
 * ordinal (`" #2"`) when nothing does.
 *
 * ⭐ EXPORTED BECAUSE THE LEGEND IS NO LONGER THE ONLY SURFACE THAT HAS TO NAME
 * TWO COPIES OF ONE INDICATOR. The chart's indicator-pane context menu builds one
 * `<label> settings…` row per live instance (two copies of a definition share ONE
 * pane, so that menu is the only door once the legend collapses to compact), and
 * it takes the suffix from HERE rather than from a rendered chip label — one
 * grammar, two surfaces, and no string-stripping of a formatted label to recover
 * a suffix that was computed in the first place.
 *
 * ⛔ WHETHER THE GROUP IS AMBIGUOUS AT ALL IS THE CALLER'S QUESTION, NOT THIS
 * FUNCTION'S. `disambiguateSiblings` below asks *"do these chips' labels
 * collide?"* and skips a group that already reads apart (`RSI(14)` vs `RSI(7)`);
 * the menu's rows all wear the same catalog noun, so for it the answer is always
 * yes. Folding that test in here would give one of the two callers the wrong
 * answer.
 *
 * ⭐ `ignoreKeys` IS AN INPUT THE LABEL ALREADY SPELLS OUT. A definition that
 * names itself from an input (`meta.labelFrom`) already prints that input's
 * meaning, so appending it reads `QQQ (source sym:QQQ:close)` — the address
 * restated as a discriminator on two rows that were never ambiguous. Excluding
 * it falls through to the ordinal, which is thin but true.
 *
 * ⛔ OPTIONAL, AND ABSENT MEANS SKIP NOTHING. Every existing caller passes one
 * argument and gets exactly the result it got before.
 *
 * ─── ⛔⛔ AND A RAW REF IS NEVER, EVER PRINTED (2026-09-16) ──────────────────
 *
 * ⚰️ THE DEFAULT `k v` GRAMMAR IS RIGHT FOR A NUMBER AND A CATASTROPHE FOR A
 * SOURCE. Two moving averages that differ only in what they average — one on the
 * candles, one on a QQQ series — collided on `EMA 20`, and the suffix that told
 * them apart read:
 *
 *     EMA 20 (source @inst:dataSeries:1::value)
 *
 * That is the engine's own address for a column, printed in a legend, in a
 * settings row and in a destination menu. It is unreadable, it is untypeable, and
 * it is exactly what the owner's §4 forbids.
 *
 * ⭐ SO A SOURCE IS DESCRIBED, NOT SPELLED. `opts.describe(key, value)` answers:
 *
 *     a string   — the member-facing phrase for that value (`QQQ`, `Volume`,
 *                  `RSI (14)`). Rendered as ` · QQQ`, which is how the owner's
 *                  §31 words it: *EMA 20 · QQQ*.
 *     `null`     — this value HAS no member-facing name here. The key is DROPPED
 *                  from the suffix entirely; if that leaves nothing, the ordinal
 *                  stands. Thin, but never a lie and never an address.
 *     `undefined`— an ordinary input; the `k v` grammar, unchanged.
 *
 * ⛔ AND `null` POISONS THE WHOLE KEY, not just the one row. A group where one
 * sibling's source can be named and another's cannot would otherwise print the
 * named half and silently omit the other — two rows reading `EMA 20 · QQQ` and
 * `EMA 20`, the second one claiming to be the plain-price average it is not.
 *
 * @param {object[]} inputsList one resolved-inputs object per sibling, in order
 * @param {string[]} [ignoreKeys] inputs the label already spells out
 * @param {{describe?: (key: string, value: *) => (string|null|undefined)}} [opts]
 * @returns {string[]} one suffix per sibling, same order, each already spaced
 */
/**
 * ⭐ 2026-10-01 — an instance's inputs AS THE COMPUTE READS THEM: every declared
 * default, overlaid with what the instance actually stored (`resolveInputs`'
 * rule). The sibling disambiguators compare THESE, never the raw stored object:
 * a legacy instance that never wrote a key (a fast Stochastic has no `smoothK`
 * and no colours) would otherwise print `kColor undefined` beside a new one, and
 * hide the one difference that matters (`smoothK 1` vs `smoothK 3`).
 */
export function resolvedInputsOf(def, inputs) {
  const out = {}
  for (const inp of ((def && Array.isArray(def.inputs)) ? def.inputs : [])) {
    if (inp && typeof inp.key === 'string' && inp.default !== undefined) out[inp.key] = inp.default
  }
  // ⭐ 3-08b: the legacy → successor read (`legacyInputs.inputsAsRead`), the
  // same one `resolveInputs` applies, so the two never key a fetch differently.
  const stored = inputsAsRead(def, inputs)
  for (const [k, v] of Object.entries(stored && typeof stored === 'object' ? stored : {})) {
    if (v !== undefined) out[k] = v
  }
  return out
}

export function siblingSuffixes(inputsList, ignoreKeys, opts) {
  const rows = (Array.isArray(inputsList) ? inputsList : [])
    .map(o => (o && typeof o === 'object' ? o : {}))
  const skip = new Set(Array.isArray(ignoreKeys) ? ignoreKeys : [])
  const describe = (opts && typeof opts.describe === 'function') ? opts.describe : null
  const keys = [...new Set(rows.flatMap(o => Object.keys(o)))].filter(k => !skip.has(k)).sort()
  const differing = keys.filter((k) => {
    const seen = new Set(rows.map(o => JSON.stringify(o[k])))
    return seen.size > 1
  })

  // ⭐ ONE PASS THAT CLASSIFIES EACH DIFFERING KEY ONCE, for the whole group, so
  // every sibling's suffix is built from the same decision. Without `describe`
  // every key is `plain` and this function is byte-for-byte what it always was.
  const phrases = new Map()   // key → phrase per row index
  const named = []
  const plain = []
  for (const k of differing) {
    if (!describe) { plain.push(k); continue }
    const per = rows.map((o) => describe(k, o[k]))
    if (per.every((d) => d === undefined)) { plain.push(k); continue }
    if (per.some((d) => d === null || d === undefined)) continue   // dropped — see the header
    phrases.set(k, per)
    named.push(k)
  }

  // Identical siblings draw on top of each other; an ordinal is thin but it is
  // not a lie, and it beats two rows claiming to be the same thing.
  return rows.map((inputs, n) => {
    const parts = []
    if (plain.length) parts.push(` (${plain.map(k => `${k} ${inputs[k]}`).join(', ')})`)
    for (const k of named) parts.push(` · ${phrases.get(k)[n]}`)
    return parts.length ? parts.join('') : ` #${n + 1}`
  })
}

/**
 * A SOURCE input's value as a member-facing phrase — `QQQ`, `Volume`, `RSI (14)`
 * — or `null` when this module cannot honestly name it.
 *
 * ⛔ PARSED HERE RATHER THAN IMPORTED, for the reason `sourceStemOf` above already
 * records at length: this module is the PURE formatting pipeline and pulling in
 * `sourceRef` would drag the whole source grammar into it. The three shapes are
 * `defSchema.SOURCE_BAR_FIELDS`, `sym:<SYMBOL>:<field>` and
 * `'@' + instanceId + '::' + plotKey` — all three are fixed by writers that
 * build them from those exact pieces.
 *
 * ⭐ AN INSTANCE SOURCE IS NAMED BY ITS INSTANCE, THROUGH `chipLabel` — the same
 * function that names it in the legend. So `MA(RSI)` reads `· RSI (14)`, the words
 * a member can find on their own chart, rather than `@inst:rsi:1::rsi`.
 *
 * ⚠️ AND `null` WHEN THE INSTANCE IS NOT IN THE LIST. A caller with no instances
 * (the legend's own chip pass takes none today) gets `null` for every instance
 * source, which drops the key and falls through to the ordinal — never an address.
 */
const BAR_FIELD_WORDS = Object.freeze({
  open: 'Open', high: 'High', low: 'Low', close: 'Close',
  hl2: 'HL2', hlc3: 'HLC3', ohlc4: 'OHLC4', volume: 'Volume',
})
/** ⭐ EXPORTED FOR THE INSPECTOR'S `SOURCE` LINE. `chartDataMap.paneRowMeta` has
 *  to print the same human words this already puts in a legend suffix — `Close`,
 *  `QQQ`, `RSI (14)` — and a second translator would be the one place a member
 *  reads `@inst:rsi:1::rsi`. Nothing about its behaviour changed. */
export function describeSourceValue(value, get, byId) {
  if (typeof value !== 'string' || !value) return null
  if (BAR_FIELD_WORDS[value]) return BAR_FIELD_WORDS[value]
  if (value.startsWith('sym:')) {
    const parts = value.split(':')
    return parts.length === 3 && parts[1] ? parts[1] : null
  }
  if (value.startsWith('@')) {
    const at = value.indexOf('::')
    const id = at > 1 ? value.slice(1, at) : ''
    const inst = (id && byId) ? byId.get(id) : null
    const def = (inst && typeof get === 'function') ? get(inst.defId) : null
    if (!def) return null
    const plot = (def.plots || []).find((p) => p && p.legend && p.legend.hide !== true)
    if (!plot) return null
    return chipLabel(def, plot, (inst.inputs && typeof inst.inputs === 'object') ? inst.inputs : null,
      legendName(inst))
  }
  return null
}

/**
 * The `describe` a disambiguator hands `siblingSuffixes` — source inputs become
 * phrases, everything else keeps the `k v` grammar.
 *
 * ⛔ IT IS BUILT FROM THE DEFINITION'S OWN DECLARATION (`type: 'source'`), never
 * from a key name or a value that happens to look like a ref. A user formula whose
 * `period` input somehow held the string `sym:...` is still a period.
 */
function sourceDescriber(def, get, instances) {
  const sourceKeys = new Set((def && Array.isArray(def.inputs) ? def.inputs : [])
    .filter((i) => i && i.type === 'source').map((i) => i.key))
  if (!sourceKeys.size) return null
  const byId = new Map((Array.isArray(instances) ? instances : [])
    .filter((i) => i && typeof i.instanceId === 'string' && i.deleted !== true)
    .map((i) => [i.instanceId, i]))
  return (key, value) => (sourceKeys.has(key) ? describeSourceValue(value, get, byId) : undefined)
}

/**
 * Suffix the chips of a plot that has MORE THAN ONE instance on the chart, so a
 * member can tell their two copies apart.
 *
 * ⚰️ MEASURED ON PRODUCTION 2026-08-14: "+ Add another" on MACD produced four
 * legend chips reading `MACD`, `SIG`, `MACD`, `SIG`, every one titled
 * `MACD — right-click for options`, with nothing on any surface saying which was
 * 12/26/9 and which was 15/26/9. Running one indicator at two settings is the
 * entire point of the feature.
 *
 * ⛔ THE SUFFIX NAMES WHAT ACTUALLY DIFFERS, NOT `meta.legendParams`. MACD
 * declares no `legendParams` on purpose (`nativeRegistry.js:345` — `SIG` is not
 * "MACD", and `shortName` cannot express two labels), so a disambiguator built on
 * that field would do nothing for the definition that surfaced this. Comparing
 * the siblings' resolved inputs works for every definition, user formulas
 * included, and naming only the keys that differ keeps `slow`/`signal` out of the
 * chip when only `fast` was changed.
 *
 * ⛔ AND A LONE CHIP IS RETURNED UNTOUCHED, BYTE FOR BYTE — the suffix appears
 * only when a second instance of the same plot is genuinely on the chart. That is
 * what keeps this out of the existing chart assertions, which are written against
 * single-instance legends.
 */
// ─── ⭐ 3-09b · A NAME THE MEMBER (OR A DRILL) GAVE BEATS AN INPUT NAME ──────
//
// ⚰️ Two RS lines in a Study drill, set apart only by their Mansfield length,
// read `UCT RS(SPY) (mansfieldLength 200)`: an input KEY in a member's legend.
// The drill had already named them (`display: {name: 'Line A'}`), and that name
// is what the lesson's words say. So when EVERY instance in a colliding group
// carries a display name and the names are DISTINCT, the suffix is
// ` · <name>` (`UCT RS(SPY) · Line A`). Any instance unnamed, or two sharing a
// name, and the input-diff suffix stands, byte for byte.
function namedSiblingSuffixes(chips, idxs, displayByChip) {
  if (!(displayByChip instanceof Map)) return null
  const byInstance = new Map()
  for (const i of idxs) {
    const name = displayByChip.get(i)
    if (typeof name !== 'string' || !name) return null
    const id = chips[i].instanceId
    if (byInstance.has(id) && byInstance.get(id) !== name) return null
    byInstance.set(id, name)
  }
  if (new Set(byInstance.values()).size !== byInstance.size) return null
  return idxs.map((i) => ` · ${displayByChip.get(i)}`)
}

function disambiguateSiblings(chips, inputsByChip, registry, instances, displayByChip) {
  // ⛔⛔ THE LABEL IS PART OF THE GROUP KEY, AND THAT IS WHAT MAKES A MIXED GROUP
  // BEHAVE. Grouping on `defId::plotKey` alone was the same sentence while every
  // definition named itself from its own metadata: either every chip in a group
  // collided (MACD, whose plots carry explicit `legend.label`s) or none did
  // (`RSI(14)` vs `RSI(7)`), and the guard below covered the second case. A
  // definition that names itself from its SOURCE breaks that: QQQ, SPY, UCTA50
  // and a second QQQ are ONE defId and plotKey with three distinct names, so the
  // old key suffixed all four — `SPY #2` for a name nothing collided with.
  // Keying by label puts only the two QQQs together, which is the grouping
  // `disambiguateLabels` already uses, so the two naming surfaces agree.
  const groups = new Map()
  for (let i = 0; i < chips.length; i++) {
    const k = `${chips[i].defId}::${chips[i].plotKey}::${chips[i].label}`
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(i)
  }

  for (const idxs of groups.values()) {
    // One chip, or several rows for the SAME instance, is not an ambiguity.
    const distinct = new Set(idxs.map(i => chips[i].instanceId))
    if (idxs.length < 2 || distinct.size < 2) continue

    // ⛔ AND NEITHER IS A DEFINITION THAT ALREADY TELLS THEM APART. RSI declares
    // `legendParams: ['period']`, so two copies already print `RSI(14)` and
    // `RSI(7)`; suffixing those would read `RSI(14) (period 14)`. Only a group
    // whose labels COLLIDE needs help, which is exactly the MACD case — its plots
    // carry explicit `legend.label`s that short-circuit `legendParams` entirely.
    if (new Set(idxs.map(i => chips[i].label)).size === idxs.length) continue

    // The suffix grammar lives in `siblingSuffixes` above — CALLED here, so the
    // legend and the pane menu cannot word two copies of one indicator differently.
    //
    // ⛔⛔ THE LABEL-BEARING INPUT IS NOT A DISCRIMINATOR. A definition that names
    // itself from an input (`meta.labelFrom: 'source'`) already PRINTS that
    // input's meaning, so appending it reads `QQQ (source sym:QQQ:close)` — the
    // canonical address restated as a suffix on rows whose labels already differ.
    // Excluding it falls through to the ordinal, which is thin but true. Same
    // rule as `disambiguateLabels`, spelled from the same declaration so the two
    // naming surfaces cannot word a duplicate differently.
    const def0 = registry && typeof registry.getDefinition === 'function'
      ? registry.getDefinition(chips[idxs[0]].defId) : null
    const ignore = (def0 && def0.meta && def0.meta.labelFrom === 'source')
      ? (def0.inputs || []).filter(i => i && i.type === 'source').map(i => i.key)
      : []
    // ⭐ A SOURCE IS DESCRIBED, NEVER SPELLED — see `siblingSuffixes`' header.
    // ⚠️ THE CHIP PASS CARRIES NO INSTANCE LIST, so an instance source resolves to
    // `null` here and the group falls through to the ordinal. That is the correct
    // failure: thin, and never `@inst:dataSeries:1::value` in a member's legend.
    const describe = sourceDescriber(def0, (id) => (registry && typeof registry.getDefinition === 'function'
      ? registry.getDefinition(id) : null), instances)
    const suffixes = namedSiblingSuffixes(chips, idxs, displayByChip)
      || siblingSuffixes(idxs.map(i => resolvedInputsOf(def0, inputsByChip.get(i))), ignore,
        describe ? { describe } : undefined)

    idxs.forEach((chipIdx, n) => {
      const label = `${chips[chipIdx].label}${suffixes[n]}`
      // ⭐ THE SUFFIX IS KEPT AS A FIELD, not only baked into the label. The pane
      // readout prints a LONGER name than the strip does (`paneReadoutLabel`), and
      // it has to be able to tell two copies apart with the same words the legend
      // uses — re-deriving the suffix from a rendered label would be the second
      // place this grammar is spelled.
      chips[chipIdx].suffix = suffixes[n]
      chips[chipIdx].label = label
      // F3: a `showValue: false` chip's text is its label alone (no trailing space).
      chips[chipIdx].text = chips[chipIdx].valueHidden === true ? label : `${label} ${chipValueText(chips[chipIdx])}`
    })
  }
  return chips
}

/**
 * The legend chips for the series the ENGINE currently holds — a thin caller of
 * `chipsFrom` that maps bindings to entries and resolves inputs per INSTANCE.
 *
 * Its exported signature is unchanged, so every existing caller and case is
 * unaffected by the extraction.
 *
 * @param {object[]} bindings  `binder.bindings()` — each carries `lastValue`
 * @param {Map}      seriesData `crosshairMove` param's `seriesData` map
 * @param {object|Function} registry
 * @param {object[]} instances the normalised instance list (for per-instance inputs)
 * @param {object} [opts] passed through to `chipsFrom` (`opts.scalarsOf`)
 */
export function engineChips(bindings, seriesData, registry, instances, opts) {
  const byId = new Map((Array.isArray(instances) ? instances : [])
    .filter(i => i && typeof i.instanceId === 'string')
    .map(i => [i.instanceId, i]))
  const entries = (Array.isArray(bindings) ? bindings : [])
    .filter(b => b && b.series)
    .map(b => ({ defId: b.defId, plotKey: b.plotKey, series: b.series, lastValue: b.lastValue, instanceId: b.instanceId,
      ...(typeof b.valueAt === 'function' ? { valueAt: b.valueAt } : {}),
      ...(typeof b.frame === 'string' && b.frame ? { frame: b.frame } : {}),
      ...(typeof b.observationAt === 'function' ? { observationAt: b.observationAt } : {}) }))
  // ⛔ PER INSTANCE, NEVER PER DEFINITION. `cs.indicators[defId]` is the LEGACY
  // lane's answer and is simply wrong here: two instances of one definition are
  // two different periods and two different colours on one chart.
  const inputsFor = (_defId, instanceId) => {
    const inst = byId.get(instanceId)
    return (inst && inst.inputs) || null
  }
  // ⭐ THE STORED DISPLAY NAME, BY INSTANCE — the same per-instance read
  // `inputsFor` makes, for the same reason: two copies of one definition can
  // carry two names, and `cs.indicators[defId]` cannot express that.
  const displayFor = (_defId, instanceId) => legendName(byId.get(instanceId))
  return chipsFrom(entries, seriesData, registry, inputsFor, displayFor, instances, opts)
}

/**
 * The chips the LEGEND renders — one per *(live instance, chip-declaring plot)*.
 *
 * ⭐ IT IS NOT `engineChips`, AND THE DIFFERENCE IS THE HIDDEN INSTANCE.
 * `engineChips` walks BINDINGS, and `pool.planBindings` drops a hidden instance
 * (`pool.js`, the `inst.hidden === true` continue) so the binder can call
 * `removeSeries` and give the pane back (`__tests__/hiddenIsRemovedNotParked.test.js`).
 * That is right for the RENDERER and wrong for the READOUT: with no chip there is
 * no surface to un-hide from, and "Hide" becomes a one-way door reachable only
 * from the settings modal.
 *
 * So this walks the INSTANCE LIST and looks the formatted chip up per instance.
 * A bound, visible instance keeps the chip `engineChips` produced for it — value
 * and all; a hidden one gets `value: null`, `hidden: true` and the label alone.
 *
 * ⛔ ONE FORMATTING PIPELINE, AND THIS DID NOT ADD A SECOND ONE. The valued half
 * is `engineChips(…)` → `chipsFrom(…)`, called, not re-implemented — the same
 * function `IndicatorSettingsDialog`'s read-only Style-tab precision row reads
 * through. The label-only half cannot go through it (a chip with no series and no
 * value is exactly what `chipsFrom` is defined to emit NOTHING for), so it uses
 * the same two module-internal helpers `chipsFrom` uses — `chipLabel` and
 * `resolvePlotColor` — and the same `DEFAULT_DECIMALS`. Nothing here formats a
 * number a second way; a label-only chip formats no number at all.
 *
 * ⚠️ `hidden` IS TESTED BEFORE THE LOOKUP, NOT AFTER. Taking whatever binding
 * happened to be there would make the contract *"a hidden chip carries no value"*
 * an accident of `planBindings` dropping it, one refactor away from a hidden
 * indicator printing a live number it is not drawing.
 *
 * @param {object[]} bindings `binder.bindings()`
 * @param {Map|null} seriesData `crosshairMove`'s map, or null when off-cursor
 * @param {object|Function} registry
 * @param {object[]} instances the normalised instance list, in stack order
 * @param {object} [opts] passed through to `engineChips` (`opts.scalarsOf`); a
 *        hidden instance's label-only chip is stamped the same way, so it keeps
 *        its pane suffix without a value.
 * @returns {{defId,plotKey,instanceId,label,color,decimals,value,hidden,text}[]}
 */
export function legendChips(bindings, seriesData, registry, instances, opts) {
  const get = resolveRegistry(registry)
  const formatted = new Map()
  for (const c of engineChips(bindings, seriesData, registry, instances, opts)) {
    formatted.set(`${c.instanceId}::${c.plotKey}`, c)
  }

  // ⛔⛔ THE "DID IT DRAW" SIGNAL IS THE BINDINGS, NOT THE FORMATTED CHIPS, AND
  // THE FIRST DRAFT GOT THAT WRONG. `engineChips` returns NOTHING when
  // `seriesData` is null — the ordinary off-cursor case — so deriving "computed
  // nothing" from a missing formatted chip would have marked EVERY indicator on
  // every chart nobody happens to be hovering. `IndicatorChip.empty.test.jsx`
  // asserts the two cases side by side, which is the only reason it was caught.
  // A binding exists exactly when `planBindings` gave the plot a series, which is
  // exactly when its column held a finite value.
  const drawn = new Set()
  for (const b of (Array.isArray(bindings) ? bindings : [])) {
    if (b && typeof b.instanceId === 'string' && typeof b.plotKey === 'string') {
      drawn.add(`${b.instanceId}::${b.plotKey}`)
    }
  }

  const out = []
  for (const inst of (Array.isArray(instances) ? instances : [])) {
    // ⭐ 2026-10-01 — chips are collected per instance so a `plots[].sparse` plot's
    // VALUELESS chip can be omitted (a bare "Down" beside an up-trending
    // SuperTrend says nothing). At least one chip per instance always survives,
    // so a hidden instance still has its chip to be shown from.
    const start = out.length
    pushInstanceChips(inst)
    const mine = out.splice(start)
    const kept = mine.filter((c) => !(c.sparse === true && c.value == null))
    out.push(...(kept.length ? kept : mine.slice(0, 1)).map((c) => { const o = { ...c }; delete o.sparse; return o }))
  }
  return out

  function pushInstanceChips(inst) {
    if (!inst || typeof inst !== 'object' || typeof inst.instanceId !== 'string') return
    // A tombstone has no defId by design; asking the registry about it would
    // only ever produce a misleading null.
    if (inst.deleted === true) return
    // ⛔ HIDDEN BY THE TIMEFRAME IS NOT HIDDEN BY THE MEMBER, AND IT GETS NO CHIP.
    // A greyed chip is a "click to show" offer; showing it for an indicator the
    // member set to "Daily only" while they look at a 5m chart would offer a click
    // that cannot work here and leave a legend ghost on every excluded timeframe.
    // `eligibility.eligibleInstances` stamps `hiddenBy` on the render copy only.
    if (typeof inst.hiddenBy === 'string') return
    const def = get(inst.defId)
    if (!def) return
    const instHidden = inst.hidden === true
    const inputs = (inst.inputs && typeof inst.inputs === 'object') ? inst.inputs : {}

    for (const plot of (def.plots || [])) {
      if (!plot || !plot.legend || plot.legend.hide === true) continue
      // ⛔⛔ A PLOT-LEVEL `hidden` IS HIDDEN TOO, and reading only the INSTANCE's
      // flag was a real member-visible bug.
      // ⚰️ MEASURED on the live chart the day C1-A shipped: a conditional colour
      // rides as a HIDDEN condition column, `planBindings` correctly gives a
      // hidden plot no series, and this loop then found no binding for it and
      // stamped its chip `data-computed="false"` — "no value on these bars",
      // with a tooltip telling the member to try a longer timeframe. Every
      // dynamically-coloured import showed one, for a column that is working
      // exactly as designed and was never meant to draw.
      // The two flags mean the same thing to a reader — "nobody looked" — so
      // they answer the same way (see the `computed` note below).
      const isHidden = instHidden || plot.hidden === true
      const bound = isHidden ? null : formatted.get(`${inst.instanceId}::${plot.key}`)
      const sparse = plot.sparse === true
      if (bound) { out.push({ ...bound, hidden: false, computed: true, sparse }); continue }
      // ⛔ THE SECOND NAMING SURFACE, AND IT MUST READ THE SAME DECLARATION.
      // This walks the INSTANCE LIST so a hidden instance still has a chip to
      // un-hide from, and it formats its own label — so a `labelFrom` definition
      // fixed only in `chipsFrom` would still print "Series" for a hidden QQQ.
      const label = chipLabel(def, plot, inputs, legendName(inst))
      // ⭐ The pane suffix (and, with a reader, the readout rows) ride on the
      // label-only chip too — a hidden RS pane still says which benchmark it is.
      out.push(stampReadout({
        defId: def.id,
        plotKey: plot.key,
        instanceId: inst.instanceId,
        label,
        color: resolvePlotColor(plot, inputs, def),
        decimals: Number.isInteger(plot.legend.decimals) ? plot.legend.decimals : DEFAULT_DECIMALS,
        compact: plot.legend.compact === true,
        value: null,
        hidden: isHidden,
        // ⭐⭐ DID THIS PLOT COMPUTE ANYTHING? MEASURED, A VISIBLE INDICATOR THAT
        // COMPUTED NOTHING AND A VISIBLE ONE WITH THE CURSOR OFF THE CHART
        // PRODUCED BYTE-IDENTICAL CHIPS — same label, same `value: null`, same
        // `hidden: false`. `pool.js`'s pane-existence test (trap #4) drops a
        // series whose column holds no finite value, so an all-NaN indicator draws
        // no line and takes no pane, and the legend said exactly what it says when
        // you simply are not hovering. A member cannot tell "this computed
        // nothing" from "move your cursor", and the far commoner cause is the
        // second one — so the honest reading of the ambiguity is the wrong one.
        //
        // ⛔ THE KEY IS ABSENT FOR A HIDDEN PLOT RATHER THAN `true`, because
        // nobody looked: `binder.js` skips a hidden instance before it computes
        // (`if (inst.hidden === true) continue`). Absent is "not asked"; `false`
        // would claim a measurement that never ran, which is the distinction this
        // module already keeps for `value`.
        ...(isHidden ? {} : { computed: drawn.has(`${inst.instanceId}::${plot.key}`) }),
        text: label,
        sparse,
      }, def, inputs, opts))
    }
  }
}

// ─── PART E · TELLING TWO COPIES OF ONE DEFINITION APART ─────────────
//
// ⭐ ONE PURE FUNCTION, ADDED WITHOUT DISTURBING ANYTHING ABOVE. `displayTarget`
// imports it so a "Display in" menu can tell two instances of one definition
// apart. The originating branch also rewrote `chipsFrom` here; that rewrite is
// existing master behaviour with its own rails and is NOT taken.

/**
 * ⭐⭐ THE ONE DISAMBIGUATOR, FOR EVERY SURFACE THAT NAMES INSTANCES.
 *
 * The legend calls it through `disambiguateSiblings` above; the "Display in"
 * destination menu calls it directly (`displayTarget.displayTargetOptions`). One
 * implementation is the only way those two can be guaranteed to word a member's
 * two copies of QQQ the same, and a member reading `QQQ #2` in the menu has to
 * find `QQQ #2` on the chart or the menu is pointing at nothing they can see.
 *
 * ⛔⛔ THE GROUP IS THE COLLIDING **LABEL**, NOT THE DEFINITION.
 *
 * ⚰️ MEASURED 2026-09-12 with QQQ, a second QQQ and SPY on one chart. Grouping by
 * `defId::plotKey` put all three `dataSeries` rows in one group, the "do these
 * already read apart?" guard saw 2 distinct labels against 3 rows and correctly
 * declined to skip — and then suffixed the whole group, so SPY printed as
 * `SPY #3`. An ordinal on a row that was never ambiguous is worse than no ordinal:
 * it implies a `SPY #1` and `SPY #2` that do not exist.
 *
 * Scoping the group to the label makes the old guard unnecessary rather than
 * merely correct — a group of one is skipped, and a group of two or more has
 * identical labels by construction. `RSI(14)` and `RSI(7)` land in different
 * groups and keep their own names; two `MACD` chips land together and get the
 * suffix that names what differs.
 *
 * ⛔ AND `siblingSuffixes` ITSELF IS UNTOUCHED, deliberately: the pane context
 * menu is a third caller whose rows all wear the same catalog noun, so for it the
 * group is always ambiguous. Whether a group NEEDS suffixing is the caller's
 * question — which is exactly what that function's header already says.
 *
 * ⭐ `opts.instances` IS WHAT LETS THIS SURFACE SAY `EMA 20 · RSI (14)` WHERE THE
 * LEGEND CAN ONLY SAY `EMA 20 #2`. A source that names another INSTANCE can be
 * turned into words only by somebody holding the instance list; the settings rows
 * and the destination menu both do, the crosshair chip pass does not, and neither
 * of them ever prints the raw ref. See `siblingSuffixes`.
 *
 * @param {{defId: string, plotKey?: string, instanceId?: string, label: string,
 *          inputs?: object}[]} rows
 * @param {Function} [get] definition lookup, for the label-bearing-input rule
 * @param {{instances?: object[]}} [opts] the chart's instances, for naming an
 *   instance-valued source in words
 * @returns {string[]} one label per row, in order — unchanged where unambiguous
 */
export function disambiguateLabels(rows, get, opts) {
  const list = Array.isArray(rows) ? rows : []
  const out = list.map((r) => (r && typeof r.label === 'string' ? r.label : ''))
  const groups = new Map()
  list.forEach((r, i) => {
    if (!r) return
    const k = `${r.defId}::${r.plotKey === undefined ? '' : r.plotKey}::${out[i]}`
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(i)
  })

  for (const idxs of groups.values()) {
    // One row, or several rows for the SAME instance, is not an ambiguity —
    // MACD's `macd` and `signal` chips are one indicator wearing two names.
    const distinct = new Set(idxs.map((i) => list[i].instanceId))
    if (idxs.length < 2 || distinct.size < 2) continue

    // ⛔ THE LABEL-BEARING INPUT IS NOT A DISCRIMINATOR. A definition that names
    // itself from an input (`meta.labelFrom`) already prints that input's meaning;
    // appending it reads `QQQ (source sym:QQQ:close)`. See `siblingSuffixes`.
    const def0 = typeof get === 'function' ? get(list[idxs[0]].defId) : null
    const ignore = (def0 && def0.meta && def0.meta.labelFrom === 'source')
      ? (def0.inputs || []).filter((i) => i && i.type === 'source').map((i) => i.key)
      : []
    // ⭐ A SOURCE IS DESCRIBED, NEVER SPELLED — `EMA 20 · QQQ`, not
    // `EMA 20 (source sym:QQQ:close)`. See `siblingSuffixes`' header.
    const describe = sourceDescriber(def0, get, opts && opts.instances)
    // ⭐ 2026-10-01 — siblings are compared on their RESOLVED inputs (a declared
    // default filled in for a key the stored instance never wrote), the reading
    // `resolveInputs` gives the compute. A legacy fast Stochastic stores no
    // `smoothK` or colours; compared raw, two Stochastics read
    // `(dColor #4ECDC4, kColor #FF6B6B, smoothK 3)` beside `(… undefined …)`.
    // Resolved, they read `(smoothK 3)` and `(smoothK 1)` — the real difference.
    const resolvedOf = (row) => resolvedInputsOf(typeof get === 'function' ? get(row.defId) : null, row.inputs)
    const suffixes = siblingSuffixes(idxs.map((i) => resolvedOf(list[i])), ignore,
      describe ? { describe } : undefined)
    idxs.forEach((rowIdx, n) => { out[rowIdx] = `${out[rowIdx]}${suffixes[n]}` })
  }
  return out
}

/**
 * The name a PANE's own readout prints — the long one.
 *
 * ⭐⭐ THE LEGEND STRIP AND THE PANE READOUT ANSWER DIFFERENT QUESTIONS, and the
 * owner's ask is exactly that: *"when in their own pane show the full name of the
 * indicator… but in the legend keep all of them abbreviated"*. The strip is a
 * dense row where nine names share one line, so `RSI(14)` is right there. A pane
 * readout sits alone over a rectangle with nothing else in it and acres of room,
 * and `UCTU20W` over a chart of green bars tells a member nothing they did not
 * already have to know.
 *
 * ⛔ IT DERIVES, IT DOES NOT SPELL. Every string here comes from the same
 * declaration the rest of the product reads — `meta.name` is what the catalogue
 * lists, what `About …` titles and what the popover header prints — so a renamed
 * indicator cannot end up with two names on one chart. This is NOT the second
 * spelling of the chip label that `paneReadoutRows`' comment warns about; it is a
 * DIFFERENT field of the same record, chosen on purpose.
 *
 * ⛔ A SECONDARY PLOT KEEPS ITS OWN SHORT NAME. MACD's pane prints two rows, and
 * "Moving Average Convergence Divergence" over `SIG` would name the indicator
 * twice and the line never. The first chip-bearing plot is the one the definition
 * is named after; the rest are parts of it and already carry the word for the
 * part (`SIG`, `%D`, the band edges).
 *
 * ⚠️ AND THE SOURCE-NAMED DEFINITIONS CANNOT BE ANSWERED FROM HERE. `dataSeries`
 * is deliberately blind to what a symbol IS (`nativeRegistry`: no `if breadth`,
 * no symbol list) and this module imports no source grammar, so the long name of
 * `UCTU20W` arrives as an argument from the caller that can look it up. A caller
 * with no answer gets the short label back, which is what the strip shows — never
 * a guess, and never the string "Data Series".
 *
 * @param {object} chip      one `legendChips` row
 * @param {object|null} def  its definition
 * @param {string|null} [sourceName]  the long name of the chip's SOURCE, for a
 *   `meta.labelFrom: 'source'` definition; ignored for every other kind
 * @returns {string} the name to print over the pane
 */
export function paneReadoutLabel(chip, def, sourceName) {
  if (!chip || typeof chip.label !== 'string') return ''
  if (!def) return chip.label
  // The sibling suffix travels with whichever name we choose — see
  // `disambiguateSiblings`, which stamps it onto the chip for exactly this.
  // ⭐ …and the calculation timeframe after it (`SMA 200 · 1D`), so the long name
  // says what the chip says.
  const suffix = (typeof chip.suffix === 'string' ? chip.suffix : '')
    + (typeof chip.frameSuffix === 'string' ? chip.frameSuffix : '')
  if (def.meta && def.meta.labelFrom === 'source') {
    return (typeof sourceName === 'string' && sourceName)
      ? `${sourceName}${suffix}`
      : chip.label
  }
  const primary = (def.plots || []).find((p) => p && p.legend && p.legend.hide !== true)
  if (!primary || primary.key !== chip.plotKey) return chip.label
  // ⭐⭐ A DEFINITION THAT NAMES ITSELF SEMANTICALLY HAS NO LONGER NAME TO GIVE.
  // `meta.name` is the CATALOGUE noun — right for "Relative Strength Index" over
  // an RSI pane, and wrong for a Moving Average, whose chip already reads `EMA 9`.
  // Printing "Moving Average" over a pane holding an EMA 9 and an SMA 50 names
  // BOTH rows the same thing, which is the exact failure `labelFrom: 'source'`
  // already has its own branch above to avoid.
  if (namesItselfSemantically(def)) return chip.label
  const full = def.meta && def.meta.name
  return (typeof full === 'string' && full) ? `${full}${suffix}` : chip.label
}

// ─── PHASE 2a VISUAL ROUND (unit VA3) · THE READOUT DEFINITION'S SURFACES ───
//
// ⭐ A DEFINITION THAT DECLARES `readout[]` IS THE OPT-IN, and it is the only one.
// Today that is `rsLine` alone. The helpers below are the client half of spec
// items A5a (the phone text chip), A8 (the pane label never goes blank) and A9
// (one name grammar: `UCT RS · SPY`). Every other definition answers `null` from
// each of them, so its chip, its menu and its pane label are byte-identical to
// before — `readout.va3.test.js` pins that on RSI and MACD.

/** Whether a definition declares a readout block (`readout[]`, non-empty). */
export function declaresReadout(def) {
  return !!(def && Array.isArray(def.readout) && def.readout.length)
}

/** Whether `plotKey` of `def` declared `legend.showValue: false` (F3): its chip
 *  names the line and prints no number. False for every other plot. */
export function legendHidesValue(def, plotKey) {
  const plot = (def && Array.isArray(def.plots) ? def.plots : []).find((p) => p && p.key === plotKey)
  return !!(plot && plot.legend && plot.legend.showValue === false)
}

/**
 * ⭐ A9 — THE SHORT NAME, IN THE ONE GRAMMAR: `UCT RS · SPY`.
 *
 * The stem is `meta.shortName`; what follows is the chip's pane suffix — the
 * identity parts and the chip-flagged readout rows `stampReadout` composed
 * (` · XLK · 94` once the envelope has landed, ` · SPY` before it while the
 * benchmark is a `legendParams` entry), then the calculation frame. So it reads
 * the same whether `legendParams` names the benchmark (`UCT RS(SPY)` on
 * `chip.label`) or is empty (the engineering map's design, `legendParams: []`
 * with the benchmark row as the chip suffix). The sibling suffix a second copy
 * earned (` (maLength 50)`) is already inside `chip.suffix`.
 *
 * ⛔ `chip.label` AND `chip.text` ARE NOT TOUCHED. Three byte-exact rails pin
 * that grammar; the surfaces that print the short name ask for it here.
 *
 * @returns {string|null} null for every definition without a readout
 */
export function readoutChipName(chip, def) {
  if (!chip || !declaresReadout(def)) return null
  const meta = def.meta || {}
  if (meta.labelFrom === 'source') return null
  const stem = (typeof meta.shortName === 'string' && meta.shortName)
    || (typeof meta.name === 'string' && meta.name) || def.id
  const suffix = typeof chip.suffix === 'string' ? chip.suffix : ''
  const frame = typeof chip.frameSuffix === 'string' ? chip.frameSuffix : ''
  return `${stem}${suffix}${frame}`
}

const MONTHS = Object.freeze(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'])

/** `20261104` / `'20261104'` / `'2026-11-04'` → `Nov 4`; anything else → ''. */
export function readoutDateText(asOf) {
  const s = typeof asOf === 'number' && Number.isInteger(asOf) ? String(asOf)
    : (typeof asOf === 'string' ? asOf.replace(/-/g, '') : '')
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(s)
  if (!m) return ''
  const mo = Number(m[2]); const d = Number(m[3])
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return ''
  return `${MONTHS[mo - 1]} ${d}`
}

/**
 * ⭐ A8 — WHAT THE PANE LABEL PRINTS WHEN THE LIVE VALUE IS MISSING.
 *
 * The newest bar can carry no RS value (the benchmark is missing that bar), and
 * then the chip has no number. The label never goes blank and never passes a
 * stale number off as current: it prints the server's `payload.legend.lastValue`
 * (the last finite RS value) at the plot's decimals, MUTED, with its date
 * (`payload.legend.asOf`): `0.4700 · Nov 4`. No finite value at all, or no
 * envelope yet → a muted `—`.
 *
 * ⭐ UCT RS 3-14 — NO VALUE AT ALL, BUT THE SERVER SAID WHY: the first readout row
 * carrying a `note` (the muted second line, e.g. the Benchmark row's `No XYZQ bars
 * yet; they usually load within a minute`) is printed in place of the dash,
 * muted, marked `note: true`. A pane whose every plot came back empty then tells
 * the member why on screen instead of only inside the chip menu.
 *
 * ⭐ UCT RS split, F3 (2026-11-10) — A PLOT THAT WITHHOLDS ITS NUMBER
 * (`legend.showValue: false`, `legendHidesValue`) withholds the dated last one
 * too: `opts.plotKey` names the chip's plot, and for such a plot the numeric
 * branch below answers `null` (the name alone is the label), while a declared
 * `legendFallback` entry and the server's note still print: neither is the number.
 *
 * @param {object|null} def
 * @param {object|null} scalars the envelope payload (`scalarsFor`), or null
 * @param {number} [decimals] the plot's legend decimals (the chip's)
 * @param {object} [inputs] the instance's stored inputs
 * @param {{plotKey?: string}} [opts] the chip's plot, for the `showValue` rule
 * @returns {{text: string, muted: true, note?: true}|null} null for a definition without a readout
 */
export function readoutFallbackValue(def, scalars, decimals, inputs, opts) {
  if (!declaresReadout(def)) return null
  const valueHidden = !!(opts && typeof opts.plotKey === 'string' && legendHidesValue(def, opts.plotKey))
  // ⭐ A DECLARED ALTERNATIVE FIRST (2026-11-07): `meta.legendFallback` is a list
  // of readout-grammar entries ({source, format, when?}). The first that
  // resolves is the pane label's value, LIVE (not muted, no date): a view that
  // blanks the primary line (the RS Mansfield view) names the line it draws.
  // ⭐ rsLine rev 5 (2026-11-08): an entry may declare a `muted` GATE (the readout
  // grammar's). While it holds, the entry's text is the pane label's value in the
  // MUTED ink: the server's reason for an empty pane ("daily charts only") is what
  // the label should say, never another reading's number. An entry with no `muted`
  // is unchanged (live, as before).
  const alts = def && def.meta && Array.isArray(def.meta.legendFallback) ? def.meta.legendFallback : []
  if (alts.length) {
    const rows = readoutRows({ ...def, readout: alts.map((a, i) => ({ ...a, key: a.key || `legendFallback${i}`, label: a.label || 'value' })) },
      scalars, { inputs: inputs || {} })
    const first = rows.length ? rows[0] : null
    const gated = first && typeof (alts.find((a, i) => (a.key || `legendFallback${i}`) === first.key) || {}).muted === 'string'
    if (first && first.text && (!first.muted || gated)) return { text: first.text, muted: first.muted === true }
  }
  const legend = scalars && typeof scalars === 'object' && scalars.legend && typeof scalars.legend === 'object'
    ? scalars.legend : null
  const v = valueHidden ? null : (legend ? legend.lastValue : null)
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    if (scalars && typeof scalars === 'object') {
      const noted = readoutRows(def, scalars, { inputs: inputs || {} }).find((r) => typeof r.note === 'string' && r.note)
      if (noted) return { text: noted.note, muted: true, note: true }
    }
    // F3: no number is withheld as nothing, not as a dash — the name is the label.
    return valueHidden ? null : { text: '—', muted: true }
  }
  const dp = Number.isInteger(decimals) ? decimals : 4
  const date = readoutDateText(legend.asOf)
  return { text: date ? `${v.toFixed(dp)} · ${date}` : v.toFixed(dp), muted: true }
}

/**
 * ⭐ A1 — SPLIT A CHIP'S RESOLVED READOUT ROWS INTO THE GLANCE LIST AND THE
 * CARDS' NUMBERS BLOCKS (shared contract: `detailOf: '<glanceKey>'`).
 *
 * A row's `detailOf` is read from the resolved row (VA2 stamps it there) and,
 * failing that, from the definition's own entry by key, so the grouping holds
 * whichever half lands first. A row whose `detailOf` names no glance row that
 * is absent (Mansfield view off, so no Mansfield row) renders nowhere: the
 * contract says a detail row lives only in its glance row's card.
 *
 * ⛔ BACKWARD COMPATIBLE BY CONSTRUCTION: with no `detailOf` anywhere every row
 * is a glance row, in the order given — exactly today's menu.
 *
 * @param {object[]} rows the chip's resolved rows (`chip.readout`)
 * @param {object|null} def
 * @returns {{glance: object[], details: Map<string, object[]>}}
 */
export function splitReadoutRows(rows, def) {
  const list = Array.isArray(rows) ? rows.filter((r) => r && typeof r.key === 'string') : []
  const entries = def && Array.isArray(def.readout) ? def.readout : []
  const declared = new Map(entries.filter((e) => e && typeof e.key === 'string').map((e) => [e.key, e]))
  const parentOf = (r) => {
    if (typeof r.detailOf === 'string' && r.detailOf) return r.detailOf
    const e = declared.get(r.key)
    return e && typeof e.detailOf === 'string' && e.detailOf ? e.detailOf : null
  }
  const glance = []
  const details = new Map()
  for (const r of list) {
    const p = parentOf(r)
    if (p) {
      if (!details.has(p)) details.set(p, [])
      details.get(p).push(r)
    } else glance.push(r)
  }
  return { glance, details }
}

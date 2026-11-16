// ── D31 RESOLVER PILOT · THE ORACLE (policy table) for the REMOVAL family ────────────────────────────────────────────────
//
// The expected-behaviour table the shared typed target resolver (design: D31 resolver-design.md, AUDIT R1) is tested against.
// Written BEFORE any resolver code and frozen by AUDIT review (its sha256 goes in the P1 PR body). DATA ONLY: no resolver here.
//
// A row: { id, family, words, context, plan, expect, reason, evidence, source, inv?, adds?, masterGap?, overAsk?, policy?, why? }
//   words    the member's words this turn (an `offers.carried` request is the pending question's carried request: railWordsRef)
//   context  { world, selection, subject, previous, offers }
//              world      'B3' three independent charts SPY · QQQ · IWM (c1 left · c2 middle · c3 right)
//                         'B1' one chart SPY (c1) · 'BDUP' SPY · SPY · IWM (c1 · c2 · c3, all unlinked)
//                         'ST' the state fixture: c1 SPY · c2 NVDA, each with RSI + EMA 9 / EMA 20 / SMA 50 / SMA 200; drawings
//                              on SPY (horizontal dr-h, trendline dr-t, fib dr-f, position dr-p, text dr-x) and NVDA (horizontal
//                              dr-n); watchlists Tech (wl1: SPY NVDA AMD) and Swing (wl2: TSLA META)
//              selection  the clicked chart (pointer) · subject  the conversation's chart (useAgent memory `subject`)
//              previous   the ONE object the previous applied turn made or changed, typed (chart:c3 · ind:c1:rsi · draw:dr-t · list:wl2)
//              offers     { refs, carried, stale? } the Agent's own question's choices, in order (R3 / I9)
//   plan     the plan's target ref: chart:<c> · ind:<c>:<rsi|ema20> · draw:<id> · list:<wl> (delete) · item:<wl>:<SYM> (remove a row)
//   expect   'resolved:<plan target>' | 'ask' | 'refuse'   — THE POLICY (invariants I1–I10 of the design), never master's habit
//   reason   resolved → the evidence SOURCE that licensed it; ask / refuse → a CODE (both closed sets, below)
//   evidence the evidence class the row exercises (the design's §8 rule → source map), for coverage counts
//   source   the existing rule / AUDIT probe class it encodes
//   adds     true: the resolver is expected to ADD this ask / refuse beyond the rails (with `why`)
//   masterGap true: master applies here although the policy blocks (expected = the policy's; a KNOWN gap, listed by the test)
//   overAsk  true: master asks / refuses where the policy would resolve; expected = master's block for now (`policy` = the
//            resolution the policy would give) — an honest ratchet, AUDIT rule 2026-11-16
//
// Wordings are the worker's own (vocabulary from deixis / stateRail / chartRail), never AUDIT probe phrasings.

export const FAMILY = 'removal'
/** The design's closed refuse / ask code enum (§3). */
export const CODES = Object.freeze(['plan-outside-words', 'type-mismatch', 'ambiguous-n', 'negated-target', 'anchor-as-target', 'pointer-vs-words', 'description-mismatch', 'absent', 'reader-error'])
/** The design's evidence SOURCE enum (§2) — what a resolved row is licensed by. */
export const SOURCES = Object.freeze(['named', 'description', 'appositive', 'container', 'relation', 'ordinal-position', 'answer', 'pointer', 'previous', 'offered', 'sole', 'plan'])
export const REASONS = Object.freeze([...CODES, ...SOURCES])
/** The evidence classes a row exercises (§8). */
export const EVIDENCE = Object.freeze(['named', 'ordinal-position', 'pointer', 'subject', 'none', 'sole', 'plural', 'previous-chart', 'previous-thing',
  'appositive-after', 'appositive-before', 'container-thing', 'container-chart', 'container-on-chart', 'continuation', 'negated', 'relation',
  'duplicate', 'offered', 'offered-stale', 'indicator-named', 'drawing-named', 'list-named', 'cross-type', 'filler', 'plan-only', 'description'])
export const WORLDS = Object.freeze(['B3', 'B1', 'BDUP', 'ST', 'B3R', 'B3E', 'B4'])
//   (AUDIT rows) 'B3R' B3 with an RSI on SPY (c1) and IWM (c3) · 'B3E' B3 with c3 EMPTY (no symbol) · 'B4' SPY · QQQ · NVDA · AMD
//   a plan with several targets joins them with '+' (e.g. 'chart:c1+chart:c2+chart:c3')
export const INVARIANTS = Object.freeze(['I1', 'I2', 'I3', 'I4', 'I5', 'I6', 'I7', 'I8', 'I9', 'I10'])

// ── the generator (deterministic: fixed vocabularies, fixed order; ids are group + running number) ──
const rows = []
const count = {}
const ctx = (c = {}) => ({ world: 'B3', selection: null, subject: null, previous: null, offers: null, ...c })
function add(group, words, context, plan, expect, reason, evidence, source, extra = {}) {
  count[group] = (count[group] || 0) + 1
  rows.push({ id: `rm-${group}-${String(count[group]).padStart(3, '0')}`, family: FAMILY, words, context: ctx(context), plan, expect, reason, evidence, source, ...extra })
}
const ok = (plan) => `resolved:${plan}`
const B3 = { SPY: 'c1', QQQ: 'c2', IWM: 'c3' }

// G1 · NAMED: a ticker + chart noun names exactly that chart; a plan closing another is refused (I1, probe 59)
const NAMED_VERBS = [(t) => `close the ${t} chart`, (t) => `remove the ${t} chart`, (t) => `get rid of the ${t} chart`, (t) => `delete the ${t} chart`, (t) => `drop the ${t} chart`, (t) => `take the ${t} chart off`]
for (const v of NAMED_VERBS) for (const t of ['SPY', 'IWM']) {
  add('named', v(t), {}, `chart:${B3[t]}`, ok(`chart:${B3[t]}`), 'named', 'named', 'chartRail removalTargets/identifiesChart (probe 59)', { inv: ['I1'] })
  add('named', v(t), {}, 'chart:c2', 'refuse', 'plan-outside-words', 'named', 'chartRail removalTargets/identifiesChart (probe 59)', { inv: ['I1'] })
}
// the clicked chart never outranks a chart the words name (I4: pointer below words)
for (const v of NAMED_VERBS.slice(0, 3)) {
  add('named', v('IWM'), { selection: 'c2' }, 'chart:c3', ok('chart:c3'), 'named', 'named', 'evidence precedence words > pointer', { inv: ['I1', 'I4'] })
  add('named', v('IWM'), { selection: 'c2' }, 'chart:c2', 'refuse', 'plan-outside-words', 'named', 'evidence precedence words > pointer', { inv: ['I1', 'I4'] })
}

// G2 · ORDINAL / POSITION (deixis ordinalChart, chartRail POS / probe 60b)
const ORD = [['close the second chart', 'c2'], ['remove the third chart', 'c3'], ['close the first one', 'c1'], ['delete the left chart', 'c1'],
  ['close the right chart', 'c3'], ['get rid of the middle chart', 'c2'], ['close chart 3', 'c3'], ['drop the last chart', 'c3']]
for (const [w, c] of ORD) {
  add('ord', w, {}, `chart:${c}`, ok(`chart:${c}`), 'ordinal-position', 'ordinal-position', 'deixis ordinalChart / chartRail POS (probe 60b)', { inv: ['I1'] })
  const other = c === 'c1' ? 'c2' : 'c1'
  add('ord', w, {}, `chart:${other}`, 'refuse', 'plan-outside-words', 'ordinal-position', 'deixis ordinalChart / chartRail POS (probe 60b)', { inv: ['I1'] })
}

// G3 · POINTER: a bare destroying pronoun with a chart clicked → that chart (probe 61a order step 1)
const PRON = ['it', 'that', 'this one']
const PVERBS = [(p) => `close ${p}`, (p) => `remove ${p}`, (p) => `delete ${p}`, (p) => `get rid of ${p}`]
for (const p of PRON) for (const v of PVERBS) {
  add('ptr', v(p), { selection: 'c2' }, 'chart:c2', ok('chart:c2'), 'pointer', 'pointer', 'chartRail resolvePronoun selected (probe 61a)', { inv: ['I1'] })
  add('ptr', v(p), { selection: 'c2' }, 'chart:c1', 'refuse', 'plan-outside-words', 'pointer', 'chartRail resolvePronoun selected (probe 61a)', { inv: ['I1'] })
}

// G4 · CONVERSATION CHART (useAgent `subject`): step 2 of the pronoun order
for (const p of PRON) for (const v of PVERBS.slice(0, 2)) {
  add('subj', v(p), { subject: 'c3' }, 'chart:c3', ok('chart:c3'), 'previous', 'subject', 'chartRail resolvePronoun subject (probe 61a)', { inv: ['I1'] })
  add('subj', v(p), { subject: 'c3' }, 'chart:c2', 'refuse', 'plan-outside-words', 'subject', 'chartRail resolvePronoun subject (probe 61a)', { inv: ['I1'] })
}

// G5 · NOTHING resolves the pronoun: 2+ chart objects, no click, no conversation object → asked (I2, probe 61a LIVE)
for (const p of ['it', 'that', 'this', 'that one']) for (const v of PVERBS.slice(0, 3)) {
  add('none', v(p), {}, 'chart:c2', 'ask', 'ambiguous-n', 'none', 'chartRail resolvePronoun 2+ → ask (probe 61a)', { inv: ['I2'] })
}

// G6 · SOLE: the only chart object is the referent of a pronoun or the class noun
for (const w of ['close it', 'remove that', 'delete this one', 'close the chart', 'get rid of it']) {
  add('sole', w, { world: 'B1' }, 'chart:c1', ok('chart:c1'), 'sole', 'sole', 'chartRail resolvePronoun sole / identifiesChart sole (D23)', { inv: ['I2'] })
}

// G7 · PLURAL: "them" / "those" name the set selection + conversation chart make; with neither → asked (I2)
for (const w of ['close them', 'get rid of those']) {
  add('plural', w, { selection: 'c1', subject: 'c3' }, 'chart:c1', ok('chart:c1'), 'pointer', 'plural', 'chartRail resolvePronoun plural', { inv: ['I2'] })
  add('plural', w, { selection: 'c1', subject: 'c3' }, 'chart:c2', 'refuse', 'plan-outside-words', 'plural', 'chartRail resolvePronoun plural', { inv: ['I1', 'I2'] })
  add('plural', w, {}, 'chart:c1', 'ask', 'ambiguous-n', 'plural', 'chartRail resolvePronoun plural → ask', { inv: ['I2'] })
}

// G8 · PREVIOUS = a CHART the previous applied turn made / changed (stateRail previous, typed chart:)
for (const p of PRON) for (const v of PVERBS.slice(0, 2)) {
  add('prevc', v(p), { previous: 'chart:c3' }, 'chart:c3', ok('chart:c3'), 'previous', 'previous-chart', 'chartRail pronounReferent previous chart: (owner 11-16)', { inv: ['I1', 'I3'] })
  add('prevc', v(p), { previous: 'chart:c3' }, 'chart:c1', 'refuse', 'plan-outside-words', 'previous-chart', 'chartRail pronounReferent previous chart: (owner 11-16)', { inv: ['I1'] })
}

// G9 · PREVIOUS = a THING (indicator / drawing / list): the pronoun is that thing; a chart close is a type mismatch (I3, probe 62)
const TVERBS = ['delete it', 'remove that', 'get rid of it']
for (const w of TVERBS) {
  add('prevt', w, { world: 'ST', previous: 'ind:c1:rsi' }, 'ind:c1:rsi', ok('ind:c1:rsi'), 'previous', 'previous-thing', 'stateRail permits previous (AUDIT #1247 A)', { inv: ['I3'] })
  add('prevt', w, { world: 'ST', previous: 'ind:c1:rsi' }, 'ind:c1:ema20', 'refuse', 'plan-outside-words', 'previous-thing', 'stateRail permits previous (AUDIT #1247 A)', { inv: ['I1'] })
  add('prevt', w, { world: 'ST', previous: 'ind:c1:rsi' }, 'chart:c1', 'refuse', 'type-mismatch', 'previous-thing', 'chartRail pronounReferent thing (probe 62)', { inv: ['I3'] })
  // a thing just made AND a chart clicked: which is meant is asked (owner 11-16 conflict)
  add('prevt', w, { world: 'ST', previous: 'ind:c1:rsi', selection: 'c2' }, 'chart:c2', 'ask', 'pointer-vs-words', 'previous-thing', 'chartRail removalTargets conflict (owner 11-16)', { inv: ['I2', 'I4'] })
}
for (const w of TVERBS.slice(0, 2)) {
  add('prevt', w, { world: 'ST', previous: 'draw:dr-t' }, 'draw:dr-t', ok('draw:dr-t'), 'previous', 'previous-thing', 'stateRail permits previous (AUDIT #1247 A)', { inv: ['I3'] })
  add('prevt', w, { world: 'ST', previous: 'draw:dr-t' }, 'draw:dr-h', 'refuse', 'plan-outside-words', 'previous-thing', 'stateRail permits previous (AUDIT #1247 A)', { inv: ['I1'] })
  add('prevt', w, { world: 'ST', previous: 'draw:dr-t' }, 'chart:c1', 'refuse', 'type-mismatch', 'previous-thing', 'chartRail pronounReferent thing (probe 62)', { inv: ['I3'] })
  add('prevt', w, { world: 'ST', previous: 'list:wl2' }, 'list:wl2', ok('list:wl2'), 'previous', 'previous-thing', 'stateRail permits previous (AUDIT #1247 A)', { inv: ['I3'] })
  add('prevt', w, { world: 'ST', previous: 'list:wl2' }, 'list:wl1', 'refuse', 'plan-outside-words', 'previous-thing', 'stateRail permits previous (AUDIT #1247 A)', { inv: ['I1'] })
  add('prevt', w, { world: 'ST', previous: 'list:wl2' }, 'chart:c2', 'refuse', 'type-mismatch', 'previous-thing', 'chartRail pronounReferent thing (probe 62)', { inv: ['I3'] })
}

// G10 · APPOSITIVE AFTER the pronoun clause types it (probe 64a-1 class); a chart appositive names that chart
const APPOS = [(v, np) => `${v}, ${np} I mean`, (v, np) => `${v} — ${np}`, (v, np) => `${v}, I mean ${np}`, (v, np) => `${v} (${np})`]
for (const f of APPOS) {
  add('appA', f('close it', 'the IWM chart'), {}, 'chart:c3', ok('chart:c3'), 'appositive', 'appositive-after', 'chartRail APPOS (probe 64a-1)', { inv: ['I1'] })
  add('appA', f('close it', 'the IWM chart'), {}, 'chart:c2', 'refuse', 'plan-outside-words', 'appositive-after', 'chartRail APPOS (probe 64a-1)', { inv: ['I1'] })
}
for (const [w, sel] of [['delete it, the RSI I mean', null], ['remove that (the trendline)', null], ['get rid of it — the alert', null], ['close it, I mean the MACD', null],
  ['delete it, the RSI I mean', 'c2'], ['remove that (the trendline)', 'c2'], ['get rid of this one — the note', 'c2'], ['close it, I mean the moving average', 'c2']]) {
  add('appA', w, { selection: sel }, 'chart:c2', 'refuse', 'type-mismatch', 'appositive-after', 'chartRail APPOS thing (probe 64a-1)', { inv: ['I3'] })
}
// the appositive outranks the clicked chart: words before pointer (I4 precedence; the chart the words name is closed)
add('appA', 'close this, the IWM chart I mean', { selection: 'c2' }, 'chart:c3', ok('chart:c3'), 'appositive', 'appositive-after', 'APPOS chart outranks the selection', { inv: ['I1', 'I4'] })
add('appA', 'close this, the IWM chart I mean', { selection: 'c2' }, 'chart:c2', 'refuse', 'plan-outside-words', 'appositive-after', 'APPOS chart outranks the selection', { inv: ['I1', 'I4'] })
// on the state world: the appositive narrows to the previous object of its type
add('appA', 'delete it, the RSI I mean', { world: 'ST', previous: 'ind:c1:rsi' }, 'ind:c1:rsi', ok('ind:c1:rsi'), 'appositive', 'appositive-after', 'APPOS + stateRail previous', { inv: ['I3'] })
add('appA', 'delete it, the RSI I mean', { world: 'ST', previous: 'ind:c1:rsi' }, 'ind:c1:ema20', 'refuse', 'plan-outside-words', 'appositive-after', 'APPOS + stateRail previous', { inv: ['I1', 'I3'] })

// G11 · APPOSITIVE / ANTECEDENT BEFORE the verb (pronounAntecedent; a place preposition is skipped)
for (const [w, sel] of [['the IWM chart is done, close it', null], ['the IWM chart is done, close it', 'c2'], ['that IWM chart — remove it', null]]) {
  add('appB', w, { selection: sel }, 'chart:c3', ok('chart:c3'), 'appositive', 'appositive-before', 'chartRail pronounAntecedent chart', { inv: ['I1'] })
  add('appB', w, { selection: sel }, 'chart:c2', 'refuse', 'plan-outside-words', 'appositive-before', 'chartRail pronounAntecedent chart', { inv: ['I1'] })
}
for (const w of ['draw a trendline and delete it', 'add a MACD, then remove it', 'put an RSI on the QQQ chart, then delete it', 'put a fib on the right chart and get rid of it']) {
  add('appB', w, { selection: 'c2' }, 'chart:c2', 'refuse', 'type-mismatch', 'appositive-before', 'chartRail pronounAntecedent thing / PLACE_PREP (probe 62)', { inv: ['I3'] })
}
// "add an RSI, then delete it": the pronoun is the RSI made THIS turn — never the existing one (AUDIT #1247 ruling)
add('appB', 'add an RSI, then delete it', { world: 'ST' }, 'ind:c1:rsi', 'refuse', 'plan-outside-words', 'appositive-before', 'stateRail permits namesThatObject (AUDIT #1247)', { inv: ['I1', 'I3'] })
add('appB', 'add an RSI, then delete it', { world: 'ST' }, 'chart:c1', 'refuse', 'type-mismatch', 'appositive-before', 'chartRail pronounAntecedent thing (probe 62)', { inv: ['I3'] })

// G12 · CONTAINER: a THING container makes the pronoun no chart; the board / layout / screen makes it a chart (probe 64a-7)
for (const w of ['remove it from my watchlist', 'take that off my Tech list', 'delete this from my notes', 'drop it out of my alerts', 'get rid of it from my drawing board', 'take it out of the Swing watchlist']) {
  add('ctT', w, { selection: 'c2' }, 'chart:c2', 'refuse', 'type-mismatch', 'container-thing', 'chartRail containerType thing (probe 64a-7)', { inv: ['I3'] })
}
for (const w of ['remove it from my watchlist', 'delete that from my notes']) {
  add('ctT', w, {}, 'chart:c1', 'refuse', 'type-mismatch', 'container-thing', 'chartRail containerType thing (probe 64a-7)', { inv: ['I3'] })
}
for (const w of ['remove it from the board', 'take it off the layout', 'drop that from my screen']) {
  add('ctC', w, { selection: 'c2' }, 'chart:c2', ok('chart:c2'), 'pointer', 'container-chart', 'chartRail CHART_CONTAINER (probe 64a-7 control)', { inv: ['I1'] })
  add('ctC', w, { selection: 'c2' }, 'chart:c1', 'refuse', 'plan-outside-words', 'container-chart', 'chartRail CHART_CONTAINER (probe 64a-7 control)', { inv: ['I1'] })
  add('ctC', w, {}, 'chart:c2', 'ask', 'ambiguous-n', 'container-chart', 'chartRail CHART_CONTAINER + resolvePronoun 2+ → ask', { inv: ['I2'] })
}
// a THING appositive outranks the board container (probe 66a class)
for (const w of ['take it off the board (the trendline)', 'remove it from the layout, the RSI I mean', 'take this off the screen — the alert']) {
  add('ctC', w, { selection: 'c2' }, 'chart:c2', 'refuse', 'type-mismatch', 'container-chart', 'chartRail APPOS outranks container (probe 66a)', { inv: ['I3'] })
}
// out of a CHART: the pronoun is a thing on that chart
for (const w of ['take it off the QQQ chart', 'remove that from the middle one', 'delete it off of the IWM chart']) {
  add('ctO', w, { selection: 'c2' }, 'chart:c2', 'refuse', 'type-mismatch', 'container-on-chart', 'chartRail containerType onChart', { inv: ['I3'] })
}

// G13 · CONTINUATION: the pronoun's clause goes on past it — no chart removal object (probe 62 PRONOUN_NEXT / FROM_CHART)
for (const w of ['take it down to weekly', 'take this down a timeframe', 'clear it of drawings', 'remove it from the chart', 'drop it to the hourly', 'take that down by one timeframe']) {
  add('cont', w, { selection: 'c2' }, 'chart:c2', 'refuse', 'plan-outside-words', 'continuation', 'chartRail PRONOUN_CONT (probe 62)', { inv: ['I1'] })
}

// G14 · NEGATED / KEPT mentions are never referents (I5: KEPT, NEGATOR, excludedCharts)
for (const [w, bad, good] of [['close everything except the QQQ chart', 'c2', 'c1'], ['close all my charts but IWM', 'c3', 'c2'], ['keep QQQ and close the rest', 'c2', 'c3'],
  ['don’t close SPY, close the IWM chart', 'c1', 'c3'], ['leave the left chart, remove the right one', 'c1', 'c3']]) {
  add('neg', w, {}, `chart:${bad}`, 'refuse', 'negated-target', 'negated', 'chartRail keptCharts / excludedCharts (I5)', { inv: ['I5'] })
  add('neg', w, {}, `chart:${good}`, ok(`chart:${good}`), 'named', 'negated', 'chartRail keptCharts / excludedCharts (I5)', { inv: ['I5', 'I1'] })
}

// G15 · RELATION: the click is the ANCHOR, never the target (I6, deixis relativeChart)
for (const [w, target] of [['close the chart to the right of this one', 'c3'], ['remove the chart left of the one I clicked', 'c1']]) {
  add('rel', w, { selection: 'c2' }, `chart:${target}`, ok(`chart:${target}`), 'relation', 'relation', 'deixis RELATIVE / relativeChart (I6)', { inv: ['I6'] })
  add('rel', w, { selection: 'c2' }, 'chart:c2', 'refuse', 'anchor-as-target', 'relation', 'deixis RELATIVE / relativeChart (I6)', { inv: ['I6'] })
}
add('rel', 'close the chart next to the QQQ chart', {}, 'chart:c1', 'ask', 'ambiguous-n', 'relation', 'deixis RELATIVE next-to, two neighbours (I2/I6)', { inv: ['I2', 'I6'] })
add('rel', 'close the chart next to the QQQ chart', {}, 'chart:c2', 'refuse', 'anchor-as-target', 'relation', 'deixis RELATIVE next-to (I6)', { inv: ['I6'] })

// G16 · DUPLICATE ticker: one ticker on two independent charts, singular → asked; plural / position narrows
add('dup', 'close the SPY chart', { world: 'BDUP' }, 'chart:c1', 'ask', 'ambiguous-n', 'duplicate', 'chartRail removalTargets ambiguous symbol', { inv: ['I2'] })
add('dup', 'remove the SPY chart', { world: 'BDUP' }, 'chart:c2', 'ask', 'ambiguous-n', 'duplicate', 'chartRail removalTargets ambiguous symbol', { inv: ['I2'] })
add('dup', 'close both SPY charts', { world: 'BDUP' }, 'chart:c1', ok('chart:c1'), 'named', 'duplicate', 'chartRail pluralOf', { inv: ['I2'] })
add('dup', 'close the left SPY chart', { world: 'BDUP' }, 'chart:c1', ok('chart:c1'), 'ordinal-position', 'duplicate', 'chartRail removalTargets position narrows', { inv: ['I1'] })
add('dup', 'close the left SPY chart', { world: 'BDUP' }, 'chart:c2', 'refuse', 'plan-outside-words', 'duplicate', 'chartRail removalTargets position narrows', { inv: ['I1'] })
add('dup', 'close both SPY charts', { world: 'BDUP' }, 'chart:c3', 'refuse', 'plan-outside-words', 'duplicate', 'chartRail pluralOf', { inv: ['I1'] })

// G17 · OFFERS (R3 / I9): the Agent asked "which chart?" with choices; the member's answer this turn
const ALL3 = { refs: ['c1', 'c2', 'c3'], carried: 'close it' }
for (const [ans, c, src] of [['2', 'c2', 'answer'], ['the third one', 'c3', 'answer'], ['the IWM chart', 'c3', 'description'], ['first', 'c1', 'answer']]) {
  add('offer', ans, { offers: ALL3 }, `chart:${c}`, ok(`chart:${c}`), src, 'offered', 'deixis pickedChoice / railPickedRef (R3)', { inv: ['I9'] })
  add('offer', ans, { offers: ALL3 }, `chart:${c === 'c1' ? 'c2' : 'c1'}`, 'refuse', 'plan-outside-words', 'offered', 'deixis pickedChoice / railPickedRef (R3)', { inv: ['I1', 'I9'] })
}
// R3: with 2+ offers a bare confirm selects nothing → asked
for (const ans of ['yes', 'ok do it', 'sure']) {
  add('offer', ans, { offers: ALL3 }, 'chart:c1', 'ask', 'ambiguous-n', 'offered', 'R3 bare confirm over 2+ offers', { inv: ['I2', 'I9'] })
}
const TWO = { refs: ['c1', 'c3'], carried: 'close it' }
add('offer', '2', { offers: TWO }, 'chart:c3', ok('chart:c3'), 'answer', 'offered', 'deixis pickedChoice by number (R3)', { inv: ['I9'] })
add('offer', '2', { offers: TWO }, 'chart:c2', 'refuse', 'plan-outside-words', 'offered', 'deixis pickedChoice by number (R3)', { inv: ['I1', 'I9'] })
add('offer', 'yes', { offers: TWO }, 'chart:c3', 'ask', 'ambiguous-n', 'offered', 'R3 bare confirm over 2 offers', { inv: ['I2', 'I9'] })
// R3: exactly ONE offer — a bare confirm may license it
const ONE = { refs: ['c3'], carried: 'close it' }
add('offer', 'yes', { offers: ONE }, 'chart:c3', ok('chart:c3'), 'offered', 'offered', 'R3 single offer, bare confirm', { inv: ['I9'] })
add('offer', 'yes please', { offers: ONE }, 'chart:c1', 'refuse', 'plan-outside-words', 'offered', 'R3 single offer, bare confirm', { inv: ['I1', 'I9'] })
// I9: an offer from an earlier turn has expired — the answer words alone ask no removal
for (const ans of ['2', 'the second one']) {
  add('stale', ans, { offers: { ...ALL3, stale: true } }, 'chart:c2', 'refuse', 'plan-outside-words', 'offered-stale', 'I9 offers expire / chartPickStale', { inv: ['I9'] })
}

// G18 · INDICATOR named (H14 unique identification, IND_PLURAL)
add('ind', 'remove the RSI from the SPY chart', { world: 'ST' }, 'ind:c1:rsi', ok('ind:c1:rsi'), 'named', 'indicator-named', 'stateRail indicatorsNamed (H14)', { inv: ['I1'] })
add('ind', 'remove the RSI from the SPY chart', { world: 'ST' }, 'ind:c2:rsi', 'refuse', 'plan-outside-words', 'indicator-named', 'stateRail indicatorsNamed (H14)', { inv: ['I1'] })
add('ind', 'delete the 20 EMA on the SPY chart', { world: 'ST' }, 'ind:c1:ema20', ok('ind:c1:ema20'), 'named', 'indicator-named', 'stateRail indicatorsNamed by length (H14)', { inv: ['I1'] })
add('ind', 'delete the 20 EMA on the SPY chart', { world: 'ST' }, 'ind:c1:rsi', 'refuse', 'plan-outside-words', 'indicator-named', 'stateRail indicatorsNamed by length (H14)', { inv: ['I1'] })
add('ind', 'remove the moving average from the SPY chart', { world: 'ST' }, 'ind:c1:ema20', 'ask', 'ambiguous-n', 'indicator-named', 'stateRail indicatorsNamed 4 MAs → demo ask (H14)', { inv: ['I2'] })
add('ind', 'remove all the moving averages from the SPY chart', { world: 'ST' }, 'ind:c1:ema20', ok('ind:c1:ema20'), 'named', 'indicator-named', 'stateRail IND_PLURAL', { inv: ['I2'] })
add('ind', 'get rid of the MACD', { world: 'ST' }, 'ind:c1:rsi', 'refuse', 'absent', 'indicator-named', 'stateRail namesObject (named object absent)', { inv: ['I1'] })
// the class noun with the instance on two charts and no chart said: which chart is asked (I2)
add('ind', 'remove the RSI', { world: 'ST' }, 'ind:c1:rsi', 'ask', 'ambiguous-n', 'indicator-named', 'I2 two RSI instances (c1, c2), words name no chart', { inv: ['I2'] })
add('ind', 'delete the 20 EMA', { world: 'ST' }, 'ind:c2:ema20', 'ask', 'ambiguous-n', 'indicator-named', 'I2 two EMA 20 instances (c1, c2), words name no chart', { inv: ['I2'] })

// G19 · DRAWING named (H14 DTYPE_NOUN sameType, CLASS.drawing)
add('drw', 'delete the trendline', { world: 'ST' }, 'draw:dr-t', ok('draw:dr-t'), 'named', 'drawing-named', 'stateRail namesObject DTYPE_NOUN (H14)', { inv: ['I1'] })
add('drw', 'delete the trendline', { world: 'ST' }, 'draw:dr-h', 'refuse', 'plan-outside-words', 'drawing-named', 'stateRail namesObject DTYPE_NOUN (H14)', { inv: ['I1'] })
add('drw', 'remove the fib', { world: 'ST' }, 'draw:dr-f', ok('draw:dr-f'), 'named', 'drawing-named', 'stateRail namesObject DTYPE_NOUN (H14)', { inv: ['I1'] })
add('drw', 'remove the fib', { world: 'ST' }, 'draw:dr-t', 'refuse', 'plan-outside-words', 'drawing-named', 'stateRail namesObject DTYPE_NOUN (H14)', { inv: ['I1'] })
add('drw', 'get rid of the line', { world: 'ST' }, 'draw:dr-t', 'ask', 'ambiguous-n', 'drawing-named', 'stateRail namesObject several lines (H14)', { inv: ['I2'] })
add('drw', 'remove the horizontal line on SPY', { world: 'ST' }, 'draw:dr-h', ok('draw:dr-h'), 'named', 'drawing-named', 'stateRail DTYPE_NOUN + ticker', { inv: ['I1'] })
add('drw', 'remove the horizontal line on SPY', { world: 'ST' }, 'draw:dr-n', 'refuse', 'plan-outside-words', 'drawing-named', 'stateRail DTYPE_NOUN + ticker', { inv: ['I1'] })

// G20 · LIST named (stateRail CLASS.watchlist + label; H14 several in scope)
add('list', 'delete my Swing watchlist', { world: 'ST' }, 'list:wl2', ok('list:wl2'), 'named', 'list-named', 'stateRail namesObject label', { inv: ['I1'] })
add('list', 'delete my Swing watchlist', { world: 'ST' }, 'list:wl1', 'refuse', 'plan-outside-words', 'list-named', 'stateRail namesObject label', { inv: ['I1'] })
add('list', 'delete the watchlist', { world: 'ST' }, 'list:wl2', 'ask', 'ambiguous-n', 'list-named', 'stateRail namesObject several lists (H14)', { inv: ['I2'] })
add('list', 'remove NVDA from the Tech list', { world: 'ST' }, 'item:wl1:NVDA', ok('item:wl1:NVDA'), 'named', 'list-named', 'stateRail watchlist syms', { inv: ['I1'] })
add('list', 'remove AMD from the Tech list', { world: 'ST' }, 'item:wl1:NVDA', 'refuse', 'plan-outside-words', 'list-named', 'stateRail watchlist syms', { inv: ['I1'] })
add('list', 'remove it from my watchlist', { world: 'ST' }, 'item:wl1:NVDA', 'ask', 'ambiguous-n', 'container-thing', 'containerType thing + no item named', { inv: ['I2'] })

// G21 · CROSS-TYPE (I3): words of one type, a plan destroying another
add('xtype', 'close the SPY chart', { world: 'ST' }, 'ind:c1:rsi', 'refuse', 'type-mismatch', 'cross-type', 'stateRail CLASS kind-matched (AUDIT #1247)', { inv: ['I3'] })
add('xtype', 'remove the RSI from the SPY chart', { world: 'ST' }, 'chart:c1', 'refuse', 'type-mismatch', 'cross-type', 'chartRail REMOVAL gate / FROM_CHART (I3)', { inv: ['I3'] })
add('xtype', 'delete the trendline', { world: 'ST' }, 'chart:c1', 'refuse', 'type-mismatch', 'cross-type', 'chartRail SPECIFIC_CHART / REMOVAL (I3)', { inv: ['I3'] })
add('xtype', 'delete my Swing watchlist', { world: 'ST' }, 'chart:c2', 'refuse', 'type-mismatch', 'cross-type', 'chartRail REMOVAL (I3)', { inv: ['I3'] })
add('xtype', 'close the NVDA chart', { world: 'ST' }, 'draw:dr-n', 'refuse', 'type-mismatch', 'cross-type', 'stateRail CLASS kind-matched (I3)', { inv: ['I3'] })
add('xtype', 'delete my Swing watchlist', { world: 'ST' }, 'ind:c1:rsi', 'refuse', 'type-mismatch', 'cross-type', 'stateRail CLASS kind-matched (I3)', { inv: ['I3'] })

// G22 · FILLERS / case / punctuation (M2): same verdict as the seed
for (const w of ['please close the IWM chart', 'Close the IWM chart!', 'close the iwm chart for me now', 'could you remove the IWM chart please']) {
  add('fill', w, {}, 'chart:c3', ok('chart:c3'), 'named', 'filler', 'M2 metamorphic over G1', { inv: ['I1'] })
  add('fill', w, {}, 'chart:c1', 'refuse', 'plan-outside-words', 'filler', 'M2 metamorphic over G1', { inv: ['I1'] })
}
for (const w of ['Close it.', 'close it please', 'remove that, now']) {
  add('fill', w, { selection: 'c2' }, 'chart:c2', ok('chart:c2'), 'pointer', 'filler', 'M2 metamorphic over G3', { inv: ['I1'] })
  add('fill', w, {}, 'chart:c2', 'ask', 'ambiguous-n', 'filler', 'M2 metamorphic over G5', { inv: ['I2'] })
}

// G23 · PLAN ONLY: words that refer to nothing never license a plan's target on their own (source 'plan' never licenses)
for (const w of ['do it', 'clean things up a bit', 'go ahead']) {
  add('plan', w, {}, 'chart:c2', 'refuse', 'plan-outside-words', 'plan-only', 'chartRail REMOVAL gate (plan never licenses)', { inv: ['I1'] })
}

// G24 · AUDIT's rows, VERBATIM (ids, words, contexts, plans and expectations are AUDIT's; source 'audit'; never altered)
const audit = (id, words, context, plan, expect, reason, evidence, inv) => rows.push({ id, family: FAMILY, words, context: ctx(context), plan, expect, reason, evidence, source: 'audit', inv })
audit('A1a', 'close this IWM chart', { selection: 'c2' }, 'chart:c2', 'ask', 'pointer-vs-words', 'pointer', ['I4'])
audit('A1b', 'close this IWM chart', { selection: 'c2' }, 'chart:c3', 'ask', 'pointer-vs-words', 'pointer', ['I4'])
audit('A2a', 'close the QQQ one, not this', { selection: 'c3' }, 'chart:c3', 'refuse', 'negated-target', 'negated', ['I5'])
audit('A2b', 'close the QQQ one, not this', { selection: 'c3' }, 'chart:c2', 'resolved:chart:c2', 'named', 'negated', ['I1', 'I5'])
audit('A3', 'clear my alerts on SPY', {}, 'chart:c1', 'refuse', 'type-mismatch', 'cross-type', ['I3'])
audit('A4', 'remove the SPY annotation', {}, 'chart:c1', 'refuse', 'type-mismatch', 'cross-type', ['I3'])
audit('A5', 'close every chart but this one', { selection: 'c2' }, 'chart:c1+chart:c2+chart:c3', 'refuse', 'negated-target', 'negated', ['I5'])
audit('A6', 'remove the RSI and close the chart', { world: 'B3R', selection: 'c1' }, 'ind:c3:rsi+chart:c1', 'refuse', 'plan-outside-words', 'indicator-named', ['I1', 'I2'])
audit('A7', 'remove this RSI', { world: 'B3R', selection: 'c1' }, 'ind:c3:rsi', 'refuse', 'plan-outside-words', 'pointer', ['I1'])
audit('A8', 'drop it from my Tech list', { world: 'ST', previous: 'item:wl1:NVDA' }, 'chart:c2', 'refuse', 'type-mismatch', 'container-thing', ['I3'])
audit('A9', 'close the empty chart', { world: 'B3E' }, 'chart:c1', 'refuse', 'description-mismatch', 'description', ['I1'])
audit('A10', 'close the last chart I opened', { previous: 'chart:c2' }, 'chart:c3', 'refuse', 'plan-outside-words', 'previous-chart', ['I1'])
audit('A11', 'close chart 2', {}, 'chart:c3', 'refuse', 'plan-outside-words', 'ordinal-position', ['I1'])
audit('A12', 'close both index charts', { world: 'B4' }, 'chart:c1+chart:c3', 'refuse', 'plan-outside-words', 'description', ['I1', 'I2'])

// ── per-row flags from the agreement run against master d4dd1cf16d (filled in BELOW the table, never by changing an expectation) ──
// masterGap: master APPLIES a wrong target / misreads a type — the expectation stays the policy's
// overAsk:  master blocks where the policy resolves — expected = master's block for now, `policy` = the policy's resolution
// adds:     the resolver adds an ask / refuse beyond the rails where master's choice is not provably a wrong target
const OFFER_OVERASK = 'master: the removal pronoun ask (resolvePronoun 2+) fires before any pick is read — an answer to the Agent’s own question never resolves "it"; and the removal ask offers no choices at all (railAskRef is set only for re-symbols), so the rail-pick path is emulated'
const over = (policy, why, reason = 'ambiguous-n', expect = 'ask') => ({ overAsk: true, expect, reason, policy, why })
const FLAGS = {
  'rm-appB-011': { masterGap: true, why: 'I1/I3: "add an X, then delete it" = the X THIS turn creates; a plan removing the PRE-EXISTING RSI on c1 is refused. Master licenses it (stateRail permits prevInd: "an RSI" names the unique RSI on c1). Supersedes AUDIT\'s earlier #1247 allowance (11-16 ruling).' },
  'rm-neg-007': { masterGap: true, why: 'I5: "don’t close SPY" — NEGATOR before a removal verb is not a KEPT lead (KEEP_LEAD has don’t touch/change/remove, not close), and identifiesChart reads SPY as named → master CLOSES SPY (wrong target applied).' },
  'rm-neg-010': over('resolved:chart:c3', 'master misreads KEPT: the KEEP_LEAD phrase "the left chart, remove the right one" runs to the end (KEEP_END needs but/then/and-verb), so "right" is read as kept → refuses the right chart the member asked to remove.', 'negated-target', 'refuse'),
  'rm-rel-001': over('resolved:chart:c3', 'master: the removal path does not read RELATIVE ("to the right of this one"); SPECIFIC_CHART "the chart" fits 2 → ask.'),
  'rm-rel-006': { masterGap: true, why: 'I6: "the chart next to the QQQ chart" — the removal path reads QQQ as the NAMED chart (no relation read), so a plan closing the ANCHOR (QQQ) is applied.' },
  'rm-offer-001': over('resolved:chart:c2', OFFER_OVERASK), 'rm-offer-003': over('resolved:chart:c3', OFFER_OVERASK), 'rm-offer-005': over('resolved:chart:c3', OFFER_OVERASK),
  'rm-offer-007': over('resolved:chart:c1', OFFER_OVERASK), 'rm-offer-012': over('resolved:chart:c3', OFFER_OVERASK),
  'rm-offer-015': over('resolved:chart:c3', `R3 single offer + bare confirm may license; ${OFFER_OVERASK}`),
  'rm-ind-002': { masterGap: true, why: 'I1: "the RSI from the SPY chart" — indicatorsNamed reads the class noun per chart (unique on each), the chart the words name is not checked → removing the NVDA chart’s RSI is applied.' },
  'rm-ind-007': { masterGap: true, why: 'absent: "the MACD" matches no instance (indicatorsNamed ids empty) and namesObject falls through to CLASS.indicator (macd is a class word) → the RSI removal is applied.' },
  'rm-ind-008': { adds: true, why: 'I2: RSI on c1 AND c2, the words name no chart; master licenses the plan’s pick (H14 counts per chart). Not a misread — the resolver adds the ask.' },
  'rm-ind-009': { adds: true, why: 'I2: EMA 20 on c1 AND c2, the words name no chart; master licenses the plan’s pick (H14 counts per chart). The resolver adds the ask.' },
  'rm-drw-007': { masterGap: true, why: 'I1: "the horizontal line on SPY" — the NVDA horizontal (dr-n) removal is applied: DTYPE_NOUN names the only horizontal in that drawing’s own scope; the ticker the words name is not checked.' },
  'rm-list-005': { masterGap: true, why: 'I1: the words name AMD; the plan removes NVDA from Tech and is applied (namesObject: "the Tech list" names the list; the row symbol is not checked).' },
  'rm-xtype-002': { masterGap: true, why: 'I3: "remove the RSI from the SPY chart" — a plan CLOSING the SPY chart is applied (REMOVAL gate passes on "remove", identifiesChart names SPY; the thing noun before FROM_CHART types nothing without a pronoun).' },
  'rm-xtype-003': { masterGap: true, why: 'I3: "delete the trendline" — a plan closing chart c1 is applied (REMOVAL gate passes on "delete"; words name no chart → "as before", no type check without a pronoun).' },
  // AUDIT rows (expectations AUDIT's, never altered)
  A1b: { masterGap: true, why: 'I4: "this" points at the clicked QQQ, the words say IWM — a bare conflict asks; master closes IWM (identifiesChart names IWM; the deixis "this" is not weighed against it).' },
  A10: { masterGap: true, why: 'I1: "the last chart I opened" is the previous chart c2; master applies a plan closing c3 (the back-reference reads no "opened"; SPECIFIC_CHART is not reached because "last" names the 3rd chart by ordinal).' },
  A12: { masterGap: true, why: 'I1/I2: "both index charts" — SPY and QQQ are the index charts; master applies closing SPY + NVDA (no description read: "both … charts" is a set removal and passes untargeted).' },
  A2b: { overAsk: true, expect: 'refuse', reason: 'plan-outside-words', policy: 'resolved:chart:c2', why: 'AUDIT ruling 11-16: one overAsk rule, no exceptions — expected = master’s block (refuse); the policy resolution (close QQQ) is kept in `policy`. Master refuses: "the QQQ one" is not read as a chart name in the removal path ("QQQ alone doesn’t say to close a chart" — the bare-ticker guard).' },
  'rm-xtype-004': { masterGap: true, why: 'I3: "delete my Swing watchlist" — a plan closing chart c2 is applied (same: no chart named, no type check without a pronoun).' },
}
for (const r of rows) if (FLAGS[r.id]) Object.assign(r, FLAGS[r.id])
// (AUDIT 11-16) the offer rows run on an EMULATION: reported apart, never counted as resolver wins
export const EMULATED_NOTE = 'master’s removal ask offers no choices; offers emulated as a clicked choice'
for (const r of rows) if (r.id.startsWith('rm-offer-')) Object.assign(r, { emulated: true, emulatedNote: EMULATED_NOTE })

export const POLICY = Object.freeze(rows.map(r => Object.freeze({ ...r, context: Object.freeze({ ...r.context, offers: r.context.offers ? Object.freeze({ ...r.context.offers, refs: Object.freeze([...r.context.offers.refs]) }) : null }), ...(r.inv ? { inv: Object.freeze([...r.inv]) } : {}) })))
export default POLICY

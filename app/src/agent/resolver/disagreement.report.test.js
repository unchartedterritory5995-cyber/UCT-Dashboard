// ── D31 RESOLVER P2 · the SHADOW-DISAGREEMENT REPORT, grouped by REUSABLE CAUSE (test artefact only — AUDIT R2) ─────────────
// Lists, for the PL / AUDIT:
//   1. every oracle row where the resolver's verdict ≠ the oracle's (the policy; `policy` on an overAsk row) — must be none;
//   2. every oracle row where the oracle ≠ the PRODUCTION path (the rails: chart rail → state rail, as useAgent.railOf composes
//      them) — the masterGap rows (production applies where the policy blocks), the overAsk rows (production blocks where the
//      policy resolves), the adds rows, and any UNFLAGGED row (must be none: policy.test.js fails those);
//   3. the generated suites (matrix · metamorphic · sequences · P2 relation families + confirmation + undo) — the same two
//      comparisons, policy = the generator's independent model.
// A CAUSE is computed from the case, never written per sentence: rails → policy · the policy's code / source · the plan's type
// (chart | thing) · what the words' evidence names (type / source). One cause = one family a single rail fix would close; FIXES
// names the fix for the known causes. RESOLVER_REPORT=1 prints it; RESOLVER_DISAGREE_OUT=<file> writes the JSON.
// No production telemetry, no endpoint, no words / tickers in the JSON's cause keys (ids and words only in the example lists).
import { describe, it, expect, afterAll } from 'vitest'
import { registerBuiltins } from '../builtins'
import { pickedChoice } from '../deixis'
import { POLICY } from './policy'
import { resolve } from './resolve'
import { readRemoval } from './families/removal'
import { worldFromHost } from './world'
import { boardHost, hostOf, worldOfRow, mapRef, planOfRow } from './testing/oracleWorld'
import { matrixCases, metamorphicCases, sequenceRuns } from './testing/generate'
import { relationCases, confirmationCases, undoCases } from './testing/relations'
import { railOutcome } from './testing/rails'

registerBuiltins()

const kindOf = (id) => (String(id).startsWith('chart:') ? 'chart' : 'thing')
const vOf = (e) => (String(e).startsWith('resolved') ? 'resolved' : e)
const railV = (v) => (v === 'allow' ? 'resolved' : v)
/** What the words' evidence names: the first group's type class and source ('none' when nothing). */
function wordsOf(reading) {
  const g = reading.groups[0]
  if (!g) return reading.cont ? 'continuation' : 'none'
  const t = g.type === 'chart' ? 'chart' : 'thing'
  return `${t}/${g.made ? 'made-this-turn' : g.absent ? 'absent' : g.source}`
}
/** The reusable cause of a (production ≠ policy) or (resolver ≠ policy) case. */
function causeOf({ prod, want, reason, plan, reading }) {
  return `${prod}→${want} · ${reason} · plan ${[...new Set(plan.map(kindOf))].join('+')} · words ${wordsOf(reading)}`
}
// the single rail fix that would close each known cause family (hand-written per FAMILY, never per sentence)
const RAIL_RELATIONS = 'chartRail removal path: read the P2 relation families (resolver/families/removal.js relationFamilies — complement · both · order; deixis relativeChart for neighbours) before SPECIFIC_CHART / the bare class noun'
const FIXES = {
  // (generated families: the cause key carries the generator form)
  'resolved→refuse · anchor-as-target · plan chart · words chart/relation · form complement': `${RAIL_RELATIONS} — "the other one / the others / the rest" EXCLUDES the anchor (click / conversation chart / previous chart): production closes the anchor (I6)`,
  'resolved→ask · ambiguous-n · plan chart · words chart/relation · form complement': `${RAIL_RELATIONS} — a complement that fits 2+ objects or not the count said ("the other two" on four charts) is asked, never a pick (I2)`,
  'resolved→ask · ambiguous-n · plan chart · words chart/relation · form both': `${RAIL_RELATIONS} — "both of them" says TWO: without a two-object pointer set or a two-chart board it is asked (I2)`,
  'resolved→refuse · plan-outside-words · plan chart · words chart/relation · form both': `${RAIL_RELATIONS} — "both of them" = the click + the conversation chart; a third chart is outside the words (I1)`,
  'resolved→refuse · anchor-as-target · plan chart · words chart/relation · form order': `${RAIL_RELATIONS} — "the chart after / before X" is X's reading-order neighbour, never X (I6)`,
  'resolved→refuse · anchor-as-target · plan chart · words chart/relation · form neighbour': 'chartRail removal path: on a two-chart board the click is still only the ANCHOR of "the chart next to this one" (I6)',
  'refuse→resolved · relation · plan chart · words chart/relation · form order': `${RAIL_RELATIONS} — over-block: production refuses the order neighbour itself`,
  'refuse→resolved · relation · plan chart · words chart/relation · form neighbour': `${RAIL_RELATIONS} — over-block: production refuses the neighbour on a two-chart board`,
  'resolved→refuse · type-mismatch · plan chart · words thing/named': 'chartRail REMOVAL gate: a named THING noun with no chart noun types the request — a chart close is a type mismatch without a pronoun too (I3)',
  'resolved→refuse · plan-outside-words · plan thing · words thing/named': 'stateRail namesObject / indicatorsNamed: check the SCOPE the words name (the chart, the ticker, the list row) against the plan target, not only the class noun (I1)',
  'resolved→refuse · absent · plan thing · words thing/absent': 'stateRail namesObject: a named object with no instance must not fall through to CLASS (I1 absent)',
  'resolved→refuse · negated-target · plan chart · words chart/named': 'chartRail KEEP_LEAD: a negator before a removal verb ("don’t close X") is a KEPT lead (I5)',
  'resolved→refuse · anchor-as-target · plan chart · words chart/relation': 'chartRail removal path: read the named-anchor relation (spatialCheck namedAnchorRelation) — the anchor is never the target (I6)',
  'resolved→refuse · plan-outside-words · plan thing · words thing/made-this-turn': 'stateRail permits: "add an X, then delete it" names the X made THIS turn, never a pre-existing one (I1/I3)',
  'resolved→ask · pointer-vs-words · plan chart · words chart/named': 'chartRail identifiesChart: weigh "this/that <named chart>" against the click — a conflict asks (I4)',
  'resolved→refuse · plan-outside-words · plan chart · words chart/previous': 'chartRail back-reference: "the last chart I opened" is the previous chart, not the ordinal last (I1)',
  'resolved→refuse · plan-outside-words · plan chart · words chart/description': 'chartRail removal path: read chart DESCRIPTIONS ("both index charts") as a set, not untargeted (I1/I2)',
  'resolved→ask · ambiguous-n · plan thing · words thing/named': 'stateRail H14 counts per chart: an instance on 2+ charts with no chart named asks (I2) — an ADD',
  'ask→resolved · relation · plan chart · words chart/relation': 'chartRail removal path: read RELATIVE / relation families (deixis relativeChart) before SPECIFIC_CHART "the chart" — over-ask (policy resolves)',
  'ask→resolved · answer · plan chart · words chart/answer': 'useAgent removal ask: offer choices and read the answer (railPickedRef) before the pronoun ask — over-ask (emulated rows)',
  'refuse→resolved · ordinal-position · plan chart · words chart/ordinal-position': 'chartRail KEEP_END: end a KEEP_LEAD phrase at a comma + removal verb ("leave the left chart, remove the right one") — over-ask',
  'refuse→resolved · named · plan chart · words chart/named': 'chartRail bare-ticker guard: "the QQQ one" is a chart name in the removal path — over-ask',
}

// ── 1 + 2 · the oracle rows ──
const ORACLE = { resolverDisagree: [], prodDiffers: [], reasonDiffers: [], rows: 0 }
async function oracleRow(r) {
  const host0 = hostOf(r.context.world)
  const host = { ...host0, charts: { ...host0.charts, selected: () => r.context.selection, canManageIndicators: () => true, canCreateIndicator: () => true, previewHost: () => null } }
  const hw = worldOfRow(r.context, mapRef)
  const live = r.context.offers && !r.context.offers.stale
  const carried = live ? r.context.offers.carried : null
  const plan = planOfRow(hw, r.plan)
  const rz = resolve({ words: { typed: r.words, carried }, planTargets: plan, world: hw })
  const reading = readRemoval({ words: { typed: r.words, carried }, world: hw, planTargets: plan })
  const policy = r.overAsk ? r.policy : r.expect
  let picked = null
  if (live) {
    const choices = r.context.offers.refs.map(ref => ({ ref, label: `the ${hw.charts.find(c => c.ref === ref)?.symbol} chart` }))
    const p = pickedChoice(r.words, choices)
    if (p) picked = new Set([`chart:${p}`])
  }
  const rails = await railOutcome(host, hw, plan, { words: r.words, carried, subject: r.context.subject, previous: hw.previous, picked })
  const prod = railV(rails.verdict)
  const want = vOf(policy)
  const flag = r.emulated ? 'emulated' : r.masterGap ? 'masterGap' : r.overAsk ? 'overAsk' : r.adds ? 'adds' : 'plain'
  const row = { id: r.id, flag, words: r.words, plan: r.plan, prod, want, resolver: rz.verdict, reason: rz.reason, cause: causeOf({ prod, want, reason: want === 'resolved' ? reading.groups.find(g => !g.ask)?.source || rz.reason : (r.overAsk ? rz.reason : r.reason), plan, reading }) }
  ORACLE.rows++
  if (rz.verdict !== want) ORACLE.resolverDisagree.push(row)
  // (blocked vs blocked of another kind is no production gap: the rails have no ask for most destroys — counted apart)
  const blocked = (v) => v !== 'resolved'
  if (prod !== want && !(blocked(prod) && blocked(want) && !r.overAsk)) ORACLE.prodDiffers.push(row)
}

// ── 3 · the generated suites ──
const HOSTS = new Map()
function hostFor(world) {
  const syms = world.charts.map(c => c.symbol)
  const rsiOn = [...new Set((world.indicators || []).map(i => i.chart))]
  const key = JSON.stringify([syms, rsiOn])
  if (!HOSTS.has(key)) HOSTS.set(key, boardHost(syms, { rsiOn }))
  const h = HOSTS.get(key)
  return { ...h, charts: { ...h.charts, selected: () => world.selection ?? null, canManageIndicators: () => true, canCreateIndicator: () => true, previewHost: () => null } }
}
const hostId = (hw, id) => (String(id).startsWith('ind:') ? hw.indicators.find(i => i.chart === String(id).split(':')[1] && i.defId === 'rsi')?.id || id : id)
const GEN = { cases: 0, skipped: 0, resolverDisagree: [], prodDiffers: [], bySuite: {} }
async function generated(suite, c) {
  // (the rails' fixture board has no link groups: a linked shape is the resolver's own suite — relation.family.test.js)
  if (c.world.charts.some(x => x.group && x.group !== 'N')) { GEN.skipped++; return }
  const host = hostFor(c.world)
  const hw = worldFromHost(host, { selection: c.world.selection, subject: c.world.subject })
  hw.offers = c.world.offers
  const previous = c.world.previous ? hostId(hw, c.world.previous) : null
  hw.previous = previous
  const plan = c.plan.map(id => hostId(hw, id))
  const carried = c.carried || (c.world.offers && !c.world.offers.stale ? c.world.offers.carried : null)
  const picked = (() => {
    if (!hw.offers || hw.offers.stale) return null
    const choices = hw.offers.refs.map(ref => ({ ref, label: `the ${hw.charts.find(x => x.ref === ref)?.symbol} chart` }))
    const p = pickedChoice(c.words, choices)
    return p ? new Set([`chart:${p}`]) : null
  })()
  const rails = await railOutcome(host, hw, plan, { words: c.words, carried, subject: hw.subject, previous, picked })
  if (!rails.plan?.ok) { GEN.skipped++; return }
  const rz = resolve({ words: { typed: c.words, carried }, planTargets: plan, world: hw })
  const reading = readRemoval({ words: { typed: c.words, carried }, world: hw, planTargets: plan })
  GEN.cases++
  const prod = railV(rails.verdict)
  const want = c.expect
  const form = c.family || c.form || c.rel || (c.cmd ? 'sequence' : '?')
  const reason = want === 'resolved' ? (reading.groups.find(g => !g.ask)?.source || rz.reason) : rz.reason
  const row = { id: c.id || c.cmd, suite, form, words: c.words, plan: plan.join('+'), prod, want, resolver: rz.verdict, reason: rz.reason, cause: `${causeOf({ prod, want, reason, plan, reading })} · form ${form === 'sequence' ? 'sequence' : form}` }
  ;(GEN.bySuite[suite] ||= { cases: 0, prodDiffers: 0, resolverDisagree: 0 }).cases++
  if (rz.verdict !== want) { GEN.resolverDisagree.push(row); GEN.bySuite[suite].resolverDisagree++ }
  const blocked = (v) => v !== 'resolved'
  if (prod !== want && !(blocked(prod) && blocked(want))) { GEN.prodDiffers.push(row); GEN.bySuite[suite].prodDiffers++ }
}

describe('SHADOW-DISAGREEMENT REPORT · grouped by reusable cause', () => {
  it('oracle rows: resolver vs oracle, oracle vs production', async () => {
    for (const r of POLICY) await oracleRow(r)
    expect(ORACLE.rows).toBe(POLICY.length)
    // the resolver gives the policy on every non-emulated row
    expect(ORACLE.resolverDisagree.filter(x => x.flag !== 'emulated').map(x => x.id)).toEqual([])
    // every production ≠ policy row is a FLAGGED one (masterGap / overAsk / adds / emulated) — none unflagged
    expect(ORACLE.prodDiffers.filter(x => x.flag === 'plain').map(x => x.id)).toEqual([])
    // every masterGap row is still open in production (a closed one: drop its flag through AUDIT)
    const gaps = POLICY.filter(r => r.masterGap).map(r => r.id)
    expect(ORACLE.prodDiffers.filter(x => x.flag === 'masterGap').map(x => x.id).sort()).toEqual([...gaps].sort())
  }, 120000)
  for (const [suite, cases] of [['matrix', () => matrixCases(31)], ['metamorphic', () => metamorphicCases(32)],
    ['sequences', () => sequenceRuns(33).flatMap(run => run.steps.filter(s => s.plan).map((s, i) => ({ ...s, id: `seq-${run.seed}-${i}` })))],
    ['relations', () => relationCases(41)], ['confirmation', () => confirmationCases(relationCases(41))], ['undo', () => undoCases(42)]]) {
    it(`generated · ${suite}`, async () => {
      for (const c of cases()) await generated(suite, c)
    }, 300000)
  }
  it('generated: the resolver never applies where the model blocks', () => {
    expect(GEN.cases).toBeGreaterThan(2500)
    // (resolver ≠ model on the RAILS' fixture host is reported, not failed: that host words positions by grid halves — on four
    // charts "the chart on the left" is the left HALF, two charts — where the generator's abstract board names one. The
    // resolver's own suites assert the model on the generator's worlds. A wrong-target apply fails here too.)
    expect(GEN.resolverDisagree.filter(x => x.resolver === 'resolved').map(x => x.id)).toEqual([])
  })
})

/** [{ cause, count, fix, ids, examples }] sorted by count. */
function families(rows) {
  const m = new Map()
  for (const x of rows) { const k = x.cause; if (!m.has(k)) m.set(k, []); m.get(k).push(x) }
  return [...m].map(([cause, xs]) => ({ cause, count: xs.length, fix: FIXES[cause] || FIXES[cause.split(' · ').slice(0, 4).join(' · ')] || null, suites: [...new Set(xs.map(x => x.suite).filter(Boolean))], ids: xs.map(x => x.id), examples: xs.slice(0, 3).map(x => `${x.id} "${x.words}" plan ${x.plan}`) }))
    .sort((a, b) => b.count - a.count || a.cause.localeCompare(b.cause))
}
afterAll(async () => {
  const report = {
    oracle: { rows: ORACLE.rows, resolverDisagree: ORACLE.resolverDisagree, reasonDiffers: ORACLE.reasonDiffers,
      masterGap: families(ORACLE.prodDiffers.filter(x => x.flag === 'masterGap')), overAsk: families(ORACLE.prodDiffers.filter(x => x.flag === 'overAsk')),
      adds: families(ORACLE.prodDiffers.filter(x => x.flag === 'adds')), emulated: families(ORACLE.prodDiffers.filter(x => x.flag === 'emulated')),
      unflagged: ORACLE.prodDiffers.filter(x => x.flag === 'plain') },
    generated: { cases: GEN.cases, skipped: GEN.skipped, bySuite: GEN.bySuite, resolverDisagree: families(GEN.resolverDisagree),
      // production APPLIES where the model blocks (a gap) / production BLOCKS where the model resolves (an over-ask)
      prodApplies: families(GEN.prodDiffers.filter(x => x.prod === 'resolved')), prodBlocks: families(GEN.prodDiffers.filter(x => x.prod !== 'resolved')) },
  }
  const fam = (title, xs) => [`${title}: ${xs.reduce((n, f) => n + f.count, 0)} in ${xs.length} famil${xs.length === 1 ? 'y' : 'ies'}`, ...xs.map(f => `  [${f.count}] ${f.cause}${f.fix ? `\n        FIX: ${f.fix}` : ''}\n        e.g. ${f.examples.join(' | ')}`)]
  const text = [
    `DISAGREEMENT REPORT · oracle rows ${ORACLE.rows} · resolver ≠ oracle: ${ORACLE.resolverDisagree.length} (${ORACLE.resolverDisagree.map(x => `${x.id}[${x.flag}]`).join(', ') || 'none'})`,
    ...fam('ORACLE masterGap (production applies, the policy blocks)', report.oracle.masterGap),
    ...fam('ORACLE overAsk (production blocks, the policy resolves)', report.oracle.overAsk),
    ...fam('ORACLE adds (the resolver adds a block)', report.oracle.adds),
    ...fam('ORACLE emulated (offer rows, apart)', report.oracle.emulated),
    `ORACLE unflagged production ≠ policy: ${report.oracle.unflagged.length}`,
    `GENERATED · cases ${GEN.cases} · skipped ${GEN.skipped} (linked shapes / unbuilt plans) · ${Object.entries(GEN.bySuite).map(([k, v]) => `${k} ${v.cases} (prod≠model ${v.prodDiffers}, resolver≠model ${v.resolverDisagree})`).join(' · ')}`,
    ...fam('GENERATED resolver ≠ model', report.generated.resolverDisagree),
    ...fam('GENERATED production APPLIES where the model blocks', report.generated.prodApplies),
    ...fam('GENERATED production BLOCKS where the model resolves', report.generated.prodBlocks),
  ].join('\n')
  if (globalThis.process?.env?.RESOLVER_REPORT) console.log(text)
  if (globalThis.process?.env?.RESOLVER_DISAGREE_OUT) { const fs = await import('node:fs'); fs.writeFileSync(globalThis.process.env.RESOLVER_DISAGREE_OUT, JSON.stringify(report, null, 1)) }
})

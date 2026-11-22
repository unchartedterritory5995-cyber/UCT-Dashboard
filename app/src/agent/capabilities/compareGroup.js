// ── COMPARE GROUPS (C1-035 / C1-037 / C1-040) ───────────────────────────────────────────────────
//
// chartSetup.compareGroup: the Compare Symbols panel's GROUP controls on ONE chart (Tools → Compare Symbols):
//   add    the group picker (Themes / Sectors / Industries → search → click a group): every member overlaid
//   remove the group row's ×: every member of that group off the chart
//   scale  the group row's "Same % scale" / "New price scale": every member of that group
//
// ⭐ The SAME writers the panel uses: compareGroups.withGroupAdded / withoutGroup / withGroupScale compute the
// next comparisonSymbols list for both, and the group is looked up through the panel's own reads
// (/api/compare/groups, /api/compare/group-members). A group name is matched by UCT itself: one match acts,
// more than one asks with the real names, none says so — never a guess. A read that FAILS says the list is
// unavailable; it is never reported as "no such group".
//
// Undo is the chart kind's exact Undo (the whole comparison list before). Removing a group is the panel's ×,
// which asks nothing; it is undoable, so no confirmation card.

import { registerCapability } from '../capabilities'
import { pickComparisonColor } from '../../components/chart/comparisonUtils'
import { GROUP_TYPES, readGroupList, fetchGroupMembers, withGroupAdded, withoutGroup, withGroupScale, groupsIn } from '../../pages/charts/compareGroups'

const TYPES = GROUP_TYPES.map(t => t.key)            // theme | sector | industry
const comps = (cs) => (Array.isArray(cs?.comparisonSymbols) ? cs.comparisonSymbols : [])
const sameJson = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const quote = (s) => `“${s}”`
const NOTHING = 'Nothing was changed.'

// Words that say "a group" without naming one ("the semis group", "my theme overlay").
const FILLER = new Set(['the', 'my', 'a', 'an', 'this', 'that', 'group', 'groups', 'sector', 'sectors', 'industry', 'industries',
  'theme', 'themes', 'stocks', 'names', 'overlay', 'overlays', 'basket', 'comparison', 'comparisons', 'lines', 'line'])
const norm = (s) => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim()
const stem = (w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w)
const wordsOf = (s) => norm(s).split(' ').filter(Boolean)

/** The phrase as the words that name a group ([] = no name given). */
export const nameWords = (phrase) => wordsOf(phrase).filter(w => !FILLER.has(w))

/**
 * Match a spoken group name against candidates `[{ name, type? }]`.
 * → `{ hit }` (exactly one), `{ many: [...] }` (more than one), or `{ none: true }`.
 * An exact name wins over partial ones; otherwise every word said must start a word of the name
 * ("semis" → Semiconductors; "ai chips" → AI Chips).
 */
export function matchGroup(phrase, candidates) {
  const said = nameWords(phrase)
  if (!said.length) return candidates.length === 1 ? { hit: candidates[0] } : { many: candidates }
  const whole = said.join(' ')
  const exact = candidates.filter(c => nameWords(c.name).join(' ') === whole)
  if (exact.length === 1) return { hit: exact[0] }
  if (exact.length > 1) return { many: exact }
  const ss = said.map(stem)
  const hits = candidates.filter(c => {
    const ws = wordsOf(c.name).map(stem)
    return ss.every(t => ws.some(w => w.startsWith(t)))
  })
  if (hits.length === 1) return { hit: hits[0] }
  return hits.length ? { many: hits } : { none: true }
}

const typeWord = (t) => (t === 'industry' ? 'industry' : t === 'sector' ? 'sector' : 'theme')
const kindsWord = (types) => (types.length === 1 ? typeWord(types[0]) : 'theme, sector or industry')
function namesOf(list, withType) {
  const shown = list.slice(0, 8).map(c => (withType && c.type ? `${c.name} (${typeWord(c.type)})` : c.name))
  return shown.join(', ') + (list.length > 8 ? `, and ${list.length - 8} more` : '')
}
const keyOf = (args) => JSON.stringify([String(args?.groupType || 'any'), norm(args?.group)])

/** Look up one "add" request through the panel's own reads → the env entry its check/apply use. */
async function lookUp(args) {
  const types = TYPES.includes(args?.groupType) ? [args.groupType] : TYPES
  if (!nameWords(args?.group).length) return { refuse: `Which ${kindsWord(types)} should I compare? Name the group. ${NOTHING}` }
  const lists = await Promise.all(types.map(t => readGroupList(t)))
  const failed = types.filter((t, i) => lists[i] == null)
  const candidates = types.flatMap((t, i) => (lists[i] || []).map(g => ({ name: g.name, type: t, count: g.count })))
  const m = matchGroup(args.group, candidates)
  // ⛔ a list that could not be read is never "no such group": only an exact single match elsewhere may act
  if (failed.length && !(m.hit && nameWords(m.hit.name).join(' ') === nameWords(args.group).join(' '))) {
    return { refuse: `I couldn't read the ${failed.map(typeWord).join(' and ')} list just now, so I can't tell which group ${quote(args.group)} is. ${NOTHING}` }
  }
  if (m.many) return { refuse: `More than one group matches ${quote(args.group)}: ${namesOf(m.many, types.length > 1)}. Which one did you mean? ${NOTHING}` }
  if (m.none) return { refuse: `UCT has no ${kindsWord(types)} called ${quote(args.group)}. ${NOTHING}` }
  const mem = await fetchGroupMembers(m.hit.type, m.hit.name)
  if (!mem) return { refuse: `I couldn't read the members of ${m.hit.name} just now. ${NOTHING}` }
  if (!mem.symbols.length) return { refuse: `${m.hit.name} has no symbols to compare. ${NOTHING}` }
  return { group: { name: m.hit.name, type: m.hit.type, symbols: mem.symbols, total: mem.total, truncated: mem.truncated } }
}

/** The group on THIS chart the words name (remove / scale) → `{ name }` or `{ refuse }`. */
function onChart(st, phrase) {
  const groups = groupsIn(comps(st.cs))
  if (!groups.length) return { refuse: `This chart has no compared groups. Add one first, for example "compare against the Semiconductors industry". ${NOTHING}` }
  const m = matchGroup(phrase, groups)
  if (m.hit) return { name: m.hit.name, count: m.hit.count }
  if (m.many) return { refuse: `This chart compares ${m.many.length} groups that could be ${quote(String(phrase || 'that'))}: ${namesOf(m.many)}. Which one did you mean? ${NOTHING}` }
  return { refuse: `No group called ${quote(phrase)} is compared on this chart (it compares ${namesOf(groups)}). ${NOTHING}` }
}

// StockChart forces percent while any "new scale" overlay is on; the Compare panel never leaves log or percent beside
// one (the same rule as chart.compare and chartSetup.compareDisplay).
function withScaleRule(cs, list) {
  const next = { ...cs, comparisonSymbols: list, preset: 'custom' }
  if (list.some(x => x.enabled && (x.scaleMode || 'new') !== 'same') && (next.percentScale || next.logScale)) { next.percentScale = false; next.logScale = false }
  return next
}

let registered = false
export function registerCompareGroupCapability() {
  if (registered) return
  registered = true
  registerCapability({
    target: 'chart', surfaces: ['charts'], available: (ctx) => ctx.surface === 'charts',
    name: 'chartSetup.compareGroup',
    summary: 'Compare ONE chart against a whole GROUP (Tools → Compare Symbols → Themes / Sectors / Industries): add every member of a theme, sector or industry as overlay lines, remove a compared group, or put a compared group on the main price scale ("same") or its own % scale ("new"). For single tickers use chart.compare.',
    hints: 'action = add | remove | scale. group = the group\'s name as the member said it ("semis", "AI Chips", "Technology"); UCT matches it itself and asks when it could be more than one, so pass the words, never a guess. groupType = theme | sector | industry when the member said which, else any. scale = same | new for action scale, else null. "Compare NVDA against the semis group" = target the NVDA chart, action add, group "semis".',
    args: { type: 'object', properties: {
      action: { type: 'string', enum: ['add', 'remove', 'scale'] }, group: { type: 'string' },
      groupType: { type: 'string', enum: ['any', ...TYPES] }, scale: { type: ['string', 'null'], enum: ['same', 'new', null] },
    }, required: ['action', 'group', 'groupType', 'scale'], additionalProperties: false },
    async prepare(ops) {
      const out = new Map()
      for (const o of ops) if (o?.args?.action === 'add' && !out.has(keyOf(o.args))) out.set(keyOf(o.args), await lookUp(o.args))
      return { compareGroups: out }
    },
    check(st, args, env) {
      const { action, group, scale } = args || {}
      if (action === 'add') {
        const r = env?.compareGroups?.get?.(keyOf(args))
        if (!r) return `I couldn't look that group up. ${NOTHING}`
        return r.refuse || null
      }
      if (action === 'scale' && scale !== 'same' && scale !== 'new') return 'Same % scale (the main price scale) or New price scale (its own)?'
      if (action !== 'remove' && action !== 'scale') return 'Add a group, remove one, or change a group\'s scale?'
      return onChart(st, group).refuse || null
    },
    apply(st, args, env) {
      const list = comps(st.cs)
      let next
      if (args.action === 'add') {
        const g = env.compareGroups.get(keyOf(args)).group
        next = withGroupAdded(list, g.name, g.symbols, pickComparisonColor)
      } else {
        const { name } = onChart(st, args.group)
        next = args.action === 'remove' ? withoutGroup(list, name) : withGroupScale(list, name, args.scale)
      }
      return sameJson(next, list) ? st : { ...st, cs: withScaleRule(st.cs, next) }
    },
    describe(b, a, args, env) {
      const was = comps(b.cs), now = comps(a.cs)
      if (sameJson(was, now)) return null
      if (args.action === 'add') {
        const g = env?.compareGroups?.get?.(keyOf(args))?.group
        const added = now.filter(x => !was.some(y => y.sym === x.sym)).map(x => x.sym)
        const kept = g ? g.symbols.length - added.length : 0
        const cut = g?.truncated ? ` (the first ${g.symbols.length} of its ${g.total}, as the Compare panel adds)` : ''
        return `Comparing ${a.symbol || 'this chart'} with the ${g?.name || 'group'} ${typeWord(g?.type)}: ${added.length} symbol${added.length === 1 ? '' : 's'} added${cut}${kept > 0 ? `, ${kept} already compared` : ''} — ${added.slice(0, 10).join(', ')}${added.length > 10 ? ', …' : ''}`
      }
      const { name, count } = onChart(b, args.group)
      if (args.action === 'remove') return `Removed the ${name} group (${count} symbol${count === 1 ? '' : 's'}) from this chart's comparisons`
      return `The ${name} group is now on ${args.scale === 'same' ? 'the main price scale (Same % scale)' : 'its own % scale (New price scale)'}`
    },
    noop: (b, a, args) => (args?.action === 'add' ? 'Every symbol in that group is already compared on this chart'
      : 'That group already uses that scale'),
  })
}

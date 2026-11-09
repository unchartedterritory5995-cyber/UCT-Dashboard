// UCT Agent AUTOTEST: root-cause layer of a failure, and dedupe into families. Pure and rule-based, so the same evidence
// always lands in the same layer. It is a FIRST sort for a fix worker: it reads the evidence, it does not prove a cause.
export const LAYERS = ['capability', 'metadata', 'schema', 'interpretation', 'target', 'composition', 'ui-state', 'validation', 'primitive', 'guide', 'data', 'read-back']
export const NON_PRODUCT = ['harness', 'oracle']

const planActions = (ev) => ev.turns.flatMap(t => (t.envelope?.ops || []).map(o => o.action))
const sameMulti = (a, b) => [...a].sort().join() === [...b].sort().join()
const words = (ev) => ev.turns.map(t => t.last || '').join(' // ')

/** → { layer, why } for a request that failed. `known`: the action names in the manifest. */
export function classify(request, ev, result, { known = null, mode = 'SIMULATED' } = {}) {
  const failed = result.checks.filter(c => c.pass === false)
  const tags = new Set(failed.map(c => c.tag))
  const said = words(ev)
  const expected = (request.turns || []).flatMap(t => (t.plan?.ops || []).map(o => o.action))
  const got = planActions(ev)
  if (ev.crash) return { layer: 'harness', why: ev.crash.slice(0, 200) }
  if (tags.has('guide')) return { layer: 'guide', why: failed.find(c => c.tag === 'guide').name }
  if (tags.has('prewarm')) return { layer: 'ui-state', why: 'the one-off definitions redraw (#948) went over its bound' }
  if (tags.has('repaint') && failed.every(c => c.tag === 'repaint' || c.tag === 'console')) return { layer: 'ui-state', why: 'a chart the request did not touch repainted' }
  if (known && expected.some(a => !known.has(a))) return { layer: 'capability', why: `no capability: ${expected.filter(a => !known.has(a)).join()}` }
  if (/the model was not given|not given:/i.test(said)) return { layer: 'metadata', why: 'the action was not offered to the planner after the reroute' }
  if (/missing:\$/.test(JSON.stringify(ev.turns.map(t => t.envelope?.ops || [])))) return { layer: 'metadata', why: 'the request did not carry the target a planner needs' }
  if (mode === 'REAL-MODEL') {
    if (ev.turns.some(t => t.unreadable)) return { layer: 'schema', why: 'the model output could not be read' }
    if (expected.length && !got.length && /can.?t|cannot|unable|not able|don.?t have|isn.?t something/i.test(said)) return { layer: 'capability', why: 'the model said it cannot' }
    if (expected.length && !sameMulti(expected, got) && ev.turns.every(t => t.modelCalls > 0)) return { layer: 'interpretation', why: `planned ${got.join() || 'nothing'}, expected ${expected.join()}` }
  }
  // no model was asked: the browser's instant path took the words and answered them itself
  if (expected.length && ev.turns.length && ev.turns.every(t => t.modelCalls === 0 && !t.envelope) && (tags.has('state') || tags.has('receipt'))) return { layer: 'interpretation', why: `the instant path took it, no model call: ${said.slice(-120)}` }
  if (tags.has('target')) return { layer: 'target', why: failed.find(c => c.tag === 'target').name }
  const refused = /didn.?t change anything|nothing was changed|nothing changed|refused|isn.?t a|is not a|not valid|can.?t|cannot/i.test(said)
  if (request.oracle.outcome === 'refuse' && (tags.has('unchanged') || tags.has('receipt'))) return { layer: 'validation', why: 'an invalid or unsupported request changed something' }
  if (request.oracle.outcome === 'clarify') return { layer: 'interpretation', why: 'it acted or answered where it had to ask' }
  if (tags.has('readback')) return { layer: 'read-back', why: 'a success receipt with no change on the board' }
  if (tags.has('says') && !tags.has('state') && !tags.has('unchanged')) return { layer: 'read-back', why: failed.find(c => c.tag === 'says').name }
  if (tags.has('state') || tags.has('receipt')) {
    if (expected.length > 1 && (ev.turns.some(t => t.newReceipt) || refused)) return { layer: 'composition', why: 'a multi-step plan landed partly or was refused whole' }
    if (ev.turns.some(t => t.newReceipt) && tags.has('state')) {
      if (failed.some(c => c.tag === 'state' && /pixels|panes|chips|\.tf|\.sym|\.scale|face/.test(c.name))) return { layer: 'ui-state', why: 'the Agent reported it, the component did not show it' }
      return { layer: 'primitive', why: 'the action ran and the state did not move' }
    }
    if (refused) return { layer: 'validation', why: `refused a valid plan: ${said.slice(0, 120)}` }
    if (/no data|unavailable|no bars|couldn.?t load/i.test(said)) return { layer: 'data', why: said.slice(0, 120) }
    return { layer: 'primitive', why: 'nothing happened' }
  }
  if (tags.has('undo')) return { layer: 'primitive', why: 'Undo did not restore the board' }
  if (tags.has('persist')) return { layer: 'primitive', why: 'the change was not written to its store' }
  if (tags.has('unchanged')) return { layer: 'target', why: 'a read or refusal changed the board' }
  if (tags.has('confirm')) return { layer: 'validation', why: 'the confirmation policy did not hold' }
  if (tags.has('console')) return { layer: 'ui-state', why: 'console error' }
  return { layer: 'harness', why: `unclassified: ${failed[0]?.name}` }
}

const norm = (s) => String(s || '').replace(/\b[A-Z]{2,5}\b/g, 'SYM').replace(/[0-9]+(\.[0-9]+)?/g, 'N').replace(/w-chart-[ab]|c-[tb][lr]|\b[AB]\b/g, 'X').slice(0, 80)
/** Failures → families: same layer, same primary action, same failing check once symbols and numbers are stripped. */
export function dedupe(failures) {
  const fam = new Map()
  for (const f of failures) {
    const action = f.expectedActions?.[0] || f.kind
    const key = `${f.layer}|${action}|${norm(f.firstCheck)}`
    if (!fam.has(key)) fam.set(key, { family: key, layer: f.layer, action, check: f.firstCheck, count: 0, requests: [], sample: f.id })
    const g = fam.get(key)
    g.count++
    g.requests.push(f.id)
  }
  return [...fam.values()].sort((a, b) => b.count - a.count)
}

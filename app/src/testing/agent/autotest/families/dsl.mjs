// UCT Agent AUTOTEST: the request-writing vocabulary. A request is plain data: board, turns (what a person types, in order,
// with the plan the SCRIPTED model answers; REAL-MODEL ignores `plan`), and a machine-checkable oracle.
export const KINDS = ['phrasing', 'params', 'target', 'combo', 'followup', 'multistep', 'unsupported', 'invalid', 'howto']
export const op = (action, target, args = {}) => ({ action, target, args })
export const say = (text, ops = [], extra = {}) => ({ say: text, plan: Array.isArray(ops) ? { ops } : ops, ...extra })

/** `fam(name, defaults)` → add(kind, turnsOrText, opsOrNull, oracle, extra). Ids are stable: family-NN. */
export function family(list, name, defaults = {}) {
  let n = 0
  return (kind, text, ops, oracle, extra = {}) => {
    n += 1
    const turns = Array.isArray(text) ? text : [say(text, ops || [])]
    list.push({ id: `${name}-${String(n).padStart(2, '0')}`, family: name, kind, inventory: defaults.inv || [], board: defaults.board || 'TWO', select: defaults.select === undefined ? 'A' : defaults.select, turns, oracle, unverifiable: defaults.unverifiable || [], ...extra })
  }
}

/** Oracle shorthands. */
export const changes = (only, expect, o = {}) => ({ outcome: 'change', only, expect, ...o })
export const refuses = (o = {}) => ({ outcome: 'refuse', ...o })
export const asks = (o = {}) => ({ outcome: 'clarify', ...o })
export const reads = (o = {}) => ({ outcome: 'read', ...o })
export const answers = (o = {}) => ({ outcome: 'answer', ...o })
export const unsupported = (reply) => ({ disposition: 'unsupported', reply, ops: [] })
export const answer = (reply) => ({ disposition: 'answer', reply, ops: [] })
export const clarify = (text, choices) => ({ disposition: 'clarify', question: { text, choices }, ops: [] })
export const propose = (ops) => ({ disposition: 'propose', ops })

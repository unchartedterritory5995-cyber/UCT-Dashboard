// The pre-entry checklist's items (spec §P2 item 1): the setup's checklist (settings.setupRules,
// "{setupName: [{id, label}]}") plus the account's ACTIVE rules marked "before entry" (part b sets
// `beforeEntry`). Read-only over server data; the block and Log Trade store only ticked ids.
// ⛔ The ONE copy of toggle and of the "not ticked" sentence: the block (Task 7) and Log Trade (Task 8)
// both import them (pre-flight S18).
// ⛔ A checklist is the member's own discipline record: only CURRENT item ids ever count as ticked,
// and a row with no id is not an item (it could never be ticked, so it could never be honest).

/** Why no checklist is listed when no SPECIFIC account is selected (R-M2-1 c, C-1: the settings served
 *  then are the legacy row, not the member's setups). The ONE copy: the block and Log Trade both show
 *  these, keyed by useChecklistSources' account states. */
export const CHECKLIST_ACCOUNT_LINES = Object.freeze({
  'no-account': 'Your pre-entry checklist shows here when one account is selected.',
  'no-accounts': 'Your pre-entry checklist shows here once you have a Journal account.',
  'accounts-error': "Your accounts couldn't load, so your pre-entry checklist isn't shown.",
})

const hasId = (v) => v !== undefined && v !== null && v !== ''

export function checklistItems({ settings, rules, setup, includeRules }) {
  const out = []
  const seen = new Set()
  const push = (id, label, source) => { if (!seen.has(id)) { seen.add(id); out.push({ id, label, source }) } }
  const setupRules = settings?.setupRules?.[setup]
  if (Array.isArray(setupRules)) {
    for (const r of setupRules) if (hasId(r?.id)) push(String(r.id), String(r.label || ''), 'setup')
  }
  if (includeRules === 'yes' && Array.isArray(rules)) {
    for (const r of rules) if (r?.beforeEntry === true && hasId(r.id)) push(`rule:${r.id}`, String(r.label || ''), 'rule')
  }
  return out
}

const onSet = (checked) => new Set(Array.isArray(checked) ? checked : [])

export function toggleChecked(items, checked, id) {
  const on = onSet(checked)
  if (on.has(id)) on.delete(id)
  else on.add(id)
  return items.map((i) => i.id).filter((x) => on.has(x))
}

export function uncheckedItems(items, checked) {
  const on = onSet(checked)
  return items.filter((i) => !on.has(i.id))
}

export function checklistSummary(items, checked) {
  const on = onSet(checked)
  return { done: items.filter((i) => on.has(i.id)).length, total: items.length }
}

export function untickedLine(n) {
  if (!n) return null
  return `${n} checklist ${n === 1 ? 'item' : 'items'} not ticked.`
}

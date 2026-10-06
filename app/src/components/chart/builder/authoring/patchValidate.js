// app/src/components/chart/builder/authoring/patchValidate.js
//
// ─── THE STRUCTURAL CHECK OF A PATCH, READ OFF `patchSchema.json` ITSELF ─────
//
// ⛔ NOT A MIRROR OF THE SCHEMA — A READER OF IT. The schema file is the one
// authority both lanes hold (the server validates the model's tool output with
// `jsonschema`; this walks the same JSON). It implements exactly the keyword
// subset the file uses: type, const, enum, pattern, min/maxLength,
// minimum/maximum, min/maxItems, required, properties, additionalProperties:
// false, minProperties, local $ref, oneOf. A keyword it does not know is a
// THROW at load (`assertSubset`), so the file cannot grow a rule this walker
// silently skips.
//
// This is a pre-check only: every tree, target and permission is re-decided by
// `applyPatch` against the canonical definition.

import SCHEMA from './patchSchema.json'

export const PATCH_SCHEMA = SCHEMA
export const PATCH_CONTRACT = SCHEMA.properties.contract.const
export const PATCH_LIMITS = Object.freeze({ ...SCHEMA['x-uct-limits'] })
export const OP_NAMES = Object.freeze(SCHEMA.$defs.patchOp.oneOf
  .map((b) => SCHEMA.$defs[b.$ref.split('/').pop()].properties.op.const))

const KNOWN = new Set(['$schema', '$id', 'title', 'description', 'type', 'additionalProperties', 'required',
  'properties', 'x-uct-limits', '$defs', 'const', 'enum', 'pattern', 'minLength', 'maxLength', 'minimum',
  'maximum', 'minItems', 'maxItems', 'items', '$ref', 'oneOf', 'minProperties', 'x-uct-node-schema'])

/** Every keyword in the file must be one this walker implements. */
export function assertSubset(node = SCHEMA, at = '#') {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) { node.forEach((n, i) => assertSubset(n, `${at}/${i}`)); return }
  for (const [k, v] of Object.entries(node)) {
    if (!KNOWN.has(k)) throw new Error(`patchSchema: keyword ${k} at ${at} is not implemented by patchValidate`)
    if (k === 'properties' || k === '$defs') {
      for (const [pk, pv] of Object.entries(v)) assertSubset(pv, `${at}/${k}/${pk}`)
    } else if (k !== 'enum' && k !== 'const' && k !== 'required' && k !== 'x-uct-limits') {
      assertSubset(v, `${at}/${k}`)
    }
  }
}
assertSubset()

const resolve = (ref) => SCHEMA.$defs[ref.replace('#/$defs/', '')]

const typeOk = (t, v) => {
  switch (t) {
    case 'object': return !!v && typeof v === 'object' && !Array.isArray(v)
    case 'array': return Array.isArray(v)
    case 'string': return typeof v === 'string'
    case 'integer': return Number.isInteger(v)
    case 'number': return typeof v === 'number' && Number.isFinite(v)
    case 'boolean': return typeof v === 'boolean'
    default: return false
  }
}

function check(schema, v, at, errors) {
  if (schema.$ref) return check(resolve(schema.$ref), v, at, errors)
  const before = errors.length
  if (schema.type && !typeOk(schema.type, v)) { errors.push({ at, code: 'schema:type', message: `${at}: expected ${schema.type}` }); return false }
  if ('const' in schema && v !== schema.const) errors.push({ at, code: 'schema:const', message: `${at}: expected ${JSON.stringify(schema.const)}` })
  if (schema.enum && !schema.enum.includes(v)) errors.push({ at, code: 'schema:enum', message: `${at}: expected one of ${schema.enum.join(', ')}` })
  if (typeof v === 'string') {
    if (schema.pattern && !new RegExp(schema.pattern).test(v)) errors.push({ at, code: 'schema:pattern', message: `${at}: does not match ${schema.pattern}` })
    if (schema.minLength !== undefined && v.length < schema.minLength) errors.push({ at, code: 'schema:length', message: `${at}: too short` })
    if (schema.maxLength !== undefined && v.length > schema.maxLength) errors.push({ at, code: 'schema:length', message: `${at}: longer than ${schema.maxLength}` })
  }
  if (typeof v === 'number') {
    if (schema.minimum !== undefined && v < schema.minimum) errors.push({ at, code: 'schema:range', message: `${at}: below ${schema.minimum}` })
    if (schema.maximum !== undefined && v > schema.maximum) errors.push({ at, code: 'schema:range', message: `${at}: above ${schema.maximum}` })
  }
  if (Array.isArray(v)) {
    if (schema.minItems !== undefined && v.length < schema.minItems) errors.push({ at, code: 'schema:items', message: `${at}: needs at least ${schema.minItems}` })
    if (schema.maxItems !== undefined && v.length > schema.maxItems) errors.push({ at, code: 'schema:items', message: `${at}: at most ${schema.maxItems}` })
    if (schema.items) v.forEach((item, i) => check(schema.items, item, `${at}[${i}]`, errors))
  }
  if (typeOk('object', v)) {
    for (const k of schema.required || []) {
      if (!(k in v)) errors.push({ at, code: 'schema:required', message: `${at}: missing ${k}` })
    }
    if (schema.minProperties !== undefined && Object.keys(v).length < schema.minProperties) {
      errors.push({ at, code: 'schema:empty', message: `${at}: names nothing to change` })
    }
    const props = schema.properties || {}
    for (const [k, val] of Object.entries(v)) {
      if (props[k]) check(props[k], val, `${at}.${k}`, errors)
      else if (schema.additionalProperties === false) errors.push({ at, code: 'schema:unknown-field', message: `${at}: unknown field ${k}` })
    }
  }
  if (schema.oneOf) {
    // ⭐ An op is dispatched on its `op` constant so the member-facing error is
    // the named op's, not "matched none of 19 branches".
    const branches = schema.oneOf.map((b) => (b.$ref ? resolve(b.$ref) : b))
    const named = typeOk('object', v) && branches.find((b) => b.properties && b.properties.op && b.properties.op.const === v.op)
    if (named) {
      check(named, v, at, errors)
    } else if (branches.every((b) => b.properties && b.properties.op)) {
      errors.push({ at, code: 'schema:unknown-op', message: `${at}: unknown op ${JSON.stringify(v && v.op)}` })
    } else {
      const passing = branches.filter((b) => { const e = []; check(b, v, at, e); return e.length === 0 })
      if (passing.length !== 1) errors.push({ at, code: 'schema:one-of', message: `${at}: must match exactly one form` })
    }
  }
  return errors.length === before
}

/** `{ok, errors:[{at, code, message}]}` — structural only. */
export function validatePatchShape(patch) {
  const errors = []
  check(SCHEMA, patch, 'patch', errors)
  if (!errors.length && patch.questions && patch.questions.length && patch.ops.length) {
    errors.push({ at: 'patch', code: 'patch:questions-with-ops', message: 'a turn that asks a question applies nothing; ops must be empty' })
  }
  return { ok: errors.length === 0, errors }
}

/** The op index an error path belongs to (`patch.ops[3]…` → 3), else null. */
export function opIndexOf(at) {
  const m = /^patch\.ops\[(\d+)\]/.exec(String(at || ''))
  return m ? Number(m[1]) : null
}

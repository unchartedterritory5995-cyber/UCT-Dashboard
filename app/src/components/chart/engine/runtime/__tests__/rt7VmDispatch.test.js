// app/src/components/chart/engine/runtime/__tests__/rt7VmDispatch.test.js
//
// ─── RT7 — the VM's dispatch labels are numeric literals, and every one is RIGHT ─
//
// `vm.js`'s instruction switch spells each label `case N /* OP.X */:` rather than
// `case OP.X:` (a `case` expression is evaluated in order until one matches, so the
// named form is a property load and a compare per label per instruction; literals
// let V8 use a jump table — ~5x on the VM's run). The price is that a literal can
// drift from `OP`. This rail reads the SOURCE and holds every label to `program.js`'s
// `OP`, so a renumbered opcode, a typo or a bare unnamed literal fails here by name
// instead of silently running the wrong instruction.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { OP } from '../program.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = fs.readFileSync(path.join(HERE, '..', 'vm.js'), 'utf8')
const code = SRC.replace(/\/\/[^\n]*/g, '') // line comments only: the label comments are block comments

describe('RT7 — the VM dispatch labels', () => {
  const named = [...code.matchAll(/case\s+(\d+)\s*\/\*\s*OP\.([A-Z_0-9]+)\s*\*\/\s*:/g)].map((m) => [Number(m[1]), m[2]])

  it('every `case N /* OP.X */` is exactly `OP.X === N` (non-vacuity: the switch is found)', () => {
    expect(named.length).toBeGreaterThan(50)
    for (const [n, name] of named) {
      expect(Object.prototype.hasOwnProperty.call(OP, name), `OP.${name} exists`).toBe(true)
      expect(OP[name], `case ${n} is labelled OP.${name}`).toBe(n)
    }
  })

  it('no label is repeated, and no numeric label is left unnamed', () => {
    const nums = named.map(([n]) => n)
    expect(new Set(nums).size).toBe(nums.length)
    const allNumeric = [...code.matchAll(/case\s+(\d+)\s*(\/\*[^*]*\*\/)?\s*:/g)]
    expect(allNumeric.length).toBe(named.length)
  })

  it('no `case OP.X:` remains in the dispatch (it would put the linear scan back)', () => {
    expect(code).not.toMatch(/case\s+OP\./)
  })

  it('the only opcodes without a label are the reserved block of program.js, which the VM has never executed (unchanged by RT7)', () => {
    const labelled = new Set(named.map(([, name]) => name))
    expect(Object.keys(OP).filter((k) => !labelled.has(k)).sort())
      .toEqual(['ARR_GET', 'ARR_NEW', 'ARR_PUSH', 'ARR_SET', 'ARR_SIZE', 'OBJ_CREATE', 'OBJ_DELETE', 'OBJ_UPDATE'])
  })
})

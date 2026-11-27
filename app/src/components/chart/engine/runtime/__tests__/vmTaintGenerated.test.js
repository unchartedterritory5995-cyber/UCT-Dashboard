// app/src/components/chart/engine/runtime/__tests__/vmTaintGenerated.test.js
//
// ─── START-TAINT PART 2: the taint run is GENERATED from the listing run, and cannot drift from it ─────────────────
//
// `vmTaint.js::executeTainted` is `vm.js::execute` with tag statements inserted (`app/scripts/gen-vm-taint.mjs`).
// These rails hold: the committed file IS what the generator makes of the committed `vm.js` (a change to `vm.js`
// lands with its regenerated twin); the generator stops BY NAME on a case with no tag rule, a rule with no case, an
// anchor that moved and a name the generated file could not import; and the listing run carries none of it.
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'

import { generateVmTaint, TAG_RULES } from '../../../../../../scripts/gen-vm-taint.mjs'
import { execute, executeTainted } from '../vm.js'
import { OP } from '../program.js'

const DIR = path.resolve(process.cwd(), 'src/components/chart/engine/runtime')
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8').replace(/\r\n/g, '\n')
const VM = read('vm.js')
const once = (src, from, to) => {
  expect(src.split(from).length - 1, `the fixture edit ${JSON.stringify(from)} must find its text once`).toBe(1)
  return src.replace(from, () => to)
}

describe('the committed taint loop is the generated one', () => {
  it('vmTaint.js is exactly what the generator makes of vm.js (regenerate: node app/scripts/gen-vm-taint.mjs)', () => {
    expect(read('vmTaint.js') === generateVmTaint(VM), 'vmTaint.js is not what the generator makes of vm.js').toBe(true)
  })
  it('every tag rule names an opcode', () => {
    for (const name of Object.keys(TAG_RULES)) expect(Number.isInteger(OP[name]), `OP.${name}`).toBe(true)
  })
})

describe('the generator stops by name', () => {
  it('a case with no tag rule (a new opcode cannot reach the taint loop untagged)', () => {
    const src = once(VM, 'case 86 /* OP.DROP */:', 'case 999 /* OP.NEWOP */: break\n        case 86 /* OP.DROP */:')
    expect(() => generateVmTaint(src)).toThrow(/OP\.NEWOP \*\/` has no tag rule/)
  })
  it('a tag rule for no case', () => {
    const src = once(VM, 'case 86 /* OP.DROP */: sp -= a; break', '')
    expect(() => generateVmTaint(src)).toThrow(/tag rules for no case in execute: DROP/)
  })
  it('an anchor that moved', () => {
    const src = once(VM, '    committed += 1\n', '    committed++\n')
    expect(() => generateVmTaint(src)).toThrow(/anchor "committed \+= 1" occurs 0 times/)
  })
  it('a name execute reads from vm.js that vm.js does not export for the generated file', () => {
    const src = once(VM, 'CLOCK_GETTER, DISARMED_NO_OPS,', 'DISARMED_NO_OPS,')
    expect(() => generateVmTaint(src)).toThrow(/execute reads CLOCK_GETTER from vm\.js/)
  })
})

describe('zero cost on the listing path: `execute` is untouched', () => {
  // the tag state's names: none may appear in the listing run's own function
  const TAG_NAMES = ['ts[sp', 'tl[localsBase', 'tp[persistBase', 'theld', 'outT', 'iterT', 'colTag', 'rTop', 'taintBranch', 'branchTableOf']
  it('the listing run\'s function (as loaded, and as written in vm.js) holds no tag code', () => {
    const live = execute.toString()
    const start = VM.indexOf('export function execute(')
    const written = VM.slice(start, VM.indexOf('\n}\n', start))
    for (const name of TAG_NAMES) {
      expect(live.includes(name), `execute (loaded) contains ${name}`).toBe(false)
      expect(written.includes(name), `execute (vm.js) contains ${name}`).toBe(false)
    }
    // the generated twin does hold them (the check above can see one)
    for (const name of ['ts[sp', 'taintBranch', 'rTop']) expect(executeTainted.toString().includes(name), name).toBe(true)
  })
  it('vm.js reaches the taint run only by a re-export, never from inside execute', () => {
    const start = VM.indexOf('export function execute(')
    const written = VM.slice(start, VM.indexOf('\n}\n', start))
    expect(written.includes('executeTainted')).toBe(false)
    expect(VM).toMatch(/^export \{ executeTainted \} from '\.\/vmTaint\.js'$/m)
  })
})

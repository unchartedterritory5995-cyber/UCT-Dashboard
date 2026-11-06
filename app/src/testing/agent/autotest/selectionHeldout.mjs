// UCT Agent AUTOTEST: the selection oracle's HELD-OUT phrasings, sealed exactly as heldout.mjs seals its own: ciphertext in the
// repository, the key outside every worktree, a result leaves as id, family, pass and layer only.
// The specs were written by a separate author who never read selectionCases.mjs, so they test the family, not the phrases.
//
//   node src/testing/agent/autotest/selectionHeldout.mjs seal <specs.json>     (the author runs this, then deletes the plain file)
import { createDecipheriv, createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { KEY_PATH, ensureKey, seal } from './heldout.mjs'
import { lint } from './lint.mjs'
import { buildCase, CAPS } from './selectionCases.mjs'
import { BOARDS } from './boards.mjs'

export const SEALED = join(dirname(fileURLToPath(import.meta.url)), 'selection.heldout.enc.json')
const sha = (s) => createHash('sha256').update(s).digest('hex')

export function loadSealed() {
  const b = JSON.parse(readFileSync(SEALED, 'utf8'))
  if (!existsSync(KEY_PATH)) throw new Error('held-out key not on this machine')
  const key = Buffer.from(readFileSync(KEY_PATH, 'utf8').trim(), 'hex')
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(b.iv, 'hex'))
  d.setAuthTag(Buffer.from(b.tag, 'hex'))
  const text = Buffer.concat([d.update(Buffer.from(b.ct, 'base64')), d.final()]).toString('utf8')
  if (sha(text) !== b.sha256) throw new Error('held-out selection set does not match its hash')
  return JSON.parse(text).map(s => ({ ...buildCase(s), set: 'heldout' }))
}

/** Field errors only, by id: never a sentence. */
export function specErrors(specs) {
  const errs = []
  for (const s of specs) {
    const e = (m) => errs.push(`${s.id}: ${m}`)
    if (!BOARDS[s.board]) e(`board ${s.board}`)
    if (!CAPS[s.cap]) e(`cap ${s.cap}`)
    const roles = Object.keys(BOARDS[s.board]?.roles || {})
    for (const c of s.clicks || []) if (!roles.includes(c)) e(`click ${c}`)
    if (!(s.intended === 'clicked' || s.intended === 'ask' || (Array.isArray(s.intended) && s.intended.every(r => roles.includes(r))))) e('intended')
    if (s.intended === 'clicked' && !(s.clicks || []).length) e('intended clicked, with no click')
    if (s.plan && s.plan !== 'adversary') e('plan')
    if (s.plan === 'adversary' && !s.bad) e('adversary with no bad role')
    if (typeof s.say !== 'string' || !s.say.trim()) e('say')
  }
  return errs
}

if (process.argv[2] === 'seal') {
  const specs = JSON.parse(readFileSync(process.argv[3], 'utf8'))
  const errs = specErrors(specs)
  if (!errs.length) errs.push(...lint(specs.map(buildCase)).map(x => x.replace(/:.*/, ': lint error (text withheld)')))
  if (errs.length) { console.log(errs.slice(0, 40).join('\n')); process.exit(1) }
  const blob = seal(specs.map(s => ({ ...s, family: s.cap, kind: 'target', turns: [] })), ensureKey())
  writeFileSync(SEALED, JSON.stringify(blob, null, 1))
  console.log(JSON.stringify({ count: blob.count, families: blob.families, sha256: blob.sha256 }))
}

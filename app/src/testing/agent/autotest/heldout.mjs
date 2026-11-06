// UCT Agent AUTOTEST: the HELD-OUT set. Requests a fix worker must never see, or the set stops measuring anything.
//
//   • In this repository it is ciphertext only (heldout.enc.json, AES-256-GCM), with family counts and a hash.
//   • The key lives outside every worktree: ~/.uct-agent-autotest/heldout.key. No fix worker is given that path.
//   • A runner decrypts in memory. Every output for a held-out request goes through `redact`: id, family, kind, pass or
//     fail, root-cause layer. Never the words, the plan, the checks, the panel text or a screenshot.
// A held-out failure tells a fix worker which family and layer to look at, not the sentence that failed.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const KEY_PATH = process.env.UCT_AUTOTEST_HELDOUT_KEY || join(homedir(), '.uct-agent-autotest', 'heldout.key')
export const BLOB = join(dirname(fileURLToPath(import.meta.url)), 'heldout.enc.json')

const sha = (s) => createHash('sha256').update(s).digest('hex')
export function ensureKey() {
  if (existsSync(KEY_PATH)) return Buffer.from(readFileSync(KEY_PATH, 'utf8').trim(), 'hex')
  mkdirSync(dirname(KEY_PATH), { recursive: true })
  const k = randomBytes(32)
  writeFileSync(KEY_PATH, k.toString('hex'), { mode: 0o600 })
  return k
}
export function seal(list, key = ensureKey()) {
  const text = JSON.stringify(list)
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([c.update(text, 'utf8'), c.final()])
  const counts = {}
  for (const r of list) counts[r.family] = (counts[r.family] || 0) + 1
  const kinds = {}
  for (const r of list) kinds[r.kind] = (kinds[r.kind] || 0) + 1
  return { about: 'Held-out autotest requests, encrypted. See heldout.mjs. Counts only in the clear.', count: list.length, turns: list.reduce((n, r) => n + r.turns.length, 0), families: counts, kinds, sha256: sha(text), iv: iv.toString('hex'), tag: c.getAuthTag().toString('hex'), ct: ct.toString('base64') }
}
export const blobInfo = () => { try { const b = JSON.parse(readFileSync(BLOB, 'utf8')); return { count: b.count, turns: b.turns, families: b.families, kinds: b.kinds, sha256: b.sha256 } } catch { return null } }
export function loadHeldout() {
  const b = JSON.parse(readFileSync(BLOB, 'utf8'))
  if (!existsSync(KEY_PATH)) throw new Error('held-out key not on this machine')
  const key = Buffer.from(readFileSync(KEY_PATH, 'utf8').trim(), 'hex')
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(b.iv, 'hex'))
  d.setAuthTag(Buffer.from(b.tag, 'hex'))
  const text = Buffer.concat([d.update(Buffer.from(b.ct, 'base64')), d.final()]).toString('utf8')
  if (sha(text) !== b.sha256) throw new Error('held-out set does not match its hash')
  return JSON.parse(text).map(r => ({ ...r, set: 'heldout' }))
}
/** The only shape a held-out result may leave the process in. */
export const redact = (r) => ({ id: r.id, set: 'heldout', family: r.family, kind: r.kind, pass: r.pass, layer: r.layer || null, modelCalls: r.modelCalls ?? null, usd: r.usd ?? null })

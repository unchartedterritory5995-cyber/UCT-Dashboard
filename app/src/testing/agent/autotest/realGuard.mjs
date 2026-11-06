// UCT Agent AUTOTEST: the REAL-MODEL guard, node side. tools/agent_autotest_gate.py holds the same rules and is the
// one that talks to the ledger; a real run needs BOTH to agree. Neither has a flag, an environment override or a default
// that lets a run through: no authorization file, no run.
//
// The file: C:/UCT/agent-autotest-authorization.json, written by the OWNER, never by a Claude session:
//   { "approved_by": "owner", "max_usd": 8, "expires": "2026-11-12", "targets": ["local"], "stages": ["canary"],
//     "public_set_sha256": "<run.mjs --lint>", "heldout_sha256": "<run.mjs --lint>",
//     "production_ack": "<exact sentence, needed only for target production>" }
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

export const MAX_AUTHORIZED_USD = 8
export const AUTH_PATH = 'C:/UCT/agent-autotest-authorization.json'
export const PRODUCTION_ACK = 'I accept that production runs on my account, against a disposable AUTOTEST layout only, and spends my production Agent budget.'
const GATE = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../tools/agent_autotest_gate.py')
const HEX = /^[0-9a-f]{64}$/

// Only `authorize` adds to this. A real relay refuses any object that is not in it.
const granted = new WeakSet()
export const isGranted = (a) => granted.has(a)

/** The pure rules. `now`: a Date. → null when the file holds, else the reason. */
export function refusalOf(auth, { target, stage, setHashes, now = new Date() }) {
  if (!auth || typeof auth !== 'object') return 'the authorization file is not a JSON object'
  if (auth.approved_by !== 'owner') return 'approved_by is not "owner"'
  if (typeof auth.max_usd !== 'number' || !Number.isFinite(auth.max_usd) || auth.max_usd <= 0) return 'max_usd is not a positive number'
  if (auth.max_usd > MAX_AUTHORIZED_USD) return `max_usd ${auth.max_usd} is over the $${MAX_AUTHORIZED_USD} limit`
  const exp = Date.parse(`${auth.expires}T23:59:59Z`)
  if (!Number.isFinite(exp)) return 'expires is not a date'
  if (exp < now.getTime()) return `the authorization expired on ${auth.expires}`
  if (!['local', 'production'].includes(target)) return `unknown target ${target}`
  if (!Array.isArray(auth.targets) || !auth.targets.includes(target)) return `target ${target} is not authorized`
  if (!Array.isArray(auth.stages) || !auth.stages.includes(stage)) return `stage ${stage || '(none)'} is not authorized`
  if (!HEX.test(auth.public_set_sha256 || '') || auth.public_set_sha256 !== setHashes?.public) return 'the authorization is for a different public request set'
  if (auth.heldout_sha256 != null && auth.heldout_sha256 !== setHashes?.heldout) return 'the authorization is for a different held-out set'
  if (target === 'production' && auth.production_ack !== PRODUCTION_ACK) return 'production needs the exact production_ack sentence'
  return null
}

/**
 * The first call of a real run. Reads the file, applies the rules, then asks the python gate (same rules, plus the
 * ledger: its cap file, the key, what is left). → { ok: true, maxUsd } | { ok: false, reason }
 */
export function authorize({ target, stage, setHashes, path = AUTH_PATH, now = new Date(), gate = true }) {
  authorize.last = null
  if (!existsSync(path)) return { ok: false, reason: `no authorization file at ${path}` }
  let auth
  try { auth = JSON.parse(readFileSync(path, 'utf8')) } catch { return { ok: false, reason: 'the authorization file does not parse' } }
  const why = refusalOf(auth, { target, stage, setHashes, now })
  if (why) return { ok: false, reason: why }
  if (gate) {
    const r = spawnSync('python', [GATE, 'check', '--target', target, '--stage', stage, '--public-sha', setHashes.public, ...(setHashes.heldout ? ['--heldout-sha', setHashes.heldout] : [])], { encoding: 'utf8', timeout: 60000 })
    if (r.status !== 0) return { ok: false, reason: `the ledger gate refused: ${String(r.stdout || r.stderr || r.error).trim().slice(0, 300)}` }
  }
  const grant = Object.freeze({ maxUsd: auth.max_usd, target, stage })
  granted.add(grant)
  authorize.last = grant
  return { ok: true, maxUsd: auth.max_usd }
}
authorize.last = null

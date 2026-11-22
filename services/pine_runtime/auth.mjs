// services/pine_runtime/auth.mjs
//
// W5-T6: request signing between `web` and the pine-runtime service
// (docs/pine/SERVER-RUNTIME-DESIGN.md section 3.6).
//
//   header   X-Pine-Runtime-Signature: t=<unix seconds>,v1=<64 lowercase hex>
//   v1       HMAC-SHA256(secret, "<t>" + "." + sha256hex(raw body bytes))
//
// The signature is bound to the BODY (the CHART_RENDERER_SECRET idiom, strengthened), so a
// captured header cannot carry a different request. A timestamp more than SKEW_SECONDS from the
// service's clock is refused, and inside that window every accepted signature is remembered, so
// the same signed request is refused the second time (replay).
//
// ROTATION: PINE_RUNTIME_SERVICE_SECRET is a comma-separated list. The service accepts a signature
// made with ANY listed secret; web signs with the first. Sequence: add the new secret to the
// service, switch web to it, remove the old one. No step needs both services to restart together.
//
// ⛔ No secret value is ever logged, thrown or returned: errors name a POSITION in the list only.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

export const SIGNATURE_HEADER = 'x-pine-runtime-signature'
export const SKEW_SECONDS = 60
/** A secret shorter than this is refused at boot: an HMAC key is only as strong as its length. */
export const MIN_SECRET_LENGTH = 32
export const AUTH_GUARD = 'runtime:server-auth'

const HEADER_RE = /^t=(\d{1,12}),v1=([0-9a-f]{64})$/

export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

/** The v1 signature over `body` (a Buffer or string) at unix second `t`. */
export function signature(secret, t, body) {
  return createHmac('sha256', secret).update(`${t}.${sha256Hex(body)}`).digest('hex')
}

/** The header value web sends (the first secret signs). Tests and the T11 client use this shape. */
export function signHeader(secret, t, body) {
  return `t=${t},v1=${signature(secret, t, body)}`
}

/**
 * Parse PINE_RUNTIME_SERVICE_SECRET. Throws (never returns an empty list) when no usable secret
 * is configured: an unauthenticated service must not boot. The message names positions, never values.
 */
export function parseSecrets(raw) {
  const list = String(raw ?? '').split(',').map((s) => s.trim())
  if (list.length === 1 && list[0] === '') {
    throw new Error('PINE_RUNTIME_SERVICE_SECRET is unset or empty; the service refuses to start unauthenticated.')
  }
  list.forEach((s, i) => {
    if (s.length < MIN_SECRET_LENGTH) {
      const what = s.length === 0 ? 'empty' : `shorter than ${MIN_SECRET_LENGTH} characters`
      throw new Error(`PINE_RUNTIME_SERVICE_SECRET entry ${i + 1} of ${list.length} is ${what}; `
        + 'the service refuses to start with a weak key.')
    }
  })
  return list
}

/** Parse the header and check the clock BEFORE the body is read. Returns { t, v1 } or { reason }. */
export function parseSignatureHeader(value, nowSeconds) {
  if (typeof value !== 'string') return { reason: 'the request carries no signature' }
  const m = HEADER_RE.exec(value)
  if (!m) return { reason: 'the signature header is malformed' }
  const t = Number(m[1])
  if (Math.abs(nowSeconds - t) > SKEW_SECONDS) return { reason: `the signature is more than ${SKEW_SECONDS} s from the service clock` }
  return { t, v1: m[2] }
}

/**
 * Remembers accepted signatures for the skew window, so one signed request runs at most once.
 * Entries expire SKEW_SECONDS after their own timestamp: past that, the clock check refuses them anyway.
 */
export class ReplayGuard {
  constructor() { this.seen = new Map() }
  /** True when `v1` was not seen (and records it); false for a replay. */
  admit(v1, t, nowSeconds) {
    for (const [k, exp] of this.seen) if (exp < nowSeconds) this.seen.delete(k)
    if (this.seen.has(v1)) return false
    this.seen.set(v1, t + SKEW_SECONDS)
    return true
  }
}

/** Constant-time check of `v1` against every configured secret. */
export function verifyBody(secrets, parsed, body) {
  const got = Buffer.from(parsed.v1, 'hex')
  let ok = false
  for (const s of secrets) {
    const want = Buffer.from(signature(s, parsed.t, body), 'hex')
    if (want.length === got.length && timingSafeEqual(want, got)) ok = true
  }
  return ok
}

// app/src/lib/panelContract.js
//
// ─── TERM-024 (FB-S4-02) — A PANEL DECLARES A NEED ──────────────────────────
//
// ⭐ A panel declares a NEED. It never owns a transport, a budget, or a
// freshness opinion. (ARCH-07 §5.2, realtime-performance-architecture.md.)
//
// All three of those are per-process, shared, and invisible to the panel
// author. `STREAM_MAX_SUBSCRIBERS = 300` (api/routers/stream.py) is a budget
// for the WHOLE process, and the client pools collapse N panels onto ~one
// connection per stream family ("16 cells, one SSE"). A panel that opens its
// own EventSource turns that budget into 300/N members, owns a drop counter
// nobody reads, and carries a freshness opinion nobody reconciles. ⛔ Those
// per-process hubs and budgets are CORRECTNESS GUARDS, NOT CACHES (STATE-7).
//
// So the interface a panel gets is a HANDLE, never a URL:
//
//     const BARS = declareNeed({ kind: 'bars', delivery: DELIVERY.LAST_VALUE_WINS })
//     const unsubscribe = BARS.subscribe(sym, tf, { onBar })
//
// The handle forwards to the shared pool that already owns the transport. It
// exposes no URL, no connection, no budget and no staleness knob, and
// `declareNeed` REFUSES any spec key other than `kind` and `delivery` — so a
// panel cannot hand the contract a URL, a subscriber cap or a stale-after
// threshold even by trying.
//
// ── ⛔ `delivery` IS REQUIRED AND HAS NO DEFAULT (ARCH-07 §3 Q6) ─────────────
//
// Two delivery semantics exist, and both are right for their stream:
//   • last-value-wins       — prices; the developing bar (`bar_broadcaster`,
//                             Queue(maxsize=64), drop-OLDEST). A dropped tick
//                             is superseded by the next one.
//   • every-message-matters — the options tape. Massive OPRA does not replay,
//                             so a dropped message is a PERMANENT gap.
// "Both behaviours are right; the defect is that the distinction lives in a
// comment." A panel author cannot infer it and will assume whichever their
// first stream was — so the panel must STATE it, and the statement is checked
// against what the stream actually does. An omitted value throws, an unknown
// value throws, and a value that disagrees with the stream throws. There is
// deliberately no default: a default would be a guess made on the author's
// behalf, which is the exact failure this field exists to prevent.
// `panelContract.rail.test.js` also rails the omission statically, at every
// call site, so it fails in CI rather than only at runtime.
//
// ── WHAT THIS MODULE IS, AND IS NOT (S NOW / L LATER) ────────────────────────
//
// This is the interface decision, taken while it is cheap. It does NOT migrate
// the existing transport owners outside the pools — those are recorded by name
// in the rail's ratchet baseline, which can only shrink. Moving them onto
// handles (and a shared client pool for the tape) is the L-sized retrofit this
// ticket exists to stop from growing.
//
// ⚠️ The TAPE has no shared client pool today: its tailer SSE is opened inside
// `pages/LiveFlowMassive.jsx` (partner-owned consumer, ledger F1). Its entry
// here records the one every-message-matters stream so the distinction lives
// in code, and `declareNeed` refuses it by name until a pool exists — a handle
// that silently did nothing would be worse than a refusal.
//
// ⭐ THE POOL MODULES IMPORTED BELOW ARE THE TRANSPORT OWNERS, BY DERIVATION.
// The rail reads this file's own import statements to decide which modules may
// construct an EventSource/WebSocket, and refuses an import here that owns no
// transport. Import only pool entry points into this module.

import * as priceStreamManager from './priceStreamManager'
import * as barsStreamManager from './barsStreamManager'

export const DELIVERY = Object.freeze({
  LAST_VALUE_WINS: 'last-value-wins',
  EVERY_MESSAGE_MATTERS: 'every-message-matters',
})

const DELIVERY_VALUES = Object.freeze(Object.values(DELIVERY))

/**
 * Every stream a panel may declare a need for.
 *
 * `pool`/`subscribe`/`read` name the shared pool entry point and the two of its
 * exports a handle forwards to. They are looked up AT CALL TIME, never captured
 * at declare time, so a module-level mock or a pool reload reaches the handle.
 */
const NEEDS = Object.freeze({
  prices: Object.freeze({
    delivery: DELIVERY.LAST_VALUE_WINS,
    pool: priceStreamManager, subscribe: 'subscribe', read: 'getSnapshot',
  }),
  bars: Object.freeze({
    delivery: DELIVERY.LAST_VALUE_WINS,
    pool: barsStreamManager, subscribe: 'subscribe', read: 'getStatus',
  }),
  tape: Object.freeze({
    delivery: DELIVERY.EVERY_MESSAGE_MATTERS,
    pool: null,
    unavailable: 'there is no shared client pool for the options tape yet — its tailer '
      + 'SSE is still opened inside pages/LiveFlowMassive.jsx (partner-owned consumer, '
      + 'ledger F1). Building that pool is the L-later half of TERM-024.',
  }),
})

export const NEED_KINDS = Object.freeze(Object.keys(NEEDS))

/** The keys a need spec may carry. Anything else is a transport, a budget or
 *  a freshness opinion trying to get in, and is refused by name. */
const SPEC_KEYS = Object.freeze(['kind', 'delivery'])

export class PanelContractError extends Error {
  constructor(message) {
    super(`panelContract: ${message}`)
    this.name = 'PanelContractError'
  }
}

/** The delivery semantics a stream actually implements. */
export function deliveryOf(kind) {
  const need = Object.prototype.hasOwnProperty.call(NEEDS, kind) ? NEEDS[kind] : null
  if (!need) throw new PanelContractError(`unknown need kind ${JSON.stringify(kind)}; `
    + `declare one of ${NEED_KINDS.join(', ')}`)
  return need.delivery
}

/**
 * Declare what a panel needs, and get back a handle — never a URL.
 *
 * @param {{kind: string, delivery: string}} spec  both REQUIRED, nothing else allowed
 * @returns {{kind: string, delivery: string, subscribe: Function, read: Function}}
 */
export function declareNeed(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new PanelContractError('declareNeed takes one object: { kind, delivery }')
  }
  const extra = Object.keys(spec).filter((k) => !SPEC_KEYS.includes(k))
  if (extra.length) {
    throw new PanelContractError(`a need spec carries only ${SPEC_KEYS.join(' + ')}; refused `
      + `${extra.map((k) => JSON.stringify(k)).join(', ')} — a panel never owns a transport, `
      + 'a budget or a freshness opinion')
  }
  const { kind, delivery } = spec
  const expected = deliveryOf(kind)
  if (delivery === undefined) {
    throw new PanelContractError(`need ${JSON.stringify(kind)} omits \`delivery\`. It is `
      + `REQUIRED and has no default — state it (this stream is ${JSON.stringify(expected)})`)
  }
  if (!DELIVERY_VALUES.includes(delivery)) {
    throw new PanelContractError(`need ${JSON.stringify(kind)} declares unknown delivery `
      + `${JSON.stringify(delivery)}; use one of ${DELIVERY_VALUES.join(', ')}`)
  }
  if (delivery !== expected) {
    throw new PanelContractError(`need ${JSON.stringify(kind)} declares ${JSON.stringify(delivery)} `
      + `but the stream is ${JSON.stringify(expected)} — a panel must not assume the semantics `
      + 'of whichever stream it met first')
  }
  const need = NEEDS[kind]
  if (!need.pool) {
    throw new PanelContractError(`need ${JSON.stringify(kind)} is declared but not yet `
      + `servable: ${need.unavailable}`)
  }
  return Object.freeze({
    kind,
    delivery,
    subscribe: (...args) => need.pool[need.subscribe](...args),
    read: (...args) => need.pool[need.read](...args),
  })
}

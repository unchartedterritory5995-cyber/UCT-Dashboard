// TERM-079 (FB-S4-01) — TYPED CONTEXT CHANNELS, STARTING WITH EXACTLY ONE
// LIST-CONSUMING PANEL.
//
// ──────────────────────────────────────────────────────────────────────────
// WHAT THIS IS
// ──────────────────────────────────────────────────────────────────────────
//
// The charts board links panels through four SYMBOL-ONLY colour groups
// (`WorkspaceContext.groupSyms` A/B/C/D, plus the read-only `groupTfs`). That
// seed is the estate's strongest terminal asset and it has two ceilings: it can
// only carry a symbol, and there are exactly four of it. This module adds the
// FDC3 vocabulary WITHOUT its container — five payload kinds — on a channel that
// carries exactly one kind:
//
//     symbol · symbol-set · list-ref · timeframe · range
//
// A channel id is `<kind>:<key>` (`channelFor(KIND.LIST_REF, 'A')` →
// `'list-ref:A'`). The key is any string, so a board is not capped at four
// linked contexts. A payload says what it is (`{ type: 'list-ref', ... }`,
// built by the constructors below), and a payload of the wrong kind is REFUSED
// BY NAME — the refusal names the publisher, the channel, the kind the channel
// carries and the kind it was handed — and the held value is untouched.
//
// ⭐ THE FIRST CONSUMER IS ONE PANEL, NOT A REWRITE: the Market Map
// (`ScatterWidget`) follows its colour group's `list-ref` channel when its
// "Follow linked list" toggle is on, and the Watchlist widget publishes the
// list it shows. Nothing else reads a channel yet.
//
// ──────────────────────────────────────────────────────────────────────────
// ⛔⛔ NOT A TENTH MECHANISM
// ──────────────────────────────────────────────────────────────────────────
//
// `focusDivergence.js` names the trap: *"the moment it caches, defaults, or
// normalises differently … it IS the tenth mechanism."* So:
//   • symbol and timeframe on a COLOUR GROUP already have an authority
//     (`WorkspaceContext.groupSyms` / `.groupTfs`, and through them
//     `useAppFocus`). A publish there is refused as OWNED_ELSEWHERE, naming that
//     authority. The channel store never holds a second copy of either.
//   • nothing is normalised — a symbol is held exactly as given, never
//     upper-cased, so two authorities that disagree on case are not made to
//     agree by this layer;
//   • values are EPHEMERAL (never persisted), like `groupTfs`: a panel's own
//     opts stay the authority for what a layout restores to, and a publisher
//     republishes on mount.
// The colour groups and `useChartsSym()`'s resolution order are untouched —
// that order is a LOCKED invariant and `contextChannels.test.jsx` rails it
// under a channel board.
//
// ──────────────────────────────────────────────────────────────────────────
// ⛔⛔ H14 / PERF-4 — A CONTEXT BUS IS A RE-RENDER SOURCE
// ──────────────────────────────────────────────────────────────────────────
//
// The 2026-09-10 navigation freeze came from a registration that re-rendered
// the registrant. The rule from that incident is the architecture here:
//   • the React context carries ONE store object, created once per board mount
//     (`useState` initialiser) and never replaced — so being inside the board
//     never re-renders anyone, however often the board's host renders;
//   • values live OUTSIDE React state, in a plain store with PER-CHANNEL
//     listener sets, read through `useSyncExternalStore` — so a publish on
//     channel X notifies only X's subscribers;
//   • an equal payload (per-kind structural equality) is a no-op: no
//     notification, the held object is kept by identity;
//   • `usePublish` returns a memoised `{ publish, clear }` keyed on
//     (store, channel, publisher), so a publisher can put it in an effect's deps.
// `contextChannels.renderLoop.test.jsx` counts real renders against a cap.

import { createContext, useCallback, useContext, useMemo, useState, useSyncExternalStore } from 'react'
import { WORKSPACE_FALLBACK } from '../../pages/charts/WorkspaceContext'

/** The five payload kinds (FDC3's vocabulary, named for this app). */
export const KIND = Object.freeze({
  SYMBOL: 'symbol',
  SYMBOL_SET: 'symbol-set',
  LIST_REF: 'list-ref',
  TIMEFRAME: 'timeframe',
  RANGE: 'range',
})
export const KINDS = Object.freeze(Object.values(KIND))

// ── Payload constructors. A payload carries its own `type`. ───────────────────
export const symbolCtx = (symbol) => ({ type: KIND.SYMBOL, symbol })
export const symbolSetCtx = (symbols) => ({ type: KIND.SYMBOL_SET, symbols })
/** A reference to a list, in the universe vocabulary `/api/scatter/data` speaks
 *  (`source` + `value`). A consumer resolves it; the channel never holds members. */
export const listRefCtx = ({ source, value = '', label = null } = {}) => ({ type: KIND.LIST_REF, source, value, label })
export const timeframeCtx = (tf) => ({ type: KIND.TIMEFRAME, tf })
/** An inclusive ISO date range, 'YYYY-MM-DD'. */
export const rangeCtx = (start, end) => ({ type: KIND.RANGE, start, end })

// ── Per-kind validation (returns a reason string, or null when valid). ────────
const isSym = (s) => typeof s === 'string' && s.length > 0 && s.length <= 32 && !/\s/.test(s)
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const VALIDATE = {
  [KIND.SYMBOL]: (p) => (isSym(p.symbol) ? null : 'symbol must be a non-empty string with no whitespace'),
  [KIND.SYMBOL_SET]: (p) => (Array.isArray(p.symbols) && p.symbols.every(isSym)
    ? null : 'symbols must be an array of non-empty strings with no whitespace'),
  [KIND.LIST_REF]: (p) => {
    if (typeof p.source !== 'string' || !p.source) return 'source must be a non-empty string'
    if (typeof p.value !== 'string') return 'value must be a string (empty for a source with no value)'
    if (p.label != null && typeof p.label !== 'string') return 'label must be a string or null'
    return null
  },
  [KIND.TIMEFRAME]: (p) => (typeof p.tf === 'string' && /^[0-9A-Za-z]{1,8}$/.test(p.tf)
    ? null : 'tf must be a short alphanumeric string'),
  [KIND.RANGE]: (p) => {
    if (!ISO_DAY.test(p.start ?? '') || !ISO_DAY.test(p.end ?? '')) return 'start and end must be YYYY-MM-DD'
    return p.start <= p.end ? null : 'start must not be after end'
  },
}

// ── Per-kind structural equality — an equal publish is a no-op. ───────────────
const sameArr = (a, b) => a.length === b.length && a.every((x, i) => x === b[i])
const EQUAL = {
  [KIND.SYMBOL]: (a, b) => a.symbol === b.symbol,
  [KIND.SYMBOL_SET]: (a, b) => sameArr(a.symbols, b.symbols),
  [KIND.LIST_REF]: (a, b) => a.source === b.source && a.value === b.value && (a.label ?? null) === (b.label ?? null),
  [KIND.TIMEFRAME]: (a, b) => a.tf === b.tf,
  [KIND.RANGE]: (a, b) => a.start === b.start && a.end === b.end,
}

// ── Held values are frozen copies, so no consumer can mutate another's view. ──
const FREEZE = {
  [KIND.SYMBOL]: (p) => Object.freeze({ type: p.type, symbol: p.symbol }),
  [KIND.SYMBOL_SET]: (p) => Object.freeze({ type: p.type, symbols: Object.freeze([...p.symbols]) }),
  [KIND.LIST_REF]: (p) => Object.freeze({ type: p.type, source: p.source, value: p.value, label: p.label ?? null }),
  [KIND.TIMEFRAME]: (p) => Object.freeze({ type: p.type, tf: p.tf }),
  [KIND.RANGE]: (p) => Object.freeze({ type: p.type, start: p.start, end: p.end }),
}

// ⛔ DERIVED, never typed: the colour groups are whatever the workspace says. Read
// LAZILY (only when a symbol/timeframe publish is checked), so a test that mocks
// WorkspaceContext without its fallback can still import any panel that publishes.
const isColorGroup = (key) => Object.prototype.hasOwnProperty.call(WORKSPACE_FALLBACK.groupSyms, key)
/** Kinds that already have an authority on a colour group. */
const OWNED_ON_COLOR_GROUP = {
  [KIND.SYMBOL]: 'WorkspaceContext.groupSyms',
  [KIND.TIMEFRAME]: 'WorkspaceContext.groupTfs',
}

/** `'<kind>:<key>'`. Throws BY NAME on an unknown kind or an empty key. */
export function channelFor(kind, key) {
  if (!KINDS.includes(kind)) throw new Error(`contextChannels: unknown channel kind "${kind}" (known: ${KINDS.join(', ')})`)
  if (typeof key !== 'string' || !key) throw new Error(`contextChannels: a ${kind} channel needs a key`)
  return `${kind}:${key}`
}

function parseChannel(id) {
  if (typeof id !== 'string') return null
  const i = id.indexOf(':')
  if (i <= 0 || i === id.length - 1) return null
  const kind = id.slice(0, i)
  return KINDS.includes(kind) ? { kind, key: id.slice(i + 1) } : null
}

/** null when the publish is admissible, otherwise the refusal (code + message naming everything). */
function check(id, payload, publisher) {
  const who = publisher || 'an unnamed publisher'
  const ch = parseChannel(id)
  if (!ch) {
    return { code: 'UNKNOWN_CHANNEL', channel: id, publisher: who,
      message: `contextChannels: "${who}" published to "${id}", which is not a channel id (<kind>:<key>) — refused` }
  }
  const got = payload && typeof payload === 'object' && typeof payload.type === 'string' ? payload.type : '(no type)'
  if (got !== ch.kind) {
    return { code: 'WRONG_TYPE', channel: id, publisher: who, expected: ch.kind, got,
      message: `contextChannels: "${who}" published a ${got} to channel "${id}", which carries ${ch.kind} — refused` }
  }
  const owner = OWNED_ON_COLOR_GROUP[ch.kind]
  if (owner && isColorGroup(ch.key)) {
    return { code: 'OWNED_ELSEWHERE', channel: id, publisher: who, owner,
      message: `contextChannels: "${who}" published to "${id}", but ${ch.kind} on colour group ${ch.key} is owned by ${owner} — refused (no second authority)` }
  }
  const reason = VALIDATE[ch.kind](payload)
  if (reason) {
    return { code: 'INVALID_PAYLOAD', channel: id, publisher: who, reason,
      message: `contextChannels: "${who}" published an invalid ${ch.kind} to "${id}": ${reason} — refused` }
  }
  return null
}

/**
 * A board's channel store. Plain JS, no React: per-channel values and per-channel
 * listener sets, so a publish notifies only that channel's subscribers.
 */
export function createChannelStore({ onRefuse } = {}) {
  const held = new Map()        // id -> { payload, publisher }
  const listeners = new Map()   // id -> Set<fn>

  const notify = (id) => {
    const set = listeners.get(id)
    if (set) for (const fn of [...set]) fn()
  }

  return {
    publish(id, payload, publisher) {
      const refusal = check(id, payload, publisher)
      if (refusal) {
        onRefuse?.(refusal)
        return { ok: false, ...refusal }
      }
      const kind = payload.type
      const prev = held.get(id)
      if (prev && EQUAL[kind](prev.payload, payload)) {
        prev.publisher = publisher   // the latest publisher of an equal value owns it
        return { ok: true, changed: false }
      }
      held.set(id, { payload: FREEZE[kind](payload), publisher })
      notify(id)
      return { ok: true, changed: true }
    },
    /** Clear a channel — only its current publisher may (a stale panel cannot wipe a live one). */
    clear(id, publisher) {
      const cur = held.get(id)
      if (!cur || cur.publisher !== publisher) return false
      held.delete(id)
      notify(id)
      return true
    },
    get(id) {
      return held.get(id)?.payload ?? null
    },
    subscribe(id, fn) {
      let set = listeners.get(id)
      if (!set) { set = new Set(); listeners.set(id, set) }
      set.add(fn)
      return () => {
        set.delete(fn)
        if (!set.size) listeners.delete(id)
      }
    },
    /** Ids that currently hold a value. */
    channels() {
      return [...held.keys()]
    },
  }
}

// Off a board: reads are null and publishes report NO_BOARD — but a wrong kind is
// STILL refused by name first, so a panel's mistake is visible wherever it runs.
const NO_BOARD = {
  publish(id, payload, publisher) {
    const refusal = check(id, payload, publisher)
    if (refusal) return { ok: false, ...refusal }
    return { ok: false, code: 'NO_BOARD', channel: id, publisher,
      message: `contextChannels: "${publisher}" published to "${id}" outside a channel board — nothing holds it` }
  },
  clear: () => false,
  get: () => null,
  subscribe: () => () => {},
  channels: () => [],
}

const ChannelsContext = createContext(null)

const logRefusal = (r) => {
  if (import.meta.env?.DEV) console.error(r.message)
}

/**
 * Mount once per board. `store` is optional (tests inject one); it is read ONCE —
 * the context value is fixed for the provider's lifetime, which is the whole
 * render-stability guarantee.
 */
export function ContextChannelsProvider({ store, children }) {
  const [board] = useState(() => store || createChannelStore({ onRefuse: logRefusal }))
  return <ChannelsContext.Provider value={board}>{children}</ChannelsContext.Provider>
}

/** The payload on `channelId`, or null. `null` channel → subscribes to nothing. */
export function useChannel(channelId) {
  const board = useContext(ChannelsContext) || NO_BOARD
  const subscribe = useCallback(
    (fn) => (channelId ? board.subscribe(channelId, fn) : () => {}),
    [board, channelId],
  )
  const snapshot = useCallback(() => (channelId ? board.get(channelId) : null), [board, channelId])
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

/**
 * `{ publish(payload), clear() }` for one channel, as one named publisher.
 * Memoised on (board, channel, publisher): safe in an effect's deps. Publishing
 * reads nothing, so a publish-only panel never re-renders because of a channel.
 */
export function usePublish(channelId, publisher) {
  const board = useContext(ChannelsContext) || NO_BOARD
  return useMemo(() => ({
    publish: (payload) => board.publish(channelId, payload, publisher),
    clear: () => board.clear(channelId, publisher),
  }), [board, channelId, publisher])
}

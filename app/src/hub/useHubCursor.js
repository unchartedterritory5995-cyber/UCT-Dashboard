// app/src/hub/useHubCursor.js — the shared cursor: every list-bearing section registers its list
// See docs/plans/joystick/00-master-spec-v1.3.md §2d
//
// ⛔ NOT MOUNTED YET — PHASE 1 SHIPS THIS UNWIRED, DELIBERATELY.
// Today the only thing that imports this file is its own test (or another
// equally unmounted hub module). It is reached from NO route. Phase 2 wires it:
// `HubProvider` goes around `<main>` in `Layout.jsx`, and the section
// integrators call `useHubMode` / `useHubCursor` from their pages.
//
// It is recorded here rather than left to be discovered because this repo has
// been bitten by the opposite: an agent read a green test file as the precedent
// for its own work before noticing the page it tested reached no route. A test
// is not a door. Until Phase 2, treat this module as a design, not a feature —
// and if Phase 2 is cancelled, DELETE these files rather than leaving them
// looking shipped.

import { useCallback, useLayoutEffect, useSyncExternalStore } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// THIS IS THE ONLY CURSOR IN THE BUILD. No section may keep its own `useState`
// index — Screener, Journal, Catalysts, Notebook, Calendar and Morning Wire all
// register their rendered list here and read the index back out.
//
// ⭐ WHY A MODULE-LEVEL STORE (requirement: persists across fan open/close).
// The joystick's own chrome — the mode chip ("Screener · 3/41"), the Peek sheet,
// the Actions button — are separate components from the section's list render,
// and none of Phase 2/3's gesture UI exists yet to say for certain which of them
// mount/unmount as the fan opens and closes. A plain `useState` inside whichever
// component happens to own it would lose the index the moment THAT component
// unmounts for any reason unrelated to the list itself. Keying a module-level
// map by `listId` decouples "where the index lives" from "which component is
// currently mounted" — any consumer of the same listId, no matter its own
// lifecycle, reads and writes the identical source of truth. This mirrors the
// existing `drawingsStore.js` pattern in this repo (Map registry + subscribe/
// notify + `_reset` test helper) rather than inventing a new idiom.
// ─────────────────────────────────────────────────────────────────────────────

const EMPTY_ITEMS = [];
const KEY_SEP = ''; // a separator no real item key is expected to contain

/** @type {Map<string, { index: number, identity: string|null, listeners: Set<() => void> }>} */
const _cursors = new Map();

function getStore(listId) {
  let store = _cursors.get(listId);
  if (!store) {
    store = { index: 0, identity: null, listeners: new Set() };
    _cursors.set(listId, store);
  }
  return store;
}

function notify(store) {
  store.listeners.forEach((fn) => fn());
}

function subscribe(listId, cb) {
  const store = getStore(listId);
  store.listeners.add(cb);
  return () => {
    store.listeners.delete(cb);
  };
}

function readIndex(listId) {
  return getStore(listId).index;
}

/**
 * @typedef {(item: any, index: number) => (string|number)} HubCursorKeyFn
 */

/**
 * Default key function. Handles the shapes actually in scope for §2d's six sections without
 * requiring every caller to pass `opts.key`:
 *  - Morning Wire's cursor list is the literal `rd-seg` key strings ('tape', 'macro', ...) — a
 *    bare string/number IS its own key.
 *  - Journal positions, Notebook notes carry `id`. Screener/Catalysts rows carry `sym`/`symbol`.
 *  - Calendar's day objects are expected to carry `date`.
 * Falls back to positional identity as a last resort so the hook stays inert (never throws) on an
 * unrecognized shape — but a caller whose items don't match one of the above SHOULD pass its own
 * `opts.key`, or a reorder-only change will read as "same identity" when it should not.
 * @type {HubCursorKeyFn}
 */
function defaultKey(item, index) {
  if (item == null) return `__null_${index}`;
  if (typeof item === 'string' || typeof item === 'number') return item;
  if (typeof item === 'object') {
    if (item.id != null) return `id:${item.id}`;
    if (item.sym != null) return `sym:${item.sym}`;
    if (item.symbol != null) return `sym:${item.symbol}`;
    if (item.date != null) return `date:${item.date}`;
    if (item.key != null) return `key:${item.key}`;
  }
  return `__pos_${index}`;
}

function computeIdentity(list, keyFn) {
  let out = '';
  for (let i = 0; i < list.length; i++) {
    if (i > 0) out += KEY_SEP;
    out += String(keyFn(list[i], i));
  }
  return out;
}

/**
 * The identity rule (requirement 1) + the shrink-safety clamp (requirement 7), in one place.
 *
 * IDENTITY is the ordered join of every item's key — NOT the array's object reference. A
 * re-render or a poll that hands back a *new array wrapping the same rows in the same order*
 * (exactly what `useJ2Positions`'s 15s poll does) produces the SAME joined-key string, so this
 * function sees no change and leaves the stored index untouched: the Journal cursor does not jump
 * home every 15 seconds. Any real membership or order change — a row added, removed, or
 * reshuffled — changes the joined string, which IS a genuinely different list, so the index
 * resets to 0.
 *
 * Independently of that, the index is ALWAYS clamped into `[0, count-1]` afterward. This is what
 * keeps a list that shrinks *out from under* the stored index safe to read even before this
 * function has had a chance to run again (see the render-time clamp in the hook below for the one
 * frame between a props change and this effect) — belt-and-suspenders, not the reset mechanism
 * itself.
 */
function reconcile(listId, identity, count) {
  const store = getStore(listId);
  const prevIndex = store.index;

  if (store.identity !== identity) {
    store.identity = identity;
    store.index = 0;
  }

  const maxIndex = Math.max(count - 1, 0);
  if (store.index > maxIndex) store.index = maxIndex;
  if (store.index < 0) store.index = 0;

  if (store.index !== prevIndex) notify(store);
}

const EMPTY_ITEM_PROPS = {};
const ACTIVE_ITEM_PROPS = { 'data-hub-cursor': 'active' };

/**
 * @typedef {Object} HubCursorApi
 * @property {*} item        The item at `index`, or `undefined` when the list is empty.
 * @property {number} index  0-based position of `item`, or -1 when the list is empty.
 * @property {number} count  `items.length` — for chip text like "Screener · 3/41".
 * @property {() => void} next    Advance one. Clamps at the last item; never wraps.
 * @property {() => void} prev    Retreat one. Clamps at the first item; never wraps.
 * @property {(delta: number) => void} scrubTo
 *   Jump to an absolute position along the list. `delta` is normalized 0 (first item)..1 (last
 *   item); values outside that range clamp at both ends rather than wrapping or throwing (a
 *   hold-and-drag scrub routinely overshoots the pad's travel limit).
 * @property {(i: number) => Record<string, string>} itemProps
 *   Declarative path — spread onto row `i`'s JSX element. `{ 'data-hub-cursor': 'active' }` for
 *   the current row, `{}` (no attribute at all) for every other row.
 * @property {(nodes: ArrayLike<(Element|null|undefined)>) => void} paintCursor
 *   Imperative path, for a "row" that isn't a React element — Morning Wire's segments are DOM
 *   nodes inside a `dangerouslySetInnerHTML` blob, so it cannot use `itemProps`. Pass the section's
 *   row nodes in the SAME order as `items` from a `useEffect` keyed on `index`; this sets
 *   `data-hub-cursor="active"` on the current node and removes it from every other one. One hook,
 *   two consumption modes — the selection semantics (which index is "active") are identical.
 */

/**
 * The shared cursor. See the file header (§2d) for the full contract.
 *
 * @param {string} listId  Stable id for the underlying list — the registry's `cursor.listId`
 *   (e.g. 'journal'). Distinct listIds are fully independent; nothing is ever shared across them.
 * @param {any[]} [items]  The list currently on screen, in display order. Pass the RENDERED array
 *   — post filter/sort/merge — never the raw fetch: Screener, Journal and Catalysts each locally
 *   re-derive their array, and registering the raw one would make next/prev visit rows that are
 *   not visually adjacent (spec §2d ⚠️).
 * @param {{ key?: HubCursorKeyFn }} [opts]  `key` overrides `defaultKey` above.
 * @returns {HubCursorApi}
 */
export default function useHubCursor(listId, items, opts) {
  const list = items ?? EMPTY_ITEMS;
  const keyFn = (opts && opts.key) || defaultKey;
  const count = list.length;
  const identity = computeIdentity(list, keyFn);

  const subscribeToStore = useCallback((cb) => subscribe(listId, cb), [listId]);
  const getSnapshot = useCallback(() => readIndex(listId), [listId]);
  // No SSR in this app (Vite SPA, not Next.js) — the client and "server" snapshot are the same
  // pure read; useSyncExternalStore only ever calls the client one here.
  const storedIndex = useSyncExternalStore(subscribeToStore, getSnapshot, getSnapshot);

  // Reconciliation is a side effect (it mutates the module-level store), so it runs in a layout
  // effect rather than inline during render — mirroring this repo's own pinned
  // useSyncExternalStore contract in drawingsStore.js: "getSnapshot is SIDE-EFFECT FREE ... lazy
  // work happens in subscribe, which runs in the passive effect." useLayoutEffect (not a plain
  // effect) so a just-changed identity resolves to index 0 BEFORE the browser paints — never a
  // visible flash of the wrong row.
  useLayoutEffect(() => {
    reconcile(listId, identity, count);
  }, [listId, identity, count]);

  // Defensive clamp for the one render between a props change landing and the layout effect above
  // running: never trust the stored index against THIS render's count. This is requirement 7 made
  // unconditional — true regardless of whether reconcile() has run yet for this identity/count.
  const effectiveIndex = count > 0 ? Math.min(Math.max(storedIndex, 0), count - 1) : -1;
  const item = effectiveIndex >= 0 ? list[effectiveIndex] : undefined;

  const next = useCallback(() => {
    if (count <= 0) return;
    const store = getStore(listId);
    const n = Math.min(store.index + 1, count - 1);
    if (n !== store.index) {
      store.index = n;
      notify(store);
    }
  }, [listId, count]);

  const prev = useCallback(() => {
    if (count <= 0) return;
    const store = getStore(listId);
    const p = Math.max(store.index - 1, 0);
    if (p !== store.index) {
      store.index = p;
      notify(store);
    }
  }, [listId, count]);

  const scrubTo = useCallback(
    (delta) => {
      if (count <= 0) return;
      const store = getStore(listId);
      const clamped = delta < 0 ? 0 : delta > 1 ? 1 : delta;
      const target = Math.round(clamped * (count - 1));
      if (target !== store.index) {
        store.index = target;
        notify(store);
      }
    },
    [listId, count],
  );

  const itemProps = useCallback(
    (i) => (i === effectiveIndex ? ACTIVE_ITEM_PROPS : EMPTY_ITEM_PROPS),
    [effectiveIndex],
  );

  const paintCursor = useCallback(
    (nodes) => {
      if (!nodes) return;
      for (let i = 0; i < nodes.length; i++) {
        const el = nodes[i];
        if (!el) continue;
        if (i === effectiveIndex) el.setAttribute('data-hub-cursor', 'active');
        else el.removeAttribute('data-hub-cursor');
      }
    },
    [effectiveIndex],
  );

  return { item, index: effectiveIndex, count, next, prev, scrubTo, itemProps, paintCursor };
}

export { useHubCursor };

// ── Test/debug helpers (mirrors drawingsStore.js's `_reset`) ────────────────
export function _reset() {
  _cursors.clear();
}

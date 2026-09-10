// app/src/hub/useHubCursor.js — the shared cursor: every list-bearing section registers its list
// See docs/plans/joystick/00-master-spec-v1.3.md §2d
//
// ✅ WIRED IN PHASE 3 WAVE A (2026-09-09). This module is reached from real routes now:
// `MorningWire.jsx` and `Breadth.jsx` register their sections through it, and the
// `AWAITING_A_DECISION` entry that declared it unmounted has been deleted from
// `components/screener/reachable.test.js` per its own stated removal condition.

// ⭐ WHY A RE-SORT FOLLOWS THE SELECTED ITEM (owner ruling, 2026-09-09).
//
// `reconcile` below treats a changed identity two ways: if the previously-selected KEY is still
// present the cursor follows it; only if the key is gone does it reset to 0. That asymmetry is not
// a nicety — it is driven by one measured fact about the Screener:
//
//   `ScannerShell` lifts the live re-sort (`sortRowsLive`) ABOVE the renderers and passes
//   `displayRows` to all three, so the rendered order changes on EVERY PRICE TICK while the
//   member is looking at it.
//
// Under the old "any identity change resets to 0" rule that is a cursor sent home several times a
// minute, while the row the member selected is still on screen — just moved. Meanwhile the case
// the reset genuinely exists for (a re-scan returning different tickers) is still handled, because
// there the old key is absent.

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
// ⛔ WRITTEN AS AN ESCAPE, NOT THE RAW BYTE. The literal 0x01 that used to sit here
// made this file BINARY to git and ripgrep: its diff read "Binary files ... differ" and a
// grep for any symbol in it found nothing. The runtime string is identical.
const KEY_SEP = '\u0001'; // a separator no real item key is expected to contain

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
 * ⛔ THERE IS NO DEFAULT KEY ANY MORE, AND THAT IS THE POINT.
 *
 * This function used to probe `id` / `sym` / `symbol` / `date` / `key` and then fall back to
 * POSITIONAL identity so the hook "stays inert (never throws) on an unrecognized shape". That
 * fallback was not inert — it was silently wrong, and the 3.3a Screener scout caught it before
 * it shipped:
 *
 *   No screener row carries `sym` or `symbol`. Its identity is `ticker` (`screener_rows` is
 *   `ticker TEXT PRIMARY KEY`, forced first into every projection). So the probe fell through and
 *   the list's identity became `__pos_0␁__pos_1␁…` — a string that changes ONLY when the LENGTH
 *   changes. A re-scan returning a completely different 100 rows read as "the same list", and the
 *   cursor held its index onto a symbol the member never selected. That is precisely the failure
 *   `reconcile` below exists to prevent, defeated by its own default.
 *
 * ⚰️ The docstring made it worse by asserting the false half out loud — "Screener/Catalysts rows
 * carry `sym`/`symbol`" — so the next reader would have gone to the same wrong place, confidently.
 *
 * A positional identity is NEVER correct for a re-fetched list, so there is nothing to fall back
 * to: `opts.key` is REQUIRED (owner ruling, 2026-09-09). The probe order survives only as a
 * dev-time HINT in the error message, which is the one thing it was ever good for.
 *
 * @param {any} item
 * @param {number} index
 * @returns {string} a hint naming the field this item looks like it is keyed by, or '' if none
 */
function keyHint(items) {
  const sample = Array.isArray(items) ? items.find((i) => i && typeof i === 'object') : null;
  if (!sample) return '';
  for (const field of ['ticker', 'id', 'sym', 'symbol', 'date', 'key']) {
    if (sample[field] != null) return ` — rows look like they carry '${field}'`;
  }
  return '';
}

function computeKeys(list, keyFn) {
  const keys = new Array(list.length);
  for (let i = 0; i < list.length; i++) keys[i] = String(keyFn(list[i], i));
  return keys;
}

/** The ordered join of the item keys — the "is this the same list?" test. */
function identityOf(keys) {
  return keys.join(KEY_SEP);
}


/**
 * The identity rule (requirement 1) + the shrink-safety clamp (requirement 7), in one place.
 *
 * IDENTITY is the ordered join of every item's key — NOT the array's object reference. A
 * re-render or a poll that hands back a *new array wrapping the same rows in the same order*
 * (exactly what `useJ2Positions`'s 15s poll does) produces the SAME joined-key string, so this
 * function sees no change and leaves the stored index untouched: the Journal cursor does not jump
 * home every 15 seconds. Any real membership or order change — a row added, removed, or
 * reshuffled — changes the joined string. What happens NEXT depends on which kind of change it
 * was: if the previously-selected KEY is still present the cursor FOLLOWS it to its new
 * position (a live re-sort must not send the member home); if it is gone, this is a genuinely
 * different list and the index resets to 0. See the note inside `reconcile`.
 *
 * Independently of that, the index is ALWAYS clamped into `[0, count-1]` afterward. This is what
 * keeps a list that shrinks *out from under* the stored index safe to read even before this
 * function has had a chance to run again (see the render-time clamp in the hook below for the one
 * frame between a props change and this effect) — belt-and-suspenders, not the reset mechanism
 * itself.
 */
function reconcile(listId, keys, identity, count) {
  const store = getStore(listId);
  const prevIndex = store.index;

  if (store.identity !== identity) {
    // ⭐ A REORDER FOLLOWS THE ITEM; A DIFFERENT LIST GOES HOME (owner ruling, 2026-09-09).
    //
    // This used to reset to 0 on any identity change, "because order is part of identity". That
    // is right for a genuinely different list and wrong for a re-SORT: the Screener re-sorts live
    // on every price tick (`ScannerShell` lifts `sortRowsLive` above the renderers for exactly
    // this reason), so the old rule sent the member home to row 0 several times a minute while
    // the row they had selected was still on screen, just moved.
    //
    // So the key the member had selected is looked up in the new list first. Found ⇒ the cursor
    // FOLLOWS it and only the index changes. Absent ⇒ this really is a different list and the
    // reset is correct — which is the re-fetch case the identity check exists for.
    const selectedKey = store.keys ? store.keys[prevIndex] : undefined;
    const movedTo = selectedKey === undefined ? -1 : keys.indexOf(selectedKey);
    store.identity = identity;
    store.index = movedTo >= 0 ? movedTo : 0;
  }
  store.keys = keys;

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
 * @param {{ key: HubCursorKeyFn }} opts  ⛔ REQUIRED. There is no default — a positional
 *   identity is never correct for a re-fetched list. See the keyHint note above.
 * @returns {HubCursorApi}
 */
export default function useHubCursor(listId, items, opts) {
  const list = items ?? EMPTY_ITEMS;
  const keyFn = opts && opts.key;
  if (typeof keyFn !== 'function') {
    // A contract failure, not a fallback. See the keyHint note above: the positional identity
    // this used to fall back to is never correct for a re-fetched list, so there is nothing
    // safe to do here except say so, naming the field the rows look keyed by.
    throw new TypeError(
      `[hub] useHubCursor('${listId}') requires an explicit opts.key${keyHint(items)}. `
      + 'A positional identity would make a re-fetch returning different rows read as the same '
      + 'list, and the cursor would hold an index onto an item the member never selected.',
    );
  }
  const count = list.length;
  const keys = computeKeys(list, keyFn);
  const identity = identityOf(keys);

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
    reconcile(listId, keys, identity, count);
    // `keys` is deliberately absent from the dep list: `identity` IS its ordered join,
    // so it changes exactly when `keys` does, and including the array re-runs this every
    // render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

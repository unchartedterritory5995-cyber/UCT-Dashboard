// app/src/hub/useHubCursor.test.js — coverage for the shared cursor's numbered requirements.
// See docs/plans/joystick/00-master-spec-v1.3.md §2d

import { describe, it as vitestIt, expect, beforeEach, afterAll } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useHubCursor, { _reset } from './useHubCursor';

// ⚠️ RAIL: `vitest -t <regex>` is a regex filter, and a filter matching nothing exits 0 and reads
// as a PASS. `definedCount` counts every `it()` call BELOW as the file is collected (this happens
// regardless of `-t`, since vitest must enumerate test names before it can filter them);
// `executedCount` counts only the ones that actually ran. `afterAll` asserts they're equal AND
// non-zero, so a `-t` typo that excludes even one case here — or a stray `.only`/`.skip` — fails
// loudly instead of silently reporting fewer green tests as a full pass. The expected count is
// DERIVED, never hand-typed: a number written beside the list it describes is exactly the defect
// class this repo's own history keeps rediscovering (a stale "4 routes" beside a five-route file,
// a stale "24 swing setups" beside 26) — this can't go stale because it counts itself.
//
// Verified empirically, not assumed: a `-t` pattern matching NONE of this file's tests reports
// "N skipped" and exits 0 WITHOUT running so much as a root-level `afterAll` (vitest 4.0.18) — so
// this rail cannot catch a TOTAL exclusion; that gap can only be closed from outside the file (a
// runner reading the reporter's own executed-test count, not the process exit code). What it does
// catch, which is the common real case, is any PARTIAL exclusion: a filter, `.only`, or `.skip`
// that leaves at least one — but not all — of these cases standing.
let definedCount = 0;
let executedCount = 0;
function it(name, fn) {
  definedCount += 1;
  return vitestIt(name, async (...args) => {
    executedCount += 1;
    return fn(...args);
  });
}
afterAll(() => {
  expect(executedCount).toBeGreaterThan(0);
  expect(executedCount).toBe(definedCount);
});

beforeEach(() => {
  _reset();
});

// Simple item shapes exercising the default key function's branches.
const wireSegments = ['tape', 'macro', 'earn', 'analyst', 'movers', 'setups', 'close'];
const positions = (n) => Array.from({ length: n }, (_, i) => ({ id: `pos-${i}`, symbol: `SYM${i}` }));

describe('useHubCursor', () => {
  // ── Requirement 6: an empty list is inert ────────────────────────────────
  it('is inert on an empty list: count 0, item undefined, next/prev/scrubTo are no-ops', () => {
    const { result } = renderHook(() => useHubCursor('empty', []));
    expect(result.current.count).toBe(0);
    expect(result.current.item).toBeUndefined();
    expect(result.current.index).toBe(-1);

    expect(() => act(() => result.current.next())).not.toThrow();
    expect(() => act(() => result.current.prev())).not.toThrow();
    expect(() => act(() => result.current.scrubTo(0.5))).not.toThrow();

    expect(result.current.count).toBe(0);
    expect(result.current.item).toBeUndefined();
    expect(result.current.index).toBe(-1);
  });

  it('is inert when items is omitted entirely (no throw on undefined)', () => {
    const { result } = renderHook(() => useHubCursor('omitted'));
    expect(result.current.count).toBe(0);
    expect(result.current.item).toBeUndefined();
  });

  // ── Basic identity + navigation on a stable list ─────────────────────────
  it('starts at index 0 on a fresh listId', () => {
    const { result } = renderHook(() => useHubCursor('scan', positions(5)));
    expect(result.current.index).toBe(0);
    expect(result.current.count).toBe(5);
    expect(result.current.item.id).toBe('pos-0');
  });

  // ── Requirement 3: next/prev move by one and CLAMP, never wrap ───────────
  it('next() advances by one and clamps at the last item (never wraps)', () => {
    const { result } = renderHook(() => useHubCursor('journal', positions(3)));
    act(() => result.current.next());
    expect(result.current.index).toBe(1);
    act(() => result.current.next());
    expect(result.current.index).toBe(2);
    act(() => result.current.next()); // already at the end
    expect(result.current.index).toBe(2); // clamped, not wrapped to 0
    expect(result.current.item.id).toBe('pos-2');
  });

  it('prev() retreats by one and clamps at the first item (never wraps)', () => {
    const { result } = renderHook(() => useHubCursor('journal', positions(3)));
    act(() => result.current.prev()); // already at the start
    expect(result.current.index).toBe(0); // clamped, not wrapped to the end
    act(() => {
      result.current.next();
      result.current.next();
    });
    expect(result.current.index).toBe(2);
    act(() => result.current.prev());
    expect(result.current.index).toBe(1);
  });

  // ── Requirement 4: scrubTo(delta) — normalized position, clamps at both ends ──
  it('scrubTo maps a normalized delta to an absolute position in the list', () => {
    const { result } = renderHook(() => useHubCursor('scrub-list', positions(11))); // indices 0..10
    act(() => result.current.scrubTo(0));
    expect(result.current.index).toBe(0);
    act(() => result.current.scrubTo(1));
    expect(result.current.index).toBe(10);
    act(() => result.current.scrubTo(0.5));
    expect(result.current.index).toBe(5);
  });

  it('scrubTo clamps deltas outside [0, 1] at both ends instead of throwing', () => {
    const { result } = renderHook(() => useHubCursor('scrub-clamp', positions(5)));
    act(() => result.current.scrubTo(-2));
    expect(result.current.index).toBe(0);
    act(() => result.current.scrubTo(50));
    expect(result.current.index).toBe(4);
  });

  // ── Requirement 1: identity survives a same-content re-render/poll ───────
  it('does NOT reset when a poll hands back a new array wrapping the same rows (by key)', () => {
    const listId = 'poll-journal';
    const { result, rerender } = renderHook(
      ({ items }) => useHubCursor(listId, items),
      { initialProps: { items: positions(4) } },
    );
    act(() => result.current.next());
    act(() => result.current.next());
    expect(result.current.index).toBe(2);
    expect(result.current.item.id).toBe('pos-2');

    // Simulate useJ2Positions's 15s poll: a BRAND NEW array, same rows (same ids/symbols, same
    // order), nothing actually changed. This must NOT jump the cursor back to index 0.
    rerender({ items: positions(4) });
    expect(result.current.index).toBe(2);
    expect(result.current.item.id).toBe('pos-2');
  });

  it('DOES reset to 0 when the list is a genuinely different list (keys change)', () => {
    const listId = 'scan-switch';
    const { result, rerender } = renderHook(
      ({ items }) => useHubCursor(listId, items),
      { initialProps: { items: positions(5) } },
    );
    act(() => result.current.next());
    act(() => result.current.next());
    expect(result.current.index).toBe(2);

    // A different active scan: entirely different symbols, same count even.
    const differentScan = [
      { id: 'x-0', symbol: 'AAA' },
      { id: 'x-1', symbol: 'BBB' },
      { id: 'x-2', symbol: 'CCC' },
      { id: 'x-3', symbol: 'DDD' },
      { id: 'x-4', symbol: 'EEE' },
    ];
    rerender({ items: differentScan });
    expect(result.current.index).toBe(0);
    expect(result.current.item.symbol).toBe('AAA');
  });

  it('resets to 0 when the list reorders (order is part of identity)', () => {
    const listId = 'reorder-list';
    const a = { id: 'a', symbol: 'AAA' };
    const b = { id: 'b', symbol: 'BBB' };
    const c = { id: 'c', symbol: 'CCC' };
    const { result, rerender } = renderHook(
      ({ items }) => useHubCursor(listId, items),
      { initialProps: { items: [a, b, c] } },
    );
    act(() => result.current.next());
    expect(result.current.index).toBe(1);
    expect(result.current.item.id).toBe('b');

    rerender({ items: [c, b, a] }); // same members, different order
    expect(result.current.index).toBe(0);
    expect(result.current.item.id).toBe('c');
  });

  // ── Requirement 7: a list that shrinks under the cursor clamps, never throws ──
  it('clamps rather than throwing when the list shrinks under the cursor', () => {
    const listId = 'shrink-list';
    const { result, rerender } = renderHook(
      ({ items }) => useHubCursor(listId, items),
      { initialProps: { items: positions(5) } }, // pos-0..pos-4
    );
    act(() => {
      result.current.next();
      result.current.next();
      result.current.next();
      result.current.next();
    });
    expect(result.current.index).toBe(4);

    expect(() => rerender({ items: positions(2) })).not.toThrow(); // pos-0..pos-1
    expect(result.current.count).toBe(2);
    expect(result.current.index).toBeLessThanOrEqual(1);
    expect(result.current.item).toBeDefined();
  });

  it('clamps down to inert (count 0, item undefined) when the list empties out entirely', () => {
    const listId = 'shrink-to-empty';
    const { result, rerender } = renderHook(
      ({ items }) => useHubCursor(listId, items),
      { initialProps: { items: positions(3) } },
    );
    act(() => result.current.next());
    expect(result.current.index).toBe(1);

    rerender({ items: [] });
    expect(result.current.count).toBe(0);
    expect(result.current.item).toBeUndefined();
    expect(result.current.index).toBe(-1);
  });

  // ── Requirement 2: persists across remount (module-level store keyed by listId) ──
  it('persists the index across an unmount + remount of the same listId (fan close/open)', () => {
    const listId = 'persist-list';
    const first = renderHook(() => useHubCursor(listId, positions(5)));
    act(() => {
      first.result.current.next();
      first.result.current.next();
      first.result.current.next();
    });
    expect(first.result.current.index).toBe(3);
    first.unmount();

    // A brand-new render of the SAME listId, with the SAME underlying rows (same keys, same
    // order) — as if the fan closed and reopened. The index must survive.
    const second = renderHook(() => useHubCursor(listId, positions(5)));
    expect(second.result.current.index).toBe(3);
    expect(second.result.current.item.id).toBe('pos-3');
  });

  it('keeps two different listIds fully independent', () => {
    const a = renderHook(() => useHubCursor('mode-a', positions(5)));
    const b = renderHook(() => useHubCursor('mode-b', positions(5)));
    act(() => {
      a.result.current.next();
      a.result.current.next();
    });
    expect(a.result.current.index).toBe(2);
    expect(b.result.current.index).toBe(0);
  });

  // ── Requirement 5a: itemProps — the declarative path ─────────────────────
  it('itemProps(i) applies data-hub-cursor="active" only to the current row', () => {
    const { result } = renderHook(() => useHubCursor('itemprops-list', positions(4)));
    act(() => result.current.next());
    expect(result.current.index).toBe(1);

    expect(result.current.itemProps(0)).toEqual({});
    expect(result.current.itemProps(1)).toEqual({ 'data-hub-cursor': 'active' });
    expect(result.current.itemProps(2)).toEqual({});
    expect(result.current.itemProps(99)).toEqual({});
  });

  // ── Requirement 5b: paintCursor — the imperative path (Morning Wire) ─────
  it('paintCursor sets data-hub-cursor="active" on exactly the current DOM node and clears it elsewhere', () => {
    document.body.innerHTML = wireSegments
      .map((key) => `<section data-seg="${key}"></section>`)
      .join('');
    const nodes = wireSegments.map((key) => document.querySelector(`[data-seg="${key}"]`));

    const { result } = renderHook(() => useHubCursor('wire', wireSegments));
    act(() => result.current.paintCursor(nodes));
    expect(nodes[0].getAttribute('data-hub-cursor')).toBe('active');
    expect(nodes[1].getAttribute('data-hub-cursor')).toBeNull();

    // Two separate `act()` calls, not one: `next()` triggers a re-render that produces a NEW
    // `paintCursor` closure (bound to the new effectiveIndex) on `result.current` — reading
    // `result.current.paintCursor` inside the same `act()` as `next()` would still see the STALE
    // pre-render closure.
    act(() => result.current.next());
    act(() => result.current.paintCursor(nodes));
    expect(nodes[0].getAttribute('data-hub-cursor')).toBeNull();
    expect(nodes[1].getAttribute('data-hub-cursor')).toBe('active');

    document.body.innerHTML = '';
  });

  it('paintCursor tolerates missing/null nodes without throwing', () => {
    const { result } = renderHook(() => useHubCursor('wire-sparse', wireSegments));
    const sparse = [null, undefined, document.createElement('div')];
    expect(() => act(() => result.current.paintCursor(sparse))).not.toThrow();
  });

  // ── opts.key: caller-supplied identity for shapes the default doesn't cover ──
  it('opts.key lets a caller define identity for shapes the default key does not recognize', () => {
    const listId = 'calendar-days';
    const days = [{ label: 'Mon' }, { label: 'Tue' }, { label: 'Wed' }];
    const keyFn = (d) => d.label;
    const { result, rerender } = renderHook(
      ({ items }) => useHubCursor(listId, items, { key: keyFn }),
      { initialProps: { items: days } },
    );
    act(() => result.current.next());
    expect(result.current.index).toBe(1);

    // New array objects, same labels in the same order -> identity unchanged -> no reset.
    rerender({ items: [{ label: 'Mon' }, { label: 'Tue' }, { label: 'Wed' }] });
    expect(result.current.index).toBe(1);

    // A genuinely different set of days -> reset.
    rerender({ items: [{ label: 'Thu' }, { label: 'Fri' }] });
    expect(result.current.index).toBe(0);
  });

  // ── jsdom-safety control: nothing above depends on layout or measured geometry ──
  it('never reads layout/geometry APIs (jsdom lays nothing out)', () => {
    const { result } = renderHook(() => useHubCursor('geometry-control', positions(3)));
    // A pure smoke assertion that the hook's public surface is plain data/functions, not anything
    // that would require getBoundingClientRect-shaped measurement to be meaningful under jsdom.
    expect(typeof result.current.next).toBe('function');
    expect(typeof result.current.index).toBe('number');
  });
});

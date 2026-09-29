# D5 fix round 1 — mutation log

Scoped run: `npx vitest run --maxWorkers=2` on the 3 board-view test files.
Clean-state totals: **3 files passed, 46 tests passed** (14 + 23 + 9).

Every mutation below was applied to `NoteBoardView.jsx` or `NoteBoardView.module.css`,
run against the scoped rail, then restored from a scratchpad byte capture and
verified by sha256 equality against the pre-mutation capture — never
`git checkout`. Clean hashes (final, committed state):

```
NoteBoardView.jsx                = 058a4f50935ebbc9563288a026a4e963f2f704cf5a5bd2ac1e2c9c1f97b6ddc9
NoteBoardView.module.css         = ed03f80a799e8ecc9c0a941e84c877a27342bd7397ada3b56f61fc18fd55b78d
NoteBoardView.scrollFade.test.jsx = 1ba14000b921faf79c0693a0558ff7fa93e8fb0ce2b1d44e776c3a1bcfb25b34
```

## I1a — delete the whole effect cleanup block

`return () => { dead = true; el.removeEventListener(...); ro?.disconnect(); window.removeEventListener(...) }`
deleted outright.

Result: **1 failed / 13 passed** (of 14 in scrollFade.test.jsx). The only red test:
`control: unmounting REMOVES every listener with the SAME fn reference and disconnects
its ResizeObserver`, on `el.removeEventListener(scroll, SAME fn) was called: expected
false to be true`. All 13 others (including every other rendered test) stayed green.

Restored; sha256 verified `058a4f50...`; full 46/46 re-confirmed green.

## I1b — drop only `window.removeEventListener('resize', update)`

Result: **1 failed / 13 passed.** Same test, different assertion:
`window.removeEventListener(resize, SAME fn) was called: expected false to be true`.

Restored; sha256 verified `058a4f50...`.

## M1a — drop the 2px end tolerance (`el.scrollLeft < max - 2` → `< max`)

Result: **1 failed / 13 passed.** Only `a sub-pixel scrollLeft inside the 2px END
tolerance reads as fully scrolled` went red (`expected 'false' to be 'true'` at
`scrollLeft = MAX_SCROLL - 1.5`).

Restored; sha256 verified `058a4f50...`.

## M1b — loosen the overflow floor (`max > 2` → `max > 0`)

Result: **1 failed / 13 passed.** Only `the ">2" overflow floor is not ">0" -- a 1-2px
overflow never opens the fan` went red (`expected 'false' to be 'true'` at
`clientWidth+2 / scrollLeft=-1`) — confirming the synthetic negative-scrollLeft design
was necessary and sufficient: at scrollLeft>=0 the tolerance clause alone forces
'false' regardless of this gate, so only a scrollLeft<0 probe can distinguish `>2`
from `>0` (derived before running, then confirmed empirically).

Restored; sha256 verified `058a4f50...`.

## M3 re-run — Mutation B (CSS selector value renamed, `"true"` → `"mutated-off"`)

First pass (before the M3 restructure) used a shared `beforeAll`-resolved `fade`:
result was **9 passed / 6 skipped**, one failed SUITE (not 6 named test failures) —
better than the original all-file collection death, but the CSS-dependent tests were
skipped, not individually failed.

Restructured so each `it()` calls `getFade()` itself (lazy per-test resolution, no
shared `beforeAll`-computed value). Re-ran the same mutation:

Result: **5 failed / 9 passed** (of 14). All 8 RENDERED tests ran and passed
normally. Of the 6 CSS/structural tests, 5 failed **individually, by name**, each
with the clear `.columns[data-board-scroll-more="true"] not found` error at its own
`getFade()` call site; the 6th (`control: an overlay-div idiom...`) correctly still
passed, since it constructs its own fixture selector and never calls `getFade()`.

Restored; sha256 verified `ed03f80a...`. Full 46/46 re-confirmed green.

## Final state

```
npx vitest run --maxWorkers=2 \
  src/pages/journal-2-0/components/notebook/NoteBoardView.scrollFade.test.jsx \
  src/pages/journal-2-0/components/notebook/NoteBoardView.scrollsAlone.test.js \
  src/pages/journal-2-0/components/notebook/NoteBoardView.test.jsx

Test Files  3 passed (3)
     Tests  46 passed (46)
```

scrollFade.test.jsx: **14 tests** — 8 rendered (6 original + 2 new from M1) + 6
CSS/structural (5 original + 1 new from M4).

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

# D5 fix round 2 — mutation log

Re-review verdict: code and rails sound, one decision (F1) closed, three report fixes
(F2/F3/F4), one cheap rigor NIT. Scoped run unchanged: `npx vitest run --maxWorkers=2`
on the 3 board-view files, still **3 files passed, 46 tests passed** (14 + 23 + 9) after
every change below.

Round-2 clean hashes (final, committed state):

```
NoteBoardView.jsx                 = e4f2402b3ebfa2661e3dc3b28be16d0e7ad25f478c3bb9a906343104c10f0026
NoteBoardView.scrollFade.test.jsx = 61ffe3d8259d3e05572504493beee22c417074af734ccaf6afef510e1611b339
```

(`NoteBoardView.module.css` is untouched this round; its round-1 hash
`ed03f80a...` above still applies.)

## F1 — drop the `max > 2` floor (controller ruling, option (a))

`const next = max > 2 && el.scrollLeft < max - 2` → `const next = el.scrollLeft < max - 2`.
At `NoteBoardView.jsx`, the effect's `update()`. The floor was implied by the
tolerance clause for every REAL (`scrollLeft >= 0`) input — at `max <= 2`,
`scrollLeft < max - 2` already forces `false` for any non-negative `scrollLeft` — so
M1b's own mutation-proof needed a SYNTHETIC negative `scrollLeft` to tell `max > 2`
apart from a loosened `max > 0`, which was the tell that the floor railed a code
token, never a behaviour a member's browser could reach. M1b's test
(`"the '>2' overflow floor is not '>0'..."`, synthetic `scrollLeft=-1`) is DELETED.
Its real-input replacement (`"a 1-2px overflow at rest (scrollLeft=0) still reads as
not-yet-scrollable"`) asserts the same boundary case at `scrollLeft=0` — the only
value a member's browser produces — and passes through the tolerance clause alone.

### M1a re-run (post-F1) — drop the 2px end tolerance (`< max - 2` → `< max`)

Result: **2 failed / 12 passed** (of 14) — one MORE red than round 1's M1a run, and
correctly so: with the floor gone, BOTH tests that exercise the tolerance clause at
a small `max` now depend on it alone, so dropping it reds both:
- `a sub-pixel scrollLeft inside the 2px END tolerance reads as fully scrolled`
  (`expected 'false' to be 'true'` at `scrollLeft = MAX_SCROLL - 1.5`)
- `a 1-2px overflow at rest (scrollLeft=0) still reads as not-yet-scrollable`
  (`expected 'false' to be 'true'` at `max=2, scrollLeft=0`)

Restored; sha256 verified `e4f2402b...`.

⚠️ **Correction to round 1's "necessary and sufficient" paragraph.** That paragraph
(above, under the now-deleted M1b) claimed the synthetic-negative-scrollLeft design
was "necessary and sufficient" to isolate the floor from the tolerance clause. It was
necessary — nothing has changed about that derivation. It was never "sufficient" in
the sense of being the design that should ship: the controller's F1 ruling is that a
gate provably unreachable by any real input is not a behaviour worth a permanent code
branch, however cleanly it can be pinned in a test. The floor is gone; the paragraph
is superseded by this section.

## I1a re-run (post-NIT) — delete the whole effect cleanup block

NIT applied first: the control test now snapshots `elRemove.mock.calls.length` /
`winRemove.mock.calls.length` **before** `unmount()`, and searches only the slice
from that index onward for the same-reference removal — so the assertion can only be
satisfied by a call made AS PART OF the unmount, never by an earlier call that
happened to share a reference for some other reason.

Same mutation as round 1's I1a (`return () => { dead = true; ... }` deleted
outright — removing the closing brace of that return statement with it, since with
the floor-removal edit `next` is now assigned two lines earlier than in round 1;
verified the file still parses before running).

Result: **1 failed / 13 passed** (of 14) — same single test as round 1, on the
NIT-reworded assertion text: `el.removeEventListener(scroll, SAME fn) was called ON
unmount: expected false to be true`. Every other test, including the new F1
real-input test, stayed green.

Restored; sha256 verified `e4f2402b...`. Full 46/46 re-confirmed green.

## F4 — reworded (no behavior change)

The M4 structural test's title and comment were reworded to lead with **"the token
is declared exactly once, and neither scroll-padding nor the mask restates a
literal"** — the assertions themselves (`scroll-padding-inline-end` equals
`var(--board-fade-w)`, the mask's `mask-image`/`-webkit-mask-image` both contain
`var(--board-fade-w)`, and the literal `--board-fade-w:\s*[\d.]+px` pattern occurs
exactly once in the file) are unchanged. No mutation re-run needed for a wording-only
change.

## Final state, round 2

```
npx vitest run --maxWorkers=2 \
  src/pages/journal-2-0/components/notebook/NoteBoardView.scrollFade.test.jsx \
  src/pages/journal-2-0/components/notebook/NoteBoardView.scrollsAlone.test.js \
  src/pages/journal-2-0/components/notebook/NoteBoardView.test.jsx

Test Files  3 passed (3)
     Tests  46 passed (46)
```

No new probe run: F1 changes no painted behaviour at any real (`scrollLeft >= 0`)
input — the fix's observable output (`data-board-scroll-more`, the computed mask) is
byte-identical to round 1's for every value a member's browser can produce. The
round-1 R-RAW evidence (`docs/notebook/proof/d5-after-round1-fix/`) still describes
the shipped behaviour accurately.

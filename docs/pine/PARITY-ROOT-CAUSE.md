# Why our output differed from TradingView — root cause, and the road to 100%

**Written 2026-09-23, from the first object-level vendor comparison this programme has
run.** Six published indicators, pasted unmodified into a live TradingView chart, their
drawn objects read out of the chart's own model (`graphics().dwglines()`,
`dwglabels()`, `dwgboxes()`) and diffed against ours.

Captures: `tests/fixtures/vendor/visual/fvg-boxes-spy-1d-2026-09-22.json`,
`five-indicators-spy-1d-2026-09-23.json`. Rail: `fvgVendorParity.test.js`.

| indicator | result |
|---|---|
| Market Structure | ⭐⭐ **exact** — 5/5 lines, 14/14 labels, same bar, same text, same price |
| Fair Value Gaps | ⭐ 47/47 boxes on the same bar |
| Inside Bar Range | ⭐ both rails exact |
| Trendlines | ⛔ every line one pivot span early |
| Liquidity Pools | ⛔ nothing we still draw is inside the vendor's window |
| 4C NYSE Breadth | ⚠️ cannot match — `request.security` has no feed here |

⭐ **That table is the 2026-09-23 MEASUREMENT and is left as measured.** All five have
since been **re-measured against the same pinned captures** — no browser needed, because
the vendor's side does not change when ours does, so re-running our engine against a
stored capture is a real comparison and not a re-render of our own work. Rails:
`fvgVendorParity.test.js`, `twoVendorParity.test.js`.

| indicator | after RC-A → RC-D |
|---|---|
| Market Structure | ⭐⭐ was already exact |
| Fair Value Gaps | ⭐⭐ **both divergences closed** — same bars, same prices, same live box count, same forward edges |
| Inside Bar Range | ⭐ was already exact on both rails |
| Liquidity Pools | ⭐⭐ **zero overlap → 86 lines / 43 labels against the vendor's 90 / 45, same window.** The 4-and-2 shortfall is our bar fixture ending 2026-09-13 against their 2026-09-22 — nine sessions, two more pools, exactly 4 lines and 2 labels |
| Trendlines | ⛔ **STILL ONE PIVOT SPAN EARLY** — root cause located below, not yet fixed |
| 4C NYSE Breadth | ⚠️ unchanged — `request.security` has no feed here |

---

## The finding under the findings

Three defects. **They are not three bugs. They are three instances of one shape:**

> ### ⛔⛔ The engine satisfies a Pine concept with a locally-reasonable primitive that RESEMBLES it, and nothing measures the difference.

Each of the three primitives is defensible on its own terms. Each differs from Pine in a
way that is invisible from inside this repo — no test could see it, because every test
compares us to us. It took the vendor's own numbers to make any of them visible.

That is the answer to "why did the code and the Pine script display differently": **not
because the translation is wrong in general, but because at three specific seams a
house concept was allowed to stand in for a Pine concept on the strength of looking
like it.**

---

## RC-A — one name table was serving two languages

**Status: FIXED (`930f14745`).**

Pine v1–v4 spelled its technical-analysis builtins without a namespace. v5 moved them
into `ta.` and left the bare spelling behind. This engine *also* has a function table
whose names a member types into the formula box — and several collide with Pine's under
**different semantics**.

`pine.js` stated the rule, and the rule was half right:

> "the bare `pivothigh(...)` still resolves to this table's own function, unshifted,
> because a member typing the bare name in OUR box means OUR vocabulary"

⭐ Correct for the formula box. **Wrong for a pasted script**: in a `//@version=4` file
the member is speaking Pine, and the same six characters mean something else.

| bare name | house meaning | Pine meaning | consequence |
|---|---|---|---|
| `pivothigh` / `pivotlow` | emits **on the pivot bar** | emits at the **confirmation bar**, `right` later | ⛔ **look-ahead** |
| `highestbars` / `lowestbars` | positive offset | **non-positive** offset | ⛔ **sign inverted** |

⛔⛔ **The pivot case is look-ahead, not an offset.** `PINE_NAMESPACED_TREE` says so
itself — the `[R]` shift *"CANCELS the look-ahead … the translated column is
non-repainting where the bare call is preview-repaints."* An engine that marks a pivot
`right` bars before the vendor could know it is an engine whose backtests see the
future. It was reachable by pasting an ordinary v4 script.

**Blast radius, measured:** 71 of 266 corpus scripts are v4; the four transformed names
appear bare in them at 28 sites across ~11 scripts.

⛔ **And the gap was already written down.** The call site read: *"a Pine v4 script may
spell a `ta.` builtin bare, and that spelling is then genuinely ambiguous …
`LEGACY_BARE_NAMESPACE` is this file's existing mechanism for that decision and it is
the pine lane's to widen; nothing here guesses."* True, and not enough. **A documented
hazard is not a bounded one.**

**Fix:** a bare name is resolved against Pine's vocabulary when the script declares
`//@version` ≤ 4, through the *same* transform `ta.<name>` uses. v5 removed the bare
spelling, so v5 keeps the house column; the formula box has no version and is
untouched. The roster rail is **derived** from `PINE_NAMESPACED_TREE`, so a transform
added later is covered the day it lands.

---

## RC-B — a correct implementation, built and left unwired past its own expiry

**Status: FIXED.**

Pine's drawing-object budget has three parts. We had two of them wrong:

| | Pine | this engine (before) |
|---|---|---|
| default cap | **50** per family | `DEFAULT_OBJECT_LIMITS` = flat **500** |
| declared override | `max_lines_count` etc., up to 500 | ✅ **already parsed** — but off the RAW source |
| at the cap | **evict the OLDEST** (FIFO) | `fail(...)` — stop creating, **keep the oldest** |

⚰️ **THIS TABLE SAID THE OVERRIDE WAS "never parsed — `declarationOverlay` reads only
`overlay`". THAT WAS WRONG.** `max_*_count` is read at `pine.js:11736` and has been.
The correction matters because the false version pointed the fix at writing a parser
that already existed, which is how the *real* third defect — that the scan ran over the
raw source, so a `max_lines_count` inside a **comment** set the budget — nearly went
unfixed. Getting a root-cause document wrong in the flattering direction (more broken
than reality) costs exactly as much as getting it wrong the other way.

`objectRuntime.js`:

```js
case 'create': {
  if (counts[op.family] >= limits[op.family]) {
    fail(`more than ${limits[op.family]} live ${op.family} objects (bar ${bar})`)
    break
  }
```

⚰️⚰️ **AND THIS PARAGRAPH SAID "THAT SINGLE BRANCH EXPLAINS LIQUIDITY POOLS COMPLETELY".
IT DID NOT EXPLAIN IT AT ALL.** The symptom was real — newest surviving line 2025-04-09
against a series reaching 2026-09-11, zero overlap with the vendor — and the diagnosis
was wrong. `liquidity-pools` declares `max_lines_count=500` and never had more than 86
lines live, so the line cap was never reached and RC-B's eviction changed nothing for
it. Re-measuring after RC-B shipped is what exposed that: the numbers did not move.
**The real cause is RC-D below.** ⭐ The lesson is this document's own headline pointed
back at itself — a plausible mechanism that fit the symptom was allowed to stand in for
the measured one, and it read as settled because a fix had shipped next to it.

Fair Value Gaps, however, IS this branch, from the other side: the vendor kept 50, we
emitted 212 uncapped, and that divergence is now closed.

⚰️⚰️ **And the correct implementation already exists in this repo, with tests, and
nothing imports it.** `app/src/components/chart/engine/objectPool.js` — its own header
reads *"R0.2 — PINE'S DRAWING-OBJECT QUOTA AND ITS SILENT FIFO EVICTION … when one
overflows, the OLDEST object …"* It has `POOL_LIMITS` (fallback 50, ceiling 500),
`resolveCapacity(kind, requested, pineVersion)` for the declared override, and
`createPoolSet(maxCounts, { onEvict })`. Everything RC-B needs.

It sits on the reachability allowlist:

> `objectPool.js`: "R0.2 RENDERER PRIMITIVE — Pine's drawing-object quota and its FIFO
> eviction. Same wave, same expiry." — **expiry: Wave 2 close, 2026-09-14.**

**That date has passed.** This is `lesson_built_tested_green_and_unreachable` with a
deadline attached, and the deadline lapsed unnoticed because nothing fails when an
allowlist entry expires.

**Fix (shipped):**
1. **Capacity has one owner.** `beginObjects` takes each pooled family's cap from
   `objectPool.resolveCapacity(family, declared, pineVersion)` — fallback 50, ceiling
   500. ⛔ Its STORAGE is deliberately not adopted: `objectRuntime.live` is an
   insertion-ordered Map that registers, collections, table cells and the output
   ordering all read, and a second copy of "what is live" would drift on the first
   `delete`. Capacity: `objectPool`. Liveness: `runtime.live`.
2. **The `fail` became a FIFO eviction**, through the SAME `reap` the `delete` path
   uses — an object can now stop existing two ways, and both must leave every register
   and collection that named it. One teardown, two callers.
3. **Only the families Pine actually pools evict.** `POOL_LIMITS` is the roster with a
   `max_*_count` and a documented FIFO. `table` and `linefill` have no vendor rule, so
   they keep the house envelope's hard refusal — inventing an eviction rule for them
   would be this document's own headline defect committed while fixing it.
4. **The `max_*_count` scan reads comment-stripped source.** A declaration inside a
   comment used to raise the budget (`CLAUDE.md`: *"every literal-hunting check strips
   comments first"* — six instances in one session).
5. **The allowlist entry is gone, not renewed.** `objectPool.js` is wired, so
   `reachable.test.js` correctly refused to let a parking note excuse it.

**Mutation-proved four ways**, each reverting exactly one layer: evict the NEWEST
instead of the oldest (killed) · drop `resolveCapacity` back to a flat 500 (killed) ·
scan the raw source again (killed) · eviction skips the shared teardown (killed).

⚠️ **The fourth one survived at first, and the rail was the thing at fault.** The
teardown case asserted `new Set(ids).size === live.length` — trivially true of any run,
never reading a register or a collection. It now drives a collection to its cap, where
an un-spliced array refuses the run at bar 500 on a script whose live set never exceeds
50. ⛔ And only the COLLECTION half is asserted: ids are monotonic and never reused, so
a register holding an evicted id and a cleared register produce the identical
write-to-deleted. That half is recorded as unobservable rather than dressed in an
assertion that would pass either way.

**Still open:** make an expired allowlist entry FAIL on its date rather than sit
quietly — four more primitives (`zorder.js`, `colorInt.js`, `textLayout.js`,
`versionRender.js`) sit on the same lapsed expiry. That is S4 below.

---

## RC-C — the clock models the future as a time step, not a session schedule

**Status: FIXED.**

`objectRenderState.js::makeBarClock` took the **median of the last 40 bar gaps** and
extended the axis by that constant. On a daily chart the median is 86,400 — one calendar
day — so `bar_index + 3` walked onto Saturday.

Pine's `bar_index + N` means **N future bars**, and the chart's future bars are trading
sessions. Measured: Fair Value Gaps put two right edges on a Saturday and a Sunday;
Inside Bar stopped two sessions short.

⚠️ **The honest difficulty:** a future bar's timestamp is not knowable without the
exchange calendar. TradingView has the session spec; we do not. So the fix is not "add
86400 × weekday-skip" — that is another resemblance.

**Fix (shipped):** the clock derives **which weekdays carry sessions** from the last 60
bars and walks the forward axis a day at a time, counting only those. One derived fact
answers all three cases, which is how you can tell it is not a weekend rule in disguise:

| the series says | the clock does |
|---|---|
| five weekdays (equities daily) | skips Saturday and Sunday |
| one weekday (a weekly series) | steps seven days, with **no special case for it** |
| all seven (crypto) | nothing to skip — keeps the measured step |

An intraday series is untouched: session-skipping is whole-day arithmetic, and applying
it to an hourly series would put every projection a day out.

**Mutation-proved two ways:** revert the cadence to a constant step (killed) · hard-code
Mon–Fri instead of deriving it (killed — it breaks the weekly and 24/7 cases, which is
exactly the claim "derived, never assumed" is making).

⭐ **Result on the vendor rail: DIVERGENCE 2 IS CLOSED, and not partially.** Every box
right edge in the comparison window now equals TradingView's — not "fewer weekends",
none, and no mismatches of any other kind either. Fair Value Gaps now agrees with the
vendor on every dimension measured: same bars, same prices, same live box count, same
forward edges.

⚠️ **HOLIDAYS REMAIN UNKNOWABLE, AND THIS DOES NOT PRETEND OTHERWISE.** A future
Thanksgiving is a weekday with no session, and no property of the loaded bars can reveal
that — only an exchange calendar can, and we have none. A projection spanning a market
holiday is still one session long. That is a **bounded, named residual**, where what it
replaces was a systematic error on every weekend.

⚰️ The fix originally specified here was *"say the coordinate is unknown rather than
invent one … drawn to the pane edge and recorded as extrapolated"*. That was not built,
deliberately: nothing downstream consumes such a flag today, and adding an unread one
would be `lesson_built_tested_green_and_unreachable` — the very defect RC-B above
existed to undo. The residual is recorded in the code and here instead.

---

## RC-D — a house envelope on an object Pine does not limit

**Status: FIXED.** Found by re-measuring after RC-B, when Liquidity Pools did not move.

`liquidity-pools` **refused at bar 250** — `more than 500 live linefill objects` — and
then *stopped stepping*, so every object it had drawn was older than 2025-04-15 on a
series reaching 2026-09-11. That is the "year-stale chart" the vendor comparison found,
and it was never the line cap.

⛔ **Pine publishes no `max_linefills_count`, because a linefill has a LIFETIME rather
than a budget:** it is bound to two lines, and deleting either destroys it. So the fill
count can never outrun the line count and no ceiling is needed. Ours was an independent
object with a house ceiling of 500, and a script that legitimately draws many fills hit
it and had its drawing abandoned — which is the one behaviour we can be certain Pine
does not have, since TradingView renders the same script across the whole window.

**Fix (shipped), two parts:**
1. **A linefill dies with its lines.** Reaping a line now reaps every fill that named
   it, through an index so the cost stays flat rather than a walk over everything live.
2. **At the ceiling, linefill EVICTS THE OLDEST instead of refusing.** The envelope
   stays — a runaway is still bounded — but its behaviour becomes the FIFO Pine uses for
   every family it does limit. ⛔ `table` deliberately keeps the hard refusal: its
   ceiling is 8, a number no honest script approaches, so reaching it means something is
   wrong rather than something is busy.

**Mutation-proved two ways:** linefill refuses again (killed) · a reaped line leaves its
fills alive (killed).

⭐ **Measured result: zero overlap → agreement.** Over the vendor's own 300-bar window
we now hold **86 lines and 43 labels against their 90 and 45**, in the same
2025-07..2026-09 window, with the run completing. The shortfall is our bar fixture
ending nine sessions earlier than their capture — two more pools, which is exactly 4
lines and 2 labels.

---

## RC-E — RC-A was applied to one lane of two

**Status: LOCATED, NOT FIXED.** This is why Trendlines is still wrong.

RC-A resolves a bare `pivothigh` in a `//@version=4` script to Pine's shifted column,
and it works: `translatePine` on this script's own construct returns
`pivothigh(high, 100, 15)[15]`.

⛔ **The object lane never sees that resolution.** `buildObjectLane` calls
`translatePine` with `objectRawTrees: true`, which deliberately keeps the **raw parse
node** so the runtime lane can lower constructs the columnar value model has no answer
for (`array.get` — without it, a dashboard whose rows come from arrays arrives empty).
RC-A's transform lives in the columnar resolution those trees bypass. So the lane that
draws objects still resolves bare `pivothigh` to the house column, which emits **on the
pivot bar** rather than at the confirmation bar `right` bars later.

⛔⛔ **That is look-ahead — the same class RC-A exists to remove — surviving in the lane
that draws.** Measured signature, on all five lines: **our RIGHT anchor is exactly
TradingView's LEFT anchor.** Pinned in `twoVendorParity.test.js` with that precision, so
a vaguer "the dates differ" cannot pass for it and the day the runtime lane gets the
transform, the case fails and says so.

⭐ **The general lesson, which is this document's headline one level up:** RC-A was
verified against the lane it was written in and declared done. *A fix is only as wide as
the lane you measured it in* — and the vendor is what found the other one.

---

## The foreseeable problems — where this shape will bite next

Each is the same substitution, at a seam we have not yet compared:

1. **Z-order.** `zorder.js` maps Pine's nine buckets onto lightweight-charts' four — and
   is on the same expired allowlist. Overlap order is untested against the vendor.
2. **Colour resolution.** `colorInt.js` (`0xTTBBGGRR`) — also unwired, also expired. A
   transparency byte in the wrong lane is invisible in a count and obvious on a chart.
3. **Text layout.** `textLayout.js` — same. Label size and wrap change what a member
   reads.
4. **`request.security` semantics.** Not a feed problem only: `lookahead`, `gaps` and
   the repainting rules are behaviour we would have to match even with data.
5. **Every remaining bare-name collision.** RC-A's fix covers the four *transformed*
   names. Any future entry in the house table that shares a Pine name with different
   semantics reopens it — which is why the rail derives its roster.
6. **`na` propagation at the edges.** Our `na` discipline is strong inside the table and
   untested against the vendor at object boundaries.

---

## What "100% parity" actually requires

It is not a number that can be declared. It is a **measurement that has to keep
running**, and this programme has just built the first instrument capable of taking it.

**S1 — close RC-B and RC-C.** ✅ **RC-B is closed** (above). ⛔ **RC-C is not**, and
neither is the vendor RE-MEASUREMENT that RC-B earns: the fix makes the engine keep the
NEWEST 50 boxes, and the FVG parity rail now agrees with TradingView's live box count
exactly — but `liquidity-pools` has **not been re-captured against the vendor since the
fix**, so "it now overlaps their window" is a prediction from the mechanism, not a
measurement. ⭐ This programme's own standing rule applies to its own fix: a render of
our own output shows we drew something, never that we drew the same thing.

**S2 — make the vendor comparison continuous, not heroic.** Today one capture took a
live browser session and a four-slice hand reassembly. That does not scale to 266
scripts. What makes 100% reachable is a harness that captures a script's objects and
diffs them without a human in the loop, with the receipt discipline already proven
(FNV-1a in the page, verified after transport).

**S3 — a semantic ledger for every Pine-facing name.** RC-A happened because a name
could be served by resemblance. Every Pine name this engine answers should declare the
vendor evidence for its semantics, and a name with no evidence should be *refused*
rather than approximated. The programme already has the idiom — `closedTable.json`'s
`_functions_vendor_parity_resolutions` — and it covers a fraction of the surface.

**S4 — expire the allowlists loudly.** ✅ **SHIPPED.** Two of the three root causes here
are primitives that were built correctly and parked. The parking note is not the
problem; the silent expiry is.

Every parked block in `reachable.test.js` now declares an **ISO expiry as data**, and a
rail reads the register's own source for its block markers — so a block added without a
date fails rather than parking itself forever, an expiry naming no block fails too, and
**a lapsed date fails by name**, listing every path still parked under it. Neither list
can drift from the other, which is the only reason it is safe for them to be two lists.

⛔ The block that lapsed is renewed **short** (`2026-10-06`), not quietly extended:
`objectPool.js` is out of it, but `zorder.js`, `colorInt.js` and `textLayout.js` remain
— and those three are items 1–3 of the foreseeable problems above, the same shape as the
defect this cost. The dates are proposals the owner can move in one line; the
enforcement is not.

**Mutation-proved three ways:** restore the expiry that actually lapsed (killed) · a
parked block declaring no expiry (killed) · the register never actually read (killed —
without that control, "no block has lapsed" is trivially true of a parse that returned
nothing).

⚠️ This makes the suite depend on the clock, deliberately: an expiry that cannot fire on
its own date is precisely what was being fixed.

⛔ **And the standing rule this work earned:** a render of our own output is not
evidence of parity. It shows we drew *something*. Only the vendor's own numbers show we
drew the same thing — and twice in two days the instrument itself nearly published a
false finding (368 labels that were 14; nine "engine errors" that were our bar fixture's
two decimals). **The measurement needs a control as much as the engine does.**

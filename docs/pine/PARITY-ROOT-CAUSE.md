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
stored capture is a real comparison and not a re-render of our own work. Rails: `fvgVendorParity.test.js`, `twoVendorParity.test.js`.

⭐⭐ **Every indicator that CAN be compared now agrees with TradingView.** The one
remaining row is `request.security`, which is a missing data feed rather than a
translation defect.

| indicator | after RC-A → RC-F |
|---|---|
| Market Structure | ⭐⭐ was already exact |
| Fair Value Gaps | ⭐⭐ **both divergences closed** — same bars, same prices, same live box count, same forward edges |
| Inside Bar Range | ⭐ was already exact on both rails |
| Liquidity Pools | ⭐⭐ **zero overlap → 86 lines / 43 labels against the vendor's 90 / 45, same window.** The 4-and-2 shortfall is our bar fixture ending 2026-09-13 against their 2026-09-22 — nine sessions, two more pools, exactly 4 lines and 2 labels |
| Trendlines | ⭐⭐ **EXACT** — all 5 lines, same dates, both prices to the capture's own precision (RC-E) |
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

**Status: FIXED.** ⭐⭐ **And the fix was ONE ARGUMENT.**

`pineRuntimeFrontend.js` built both of its resolvers as

```js
new Resolver(env, TABLE, new Map(), {})     // ← an EMPTY options object
```

so `pineVersion` was `null` in the lane that draws, and **every
version-conditional rule in `pine.js` silently answered "this is not Pine"**.
Not a wrong answer to a hard question — no question asked at all.

⛔ **The cost was a look-ahead defect on a live chart.** Bare `pivothigh` in a
`//@version=4` script kept resolving to the house column, which emits ON the
pivot bar instead of at the confirmation bar `right` bars later, so every
trendline sat one pivot span early against TradingView — with RC-A's own rail
green, one lane over.

⭐ **The version is read from the lex, not re-detected.** `lexed.version` is the
pragma the source actually carries; a second scan would be a second authority
over one value.

**Measured result — Trendlines is EXACT:** all five of TradingView's lines, same
left date, same right date, both prices agreeing to the capture's own four
decimal places. We draw one additional line, older than the vendor's first
captured bar, because this comparison runs 600 bars so every pivot can form.

⚰️ **The lesson is the one this document keeps re-learning, now in its sharpest
form:** RC-A was verified through `translatePine`, which is a real verification
of a real lane, and it was not a verification of the product. *A fix is only as
wide as the lane you measured it in* — and the same omission then swallowed the
`time` reconciliation below on its first run, with the corpus census moving by
exactly zero.

---

## RC-F — a unit that differs is not a name that is missing

**Status: FIXED.**

Pine's `time` is **milliseconds** since 1970; `closedTable.json::clock.time` is
**seconds**. The engine held the column, under the same spelling, and refused to
bind it — with a refusal that named the difference precisely:

> "a thousand-fold difference that would compare true against no literal a
> member wrote, on every bar, without ever looking wrong"

⭐⭐ **That refusal was right and is not softened.** Binding on SPELLING alone
would have been a silent mistranslation, which is worse than refusing. What
changed is that the difference is **exactly reconcilable**: our seconds are
whole seconds, so `time * 1000` is Pine's value with nothing lost and nothing
assumed. An exact conversion is a translation; an approximate one would be this
map's first bug, so nothing approximate belongs in it.

⛔ **Gated on the source speaking Pine at all.** `time` is a name in BOTH
vocabularies — in the formula box it is OUR column, in seconds — so the
discriminator is the `//@version` pragma, exactly as for bare `pivothigh`. A
versionless source keeps the refusal untouched. ⚠️ Binding it there as seconds
would probably be right and is **deliberately not done**: that is a change to
the formula box, with the screener downstream of it, and the measurement that
motivated this (5 corpus scripts, all Pine) says nothing about the box.

⛔ **The gate is ONE function, because it was written twice first and the
mutation run caught it.** Deleting the version check from one of the two
resolution doors left every test green — the versionless case only ever reaches
the other door, so half the gate was unproved
(`lesson_a_guard_repeated_is_a_guard_unproved`).

**Corpus movement: `runtime/pine:builtin` 16 → 12.** Four scripts past that
blocker, all to their next one. The drawing count did not change, which is the
pattern this programme has measured repeatedly and should expect.

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

## RC-G — the engine was telling members their script never defined a name it plainly defines

A member pastes `artemis-oscillator-pro` and is told:

> this Pine name was never given a value in the pasted script — `len`

`len` is a declared parameter. The sentence is not a hedge or an approximation; it is
false, and it sends the member to look for a typo that is not there.

**The mechanism.** A window length and a history offset are sized BEFORE BAR 0 — the ring
is allocated before any data arrives — so the number has to fold to a compile-time
constant. `foldConstNode` asks `makeFrozenResolver()` for it, and that resolver sees only
the **top-level environment**. A function PARAMETER, a REASSIGNED name and a LOOP COUNTER
are all bound somewhere else, so all three come back `pine:undefined`, whose sentence says
the name was never given a value.

`foldConstNode` then re-threw that refusal verbatim, deliberately and with its reason
written beside it: *"re-dressing a `pine:undefined` as a dynamic offset would send an
engineer to build ring machinery for a typo."* **That rule is right for a typo and wrong
for everything else on the row**, and the row is mostly everything else.

⭐ **The discriminator is the SCOPE, which knows what the resolver does not.** A name this
lane holds a slot for IS bound; what it lacks is a value known when the formula is built.
A name no slot holds is still a typo and still gets the sentence that says so.

**Measured over the committed corpus**, same instrument before and after, sources restored
by captured bytes with the sha re-verified:

| row | at HEAD | with the fix |
|---|---|---|
| `pine:undefined` | 22 | **11** |
| `runtime:history-dynamic-offset` | 0 | **11** |

⛔ **ZERO scripts start building.** Eleven of twenty-two stop being told something false and
start being told the truth; the other eleven are names this lane genuinely does not hold.
This changes which sentence a member reads and nothing else — serving these needs
monomorphisation (a parameter's value is known per CALL SITE) and a dynamic ring read (a
loop counter's, per ITERATION), which are capabilities, not sentences.

⭐⭐ **THE CONTROL THAT LOOKED RIGHT COULD NOT FAIL.** The obvious guard for a change like
this is *"a real typo still gets the real sentence"*, written the obvious way:

```pine
plot(ta.sma(close, zzNope))
```

It is green whatever this code does. A **top-level** length never reaches this fold at
all — measured by deleting the scope test entirely and watching that case answer
`pine:undefined` exactly as before. It could not distinguish the fix from its absence
(`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`). The case that discriminates
puts the typo **inside a function body**, where it takes the same road as the parameter:

```
                                  scope test present   scope test removed
  typo in a function body         pine:undefined   →   runtime:history-dynamic-offset
```

That second column is precisely the defect the re-throw rule exists to prevent, arriving
through the branch written to narrow that rule. Only a mutation found it.

⛔ **And the fix is only as wide as the lane it was measured in — inside one function.**
`foldConstNode` is reached from five call sites: one for the FINITE-WINDOW family (`sma`,
`wma`, `stdev`, `highest`, …) and others for the CARRIED family (`ema`, `rma`, `rising`,
…), each with its own noun. Threading the first alone would leave every
`ta.ema(src, len)` still reading the false sentence with every assertion green. Both
families are now covered, and mutating either set of call sites goes red.

⚠️ **One thing changed in `pine.js`:** `undefinedName` now hangs the name on the refusal as
`pineName`. The alternatives were to read it back out of `at.token` (the raw token text) or
to parse it out of the message — both true today and both coupled to spelling. A consumer
that has to ask *"which name?"* should be handed the answer, not left to recover it.

---

## RC-H — a spelling Pine still compiles, refused as if the request were unservable

`security(syminfo.tickerid, res, high[1], lookahead=true)` is how Pine v1–v3 wrote a
look-ahead request, and v4 still compiles it: the migration to `barmerge.lookahead_on`
renamed the constant, it did not retire the boolean. **16 uses across 5 corpus scripts**
write it that way.

The door read the argument only when the node was a NAME:

```js
const spelled = v && v.type === 'name' ? v.name : null
if (spelled === 'barmerge.lookahead_on') live = true
else if (spelled !== 'barmerge.lookahead_off') return null
```

A boolean literal has no `.name`, so `spelled` was null, the second test was true, and
the whole call fell to `pine:request` — *"this request could not be resolved to one
symbol and one servable timeframe"*.

⛔ **That sentence is false about its own neighbour.** The identical request with
`lookahead=barmerge.lookahead_on` resolves, and so does the identical request with no
`lookahead` at all. The symbol was fine and the timeframe was fine; the spelling of a
fifth argument was not, and the refusal named neither. Same shape as RC-G: *the engine
giving the wrong one of its own sentences*.

**Measured: object-lane BUILDS 6 → 7.** `fibonacci-pivot-points-cc` now translates. That
is the first move in the product metric since `runtime:colour`, and it is the unit this
programme actually progresses in.

⭐⭐ **HOW IT WAS FOUND, AND WHY THE STANDARD INSTRUMENT SAID ZERO.**
`guardUpperBound` returned **0** for every guard tried — `pine:undefined`,
`runtime:colour`, `pine:function`, `pine:request`, `runtime:request`. For `pine:request`
that zero is an ARTIFACT, and the file's own header says why: it sizes a guard by
DELETING every line the guard refuses, and *"deleting a binding breaks its consumers, so
the peel is stricter than an implementation."* `High = security(…)` is a binding —
deleting it removes the name, and `pp`, `range`, `r1` all then fail. The second walls it
printed were literally `5 runtime/pine:undefined, 4 objects/pine:undefined`: the cascade,
not the corpus.

Sizing it honestly means **preserving the binding** and substituting what a correct
implementation would return. That probe said **+2**.

⚰️ **AND ONE OF THOSE TWO WAS MY OWN INSTRUMENT MANUFACTURING A FINDING** — the third
time this session. `sub__1xYROVYMlX` requests **eleven different foreign symbols**
(`INDEX:SLTW`, `INDEX:SYTW`, …); substituting the expression gives all eleven sector
series the chart's own `close`. Shape preserved, meaning destroyed — eleven wrong numbers
wearing right names, which is the one thing this engine refuses to ship. The honest
number was **+1**, and the only thing that caught it was reading the two candidate
scripts rather than trusting the count.

⛔ **THE ASYMMETRY THE CORPUS COULD NOT HAVE FOUND.** Pine takes `lookahead` as the fifth
POSITIONAL argument, and the corpus writes it that way often —
`security(sym, tf, expr, barmerge.gaps_on, barmerge.lookahead_on)` — caught by a
heuristic on the name node (`spelled.includes('lookahead')`) that a boolean literal
cannot satisfy. Teaching only the named form would have left `…, barmerge.gaps_on, true)`
reading as lookahead_**off**: not a refusal a member can see, but a different number
under the same name. **Zero corpus scripts write it**, so a census-driven stop would have
shipped it. It is valid Pine, and the objective is every published script, not 266 of
them.

⚠️ **THE DIRECTION IS A LANGUAGE EQUIVALENCE, NOT A VENDOR MEASUREMENT**, and two things
keep that honest. The tests assert it by DERIVATION — not *"`true` produces `tf_live`"*
but *"`true` produces whatever `barmerge.lookahead_on` produces"* — so they follow the
engine instead of going stale. And **the measured gain does not depend on it at all**:
for a request at the chart's own timeframe the engine already forces `live = false`
(*"there is no period to be part-way through"*), which is the case
`fibonacci-pivot-points-cc` is in. The +1 stands even if the mapping were backwards.

⛔ **THE TOKEN, NOT THE VALUE.** `parsePrimary` folds the keyword to `{type:'number',
value:1}`, so at the node level `true` and `1` are the same object. Matching `value === 1`
would have accepted `lookahead=1`, inventing a truthiness coercion Pine does not have.
The check asks the token the same question the parser asked (`tok.value === 'true'`).
That precision exists because a control demanded it — the mutation that swaps the token
test for a value test fails only the numeric case.

---

## RC-I — a walk that could not see the offset sent the whole expression to the wrong lane

Pine permits a SERIES index in `[]`, and the corpus leans on it:

```pine
for i = 0 to 3
    total := total + close[i]

FH = FIBS == 1 ? highestbars(high, FPeriod) : 1
BB = … bar_index[-FH] …                      // fib-retracement, line 74
```

Every one of them came back **"this Pine name was never given a value in the pasted
script — `i`"** — about a loop counter the `for` declares two lines up.

⛔⛔ **THE ROUTING DEFECT.** `needsRuntime` decides which lane an expression belongs to
by walking `['left','right','test','yes','no','arg','value']` and `args`. An offset node
is `{type:'offset', arg, n, tok}`, so the walk reaches **what is being offset** and never
reaches **the offset**. `close[i]` therefore looked PURE, went to the columnar lane, and
that lane — which resolves against the frozen top-level environment — correctly reported
that it had never heard of `i`.

⭐⭐ **THIS IS THE THIRD TIME THAT FUNCTION HAS HAD THIS BLIND SPOT**, and its own
comments record the other two: a method form's receiver glued into the call NAME
(`a.get(0)` → the columnar lane answered *"the engine grammar does not hold `a.get`"*),
and a field path's head glued into a dotted name (`ob.top` → *"names something the engine
grammar does not hold — `p.tpo`"*, sending a member to look for a built-in namespace
called `p`). **A walk that cannot see part of a node routes the whole expression to the
wrong lane, and that lane then refuses with a sentence about something else entirely.**

### The capability, and the line it does not cross

The opcode table has carried the answer's shape as a RESERVED entry since 2F-2, with the
constraint that gates it:

```js
READ_HIST_SLOT_DYN: 55,
// It cannot be admitted until the ring depth it may reach is statically bounded,
// because an offset past the ring would answer `na` where Pine answers a number:
// a silent wrong value, which is the one outcome this runtime refuses to trade
// for coverage.
```

⭐⭐ **THAT CONSTRAINT IS ABOUT A RING, AND TWO OF THE THREE HISTORY READS HAVE NO RING.**
`READ_HIST` indexes a precomputed COLUMN and `READ_SERIES_HIST` a price SERIES — both
materialised in full before the bar loop starts, so `columns[a][bar - n]` answers for ANY
`n` with `bar - n >= 0` and there is nothing to overflow. Only `READ_HIST_SLOT` reads a
ring of bounded depth.

So `READ_HIST_DYN` (56) and `READ_SERIES_HIST_DYN` (57) ship and **55 stays reserved** —
the reserved opcode's own reasoning applied, not overridden. `ir.js` refuses a
`HIST_DYN` whose target is a `READ`, and that refusal has its own rail rather than being
a guard nobody has watched fire.

⛔ **EVERY UNANSWERABLE OFFSET IS `na`, AND THERE ARE THREE OF THEM** — a NaN offset (the
value was itself `na`), a negative one (Pine reads backwards; forwards is a bar that has
not happened), and one reaching before bar 0. None may clamp: answering with the earliest
bar is how a warm-up silently becomes a real number, which is what `READ_HIST` already
refuses to do with a constant offset. ⚠️ `n | 0` is deliberately not used — it turns 2.7
into 2 and **NaN into 0**, and the second would read bar 0 and call it an answer.

### Measured

| | at HEAD | with the fix |
|---|---|---|
| object-lane BUILDS | 7 | **7** |
| `runtime/pine:undefined` | 7 | **1** |

⛔ **ZERO NEW BUILDS, AND THAT IS THE HONEST NUMBER.** Six scripts stop being told
something false and move to their REAL next wall — `runtime:array`,
`runtime:object-op`, `runtime:function-global-state`, `pine:window-dependent`,
`pine:offset-literal`, and one to `runtime:history-dynamic-offset` (the ring case,
correctly refused and now saying so). The near-queue already predicted this:
`fib-retracement` carries TWO distinct walls, so serving one moves it to the other.

⭐ **AND IT CLOSED RC-G'S OWN GAP.** RC-G threaded the scope into the three WINDOW-LENGTH
fold sites and not into the OFFSET one, so a loop counter — the commonest dynamic offset
there is — still read *"never given a value"*. The same lesson RC-G was written about,
one site further on: **a fix is only as wide as the lane you measured it in.**

---

## RC-J — Pine has one `if`; this engine served it in two positions of three

```pine
x = if c          ✅ the block-valued BINDING
if c              ✅ the statement form
f(c) =>           ⛔ the function BODY — `runtime:statement`
    if c
        1
    else
        2
```

⛔⛔ **THE SPLIT, NOT THE `if`.** A function body lowers as
`lowerStmts(lines.slice(0, -1))` plus a result taken from the last line, because Pine
returns the value of the last statement (§16). But an `if`/`else if`/`else` chain
occupies **several entries** of that list — so the split handed the `if` to the
statement lowerer and left a bare `else` as "the result expression", which parses as
nothing. The refusal named the statement shape; the cause was the split. The fix finds
where the trailing chain BEGINS.

⭐ **EXTRACTED, NOT COPIED.** The chain collection and the arm rule now live in two
shared helpers (`lowerIfChainInto`, `armAssignerFor`) that the binding, `switch` and the
function body all call. The mutation proof is what makes that real: breaking either
helper reds the new file **and** `blockValuedBinding.test.js` together.

### Measured, and my own estimate was 3× optimistic

| | |
|---|---|
| corpus scripts containing the construct | **57** across **147 sites** (21%) |
| blocked by it — my estimate | 9 |
| blocked by it — **actual** | **3** |
| BUILDS | 7 → **7** |

I read `runtime:statement` (5 scripts) as this shape without checking. It was not. The
three that moved: `high-low-open-mid-ranges`, `ict-ipda-look-back` (to
`runtime:block-value` — the stated multi-statement-arm limit, firing correctly), and
`rsi-swing-indicator`, the one script whose first wall was `pine:undefined` naming
**`else`**.

### ⚰️ THE GATE CAUGHT A CHANGE I HAD NOT PREDICTED, and three hypotheses were wrong

Three member-fixture tests failed on `diagnostics.statements` 77 → 75. In order, I was
wrong that they were stale blocker pins (all three were the same counter), wrong that my
refactor caused it (**measured innocent** — 77, identical to HEAD), and wrong that
`uncharted-volume-v2` had no if-bodied function (my scan checked only the FIRST body
line; `f_getVolumeUnit` at v2:161 **ends** in one — the scan was wrong, not the data).

**Cause:** that chain now lowers through the value path, one `lowerExpr` per arm, and
the counter only ticks inside `lowerStmts`.

⛔ **THE NUMBER WAS CHANGED ONLY AFTER THE CODE WAS CHECKED**, because
`pineRuntimeTextLane.test.js` carries a standing rule about this exact figure: *"The
number was right and the code was wrong. A ledger that gets edited to match the code it
is supposed to measure is not a ledger."* Evidence that 75 is right: identical refusal
guard and line, a **byte-identical** skipped-function set, and both member scripts moving
by exactly 2 (v2 77→75, v1 76→74) so the differential holds.

⭐⭐ **AND THE PROPERTY THE COUNT WAS A PROXY FOR IS NOW RAILED DIRECTLY.** The
2026-09-20 incident moved that number UP because an `if`'s BODY was lowered before its
TEST — the lane stopped CHECKING and looked like it had gone further. A count cannot say
which way round they ran; `functionBodyBlockValue.test.js` → "SOURCE ORDER" now puts a
tuple in BOTH positions and requires the TEST's line to win, with single-position
controls proving each side really can own the refusal.

### ⚠️ FOUND, NOT CAUSED — a false sentence on a tuple arm

`f_getVolumeUnit` returns **tuples** (`['B', 1e9]`) from its arms, and `armAssignerFor`
assigns to ONE slot, so it still refuses — with `pine:collection`, *"an array, a matrix
or a map is outside the expression grammar this engine runs"*. **`['B', 1e9]` is a Pine
TUPLE, not an array**, so that sentence sends a member looking for array support that is
not the problem. The byte-identical skipped set proves this **predates** the change; it
was surfaced, not introduced. It is the same "wrong one of its own sentences" class as
RC-G, RC-H and RC-I, and it is what stands between the firm's own indicator and this
lane — so it is the next item, with tuple-valued arms (N slots, arity agreement across
arms) the capability behind it.

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

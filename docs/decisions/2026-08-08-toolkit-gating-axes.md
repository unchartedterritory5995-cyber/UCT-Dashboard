# Decision: what a toolkit gates — the axes and their numbers

**Status:** 🟡 **OPEN — design §8.4. The MECHANISM ships; the NUMBERS are the owner's.**

**Date opened:** 2026-08-08 · **Phase:** E · **Applied:** —

## 1. The rule that is not open

Spec §1.4: *"Sell toolkits, not indicators. Gate breadth (symbols, history), never
mechanics."* **Nobody is ever sold a worse RSI.** That is machine-checked:
`test_the_SAME_definition_on_the_SAME_symbol_is_BIT_IDENTICAL_under_every_toolkit`,
`repr()` for `repr()`, with a positive control that proves the same assertion goes
RED when the entitlement layer is made to perturb the compute.

## 2. The four axes E-7 builds enforcement points for

| axis | enforcement point | constant | wired today? | blocked by |
|---|---|---|---|---|
| symbols | the sweep's universe slice (`scan_evaluator._apply_limits`, pinned to `entitlements.apply_symbol_cap` by an agreement test) | `max_symbols` | ✅ live — `evaluate_one(..., limits=)` | §8.4 (the number) |
| history depth | `entitlements.apply_history_cap` — **a refusal boundary, never a trim** (§4) — plus `scan_evaluator._history_withheld`, the sweep's door, pinned to it by an agreement test | `max_history_bars` | ✅ live (2026-08-09) — `evaluate_one(..., limits=)` withholds the whole definition | §8.4 (the number) |
| definition count | `user_definitions.save` → `entitlements.check_definition_count`, reached from `POST`/`PUT /api/user-definitions` via `Depends(limits_dependency)` | `max_definitions` | ✅ live | §8.4 (the number) |
| refresh cadence | `entitlements.refresh_floor_seconds(cadence, limits)` — the MAX of the data floor and the plan floor | `min_refresh_seconds` | ⛔ not wired — no per-toolkit scheduler surface exists | 🔴 **§8.5 — cadence is unanswered; nightly-vs-intraday drives this AND the freshness contract** |

## 3. What ships today

ONE toolkit, `"all"`, whose caps are the capacity bounds already in the tree
(`MAX_DEFINITIONS_PER_USER`), and `None` on the other three — meaning ungated.
**Nothing changes for anybody until a number is set here.**

⛔ Turning a capacity bound into an entitlement bound is a CATEGORY CHANGE:
capacity may be tuned by ops, entitlement is a billing contract. The test that a
DOWNGRADE actually shrinks the answer is what makes it one. Two of them ship:
`evaluated` strictly shrinks under a smaller `max_symbols`, and the second
definition is REFUSED under `max_definitions=1`.

⛔ `max_definitions` **references** `user_definitions.MAX_DEFINITIONS_PER_USER`
rather than restating `50`, and the reference is asserted by AST. The two are the
same number today on purpose; the day the owner sets an entitlement number they
separate, and the reference is what makes that a deliberate edit.

## 4. 🔴 The history axis — E-7's adjudication

**E-3 accepted `max_history_bars` and deliberately did not apply it**, reporting
that trimming EMA seeding is mechanics rather than breadth, and that the draft's
own two E-7 tests contradicted each other on the point. The controller noted that
"history depth" is nonetheless a named breadth axis and handed E-7 the call.

**Ruling: the axis is KEPT, and it is enforced as a REFUSAL, never as a TRIM.**

Breadth is *how much of the market — and how much of the past — your plan lets you
ASK about.* Mechanics is *what number comes back for the question you were allowed
to ask.* Trimming the bars an EMA seeds from does not narrow the question; it
answers the same question with a worse number, and the member cannot tell. That is
"sold a worse RSI" precisely, and the axis being called "history depth" does not
rescue it from §1.4.

**Measured**, `ema(close, 20)` over 400 synthetic daily bars:

```
all 400 bars  ->  15.269399733598789
last 120 bars ->  15.269384587868412
relative difference = 9.919e-07
```

Two different indicators — and `9.919e-07` is **inside** `pytest.approx`'s default
`rel=1e-6`, so `assert trimmed == pytest.approx(full)` **passes**. That is a
measured false negative, not a close call, and it is why the gate is `repr()` for
`repr()`. `tests/test_entitlements.py` asserts the approx comparison SUCCEEDS, so
the justification is in the suite rather than in a comment.

⛔ And `max_lookback` cannot rescue a trim either: it reports **20** for that tree
— the declared window — while `_ema_col` seeds from bar zero. A recursive
indicator's honest history requirement is *all of it*, so there is no per-tree
number a trim could be validated against.

So `apply_history_cap` has exactly two outcomes: the bars UNCHANGED, or
`ToolkitWithheld('toolkit:history')` — *"your plan stops here"*, which is honest,
attributable, and fixed by upgrading. This is E-3's own prescription
(*"a declared outcome … rather than a quietly different value"*) with the axis kept.

### ✅ CLOSED 2026-08-09 — the refusal is wired

`toolkit:history` is in `scan_evaluator.WITHHELD_REASONS` and
`scan_evaluator._history_withheld` is the enforcement point. E-7's pin
(`test_the_WITHHELD_VOCABULARY_is_PINNED_to_the_SWEEPs_not_RESTATED`) went RED by
name on the commit that landed it, as designed, and now pins the two vocabularies
EQUAL rather than as a subset.

⚠️ **ONE DEPARTURE FROM THE INSTRUCTION ABOVE, AND IT IS DELIBERATE: the sweep does
NOT catch `ToolkitWithheld` in the per-symbol loop.** `apply_history_cap` refuses
on `len(bars)`, a fact about ONE SYMBOL; caught per symbol it would answer YES for
a liquid name and NO for a thin one, so a member on a small plan would get results
only for the data-poorest tickers in the universe — a lottery wearing an
entitlement's clothes, and it would put a plan's boundary inside a loop whose
counts are supposed to describe the market. The sweep instead asks once, about
`want` — the history the TREE declares it reads — and withholds the WHOLE
definition under one attributable reason before a bar is touched. That is strictly
the stronger test; the two agree wherever a symbol carries the history the tree
asked for, and `test_the_SWEEPs_history_gate_and_apply_history_cap_AGREE` drives
both over a matrix and asserts the divergence rather than leaving it to drift.

⛔ **A withheld run writes NOTHING into `scan_hits`/`scan_coverage`.** Those tables
have no member column by design — two members who typed one formula share one
result set — so a per-member entitlement outcome written there would publish one
plan's boundary as a fact about the market, for everybody. Silence reads correctly
as `coverage(...) is None`, "nobody looked".

The shipped toolkit's `max_history_bars` is still `None`, so this changes nothing
for anybody until §8.4 sets a number.

## 5. 🟡 The cadence axis — §8.5 is narrower than it looks

E-3 measured the manifest: all **54** declared scalars are unanimous
`cadence: nightly`, `store: screener_rows`, `grain: date`, and wired
`cadence_ceiling(tree)` off `ast_freshness.freshness_for(tree)["cadences"]` —
`None` for a bars-only tree.

⇒ **A scan naming any scalar has a nightly ceiling; a bars-only scan can honestly
be intraday.** So `min_refresh_seconds` is a floor that can only go UP:
`refresh_floor_seconds` takes the MAX of the data floor and the entitlement floor.
An entitlement permitting a faster refresh than the data supports sells a promise
the table cannot keep, and it fails invisibly — every number still looks right, and
the member infers new information arrived when the same 03:00 rows were re-read.

`CADENCE_FLOOR_SECONDS` is railed against the manifest's OWN declarations, not
hand-kept: a fifty-fifth scalar declaring `intraday` fails BY NAME rather than
silently getting no floor.

## 6. What the owner still has to answer

1. **§8.4 — the numbers.** How many symbols, how much history, how many
   definitions, and how fast a refresh, per toolkit. Every enforcement point is
   built and tested; setting a number in `entitlements.TOOLKITS` is the whole edit.
2. **§8.5 — is nightly 03:00 right, or do scans need intraday?** This decides
   `min_refresh_seconds` AND the freshness contract E-1 hedged. Note that it can
   only be answered *per tree*: a scalar-bearing scan cannot be honestly intraday
   whatever the plan says.
3. ~~**The history refusal's wiring** (§4)~~ — ✅ **CLOSED 2026-08-09.** Wired at
   the sweep's door rather than in its per-symbol loop; see §4.

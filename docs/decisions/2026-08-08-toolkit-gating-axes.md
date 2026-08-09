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
| history depth | `entitlements.apply_history_cap` — **a refusal boundary, never a trim** (§4) | `max_history_bars` | ⛔ **not wired** — needs `toolkit:history` in `scan_evaluator.WITHHELD_REASONS`, a vocabulary E-3 owns | §8.4 + one controller-approved edit |
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

**What it still needs, and it is one edit:** the refusal must become a `withheld`
count in the sweep's envelope, which means adding `toolkit:history` to
`scan_evaluator.WITHHELD_REASONS` and catching `ToolkitWithheld` in the per-symbol
loop. `WITHHELD_REASONS` is E-3's vocabulary and `scan_evaluator.py` was
coordination-gated for E-7, so the edit is named here rather than made. Until it
lands the shipped toolkit's `max_history_bars` is `None` and the function is the
identity.

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
3. **The history refusal's wiring** (§4) — a controller decision, because it
   touches E-3's closed `WITHHELD_REASONS`.

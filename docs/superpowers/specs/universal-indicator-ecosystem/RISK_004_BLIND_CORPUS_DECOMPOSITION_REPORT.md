# RISK-004 — Blind Pine Corpus Failure Decomposition

**Status: DIAGNOSTIC COMPLETE. No remediation implemented. Stop for owner/ChatGPT review, per explicit tranche instruction.**

Date: 2026-09-06. Scope: `tests/fixtures/pine_blind/` (48 scripts, blind-authored,
8 lenses), harness `app/src/components/chart/engine/ast/pine.blindCorpus.test.js`.
New permanent evidence: `app/src/components/chart/engine/ast/pine.blindCorpusDecomposition.test.js`
(12 tests, all passing, all minimal first-party reductions — no full corpus
script bodies committed beyond what the existing harness already commits).

Out of scope, per the authorizing instruction, and untouched in this tranche:
pattern-engine/scanner-pattern program (recorded only as OUT-OF-SCOPE ADJACENT
RISK, no code touched), vendor-parity Tranche 2 backlog (preserved exactly, no
new batch started), any broad parser/assisted-edit/Track-F/stateful-execution
remediation.

---

## 1–2. Current raw/assisted count, and reconciliation against the historical 21/48

**The historical "21/48" is stale. The current, reproducible, live-executed
baseline is 27/48 raw, 27/48 assisted, 0 additional recoveries** — confirmed by
running `npx vitest run src/components/chart/engine/ast/pine.blindCorpus.test.js`
against current Phase Two HEAD before any change in this tranche.

```
BLIND EXAM  27/48 translate to a boolean screen   (authored corpus: 38/38)
after offer 27/48 once the member takes the door's own offer
```

The "0 additional recoveries" half of the historical claim is **still true** —
only the denominator moved. `pine.blindCorpus.test.js`'s own comment history
already documented why: Vendor Parity Tranche 2 Lane B (2026-09-05) moved
`ta.rising`, `ta.bbw`, `ta.percentrank`, `ta.median` from `UNSERVED_PROBES` to
`SERVED_CONTROLS` after real TradingView vendor captures resolved their
ambiguities, which is exactly what raised `PASSING.length` from 21 to 27 — the
test file's own comments said so ("21 → 27 is Vendor Parity Tranche 2 Lane B"),
but the `FLOOR` constant that gates the test was never ratcheted to match. That
gate uses `toBeGreaterThanOrEqual`, so it was passing throughout — the test was
never lying about failing, it was just stating an understated floor. **This is
the one bookkeeping fix made in this tranche** (`FLOOR = 21` → `FLOOR = 27`,
with a dated comment explaining the ratchet) — a trivial correction of a
documentation drift, not a behavior change; no engine code touched.

No per-script history from the original 21/48 measurement was preserved
anywhere retrievable in-repo, so a script-by-script "which ones flipped"
account is not reconstructable — only the aggregate mechanism (Lane B's 4 name
promotions) is known. This is recorded honestly rather than fabricated.

---

## 3–5. Full decomposition: guard, taxonomy, and generality per current miss

All 21 current misses, their **PRIMARY** blocker (the first guard `translatePine`
raises), and — where static reduction found one — the **SECONDARY** blocker
that would surface next. Guard names are the engine's own 5-guard vocabulary
seen among these misses (`pine:function`, `pine:builtin`, `pine:role-order`,
`pine:tuple`, `pine:undefined`); the RIGHT column maps each to the requested
20-category taxonomy.

| # | Script | PRIMARY blocker | Taxonomy | SECONDARY (confirmed by static reduction) | Deeper still |
|---|---|---|---|---|---|
| 1 | breakout-flat-base-pivot-breakout | `ta.valuewhen` — occurrence-count vs bar-window arity mismatch | PARAMETER_FIDELITY | **CONFIRMED**: `nz(ta.barssince(...), 0)` is independently unbounded (`UNSUPPORTED_BUILTIN`/WINDOW_ARGUMENT_LIMIT) | unknown — 2 real blockers is as far as reduction was pushed |
| 2 | breakout-gap-up-holding | `syminfo.mintick` idiom | UNSUPPORTED_BUILTIN (by design — see §6) | offer exists but is **corrupted** (see §6/§9) — true secondary blocker unknown | UNKNOWN — mintick's own offer never applies cleanly enough to see past it |
| 3 | breakout-squeeze-release-breakout | `ta.barssince` unbounded (wrapped in `nz(...)`, not directly compared to a literal) | WINDOW_ARGUMENT_LIMIT | none found — rest of script uses only served names (`ta.bb` tuple, `ta.percentrank`, `ta.ema`, `ta.atr`, `ta.linreg`, `ta.highest`, `ta.sma`) | — |
| 4 | candles-doji-at-extension | `ta.falling` (unserved; `ta.rising`, its mirror, was served by Lane B, `ta.falling` was not) | UNSUPPORTED_BUILTIN | none — script also calls `ta.rising`, which is now served; every other name (`ta.sma`, `ta.highest`, `ta.lowest`, `ta.ema`, `ta.atr`) is served | — |
| 5 | candles-key-reversal-bar | `syminfo.mintick` idiom | UNSUPPORTED_BUILTIN (by design) | offer corrupted — see §6 | UNKNOWN |
| 6 | candles-red-to-green-day | `syminfo.mintick` idiom | UNSUPPORTED_BUILTIN (by design) | offer corrupted — see §6 | UNKNOWN |
| 7 | candles-strong-closing-range | `syminfo.mintick` idiom | UNSUPPORTED_BUILTIN (by design) | offer corrupted — see §6 | UNKNOWN |
| 8 | meanrev-zscore-multi-oscillator-washout | `ta.cci(close, 20)` — wrong role/source arg (engine wants `hlc3`) | PARAMETER_FIDELITY | **CONFIRMED NONE.** `request.security(syminfo.tickerid, "W", ta.rsi(close,14), lookahead=...)` — a real second unserved-sounding name in source — **translates cleanly once cci is fixed.** This script has exactly ONE real blocker. | — |
| 9 | multifactor-gap-up-continuation-hold | `[st, dir] = ta.supertrend(3.0, 10)` — no tuple form | CANONICAL_AST_LIMIT / CORRECT_REFUSAL | **CONFIRMED**: the bare, non-tuple form (`st = ta.supertrend(3.0, 10)`) is ALSO refused, separately, as "NOT EXPRESSIBLE" — `ta.supertrend` has no spelling in this engine in either shape | none deeper — this is a hard ceiling, by design |
| 10 | multifactor-pocket-pivot-accumulation | `syminfo.mintick` idiom | UNSUPPORTED_BUILTIN (by design) | offer corrupted — see §6 | UNKNOWN |
| 11 | multifactor-rsi-pullback-in-uptrend | `dryVol_placeholder_removed` — name never bound (author's own typo/leftover artifact) | CORRECT_REFUSAL | none — this is the deliberately-preserved "real pasted scripts contain real mistakes" case; the refusal is correct and no fix is appropriate | — |
| 12 | recency-breakout-hold-since-trigger | `ta.barssince(trigger)` unbounded (assigned to a variable, not inline-compared) | WINDOW_ARGUMENT_LIMIT | **HIGHLY LIKELY** (not fully isolated cleanly — see caveat below): two `ta.valuewhen(trigger, ..., 0)` calls with the same arity mismatch as #1/#13 | unknown |
| 13 | recency-fresh-golden-cross | `ta.barssince` — two calls compared to EACH OTHER (`barsDC > barsGC`), not to a literal or bound input | WINDOW_ARGUMENT_LIMIT | **CONFIRMED NONE** — isolated reduction (two `ta.barssince` calls, one cross-compare, nothing else) reproduces the exact refusal standalone; no other unserved name in the script | — |
| 14 | recency-macd-turn-recent | `ta.valuewhen` arity mismatch | PARAMETER_FIDELITY | **CONFIRMED, and DEEPER THAN THE MESSAGE ADMITS**: even the "correctly" arity-fixed call `valuewhen(cross, macdLine, within)` still fails, on `pine:role-order` ("no measured order maps `valuewhen` onto them") | the refusal's own advice ("write `valuewhen(condition, source, n)`") is **necessary but not sufficient** |
| 15 | volatility-atr-expansion-breakout | `syminfo.mintick` idiom | UNSUPPORTED_BUILTIN (by design) | offer corrupted — see §6 | UNKNOWN |
| 16 | volatility-inside-bar-continuation | `syminfo.mintick` idiom | UNSUPPORTED_BUILTIN (by design) | offer corrupted — see §6 | UNKNOWN |
| 17 | volatility-range-contraction-base | `ta.kcw` (unserved) | UNSUPPORTED_BUILTIN | **CONFIRMED, THREE-DEEP**: fixing kcw exposes `ta.tr(true)` (a parameter-fidelity gap — `ta.tr()`/`ta.tr(false)` translate, `ta.tr(true)` does not); fixing that too exposes `ta.falling` (unserved, same as #4). `request.security(syminfo.tickerid, "W", ta.atr(10))` (no `lookahead=` kwarg this time) is **confirmed clean** once those three are fixed | none further found — 3 real blockers, then done |
| 18 | volume-capitulation-volume-reversal | `syminfo.mintick` idiom | UNSUPPORTED_BUILTIN (by design) | offer corrupted — see §6 | UNKNOWN |
| 19 | volume-dollar-volume-money-flow | `ta.cmf(21)` (unserved) | UNSUPPORTED_BUILTIN | **CONFIRMED, TWO independent, in DIFFERENT guard families**: `ta.accdist` (unserved, `pine:function`) AND a `for i = 0 to 24 ... distDays := distDays + 1` stateful accumulator loop, which independently refuses on `pine:reassign` ("a name that is reassigned later cannot be folded into one expression") | STATEFUL_REASSIGNMENT is a genuinely different construct class from the other two — see §8 |
| 20 | volume-obv-accumulation-divergence | `ta.obv` (ruled — "cumulative from the first bar, with no absolute seed") | CORRECT_REFUSAL / TRANSLATOR_SEMANTIC_GAP | **CONFIRMED**: `ta.pvt` (Price Volume Trend — a structurally similar cumulative-running builtin) is independently unserved | both are the same conceptual gap (no general "cumulative running total" primitive for arbitrary named series) |
| 21 | volume-rvol-breakout-thrust | `syminfo.mintick` idiom | UNSUPPORTED_BUILTIN (by design) | offer corrupted — see §6 | UNKNOWN |

**Blocker-class distribution (by PRIMARY guard, the corpus's own histogram,
unchanged by this tranche):**

```
pine:function   9   (ta.valuewhen ×2, ta.barssince ×3, ta.falling, ta.cci-shape,
                      ta.supertrend, ta.kcw, ta.cmf, ta.obv — 10 name-slots
                      across 9 scripts because one script's primary is a
                      role-order variant of a pine:function-family name)
pine:builtin    9   (syminfo.mintick, all 9)
pine:role-order 1   (ta.cci)
pine:tuple      1   (ta.supertrend)
pine:undefined  1   (author's own unbound name)
```

**"Scripts affected per blocker class"**, counting every CONFIRMED blocker at
any depth (primary or secondary), not just the first-reported one:

```
syminfo.mintick (mechanism-corrupted, true depth unknown)   9 scripts
ta.barssince (unbounded, various shapes)                    4 scripts (#1 secondary, #3, #12 primary, #13)
ta.valuewhen (arity + role-order, two-layer defect)         3 scripts (#1 secondary, #12 secondary-likely, #14)
ta.falling                                                  2 scripts (#4, #17 secondary)
request.security (same-ticker weekly resample)              2 scripts in SOURCE, 0 CONFIRMED as real blockers
                                                              (#8 and #17 both tested clean once their
                                                              real blockers were fixed — see §6/§10)
ta.cci role-order                                           1 script (#8, sole blocker)
ta.supertrend (no expressible form, either shape)            1 script (#9, hard ceiling)
ta.kcw                                                       1 script (#17 primary)
ta.tr(true)                                                  1 script (#17 secondary)
ta.cmf                                                       1 script (#19 primary)
ta.accdist                                                   1 script (#19 secondary)
stateful for-loop accumulator (pine:reassign)                1 script (#19 tertiary)
ta.obv                                                       1 script (#20 primary)
ta.pvt                                                       1 script (#20 secondary)
undefined-name author typo                                   1 script (#11, correct refusal)
```

**Ranked by the six criteria (corpus scripts unlocked · silent-wrong-answer
risk · real public-script evidence · blast radius · architectural leverage ·
soundness preservation) — see §11 for the full ranking.**

---

## 6. The assisted-edit mechanism's zero uplift — root cause found, not just measured

**Structural fact, confirmed by direct code reading of the entire `pine.js`
engine (114 `PineRefusal` construction sites): exactly ONE of them supplies a
`suggest` + `span` — `mintickGuardOffer`, the `syminfo.mintick` idiom rewrite.**
No other guard in the engine — not `pine:function`, not `pine:tuple`, not
`pine:role-order`, not `pine:undefined` — has ever been wired to offer a
machine-appliable rewrite. `acceptEveryOffer` (the assisted-edit simulation)
can therefore, by construction, never do anything for 12 of the 21 misses.
Classification for those 12: **NO_OFFER — not a defect, a scope boundary.**
(Confirmed as a permanent test: `pine.blindCorpusDecomposition.test.js`,
`"the ENTIRE engine has exactly one refusal that carries a suggest+span"`.)

For the remaining 9 (all `syminfo.mintick`), the ONE offer that exists is
**silently corrupted on every real corpus script**, and the root cause is now
fully diagnosed:

- `lexPine` (pine.js) normalizes `src.replace(/\r\n?/g, '\n')` **before**
  tokenizing. Every token's `.index` — and therefore every `spanOfNode(...)`
  result, including `mintickGuardOffer`'s returned `span` — is a character
  offset into that **normalized** text.
- `translatePine`'s own `source` parameter (the **raw**, un-normalized string)
  is threaded unchanged into `new Resolver(..., { source, ... })` and becomes
  `this.source` — what `mintickGuardOffer` slices to build its `suggest` text,
  and what any caller (this test file's own `acceptEveryOffer`, and — as far
  as this diagnosis can tell — the only production "take this offer" path)
  must splice using `refusal.span` against the **original raw** string.
- **Every blind-corpus fixture is CRLF** (`\r\n`, confirmed across all 48
  files). Splicing a normalized-space span into a CRLF-intact string drifts by
  **exactly one character per CRLF line ending preceding the flagged
  construct.** Confirmed by direct measurement on
  `breakout-gap-up-holding.pine` (9 preceding lines → 9-character drift → the
  span lands on `"Range  = math.max(high - low, syminfo"`, not
  `"math.max(high - low, syminfo.mintick)"`) and reproduced from a minimal,
  hand-built CRLF control with zero corpus content (LF control: correct;
  CRLF: corrupted, byte-identical drift mechanism).

This is the **measured, root-caused explanation for the entire zero-uplift
finding**: it is not that fixing `syminfo.mintick` typically exposes a
different real blocker nine separate times (the "secondary guard" readings —
`pine:character`, `pine:no-output`, `pine:statement`, `pine:undefined` — that
a naive re-run of `acceptEveryOffer` reports for these 9 scripts) — it is that
the applied "fix" is **garbage text**, and whichever garbage-dependent guard
happens to fire next is a coincidence of exactly what got mangled, not a
finding about the script's real second blocker. **The true secondary blocker
behind `syminfo.mintick` in any of the 9 real scripts is UNKNOWN** until the
offer is fixed or the fixture is hand-edited to apply the intended `(high -
low)` rewrite manually (which this tranche's rules forbid, since that would be
editing the fixture to manufacture a result rather than measuring the current
engine).

**This is a real product bug in `pine.js`'s offer mechanism — not a test/harness
defect** — and is explicitly NOT fixed in this tranche (RISK-004 authorizes
decomposition only; "broad assisted-edit changes" are named as out of scope
pending this exact distribution). It is preserved as the top-ranked remediation
opportunity in §11, with a permanent, minimal, CRLF-vs-LF-control regression
test already committed (`pine.blindCorpusDecomposition.test.js`, two tests
under "the mintick offer SPAN is computed in the wrong index space").

**Assisted-edit zero-uplift classification, final:**

| Class | Count | Scripts |
|---|---|---|
| NO_OFFER (guard was never wired to offer anything — structural, not a bug) | 12 | all non-mintick misses (#1 primary, #3, #4, #8, #9, #11, #12, #13, #14, #17 primary, #19, #20) |
| APPLICATION DEFECT (offer exists, is well-formed in isolation, but its `span` is computed in the wrong index space and corrupts on any real CRLF multi-line script) | 9 | all `syminfo.mintick` misses (#2, #5, #6, #7, #10, #15, #16, #18, #21) |
| WRONG OFFER / NON-ACTIONABLE OFFER / SECONDARY BLOCKER / CORRECTLY NO SAFE ASSIST / OTHER | 0 | none of the 21 misses fits these — every one is either NO_OFFER or the one APPLICATION DEFECT |

---

## 7. Minimal reductions — committed as permanent tests

`app/src/components/chart/engine/ast/pine.blindCorpusDecomposition.test.js`,
12 tests, all passing, none committing a full corpus script body:

1. The one-offer structural fact (6 guard families probed, none but mintick
   carries a `suggest`).
2. The mintick offer's correct behavior in isolation (control).
3–4. The CRLF span-corruption root cause: an LF-vs-CRLF paired control proving
   the drift is mechanical (not fixture-specific), plus a reproduction of the
   exact `breakout-gap-up-holding.pine` shape (9 preceding lines, 9-character
   drift) without committing that fixture's body.
5. `ta.barssince` wrapped in `nz(...)` is independently unbounded (script #1's
   secondary blocker).
6. `request.security` same-ticker weekly resample is confirmed CLEAN once
   `ta.cci`'s role-order is fixed (script #8 has exactly one real blocker).
7. The three-deep chain behind `ta.kcw` in script #17 (`ta.tr(true)` →
   `ta.falling` → clean `request.security`).
8. `ta.accdist` (unserved) and the stateful for-loop accumulator
   (`pine:reassign`) as two independent, differently-classed blockers beyond
   `ta.cmf` in script #19.
9. `ta.pvt` independently unserved, alongside `ta.obv`, in script #20.
10. `ta.supertrend` refused in BOTH the tuple and bare forms — no expressible
    spelling exists (script #9's hard ceiling).
11. `ta.valuewhen`'s role-order defect surviving an arity-correct rewrite
    (script #14's two-layer defect).
12. Two `ta.barssince` results compared to each other, standalone, reproduces
    script #13's sole blocker in isolation.

Full suite run together with the existing `pine.blindCorpus.test.js`:
**2109/2110 passing** across the entire `ast/` directory (112/113 files); the
one failure is the pre-existing, expected, unchanged
`'⏳ the accepted floor moves one way too'` assertion (`ACCEPTED.length >
PASSING.length` — 27 is not greater than 27), which is the correct, honest
state of the zero-uplift finding and must **not** be made to pass by any
change in this tranche.

---

## 8. Cross-reference against the 8-script public compatibility corpus

Guard names confirmed live from `pine.community.guards.test.js`:
`22-daily-weekly-monthly-highs-lows.pine` → `pine:collection`;
`27-support-resistance-channels.pine` → `pine:reassign`;
`29-zigzag-plus-plus.pine` → `pine:module`; QQE → `pine:state` (confirmed
present in that file's comments).

- **Overlap: `pine:reassign` appears in BOTH corpora.** The public corpus's
  `27-support-resistance-channels.pine` hits it as its PRIMARY blocker
  (`:=` reassignment); the blind corpus hits the identical guard as a
  **tertiary, previously-unreported** blocker in
  `volume-dollar-volume-money-flow` (the `for`-loop accumulator, §6/§8 in the
  table above) — a genuine cross-corpus repeat of the same construct class
  that the original first-guard histogram never surfaced (it was buried behind
  two other blockers).
- **`pine:state` (QQE-style stateful recursion) does NOT repeat in the blind
  corpus.** None of the 21 misses' primary OR any confirmed secondary blocker
  is `pine:state`. The one loop/state-adjacent construct found
  (`volume-dollar-volume-money-flow`'s `for`-loop) is a **different** guard
  (`pine:reassign`, a fold-limit on a variable reassigned across iterations),
  not QQE's self-referential single-bar recursion. These are related but
  distinct construct classes and should not be conflated in future scoping.
- **`pine:collection` and `pine:module`** (arrays, imports — the public
  corpus's other two correct-refusal classes) do not appear anywhere in the 48
  blind scripts, confirmed by the guard histogram (5 guard families total,
  neither of these two among them).
- **Did `input.bool` (Track F v1.1) materially change the current blind
  result? No.** None of the 21 current misses' primary or any confirmed
  secondary blocker involves any `input.*` construct at all — every blocker is
  a `ta.*`/`math.*`/`syminfo.*` function, builtin, or a bare undefined name.
  Track F's input-type work and the blind corpus's remaining failures are
  disjoint concerns at present.
- **Does BuilderSheet visual-exposure (RISK-029) matter to the blind corpus?
  No.** All 48 scripts are single-boolean-output screens by the corpus's own
  design constraint (verified non-vacuously by the existing harness); none
  needs bands, `fill`, or `colorMode`.
- **Did prior fixes already improve blind-corpus cases? Yes** — the entire
  17→27 historical ratchet (run-length counter identity, OBV-against-its-own-
  average, venue-qualified ticker, and Lane B's 4 name promotions) is blind-
  corpus-visible progress, all pre-dating this tranche and preserved exactly.

---

## 9. Silent-wrong-answer check

**None found among the 21 misses.** Every one either (a) correctly refuses
with a named guard and an accurate reason (19 of 21), or (b) is the mintick
mechanism defect, which corrupts the OFFER text but does not change
`translatePine`'s own judgment about the ORIGINAL script — the original script
still correctly refuses with the true, honest mintick message; a member who
does not accept the (broken) offer sees nothing wrong. The risk is narrower
than "silent wrong answer": it is "a member who explicitly accepts a
displayed offer, on a CRLF script, past line 1, gets a rewrite that does not
do what the offer said it would do" — real, but scoped to the assist path, not
the base translation judgment.

---

## 10. Correct-refusal count

**2 of 21** are CORRECT_REFUSAL with no remediation appropriate:
`multifactor-rsi-pullback-in-uptrend` (author's own unbound-name typo,
deliberately preserved in the corpus) and `multifactor-gap-up-continuation-hold`
(`ta.supertrend` has no expressible form in either shape — an architectural
ceiling, not a bug).

---

## 11. Top remediation opportunities, ranked

1. **Fix the mintick offer's index-space bug** (§6). Leverage: unlocks the
   TRUE secondary-blocker picture for 9 scripts at once (currently unknown),
   and — more importantly — repairs the ONLY offer mechanism in the entire
   engine for **every future CRLF script**, not just this corpus. Blast
   radius: one function (`mintickGuardOffer`) plus (likely) `spanOfNode`'s
   contract, or a `translatePine`-level decision to normalize `source` before
   storing `this.source`. Architectural leverage: HIGH — this is infrastructure
   underneath every future offer the engine might ever grow, not a one-off
   patch. Soundness: does not touch translation judgments, only the applied
   text of an already-consented rewrite. **Needs an architecture decision**:
   should `this.source` be re-derived to match normalized-index space, or
   should spans be computed in raw-source space from the start? Either is
   narrow; the choice affects every future span-bearing guard.
2. **`ta.cci` role-order / parameter-fidelity** — real Pine's `ta.cci(source,
   length)` takes an arbitrary source; this engine currently requires `hlc3`
   specifically. Leverage: unlocks `meanrev-zscore-multi-oscillator-washout`
   OUTRIGHT (confirmed sole blocker, §5/§6) — the single highest-confidence,
   lowest-risk win in this decomposition. Narrow, well-scoped fix; no
   architecture decision needed.
3. **`ta.barssince` bounding heuristic gaps** — currently bypassed only by a
   DIRECT, INLINE comparison to a literal or a bound name; fails when wrapped
   in `nz(...)` (script #1, #3) or compared to another `ta.barssince` result
   (script #13) or assigned to a variable before comparison (script #12).
   Leverage: touches 4 of 21 misses (highest script-count of any single
   construct family after mintick). Requires care: the existing heuristic is
   already a narrow, deliberate exception (`pine.js`'s own comment: "every
   value the cap destroys is a count that comparison already answers the same
   way") — widening it changes what "bounded" means and needs the same rigor
   that produced the current exception.
4. **`ta.valuewhen`'s two-layer defect** (arity AND role-order, §5 #14) — the
   refusal's own advice is incomplete. Leverage: 2–3 scripts (#1 secondary,
   #12 likely-secondary, #14 primary). Narrow bug in the refusal-advice text
   plus a real role-order gap in the underlying function's resolution.
5. **The `syminfo.mintick` idiom's second guard, once mintick's offer is
   fixed** — currently UNKNOWN for 9 scripts. This is not independently
   actionable until #1 above is done; ranked here as "next thing to measure,"
   not "next thing to build."

Narrow, single-script fixes not otherwise ranked: `ta.tr(true)` parameter
fidelity (#17), `ta.falling` (#4, #17 — 2 scripts, same missing-builtin class
as the already-served `ta.rising`), `ta.kcw`/`ta.cmf`/`ta.accdist`/`ta.obv`/
`ta.pvt` (each single-script, each a plain UNSUPPORTED_BUILTIN with no
disclosed ambiguity — candidates for a future vendor-parity batch, not this
tranche). The `pine:reassign` for-loop accumulator (#19 tertiary) needs an
architecture decision (does the engine grow general bounded-loop-with-
accumulator support, or stay refused) and should not be scoped as "narrow."

---

## 12. Updated RISK-004 truth (superseding the historical entry)

Old: "21/48 raw, 21/48 assisted, 0 additional recoveries; investigate why."
**New: 27/48 raw, 27/48 assisted, 0 additional recoveries. The zero uplift is
now root-caused, not merely observed: the assisted-edit mechanism has exactly
one offer in the whole engine, and that offer's span is computed in the wrong
character-index space, corrupting on every CRLF multi-line script — which is
every script in this corpus.** The 21 remaining misses decompose into 5 guard
families, 15 distinct real-or-suspected blocking constructs, at least 6
scripts with 2+ independently-confirmed real blockers (one with 3), and
exactly 2 correct, non-actionable refusals. See RISK_REGISTER.md for the row
update.

## 13. Recommended next custom-indicator tranche (recommendation only — not begun)

Given the leverage ranking above, the highest-confidence next tranche is a
**narrow, two-item fix**: (a) `ta.cci` role-order/parameter-fidelity (item 2),
which unlocks one script outright with no architecture decision, and (b) the
mintick offer's index-space bug (item 1), which is infrastructure-level and
should be fixed even if no corpus script were waiting on it, since it silently
breaks the one "take this offer" affordance the whole product has for any
CRLF-authored script. Both are narrow enough to bound tightly; neither
requires the broader `ta.barssince`/`ta.valuewhen` heuristic work, which
deserves its own, separately-scoped tranche given how much nuance the existing
exceptions already carry.

**This tranche does not implement either.** Per the authorizing instruction,
diagnostic evidence and documentation are committed and pushed; no
remediation follows without separate authorization.

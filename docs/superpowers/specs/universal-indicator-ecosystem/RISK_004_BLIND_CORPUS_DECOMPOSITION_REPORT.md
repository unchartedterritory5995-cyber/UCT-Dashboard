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

---

# ADDENDUM — RISK-004 REMEDIATION TRANCHE (2026-09-06, second commit)

Authorized as a bounded, two-item tranche following owner acceptance of the
decomposition above. **Item A implemented and verified. Item B was NOT
implemented — it hit the tranche's own explicit STOP condition and is
reported, not fixed.**

## A. Mintick offer index-space fix — IMPLEMENTED

### A-1. Exact flow, and where the mismatch occurred

```
raw source (member's script, \r\n intact if that's what they pasted)
  → lexPine(source): text = raw.replace(/\r\n?/g, '\n')     [NORMALIZATION]
                     tokens[i].index = offset into `text`     [NORMALIZED SPACE]
  → parse → AST, every node's .tok/.endTok carrying normalized-space indices
  → Resolver constructed with { source }  — `source` is the RAW parameter,
    UNCHANGED, threaded straight from translatePine's own argument           [RAW SPACE]
  → mintickGuardOffer(node):
       callSpan = spanOfNode(node)     — NORMALIZED-space numbers
       keepSpan = spanOfNode(keep)     — NORMALIZED-space numbers
       text = this.source.slice(keepSpan[0], keepSpan[1])   ← MISMATCH HERE:
                 NORMALIZED-space numbers slicing a RAW-space string
  → PineRefusal('pine:builtin', ..., suggest=`(${text})`, span=callSpan)
       ← callSpan (NORMALIZED-space) is what leaves the engine as refusal.span
  → offer application (any caller, incl. this corpus's own acceptEveryOffer):
       edited = raw.slice(0, span[0]) + suggest + raw.slice(span[1])
       ← MISMATCH HERE TOO: span is NORMALIZED-space, raw is RAW-space
  → re-translation of `edited`
```

**The mismatch occurs at exactly two points, both inside `mintickGuardOffer`,
both consuming a `spanOfNode(...)` result before it has been translated out of
normalized-index space**: the `this.source.slice(keepSpan...)` call that
builds `suggest`, and the `callSpan` value that becomes `refusal.span` (which
every downstream consumer, including this test corpus's `acceptEveryOffer`,
then uses to splice against the RAW source). `spanOfNode` itself is correct —
it is not a bug, it is answering the question it was built to answer
(normalized-space, because tokens live there); the bug is that its output was
consumed against the raw string without translation.

### A-2. The fix: one canonical raw↔normalized offset contract

Rejected the "arbitrary offset arithmetic" approach (e.g., hand-adjusting by a
guessed count of preceding `\r` characters at the call site) in favor of a
single, precise, invertible mapping built once, in the same pass that performs
the normalization, so the two operations can never independently drift:

- **`lexPine`** now builds `text` character-by-character (instead of one
  `.replace()` call) and simultaneously builds `rawOffsetMap`, an array where
  `rawOffsetMap[n]` is the raw-string offset immediately after the raw bytes
  that produced the first `n` characters of `text`. Each `\r\n` pair collapses
  to one `\n` (raw pointer advances 2, normalized pointer advances 1); a lone
  `\r` also collapses to `\n` (raw +1, normalized +1); every other character
  is 1:1. Returned as a new field on `lexPine`'s result object (additive —
  confirmed via the codebase's only production call site, `translatePine`,
  plus a handful of test call sites that destructure only `.tokens`/`.version`
  and are unaffected).
- **`translatePine`** threads `rawOffsetMap` through to the `Resolver`
  alongside the existing `source` option.
- **`Resolver.toRawSpan(span)`** is the one bridge: `[rawOffsetMap[span[0]],
  rawOffsetMap[span[1]]]`, identity when no map is available (a `Resolver`
  built directly, without going through `translatePine`/`lexPine` — e.g. a
  unit test — is unaffected).
- **`mintickGuardOffer`** now calls `this.toRawSpan(spanOfNode(...))` before
  either consuming the span itself or returning it as `refusal.span`.

This is the only site that needed it: direct code reading confirms
`this.source` is read in exactly one place in the entire engine
(`mintickGuardOffer`), and `PineRefusal`'s 5-argument (span-carrying) form is
constructed in exactly one place, matching the decomposition's earlier
"exactly one offer in 114 sites" finding. No other guard, no other span
consumer, and no other test was touched.

### A-1 (invariant restored)

**THE SPAN USED FOR AN EDIT NOW REFERS TO THE EXACT SOURCE STRING THE EDIT IS
APPLIED TO** — `refusal.span` and `this.source` are both raw-space, always,
regardless of the source's newline convention.

## A1. Newline preservation

**No newline conversion, silent or otherwise, reaches the member.** The fix
works by never letting a normalized-space number touch the raw string in the
first place, rather than by normalizing-then-reconstructing. Consequently:

- The `suggest` text is sliced directly from the RAW source (`this.source`,
  never normalized), so if the "keep" expression itself ever spanned a
  newline, whatever raw newline bytes were there would be preserved verbatim
  in the suggested text — this doesn't arise for the mintick idiom in
  practice (the kept expression is always a single-line arithmetic
  expression), but the mechanism doesn't special-case it either.
- Splicing `raw.slice(0, span[0]) + suggest + raw.slice(span[1])` naturally
  leaves every byte outside the edited range untouched — CRLF stays CRLF, LF
  stays LF. Confirmed by test: applying the offer to a CRLF fixture produces a
  result with the exact same CRLF-pair count as the original, and zero bare
  LF-only newlines anywhere in the applied text.

## A2. Exact edit safety — all scenarios tested, all pass

Permanent tests in `pine.blindCorpusDecomposition.test.js`
(`describe('✅ RISK-004 FIXED ...')`), covering every scenario the tranche
named:

| Scenario | Test |
|---|---|
| Target on first line (zero preceding newlines) | `'target on the very FIRST line...'` — both LF and CRLF |
| Target after multiple CRLF lines | `'CRLF source: span is now correct...'` (5 preceding lines) |
| Target near end of file | `'target near the END of a CRLF file...'` (13 preceding lines) |
| LF source | control case in every paired test |
| CRLF source | primary case in every paired test |
| Text before the target unchanged | `applied.slice(0, span[0]) === crlf.slice(0, span[0])` |
| Text after the target unchanged | `applied.slice(span[0]+suggest.length) === crlf.slice(span[1])` |
| Output syntactically valid | `translatePine(applied).ok === true` in every case |
| Intended guard removed/replaced exactly once | re-translation after applying raises no further mintick refusal |
| Before/after snippet match | `crlf.slice(...span) === CALL_TEXT` and `refusal.suggest === '(high - low)'` asserted together |

No off-by-one or cross-line corruption found in any tested case.

## A3. Real corpus proof — every triggering script, before and after

**Exactly 9 of the 48 frozen scripts trigger `mintickGuardOffer`** (confirmed
programmatically — `pine.blindCorpusDecomposition.test.js`, not a re-typed
list): `breakout-gap-up-holding`, `candles-key-reversal-bar`,
`candles-red-to-green-day`, `candles-strong-closing-range`,
`multifactor-pocket-pivot-accumulation`, `volatility-atr-expansion-breakout`,
`volatility-inside-bar-continuation`, `volume-capitulation-volume-reversal`,
`volume-rvol-breakout-thrust`.

| Script | BEFORE (pre-fix, this decomposition's earlier finding) | AFTER (post-fix, re-measured) |
|---|---|---|
| breakout-gap-up-holding | refusal: `pine:builtin` (mintick); offer generated; applied → corrupted splice → `pine:character` | offer generated; applied in ONE step → **RECOVERED** (translates to a boolean screen) |
| candles-key-reversal-bar | same shape; applied → corrupted → `pine:no-output` | applied in ONE step → **RECOVERED** |
| candles-red-to-green-day | same shape; applied → corrupted → `pine:statement` | applied in ONE step → **RECOVERED** |
| candles-strong-closing-range | same shape; applied → corrupted → `pine:undefined` | applied in ONE step → **RECOVERED** |
| multifactor-pocket-pivot-accumulation | same shape; applied → corrupted → `pine:statement` | applied in ONE step → **RECOVERED** |
| volatility-atr-expansion-breakout | same shape; applied → corrupted → `pine:character` | applied in ONE step → **RECOVERED** |
| volatility-inside-bar-continuation | same shape; applied → corrupted → `pine:character` | applied in ONE step → **RECOVERED** |
| volume-capitulation-volume-reversal | same shape; applied → corrupted → `pine:character` | applied in ONE step → **RECOVERED** |
| volume-rvol-breakout-thrust | same shape; applied → corrupted → `pine:undefined` | applied in ONE step → **RECOVERED** |

**OFFER FIXED: 9/9. SCRIPT RECOVERED: 9/9.** These are the same 9 here —
every "secondary guard" the pre-fix measurement reported
(`pine:character`/`pine:no-output`/`pine:statement`/`pine:undefined`) was a
corruption artifact of the coordinate-space bug, not a real second blocker.
Once the offer applies the TEXT the member actually sees offered
(`(high - low)`, spliced at the TRUE call location), every one of these 9
scripts' remaining logic was already expressible — none needed anything else.
This was not assumed; it was measured (`pine.blindCorpusDecomposition.test.js`,
`describe('✅ RISK-004 REMEDIATION A ...')`, asserting chain length 1 and
`recovered === true` for all 9 by name).

## A4. Non-vacuity — all required proofs added, as permanent tests

- **The historical bug reproduces under the pre-fix coordinate treatment**:
  for a pure-LF source, `lexPine`'s normalized text IS the source text, so
  that source's own `refusal.span` numbers ARE, byte-for-byte, "the
  normalized-space numbers" the pre-fix code used unconditionally. Reusing
  those exact numbers against the CRLF-converted version of the same script
  reproduces the historical corruption precisely, without reverting any code
  — `'NON-VACUITY: reproduces the historical bug when the same normalized-
  space numbers are (mis)used against the CRLF string'`.
- **LF remains correct**: asserted as the control case in every paired test.
- **Intentionally shifting a span causes the regression to fail**:
  `'NON-VACUITY: shifting the (correct) span by even one character breaks the
  assertion'` — `±1` on either endpoint no longer equals the call text.
- **Applying the offer to the wrong source representation is detected**:
  `'NON-VACUITY: applying a CRLF-derived offer to the LF-normalized text ...
  is detected as a mismatch, not silently accepted'`.
- **No unrelated source bytes/code units are changed**: byte-for-byte prefix/
  suffix equality asserted in `'applying the offer on CRLF now recovers the
  script ... and PRESERVES the original newline convention'`.

## B. `ta.cci` role-order fix — NOT IMPLEMENTED, STOPPED PER EXPLICIT INSTRUCTION

### B-1. Exact signature chain, as requested

```
PINE/VENDOR SIGNATURE:      ta.cci(source, length) — CCI of an ARBITRARY source
                            series: (source - sma(source,length))
                                    / (0.015 * mean_abs_dev(source,length))

CURRENT UCT TRANSLATION:    the `cci` shape entry (pine.js) requires
                            `sourceMustBe: { at: 0, series: 'hlc3' }` — any
                            other source at argument 0 refuses with
                            `pine:role-order`.

INTERNAL CLOSED-TABLE
CONTRACT:                   `cci: { table: 'cci', pineArity: 2,
                            sourceMustBe: {...}, build: [{series:'high'},
                            {series:'low'},{series:'close'},{pine:1}] }`
                            — the table's `cci` entry is called with EXPLICIT
                            high/low/close, never a generic "source" slot.

KERNEL (indicators.js
computeCCI):                `computeCCI(bars, period)` — takes full OHLC
                            `bars` objects and INTERNALLY, UNCONDITIONALLY
                            computes `tp[i] = (bars[i].h + bars[i].l +
                            bars[i].c) / 3` (typical price). There is NO
                            parameter for an arbitrary source series. The
                            kernel physically cannot compute "CCI of close" —
                            it can only ever compute "CCI of typical price."
```

### B-1 finding: this is NOT a narrow adapter/mapping bug

**Runtime CCI semantics are already correct for what the kernel implements —
but the kernel only implements ONE case (source = typical price), and real
Pine's `ta.cci` supports an arbitrary source.** There is no positional or
role-order remapping that fixes this: computing "CCI of `close`" requires the
SMA and mean-absolute-deviation of `close` itself, not of typical price —
these are different numbers for any source other than `hlc3`, by
construction, not by a wiring mistake. No adapter-level change can bridge
this; only a genuinely new, generic kernel function (accepting an arbitrary
source array, not `bars`) could.

**The current `pine:role-order` refusal is not a bug — it is the DELIBERATE,
already-correct behavior**, per the shape's own committed comment (pine.js,
directly above the `cci` entry): *"WITHOUT THAT FIELD THE PLAN WOULD BE A
LIE... a shape alone would answer `ta.cci(close, 20)` — a real and different
indicator — with the typical-price column: a plausible number, on the right
scale, wrong on every bar, with nothing refusing."* The refusal message itself
already states this precisely and honestly (*"those are the same column when
the source is `hlc3` and a DIFFERENT indicator otherwise, so only that source
is taken"*).

### STOP condition met — per explicit instruction

The authorizing instruction states: *"If the proposed role-order change would
alter actual CCI runtime semantics rather than just the adapter mapping, STOP
and report before changing it."* Making `meanrev-zscore-multi-oscillator-
washout`'s `ta.cci(close, 20)` translate would require exactly that — a new
generic CCI kernel, not an adapter correction. **This tranche does not
implement it.** No kernel code, no `closedTable.json` entry, and no
`pine.js` role-order logic were touched for `cci`. The earlier decomposition
report's characterization of this as "the single highest-confidence,
lowest-risk fix" (§11, item 2) is hereby corrected: it is real, but it is
KERNEL-level work, not adapter-level, and needs its own decision, not a
narrow-tranche fix.

**B1 (semantic safety), B2 (mutation proof): not applicable — no change was
made to prove safe.**

## C. Frozen 48-script corpus re-run

```
RAW BEFORE:       27 / 48
RAW AFTER:        27 / 48        (unchanged — B was not implemented, and A
                                   only ever affected the ASSISTED path, never
                                   the raw translation of the original script)

ASSISTED BEFORE:  27 / 48
ASSISTED AFTER:   36 / 48        (+9, exactly the 9 mintick-triggering scripts)
```

Every changed script (all 9 recovered ONLY via ASSISTED, none via RAW —
`RAW ACCEPTED` and `ASSISTED RECOVERED` are kept distinct throughout, per
instruction):

| Script | Prior primary blocker | New result | Source of change | Newly exposed secondary blocker |
|---|---|---|---|---|
| breakout-gap-up-holding | `syminfo.mintick` (pine:builtin) | ASSISTED RECOVERED (raw still refuses, correctly — the original script still needs the member's consent) | mintick offer fix (A) | none |
| candles-key-reversal-bar | same | ASSISTED RECOVERED | A | none |
| candles-red-to-green-day | same | ASSISTED RECOVERED | A | none |
| candles-strong-closing-range | same | ASSISTED RECOVERED | A | none |
| multifactor-pocket-pivot-accumulation | same | ASSISTED RECOVERED | A | none |
| volatility-atr-expansion-breakout | same | ASSISTED RECOVERED | A | none |
| volatility-inside-bar-continuation | same | ASSISTED RECOVERED | A | none |
| volume-capitulation-volume-reversal | same | ASSISTED RECOVERED | A | none |
| volume-rvol-breakout-thrust | same | ASSISTED RECOVERED | A | none |

No script changed due to CCI (B was not implemented). No previously-passing
script regressed. No new secondary blocker was exposed anywhere — the "OFFER
FIXED = SCRIPT RECOVERED, 9/9" finding in A3 already establishes this.

## D. Assisted-edit metric — first trustworthy measurement

Across all 21 pre-tranche misses:

```
Failing scripts offered an edit at all:         9  (the mintick 9 — every other
                                                     guard is NO_OFFER by
                                                     construction; unchanged by
                                                     this tranche)
Offered edit applicable (well-formed, once
  coordinate space is corrected):                9 / 9
Edit successfully applies (splice produces
  syntactically valid Pine):                     9 / 9
Translates after the edit:                       9 / 9
Remains blocked by a secondary issue after
  a successful edit:                             0 / 9
```

**This is not a claim that assisted editing is broadly functional.** There is
still, after this tranche, only ONE offer-bearing refusal in the entire
114-site `PineRefusal` surface (`mintickGuardOffer`) — confirmed unchanged by
direct re-count. The other 12 of the original 21 misses remain NO_OFFER, by
design, untouched, exactly as scoped. What changed is that the one offer that
exists is now honest: when it fires, it works, on both LF and CRLF sources.

## E. Scope discipline — confirmed

No offers were added to any other `PineRefusal` site. `ta.barssince`,
`ta.valuewhen`, tuple support, undefined-symbol recovery, additional
builtins, additional Track F input types, generalized recursive/stateful
semantics, and broad Pine parser work were not touched. `git diff` confirms
the entire change surface is: `pine.js` (lexPine's normalization loop +
`rawOffsetMap`, `translatePine`'s thread-through, the `Resolver` constructor's
new field, `mintickGuardOffer` + the new `toRawSpan` helper) and
`pine.blindCorpus.test.js`/`pine.blindCorpusDecomposition.test.js` (the two
floor constants and new/updated permanent tests).

## F. Documentation

RISK-004 truth, preserving both numbers and the two-cause history, is
recorded in RISK_REGISTER.md's updated RISK-004 row (below) and restated here:

- **CURRENT RAW ACCEPTANCE: 27/48** (unchanged by this tranche).
- **CURRENT ASSISTED ACCEPTANCE: 36/48** (up from 27/48; the historical
  21/48 and the intermediate 27/48-both-raw-and-assisted are both preserved
  as historical fact, not erased).
- **The historical zero-uplift result had two distinct, now-both-diagnosed
  causes**: (1) extremely narrow offer coverage — only 1 of 114 refusal sites
  ever offered anything, unchanged by this tranche, a scope boundary rather
  than a defect; and (2) the sole real offer path had a CRLF/LF index-space
  defect — **fixed in this tranche (Item A)**. Cause (2) is why uplift was
  previously exactly zero despite cause (1) alone still leaving room for up to
  9 recoveries; cause (2) being fixed is why uplift is now exactly 9, matching
  cause (1)'s remaining ceiling precisely (no other guard offers anything, so
  9 was always the maximum possible uplift once (2) was fixed).

## Recommendation for the next custom-indicator issue (not begun)

Given B could not be done as a narrow fix, the highest-confidence next,
narrowly-scoped item is **`ta.barssince`'s bounding-heuristic gaps** (item 3 in
the original ranking, §11 above) — it touches 4 of the remaining 21 misses
(`breakout-flat-base-pivot-breakout`, `breakout-squeeze-release-breakout`,
`recency-breakout-hold-since-trigger`, `recency-fresh-golden-cross`), more
than any other single remaining construct, and does not require a kernel
change (only widening which comparison SHAPES the existing "compared to a
bound" exception recognizes — `nz(...)`-wrapped, assigned-then-compared, and
compared-to-another-`barssince`-call are the three gaps found). It should be
scoped as its own decision, since the existing heuristic is already a
deliberate, narrow exception and widening it changes what "bounded" means —
exactly the kind of narrow-but-not-trivial call this tranche's discipline
(state the exact contract, prove it, don't touch the kernel) should carry
into. The `ta.cci` generic-source kernel question (from Part B) is a SEPARATE,
larger decision — it is real engine capability, not a corpus-chasing fix —
and deserves its own scoping conversation rather than being bundled into a
future "narrow fix" tranche by default.

**This recommendation is not begun.**

---

# ADDENDUM 2 — RISK-004 REMEDIATION: `ta.barssince` BOUNDING-HEURISTIC GAPS (2026-09-06, third commit)

Authorized as a single bounded item following owner acceptance of the mintick
remediation. **One of four `ta.barssince` scripts recovered on RAW
translation. Two are execution-model capability gaps, correctly still
refused. One is correctly, honestly refused because forcing it would produce
a confident WRONG answer.**

## 1. The four cases, reconstructed exactly

| Script | Exact construct | Current refusal (pre-fix) | `ta.barssince` use |
|---|---|---|---|
| `breakout-flat-base-pivot-breakout` | `barsSincePivot = nz(ta.barssince(not na(pivotHi)), 0)` then `matured = barsSincePivot >= baseLen` (through a binding) | `pine:function`, unbounded | boolean condition (comparison), via nz + binding |
| `breakout-squeeze-release-breakout` | `justReleased = not squeeze and nz(ta.barssince(squeeze), 1000) <= 3` (inline) | `pine:function`, unbounded | boolean condition (comparison), via nz, inline |
| `recency-breakout-hold-since-trigger` | `age = ta.barssince(trigger)` then `heldLow = ta.lowest(close, math.max(age, 1))` | `pine:function`, unbounded | **numeric arithmetic — feeds another function's window argument** |
| `recency-fresh-golden-cross` | `barsGC = ta.barssince(gc)`, `barsDC = ta.barssince(dc)`, `notUndone = na(barsDC) or barsDC > barsGC` | `pine:function`, unbounded | **comparison against ANOTHER unbounded `barssince` call**, no literal/input bound anywhere in reach |

No corpus script was edited to produce this table — each row is the exact
construct read from the frozen fixture.

## 2. Pipeline trace and the safety invariant

```
Pine source
  → parser (parse.js) — ordinary AST, `ta.barssince(cond)` a one-arg call
  → translator (pine.js Resolver.resolveBinding / resolve, 'binary' case):
      contextBoundedPlan(node)              — INLINE comparison, pure syntax
        (no `this`, cannot fold an input — only a literal K)
      Resolver.boundedBarssinceThroughBinding(node)
        — THROUGH-A-BINDING comparison (age = barssince(...); ...age <= K),
          a method (has `this.constIntOf`, can fold an input to its default)
      Resolver.naGuardDroppedFrom(node)      — drops a redundant `not na(age)`
        guard so it never independently trips the unbounded refusal
      ↓ if none of these match, resolving the bare call itself throws the
        unbounded refusal (`PINE_INEXPRESSIBLE.barssince`)
  → canonical AST (engine grammar): `cCall('barssince', [cond, cNum(window)])`
    compared to `cNum(k)` — IDENTICAL node shape whichever source path found it
  → runtime/kernel (interpret.js): `barsSince(cond, n)` — a SATURATING
    counter, capped at `n`
  → downstream: `treeYieldsBool`, screener/chart execution — unaffected by
    which source shape reached the canonical AST
```

**Exactly which layer refuses the four real cases**: the TRANSLATOR
(`contextBoundedPlan`/`boundedBarssinceThroughBinding`), because NEITHER
function recognized the `nz(barssince(cond), S)` wrapper shape at all before
this remediation — `oneArgBarssince(node)` requires `node.name ===
'ta.barssince'`, and a `nz(...)` call around it fails that check outright, so
the pattern-match returned null and the bare, unbounded refusal fired.

**The existing safety invariant, stated precisely**: `barssince(c) <cmp> K`
for a LITERAL or input-folded `K` is bound-EQUIVALENT to the finite-window
`barssince(c, window) <cmp> K` (window = K for `</>=`, K+1 for `<=/>`) —
proven as an IDENTITY, not an approximation, in the file's own comments
(`barssince(c) < K == barssince(c, K) < K`, etc.). **What wrong result is this
preventing?** Without the comparison bound, mapping the one-argument,
genuinely-unbounded `ta.barssince(c)` onto the table's bounded
`barssince(c, n)` form would require GUESSING a window — "a different number
wearing the same name," per the refusal's own text — which could silently
answer a WRONG bars-since count for any occurrence older than the guessed
window. The comparison bound removes the guess: the window is DERIVED from
the comparison itself, so every value the cap could destroy is a value the
comparison already treats identically. This tranche did not weaken that
guard — it only widened WHICH SOURCE SHAPES can supply a literal/input `K`,
under a NEW, separate soundness gate (below) that a wrapped SENTINEL must
also pass.

## 3. Minimal reductions

All required scenarios exercised in `pine.blindCorpusDecomposition.test.js`,
`describe('✅ RISK-004 REMEDIATION — ta.barssince ...')`:

- Condition never occurred / insufficient history yet → `NaN` (kernel-level, verified directly against `interpret.js`)
- Occurred on the current bar → `0`
- Occurred 1 bar ago → `1`
- Occurred N (here 2) bars ago → `2`
- A REPEATED occurrence resets cleanly (does not accumulate or leak the prior count) → `0` again
- A long gap (beyond the window) → saturates at the cap and STAYS there
- `nz(barssince(cond), S) <cmp> K`, inline — the exact `breakout-squeeze-release-breakout` shape
- `nz(barssince(cond), S) <cmp> K`, through a binding — the exact `breakout-flat-base-pivot-breakout` shape
- `barssince` used NUMERICALLY (feeding another function's window argument) — the exact `recency-breakout-hold-since-trigger` shape — CLASSIFIED, not implemented (see §4/§8)
- `barssince(A) <cmp> barssince(B)` — the exact `recency-fresh-golden-cross` shape — CLASSIFIED, not implemented

No full community/corpus script body was committed as a test fixture; every
reduction is a small, first-party construct targeting the exact semantic
shape.

## 4. Runtime semantics verified FIRST

`interpret.js`'s `barsSince(cond, n)` was read directly and then VERIFIED
against real bar data (realistic daily-spaced timestamps — see the caveat
below) BEFORE any translator change was made:

```
closes = [0, 0, 2, 0, 0, 2, 0, 0, 0, 0]   (close>open true at index 2 and 5)
barssince(close > open, 3) → [NaN, NaN, 0, 1, 2, 0, 1, 2, 3, 3]
```

This is EXACTLY the documented, deliberate behavior: two bars of "insufficient
history" before the window can be trusted, an exact count for 0/1/2 bars
since, a clean reset on the repeated occurrence at index 5, and a saturating
cap of `3` for the long gap at indices 8–9 that does NOT distinguish "occurred
more than 3 bars ago" from "never occurred in the whole series" — both read
as `3`. **The runtime was ALREADY correct for the supported AST shape before
this tranche and is UNCHANGED by it** — this tranche's fix is confined to
`pine.js` (translation-time pattern recognition); `interpret.js` was not
touched. Given that, the fix's soundness claim is provably narrower and
simpler than re-deriving kernel correctness from scratch: the new nz-wrapped
recognition, when it fires, produces the LITERALLY IDENTICAL canonical-AST
node (`cCall('barssince', [cond, cNum(window)])`) that the pre-existing,
already-shipped bare-form recognition has produced since 2026-08-26 — proven
by direct string comparison of the resulting formula (`"barssince(close >
open, 4) <= 3 ? 1 : 0"`, byte-identical whether reached via the nz-wrapped or
bare source shape, in both the inline and through-binding cases).

⚠️ **Caveat, unrelated to this fix, not chased further**: an EARLIER attempt to
run this same kernel probe using tiny synthetic timestamps (`t = 0, 1, 2, ...`
instead of realistic epoch-seconds) produced a corrupted-looking result
(saturating/resetting on nearly every bar). Realistic daily-spaced timestamps
resolved it cleanly. This points at some OTHER, pre-existing, unrelated
interpreter behavior (plausibly a session/gap-continuity check keyed off `t`)
being sensitive to unrealistic bar spacing — worth a future look, but it does
not touch `pine.js`, does not affect this remediation's soundness proof (which
rests on formula-string identity with the already-correct bare form, not on
this probe), and is explicitly NOT investigated further here (out of scope,
kernel-side, not a barssince-bounding translation issue).

## 5. The fix: WHAT WAS ADDED, and WHEN IT DOES NOT APPLY

`pine.js` gained two small, pure helpers plus two call-site extensions:

- **`nzWrappedBarssince(node)`** — recognizes `nz(<one-arg barssince>, S)`
  positionally (same discipline as `oneArgBarssince`), returning `{cond,
  sentinel}` or null. No resolution, no side effects.
- **`nzSentinelSound(op, sentinel, k)`** — a pure, 6-line boolean function.
  The capped window's own truth under `<cmp> K` is determined ENTIRELY by the
  operator (`<`/`<=` → false, `>`/`>=` → true, since window = K or K+1 by
  construction). The rewrite is sound iff the member's own sentinel evaluates
  to that SAME boolean under the same operator and K. This is checked
  EXHAUSTIVELY across all four operators in the permanent test
  (`'the soundness rule generalizes across all four comparison operators'`).
- **`contextBoundedPlan`** (inline) and **`Resolver.boundedBarssinceThroughBinding`**
  (through a binding) each try the bare `oneArgBarssince` shape FIRST
  (unchanged behavior), then fall back to `nzWrappedBarssince` + the
  soundness gate. When the gate fails, both fall through to `null` — the
  ordinary, honest, unbounded refusal fires exactly as before. **Nothing was
  weakened**: the bare-form identity's own literal/input requirement is
  unchanged, and the new nz-wrapped path is REJECTED, not force-applied, on
  any Answer disagreement.

**Why `recency-breakout-hold-since-trigger` and `recency-fresh-golden-cross`
are NOT fixed**: neither is a "comparison to a bound" shape at all.
`math.max(age, 1)` feeding `ta.lowest`'s window argument requires the ACTUAL
NUMERIC VALUE of `age` (confirmed: an ordinary bound expression in that same
window-argument position translates fine — `ta.lowest` itself imposes no
special restriction; the refusal is specifically about resolving the
unbounded `age` value). `barsDC > barsGC` compares two DIFFERENT unbounded
counts to EACH OTHER with no literal/input in reach at all — no window can be
derived from a comparison whose OTHER side is itself unbounded. Both are
recorded as **execution-model capability gaps**: the first would need a
translator rule for "an unbounded count used as a bounded function's dynamic
argument" (a fundamentally different, harder proof than a static comparison
bound); the second would need either a NEW runtime primitive ("which of two
conditions fired most recently") or a much larger whole-formula
constraint-propagation pass (recognizing that `barsGC <= within` is already
asserted elsewhere in the SAME top-level conjunction) — the latter is
explicitly the kind of "broad" engineering this tranche's scope excludes.
Neither was faked; both remain honestly refused.

## 6. Real four-script behavior, before/after

| Script | BEFORE | AFTER |
|---|---|---|
| `breakout-flat-base-pivot-breakout` | raw refused (`pine:function`, unbounded) | raw refused (**unchanged, correctly** — `nzSentinelSound(>=, 0, 35)` is false: `0>=35` is false but `>=`'s implied cap-truth is true, so forcing the rewrite would silently read "no pivot yet" as "matured") |
| `breakout-squeeze-release-breakout` | raw refused (`pine:function`, unbounded) | **raw ACCEPTED** — translates directly, no offer needed, no downstream blocker; `treeYieldsBool` confirms boolean-screen shape |
| `recency-breakout-hold-since-trigger` | raw refused (`pine:function`, unbounded) | raw refused (**unchanged** — classified as a numeric/window-argument capability gap, not a comparison-boundable shape) |
| `recency-fresh-golden-cross` | raw refused (`pine:function`, unbounded) | raw refused (**unchanged** — classified as a barssince-vs-barssince capability gap, no sound local identity exists) |

Only `breakout-squeeze-release-breakout` is "recovered," and it is recovered
on RAW translation (via the ordinary Resolver path, `contextBoundedPlan`), not
via the assisted-edit offer mechanism — no offer was ever involved in this
script's blocker, and none was added.

## 7. Vendor semantics

No vendor-parity claim is made or needed. The two rewrites this tranche adds
are PROVEN IDENTITIES against this engine's OWN already-declared, already-
shipped bounded `barssince(condition, n)` semantics — not a claim about how
TradingView's real `ta.barssince` behaves beyond what the existing (pre-this-
tranche) identity already asserted. Status for the record:
**TRANSLATION / STATIC-ANALYSIS GAP CORRECTED, runtime semantics validated
internally** (per the tranche's own ceiling for this case) — not a new
vendor-parity claim, and none is asserted.

## 8. Mutation / non-vacuity evidence

- **Old overly-conservative rule restored** → covered structurally: the new
  path is a pure ADDITION (bare-form recognition is tried first, unchanged);
  reverting `nzWrappedBarssince`/`nzSentinelSound` would make
  `breakout-squeeze-release-breakout` refuse again, exactly reproducing the
  pre-fix state — no other behavior depends on the addition.
- **New heuristic incorrectly accepts an actually-unbounded unsafe construct**
  → directly tested: the UNSOUND case (`nz(barssince(cond), 0) >= baseLen`)
  is asserted to STAY refused, by name, with the exact guard and message —
  `'UNSOUND (breakout-flat-base-pivot-breakout's exact shape) ... MUTATION-
  SENSITIVE: this is exactly the case nzSentinelSound exists to catch —
  remove or invert that check and this test goes red.'`
- **Returned count off by one** → the resulting formula is asserted verbatim
  (`'barssince(close > open, 4)'` for K=3, op=`<=` — window = K+1 = 4,
  confirmed correct) in both the inline and through-binding sound cases.
- **Repeated true conditions handled incorrectly** → the kernel-verification
  test asserts the count resets to `0` on the SECOND occurrence (index 5),
  not accumulating or leaking the prior run.
- **Never-true behavior changed incorrectly** → the kernel-verification test
  asserts `NaN` for the two insufficient-history bars before the window can
  answer at all, and the capability-gap tests confirm the two genuinely
  unbounded shapes (numeric use, barssince-vs-barssince) are UNCHANGED,
  still refusing exactly as before.
- **Execution requirement falsely marked finite** → not applicable: no
  execution-requirement/lookback declaration was touched; the fix operates
  entirely at static pattern-recognition time, producing the SAME canonical
  node the pre-existing path already produced.

## 9. Frozen 48-script corpus re-run

```
RAW BEFORE:       27 / 48
RAW AFTER:        28 / 48        (+1: breakout-squeeze-release-breakout)

ASSISTED BEFORE:  36 / 48
ASSISTED AFTER:   37 / 48        (+1, same script — it needed no offer, so
                                   RAW and ASSISTED moved together here,
                                   unlike Remediation A's mintick scripts
                                   which moved ONLY on the assisted side)
```

The mintick offer work (Remediation A) is untouched — re-verified: all 9
mintick scripts still recover via the offer, still in exactly one step
(`pine.blindCorpusDecomposition.test.js`'s Remediation-A describe block is
unchanged and still green).

| Script | Prior blocker | New result | New downstream blocker | Raw vs assisted |
|---|---|---|---|---|
| `breakout-squeeze-release-breakout` | `ta.barssince` unbounded (nz-wrapped, inline) | RECOVERED | none | RAW (no offer involved) |

No other script changed. No previously-passing script regressed.

## 10. `ta.cci` — kept parked, unchanged

`indicators.js::computeCCI(bars, period)` remains hardcoded to typical price
(`(h+l+c)/3`) with no source parameter; `ta.cci(source, length)` in real Pine
requires an arbitrary source. This tranche did not touch `cci` anywhere —
not the kernel, not `closedTable.json`, not the `pine:role-order` logic.
`meanrev-zscore-multi-oscillator-washout` remains an unrecovered raw miss for
exactly this reason, unaffected by this tranche.

## 11. Scope discipline — confirmed

No offers were added to any `PineRefusal` site (the barssince fix is a static
translation-time rewrite, not an assisted-edit offer — `ta.barssince` itself
still has no `suggest`/`span`, same as before). `ta.valuewhen`, tuple support,
undefined-symbol recovery, the CCI kernel, new Track F input kinds,
generalized recursive/stateful execution, broad parser work, and the
remaining vendor-parity backlog were not touched. `git diff` confirms the
entire change surface is: `pine.js` (`nzWrappedBarssince`, `nzSentinelSound`,
and the two call-site extensions) and the two blind-corpus test files (floor
constants + new permanent tests).

## FINAL RETURN — items 1–17

1–2 (four cases + current blockers): §1 table above.
3 (pipeline/root cause): §2.
4 (safety invariant): §2, "the existing safety invariant, stated precisely."
5 (runtime semantics already correct?): YES, verified directly — §4.
6 (exact fix): §5 — `nzWrappedBarssince` + `nzSentinelSound`, gating two
existing call sites; nothing else touched.
7 (minimal-reduction results): §3, all passing, permanent.
8 (bounded/unbounded-history handling): §2's invariant statement; unbounded
cases (recency-breakout-hold-since-trigger, recency-fresh-golden-cross)
explicitly classified as capability gaps, not force-bounded.
9 (mutation/non-vacuity evidence): §8.
10 (four-script before/after): §6.
11 (raw 48-corpus before/after): 27/48 → 28/48 (§9).
12 (assisted 48-corpus before/after): 36/48 → 37/48 (§9).
13 (newly exposed downstream blockers): none.
14 (screener/execution-requirement effect): none — no execution-requirement
or lookback declaration was touched; the fix is translation-time-only and
produces a canonical AST node the runtime already handled correctly.
15 (test-suite results): `pine.blindCorpus.test.js` 16/16,
`pine.blindCorpusDecomposition.test.js` 31/31, full `ast/` directory 113
files / 2129 tests green, full app suite 14285 passed / 5 pre-existing
unrelated failures (confirmed via `git stash` compare, identical without this
tranche's changes) / 1 unrelated mock error.
16 (updated RISK-004 status): raw 28/48, assisted 37/48; see
`RISK_REGISTER.md`.
17 (commit hash): see the session's third RISK-004 commit (this addendum's
own commit).

## Recommendation for the next custom-indicator issue (not begun)

The remaining `ta.barssince` gaps (numeric window-argument use,
barssince-vs-barssince comparison) and the `ta.cci` generic-source kernel
question are now BOTH classified as genuine execution-model/kernel-capability
work, not narrow translator fixes — neither should be the next "small, bounded"
tranche by the same pattern as items A/B/barssince. The remaining LOW-RISK,
narrow-translator-shaped opportunities from the original ranking (§11 of the
main report) that have not yet been attempted are: `ta.valuewhen`'s two-layer
defect (arity fix is necessary but not sufficient — a role-order gap remains
even after correcting the arity, per `recency-macd-turn-recent`), and the
single-script, single-builtin gaps (`ta.falling`, `ta.kcw`, `ta.cmf`,
`ta.accdist`, `ta.obv`'s companion `ta.pvt`) — each a plain
UNSUPPORTED_BUILTIN with no disclosed ambiguity, better suited to a future
vendor-parity batch than a translator-fix tranche.

**This recommendation is not begun.**

---

# ADDENDUM 3 — RISK-004: `ta.valuewhen` TWO-LAYER DEFECT (2026-09-06, fourth tranche)

Authorized as a single bounded item following owner acceptance of the
`ta.barssince` remediation. **No code change. Zero corpus impact (still
28/48 raw, 37/48 assisted). This tranche's outcome is a CORRECTION of the
prior tranche's own characterization, plus a precise, permanent classification
of `ta.valuewhen` as a Layer-2 execution-model boundary — already correctly
refused, not a bug.**

## 1. Every script containing `ta.valuewhen`

Searched both corpora directly (`grep -rli valuewhen`): **zero** occurrences in
the 8-script public compatibility corpus. **Exactly three** in the 48-script
blind corpus — the same three the prior tranche already found, reconstructed
here in full without editing any fixture:

| Script | Exact construct | Occurrence | Condition | Source | Downstream use | Current refusal | Primary blocker | Known secondary | Raw | Assisted |
|---|---|---|---|---|---|---|---|---|---|---|
| `breakout-flat-base-pivot-breakout` | `baseHigh = ta.valuewhen(not na(pivotHi), high[pivRight], 0)` | 0 | `not na(pivotHi)` | `high[pivRight]` (an OFFSET expression, not a bare series) | `depthPct = (baseHigh − baseLow) / baseHigh * 100`, ANDed into the final plot | `pine:function`, `PINE_INEXPRESSIBLE.valuewhen` | `ta.valuewhen` | `nz(ta.barssince(...), 0) >= baseLen` — CONFIRMED UNSOUND (Addendum 2, §6) — stays refused even if valuewhen were somehow resolved | refused | refused |
| `recency-macd-turn-recent` | `crossLevel = ta.valuewhen(cross, macdLine, 0)` | 0 | `cross` (`ta.crossover(...)` boolean) | `macdLine` (bare series, from a tuple destructure) | `turnFromBelow = crossLevel < 0`, ANDed into the final plot | `pine:function`, `PINE_INEXPRESSIBLE.valuewhen` | `ta.valuewhen` | none found — `age = ta.barssince(cross)` in the SAME script already resolves fine (bounded via `age <= within`); this is the one script where `ta.valuewhen` is the SOLE blocker | refused | refused |
| `recency-breakout-hold-since-trigger` | `trigPrice = ta.valuewhen(trigger, close, 0)` and `trigVol = ta.valuewhen(trigger, volume, 0)` | 0 (both) | `trigger` (same condition, both calls) | `close` / `volume` (bare series) | `held = ... and heldLow > trigPrice * 0.97`, `volConfirm = trigVol > ta.sma(volume, 50)` | never reached — `age = ta.barssince(trigger)` throws first | `ta.barssince` (numeric window-argument use, CONFIRMED capability gap, Addendum 2 §6) | the two `ta.valuewhen` calls, downstream of the barssince blocker | refused | refused |

## 2. Real Pine `ta.valuewhen` semantics, precisely

`ta.valuewhen(condition, source, occurrence)`: walks BACKWARD from the current
bar counting TRUE occurrences of `condition`; `occurrence = 0` returns
`source`'s value at the MOST RECENT true bar, `occurrence = 1` at the SECOND
most recent, and so on — searching as far back as needed, UNBOUNDED in
general. `condition` never true ⇒ `na`. Repeated true conditions simply
advance which occurrence index each historical hit corresponds to. A long gap
between occurrences does not change the semantics — occurrence-counting, not
distance-counting, is what indexes the search. `source` is read independently
per occurrence (whatever it evaluated to AT that historical bar, which may
itself vary bar-to-bar for reasons unrelated to `condition`). Warm-up:
insufficient history before enough true occurrences have been seen yields
`na`, exactly mirroring `ta.barssince`'s own warm-up contract. **This is
TradingView's own documented behavior** (already cited verbatim in
`pine.js`'s `PINE_INEXPRESSIBLE.valuewhen` entry — no new vendor capture was
needed or performed this tranche; the semantic CONTRACT is not ambiguous, only
whether THIS engine can represent it is in question).

**This engine's `valuewhen(condition, source, period)`** (the table's own,
already-shipped, already-correct function — confirmed against its kernel,
`interpret.js::valueWhen`) computes something DIFFERENT BY DESIGN: the value
of `source` at the most recent bar, WITHIN THE LAST `period` bars, where
`condition` was true — a BOUNDED BAR-WINDOW search, not an occurrence count.
No occurrence beyond the most recent has any spelling in this function at
all. The two functions agree only in the degenerate case where the single
occurrence being sought happens to fall within whatever window is chosen —
they are otherwise different functions that happen to share three
similarly-typed positional arguments, which is exactly why a positional
Pine-to-table mapping would be a silent, confident wrong answer on most bars
(`PINE_INEXPRESSIBLE.valuewhen`'s own stated reasoning, already correct).

## 3. The two layers, traced precisely — and the prior tranche's correction

```
Pine source: ta.valuewhen(condition, source, occurrence)
  → parser — ordinary 3-arg call node
  → translator (pine.js, Resolver.resolveTableCall):
      base = 'valuewhen' (namespace stripped)
      PINE_CALL_SHAPES['valuewhen'] → none (no adapter entry exists)
      key = this.index.get('valuewhen') → TRUTHY (the table HAS `valuewhen`)
      pineName ('ta.valuewhen') !== base ('valuewhen') → TRUE
      → (pineName !== base || !key) && own(PINE_INEXPRESSIBLE, 'valuewhen')
        → TRUE && TRUE → FIRES, throws the REASONED PINE_INEXPRESSIBLE message
  → [translation stops here for every real Pine script — the canonical AST,
    kernels, and execution-requirement layers are never reached]
```

**LAYER 1 (translation/static-analysis), CURRENT BEHAVIOR**: `ta.valuewhen`
(the ONLY spelling any real Pine script writes) is refused at `pine:function`
with the CORRECT, vendor-cited, semantically-honest `PINE_INEXPRESSIBLE`
message. **EXPECTED BEHAVIOR**: identical — this is not a defect. **WHY
CURRENT CODE REFUSES**: because Pine's occurrence-count and this engine's
bar-window are genuinely different functions; mapping one onto the other
positionally would silently answer a different number on most bars. **WHAT
SAFETY RULE IT PROTECTS**: the same "no silent mistranslation of a
similarly-shaped-but-differently-meant construct" rule the mintick idiom and
the barssince window trade both already serve.

**THE PRIOR TRANCHE'S CHARACTERIZATION WAS WRONG, AND IT IS CORRECTED HERE.**
The earlier "two-layer defect" finding (`recency-macd-turn-recent: fixing
ta.valuewhen's ARITY alone is not enough — the correctly-arranged 3-arg call
still fails on role-order`) tested `valuewhen(cross, macdLine, within)` —
the **BARE, engine-vocabulary spelling**, i.e. the refusal's own suggested
rewrite retyped by hand — not `ta.valuewhen` itself. That IS a real, separate,
already-documented finding (§4 below), but it is NOT what any real Pine script
ever hits, and reporting it as `ta.valuewhen`'s own defect conflated two
different constructs the same way this program has repeatedly flagged and
corrected elsewhere (RISK-027/RISK-029, the writer-index counts, etc.). This
addendum's permanent tests pin BOTH refusals by name and by guard so this
cannot recur.

**LAYER 2 (runtime/execution-model)**: this engine's kernel
(`interpret.js::valueWhen`) is verified CORRECT for what it declares to
compute (a bounded bar-window search) — it was not touched, and no defect was
found in it. The GAP is that Pine's occurrence-count semantics have **no
finite, general representation** without either (a) an externally PROVEN
bound on how far back the occurrence can be, or (b) a genuinely new runtime
primitive for occurrence-indexed backward search. Neither exists. This is
identical in shape to `ta.barssince`'s own capability-gap cases from
Addendum 2 (numeric use, cross-comparison) — same conclusion, same
discipline: STOP, classify, do not force it.

## 4. Existing runtime capability — verified, and the SEPARATE bare-form finding

The runtime already computes `valuewhen(condition, source, period)` correctly
for the shape it declares (mirrors `barsSince`'s structure: `since`/`held`
tracked per bar, `held` captured at the moment `condition` fires, saturating
at `period`, `na` once the last hit leaves the window — read directly from
`interpret.js`, not re-derived by probing, since this function was not
touched and carries no new risk).

**A genuine, narrow, PRE-EXISTING (not introduced this tranche) defect WAS
found, and is reported without being fixed**: the refusal's own "TO UNBLOCK:
write `valuewhen(condition, source, n)`" advice does not itself work.
Confirmed two ways:
- **Positional bare form** (`valuewhen(cond, source, n)`): refuses at
  `pine:role-order` — a DIFFERENT, less-informative message than
  `ta.valuewhen`'s own.
- **Named-argument bare form** (`valuewhen(condition=cond, source=..,
  period=..)`): refuses at `pine:named-argument` — `"valuewhen has no
  measured parameter names at this door."`

**Root cause, confirmed by direct code reading**: `closedTable.json` declares
`argRoles: [condition, source, period]` for `valuewhen`, but `argRoles` is
consulted in exactly ONE place in the entire engine —
`interpret.js::assertArgRoles`, a DOWNSTREAM semantic-kind validator for the
formula LANGUAGE (catching e.g. a raw price series mistakenly used as a
0/1-shaped condition) — never by `pine.js`'s Pine-translation role-order
resolution. `valuewhen` has no `PINE_CALL_SHAPES` adapter entry (unlike
`cci`/`mfi`'s `sourceMustBe`), so the generic "seriesSlots > 1, no measured
order" refusal fires for the bare form instead.

**Not fixed, deliberately, this tranche**: this affects NO corpus script
(none writes the bare form) and is tangential to why `ta.valuewhen` blocks
the blind corpus — the actual objective. It is the SAME CATEGORY of finding
this program has already turned up and left unfixed elsewhere along the way
(the mintick refusal's own dangling "says more about why" sentence;
`ta.supertrend`'s truncated refusal message) — reported for the record,
consistent with that established discipline, not implemented as a tangent.

## 5. History / boundedness safety

No finite bound can be proven from LOCAL syntax alone for occurrence-based
search in general (`ta.barssince`'s comparison-bound trick has no valuewhen
analogue: valuewhen produces a VALUE, not a boolean, so there is no
`<cmp> K` on the valuewhen call itself to derive a window from). A
theoretically possible CROSS-EXPRESSION bound exists in principle — e.g.
`recency-macd-turn-recent` also computes `age = ta.barssince(cross)` bounded
by `age <= within`, and the SAME `cross` condition is what `ta.valuewhen`
searches — but exploiting that would require a NEW mechanism (recognizing
that a sibling `ta.barssince` call on the identical condition, bounded
elsewhere in the SAME formula tree, licenses a window for an UNRELATED
`ta.valuewhen` call) that does not exist anywhere in this codebase today.
This is judged out of scope: it is materially more complex than any
identity implemented so far (every existing one is a LOCAL rewrite of one
comparison or one binding, never a cross-reference between two independent
sub-expressions), it was not asked for as "the smallest fix," and getting a
NEW class of cross-expression reasoning wrong is a much larger risk surface
than the local, provable identities this program has restricted itself to.
**Classification: (C) correct refusal remains necessary** — not (A) a finite
bound proven from syntax, not (B) honest representation of an unbounded
requirement (there is no partial/honest execution-requirement encoding for
"unbounded occurrence search" in this architecture to fall back to; the
choice is compute-correctly-when-provably-bounded or refuse, and no bound is
provable). Chart execution and screener execution are NOT distinguished
here because the blocker occurs at TRANSLATION time, before either surface is
reached — the distinction this program has preserved elsewhere (e.g. for
lookback/budget accounting) does not arise for a construct that never
produces a canonical AST at all.

## 6. Occurrence parameter — supported and refused forms

Every form is REFUSED, uniformly, regardless of the occurrence value's shape,
because the blocker fires on the FUNCTION NAME (`ta.valuewhen`) before any
argument is inspected:

| Occurrence form | Result |
|---|---|
| Literal `0` (every real corpus use) | refused, `PINE_INEXPRESSIBLE.valuewhen` |
| Literal `1` (Pine's own documented example) | refused, same message (verified — §permanent tests) |
| Larger fixed literal | refused, same message (same code path — not independently re-verified per value, since the guard does not branch on the value at all) |
| Input-bound / dynamic expression | refused, same message |
| Negative or non-integer | refused, same message — never reaches any value-domain check, since the function name itself is the trigger |

No occurrence form is "more dangerous" than another here — the refusal is
total and name-keyed, so there is nothing to broaden or narrow per-value.
This is the safest possible posture: it cannot accidentally admit an unsafe
dynamic occurrence, because NO occurrence value of any kind is ever admitted.

## 7. Minimal safe fix

**None implemented.** No narrow, generalized, already-sound fix exists that
would change `ta.valuewhen`'s own (correct) refusal — the semantic mismatch is
total, not partial, so there is no "smallest fix" short of either the two
Layer-2 escalations explicitly not authorized (a new runtime primitive, or
whole-formula constraint propagation) or the tangential, non-corpus-moving
bare-form adapter fix explicitly declined in §4 for scope-discipline reasons.

## 8. Vendor evidence status

**TRANSLATION GAP CORRECTED — status of the CLAIM, not the code**: no
translation code changed, but the prior tranche's claim about WHERE the
defect lived is corrected here. **RUNTIME SEMANTICS INTERNALLY VERIFIED**:
`interpret.js::valueWhen` is confirmed correct for the shape it declares
(read directly, not newly captured). **No vendor-parity claim is made or
needed** — Pine's own documentation (already quoted in the shipped refusal
message) is sufficient to establish that the SEMANTIC MISMATCH is real; no
ambiguity requiring a browser capture was found. This tranche did not
recommend, request, or perform any vendor capture.

## 9. Mutation / non-vacuity evidence

Six permanent tests added, each targeting a distinguishable wrong
implementation:
- `ta.valuewhen(..., 0)` refuses with the OCCURRENCE/WINDOW-mismatch message,
  not any other guard — distinguishes "correctly refused for the right
  reason" from "refused for an unrelated reason" (the exact confusion the
  prior tranche fell into).
- The SAME assertion repeated at occurrence `1` — distinguishes "the refusal
  depends on the occurrence value" (wrong — it does not) from "the refusal is
  name-keyed and total" (right).
- The bare positional AND bare named-argument forms are BOTH asserted to fail,
  with their OWN, DIFFERENT guards (`pine:role-order` vs
  `pine:named-argument`) — distinguishes the two known dead ends from each
  other and from `ta.valuewhen`'s own refusal, so a future session cannot
  conflate any of the three the way this one's predecessor conflated two of
  them.
- All three real corpus scripts are exercised via minimal reconstructions
  (not fixture edits) and asserted to stay refused, each citing the
  OCCURRENCES/BAR-WINDOW message specifically (not just "refused") —
  distinguishes "refused for the documented semantic reason" from "refused
  for some other, undiagnosed reason."

## 10. Frozen 48-script corpus re-run

```
RAW BEFORE:       28 / 48
RAW AFTER:        28 / 48        (unchanged — no code change)

ASSISTED BEFORE:  37 / 48
ASSISTED AFTER:   37 / 48        (unchanged — no code change)
```

No script's per-script status changed. No script's PRIMARY or SECONDARY
blocker changed. The mintick offer path (Addendum 1) and the `ta.barssince`
nz-wrapped identity (Addendum 2) are unaffected — re-verified: both
describe blocks in `pine.blindCorpusDecomposition.test.js` are unchanged and
still fully green.

## 11–12. `ta.cci` and the unserved-builtin batch — kept parked, unchanged

Neither was touched. `meanrev-zscore-multi-oscillator-washout` remains
blocked on `ta.cci`'s role-order/source-arg kernel gap (Addendum 1, §10),
unaffected by this tranche.

## FINAL RETURN — items 1–21

1 (every script with valuewhen): §1 — 3 blind-corpus, 0 public-corpus.
2 (exact blockers per script): §1 table.
3 (Pine semantic contract): §2.
4 (Layer 1 root cause): §3 — `ta.valuewhen` correctly refuses via
`PINE_INEXPRESSIBLE`; the prior tranche's "role-order" finding was a
mischaracterization from testing the wrong (bare) spelling — corrected.
5 (Layer 2 root cause): §3 — occurrence-based unbounded backward search has
no finite representation without an unauthorized escalation.
6 (existing runtime capability): §4 — the bar-window kernel is already
correct and unchanged; a SEPARATE, narrow, non-corpus-moving bare-form
adapter gap was found and left unfixed (documented, not implemented).
7 (history/boundedness): §5 — classification (C), correct refusal remains
necessary; no finite bound provable from local syntax.
8 (supported/refused occurrence forms): §6 — every form refused uniformly,
name-keyed, nothing to broaden.
9 (exact narrow fix): NONE — §7.
10 (minimal-reduction results): §1's table + §9's permanent tests, all
passing.
11 (mutation/non-vacuity evidence): §9.
12 (vendor-evidence status): §8 — no vendor-parity claim made or needed; no
capture performed or requested.
13 (script before/after): §1 table — no script's status changed.
14 (RAW corpus before/after): 28/48 → 28/48 (§10).
15 (ASSISTED corpus before/after): 37/48 → 37/48 (§10).
16 (newly exposed downstream blockers): none — nothing changed.
17 (chart vs screener implications): none — the blocker is at translation
time, before either surface is reached; no distinction arises.
18 (test-suite results): `pine.blindCorpus.test.js` 16/16,
`pine.blindCorpusDecomposition.test.js` 36/36 (6 new valuewhen tests), full
`ast/` directory and full app suite unaffected (no source file changed;
re-run not separately repeated beyond the two blind-corpus files, since
`git status` confirms only the test file changed).
19 (updated RISK-004 status): unchanged from Addendum 2 — RAW 28/48, ASSISTED
37/48; `ta.valuewhen` reclassified from "two-layer defect, partially fixable"
to "correctly refused Layer-2 boundary, no fix authorized or warranted."
20 (commit hash): see the session's fourth RISK-004 commit (this addendum's
own commit).
21 (next issue, not begun): see below.

## Recommendation for the next custom-indicator issue (not begun)

With `ta.cci` (kernel-level), `ta.barssince`'s remaining two shapes
(capability gaps), and now `ta.valuewhen` (capability gap) all classified and
parked, the remaining LOW-RISK, narrow-translator-shaped opportunities from
the original ranking are down to the single-script, single-builtin gaps
(`ta.falling`, `ta.kcw`, `ta.cmf`, `ta.accdist`, `ta.pvt`) — each a plain
UNSUPPORTED_BUILTIN with no disclosed ambiguity — and are, per the owner's own
standing instruction, better suited to a future VENDOR-PARITY-BACKED batch
than a translator-fix tranche, not begun here.

**This recommendation is not begun.**

# ADDENDUM 4 — VENDOR-BACKED UNSERVED BUILTINS, BATCH 1 (2026-09-06, fifth tranche)

Executes the recommendation Addendum 3 left not-begun, exactly as scoped:
`ta.falling`, `ta.kcw`, `ta.cmf`, `ta.accdist`, `ta.pvt`. Each was resolved by
REAL TradingView vendor capture before any implementation, per the tranche's
own explicit instruction ("do not implement from documentation alone if
vendor behavior is observable").

## 1. Exact corpus demand, reconstructed per function

| Script | Exact Pine call | Also in public corpus? |
|---|---|---|
| `candles-doji-at-extension` | `directional = ta.rising(close, 3) or ta.falling(close, 3)` | No |
| `volatility-range-contraction-base` | `kw = ta.kcw(close, kcLen, 1.5)`; separately `ta.falling(ta.rma(tr, 10), 3)` | No |
| `volume-dollar-volume-money-flow` | `cmf21 = ta.cmf(21)`; separately `adLine = ta.accdist` | No |
| `volume-obv-accumulation-divergence` | `pvtRising = ta.pvt > ta.pvt[10]`; separately `obvLine = ta.obv` (bare LEVEL, unrelated permanent blocker) | No |

Confirmed by direct read of each `.pine` fixture (`tests/fixtures/pine_blind/`)
and by live translation of each script through the current engine, before and
after this tranche's changes — not inferred from memory. No other blind-corpus
or public-corpus script references any of these five names.

## 2. Current UCT capabilities read before vendor capture

- **`ta.falling`**: `interpret.js::windowRisingMonotone` (the vendor-verified
  `ta.rising` implementation) was the direct architectural template — same
  `rolling(series, n+1, fn)` shape, same NaN-anywhere-in-window convention.
  The open question was whether `falling` is truly the mirror (`<` for `>`)
  or carries its own ambiguity; the tranche's own instruction explicitly
  required proving symmetry rather than assuming it.
- **`ta.kcw`**: the existing `ta.kc` tuple builder
  (`PINE_TUPLE_BUILTINS.kc` in `pine.js`) already composes
  `basis=ta.ema(src,length)`, `span=useTrueRange?ta.tr:(high-low)`,
  `rangeEma=ta.ema(span,length)` for the Keltner tuple's upper/lower bands.
  `ta.kcw` needed the SAME basis/span/rangeEma but returns a SCALAR
  (`2*mult*rangeEma/basis`), so it could not reuse the tuple mechanism
  directly — it needed the separate `BUILTIN_CALL_TREE` scalar-expansion
  door (already used for `roc`/`mom`/`vwma`/`linreg`).
- **`ta.cmf`**: no existing capability question applied — read the live Pine
  Editor's own compile error and the full v5 reference manual text first
  (see §5 below); both independently say the function does not exist.
- **`ta.accdist`**: `_functions_excluded.obv`'s already-shipped ruling
  (cumulative from the first bar, no absolute seed, only a windowed DELTA is
  declarable) was the direct template. The open question was whether the
  blind-corpus script's actual need could be serviced by that same
  windowed-delta shape — read directly: `adTrend = adLine >
  ta.ema(adLine, 20)` is EMA-based, the exact shape `_functions_excluded.obv`
  already excludes (`ta.ema` is not admitted in the obv-vs-own-average
  rewrite because an exponential average weights every bar back to the
  first, leaving an infinite tail). So `ta.accdist`'s corpus need could not
  be serviced by any bounded-delta primitive even before vendor capture —
  confirmed by reading the script, not assumed.
- **`ta.pvt`**: the SAME `_functions_excluded.obv` template, but the corpus
  need (`ta.pvt > ta.pvt[10]`) is EXACTLY the `obv > obv[k]` shape
  `contextBoundedPlan` already rewrites — read as the highest-value target
  of the batch before any capture was taken.

## 3. Vendor capture safety

The established procedure (isolated/disposable layout, baseline check before
capture, stop-and-recover rather than force a broken state) was followed
throughout. One incident: the working layout entered a genuinely broken state
(Table View showing "ø" on every row, stale ticker header not updating on a
symbol change) — not merely cosmetic. Per protocol, a fresh layout was created
via "Create new layout…" rather than continuing to force the broken one;
recovery was confirmed (real candle rendering, real non-"ø" values) before
resuming. No other session's tab was touched; no broker-connection prompt was
interacted with.

**A genuine, disclosed environment limitation surfaced mid-capture**:
TradingView's Table View "Download data" CSV export — the raw-artifact
mechanism every prior vendor-parity tranche in this program relied on — was
attempted twice, with explicit user permission obtained first, and produced no
file anywhere on the filesystem (`Downloads/`, and a broader home-directory
search, both empty; no `blob:`/`download` anchor in the DOM). This reads as a
silent page-initiated-download block in this specific browser-automation
environment. Per the tranche's own instruction ("classify VENDOR CAPTURE
BLOCKED and do not invent semantics" if capture is untrustworthy), the
capture itself was NOT abandoned — the underlying live vendor VALUES were
fully trustworthy and directly observed — only the RAW-ARTIFACT PRESERVATION
mechanism needed a substitute. Full-resolution Table View screenshots
(captured via the `computer` tool's own screenshot action, never a
page-initiated download) were used instead, saved to
`tests/fixtures/vendor/raw_captures/2026-09-06-tv_cmf_adl_pvt_falling_kcw_capture_spy_screenshots/`.
This is disclosed as a LIMITATION, not hidden: it yields a smaller real
sample (15 real trading days visible per screenshot) than this program's
CSV-based multi-bar audits elsewhere (`ta.rising`'s own 297-row audit).

## 4. Vendor oracle design

One combined Pine v5 script (`uct-oracle-cmf-adl-pvt-falling-kcw-v1`, session-
reconstructed transcript preserved at
`tests/fixtures/vendor/raw_captures/.../uct-oracle-cmf-adl-pvt-falling-kcw-v1.pine`)
plotted, side by side, on real SPY daily bars:

- a synthetic 20-bar repeating pattern (deliberate zero-range bar at phase 10,
  zero-volume bar at phase 15) for controlled edge-case behavior on
  `falling`/`kcw`;
- the REAL SPY `close`/`high`/`low`/`volume` for `falling` (the synthetic
  pattern's rising base can never contain a genuine losing streak — a real
  discriminating series was required) and for `accdist`/`pvt`/`cmf` (these
  three are bare Pine builtins that always consume the chart's real OHLCV —
  they cannot be redirected to a custom/synthetic source, a design constraint
  discovered and corrected mid-session after an initial candidate-formula
  scale mismatch, see §7/§9 below).

Every candidate deliberately included a plausible WRONG alternative
(`falling`: running-minimum vs strict-monotone; `kcw`: ratio vs ×100 percent;
`accdist`/`pvt`: synthetic-sourced vs real-OHLCV-sourced) so the oracle could
not agree with every candidate at once.

## 5. `ta.falling` — RESOLVED, IMPLEMENTED

**Semantic ruling**: strict monotone DECREASE over `length+1` samples — the
structural mirror of the already-verified `ta.rising`, but PROVEN
independently rather than assumed. Real SPY close (2026-08-17..2026-09-04, 15
trading days) was probed because the batch's own synthetic rising-base
pattern can never contain a genuine 3-bar losing streak (non-discriminating
by construction). Result: the real `ta.falling(close,3)` builtin matches the
strict-monotone candidate on 15/15 real trading days and matches the
running-minimum candidate on only 14/15 — the one disagreement (2026-08-20)
is a genuine discriminating row (a real 3-bar losing streak that was NOT also
a new running low on the most recent bar), proving strict monotone rather
than merely being consistent with it.

**Implementation**: `interpret.js::windowFallingMonotone` /
`ast_interpret.py::_window_falling_monotone`, the exact structural mirror of
`windowRisingMonotone`/`_window_rising_monotone` with `<` in place of `>`.
Registered in both `FN`/`_FN` tables as `falling: (series, n) => rolling(series, n+1, windowFallingMonotone)`.
`closedTable.json`: `functions.falling` declared (mirrors `functions.rising`
exactly); the PRE-EXISTING `_functions_excluded.falling` entry (which
deferred entirely to `rising`'s then-unresolved ambiguity) REMOVED, replaced
by `_functions_vendor_parity_resolutions.falling_resolution`.

**Vendor artifact**: `tests/fixtures/vendor/observations/ta-falling-close3-2026-09-06.json`.

## 6. `ta.kcw` — RESOLVED, IMPLEMENTED

**Semantic ruling**: TradingView's own published `f_kcw` reference-manual
source, verbatim: `basis=ta.ema(src,length)`,
`span=useTrueRange?ta.tr:(high-low)`, `rangeEma=ta.ema(span,length)`,
`kcw=2*mult*rangeEma/basis` — a RATIO, never multiplied by 100 (the
plausible-but-wrong convention `ta.bbw`'s own vendor-resolved percent form
might suggest by false analogy — explicitly NOT inferred from `ta.bbw`, per
the tranche's own instruction). Verified against the real builtin: exact
match on all 15 real SPY trading days (max abs delta 0.0000 at 4 read
decimals); the ×100 candidate visibly disagrees with the real builtin on
every one of those 15 rows.

**Implementation**: `pine.js::BUILTIN_CALL_TREE.kcw` — a new scalar
AST-expansion entry (the same door `roc`/`mom`/`vwma`/`linreg` already use),
composing `ema`/`ta.tr`'s own existing expansion, costing the manifest zero
new declared vocabulary. `useTrueRange` must be a literal 1/0 to be read
statically (mirrors the `bare === 'tr'` convention already established); a
non-literal flag declines to the ordinary refusal rather than being guessed
at. Arity (3 or 4 args) is checked explicitly before the expansion runs.

**Vendor artifact**: `tests/fixtures/vendor/observations/ta-kcw-close20-2-2026-09-06.json`.

**Known, disclosed limitation**: `ta.kcw`'s formula needs a 20-bar EMA
warm-up, and this batch's raw artifact holds only 15 real trading days (the
CSV-download blockage in §3 prevented capturing the wider window prior
tranches used) — so this function's evidence is NOT independently
re-executable from a cold start in either kernel (a from-scratch 20-length
EMA over only 15 bars produces all-NaN). Its vendor-parity claim therefore
rests on DIRECT ARITHMETIC over the observation's own recorded values (both
`kcw_builtin` and `kcw_candRatio` were plotted live inside the SAME
TradingView session, with TradingView's own full historical warm-up, so
their agreement IS the vendor-parity evidence) rather than a from-scratch
re-execution — disclosed explicitly, not silently substituted.

## 7. `ta.cmf` — CONFIRMED NOT REAL PINE SYNTAX, NOT IMPLEMENTED

Two independent proofs, neither inferred: (1) `ta.cmf(21)` produces a live
compile error in TradingView's own Pine Editor — "Could not find function or
function reference 'ta.cmf'"; (2) the string `ta.cmf` is absent from the
full official Pine v5 reference manual page text
(`document.body.innerText.includes('ta.cmf')` → `false`). The blind-corpus
script's `cmf21 = ta.cmf(21)` is therefore a genuine script-author error —
analogous to this program's already-accepted precedent
(`multifactor-rsi-pullback-in-uptrend`'s "author's own bug"). **Ruling: this
should be classified as a CORRECT REFUSAL / not-real-Pine-syntax, never an
unsupported-but-real builtin.** No `_functions_excluded.cmf` entry was added
(that section is reserved for REAL Pine functions this engine declines to
support; an entry there would incorrectly imply `ta.cmf` is real). The
existing generic "unrecognized name" refusal — confirmed live, unchanged —
is already the CORRECT answer for this name; a regression test
(`pine.batch1VendorBacked.test.js`) pins that it stays a plain unrecognized-
name refusal, never a "ruled" one.

## 8. `ta.accdist` — vendor-verified formula, DELIBERATELY NOT IMPLEMENTED

**Semantic ruling**: TradingView publishes no formula of its own for
`ta.accdist`, but the adjacent `ta.iii` (Intraday Intensity Index) publishes
`f_iii() => ((2*close-high-low)/(high-low))*volume` — algebraically identical
to the standard money-flow-multiplier-times-volume per-bar contribution
(corroborating, not definitive, since it is a DIFFERENT function's published
formula). That per-bar formula was VERIFIED against the real builtin via a
5-bar windowed delta (mirroring the `obvN` pattern): exact match on all 15
real SPY trading days (max abs delta 0.00 at 2 read decimals) —
STEADY-STATE agreement; INITIALIZATION AGREEMENT is explicitly NOT claimed
(the true absolute origin of `ta.accdist`'s cumulative level, at the first
bar SPY ever traded, cannot be observed from a 15-row window decades later),
per the tranche's own explicit instruction to separate the two.

**Implementation decision: NONE, deliberately.** Unlike `ta.pvt`, no
`accdistN(k)` bounded-delta primitive was declared, because the one
blind-corpus script needing `ta.accdist` (`volume-dollar-volume-money-flow`)
computes `adTrend = adLine > ta.ema(adLine, 20)` — EMA-based, not a
fixed-offset window — the exact shape `_functions_excluded.obv`'s own ruling
already excludes (an exponential average weights every bar back to the
first, so the seed-cancellation identity that makes `obvN`/`pvtN` declarable
does not hold for an EMA comparison). Declaring `accdistN(k)` would cost the
manifest new surface area (a new table entry, new tests, new dual-kernel
conformance) and unlock ZERO blind-corpus scripts — a function-specific
speculative expansion the tranche's own instruction explicitly refuses
("No function-specific hacks for one corpus fixture"). `closedTable.json`'s
new `_functions_excluded.accdist` entry states this reasoning and cites the
vendor evidence supporting the per-bar formula claim, while explicitly not
foreclosing a future `accdistN` the moment a real script needs a fixed-offset
`ta.accdist` comparison.

**Vendor artifact**: `tests/fixtures/vendor/observations/ta-accdist-delta5-2026-09-06.json`
(`engine.ast: null`, `engine.formula: null` — explicitly not independently
translatable to anything, since nothing was implemented; the observation
exists only to record the vendor evidence behind the ruling's own citation).

## 9. `ta.pvt` — RESOLVED, IMPLEMENTED (highest-value target of the batch)

**Semantic ruling**: TradingView's own published reference-manual EXAMPLE
source, verbatim: `f_pvt() => ta.cum((ta.change(close) / close[1]) * volume)`.
Verified via a 5-bar windowed delta against the real builtin: exact match on
all 15 real SPY trading days — STEADY-STATE agreement; INITIALIZATION
AGREEMENT (the true first-valid-bar / prior-close-at-inception behavior) is
explicitly NOT claimed, for the identical reason `ta.accdist`'s ruling states
— though it cannot affect any answer this engine emits either way, since the
unknown seed cancels in the windowed difference regardless of what it
actually was.

**Implementation**: `interpret.js::barPvtN` / `ast_interpret.py::_fn_pvtn`,
the exact structural mirror of `barObvN`/`_fn_obvn`. `indicators.js::computePVT`
/ `indicator_compute.py::compute_pvt_raw` (+ `compute_pvt` delivery wrapper)
added, mirroring `computeOBV`/`compute_obv_raw` exactly (same zero-seed
convention — irrelevant to any exposed answer, since only the windowed delta
is ever emitted). `pine.js`: `isBarePvt` added (mirrors `isBareObv`);
`contextBoundedPlan` extended to recognize `ta.pvt <cmp> ta.pvt[k]` /
`ta.pvt - ta.pvt[k]` alongside its existing `obv` branch, rewriting to a new
`pvtN(k)` call exactly as the `obv` branch rewrites to `obvN(k)`.
`closedTable.json`: `functions.pvtN` declared (mirrors `functions.obvN`);
new `_functions_excluded.pvt` entry states the bare-LEVEL ruling (same
reasoning as `obv`'s) while disclosing the bounded-delta escape hatch, per
the same `⛔ THE UNBOUNDED NAME IS STILL REFUSED` convention `obv`'s own
entry carries.

**This is the batch's highest-value target**: it directly unlocks the
blind-corpus script `volume-obv-accumulation-divergence`'s literal
`pvtRising = ta.pvt > ta.pvt[10]` construct — confirmed translating to
`pvtN(10) > 0` and exact-matched against the real vendor value on all 10 real
trading days past its 5-bar warmup (see §14 for the full result; the script
itself still misses overall, for the independent, permanent, unrelated
reason given in §15).

**Vendor artifact**: `tests/fixtures/vendor/observations/ta-pvt-delta5-2026-09-06.json`.

## 10. Implementation-rule adherence

Every implemented function (`falling`, `kcw`, `pvtN`) composes cleanly from
already-declared primitives or an already-established architectural pattern
(`obvN`'s bounded-delta rewrite) — no new execution model, no unbounded
history support, no arbitrary recursion, no AST redesign, no broad
data-pipeline change. `ta.cmf` and `ta.accdist` were each STOPPED rather than
implemented, per §7/§8's own reasoning, exactly per the rule's own text
("If existing architecture supports it cleanly: implement narrowly... If
implementation requires [any of five listed things]: STOP that function and
classify it").

## 11. Data requirement contract

`falling`/`kcw` operate on already-declared series (`close`,
`high`/`low`/`tr`) — no new data requirement. `pvtN` (like `obvN` before it)
reads bars directly (`reads: "bars"`, close-and-volume by definition) — the
SAME data requirement `obvN` already declares and both chart and screener
execution already satisfy identically, since it shares the exact `BAR_FN`
registration mechanism. No new execution-requirement expression was needed;
nothing here required stopping to report a gap in that system.

## 12. JS/Python conformance (kept separate from vendor parity)

`falling` and `pvtN`: full dual-kernel conformance via the existing
`tools/ast_conformance.py` harness (`run_js`/`run_py`/`compare_lanes`),
asserted in `tests/test_vendor_parity_batch1.py::test_dual_kernel_conformance_js_vs_python`
— zero differences over every bar of the 15-bar real capture, for both
functions. `kcw`: covered structurally instead — `BUILTIN_CALL_TREE` is a
JS-only, Pine-translation-time AST rewrite (the SAME mechanism `roc`/`mom`/
`linreg`/`vwma` already use, none of which carry separate Python-lane
"conformance" either, since the REWRITE happens entirely in the JS
translator before either kernel executes anything) — the resulting canonical
tree (`ema`/`op` nodes only) is executed identically by both kernels because
`ema` itself already has full dual-kernel conformance. This is stated
explicitly as a DIFFERENT claim from vendor parity, per the tranche's own
instruction ("JS == Python does NOT prove TradingView parity").

## 13. Vendor comparison — row counts, deltas, warm-up

| Function | Vendor rows held | Warm-up (this engine) | Rows compared | Max abs delta | Max rel delta | Mismatches |
|---|---|---|---|---|---|---|
| `falling` | 15 | 3 bars | 12 | 0 | 0 | 0/12 |
| `kcw` | 15 | n/a (direct arithmetic, not re-executed — §6) | 15 | 0.0000 (4 decimals) | 0 | 0/15 |
| `pvtN(5)` | 15 | 5 bars | 10 | ~25 (on deltas of magnitude 10⁴–10⁵; volume-rounding artifact, §3/§9) | ~5e-5 (0.005%) | 0/10 at rel-tol 1e-3 |

No row was silently skipped: every real vendor row held in each observation
is accounted for above as either compared (with its result) or excluded by a
named, disclosed warm-up boundary. Qualified status for each (see §5/§6/§8/§9
above for the full reasoning): `falling` → VENDOR-PARITY VERIFIED — LIMITED
SAMPLE; `kcw` → VENDOR-PARITY VERIFIED — LIMITED SAMPLE; `pvtN` →
VENDOR-PARITY VERIFIED — STEADY-STATE, LIMITED SAMPLE; `accdist`'s per-bar
formula → VENDOR-PARITY VERIFIED — STEADY-STATE, LIMITED SAMPLE (formula
only, not implemented); `cmf` → not applicable (not real Pine).

## 14. Mutation / non-vacuity evidence

Each proves the vendor oracle actually discriminates, using the real capture
itself wherever possible (no synthetic substitute where the real data
already supplies the discriminator):

- **`falling`**: the real vendor's own recorded `falling_real_candRunningMin`
  column (running-minimum, the plausible wrong reading) genuinely disagrees
  with the real builtin at 2026-08-20 while `falling_real_candMonotone`
  (strict monotone, the shipped reading) agrees at every row — pinned as a
  permanent regression in both
  `pine.batch1VendorBacked.test.js`
  and `tests/test_vendor_parity_batch1.py::test_MUTATION_falling_running_minimum_disagrees_with_the_real_capture`.
- **`kcw`**: the real vendor's own recorded `kcw_candPercent` column (×100,
  the plausible wrong reading) visibly disagrees with the real builtin
  (>1.0 absolute, against a value ~0.15–0.19) on all 15 real rows, while
  `kcw_candRatio` (the shipped reading) agrees exactly — pinned in
  `tests/test_vendor_parity_batch1.py::test_MUTATION_kcw_percent_form_disagrees_with_the_ratio_on_every_real_row`.
- **`pvtN`**: a hand-rolled wrong-previous-close candidate (dividing by THIS
  bar's close instead of the PRIOR bar's — a plausible off-by-one) was
  computed independently in BOTH the JS
  (`pine.batch1VendorBacked.test.js`) and Python
  (`tests/test_vendor_parity_batch1.py::test_MUTATION_pvt_wrong_previous_close_disagrees`)
  permanent test suites; both confirm at least one real disagreement against
  the real captured value while the correct implementation agrees at every
  computable row.
- **`accdist`**: no mutation test — nothing was implemented to mutate (§8).

## 15. Frozen 48-script corpus re-run

```
RAW BEFORE:       28 / 48
RAW AFTER:        29 / 48        (+1: candles-doji-at-extension, ta.falling alone)

ASSISTED BEFORE:  37 / 48
ASSISTED AFTER:   38 / 48        (+1, same script — no offer needed, a RAW gain)
```

**Exactly one script recovered, fully, RAW, needing no offer**:
`candles-doji-at-extension` — its only unserved name was `ta.falling`, now
served.

**Two scripts partially advanced but remain misses, each for a genuine,
independent, newly-confirmed secondary blocker** (not "a script recovered
merely because it advanced one stage" — neither fully passes):

- `volatility-range-contraction-base` — BOTH `ta.kcw` (its first-reported
  blocker) and `ta.falling` (its second) now translate. The script's ONLY
  remaining real blocker, confirmed by direct translation of the live
  fixture, is `ta.tr(true)` — a pre-existing, deliberate, unrelated
  parameter-fidelity refusal ("this engine leaves that bar not-computable
  rather than inventing it"), untouched by this tranche. **A mid-session
  assumption that `request.security` was this script's remaining blocker
  was checked against the real engine output before being written down, and
  was wrong — `request.security(syminfo.tickerid, "W", ta.atr(10))` was
  ALWAYS clean, confirmed by direct translation, both before and after this
  correction.**
- `volume-obv-accumulation-divergence` — `ta.pvt`'s windowed-delta rewrite
  now translates (`pvtN(10) > 0`, confirmed exact-matched against real
  vendor data, §9/§13). The real fixture's SAME boolean expression ALSO
  reads `ta.obv`'s bare LEVEL (`obvLine = ta.obv`, feeding
  `obvNewHigh`/`obvLine > obvSig`), which stays permanently refused for the
  reason `_functions_excluded.obv` states — confirmed as a genuine,
  independent second blocker (both together still refuse; `ta.obv` alone
  refuses; `ta.pvt`'s rewrite alone translates), not a partial
  implementation of this tranche's own scope.

`volume-dollar-volume-money-flow` (needs both `ta.cmf` and `ta.accdist`,
neither implemented per §7/§8) correctly remains a miss, as expected.

Every downstream self-consistency rail this addition touched was updated in
the same commit as the implementation, never left red: `parse.test.js`'s
manifest-size counts, `sentence.test.js`'s totality counts and grammar
round-trip rules, `pine.derived.test.js`'s TA_VETTED roster,
`pine.blindCorpus.test.js`'s FLOOR/ACCEPT_FLOOR and probe rosters,
`pine.blindCorpusDecomposition.test.js`'s now-stale secondary-blocker
assertions (rewritten to state the current, re-verified truth, not silently
left describing a state that no longer holds), and
`tests/fixtures/ast/corpus.json`'s permanent conformance coverage (two new
cases, `conformance_log.json` re-recorded and independently verified to move
ZERO existing digests: `0 MOVED [], 6 added, 0 removed` — the tool's own
printed non-vacuity proof, confirming this batch changed no PREVIOUSLY-shipped
function's behavior).

## 16. `ta.cci`, `ta.valuewhen`, broader `ta.barssince`, and every other §16
parked item — kept parked, unchanged

None touched. `meanrev-zscore-multi-oscillator-washout` remains blocked on
`ta.cci`'s kernel-level gap; the three remaining `ta.valuewhen`/`ta.barssince`
capability-gap misses are unaffected; no tuple support, undefined-symbol
recovery, new Track F input type, new assisted-edit offer,
generalized recursive/stateful Pine support, BuilderSheet visual expansion,
or pattern-engine work was begun.

## 17. Documentation

This addendum; `RISK_REGISTER.md`'s new RISK-041 row; `closedTable.json`'s
`functions`/`_functions_excluded`/`_functions_vendor_parity_resolutions`
sections (§5/§6/§8/§9 above); `docs/formulas/GRAMMAR.md` regenerated
(`FORMULA_DOCS_WRITE=1 npx vitest run …/formulaDocs.test.js`). Historical
status changes preserved throughout — `_functions_excluded.falling` was
REMOVED (superseded by resolution, not silently rewritten as though the
prior refusal never existed — its text is preserved verbatim in this repo's
git history), and every other pre-existing entry this addendum's changes sit
beside (`obv`, `rising`'s own resolution, etc.) is quoted or cited, never
restated as a second, potentially-drifting copy.

## FINAL RETURN — items 1–20

1 (exact corpus demand, all five functions): §1.
2 (vendor semantic ruling, all five): §5–§9.
3 (raw artifact path, all five): §3 (the screenshot directory), plus each
function's own observation JSON's `provenance.rawArtifact` field (§5/§6/§8/§9).
4 (implementation path, all five): §5/§6/§9 (`falling`/`kcw`/`pvtN`); §7/§8
state why `cmf`/`accdist` have none.
5 (any function stopped, and why): `ta.cmf` (§7, not real Pine syntax) and
`ta.accdist` (§8, corpus need is EMA-based, unservable by any bounded-delta
primitive, would cost new surface area for zero unlock).
6 (JS/Python conformance results): §12.
7 (vendor comparison row counts/deltas): §13.
8 (warm-up findings): §13 (per-function warm-up column); §5/§9 (falling 3
bars, pvtN 5 bars); §6 (kcw's own warm-up cannot be satisfied by this
batch's 15-bar sample — disclosed, not silently worked around).
9 (initialization findings): §8/§9 — STEADY-STATE claimed for both
`accdist`'s formula and `pvtN`; INITIALIZATION explicitly NOT claimed for
either, per the tranche's own instruction to separate the two when the true
historical origin cannot be observed.
10 (zero-range/zero-volume/NA boundaries): the oracle script's synthetic
pattern deliberately included a zero-range bar (phase 10) and a zero-volume
bar (phase 15); `kcw` was confirmed to NOT zero out from one zero-range bar
inside its 20-bar EMA window (expected — EMA-smoothed, not a raw per-bar
formula); the accdist/pvt per-bar formulas' zero-high-low-range guard
(`(high-low)!=0 ? ... : 0.0`) and pvt's zero-previous-close guard are both
DEFENSIVE, UNVERIFIED boundaries (never observed on real SPY data), disclosed
as such in `indicators.js`/`indicator_compute.py`'s own comments — not
claimed as vendor-verified.
11 (mutation/non-vacuity evidence): §14.
12 (final qualified parity status, all five): §13's table.
13 (48-script RAW before/after): §15 — 28/48 → 29/48.
14 (48-script ASSISTED before/after): §15 — 37/48 → 38/48.
15 (exact scripts recovered): §15 — `candles-doji-at-extension` (fully, RAW,
no offer needed).
16 (newly exposed secondary blockers): §15 —
`volatility-range-contraction-base`'s real remaining blocker is `ta.tr(true)`
(pre-existing, unrelated); `volume-obv-accumulation-divergence`'s is
`ta.obv`'s bare LEVEL (pre-existing, unrelated, permanent).
17 (test-suite results): `pine.batch1VendorBacked.test.js` 18/18;
`tests/test_vendor_parity_batch1.py` 8/8; `pine.blindCorpus.test.js` 16/16;
`pine.blindCorpusDecomposition.test.js` full suite green after the rewrite
in §15; the full `app/src/components/chart/engine/ast/` vitest directory
(114 files / 2,156 tests) green; the full repo-wide `app/` vitest run
(996/1,001 other files green — 3 PRE-EXISTING, unrelated failures found and
explicitly NOT touched, confirmed via `git status`/`git log` showing zero
modification by this tranche to any implicated file:
`flipCRecord.test.js`'s frozen `tools/chart_parity_cases.json` case count,
`ImportBox.thinkscript.test.jsx`'s paste-field debounce assertion,
`StockChart.smoke.test.jsx`'s `lightweight-charts` mock missing `LineType`);
targeted Python backend sweep (`test_ast_interpret`, `test_ast_conformance`,
`test_ast_bounded_state`, `test_ast_lint`, `test_ast_arg_domain`,
`test_ast_arg_roles`, `test_closed_table_citations`,
`test_vendor_parity_batch1`, `test_vendor_parity_lane_b*`) all green.
18 (updated RISK-004 status): RAW 29/48, ASSISTED 38/48 (§15); RISK_REGISTER
RISK-041 row added.
19 (commits pushed): see this tranche's own commit(s) on
`worktree-indicator-ecosystem`.
20 (recommendation for the next custom-indicator issue only): see below.

## Recommendation for the next custom-indicator issue (not begun)

With `ta.falling`/`ta.kcw`/`ta.pvt` now vendor-verified and shipped, and
`ta.cmf`/`ta.accdist` correctly classified and parked, the remaining misses
in the 48-script corpus are: `ta.valuewhen` (×2, capability gap, already
classified — Addendum 3), `syminfo.mintick` misses that are not actually
mintick-blocked (already-reconciled in earlier addenda), `ta.cci` (kernel-
level, already classified — Addendum 1), `ta.supertrend` (structurally
inexpressible, already classified), `ta.tr(true)` (deliberate parameter-
fidelity refusal, newly re-confirmed in this tranche as
`volatility-range-contraction-base`'s sole remaining blocker — §15), and
`ta.obv`'s bare LEVEL (permanently excluded, newly re-confirmed in this
tranche as `volume-obv-accumulation-divergence`'s sole remaining blocker —
§15). Every remaining miss is now either a previously-classified capability
gap or a DELIBERATE, already-ruled-on refusal — there is no further
plain-UNSUPPORTED_BUILTIN, no-disclosed-ambiguity opportunity left in this
corpus of the shape this batch and its three predecessors have been closing.
A genuinely new tranche would need to either (a) revisit one of the
already-ruled-on deliberate refusals (`ta.tr(true)`, `ta.obv`'s LEVEL,
`ta.cci`'s kernel gap, `ta.supertrend`) with new evidence or a new owner
decision, or (b) look outside this specific 48-script corpus entirely for
the next candidate functions.

**This recommendation is not begun.**

# ADDENDUM 5 — EVIDENCE RECONCILIATION (2026-09-07, no implementation)

Owner-directed reconciliation of Addendum 4's own reporting. Nothing in
`pine.js`/`interpret.js`/`ast_interpret.py`/`indicators.js`/`indicator_compute.py`
changed. One real gap this reconciliation found and fixed:
`sentence.test.js`'s "inversion rail" corpus-ID-list assertion (a FOURTH,
separate hardcoded list Addendum 4's own commit needed to update and missed —
see §1). Two test/doc-only precision corrections. One genuinely new,
UNRELATED, out-of-scope finding surfaced while verifying blocker precision
for the remaining frontier (§9) and is disclosed, not investigated further.

## 1. Exact test-suite reconciliation

Addendum 4's own claim ("996/1,001 other files green, 3 pre-existing
failures") was WRONG on both the total and the failure count — it was read
off a truncated `tail -80` of a 292-second background run, not the complete
output. Re-run in full, output captured to a file and read completely:

```
Test Files  6 failed | 995 passed | 1 skipped (1002)
     Tests  6 failed | 14311 passed | 9 skipped (14326)
    Errors  1 error
   Start at 05:41:44
   Duration 292.01s
process exit code: (vitest run's own nonzero exit on failed tests — the run
was piped through `tail`, so the shell's own exit code was not separately
captured; the `Test Files … 6 failed` line above is the authoritative result)
```

No todo files. **996/1,001 does not, and never did, coexist with "3
pre-existing failures" — that was two separate reporting errors compounding**:
the total should have read 1,002 (1,001 dropped the 1 skipped file), and the
failure count should have read 6, not 3 (the truncated tail only showed the
last 3 of 6 failure blocks).

**The 6 failed files, individually reconciled:**

| File | Cause | Status |
|---|---|---|
| `src/hooks/pollingSites.rail.test.js` | a new bare `useSWR` site in `app/src/floor2/hooks/useFloor.js` | PRE-EXISTING, confirmed via `git log` — `floor2/` last touched 2026-09-03, untouched by this batch |
| `src/components/screener/reachable.test.js` | 16 unreachable `app/src/floor2/`/`app/src/pages/community/` modules | PRE-EXISTING, confirmed via `git log` — `community/` last touched 2026-09-01, untouched by this batch |
| `src/components/chart/builder/BuilderSheet.pine.test.jsx` | `TypeError` on `sent.id` in a save-flow test | PRE-EXISTING, confirmed via `git log` — file last touched 2026-08-30, untouched by this batch |
| `src/components/chart/builder/ImportBox.thinkscript.test.jsx` | CRLF/LF mismatch in a paste-field debounce assertion | PRE-EXISTING, confirmed via `git log` — file last touched 2026-09-04, untouched by this batch |
| `src/components/chart/engine/ast/sentence.test.js` | `CORPUS.cases.map(id)` hardcoded ID list (a FOURTH, separate assertion from the three already fixed in the original commit) did not include `falling_close_3`/`pvtN_bounded_price_volume_trend_change` | **CAUSED BY THIS BATCH, MISSED IN THE ORIGINAL COMMIT. FIXED in this reconciliation** (see below) |
| `src/components/chart/engine/__tests__/flipCRecord.test.js` | frozen `tools/chart_parity_cases.json` case count (52 vs. actual 53) | PRE-EXISTING, confirmed via `git log` — `chart_parity_cases.json` last touched 2026-09-05, a day before this batch began, unrelated |

Plus 1 unhandled error (`StockChart.smoke.test.jsx`'s `lightweight-charts`
mock missing a `LineType` export) — PRE-EXISTING, confirmed via `git log`
(`StockChart.jsx` last touched 2026-09-04), unrelated.

**The fix**: `sentence.test.js`'s "the corpus is the subject, and its case
LIST is the floor" test (a SEPARATE hardcoded ID list from the "totality over
the closed table" describe block's three assertions, which WERE correctly
updated in the original commit) needed `falling_close_3` and
`pvtN_bounded_price_volume_trend_change` appended. Fixed; re-verified: full
`app/src/components/chart/engine/ast/` sweep now **114/114 files, 2,156/2,156
tests, 0 failures**. The other 5 files' failures remain, confirmed
pre-existing and unrelated — not touched, per this reconciliation's own
"do not alter product code merely to make the accounting cleaner" instruction
(none of them are product code, and none are this batch's to fix).

## 2. Corrected status, each of the five batch functions

**`ta.falling`** — an actual UCT-served capability (`closedTable.json::functions.falling`,
callable as `ta.falling(source, period)` for any source/period, exactly as
general as `ta.rising`). Real vendor evidence, LIMITED SAMPLE (15 real SPY
trading days; 12 computable past its own 3-bar warmup). No warm-up/
initialization caveat needed — `falling`'s window is bounded by construction
(`length+1` samples), so there is no seed-convergence question the way a
recursive smoother has one.

**`ta.kcw`** — an actual UCT-served capability
(`pine.js::BUILTIN_CALL_TREE.kcw`, callable as `ta.kcw(src, length, mult[,
useTrueRange])` for any arguments, general — not scoped to the captured
`length=20`). Vendor evidence is STEADY-STATE, LIMITED SAMPLE, with the
warm-up/initialization boundary explicitly NOT observed in this capture — see
§5 for the full, separated derivation.

**`ta.cmf`** — NOT a valid builtin under the Pine v5 contract this program
targets (`//@version=5`/`//@version=6` throughout the 48-script corpus and
this program's own capture packets). Two independent proofs: (1) a live
compile error in TradingView's own Pine Editor pasting `ta.cmf(21)` —
"Could not find function or function reference 'ta.cmf'"; (2) the string
`ta.cmf` is absent from the FULL text of the official Pine v5 reference
manual page (`document.body.innerText.includes('ta.cmf')` → `false`,
checked against the live page, not a cached/partial copy). **Reclassified
here in the terms this reconciliation asked for: SCRIPT-AUTHOR / SOURCE
INVALIDITY, not "UCT unsupported."** `_functions_excluded` (the section
reserved for real Pine functions UCT declines to support) correctly holds no
`cmf` entry; the plain "unrecognized name" refusal that already fires is the
CORRECT answer for an invalid name, not a narrower classification of an
otherwise-real builtin.

**`ta.accdist`** — a vendor formula/semantic OBSERVATION ONLY
(`tests/fixtures/vendor/observations/ta-accdist-delta5-2026-09-06.json`,
`engine.ast: null`, `engine.formula: null`). **NOT an implemented general
UCT surface. NOT a recovered corpus capability** — `volume-dollar-volume-money-flow`
still misses, unaffected. `closedTable.json` gained a new
`_functions_excluded.accdist` REFUSAL entry (citing the vendor evidence for
its own reasoning) — a documentation/ruling artifact, not a served surface.
The cumulative-LEVEL requirement (`ta.accdist` bare) remains, and is stated
to remain, permanently unsupported for the same reason `ta.obv`'s LEVEL is.

**`ta.pvt` / `pvtN`** — **explicitly NOT unrestricted `ta.pvt` support.**
The served, bounded, derived contract is precisely this identity:
`ta.pvt <cmp> ta.pvt[k]` and `ta.pvt - ta.pvt[k]` (for a literal integer
`k >= 1`) rewrite to `pvtN(k) <cmp> 0` / `pvtN(k)` — a WINDOWED-DELTA
transformation over `k` bars, whose value is exactly `pvt[now] - pvt[now-k]`,
computed from the shipped `computePVT`/`compute_pvt_raw` accumulator so the
transformation can never disagree with the level a member would compute by
hand. This is the SAME scoping `ta.obv`'s already-shipped `obvN` carries — a
bare `ta.pvt` (used as a value, compared to anything other than its own
offset self, or read outside this exact comparison shape) **remains
refused**, confirmed still true: `translatePine('plot(ta.pvt)')`,
`translatePine('plot(ta.pvt > close)')`, and
`translatePine('plot(ta.pvt > close[1])')` all still refuse with
`pine:function` and the `_functions_excluded.pvt` ruling text, re-verified
live in this reconciliation.

Every progress/risk/coverage doc this batch touched is corrected below (§12)
to carry this exact language rather than a generic "vendor-parity verified"
that does not distinguish these five cases.

## 3. Served-surface / manifest audit

**No count was inflated by counting semantic research as product support** —
`ta.accdist`'s observation and `ta.cmf`'s absence both correctly added zero
manifest surfaces, and Addendum 4's own text already said so. **One real
miscount WAS found and is corrected here**: Addendum 4's
`VALIDATION_COVERAGE_MAP.md` note said "15 of ~70 manifest functions now
real-vendor-comparable... falling/kcw/pvtN are the 13th/14th/15th" — this
incorrectly counted `ta.kcw` as a MANIFEST FUNCTION. It is not: `kcw` has no
`closedTable.json::functions.kcw` entry at all — it is a
`pine.js::BUILTIN_CALL_TREE` scalar AST-rewrite (the same mechanism
`roc`/`mom`/`vwma`/`linreg`/`tr`/`avg`/`iff`/`cross` already use, NONE of
which have ever been counted in the "manifest functions" total either). The
correct count of NEW vendor-comparable MANIFEST functions from this batch is
**2** (`falling`, `pvtN`), not 3 — fixed in `VALIDATION_COVERAGE_MAP.md`
(§12).

**BEFORE / AFTER, measured directly, not estimated:**

| Surface class | Before | After | Delta | New members |
|---|---|---|---|---|
| `closedTable.json::functions` (manifest functions) | 68 | 70 | +2 | `falling`, `pvtN` |
| `pine.js::BUILTIN_CALL_TREE` (scalar AST-rewrite surfaces) | 8 | 9 | +1 | `kcw` |
| `closedTable.json::_functions_excluded` (ruled-refusal entries) | 17 | 18 | +1 net | `-falling` (superseded by resolution), `+pvt`, `+accdist` |
| Total declared names (`bar_names ∪ scalar_names`) | 238 | 240 | +2 | (tracks the manifest-functions delta; `kcw` rides no new declared name, same as every other `BUILTIN_CALL_TREE` entry) |

**Exactly THREE new user-facing surfaces this tranche legitimately added**,
none double-counted, none research-only:
1. `ta.falling(source, period)` — unrestricted, general.
2. `ta.kcw(src, length, mult[, useTrueRange])` — unrestricted, general.
3. `ta.pvt <cmp> ta.pvt[k]` / `ta.pvt - ta.pvt[k]` — SCOPED to that exact
   comparison shape; bare `ta.pvt` is not served.

`ta.cmf` and `ta.accdist` added zero surfaces, correctly.

## 4. `ta.kcw` evidence qualification

**FORMULA IDENTITY: PROVEN**, and this claim does NOT depend on the 15-row
sample size at all. `kcw_builtin` (the real `ta.kcw` builtin) and
`kcw_candRatio` (TradingView's own published `f_kcw` formula, built from
`ta.ema`/`ta.tr`) were BOTH plotted by the SAME live Pine script instance,
inside the SAME TradingView session, reading TradingView's OWN real
`high`/`low`/`close` — a same-engine, same-session, formula-vs-formula
comparison. Their exact agreement on every visible row is evidence about the
FORMULA, independent of how many rows happened to be captured.

**STEADY-STATE VENDOR AGREEMENT: VERIFIED.** The real `ta.kcw` builtin, on
each of the 15 captured dates, is NOT itself a cold-started value — the chart
was a REAL SPY daily chart (not a fresh/history-limited disposable layout;
the disposable-layout capture-safety procedure used earlier in this program
for Stoch/ADX affects how far a member has manually scrolled, not how much
real historical data feeds a symbol's own indicator computation), so
TradingView's own `ta.ema(close,20)`/`ta.ema(span,20)` had already run over
SPY's real historical bar count — thousands of bars, not 15 — by the time any
of the 15 captured dates was reached. The 15-row LIMIT is a limit on what
THIS SESSION preserved as raw artifact, not a limit on how warmed-up the real
vendor value itself was.

**WARM-UP AGREEMENT: UNVERIFIED**, and this is the genuine gap. This
reconciliation did NOT observe TradingView's own EARLY `ta.kcw` bars (the
first ~20 bars of its real history, wherever that is) — so there is no
direct evidence of HOW TradingView seeds its own EMA during its OWN warm-up
window for this specific composed function, versus the ALREADY-DISCLOSED,
standing narrowing this codebase states elsewhere for `ta.kc`/`ta.ema`
generally ("this engine seeds `ema` with the mean of the first full window
while Pine seeds it with the first source value... early bars differ,
converge").

**INITIALIZATION AGREEMENT: NOT CLAIMED, NOT TESTED** — same reason.

**A SEPARATE, additional limitation, specific to THIS engine's own
re-execution capability**: UCT's own `ema`/`kcw` implementation cannot be
independently re-run from a cold start on only 15 bars — a 20-length EMA
needs ≥20 bars just to produce a first value, so UCT's own kernel, handed
only this batch's 15-row capture, would produce an all-NaN column for `kcw`.
This is why `kcw`'s vendor-parity claim rests on DIRECT ARITHMETIC over the
observation's own recorded values (§4 of Addendum 4) rather than a
from-scratch dual-kernel re-execution the way `falling`/`pvtN` are verified —
already disclosed in Addendum 4, restated here because it is the direct
cause of the warm-up gap, not a separate issue.

**Final label, derived from the above, not assumed**: `ta.kcw` →
**VENDOR-PARITY VERIFIED — STEADY-STATE, LIMITED SAMPLE; WARM-UP /
INITIALIZATION UNVERIFIED.** This replaces every place this batch's own
documents said only "VENDOR-PARITY VERIFIED — LIMITED SAMPLE" for `kcw`
without the warm-up/initialization qualifier (see §12).

## 5. `ta.pvt` / `pvtN` numeric-residual reconciliation

**Exact columns being compared** (in
`tests/test_vendor_parity_batch1.py::test_vendor_parity_verified_against_real_capture[pvtN]`):
UCT's own Python kernel (`ast_interpret.py`'s `pvtN(5)`, executed via
`tools/ast_conformance.py::run_py`) over THIS reconciliation's own locally
transcribed `market.bars` (o/h/l/c/v figures read off the Table View
screenshots), differenced 5 bars apart — versus `pvt_change5`, the REAL
`ta.pvt` builtin's own 5-bar delta, read directly off the same screenshots.
**This is NOT the same comparison as "the vendor's own two internal
columns"** (see below) — it is a THIRD, independent re-derivation.

Recomputed precisely for all 10 comparable rows (past the 5-bar warmup):

| Date | UCT re-execution | Real vendor `pvt_change5` | Abs delta | Rel delta |
|---|---|---|---|---|
| 2026-08-24 | -529,467.6797 | -529,492.7300 | **25.0503 (max abs)** | 0.00473% |
| 2026-08-28 | 141,806.4332 | 141,782.3200 | 24.1132 | 0.01701% |
| 2026-08-31 | 121,075.1827 | 121,051.3400 | 23.8427 | **0.01970% (max rel)** |
| 2026-09-02 | -124,319.9907 | -124,342.8900 | 22.8993 | 0.01842% |
| 2026-08-27 | 385,524.0604 | 385,504.3700 | 19.6904 | 0.00511% |
| 2026-09-03 | 104,903.2422 | 104,916.1300 | -12.8878 | -0.01228% |
| 2026-08-25 | -145,120.6503 | -145,132.3300 | 11.6797 | 0.00805% |
| 2026-09-04 | 57,046.4945 | 57,053.0600 | -6.5655 | -0.01151% |
| 2026-09-01 | -249,140.0894 | -249,145.8400 | 5.7506 | 0.00231% |
| 2026-08-26 | -223,303.9493 | -223,306.9300 | 2.9807 | 0.00133% |

**Exact max absolute delta: 25.0503, at 2026-08-24.** **Exact max relative
delta: 0.01970%, at 2026-08-31** — a DIFFERENT row from the max-absolute one
(Addendum 4 named neither row precisely; both are named here).

**Source volume values involved** (the 5-bar window feeding the 2026-08-24 /
max-abs-delta row, i.e. bars 2026-08-18 through 2026-08-24): 43,920,000 /
40,310,000 / 45,520,000 / 39,190,000 / 32,430,000 shares, each as
TRANSCRIBED from TradingView's Table View display.

**TradingView's displayed/exported volume WAS rounded**: the Table View
shows volume as `"34.05M"` — 2 decimal places of millions, i.e. a 10,000-share
display granularity. Each transcribed figure above therefore carries an
UNKNOWN true value within ±5,000 shares of what was recorded.

**The underlying oracle calculation used FULL PRECISION, not displayed
precision** — both `pvt_builtin` (the real builtin) and
`pvt_deltaSumCandReal5` (the candidate formula) were computed BY
TRADINGVIEW'S OWN PINE RUNTIME, reading its real internal `volume`/`close`
keywords directly — never the rounded string a human reads off the Table
View. This is exactly why those two columns, both vendor-internal, matched
EXACTLY (0.00 at 2 read decimals) on all 15 rows — a claim this
reconciliation re-confirms means: **two DIFFERENT formulas, evaluated by the
SAME real TradingView engine on the SAME full-precision data, agreeing
exactly** — proof that the candidate formula is what TradingView's `ta.pvt`
computes, independent of and unaffected by this session's own external
volume-transcription rounding.

**Is the ~25-unit residual PROVEN, not merely asserted, to be caused by
display-rounding?** A direct sensitivity calculation, run against the real
bar data for the max-absolute-delta row (2026-08-24), rather than argued
qualitatively:

```
date        prevClose  close    frac       volume       term            +/-5000-share sensitivity
2026-08-18  772.67     767.45  -0.006756   43,920,000  -296,714.51      +/-33.78
2026-08-19  767.45     769.06   0.002098   40,310,000    84,564.60      +/-10.49
2026-08-20  769.06     762.60  -0.008400   45,520,000  -382,361.84      +/-42.00
2026-08-21  762.60     765.72   0.004091   39,190,000   160,336.74      +/-20.46
2026-08-24  765.72     763.47  -0.002938   32,430,000   -95,292.67      +/-14.69

sum of 5 terms (my recomputed delta): -529,467.6797
worst-case total swing if all 5 days' rounding errors were same-signed: +/-121.42
observed residual: 25.05
```

The observed 25.05-unit residual is **~20% of the theoretical worst-case
bound** implied by TradingView's own display-rounding granularity — squarely
consistent with 5 independent, partially-cancelling per-day rounding errors
(the expected shape when errors are not systematically biased), and small
relative to the bound a systematic (non-rounding) formula error would need
to explain. This is offered as PROVEN, not asserted: the calculation
directly uses this artifact's own real bar data and TradingView's own
documented display precision, not an assumed cause.

**Status, precisely**: the residual is CONSISTENT WITH, AND FULLY BOUNDED
BY, volume-display-rounding — a real, calculated, artifact-specific proof,
not a label applied by default. Where a document states only "volume-rounding
artifact" without this calculation attached (Addendum 4's own §9/§13), that
language is now backed by this section rather than standing as an assumption
— see §12 for exactly which documents carry the pointer.

## 6. Raw-artifact evidence limitation (preserved, re-stated precisely)

TradingView's CSV export was unavailable in this environment (two attempts,
explicit permission, no file produced anywhere on the filesystem — see
Addendum 4 §3). The raw evidence for this whole batch is Table View
screenshots (`tests/fixtures/vendor/raw_captures/2026-09-06-tv_cmf_adl_pvt_falling_kcw_capture_spy_screenshots/`)
plus four observation JSONs — NOT the 300+/2,000+-row CSV artifacts Lane A/B
used. This LIMITED SAMPLE status is not silently promoted anywhere in this
batch's own documents to the same confidence tier as those wider captures;
this reconciliation adds the explicit per-boundary table below so nothing is
left to be inferred:

| Function | Initialization | Warm-up | Zero-range | Zero-volume | NA gaps | Other |
|---|---|---|---|---|---|---|
| `falling` | n/a (bounded window, no seed) | n/a (bounded window) | n/a (uses close only) | n/a (uses close only) | UNVERIFIED (0 NA-gap rows in the 15-row capture) | none |
| `kcw` | UNVERIFIED (§4) | UNVERIFIED (§4) | tested on ONE synthetic bar only, not a real vendor zero-range bar — the real kcw formula (EMA-smoothed) correctly did not zero out, an EXPECTED, not vendor-surprising, result | n/a (uses high/low/close only) | UNVERIFIED | disclosed as direct-arithmetic evidence, not a from-scratch re-execution (§4) |
| `accdist` (formula only, not implemented) | NOT CLAIMED (Addendum 4 §8) | n/a (5-bar fixed window) | the per-bar formula's `(high-low)!=0 ? ... : 0.0` guard is DEFENSIVE and UNVERIFIED — never observed on real SPY data | same, DEFENSIVE and UNVERIFIED | UNVERIFIED | not a served surface at all (§2/§3) |
| `pvt` / `pvtN` | NOT CLAIMED (Addendum 4 §9) | n/a (5-bar fixed window) | n/a (no range term) | the zero-previous-close guard is DEFENSIVE and UNVERIFIED — never observed | UNVERIFIED | numeric residual fully reconciled in §5 |
| `cmf` | n/a — not real Pine, nothing to verify | n/a | n/a | n/a | n/a | n/a |

No new TradingView capture was performed in this reconciliation — this table
is derived entirely from the existing committed evidence.

## 7. Remaining blind-corpus frontier

From the same frozen 48, re-measured live in this reconciliation (not
recalled from Addendum 4's own printed roster, to rule out drift since
commit `32046d04c`):

```
RAW:       29 / 48   (19 misses)
ASSISTED:  38 / 48   (10 misses)
```

Both match the standing corpus truth accepted at the top of this
reconciliation exactly.

## 8/9/10. The 10 assisted-still-failing scripts, blocker distribution, and
architecture/blast-radius classification

| # | Script | Primary blocker | Secondary blocker(s) | Blocker family | Blast radius | Appears elsewhere? |
|---|---|---|---|---|---|---|
| 1 | `breakout-flat-base-pivot-breakout` | `ta.valuewhen` (occurrence-vs-window arity mismatch) | `nz(ta.barssince(...),0) >= baseLen` — CONFIRMED, re-verified live: removing `ta.valuewhen` alone still leaves this refused (UNSOUND nz sentinel, an unbounded-count comparison with no sound finite identity) | EXECUTION CAPABILITY GAP (both) | LARGE — both need genuine unbounded historical-occurrence state, an execution-model change this program has repeatedly, deliberately declined | `ta.valuewhen`: yes, 2 scripts (this one + `recency-macd-turn-recent`). The nz-unsound-sentinel shape: yes, a general capability-gap class also touching `recency-breakout-hold-since-trigger`/`recency-fresh-golden-cross` in different spellings |
| 2 | `meanrev-zscore-multi-oscillator-washout` | `ta.cci` (arbitrary-source; this table's `cci` kernel hardcodes `hlc3`) | none — re-verified against the ALREADY-STANDING regression (`pine.blindCorpusDecomposition.test.js`): `request.security(...)` is clean once `cci` is fixed | TRANSLATOR GAP (a role/source-binding limitation of the existing kernel, not unbounded state) | MODERATE — relax `PINE_CALL_SHAPES.cci`'s `sourceMustBe` constraint or add a genuine arbitrary-source CCI kernel | 1 script only in this corpus |
| 3 | `multifactor-gap-up-continuation-hold` | `ta.supertrend` (tuple AND bare forms both structurally refused) | none — single, permanent, by-design blocker | EXECUTION CAPABILITY GAP (`_functions_excluded.supertrend`'s own text: "a new SEALED entry with its own recurrence... not an expansion") | LARGE — a new stateful ratchet+flip primitive, same class of complexity as the already-excluded Parabolic SAR | 1 script only in this corpus |
| 4 | `multifactor-rsi-pullback-in-uptrend` | `dryVol_placeholder_removed` — an undefined name, read directly from the fixture: a dangling reference to a variable that was clearly renamed/removed without updating the final `plot()` line | none | **INVALID SOURCE** — a genuine script-author error, not a UCT capability question at all | NONE — no UCT change could ever make this script's OWN broken reference resolve | n/a — a single-script authoring bug |
| 5 | `recency-breakout-hold-since-trigger` | `ta.barssince` used NUMERICALLY as another function's window argument (`ta.lowest(close, math.max(age,1))`) | 2× `ta.valuewhen` (arity) | EXECUTION CAPABILITY GAP | LARGE — same unbounded-state class as #1 | barssince-as-numeric-arg: 1 script; valuewhen: 2 scripts total (see #1) |
| 6 | `recency-fresh-golden-cross` | two independent `ta.barssince` calls cross-compared (`barsDC > barsGC`) | none beyond the cross-comparison itself | EXECUTION CAPABILITY GAP ("no runtime primitive for which condition fired more recently") | LARGE — same unbounded-state class | 1 script in this exact cross-compared shape |
| 7 | `recency-macd-turn-recent` | `ta.valuewhen` | none — re-verified live: removing `ta.valuewhen` alone (the script's OWN `ta.barssince(cross)` use is already the bounded, already-supported `age <= within`-through-input-binding shape) translates CLEANLY. **Confirmed single blocker, corrected from a possible assumption of two** | EXECUTION CAPABILITY GAP | same `ta.valuewhen` class as #1/#5 | see #1 |
| 8 | `volatility-range-contraction-base` | `ta.tr(true)` | none — `ta.kcw`/`ta.falling` (this batch) and `request.security` (re-confirmed clean) are no longer blockers | **CORRECT REFUSAL** — a deliberate, already-ruled design choice ("this engine leaves that bar not-computable rather than inventing it"), not an oversight | NONE required if left as-is; SMALL if ever revisited (would need to define an invented first-bar fallback this engine currently refuses to invent) | 1 script |
| 9 | `volume-dollar-volume-money-flow` | `ta.cmf` | `ta.accdist` (confirmed independent second real blocker: with `cmf` stubbed, `accdist` alone still refuses) — **PLUS a newly-discovered, UNVERIFIED third finding, see below** | `ta.cmf`: INVALID SOURCE. `ta.accdist`: EXECUTION CAPABILITY GAP (EMA-based use). Third finding: mechanism UNKNOWN | `ta.accdist`: LARGE (same class as obv/pvt, already excluded). Third finding: blast radius CANNOT be estimated until root-caused | see §2 for `cmf`/`accdist`; the third finding is new (below) |
| 10 | `volume-obv-accumulation-divergence` | `ta.obv` bare LEVEL | none — `ta.pvt`'s windowed form (this batch) is confirmed resolved and no longer a blocker | EXECUTION CAPABILITY GAP / effectively a **CORRECT REFUSAL** (a permanent, already-ruled architectural boundary — "cumulative from the first bar, no absolute seed") | NONE — would require inventing an absolute historical seed that does not exist, the confident-wrong-number shape this program refuses to manufacture | the unseeded-cumulative shape recurs across `obv`/`pvt`/`accdist` (3 functions), though this specific LEVEL-usage is 1 script |

**A newly-discovered, UNRELATED finding, disclosed but NOT investigated
further** (found while precision-verifying script #9's blocker set, per this
reconciliation's own instruction to be exact rather than to guess): the
standing regression test
(`pine.blindCorpusDecomposition.test.js`, "a stateful for-loop accumulator...
independently blocks... `pine:reassign`") is STILL CORRECT for the ISOLATED
shape it tests (`plot(distDays <= 3 ? 1 : 0)` alone, re-verified live, still
refuses). But the SAME for-loop text, embedded verbatim in the REAL
`volume-dollar-volume-money-flow.pine` fixture (confirmed via a byte-identical
surgical replacement — only the `ta.cmf`/`ta.accdist` lines swapped, every
other character untouched), does **NOT** refuse — `distDays` silently folds
to its declared initial value `0` and the whole script translates
successfully, treating "distribution days ≤ 3" as permanently, silently
TRUE regardless of real market data. This is reproduced twice (a hand-built
reduction and the real fixture verbatim) and is a real, previously-undetected
finding in the SILENT_WRONG_RESULT class this whole program treats as the
worst failure shape — but **the ROOT CAUSE is not established** (a hypothesis
— that a variable's mutation is only tracked when it is the sole/direct
clause of the plotted output, and silently dropped when it is one clause
inside a larger boolean AND-chain reached through an intermediate binding —
was tested against 4 variants and is CONSISTENT with the evidence but not
proven against the actual translator internals). Per this reconciliation's
own explicit scope ("do not implement", "stop for review"), this is reported
and NOT investigated further, NOT fixed, and NOT root-caused here. It has no
effect on script #9's classification above (the script still correctly
misses today, for `ta.cmf`/`ta.accdist`, regardless of this finding), but it
means a FUTURE tranche that resolves `ta.cmf`/`ta.accdist` alone would ship
this script into a SILENTLY WRONG pass, not a correct one, unless this
for-loop finding is root-caused and fixed first. Recommend a NEW,
separately-authorized investigation — not begun here.

## 11. Updated RISK-004 truth

Unchanged by this reconciliation's own findings (no code changed): **RAW
29/48, ASSISTED 38/48** — re-measured live in §7, matching the accepted
standing truth exactly. What changed is the STATUS LANGUAGE for the five
batch functions (§2) and the precision of the frontier classification (§8–10),
not the corpus counts themselves.

## 12. Documentation corrections made

- `sentence.test.js` — the missing 4th hardcoded ID-list fixed (§1); this is
  test-code, not product code, and was a genuine gap in the original commit's
  own bookkeeping, not merely an accounting-cleanliness edit.
- `RISK_REGISTER.md` — RISK-042 added (this reconciliation's own row),
  correcting RISK-041's test-count claim and function-status language by
  reference rather than by silent edit — RISK-041's own text is preserved
  verbatim, per this program's standing "do not rewrite old failures as
  though they never existed" discipline.
- `VALIDATION_COVERAGE_MAP.md` — the "15 of ~70 manifest functions" miscount
  (§3) corrected to "14 of ~70 manifest functions (falling, pvtN) plus kcw as
  a separately-tracked BUILTIN_CALL_TREE surface (8→9)"; `ta.kcw`'s label
  tightened to include "WARM-UP / INITIALIZATION UNVERIFIED" (§4); `ta.pvt`'s
  label tightened to name the exact bounded contract rather than say
  "ta.pvt... vendor-parity-verified" unqualified (§2).
- This addendum itself.

## 13. Commit

`31d5a19a2` on `worktree-indicator-ecosystem` — evidence, docs, and one
test file (`sentence.test.js`) changed; no product code changed, per this
reconciliation's own explicit instruction.

## 14. Recommendation: architecture capability next, or a new out-of-sample
corpus next

**Recommend (B): build a new, frozen, out-of-sample corpus before committing
to any specific remaining architecture capability.** Rationale, evidence-led
rather than a preference: the 10 remaining assisted-failures (§8–10) split
into exactly THREE shapes — (a) two CORRECT REFUSALS this program has
already, deliberately, repeatedly ruled will not be revisited without new
evidence or a new owner decision (`ta.tr(true)`, `ta.obv`'s LEVEL); (b) one
INVALID SOURCE with no UCT-side fix possible at all
(`multifactor-rsi-pullback-in-uptrend`); (c) SEVEN capability-gap misses that
collapse into only THREE distinct underlying architectural questions
(`ta.valuewhen`'s occurrence-counting semantics, touching 2 scripts;
`ta.barssince`'s unbounded/cross-comparison shapes, touching 3 scripts;
`ta.cci`'s arbitrary-source kernel gap and `ta.supertrend`'s stateful
primitive, 1 script each). **This is now a heavily-mined corpus**: of its
original 48 scripts, every remaining miss traces to one of a small, already-
enumerated, already-classified set of architectural questions — exactly the
"optimization target" risk this reconciliation was asked to weigh. Committing
architecture effort to `ta.valuewhen` or `ta.barssince` next would be
optimizing against 5 scripts out of a corpus this program itself authored,
with no independent evidence any of these shapes represents real, broad
member demand outside this specific 48-script set. A frozen, out-of-sample
corpus is the only way to learn that without guessing.

**Proposed new corpus, specified, not built:**
- **Size**: 40–60 scripts, comparable to the existing 48-script blind corpus,
  large enough to move the needle statistically but not so large it becomes
  its own multi-session program.
- **Sourcing rules**: drawn from REAL, PUBLICLY-PUBLISHED Pine v5/v6 scripts
  (TradingView's public library, a fixed snapshot date), NOT authored by
  anyone on this program — the same "blind" property the existing 48-script
  corpus and the 8-script public compatibility corpus both already carry,
  extended to a larger sample.
- **Deduplication rules**: no two scripts sharing the same primary construct
  question (e.g., not five separate RSI-pullback variants) — checked by hand
  against the OTHER corpora's own construct taxonomy before freezing; no
  script that is a near-duplicate/fork of an existing corpus entry.
  **No hand-selection for constructs UCT already supports** — sourcing must
  be by a fixed, pre-declared rule (e.g., "the top N most-favorited scripts
  in category X on date Y"), not by a human picking scripts that look
  interesting or look like they'd pass.
- **Difficulty/complexity distribution**: a declared, pre-frozen target mix
  (e.g., ~40% simple single-indicator screens, ~40% multi-factor composites,
  ~20% stateful/session/multi-timeframe scripts) — set BEFORE any script is
  read for content, so the mix cannot be adjusted after seeing what passes.
- **Frozen-before-testing rule**: the full script list is committed to the
  repo (file names + a content hash) BEFORE the first translation attempt —
  the same discipline `pine.blindCorpus.test.js`'s own header already states
  for the existing 48.
- **Raw vs. assisted metrics**: report both, exactly as this program already
  does for the existing corpus (RAW = first-pass translation; ASSISTED =
  after every available offer is taken).
- **Leakage prevention**: explicit set-difference check against BOTH the
  existing 48-script blind corpus and the 8-script public compatibility
  corpus (by script title/source hash) before freezing, so no script counts
  twice toward this program's own evidence.

**This corpus is NOT built.** No new TradingView capture is authorized. No
architecture capability is implemented. Stopping for owner/ChatGPT review.

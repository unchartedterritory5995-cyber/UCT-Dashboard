# Benchmark Reproduction — Pine / thinkScript / TC2000 Translation Layer

Satisfies MP-007 (master-prompt §7 calibration warning: "Reproduce them. Audit their denominators.")
and master-prompt §89.G. Every number below was produced by actually running the corpus test files and
the Python cross-lane conformance tool in this worktree, on `origin/master` tip `12cf5c8d3` + this
program's own doc-only commits — not read off a comment, a doc, or a memory entry.

**Commands run, 2026-09-04, in the `indicator-ecosystem` worktree:**
```
cd app
npx vitest run src/components/chart/engine/ast/doorScorecard.test.js \
  src/components/chart/engine/ast/pine.corpus.test.js \
  src/components/chart/engine/ast/pine.blindCorpus.test.js \
  src/components/chart/engine/ast/pine.screenerCorpus.test.js \
  src/components/chart/engine/ast/thinkscript.corpus.test.js

python tools/ast_conformance.py --check
python tools/ast_conformance.py --coverage
```

## Reconciliation of the five previously-cited numbers

| Cited figure | Source | Verdict, as measured today |
|---|---|---|
| Master prompt "38/38 authored/product-goal" | `pine_screener/` corpus | `pine.screenerCorpus.test.js`: **6/6 tests pass, clean.** Consistent with the corpus still fully passing; the suite does not reprint a literal "38/38" line in this run, but nothing here contradicts it. |
| Master prompt "43/58 curated regression corpus" | `doorScorecard.test.js`'s "honest denominator" | **CONFIRMED, live and current: 43/58.** Not stale — this is the actual number the scorecard prints today. See breakdown below for what 43 and 58 each mean. |
| Master prompt "21/48 blind first pass" | `pine_blindCorpus.test.js` | **CONFIRMED, live and current: 21/48.** |
| Master prompt "28/48 after assisted edits" | same file, "accepted" set after the door's own suggested-edit offer | **FALSE AS OF TODAY — the repo's own test is currently RED on this exact claim.** Measured: still 21/48 after offer (not 28). See "Live failing test" below. |
| Memory "Pine parity ceiling 17/21" (dated 2026-08-12) | `pine.corpus.test.js` (21-file vendor corpus) | **Superseded.** `pine.corpus.test.js` passes 47/47 tests self-consistently at today's actual state — **14/21 translate**, not 17/21. 17/21 was an 8/12 projected ceiling; the permanently-refused ("ruled") set has grown since then. |

**Bottom line:** two of five cited numbers were exactly right (43/58, 21/48) — this codebase's own
benchmark infrastructure is unusually well self-documenting. One is currently false and the repo already
knows it (a red test, not a silent gap). One is superseded by more recent, more conservative data. One
could not be re-confirmed to the literal digit in this run but nothing contradicts it. **Per CL-008 /
master-prompt §7, none of these get quoted in any future report without a fresh line to this file or a
fresh re-run — this file itself will go stale the next time the corpus or the translator changes.**

## The full scorecard, as measured today (`doorScorecard.test.js`)

```
Pine               14/21  translate · 5 ruled · 0 offered · 2 OPEN
Pine (community)   19/30  translate · 7 ruled · 3 offered · 1 OPEN
thinkScript        10/24  translate · 5 ruled · 4 offered · 5 OPEN
TC2000 (PCF)       57/57  translate · 21 ruled · 0 OPEN

scripts:  43 translate · 17 ruled · 7 offered · 8 OPEN     (= 21+30+24 = 75 total; Pine+community+thinkScript only, PCF counted separately)
honest denominator (everything that CAN translate, i.e. excluding the 17 permanently-and-correctly-refused): 43/58

end to end: 43 translate -> 43 evaluate -> 43 SAVEABLE
  saveable once the repaint claim is acknowledged: 11-52-week-high-low.pine — preview-repaints

columns: 126 offered · 47 SCANNABLE
scripts: 18 of 43 translating scripts can be SCANNED directly — the rest offer only numeric columns
reachable as a screen with one added comparison: 43 of 43 translating scripts
```

**Reading this against the master prompt's own framework:**
- "ruled" = a permanent, principled refusal (correct refusal, per master-prompt §34 — the *better* failure
  mode, not a defect). These are excluded from the "honest denominator" deliberately, and the scorecard's
  own naming makes that explicit rather than hiding it inside a lower headline number.
- The translate → evaluate → saveable chain being 43 → 43 → 43 (with one flagged repaint caveat) is direct
  evidence against the "translation ≠ delivery" failure mode master-prompt §36 warns about — for this
  corpus, translating scripts are *not* silently failing to deliver. That doesn't generalize past this
  corpus, but it's real evidence, not an assumption.
- The 18/43-scannable-directly vs. 43/43-reachable-with-one-comparison split is exactly the numeric-output
  vs. boolean-condition distinction master-prompt §17–19 asks the program to guarantee — it already
  appears to be built and measured here, not merely aspired to.
- **TC2000 (PCF) at 57/57 translate, 21 ruled, 0 OPEN is the strongest-looking door of the three by this
  metric** — stronger than either Pine sub-corpus or thinkScript. This directly updates the earlier
  finding further: Door C is not only non-greenfield (per the Pine/thinkScript archaeologist's correction)
  but plausibly the most mature door by test-corpus pass rate. **Caveat, per CL-009 (no paper
  capabilities):** a 100% pass rate on a 57-case self-authored corpus is not proof the corpus is
  representative of real-world PCF diversity the way the *blind* Pine corpus is deliberately designed to
  stress-test Pine. Whether TC2000 has an equivalent blind/adversarial corpus is unknown — flagged for a
  dedicated Door C follow-up, not assumed from this number alone.

## Live failing test (real, current, not hypothetical)

`pine.blindCorpus.test.js` → `⏳ the accepted floor moves one way too` — **FAILS today:**
```
AssertionError: accepted: breakout-donchian-breakout-volume.pine, breakout-fifty-two-week-high-proximity.pine,
breakout-tight-consolidation-range.pine, candles-bullish-engulfing-pullback.pine, candles-hammer-at-support.pine,
meanrev-atr-stretch-below-ema.pine, meanrev-consecutive-down-closes-exhaustion.pine,
meanrev-rsi-oversold-uptrend-pullback.pine, meanrev-stochastic-deep-oversold-cross.pine,
momentum-ma-stack-alignment.pine, momentum-momentum-acceleration.pine, momentum-new-52w-high-breakout.pine,
multifactor-exhaustion-fade-short.pine, multifactor-squeeze-breakout-relative-strength.pine,
multifactor-weekly-trend-daily-macd-trigger.pine, recency-pullback-down-streak.pine, recency-stalled-under-high.pine,
volatility-bb-kc-squeeze-fire.pine, volatility-nr7-coil-uptrend.pine, volume-pocket-pivot-up-volume.pine,
volume-volume-dry-up-tight-base.pine
: expected 21 to be greater than or equal to 28
```
Interpretation: the assisted-edit/"offer" mechanism (per the earlier archaeology report, the "Put this in
my script" button in `PineBox.jsx`) is not currently lifting any of these 21 blocked blind-corpus scripts
into translating status — the accepted-after-offer count equals the pre-offer count. **This is a real,
currently-tracked product gap in the assisted-translation path**, visible as a red test rather than hidden
behind a stale claim. This is the single most concrete, actionable finding from this reproduction pass.

## Second live failing check: a named coverage hole

`python tools/ast_conformance.py --coverage` → **FAILS:**
```
AssertionError: 1 declared scalars have NO fixture case: ['base_relation_count'].
The fixture pins nothing about them -- not that they resolve, not what dates them, not what they yield --
and every gate would stay green.
```
`--check` itself **passes**: `CONFORMANCE LOG MATCHES, 144 asts x 579 bars` — the JS and Python execution
kernels agree at the tool's tolerance across all 144 corpus ASTs. But `--coverage` catches something
`--check` structurally cannot: one manifest-declared scalar (`base_relation_count`) has zero fixture
coverage, meaning a regression in its handling would pass every existing gate silently. This is a direct,
concrete instance of exactly what addendum item 14 (Test Credibility Assessment) asks Phase Zero to find —
found by running the repo's own tooling, not invented.

## What this changes

- MP-007 (benchmark reproduction) — **done**, this file is the artifact.
- MP-014A/B/C (per-door capability audits) — not done (a pass-rate number is not the full proof chain
  CL-009 requires), but each door now has a real, current, numeric starting point instead of five
  conflicting secondhand claims.
- Two new concrete findings enter the risk/gap picture: the blind-corpus assisted-edit floor (currently
  failing its own test) and the `base_relation_count` coverage hole. Neither is catastrophic — both are
  narrow and already caught by the repo's own test suite — but both are real and should be logged rather
  than left to whoever next notices the red test.

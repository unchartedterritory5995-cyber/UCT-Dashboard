VERDICT: GO-WITH-NOTES @c26cc5b231

Lane RULING-0927, delta re-review r2. The previous verdict was NO-GO @3700363b99 (B3 only).
The delta 3700363b99..c26cc5b231 is one commit touching three files: runtimeInputs.js (one line), ruling0927.test.js (+36),
EVIDENCE.md (+37). Reviewer: independent desktop Opus, 2026-11-07. I used a git-archive extract (rv-r0927-r2) with a
node_modules junction to pine-base. For cleanup I ran `cmd /c rmdir` on the junction first (pine-base intact), then
deleted the extract. No --force anywhere. I edited no lane code and pushed nothing.

## B3: CLOSED
Fix: `timeInputDefaultOf` reads `argOf(node, 'confirm', 5)` for both signatures (v4 `input(defval, title, type, minval,
maxval, confirm)`, v5/v6 `input.time(defval, title, tooltip, inline, group, confirm)`).
I probed each form at the tip on pane, screen, runtime settings and runtime run:
  REFUSED by name everywhere: v4 `input(T, "S", input.time, 0, 0, true)`; v4 positional bound to a name `c = true`;
  v4 `type=input.time, confirm=true`; v4 `input.time, confirm=true`; v4 `type=input.time, minval=0, maxval=0, confirm=true`;
  v5 positional index 5 `true`; v6 positional `true`; v6 `defval=…, confirm=true`; v5 `confirm=c`.
  SERVED (19130 on pane and runtime): every `false` twin (v4 positional, v5/v6 positional, and positional `false`
  followed by `display.all`).
Mutation: setting the index back to the r1 expression (`node.name === 'input.time' ? 5 : null`) turns ruling0927 red
(1 failed). Restored by copy, cmp clean.

## Nothing else changed
- The diff is limited to the three files above. The only code change is the confirm index.
- I re-ran my r1 probe set of 45 default forms. Every row except the new confirm rows is byte-identical to r1, so the
  B1 closure stands.
- Rails at the tip on Node 20.20.2: ruling0927 + runtimeInputKinds pass 114/114.
- The kNN fallback reason is documented in EVIDENCE and the code is unchanged, as the builder said (N6 stays a later task).
- I did not re-run hostParity or the service suite for r2. The one-line reader change only narrows `confirm`. At r1 both
  were green (166/166, 139/139).

## Merge
`git merge-tree --write-tree origin/master c26cc5b231` is clean (rc 0, f65ab712b3).

## Carried forward (from r1; still apply)
- Measure-pair is REQUIRED on both lanes. Expected results:
  - runtime 0: C18 probes 0/69. session-hilo goes from refused to served. The vw-time-tf probe passes the door, with
    T16 exact.
  - runtime 1: the above, plus runtime-lane refusals. Committed corpus: kNN goes from served to refused. pine-sample:
    every input.time default not in the captured form, or with confirm=true. Any other census mover blocks.
- Engine bump at merge (coordinator).
- N6: when the runtime route refuses, the member sees the host reason (kNN shows pine:collection). Pre-existing; later task.

VERDICT: GO-WITH-NOTES @c26cc5b231

## r2 measure adjudication (rt0)
Source: runs/ruling0927-mp/mp-all.log and mp0/ (tip c26cc5b231 vs base 911eb4b215; HEADs held). The runtime-1 leg is
being re-run (its base side failed on disk-full) and is NOT adjudicated here. I read the result files and the corpus
sources only. I ran no probes and changed nothing.

Direction convention: in census/C18 lines `a != b` is TIP != BASE. I checked this against session-hilo
(attached True=tip).

HARNESS: no worsening. MATCH is 93 -> 93. DIVERGE is 103 -> 110 and INCONCLUSIVE 140 -> 133. hostRefused is 112 -> 94.
Exactly 18 captures move, all `vw-time-tf-*`. Each was "member door refused (pine:input-kind)" on base and passes the
door at the tip. 7 go INCONCLUSIVE -> DIVERGE (btcusd-1d, eurusd-1d x2, spy-1, spy-30, spy-240, spy-5-ext); 11 stay
INCONCLUSIVE with a new reason. On all 18, T16 matches every bar (0 value, 0 na mismatches; for example 8477/8477 and
14330/14330). Every DIVERGE plot (T01-T09) has valueMismatches 0. All mismatches are na-only, with ours = null at the
first divergence (we withhold; we never draw a wrong value or draw where the vendor hides). These are the pre-existing
`time(<tf>)` withholds, graded now because the probe no longer stops at T16. The BTC case is already pinned by c36.
INTENDED.

C18 out (7 rows):
- open-interest-profile (confirm=true), market-compass (ISO `2024-01-01T00:00:00`), smart-money-volume (isnew sentence):
  message text only. INTENDED.
- lorentzian (`+0000` defaults, T16 form) and 15-anchored-vwap (`"01 Jan 2024 00:00 +0000"`, T16 form): the input step
  now passes, and the next wall refuses (runtime:library; runtime:conditional-history). Still refused. INTENDED.
- session-hilo: attaches, as already graded (0 mismatches vs an independent compute). INTENDED.
- rsi-vwap-indicator (v4 strategy): `testPeriodStart = input(StartDate, "Start of trading", input.time)` with
  `StartDate = timestamp("01 Jan 2000 00:00 +0000")`. That is EXACTLY the T16 form: name-bound, v4 positional type,
  no confirm. So the line-94 sell `label.new` guard (`time > testPeriodStart`) now folds, and the doc carries objects
  (docObjects false -> true). Its drawn output is EMPTY: on every config (synth-listing, synth-offlisting,
  agen600-listing) `reader.failed = 1` and labels = 0. The census also shows `installed: false`
  (compute.budget 976 > 960) on BOTH sides, so a member cannot install it either way. No visible output changes.
  The object op is carried but draws nothing, and that failure is pre-existing reader behaviour. INTENDED, no over-serve.

CENSUS (14 rows):
- kNN: the coordinator read the direction backwards. The row is `runtime.attached: false(tip) != true(base)`, and base
  lane=runtime. kNN DETACHES at the tip: its `GMT+10` defaults are refused. This matches finding (a) from r1. INTENDED
  under B1. Note the member is shown `pine:collection` (N6).
- example:functions:input.time#0 (`timestamp("20 Jul 2021 00:00 +0300")`): DETACHES on the runtime probe for the same
  reason (+0300 is not the captured form). INTENDED.
- trend-speed-analyzer: `input.time(timestamp('1 Jan 2020 00:00 +0000'))`, T16 form. The input passes and the guard
  moves to pine:state. Still refused. INTENDED.
- session-hilo attaches; rsi-vwap drawsObjects (see above); open-interest-profile and interactive-atr-stop-loss
  (confirm=true) and two `barstate.isnew` rows (liquidity-engulfing, smart-money-volume) change sentence only. INTENDED.
- NOISE: ai-supertrend (reachedAfterPeel true -> false, stuck pine:roundtrip), halftrend (peelSteps 7 -> 6),
  mirage (dropHeads 54 -> 53), volatility-coil (first dropHead), multi-timeframe-trend (refusals 3 -> 2). None of
  these five contain `input.time` in any form. For scripts without a time input, the r0-r2 code path is identical:
  the new branch is skipped and the `knobReads` move is order-only. Every one of them has `pine:timeout` steps
  (10 s / 400-level budgets) and wall-time that differs by up to 43 s between sides. Their member step 0 is
  identical. These are time-budget nondeterminism from the PEEL loop, not a change in what members see.
  Confirm in the rt1 re-run: they should move again, or move back.

Adjudication: no MATCH -> DIVERGE, no value mismatch, and no over-serve. Every behaviour change traces to the T16 form
being served, or an uncaptured form being refused. Verdict unchanged: GO-WITH-NOTES @c26cc5b231, PENDING the rt1
re-run. These would block in rt1: any harness worsening; any runtime-lane attach that is not an input.time default in
the captured form; any member step-0 change on a script without input.time.

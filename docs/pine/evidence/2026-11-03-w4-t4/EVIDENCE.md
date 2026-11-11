# W4 T4: `?:` arms run only when chosen (evidence)

Branch `feat/pine-w4-t4-conditional-arms`, build tip `f955303533`, measured against pine-base at
`52f76f9b4f`. Raw logs on the laptop: `_resume-laptop/runs/w4t4/` (job.out, rails.log, mut.log, mut-m8.log, prod/, rt/, final/).

## What changed
- **Lazy arms.** A v6 root `?:` arm holding `ta.sma`, `ta.ema`, `ta.rma` or one-argument
  `ta.change` is marked `lazy` and lowered as a jump with the version's na rule. `ta.change` in an
  arm is `src - src at the previous run` (CARRIED2 valuewhen ring), which is na on the first run.
  That is Pine's rule for a function's own series.
- **Master gap closed.** A `?:` off the column route was served with every-bar SELECT, which
  stepped arm state on bars where the arm was not chosen. The arm rule now applies to every
  `?:`, so the change only adds refusals. The object door is excluded, and rails M10/M14 pin it.
- **Still refused by name:** v5 (Q-PT1), v1-v4 (Q-PT3/Q-PT4), v4 `iff` (H10), any other `ta.*`,
  `change(x, 2)`, nested arms, function bodies, loops, if blocks, call arguments, offsets, twins,
  and sma-of-ema.

## Checks
- **Rails:** 392/392.
- **Harness:** `vendorHarness.w4ArmHistory` T03/T04/T05/K02/K03/N02 match on all 636 RDDT bars,
  and on SPY after warm-up. The reviewer re-ran both arm-history suites: 39/39.
- **Mutations:** 13/13 killed. M8 survived at first; `f955303533` added the rails that kill it.
- **measure-pair, production lane:** 0 attach diffs. The only field change is mcginley's
  `runtime.attached` sub-record, plus `pine:timeout` noise.
- **measure-pair, runtime-on lane:** 3 intended moves:
  1. `mcginley-dynamic` attaches.
  2. `luxy-momentum`'s first wall moves from the `na(capS) ? na : ta.ema(…)` arm, now served,
     to a later wall.
  3. `cm-gann` (v1) moves from na-test to conditional-history, which is fail-closed.
- **Spec rows that did not move:** trendlines-2x, rob-booker-adx-breakout,
  banknifty-mcclellan-oscillator, kernel-channel-backquant, strategyrszigzag ×2 and
  trendlines-jd. They are v1-v4 or hit another wall first, and stay refused by name. The spec
  (W4-BREAKDOWN T4) has been updated to match.
- **C18:** 0 diffs. Harness verdicts unchanged; `adx-and-di-for-v4` unchanged.
- **final-tip:** 2 failed / 1334 passed files, matching the baseline (`pollingSites.rail` and
  `targetScriptReport.measure`, both master's own). Gate pytest 46 passed; hygiene clean.

## Open
- `ta.rma` in an arm is served by inference, not capture. Capture queue W4-A2;
  `capture-queue-2026-11-03-w4-t4.md` holds W4-A1..A4.
- **Engine bump:** yes, given by the coordinator at merge.
- **Review:** independent Opus GO. Its two mediums (luxy-momentum, the unmoved spec rows) are
  folded in above.

# Capture queue — 2026-10-01 C46, a top-level value written below a loop inside a block (Q-C46a)

Branch `pine/c46-param-id-stability`. One new probe,
`tools/visual_conformance/probes/vw-loop-in-block.pine`, for the parent session to run on the live
TradingView rig with `tools/vendor_harness/tv_capture.js` — same procedure as
`docs/pine/capture-queue-2026-09-28.md` (visibility gate, **Create new ▸ Indicator**, "Add to chart"
binding gate, `__uctVH.capture({...})`, chunks, `verify_capture.mjs --assemble`).

## What is refused, and why a capture is what lifts it

| refused as | what is unknown |
|---|---|
| `pine:reassign` — "`<name>` — and the fold stopped before it, at line N: … `for`" (the main walk, every lane) | the value of a TOP-LEVEL name written inside an `if` chain that also holds a `for` / `while`, read after the chain: by a plot, or by a drawing in another block |

C31 (§ C31 of `docs/pine/vendor-harness/objects-triage-2026-09-28.md`) settled the rule for a block
LOCAL on the object lane, on captures: a loop's only effect on the names around it is what its body
writes. The same rule for a top-level name is not shown by any committed capture. Measured on
2026-10-01 with the fold switched on (branch `pine/c46-stepover-trial`): over the 47 external
captures and the 117-entry committed harness dir, objects pane on and off, **0 entries change**; over
the 266 corpus scripts **0 served outputs change and 0 become served** — the corpus has no served
value that goes through such a chain. So there is nothing to grade it against, and it stays refused
by name (rail: `pine.c31LoopScope.test.js`, "THE MAIN WALK STILL REFUSES THE BLOCK AT ITS LOOP").

Until C46 the reason written at that refusal was parameter ids (folding the chain reached inputs a
refused chain never did, and the walk-order counter renumbered saved ids). That reason is gone
(§ C46); this capture is the only thing still in the way.

## The capture

| # | capture | settles | what it would move |
|---|---|---|---|
| Q-C46a | `vw-loop-in-block` on AMEX:SPY 1D | L02 = L03 on every bar (a name the loop does not write folds as it does with no loop); L06 (written above the loop); L07 (`while`); L08 (the `else` arm); the label y (the same name read from another block) | merging `pine/c46-stepover-trial`: 108 refused corpus outputs name their real next wall instead of the loop; 8 parameters become adjustable in 6 scripts (source ids, none moves); poor-man's 40 `rowN_price` label positions resolve on the host lane instead of being asked of the runtime lane (its labels stay 0 / 40 — their text is behind ruling R7 and `INSTRUCTIONS_PER_BAR`) |

L04 / L05 (the loop-written total and what derives from it) are recorded for completeness; they
stay refused whatever the capture shows (ruling R7).

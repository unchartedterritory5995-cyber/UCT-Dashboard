# Uncharted Volume — v1 → v2, and why both are kept

**Owner-authored edit, 2026-09-12.** Not a translation, not a rewrite by this project:
the member owns the script and changed it. This page records what moved, why, and what
each revision is now FOR.

| | v1 | v2 |
|---|---|---|
| file | `tests/fixtures/member/uncharted-volume.pine` | `tests/fixtures/member/uncharted-volume-v2.pine` |
| `file_sha256` | `306415b2dda8d8f4b95be314e17e2616defaab260610728e164e15e4c9fa7f65` | `e550e994f5ad04f197b7746b14db21e9e1a0edcee843a2fa568402ac2e22c0c6` |
| host / pane (strict) | **ok=false**, `pine:state@284` | **ok=true**, 5 outputs, 0 refusals |
| screener (default) | ok=true, 4 × `pine:function@225` (`ta.cum`, by ruling) | ok=true, 4 × `pine:function@227` (same, two lines lower) |
| `buildRuntimeIr` | ok=false, `runtime:realtime-untold@296` | ok=false, `runtime:realtime-untold@297` — **expected until T4** |

## The three changes, whole

```diff
-indicator('Uncharted Volume', …)
+indicator('Uncharted Volume v2', …)

 lookbackDays = 252
+// v2 (2026-09-12): the HVE window, stated. See the header note.
+lookbackBarsHVE = input.int(2500, "HVE lookback (bars)", minval=50)

-// Running max of all prior daily volumes. Persists across bars via `var`.
-var float priorMaxAllTimeDaily = na
 …
-    if not na(volD[1])
-        priorMaxAllTimeDaily := na(priorMaxAllTimeDaily) ? volD[1] : math.max(priorMaxAllTimeDaily, volD[1])
+    priorMaxAllTimeDaily = ta.highest(volD[1], lookbackBarsHVE)
```

Nothing else moved. The title changes only so the two can sit on one chart without the
member having to read the pane to tell them apart.

## What the member gives up, said plainly

**HVE stops meaning "the highest daily volume ever" and starts meaning "the highest in
the last N sessions", with N theirs to choose.** At the default 2,500 bars that is about
ten years of sessions. That is a different feature, and the door said so in its own
words before this edit existed — the refusal on v1 line 284 hands back exactly this
call:

> THIS ENGINE DOES DECLARE A BOUNDED FORM: `highest(<that value>, <bars>)` … Stating the
> window is what makes the answer the same tomorrow — an all-time value moves with
> however many bars were fetched.

⭐ **And the script's own author had already reached for the bounded form one line
later**: `priorMax1YDaily = ta.highest(volD[1], lookbackDays)` is how HV1 has always
been computed. v2 makes HVE the same shape as its sibling.

## ⛔ v1 STAYS, AND IT IS NOT A STALE COPY

v1 is the **doctrine case**: the only member-scale script this project holds that
exercises `pine:state`'s refusal-with-offer end to end, on a real script somebody
actually runs. R-A3 ruled that the refusal stands and names the bounded call; that
ruling is testable only while a script that trips it is on disk.

⚠️ **So do not "fix" v1.** A future session that edits it to translate deletes the
evidence that the offer sentence is right, and the doctrine becomes a claim nobody can
check. The manifest says the same thing at the entry.

## What v2 unblocks

`pine:state@284` was the last host-lane blocker in the chain
`pine:reassign@250 → @260 → pine:request@259 → pine:state@284`. With it gone the pane
work has a real member script to be measured against: **5 outputs, 0 refusals, strict**.

The IR lane still refuses at `runtime:realtime-untold` (line 297 in v2, 296 in v1) —
`barstate.isconfirmed` cannot be answered until T4 lands the `newestBarIsForming`
producer. That is the expected state, recorded here so a future reader does not file it
as a regression.

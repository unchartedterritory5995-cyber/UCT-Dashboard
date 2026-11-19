# RS Rating added from "Your indicators": the load-time refusal flash (2026-11-17)

## ⭐ UPDATE 2026-11-18: reproduced, cause found, fixed (L10b)

The instrument reproduced the flash in **#1733's restart window**: prod `fbc204529e`, deployed at
00:42:56Z, probe run 00:43–00:49Z. This time the refusal-creation hooks were armed.

| load | seed + SPX requested | SPX 200 | run half | seed 200 |
|---|---|---|---|---|
| 1 | 15.2 s | 15.4 s | pending → served | 15.5 s |
| 2 | 14.9 s | 15.0 s | pending → served | 15.2 s |
| 3 | 14.9 s | 15.0 s | pending → pending → **refused `runtime:request` (15.13 s, beacon 15.3 s)** → pending → served (15.93 s) | 16.0 s |

**Cause.** A run waiting for another symbol's bars throws `runtime:request` with `pending: true`
(`runtimeColumns.js`), and `nativeRegistry.js::withRunHalf` holds a pending error as *pending*:

- **On the main thread**, the error arrives as thrown, so it stays pending.
- **Off the main thread**, it lost its flag. `runtimeWorker.js` posted only `{name, message, guard, limit, bar, ms}`,
  and `runtimeAsync.js::errorOf` rebuilt only those fields. So a worker run that finished **before the seed landed**
  came back as a plain `runtime:request` and was refused, until the seed's arrival started a new run.

Load 3's seed came 1.0 s after SPX, which gave a worker run time to finish first. Loads 1 and 2 had 0.1–0.2 s.
That is why it shows in slow restart windows, and why the 22:44Z beacons sat between SPX's answer and the seed's.

**Fix.** The worker posts `pending`, and `errorOf` keeps it.

**Rail.** `rsRunHalfWorkerPending.test.js` runs RS Rating's run half through the **real** worker module, with
each message structured-cloned as the browser does, SPX in hand and the seed loading:

| state | run-half states |
|---|---|
| before the fix | `refused:runtime:request`, as production showed |
| after the fix | pending only |
| control (both series in hand) | served |

Mutants: dropping the flag in the worker turns 1 test red; dropping it in `errorOf` turns 2 red.

The ruling below ("not reproducible at e73") is kept as written: it was true of the windows it had.

---

**Status (2026-11-17): CLOSED as not reproducible at engine 73** (coordinator ruling, 2026-11-17). The instrument is kept as
`tools/rs_library_load_probe.py`, which only measures and never gates. Any later restart can be probed in one command:

    python tools/rs_library_load_probe.py --profile <rig profile dir> --loads 3

## What was seen

Fred6724's RS Rating, added from **Add indicator → Your indicators**, flashed the refusal state
(`runtime:request`) on a fresh `/charts` load, and then drew `RS Rating 99` without any action from the member.
The two real causes of a *lasting* refusal were fixed before this note was written:

- **#1687**: SPX's daily answer had no bar for today.
- **#1715**: the binder's recompute key missed the run half's own reads (the seed).

What remained was this transient.

## The three instrumented windows

Every window ran on the rig profile as smoke@, on the live site, with fresh browser sessions. Each session first
loads `/charts`, then adds RS Rating from the library at about 14 s.

| window (UTC) | engine | library loads that drew | run-half refusal beacons | failed / non-200 `/api/bars` |
|---|---|---|---|---|
| ~22:44Z, a deploy restart window | 72 | 2 of 2 picked (one more load could not open the picker, an instrument miss) | **2**, one per drawn load | 0 |
| ~22:57Z | 72 | 3 of 3 | 0 | 0 |
| 23:15–23:21Z, e73 restart window (deploy live 23:15:02Z, uptime 16 s) | 73 | 3 of 3 | 0 | 0 |

**The 22:44Z window is the only sighting.**

### Its timeline

Times are seconds from the session's start, from the probe's own request, response and beacon records.

| load | seed + SPX requested | SPX 200 | refusal beacon `runtime:request` | seed 200 (35 rows) | first sample (about 29 s) |
|---|---|---|---|---|---|
| A2 | 15.2 | 15.6 (9,288 rows) | 15.9 | 16.7 | drawn `RS Rating 99` |
| A3 | 15.0 | 15.2 (9,288 rows) | 15.5 | 15.6 | drawn `RS Rating 99` |

Both beacons fired **while the seed request was still in flight**, between SPX's answer and the seed's answer.
Each series was requested exactly once and answered 200, and nothing failed. The rating drew without a second
request. The longest gap between the beacon and the seed's answer was 0.8 s (A2).

### The same moment at engine 73, with the refusal-creation hooks armed

In all three loads the run went through these states, in this order:

1. `pending` (`runtime:in-flight`);
2. the pending message *"this script reads another symbol whose bars are still loading; it is drawn once they
   arrive"*;
3. `pending`;
4. the same pending message;
5. `pending`;
6. `served`, about 0.8 s after the first `pending`.

No `refused` state and no run-half beacon appeared. The in-flight seed was classified as pending, not as a
refusal.

## Not settled

The 22:44Z window lacked the refusal-creation hooks: those were added for the e73 window. So it cannot say which
guard produced the beacon, only when it fired. The instrument now records exactly that (see below), so a future
sighting will name it.

## What the tool records

The tool writes `rs-library-load.json`. For each fresh load (default 3), it records:

- **every read of the RS store keys** (`SPX` and the seed) in the chart's other-symbol cache: status, bar count and
  `retryAt`;
- **every runtime refusal at creation**: its `guard` and message;
- **every run-half state**;
- **every withheld payload's reason**, and whether it was pending;
- **every `/api/bars` request**: its response status and any `requestfailed`;
- **the product's own refusal and headline beacons**: aborted, payload kept;
- **at +15, +45 and +90 s**: whether the label is drawn and whether a refusal note shows.

It makes only three writes:

- the one library row it creates through the member door;
- `runtime-admission`, which stores nothing;
- the DELETE of that row.

Every other non-GET request to `/api/` is aborted and logged. `--self-check` proves the write gate. Its table fails
both an allow-all gate and a deny-all gate, and two mutants of the gate turned it red.

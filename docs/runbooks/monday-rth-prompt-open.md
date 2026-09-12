# Monday RTH — OPEN run (items 1–15)

> **This file is piped to `claude -p` by `scripts/rth-open.ps1`. Nobody is watching.**
> There is no human to ask. If a decision is not covered here, take the conservative
> option, record it, and continue. Do not message anyone. Do not wait for input.

**Working directory:** `C:\Users\Patrick\uct-worktrees\flow-watch-rail` (a git worktree —
run everything from here, never `cd` to the main checkout).

**Session scope:** items 1–15 only — pre-open, the open, and the mid-session
measurements. Items 16–23 (write-up, verdict, proposals) belong to the CLOSE run and are
**out of scope here**. Do not start them.

---

## ⛔ EVERY MEASUREMENT WRITES ITS RESULT TO A FILE, AS IT GOES

This is the difference between this run and an interactive one: **a second session must
be able to finish the write-up from files alone, without re-measuring anything.** The
tape is gone by then; an unwritten measurement is a lost one.

For each item **N** below, write `scratchpad/monday-rth/itemN.json` **at the moment you
finish that item**, not at the end of the session. Each file:

```json
{
  "item": 8,
  "title": "Measured p50 row",
  "status": "measured | unmeasured | inconclusive | skipped",
  "reason_if_not_measured": "...",
  "started_et": "2026-09-14T10:02:11-04:00",
  "finished_et": "2026-09-14T10:41:03-04:00",
  "raw": { "...": "every number you measured, unrounded, plus the sample size" },
  "guards": [
    {"guard": "pod age >= 120 s", "verdict": "pass", "observed": "1841 s"},
    {"guard": "no deploy during the run", "verdict": "pass", "observed": "version stable 3 runs"}
  ],
  "notes": "anything a reader needs to not misread the raw block"
}
```

⛔ **`status` and `guards` are not optional.** A raw block with no verdicts is the thing
that becomes a confident finding later. If a guard could not be evaluated, say
`"verdict": "unevaluated"` with why — never `"pass"` by default.

⛔ **No projections, ever.** An unmeasured row stays unmeasured with its reason. Do not
interpolate, extrapolate, or "estimate" a number you did not observe.

⭐ Write `scratchpad/monday-rth/index.json` at the end listing every item file with its
status, so the close run knows what exists without globbing.

---

## ⛔ EVERY RIG RUN PASSES `--out`

`tools/flow_cold_paint_rig.py` prints to stdout and **saves nothing unless you pass
`--out`**. The smoke run proved this the expensive way: a clean path-B run happened and
left no artefact behind.

So every rig invocation in this session writes its own file:

```sh
python tools/flow_cold_paint_rig.py --path b --runs 5 --out scratchpad/monday-rth/rig-item10.json
```

Name it after the item it serves (`rig-item3a.json`, `rig-item3b.json`, `rig-item9.json`,
`rig-item10.json`, `rig-item13.json`) and reference that filename from the item's own
JSON under `raw.rig_out`. A run whose output exists only in a scrolled-past stdout buffer
did not happen, as far as the close session is concerned.

## HARD RULES — carried over verbatim, they still bind

- No push to master touching anything on flow-worker's watch list between 09:00 and
  16:00 ET. No docs pushes during RTH either — every master push rebuilds web, which
  blips `/api/*` and invalidates any rig run in flight. A clean deploy-free tape is
  required for measurement. If another workstream pushes, note the window and treat
  overlapping runs as INCONCLUSIVE (the rig enforces this).
- Production pod is read-only: ssh probes and ledger reads fine; no restarts, no
  `--set`, no variable changes.
- Do not edit `OptionsFlow.jsx` or `flowLoadPolicy.js`. Diagnose, produce diffs in
  `scratchpad/`, do not land them.
- No blank row gets a projection. Unmeasured stays unmeasured with the reason.
- Rig runs use member-smoke by default; admin smoke account only as a labelled control.
  Respect the rate limiter — space logins so a 429 doesn't cost you the open.
- If anything looks like a live incident (members seeing errors, tape stalled, parts
  cache draining and not refilling, `build_failures` climbing, holding page or login
  broken), stop measuring and report immediately. No fix during RTH without the owner's
  go.

### What "report immediately" means in a headless run

There is nobody to report to mid-run. So: **stop measuring, write
`scratchpad/monday-rth/INCIDENT.md`, and exit.**

`INCIDENT.md` must carry: what you saw, the timestamp in ET, the exact evidence (log
lines, status codes, screenshots paths), which item you were on, what you had already
written to `scratchpad/monday-rth/`, and explicitly **what you did NOT do**. Then exit
**non-zero** so the wrapper records it. Do not attempt a fix. Do not continue to the
next item.

---

## PRE-OPEN (before 09:30 ET)

**1.** Pod state matches the weekend: `FLOW_FAST_DATE_SCAN` read in-process = 1; parts
cache 10; `build_failures` 0; `parts_rejected_missing` 0; no overnight tracebacks; T+1
flat-file backfill completed per logs. Pod age noted. Holding page live at `/`,
member-smoke login 200 with `role=member`.
→ `item1.json`

**2.** Snapshot `/api/flow/aggregate-health` in full to
`scratchpad/monday-rth/monday-preopen-health.json` **and** record the same payload under
`raw` in `item2.json`.

**3.** Rig ready: both paths dry-run once on the pre-open tape, pod age ≥ 120 s, both runs
discarded as quiet-tape **by label**, harness confirmed working (visible tab,
PerformanceObserver, `X-Flow-Version` and `X-Flow-Part` reads, mount counting for the
picks question).
→ `item3.json`, with the two dry runs recorded under `raw.discarded_runs` and
`guards[].guard = "labelled NOT A MEASUREMENT"`.

## AT THE OPEN (09:30–10:00 ET) — RTH VALIDATION GATE

**4.** `rolls_steady[]` first live read ever: record when it first becomes non-zero and
capture the first 10 steady rolls **in full** — version, `prepare_ms`, `handoff_ms`,
`blocked_by`, `blocked_pass`, `blocked_held_ms`, `builds`, `build_failures`,
`parts_rejected_missing`, cache entry count, `csv_provider` share if exposed.
→ `item4.json` with all 10 rolls verbatim under `raw.rolls`.

**5.** Pre-warming under a live tape: `"[flow-prepare] remainder warmed"` on every roll,
cache stays at 10, `build_failures` stays 0. **If pass 2 fails or the cache drains under
load, that becomes the top finding** — capture exact log lines and characterise before
continuing.
→ `item5.json`; set `"top_finding": true` if it broke.

**6.** First `prepare_ms` after the open recorded. Any steady-state roll over 30 s is
flagged; otherwise the 110 s stays parked as a boot artefact.
→ `item6.json`

**7.** Members on parts: from server-side logs, confirm real member sessions (not just
the rig) are requesting `part=bootstrap` + `part=TOP_PICKS` and not whole-D +
`data?days=1`. Report the ratio of parts requests to whole-D requests over the first 30
minutes. **Any whole-D request from a member session is a finding** — capture the user
agent and the request sequence.
→ `item7.json`

## MID-SESSION (10:00–15:30 ET) — THE MEASUREMENTS

**8.** Measured p50 row: from ≥ 60 steady rolls, min / p50 / p95 / max `prepare_ms`,
`csv_provider` share, delta vs the 6,199 ms baseline, and whether the delta is consistent
with the 1.42 s component saving. Compare tape volume (row counts) to the baseline
sessions and qualify accordingly.
→ `item8.json`, with every roll's `prepare_ms` in `raw.samples` (not just the summary).

**9.** Cold first paint, path A (direct load, intro-gated): ≥ 5 valid runs spread across
the roll cycle (right after a roll, mid-roll, just before a roll). Per run: shell time,
picks time, first content, bytes on the wire, parts served from cache vs built,
`X-Flow-Version` at paint vs current version, pod age. Report median and worst, and
**separate the intro animation's share** so the page number is visible on its own.
→ `item9.json`

**10.** Cold first paint, path B (in-app navigation, no intro): same protocol, ≥ 5 valid
runs. **This is the number a returning member feels every 60 s; it's the headline.**
→ `item10.json`

**11.** Warm re-entry: confirm it still beats UCT20 on commits and bytes.
→ `item11.json`

**12.** Handoff attribution over the full session: every roll with `handoff_ms > 500` —
`blocked_by`, `blocked_pass`, `blocked_held_ms`, and the residual between `handoff_ms`
and `blocked_held_ms`. Distribution plus the three worst rolls in detail. Classify: fully
explained by lock hold (which pass), partially explained (residual — name the candidates:
the 2 s `_PREPARE_POLL_S` tick, detector timing, anything between sighting and pass-1
start), or unexplained (slot was free).
→ `item12.json`

**13.** TOP 10 / `.of-picks` and the request storm — the bimodal path-B finding. Under a
live tape, across the path-B runs plus dedicated runs if needed: does the picks table
mount when `part=TOP_PICKS` lands; **count mounts, not requests**; correlate storm shape
(bootstrap ×3, TOP_PICKS ×3, stray `data?days=1`) with picks never rendering; determine
whether it's a remount, a render gate, a version-check race, or a data-shape issue, using
the discriminator you named — **a render gate doesn't re-issue network calls, a remount
does**. Note the run-A caveat: clean shape and still no render. If real members are
hitting this, quantify from server logs how often the storm shape appears.
→ `item13.json`

**14.** Search on the head names: during a busy stretch, for NVDA, SPY, MU — does Search
complete, derive time, 503 to legacy tape or not. For MU: does the derive still exceed
60 s, and does the timeout discard the work or does it complete after the client gives
up? **Observation only.**
→ `item14.json`

**15.** Anomalies: 502s, empty panels, stale versions painting, drilldowns falling to the
tape, anything on the holding page or login. Log them with timestamps.
→ `item15.json` (`raw.anomalies: []` is a valid, meaningful answer — say so explicitly
rather than omitting the file).

---

## AT THE END OF THIS RUN — COMMIT LOCALLY, DO NOT PUSH

1. Copy everything in `scratchpad/monday-rth/` into `docs/runbooks/monday-rth-results/`
   (create it; keep the same filenames).
2. `git add docs/runbooks/monday-rth-results/` and commit locally. Docs-only — the commit
   must touch **no** file under `api/` or `app/`.
3. ⛔ **DO NOT `git push`.** Not before 16:00 ET, not at all in this run. Every master
   push rebuilds web and blips `/api/*`. The CLOSE run pushes. `git push` is not on this
   session's allowlist and will be denied — that denial is the design working, not a
   problem to route around.
4. Print the local commit SHA as the last line of your output.

**Exit 0** if items 1–15 are attempted and their JSON files written (including files
marked `unmeasured` with a reason). **Exit non-zero** only for an incident (see above).

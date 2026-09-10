# Options Flow roll gate — SESSION STATE (written 2026-09-09 ~22:30 ET)

**Read this first. Then read `C:\Users\Patrick\flow-gate-sampler\report.txt`. Then
write the verdict. Nothing before reading the data.**

---

## STATUS: the fix is live and proven

The classifier fix is **live in production on `184a7e77b`** (flow-worker deployment
`2c768029`). The gate that recorded **nothing** on the morning of 2026-09-09 now
records correctly.

What was wrong: `_record_roll` classified a roll by bucket arithmetic, which a forced
version bump invalidates, so the branch fell straight to `startup_catchup`. From the
first bump onward **every** roll was filed as a catch-up and `rolls_steady` stayed
empty for the life of the process. Production ran **437 prepares with ZERO steady
rolls** over ~18 hours. It is not an exotic state: `flow_gap_autofill` bumps the
version on a completed fill, and it did exactly that at 08:00 ET (fill run 246,
17,492 rows).

GREEN, verified in production and stable across the evening:

    gen 1  startup_catchup    1      <- the boot roll, correctly filed
    gen 1  steady_state_roll  1      <- the first steady roll this ledger has ever held
    steady observed_s: n=1 med=10.04  (>=60s: 0)   handoff med=2   declined=0

⚠️ That 10.04 s is **above** the 6–9 s band and is **expected, not a regression** — a
manual bump changes the version without changing data, so the CSV cache (keyed
`(source, days, version)`) is cold and rebuilds inside the measured window.
`declined=0` rules out lock contention. The FAIL bound is 60 s.

## WHAT IS NOT SOLVED

**Instant / seamless page loading is NOT achieved.** The fix repaired the
*instrument*, not the member experience. After every version roll there is a cold
window — steady-state observed at ~6.6–10 s tonight — during which a member load falls
through to the raw-tape path: multi-MB download, `processFlowData` on the main thread,
a visibly slow page. That window is the actual product problem and Phase 2 targets it.

⛔ **Tonight could not measure post-roll behaviour.** The tape froze at 16:59 ET and
the sampler attached at 18:09, so only ONE capture interval all evening contained a
version change, and it had zero requests in it. **Tomorrow's RTH session is the first
real distribution this project will ever have.** Do not reason about the window's width
from tonight's numbers.

Also unmeasurable tonight, and gone: the other 432 of that morning's 437 prepares. The
sampler only ever saw the five rolls sitting in the served `[-5:]` window. That is the
retention defect (E1) — the *second* independent failure of 2026-09-09, fixed on
`feat/flow-ledger-retention` but not yet deployed.

## TOMORROW — fully automated, nobody needs to be present

Nine Windows scheduled jobs. **The machine runs CDT (UTC−5); ET is UTC−4; every
trigger was set at ET−1 and each was verified to resolve to its named ET time.**

| ET | job | what it does |
|---|---|---|
| 07:45 | `morning` | sampler alive-check + restart if dead, full read, admin-token probe |
| 08:00 | `bump` | fires `POST /api/flow/bump-version` with the service token |
| 08:05 | `read` | the GREEN/RED/DECLINED/NO-SIGNAL call on the bump |
| 09:45 / 11:00 / 13:00 / 15:00 | `read` | periodic distribution snapshots |
| 16:05 | `final` | the verdict against the criteria below |

Plus `UCT Flow Sampler Keepalive` every 15 min for 22 h — it revives the sampler if it
dies. Both the job path and the revive path were **proven by execution**, not assumed:
a gate job was fired manually (`Last Result: 0`, wrote to `report.txt`), and the
sampler was deliberately killed and observed coming back.

Everything appends to **`C:\Users\Patrick\flow-gate-sampler\report.txt`**.

⛔ **08:05 go/no-go is PRE-DECIDED. On RED, do NOT revert.** Nothing member-facing
reads these ledgers — the only two readers are `/api/flow/aggregate-health` and
`/api/flow/_diag/pod`, both diagnostic. A wrong classifier costs bad gate data and
nothing else. Reverting costs a full-site bounce and buys a known-BLIND ledger instead
of a known-WRONG one, which is strictly less informative. Let the session run, fix at
the close. The only exception is member-facing breakage (`warm=False` persisting,
errors on every capture) — a different signal entirely.

⛔ **09:30–16:00 ET is hands-off.** No deploys, no bumps, no reverts, **no master
pushes of any kind** — not docs, not tests. Any master push is a full-site bounce
(`web` has an empty `watchPatterns`, which on Railway means *no filter*), and a push
touching one of flow-worker's 23 watched files gaps the OPRA tape permanently.
`summary.py` is read-only and safe at any time.

## THE 16:05 CRITERIA

Per **fully-observed** generation (a generation whose boot the sampler witnessed —
`generation >= 1`; gen 0 is a baseline the sampler attached to mid-life and its
catch-up count is meaningless):

- **PASS** — `startup_catchup == 1`; ≥20 steady rolls spread across the session; max
  `observed_s` < 60 s; median ≈ 7–9 s; `handoff_ms` single-digit; `pass2_skipped` rare.
- **FAIL** — a second `startup_catchup` with `restart=False` (on its own, regardless of
  how good the timing looks); `observed_s` regularly ≥ 60 s; frequent `pass2_skipped`;
  `rolls_steady` still 0 while `current_version` visibly moves.
- **AMBIGUOUS** — fewer than ~20 steady rolls, or all rolls inside one or two minutes
  (that is one build, not a distribution).

Then, before calling anything:

- **Check `restart` first on any second catch-up.** `restart=True` means the container
  restarted and a second catch-up is CORRECT, not a bug.
- **Attribute every roll ≥ 60 s.** `summary.py` prints the `declined` delta across the
  roll's window: `declined +N -> LOCK CONTENTION` vs `declined +0 -> THE PREPARER
  ITSELF`. Two different problems with two different fixes; never conflate them. It
  also now prints the **stage split** — `csv_ms` vs `parts_ms` vs `pass2_ms` — so a slow
  roll can be attributed to materialization or to the node subprocess. (That field only
  appears on rolls recorded by a binary carrying the stage-split change, which is NOT
  yet deployed — expect it after the post-close deploy, not tomorrow.)
- ⛔ **The fail-open trap.** If `db.data_signature()` raises, `_current_version()` fails
  OPEN and returns an ungated minute bucket — so the version advances every single
  minute and the distribution looks *flawless* while SQLite is unreadable. `summary.py`
  prints a `*** POSSIBLE FAIL-OPEN ***` banner on a ≥30 gapless run combined with
  `warm=False` or a climbing error rate. **The prettiest distribution is the suspicious
  one.** Cross-check `warm` and errors before calling a PASS.
- ⛔ **`observed_s` starts at the detector's SIGHTING**, and the sighting is itself
  delayed by the `_SIG_PROBE_SEC` (5 s) probe cache. This gate validates **handoff +
  preparation only**. Quote it as "sighting → first paint published", **never** as
  "data change → first paint".
- **The stale-valid split.** `summary.py` buckets each capture interval by whether the
  version moved during it. The **ROLLED** row is the post-roll population (an upper
  bound — a 60 s interval containing a roll also contains ordinary traffic); the
  **STABLE** row is cold-filter misses, which stale-valid would not help. Only the
  ROLLED row sizes the decision. Tonight: 5.4% over 234 stable intervals, and
  essentially no rolled data.

## POST-CLOSE DEPLOY (after 16:05, one GraphQL push against an explicit commit)

1. docs `E0`–`E13` (on `fix/flow-roll-classifier`)
2. `feat/flow-ledger-retention` @ `4e613468b` — per-kind deques + the stage-split
   capture fields. Green: 38 passed, 4 inherited reds, three mutants killed.
3. `last_build_error` beside the `build_failures` counter (see OPEN RISKS)
4. `web`'s `watchPatterns` fix (E6) — ⚠️ must include the `app/**` sources that feed
   `npm run build`, or a real frontend change silently never deploys. **Too narrow
   fails CLOSED on deploys, which is worse than the bug.**

**Latch stays parked** on `feat/flow-gate-postclose` unless tomorrow's data shows the
boot-decline case actually costing samples. Its redesign is written into that branch's
commit message: one authority, not two — delete `prev_version` rather than leave a dead
argument, and re-derive the call-site mutants against whatever carries the signal.

⛔ **Deploy via GraphQL against an explicit commit** — `deploymentCancel(id)` then
`serviceInstanceDeployV2(commitSha, environmentId, serviceId)`. **Never
`railway redeploy`**: it resolves `latestDeployment`, a moving reference, and after a
cancel that reference points at the PREVIOUS deployment — it would silently rebuild
pre-fix code and report success. Full procedure in E10. Verify the same way as tonight:
two stable captures, bump, GREEN.

## PHASE 2 — the actual member-facing speed work, ordered

1. **CSV materialization** — ~19.9 s of the cold window (`_get_cached_or_build` turning
   SQLite into a 14.8 MB CSV, keyed by `(source, days, version)`, rebuilt every roll,
   shared by both preparer passes). The biggest lever now that the parts build is
   ~8.9 s. Candidates: incremental materialization, a columnar/binary intermediate, or
   reading SQLite directly from the parts builder. **Choose by measured wins** — the
   stage-split fields exist precisely so this is aimed rather than guessed.
2. **Stale-valid serving — DECISION, needs the owner's word.** Serve generation N−1's
   prehydrated parts to loads landing in the post-roll window instead of the raw tape:
   ~200 ms instead of a multi-MB client-side rebuild, at up to ~60 s of staleness on
   TOP 10 / ticker aggregates / cap-filter counts for that one load. `planBundle`
   already guarantees intra-bundle consistency (`versions.size === 1`) and the server
   already serves stale under lock contention with an honest `X-Flow-Version`. **Bring
   it with numbers, not the qualitative case:** the ROLLED-row population from
   tomorrow, what those loads experience in wall-clock terms, and the window's measured
   width. If the window is 8 s and rare the answer is probably no; if it is 30–97 s and
   common it is probably yes and urgent.
3. **`_BUILD_LOCK` contention** — `declined: 261` against `prepared: 437` in the
   observed process; the search warm lane once held the lock ~90 s on one pathological
   ticker. Size it from the gate's attribution, then: a separate preparer lock,
   preparer priority, or a bounded warm-lane hold.
4. **Detector latency** — the 5 s probe cache plus minute-bucket versioning put up to
   ~65 s between a data change and the detector's sighting, entirely outside this gate.
   Measure end-to-end after 1–3 and decide whether members feel it.

If the gate FAILED on preparer slowness, item 1 is the fix, not an optimisation. If it
failed on contention, item 3 is.

## OPEN RISKS

- ⭐ **The foreign session on master.** A second Claude session
  (`session_01HWGkvQ2snrfWTGH5bXEL2K`, "Claude Fable 5") is an active uncoordinated
  writer on the same master. **Relaying `docs/flow/master-push-coordination.md` to that
  session's owner before 09:30 ET is the single highest-value manual action available,
  and it is the OWNER's to do — not this session's.** Coordination reaches writers a
  hook never would. ⛔ Do **not** rebuild the market-hours push guard: the owner removed
  it deliberately on 2026-08-24 (`143cabd3a`), and a hook is bypassed by a GitHub
  web-UI commit anyway.
- **`build_failures` sat at 2** all evening. Both fired exactly on a version change
  (boot roll, manual bump), neither on load, and neither was the preparer
  (`prepare.failed=0`, `warm=True` throughout). It matters because a failure does
  `return None` **unconditionally** where a decline returns `cached if cached else
  None` — **the member gets nothing**, not a stale part. And no error string is captured
  anywhere, so "why" is currently unanswerable. **Watch whether it scales with RTH
  load.** Fix is `last_build_error`, post-close.
- **`web`'s empty `watchPatterns`** bounces the member-facing service on every master
  push, including docs-only ones. It fired twice on 2026-09-09 for zero benefit.

## BRANCH MAP

| branch | tip | state |
|---|---|---|
| `fix/flow-roll-classifier` | see `git log` | the fix + docs E0–E13 + vendored tooling in `tools/flow-gate/` |
| `feat/flow-ledger-retention` | `4e613468b` | post-close, **green** — per-kind deques + stage split |
| `feat/flow-gate-postclose` | `f4883b3d8` | the latch, **parked red on purpose** (design conflict recorded in the commit) |

**Master carries only `184a7e77b` from this work.** No docs, no tooling, no retention.

## FIRST NEXT STEP

1. Read `C:\Users\Patrick\flow-gate-sampler\report.txt`.
2. Run `python C:\Users\Patrick\flow-gate-sampler\summary.py`.
3. Write the verdict against THE 16:05 CRITERIA above.
4. Only then decide the post-close deploy.

Nothing before reading the data. The one thing that almost shipped broken tonight — a
`parts_ms` that went negative because the same provider closure was timed across two
passes — was caught by an assertion demanding the stage split account for `prepare_ms`
exactly. Grinding harder would not have found it; the stricter assertion did.

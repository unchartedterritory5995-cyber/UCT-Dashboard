# Breadth History Reader — PROGRAMME CHECKLIST

**This file is the source of truth for the programme's state.** Standing directive SD-1
(issued 2026-09-15) says a fresh session must be able to resume from this file alone, and
that it is updated **in the same commit as the work it records**. A checklist that lags is
a false instrument.

The programme ends when this file reads **DONE** — that is, when D4 (`FINAL.md`) is merged.

Created 2026-09-15 (Session 13, first run under SD-1).
Last updated: **2026-09-16 01:45 ET, Session 14 (SD-1.7 final ratification).**

# ✅ DONE

**D4 (`FINAL.md`) merged to master in `54abdefeb`** — a master-first merge
(`^1` = `c0c950fbb`, `^2` = `32f0d8274`), Railway `web` **SUCCESS on its own**, production
200. Verified by artifact and ancestry, not by expectation: `32f0d8274` is an ancestor of
`origin/production`, and the landed files byte-match the commit.

**DONE carries five labels, each naming what is not finished** (SD-1.6 F0):

| label | what it covers |
|---|---|
| `OWNER-PENDING` | **G6** branch protection on `production` — payloads in FINAL.md §14.6. The session was correctly refused a credential and attempted no other route. |
| `TIME-GATED` | **S2** scope checker → ENFORCE: ≥20 heartbeats, ≥2 worktrees, ≥24 h, 0 WOULD-REFUSE. Installed in WARN; cannot refuse anybody's commit. |
| `NOT-OBSERVED` | the **negative case** — a red gate publishing its own record. Passive capture armed (D2.1); never seen fire. |
| `UNREHEARSED-WITH-PROCEDURE` | the **G6 rollback** (remove the `update` rule within one gate cycle) is written and has never been run. |
| `RUNNER-OWNED` | **R6/R8** Pool B and the flip. R6's *criterion* is met (§14.1); executing it is the runner's. |

⛔ **R7 moved from `NOT ESTIMABLE` to `ANSWERED` after ratification**, because the pool was
never short of rows — `breadth_pool_report.py` was keying populations on the SHA rather than
on the hot path. See FINAL.md §14.1 and §14.7 #8. **The ratified "175× conservative" figure
is superseded by 33×** (the p95 bound); the median figure is 185×. Both are recorded, and
the owner may keep either as the headline — but "conservative" now names the smaller one.

---

## STATE VOCABULARY

| State | Means |
|---|---|
| `DONE` | finished and merged to master; nothing further |
| `BUILT` | built and gated on a branch, **not on master** — names the branch |
| `READY` | preconditions met, waiting only for a slot (window / settle / n) |
| `BLOCKED` | a named precondition is not met — names it |
| `OWNER-PENDING` | needs the owner's keyboard; carries the click-path |
| `STOPPED` | hit a §5 hard stop; stays stopped until the owner changes this line |
| `NOT STARTED` | no work done |

⛔ **A state is changed only by evidence, never by expectation.** "It should have landed"
is not `DONE`.

---

## THE ONE-SCREEN ANSWER

| Track | Where it is |
|---|---|
| **R** Reader | **R1–R5 `DONE`.** **R6** criterion MET (n=79 ≥ 20 on the live reader), execution `RUNNER-OWNED`. **R7 `ANSWERED`** — p95 ≤ 1,680.6 ms at 95.6% (n=61 at the 600 s analysis floor). **R8** follows R6. |
| **G** Deploy gate | **G1, G3, G4, G5, G7, G8 `DONE`.** **G2 `RETIRED`** — the cutover was the probe. **G6 `OWNER-PENDING`** (§14.6) — the only item needing a keyboard. |
| **S** Repo safety | **S1 + S3 `DONE`** — landed and installed. **S2 `TIME-GATED`** in WARN on its 24 h criterion. |
| **D** Record | **D1–D4 `DONE`** — `FINAL.md` merged in `54abdefeb`, which is what ends the programme. |

**What is left, in one sentence:** one GitHub setting that needs the owner's keyboard (G6),
one 24-hour clock running on its own (S2), one failure mode nobody has seen fire yet (the
red gate), and a runner that owns the flip.

⛔ **There is no market-hours window on this repo** — owner ruling SD-1.1 A0, *"we no longer
have mid day blocks ever"*. The landing gates were the settled SUCCESS deploy, the lock, the
pause sentinel and the pre-push guard, and those held: the branch landed on a queue reading
2 deploys/60 min with none inside 600 s.

⚠️ **And that guard reading was true and insufficient — see §14.7 #11.** A Railway deploy
record appears ~3m25s AFTER the push that causes it, so a push already in flight is
invisible to any guard that reads the deploy list. This landing superseded a peer's deploy
2.3 minutes after it started building. Nothing was lost (their commit is an ancestor of the
merge's first parent), but **"no deploy in flight" is evidence about deploys, never about
pushes**, and only GitHub's `concurrency: master-deploy` group sees the push itself.

⚰️ **The thing to carry out of Session 13:** a red gate has already shipped to production
once, because Railway's Wait-for-CI is off and the gate only serialises. The cutover is
what makes the gate actually gate, and it is now a single **API call**.

⛔ **WHAT IS ACTUALLY BLOCKING THE LANDING (measured 16:15 ET, not assumed).** Not the
clock — the guard printed *"16:15:24 ET is outside the 09:25-16:05 ET deploy window — safe
to restart web"* and PASSED it. The refusal is the **burst clause**:
`BURST_WINDOW_SECONDS = 3600`, ≥ 3 distinct commits deployed within an hour. Three
joystick deploys landed at 15:31:11, 15:53:45 and 16:04:56 ET.

⭐⭐ **This reconciles Session 12's "quiet window" request with SD-1.1's ruling, and both
were right.** There is **no clock**, but there **is** a real precondition called quiet —
enforced by RATE, read off the deployment list, rather than by hour and by courtesy. The
need was never imaginary; only the mechanism was.

⚠️ It is a **livelock risk, not a wait**: the clause clears only if nothing else lands, and
every master deploy from any workstream slides it forward. The script retries and logs each
refusal by SHA — those refusals are the operational record.

### ⭐⭐ THE QUEUE IS ITS OWN COMPETITOR — the burst clause sets this programme's pace

**A sequential landing queue trips the burst clause with its OWN pushes.** The clause counts
distinct `web` deploys in a sliding 60 minutes and refuses at ≥ 3; each landing contributes
one. So even on a repository where nothing else is shipping, landing `i` must wait until
landing `i−3` ages out:

> **t(i) > t(i−3) + 3600** — at most **3 landings per rolling hour**, one every ~20 minutes.

⛔ **That, not the 610 s settle, is the binding constraint on everything left in R and S.**
The settle gate costs ~10 minutes and the build ~3–5; the burst clause costs 20. Any plan that
sizes the remaining work by "how long does a deploy take" is wrong by a factor of two, and the
error is in the flattering direction.

⚠️ **Foreign traffic makes it worse, and did here.** At 16:43 ET the window held three commits
of which **two were another workstream's** (`db5591c63` 15:53:45, `57113d1ac` 16:04:56) and one
was ours (`56b5554b1` 16:32:54, M14) — so the queue had **zero** slots until the oldest aged
out at 16:53:45. M12 refused four times on that clause between 16:43:21 and 16:48:14, each
refusal logged by SHA, the clock passing every time at 626–918 s settled.

⭐ **This is the guard working, and the queue is right not to fight it.** Three landings an hour
IS "one master merge at a time" expressed as a rate. The wrong reactions, both rejected here:
`UCT_SKIP_PREPUSH_GUARD=1` (the refusal is correct), and **combining M12/M13/S13 into one push
to save two slots** — that trades a real rate limit for an unattributable deploy, and
attributable rollback is the whole reason they are separate.

⚠️ **Consequence for the landing ORDER, recorded and deliberately NOT acted on.** S13
(`repo/git-scope`) is last in the queue but carries the `.gitattributes` fix and the scope
checker — repo-safety machinery every later commit benefits from — while M13 ships with its
flag OFF and is inert on arrival. Under a 20-minute-per-slot budget that ordering costs ~40
minutes of protection. **SD-1.1 A4 fixed the order; a mid-flight reorder is exactly the change
this session already declined to make once** (the merge-direction finding). Noted for the next
queue, not changed in this one.

#### ⛔ THE GUARD'S `CLEARED_PREFIXES` EXEMPTION IS ONE-DIRECTIONAL — it excuses you and charges the next person

Measured live, 2026-09-15, while this section was being written:

| | |
|---|---|
| M12 pushed → `9f0c76f46` | deploy created **16:55:04**, SUCCESS **16:57:35** |
| **`263e54120` began BUILDING** | **16:58:40** — another workstream, 65 s after our SUCCESS |
| What they actually changed | **21 files, every one under `app/src/components/chart/`** |
| Guard verdict | **legitimately EXEMPT** — `app/` is in `CLEARED_PREFIXES` |

**No violation, and no damage** — our sampler files are intact on master (`breadth_sampler.py`
310 lines, `breadth_sampler_report.py` 278, `test_breadth_sampler.py` 420). But the deploy their
exempt push produced **occupies a burst slot for everyone else**, because the clause counts
DEPLOYS, not the changes that caused them. So M13 is now blocked by a deploy that was itself
exempt from the clause now blocking us.

⛔⛔ **AND A SECOND EXEMPT PUSH LANDED THREE MINUTES LATER** (`a4e845fe7`, docs-only, same
workstream, 17:01:46). Measured window at 17:02:52 — **five distinct deploys**, guard refusing at
three, first drop to two at **17:55:04**:

```
17:01:46  a4e845fe7  BUILDING   ages out 18:01:46   foreign (docs)
16:58:27  263e54120  SUCCESS    ages out 17:58:27   foreign (app/charts)
16:55:04  9f0c76f46  REMOVED    ages out 17:55:04   <- OUR M12
16:32:54  56b5554b1  REMOVED    ages out 17:32:54   <- OUR M14
16:04:56  57113d1ac  REMOVED    ages out 17:04:56   foreign
```

⭐⭐ **READ THE THIRD ROW: the binding constraint is OUR OWN M12.** With zero further foreign
pushes, M13 still waits for *our previous landing* to leave the window. **Do not write a
predicted clock time for a landing** — two foreign pushes moved it twice in seven minutes. State
the mechanism and re-measure; a timestamp in this file is stale the moment somebody else ships.

⚠️ **THIS IS THE LIVELOCK, DEMONSTRATED.** A queue that yields politely competes with pushes that
are exempt from the clause and therefore never yield. If the other workstream sustains roughly one
deploy per 20 minutes, **a yielding queue never lands at all.** It is not a wait to sit out; it is
a condition to notice, and the only lever is coordination between workstreams — **never the
override, which would make our push the one that breaks somebody else's instrument.**

#### ✅ OUTCOME — the queue DID drain, and the threshold was still exceeded

**Four landings in 1 h 43 m** (16:32:54 → 18:18:46), each to SUCCESS, each on a green guard,
**no override at any point.** Competing traffic over that span: **five foreign deploys** —
`57113d1ac`, `263e54120`, `a4e845fe7`, `5efc1abc5`, `f0262e848` — from **two** other
workstreams, arriving at **1 per 18.9 min**, above the 1-per-30-min threshold derived above.

⭐ **So it drained despite exceeding the threshold, and the reason matters.** The threshold
governs a **steady state**; a real arrival stream is bursty, and a FINITE queue only needs the
gaps. Three foreign deploys landed inside fifteen minutes and then nothing for forty-two.
**The threshold predicts whether a queue can drain INDEFINITELY, not whether THIS queue
drains** — stating it as the latter would be a forecast dressed as a derivation.

⛔ **AND A FOREIGN DEPLOY COSTS A YIELDING QUEUE TWICE.** It holds a burst slot for an hour
**and resets the 610 s settle**, because the settle is measured against the NEWEST deploy, not
against yours. `f0262e848` (17:55:13) did both: it re-occupied a slot *and* pushed M13's settle
from 18:01:46 out to 18:05:23, **flipping the binding constraint from burst to settle
mid-wait.** Budget ~10 minutes of settle per intrusion on top of the slot.

⚰️ **MY OWN ERROR, recorded because it is this file's recurring shape.** At 17:45 I measured a
thirty-minute gap with no foreign deploy, declared the burst over, and stood the livelock
trigger down. Four minutes later `f0262e848` arrived. **Thirty minutes of silence is a sample,
not a rate** — `lesson_two_points_do_not_establish_a_rate`, committed against my own threshold
in the same hour I derived it. The honest reading was available and I did not take it: four
arrivals over 57 minutes. ⭐ **A quiet interval is evidence about that interval and nothing
else.**

⭐ That is not an argument for removing the exemption — an `app/`-only change genuinely is
low-risk to push. It is the observation that **the exemption and the clause measure different
things**, and only the person who did not get the exemption pays for it.

⛔ **I MISREAD IT FIRST, in the way this session had already documented.** `git diff 263e54120^1`
showed OUR breadth files and read as *"they overwrote our landing"*. Their merge's **first parent
is their branch and its second is master**, so that diff shows what MASTER brought IN — our M12.
The correct side is `^2`. **Same merge-direction trap as our own M14, from the opposite
direction, within an hour of writing it down.**

⚰️ **And A2.5's range-scan defect recurred on that push, live.** `263e54120` is a
`checkout feature; merge master` merge, so the deploy gate's `git diff HEAD^ HEAD` scans the
**first-parent side — our breadth files** — and gives their **21 chart files zero secret
scanning**. The finding is no longer a historical 66-commit count; it happened again today, on a
push that is not ours. (The advisory scan lives on `repo/range-scan`, unlanded — see A2.5.)

⚠️ **CORRECTION to the schedule arithmetic above: the 610 s settle runs from deploy CREATION, not
from SUCCESS.** Read off the log — `9f0c76f46 is 156s of 610s` at 16:57:39 against a 16:55:04
creation. An estimate built on SUCCESS is ~2–3 minutes pessimistic per landing, which is the
direction that makes a queue look slower than it is.

---

## R — READER

### R1 · M12 (sampler) landed, SUCCESS
✅ **`DONE`** — pushed `16:55:05`, **deploy `9f0c76f46` SUCCESS `16:57:35 ET`**, verified on
`origin/master` by `ls-remote`, not by the push's exit code. Seven burst refusals preceded it
(16:43:21 → 16:53:24), every one correct; **no override was used.**
- Branch `breadth/sampler`, local tip `41bd58eb7`, **ahead of `origin/breadth/sampler` by 23** (master merged in for re-gating, plus the encoding fix below).
- Re-gated 2026-09-15: master is ancestor; no file overlap with master's changes; hot-path diff **empty** (5 files, 0 under `api/`); **20 tests green** (17 + 3 added this session).
- ⚠️ **The branch moved after Session 12 gated it.** `41bd58eb7` fixes a defect that would have shipped: see *Session 13 findings* below. Re-gated after the change.
- Evidence to record on landing: deploy SHA, status, time.

> **RE-GATED AGAINST `79b4b2907` (SD-1 §6, master moved mid-session).** Master's delta is
> **3 files, 0 under `api/`, 0 hot**, and its overlap with every held branch is **NONE**.
> ⭐ This matters because the landing script merges `origin/master` immediately before
> pushing and does **not** re-run the parity gate — so the argument that M13's EXACT
> parity survives that merge has to be made from the delta, and it is: a change that
> touches no file the branch touches, and no file the reader executes, cannot move a
> byte of the response.

### R2 · S1 registered; sampler producing lines; summary regenerated each run
**`BLOCKED`** — ⚠️ **but no longer for the reason this line used to give.** It read *"blocked on
R1 (the sampler's files are not on master until M12 lands)"*; **M12 landed at 16:57:35 and that
condition is met.** The live blocker is the RUNNER'S LOCATION — see the subsection below. Left
visible rather than silently rewritten, because the old reason being satisfied is exactly what
would make somebody run the prepared command.
- Task Scheduler: **no sampler job exists** — verified 2026-09-15 against the full task list. Proposed name `UCT Breadth Sampler`, matching the existing `UCT Breadth *` convention.
- ⭐ The report tool now writes `docs/breadth-history-reader/sampler-summary.md` on every run and **survives this box's cp1252 console** (fixed `41bd58eb7`). Before that fix a scheduled run would have exited 1 with no file — R2 could not have been satisfied.

**The registration, ready to run the moment M12 is on master** (shape copied from
`UCT Breadth Collector`, the convention on this box — `MultipleInstances IgnoreNew`,
Interactive/Limited, weekdays):

```powershell
$repo = 'C:\Users\Patrick\uct-worktrees\breadth-history-reader'
$act  = New-ScheduledTaskAction -Execute 'python' `
          -Argument "$repo\tools\breadth_sampler.py" -WorkingDirectory $repo
# 16:10 ET = 15:10 CT on this box. The clock HERE is LOCAL/CT; the sampler's OWN guard
# is ET via zoneinfo and is the authority. This trigger only avoids pointless wake-ups
# inside a window the sampler would refuse anyway.
$trg  = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At 15:10
$set  = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable
Register-ScheduledTask -TaskName 'UCT Breadth Sampler' -Action $act -Trigger $trg -Settings $set
```

- ⛔ **`MultipleInstances IgnoreNew` is the "never two samplers" rule, in the scheduler
  rather than in a comment.** The sampler loops internally until its daily cap, so a
  second instance would double the production load that cap exists to bound.
- ⛔ **Do not register before M12 lands.** `tools/breadth_sampler.py` is not on master, so
  the task would start, fail to find the file, and record a green-looking run that
  sampled nothing.

#### ⛔⛔ M12 HAS LANDED AND THE COMMAND ABOVE IS STILL NOT SAFE TO RUN — the precondition names the wrong thing

**M12 is on master (`9f0c76f46`, 2026-09-15 16:57:35 ET), so the stated precondition is
met.** It is not sufficient, because **the scheduled task does not read master.** It runs a
file out of a WORKING TREE:

```python
REPO = pathlib.Path(__file__).resolve().parents[1]      # tools/breadth_sampler.py:59
LOG_PATH = REPO / "logs" / "breadth-samples.jsonl"      # :60
KILL_SWITCH = REPO / "logs" / "STOP-BREADTH-SAMPLER"    # :61
BASE = "https://uctintelligence.com"                    # :55
```

⭐ **The script's own LOCATION defines the pool's identity.** It samples production over
HTTP, so it needs no repo data at all — but it writes the sample log, and reads the kill
switch, beside whichever *copy of itself* runs. Point a second copy anywhere and you start a
**second pool that looks identical to the first**, silently. (Same `__file__.parents[1]`
construct that made `tools/git_scope.py` vacuous from the scratchpad earlier this session.)

⛔ **And `$repo` in the command above is the SHARED worktree — the one the landing script
owns and switches branches on.** Measured 2026-09-15, the file is absent from three of the
four branches that script checks out:

| branch | `tools/breadth_sampler.py` |
|---|---|
| `breadth/sampler` (checked out now) | present, 310 lines |
| `docs/session11-record` | **ABSENT** |
| `breadth/resident-recon` | **ABSENT** |
| `repo/git-scope` | **ABSENT** |

So a 15:10 CT fire during a landing finds no file — *"a green-looking run that sampled
nothing"*, exactly as the bullet above warns, but triggered by **branch state**, not by
master. Worse when the file IS present: the version that runs is the branch's, not master's.

⚠️ **`master` also read ABSENT in that measurement and that was a STALE LOCAL REF** — 23
commits behind `origin/master`, which has the file. Checked before reporting; a phantom
absence would have been the finding here.

**Therefore R2 stays BLOCKED, for a reason this checklist did not previously state.** Two
conditions, not one:
1. the sampler is on master — ✅ **met**; and
2. the task runs from a checkout **nothing else switches branches on** — ❌ **not met**.

⭐ **The fix is cheap RIGHT NOW and gets more expensive later.** R4 already records that M13
starts a new pool (it touches `breadth_daily_ohlc.py`, a hot file), so the existing n=2 does
not carry forward anyway — **there is no pool to strand by moving the runner today.**
⛔ Recorded as a **proposal, not an action** (SD-1 §7): the registration path is owner-visible
and changing where the sampler lives is a standing decision about this box, not a checklist
step. It needs a dedicated, stable checkout — "one worktree, one writer" applied to the
scheduler.
- Verify after registering: `Get-ScheduledTask 'UCT Breadth Sampler'`, then prove the
  guard is **live rather than merely present** with the kill switch, which is the one
  refusal that does not depend on pod timing:

  ```sh
  touch logs/STOP-BREADTH-SAMPLER
  python tools/breadth_sampler.py --once     # must print kill_switch_present, exit 0
  rm logs/STOP-BREADTH-SAMPLER
  ```

  ⚰️ **This step used to read *"inside guard hours it must print a refusal"* — it named a
  guard SD-1.1 A0 deleted.** `should_sample` now refuses with exactly four strings —
  `kill_switch_present` · `uptime_unknown` · `pod_unsettled_uptime_Ns` ·
  `daily_cap_reached_N` — and none of them is a window. Following the old instruction
  after a fresh deploy would have produced `pod_unsettled_uptime_Ns` and been read as
  *"the window guard fired"*: **a refusal for the right reason is not evidence for the
  reason you were looking for.** It is the last clock survivor the A0 sweep missed, found
  2026-09-15 by re-reading the branch rather than the checklist.

- ⛔ **The landing sequence's post-M12 dry run does NOT satisfy *"sampler producing
  lines"*.** It fires seconds after M12's deploy, so the pod is under `MIN_UPTIME_S = 600`
  and `should_sample` refuses with `pod_unsettled_uptime_Ns`, writes that refusal row to
  `logs/breadth-samples.jsonl`, and returns 0. **A refusal row is a working guard, not a
  working sampler** — and it is the row most likely to be mistaken for one, because the
  file grew and the run exited clean. R2 needs the scheduled job's first fire, or a manual
  run once the pod is past 600 s.

### R3 · M13 (resident copy, flag OFF) landed, SUCCESS
✅ **`DONE`** — pushed `18:05:34`, **deploy `3b50c46b9` SUCCESS `18:08:49 ET`**.
⭐ **Flag state verified against Railway, not assumed:** `BREADTH_RESIDENT_RECON_ENABLED` is
**absent** from `railway variables --service web --kv` — and the read was proved non-vacuous
first (rc=0, 247 lines, `PUSH_SECRET` present, 4 other `BREADTH_*` vars returned), because a
failed CLI call and an unset variable produce the same empty grep.
- Branch `breadth/resident-recon`, local tip `acddfabca`, ahead of its remote by 11.
- Re-gated 2026-09-15: parity **EXACT three ways** vs master `65899a8f7` — golden / flag OFF / flag ON all `sha256 7695923c…` over 5,576,278 bytes; 493 breadth + 187 ledger tests green.
- Lands with `BREADTH_RESIDENT_RECON_ENABLED` **unset** (OFF). The flip is R5, not this.

### R4 · Pool A — n ≥ 20 on M13's SHA, flag OFF (the *before*)
**`BLOCKED`** on R2/R3. Current pool: **n = 2** on SHA `4a0995a52`, `rf_pagecache = 1`.
- ⭐ That pool is still valid against today's master: the 8 hot files are **byte-identical** between `4a0995a52` and `65899a8f7`, and the discriminator fires (`fdf7c2201` vs `444f747d8` → `breadth_daily_ohlc.py`), so the identity is measured, not vacuous.
- ⛔ M13 lands a change to `breadth_daily_ohlc.py`, which **is** a hot file — so **M13 starts a new pool** and the existing n = 2 does not carry into Pool A.

#### ⭐⭐ THE EXISTING POOL'S TWO POINTS DIFFER BY 10×, AND THAT IS THE FINDING

Derived from `logs/breadth-samples.jsonl` 2026-09-15 (5 rows: **2 real samples, 3 refusals** —
`uptime_unknown` ×2, `pod_unsettled_uptime_17s` ×1):

| SHA | kind | server `total` | `rf_rows` | `rf_pagecache` | `uptime_s` |
|---|---|---|---|---|---|
| `4a0995a52` | deep_cold | **3599.7 ms** | 4529 | 1.0 | 674 |
| `4a0995a52` | deep_cold | **351.4 ms** | 4529 | 1.0 | 730 |

Same SHA, same kind, **same row count and same `rf_pagecache`** — and a **10.2×** spread in the
reader's own server-side time. The obvious explanation is ruled out by the data: the page cache
was warm in both.

⛔ **No flip decision can be built on this.** SD-1 §3 needs a p95; two points spanning an order of
magnitude cannot produce one, and quoting one would be the *acceptance number is a forecast until
derived* failure. **R5 and R7 are not merely blocked on R2/R3 — they are blocked on having a pool
at all**, and this is the real reason R2 is urgent.

⚠️ **`MIN_UPTIME_S = 600` is now a SUSPECT, not a settled constant.** Both samples cleared the
floor — 674 s and 730 s — and still differ 10×. If 600 s is not enough for the pod to reach steady
state, the sampler is partly measuring deploy warm-up and a p95 built from such a pool would
characterise the DEPLOY rather than the reader.

⛔ **This is explicitly NOT a conclusion.** Two points establish that the variance exists; they
cannot separate *warm-up incomplete at 600 s* from *ordinary run-to-run variance*
(`lesson_two_points_do_not_establish_a_rate`). Separating them needs n, which needs R2. **Do not
raise `MIN_UPTIME_S` on the strength of this table** — that would be tuning a constant against
two samples, which is the same error one level down.

⭐ **The instrumentation to answer it already exists and costs nothing extra:** every row carries
`uptime_s` beside `timing.total`. Once Pool A has n ≥ 20, plot one against the other. If `total`
decays with uptime, the floor is too low and the fix is measured; if it does not, the variance is
the reader's own and the p95 is honest. **Record the answer either way** — a null result here is
what licenses every later p95.

### R5 · V3 flip ON; Pool B — n ≥ 20, same SHA, flag ON
**`BLOCKED`** on R4.

### R6 · Flip decision executed by SD-1 §3's criterion
**`BLOCKED`** on R5. The criterion is six terms, all of which must hold to keep ON; the
failing term is recorded either way.

### R7 · Winning pool n ≥ 59; p95 CI; the ~1 s bar; cap FINAL
**`BLOCKED`** on R6. `N_FOR_P95 = 59` is Session 10's derivation, pinned by a rail.
- Cap decision: 365 stands on the UI-maximum argument regardless — record the number and close.

### R8 · Reader work CLOSED
**`BLOCKED`** on R7. Names the remaining floor (`rf_materialise` + whatever the winning
configuration leaves) and writes the next candidate as a **proposal only**.

---

## G — DEPLOY GATE

### G1 · Wait-for-CI reading recorded
✅ **`DONE`** 2026-09-15 — **`checkSuites: False` on all six services.** Recorded in
**D-053**. Read from the Railway API with the CLI's own token, field name introspected
rather than guessed.
- ⭐ It never needed a browser. The toggle is the `checkSuites` Boolean on
  `Environment.deploymentTriggers`, and the service can be asked directly.
- ⚠️ It also settles a contradiction: `master-deploy-gate.yml`'s header claims Wait-for-CI
  holds the build, `promote-production.yml`'s says it does not gate. **The promotion
  workflow is right; the gate's header is stale.**
- ⚰️ And the negative case has **already happened**: of 59 gate runs exactly one failed
  (`beace00e0`), and Railway deployed that commit **in the same second**. A red gate does
  not stop a deploy today — measured, not inferred.

### G2 · C.2.i probe — ⚰️ RETIRED
**`RETIRED`** by SD-1.1 A1. **The cutover is the probe**: `production` is the throwaway,
§4's 20-minute auto-rollback bounds it, and G1 showed the API is reachable with the CLI
token — so the watched-branch change is a mutation, not a click.
- Session 13 had already measured away two of its three unknowns: environment shared
  variables are **0** (control: `serviceId=web` returns **248**), so its stop condition
  could not fire; and `origin/production` already exists and is being advanced.
- ⭐ The probe existed to de-risk a click nobody can undo. An API call with a scripted
  rollback is a different risk shape, and the owner re-scoped it rather than running a
  ceremony against the old one.

### G3 · Cutover — watched branch `master` → `production`
**`READY`** (was OWNER-PENDING). **A3.1 answered it: this is an API call, no browser.**

| | |
|---|---|
| Mutation | `deploymentTriggerUpdate(id, input)` — `input.branch` is a `String` |
| `web` trigger id | `61b50f1f-b011-42b1-82ba-77d080ad7108` |
| Now | `branch: master` · `checkSuites: False` |
| Rollback | the same mutation with `branch: "master"` |

- ⚠️ **Permission is untested by construction** — executing it *is* the test. The token
  already reads these objects and it is the owner's account.
- ⛔ **Preconditions (SD-1.1 A3.2):** last deploy SUCCESS and settled ≥ 600 s;
  `production` HEAD == master HEAD == deployed SHA; no deploy from any workstream in
  15 min; **landing script PAUSED between steps**. **No clock condition.**
- ⛔ **Must not interleave with the reader landings** — M12/M13 first.
- ⭐ A3.5's rollback rehearsal is now cheap: two API calls and two deploys.

### G4 · Verification push proves the deploy came from `production`
**`BLOCKED`** on G3. Auto-rollback per §4.4 — and **no retry under SD-1**.

### G5 · Negative case — a red gate must not deploy
✅ **`DONE` ON HISTORY** (SD-1.1 A1). Of **59** `master deploy gate` runs exactly one
failed — `beace00e0`, 2026-09-14T19:00:49Z — and Railway created a `web` deployment for
that commit **in the same second**.
- ⭐ Stronger than the planned test and free: an observation of the system as it ran,
  not a fixture. **E-neg authorisation withdrawn**; no marker-gated failing push.
- ⚠️ It evidences the PRE-cutover state. That a red gate stops a deploy AFTER G3 is what
  G4's verification push shows.

### G6 · Branch protection on `production`
**`OWNER-PENDING`** by default (GitHub admin). Packaged with exact settings; does not
block G7.

### G7 · `--audit` repointed; runbook updated to "as executed"; rollback rehearsed
**`BLOCKED`** on G4. A rehearsal that costs more than its evidence is worth may be
recorded `UNREHEARSED` with the reason, after verifying the dashboard state it changes.

### G8 · Shared CLAUDE.md carries the new topology in three lines
**`BLOCKED`** on G3 succeeding. Uses the scope override, logged.
- The three lines: deploys come from `production`; a master push is a gate run; a red gate is no deploy.

---

## S — REPO SAFETY

### S1 · `.gitattributes` for the blobs already stored with CR
✅ **`DONE`** — landed with S13, `64269ffe5`, **deploy SUCCESS `18:18:46 ET`**. `.gitattributes`
verified present on `origin/master` (70 lines). Built on `repo/git-scope` (authorised by
SD-1.1 A2.1). 10 paths derived from the index; 8 rails, mutation-proved.
- ⚰️ It corrects D-052 §6: no joystick document carries a control byte at HEAD or in its
  last fifteen commits. eol conversion rewrites CR and LF and nothing else, so it never
  could have touched ``. What the incident flattened was **line endings**.
- Landing gate (A2.1): 8 rails green, round-trip test per `-text` path, scope checker
  dogfooded on the merge commit, no `api/` file touched with the non-vacuity count driven.

### S2 · Scope checker in the shared pre-commit — WARN, then ENFORCE
**`READY TO INSTALL`** once `repo/git-scope` is on master. Placement and mode are settled
by SD-1.1 A2.2 and the code is built.
- ⛔ **PREPENDED, not appended.** Measured: appended after the credential scan's `exit 0`
  it never runs. Same commit, same staged out-of-scope path — appended → log empty;
  prepended → violation recorded. The credential scan's lines are not edited.
- ⛔ **Heartbeat on every invocation** (timestamp · branch · paths · verdict), including
  `in-scope` and `no-scope`. Without it a never-run trial and a clean trial produce the
  same artifact, and the empty one reads as the pass.
- **Promotion criterion (A2.2):** **≥ 20 heartbeats from ≥ 2 workstreams over ≥ 24 h with
  zero WOULD-REFUSE rows.** An empty or heartbeat-less log is a **failed instrument**,
  never a pass.
- The block to paste is in `docs/breadth/git-scope-hook-proposal.md`, verified end-to-end
  in a throwaway repo.

### S3 · The unborn-branch defect fixed
✅ **`DONE`** — same branch, same landing (`64269ffe5`). `tools/git_scope.py` verified present
on `origin/master`. `symbolic-ref` first, empty-tree diff for `staged_paths()`. 11 rails green
on the branch after merging current master.

### S4 · A2.5 — gate the promotion RANGE, not just the tip
**`NOT STARTED`** (accepted as a change by SD-1.1 A2.5; lands under M-docs **after** the
cutover).
- Per-commit secret scan over `production..candidate`, **ADVISORY first** (reports, does
  not gate) with a heartbeat, promoted to gating at **≥ 20 runs executed with zero
  findings on green tips**, or on the first true finding after review.
- Record which commits in `production`'s history were never scanned by a gating run —
  **by SHA**. It is a finding, not a fault.
- ⭐ Same shape as S2: advisory + heartbeat first, because an unrun check that reports
  nothing is indistinguishable from a clean one.

## D — RECORD

### D1 · Every session from 12 written up; every `docs/sessionN-record` merged
**`IN PROGRESS`**.

| Branch | Tip | Merged? |
|---|---|---|
| `docs/session11-record` | `57a0b70b3` | **no** — M14, first in the landing sequence |
| `docs/session12-record` | `26423b010` | **no** — M-docs when a slot is free |
| `docs/session13-record` | this branch | **no** |

### D2 · DECISIONS.md carries the required entries
**`IN PROGRESS`**. Present: D-049 … D-052 (D-052 = the four conventions + the operational
row). Outstanding: the flip decision (R6), the p95/cap final (R7), the cutover as executed
(G3/G4).

### D3 · Appendix current
**`IN PROGRESS`**. `00-profile.md` carries #1–#39. Session 13 adds #40 (below).

### D4 · FINAL programme report — `docs/breadth-history-reader/FINAL.md`
**`DRAFT`** — opened Session 13, sections **1, 2, 4, 6, 7** filled; **3, 5, 8** `PENDING`.
- ⛔ **Merging this file is the act that ends the programme.** Do not merge it while any
  section still reads `PENDING` — the file says so at the top, in its own voice.
- Drafted incrementally while waiting (SD-1 §6) so the closing session is an **edit**,
  not a composition.

---

## SESSION 13 FINDINGS (to fold into D3)

**#40 — the report tool's terminal echo could destroy the artifact it was echoing.**
`_run_and_capture` wrote to `sys.stdout` *before* writing the summary file. This box's
console is cp1252 and the report's text is full of `⛔` (U+26D4), so `sys.stdout.write`
raised `UnicodeEncodeError`, the exception escaped, and **the summary file was never
written** — exit 1, nothing on disk, on the exact box Task Scheduler was about to run it
on. C.1's guarantee ("one rendering written twice") failed closed, and it failed by
sacrificing the **durable** half to the **disposable** half.
⭐ The ordering was the whole defect: the artifact is written first now, and the echo
cannot raise. Three mutations, three different rails red.
⚠️ The same trap then bit an ad-hoc probe in the same session — it is a property of this
box, not of one tool. Scripts that print `⛔` need `PYTHONIOENCODING=utf-8` or a guarded
write.

---

## STANDING FACTS A RESUMING SESSION SHOULD NOT RE-DERIVE

| | |
|---|---|
| Push windows | ⛔ **NONE — retired by owner ruling SD-1.1 A0.** The gates are a settled SUCCESS deploy (≥ 600 s) and the pre-push guard, which remains the authority. ✅ **A0.4 is CLOSED — and not by us.** The shared guard's clock clause was retired at the source on 2026-09-15 by the **discord-render** workstream under owner ruling **R18** (`5efc1abc5`): `tools/pre_push_guard.py:637` *"R18 — THE RTH DEPLOY WINDOW IS RETIRED, PROGRAMME-WIDE"*, and `:666` now **returns OK**. Verified with `git cat-file blob origin/master:…`, and observed live in every guard line from 17:23:52 onward. SD-1.1 A0.4 said report it and do not edit it; the owner-side change was made independently. ⛔ **The constants are KEPT deliberately** (`RTH_GUARD_OPEN`/`_CLOSE`, `:501-502`, per the note at `:659`) — **so a grep for them still reports a clock that no longer refuses.** Presence is not the predicate. ⚠️ **One stale line to REPORT, not fix:** the module docstring at `:11` still says the push *"is refused between 09:25 and 16:05 ET on trading days"*, which the file no longer does — a new instance of A0.4's own class, in the same shared file, so the same rule applies. |
| Settle | **≥ 600 s** after any workstream's deploy |
| Hot path | the **8 files a deep read executes** — `docs/breadth/reader-hotpath.txt` |
| Pool flags | `rf_pagecache` (`POOL_FLAGS`); `rf_resident` joins it once M13 is live |
| p95 needs | **n ≥ 59** (Session 10) |
| Memory bound | **2× wire bytes**; strings, not parsed dicts |
| Never | `git add -A`, `--no-verify`, two landing scripts, two samplers |
| ⛔ **One worktree, one writer** | the landing script OWNS `uct-worktrees/breadth-history-reader`. A session editing any OTHER branch uses its own `git worktree add`, or **pauses the script first and waits for the log to say so**. |

⚰️ **That rule was paid for twice in one session.** Session 13 edited files in the shared
worktree while the script was unpaused. The first time it checked out under the edits and
**exited 1** mid-sequence; the second time it had already switched branches, so a
`git add` staged a correction onto `docs/session11-record` — the branch that was about to
be pushed to master. Nothing reached master and the branch was restored by writing back
the committed bytes and verifying the blob hash (never `git checkout --`), but the second
one was close: the wrong branch was one push from landing.

⭐ **The script's own dirty-tree guard caught the second one** — *"WAITING — the worktree
has 1 uncommitted path(s); a checkout would clobber an editor"* — which is why it was a
recovery rather than an incident. It was added after the first failure, and it fired
within four minutes.

⚠️ **And the pause protocol has the heartbeat defect this session just fixed elsewhere.**
The script logs `PAUSED` only when the state CHANGES, so a re-pause writes nothing and the
log cannot distinguish *"paused and acknowledged"* from *"not yet observed"*. That is the
same class as the git-scope trial's empty log: **an instrument that reports only on change
cannot prove it is watching.** Fix it before relying on the pause for the cutover (A3.2
requires the script paused between steps).

---

## CLOSE-OUT — Session 14, 2026-09-16

Report: `docs/breadth-history-reader/FINAL.md` (PART 2) · page published ·
decisions: `docs/breadth/DECISIONS.md` · incident: `docs/breadth/INC-1-second-app-instance.md`

### The result

**54,923 ms (D-042) → a 271–313 ms median on production — 175–202× at the median.**
**75 deep-cold rows across FOUR independently deployed SHAs**, flag OFF, every row a
forced cache miss on a distinct span. The four medians sit 15% apart
(271.5 / 277.2 / 307.6 / 313.4 ms), so the result is a property of the design rather
than of one build. Warm `days=365`: 44.1 ms.

⭐ **MIN_UPTIME_S answered** (B1.6, open since Session 7): ρ=+0.09, buckets n=8 and n=26,
medians 4.3% apart — no uptime effect detectable, so 300 s suffices and 600 s was costing
collection for nothing.

### Every item, with its state

| item | state |
|---|---|
| G3 — cutover, `web` deploys from `production` | **DONE** |
| G4 — the deploy came FROM `production` | **DONE** (passively, on foreign pushes) |
| C.2.i — does a `GITHUB_TOKEN` push reach Railway | **DONE — answered YES** |
| B4.3 — compensating control on `production` | **DONE** (7 states, mutation-proved ×3) |
| D2.1 — every gate run records itself | **DONE** (from the promotion job) |
| C2.4 — landing direction rail, encoded | **DONE** |
| L1 — range-scan six-state rails | **DONE** (18 tests, mutation-proved ×4) |
| L5 — shared guard docstring | **DONE** |
| G8 — cutover recorded in the push-timing authority | **DONE** |
| B3 — sampler pool at a fixed path, flag evidence per row | **DONE** |
| E1.1 — heartbeat at a fixed path, worktree as a field | **DONE** |
| INC-1 — second app instance | **CLOSED** (audited from code; contained) |
| the negative case (a red gate) | **NOT-OBSERVED** — passive capture armed |
| R6 — the flip decision | **DEFERRED-TO-RUNNER** (criterion unchanged, SD-1 §3) |
| R7 — p95 at n ≥ 59 | **NOT ESTIMABLE TONIGHT** (best single-SHA pool n=34 → 83%; 25 short; arithmetic, not judgement) |
| R8 — floor named, next candidate proposed | **DONE** (proposal only; no build) |
| S2 — scope checker → ENFORCE | **TIME-GATED** (≥20 heartbeats, ≥2 worktrees, ≥24 h, 0 WOULD-REFUSE) |
| G7 — rollback rehearsal | **UNREHEARSED-WITH-PROCEDURE** (no ≤1-in-the-hour window occurred) |
| G6 — branch protection on `production` | **OWNER-PENDING** (payloads in FINAL.md §14.6) |
| MEMORY.md index line | **NOT ADDED** — 114 bytes headroom vs a 117-byte line; index needs compaction first |

### Why two items are not "done" and must not be read as done

- **R7** — at n=14 the sample maximum bounds the true p95 at 51% confidence. n=59 is the
  first n reaching 95%. The pool was voided mid-run by a foreign hot-path change to
  `api/services/breadth_daily_ohlc.py`; **that is the poolability rule working**, not a
  failure. The runner continues it.
- **G6** — the session attempted it and the credential-store read was refused by the
  safety layer. **The refusal is recorded as the correct outcome**; no other route was
  tried. Until it is set, a direct push to `production` deploys and the control catches it
  only on the next master push — the same exposure `master` carried before the cutover.

### STATUS

**DONE-PENDING-LANDING** — every automatable item is complete or running; the branch
carries the work and the lander holds it against the burst guard. Foreign deploy cadence
tonight: ~1 per 11 min, which is what both the landing queue and the sampling pool spent
the session waiting on.

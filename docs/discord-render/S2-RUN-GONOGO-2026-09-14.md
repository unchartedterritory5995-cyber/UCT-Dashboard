# D-04 Part 1 — the S2 production run: GO/NO-GO result

> ## ⛔ **NO-GO. The run did not happen and must not, on this branch, today.**
> One item fails, it fails **structurally**, and per 1.6 a partial run is not an option.

---

## The checklist, every item measured

| # | GO/NO-GO item | result | evidence |
|---|---|---|---|
| 1 | outside RTH | ✅ **PASS** | 2026-09-14 **23:53 ET Mon** — RTH is 09:25–16:05 |
| 2 | organic arrivals last 15 min = 0, from the job store | ⚪ **N/A** | `/data/discord_render_jobs.db` **does not exist in production** — V2 has never run there. There is no store to read, which is itself the answer: zero V2 arrivals, ever. |
| 3 | `RENDER_MAX_CONCURRENT` read in-process from chart-renderer | ⚪ **NOT REACHED** | blocked by item 6 |
| 4 | concurrency cap read in-process from the harness config | ⚪ **NOT REACHED** | the harness service does not exist |
| 5 | tripwires proven on the *deployed* harness service; tag exclusion proven | ⚪ **NOT REACHED** | same |
| 6 | **web running SHA = `c84c5d031` or the merged successor, in-process** | 🔴 **FAIL** | **the branch is not merged. 20 commits ahead of `origin/master`; `git merge-base --is-ancestor HEAD origin/master` → NO.** |

---

## ⛔ Why item 6 is structural, not a formality

R1's own limits are enforced **by code that exists only on this branch**:

| the run requires | lives in | in production? |
|---|---|---|
| 1.2 harness-request tag → job store column → `observe` exclusion | `jobs_store.py`, `runtime.py`, `commands.py` | ❌ **branch-only** |
| 1.3 organic-arrival + S1 tripwires | same | ❌ branch-only |
| OI-41's fix (a V2 job no longer told the queue refused it) | `discord_interactions.py`, `commands.py` | ❌ branch-only |
| `refusal_reach_ms`, so the run can be observed at all | `jobs_store.py` | ❌ branch-only |

Every one of those four files **DIFFERS from `origin/master`** (measured, `git diff --quiet` per file).

⭐ **So running against production today would mean running with none of the safety machinery the
ruling requires.** Harness rows would enter the S1 and S5 production populations — the exact thing
1.2 exists to prevent — and no tripwire would exist to pause on an organic arrival. The checklist
did its job: it refused a run that would have produced an artifact nobody could trust *and* polluted
the populations the gate judges.

---

## What making item 6 pass would cost — an OWNER decision, not a session's

It is one action: **merge 20 commits to `master` and let `web` redeploy.**

| consideration | measured |
|---|---|
| member-visible behaviour change with V2 off | **none that I can find.** `slot_wait_s` defaults to `0.0`, so V1 is byte-identical; the OI-41 mapping is inside the `fail_fn is not None` branch that only V2 supplies; `services/chart_renderer/**` is not deployed by a push (no repo source). |
| what it does do | **restarts `web`**, costing every in-flight render and any scheduler slot whose minute falls in the swap |
| window | 23:53 ET — **outside** RTH, so the window permits it |
| ⚠️ queue state | `/api/health` reports `uptime_seconds: 183` — **`web` restarted ~3 minutes ago**, i.e. another push is in flight. The standing rule is ONE master merge at a time, with `web` SUCCESS confirmed before the next. That deploy must be green first. |

⛔ **I am not merging 20 commits to production on a delegated ruling.** R1 authorises the *run*; it
does not say "merge the branch", and the merge is the larger act — it is the one that changes what
~1,558 members' `web` pod is executing. That is the owner's call, and it is the only remaining
blocker.

---

## What IS ready, so the next session starts from GO

Design and preparation are complete and committed (`CANARY-RENDERER-DESIGN-2026-09-14.md` plus this
file). The measured facts that shape the run:

- `POST /render` takes the URL **from the caller**, so a harness chooses what is screenshotted;
- `check_url` enforces https **and a host allowlist**; `RENDER_MAX_CONCURRENT` defaults to **2**, so
  R1's "cap ≤ MAX − 1" means **a concurrency of 1** against a default renderer — state that plainly
  before anyone plans a ladder;
- C-13's redaction is **code**, so a harness service built from this repo inherits it;
- creating/deleting a non-repo-connected service **cannot** redeploy `web` or `flow-worker`.

**Minimum N for the S2 row, stated as R1 requires:** with a cap of 1 concurrent render and ≤ 400
offers, the design burst (0.6/s) over 15 minutes yields ~540 offers — so **N ≥ 120 judged deliveries
per tier**, below which the row reports NOT MEASURABLE rather than a percentile. ⛔ That number is a
*floor for reporting*, not a target to grind toward: p99 over 120 samples is one sample, and the row
must say so.

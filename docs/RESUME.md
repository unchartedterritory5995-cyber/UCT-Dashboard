# RESUME — restart checkpoint 2026-09-14 13:50 ET (Monday, midday)

## a00. The midday state, and the four things that are blocked

**Master `db23f17e8` is live and verified in-process.** Two further commits (`abda0e0d0`,
`26a88d052`) are **gated, green and queued** — master's own pre-push guard refused them because
another session's deploy was in flight, and the override was deliberately not used.

| Ruling | State |
|---|---|
| Gap 1 — cache wired to the hot path | ✅ **merged**, 80 % hit rate on the bench, 8 mutations red |
| Gap 3 — `/chart` shadow | ✅ **settled**: the hook fires (mutation-proved); the absence was real traffic absence, confirmed by an EXACT pull **and** by the chart production log |
| OI-32 — never cache a stand-in | ✅ **merged**, refused at BOTH tiers |
| NOT-APPLIED ≠ 0 | ✅ **fails in the gate** (`tests/test_mutation_harness_anchors.py`), one second, plus per-retirement cross-references |
| Gap 2 — S2 in `--real` | 🟡 **built and self-checked, NOT RUN.** Needs a delivery channel |
| Gap 4 — 3.5 smoke | 🔴 **blocked**: no channel is both bot-postable and not Contributor-visible |
| Step 1.3 — `#render-alerts` | 🔴 **measured**: `Contributor` is the channel's ONLY view-allow overwrite |

⛔⛔ **THE ONE OWNER ACTION THAT UNBLOCKS THE MOST:** grant the bot's role
(`UCT Intelligence`, `1474903498700230668`) **`MANAGE_CHANNELS`** — then
`discord_channel_admin.py --create-smoke` makes `#render-smoke` with itself inside it, and 3.5 plus
the `--real` delivery hop both unblock. ⚠️ That grant does **not** fix `#render-alerts`: 50001 there
is *membership*, and the bot has no overwrite on that channel. Two gaps, two fixes.

**Flip gate: `NOT MET`** — `python docs/discord-render/instruments/flip_preconditions.py`.
Three rows NOT MET, five NOT MEASURABLE, **organic members exposed 0**.

**Shadow at 13:39 ET: 33 records, EXACT, all `/flow`, all agree, zero divergences, zero `/chart`.**
No member ran `/chart` today — confirmed twice over.

⚠️ **Live finding worth a look:** the warm cycle is still blowing its 20 s budget continuously
(`hot warm hit its 20s budget after 20.0–22.8s, N chart(s) deferred`, many times an hour through
RTH). That is **C-09**, still open, and it is happening now.

---

# RESUME — earlier checkpoint 2026-09-14 03:50 ET (Monday, pre-RTH)

> ⭐ **THIS HEADER IS THE CURRENT ONE. The sections below it were written at 2026-09-13 20:45 ET
> and are superseded where they disagree with §a0.** They are kept because §f (standing rules),
> §h (the rest of the machine) and §i (gotchas) have not moved and are still the fastest read.

## a0. Where it actually is, 2026-09-14 03:50 ET

**Master `e269f2b10`, deployed SUCCESS, verified in the RUNNING process** (not `--kv`):
`RENDER_V2_SHADOW='1'` · `DISCORD_RENDER_V2_ENABLED` **absent** · `delivery.edit_image`,
`bindings._fold_attachments`, `renderer._with_vintage`, `badge.render_footer(quality=…)` and
`JobRuntime.send_failure_result` all present · `l2_root` = `/data/discord_render_cache`.

**Every forensics class this programme owns now has a PASSING regression test.** C-04, C-06 and
C-07 were `xfail(strict=True)` at the last checkpoint; all three are closed **on the V2 path**, and
`01-failure-forensics.md` has a section explaining exactly what that qualifier costs. Zero xfails
remain in `tests/test_discord_render_forensics.py`.

| Ruling | Landed | Where |
|---|---|---|
| **OI-29** — the chart IMAGE through `delivery.edit_image`; C-04 closed by the attachment fold | `decd049c1` | `delivery.py`, `adapters/bindings.py`, `commands.py` |
| **C-06** — the stand-in label, derived in the V2 wrapper; `bindings` consumes `badge.py` at last | `b5a4e1a31` | `adapters/bindings.py` |
| **C-07** — `?stale=` end to end **and its producer** | Lane D + `b5a4e1a31` | `discord_chart_house`, `badge.py`, `ChartRender.jsx`, `adapters/renderer.py` |
| **OI-31** — the two-tier cache, L2 on the volume | Lane B | `artifact_cache.py`, `03` §3.6 |
| **OI-28** — the chart-renderer reds adopted and fixed | Lane C | the renderer test loaders |
| the per-attempt budget made structural, + a SECOND overrun in the retry backoff | Lane C | `adapters/_call.py` |
| **Step 3** — load, chaos, determinism | `a82a2493c` | `docs/discord-render/evidence/step3/` |

**Step 3 results:** load p99 **102 ms** against a 1,000 ms SLO with zero acks over 3 s · chaos
**13/13** (the harness had 5 scenarios and the brief named 12 — the other 7 were written) ·
determinism **20 runs, 6/6 identical** including an L1→L2 round trip.

⛔ **NOT DONE, and it is the one thing standing between here and a flip packet that can be acted
on: 3.5, the real-Discord smoke.** It needs a human to type commands in the private test channel;
no agent can do it. Everything else in Step 3 is evidence about a rig.

⛔ **Three scheduled jobs are running and their logs are the next thing to read.** All three were
fired by hand once and their output verified, so none of them is a job nobody has seen run:

| Task | Cadence | Log |
|---|---|---|
| `UCT Render Soak` | every 15 min | `C:\Users\Patrick\uct-render-soak\soak.log` — at 02:20 ET, 5 ticks, 262 samples, **no drift** |
| `UCT Render Alerts Access Probe` | hourly (the owner-hand item) | `render-alerts-access.log` — `STILL_BLOCKED HTTP 403 code 50001` |
| `UCT Render Monday Shadow Line` | once, **07:45 local = 08:45 ET** | `monday-shadow-line.log` — pulls the `drender` logs and runs `shadow_report.py`, then appends every soak totals line |

⭐ The third exists so the pre-09:30 line is produced **whether or not a session is alive to write
it**. Read that log; do not re-derive it by hand.

**The Monday line**, as of 05:40 UTC: **≥ 8 records, all `/flow`, all `agree`, p50/p95 0.1 ms, zero
divergences — and zero `/chart` records**, which the tool refuses to read as clean. The `≥` is not
decoration: `railway_env_logs.py` printed `STOPPED: no progress past …`, so the count is a FLOOR.

---

Written by **Lane F** of the Discord render hardening programme (`docs/discord-render/`).

⛔ **Every claim below names a SHA, a `file:line`, or the command it was measured with.** Anything
that could not be verified while writing this is marked **UNVERIFIED** and says what would settle it.
A resume file that asserts a state nobody can re-derive is how the last restart cost an hour.

One command re-runs the checklist in §g:
`powershell -ExecutionPolicy Bypass -File C:\Users\Patrick\uct-worktrees\discord-render\scripts\resume.ps1`
— ⚠️ but read §g first: two of its pins are stale.

⚠️⚠️ **EVERY SHA IN THIS FILE IS A STAMPED READING, NOT A STANDING FACT.** Five workstreams push to
this repository; `origin/master` moved twice and `web` deployed twice while this file was being
written (`e659454bb` → `cda883387`). Re-derive with §g before acting on any of them. The parts that
do not churn — the lane map, the open decisions, the standing rules — are the parts to trust on
sight.

---

## a. Where the programme is

**Phase 2, step 2.4b P2 — merged to master and live-DARK.** Master merge 5 (`5ca4d5db2`) shipped the
provider adapters, the member-facing stamp, the breaker and loop-stall alerts, the event-loop probe
and shadow mode; the merge-5 record (`954309f0f`) and the frozen cross-lane contracts
(`e659454bb`) followed. `docs/discord-render/05-progress.md` carries the measured deploy for each.

| Step | State | Evidence |
|---|---|---|
| Phase 0 (map, forensics, baseline) · Phase 1 (architecture) | closed | `docs/discord-render/00`–`03`, `LEDGER.md` Phase summaries |
| 2.1 runtime · durable jobs · deadline · failure contract | merged dark | `740b79ad5` (LEDGER row 4) |
| 2.2 observability · render-health · alerts | merged dark | `6d779dd47` (row 6) |
| 2.3 renderer hygiene · hard ceiling · warm pool | merged; chart-renderer deployed | `d32d14d60` (row 8) + deployment `6090d306` (row 9) |
| 2.4a symbol resolution · `/flow` ETF partition | merged dark | `d623baf1d` (row 11) |
| 2.4b part 1 market clock + freshness envelope + breakers | on the branch | `9087bc196`, `4984e6207` (Phase 2 summary) |
| **2.4b P2.1–P2.10 adapters, stamp, alerts, loopwatch, shadow** | **merged dark** | **`5ca4d5db2`** (row 14), gate 1,112 passed, 69/69 mutations red |
| Cross-lane contracts frozen | **merged** | **`e659454bb`** — `api/services/discord_render/contracts.py` + `tests/test_discord_render_contracts.py` |
| Shadow mode flipped ON + its record made interpretable | on the branch | `9a7043317` (`shadow.py`, `tests/test_discord_render_shadow.py`, `08-merge-queue.md`) |
| P2.10 bench + wall clock + two instrument failures | on the branch | `ef8bdca06` (`05-progress.md`, `instruments/adapter_overhead_bench.py`) |
| 2.5 cache · 2.6 delivery · 2.7 visual+goldens · 2.8 forensics regressions | **in flight, lanes B–E** | `docs/discord-render/07-execution-plan.md` §3 |
| Phase 3 (canary, bench, RTH) · Phase 4 (the flip) | not started | — |

**Shadow mode is ON in production** (`RENDER_V2_SHADOW='1'`, read in-process — §c; flipped and
ledgered by Lane A in `9a7043317`). That was 07 §6's "live and ON before Monday 09:30 ET" target, and
it is met.

**Nothing a member can see has changed.** `DISCORD_RENDER_V2_ENABLED` is absent from the running
process, and with it absent the interactions endpoint runs the pre-V2 path exactly
(`api/services/discord_render/commands.py:49`, railed).

---

## b. The very next actions, in order, with their commands

**1 — Re-establish state before touching anything** (30 seconds; run these first after any restart):

```sh
cd C:/Users/Patrick/uct-worktrees/discord-render
git fetch origin && git status --short && git rev-list --count HEAD..origin/master
railway deployment list --service web --json | head -40      # newest SUCCESS + its commitHash
python docs/discord-render/instruments/verify_merge.py <expected_sha_prefix>
```

**2 — Read the shadow divergence, which is the one number the flip decision rests on.** Shadow has
been recording since the flip of `RENDER_V2_SHADOW` earlier this session; it is worth the most
through Monday's RTH:

```sh
python tools/railway_env_logs.py --filter drender
# then count lines with "evt":"shadow" and "divergence":true
```

`divergence` = V2 would have refused a symbol the old path went on to draw
(`api/services/discord_render/shadow.py:94`). ⛔ Search the bare word `drender` — Railway's log
search silently matches nothing for a bracketed phrase (`api/services/discord_render/observe.py:9-11`).

**3 — Lane A integrates whatever lands first** through `docs/discord-render/08-merge-queue.md`. On
the programme branch at 20:45 ET that queue lists **all five lanes B–F in flight, every one gated
against `e659454bb`** — so re-read it on `discord-render-hardening`, not on master, where it may lag:
`git show discord-render-hardening:docs/discord-render/08-merge-queue.md`. One master merge at a
time; `web` SUCCESS and the running SHA confirmed in-process before the next push.

⛔ **A queue row is only "ready" if it names the SHA it was gated against**, and master moves under
this branch every few minutes. Re-gate only what master's movement actually invalidates, and record
which of the two happened (`08-merge-queue.md`'s own rules).

**4 — The RTH baseline is still missing.** `02-baseline.md` is a closed-market bench and says so
("RTH baseline pending (Monday)"). `tools/discord_render_bench.py` is the instrument.

**5 — The flip, when the owner decides:** `docs/discord-render/06-flip-packet.md` — written to be
read alone. Day-two operations: `docs/runbooks/discord-render-operations.md`.

---

## c. Live production state — measured 2026-09-13 20:44 ET / 2026-09-14 00:44 UTC

| Fact | Value | Command |
|---|---|---|
| `web` newest deployment | **SUCCESS**, commit `cda883387887…`, created `2026-09-14T00:41:31.783Z` | `railway deployment list --service web --json` |
| Running commit, **in-process** | `cda883387887` (= `origin/master` at the time of reading) | `railway ssh` probe (recipe in `06-flip-packet.md` §2.3) |
| `DISCORD_RENDER_V2_ENABLED` | **absent** | same probe |
| `RENDER_V2_SHADOW` | **`'1'`** | same probe |
| `DISCORD_RENDER_V2_ADAPTERS_ENABLED` · `DISCORD_RENDER_LOOPWATCH_ENABLED` | absent (= ON; dormant while the master is off) | same probe |
| `/data/discord_render_jobs.db` | **does not exist** — V2 has never run in production | same probe |
| `DISCORD_RENDER_ALERT_WEBHOOK` | configured on `web` (private `#render-alerts`) | `railway variables --service web --kv`, key only |
| `CHART_RENDER_TOKEN` + `CHART_RENDER_TOKEN_PREVIOUS` + both `VITE_` halves | all four present — **a rotation is in flight** | same |
| chart-renderer | `RENDER_POOL_ENABLED=1`, `RENDER_WARM_URL` set | `railway variables --service chart-renderer --kv` |

⭐ The **absent jobs database** is the proof that V2 has never run, and it is stronger than a zero job
count — a zero count is also what a wrong query returns (`LEDGER.md`, post-restart close-out B).

⚠️ **`--kv` is the service's CONFIG, not evidence the running process has it.** The five rows above
marked "in-process" were read from the process; the `--kv` rows are configuration only, and are
reported as such.

**UNVERIFIED (and cheap to settle):** whether the Monday one-shot Task Scheduler job
**`UCT Render Token Retire`** (2026-09-14 07:15 CT) is still registered and enabled. It clears only
the `_PREVIOUS` pair, gated on Morning Wire having run that day (`LEDGER.md` step 1.1b). Settle with
`schtasks /query /tn "UCT Render Token Retire"`.

---

## d. HEAD state, branches and the lanes

| Checkout | Branch | State at 20:45 ET |
|---|---|---|
| `C:\Users\Patrick\uct-worktrees\discord-render` (**Lane A**, the programme) | `discord-render-hardening` | **`ef8bdca06`** — 1 ahead of `origin/master` (`cda883387`), which it has already merged. Two programme commits not yet on master: `9a7043317`, `ef8bdca06` |
| `.claude/worktrees/agent-*` (**lanes B–F**) | `worktree-agent-<id>` | five branches, all created at `e659454bb` 2026-09-13 20:23 ET; **none had committed** when this was written. They are now 18 commits behind `origin/master` — re-measure with `git rev-list --count HEAD..origin/master` before gating anything |

Lane ownership, and it is the rule that keeps two lanes off one file
(`docs/discord-render/07-execution-plan.md` §3): **A** integration/merges/bench · **B** 2.5 artifact
cache · **C** 2.6 delivery · **D** 2.7 badge + visual spec + goldens · **E** 2.8 + Step-3 harnesses
(**no `api/**` change at all**) · **F** docs, runbook, flip packet, `docs/RESUME.md`.

⛔ **A lane that needs a change in another lane's file writes a contract-change request in its ledger
row and proceeds on its own side.** Never two lanes editing one file.

⛔ The five frozen contracts are `api/services/discord_render/contracts.py` (merged at `e659454bb`);
a change to any of them after the lanes are running is a **ledgered event with a reason**.

---

## e. Open decisions (OI) — the ones still open, with who owns them

Full text for every row is `docs/discord-render/LEDGER.md` ("Owner decisions") and `03` §6. Closed
since the last checkpoint: **OI-09** (`/renderhealth` registered, step 1.2b), **OI-12** +
**OI-17** (renderer connected to the repo with watch path `services/chart_renderer/**`, pool and warm
URL live, step 1.2), **OI-13** (token rotated, step 1.1b — see the Monday retire job),
**OI-19** (dual-token acceptance, step 1.1a), **OI-21** / **OI-23** (built in P2.1).

| OI | What is still open | Owner |
|---|---|---|
| OI-03 | web vs a dedicated worker service — revisit after 5 sessions of `resumed` data | programme, after the flip |
| OI-04 | fold the context line into the image PATCH (kills the last attachment re-declaration) | **Lane C** (2.6) |
| OI-06 | label the stand-in on the image **and** in the message | **Lane D** (2.7) |
| OI-07 | per-class `/flow` wording shipped (2.1a); the **≤10-minute cached flow card is not built** — `grep cached api/services/discord_render/adapters/flow.py` returns nothing | Lane A / B |
| OI-10 | D-02's 30 s RTH cache TTL vs today's 120 s — measure once 2.5 exists | **Lane B** (2.5) |
| OI-11 | per-window `/flow` targets are set (1 → 4.4 s · 7 → 4.9 s · 30 → 8.7 s · all → 10.4 s); the RTH measurement is outstanding | Lane A, Monday |
| OI-14 | ~77 `web` deploys/day is the root of C-01 for every feature on the pod | **recorded only — out of scope** |
| OI-15 | flow-worker `/ticker-flow` has no internal time budget (partner file) | **flow-worker owner** — raised, not built here |
| OI-18 | the renderer hard ceiling defaults to the request's declared budget; drop it to 20 s once web's attempts are re-budgeted inside the 15 s deadline and RTH p99 is measured | Lane A/C, after 2.6 |
| OI-20 | the hygiene gate as an opt-in pre-commit hook (installing one reaches ~57 worktrees) | deferred, documented |
| OI-22 | a quote failure is still indistinguishable from "no extended-hours print"; bounded now, the split needs `fetch_ext_quote` to raise (pre-V2 behaviour change) | **Lane E** (2.8) |
| OI-24 | `discord-chart-produce` is spawned without `ids.carry`, so chart-production events are unattributable (pre-V2 file) | **Lane E** (2.8) |
| OI-25 | the fixed 1.5 s bars retry lives in the caller; the binding passes `attempts=1` so they cannot multiply. Moving the loop is a pre-V2 change | **Lane E** (2.8) |
| OI-26 | ⛔ the pre-push **secret scan has never run** for any worktree but one, and this is a **public repo**: `tools/secret_scrub.py` exists only on `feat/breadth-charts`. The hook prints "the secret scan did NOT run. This is not a pass." and proceeds | **`feat/breadth-charts` owner** — land the tool on master and every worktree's hook starts working |
| OI-27 | `RENDER_V2_SHADOW` is **structurally undeclarable** in `docs/feature_flags.json` — the scanner only sees gates whose name contains `ENABLED`/`DISABLE`. Declared in `03` §3.8d + `LEDGER.md` instead | **flag-ledger programme** (widen `_GATE_MARKERS`) |

⛔ **Step 1.3 is NOT done and is blocked two ways:** `#render-alerts` inherits ADMIN CHAT's access,
which includes the **Contributor** role. The Claude browser extension is disconnected, and the bot
token gets `403 Missing Access (50001)` on that private channel — granting access needs the very
permission that is missing. ⚠️ Not a member-data exposure: the channel carries queue depths, latency
percentiles, failure classes and correlation ids. Posting is unaffected (a webhook does not need read
access), which is why the test alert landed. `LEDGER.md`, step 1.2b/1.3.

---

## f. Standing rules this programme runs under

1. **ONE master merge at a time, repo-wide.** `web` SUCCESS **and** the running SHA confirmed
   in-process before the next push. `python tools/pre_push_guard.py` enforces it and fails closed
   (refuses while the newest `web` deployment is not a SUCCESS at least 150 s old).
2. **Everything ships DARK behind a flag. The owner flips.**
3. **Deploy tier is decided by the FILES, not the clock** — `docs/runbooks/deploy-windows.md` is the
   single authority. Anything on flow-worker's watch list is weekend/after-hours only, because a
   flow-worker restart drops the OPRA socket and Massive does not replay. Check with
   `python tools/flow_worker_watch_coverage.py`; a red needs an ADDITIVE / BEHAVIOUR-CHANGING
   classification written in the ledger row before the push.
4. **Backend pytest is SCOPED — named files, ≤6 per lane, never `pytest tests/`, never `-k` over the
   tree.** `-k` filters what *executes*; everything is still *collected*, and collection is where the
   memory goes. The full gate runs in Lane A only, one at a time
   (`07-execution-plan.md` §1). **No `npm ci` / `npx vitest` in a lane at all.**
5. **A run with no totals line is not a run**, and the background-task exit code is not a verdict —
   it has been measured wrong in both directions.
6. **Write the line endings git already stores**, not what is on disk. `python tools/check_repo_hygiene.py`
   (it was `clean: 9226 tracked file(s)` when this was written). ⛔ `git checkout -- <file>` is not
   an undo; it discards everything uncommitted in that file.
7. **Never `git add -A`** in a shared worktree; stage by path.
8. ⛔⛔ **H15 — a failing post-deploy smoke is rolled back FIRST and diagnosed second**, and
   **INCONCLUSIVE is not FAILED**.
9. Partner-owned files (`OptionsFlow.jsx`, `live_massive_router.py`, `schwab_router.py`) are out of
   scope for every lane; a minimal isolated diff, acked first, if ever unavoidable.
10. **Machine constraint:** ~8.6 GB free of 31.8 GB with other sessions live. One gate at a time on
    this box.

---

## g. Verification checklist — how to re-derive everything above

| # | Check | Command |
|---|---|---|
| 1 | worktree clean; branch == `origin/discord-render-hardening` | `git status --short`, `git rev-parse HEAD origin/discord-render-hardening` |
| 2 | master drift | `git rev-list --count HEAD..origin/master` (was **0**) |
| 3 | `web` newest deployment SUCCESS + its commit | `railway deployment list --service web --json` |
| 4 | the **running** commit and the flags, in-process | `06-flip-packet.md` §2.3, or `docs/discord-render/instruments/pod_env_probe.py` |
| 5 | `/api/health` 200 + uptime · bad signature → 401 · render-health without the bearer → 401 | `docs/discord-render/instruments/verify_merge.py <sha>` |
| 6 | chart-renderer ready | `docs/discord-render/instruments/renderer_health_probe.py` |
| 7 | flow-worker untouched by this branch | `python tools/flow_worker_watch_coverage.py` |
| 8 | line endings + tracked-file hygiene | `python tools/check_repo_hygiene.py` |

⚠️⚠️ **`scripts/resume.ps1` HAS TWO STALE PINS AND THEY FAIL SOFT.** `scripts/resume.ps1:16-17` still
read `$CodeTip = '3f71d5364'` and `$LastOnMaster = 'd32d14d60'`, consumed at `:66-67` and `:95-96` as
*ancestor* checks. Both SHAs **are** ancestors of today's tip (measured), so both checks print green —
and would keep printing green with the pod running a commit four merges old. ⭐ An ancestor test
against a stale pin cannot detect the drift it exists to detect. Re-pin both to the current tip
before trusting checks 2 and 4 of that script. **Lane F does not own `scripts/resume.ps1`** — this is
recorded here and in Lane F's report as a change request for Lane A.

---

## h. Everything else on this machine

Each programme keeps its own checkpoint; this file is the Discord render programme's:

- Notebook Wave Q1 → `docs/notebook/wave-q1-RESUME-HERE.md` — **on master**
- Joystick hub → `docs/plans/joystick/RESUME.md` — **on master** (programme CLOSED; one owner device
  run outstanding)
- Wisdom loop → `docs/wisdom/SESSION-STATE.md` — **on master**
- Indicator ecosystem → `docs/runbooks/indicator-ecosystem-resume.md` — ⚠️ **NOT on master**; it
  lives on `worktree-indicator-ecosystem` (`git show worktree-indicator-ecosystem:docs/runbooks/indicator-ecosystem-resume.md`)
- Terminal-Next → `docs/terminal-research/00-program-control/LEDGER.md` — ⚠️ **NOT on master**; it
  lives on `terminal-research` (`git show terminal-research:docs/terminal-research/00-program-control/LEDGER.md`),
  and `docs/runbooks/deploy-windows.md:51-52` points at it by that path

**The 2026-09-13 15:30 ET restart capture — 19 dirty checkouts captured and pushed, with the branch
and SHA for each — is in the previous version of this file: `git show b4c9e9bcc:docs/RESUME.md`
(§i).** It is not reproduced here because it is a completed one-off, and a stale copy of it is worse
than a pointer to the real one.

**Processes to restart: none.** Nothing in this programme runs locally. The `UCT *` Task Scheduler
jobs resume on their own.

---

## i. Known gotchas that cost time last session

- `railway ssh` from Windows: **Git Bash + `MSYS_NO_PATHCONV=1`**, the pipe quoted as `"|"`, and
  `/opt/venv/bin/python` (bare `python3` in the pod is the Nix system python with no app deps).
  Never Python `subprocess`; never discard stderr.
- **Cloudflare 1010-blocks raw `curl`/`python` user agents** on `uctintelligence.com` — send a browser
  `User-Agent`.
- **A status code without a body check is not a measurement.** `GET /api/r/movers` returned 200 for a
  made-up token because there is no such route and the SPA catch-all answered with HTML.
- **`railway variables --set` has been measured both staging and auto-redeploying** on this project.
  Set it, watch for a NEW BOOT by startup-line timestamp, then read the value in the process.
- **`railway redeploy --service flow-worker` re-deploys the commit it is already on** and drops the
  OPRA socket for nothing. The only discharge mechanism is a marker bump
  (`docs/runbooks/deploy-windows.md`).
- The Claude Code permission classifier refuses reading local credential stores, Railway
  feature-flag writes and Railway service-config changes. Ask the owner; never route around.

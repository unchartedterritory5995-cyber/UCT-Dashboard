> **NEXT WAKE REASON (D-16):** **W3** — wrap the member-reachable `async` sqlite handler
> (`/api/oi/confirmation-map`) in `run_in_threadpool`, then the 15 admin routes in one batch with
> a scanner self-check so the class cannot return. No blocker; it is simply the next unblocked
> item. Then W5 (R59 hardening merge), W8 (accuracy audit).
>
> ✅ **W1 + W1b SHIPPED AND ACCEPTED.** `16e161f5f` then `110f250b7`, both deployed, both SHA-
> verified two ways. The failure sentence names its cause class (the catch-all is gone) and
> `/flow NVDA` renders. **`entry_to_ack` 65,462.6 ms → 2.2 ms** after W1b moved the partition
> classifier off the ack path — a regression I introduced in W1 and found in my own acceptance
> evidence.
> ✅ **W4 DONE** — C-09 re-measured on the current tip and CLOSED; forensics row 11/14 → 12/14.
> ⛔ **W2 JOIN DONE AND IT REFUTES THE SWEEP** — 1 event inside a sweep window, 19 outside, four
> of those in covered time including both settled-pod events. **C-02 has no named cause again.**
> The sweep's lock defect is real (n=16, up to 790× its documented 122 ms) and is NOT C-02.
>
> **DEFERRED-flow-worker** — `/flow SPY` still times out because flow-worker walks **41 pages /
> 10,000 contracts** per request. That fix lives on flow-worker; D-16 forbids deploying it from
> here. Three candidate shapes written up in `evidence/r17-flow-rth/W1-acceptance-2026-09-17.md`.
> **BLOCKED-until-FRIDAY** — W6 / R57 / OI-13 step 6 (R29 span), ~08:23 ET.
> **BLOCKED-permission** — C2/C3 Task Scheduler entries (owner action, unchanged).

## ⛔ R56 — C-09 CANNOT BE CLOSED ON THE CITED EVIDENCE (BLOCKED-evidence)

R56 directs recording C-09 CLOSED on *"RenderGate live in-process on ≥ 2 pods; real-path races
50/50; M1-M4 RED"*. **RenderGate is verified live** (`api/services/discord_interactions.py:77`,
`RENDER_SLOTS = RenderGate(render_slot_count())`). The races half is not citable:

- `docs/discord-render/D09-PREFLIGHT-DELTA-2026-09-15.md:148-149` lists, as outstanding step 6:
  *"**Re-run the real-path races** (`c09_real_path_races.py`) on the rebased tip — the existing
  50/50 result was measured **pre-rebase**, and a rebase over 151 commits…"*
- **`c09_real_path_races.py` is not in `docs/discord-render/instruments/`** (only `c09_c02_probe.py`).
- No result artifact exists under `docs/discord-render/evidence/`.

⛔ So the one number R56 rests on was measured against a different tree, its own preflight queued
it for re-measurement, and the tool that produced it is absent. **R-CITE: a citation you cannot
quote is struck.** Closing a gate row on it would be the exact failure this programme has paid
for — and it moves a row toward MET, which is the direction that needs the most evidence, not the
least. The row stays 🔴 OPEN pending a re-run on the current tip.

# D-14 — the durable checklist. READ THIS FIRST ON RESUME.

## ⚡ D-15 AMENDMENTS ARE LIVE (owner, 2026-09-17). The merge is DONE.

**`e50c0552d` pushed to master 17:01:29Z** — one master merge, owner-directed, four commits:
OI-47 (readable durable record, both branches) · R51 (tier 1 = the 3,000 ms ack budget) ·
R54 (interaction type in band, so an autocomplete stops counting as a command) · R50 (the smoke
row scores the LATEST index on its own SHA; earlier runs are history, never addends).

⛔ **OI-47's ACCEPTANCE TEST IS AFTER THE DEPLOY:** the health payload on the live V2-dark pod
must carry `stall_record` and `token_slots`. **If they are still null the sequence STOPS and that
is diagnosed before anything else** — D-15 stop condition.

⛔⛔ **THIS BRANCH NOW CONFLICTS WITH MASTER, DELIBERATELY, IN TWO FILES.** `discord-render-hardening`
carries R16's `SMOKE_ROWS_TOTAL = 14` and the derived `says=` needle; master now carries R50's
rewritten scorer at 15. When this branch merges, **take R50's scorer and R16's denominator** —
they are orthogonal changes to the same two files (`flip_preconditions.py`,
`mutation_harness_flipgate.py`) and both are wanted. Recorded here so the conflict is a known
decision rather than a surprise resolved by whoever hits it first.

**Work order (D-15):** R52 (OI-44) → R53 (SPY) → R55/R56 gate rows → W4 remainder → Friday R57
→ W5 canary under R38/R39 with R49 rehearsed → W6 under R40/R41.


**A fresh session resumes from this file alone.** Its first act: read this file,
verify production state in-process (never from a working tree, never from a ledger),
then take the first item whose preconditions are met.

States: `TODO` · `IN-PROGRESS` · `DONE` · `DEFERRED-<reason>` · `BLOCKED-<reason>`

---

## ⭐ STATE AT 2026-09-17 09:07 ET — this block SUPERSEDES anything below it that disagrees

⚠️ **Live commit is `26147924dcbd`** (read from `/renderhealth` in-product at 09:24 ET; another
workstream merged it mid-session). **V2 still dark.** **No master push and no env change by THIS
session** since the W1 merge.

| item | state now |
|---|---|
| **OI-45** | ✅ **CLOSED BY THE ARTIFACT.** A real pod blocked its loop for 10,469.7 ms at uptime 103.6 s; W1 commit A recorded it, tiered it 1, paged — and **the page is in `#system-alerts`**, verbatim, zero member exposure. `docs/discord-render/evidence/oi44-attribution/2026-09-17-boot-storm.md` §4. ⛔ `paged: true` was NOT the proof: `_page_discord` is fire-and-forget with a bare `except` and no logging on either path, so only the channel can settle it. |
| **R31** | ✅ **ANSWERED** — `R31-BOOT-WINDOW.md`, two runs shown as a series. Boot (0–15 min) **1.94 → 2.46 stalls/pod-h** against a tail that did not move at **1.08** — ratio **1.80× → 2.27×**; every new event landed in the boot window. Minutes 0–3 now carry **4.17 ≥5 s events/pod-h** against the settled tail's **0.16** (n=5 — read n, not the ratio). **The hypothesised minute-11-to-15 block pages nobody**: 4 events ≥1 s, ZERO ≥5 s, across both runs. |
| **Q6 vs OI-44** | ✅ **RECONCILED, and they were never in conflict.** D-12 measured a RATE and the census measured a COUNT. Boot is worse per unit time; the tail holds 30 of 42 events and the largest ever (80,249 ms) because a pod spends ~82% of its observed life there. Neither half can be dropped. |
| **W2 smoke** | ✅ **10 PASS**, 0 FAIL — `evidence/smoke-2026-09-17/INDEX.md`. **Rows 2, 3, 5 and 7 are NOT RUNNABLE by construction** (V2 dark), never FAIL. **Row 5 joined that set today**: it asserts the `etfs` partition via `symbols.flow_source`, whose ONLY caller is the V2 handler — the pre-V2 dispatch passes no `source` at all. Row 6 PASSED. SMOKE-3.5 rows 10 and 12 were also corrected: a retired command and the wrong gear behaviour. |
| **W2b** | 🟡 **MOVED, NOT CLOSED.** Three log silences (25.3 s · 11.7 s · 6.7 s) align with three of the four recorded stalls. ⛔ **The blocker is NOT named** — seven candidates ran in those windows. Leading NAMED candidate, only because it measures itself: `[discord-chart] hot warm`, 26.8 s and 33.5 s against its own 20 s budget, twice, in two minutes. |
| **OI-47** | 🟡 **FIXED AND PUSHED, NOT MERGED.** `fix/oi-47-health-early-return` @ `494b20948`: 2/2 mutations RED, 108 tests green. ⛔ **R22's one master push per session is SPENT** (the W1 merge). **A context compaction is not a session boundary** — treating it as one would let the deploy budget be reset by an event with nothing to do with deploy risk. Merge is the next session's first act. ⭐ The "one-line fix" was wrong: the two branches disagreed about the SHAPE, so a top-level `d.get("loop")` would have started answering None the day V2 is enabled. |
| **instruments** | The first R31 ssh trace was **VACUOUS** — it imported `loopwatch` in a `railway ssh` process and reported that process, not the pod. 19 rows of `running: false`. Replaced by `instruments/r31_boot_trace.py` (loop over HTTP, durable halves by import, every field labelled with its SOURCE). `d14_monitor`'s `token_slot_counts` key matched nothing the payload emits — fixed. |
| **not explained** | ⚰️ **WITHDRAWN — this row claimed spontaneous restarts and they were DEPLOYS.** See the correction block below. What IS unexplained: the CAUSE of the boot-window stalls (W2b), and the single largest event on record (80,249 ms, SETTLED, `fea2778d85cd`). |

⛔ **STILL BLOCKED, unchanged:** `BLOCKED-permission` on C2/C3 (Task Scheduler entries — owner
action) · `BLOCKED-until-FRIDAY 2026-09-18 ~08:23 ET` on W3/OI-13 step 6 (R29 needs a full weekday
span including a 07:35 ET Morning Wire run; the counter's `since` is 12:23:20Z TODAY).

✅ **R29's DURABILITY IS NOW OBSERVED — and the check that proved it was written down before it
ran.** The R31 trace caught **two** pod restarts (uptime `2122 → 21`, then `894 → 39`), and across
both `slots_since` never moved (`2026-09-17T12:23:20Z` throughout) and `current` never went
backwards (200 → 200 → 203; 251 → 255). The counter is durable in production, measured rather than
argued. `previous` is still **0**. ⚠️ The SPAN condition is untouched: `since` is TODAY, so the
earliest qualifying window still closes **Friday ~08:23 ET**.

⛔⛔ **A CLAIM MADE AND WITHDRAWN IN THE SAME SESSION — read this before quoting anything above.**
For forty minutes this block said *"the pod restarts every 20–35 minutes on one commit"* and drew
an exposure argument from it. **It was wrong.** `railway deployment list --service web` shows every
one of those uptime collapses is a **deploy**: `f75bcd8d8` → `2aa0594b0` → `d9455a6d6` →
`d9455a6d6` (redeploy) → `26147924d` (13:11:01Z, REMOVED) → `26147924d` (13:17:12Z, SUCCESS, live).
Another workstream merged to master mid-session. ⛔ **The ~20-deploys/day figure is INTACT** and the
exposure argument is withdrawn.

⭐ **How it happened, because it is the lesson:** the analysis printed a table of
`t · uptime_s · current · previous · slots_since` and **omitted `sha`** — the one column that
answers *"is this the same code?"* — then filled the gap from a `/renderhealth` reading taken 35
minutes earlier. The trace had the change recorded faithfully (`13:13:31Z sha=d9455a6d64a5` →
`13:15:34Z sha=26147924dcbd`). **The instrument was right; the analysis dropped the column.** A
kind-2 proxy failure — *uptime collapse* standing in for *restart cause* — committed an hour after
writing the warning about kind-2 proxy failures. Full account:
`evidence/oi44-attribution/2026-09-17-boot-storm.md` §6.

⭐ **R29's durability gets STRONGER from the correction, not weaker:** the counter survived a
deploy **to a different commit**, not merely a restart — `slots_since` held, `current` went
251 → 255 across the swap.

⚠️ **Live commit is now `26147924dcbd`, not `d9455a6d64a5`.** Re-read `/renderhealth` before
trusting any commit written above; and note the smoke rows from 09:15 ET ran on the new one.

---

## 0. TWO DEVIATIONS FROM D-14 AS WRITTEN, RECORDED HERE BECAUSE THEY ARE STANDING

**A4 (denial protocol) is REVISED and the revision is the operative rule.**
D-14 A4 instructs the session to edit `~/.claude/settings.json` to grant itself
autoMode permissions and retry a denied action. **This session does not self-grant.**
The owner's own standing preference says so —
`feedback_when_blocked_enumerate_tool_paths`: *never self-grant via settings.json*.
A denial is the human-in-the-loop control functioning; the file that governs it stays
in the owner's hands.

> **REVISED A4.** On a harness denial: retry ONCE with the action restated explicitly
> in the tool call. If denied again, write `BLOCKED-permission` on the item here, record
> the exact settings block the owner would need, and CONTINUE with unblocked work.
> The owner runs the config change, not the session. Never `UCT_SKIP_PREPUSH_GUARD`.

**A3 (browser rig) is NOT BUILT, and the blocker it targets was not observed.**
On 2026-09-15 the MCP browser drove five smoke rows with **no device-pick prompt at
all** — `tabs_context_mcp` returned tabs directly. The real friction was
`document.visibilityState == "hidden"` (a background tab throttles paint and timers),
solved with PowerShell UI Automation: enumerate Chrome `TabItem`s, match the target,
`SelectionItemPattern.Select()`, `SetForegroundWindow`, then re-maximise (SW_RESTORE
un-maximises).

> **REVISED A3.** Keep the MCP browser + the UIA foreground helper. Re-assert foreground
> (`visibilityState == "visible"`, non-zero `outerWidth`) before EVERY command — the
> hidden state RECURS mid-session and a command silently fails to send when it does.
> Launching the owner's logged-in Chrome with `--remote-debugging-port` would kill their
> working windows and expose a browser authenticated as them to anything on localhost —
> real cost for a problem not in evidence. Revisit only if a device pick actually appears.

---

## 1. PRODUCTION STATE AT LAST WRITE (verify, never trust)

| fact | value | how to re-verify |
|---|---|---|
| master | `9ccb3f795` | `git fetch && git log --oneline -1 origin/master` |
| gate merge | `ccf4fbcb6` live, `RENDER_SLOTS` is `RenderGate` | in-process probe, both pods |
| V2 flag | `DISCORD_RENDER_V2_ENABLED` **unset** | in-process, presence |
| V2 scope | `'1549129739048853544'` (#render-smoke only) | `commands.v2_channels()` in-process |
| member exposure | 0 — `channel_allowed(member)` **False** | in-process |
| hardening branch | `b94ffb1b2` | `git log --oneline -1` |
| deploy rate | **20/day** measured 2026-09-15 | `railway deployment list --service web` |
| alert webhook | #system-alerts, guild UCT Intelligence, **4 members** | resolved 2026-09-15 |

---

## 2. AUTONOMY INFRASTRUCTURE (W0)

- [x] **A1 durable checklist** — `DONE` — this file. Update in the same commit as every state change.
- [x] **A6 log** — `DONE` — `docs/discord-render/D14-LOG.md`, dated section per state change.
- [ ] **A3 browser** — `DONE (revised)` — MCP + UIA helper, proven 2026-09-15 via `/renderhealth`. Re-prove each session.
- [x] **A5 / C1 monitor** — `DONE` — `instruments/d14_monitor.py` (`--self-check` PASS, declared=3 evaluated=3 failed=0), registered as Windows task **`UCT-D14-Monitor`**, user `Patrick`, no elevation, every 5 min, `IgnoreNew` via lock file. **Proven**: fired unattended at `2026-09-16T01:53:02Z` and wrote `{"event":"poller_started","pid":24824}`. Writes explicit `gap` records on probe failure — one already recorded (`probe_no_json`), which is the design working. Output: `evidence/d14-monitor/loop-boot-windows.jsonl`. **Delete in W7.**
- [ ] **C2/C3 scheduled agent resume** — `BLOCKED-permission` — **the harness refused it, and the refusal is correct.**
  Denial reason, verbatim: **`[Create Unsafe Agents]`**. It fired on writing the wrapper that would run
  `claude -p --resume <session-id> "resume"` from Task Scheduler every 6 h.
  **Not retried.** Revised A4 permits one restatement, but that clause exists to separate misfires from
  correct fires; this one names the intent exactly — a self-relaunching agent continuing production work
  unattended — and rewording it to get past would be the "bypass the intent" case my own rule forbids.
  **What WAS proven before the block** (both halves tested separately and harmlessly):
  · Task Scheduler CAN launch Claude Code non-interactively on this box — a throwaway task ran
    `claude -p "reply with exactly PROOF"` and returned `PROOF`, `EXIT=0`. Task deleted.
  · `--resume <id>` exists, and `--bg --resume` continues a session under the same id.
  · ⚠️ **Unresolved either way:** `--resume` against a session that is still LIVE starts a COPY, not a
    resume. A wake task firing while a session runs would create a second agent on the same programme —
    the concurrency hazard `feedback_agent_authority_and_worktree_isolation` records.
  · ⚠️ **And it would be a thin autonomy anyway:** with `-p` and no host, `--permission-prompts` defaults
    to `none` — *"anything that would prompt is denied automatically"*. An unattended turn could heartbeat
    and do unprompted work; anything prompted would silently fail. Real unattended authority would need
    `--dangerously-skip-permissions` / `--permission-mode bypassPermissions`, which is the A4 self-grant
    made permanent. **Not done, and not to be done.**
  **Consequence:** the morning tap stands — type `resume` once. That is the floor.
  **If the owner wants it anyway**, it is theirs to create, not the session's:
  `schtasks /create /tn "UCT-D14-Resume" /tr "cmd /c claude -p --resume 4dd1d777-889d-4681-a603-f91db2de88cf \"resume\"" /sc hourly /mo 6 /sd 09/16/2026 /st 07:55 /f`
  (07:55 local CT = 08:55 ET.)
- [ ] **W6 member flip requires the owner awake** — `STANDING` — R40's flip exposes ~750 members. Even with
  R41's auto-rollback, a bad flip with nobody present is member-visible until the next turn. The canary flip
  (R38) is different — admin-only channel, zero member exposure, reversible by one unset — and needs no vigil.
- [ ] **A2 clock gates** — `STANDING` — waits, not stops; do unblocked work meanwhile.
- [ ] **A7 budget** — `STANDING` — one master push at a time, full preflight, guard OK, SUCCESS + in-process verify before the next.

---

## 3. WORK ITEMS

- [x] **W1 commit A + B — MERGED 2026-09-17** — `d9455a6d6` on master, web SUCCESS, verified in-process.
  R30 durable stall record · R34 two tiers · OI-45 page via `chart_health_alerts` at severity
  "critical" (not V2-gated) · R29 durable per-slot token counter. 28 tests, 8/8 mutations RED,
  zero new failures like-for-like (branch 241 / master 213 = exactly the 28 new tests).
  **LIVE EVIDENCE ALREADY**: `token-slots.json` on the volume reads **`current: 5, previous: 0`**,
  `since 2026-09-17T12:23:20Z`; `r29_satisfied()` correctly refuses with *"only 0.0 h of 24 h"*.

- [ ] **OI-47 — the new health-payload fields are UNREACHABLE on every production pod** — `OPEN, 1-line fix, next push`
  ⛔⛔ **THE THIRD INSTANCE OF THIS CLASS IN ONE PROGRAMME, AND THE CODE COMMENT DESCRIBES IT.**
  `api/routers/discord_interactions.py:875 render_health` has a `store is None` EARLY RETURN —
  taken on every pod where V2 is dark and no jobs DB exists, i.e. **all of them** — which
  hand-builds its dict and never reaches `observe.health_payload`. I wired `stall_record` and
  `token_slots` into `health_payload`; both fall into exactly the hole OI-42 fixed for `loop`.
  Verified in-process on `d9455a6d64a5`: `stall_record_present: false`, `token_slots_present: false`,
  while the constants read fine (`LOOP_STALL_PAGE_ALWAYS_MS 5000.0`) and `RENDER_SLOTS` is still
  `RenderGate`.
  ⭐ **The acceptance test caught it** — which is the entire reason the directive requires reading
  the fields in-process rather than inferring them from a green merge.
  ⚠️ **What still WORKS, verified by reading `/data` directly:** the durable record is wired with
  `last_error: null`, the page path is live, and the token counter is writing. Only the *read
  surface* is blocked. So the protective half shipped; the convenient half did not.
  **Fix:** add both fields to the early-return dict beside `"loop": observe._live_loop()`.
  **Not pushed this session — R22 allows one master push and it is spent.**

- [ ] **W1 remainder — D-13's field block** — `TODO, clock-gated 10:00 ET`
  Observability merge (durable stall record on `/data`; delivery via
  `chart_health_alerts.emit` at severity **"critical"**; R34 tiers; durable cooldown;
  durable token-slot counters) · R31 traces · smoke rows incl. the 10:00 ET window ·
  OI-42 reproduction · tripwire PAUSE · S2 attempt · OI-45 · OI-46.
  **Pre-cleared 2026-09-15:** webhook target GREEN; delivery path live and not
  V2-gated; `conftest.shared_data_root_census()` confirmed at `conftest.py:266`.
  **Both `/data` writers MUST use the `AUTH_DB_PATH` idiom** (`os.environ.get("X",
  "/data/...")`) or they land in `unpinnable` and trip the tripwire.
- [x] **W2a — OI-44 MEASURED** — `DONE 2026-09-17` — see `OI-44-STALL-CENSUS.md`.
  **42 stalls >= 1,000 ms in 33.9 h (29.7/day) across 34 pods; 27 PROVABLY past the 900 s floor;
  11 >= 5,000 ms (7.8/day); largest 80,249 ms at uptime 2,510-2,838 s.**
  ⛔ **Q6's STARTUP verdict is OVERTURNED** — superseding note written into `D12-FIELD-FINDINGS.md`.
  ⛔ **R35 FIRES**: 7.8 tier-1 pages/day vs a threshold of 2 → fix the cause, do not move the number.
  ⛔ **Batching the other workstreams' deploys would NOT fix it** — 27 of 42 are settled-pod stalls,
  so fewer deploys removes some of the 11 boot-class events and none of the 27. This corrects the
  expectation D-14 was written against.
- [ ] **W2b — OI-44 ATTRIBUTION then FIX** per R43 — `TODO, next after W1 commit A`
  The census reads the loop, not the request log, so the cause is still unattributed. W1's durable
  stall record is the join key (wall-clock + uptime per stall). Leading hypothesis, NOT established:
  the post-close cluster on `fea2778d85cd` (3.1 s → 20.6 s → 80.2 s → 14.2 s between 16:23 and 17:03 ET)
  sits where the breadth collector, the EOD updaters and `/api/push` land. Correlate before fixing.
- [ ] **W6 member flip — GATED ON THE OI-44 FIX** — `precondition added 2026-09-17`
  An 80 s loop block is a mass ack failure whatever the render path does, and R41's rollback changes
  which code serves, not whether the loop is blocked. R40's precondition list gains: OI-44 fixed and
  verified across >= 10 pods at a stall rate that cannot breach the 3 s ack budget.
- [ ] **W3 — OI-13 step 6** per R42 — `BLOCKED-until-FRIDAY 2026-09-18, ~08:23 ET at the earliest`
  The durable counter went live at **2026-09-17T12:23:20Z = 08:23 ET**, which is AFTER today's
  07:35 ET Morning Wire run. R29 requires a full weekday span **including** a 07:35 ET run and a
  market session, so the first qualifying window closes no earlier than Friday ~08:23 ET.
  Current reading: **current 5, previous 0** — zero so far, which is the direction that permits
  the clear, but 0.0 h of 24 h observed. ⛔ Reading it early and clearing on "previous is 0"
  would be exactly the absence-is-not-evidence error R29 exists to prevent.
- [ ] **W4 — gate to 11/11** — `TODO` — snapshot `20260916T014229Z-29900cedf` = **7 MET / 2 NOT MET / 2 NOT MEASURABLE**, no gate change vs `7decb0601`. The four rows and their movers:

  1. **NOT MET — "every forensics class closed with a commit"** · 11/14 closed; open: **C-02, C-09, C-13**.
     Mover: C-09 is the gate merge `ccf4fbcb6` (live) — the row likely just needs its closing commit recorded.
     C-13 closes with OI-13 step 6 + the 11x4 control (R42, Thursday+). C-02 is the loop/ack class — OI-44/OI-45 work.
     Owner: session. Not blocked except C-13's clock.
  2. **NOT MET — "3.5 real-Discord smoke"** · reads *"1 FAIL mark (2/15 rows marked PASS, 10 rows no mark speaks for)"*.
     ⛔ **THE ROW IS SCORED AGAINST A STALE ARTIFACT.** The denominator is **15**; R16 struck the fifteenth and
     `SMOKE-3.5.md` defines **14**. It also has no knowledge of 2026-09-15's run, where rows 1, 8, 9, 11, 13
     PASSed on the gate SHA. This is the very defect SMOKE-3.5.md was written to end — a score against a list
     nobody can re-derive. Mover: write the 2026-09-15 marks into the evidence the gate reads, run the
     remaining rows (W1), and move the scorer to the 14-row denominator. Never relax the threshold.
  3. **NOT MEASURABLE — "S2 measured in --real mode and within SLO"** · zero admissible latency artifacts:
     1 void (open-loop mislabelled as concurrency), 12 inconclusive (ack-path only / `renderer=fallback` /
     unlabelled load model / pre-label). **S5 MET, S5b MET, S5c MET** (4,444 refusals all reached the member
     inside 3,000 ms, read from the WIRE). Mover: the private-network harness run (R46) or, if NO-GO twice,
     canary traffic under D2 with `source=canary`, min N=50 — an honest new SOURCE, contract updated to accept it.
  4. **NOT MEASURABLE — "mutation NOT-APPLIED = 0"** · 15 harnesses, only 6 answer `--dry-check`.
     Mover: `--run-mutations`, or read the merge row. Unblocked and cheap; do it early in W1.

  ⭐ Note the gate's `#render-alerts locked to admins` row is **MET** and is a DIFFERENT channel from
  `#system-alerts` (OI-46). Do not conflate them.
- [ ] **R49 — deterministic rollback watchdog** — `TODO, precondition for W5 and W6`
  Extend `d14_monitor.py` (a SCRIPT, not an agent — which is why the classifier has no reason to touch it)
  so it can itself unset `DISCORD_RENDER_V2_ENABLED` (R39) or narrow `DISCORD_RENDER_V2_CHANNELS` back to
  `'1549129739048853544'` (R41) on its own measured triggers. 60 s polls during canary/member phases.
  Action on trigger: the single env change, an in-process read confirming it, a **critical** page through
  `chart_health_alerts`, an entry in `D14-LOG.md`. Never a re-flip, never a second change.
  Fail-closed: 3 consecutive unreadable polls during a MEMBER phase is itself a rollback trigger; during
  the CANARY phase it is a page only.
  Rails before W5's flip: a synthetic breach at the monitor's INPUT (never production) produces exactly one
  rollback call with the right variable and value; clean input produces none; the blindness rule fires on
  the third gap, not the second. Mutations: threshold as infinity → RED; variable name swapped → RED;
  blindness counter never increments → RED. Then a LIVE rehearsal in a settled window, both paths.
  **This withdraws the "owner awake" note on W6** — the flips run on R38/R40 when their preconditions hold.

  ⛔⛔ **R49'S HANDS ONLY WORK FROM THE REPO WORKING DIRECTORY — MEASURED 2026-09-16.**
  The Railway CLI resolves its linked project from the CWD. A scheduled task has none, so it runs in
  `C:\Windows\System32` and every call answers *"No linked project found"* — rc=1, no JSON.
  The first scheduled poller did exactly this: **8 gaps / 7 successes**, and the successes were a
  DIFFERENT poller that happened to still be alive in a repo cwd. The file kept growing and the task
  read `Running` the whole time. **R49 would have been blind AND handless in production while looking
  healthy.** Fixed by pinning `cwd=ROOT` on the subprocess inside the script (not in the task
  definition, so it travels). Verified after the fix: 2 successes, 0 gaps.
  ⭐ The only reason this was visible at all is that the poller writes explicit `gap` records. A silent
  absence would have read as "no stalls observed overnight".
  **R49's rollback call must use the same pinned cwd, and its rehearsal must prove it from the scheduled
  context — not from an interactive shell, where it would pass for the wrong reason.**

- [ ] **W5 — canary rehearsal + flip** per R38, monitor per R39 for >= 3 trading days — `BLOCKED-needs-W4, needs-R49`
- [ ] **W6 — member flip** per R40, monitor per R41 for >= 5 trading days — `BLOCKED-needs-W5`
- [ ] **W7 — close-out** — `BLOCKED-needs-W6`

---

## 4. OI CLOSE-OUT (D4) — 46 items

OI-01..OI-43 appear across the programme docs; OI-44/45/46 were named 2026-09-15.
**State per item is NOT yet derived.** First close-out action: build the table from
`docs/discord-render/LEDGER.md` (72 OI references) plus `05-progress.md`, one row per
id with CLOSED(evidence) / DEFERRED(reason + what would close it + why it does not
block D1-D3). No item may read "pending owner".

- OI-13 rotation — step 6 only, gated by R29/R42 → **Thursday or later**
- OI-35 — scope narrowing; ⛔ `DISCORD_RENDER_V2_CHANNELS` **empty means EVERY channel**; the member flip is the explicit PAIR, never a blank
- OI-42 — ack-timing instrument live; reproduction outstanding (W1)
- OI-43 — loop watcher ungated; **fixed the instrument, not its reader** → OI-45
- OI-44 — boot-window loop block; named only if >= 2 of 5 pods show it (R43)
- OI-45 — `loop_stalled` unreachable in prod: `Observer` is built in `commands.start()`, called only inside `if _render_v2.enabled():` (`main.py:7816`). Closes on W1 commit A + post-deploy proof.
- OI-46 — #system-alerts privacy rests on a 4-member guild, not an `@everyone` VIEW deny. Non-blocking (R47).

---

## 5. STANDING CLOCK GATES

| gate | earliest |
|---|---|
| D-13 start | Wed 16 Sep, >= 09:00 ET, weekday |
| ~~R17 + smoke rows 5/6/7~~ ✅ **RUN 2026-09-17 14:00:07Z** | ~~first weekday 10:00 ET the session spans~~ — SPY failed in RTH too, on a 30 s timeout (`[flow] fetch failed SPY (30): timed out`), NOT the ETF partition. Row 7 settled NOT RUNNABLE on evidence; rows 5/6 unchanged. `evidence/r17-flow-rth/2026-09-17-spy-rth.md` |
| OI-13 step 6 (R42) | Thu 17 Sep at the earliest — counter must span a 07:35 ET run + a market session |
| S2 after an operator command (R33) | +15 min |
| member flip (R40) | >= 30 min clear of 07:35 ET; outside 09:25-10:30 ET |

---

## 6. HONEST NOTE ON "RUNS TO DONE"

D2 (>= 3 trading days canary) + D3 (>= 5 trading days member) is **>= 8 trading days**.
No single session spans that. This file is the resume point and `resume` will be needed
roughly daily. That is the design working, not a failure — the alternative is a session
claiming continuity it does not have.

### OI-47 merge readiness — measured 2026-09-17 09:32 ET, so the next session need not re-derive it

- Branch `fix/oi-47-health-early-return` @ **`494b20948`**, pushed.
- Master moved under it to **`26147924dcbd`** (breadth workstream, 3 commits).
- **File overlap with master's new commits: ZERO.** Master added only
  `docs/breadth-history-reader/FINAL.md`, `docs/breadth/DECISIONS.md`,
  `docs/runbooks/PROPOSAL-push-blind-window.md`, `tests/test_breadth_sampler.py`,
  `tools/breadth_pool_report.py`, `tools/breadth_sampler.py`, `tools/breadth_sampler_report.py`.
  The branch touches three files, none of them on that list. **Per the repo's rebase rule — empty
  overlap and fewer than six behind — merge clean, do not rebase.**
- **Trial merge performed and thrown away** (`git merge --no-ff --no-commit` … `git merge --abort`;
  branch verified back at `494b20948`): *"Automatic merge went well"*, and the scoped suite on the
  MERGED tree read **108 passed / 0 failed** over the branch's own rails plus master's new
  `tests/test_breadth_sampler.py`. ⚠️ That is the branch's rails on the merged tree, not a full
  gate — the master deploy gate is what verifies merged reality.
- ⛔ **Still not merged, and the reason is not staleness:** R22's one master push per session is
  spent. The next session merges it as its first act, after re-reading `/renderhealth` for the
  live commit.

### ✅ The denominator change IS mutation-proved — done 2026-09-17 09:47 ET, `8b2a87207`

Run in a detached throwaway worktree carrying a `.mutation-sandbox` marker
(`uct-worktrees/_tw-flipgate`, at `329f90379`):

```
TOTALS mutation_harness_flipgate PASS rows=11 cases=69 failed=0
TOTALS flip_preconditions --self-check PASS cases=11 mutation_failures=0 failed=0
```

⚰️ **The first run was `failed=1`, and the failure is worth keeping for its SHAPE.**

```
FAIL smoke  FAIL planted  want=NOT MET  got=NOT MET
     state ok but the evidence never says 'only 1/15'
```

**`want` and `got` AGREE.** The row read the planted partial smoke and returned NOT MET in both
directions — the gate was never wrong. What was stale was the case's own hand-typed `says=`
needle, which demanded the gate say *"only 1/15"* while it now correctly says *"only 1/14"*.
⛔ **A red whose want and got agree is the one failure shape that reads as a real regression and
is not one** — it is the harness describing a world that moved, which is precisely what this
harness exists to catch in the gate and had not been applied to itself.

⭐ **Fixed by deletion of the literal, not by retyping it at 14:** `says=f"only 1/{fp.SMOKE_ROWS_TOTAL}"`,
derived from the constant that owns it. The case label carried the same number again and was
wrong about a second one too (*"2 of 15 rows PASS"* — the planted tree has ONE pass mark), so it
is derived now as well. Same defect class as the writer-index `FOUR`, the COT router's *"4
routes"* and the setup catalog's *"24"*: **a count typed beside the list it describes**, and the
fourth artifact in this repo to pay for it.

⛔ **The earlier `mutation_failures=1` reading said nothing about the change** and is struck, not
deleted — the harness had simply refused to run in the integrator's tree (it edits real source in
place and demands the marker, because a killed run once left a mutation behind in `badge.py`).
Same rule as *"never read an INVALID manifest as a signal about your branch"*. ⚠️ Nothing was ever
planted in the repository either way: every case builds its tree under `mkdtemp()`, and the
throwaway worktree is defence in depth rather than what makes the harness safe.

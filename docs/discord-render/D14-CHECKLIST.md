# D-14 — the durable checklist. READ THIS FIRST ON RESUME.

**A fresh session resumes from this file alone.** Its first act: read this file,
verify production state in-process (never from a working tree, never from a ledger),
then take the first item whose preconditions are met.

States: `TODO` · `IN-PROGRESS` · `DONE` · `DEFERRED-<reason>` · `BLOCKED-<reason>`

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

- [ ] **W1 — D-13 in full** — `TODO, clock-gated Wed >= 09:00 ET`
  Observability merge (durable stall record on `/data`; delivery via
  `chart_health_alerts.emit` at severity **"critical"**; R34 tiers; durable cooldown;
  durable token-slot counters) · R31 traces · smoke rows incl. the 10:00 ET window ·
  OI-42 reproduction · tripwire PAUSE · S2 attempt · OI-45 · OI-46.
  **Pre-cleared 2026-09-15:** webhook target GREEN; delivery path live and not
  V2-gated; `conftest.shared_data_root_census()` confirmed at `conftest.py:266`.
  **Both `/data` writers MUST use the `AUTH_DB_PATH` idiom** (`os.environ.get("X",
  "/data/...")`) or they land in `unpinnable` and trip the tripwire.
- [ ] **W2 — OI-44** per R43 — `BLOCKED-needs-W1` (needs the durable record across pods)
- [ ] **W3 — OI-13 step 6** per R42 — `BLOCKED-until-Thursday` (counter ships in W1; first qualifying weekday span begins Thu 17 Sep)
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
- [ ] **W5 — canary rehearsal + flip** per R38, monitor per R39 for >= 3 trading days — `BLOCKED-needs-W4`
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
| R17 + smoke rows 5/6/7 | first weekday 10:00 ET the session spans |
| OI-13 step 6 (R42) | Thu 17 Sep at the earliest — counter must span a 07:35 ET run + a market session |
| S2 after an operator command (R33) | +15 min |
| member flip (R40) | >= 30 min clear of 07:35 ET; outside 09:25-10:30 ET |

---

## 6. HONEST NOTE ON "RUNS TO DONE"

D2 (>= 3 trading days canary) + D3 (>= 5 trading days member) is **>= 8 trading days**.
No single session spans that. This file is the resume point and `resume` will be needed
roughly daily. That is the design working, not a failure — the alternative is a session
claiming continuity it does not have.

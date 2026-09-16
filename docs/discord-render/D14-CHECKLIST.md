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
- [ ] **A5 monitors** — `TODO` — loop/health 60 s; deploy history 60 s; canary SLO 5 min once V2 on; tier-1 rate daily. Each logs its own gaps (**a gap is not a zero**). ⛔ Background pollers die with the session — for overnight coverage they need a Task Scheduler entry, which is an owner action.
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
- [ ] **W4 — gate to 11/11** — `TODO` — per non-MET row, the named mover from D-13 Part 6. Evidence contracts may accept an honest new SOURCE, **never a relaxed threshold**.
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

---
id: ARCH-07-OBS
title: Observability architecture — what already watches this system, what nobody reads, and the three signals the process cannot hold
role: >
  The observability deliverable. MASTER_CHECKLIST item 25, gate item 25. Written by
  ARCH-07/H-06 as the owner of the design item 24 §3 Q10 handed forward, and of the
  measurement CARD 16 specified without an instrument.
wave: 4
group: ARCH
category: architecture-proposal
inputs: >
  ARCH-07 `07-technical-architecture/realtime-performance-architecture.md` (gate item 24,
  draft) — its Q10, §2.2, §2.4, §2.5, its CARD 16 reference and its GAPS line "no p95
  anywhere" · D-05 `07-technical-architecture/current-performance-and-realtime.md`
  (accepted) §8 and §4.3 · C7-01 `07-technical-architecture/domain-streaming-caching.md`
  (accepted) §3 OPEN QUESTION and §13 Q10 · `docs/perf-baseline-2026-09-26.md` (the
  executed baseline) · CP-05 in `00-program-control/CRITICAL_PATH.md` · gate item 23
  `09-security-licensing-cost/security-entitlement-architecture.md` §1.7 and DP-6 ·
  `C:\Users\Patrick\uct-worktrees\_merge-master\CLAUDE.md` for the three instrument-failure
  kinds, the desk-audit pattern and the `fundamentals_monitor` suppression-set correction.
scope: >
  Source read READ-ONLY in the sibling worktree
  `C:\Users\Patrick\uct-worktrees\_merge-master`; nothing written there. ⛔ NO git command
  of any kind was run (another session owns the commit), NO network request, NO `curl`, NO
  `railway` command, NO production call, NO test and NO script. Every number below is
  derived from a grep or a file read whose exact command is recorded in SOURCES. One file
  written: this one.
confidence: >
  🟢 high on everything with a `file:line` — each was opened, not grepped-and-assumed.
  🟢 high on the two structural findings (per-process counters; the p95 the gate names is
  computed over a subset the same ruling redefined), both read directly out of source.
  🟡 on any statement about what is SET in production: no Railway read was available, so
  flag states are quoted from `docs/feature_flags.json` and from the inherited documents,
  never asserted. 🟡 on "nothing reads X on a schedule" — bounded to *this repository*,
  with the grep and a control stated in every case.
evidence_ceiling: >
  ⛔ No production read, so not one counter value in this document was observed live; every
  observed value is carried from `docs/perf-baseline-2026-09-26.md`. ⛔ No Railway service
  or variable listing, so whether `terminal-next-monitor`, `liveflow_monitor`,
  `provider_coverage_monitor` and `fundamentals_monitor` are RUNNING today is outside this
  document — it establishes only that each is written, wired to a starter, and gated. ⛔ No
  Windows Task Scheduler read, so a schedule held on the owner's box is invisible here and
  is marked as such rather than denied. No alert was fired and no guard was proved to fire
  by this document; §4.6 states how each would be proved and by whom.
status: draft
---

# Observability architecture (ARCH-07-OBS)

## 0. Headline

**Three findings. The first one changes what this item is FOR.**

1. ⭐⭐ **The monitor this item would have designed already exists, as its own Railway
   service, and nobody has pointed it at performance.**
   `api/terminal_next_monitor_main.py` (269 lines) is a fifth service selected by
   `railway.json`'s `startCommand`, invoked by Railway cron with `--once`, holding **no
   in-memory state at all**, that already solves — in its own docstring and comments —
   every failure mode this document would otherwise have re-derived: it runs no
   measurement of its own so it can never become a second authority (`:5-11`); it reaches
   `web` over the private network because a Railway volume mounts to exactly one service
   (`:12-17`); it posts only to the admin channel and a test asserts the public channel's
   name does not appear in the file (`:19-24`); an unreadable source posts as **UNREADABLE,
   never as zero** (`:25-29`, `:85-88`); every post carries the running commit and the
   timestamp (`:30-32`, `:100`); and it refuses to alert on the normal case — *"A CLOSED
   MARKET IS NOT A FAULT, and alerting on it every weekend is how a monitor gets muted"*
   (`:161-165`). **The design question for item 25 is therefore not "what monitor" but
   "which jobs", and the drop counters are job five.** §4.

2. ⛔⛔ **Two of the three signals this programme most needs are not merely UNREAD — they
   are UNREADABLE by the process that holds them, for the same reason.**
   `event_loop_watchdog._state["max_lag_ms"]` starts at `0.0` in `_fresh_state()`
   (`api/event_loop_watchdog.py:122`, installed at `:136`) and only ever ratchets up
   in-process (`:307-308`, `:356-357`). Its own arming runbook, in the same file, instructs
   the operator to *"Watch `GET /api/watchdog/status` -> `max_lag_ms` **for a few days**
   across a market open and a heavy-job window"* (`:46-49`) and then to set the kill
   threshold at *"3-5x"* the observed maximum (`:50`). Item 24 §2.5 carries the measurement
   that makes this impossible: **median pod life 26 minutes.** A maximum-since-boot cannot
   span days on a process that lives 26 minutes, so the number the arming decision is
   supposed to rest on has never existed. `bar_broadcaster._bars_dropped_total`
   (`api/services/bar_broadcaster.py:65`) is the same shape — a per-process monotonic total,
   reset to 0 by every deploy. ⭐ **And the distinction generalises into the design rule of
   §4.2: per-process state is fatal for a CUMULATIVE quantity (a leak slope, a drop total,
   a max over days) and perfectly adequate for a DISTRIBUTIONAL one measured inside one
   pod's life (a latency p95).** Which tier a signal belongs in is decided by that
   property, not by convenience.

3. ⛔⛔ **CARD 16's replacement gate cannot be evaluated, today, on the timeframe that
   motivated it — and the mechanism is two lines of a tool.**
   CARD 16 ruled that `stale-swr` **counts as SERVED** and replaced the warm-ratio gate
   with *"p95 ≤ 250 ms per timeframe, on a pod ≥ 300 s old"* on the same one command
   (`docs/perf-baseline-2026-09-26.md:290-306`). That command is
   `tools/bars_warmth_audit.py`, whose `WARM = {"mem", "sqlite", "yf-only"}` and
   `COLD = {"fetch", "stale-swr", "inflight-wait", "disk", "miss", "unknown"}` (`:27-28`)
   still put `stale-swr` in COLD. Samples are bucketed on that constant (`:99-103`), and
   the p95 line is computed over `warm_ms` **only**, inside `if warm_ms:` (`:109-112`).
   Daily has been 100 % `stale-swr` since 2026-08-19, so on daily `warm_ms` is **empty**
   and **no p95 is printed at all**; the "daily p50 104 ms / max 301 ms — PASS" recorded
   against the new gate was read off the COLD line at `:113-116`, which prints p50 and
   **max**, never p95. ⭐ **The ruling changed the definition and the instrument was not
   changed with it** — CLAUDE.md's kind 3a exactly: a true record, read, and not acted on.
   §3 G-2 states the fix and the control that proves it landed.

**What this document is for.** Item 24 §3 Q10 answered *"the counters exist and are
currently unread"* and assigned the design here. C7-01 §3's OPEN QUESTION asked the same
thing (`domain-streaming-caching.md:244-248`). This document enumerates what watches this
system today with a `file:line` for every surface, classifies each one by whether it reads
an **artifact** or a **proxy** and which of CLAUDE.md's three instrument-failure kinds it is
exposed to, names the gaps with a severity argument, and proposes an architecture whose
whole shape is dictated by one constraint: **one uvicorn process, one event loop, one
64-thread anyio pool, and every counter in it is per-process, so a redeploy is a data-loss
event for anything held in memory.**

---

## 1. Method — so every count here can be re-derived rather than trusted

**Measure it, don't quote it.** Every count below names the command that produced it.
⚠️ None of these was run against production; all are greps over the read-only worktree
`C:\Users\Patrick\uct-worktrees\_merge-master`.

| number in this document | how it was produced |
|---|---|
| **91** status/health route declarations | `grep -rn -E '^\s*@(app\|router\|[a-z_]+)\.(get\|post)\("(/[^"]*)?(status\|health)[^"]*"' api/ --include=*.py \| wc -l` |
| **12** of those under `/api/admin/` | same pattern narrowed to `@(app\|router)\.get\("/api/admin/[^"]*(status\|health)[^"]*"` |
| **30** modules referencing `DISCORD_WEBHOOK_URL` | `grep -rl "DISCORD_WEBHOOK_URL" api/ --include=*.py \| wc -l` |
| **14** distinct `DISCORD_*WEBHOOK*` env names | `grep -rhoE 'DISCORD[A-Z0-9_]*WEBHOOK[A-Z0-9_]*' api/ --include=*.py \| sort \| uniq -c` |
| **162** `add_job` call sites in `api/main.py` | `grep -c "add_job" api/main.py` |
| the readers of the drop counters | `grep -rn "api/admin/" tools/ scripts/ .github/ docs/runbooks/` and `grep -rn "get_broadcaster().get_status()\|bar_stream.get_status()" . --include=*.py` |

⚠️ **Two known limits of the route count, stated rather than hidden.** It counts *declarations
matching a literal*, so (a) a status route whose path spells health differently —
`/api/admin/provider-coverage`, `/api/admin/deploy-log`, `/api/admin/bars/alerts` — is **not**
in the 91, which therefore UNDER-counts; and (b) a declaration is not a mount, so a router
`api/main.py` never includes would still be counted. The honest reading is *"at least 91
routes in this codebase are named as a status or health surface"*. It is a floor, and the
floor is the point.

⭐ **An absence is only evidence if the instrument could have seen a presence.** Every negative
claim in §3 is paired with a control. The template: to claim *"nothing reads the drop counters
on a schedule"*, the same grep that finds no scheduled caller is shown finding a real one —
`grep -rn "run_audit_and_alert" . --include=*.py` returns `api/main.py:6614`, the desk audit's
`add_job` (`api/main.py:6625-6627`). The instrument can see a scheduled reader; it sees none here.

⚰️ **And the method immediately corrected an inherited citation.** Both item 24 §2.2 and
`docs/perf-baseline-2026-09-26.md:23-24` cite `api/main.py:3639-3644` for the comment calling a
leak/working-set distinction *"the prerequisite for any further memory work"*.
`grep -n "prerequisite for any further memory work" api/main.py` returns exactly one hit:
**`api/main.py:4510`**, inside `_web_memwatch` (`:4511-4521`); `api/main.py:3637-3642` is an
unrelated breadth-backfill comment. The claim is true; the line number drifted with the file.
This is CLAUDE.md's *"Grep the constant, not a line number"* collecting its toll on two
documents at once, and it is why §5's second item is free.

---

## 2. What observability exists today, measured

### 2.1 The census: at least 91 named status surfaces, 12 of them admin-prefixed

The full list is not reproduced — it would be a hand-typed enumeration beside the source
that owns it, which is the defect this programme has paid for repeatedly. The derivation is
in §1; the ones that matter to a terminal are below.

⭐ **The interesting number is not 91. It is the read side.** A status endpoint is not
observability; it is the *possibility* of observability. §2.2 is the same population sorted
by who reads it.

### 2.2 The read side — every surface, what it reads, who reads it, on what schedule

**A = reads an ARTIFACT (the thing itself). P = reads a PROXY (a stand-in).** Kind column
is CLAUDE.md's taxonomy: **1** = pointed at something that MOVED · **2** = a PROXY for the
thing it names · **3a** = a true record read and not acted on · **3b** = right when
written, the world moved.

| surface | file:line | reads | A/P | kind exposure | read by | schedule |
|---|---|---|---|---|---|---|
| `/api/health` | `api/main.py:8317-8329` | `uptime_seconds`, `thread_count`, `rss_mb`, `wire_date` | **P** for "did my deploy ship" | **2**, with a published incident | Railway healthcheck (`railway.json` `healthcheckPath`) **and** `worker_main`'s down-alert | every 60 s (`KEEPWARM_INTERVAL_SECONDS` default 60, `api/worker_main.py:596`) |
| `/api/ready` | `api/main.py:8332-8363` | every warm gate | **A** | **3b**, corrected in-file | nothing; *"⛔ NOTHING GATES A DEPLOY ON THIS"* | none |
| `/api/watchdog/status` | `api/event_loop_watchdog.py:199-209` | in-process lag counters | **A** for this pod, **P** for "the loop over days" | **2** | no scheduled reader in this repo | none |
| `/api/admin/bars-stream-status` | `api/routers/bars.py:1285-1307` | `bars_emitted_total`, `bars_dropped_total`, `last_emit_age_s`, subscribers | **A** | **2** across a deploy | `tools/market_open_chart_check.py:247` only | **none in this repo** — see G-1 |
| `/api/admin/reconciliation-status` | `api/routers/bars.py:1236` | reconciliation worker counters | **A** | — | `tools/market_open_chart_check.py:283` only | **none in this repo** |
| `/api/admin/fundamentals-health` | `api/routers/fundamentals.py:224` | `flagged_current` + cycle counters | **A** | — | the in-process monitor's own digest | cycle 7200 s (`fundamentals_monitor.py:45`) |
| `/api/admin/provider-coverage` | `api/routers/provider_coverage.py:29` | per-field FILL RATE | **A** | — | the in-process monitor | cycle 3600 s (`provider_coverage_monitor.py:99`) |
| `/api/admin/disk-status` | `api/routers/bars.py:1249` | whole-volume usage + top consumers | **A** | — | `disk_watchdog`'s own loop | periodic (module) |
| `/api/admin/bars/alerts` | `api/services/chart_health_alerts.py:8` | a 200-entry in-memory deque | **A** while the pod lives | **2** across a deploy | admin pull; CRITICAL also pages Discord | pull-only + event |
| `[mem] rss_mb=… threads=…` | `api/main.py:4517`, 60 s at `:4520` | RSS + thread count | **A** | **1** (the log stream rotates) | **nothing** — item 24 §2.2 read it by hand, once | none |
| `[thread-burst] {histogram}` | `api/main.py:1497`, 30 s at `:1501` | thread-name histogram over threshold 200 (`:1478`) | **A** | — | self-capture to the log | event-driven |
| boot fingerprints (`[startup] …`) | `api/main.py` passim | flag + wiring state at boot | **A** | **3b** — a fingerprint has gone stale here before | operator grep | none |
| `desk_session_audit` | `api/services/desk_session_audit.py:347-364` | the `edu_videos` row + announce ledger | **A**, explicitly refusing a counter | designed against **2** | `api/main.py:6614` | **09:00 ET daily** (`:6625-6627`) |
| `desk_session_audit.sweep_liveness` | `:267-318` | YouTube oEmbed per video, cursor on the volume | **A** | designed against **3b** | same job | same |
| `check_missing_session_alert` | `api/services/desk_daily_session.py:329-349` | "is today's session in The Desk" | **A** | — | scheduler | weekday EOD |
| down-alert monitor | `api/worker_main.py:420-437`, loop `:646-663` | `/api/health` liveness | **P** | **2** | the **worker** process | 60 s |
| bars freshness watchdog | `api/worker_main.py:542-569` | prewarm heartbeat + daily freshness report | **A** + heartbeat | — | the **worker** process | 900 s (`:463`) |
| `liveflow_monitor` | `api/services/liveflow_monitor.py`, started `api/worker_main.py:895` | `/api/live/massive/status` → `max_id` delta | **A**, with the wall-clock field demoted | designed against **1** | the **worker** process | 60 s in session |
| `terminal-next-monitor` | `api/terminal_next_monitor_main.py:203-213` | four report endpoints on `web` | **A** | designed against **2** and **3b** | its own Railway service | Railway cron, ET table |
| `/api/admin/auth-surface` | `api/auth_surface_check.py:50`, `:64` | live route objects at boot | **A** | **2** by aperture — §3 G-4 | boot | every boot |

### 2.3 ⭐ Five instruments already get this right, and each contributes a different rule

This is the most valuable part of the census. The repo has already paid for five designs
that survive the failure modes item 25 exists to avoid. **The architecture in §4 is those
five rules applied to performance signals, not a sixth idea.**

**(a) `desk_session_audit` — read the artifact, never a counter, and grace is load-bearing.**
It refuses to consult `desk_session_insights._FAIL_STREAKS`, an in-memory dict that alerts
on the 4th consecutive failure, and says why in the module docstring
(`api/services/desk_session_audit.py:12-18`): *"this pod redeploys several times a day, so
that streak resets before it can ever fire. A proxy that resets on redeploy reports healthy
straight through a total failure."* ⭐ And the grace window is stated as load-bearing
(`:22-26`): insights land 2 min–3 h after publish, so a session younger than
`DESK_SESSION_AUDIT_GRACE_SECS` (default `3 * 3600`, `:45`) is **not checked at all** —
*"Without that, this alert fires on every healthy session and is muted within a week."*
Names, not counts (`:27-30`, rendered at `:321-337`). The announce check reads the
announcer's **own** allowlist (`:80-90`) so the audit can never disagree with the thing it
audits. The liveness sweep (`:168-193`) adds the round-robin cursor and, crucially,
`youtube_live` returns `None` for UNKNOWN and *"None is deliberately NOT a verdict"*
(`:249-264`) — an outage at the source must not manufacture a library's worth of findings.
Its state is written atomically via `os.replace` to the volume (`:232-246`), so **a redeploy
neither re-alerts nor restarts the cursor** (`:176-178`).

**(b) `fundamentals_monitor` — the severity rule, and the suppression-set correction.**
`_CRITICAL_KINDS` (`api/services/fundamentals_monitor.py:85-86`) splits alerts by one
question, written out at `:63-78`: *"who is supposed to guarantee this?"* Invariants **our**
code enforces (`exception`, `bad_shape`, `nan`, `dup_quarter`, `dup_forward`,
`reported_forward_overlap`, `label_period_mismatch`) mean a guard stopped working → **page**.
Holes a **provider** handed us that our code faithfully reproduces (`forward_gap`,
`forward_noncontiguous`, `stale_reported`) → **recorded and digested**. ⚰️ And the same file
records the correction that makes it trustworthy (`:88-91`, and CLAUDE.md at length): the
"newly flagged" baseline used to be `_state["_prev_flagged_syms"]`, an in-memory set holding
only the previous cycle's names, while the population is a rotating ~30-of-~3,700 sample —
so a long-tail name left the set the moment it went unsampled and paged again on its next
appearance, and every master push cleared it outright. ⭐ **A suppression set whose
population is a rotating sample is not a suppression set.** The baseline is now the durable
`defect_state` table on the volume (`:98-103`), written back **only for the tickers a cycle
actually checked** (`:158-189`), and the digest's own "last sent" stamp is on disk for the
identical reason (`:104-112`): *"a pod that redeploys a few times a day would send a 'daily'
digest a few times a day — the exact defect this module is being fixed for."*
⛔ The companion warning matters as much: `provider_coverage_monitor` replaces its whole set
each cycle because it evaluates its **entire** population — **do not copy that back here.**

**(c) `provider_coverage_monitor` — measure the FIELD, not the status code.**
Its docstring (`api/services/provider_coverage_monitor.py:8-21`) records that two Finnhub
endpoints returned HTTP 403 on every call **for months** — 100 % blank in production —
*"discovered only because a human happened to look"*, alongside a 48 h-cached blank tab, a
retry job with no scheduler caller, and a nightly capture silently returning
`{'captured': 0}`. ⭐ *"Every one of those was a 200 response with an empty/null field, which
no uptime check or 'did the endpoint 200' probe would ever catch."* So it measures **fill
rate**, against three distinct triggers (`:26-37`): exactly 0 % with a non-empty sample; below
a hand-tuned per-field floor; or a sharp **drop against its own persisted median baseline**
even while above the floor — because *"a field that sits at a steady 40 % forever is not [an
alarm]; and floors alone can't tell those apart without history."* That third trigger is the
one a terminal needs and the one this document borrows for latency and drops.

**(d) `liveflow_monitor` — the independent oracle, and the dead-man convention.**
`api/services/liveflow_monitor.py:4-6`: it runs on the worker — *"a different process,
volume, and deploy lifecycle than the web pod that hosts the Massive OPRA WS consumer — the
independent oracle. Would have caught all 16 downtime windows on 2026-07-06."* Four rules
come from it. **(i)** The primary staleness oracle is the `max_id` delta between polls, a
SQLite rowid, *"timezone-immune"*, and `last_event_age_sec` is explicitly demoted to
diagnostic because *"the router's age math sits on a hardcoded UTC-4 that skews +1h when EST
resumes in November"* (`:11-13`) — kind 1, named and routed around. **(ii)** A four-way
classification (HEALTHY / WORKER_DOWN / BLIND_DB / BLIND_WEB) plus a consumer-state
cross-check distinguishing *"consumer down"* from *"connected but zero prints"* (`:14-16`) —
a binary up/down could not tell those apart. **(iii)** Alert fatigue is bounded: ≤ 6 messages
per incident, 10 per day (`:17-19`). **(iv)** ⭐⭐ **The dead-man convention**: the daily
Integrity Scorecard posts at 16:15 ET *"EVERY trading day — its ABSENCE by 4:30 PM ET is
itself the alarm"* (`:20-22`), with the marker and trend JSON on the volume at
`/data/liveflow_scorecard/`. **That is the only construct in this repo under which silence is
not ambiguous**, and §4.8 generalises it.

**(e) `terminal-next-monitor` — the out-of-process shape, already built.** §0 finding 1.
Two further details earn their place. The schedule table is in **ET** and the Railway cron
is a deliberate **superset in UTC** (`:197-213`), because *"A UTC crontab expressing '09:12
ET' silently becomes 10:12 ET the day DST ends — the sweeps would be checked an hour after
they started, and nothing would say so"*; 16 firings a day of which 4 are due, and *"a firing
with nothing due is the normal case and must cost nothing and say nothing"* (`:252-261`). And
⚰️⚰️ the outbound post carries a browser User-Agent because a default `Python-urllib` agent
came back `HTTP 403 / error code: 1010` — **Cloudflare, not Discord** — a failure that
*"reads as 'your webhook is dead'… which sends you to rotate a credential that was never
broken"* (`:112-120`). Any new probe in this programme inherits that.

**(f) And a sixth, from the operations side.** `docs/runbooks/rth-scheduling.md` states the
same principle in the owner's own words: *"a missing Sunday alert is the signal — not a quiet
success. That is why the preflight alerts on GO as well as NO-GO: silence should never need
interpreting."* The convention is already in this programme's practice; it is not in the
production monitors.

### 2.4 Two corrections the census produced, recorded before they are used

⚰️ **`disk_watchdog` is the template for "the class, not the instance", and it exists because
of a per-feature guard.** `api/services/disk_watchdog.py:3-20` records the 2026-07-23
incident: the options tape spool paused itself on a disk budget and gap capture stayed dead
for **three trading days**, because *"the only thing watching disk was the spool's OWN budget
check — a per-feature guard that alerts about ITSELF, in ITS OWN terms"*, while 33 GB of
unpruned gap-fill backups next door squeezed everything off a 46 GB volume. Three of its
design notes are directly reusable: **threshold CROSSINGS alert and a still-over state
RE-alerts on a cadence** — *"A one-shot edge is what let the spool sit silent for three days;
worse, every restart re-fired the same edge, so a stuck state read as a fresh transient one"*;
**recovery is announced** — *"'No news' must never be the only evidence of health"*; and
**read-only** — it never deletes, because deciding what is expendable is not a monitor's job.

⚰️ **I corrected myself mid-census, and the correction is the useful part.** A first grep for
`liveflow_monitor` in `api/main.py` and `api/flow_worker_main.py` found no starter, and I was
one sentence from writing "a monitor written and never wired" — the exact shape this repo's
history makes plausible. Widening to `grep -rn "liveflow_monitor" --include=*.py .` found
`api/worker_main.py:895` calling `start_liveflow_monitor`. ⭐ **A negative scoped to the files
you expected is not a negative.** That is why §1 fixes the grep and the control together, and
why every absence in §3 names the files it swept.

---

## 3. The gaps, each one named and severity-argued

Severity uses the `_CRITICAL_KINDS` rule of §2.3(b): **PAGE** = an invariant our own code is
supposed to guarantee has stopped holding · **DIGEST** = real, recorded, not actionable at
23:00 · **UNREADABLE** = the instrument could not answer, which is a finding and never a zero.

### G-1 — the drop counters are read by one operator-run tool and no schedule in this repo

**Measured.** `grep -rn "get_broadcaster().get_status()\|bar_stream.get_status()" .
--include=*.py` returns exactly two hits, both inside the route that serves them
(`api/routers/bars.py:1298` and `:1303`). Outside `api/`, `grep -rn "api/admin/" tools/
scripts/ .github/ docs/runbooks/` finds `/api/admin/bars-stream-status` at exactly one
place: `tools/market_open_chart_check.py:247`. **Control:** the same sweep of `.github/`
finds one scheduled workflow (`grep -rln "schedule:" .github/workflows/` →
`joystick-device.yml`, cron `0 7 * * *`), and `grep -rn "run_audit_and_alert"` finds the desk
audit's `add_job` at `api/main.py:6614`. The instrument sees schedules where they exist.

**And the reader is not on a standing schedule.** `grep -rln "market_open_chart_check"` over
the whole repo returns three paths: the tool, `CLAUDE.md:1542`, and one plan document.
CLAUDE.md:1542 calls it *"the scheduled 9:45 ET agent's push-render proof"*, and
`docs/runbooks/rth-scheduling.md` shows what that means: nine **Windows** tasks, *"All
one-time triggers"*, registered for a named Monday RTH session on the owner's box.
⚠️ **A Windows Task Scheduler state is outside this document's reach** (no command was run),
so this is not "there is no schedule" — it is *"no standing schedule is recorded in this
repository, and the one recorded mechanism is a one-time trigger for a named session"*. The
only runbook that names the endpoint at all lists it as a **held** check:
`docs/runbooks/held-flags-and-checks.md:28` — *"⏳ Needs RTH."*

**Severity: PAGE for silence, DIGEST for drops.** The route's own docstring states the signal
(`api/routers/bars.py:1288-1291`): *"is it actually EMITTING … vs silently dead while users
invisibly fell back to Finnhub. `bars_dropped_total` > 0 = slow-consumer data loss."* Those
are two different facts with two different severities, and the existing design already
distinguishes them: the fan-out is last-value-wins by construction
(`bar_broadcaster` `maxsize=64` drop-oldest, item 24 Q6), so a dropped developing bar is a
conflation, not a gap — **digest**. A flat `bars_emitted_total` with subscribers > 0 during
RTH means the rail is dead and every member silently fell back — **page**. ⛔ The severity
inversion is the danger: paging on drops trains the channel to be ignored, which is how the
page that matters gets muted.

### G-2 — a p95 gate with no p95, and the one p95 that exists excludes the case in question

**Measured, with a control.** `grep -rn "p95\|percentile" api/ --include=*.py` returns hits
in exactly one module: `api/baselines.py`, whose `_percentile` (`:140`) and
`p50/p75/p90/p95/p99_premium` (`:329-333`) are **option-premium** percentiles — a product
feature, not a latency metric. **The control is inside the result**: the grep does find real
`p95` occurrences, and `grep -rln "p95" tools/ scripts/` returns 20 files. So the absence of
a *latency* percentile in `api/` is evidence, not instrument failure. **Nothing in the serving
process computes a latency percentile for any surface.** Item 24's GAPS said this; it is
confirmed here with the control it lacked.

**The raw material is already on the wire and is discarded.** `/api/bars/{ticker}` emits
`Server-Timing: bars;desc="<layer>";dur=<ms>` (`api/routers/bars.py:912-927`), and
`api/services/breadth_timing.py` is a whole phase-timing instrument with a `Server-Timing`
renderer (`:175`) scoped to two breadth paths (`:42`, `:402-415`). **Per-request timing
exists; nothing aggregates it.** ⭐ And `breadth_timing:79` states the governing caution in
one line — an instrument can end up *"aimed at nothing, which is the single most flattering
way an instrument can fail."*

**The instrument CARD 16 names measures a different quantity than CARD 16 specifies, three
ways.** All in `tools/bars_warmth_audit.py`:
1. **Bucketing.** `WARM = {"mem","sqlite","yf-only"}` / `COLD = {…,"stale-swr",…}` (`:27-28`)
   contradicts CARD 16's ruling that `stale-swr` counts as SERVED. Daily is 100 %
   `stale-swr`, so every daily sample lands in `cold_ms` (`:99-103`), `warm_ms` is empty, and
   the `if warm_ms:` guard at `:109` means **no p95 line prints for daily at all**.
2. **Statistic.** The cold branch prints p50 and **max** (`:113-116`), not p95 — which is
   where the baseline's "daily p50 104 ms / max 301 ms" came from. A max on n = 40 and a p95
   on n = 40 are different numbers and only one of them is the gate.
3. **Quantity.** `wall` is client wall-clock around the request (`:56-59`), so it includes
   TLS, Cloudflare and network; the `dur` in the header — server compute — is parsed away
   and thrown out (`:62-64` keeps only `desc=`). A 250 ms budget against client wall-clock
   and against server compute are different gates, and CARD 16 does not say which it is.
   ⚠️ **Neither is wrong** — client wall-clock is the right quantity for a *member* budget
   and `dur` for a *server* budget. What is wrong is that the gate does not name one.

⚠️ **And one more, small but it decides comparability.** The p95 index is
`warm_ms[min(len-1, int(len*0.95))]` (`:112`): on n = 40 that is index 38, the **second
largest of forty** — a nearest-rank estimate whose resolution is 2.5 percentage points. A
gate expressed as a percentile must declare its N (`--n`, default 40 at `:79`) or two runs
are not comparable.

**Severity: PAGE on the gate being unmeasurable** — a definition of done nothing can evaluate
is the failure mode CARD 16 was created to escape, one level up. The fix is small and §5 puts
it first.

### G-3 — a leak that needs 104 minutes to see, on a pod that lives 26

Item 24 §2.2 measured **+7.9 MB/min, monotonic across quartiles, 76 `[mem]` samples over 104
minutes** — possible only because one deployment happened to live that long — and records
that a separate 5-sample read on a 5-minute-old pod read **flat-to-declining** (1,980 →
1,905 MB). ⭐ **That is not a memory finding; it is an observability requirement.** Three
facts from source make it concrete:

- The sampler is `print(f"[mem] rss_mb=… threads=…")` every 60 s (`api/main.py:4517`, `:4520`).
  It writes to **stdout only**. Nothing reads it; nothing stores it; a deploy ends the series.
- The comment above it states the purpose — confirm *"a plateau … vs. a climb — the
  prerequisite for any further memory work"* (`api/main.py:4508-4510`) — and that purpose
  requires a series **longer than one pod's life**, which the sampler's own medium cannot
  provide.
- `/api/health` carries `rss_mb` (`api/main.py:8328`) but it is point-in-time, and the
  comment at `:8326` says exactly that: *"Pod resource observability (2026-06-09
  thread-exhaustion incident)"* — a spot value, not a trend.

**The same shape, twice more.** (i) `event_loop_watchdog`'s `max_lag_ms` — §0 finding 2: the
arming runbook needs days, the counter is bounded by a 26-minute process, and item 24 §2.3
correctly refuses to derive a threshold from a 27-minute after-hours sample. (ii) `[mem]`'s
sibling `[thread-burst]` is honest about the same problem and solves it locally: *"Nobody is
awake to curl /api/health/threads mid-burst, so the pod samples itself"*
(`api/main.py:1472-1476`) — a self-capture that logs the histogram at threshold and a
**subsided** line when it ends *"so the burst duration is in the logs too"* (`:1500`). That is
the right instinct; it still ends at the log boundary.

**Severity: DIGEST, with a deliberate exception.** A slope needs many samples and pooling
across deploys, so it is a weekly number, not a page. ⛔ The exception is a **ceiling
crossing**: RSS above a stated bound, or threads above the 200 threshold that already exists
(`api/main.py:1478`) — item 24 §2.2 records max 178 threads, *"not comfortably far from
200"* — is a page, because the 2026-06-09/10 precedent is a real outage.

### G-4 — the boot auditor audits mutating methods only, and read-only is the terminal's shape

Gate item 23 §1.7 established it and this document confirms the aperture at source:
`api/auth_surface_check.py:79` sets `MUTATING = {"POST","PUT","PATCH","DELETE"}` and `:248`
loops `for method in sorted(m for m in methods if m in MUTATING)`. Item 23's phrasing is the
right one: *"The instrument's design is right in every respect except its aperture."*

⭐ **This belongs in an observability taxonomy, not only a security one, and it is the
cleanest kind-2 instance in the repo.** The instrument's stated rule is *"does every route
carry a recognised guard"*; what it actually keys on is *"does every MUTATING route carry a
recognised guard"*. Those are two different sentences, which is CLAUDE.md's test for kind 2
verbatim (`_merge-master/CLAUDE.md:3321-3323`). And it *reads the artifact* — the live route
objects at boot — so it is not the usual proxy mistake; it is the rarer one, **a correct
artifact read over an incomplete population**. Its output is therefore reassuring in the
exact region a terminal lives in: reads.

⚠️ **One thing item 23 left open and this document does not close:**
`middleware_guarded_prefixes(app)` exists at `:198` and its population was never enumerated,
so some GETs may be covered by a prefix. That is an *unknown coverage set*, which for
observability purposes is the same as uncovered until enumerated.

**Severity: PAGE once widened, silent until then.** Item 23's DP-6 already rules the widening
*"Engineering — no owner input needed … it is additive and fails closed"*, so item 25 adds
only this: **the widened auditor must publish its population size**, not just its failures. A
guard that reports "0 unguarded routes" without saying over how many routes is
indistinguishable from a guard that examined nothing.

### G-5 — thirty modules share one Discord channel, and that channel also carries signups

**Measured.** `grep -rl "DISCORD_WEBHOOK_URL" api/ --include=*.py | wc -l` → **30**. Among
them: `chart_health_alerts`, `event_loop_watchdog`, `worker_main` (down-alert **and** bars
freshness), `desk_session_recap`, `flow_backup`, `flow_gap_autofill`, `liveflow_monitor`,
`journal_two/broker/notifications`, `ipo_maintenance`, `cot_weekly_post`,
`calendar_week_poster`, `terminal_next_monitor_main`, and `discord_notify` — whose
`DISCORD_ADMIN_WEBHOOK = os.environ.get("DISCORD_WEBHOOK_URL", "")`
(`api/services/discord_notify.py:11`) is the same webhook used by `notify_signup` (`:31`),
`notify_waitlist_signup` (`:44`), `notify_subscription` (`:69`), `notify_churn_risk` (`:92`)
and `notify_admin_action` (`:102`). **The operational alert channel is the business-event
channel.** `grep -rhoE 'DISCORD[A-Z0-9_]*WEBHOOK[A-Z0-9_]*'` shows 14 distinct names exist,
so the codebase is perfectly capable of routing — it just does not, for ops.

**Severity: PAGE-quality degradation, and it is the same failure as the grace window.**
The desk audit's 3 h grace exists because *"without it the alert fires on every healthy
session and is muted within a week"* (`desk_session_audit.py:22-26`), and
`terminal_next_monitor_main:161-165` says the same about a closed market:
*"alerting on it every weekend is how a monitor gets muted."* ⭐⭐ **A channel where a page
arrives between two signup notifications is muted by the same mechanism, one level up: it is
not the individual alert that fires on the normal case, it is the channel.** And CARD 16's
retired warm-ratio gate is the third instance of one disease — **a signal that reports a
problem during normal operation gets waived, and then nothing is monitored at all.** Three
independent artifacts in this repo have paid for it; that is the strongest single argument
this document has, and §4.5 makes it a design rule rather than an anecdote.

### G-6 — `chart_health_alerts` is a 200-entry in-memory deque, and its own header says why that failed

`_alerts: deque = deque(maxlen=200)` with `_throttle` and `_discord_last` as module dicts
(`api/services/chart_health_alerts.py:26-30`). The module header records the consequence
(`:11-16`): *"the in-memory deque was admin-pull-only, so a bars-store problem paged no one —
the gap that let the 2026-08-11 daily freeze run for a week."* Discord paging was added for
CRITICAL only (`_should_page_discord`, `:33-42`), with its own 1800 s per-key cooldown
(`:30`) beside the deque's 600 s throttle (`:28`).

⛔ **Both cooldowns are module dicts.** A redeploy clears `_discord_last`, so a standing
critical re-pages on the first cycle after every deploy — the identical defect
`fundamentals_monitor` moved to disk (`:104-112`) and `provider_coverage_monitor` records at
`:138`. **The same fix is available and is one table.** And `worker_main:457-462` already
names this module as the reason the worker-side watchdog exists: *"pages Discord … the
delivery the in-memory chart_health_alerts deque never had."*

**Severity: DIGEST as a defect, PAGE as a risk.** Nothing is currently lost that matters more
than duplicate pages — but duplicate pages are exactly what mutes a channel (G-5).

### G-7 — outside `liveflow_monitor`, silence is indistinguishable from health

`liveflow_monitor:20-22` is the only production construct in this repo under which an
**absent** report is itself an alarm. Every other monitor surveyed is silent-on-healthy by
design and says so: `desk_session_audit.run_audit_and_alert` is *"Silent when everything
landed"* (`:348-349`); `terminal_next_monitor_main` exits quietly when nothing is due
(`:257-261`). ⚠️ Those choices are **correct individually** — a monitor that posts on every
healthy cycle is the G-5 disease. The gap is that no signal has a cadence contract, so *"no
alert since Tuesday"* and *"the cron has not fired since Tuesday"* are the same observation.
`desk_session_audit`'s own docstring flags the sub-case honestly (`:32-36`): *"a quiet run and
a run that found nothing to check look the same in Discord."*

**Severity: PAGE.** It is the failure that hides every other failure. §4.8 is the answer and
it is cheap: one heartbeat per signal per period, and the missing heartbeat is the alarm.

### G-8 — "when was this last true?" is unanswerable for most of these surfaces

CLAUDE.md names this as the only question that finds kind 3
(`_merge-master/CLAUDE.md:3477`). Applied to the census: `/api/admin/bars-stream-status`
returns `last_emit_age_s` (`bar_broadcaster.py:492`) — **answerable**.
`fundamentals-health` carries `last_cycle_at`, `last_alert_at`, `last_digest_at`
(`fundamentals_monitor.py:130-132`) — **answerable**. `desk_session_audit` stamps
`checked_at` (`:132`) — **answerable**. But `/api/watchdog/status` returns `started_at` and
`last_checked_at` (`event_loop_watchdog.py:185-188`) **for this pod only**, so it cannot say
when the loop was last measured over the window the arming decision needs; and the `[mem]`
line carries no timestamp of its own at all (`api/main.py:4517`) — it inherits the log's, and
the log is not a store.

**Severity: DIGEST, but it is a hard precondition on §4.** A monitoring design that cannot
answer "when was this last true?" for its own signals is incomplete by CLAUDE.md's own
standard, so **`as_of` is mandatory on every signal in §4.3** and is not negotiable per
signal.

### G-9 — the options tape has an independent oracle; the bars tape does not

Both are Massive WebSocket consumers whose characteristic failure is **silence**, not error.
The flow tape got `liveflow_monitor` — a 60 s independent poller on a different process with
a rowid-delta oracle, four-way classification, bounded fatigue and a dead-man scorecard — and
its docstring says it *"Would have caught all 16 downtime windows on 2026-07-06"*
(`liveflow_monitor.py:6`). The bars push feed got a status endpoint and a tool
(§G-1). ⭐ **The asymmetry is the finding, and it is also the shortcut**: the design for the
bars stream does not need inventing, it needs porting, and the two ports differ in exactly
one respect — the bars fan-out is last-value-wins so drops are conflation (digest), while the
tape is every-message-matters so a gap is permanent (page). Item 24 Q6 already established
that distinction in code.

### G-10 — the boot fingerprint is load-bearing and has gone stale before

Boot fingerprints are a genuine observability surface here: `api/main.py` prints flag and
wiring state at startup (the `[startup] …` family, and CLAUDE.md documents
`[startup] chart-realtime-mode: …` and `[startup] bars-push-rail: …`). ⚰️ CLAUDE.md also
records that one of those fingerprints **carried a stale literal** — the designated
verification therefore *"read green"* — and that the value is now **interpolated** at boot by
`api/main.py::idb_cache_logic_version()`, which prints `unreadable` rather than guess, with
`tests/test_startup_fingerprint.py` as the rail.

**Severity: DIGEST, and a rule for §4.** ⭐ That fix is the general rule for any fingerprint a
monitor reads: **derive the value, and print `unreadable` rather than a plausible default.**
It is the same rule as `youtube_live`'s `None` (`desk_session_audit.py:249-264`) and
`terminal_next_monitor_main`'s UNREADABLE (`:85-88`), arrived at three independent times.

---

## 4. The proposed architecture

### 4.1 ⛔ The constraint, stated first, because it is the whole shape

`_merge-master/CLAUDE.md` states it as an architecture reality: **the web pod is ONE uvicorn
process = ONE event loop + ONE anyio threadpool (64) shared by all users. Do NOT multi-worker
the web pod (SSE live-price state is in-process).** Three consequences follow, and every
decision in §4.2–§4.9 is one of them:

1. **Every counter in that process is per-process.** `bars_dropped_total`
   (`bar_broadcaster.py:65`), `max_lag_ms` (`event_loop_watchdog.py:122`), the
   `chart_health_alerts` deque and both its cooldown dicts (`:26-30`), and
   `fundamentals_monitor._state` (`:116-133`) are all module state.
2. **A redeploy is a data-loss event for all of it**, and item 24 §2.5 supplies the rate:
   fourteen deploys in six and a half hours, median pod life 26 minutes. ⭐ This also means
   the *frequency* is not incidental: item 24 §4 D9 re-scored frequent recycling as partly
   load-bearing against the leak, so the answer is never "deploy less so the counters
   survive" — it is "put the counters where a deploy cannot reach them."
3. **A Railway volume mounts to exactly one service.**
   `terminal_next_monitor_main.py:12-17` records this and its consequence: `/data` belongs to
   `web`, so any other service must reach state over the private network
   (`web.railway.internal`), *"the same idiom `WORKER_INTERNAL_URL` already uses"*. So
   "durable" and "out-of-process" are two different properties and must be designed
   separately.

### 4.2 The tiering rule — cumulative vs distributional decides where state lives

⭐ **This is the one new idea in this document and it falls straight out of §0 finding 2.**

| tier | state lives | fit for | unfit for | precedent |
|---|---|---|---|---|
| **T0 — in-process, ephemeral** | module memory on `web` | a **distributional** quantity over a window shorter than a pod's life: a latency percentile, a fill rate, a current subscriber count | anything cumulative or compared across deploys | `provider_coverage_monitor` sampling; `breadth_timing` per-request |
| **T1 — volume-durable on `web`** | a SQLite table or a JSON marker under `DATA_DIR` | a **suppression set**, a **cursor**, a **digest stamp**, an observation history that must outlive a deploy | anything that must be readable when `web` itself is the thing that is down | `fundamentals_monitor.defect_state` (`:98-112`); `desk_session_audit` liveness state (`:218-246`); `liveflow_scorecard` markers (`:53`) |
| **T2 — out-of-process** | the `worker` service, or `terminal-next-monitor` | **liveness of `web`**, a **cadence contract** (dead-man), a **slope pooled across deployments**, anything whose failure mode includes "`web` cannot answer" | anything needing the volume directly (it cannot mount it) | `worker_main` down-alert (`:646-663`); `liveflow_monitor`; `terminal-next-monitor` |

⛔ **The test for which tier a signal belongs in is one question: does the quantity accumulate
across process lifetimes?** A latency p95 does not — 26 minutes of requests is a valid sample
of a distribution, which is why G-2's fix is allowed to be T0/sampled. A leak slope, a drop
total and a max-over-days do — which is why G-1 and G-3 cannot be fixed inside `web` at all,
no matter how carefully.

⚠️ **And the deploy cadence is itself a covariate, not just a nuisance.** Item 24 §2.5 records
fourteen deploys destroying measurement windows. Any T2 slope must therefore report
`deployments_sampled` beside the slope, because a slope pooled over three 30-minute pods and a
slope from one 104-minute pod are different measurements even when they agree.

### 4.3 The signal table

Ten signals. For each: what it reads, artifact or proxy, which kind it is exposed to, tier,
cadence, grace, severity, and how it is proved able to fire. ⛔ **`as_of` is mandatory on all
ten** (G-8). Every one is a port of an existing pattern; the "precedent" column names it so
none of this is new machinery.

| # | signal | reads | A/P | kind | tier | cadence / grace | severity | precedent |
|---|---|---|---|---|---|---|---|---|
| **S1** | **push-rail silence** — `bars_emitted_total` flat while `subscriber_pairs > 0` during RTH | `/api/admin/bars-stream-status` | **A** | 1 (RTH window moves with the calendar) | **T2** | 60 s in session; 3 consecutive confirms | **PAGE** | `liveflow_monitor` `classify_poll` (`:125-153`) |
| **S2** | **drop accumulation** — Δ`bars_dropped_total` between polls | same | **A** (delta, not total — the total is per-process) | 2 across a deploy | **T2** | 60 s; daily rollup | **DIGEST** | `liveflow_monitor` `max_id` delta (`:11-13`) |
| **S3** | **served-latency percentile** per surface × timeframe | `Server-Timing` on `/api/bars` (`bars.py:912-927`) | **A** | 2 if the quantity is unnamed — §4.9 OBS-1 names it | **T0** sampled, reported **T2** | on demand + daily; pod ≥ 300 s | **PAGE** on the gate, **DIGEST** on the tier mix | `bars_warmth_audit` (fixed per G-2) |
| **S4** | **RSS slope** and **thread ceiling** | `[mem]` lines, pooled per deployment id | **A** | 1 (the log rotates) | **T2** | one reading per run; ≥ 40 samples in one deployment before a slope is emitted | **DIGEST** for slope; **PAGE** on a ceiling crossing | `disk_watchdog` crossing-vs-cadence (`:21-24`) |
| **S5** | **loop-lag distribution** — not `max_lag_ms` | `/api/watchdog/status`, sampled and **accumulated outside** | **A** per sample, **P** if the in-process max is used | **2** — §0 finding 2 | **T2** | 60 s in session; percentile over ≥ 1 trading day | **DIGEST** until CARD 18's condition is met | `event_loop_watchdog` counters, read differently |
| **S6** | **cadence heartbeat** per signal | its own last-run marker | **A** | 3b | **T1** marker + **T2** reader | one per signal per period; **absence is the alarm** | **PAGE** | `liveflow_monitor` dead-man (`:20-22`) |
| **S7** | **auth-surface population** — unguarded count **and denominator** | boot auditor output, widened per item 23 DP-6 | **A** over an incomplete population until widened | **2** (G-4) | every boot; compared across boots | **PAGE** on a non-zero unguarded count | `auth_surface_check` (`:225-252`) |
| **S8** | **alert-channel separation** — ops traffic on its own webhook | env config | **A** | — | n/a | config, not an alert | `DESK_TSDR_ANNOUNCE_SHOWS` fail-silent idiom |
| **S9** | **fingerprint drift** — the boot fingerprint's interpolated values | `[startup] …` lines | **A** | **3b** (G-10) | every boot | **DIGEST** | `idb_cache_logic_version()` + `tests/test_startup_fingerprint.py` |
| **S10** | **web liveness from outside** *(exists — do not rebuild)* | `/api/health` | **P** for "did my deploy ship" | **2**, with a published incident | **T2** | 60 s, 2 confirms, 30-min renag | **PAGE** | `worker_main._down_alert_decision` (`:420-437`) |

⛔ **S10 is listed to be left alone, with one label added.** `_merge-master/CLAUDE.md`
records the kind-2 incident precisely: when a deploy is superseded mid-flight,
`/api/health uptime_seconds` resolves to the **superseding** pod's boot, so a blip check
read a clean monotonic uptime and *"named it as proof of its own deploy; it was measuring the
other session's pod."* The remedy stated there is to verify a deploy by its own record's
status and by ancestry, **never by an uptime you did not tie to a named deploy**. So S10 is
a fine liveness signal and must never be used as a deploy-verification signal, and the route
should say so where it is read.

### 4.4 Severity — two tiers plus UNREADABLE, from one question

Adopt `fundamentals_monitor`'s rule verbatim (`:63-78`): **"who is supposed to guarantee
this?"**

- **PAGE** — an invariant **our** code enforces has stopped holding. S1 (the rail is
  supposed to emit), S3 (the gate is supposed to be evaluable and met), S6 (the signal is
  supposed to report), S7 (a route is supposed to carry a guard), S10 (the site is supposed
  to answer), and any ceiling crossing in S4.
- **DIGEST** — real, recorded, and not actionable at 23:00: S2, S5, S9, the S4 slope, and
  the S3 tier mix. One message per `<signal>_DIGEST_SECONDS`, **stamped on the volume**, not
  in memory (`fundamentals_monitor.py:104-112` is the reason).
- ⛔ **UNREADABLE — a third state, never folded into either.** A store that will not open, a
  report that times out, a `web` that will not answer, a fingerprint that cannot be parsed:
  each reports as UNREADABLE **with its reason**. Three modules arrived at this
  independently (`terminal_next_monitor_main.py:25-29`, `desk_session_audit.py:249-264`,
  `idb_cache_logic_version()` printing `unreadable`), and item 24's own §2.2 GAPS plus this
  programme's `_doc_text(None)==''` incident are what happens without it: **a layer that
  could not be READ is not a layer that is EMPTY.**

### 4.5 ⭐⭐ Grace windows, and the argument that decides the whole design

**Three artifacts in this repo record the same failure, arrived at independently.**

1. `desk_session_audit.py:22-26` — insights land 2 min–3 h after publish, so a session
   younger than the 3 h grace is not checked at all: *"Without that, this alert fires on
   every healthy session and is muted within a week."*
2. `terminal_next_monitor_main.py:161-165` — *"A CLOSED MARKET IS NOT A FAULT, and alerting
   on it every weekend is how a monitor gets muted."*
3. **CARD 16's retired warm-ratio gate** — item 24 §2.1 states it in the gate's own terms:
   daily reads 0 % warm at p50 104 ms, *"a definition of done that a healthy system fails is
   a definition that gets waived, and then nothing is gated at all."*

⭐⭐ **Those are one finding at three altitudes: an alert, a monitor, and a gate. The rule is
that a signal which fires on the normal case is not a noisy signal — it is a signal that will
shortly be no signal.** Two consequences, and both are non-negotiable in §4.3:

- **Every PAGE carries a stated grace or confirm count**, and the value is justified by the
  latency of the thing it watches — not chosen for comfort. S1's three confirms are the
  RTH-poll analogue of the down-alert's two (`worker_main.py:415`); S3's "pod ≥ 300 s" is
  §8's own Governing Rule 1; S4's "≥ 40 samples in one deployment" is derived from item 24
  §2.2's finding that a 5-sample window read flat-to-declining on a leaking pod.
- **G-5 is the channel-level instance of the same disease and must be fixed with the rest.**
  A grace window on each alert, delivered into a channel that also carries signups, buys
  nothing: the mute happens at the channel.

### 4.6 A guard nobody has seen fire is not a guard — four proof methods, each with a precedent

Every signal in §4.3 needs a stated way to prove it can fire. This repo has already
established four, and each of the ten maps to one. ⛔ **None of these was executed by this
document** (no test, no script, no network by instruction); this is the design obligation and
who discharges it.

1. **A pure decision function, unit-tested with a control.** The strongest and the cheapest.
   `worker_main._down_alert_decision` (`:420-437`) and `_bars_freshness_decision` (`:491-503`)
   and `liveflow_monitor._liveflow_alert_decision` (`:163`) are all pure `(prev, observation,
   now) -> (state, event)` machines, so every transition — including *still_down* and
   *recovered* — is provable without a socket. **S1, S2, S5, S6 and S10 are all this shape and
   must be written this way.**
2. **A pure clamp or classifier, proved at its boundaries.**
   `desk_session_audit.clamp_liveness_limit` (`:207-215`) is documented as existing so *"the
   ceiling is provable without a browser or a socket"*. **S3's percentile-on-N and S4's
   minimum-sample rule are this shape.**
3. **Mutation-checking the wire, not just the logic.** `tests/test_desk_session_audit.py` is
   pinned two ways — an AST over `api/main.py` proving the `add_job` id exists, and a
   route-presence check off `router.routes` — *"each with a non-vacuity control asserting the
   probe can see a sibling it isn't looking for"*, and CLAUDE.md records it mutation-checked
   four ways: cut the scheduler wire, cut the route, delete the grace window, or swap names
   for a count, and each goes RED. ⛔ **The wire is the part that has actually been cut in
   this repo** — the insights pass was *"written, documented as scheduled, wired into no
   scheduler"* for weeks — so **every signal in §4.3 needs the AST-over-the-scheduler rail,
   not only a logic test.**
4. **A live trigger with an injected verdict.** `sweep_liveness(check=...)` is late-bound
   *"so a test can inject a verdict table without a socket"* (`:267-272`). **S7 and S9 use
   this**: feed the auditor a route with no guard and a fingerprint that cannot be parsed,
   and assert the alert text names them.

⚠️ **And the anti-pattern, because it is in this file's neighbourhood.** CLAUDE.md records
that a default argument bound at import (`x_fn=real_function`) makes `monkeypatch.setattr`
reach nothing, so *"the test silently exercises the real function"* — it names
`deploy_watch.py:93`, `:99` and `window_check.py:883` as surviving instances. **Every injected
seam in a new monitor must be `=None` and resolved in the body**, or its proof is theatre.

### 4.7 "When was this last true?" — the `as_of` contract

Three fields on every signal, no exceptions (G-8):

- **`as_of`** — when the underlying value was last *observed*, not when this response was
  assembled. `last_emit_age_s` (`bar_broadcaster.py:492`) is the good example; a bare
  `checked_at` on a cached value is the bad one.
- **`window`** — the span the value summarises, and for a T2 slope also
  **`deployments_sampled`** (§4.2). ⭐ A p95 with no N and a slope with no window are not
  comparable to their own previous readings, which is the whole purpose.
- **`commit`** — the running build, exactly as `terminal_next_monitor_main` already does on
  every post (`:100`, from `RAILWAY_GIT_COMMIT_SHA`/`RAILWAY_DEPLOYMENT_ID`/`GIT_COMMIT` at
  `:64-68`): *"a reading without the build it came from cannot be compared to the next one."*

⛔ **And the obligation is recursive.** The monitor must be able to answer the question about
*itself*: S6 exists so that "when did this signal last report?" has an answer that does not
depend on the signal being healthy.

### 4.8 Dead-man conventions — the only construct under which silence is unambiguous

Port `liveflow_monitor`'s scorecard convention (`:20-22`, `_scorecard_due` `:408-414`, marker
path `:416-418`) to the observability plane as **S6**:

- Each signal writes a **marker** on `web`'s volume (T1) every period it runs — the same
  atomic `os.replace` idiom as `desk_session_audit._write_state` (`:232-246`).
- `terminal-next-monitor` (T2) reads the markers over the private network and posts **one**
  daily roll-up naming every signal that did **not** report in its window.
- ⛔ **The roll-up posts even when everything is fine** — that is the whole point, and it is
  the one deliberate exception to §4.5's "never fire on the normal case", because it is not
  an alert, it is the cadence proof. `docs/runbooks/rth-scheduling.md` already states the
  principle in the owner's words: *"the preflight alerts on GO as well as NO-GO: silence
  should never need interpreting."*
- ⚠️ **Exactly one such message per day, on the ops channel.** A dead-man that posts hourly
  becomes the thing that mutes the channel, which would be this document losing its own
  argument.

### 4.9 Defaultable rulings — the numbers nobody has chosen

⛔ Each is a **ruling, vetoable in one word**, not a question handed back. Each states what
would overturn it.

| id | decision | proposed default | why this default | overturned by |
|---|---|---|---|---|
| **OBS-1** | Which latency does the p95 gate mean? | **Client wall-clock**, n ≥ 60 per timeframe, `stale-swr` counted as SERVED per CARD 16, with the tier mix reported beside and never as pass/fail | CARD 16's purpose is the member's experience, and client wall-clock is the only quantity that includes Cloudflare and the network; 60 gives ~1.7 pp percentile resolution against 40's 2.5 pp | a ruling that the gate is a **server-compute** budget — then read `dur` from `Server-Timing` (`bars.py:912-927`), which `bars_warmth_audit.py:62-64` currently discards, and set a lower bar |
| **OBS-2** | Drop-counter alert threshold | **Any** Δ`bars_dropped_total` → DIGEST. `bars_emitted_total` flat across **3** consecutive 60 s RTH polls with `subscriber_pairs > 0` → PAGE | the fan-out is last-value-wins by construction (item 24 Q6), so a drop is conflation; silence is the data-loss case the route's own docstring names (`bars.py:1288-1291`) | one week of RTH data showing drops are routine at the open — then floor the digest at a measured rate rather than at zero |
| **OBS-3** | Leak-slope emission rule | **≥ 40 `[mem]` samples within one deployment id** before a slope is emitted, and report `deployments_sampled` | item 24 §2.2: 5 samples on a 5-minute pod read flat-to-declining on a pod leaking 7.9 MB/min; 40 samples ≈ 40 min, above the 26-minute median but reachable | a decision that cross-build slopes are not comparable — then pin to one deployment id and accept a sparser series |
| **OBS-4** | RSS / thread ceilings | **PAGE** at threads > 200 (reuse `THREAD_BURST_LOG_THRESHOLD`, `api/main.py:1478`) and at RSS > **3,500 MB** | 200 is already the shipped threshold with a 2026-06-09/10 outage behind it; item 24 §2.2 measured max RSS 3,401 ⚠️[cited to ARCH-07 §2.2; the figure actually lives in `docs/perf-baseline-2026-09-26.md:35` as the rss RANGE max — real and measured, wrong pointer, corrected by the orchestrator 2026-09-26] MB in a healthy-but-leaking window, so 3,500 is just above observed normal | a capacity decision that raises the pod's memory limit — then re-derive the ceiling from the new limit, never from the old number |
| **OBS-5** | Observation retention | **90 days** per signal, **max 400 rows** per signal, on `web`'s volume | a slope needs weeks and more than one deployment to be more than `n = 1`; and the volume has a measured 33 GB runaway in its history (`disk_watchdog.py:3-8`), so an unbounded observation table is the exact class that incident belongs to | a ruling that the trend belongs in an external store — then this becomes an export cadence, not a retention number |
| **OBS-6** | Alert fatigue caps | **≤ 6 messages per incident, 10 per day, per signal** | copied verbatim from `liveflow_monitor.py:17-19`, which is the only fatigue budget in this repo that has survived contact with an incident | an owner preference for uncapped pages on a named PAGE signal |
| **OBS-7** | Grace / confirm defaults | **3 h** for artifact audits · **3 polls** for stream liveness · **2 polls** for web liveness (already shipped) · **pod ≥ 300 s** for any latency or warm measurement | each is an existing shipped value with a written reason: `desk_session_audit.py:45`, `worker_main.py:415`, §8 Governing Rule 1 | a measurement of the actual latency of the watched thing — which is the only thing that should ever move a grace window |
| **OBS-8** | The channel | A new **`DISCORD_OPS_WEBHOOK_URL`** carrying PAGE and DIGEST, **falling back to `DISCORD_WEBHOOK_URL` when unset** | the codebase already has 14 webhook names, so routing is free; the fallback means a missing variable degrades to today's behaviour and **never to silence** — the same failure direction `DESK_TSDR_ANNOUNCE_SHOWS` chose | an owner preference for one channel — in which case G-5 stands as an accepted risk and should be recorded as one |
| **OBS-9** | Where S1–S6 run | **`terminal-next-monitor`**, as added jobs on the existing ET schedule table (`:203-213`), **not** a new service | it already has the cron, the admin-channel rule with a test, the UNREADABLE discipline, the commit stamp and the truncation guard; a sixth service is five more things to forget (its own `:210-213` argument) | a ruling that observability must not share a service with programme self-reporting — then the `worker` is the second-best host, since `liveflow_monitor` and the down-alert already live there |

---

## 5. What to do first, ordered by leverage

The order is by **(evidence unlocked) ÷ (work)**, and each item states why it precedes the
next.

1. ⭐⭐ **Make CARD 16's gate measurable — two constants and one print.** In
   `tools/bars_warmth_audit.py`: move `"stale-swr"` from `COLD` to `WARM` (`:27-28`) per the
   ruling that already exists, print a p95 for **both** buckets (`:109-116`), and print `n`
   and which quantity is being reported (OBS-1). **First because it is the smallest change in
   the list and it unblocks the one gate the programme has already ruled on** — and because
   until it lands, every warm/latency number produced by this repo is bucketed against a
   definition that was retired. ⛔ Ship it with the control that proves the fix is real: a
   fixture of 40 `stale-swr` samples must produce a p95 line, which today's code cannot.
2. ⭐ **Fix the two stale citations of `api/main.py:3639-3644`** (item 24 §2.2 and
   `docs/perf-baseline-2026-09-26.md:23-24`) to `api/main.py:4510`. **Second because it is
   free, because two artifacts now carry it, and because a wrong line number in the document
   that names the leak is the same defect class as everything else in this file.** Grep the
   constant, not the line.
3. **Add S1 and S2 to `terminal-next-monitor` as one job** (OBS-9), written as a pure
   decision function (§4.6 method 1) with the AST-over-scheduler rail (method 3). **Third
   because it closes Q10 — the question item 24 handed to this item — and because it is a
   port of `liveflow_monitor`, not a design.** The asymmetry in G-9 means the hard thinking is
   already done.
4. **Add S6, the dead-man roll-up.** **Fourth and not later, because it is what makes items
   3, 5 and 6 verifiable**: without a cadence contract, a monitor that stops running is
   indistinguishable from a system with nothing to report (G-7), and every subsequent signal
   inherits that hole the day it ships.
5. **Split the channel (OBS-8).** **Fifth because it is configuration, not code**, and
   because items 3 and 4 begin adding traffic to the channel that G-5 says is already
   mixed — the split should land before the traffic does, not after.
6. **Add S4 — the `[mem]` slope reader** in the same monitor, honouring OBS-3 and OBS-5.
   **Sixth because it needs 3–5 to be trustworthy** (a slope with no cadence contract and no
   `deployments_sampled` is item 24's `n = 1` again) and because it is the only item here that
   requires reading logs rather than an endpoint, which is genuinely more work.
7. **Move `chart_health_alerts`' cooldown dicts to the volume (G-6)** — one table, the
   `fundamentals_monitor.monitor_meta` shape (`:104-112`). **Seventh because it is a
   duplicate-page problem, and duplicate pages only matter once the channel is worth
   listening to (item 5).**
8. **Widen `auth_surface_check` to GETs and publish the denominator (G-4 / item 23 DP-6).**
   **Eighth not because it is unimportant but because item 23 owns the decision and has
   already ruled it needs no owner input**; item 25's only addition is the denominator, which
   is one line.
9. **S5, the loop-lag distribution.** **Last, deliberately.** CARD 18 ruled NOT YET on arming
   and named its condition (one window spanning a market open **and** a heavy-job window), and
   S5 exists to *produce* that window rather than to pre-empt the ruling. ⛔ Nothing here arms
   the killer.

⚠️ **One item deliberately absent from this list: anything that changes the deploy cadence.**
Item 24 §4 D9 re-scored frequent recycling as partly load-bearing against the leak, and §4.2
(3) says the fix for a counter a deploy destroys is to move the counter, never to deploy less.

---

## 6. ⛔ What this document does NOT decide

1. **Whether to arm the event-loop watchdog.** CARD 18 ruled NOT YET and named the condition;
   this document supplies S5 as the instrument that could eventually satisfy it and takes no
   position on the threshold. ⛔ §0 finding 2 makes the narrower point that the *arming
   procedure as written* is unsatisfiable on a 26-minute pod — that is an argument about the
   procedure, not about arming.
2. **Any threshold that would kill or restart a process.** Every PAGE in §4.3 is a
   notification. Nothing here is wired to `os._exit`, a redeploy, or a flag flip.
3. **Whether Terminal-Next runs in its own process.** Item 24 Q7 owns it and is blocked on
   the panel count and on the leak. §4.2's tiering applies to whatever topology is chosen and
   does not argue for one.
4. **The panel count, the conflation rate, or any capacity number.** Item 24 §6 items 1, 5
   and 8; CARD 15 ruled an absolute production capacity number out of scope.
5. **Any edge or Cloudflare configuration.** Item 24 §1.5 and §6.3 bar it until the existing
   rule and the cache key are read. ⚠️ This document adds one observation that must not be
   misread as an argument for caching: the Cloudflare ~100 s proxy budget already shapes an
   observability decision here (`desk_session_audit.py:184-190` caps an on-demand sweep at 15
   so the caller is not 524'd), so the edge is a constraint on monitors, not a lever for them.
6. **Entitlement design, and the fix to `auth_surface_check`.** Gate item 23 owns both;
   §G-4 and §5 item 8 add only the denominator requirement.
7. **Whether the leak is fixed, or what leaks.** Item 24 §5.1 owns the ordering
   ("fix the leak before choosing a process topology"). S4 measures the slope; it does not
   attribute it, and no per-subsystem breakdown is proposed here.
8. **Any retention or threshold number as a final value.** OBS-1 to OBS-9 are defaultable
   rulings. Each names what would overturn it, and a one-word veto from the owner is
   sufficient for any of them.
9. **Whether an external monitoring vendor should be used.** No vendor was evaluated, no
   network call was made, and the architecture above deliberately uses only what the repo
   already runs. That is a cost and vendor decision, not an architecture one, and it is
   unowned.
10. **Whether `terminal-next-monitor`, `liveflow_monitor`,
    `provider_coverage_monitor` or `fundamentals_monitor` are RUNNING in production today.**
    No Railway read was available. `docs/feature_flags.json` records
    `TERMINAL_NEXT_MONITOR_ENABLED` as `status: "armed"`, `where: ["terminal-next-monitor"]`,
    and the other three default OFF in code (`provider_coverage_monitor.py:835`,
    `fundamentals_monitor.py:625`, `liveflow_monitor.py:41`). ⛔ A code default is not a
    production state; `railway variables --service web --kv` is the only authority and it was
    not run.

---

## GAPS — what this document could not reach

- ⛔ **No production read of any kind.** Not one counter here was observed live; every observed value is carried from `docs/perf-baseline-2026-09-26.md`, which states its own validity context. So *"the drop counters are unread"* is a claim about **artifacts in this repository**, never about a person's habits.
- ⛔ **No Railway service, variable or log read**, by instruction. Consequences: flag states are quoted, never asserted (§6.10); the number of services actually running is not established; and whether `terminal-next-monitor`'s cron has ever fired is unknown here.
- ⛔ **No Windows Task Scheduler read.** `docs/runbooks/rth-scheduling.md` describes nine tasks on the owner's box, all one-time triggers. A standing schedule held there is invisible to this document, so G-1 is phrased *"no standing schedule recorded in this repository"* and not *"nobody reads them"*.
- **SHA not pinned (no git by instruction).** Every `file:line` is against the working tree of `C:\Users\Patrick\uct-worktrees\_merge-master` as read on 2026-09-25 and cannot be tied to a commit here. ⚠️ Given §1's ⚰️ — an inherited citation that drifted ~870 lines in one file — grep the quoted string rather than trust the number if the tree has moved.
- **No guard was proved to fire.** §4.6 states the four methods and which signal uses which; none was executed, because no test may be run under this document's constraints. ⛔ By this document's own standard, **every signal in §4.3 is an unproved guard until §4.6 is discharged** — a precondition of shipping any of them, not a footnote.
- **The route census is a floor, not a total** (§1): it counts declarations matching a literal, so status surfaces named otherwise are excluded, and unmounted routers would still be counted.
- **`middleware_guarded_prefixes(app)` population still not enumerated** (G-4), inherited unresolved from item 23 §1.7. Until it is, GET coverage is an unknown set.
- **No cost estimate.** Adding S1–S6 to `terminal-next-monitor` adds cron firings and private-network calls; `terminal_next_monitor_main.py:252-255` notes a container that slept between crons *"would also bill for the sleeping"*, so the shape is right, but no number is offered.
- **The `Server-Timing` sub-metric surface was read only in `bars` and `breadth`.** Whether other routes emit it — and therefore whether S3 can widen past those two surfaces — was not swept.

## SOURCES

**Programme artifacts (read in `C:\Users\Patrick\uct-worktrees\terminal-research`):**
`07-technical-architecture/realtime-performance-architecture.md` (gate item 24, in full — §0, §1.5, §2.1–§2.5, §3 Q6/Q7/Q10, §4 D9, §5, §6, GAPS) · `07-technical-architecture/current-performance-and-realtime.md` (§ outline; §4.3 and §8 as quoted by item 24 and the baseline) · `07-technical-architecture/domain-streaming-caching.md` (`:210-248` the drop-counter OPEN QUESTION; `:865-876` the ten questions) · `docs/perf-baseline-2026-09-26.md` (in full; Protocols A/B/D/E/F/G and CARD 16 at `:290-306`) · `00-program-control/CRITICAL_PATH.md` (the CP-05 cell) · `09-security-licensing-cost/security-entitlement-architecture.md` (`:373-400` §1.7, `:726` DP-6, `:732` the proposal).

**Source, read READ-ONLY in `C:\Users\Patrick\uct-worktrees\_merge-master`:**
`CLAUDE.md` (`:3305-3323` the two instrument-failure kinds and the kind-2 test · `:3346-3386` the import-bound default-argument class · `:3388-3409` two instruments agreeing · `:3462-3521` kind 3, "When was this last true?", and the `uptime_seconds` consequence · `:3523-3543` the one-master-merge ruling and the 14-push deploy measurement · `:5467-5505` the desk session audit · `:5507-5573` the launch-hardening single-process constraint and the down-alert · `:5575-5636` the fundamentals monitor, its suppression-set ⚰️ and `_CRITICAL_KINDS` · `:1541-1542` the bars-push observability line) ·
`api/main.py` (`:1465-1503` thread-burst watch · `:3637-3648` the comment at the stale citation · `:3824-3826` `provider_coverage_monitor.start()` · `:4505-4521` `_web_memwatch` and the "prerequisite" comment at `:4510` · `:5492-5512` the `alert_bars_freshness` job · `:6613-6628` the `desk_session_audit` add_job · `:8317-8329` `/api/health` · `:8332-8363` `/api/ready` · `:8366-8396` the no-auth set and the gated health family) ·
`api/worker_main.py` (`:63-82` the worker `[mem]` line · `:415-454` down-alert constants, `_down_alert_decision`, `_post_discord` · `:457-569` the bars freshness watchdog, its pure decision machine and `_bars_alert_text`'s ⛔ remedy note · `:572-663` keep-warm and the down-alert loop · `:895` `start_liveflow_monitor`) ·
`api/terminal_next_monitor_main.py` (in full, 269 lines) · `api/routers/terminal_next_reports.py` (`:1`, `:80`, `:87`) ·
`api/services/liveflow_monitor.py` (`:1-41` the design docstring and the gate · `:125-153` `classify_poll` · `:163` the alert decision · `:408-418` `_scorecard_due` and the marker · `:582-596` `start_liveflow_monitor`) ·
`api/services/desk_session_audit.py` (in full, 365 lines) · `api/services/desk_daily_session.py` (`:329-349` `check_missing_session_alert`) ·
`api/services/fundamentals_monitor.py` (`:19-21`, `:45`, `:60-133` the severity split, durable state, schema and status dict · `:515` `_alert` · `:597-599` the critical filter) ·
`api/services/provider_coverage_monitor.py` (`:1-82` the docstring · `:99-127` bounds and DB path · `:138` the durable baseline comment · `:243` `_recent_baseline` · `:316-337` `_evaluate_field` · `:721` `_alert` · `:835-865` the gate and `start()`) ·
`api/services/chart_health_alerts.py` (`:1-80` header, deque, throttles, Discord gate) · `api/services/disk_watchdog.py` (`:1-28` the incident and the design notes) · `api/services/bar_broadcaster.py` (`:63-65` the counters · `:435-444` the drop increment · `:478-492` the status dict) ·
`api/routers/bars.py` (`:912-927` `Server-Timing` emission · `:1236`, `:1249`, `:1255-1265` the disk-status docstring and the no-auth siblings · `:1285-1307` bars-stream-status · `:1309` warm-universe-status) ·
`api/event_loop_watchdog.py` (`:34-52` the arming runbook · `:85-106` `should_kill` · `:118-136` `_fresh_state` and the module state · `:180-224` the status and stacks routes · `:307-308`, `:356-357` the max update) ·
`api/services/breadth_timing.py` (`:37-52`, `:79`, `:175`, `:347`, `:402-415`) · `api/auth_surface_check.py` (`:50`, `:64`, `:79`, `:118`, `:198`, `:248`) · `api/services/discord_notify.py` (`:11-13`, `:31`, `:44`, `:69`, `:92`, `:102`) · `api/routers/fundamentals.py:224` · `api/routers/provider_coverage.py:29` · `api/routers/admin_api_health.py:1-40` · `api/baselines.py` (`:140`, `:329-333` — the p95 control) ·
`tools/bars_warmth_audit.py` (in full, 121 lines; `:27-28`, `:56-73`, `:77-117`) · `tools/market_open_chart_check.py` (`:247`, `:283`) · `railway.json` (the `startCommand` service switch) · `docs/feature_flags.json` (the `TERMINAL_NEXT_MONITOR_ENABLED` entry) · `docs/runbooks/rth-scheduling.md` (`:1-60`) · `docs/runbooks/held-flags-and-checks.md:28`.

**Greps run (all read-only, over `_merge-master`; commands in §1):** the 91-route and 12-admin-route counts · `DISCORD_WEBHOOK_URL` file list (30) and the `DISCORD_*WEBHOOK*` name histogram (14) · `add_job` count in `api/main.py` (162) and the `id="…"` roster · `"api/admin/"` over `tools/ scripts/ .github/ docs/runbooks/` · `"get_broadcaster().get_status()\|bar_stream.get_status()"` over `.` (2 hits, both the route) · `"run_audit_and_alert"` over `.` (the scheduled-reader **control**) · `"p95\|percentile"` over `api/` (one module, `baselines.py` — the **control** proving the grep can see a presence) and `"p95"` over `tools/ scripts/` (20 files) · `"market_open_chart_check"` over `.` (3 paths, two of them prose) · `"schedule:"` and `"cron:"` over `.github/workflows/` (one scheduled workflow — the CI **control**) · `"prerequisite for any further memory work"` over `api/` (one hit, `:4510` — the ⚰️ in §1) · `"liveflow_monitor"` scoped, then repo-wide (the self-correction in §2.4) · `"\[mem\]"`, `"thread-burst"` and `"\[startup\]"` over `api/`.

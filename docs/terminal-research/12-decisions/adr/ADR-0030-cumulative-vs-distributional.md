---
id: ADR-0030
title: Cumulative versus distributional decides where a counter's state may live
status: accepted
date: 2026-09-26
decided_by: the programme (gate item 25 / ARCH-07-OBS)
gate_item: 25
promotion: Locked: it is the one new design rule item 25 produces, derived from two signals proved UNREADABLE rather than merely unread, and it decides a tier by a property rather than by convenience.
supersedes: the reading of the drop counters and the watchdog maximum as merely UNREAD
superseded_by: none
register_row: none
---

# ADR-0030 — Cumulative versus distributional decides where a counter's state may live

**STATUS: ACCEPTED** · 2026-09-26 · decided by the programme (gate item 25 / ARCH-07-OBS) · gate item 25

**Why it is an ADR and not a tracker row:** Locked: it is the one new design rule item 25 produces, derived from two signals proved UNREADABLE rather than merely unread, and it decides a tier by a property rather than by convenience.

**Supersedes:** the reading of the drop counters and the watchdog maximum as merely UNREAD

## Context

⛔⛔ **Two of the three signals this programme most needs are not merely UNREAD — they
are UNREADABLE by the process that holds them, for the same reason.**

* `event_loop_watchdog._state["max_lag_ms"]` starts at `0.0` in `_fresh_state()`
  (`api/event_loop_watchdog.py:122`, installed `:136`) and only ratchets up in-process
  (`:307-308`, `:356-357`). Its own arming runbook, in the same file, instructs the operator to
  watch it *"for a few days"* across a market open and a heavy-job window (`:46-49`) and then set
  the kill threshold at *"3-5x"* the observed maximum (`:50`). **Median pod life is 26 minutes.**
  A maximum-since-boot cannot span days on a process that lives 26 minutes, *"so the number the
  arming decision is supposed to rest on has never existed."*
* `bar_broadcaster._bars_dropped_total` (`api/services/bar_broadcaster.py:65`) is the same shape
  — a per-process monotonic total, reset to 0 by every deploy.

(`10-roadmap/observability-plan.md:50-115`, finding 2)

## Decision

⭐ **Per-process state is fatal for a CUMULATIVE quantity** (a leak slope, a drop total, a
max over days) **and perfectly adequate for a DISTRIBUTIONAL one measured inside one pod's life**
(a latency p95). **Which tier a signal belongs in is decided by that property, not by
convenience.** (`:50-115`, `:589-609` §4.2)

Two corollaries the same document states:

* ⛔ **The fix for a counter a deploy destroys is to MOVE THE COUNTER, never to deploy less**
  (§4.2(3); see ADR-0029).
* **UNREADABLE is never zero**, and severity is two tiers **plus UNREADABLE**
  (`:639-658` §4.4). Silence is unambiguous only under a **dead-man convention**
  (`:740-757` §4.8).

## Alternatives actually considered

1. **Persist the streak/counters in memory and alert on consecutive failures.** Rejected with a
   named precedent: `desk_session_insights._FAIL_STREAKS` alerts on the 4th consecutive failure,
   which needs an uninterrupted hour of 15-minute passes on a pod that redeploys several times a
   day — *"a proxy that resets on redeploy reports healthy straight through a total
   failure."*
2. **A sixth Railway service for observability.** Rejected by OBS-9: `terminal-next-monitor`
   already has the cron, the admin-channel rule with a test, the UNREADABLE discipline, the commit
   stamp and the truncation guard — *"a sixth service is five more things to forget"*
   (`:759-776`).

## Consequences

* ⭐⭐ **The monitor this item would have designed already exists as its own Railway
  service:** `api/terminal_next_monitor_main.py`, cron-invoked with `--once`, holding **no
  in-memory state**, whose own comments already solve every failure mode the item would have
  re-derived — including *"A CLOSED MARKET IS NOT A FAULT, and alerting on it every weekend
  is how a monitor gets muted"* (`:161-165`). **So the design question is "which jobs", not "what
  monitor"** (`:50-115`, finding 1).
* OBS-1 … OBS-9 are **defaultable rulings, each vetoable in one word**, and each names what
  would overturn it (`:759-776`, `:830` point 8). ⛔ **They are deliberately NOT promoted to
  ADRs here** — a ruling a one-word veto can reverse has not locked.
* ⛔ **Not decided:** any threshold that would kill or restart a process (every PAGE is a
  notification, nothing is wired to `os._exit`); whether an external monitoring vendor should be
  used (no vendor evaluated, no network call made — a cost and vendor decision, and unowned)
  (`:830`, points 2 and 9).
* ⚠️ Item 25 refuses to say whether `terminal-next-monitor`, `liveflow_monitor`,
  `provider_coverage_monitor` or `fundamentals_monitor` are RUNNING — no Railway read was
  available, and *"a code default is not a production state"* (`:830`, point 10). See ADR-0003.

## Sources

- `10-roadmap/observability-plan.md:50-115,156-311,318-350,396-428,564-609,639-658,740-776,830-871`

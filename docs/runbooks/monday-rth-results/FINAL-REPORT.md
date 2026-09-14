# Monday 2026-09-14 — Options Flow RTH session, final report

## Provenance — what this was built from

| | |
|---|---|
| OPEN run commit | **`2f5110276`** — *"docs(rth): Monday 2026-09-14 OPEN run — items 1-15, evidence and verdicts"*. ⚠️ It was `8dffab87a` while local; this CLOSE run rebased both commits onto `origin/master` (124 behind, **overlap empty**), which rewrote the SHA. `8dffab87a` resolves to nothing on master — cite the rebased one. |
| Source of record | `docs/runbooks/monday-rth-results/` (committed at ~11:20 ET) |
| Manifest | `index.json` — `incident: false`, `exit: 0` |
| Session window | 09:20:53 → 11:20:00 ET, items 1–15 |
| This report | written 16:20–16:45 ET, **CLOSE run, items 16–23.** Nothing was measured in it. |

**Item file status, verbatim from the manifest:**

| item | status | | item | status |
|---|---|---|---|---|
| 1 pre-open pod state | measured | | 9 path-A cold paint | measured |
| 2 pre-open health | measured | | 10 **path-B cold paint** | measured |
| 3 rig dry-run | measured | | 11 warm re-entry | measured |
| 4 **first 10 rolls** | measured | | 12 handoff attribution | measured |
| 5 pre-warming | measured | | 13 TOP 10 / storm | measured |
| 6 first prepare / 110 s | measured | | 14 head-name Search | measured |
| 7 **members on parts** | 🔴 **inconclusive** | | 15 anomalies | measured |
| 8 measured p50 | measured | | | |

**14 of 15 measured. One — item 7 — is inconclusive and is the only row in this
report with no number behind it.** Two sub-checks inside item 1 are `unevaluated`
(the Railway log buffer reaches back ~1 h, so there is no overnight window to read).
Nothing in this report is interpolated, projected, or carried over from the weekend's
quiet-tape figures.

⛔ **No INCIDENT.md exists in either directory.** The session ran to completion.

---

## 1. Pre-open state

Read at 09:21:21 ET, pod age 1,188 s, against the weekend's expectations. **Seven of
nine checks pass; two are unevaluated for the same reason.**

| check | result |
|---|---|
| `FLOW_FAST_DATE_SCAN` read **in-process** on flow-worker | ✅ `'1'` — via `railway ssh`, evaluating the read-site expression itself, not `--kv` |
| parts cache entries | ✅ **10** of a 24 cap — all ten keys present |
| `build_failures` | ✅ **0** |
| `parts_rejected_missing` | ✅ **0** |
| pod age ≥ 120 s | ✅ 1,188 s |
| holding page at `/` | ✅ 200, *"UCT Intelligence — Coming soon"* |
| member-smoke login | ✅ 200, `role=member` |
| no overnight tracebacks | ⚠️ **UNEVALUATED** — buffer spans 08:23–09:24 ET only. Zero hits *in that hour*, which is not an overnight statement and is not quoted as one. |
| T+1 flat-file backfill completed | ⚠️ **UNEVALUATED** — same buffer. Zero matches is equally consistent with "completed before the window" and "never ran". ⚠️ `MASSIVE_FLATFILES_ENABLED` reads **null** in-process on flow-worker. |

Version frozen pre-open at **29822328**. `rolls_steady[]` **empty**.

---

## 2. First live `rolls_steady[]` read — ever

The first steady-state roll in this system's history to be observed live:
**09:30:18 ET, v29823210, `prepare_ms` 8,242, `handoff_ms` 7.**

| # | version | `prepare_ms` | `handoff_ms` | `observed_s` | `bucket_bound_s` | `pass2_skipped` |
|---|---|---|---|---|---|---|
| 1 | 29823210 | **8,242** | 7 | 8.25 | 18.03 | false |
| 2 | 29823211 | 575 | 1 | 0.58 | 4.91 | false |
| 3 | 29823212 | 434 | 1 | 0.43 | 4.33 | false |
| 4 | 29823213 | 991 | 1 | 0.99 | 1.30 | false |
| 5 | 29823214 | 1,133 | 2 | 1.13 | 3.79 | false |
| 6 | 29823215 | 777 | 1 | 0.78 | 4.51 | false |
| 7 | 29823216 | 1,876 | 1 | 1.88 | 7.59 | false |
| 8 | 29823217 | 1,982 | 1 | 1.98 | 4.05 | false |
| 9 | 29823218 | 1,013 | 2 | 1.02 | 6.21 | false |
| 10 | 29823219 | 2,277 | **12** | 2.29 | 3.46 | false |

`blocked_by`, `blocked_pass`, `blocked_held_ms` — **null on all ten.**

**The headline of this table is `handoff_ms`:** max 12 ms, p50 1 ms, nothing blocked.
At the open the handoff was not a problem at all. That changes later — §7.

⛔ **Four fields the run asked for are not exposed per-roll** and are recorded as
not-exposed rather than filled: `builds`, `build_failures`, `parts_rejected_missing`
(cumulative counters only — 5→18, 0, 0 across these ten) and **`csv_provider` share,
which appears nowhere in `/api/flow/aggregate-health` at all.**

⭐ **The roll series is uncontaminated by the 09:30 restart, and that is measured, not
assumed.** `stats_process_local.requests` held at 528 and `cache_hits` at 539
continuously across web's swap while `builds` kept climbing — a restarted process
resets those. So the prepare machinery lives on **flow-worker**, which did not
restart, and every roll above is a warm-process number.

---

## 3. Pre-warming under a live tape — HELD

**Pass 2 ran on every roll: `pass2_skipped` false on 14/14 distinct rolls, and false on
all 89 across the session.** The parts cache sat at **10 on every one of 454 samples** —
never drained, never grew. `build_failures` **0** and `parts_rejected_missing` **0** on
every sample. `declined_busy` did not move (2 → 2).

Seven rolls have both their `first paint warmed` and `remainder warmed` log lines, and
the pairing is **7 of 7** — there is no instance of a first-paint warm without its
remainder. Remainder cost: 234, 303, 1,458, 2,013, 2,759, 1,389, 2,205 ms.

⚠️ **Three rolls have no surviving log lines, and that is my capture, not a skipped
pass.** The Railway buffer turned over fully between two drains. The conclusion rests
on `pass2_skipped`, which is the pod's own per-roll record and inherits none of that
loss. **Absence of a log line here is not evidence of a missing warm.**

---

## 4. Members on parts — 🔴 NO DENOMINATOR

> **ZERO `/api/flow/*` requests of any shape reached the service between 09:30 and
> 10:00 ET.** Not zero whole-D requests — zero requests.

There is no ratio, and none is computed. **This is an absence of subjects, not an
absence of instrument**, and the difference is load-bearing:

- The instrument was proven to see browser-originated flow requests — it captured the
  rig's own 8 part-requests at 09:21–09:24 in the same log.
- ⛔ **It was also corrected mid-run before it could lie.** The first classifier
  matched `/api/flow/aggregate-health` against its `/api/flow/aggregate` prefix and
  counted *this session's own 10 s poller* as 15 member whole-D calls. Had that stood,
  this section would report a **65% member whole-D ratio that was entirely my own
  instrument.**

Production holds 26 accounts, registration is closed behind the holding page, and
they are admins and testers. Web's own logs put the live population at
`members=6` / `members=2` / `scanned_users=8`.

⛔ **This must not be quoted as "members are on parts".** What is established is that
the parts transport works end-to-end for a real member-role browser session, proven
by the rig on this account in items 3, 9 and 10. *Members loaded it and got parts* is
a different claim and today produced no evidence for it either way.

---

## 5. Measured p50 — the row the weekend bundle left blank

> ### The number to quote is **~5,400 ms, −12.9%.** Not −30.2%, and certainly not −46.2%.

| window | n | p50 | vs 6,199 ms baseline |
|---|---|---|---|
| 09:30–10:29 | 60 | 3,334 ms | −46.2% |
| 09:30–10:58 | 89 | 4,328 ms | −30.2% |
| **steady-state plateau** | — | **~5,400 ms** | **−799 ms, −12.9%** |

Full distribution at n=89: min **0**, p50 **4,328**, p95 **7,378**, max **9,107**,
mean **4,122** ms.

**Why the plateau and not the session p50.** `prepare_ms` is not stationary — it rises
through the open and then flattens:

| quarter-hour | 09:30 | 09:45 | 10:00 | 10:15 | 10:30 | 10:45 |
|---|---|---|---|---|---|---|
| p50 (ms) | 1,182 | 2,701 | 3,536 | **5,538** | 5,449 | 5,351 |

The last three agree within **3.5%**. The driver is tape volume, and it is measured:
Last1 `raw_rows` grew **52×**, from 503 at 09:30:41 to 26,107 at 10:18:46. A p50 taken
from the open is weighted toward the cheapest builds of the day.

⛔ **Three headline numbers came out of one session, one flag and one pod, differing
only in where counting stopped — and the two flattering ones came first.** Filing at
n=60 would have published −46.2%.

⚠️ **The comparison is still not like-for-like, and the gap is on the baseline's
side:** the 2026-09-11 baseline records `n=25` and the flag state but **not its tape
volume or time of day**, and tape volume is the dominant driver. −12.9% is the closest
honest read because it is the only one taken where the tape had stopped growing.

⭐ **It is also the one that is consistent with the component.** The date-scan
component saves ~1.34 s (1.4227 s → 0.0028 s, measured on the pod). −0.80 s is the
same order and *smaller* — coherent, because a busier tape than the baseline's eats
some of it. **−46.2% claimed the flag bought more than twice what its own component
can deliver**, which should have been the tell.

**To settle it properly: compare on `raw_rows`, not on clock time.** Today supports
that directly — the 10:12:39 build at 22,198 rows took 5,186 ms. The baseline's row
count is the one missing input.

---

## 6. Cold first paint, and warm re-entry

### Path B — in-app navigation. **This is the headline and it is the page's own cost.**

| | median | worst | min |
|---|---|---|---|
| `shell_ms` | **542** | **648** | 474 |
| `picks_ms` | **2,020** | **3,945** | 1,024 |

**134 KB** median wire. **Parts on every run — no whole-D and no `data?days=1` in any
of the six.** Picks rendered **6 of 6**, measured by DOM mutation. Zero runs discarded;
pod 1,676–1,803 s; no deploy swapped.

⭐ **The bimodal no-picks failure did not reproduce once.** Run 3 is the most
informative of the session: a version roll landed mid-load, the client re-fetched
across three versions — **14 requests instead of 5, 870 KB instead of 134 KB, 6.5×** —
and *still rendered picks*, at 3,945 ms. The storm degrades the number; it does not
break the render.

### Path A — direct load, intro-gated

First content **median 10,104 ms**, worst **16,169 ms** (n=5, one run discarded).

⚠️ **~9.5 s of that is the cinematic intro, and that share is DERIVED, not measured** —
the rig exposes no intro-duration field, so it is path A's median minus path B's
shell, on the same tape in the same half hour. CLAUDE.md's ~9.3 s three-act
description corroborates it. **Path A is not a page number.**

⚠️ **The discarded run should not be forgotten.** Run 1 was rejected *by the rig* on an
unreadable uptime behind a transient 502, and its first content was **67,434 ms**.
Excluding it flatters the result. A member hitting the same transient waits over a
minute.

⚠️ Wire bytes vary **6×** across path-A runs on the same tape (28 KB / 56 KB / 143 KB /
145 KB / 815 KB) — the two cheapest served only `TOP_PICKS` + `bootstrap`, the
expensive ones also pulled `CONV` + `TICKER_DB`. The transport does materially
different work run to run.

### Warm re-entry vs UCT20 — **the standing claim is half falsified**

| | Options Flow warm | UCT20 | |
|---|---|---|---|
| commits, 9 s settle | **14** | 31 | ✅ Flow wins |
| commits, 3 s settle | **10** | 15 | ✅ Flow wins |
| bytes, 9 s settle | 16.5 MB | **14.0 MB** | ❌ Flow loses |
| bytes, 3 s settle | 9.5 MB | **0.49 MB** | ❌ Flow loses badly |

**Commits: confirmed, both windows, all 7 runs.** Options Flow landed on exactly 10
commits in 3 of 3 control runs.

**Bytes: fails, and the control makes it worse rather than better.** At 9 s the two
look close and it would be tempting to call it a wash — but UCT20's byte total
**collapses 28×** between the windows while Options Flow's stays in the same order of
magnitude. UCT20's 9 s figure was mostly post-load polling; Options Flow's was mostly
load. **Warm re-entry costs roughly an order of magnitude more bytes than UCT20, not
1.2×.**

⚠️ The byte comparison does not cleanly isolate navigation cost for either page — the
direction is robust across both windows, the magnitude is not. ⚠️ No weekend figures
exist to regress against; this is a fresh head-to-head of the claim, not a regression
check.

---

## 7. Handoff attribution — **the ledger cannot explain its own worst cases**

**7 of 89 rolls exceeded 500 ms (7.9%). `blocked_by`, `blocked_pass` and
`blocked_held_ms` are NULL on all 89.** Residual is therefore **100% of handoff** in
every case.

| seen ET | version | `handoff_ms` | `prepare_ms` | `blocked_by` | residual |
|---|---|---|---|---|---|
| **10:02:16** | 29823241 | **44,539** | 2,088 | null | **44,539** |
| **10:57:41** | 29823297 | **25,353** | 4,454 | null | **25,353** |
| **10:33:42** | 29823273 | **21,821** | 4,453 | null | **21,821** |
| 09:54:29 | 29823234 | 17,142 | 3,213 | null | 17,142 |
| 10:07:37 | 29823247 | 14,699 | 3,536 | null | 14,699 |
| 10:13:17 | 29823253 | 6,325 | **0** | null | 6,325 |
| 10:27:22 | 29823267 | 2,046 | 5,921 | null | 2,046 |

Distribution (n=89): min 1, p50 **2**, p90 21, p95 14,699, p99 25,353, max **44,539**,
mean 1,487 ms.

**Buckets:** ≤10 ms → **67** · 11–100 ms → **15** · 101–500 ms → **0** ·
501–5,000 ms → **1** · >5,000 ms → **6**.

⛔ **`api/flow_router.py`'s own comment above the ledger states that "a present
`blocked_by` is the whole explanation for a large one". Today falsifies it: seven
large handoffs, zero attributions.** The weekend bundle's Component-3 check anticipated
exactly this fork — *"`blocked_by` should name it — or show the slot was free, which
kills the hypothesis outright."* **It showed the slot was free.**

⚠️ The mean (1,487 ms) is **~740× the p50** (2 ms). A mean handoff here describes no
roll that actually happened.

**Classification: UNEXPLAINED — the slot was free.** §18 carries the proposal.

---

## 8. TOP 10 / the request storm — diagnosed

**It is a STALLED `/api/flow/version`.** Not a remount, not a render gate, not a
data-shape rejection.

Applying the item's own discriminator, over 20 probe runs (5 storms, 15 clean):

- `.of-mroot` mounted **exactly once in all 20 runs**, storms included, and never
  unmounted → **not a remount**, even though network calls are re-issued.
- `.of-picks` also mounted exactly once, 16–1,151 ms after `TOP_PICKS` arrived → the
  table renders as soon as its data lands → **not a render gate**.
- Picks rendered **20 of 20**, all five storms included. **The "picks never render"
  half of the reported bimodality did not reproduce once.** What reproduces is picks
  rendering *late* — up to 33.3 s.

| run | version request | picks mount |
|---|---|---|
| 2 | 6,340 ms | 7,625 ms |
| 4 | 32,320 ms | 33,334 ms |
| 5 | 8,602 ms | 10,245 ms |
| 13 | 10,084 ms | 10,658 ms |
| 11 | **853 ms** | **11,542 ms** ← outlier, unexplained |

In 4 of 5, picks-mount tracks the version request almost exactly. **The delay is in
obtaining the data, not in rendering it.**

⭐ **Server and client agree to 15 ms.** The roll first seen at 10:13:17 recorded
`handoff_ms` **6,325**; probe run 2, starting ~10:12:47, measured its
`/api/flow/version` at **6,340 ms from inside the browser.**

**A finding inside the finding:** the legacy-tape fallback answered with a **stale
version every single time** — 29823247 vs 29823253, 29823251 vs 29823255, 29823254 vs
29823256, 29823258 vs 29823259, 29823259 vs 29823261. This is what `stale_served` is
recording. ⭐ **The client handles it correctly** — `shouldSkipStaleParse`
(`flowLoadPolicy.js`) discards those bytes *unparsed*, once. So the cost is bytes and
a corrective refetch, **not wrong data on screen**.

⚠️ **Two things this does not explain, stated rather than smoothed:** run 11 stormed
with a *fast* version request, and run 4's 32 s stall has no matching server-side
handoff. **At least one more path into the storm shape exists.**

⚠️ **Frequency is a rig rate, not a member rate** — 5 in 14 dedicated runs plus 1 in 6
cold-paint runs, roughly one load in three during that window. No member loaded the
page today (§4), so member impact cannot be quantified.

---

## 9. Head-name Search — **two of three head names cannot build at all during RTH**

| | first response | outcome |
|---|---|---|
| **SPY** | 503 in 2,088 ms | ✅ **warm at 7.8 s** — the work completes after the client gives up, is cached, next search is a hit |
| **NVDA** | 503 in 384 ms | 🔴 **TOO_BIG at 27,208 ms** (budget 20 s), 8,001 rows / 1,165 kB — discarded, 600 s cooldown |
| **MU** | 503 in 258 ms | 🔴 **TOO_BIG at 21,276 ms** (budget 20 s), 4,001 rows / 570 kB — discarded, 600 s cooldown |

Final state: `built=1, failed=2, declined=0, cooling_off=['MU','NVDA']`.

**Answering the question as asked, because its premise is wrong.** *"Does the derive
still exceed 60 s?"* — **No. It never gets near 60 s, because it is cut off at a 20 s
warm budget.** *"Does the timeout discard the work, or does it complete after the
client gives up?"* — **Both happen, and which you get depends on the symbol**: SPY
completes and caches; NVDA and MU are discarded.

⛔ **So a member searching NVDA or MU gets a 503 and the legacy tape (~4.2 s per the
source's own measurement) every single time, and repeating cannot help — the 600 s
cooldown guarantees the next ten minutes are 503s too.** It is not a slow path, it is
a permanently degraded one, and it is worse precisely for the names most likely to be
searched, because what blows the budget is row count.

⭐ **Both mechanisms are working as designed.** The budget protects the single build
lane; the cooldown stops one un-buildable symbol monopolising it. The consequence is
still that Search's premium path is unavailable for the head names during exactly the
hours it matters.

⭐ **The cause was read from the server, not inferred.** Two hypotheses were formed —
lock starvation and a version-keyed cache treadmill — and **both were wrong**
(`declined=0` rules out the first; `_search_freshness` is per-symbol, explicitly not
the global version, which rules out the second). Only the server log gave the cause.

---

## 10. Anomalies

| id | severity | what |
|---|---|---|
| **A1** | **member-visible** | **~45 s of 502s straight into the market open** — 09:29:45 through 09:30:30, four consecutive samples, both endpoints. Recovered 09:30:31 with uptime 22 s. **Cause: a web pod swap. Railway deployment `1d75954c73` — *"merge(wisdom): master into feat/wisdom-loop before the item-4 measurement push"* — SUCCESS at 09:27:22 ET. ANOTHER WORKSTREAM PUSHED TO MASTER DURING RTH**, and five further web deployments are recorded in the hour before it. |
| A2 | instrument-visible | 11 of 454 samples (2.4%) had one failed leg — `RemoteDisconnected` / `ConnectionAborted`. Never two consecutive full failures outside A1. Likely also the cause of item 9 run 1's discarded 67 s paint. |
| A3 | product | `stale_served` **0 → 98** across the session, still climbing. Mechanism corroborated by §8. ⚠️ **My own rig increments this counter and I did not separate my share — the absolute 98 is NOT member impact.** |
| A4 | product | Search cannot build NVDA or MU — §9. |
| A5 | unrelated | **1,788 lines** of `[schwab] Token refresh failed: 400 ... Refresh token is invalid, expired`, roughly every 90–100 s throughout. Not an Options Flow defect and out of scope — recorded because it is by far the loudest error in the logs and will bury anything a future reader greps for, and because an expired refresh token does not fix itself. |
| A6 | observation | One roll with `prepare_ms = 0` (10:13:17) — the whole cost was handoff. It is the roll that matched probe run 2 to 15 ms. |

**Explicitly checked and clean:** no empty panels (picks rendered 20/20, 6/6, 4/4);
`build_failures` 0 and `parts_rejected_missing` 0 on all 454 samples; parts cache 10
throughout; versions 29823210–29823298 **contiguous, no gaps**; holding page 200;
login `role=member` on ~40 attempts with the 5/min limiter never tripped; and no run
ever ended up tape-only.

⭐ **A1 is the one that matters most, and it is not a product defect.** The session's
hard rules forbid exactly that push, and the deploy's own commit message says it was
made *"before the item-4 measurement push"* — i.e. by a session that knew this
measurement was in progress. Nothing rose to an incident: A1 had self-recovered before
it could be acted on and its cause was a deploy rather than a fault.

---

## 11. The verdict — item 17

> **Yes — Options Flow is now fast for a member, and the number that says so is the
> path-B one: a returning member navigating in-app to Options Flow on a live RTH tape
> gets the page shell in 542 ms (median; 648 ms worst) and the TOP 10 table in 2.0 s
> (median; 3.9 s worst), on 134 KB of wire, entirely over the parts transport, with
> the table rendering on 6 of 6 runs. Against the 5.5 MB whole-day-plus-tape every
> member was served until Friday, that is a 41× reduction in bytes on first paint, and
> it is measured on a live tape through a real member-role session rather than
> projected. Two honest qualifications ride with it and neither is fine print. First,
> this is the in-app navigation path; a member who loads the URL directly waits ~10 s
> median because the cinematic intro gates first content, and roughly 9.5 s of that
> has nothing to do with Options Flow — shaving the flow pipeline is invisible on that
> path. Second, about one load in three during this window hit a request storm that
> pushed the table out to 3.9–33 s and the wire to 870 KB; the page still rendered
> every time, but the worst case a member feels is seconds, not milliseconds, and the
> cause is a server-side stall we have now located but not yet fixed.**

⛔ **What this verdict does NOT say, and must not be stretched into saying:** that
members are on the parts path. **Zero members loaded Options Flow today** (§4), so
that has no evidence today in either direction. The claim above is about what the
product delivers to a member-role session, proven end-to-end; it is not a measurement
of member behaviour.

⚠️ The 41× is bytes-on-first-paint (134 KB vs 5,514 KB). The weekend's 32× figure is
the same comparison measured at 169.7 KB; both are real and differ by which run's wire
total is used. **Quote one or the other with its basis, never a rounded "over 30×"
with neither.**

---

## 12. Proposals — items 18 to 23. **None of these is landed. All await the owner.**

### 18 — the 6b handoff residual

> **Recommendation: NO FIX YET. Land an INSTRUMENT, read one RTH session, then
> decide.** A fix shipped now would be the sixth speculative fix on a thread that has
> already paid for five, and it would be unfalsifiable afterwards.

**But the residual now has a named, falsifiable candidate**, read from source rather
than guessed — and it is stronger than item 12's, because **one mechanism explains
three separate unexplained observations at once.**

`_current_version()` (`api/flow_router.py:217`) holds **`_SIG_LOCK` across a SQLite
read of flow.db** — the same database the OPRA consumer writes continuously during
RTH. Every caller serialises on that one lock: the `/api/flow/version` endpoint, the
preparer's poll tick, **and `_prepare_once`'s own first line**, which runs *before*
`_INFLIGHT_HOLDER` is set and *before* `t0` starts. So a wait there lands in
`handoff_ms`, is absent from `prepare_ms`, and leaves `blocked_by` **null**.

| today's observation | explained by this? |
|---|---|
| 7 large handoffs, `blocked_by` null on all 89 (§7) | ✅ the instrument watches `_PREPARE_INFLIGHT`; the contention is on `_SIG_LOCK` |
| `/api/flow/version` stalling 6.3–32.3 s client-side (§8) | ✅ same lock, on the request path |
| the empty 101–500 ms bucket (§7) | ✅ you either hit the 5 s probe cache (µs) or wait on a whole DB read (seconds) |
| run 4's 32 s stall with no matching server handoff (§8) | ✅ if the preparer was inside its probe window it never waited, so no roll records it |

⭐ **And there is a one-line correctness defect in the same function.** `now` is read
*before* `with _SIG_LOCK`, then written to `_SIG_PROBED_AT` after the lock is
acquired — so a caller that waited 30 s records a probe **30 s in the past**, every
subsequent caller then sees an expired 5 s window and re-probes, each holding the lock
across its own DB read. **One slow probe becomes a self-sustaining probe storm.** That
is a positive feedback loop and it fits the measured bimodality.

| | |
|---|---|
| **Expected effect** | none on p50 (already 2 ms). On p95/p99: if confirmed, it is the whole of the 14.7 s / 25.4 s tail, and the §8 storm with it. **Stated as conditional because it is unmeasured.** |
| **Files** | `api/flow_router.py` only |
| **Deploy tier** | 🔴 **flow-worker — AFTER-HOURS OR WEEKEND ONLY.** Confirmed via `tools/flow_worker_watch_coverage.py`. Restarts the OPRA consumer; the tape gap is permanent until the T+1 flat file. |
| **Rollback** | `git revert` — no flag, no schema, no state |
| **Diff** | `item18-sig-lock-PROPOSAL.diff`, beside this file — instrument + the one-line fix, with the confirm/kill criterion and a non-vacuity control for the new field. ⚠️ Written to `scratchpad/monday-rth/` as the run prompt directs, **and committed here as well because `/scratchpad/` is gitignored** and a proposal that dies with the worktree is not a proposal. It is a `.diff`, not an applied change. |

### 19 — the TOP 10 / request storm

> **Recommendation: change NOTHING in `OptionsFlow.jsx`, and do not touch the 3 s
> threshold. Fix it upstream at §18. No Manrav ack is needed, because nothing of his
> is proposed for edit.**

**Root cause, and it is not new code — it is §18 seen from the client.**
`/api/flow/version` stalls past 3 s → `PREHYDRATE_FALLBACK_MS = 3000`
(`flowLoadPolicy.js:362`) fires → `_demandTape()` sets `tapeDemanded`, which is a
dependency of that effect → **the effect re-runs and re-issues both first-paint parts
plus the legacy tape**. Hence exactly 3× `bootstrap` and 3× `TOP_PICKS`.

⚰️ **This corrects the weekend's scoping, and the correction matters.** The weekend
diagnosed the same mechanism but concluded `0/8` storms on a warm pod and scoped the
cost to *"only in the ~2 minutes after a deploy"*. **Today it reproduced 5 times in 14
runs on a pod 2,353–3,085 s old** — about one load in three. The weekend was measured
on a Saturday, where the only way to make prehydrate miss 3 s was to boot a cold pod.
**The mechanism was right; the list of triggers was too short.** Corrected in the
bundle in this push.

⛔ **Do not raise or adapt the threshold.** It exists because deferring the tape once
left an empty page with nothing to re-arm it. Today it fired and picks still rendered
20/20 — the safety net is working. The cost is one duplicate first-paint round plus a
discarded tape fetch: **870,699 B vs 134,015 B, 6.5×**, and the stale tape is thrown
away unparsed by `shouldSkipStaleParse`, so it is a cost, not a correctness bug.
**Remove the stall and the storm goes with it.**

⚠️ Residual: run 11 stormed with a fast version request. **At least one more path
exists and this proposal does not cover it.**

### 20 — decisions (a) and (b)

> **Recommendation: DROP BOTH.**

The memo in `options-flow-status.md` names the deciding figure — *"path-B `shell_ms`
and `picks_ms`, median and worst, from ≥5 guard-accepted runs. Blank until Monday."*
**It is no longer blank: 542 / 648 ms shell, 2,020 / 3,945 ms picks, from 6 of 6
guard-accepted runs, parts on every one.** The memo's own *drop both* branch reads
*"the parts path already delivers first paint in ~166 KB and neither adds enough to
justify the work"* — and 134 KB with a sub-second shell is inside that branch, not
outside it.

**Reopening (b) would additionally require the reconcile path inside
`OptionsFlow.jsx`** — a partner-owned edit needing Manrav's ack or an explicit
waiver — **and it is not justified by anything measured today.** ⚠️ The storm
diagnosis does not unblock it either: `planDelta` / `_baseFetchedVer` appear nowhere
in the §19 mechanism, which is an effect re-running, not a guard returning `none`.

⛔ **One honest gap the owner should know before ruling.** *I could not find anywhere
in this repository that states what (a) and (b actually ARE.* The memo records their
outcomes, their blocker and their deciding number; the substance is referenced from
`b272db249` onward without ever being defined. All that is recoverable is that (a)
touches no partner-owned file and (b) is the `OptionsFlow.jsx` reconcile path. **The
recommendation above is therefore made on the memo's own decision rule, not on the
merits of the work** — if (a) has value the memo never captured, this recommendation
cannot see it.

### 21 — head-name Search / MU

> **It is a DERIVE-COST problem, not a staleness problem and not a timeout-behaviour
> problem.** Proposal only.

The evidence separates the three cleanly. Not staleness: `_search_freshness` is
per-symbol (`max_id.prune_generation`), explicitly not the global version, so rolls do
not invalidate it. Not timeout behaviour: the timeout does exactly what it is designed
to do, and SPY proves the same machinery completes and caches when the work fits.
**The work simply does not fit** — NVDA needs 27.2 s and MU 21.3 s against a 20 s
budget, and what blows it is row count (8,001 and 4,001 rows).

**Next step — measure before changing anything.** Establish where the 27 s goes for
NVDA (query, derive, or serialisation) on a single instrumented call. Three directions
exist and today's data does not choose between them: raise the budget for a bounded
allowlist of head names; make the derive incremental so a partial product beats none;
or pre-warm the head names *off* the member path on the same cadence as the roll. ⛔
**Do not simply raise `FLOW_SEARCH_WARM_COOLDOWN_S` or the 20 s budget** — both
mechanisms are protecting the single build lane, and loosening them trades a degraded
head-name search for a degraded search for everyone.

### 22 — GEX crosshair lag

> ⛔ **The premise is stale: this was traced on 2026-09-13 and the thread is closed on
> a measurement. There is no spike to plan.** Reporting that rather than writing a
> plan for completed work.

What the record in `flow-worker-weekend-bundle.md` shows, and I verified the fix is on
master (`67566d999` is an ancestor of `origin/master`):

1. **The spike could not run at first — the surface crashed.** `ReferenceError: fmtGex
   is not defined`, live since 2026-09-07, error boundary instead of the GEX tab.
   Fixed and shipped.
2. **On the now-rendering chart there is no GEX-specific lag.** Headless: 16.70 ms
   frame interval against 16.67 ms for 60 Hz, **0 dropped frames, 0 long tasks, 0
   LoAF**, across 5 runs. Headed, the GEX chart dropped 15–17 frames while a plain
   `/charts` control **dropped 54** — the chart *without* the GEX lines was three times
   worse. Zero script attribution in any long frame.
3. ⛔ **The negative is trustworthy because the instrument was shown able to find a
   positive**: 25 ms of injected work per move produced 10 dropped frames and a 63 ms
   LoAF.
4. ⚰️ **This re-reads the five-speculative-fixes history.** One of the May fixes
   evidently did work, and nobody could confirm it because from 2026-09-07 the view
   crashed on open — **so every later report of the lag "persisting" was about a screen
   that never rendered.**

**The only thing still open is item 24 of `options-flow-status.md`: the owner's own
DevTools Performance trace, Bottom-Up by Self Time, on their own display during real
cursor movement.** That is an OWNER-DECISION, it needs no RTH, and if it names a hot
function this protocol missed then the protocol is what is wrong and
`tools/gex_crosshair_probe.py` is the thing to fix. **I have added a pointer at the
stale "(not started)" heading** so two sections of one file no longer disagree about
whether the work happened.

### 23 — ranked next actions, by member-felt impact

| # | action | impact | tier | needs |
|---|---|---|---|---|
| **1** | **§18 instrument** — name the handoff residual (`sig_wait_ms` / `sig_probe_ms`) | **Highest.** It is the single root cause behind both the p99 handoff tail AND the §19 storm, which is the worst case a member actually feels (3.9–33 s picks). | 🔴 flow-worker — **after-hours / weekend** | owner go |
| **2** | **§18 one-line fix** — stamp `_SIG_PROBED_AT` after the probe | Same root cause. **Sequence it AFTER #1 by one session** so there is a before-picture. | 🔴 flow-worker — after-hours / weekend | owner go, #1's reading |
| **3** | **A5 — Schwab refresh token** | Zero Options Flow impact, but 1,788 log lines will bury the evidence for #1 and #2, and it does not self-heal. Cheapest item here. | not this workstream's | owner / whoever owns Schwab |
| **4** | **§21 — instrument the NVDA derive** | Real and permanent for two of three head names, but *measure first*; every fix direction is a guess until the 27 s is broken down. | read-only measurement | owner go |
| **5** | **Declare `FLOW_FAST_DATE_SCAN` in the flag ledger** — see below | It is armed on production and undeclared. Low member impact, high "next reader is misled" impact. | web, any time (docs+code) | needs the rail fixed first |
| **6** | **§20 — rule on (a)/(b)** | Recommendation is drop both; the deciding number is in hand. Unblocks a stale OWNER-DECISION row. | decision only | **owner**, and Manrav if (b) reopens |
| **7** | **§22 — the owner's own GEX trace** | Closes the last thread on the original list. Needs no RTH; any evening works. | decision only | **owner**, on their own machine |
| — | **§19 storm** | **No action. Subsumed by #1/#2.** Listed so it is not re-opened as separate work. | — | — |

---

## 13. One finding this run turned up that was not on the list

**`FLOW_FAST_DATE_SCAN` is armed on production and is not in the flag ledger at all** —
and the rail that exists to catch that **cannot see it**.

Measured, not inferred:

- Item 1 read it **in-process** on flow-worker: `'1'`. It is live, and it is the flag
  §5's entire measurement is about.
- `docs/feature_flags.json` declares 171 flags. **It is not one of them** — the eight
  `FLOW_*` entries are all `*_ENABLED`.
- `api/services/feature_flag_index.gates()` finds **284 gates** across `api/`,
  `scripts/`, `tools/`. **`FLOW_FAST_DATE_SCAN` is not among them**, despite
  `api/flow_db.py:292` reading it as a textbook off-by-default gate:
  `os.environ.get("FLOW_FAST_DATE_SCAN", "0") == "1"`. It is invisible because of its
  **name**: every gate the index finds carries `_ENABLED`, `_DISABLE*` or `_ON`.
- `tests/test_feature_flag_ledger.py` — **185 passed.** It is green not because the
  flag is declared but because the index never asks about it. **Same structural blind
  spot as `DESK_PUBLIC_SHOWS`, one axis over**, and CLAUDE.md already records that
  shape: *"the rail was reporting its own blindness and blaming the ledger."*

⛔ **And this is why I did NOT simply add the entry, which was item 16's instruction.**
The rail computes `stale = ledger − (gates ∪ visibility_flags)` and asserts it is
empty. Declaring the flag puts it in exactly that set difference. Demonstrated on the
measured sets:

```
current stale (empty, which is why the rail is green):  []
stale IF I declare the flag:                            ['FLOW_FAST_DATE_SCAN']
```

**So declaring it turns the rail red, and not declaring it leaves an armed,
member-affecting flag undeclared.** The fix is to teach `feature_flag_index` to
recognise a gate by its *read shape* rather than its *name suffix*, then declare the
flag — which is a code change to `api/services/`, outside a docs-only close run.
Recorded as ranked action **#5** and deliberately not forced. Nothing else in today's
observations changed any declared flag's precondition, so `docs/feature_flags.json` is
otherwise untouched by this push.

---

## 14. What this session could not answer

Carried forward verbatim rather than quietly dropped:

1. **Members on parts (§4)** — no denominator. Needs real member traffic or a
   deliberately scheduled member session during RTH.
2. **Overnight tracebacks and the T+1 flat-file backfill (§1)** — the Railway buffer
   reaches back ~1 h. Needs a log sink that outlives the buffer.
3. **`csv_provider` share** — asked for by items 4 and 8; **not exposed anywhere** in
   `/api/flow/aggregate-health`. Recorded as not-exposed, never as zero.
4. **The baseline's tape volume (§5)** — the one missing input that would make the
   date-scan delta like-for-like.
5. **Storm run 11 and run 4 (§8)** — at least one more path into the storm shape.
6. **A3's member share (§10)** — my rig increments `stale_served` and I did not
   separate it.
7. **Items 9 and 10 were not deliberately phased against the roll cycle** — coverage
   was incidental. Run 3 caught the roll-during-load case by luck, not design.

---

## 15. Deploy record — 🔴 **THE PUSH WAS BLOCKED. IT IS STILL OWED.**

> ### ⛔ Two commits are sitting on `ops/member-rig`, rebased and ready. Nobody pushed them.
>
> ```sh
> cd C:\Users\Patrick\uct-worktrees\flow-watch-rail
> git push origin HEAD:master
> ```
>
> **It will fast-forward.** The branch is rebased onto `origin/master` with the
> overlap measured empty, and nothing else is needed.

| | |
|---|---|
| Commits ready | `2f5110276` (OPEN run, rebased) + the CLOSE-run commit that carries this file — **2 ahead of `origin/master`, 0 behind** ⭐ the CLOSE commit's own SHA is deliberately not written here: it is *this file's* commit, so every amend would invalidate the citation. Read it with `git log --oneline -1`. |
| Content | **docs only.** No file under `app/` or `api/` was modified in either run. |
| Rebase | onto `origin/master` (was 124 behind). **Overlap: empty** — 219 files changed on master, 74 on this branch, intersection `∅`. Clean, no conflicts. |
| Hygiene gate | ✅ `python tools/check_repo_hygiene.py --staged` — clean, no line-ending flip against the stored blobs |
| Push status | 🔴 **BLOCKED — NOT ATTEMPTED.** `git push` requires approval and this session is non-interactive with no approval surface, so the call was denied before it ran. This is a harness limitation, **not** a rejected push, a conflict, or a policy stop. |
| Timing | The 16:15 ET gate was satisfied — it was **16:24 ET** when the check ran, tape closed. Nothing about the timing blocked this. |
| Queue | Clear at push time: latest `web` deployment **SUCCESS at 16:21:41 ET**, nothing building. The one-merge-at-a-time rule was satisfied. |
| **Expected** fan-out | **web rebuilds; worker / bars-api / flow-worker SKIPPED.** Docs-only touching no watched path — `tools/flow_worker_watch_coverage.py` exits OK. |
| **Observed** fan-out | ⚠️ **UNOBSERVED — there was no push to observe.** Confirm it after pushing; do not record the expected row as though it happened. |

⭐ **The report is safe either way.** It is committed locally, so it survives this
session ending; what is missing is only its arrival on `origin/master`. Until the push
lands, `docs/runbooks/monday-rth-results/FINAL-REPORT.md` exists **only in this
worktree**, and the weekend bundle's filled-in p50 row and storm correction are not
visible to anyone else.

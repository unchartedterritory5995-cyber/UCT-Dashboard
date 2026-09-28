---
id: DECISION-TERM-011-ROUTING
title: TERM-011 / RM-N09 — the routing DECISION PACKET for steps 5, 6 and 7
role: The owner rules once from this file; an implementer then lands steps 5-7 without re-deriving anything
phase: decision-packet
group: technical-architecture
category: decision
scope: >
  Every one of the 13 BOTH rows in SPEC-TERM-011 §4.3 and every one of the 9 ↩ADMIN-FALLBACK
  posters §6 step 5 names, each with: what the event is in one sentence; where it lands TODAY at a
  `file:line` read in this tree; who sees it today; what a human would observe under each available
  ruling; a recommendation with its reason; and the blast radius if the ruling is wrong. It changes
  no runtime behaviour, no routing, no severity and no variable.
status: AWAITING OWNER RULING. Steps 1, 2 and 3 are DONE and IN PRODUCTION (see §1). Step 4 landed on
  this branch at `3622287d5` while this pass was being written and is NOT yet in production.
  Steps 5, 6 and 7 are blocked on the rulings in §2 of this file.
source_read: >
  Working tree `C:\Users\Patrick\uct-worktrees\_merge-master`, branch `integrate/terminal-fixes`,
  branch HEAD `519203f23` when the read began, `3622287d5` when it finished — the concurrent lane
  landed step 4 mid-pass (see below). ⭐ All **26** other files cited below are BYTE-IDENTICAL
  between `origin/production` and the branch (verified per file by blob hash, and by `git status`
  for the working tree), so every "today" claim is a claim about the running product, not a branch.
  ⚠️ TWO EXCEPTIONS, both owned by the concurrent step-4 lane: `api/services/chart_health_alerts.py`
  (**161** lines on `origin/production`, **279** on the branch since `3622287d5`) and
  `api/services/alert_destination.py` (**206** on production, **359** on the branch). **Every line
  number this file gives for those two is the `origin/production` number — what is running — read
  with `git show origin/production:<path>`, and labelled `@prod`.** The branch's own numbers for the
  same constructs are given beside them where it matters. ⛔ Reading either file off this working
  tree gives the branch numbers, not the running ones.
date: 2026-09-27
supersedes_nothing: true
depends_on: >
  07-technical-architecture/term-011-ops-vs-business-events.md (the spec; §4.3 is the 13 rows,
  §5.2 the variables, §6 the order) · api/services/alert_routing.py (step 2, the pure resolver) ·
  api/services/alert_destination.py (step 3, the one reader)
---

# TERM-011 — the routing DECISION PACKET for steps 5, 6 and 7

**Why this file exists.** Steps 3 and 4 are code. Steps 5, 6 and 7 are **decisions**, and the spec
says so — §6 step 6: *"⛔ These are decisions, not conversions. Batching them makes a wrong one
unattributable."* They have been blocked on nobody having the facts in one place. This is that
place: one block per row, six fields per block, every "where it lands today" carrying a `file:line`
read in this tree rather than restated from the spec.

**How to use it.** §2 is a one-page answer sheet — thirteen + nine lines, each with a recommended
answer already filled in. Ruling means striking out the ones you disagree with. §4 and §5 are the
evidence behind each line, in the same order. §3 is where the tree and the spec disagree, and it
matters before you rule, because **four of the spec's thirteen "decisions" turn out not to be
decisions** and **one of them is settled outright**.

---

## 0. METHOD — what was verified, how, and what was not

⛔ **CODE, NEVER PROSE.** Every count and every citation below was produced against source with
comments and docstrings **blanked**, line numbers preserved. The instrument is a `tokenize`
comment-strip plus an AST docstring-blank. It carries two controls and **no count in this file was
printable unless both passed**:

| control | what it proves | result |
|---|---|---|
| **SURVIVE** — `DISCORD_WEBHOOK_ENV = "DISCORD_ALERT_WEBHOOK"` (a code line, `api/services/alerts.py:137`) | the stripper does not destroy code | ✅ survives, and the same literal's two *comment* mentions at `:123` and `:155` correctly vanish |
| **VANISH** — `Audience-facing` (a docstring, `desk_daily_session.py`) and `THE SEVERITY THIS USED TO SEND` (a comment, `bars_reconciliation.py`) | prose cannot be matched | ✅ both present raw (1 occurrence each), 0 survive stripping |

⛔ **A grep that finds an unrelated line still exits 0, so the content at every cited line was
read.** This caught two things. (a) One of the spec's own citations —
`calendar_week_poster.py:453` for "the week-ahead cards" — still resolves and still answers, but
the code at that line is `_alert_admin`'s webhook read (`:451-453`), an ops alert, **not** the
cards; the cards' admin fallback is at `:50`. (b) My own first pattern for step 3's converted
producers, `\bops_webhook\s*\(`, returned 3 hits and looked like "nothing was converted" — the
six converted modules all import it as `_ops_webhook`, and `\b` does not match before `_`. An
empty result was a broken pattern, not a fact.

**Counts, each with its pattern and unit stated, per the spec's §0 rule:**

| # | question | pattern + unit | result | spec said |
|---|---|---|---|---|
| C1 | `add_alert(` production call sites | code-only regex, `api/`, minus the `def` — **call sites** | **9** across 5 files | 9 (D3p) ✅ |
| C2 | `chart_health_alerts.emit` / `_alerts.emit` call sites | code-only regex, `api tools scripts` — **call sites** | **22** across 18 files | 22 (D4) ✅ |
| C3 | line-initial `or os.getenv/environ.get("DISCORD_WEBHOOK_URL")` | code-only regex — **files** | **9** | 9 (D7) ✅ — and all 9 are the same 9 modules |
| C4 | `deliver_alert_payload` call sites, with the severity each passes | **AST**, `api/`, alias-resolved — **call sites** | **13**, of which **11 pass no severity at all** | not measured by the spec |
| C5 | `DISCORD_WEBHOOK_URL` mentioned in CODE under `api/` | code-only regex — **files** | **22** | — (a different unit; see C6) |
| C6 | the spec's own D1 / D1c reproduced verbatim (raw literal, prose included) | `git grep -l` — **files** | **32** under `api/`, **38** across `api tools scripts` | 30 / 36 — **drifted by 2 each** |

⚠️ **What this pass did NOT do, and could not.** No Railway access was used or attempted. **Every
variable named below is NAMED, UNREAD** — including whether `DISCORD_ALERT_WEBHOOK` and
`DISCORD_WEBHOOK_URL` point at the same Discord channel, which §6 shows is the single unknown
blocking two of the thirteen rows. Where arming state is quoted it comes from
`docs/feature_flags.json`, which **records intent and cannot see Railway**, and is by CLAUDE.md's
own account the artifact most likely to be stale. No tests were run; nothing was imported from
`api.**`; no file outside this one was written.

---

## 1. WHAT LANDED SINCE THE SPEC WAS WRITTEN — read this before ruling

The spec's `status:` field says *"NOT IMPLEMENTED — nothing in this document is in source."* That is
three weeks old and **no longer true**. Steps 1-3 are live.

| step | state | evidence in this tree |
|---|---|---|
| **1** — the three variables created blank and registered | ✅ **DONE** | `api/routers/admin_api_health.py:52` `DISCORD_OPS_WEBHOOK_URL`, `:53` `DISCORD_BUSINESS_WEBHOOK_URL`, `:57` `OPS_ALERT_EMAIL_TO` in `infra_and_comms`; `:68` `ALERT_ROUTING_ENABLED` in `feature_flags`, beside the incumbent at `:43` |
| **2** — `resolve_channel` + rails, no caller | ✅ **DONE** | `api/services/alert_routing.py` (425 lines). `CLASS_OPS`/`CLASS_BUSINESS` `:100-101`, the whole vocabulary `:103` (⛔ `"both"` refuses), `OPS_WEBHOOK_ENV` `:114`, `BUSINESS_WEBHOOK_ENV` `:115`, `ADMIN_WEBHOOK_ENV` `:119`, `OPS_EMAIL_ENV` `:126`, `ROUTING_FLAG_ENV` `:135` default `"1"` `:143`, `resolve_channel` `:299` (pure, raises `UnroutableAlert` on an absent class `:317-323`), `route_stamp` `:358` (built, unused, deliberately) |
| **3** — the OPS-only producers converted | ✅ **DONE AND IN PRODUCTION** (`26b3a1cef`, an ancestor of both `origin/master` and `origin/production`) | one reader, `api/services/alert_destination.py`: `destination_for` `:144@prod` (`:164` on the branch), `ops_webhook` `:189@prod` (`:209`). Six producers call it: `api/auth_surface_check.py:458`, `api/event_loop_watchdog.py:437`, `api/flow_backup.py:157`, `api/flow_gap_autofill.py:407`, `api/worker_main.py:558` and `:636`, and **`api/services/chart_health_alerts.py:95@prod` and `:144@prod` (`:159` on the branch) — which is door B's page, i.e. all 22 emit sites at once** |
| **4** — the `(OPS, critical)` second transport | 🔨 **LANDED ON THIS BRANCH MID-PASS, NOT YET IN PRODUCTION** — `3622287d5` *"step 4 — the second transport for (OPS, critical), and it is NOT silenceable by the first channel"* | `chart_health_alerts.py` 161 → 279 lines and `alert_destination.py` 206 → 359 (`ops_email_recipients` now at `:343`). ⛔ **This is why the two files carry `@prod` numbers above**, and it is this packet's own §8 third-candidate error arriving inside the hour |
| **5, 6, 7** | ⛔ **BLOCKED ON THIS FILE** | — |

⭐ **Three consequences for the rulings below.**

1. **The OPS destination already exists and is already being used.** Every recommendation that says
   "classify it OPS" now means one concrete thing — *call `alert_destination.ops_webhook()` instead
   of reading a webhook literal* — and step 3 has already proved at the wire that with
   `DISCORD_OPS_WEBHOOK_URL` unset or blank that call returns exactly what
   `os.environ.get("DISCORD_WEBHOOK_URL")` returned before. **A conversion changes zero bytes on the
   wire until somebody sets the variable.** That is what makes most of §5 cheap.
2. **`ALERT_ROUTING_ENABLED` is a live kill switch with a default of ON** (`alert_routing.py:135`,
   `:143`; declared `dark` in the ledger because the *capability* is unreleased, not because the gate
   is off). So any step-6 or step-7 conversion that routes through the resolver is reversible by one
   variable, not a deploy. **Recommendations below lean on that heavily** — please keep it.
3. **The stamp is not built into the post yet, on purpose.** `route_stamp` exists and is unused;
   `alert_destination.py`'s own header records why (appending to a post is a payload change, and
   step 3's invariant was zero payload change). **The stamp belongs to the first commit that SETS
   `DISCORD_OPS_WEBHOOK_URL`** — which is a step-8 concern, not one of these rulings.

---

## 2. THE ANSWER SHEET — thirteen rulings, nine conversions, one sentence each

Recommended answers are filled in. Strike what you disagree with; everything unstruck is the ruling.

> ✅✅ **RULED 2026-09-27, owner-delegated** (*"You determine and answer all of that"*, and earlier
> *"you decide it because I am okay with whatever"*). **Nothing below is struck. All five open
> rows are ACCEPTED as recommended**, and the reasoning is recorded so the ruling is reviewable
> rather than merely asserted.
>
> * **#4 and #5 — BUSINESS, Discord leg removed, decided by `user_id`.** ⭐ The switch matters
>   more than the verdict: `user_id` is the field that ALREADY decides broadcast-vs-private, so
>   routing on it removes severity from the decision instead of adding a second thing that
>   decides. ⛔ The ordering is part of the ruling: the two `"info"` severity lies are deleted
>   **only after** the member path exists — delete them first and 200 personalised briefs land in
>   the ops channel, which is the outcome the workaround was invented to prevent.
>   ⭐ Safe to take now because the two webhooks were measured as ONE channel (§6): the removed
>   leg is a copy in the single ops room, and the member keeps their bell and email.
> * **#1 and #3 — BOTH, resolve twice, severity UNTOUCHED.** The class changes the destination;
>   the severity does not move. `critical` also paints the member's 🚨 embed, so demoting it
>   would quietly change what a MEMBER sees in order to fix where an OPERATOR reads — which is
>   the severity-as-channel-control defect wearing a tidier hat.
> * **#6 — BUSINESS, no Discord leg, and ⛔ NO `_TYPE_SEVERITY` ROW.** ⭐ **This corrects a worry
>   I raised with the owner and got backwards.** I had said #6 was "a guard that pages nobody"
>   and that fixing it would make it start paging — and separately that it ships inert. Both
>   were wrong: `EXPOSURE_GATE_WATCH_ENABLED` is declared **armed on `web`** on a 2-minute
>   weekday cron, and the correct fix is the one that adds NO paging at all. It is a MARKET
>   event, not a system event: a member reads it and acts, an operator has nothing to fix.
>   Classifying it BUSINESS makes the classification match what it already does, so it is a
>   **no-op today** — the "it starts firing" risk existed only for the remedy the packet
>   explicitly forbids.
>
> ⚠️ **What this ruling does NOT cover**, so nobody reads it as broader than it is: step 5's nine
> posters (one of which must NOT be failed closed), step 7's `alerts.py:406`, and step 8 — which
> is not reachable by building at all, only by a measured `fallback=0` over a full weekly cycle.


### 2a. The 13 BOTH rows (§4.3), in the order §6 step 6 asks for

| # | the event | recommended ruling | reversible by |
|---|---|---|---|
| **4** | a member's own price alert fired | **BUSINESS, and its Discord leg is removed** — decided by `user_id`, never by severity | a variable, if gated on `ALERT_ROUTING_ENABLED` |
| **5** | the member fan-out (indicator / catalyst / calendar / awareness / screener / transcript / AI briefings) | **BUSINESS, same rule as #4: a private alert has no Discord leg.** Then, and only then, delete the two `"info"` severity lies — separate commit | a variable |
| **1** | the market phase label changed | **BOTH — resolve twice.** Ops half → the ops destination; member half stays the bell, unchanged | a variable |
| **3** | the AI exposure read moved ≥20 points | **BOTH — resolve twice.** Identical treatment to #1, its own commit | a variable |
| **2** | a UCT20 book position hit its hard stop | ⛔ **NOT A DECISION — STRIKE IT FROM STEP 6.** Nothing calls the emitter; it reaches nobody. Class it when somebody wires it | n/a (no behaviour today) |
| **6** | QQQ traded through the wire's exposure-gate level intraday | **BUSINESS.** The bell entry is the whole product; add no Discord leg and ⛔ do **not** give it a `_TYPE_SEVERITY` row | nothing — it is a no-op today |
| **7** | a member's broker connection broke / a whole sweep failed / one account failed 3× | **OPS — a step-3-shaped conversion, not a step-6 decision** | a variable, **once §6's one unknown is read** |
| **8** | one member's journal disagrees with their brokerage after a sync | **OPS — same conversion as #7** | a variable, same unknown |
| **9** | the weekly sweep says whether every member's books balance | **OPS.** The green-heartbeat question is real but **deferred to after step 8** — see §4 row 9 | a variable |
| **10** | the morning catalyst digest | ⛔ **NOT A BOTH ROW — the tree contradicts the spec.** It is admin-only on all three legs. Convert as ordinary OPS | a variable |
| **11** | today's Live Trading Session did not publish / is stuck | ⛔ **NOT A DECISION.** A true ops alarm; ordinary OPS conversion | a variable |
| **12** | "a video just published" — the row the spec calls the sharpest | ⭐ **SETTLED: the DOCSTRING is the wrong sentence, not the destination.** Classify **OPS** and delete the word *"Audience-facing"* in the same commit. ⛔ Do not "fix" it the other way — that is a paid-content leak | the class: a variable. The leak: **not reversible** |
| **13** | an AI-written recap of a published session | **Neither OPS nor BUSINESS — it is a CONTENT poster. Move it to step 5** and fail it closed on `DISCORD_RECAP_WEBHOOK_URL` | a variable |

**Net effect on step 6: thirteen rows become four decisions** (#4, #5, #1, #3), **one classification
call** (#6), **six ordinary conversions** (#7, #8, #9, #10, #11, #12), **one move to step 5** (#13)
and **one strike** (#2).

### 2b. The 9 ↩ADMIN-FALLBACK posters (§6 step 5)

| # | module | what stops appearing | who notices, and how fast | recommended |
|---|---|---|---|---|
| 1 | `alpha_gold_eod.py:79-83` | the EOD Alpha Gold flow card | owner, **same day ~16:05 ET** | **fail closed** |
| 2 | `cream_card.py:104-110` | the Cream of the Crop EOD card | owner, **same day ~16:10 ET** | **fail closed** — ⛔ do not touch its ops emit at `:167` |
| 3 | `darkpool_eod.py:72-80` | the EOD (and Friday EOW) dark-pool card | owner, **same day** | **fail closed** |
| 4 | `oi_morning.py:521-526` | the pre-open overnight-OI leaderboard | owner, **next morning 8:00 ET** | **fail closed** — ⛔ do not touch its ops emit at `:648` |
| 5 | `weekly_flow.py:654-659` | the Friday weekly conviction-flow card | owner, **up to 7 days later** | **fail closed LAST of the five, and only with a log line** |
| 6 | `discord_watchlist.py:22-31` | the manual "Push to Discord" watchlist post | **instantly — the person who clicked** | **fail closed AND move to a call-time read** (import-time today) |
| 7 | `live_massive_router.py:4954-4958` | the manual Massive force-push | the person who triggered it | **fail closed + call-time read — ⚠️ Ravi co-owns this file; coordinate, never bundle** |
| 8 | `liveflow_worker.py:94-97` | live-flow conviction alerts forwarded to Discord | members of that room, within minutes | **fail closed + call-time read + rename the shadowing global. ⛔ flow-worker deploy — after-hours only** |
| 9 | `liveflow_monitor.py:47-48` | **nothing should stop** | — | ⛔ **DO NOT fail closed. Convert to `ops_webhook()`** — it is the one OPS member of the nine |

⭐ **This resolves the spec's own arithmetic.** §6 step 5's cell says *"The **9** ↩ADMIN-FALLBACK
content posters"* and its "why not earlier" cell says *"turns **eight** content posters silent."*
**Eight is right for step 5.** The ninth, `liveflow_monitor`, is an ops alarm and belongs to step 3's
population — and failing it closed would recommit the exact defect
`chart_health_alerts.py:31@prod` records: *"the in-memory deque was admin-pull-only, so a
bars-store problem paged no one — the gap that let the 2026-08-11 daily freeze run for a week."*

**And there is a tenth, shaped differently, which the spec named and mis-cited.**
`calendar_week_poster.py:50` returns `DISCORD_WEBHOOK_URL` as `"test(admin-fallback)"` for the
**test** target only; the `live` target at `:47` never falls back, by the design the whole ticket
generalises (`:41-43`). It needs no ruling. (The spec's `:453` citation for this points at
`_alert_admin`, an unrelated ops alert — see §0.)

---

## 3. WHERE THE TREE DISAGREES WITH THE SPEC — the tree wins

The spec is three weeks old and was read at `origin/master be9ca78b6`. Each row below was
re-verified in code at this HEAD.

| # | the spec says | the tree says | why it matters to a ruling |
|---|---|---|---|
| **T1** | `status: NOT IMPLEMENTED — nothing in this document is in source` | **steps 1, 2 and 3 are live in production** (§1) | every "classify it OPS" recommendation is now a one-line call to an existing, wire-proved reader |
| **T2** | row 2, `stop_hit`: *"`warning` posts it. Owner wants it; ops paging does not."* | **`alert_stop_hit` (`alerts.py:589`) has ZERO callers in `api/`, `tools/` or `scripts/`.** The file's own derived status table says `[NOT WIRED]` (`:20`) and `tests/test_alerts_broadcast_type_reachability.py` is the rail that keeps saying so | row 2 posts nothing, anywhere, today. It is not a decision |
| **T3** | row 5: *"bulk member content was set to `"info"` so 200 briefs never flood the admin channel"* — framed as one workaround | **the DEFAULT is the noisy one.** `deliver_alert_payload`'s signature defaults `severity: str = "warning"` (`watchlist_alert_service.py:386`), and **11 of its 13 call sites pass no severity at all** (C4). Only `ai_search_briefings.py:282` and `ai_search_deep.py:530` pass `"info"` | the problem is ~6× larger than the spec states, and it is a *default*, not a workaround. This is what makes §5's step-7 recommendation what it is |
| **T4** | row 10: the catalyst digest is *"also emailed to members and pushed to bells — member content on the ops transport"* | **admin-only on all three legs.** Docstring `catalyst/digest.py:6` *"Operator-scoped (admins only) so subscribers never get surprise pushes"*; `_admin_recipients()` `:33-34` is `SELECT id, email FROM users WHERE role = 'admin'` (`:42`), and it is what both the email loop (`:132`) and the bell loop (`:141`) iterate | there is no second audience to lose, so row 10 is not a BOTH row |
| **T5** | §1.3 and contradictions 2 + 8: `bars_reconciliation.py:358` passes **`"warn"`**, which pages nobody, and a green rail pins the typo | **FIXED.** `bars_reconciliation.py:385` passes **`"warning"`**, and the comment at `:371-377` records the change and why (two `severity` scales meet in one function). The prose *"pages someone"* is gone from the file | the spec's strongest argument against keying a router on severity has lost its live example. The argument still holds — `emit`'s severity is still a free string (`chart_health_alerts.py:117@prod`, `:220` on the branch) with no declared constants — but do not cite `"warn"` as current |
| **T6** | row 12: *"Whichever sentence is wrong, one of them is"* | **settled — the docstring is wrong.** Three independent code facts, §4 row 12 | the sharpest row is no longer open |
| **T7** | D1 = **30** files under `api/`, D1c = **36** | reproduced verbatim at this HEAD: **32** and **38** | two more readers of `DISCORD_WEBHOOK_URL` arrived in three weeks. `alert_routing.py:116` restates the old `30` in a comment and is now stale too |
| **T8** | line numbers throughout §1.2, §2, §5 for `alerts.py` | **every internal citation has drifted** (the file grew to 607 lines): `_TYPE_SEVERITY` `:119-125`→**`:175-181`**, the Discord gate `:350`→**`:406`**, severity constants `:89-91`→**`:145-147`**, `CHANNEL_*` `:107-109`→**`:163-165`**, `add_alert` `:280`→**`:336`**, the info default `:321`→**`:377`**, `discord_webhook()` `:84-86`→**`:140-142`**, the four emitters `:529/:534/:540/:548`→**`:585/:590/:596/:604`**, `wire_missed` `main.py:2514`→**`:2536`** | an implementer working from the spec's numbers patches the wrong lines. ⚠️ A third artifact carries a stale one too: `alert_taxonomy/regime_change.py:52` cites `_TYPE_SEVERITY["regime_change"]` at *"`alerts.py:98`"* |
| **T9** | §4.3's call-site column for rows 4, 5, 6, 7, 8, 9, 10, 11, 12, 13 | **all ten still resolve to the right code** — `watchlist_alert_service.py:301`/`:474` and the `:478-481` comment, `exposure_gate_watch.py:45`, `notifications.py:54`, `mirror_check.py:67`, `books_audit.py:299`, `digest.py:123`, `desk_daily_session.py:285`/`:302`, `desk_session_recap.py:36` — exact | the spec's *external* citations held up; only its `alerts.py` internals drifted |
| **T10** | §1.5 lists the nine fallback modules without noting how each reads its chain | **four of the nine capture at IMPORT**, not at call time: `discord_watchlist.py:22`, `live_massive_router.py:4954`, `liveflow_worker.py:94`, `liveflow_monitor.py:47` | for those four, "blank the variable to turn it off" does not reach the running process until a restart — the exact defect `alerts.py:118-136` documents and fixed for door A. Step 5 must fix the read, not just the chain |
| **T11** | §4.3 row 6: *"gated by `EXPOSURE_GATE_WATCH_ENABLED` default `"0"`"* | true of `exposure_gate_watch.enabled()` (`:29`) — **which has zero callers.** The scheduler reads the raw variable at `api/main.py:6587` with a *wider* predicate (`"1"`, `"true"`, `"yes"`), and the ledger declares the flag **`armed` on `web`** | the guard is probably RUNNING, on a 2-minute weekday 09-16 ET cron (`api/main.py:6588-6591`). Row 6 is a live producer reaching every member's bell, not an inert one. And "is it on" has two authorities, one of them dead |

---

## 4. THE 13 BOTH ROWS — the evidence, one block each

Ordered as §6 step 6 asks: rows 4 and 5 first, because they are where severity is doing the routing.

---

### Row 4 — `price_alert`: a member's own price alert fired

1. **What it is.** A member set "tell me when NVDA crosses $180". It crossed. This is that
   notification.
2. **Where it lands today.** `api/services/watchlist_alert_service.py:301` calls `add_alert` with
   **`severity="warning"` hardcoded at `:305`** and `user_id=alert["user_id"]` at `:314`. In
   `add_alert`: the row goes to that member's private list, not the broadcast list
   (`alerts.py:387`); then `fires_discord` is computed at **`alerts.py:406`** as
   `severity in (SEVERITY_WARNING, SEVERITY_CRITICAL)` → **True**, so `:407-408` posts to
   `DISCORD_ALERT_WEBHOOK` (`alerts.py:137`, read at call time by `discord_webhook()` `:140-142`).
   A member email follows at `watchlist_alert_service.py:331-336`.
3. **Who sees it today.** The member — bell **and** their email. **Plus** whoever reads
   `DISCORD_ALERT_WEBHOOK` (❓ which room that is, is UNREAD). The member cannot stop the third copy
   and neither can the caller: **there is no severity parameter on this path.**
4. **What changes under each ruling.**
   - **(a) BUSINESS, Discord leg moves** to `DISCORD_BUSINESS_WEBHOOK_URL` → unset ⇒
     `DISCORD_WEBHOOK_URL`: observable change is that the alert stops appearing in door A's room and
     starts appearing in the signups room. Possibly the same room. **This is the ruling that buys
     nothing.**
   - **(b) BUSINESS, Discord leg removed** (recommended): this notification stops appearing in any
     Discord channel. Nothing else changes — bell and email are untouched, and the member's
     experience is byte-identical.
   - **(c) leave it.** Every member's armed price levels keep arriving in a shared room.
5. **Recommendation: (b), and the switch is `user_id`, not severity and not class.** A member's
   private price alert has exactly one intended reader, and that reader has already been told twice.
   A third copy in a room they cannot read is not a notification — it is their watchlist leaking
   into an operator channel. ⛔ **And `severity="warning"` at `:305` must NOT be touched**: severity
   still ranks the alert on the bell and still picks its Discord embed colour (`alerts.py:552`) and
   glyph (`:554`). Per the spec's own constraint, the class changes the destination; here the
   *audience field* removes it.
6. **Blast radius if wrong.** Small and cheap. Nobody loses a notification they were getting.
   Reversible by a deploy — or by a variable if the implementer gates the new branch on
   `ALERT_ROUTING_ENABLED` (`alert_routing.py:135`), which is **strongly recommended** and costs
   nothing.

---

### Row 5 — the member fan-out: `deliver_alert_payload`

1. **What it is.** The one function every per-member alert in the estate goes through — indicator
   alerts, catalyst alerts, catalyst must-know, calendar alerts, the awareness engine, screener
   alerts, transcript-keyword alerts, the AI briefings, the AI deep reports, and the whole S7
   taxonomy.
2. **Where it lands today.** `api/services/watchlist_alert_service.py:474` calls `add_alert` with
   `severity=severity` at `:482`, the caller's value, and `user_id=user_id` at `:484`. The comment
   at **`:478-481`** is the workaround the spec quotes, verbatim in the tree today:
   *"severity is the Discord gate (add_alert fires the global admin webhook on warning/critical
   only) — bulk member content like the AI briefings passes `"info"` so 200 personalized briefs
   never flood the admin channel (2026-08-28 review)."*
   ⛔ **And the default is the loud one.** The signature at **`:386`** reads
   `severity: str = "warning"`. An AST scan of all 13 call sites:

   | call site | `source` | severity passed |
   |---|---|---|
   | `ai_search_briefings.py:282` | `ai_briefing` | **`"info"`** |
   | `ai_search_deep.py:530` | `ai_deep_report` | **`"info"`** |
   | `alert_taxonomy/delivery.py:56` | pass-through | the taxonomy's own default is `"info"` (`delivery.py:29`) |
   | `alert_rev_migration.py:254` | `indicator_alert_migration` | *(default `"warning"`)* |
   | `awareness/engine.py:271` | `awareness_engine` | *(default `"warning"`)* |
   | `calendar_alerts.py:317` | `calendar_alert` | *(default `"warning"`)* |
   | `catalyst/digest.py:143` | `catalyst_digest` | *(default `"warning"`)* |
   | `catalyst/engine.py:274` | `catalyst_alert` | *(default `"warning"`)* |
   | `catalyst/engine.py:381` | `catalyst_mustknow` | *(default `"warning"`)* |
   | `indicator_alert_evaluator.py:2251` | `indicator_alert` | *(default `"warning"`)* |
   | `screener/screen_alerts.py:279` | `screen_alert` | *(default `"warning"`)* |
   | `transcript_keyword_alerts.py:210` | `transcript_keyword` | *(default `"warning"`)* |
   | `transcript_keyword_alerts.py:294` | `transcript_keyword` | *(default `"warning"`)* |

3. **Who sees it today.** The member (bell + email) for all of them. **Plus door A's channel for
   ten of the thirteen** — every indicator alert, calendar alert, catalyst alert, must-know,
   awareness away-delivery, screener alert and transcript-keyword hit that any member has armed.
   Only the two AI paths and the S7 taxonomy are quiet there.
4. **What changes under each ruling.**
   - **(a) class the fan-out BUSINESS and point the Discord leg at `DISCORD_BUSINESS_WEBHOOK_URL`**:
     unset ⇒ `DISCORD_WEBHOOK_URL`, so ten producers' member content **moves from door A's room to
     the signups room**. That is more content in the room this ticket exists to unclutter.
   - **(b) a private alert has no Discord leg** (recommended): all ten stop appearing in any Discord
     room. Bells and emails unchanged. The room this ticket is about gets materially quieter on day
     one, with no member-visible change at all.
   - **(c) leave it**, and every future per-member alert type inherits a default that posts to an
     operator channel unless its author remembers to lie about severity.
5. **Recommendation: (b) — and this is the answer to what row 5 implies for step 7.**
   ⭐ **Severity is already a channel control, and the fix must remove that job from it, not
   re-home it.** `alerts.py:406` is the whole defect in one line. While a boolean over severity
   decides the Discord leg, every producer that wants to be quiet must understate its priority
   (two do) and every producer that forgets is loud (ten do). **A class field that leaves `:406`
   reading severity re-creates the 2026-08-28 workaround with extra steps** — the spec says so and
   it is right.
   **The minimal step 7, concretely:** at `alerts.py:406-414`, consider a Discord destination only
   when `user_id is None`; when `user_id` is set, write `channels[CHANNEL_DISCORD] = CHANNEL_SKIPPED`
   with the reason *"private alert — the member's own bell and email carry it"*. That reuses the
   field that already decides broadcast-vs-private at `:387` and the vocabulary that already exists
   at `:163-165`. Severity keeps ranking, colouring and glyphing, and stops routing.
   **Then, in its own later commit,** delete the two `"info"` literals at
   `ai_search_briefings.py:282` and `ai_search_deep.py:530` — they are severity lies told to control
   a channel, and once the channel is decided by audience they are simply wrong about priority.
   ⛔ **Order is load-bearing and the spec already warns about it:** removing those two literals
   *before* the `user_id` branch lands puts 200 personalised briefs per morning into the shared room.
6. **Blast radius if wrong.** The ruling itself: low — ten producers go quiet in one Discord room,
   nothing member-facing moves, reversible by `ALERT_ROUTING_ENABLED=0` if gated. **The ORDER
   getting reversed: high** — a flood recoverable only by a deploy, or by blanking
   `DISCORD_ALERT_WEBHOOK`, which silences door A for everything including rows 1 and 3.

---

### Row 1 — `regime_change`: the market's phase label changed

1. **What it is.** The morning-wire engine's phase classifier moved the market from one phase to
   another — e.g. Markup → Distribution — on an intraday push.
2. **Where it lands today.** `api/routers/push.py:196` calls `alert_regime_change` when the new
   push's phase differs from the cached previous one (`:193-195`). That is `alerts.py:580`, which
   calls `add_alert("regime_change", …)` at `:585` with **no severity and no `user_id`**. So:
   `_TYPE_SEVERITY["regime_change"]` at **`alerts.py:176`** supplies `SEVERITY_CRITICAL` via `:377`;
   `user_id is None` puts the row on the broadcast list (`:387`); `fires_discord` is True at `:406`;
   `:408` posts to `DISCORD_ALERT_WEBHOOK` with the red 🚨 embed (`:552`, `:554`).
3. **Who sees it today.** **Every logged-in member's bell**, plus whoever reads
   `DISCORD_ALERT_WEBHOOK`. No email. It is the highest severity in the estate, on a routine market
   event.
4. **What changes under each ruling.**
   - **(a) BOTH — two `resolve_channel` calls** (recommended): the member bell entry is unchanged.
     The Discord copy moves to the ops destination — which, with `DISCORD_OPS_WEBHOOK_URL` unset, is
     byte-identically where it goes today. The observable change on day one is **none**; the change
     arrives the day the ops variable is set, and then a phase transition appears in the ops room
     instead of the signups room.
   - **(b) BUSINESS only:** the ops room stops carrying market signals. A phase change becomes a
     member-product event and nothing else.
   - **(c) leave it.**
5. **Recommendation: (a) BOTH, resolve twice.** Both readings are real and neither is redundant. The
   member copy is written in the second person about the market (`alerts.py:582`); the ops copy is
   the one line that tells an operator the classifier ran and changed its mind, which is exactly the
   "did the engine do something" question the ops room is for. ⛔ **Do not demote the severity** —
   beyond the spec's constraint, `critical` is also what gives the member the red 🚨 rendering
   (`:552`, `:554`), so a demotion would change what a member sees in order to change where an
   operator reads. That is the inversion in miniature.
6. **Blast radius if wrong.** Low and variable-reversible: blank `DISCORD_OPS_WEBHOOK_URL` and the
   post returns to the compatibility floor, or set `ALERT_ROUTING_ENABLED=0` and the whole branch
   reverts. ⚠️ One honest caveat: `push.py:205`'s `intraday_update_prev` cache has a 14400 s TTL and
   lives in the in-process TTLCache, so after any redeploy the first push seeds the baseline and
   nothing fires. This row's frequency is therefore lower than "every transition" and nobody should
   size the ops room's noise off the phrase "pages on every market phase transition".

---

### Row 3 — `exposure_shift`: the AI's exposure read moved 20+ points

1. **What it is.** The brain's own intraday exposure opinion moved by 20 points or more. ⛔ It is
   explicitly **not** the published UCT Exposure rating — the message says so (`alerts.py:605-606`).
2. **Where it lands today.** `api/routers/push.py:202`, fired when `abs(new_exp - old_exp) >= 20`
   (`:201`). That is `alerts.py:601` → `add_alert("exposure_shift", …)` at `:604`, again with no
   severity and no `user_id`. `_TYPE_SEVERITY` gives `SEVERITY_WARNING` at **`alerts.py:180`** →
   broadcast bell (`:387`) **and** door A's webhook, because `:406` fires on `warning` too.
3. **Who sees it today.** Every member's bell + door A's channel, with the amber ⚠️ rendering.
4. **What changes under each ruling.** Identical shape to row 1: **(a)** BOTH ⇒ no day-one change,
   ops copy relocates when the variable is set; **(b)** BUSINESS-only ⇒ the ops room stops hearing
   that the brain changed its mind; **(c)** leave.
5. **Recommendation: (a) BOTH, resolve twice — its own commit, immediately after row 1.** Same
   reasoning, and the disclaimer in its own copy is the argument: a message that has to explain it
   is *not* the published rating is telling an operator about the engine's internal state, which is
   an ops fact; it is *also* on every member's bell, which is a product fact.
6. **Blast radius if wrong.** Same as row 1 — one variable.

---

### Row 2 — `stop_hit` ⛔ STRIKE: nothing calls it

1. **What it is.** *Would be*: a UCT20 book position hit its -6% hard stop.
2. **Where it lands today.** **Nowhere.** `alert_stop_hit` is defined at `api/services/alerts.py:589`
   and a code-only scan of `api/`, `tools/` and `scripts/` finds **no reference to it outside that
   definition** (C3 in §0 — `alert_regime_change` and `alert_exposure_shift` both show their
   `push.py` callers in the same scan, so the scan is not answering "no" to everything). The file's
   own status table says `[NOT WIRED]` at `:20`, derived — not typed — by
   `tests/test_alerts_broadcast_type_reachability.py`.
3. **Who sees it today.** **Nobody.** No bell entry, no Discord post, no email. The function is
   unreachable from production code.
4. **What changes under each ruling.** Nothing, under any of them. A class on a producer nothing
   calls changes no observable behaviour.
5. **Recommendation: strike row 2 from step 6.** Class it at the moment somebody wires it — and
   because `resolve_channel` raises on an absent class (`alert_routing.py:317`), whoever wires it
   will be *forced* to choose. That is the rail doing its job and it costs nothing now.
   ⭐ **But read this before assuming stops are un-notified.** A member IS told when a position
   reaches its stop — through a different mechanism with a different name.
   `api/services/awareness/rules.py` raises `kind="stop_hit"` at importance 10, and importance ≥8
   away-delivers via `awareness/engine.py:271` → `deliver_alert_payload` **with no severity**, i.e.
   the `"warning"` default. **So the stop-hit notification that actually exists already posts into
   door A's webhook, through row 5's path.** Row 2 is empty; the thing row 2 is about is row 5's
   problem.
6. **Blast radius if wrong.** Zero today. If row 2 is classed now and wired differently later, the
   class is a guess about a producer that does not exist — which is why not classing it is the safer
   answer.

---

### Row 6 — `exposure_gate`: the wire's gate level was crossed intraday

1. **What it is.** QQQ traded above the morning wire's restraint-release level, or below the FTD
   low (the "S2 danger level"), during the session — an early flag that a *close* there would lift
   or cap the exposure ceiling on tomorrow's wire.
2. **Where it lands today.** `api/services/exposure_gate_watch.py:45` —
   `add_alert("exposure_gate", title, message, data=data)`, with **no severity and no `user_id`**,
   once per trigger per day (`_fire_once`, `:39-46`, 24 h cache key). Triggers: release at `:69-77`,
   S2 at `:81-89`. In `add_alert`: `"exposure_gate"` is **absent from `_TYPE_SEVERITY`**
   (`alerts.py:175-181` — the map holds exactly `regime_change`, `stop_hit`, `scanner_match`,
   `ep_resolved`, `exposure_shift`), so `:377` falls to `SEVERITY_INFO`; `fires_discord` is **False**
   at `:406`; `:414` records `channels[CHANNEL_DISCORD] = CHANNEL_SKIPPED`. `user_id is None` ⇒ the
   broadcast list at `:387`.
3. **Who sees it today.** ⭐ **Correction to the spec, which says this guard "pages nobody".** It
   reaches **every logged-in member's bell** and **no operator at all**. And it is almost certainly
   running: registered at `api/main.py:6588-6591` on a `mon-fri`, `hour="9-16"`, `minute="*/2"` ET
   cron, gated at `api/main.py:6587` on `EXPOSURE_GATE_WATCH_ENABLED` — which
   `docs/feature_flags.json` declares **`armed` on `web`** (❓ ledger, not Railway).
   ⚠️ **A second authority, and it is dead.** `exposure_gate_watch.enabled()` (`:28-29`) accepts only
   `"1"`; `api/main.py:6587` accepts `"1"`, `"true"` or `"yes"` — and `enabled()` has **zero
   callers**. Not this ticket's to fix; recorded so nobody reads `:29` as the authority.
4. **What changes under each ruling.**
   - **(a) BUSINESS** (recommended): **nothing changes.** No Discord leg is added, no severity row
     is added, the bell keeps working. The row is closed with a written reason.
   - **(b) OPS**: the guard starts reaching an operator — up to two posts a day during RTH, on days
     the levels are crossed. ⛔ **And it must be expressed as a class with a destination, never as
     `_TYPE_SEVERITY["exposure_gate"] = SEVERITY_WARNING`.** That one-line severity bump is the
     tempting implementation and it is precisely what the spec forbids: *"The class must change the
     destination, not the severity."* It would also silently change how the alert ranks on every
     member's bell.
5. **Recommendation: (a) BUSINESS — and this is the row I am least confident about.** The reason is
   the copy. Every message this module writes is addressed to a member, in the second person, about
   what a close would mean to them: *"A CLOSE above it lifts the exposure cap on the next morning's
   wire"* (`:73-75`), *"no new risk until it reclaims"* (`:85-87`). There is no operator action in
   it — nothing is broken, no job failed, no credential expired, no remediation is a deploy. By the
   spec's own §4 test that is BUSINESS.
   ⚠️ **Say plainly where I am unsure:** the spec's author expected a reviewer to move exactly this
   row (its GAPS §1 names #6, #9 and #11). If the owner's model is that the exposure gate is the
   wire engine's *guard* — a thing that should page whoever runs the engine when it trips — then OPS
   is defensible and I would not argue. What I am confident about is the *mechanism*: whichever way
   it goes, do not do it by adding a severity.
6. **Blast radius if wrong.** **(a) is free** — a no-op today, reversible by nothing because nothing
   changed. **(b)** adds up to two posts a day to an ops room, reversible by blanking
   `EXPOSURE_GATE_WATCH_ENABLED` (which also stops the bell entry — a blunt lever, worth knowing
   before choosing (b)).

---

### Row 7 — broker `notifications.py`: a member's brokerage connection broke

1. **What it is.** Three related events: a member's brokerage connection went to `broken` and they
   must re-authorize; **or** a large fraction of one sweep's accounts failed together (the
   partner-outage shape); **or** one account's last three sync attempts all failed.
2. **Where it lands today.** All three go through the module's own poster,
   `api/services/journal_two/broker/notifications.py:53` `_post_discord`, which reads
   **`DISCORD_ALERT_WEBHOOK or DISCORD_WEBHOOK_URL` at `:54`** — door A's variable first, door C's
   as the fallback, and neither door's code.
   - `connection_broken` (`:81`) → `_do_broken` (`:91`): a **member email** via
     `email_service.send_broker_reconnect_email` at `:100`, then the Discord post at `:108`.
   - `sweep_failure_spike` (`:144`) → Discord only, at `:161-171`, 1 h cooldown (`:126`).
   - `sync_failed` (`:180`) → `_do_failed` (`:187`) → Discord only, at `:200-206`, once per account
     per ET day (`:34`, `:193`).
3. **Who sees it today.** The **member**, by email, for the broken transition only. The **owner**,
   in whichever room `DISCORD_ALERT_WEBHOOK` (or, unset, `DISCORD_WEBHOOK_URL`) points at, for all
   three. No bell, no in-app.
4. **What changes under each ruling.** The spec frames this as "which half each variable serves".
   In the tree there is nothing to split: **the member half is already a separate transport** (the
   Resend email at `:100`), and the three Discord posts have one reader. So the choice is narrower —
   convert the Discord leg to the ops destination, or leave the straddle.
5. **Recommendation: OPS, and treat it as a step-3-shaped conversion rather than a step-6 decision.**
   Replace `:54` with `alert_destination.ops_webhook()`. The reason is in the message bodies: each
   one ends with a triage instruction — *"Triage: GET /api/j2/broker/admin/stats · POST
   /api/j2/broker/admin/reset-partner-auth-broken?dry_run=1"* (`:169-170`), *"Triage:
   /api/j2/broker/admin/stats"* (`:204`). **A post whose body is a runbook is an ops post by
   construction.**
   ⚠️ **The one thing an implementer cannot verify from source, and it gates this row:** today a
   *set* `DISCORD_ALERT_WEBHOOK` **wins** at `:54`. `ops_webhook()` resolves
   `DISCORD_OPS_WEBHOOK_URL` → `DISCORD_WEBHOOK_URL` and **never reads `DISCORD_ALERT_WEBHOOK`**. So
   if those two variables name different rooms, this conversion *moves* three owner alerts. See §6 —
   one pod read settles it for rows 7 and 8 together, and it should be taken before either lands.
6. **Blast radius if wrong.** Bounded and variable-reversible: if the two variables differ and the
   move is unwanted, set `DISCORD_OPS_WEBHOOK_URL` to whatever `DISCORD_ALERT_WEBHOOK` holds and the
   post goes back. No member-facing change under any ruling — the reconnect email is untouched.

---

### Row 8 — broker `mirror_check.py`: one member's journal disagrees with their broker

1. **What it is.** After a sync, the journal failed to prove itself equal to the broker payload that
   same sync used — a member's positions, options or balance in the product do not match their
   brokerage.
2. **Where it lands today.** `api/services/journal_two/broker/mirror_check.py:67` — the same
   straddle, `DISCORD_ALERT_WEBHOOK or DISCORD_WEBHOOK_URL`, posted off-thread (`:76-78`) and
   deduped once per account per ET day (`:49` `_alert_pinged`).
3. **Who sees it today.** **The owner only.** There is no member leg in this module at all — which
   is the module's stated design: the owner cannot inspect members' broker data, so the guarantee
   has to be structural (`:2-9`).
4. **What changes under each ruling.** OPS ⇒ the post resolves through `ops_webhook()`; identical
   today with the ops variable unset, relocates when it is set. BUSINESS ⇒ a structural invariant
   failure would be routed to a business room, where nobody acts on it.
5. **Recommendation: OPS, same conversion as row 7, same commit or the next one.** The spec's BOTH
   reading is *"the drift is in one member's book, so remediation is member-scoped"* — but
   remediation is a **code fix to the reconcilers**, not a reply to the member, and the member is
   never told. The fact that the payload contains member data is an argument for keeping it out of a
   member or public room, i.e. **for** a dedicated ops destination, not against it.
6. **Blast radius if wrong.** Identical to row 7, with the identical mitigation. ⚠️ Same unknown.

---

### Row 9 — `books_audit.py`: the weekly "does every member's book balance" sweep

1. **What it is.** A Sunday sweep that re-derives every member's journal across five lenses
   (analytics, calendar, day pages, tax, options) and reports whether each one closes.
2. **Where it lands today.** `api/services/journal_two/books_audit.py:297` `_post_discord_summary`
   reads **`DISCORD_WEBHOOK_URL` at `:299`** — door C's variable, no straddle, no ops variable.
   Scheduled by `register_weekly_job` (`:323`) at **Sunday 09:30 ET** (`:333-334`), wired from
   `api/main.py:8148-8149`, with kill switch `BOOKS_AUDIT_WEEKLY_ENABLED` **default ON** (`:327`).
   Failures are truncated to the first ten (`failures[:10]`, `:306`) with member ids cut to eight
   characters (`f['userId'][:8]`, `:306`).
3. **Who sees it today.** Whoever reads `DISCORD_WEBHOOK_URL` — the room signups land in.
   ⛔ **And it posts on the healthy case too:** the 🟢 *"Books audit: all N books balance"* branch at
   `:311-314`. **That is §3's muting mechanism, live** — roughly 51 of 52 posts a year say nothing is
   wrong, into the channel this ticket exists to unclutter.
4. **What changes under each ruling.** OPS ⇒ the summary resolves through the ops destination.
   BUSINESS ⇒ a broken invariant about member data lands where nobody triages. A **third, separable
   decision** sits beside the class: whether the green weekly heartbeat should keep posting.
5. **Recommendation: OPS now. Defer the green-heartbeat question until after step 8.** The class is
   easy — a failing accounting invariant is an engineering fact and the truncated ids are already the
   right privacy posture. The heartbeat is genuinely harder and I do **not** recommend bundling it:
   removing the only weekly proof-of-life before the ops room exists and is being read would make
   "the sweep is quiet" and "the sweep is dead" indistinguishable, which is the failure
   `desk_session_audit.py` was written to avoid. Once the ops destination is set and `fallback=0` has
   been measured (step 8), revisit it — and if it is dropped then, drop it in favour of the
   population count §5.3 already asks for (`resolved=<n> … checked=<n>`), never in favour of silence.
6. **Blast radius if wrong.** Class: one variable. Heartbeat, if taken early: a deploy, and the real
   cost is a blind spot rather than noise — which is why the recommendation is to wait.

---

### Row 10 — the catalyst digest ⛔ NOT A BOTH ROW: the tree contradicts the spec

1. **What it is.** One consolidated 8 AM ET brief of the morning's A/B-grade catalysts.
2. **Where it lands today.** Three legs, and **all three are admin-only**:
   - **Discord** at `api/services/catalyst/digest.py:123` — `discord_notify._send_webhook(...)`,
     i.e. door C ⇒ `DISCORD_WEBHOOK_URL`, captured at **import** (`discord_notify.py:11`).
   - **Email** at `:133`, looping `recipients` from `_admin_recipients()` (`:117`).
   - **Bell** at `:143` via `deliver_alert_payload`, in the same `recipients` loop (`:141`).
   `_admin_recipients()` is defined at `:33-34` and its query is
   `SELECT id, email FROM users WHERE role = 'admin'` (`:42`). The module docstring says so at `:6`:
   *"Operator-scoped (admins only) so subscribers never get surprise pushes."* Gate
   `CATALYST_DIGEST_ENABLED` at `:109`, declared `armed` on `web`.
3. **Who sees it today.** **Administrators only** — door C's Discord room, admin email, admin bell.
   No member receives any leg of it. The spec's BUSINESS reading ("also emailed to members and pushed
   to bells") is **false in the tree**.
4. **What changes under each ruling.** Because there is no second audience, suppressing the digest
   "for members" loses nothing. OPS ⇒ the Discord leg resolves through `ops_webhook()`. There is no
   BOTH to split.
5. **Recommendation: strike row 10 from step 6 and convert it as an ordinary OPS producer.**
   ⚠️ **One unnoticed defect worth the owner's eye while this row is open.** The bell leg at `:143`
   passes **no severity**, so it takes `deliver_alert_payload`'s `"warning"` default
   (`watchlist_alert_service.py:386`) and therefore **also posts to door A's webhook — once per
   admin recipient**. With three admins that is three duplicate Discord copies of the same digest
   every morning, in a *second* room, on top of the intended one at `:123`. That is row 5's mechanism
   producing a real duplicate today, and row 5's recommended `user_id` branch fixes it for free
   (these bell entries all carry a `user_id`). No separate ruling needed — just do not be surprised
   when a daily duplicate disappears.
6. **Blast radius if wrong.** Very low. Nothing member-facing; one variable either way.

---

### Row 11 — "today's session did not publish" ⛔ NOT A DECISION: a true ops alarm

1. **What it is.** The weekday end-of-day guard saying either that today's Live Trading Session is
   not in The Desk, or that its recording is stuck in processing.
2. **Where it lands today.** `api/services/desk_daily_session.py:274` `_alert_owner`, called from
   `check_missing_session_alert` at `:348` (which drains the queue first and distinguishes *stuck*
   from *missing*). It posts at **`:285`** via `discord_notify._send_webhook`, i.e. door C ⇒
   `DISCORD_WEBHOOK_URL` captured at **import** (`discord_notify.py:11`).
3. **Who sees it today.** Whoever reads `DISCORD_WEBHOOK_URL` — the signups room. No email, no bell,
   no member.
4. **What changes under each ruling.** OPS ⇒ resolves through `ops_webhook()`, identical until the
   variable is set. There is no business half: members do notice a missing video, but this post is
   not what tells them and would not help them.
5. **Recommendation: OPS, ordinary conversion — strike it from step 6's decision list.** The message
   bodies settle it: *"Check that the webinar ran and auto-recorded to the Zoom cloud"* (`:283-284`)
   and *"Check Zoom/YouTube credentials + the desk_session_jobs queue"* (`:278-279`). Remediation is
   a credential or a queue; the reader is whoever keeps the system running.
   ⚠️ **One consequence to state once and then stop worrying about:** converting this producer
   bypasses door C's import-time capture for *this* post only. After the conversion, blanking
   `DISCORD_WEBHOOK_URL` silences this alarm **immediately** while `notify_signup` keeps posting
   until the process restarts. That asymmetry is a real hazard but it is *already* the situation for
   all six of step 3's converted producers, and the fix for it is door C's one-line call-time read
   (spec §9 leaves the sequencing to step 3's implementer), not a reason to leave this row alone.
6. **Blast radius if wrong.** One variable. Nothing member-facing.

---

### Row 12 — "Audience-facing" ⭐ SETTLED: the docstring is the wrong sentence

1. **What it is.** The notification that a session video finished processing and is now in The Desk.
2. **Where it lands today.** `api/services/desk_daily_session.py:300` `_notify_published`, called
   once, from the publish path at `:502`. Two legs:
   - **Discord** at `:308` — `discord_notify._send_webhook`, door C ⇒ `DISCORD_WEBHOOK_URL`. It
     builds a gold-brand embed (`:314`) with the YouTube thumbnail (`:313`) and a `[Watch ▶]` link
     (`:311-312`), exactly as the spec describes.
   - **Email** at `:324`, to `_alert_recipients()` (`:294-297`), which is
     `DESK_DAILY_SESSION_ALERT_EMAILS or ADMIN_EMAILS`.
3. **Who sees it today.** **Administrators.** Door C's Discord room, and the admin alert-email list.
   No member and no public room receives it.
4. **Which sentence is wrong — determined.** The spec asks: the docstring at `:302` calls this
   *"Audience-facing"*, and `terminal_next_monitor_main.py:18-19` calls `DISCORD_WEBHOOK_URL` *"THE
   ADMIN CHANNEL, NEVER THE MEMBER OR PUBLIC ONE"*. **The docstring is wrong.** Three independent
   facts, all in code:
   1. **Its own other leg goes to administrators.** `_alert_recipients()` (`:294-297`) is
      `DESK_DAILY_SESSION_ALERT_EMAILS or ADMIN_EMAILS`, consumed at `:323`. A function whose email
      list is the admin list is not addressing an audience.
   2. **`terminal_next_monitor_main.py` binds that claim in CODE, not just prose** —
      `ADMIN_WEBHOOK_ENV = "DISCORD_WEBHOOK_URL"` at `:47`, with `DISCORD_TSDR_WEBHOOK_URL` named as
      the public ~750-member channel and asserted absent from that file by
      `tests/test_terminal_next_monitor.py`.
   3. ⭐ **A genuinely audience-facing announcement for the very same event already exists, in a
      different module, on a different variable.** `api/services/desk_session_announce.py:68` reads
      **`DISCORD_TSDR_WEBHOOK_URL`**, and `maybe_announce` (`:367`) is called on the same publish
      path, gated by its own per-show allowlist.
   So `_notify_published` is an operator confirmation that the pipeline shipped, which *looks* like a
   promo because the gold card was the convenient thing to reuse. **The styling is what made the
   docstring wrong.**
5. **Recommendation: classify OPS, and delete the word "Audience-facing" from `:302` in the same
   commit**, replacing it with a pointer to `desk_session_announce.py` as the audience-facing path.
   A comment claiming an audience that its own recipient list contradicts is a claim about a run, and
   leaving it means this row gets re-opened by the next reader.
   ⛔⛔ **Do NOT settle it the other way.** Pointing `_notify_published` at
   `DISCORD_TSDR_WEBHOOK_URL` to make the docstring true would announce **every** show to the public
   room, bypassing `desk_session_announce`'s allowlist — the one rail that keeps paywalled shows out
   of it. Live Trading Sessions are paywalled. **The tempting reading of row 12 is a paid-content
   leak**, and this repo has already paid once for a `DESK_PUBLIC_SHOWS` misreading.
6. **Blast radius if wrong.** The OPS classification: one variable. The docstring: free. **The wrong
   ruling is the expensive one and it is not variable-reversible** — a public announcement cannot be
   unsent to ~750 people.

---

### Row 13 — the AI session recap → move it to step 5 and fail it closed

1. **What it is.** An Opus-written recap of a published session (TL;DR, discussion points, tickers
   and levels, setups, takeaways, action items), posted after the insights pass stores the
   transcript.
2. **Where it lands today.** `api/services/desk_session_recap.py:32` `_webhook_url(category)`:
   `DISCORD_RECAP_WEBHOOK_URL` at `:36`, `DISCORD_WEBHOOK_URL` at `:37`, and the decision at
   `:38-39` — the dedicated webhook **only** when the category is exactly
   `"live trading sessions"`; otherwise `return fallback or dedicated`. Gate
   `DESK_SESSION_DISCORD_RECAP_ENABLED` at `:29`, declared `armed` on `web`. The same resolution is
   re-checked, with its own refusal message, at `:209-214`.
3. **Who sees it today.** Whoever reads `DISCORD_RECAP_WEBHOOK_URL` for live sessions; **whoever
   reads `DISCORD_WEBHOOK_URL` for every other category** — workshops, evening updates, thoughts on
   the market, post-market recaps, Sunday Scans. The docstring calls the destination *"the team's
   UCT Intelligence Discord"* (`:3-4`), i.e. internal either way.
   ⚠️ **A second hop the spec does not name:** `:39` is `fallback or dedicated`, so with
   `DISCORD_WEBHOOK_URL` blank a non-live recap falls through **into the recap channel** — the very
   channel the comment at `:34-35` says the fallback exists to keep clean.
4. **What changes under each ruling.**
   - **OPS or BUSINESS**: both are category errors. A recap is not an alarm and not a member
     notification; it is a piece of writing for a room.
   - **Content poster, fail closed** (recommended): return `DISCORD_RECAP_WEBHOOK_URL` for every
     category and post nothing when it is unset. Observable change: non-live recaps stop appearing
     in the admin room; they appear in the recap channel instead, or nowhere until the variable is
     set.
5. **Recommendation: strike row 13 from step 6, add it to step 5, and give it
   `calendar_week_poster.resolve_webhook`'s shape** (`:39-51`) — one destination per content purpose,
   no admin terminus.
   ⚠️ **Where I am overriding the spec, and why.** The spec classes this BOTH *"because the fallback
   is the documented intent, not a default"*, and the comment at `:34-35` does state an intent. My
   reason for overriding: **`:39`'s `or dedicated` means the chain already falls back into the recap
   channel when the admin variable is blank**, so "keep the recap channel copy-paste clean" is not a
   property the code holds in the first place. An intent the code contradicts is a plan, not a
   decision — and the docstring at `:12-14` says as much in its own words (*"point the dedicated var
   at a #session-recaps channel later without touching code"*). If the owner reads it the other way,
   the spec's BOTH classification is defensible and this row becomes a two-call producer.
6. **Blast radius if wrong.** Low. Non-live recaps stop appearing until `DISCORD_RECAP_WEBHOOK_URL`
   is set; the owner notices the next time a workshop or evening update publishes. One variable
   fixes it.

---

## 5. STEP 5 — the nine posters, and what silence costs each

⛔ **The shared consequence, stated once:** step 5 makes a poster **go silent rather than post to
the wrong room**. Per poster, what stops appearing and who notices.

**Eight of the nine are content.** Each currently resolves its own chain ending in
`DISCORD_WEBHOOK_URL`; the recommendation for each is to delete that last term. **Four of the eight
additionally need their read moved from import time to call time**, or the fail-closed behaviour
cannot be turned back on by a variable — the defect class `alerts.py:118-136` documents and fixed
for door A.

| # | module + the resolution site | how it reads | what it posts | schedule / trigger | flag (ledger) | if it goes silent, who notices |
|---|---|---|---|---|---|---|
| 1 | `api/alpha_gold_eod.py:79-83` `_webhook()` | ✅ **call time** | the EOD Alpha Gold options-flow PNG card | flow-worker, ~16:05 ET weekdays | `ALPHA_GOLD_EOD_ENABLED` armed on `flow-worker` | the owner, **the same afternoon** — it is a daily habit |
| 2 | `api/cream_card.py:104-110` `_webhook()` | ✅ **call time** | the Cream of the Crop EOD Bull/Bear card | flow-worker, ~16:10 ET weekdays | `CREAM_EOD_ENABLED` armed on `flow-worker` | the owner, **the same afternoon** |
| 3 | `api/darkpool_eod.py:72-80` `_webhook()` | ✅ **call time** | the dark-pool EOD card (and Friday's EOW) | **web**, scheduled `api/main.py:5736-5740` | `DARKPOOL_EOD_ENABLED` armed on `web` | the owner, **the same afternoon** |
| 4 | `api/oi_morning.py:521-526` `_webhook()` | ✅ **call time** | the overnight open-interest leaderboard | flow-worker, 8:00 ET pre-open | `OI_MORNING_ENABLED` armed on `flow-worker` | the owner, **the next morning** |
| 5 | `api/weekly_flow.py:654-659` `_webhook()` | ✅ **call time** | Friday's top-10 bull / top-10 bear conviction flow | flow-worker, Friday | `WEEKLY_FLOW_ENABLED` armed on `flow-worker` | ⚠️ the owner, **up to seven days later** |
| 6 | `api/discord_watchlist.py:22-31` `DISCORD_FLOW_WEBHOOK_URL` | ⛔ **IMPORT time** | the curated watchlist push | **manual** — the owner clicks "Push to Discord" (`:4`) | none | ⭐ **instantly, by the person who clicked** |
| 7 | `api/live_massive_router.py:4954-4958` `_MASSIVE_WEBHOOK` | ⛔ **IMPORT time** | the manual Massive flow force-push | manual / PUSH_SECRET | none | the person who triggered it |
| 8 | `api/liveflow_worker.py:94-97` `DISCORD_WEBHOOK_URL` | ⛔ **IMPORT time** | live-flow conviction alerts forwarded to Discord | continuous, market hours | — | **members of that room**, within minutes |
| 9 | `api/services/liveflow_monitor.py:47-48` `WEBHOOK` | ⛔ **IMPORT time** | live-feed outage alarms + the daily scorecard | `worker`, 60 s poll | `LIVEFLOW_MONITOR_ENABLED` armed on `worker` | ⛔ **NOBODY — which is why it must not be failed closed** |

**Per-poster notes that change what the implementer does:**

- **#2 and #4 are also OPS producers.** `cream_card.py:167` and `oi_morning.py:648` each call
  `chart_health_alerts.emit(...)` — two of door B's 22 sites. **Step 5 touches `_webhook()` only;
  it must not touch those two emits**, which step 3 already converted through `ops_webhook()`.
- **#5 should go last of the eight, and only with a log line.** A weekly card that silently stops is
  invisible for up to a week. Its refusal must print something an operator can find, in the style of
  `desk_session_recap.py:213-214`'s refusal message.
- **#6 is the best silence in the set** and should go **first**: the feedback loop is a human
  looking at a button. It is also one of the four import-time reads, so it is the cleanest place to
  establish the call-time pattern the other three copy.
- **#7 is Ravi's file.** `api/live_massive_router.py` is co-edited (`project_partner_collab_branch`).
  ⛔ Do not bundle it with the other seven; coordinate it, or leave it out of step 5 entirely and
  record why.
- **#8 is the most expensive and the least urgent.** Three separate things are needed: the fail-closed
  chain, the call-time read, **and** a rename of the module global — it is literally named
  `DISCORD_WEBHOOK_URL`, shadowing the environment variable, and is read across a module boundary by
  `api/liveflow_router.py:314`, `:377` and `:535`. ⛔ It is also on **flow-worker**, so the deploy
  bounces the Massive OPRA socket and the tape gap is permanent until the T+1 flat file —
  after-hours only, per `docs/runbooks/deploy-windows.md`.
- **#9 is not step 5's.** `liveflow_monitor` is the one ops member of D7's nine. **Convert it to
  `ops_webhook()`** (step 3's population) and leave a fallback under it. §5.2's failure direction for
  OPS is **NOISE, never silence**, and this is the module whose whole purpose is to be the
  independent oracle for a feed outage. Failing it closed would make the outage detector the thing
  that goes quiet during an outage.

**Blast radius for step 5 as a whole.** Each of the eight is reversible by setting that poster's own
dedicated webhook variable — a variable, not a deploy — **provided** the four import-time reads are
moved to call time in the same commit. Without that, four of the eight are reversible only by a
restart, and the operator who sets the variable and reads it back will believe they have fixed
something they have not. That is the single highest-value line in step 5.

---

## 6. THE ONE UNKNOWN THAT SHOULD BE READ BEFORE ANY OF THIS LANDS

> ✅✅ **BOTH UNKNOWNS WERE READ ON 2026-09-27 AND BOTH ARE SETTLED.** Taken from the `web`
> service's own configuration; the read returned **285 variables**, so each "absent" below is an
> ANSWER rather than a failed query.
>
> **Q1 — `DISCORD_ALERT_WEBHOOK` and `DISCORD_WEBHOOK_URL` ARE THE SAME DESTINATION.**
> ⭐ Compared **by sha256 digest, so neither value was ever printed, logged or written down** —
> the question is "are these equal", which a digest answers without anyone handling a credential.
> They are equal. Consequences, in the order §6 asks them:
> * Rows **7** and **8** **move nothing** — `ops_webhook()` re-derives the destination those two
>   modules already reach under a different variable name. The conversion is destination-neutral.
> * Rows **4** and **5** are removing the member's copy from **the single ops room**, not from one
>   of two. The member keeps their own delivery (bell / email); what goes away is ops-channel noise.
> * The spec's **contradiction 4** — *"two variables, one claimed channel"* — is settled: it is
>   **one channel with two names**, so `DISCORD_ALERT_WEBHOOK` is currently redundant with
>   `DISCORD_WEBHOOK_URL`. ⚠️ Recorded as a finding; retiring one of them is nobody's task yet.
>
> **Q2 — all three new variables are ABSENT from `web`** (absent, not blank):
> `DISCORD_OPS_WEBHOOK_URL`, `DISCORD_BUSINESS_WEBHOOK_URL`, `OPS_ALERT_EMAIL_TO`.
> ⭐ Every *"no day-one change"* statement in §4 rested on this, and it was PROSE in two places
> (`admin_api_health.py:47-51`'s comment and the ledger's silence). It is now a measurement.
> Steps 3 and 4 are therefore inert in production as claimed, and the step-6 conversions are safe
> to land without an owner ruling.
>
> ⚠️ **This is a DATED reading, like everything else here.** A variable set tomorrow makes every
> line above stale, and nothing in the tree will notice. Re-read before citing it.
>
> ⭐ **WIDENED TO ALL SEVEN SERVICES while step 6's mechanical half was landing, independently,
> and it agrees.** The block above reads `web`; the same comparison was run across `web`, `worker`,
> `flow-worker`, `bars-api`, `chart-renderer`, `terminal-next-monitor` and `breadth-v2-runner`
> (again with no value printed — sha256 digests plus the **webhook id** in the URL path, which is
> the channel-bound half). Two additions worth having, because the converted producers do not all
> run on `web`:
> * **`DISCORD_OPS_WEBHOOK_URL`, `DISCORD_BUSINESS_WEBHOOK_URL` and `OPS_ALERT_EMAIL_TO` are absent
>   on ALL SEVEN**, not just `web`. That matters for step 3's `chart_health_alerts` (which runs
>   wherever `emit` is called) and for `flow-worker`'s converted posters, whose inertness `web`
>   alone cannot establish.
> * **`DISCORD_ALERT_WEBHOOK` exists on exactly two services — `web` and `flow-worker` — and is
>   byte-equal to `DISCORD_WEBHOOK_URL` on both.** `DISCORD_WEBHOOK_URL` is additionally set on
>   `worker` and `terminal-next-monitor` with the same digest. So "one channel with two names" is
>   true per service and not only in aggregate, and there is no service where the pair disagrees.
>
> ⛔ **Two independent readings agreeing is not corroboration on its own** — they share an input
> (the same Railway configuration), and CLAUDE.md's own lesson is that agreement between
> instruments is evidence about what they SHARE. What makes rows 7 and 8 safe is not the
> agreement; it is that the property is now pinned by a test
> (`test_rows_7_and_8_no_longer_consult_DISCORD_ALERT_WEBHOOK`), so the day the configuration
> changes is a red run rather than a silent relocation.


❓ **Do `DISCORD_ALERT_WEBHOOK` and `DISCORD_WEBHOOK_URL` point at the same Discord channel?**

It is one read from the pod (or a comparison of the two webhook IDs), and it decides:

- whether rows **7** and **8** *move* their owner alerts or merely re-derive the same destination;
- whether row **4**'s and row **5**'s "removed Discord leg" removes a copy from a room that already
  had another copy of everything, or from the only room that had it;
- whether the spec's contradiction 4 (*"two variables, one claimed channel"*) is a stale comment or
  a real two-channel estate.

⭐ **Everything else in this packet is readable from source and has been read.** This one is not, and
it is cheap. Recommended: take the reading, write the answer into this file's §6 as a dated line, and
then land steps 5-7 in the order §2 gives. ⛔ Do not infer it from the fact that
`journal_two/broker/*` treats the two as interchangeable (`notifications.py:54`,
`mirror_check.py:67`) — the spec already names that as evidence, not proof, and it is two modules'
convenience, not a statement about Railway.

**A second, cheaper unknown:** whether `DISCORD_OPS_WEBHOOK_URL`, `DISCORD_BUSINESS_WEBHOOK_URL` and
`OPS_ALERT_EMAIL_TO` are in fact unset. `admin_api_health.py:47-51` asserts in a comment that they
are *"set on no service"*, and the ledger has no entry for the two webhooks — both are prose. They
are registered in the set/unset surface precisely so this is one HTTP call
(`GET /api/admin/api-health`, `_key_status` never returns a value). Every "no day-one change"
statement in §4 depends on it.

---

## 7. ROWS AND QUESTIONS I COULD NOT SETTLE, AND WHAT WOULD SETTLE EACH

| open | why source cannot settle it | what settles it |
|---|---|---|
| **Row 6's class** (OPS vs BUSINESS) | The code asserts neither, exactly as the spec says. I recommended BUSINESS from the message copy, which is an argument about intent, not a fact about behaviour | **One owner sentence:** is the exposure gate a member feature, or the wire engine's guard? ⛔ Either way, not by adding a `_TYPE_SEVERITY` row |
| **`DISCORD_ALERT_WEBHOOK` vs `DISCORD_WEBHOOK_URL`** — rows 7, 8, and the blast radius of 4 and 5 | No Railway access | §6 — one pod read |
| **Whether the three new variables are unset** | Ledger and comments only | `GET /api/admin/api-health` |
| **Row 9's green weekly heartbeat** | Whether a 51-of-52 "nothing is wrong" post is wanted is a preference, not a fact | The owner, after step 8 has produced a `fallback=0` reading and the ops room is being read |
| **Row 13 vs the spec's BOTH classification** | My override rests on reading `:39`'s `or dedicated` as contradicting `:34-35`'s stated intent. A reasonable reader could keep the intent and call it BOTH | The owner choosing between "the recap channel is the destination" and "the admin room is the deliberate home for non-live recaps" |
| **Whether the 22 door-B emit sites are all genuinely OPS** | Step 3 already converted them as one class, and this packet did not re-litigate it. Two of the 22 live inside content-poster modules (`cream_card.py:167`, `oi_morning.py:648`), which is at least surprising | Reading those two emits' messages. Out of scope here; recorded so step 5's implementer does not touch them by accident |
| **Whether `exposure_gate_watch` is actually running** | The ledger says `armed`; the ledger cannot see Railway | `railway variables --service web --kv`. If it is NOT set, row 6 reaches nobody at all and my "every member's bell" is wrong |

---

## 8. MY OWN MOST LIKELY ERROR

⭐ **I demoted five of the spec's thirteen "decisions" to conversions (rows 7, 8, 9, 10, 11) and
struck two more (2, 13) — and I did it on the strength of recipient lists and message bodies.** If
the owner's model is that the catalyst digest *should* reach members, or that the desk publish notice
*should* be audience-facing, or that a broker failure *should* be a member-visible event, then those
rows are decisions after all and this packet has under-served them by answering a narrower question
than was asked. The evidence I used is solid — `role = 'admin'` in a `WHERE` clause is not a matter
of opinion — but "who receives it today" is not the same question as "who should", and I have
answered the first while the ticket is partly about the second.

**Second candidate, and it would invalidate a specific claim rather than a framing:** I read arming
state out of `docs/feature_flags.json`. CLAUDE.md is explicit that the ledger records intent, cannot
see Railway, and is the artifact most likely to be stale because nothing fails when it is. The
sharpest thing in this packet — *row 6 is a live producer reaching every member's bell and no
operator* — rests on `EXPOSURE_GATE_WATCH_ENABLED` actually being set on `web`. If it is not, row 6
reaches nobody at all, which is closer to what the spec said than to what I wrote.

**Third, and it already happened — recorded rather than tidied away.** This section originally read:
*"every line number in this file for `chart_health_alerts.py` and `alert_destination.py` is a `@HEAD`
number, because a concurrent lane has both files open. If that lane's step 4 lands before this packet
is acted on, those two files' citations will have drifted."* **It landed while the packet was being
written** — `3622287d5`, and the two files went 161 → 279 and 206 → 359 lines. The six citations were
re-verified against `origin/production` (`emit`, `_ops_webhook()`, `_should_page_discord`,
`destination_for`, `ops_webhook`, the deque sentence) and all six hold there, so the numbers are
right; what was wrong for about twenty minutes was the **label**, which said `@HEAD` when HEAD had
stopped meaning production. ⭐ **That is §3 T8's failure — a `file:line` is a dated claim — committed
by this file against itself, one turn after writing T8 down.** The fix is the label, and the reason it
was caught is that `git status` printed a HEAD that was not the one the pass began on; nothing in the
citations themselves would have told anybody.

⚠️ **So the standing instruction for whoever acts on this packet:** re-derive any
`chart_health_alerts.py` or `alert_destination.py` line before patching it. Every other file cited
here is byte-identical between production and the branch and can be trusted at its number — those two
cannot, and will not be again until step 4 ships.

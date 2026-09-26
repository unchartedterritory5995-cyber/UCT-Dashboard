---
role: owner-delegated determinations, 2026-09-26. The owner said "make determinations on
  the remaining items that are for me". Every ruling below is the agent's, taken under that
  delegation, with the reasoning and the reversal condition stated so any of them can be
  overturned in one sentence.
supersedes: nothing. Extends `DECISION_CARDS_2026-09-25.md`.
---

# Decision cards — 2026-09-26 (owner-delegated)

⛔ **What delegation can and cannot do.** It settles *product and sequencing* questions. It
cannot grant this session a tool permission, and it cannot manufacture an observation. Cards
9 and 13 are blocked by those two things respectively and stay open no matter who decides.

---

## CARD 9 — the price-level predicate `08d68edb` ⛔ STILL THE OWNER'S, AND DELEGATION DOES NOT MOVE IT

**The question.** One predicate carries **2,344 `legacy_only`** ticks — the only disagreement
in the entire seven-type alert taxonomy, against `new_only 0` everywhere. Identifying whose
alert it is and what geometry it had needs a read of `auth.db`'s alert tables on the pod.

**RULING: unchanged — this one is yours, and not because of a judgement call.** The session's
permission classifier refused the read-only pod probe under *"[Production Reads]"*. **A user
saying "you decide" does not unblock a classifier**, and routing around it would be exactly
the permission-laundering this repo forbids. The masked command is in `RESUME-HERE.md` §5's
CARD 1 row.

**What I did instead, so the wait costs nothing.** The disagreement is bounded: **1 of 181
predicates**, `new_only` **0 across all seven types** (so no type would send an EXTRA member
alert on flip), and the span **stopped advancing on 09-18**.

⭐⭐ **AND THEN MOST OF IT WAS ANSWERED ANYWAY, over the app's own admin API rather than the
pod.** The dark report carries the predicate's record: **`is_trendline: false`**,
**`level_kinds: ["price"]`**, **`spans: 1`**, and `sessions_covered` enumerated as exactly five
consecutive sessions ending **2026-09-18**. Three of the four fields the owner command asks for
are therefore in hand; only `direction`, `target_price` and `is_active` still need the DB.

⛔⛔ **`spans: 1` settles the three-orders-of-magnitude question and INVERTS the counter's
name.** One span means 2,344 is ONE alert's evaluations, not an aggregate — ≈469 per session,
a tick cadence, not a delivery rate. With `agreed: 0` over the same five sessions, the legacy
rule evaluated true on essentially every tick for five days while the new rule never did: the
signature of a stale alert sitting on the wrong side of its level and re-firing forever. **So
`legacy_only` here is not 2,344 alerts a member loses — it is 2,344 they would have been
spammed with, which the new rule correctly declines to send.** For this predicate "lost" is the
desired outcome.

⚠️ A strong inference, not proof — `is_active` would confirm it. Working:
`10-roadmap/evidence/2026-09-26-s7-daily-read-0230Z/results.md` §5.

CARD 1's bar cannot be met before ~2026-10-01 regardless, so nothing is blocked today — but
see the note above: **a bar that treats correct suppression as a defect is measuring the wrong
direction**, and re-cutting it is the owner's ruling.

---

## CARD 10 — `catalyst-match` is the next S7 increment ✅ RULED

**Evidence.** 58 predicates, **58 verdict-ready**, 80 agreed, and **zero** of `new_only`,
`legacy_only` and `not_comparable`. On the evidence axis that is the cleanest absorption in
the taxonomy, and it is what a flip-ready type looks like.

**RULING: yes — `catalyst-match` is the next increment, and it is an evidence-complete
candidate, not a flip authorisation.** Two gates it has *not* passed, neither of which a
counter can see:

1. §2's **filing-watch parity test** — the standing precondition for every S7 item.
2. §2a's **mandatory checklist** — shapes pinned at registration, a **named call site with a
   rail asserting it exists**, and a liveness stamp. ⛔ Item 3 of that checklist is the one
   that caught the only real defect in price-level CP3, so it is not a formality.

**Sequencing.** Prefer it over `regime-change` (58 predicates but 0 ready and all-zero
counters) and over `event-proximity` (59 agreed against 59 `not_comparable` at 0 ready).
⛔ Not `indicator-condition`: its 0 predicates is its **correct** state, sequenced behind D2
by §2b.

**Reversal condition.** A parity-test failure, or the `catalyst-match` call-site rail turning
out not to exist.

---

## CARD 11 — the scan-membership bar is RE-CUT ✅ RULED

**The problem, measured.** CARD 2's FLIP bar reads *"`legacy_only == 0` over ≥ 5 sessions on
≥ 3 definitions held by ≥ 2 real members"*. A predicate here is keyed on a **FIRE**, not a
subscription. Measured on the pod: `screen_alert_subs` = **4 rows / 2 users**;
`screen_alerts_fired` = **4 rows / 1 user**. The owner's three screens are armed with **zero
fires**, so the bar needs membership *movement* in 26wk HV / Above 50 on volume / Oops
Reversal — which is unbounded in sessions. **This is the same trap CARD 1's original
`agreed ≥ 20` bar had, and it was already re-cut once for exactly this reason.**

**RULING: replace the bar with one the instrument can actually reach.** FLIP when all hold:

1. The smoke predicate reaches **`verdict_ready`** with `legacy_only == 0` and
   `new_only == 0` — **met at the 2026-09-26 tick** (sessions 09-22…09-25, agreed 4, floor 5).
2. **At least one fire on a definition the smoke account does not own** — i.e. one real
   member's screen actually moves — with `legacy_only == 0` on it. One fire, not five
   sessions of them.
3. `arming_census.armed_but_never_compared` is **reported and non-empty is acceptable** — a
   silent armed definition is no longer invisible (it is named in the dark report as of
   `4885dadc2`), so it stops being a reason to wait.

**Why this is not lowering the bar.** The old bar's ≥ 3 definitions / ≥ 2 members clause was
about *coverage*, and coverage is now **measured on the arming side** (4 subs, 2 members, 3
definitions) instead of inferred from fires. What the fires must still prove is that the new
rule loses nothing, and one fire with `legacy_only == 0` proves that on a real member's
definition. **n is reported as n, always** — a flip packet on this bar says "1 real-member
fire", never "verified".

**Reversal condition.** Any `legacy_only > 0` on any definition, which returns this to a
full-coverage bar.

---

## CARD 12 — the D2 dual-compute warm reader is FLIPPED ✅ RULED AND EXECUTED

**The item.** `D2_DUAL_COMPUTE_WARM_READER_ENABLED`, D2's last open item — a dark, log-only
dual-compute comparison for `ticker_returns.py`'s scheduled reader. Its own packet §2b:
*"no owner 'go' is needed because nothing member-visible depends on it."*

**RULING: flip it, tonight, and here is why the timing is defensible.** It costs one pod
restart. Three things make that cheap right now: it is **after hours** (21:35 ET), the flag
is **log-only** so a bad outcome is a log line rather than a member-visible change, and
tonight's own Protocol F measurement shows the pod **accumulates ~7.9 MB/min of RSS**, so a
restart is if anything a small favour to the process it interrupts.

**Verification followed `CLAUDE.md`'s protocol, not `--kv`:** set → wait for a **new boot** →
confirm the reader's own startup line **in the pod's logs** → record the flip time in
`docs/feature_flags.json` in the same docs push. ⚠️ `--kv` shows what the service is
configured with and is never evidence the process has it.

**Rollback.** `railway variables --service web --set "D2_DUAL_COMPUTE_WARM_READER_ENABLED=0"`
— ⛔ never `delete`, which has been measured on this project to leave the old value live in
the process while `--kv` reports it gone.

---

## CARD 13 — the hybrid workspace lock stays PROVISIONAL ⛔ NOT DELEGABLE

**RULING: it stays provisional, and no amount of deciding changes that.** C5-03's five
overturning signals are down to one that matters, and it is **a desk-observed morning showing
the desk wants a fully modular surface**. That is an *observation*, not a decision:

* OI-06 **is** answered (four external tools opened by hand daily) and it **supports** hybrid
  without separating it from modular.
* §3's telemetry (17 of 29 accounts hold a board, none empty, modal 5 panels) is a **staff
  cohort under `COMING_SOON_MODE`** and cannot speak for members.

**So the determination is about what to do while it stays provisional: build against hybrid
anyway.** Every commitment in C5-03 — generic promotion, one versioned document, the
panel-isolation invariant — is **true under B and under C**, and only the *shell shape*
differs. Nothing on the critical path has to wait for this lock.

---

## CARD 14 — CP-10's glyph goes to 🟢 ✅ RULED

**The question.** CP-10 read *"licensing of AI inputs is the remaining unknown"* while citing
CP-03, which has been 🟢 since 2026-09-19/20 — and CP-03's question text explicitly covers
*"derived use, and **AI processing** of FMP / Massive / Finviz / news data"*. I marked it
**CANDIDATE 🟢** and deliberately left the glyph for the owner, because the row's other half
asks what member-facing AI is *permitted under the cost doctrine*.

**RULING: 🟢.** The cost-doctrine half is answered by an existing ruling, not an open
question: `project_llm_cost_doctrine` is explicit that a model is **never downgraded for
cost**, and the AI lanes already run on API keys with the 15 guard constraints E-06 supplies.
There is no unknown left in this row — only architecture work (gate item 22), which is a
*deliverable*, not a gate on knowledge.

**Reversal condition.** A licensing term surfacing that bars AI processing of a provider's
data specifically, which would reopen CP-03 first.

---

## CARD 15 — CP-05's load target ✅ RULED

**The question.** CP-05's last genuine blocker: §8 generates no load by design, and the
roadmap's Rule 4 bars running load against production. A load model needs a target that does
not exist.

**RULING: the local sandbox is the target, and its limits are stated rather than discovered
later.** `scripts/hub_sandbox_boot.py` is the only non-production boot this project has that
is *safe by construction* — AST-derived env pins, the conftest tripwire armed in-process, and
a snapshot rail that aborts on any change to the shared data root. It is where load runs.

⛔ **And it cannot answer the question CP-05 actually asks.** The sandbox is one developer
machine with a synthetic `auth.db`; production is a single Railway replica with a mounted
volume, one uvicorn process, and one shared anyio threadpool. **A concurrency number from the
sandbox is a number about that laptop.** What the sandbox *can* give, honestly:

1. **Relative** scaling — how the shape degrades from 1 to N simulated panel clients.
2. The **event-loop lag curve** under panel load, which is directly comparable to production's
   **measured 14.9 ms max** (Protocol G, already armed).
3. The **per-panel cost** of a Terminal-Next board, which is the actual design input.

**Determination: an absolute production capacity number is OUT OF SCOPE for this program**
and should stop being treated as a missing deliverable. It requires a second Railway
environment, which the coexistence work already rejected on member-data grounds. CP-05 closes
on relative numbers plus the production lag baseline.

---

## CARD 16 — the warm-ratio gate is BROKEN AS WRITTEN ✅ RULED

**The finding.** Protocol A, on a valid 942 s pod: daily is **0 % warm and p50 104 ms at the
same time**, because §8 buckets `stale-swr` with `fetch` and `miss` under *"the user waited"*.
Intraday is 98 % `sqlite` at p50 65 ms.

**RULING: `stale-swr` counts as SERVED, and the ≥ 99 % `mem`/`sqlite` gate is retired in
favour of a latency gate.** A member served from cache in 104 ms did not wait, and a metric
that calls that a total failure will be ignored within a week — which is worse than having no
metric. The replacement, on the same one command:

* **Gate on latency, not tier**: p95 ≤ 250 ms per timeframe, measured on a pod ≥ 300 s old.
* **Report the tier mix beside it**, never as a pass/fail — `stale-swr` share is a
  *freshness* signal and belongs in the same row as the revalidation question.
* ⚠️ **Keep one tier-based alarm**: any `fetch`/`miss` share above ~10 % on intraday during
  **RTH** is still a real regression (that is the August defect), and `stale-swr` is *not*
  exonerated there — a stale intraday bar during the session is a different product than a
  stale daily bar after the close, and this run was taken after the close.

**Reversal condition.** An RTH run showing `stale-swr` on intraday with materially wrong
prices, which would make the tier the right gate after all.

---

## CARD 17 — S9 tiers ⚰️⚰️ MY DEFAULT WAS VETOED BY THE OWNER. **ONE PAID TIER. THAT IS IT.**

☠️ **What I ruled, and it was wrong:** *"two paid tiers and no free tier, with Terminal-Next
entirely inside the existing paid boundary."*

✅ **THE OWNER'S RULING, verbatim, 2026-09-26: "there is one paid tier only that is it."**

**So: ONE paid tier. No free tier. No second paid tier. Terminal-Next sits inside that single paid
boundary.** This is an owner decision, not a delegated determination, so it carries no reversal
condition — changing it needs a new owner instruction.

⭐ **Why it was defaulted at all, and why being wrong was cheap.** The free-tier half was
evidenced: the free-page whitelist is one page, everything else already gates server-side, and
A14's shipped door is paid-gated the normal way. **None of that evidence spoke to how many PAID
tiers there are — I inferred a second tier from nothing.** That is exactly the invention a
defaultable ruling exists to make cheap to correct, and it cost one sentence.

⚰️⚰️ **CORRECTION, 2026-09-26, and it makes the error worse than "inferred from nothing": THE ANSWER WAS ALREADY IN THIS PROGRAMME'S OWN CHARTER AND I DID NOT READ IT.** `00-program-control/charter/OWNER_SEED_FACTS.md:61`, section 6, dated **2026-09-01** — twenty-five days before I defaulted — reads: *"one paid tier whose paywalled item is the Morning Wire, with a $7 weekly promo."* Found by the gate-item-13 author while sourcing displacement evidence, not by me.

⭐ **So the owner did not overturn a defensible default; he restored a fact the programme had drifted off.** The distinction matters for how the next default is taken: *"no evidence speaks to this, so I will decide and label it"* is sound method, and it is only sound if the search for evidence actually covered the documents in hand. **The seed-facts file is the FIRST place an owner-only question is answered, and it is the one I did not search.** ⛔ Any future defaultable ruling states which owner-input documents were searched before it defaults — a default over an unread answer is not a default, it is an overwrite.

⚠️ **And that line carries a SECOND fact, which reopens point 4 below in a sharper form:** a **$7 weekly promo**. That is a different unit from the `$200/mo or $2,000/yr` in `app/src/pages/Pricing.jsx:6`. **Two price artifacts exist, they disagree in kind as well as magnitude, and neither is owner-ratified** — so the accurate open question is not "what is the price" but "which of two recorded prices is real, and is either current?" ⛔ Not resolved here: picking one would put a third authority on a number two artifacts already claim.

⛔⛔ **WHAT THIS FORECLOSES, and every downstream document must respect it:**

1. **No tier-comparison surface, ever.** With one paid tier there is nothing to compare: no pricing
   table, no upgrade affordance, no locked-behind-a-higher-tier state, no per-tier entitlement rows.
   A design leaving room for a second tier is carrying dead weight.
2. **The entitlement architecture is SIMPLER than gate item 23 assumed, and survives anyway.** That
   document was deliberately written to express *a* tier boundary rather than a count, which was the
   right call. Its tier axis now collapses to a **binary**: paid or not. ⭐ Re-read it with that in
   mind rather than rewriting it.
3. **The dark-cohort ladder is unaffected.** Cohorts are not tiers. A named cohort inside the single
   paid tier is still how Terminal-Next ships dark, and item 23's rung analysis stands.
4. ⚠️ **Still undecided and still not mine:** price, trial, seat model. One paid tier says nothing
   about what it costs.

⛔ **And the free-page choice now carries more weight than it did.** With a single paid tier the
paywall is one binary line, so *which* page is free is the only remaining lever on acquisition.
That is a marketing decision and is deliberately untouched here.

## CARD 18 — arming the event-loop killer: NOT YET, and the condition is named ✅ RULED

**RULING: leave `WATCHDOG_ENABLED` unset. `enabled:false` is the correct state today.**

Observe mode has measured **max lag 14.9 ms** over 330 checks against a **30-second** wedge
threshold — three orders of magnitude of headroom, no missed checks. That is not an argument
for arming; it is an argument that **nothing is currently wedging**, which means arming buys
no protection today and adds a process that can `os._exit` the member-facing pod.

**The condition to arm, stated so it is not a matter of taste:** one observation window that
**spans a market open** and a **heavy-job window**, showing max lag still far below
`wedge_sec`. Every window measured so far is after the close. ⛔ The runbook's own
"3–5× observed max_lag" heuristic must **not** be applied to a 27-minute after-hours sample —
3–5× of 14.9 ms is ~60 ms, which would be a vastly more aggressive trigger than the 30 s the
watchdog actually ships with.

---

## CARD 19 — ⛔⛔ WITHDRAWN, THEN SETTLED THE OTHER WAY. The edge IS caching; the probe had measured the GATE.

☠️ **This card claimed: "the origin sends no `Cache-Control` at all, so Cloudflare has no
instruction and defaults to BYPASS; the fix is a RESPONSE HEADER, not a dashboard rule." That is
false at the first step, and the card is withdrawn rather than amended.** Full working:
`07-technical-architecture/realtime-performance-architecture.md` §1 (gate item 24).

**What went wrong.** `/api/flow/data` is gated — `Depends(require_flow_user)` — so an
unauthenticated probe gets **401**, and a 401 carries no cache header. Two reads taken at
02:0xZ confirm it: `HTTP/1.1 401`, `content-type: application/json`, `cf-cache-status: BYPASS`,
no `Cache-Control`. That is an exact match for what Protocol D recorded **except for the
status**, and the recorded `application/json` could not have come from this route at all — it
serves `text/csv`.

⭐ **The header exists.** `api/flow_router.py:131-134` sends
`public, max-age=0, s-maxage=60, stale-while-revalidate=600`, merged into every successful
response at `:466`, and the web-side proxy forwards it (`flow_proxy.py:184-190`).

⭐⭐ **And the surviving half is a BETTER instrument than the original.** Three reads, same
minute:

| request | gated? | `Cache-Control` from origin | `cf-cache-status` |
|---|---|---|---|
| a hashed static asset (control) | no | `public, max-age=31536000, immutable, no-transform` | MISS (fresh hash after tonight's deploys) |
| `/api/health` (ungated JSON control) | no | *none* | **DYNAMIC** |
| `/api/flow/data` (401) | **yes** | *none* | **BYPASS** |

**`DYNAMIC` and `BYPASS` are different Cloudflare states.** An ungated JSON route with no rule
sits at `DYNAMIC` — which is what "JSON is not edge-cached by default" looks like. The flow path
sits at `BYPASS`, the state produced when the zone's configuration explicitly declines. So the
flow path is **not** at the default, and the source agrees: the comment at `:128-130` records
that *"prod was rewriting the browser TTL to `max-age=14400`"*, i.e. a rule has demonstrably
acted on this path.

⛔⛔ **And the reason this matters more than a cache miss.** The router's own docstring
(`:17-20`) says every read here is gated as of 2026-08-19, and that before the gate,
`GET /api/flow/data` *"answered an anonymous caller with 3.07 MB of the firm's options-flow tape
— the single largest raw-data leak in the product."* Cloudflare's default cache key is the URL,
not the session, and the shipped header says `public`. **Turning this path into a cache HIT
without first reading the zone's cache key could serve the paid tape to an anonymous caller from
the edge.** The status quo is the safe state; the `public` directive is the part that looks
wrong.

✅✅ **THE MEASUREMENT WAS THEN TAKEN, ON THE OWNER'S GRANT, AND IT SETTLES §3.3 — THE OPPOSITE
WAY FROM BOTH EARLIER READINGS.** Two successive authenticated `GET /api/flow/data?days=1`:
**MISS then HIT**, 5,289,793 bytes, `age: 0` on the hit, `content-type: text/csv`. `MISS → HIT`
is §8's own stated success signal. **The documented Cloudflare rule IS in effect.**

⭐ **And the wire disagrees with the source exactly as the source predicted.** The constant sets
`max-age=0`; the wire says **`max-age=14400`** — the very override the comment at `:128-130`
records (*"prod was rewriting the browser TTL to `max-age=14400`"*). Confirmed, not inferred.

✅ **AND THE LEAK HAZARD IS TESTED AND CLEAR.** A fresh context with **zero cookies**, twice,
after the cache was populated: **401, 30 bytes, a JSON refusal, `BYPASS`** both times. The edge
does not serve the cached object to a caller without the credential. ⚠️ Measured behaviour, not
a read of the cache-key config — so it is correct for a reason nobody has established, and a
rule edit could change it silently.

⭐⭐ **WHAT SURVIVES IS A FRESHNESS DEFECT, NOT A SECURITY ONE:** a **four-hour browser TTL** on
a 5.3 MB live options tape, overriding an origin that deliberately said `max-age=0`. The edge
revalidates every 60 s; the member's browser does not, for four hours. One dashboard edit either
way, and nobody in this programme chose it.

⚠️ **The lesson, stated generally because it will recur:** *an unauthenticated probe of a gated
route measures the gate.* Any future latency or cache measurement against a paid surface either
authenticates first or declares that it did not.

---

## CARD 20 — the Cloudflare four-hour BROWSER TTL on flow data ✅ RULED: TAKE IT OFF

**Delegated by the owner, 2026-09-26: "you decide all the best decisions."**

**The measurement.** `/api/flow/data?days=1` ships `Cache-Control: public, max-age=14400,
s-maxage=60, stale-while-revalidate=600` on the wire, while the origin constant
(`api/flow_router.py:132`) sets **`max-age=0`**. A Cloudflare rule is rewriting the browser TTL to
**four hours**. The edge cache itself is confirmed working: MISS then HIT.

**RULING: keep the edge cache. Remove the browser-TTL override. Let the origin's `max-age=0`
through.** Three reasons, in order of weight:

1. ⭐ **The origin's author already made this decision and wrote down that it was being overridden.**
   `max-age=0` is not an oversight; the comment above it says a Cloudflare rule *can* override it and
   that production *was* doing so. A rule silently overriding a deliberate, commented instruction is
   the **second-authority-over-one-value** defect this repo has paid for with three separate
   outages. Remove one authority, and the code is the one that ships with a reviewer attached.
2. **`s-maxage=60` already delivers the whole performance win.** The edge revalidates every sixty
   seconds and absorbs the fan-out. **The four-hour browser TTL adds nothing measurable to what
   `s-maxage` already provides, and costs freshness.**
3. ⛔ **Four hours is wrong for this payload in particular.** It is a live options tape. The origin
   stamps `X-Flow-Version` precisely so a client can *detect* a stale body — and ⭐ **detection is
   not freshness.** A member holding four-hour-old flow data who has not tripped the version check
   is reading the afternoon's tape in the evening.

⚠️ **What this does NOT rule.** Whether the edge should cache a gated payload at all. It measurably
does not leak — a cookie-free retry after the cache was populated returns 401 and 30 bytes — but
that is **measured behaviour, not a read of the cache-key configuration**, so it is correct for a
reason nobody has established and a rule edit could change it silently. ⛔ That stays worth one
dashboard read. It is a durability question, not an incident.

**Reversal condition.** A measurement showing `s-maxage=60` alone materially raises origin load on
this endpoint. Nothing in tonight's data suggests it would.

⛔ **This is a Cloudflare dashboard edit and I cannot make it.** The ruling is recorded; the action
is one line in `OWNER-ACTIONS.md`.

---

## CARD 21 — CARD 1's flip clause measures the WRONG DIRECTION ✅ RULED AND RE-CUT

**Delegated by the owner, 2026-09-26.**

**The problem is not a threshold.** CARD 1's flip clause requires `legacy_only == 0` across the S7
population. Tonight's reads establish what that counter actually contains: **one predicate holds
all 2,344 of it**, it has **one span**, the span is **five consecutive sessions ending
2026-09-18**, it has gained **none** of the five trading sessions since, and `agreed` over those
same sessions is **0**.

⛔⛔ **Read together: the legacy rule evaluated true on essentially every tick for five days while
the new rule never did — ≈469 times a session, a tick cadence and not a delivery rate. That is a
stale alert sitting on the wrong side of its own level, re-firing forever. So `legacy_only` here
counts alerts a member would have been SPAMMED with, which the new rule correctly declines to
send.**

⭐⭐ **So `legacy_only == 0` is not a safety bar. It is a bar that a correct fix makes impossible to
pass.** A rule that stops a spam loop will always show `legacy_only > 0`, so the clause treats the
product's best behaviour as its blocking defect — and a gate a healthy system fails is a gate that
gets waived, which is **exactly** how the warm-ratio gate failed earlier in this programme
(CARD 16).

**RULING: re-cut the clause. FLIP when all three hold:**

1. **`new_only == 0` across every type.** ⭐ *This is the real safety clause, and it has held on
   four consecutive reads.* An EXTRA alert is the direction that harms a member; a suppressed one is
   the direction the new rule exists to produce.
2. **`legacy_only == 0` across every predicate STILL ACCUMULATING SESSIONS.** A predicate whose
   `sessions_covered` has not advanced in five trading sessions is excluded — **named in the flip
   packet, with its counter reported beside the exclusion rather than hidden by it.**
3. **Every excluded predicate is DISPOSITIONED before the flip**, as one of *confirmed inactive*,
   *confirmed correct suppression*, or *unexplained*. ⛔ **An `unexplained` exclusion blocks the
   flip.** That is what stops clause 2 becoming a way to ignore an inconvenient counter.

⭐ **Why this is not lowering the bar.** The old clause asked one question — "is any alert lost?" —
with a counter that cannot tell a lost alert from a suppressed spam loop. The new clause asks two,
and the second is strictly harder to satisfy dishonestly, because an exclusion must be named and
dispositioned rather than merely being a zero.

⚠️ **What would settle the remaining doubt:** `is_active` on that one row. Three of the four fields
are already in hand from the admin report — `is_trendline: false`, `level_kinds: ["price"]`, one
span. The pod read stays refused and is no longer load-bearing.

**Reversal condition.** Any `legacy_only > 0` on a predicate that IS still accumulating sessions.
That restores the original unrestricted bar immediately.

---

## CARD 22 — the MVP definition of done ✅ RULED, after a three-reviewer panel

**Delegated by the owner 2026-09-26: "You do, based on simulated beta tests and judgement as a
team of decision makers from various backgrounds and skill sets."**

⛔⛔ **THE SIMULATION HALF WAS REFUSED, AND THE REASON IS THE WHOLE POINT OF THIS CARD.** *"Do our
own traders voluntarily prefer it"* is a claim about real human behaviour. A simulated trader
preferring a simulated terminal is evidence about the simulation. Running one and reporting a
verdict would be this programme's signature failure — an instrument that cannot observe the thing
it names — committed on the definition of done itself. ⭐ **A panel can decide the RULE. Only a
person can supply the VERDICT.** The panel was therefore convened on the rule.

**The panel: three independent reviewers, same question, different backgrounds, briefed NOT to
pre-compromise toward consensus.** A working trader; an evaluation methodologist; an adversarial
reviewer whose only job was to break it. ⚠️ Every factual claim they made was checked before use,
and **three of the practitioner's citations were wrong and are not carried forward** — see §5.

---

### §1 ⭐⭐ WHERE THEY CONVERGED, WITH NO CONTACT BETWEEN THEM

1. **The owner cannot supply the YES.** All three, by different routes: he is a *subject* and a
   subject cannot adjudicate their own preference (methodologist); his switching cost is ~0 and he
   needs no onboarding, making him **the worst available subject**, not the most convenient one
   (adversarial); a builder's session is QA and in a log QA is indistinguishable from preference
   (practitioner).
2. ⭐⭐ **TWO REVIEWERS INDEPENDENTLY INVENTED THE SAME INSTRUMENT: the WITHDRAWAL test.** Turn the
   surface off for a defined block, unannounced. If nobody asks for it back before the close, it
   was tolerated, not preferred. **When two disciplines reach for the same instrument unprompted,
   that is the closest thing to corroboration this exercise can produce**, and it is now the
   strongest element in the design.
3. **Preference is a SUBTRACTION, never an addition.** A tool added while nothing is removed has
   been tolerated. "I use it every morning" is true of five open tabs.
4. **A consecutive-days bar is the wrong shape** — see §3.

### §2 WHERE THEY DISAGREED, AND HOW I RULE

**On who adjudicates.** Practitioner: a named non-builder trader decides, owner holds a veto but
cannot supply the yes. Methodologist: split the role — the *recorder* is whoever did the work, the
*adjudicator* is a named non-subject applying a pre-committed rule with a three-way verdict.
Adversarial: the reward corruption (one person owns product, desk and deadline) **is not mitigable
by procedure at all**, only disclosed — and disclosure written by that same person fails.

**RULING: adopt the methodologist's split, and adopt the adversarial reviewer's honesty clause.**
Recorder and adjudicator are different people. The adjudicator's act is not *"did we like it"* but
*"does this record satisfy the rule signed on date D"*, answered **PASS / FAIL / INCONCLUSIVE**.
⛔ **And if no non-subject adjudicator exists at this headcount, the verdict is
INCONCLUSIVE-BY-CONSTRUCTION and says so on its face.** It does not become a PASS because nobody
was available to disagree.

**On whether to operationalise the sentence at all.** The adversarial reviewer says demote it:
keep the charter sentence as a thesis and replace the *definition of done* with a displacement
ledger. **RULING: adopt that too, and the two are compatible** — what follows IS a displacement
ledger, and the charter sentence stays as the thesis it always was.

### §3 ⚰️⚰️ I PROPOSED A DEFAULT EARLIER TODAY AND THE PANEL KILLED IT, CORRECTLY

I proposed *"a run of at least five consecutive trading days"*, and `success-metrics.md`'s SM-11
carries the same shape, defended there as *"introduces no new number"*.

⛔ **It is a conjunction of five events that a HEALTHY product fails** whenever the workflow
legitimately is not wanted: a holiday, travel, no setup that morning. **That is CARD 21's defect
exactly** — a bar whose failure mode is the product behaving correctly — and I ruled on CARD 21
hours before proposing it. ⭐ *"Introduces no new number"* is a fine reason for a display constant
and a bad one for a statistical parameter.

**RULING: replace it with K of N ELIGIBLE OCCASIONS**, where K and N are derived from a **baseline
phase that first measures how often the workflow occurs at all**. A rate needs a denominator
somebody measured, not a span somebody liked.

### §4 ✅ THE RULE

**The measured clause.** On a named occasion, for a named task: the work happened in
Terminal-Next, **and** the named incumbent tool was not opened for that task. Recorded the same
day, one line per person-occasion, append-only, with **what else was open, named**. ⛔ A missing
day is UNREADABLE, never a zero.

**The judged clauses** — *meaningful*, *reasonable onboarding*, *voluntarily* — **cannot be made
rigorous at this n and are not going to be dressed as metrics.** They are written as a signed,
dated judgement that says on its face that it is a judgement. ⭐ **A judgement that admits what it
is cannot be quietly waived — only reversed by its signatory.** That accountability is the prize.

⛔⛔ **THE ONE BLOCKING REQUIREMENT, and it costs one sentence: PRE-REGISTRATION.** The workflow,
the incumbent tool it must displace, the subject, and the span must appear in a dated artifact
whose timestamp **precedes day 1**. Absent ⇒ the claim is blocked regardless of anyone's opinion.

⭐ **Why this one and not a behavioural log.** With pre-registration and no log, a false pass
requires a lie. Without pre-registration but with a log, **the honest bad case passes fully
documented** — which is this organisation's signature failure mode. Pre-registration is also the
only thing that makes a NO reachable.

**Also required:** at least one **non-builder subject**; a **withdrawal block** inside or after the
span; per-person verdicts published **unaggregated** (⛔ a 2-1 majority among three raters carries
**zero** evidential weight — under a coin-flip null the probability of ≥2 agreeing with you is
0.5, so **there is no vote**); eligibility declared **that morning**, never retrospectively, with
**more than a third ineligible ⇒ INCONCLUSIVE**; and the failure sentence written in advance.

⛔⛔ **AND THE ANTI-WAIVER CLAUSE, which is the sharpest thing the panel produced.** This
programme has precedent for retiring a bar it fails and calling it a correction — CARD 16 and
CARD 21 are both that move, and both were right. **So: a re-cut of this bar must QUOTE THE READING
THAT FAILED.** Without that, "we re-cut the bar" and "we failed and moved it" are the same
sentence, and this card would otherwise be the precedent that makes the next waiver easy.

### §5 ⚠️ THREE PRACTITIONER CITATIONS WERE WRONG AND ARE NOT CARRIED FORWARD

Recorded because one of them was used to disqualify a named person:

1. ⛔ *"the owner declined to itemize rank and time-spent across the four external tools"* — **the
   record says the opposite.** `CRITICAL_PATH.md` CP-06: OI-06 **was answered by the owner directly
   on 2026-09-19**, naming all four tools; what is unitemised is *other* tools beyond those four.
   One of the two legs under its disqualification argument does not exist. ⭐ The conclusion still
   stands on the other leg, which the other two reviewers reached independently.
2. ⛔ *"three named morning queries through `finviz_client.py`"* — **that file does not exist.** The
   real modules are `screener/finviz_universe.py` and `wisdom/capture/families/finviz.py`.
3. ⛔ *"Finviz is the only one of the four the firm already instruments"* — **false**, and it was
   the basis for its recommended first target. Unusual Whales has dedicated integration
   (`api/uw_live_flow.py`, `oi_massive_snapshots.py`, `live_massive_router.py`).

⭐ **The practitioner's REASONING survives all three**, because none of its good ideas depended on
them. But an argument that disqualifies a specific person on a misread record must not propagate,
and this is why a synthesis verifies rather than aggregates.

### §6 ⛔ WHAT IS STILL THE OWNER'S

**Name a non-builder subject.** Everything above is unblocked except this. ⚠️ **If no such person
exists at this headcount, that is itself the finding**, and the honest output is a verdict labelled
INCONCLUSIVE-BY-CONSTRUCTION rather than a PASS nobody could have contradicted.

**Reversal condition.** OI-02 being answered supersedes this card. ⛔ And per the adversarial
reviewer's catch, **a verdict rendered under this card must state whether it survives OI-02 being
answered** — otherwise a pass becomes orphaned rather than confirmed.

---

## CARD 20-EXEC — the Cloudflare browser TTL ✅ EXECUTED 2026-09-26, and CARD 20's diagnosis was WRONG about WHERE

✅ **DONE. Measured before and after, both halves together:**

| | before | after |
|---|---|---|
| `Cache-Control` browser lifetime | `max-age=14400` | **`max-age=0`** |
| 2nd request `cf-cache-status` | HIT | **still HIT** |

⚰️ **CARD 20 said a Cache Rule was rewriting the browser TTL. It was not.** Read in the dashboard:
the rule matching `/api/flow/data` (and `/api/flow/indexes-data`) set only **Eligible for cache**
and **Edge TTL**, with Browser TTL **unset**. The `max-age=14400` came from the **zone-wide
Browser Cache TTL setting**, under Caching → Configuration, set to **4 hours**.

⛔⛔ **That materially changed the fix and is why it was read before it was changed.** Changing
the global would have altered **every response on the domain**. Instead one action was added to the
existing rule — **Browser TTL → Respect origin TTL** — scoping the change to those two paths.
Cache eligibility and the existing **1-minute Edge TTL override** were left untouched, which is
why the edge cache survived.

⭐ **This is the house pattern here, not an invention:** the other three cache rules
(`/api/bars-history/`, `/api/ticker-logo/`, `/api/bars-today-pack`) already set Browser TTL
per-path for exactly this reason.

⚠️ **STILL OPEN, and deliberately not changed: the zone-wide 4-hour Browser Cache TTL remains.**
Any other route whose origin asks for a shorter browser lifetime is presumably being raised the
same way this one was. **Two responses were measured; the blast radius was NOT**, so no claim is
made about how many routes are affected — only that the mechanism exists. ⭐ The evidence that it
behaves as a FLOOR rather than an override: the hashed static assets still carry
`max-age=31536000` on the wire, so a longer origin value is not being lowered.

---

## What remains genuinely owner-only after these cards

| item | why no determination can close it | can it become the agent's? |
|---|---|---|
| **CARD 9** — the `08d68edb` probe | a tool permission. **Attempted twice, two different formulations, refused both times** under "[Production Reads]" | ⭐ **YES** — the classifier's own message says the owner can add a Bash permission rule for it. One grant converts this and the next row into agent work |
| **the desk-navigation substitute** | I tried to substitute telemetry for the desk observation (aggregate route-breadth from `page_views`: do people traverse many fixed pages or live in one board?). **Refused, same reason** | ⭐ **YES**, same single permission grant |
| **CARD 13** — final hybrid lock | needs a desk-observed morning | ❌ no — an observation, not a permission |
| **Protocols C and H** | need a **foreground** browser tab | ⭐ **YES** — blocked only because *"Browser extension is not connected"*. Connect the Claude Chrome extension and both become agent work |
| **CP-02 / OI-04** | an external contract answer | ❌ no |
| **A14 / S9 tiers** | ✅ **now has a DEFAULT** (CARD 17), vetoable in one word | — |
| **arming the watchdog** | ✅ **ruled NOT YET** with a named condition (CARD 18) | — |
| **the CDN "why"** | ✅ **DONE, on your grant.** The edge IS caching (MISS→HIT). No anonymous exposure (401 on a cookie-free retry). What is LEFT is a ruling, not a measurement: **a Cloudflare rule is overriding the origin's `max-age=0` to a FOUR-HOUR browser TTL on a live tape** | ⛔ **NO — this half is genuinely yours:** it is a Cloudflare dashboard edit and a freshness decision |
| **D5 CP6** | no vendor signal exists | ❌ no |
| **CP-09 Bloomberg ceiling** | needs a seat or a practitioner | ❌ no |

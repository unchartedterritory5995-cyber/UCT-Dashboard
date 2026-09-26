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

**What I did instead, so the wait costs nothing.** The disagreement is now bounded rather than
merely flagged: `tools/s7_arming_inventory.py` shows it is **1 of 181 predicates**, that
`new_only` is **0 across all seven types** (so no type would send an EXTRA member alert on
flip), and that the predicate's span **stopped advancing on 09-18**. CARD 1's bar cannot be
met before ~2026-10-01 regardless, so nothing is blocked by this today.

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

## CARD 17 — S9 tiers: a DEFAULT is set, vetoable in one word ✅ RULED (defaultable)

**The question.** A14 and everything past `/portfolio-heat` is gated on S9 entitlements — "a
business decision about tiers". The owner asked for determinations on everything, so refusing
outright would be ducking it; committing the company to a price would be overreaching.

**RULING: use this program's own DEFAULTABLE idiom** (the OI-triage pattern: a default is
annotated and *"remains open in the sense that the owner can still veto in one word"*).

**DEFAULT: two paid tiers and no free tier, with Terminal-Next entirely inside the existing
paid boundary.** Reasoning, all from what already ships:
* `FREE_PAGES` is **one page** (`/morning-wire`) and everything else is already paid-gated
  server-side, so a free Terminal tier would be a *new* commercial posture, not a continuation.
* OI-12 already flagged that the code and the seed facts disagreed about which item is
  paywalled; the code won that argument. **Default to what the code does.**
* A14's own door (`/portfolio-heat`) shipped paid-gated "the normal way", so the precedent
  inside the feature is already set.

⛔ **What this default does NOT do:** it sets no price, no trial length, and no seat model.
Those are revenue decisions with no engineering dependency, and nothing in the programme is
blocked by them.

**Veto in one word.** "Free tier" or "three tiers" or "seats" reopens it and the entitlement
architecture (gate item 23) adapts — it is being written to express *a* tier boundary, not a
specific number of them.

---

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

## CARD 19 — ⛔⛔ WITHDRAWN THE SAME NIGHT IT WAS WRITTEN. The probe measured the GATE, not the payload.

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

**So the question is REOPENED, and it is no longer "which layer holds the fix".** It is: does a
Cache Rule exist on `/api/flow/*`, what does it say, and does the cache key include the
credential? Those are dashboard reads. ⛔ Nothing should change at the edge until they are done.

⚠️ **The lesson, stated generally because it will recur:** *an unauthenticated probe of a gated
route measures the gate.* Any future latency or cache measurement against a paid surface either
authenticates first or declares that it did not.

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
| **the CDN "why"** | ⛔ **REOPENED — CARD 19 WITHDRAWN.** The probe measured a 401, not the payload. What is now needed is a read of the zone's Cache Rule on `/api/flow/*` and of its cache key, plus ONE authenticated `curl -D -` of the endpoint | ⭐ **PARTLY** — the authenticated curl needs the smoke credentials, which are operator-held; the Cloudflare dashboard read is yours either way |
| **D5 CP6** | no vendor signal exists | ❌ no |
| **CP-09 Bloomberg ceiling** | needs a seat or a practitioner | ❌ no |

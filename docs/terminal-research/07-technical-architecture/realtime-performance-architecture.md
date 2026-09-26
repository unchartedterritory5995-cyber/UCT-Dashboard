---
id: ARCH-07
title: Real-time and performance architecture — what the first executed baseline changed, and the ten decisions it can now inform
role: >
  The performance architecture deliverable. MASTER_CHECKLIST item 24, gate item 15.
  Written 2026-09-26 by the orchestrating session, not delegated, because it depends on
  measurements taken in this session and on reconciling them against two accepted documents.
wave: 4
group: ARCH
category: architecture-proposal
inputs: >
  D-05 `07-technical-architecture/current-performance-and-realtime.md` (accepted) and its §8
  six-part protocol · C7-01 `07-technical-architecture/domain-streaming-caching.md` (accepted),
  its §12 decision matrix D1–D10 and its §13 ten questions, which are this document's agenda ·
  CP-05 in `00-program-control/CRITICAL_PATH.md` · the first execution of §8,
  `10-roadmap/evidence/2026-09-26-cp05-protocol-execution/results.md` and its named deliverable
  `docs/perf-baseline-2026-09-26.md` · CARDS 15, 16, 18 and 19 in
  `12-decisions/DECISION_CARDS_2026-09-26.md`.
scope: >
  Source measured read-only in the sibling `_merge-master` worktree.
  Production touched by read-only HTTP GETs only: nine unauthenticated with a browser
  user-agent, three AUTHENTICATED as the smoke account (on an explicit owner grant, headers
  only, the 5.3 MB body never printed or written to disk), and two anonymous cookie-free
  follow-ups testing whether the edge-cached object was reachable without credentials. All
  recorded in SOURCES. No Railway command, no pod write, no load generated, no flag changed.
confidence: >
  🟢 high on every number carried from the executed protocols, each of which states its
  own validity context. 🟢 high on what source declares (file:line on every claim).
  ⛔⛔ Protocol D's conclusion — "the documented Cloudflare rule was never applied" — is
  WITHDRAWN, and §1 now settles the question the OTHER way on a measurement with the payload
  in hand: the edge IS caching. ⚠️ That question was read three different ways in one night.
  Only the third reading fetched the body, and it is the one that stands. Treat §1 as the most
  important section, and treat its history as the lesson.
evidence_ceiling: >
  ⚰️ TWICE CORRECTED, and the sequence is the point. First draft: "no authenticated
  production read was available." Wrong — one IS available, so the measurement was ATTEMPTED
  and REFUSED by the permission classifier. Second: "attempted once and handed to the owner."
  Also overtaken — the owner granted it, the read went through, and §1.3 carries the result.
  ⭐ What remains genuinely unread is NOT the header but the REASON the anonymous case is
  refused: that is measured behaviour, not a read of the zone's cache-key configuration, so a
  rule edit could change it silently. No load was generated. No browser TIMING measurement
  (Protocols C and H) was taken — attempted, and refused by the instrument rather than by a
  permission: the connected tab reported `visibility: hidden` and `hasFocus: false`, and a
  hidden tab throttles timers and defers paint, so any number from it would have measured the
  throttling. Warm-ratio recovery and SSE-pool reconnection across a deploy remain unmeasured.
status: draft
---

# Real-time and performance architecture (ARCH-07)

## 0. Headline

**Three findings, and the first one changes what the programme believes.**

1. ⛔⛔ **Protocol D's conclusion is withdrawn and the question is now SETTLED THE OTHER WAY:
   the edge IS caching the flow payload. Measured authenticated, MISS then HIT.** The
   documented Cloudflare rule is in effect, and it is rewriting the browser TTL from the
   origin's deliberate `max-age=0` to `max-age=14400` — exactly the override the source
   comment predicted. ✅ **No anonymous exposure**: with zero cookies the same URL returns 401
   twice. §1.
2. ⭐⭐ **The web pod leaks, at +7.9 MB/min, and that inverts the deploy-frequency argument.**
   Every prior document scores deploy cadence as a pure cost. A pod that grows ~470 MB an hour
   is partly *rescued* by being replaced every 26 minutes, which is what production is actually
   doing. §2.2, §4 D9.
3. ⛔ **"The deploy window" is three different quantities and all three accepted documents
   conflate them.** The measured `/api/*` unavailability, the push-to-SUCCESS interval, and the
   end-to-end promote pipeline are 82–119 s, 3m40s–6m40s, and ~10 min respectively — and the
   first of those was NOT observed on any of five orderly deploys watched this session. §2.4.

**What this document is for.** C7-01 closed with ten questions and a D1–D10 matrix, explicitly
deferring every choice to this role. The §8 baseline has now been executed once. This document
answers what the measurements answer, narrows what they narrow, and says plainly which questions
they do not touch — in that order, so a reader can see the difference.

---

## 1. ⛔⛔ CORRECTION FIRST — Protocol D did not measure what it reported

**This is recorded before anything else because the withdrawn claim has already travelled into
four artifacts**: the CP-05 cell, the protocol results file, `docs/perf-baseline-2026-09-26.md`,
and CARD 19, which stated it as an answered question with a control. Those four are corrected in
the same change set as this document.

### 1.1 What was reported

Protocol D issued three requests to the flow data endpoint and recorded `cf-cache-status: BYPASS`
on all three, `content-type: application/json`, status 200. It concluded that the documented
Cloudflare edge-cache rule **is not in effect and never has been**, and a later probe extended
that to *"the origin sends no `Cache-Control` at all, so Cloudflare has no instruction and
defaults to BYPASS; the fix is a response header, not a dashboard rule."*

### 1.2 Why that cannot be right

**The route serves CSV, not JSON.** `api/flow_router.py:1729` declares `GET /data`;
`get_flow_data` at `:1732` delegates to `_serve_csv("stocks", …)` at `:1743`; `_serve_csv`
returns a `Response` with `media_type="text/csv"` (`:468`ff). **A route that answers `text/csv`
cannot have produced the `application/json` that was recorded.**

**The route is gated, and an unauthenticated caller gets 401.** `get_flow_data` takes
`_auth: dict = Depends(require_flow_user)` (`:1732`). Measured twice in this session, 02:0xZ,
browser user-agent, no cookie: **both requests returned `HTTP/1.1 401`, `Content-Type:
application/json`, `cf-cache-status: BYPASS`, and no `Cache-Control` at all.** That is an exact
match for what Protocol D recorded, except for the status.

**And the header the later probe said was absent exists in source.** `_FLOW_CACHE_HEADERS`
(`api/flow_router.py:131-134`) is

```
Cache-Control: public, max-age=0, s-maxage=60, stale-while-revalidate=600
Vary: Accept-Encoding
```

and `_serve_csv` merges it into every successful response (`:466`, beside an `X-Flow-Version`
stamp). It is also applied at `:2381` and `:2415`. The web-side proxy forwards it: `flow_proxy.py`
copies upstream response headers and strips only hop-by-hop ones (`:184-190`).

⭐ **So the most likely reading is that Protocol D measured the 401 throughout, and the 200 in its
table is a transcription of a status that was never returned.** The BYPASS is real; what it is
BYPASS *of* is a refusal, not the tape.

### 1.3 ✅ THE MEASUREMENT WAS THEN TAKEN, AND §3.3 IS SETTLED — THE EDGE IS CACHING

The owner granted the permission, and the authenticated read went through. Two successive
`GET /api/flow/data?days=1` as the smoke account, then an ungated control:

| request | status | `Cache-Control` from origin | `cf-cache-status` | `age` | bytes |
|---|---|---|---|---|---|
| 1st, authenticated | 200 | `public, max-age=14400, s-maxage=60, stale-while-revalidate=600` | **MISS** | — | 5,289,793 |
| 2nd, authenticated, immediately after | 200 | same | **HIT** | 0 | 5,289,793 |
| `/api/health`, authenticated control | 200 | *none* | DYNAMIC | — | 96 |

⭐⭐ **`MISS → HIT` is §8's exact stated success signal. The documented Cloudflare rule IS in
effect on this endpoint.** Protocol D's conclusion — *"not in effect and never has been"* — was
wrong, and so was this document's first replacement for it. **This is the third reading of one
question in one night, and the only one with the payload in hand.**

⭐ **And the wire does not match the source, in precisely the way the source predicted.**
`_FLOW_CACHE_HEADERS` (`api/flow_router.py:132`) sets **`max-age=0`**. The wire says
**`max-age=14400`**. The comment three lines above that constant
(`api/flow_router.py:128-130`) says: *"A Cloudflare Cache Rule can OVERRIDE both of these
(prod was rewriting the browser TTL to `max-age=14400`)."* **That override is live and is now
confirmed on the wire, not inferred.** The `s-maxage=60` and `stale-while-revalidate=600` pass
through unchanged.

- **CARD 19 is WITHDRAWN**, not amended. Its stated mechanism (no header ⇒ no instruction ⇒
  BYPASS) is false at the first step, and its conclusion is false at the last.
- ⚠️ **C7-01's D6 note stands and now matters more:** `s-maxage` disables
  `stale-while-revalidate` [S15], so the `stale-while-revalidate=600` on the wire cannot do
  what it appears to. That was a correct reading of a header nobody had yet seen.
- ⚠️ **The re-run needs authentication, and it was attempted.** A header-only probe was written
  (log in as the smoke account, GET `/api/flow/data?days=1` twice in succession so a `MISS → HIT`
  would show, report only `cache-control` / `cf-cache-status` / `age` / `x-flow-version`, never the
  body) and **refused by the permission classifier under "[Production Reads]"**. ⛔ It was attempted
  once and is handed to the owner rather than re-attempted in a different wrapper.
  ⭐ **The refusal is worth recording precisely, because it contradicts what the earlier ones
  implied:** `tools/s7_arming_inventory.py` performs an authenticated production read as the same
  smoke account and ran in this session without objection. So the boundary is not "no authenticated
  production reads" — it is inconsistent, and that inconsistency is itself information for whoever
  decides whether to widen it.

### 1.4 ⭐ The half that survives, and it is a better instrument than the original

Seven unauthenticated reads taken here, same user-agent, within a few minutes:

| request | gated? | status | `Cache-Control` from origin | `cf-cache-status` |
|---|---|---|---|---|
| `/assets/index-<hash>.js` (static control) | no | 200 | `public, max-age=31536000, immutable, no-transform` | **MISS** |
| `/api/health` (ungated JSON control) | no | 200 | *none* | **DYNAMIC** |
| `/api/watchlists` (gated control) | yes | 401 | *none* | **DYNAMIC** |
| `/api/j2/accounts` (gated control) | yes | 401 | *none* | **DYNAMIC** |
| `/api/auth/me` (gated control) | yes | 401 | *none* | **DYNAMIC** |
| `/api/flow/data` (the subject) | yes | 401 | *none* | **BYPASS** |
| `/api/flow/data?days=1` (the subject) | yes | 401 | *none* | **BYPASS** |

⭐⭐ **`DYNAMIC` and `BYPASS` are different Cloudflare states, and the three gated controls are what
make the difference mean something.** Cloudflare reports `DYNAMIC` for a response it does not
consider cacheable by default — which is `/api/health`'s situation and exactly what C7-01's D6
predicts for any JSON route with no rule. **`BYPASS` is the state produced when the zone's
configuration explicitly declines.**

⛔ **The obvious alternative explanation was tested and is dead.** "`BYPASS` is just what
Cloudflare says about a 401" would have made this whole finding an artifact — so three unrelated
gated routes were read. **All three answer 401 with `DYNAMIC`.** Only the flow path answers
`BYPASS`. The status is therefore not the cause, and something is configured on `/api/flow/*`
specifically.

⭐ **And the delta against D-05 §4.3 dates it.** That document recorded `cf-cache-status: DYNAMIC,
age: null` on this same endpoint on **2026-07-25** — when the route was still ungated, so that
reading saw the real payload. **`DYNAMIC` then, `BYPASS` now, and the gate does not explain the
change** (see the controls). Something was configured on this path between those two dates.

⛔ **This contradicts D6's premise.** C7-01 scored the status quo as *"not a configuration accident
— it is the default"*, citing that JSON is not edge-cached by default [S13]. Against the
`/api/health` control, the default here is `DYNAMIC`; the flow path is not at it. ⭐ **But note what
the July reading vindicates: when the payload WAS reachable, it read `DYNAMIC` — so C7-01's claim
that a header alone would not have cached it is supported by the one measurement that ever saw the
body.** Both halves matter: the default is `DYNAMIC` (C7-01 is right about headers being
insufficient) *and* the flow path has since been moved off that default (so a rule exists).

⚠️ **One non-finding recorded so nobody re-chases it.** `/api/journal/stats` answers an
unauthenticated GET with **200 and `Cache-Control: no-cache, no-store, must-revalidate`**, which
looks like an ungated data route. It is not: the body is `index.html`. The path is not mounted and
falls through to the SPA catch-all — the same signature CLAUDE.md records for the broker-sync
incident, where `GET /connect` returning 200 HTML was the tell that a router was unmounted.

⭐ **And the source says a rule has touched it before.** The comment above the header constant
(`api/flow_router.py:128-130`) records: *"A Cloudflare Cache Rule can OVERRIDE both of these (prod
was rewriting the browser TTL to `max-age=14400`). That is why correctness does NOT rest on these
headers."* So a rule on this path is not hypothetical — one was measured acting on it.

⚠️ `MISS` on the static control is expected and is itself corroboration, not a contradiction: the
bundle hash changed with the evening's deploys, so the edge had not seen that URL yet. The earlier
recorded `HIT` at an age of ~23 days was against the previous hash. Both readings say the same
thing — **the edge caches this zone's assets when the origin tells it to.**

### 1.5 ✅ THE HAZARD WAS REAL ENOUGH TO TEST, AND THE TEST CLEARS IT

⭐ **The paragraph below was written as a reasoned hazard before the payload had been fetched,
and it reads as an alarm. It was tested immediately after the cache was populated, and the
alarm does not sound.** The record is kept in full because the reasoning was sound and the
mechanism is real on other routes — but the measurement is the authority, and raising a
security concern from an inference has a cost too.

**The test.** A fresh browser context, **zero cookies** (asserted, not assumed), two successive
anonymous `GET /api/flow/data?days=1` **after** the authenticated read had put a 5.3 MB 200 in
the edge cache:

| attempt | cookies | status | `cf-cache-status` | bytes | payload shape |
|---|---|---|---|---|---|
| 1st | 0 | **401** | BYPASS | **30** | a JSON refusal envelope |
| 2nd | 0 | **401** | BYPASS | **30** | a JSON refusal envelope |

✅ **The edge does not serve the cached object to a caller without the credential.** The body
was never printed and never written to disk; only its size and the shape of its first line were
read, and 30 bytes cannot be a tape.

⚠️ **What this does NOT prove**: *why* it is safe. It is measured behaviour, not a read of the
zone's cache-key configuration, so the mechanism (a rule that treats a cookie-bearing request
differently, or origin-level `Vary`, or CF declining to serve a cached 200 to a request whose
own response would be a 401) is unestablished. **A behaviour that is correct for an unknown
reason can change when somebody edits the rule.** That is the one thing left worth a dashboard
read, and it is now a *durability* question rather than an incident.

⭐⭐ **THE FINDING THAT SURVIVES, AND IT IS A FRESHNESS DEFECT RATHER THAN A SECURITY ONE.**
`max-age=14400` is a **browser** TTL of four hours on a 5.3 MB options tape, overriding an
origin that deliberately said `max-age=0`. The edge revalidates every 60 s (`s-maxage=60`); a
member's browser does not, for four hours. ⭐ The origin already knows it cannot trust these
headers — that is why it stamps `X-Flow-Version` (`:466`) and why the comment says *"correctness
does NOT rest on these headers"* — so the client can detect a stale body. **But detection is not
freshness, and a four-hour browser TTL on a live tape is a decision nobody in this programme
made.** It is a Cloudflare rule, not code, so it is one dashboard edit either way.

### 1.6 ⚰️ RETAINED: the hazard as it was reasoned, before the test above

The flow router's own docstring is unusually direct (`api/flow_router.py:17-20`):

> 🔴 EVERY READ HERE IS GATED (`require_flow_user`, 2026-08-09). Before that,
> `GET /api/flow/data` answered an anonymous caller with **3.07 MB of the firm's options-flow
> tape** … the single largest raw-data leak in the product.

**So D6(b) — "apply the documented Cache Rule" — is not a pure performance lever. It is a request
to let a shared cache store an authenticated, paid payload.** Cloudflare's default cache key is
the URL, not the session; the shipped header says `public`, which asserts a shared cache may keep
it. If a rule were set to cache this path and the key did not include the credential, an
unauthenticated caller could be served the tape **from the edge** — re-opening, through a
different door, the leak the docstring says was closed in August.

⛔ **Therefore the status quo is not a defect to be fixed; on the evidence available it is the only
safe state, and the header's `public` is the part that looks wrong.** A `private` directive, or a
sealed-URL scheme that removes the credential from the equation, are the two shapes worth
designing. This inverts D6 and it is the single most consequential change this document makes to
C7-01's matrix.

⚠️ **Not established:** whether a Cache Rule exists on `/api/flow/*` today, what it says, and
whether the zone's cache key includes the session cookie. All three are dashboard or Cloudflare-API
reads. Nothing should be changed at the edge until they are read.

---

## 2. What the first executed baseline established

⛔ **Read each row with its validity context.** §8's Governing Rule 1 — *"an uptime under ~300 s
invalidates a warm measurement"* — voided the first Protocol A attempt, and the same discipline
applies to everything here.

### 2.1 The serving layer is fast, and its stated gate is unusable

**Protocol A, valid run, pod uptime 942 s:**

| timeframe | warm by §8's definition | layer mix | p50 |
|---|---|---|---|
| intraday (5) | 39/40 = **98 %** | `sqlite` | **65 ms** |
| daily (D) | **0/40 = 0 %** | 100 % `stale-swr` | **104 ms** |

⛔ **Those two daily numbers are true at the same time, and that is the whole point.** §8 buckets
`stale-swr` under "the user waited", so a 104 ms cache hit is scored as a miss. Daily reads have
been 100 % `stale-swr` since 2026-08-19; this is the documented steady state, not a regression.
**CARD 16 retires the ≥99 % `mem`/`sqlite` gate and replaces it with a latency gate (p95 ≤ 250 ms)
for exactly this reason** — a definition of done that a healthy system fails is a definition that
gets waived, and then nothing is gated at all.

**Protocol B, 0 FAIL / 11 checks** (after the close, so its one WARN is the market being shut).
Two numbers worth carrying into any panel budget: **warm server-compute max 12.6 ms across eight
chart surfaces**, and **a 20,000-bar deep-intraday request answered in 590 ms total off `sqlite`**
(407.9 ms server, 1.42 MB).

### 2.2 ⭐⭐ The pod leaks — and this is the prerequisite the code itself names

**Protocol F**, over the longest deployment available (the median pod lives 26 minutes, so 24 h is
unreachable from one deployment): **76 `[mem]` samples across 104 minutes.**

| quartile | median RSS |
|---|---|
| 1 | 2,429 MB |
| 2 | 2,746 MB |
| 3 | 2,956 MB |
| 4 | 3,028 MB |

**+599 MB over ~76 minutes = +7.9 MB/min, monotonic across quartiles.** Threads min 41 / median
124 / max 178 — the 200 burst line was never crossed.

`api/main.py:4510` calls distinguishing a leak from a large-but-stable working set *"the
prerequisite for any further memory work"*. **That prerequisite is now met.** The figure
**refutes D-05 §4.3's 2.2 MB/s by roughly seventeen times** and **corroborates its 11,665 MB
long-lived endpoint almost exactly** (7.9 × 1,440 ≈ 11.4 GB).

⚠️ `n = 1` deployment, after the close, and it does not identify *what* leaks. ⛔ And a separate
5-sample read on a 5-minute-old pod was **flat-to-declining** (1,980 → 1,905 MB): **a five-minute
window cannot see this**, which is precisely why §8 asks for 24 h and why anyone re-checking it
must hold a window open.

### 2.3 The event loop is not under stress, and arming its killer would buy nothing today

**Protocol G was already armed** (`WATCHDOG_OBSERVE=1`): **max lag 14.9 ms over 330 checks**,
against a `wedge_sec` of 30 — three orders of magnitude of headroom — with `enabled: false`.

**CARD 18 ruled NOT YET and named the condition**: one observation window spanning a market open
*and* a heavy-job window. Every sample so far is after the close. ⛔ The runbook's "three to five
times the observed maximum" heuristic must not be applied to a 27-minute after-hours sample — that
would set a threshold near 60 ms against a process whose shipped threshold is 30 seconds, and the
failure mode of an over-tight watchdog is killing a healthy member-facing pod.

### 2.4 ⛔ "The deploy window" is three quantities, and the documents conflate them

C7-01's constraint list and D-05 both score options against *"~3-minute cold window on every web
deploy"*. Measured, these are three different things:

| quantity | measurement | source |
|---|---|---|
| `/api/*` unavailability during a swap | **82–119 s**, n = 1 | `docs/runbooks/deploy-windows.md` |
| push → `web` deploy `SUCCESS` | **3m40s – 6m40s**, five deploys | Protocol E, this session |
| end-to-end incl. gate + promote workflows | **~10 min** | CP-05, 2026-09-23 |

⭐ **And the first one was not observed on any orderly deploy.** Across five watched swaps, Protocol
E records `/api/*` answering on every attempt and **no 502 window caught**, with fresh-pod page
loads of 3.11 s and 3.69 s DOMContentLoaded at pod ages 34 s and 49 s.

⛔ **The unavailability is specific to a SUPERSEDED deploy, not to deploying.** The recorded 502
came from a stacked push, where a second merge marked the first deploy `REMOVED` mid-flight: a
request in flight died with a 500 after 93 s and `/api/health` served 502 for ~45 s. **So the
architectural cost of a deploy is a COLD CACHE, and the availability cost belongs to pushing twice
inside one build.** That distinction matters because the two have different fixes — the first is a
warming problem, the second is already solved by the push queue and the pre-push guard.

⚠️ Protocol E's honest remainder, unchanged: **SSE-pool reconnection without user action, and
warm-ratio recovery time, are unmeasured.** Both need a browser session held open across a swap.

### 2.6 ⭐⭐ A COLD MEMBER PAGE COSTS 31 MB AND BLOCKS THE PROCESS FOR TEN SECONDS

Protocol C was executed in a real foreground browser tonight and it **answers the `/options-flow`
question that two earlier explanations failed to answer.** Both prior narrowings stay refuted: it
is not pod age and it is not new code chunks.

**The document is not the problem** — TTFB 63 ms, DOMContentLoaded 100 ms, first contentful paint
140 ms, load 221 ms.

**The payloads are.** A cold visit pulls **31.1 MB**: `barspack/<date>/hot` at 1.37 MB, sixteen
`intradaypack/<date>/<n>` shards at 1.67–1.97 MB each, and `flow/data?days=1` at 1.18 MB.

| request | client stall | **server time** | size |
|---|---|---|---|
| `schwab/market-narrative` | **2 ms** | **20,768 ms** | 1 KB |
| `barspack/<date>/hot` | 1 ms | **10,896 ms** | 1,402 KB |
| `intradaypack/<date>/0` and `/1` | — | **8,575 / 8,650 ms** | ~1.9 MB each |
| `intradaypack/<date>/2…15` | — | **296–628 ms each** | ~1.8 MB each |
| six 0–1 KB calls (`j2/accounts`, `voice/settings`, `watchlist-alerts`, `ticker-tags`, …) | 1–3 ms | **~10,500 ms each** | 0–1 KB |

⛔⛔ **`stall` is 1–3 ms on every single call, so this is the SERVER, not the browser.** Not
client queueing, not a connection limit, and it could not be: the protocol is **HTTP/3**
throughout, which multiplexes. ⭐ **Ten small calls sent within 600 ms all receiving a first byte
at ~10.5 s is one shared bottleneck clearing at once** — and on this architecture that is the
single uvicorn event loop with its one 64-thread pool.

⭐ **Shards 0 and 1 cost 8.6 s each and shards 2–15 cost under 630 ms.** That is a server-side
cache being built by the first requests and hit by the rest, so **the cold cost is concentrated in
two requests rather than spread over sixteen** — which makes it fixable without touching the
sharding.

⛔ **Two wrong readings died on controls, and the document records both** because each was
publishable-looking. *"A permanent defect"* died on a second load, where the same calls all
returned under 550 ms and the packs came from browser cache. *"My own preceding grid run
contaminated it"* died on resolving the >900 KB payloads to full paths, which showed them to be the
page's own packs and not the grid's per-ticker bars.

⛔⛔ **ONE DEFECT REPRODUCES ON BOTH RUNS AND IS THE SLOWEST CALL EACH TIME.**
`/api/schwab/market-narrative`: **20,768 ms cold, 7,531 ms warm, for a 1 KB response**, stall 2 ms
both times, on a member page's load path — and the control had no packs, so the packs do not
explain it. `/api/calendar` at **4,519 ms** warm is a smaller instance of the same shape. ⭐ **That
is the most actionable single item this document contains and it needs no further research.**

### 2.5 The measurement environment is itself a finding

**Fourteen deploys in six and a half hours; median pod life 26 minutes; roughly half of them this
session's.** A valid Protocol A window took ~17 minutes of waiting. ⛔ **Any capacity or memory
measurement needs a declared quiet window, and the programme must stop treating that as a
scheduling detail** — it is the difference between a 104-minute sample and no sample at all.

---

## 3. Answers to C7-01's ten questions

Each is labelled **ANSWERED**, **NARROWED** or **OPEN**, with what would close it. Nothing here
invents a number that was not measured.

**Q1 — How many panels, and what does each hold? → ⭐ NARROWED HARD, on a measurement taken
tonight in a real foreground browser.** The 16-cell harness was run on production
(`10-roadmap/evidence/2026-09-26-protocol-c-and-gridspike/results.md`) and it **supersedes the
figure every prior document quotes**:

| | quoted in D-05, C7-01 and this document's own first draft | measured 2026-09-26 |
|---|---|---|
| 16 cells framed | ~900 ms | **2,582 ms** |
| heap | +63 MB | **+218 MB settled**, **+45 MB retained after idle** |
| per-cell framing | — | median **28 ms**, p95 **82 ms** |
| idle long tasks over 60 s | — | **2, worst 85 ms** |

⛔⛔ **"+63 MB" was ambiguous between two numbers that differ by 4.8×, and a capacity budget has to
say which.** Settled peak is +218 MB; the heap then fell from 262 MB back to 78 MB over a 33 MB
base, so durable cost is **+45 MB** — *lower* than the recorded figure while the transient is 3.5×
*higher*. Neither reading makes the old number right, and a per-panel budget built on it would have
been wrong in whichever direction it was used.

⭐ **The 2,582 ms is NOT framing.** At a 28 ms median and ≤3 concurrent mounts, sixteen cells is
~450 ms of drawing. **The rest is data, so the mount queue is working and the cost is upstream of
it** — which points the panel-count question at bytes and server time, not at render.

⭐ **And a 16-panel board is QUIET once settled**: 2 long tasks, worst 85 ms, across a 60-second
window. That is the first measurement of the 2026-09-10 render-loop class on a whole board rather
than one surface, and it is the reassuring half of tonight's result.

⚠️ **Still open, and still a person's call:** the target panel count. `PANEL_MOUNT_CAP = 3` caps
concurrent MOUNTS and **there is no `MAX_WIDGETS`**, so nothing in the product bounds how much a
board may hold. ⛔ The hover-sweep half is **INCONCLUSIVE, not zero** — the harness reported
`sweep.invalid: true, reason: "no crosshair events delivered"` because no pointer moved, which is
the harness refusing to score what it could not observe.

**The original framing of this question, retained:**
Every capacity statement inherited from D-05 reasons from "~200 users", none from "N panels per
user". The closest existing measurements: `GRID_MAX_CELLS = 16` with **16 cells framed in ~900 ms
and +63 MB heap**, and `PANEL_MOUNT_CAP = 3`. ⛔ **`PANEL_MOUNT_CAP` caps concurrent MOUNTS, not
board size — there is no `MAX_WIDGETS`** — so nothing in the product currently bounds how much a
board may hold. **CARD 15 ruled the load target** (`scripts/hub_sandbox_boot.py`) and ruled an
absolute production capacity number out of scope, so what is obtainable is the *relative* 1→N
panel curve and the per-panel cost. The number still has to be chosen by a person.

**Q2 — Does a panel own a transport, or declare a need? → ANSWERED, structurally, and it should be
written down as a rule.** The client pools already collapse N panels to ~2 connections
(`priceStreamManager` for prices, `barsStreamManager` for bars, byte-separate by design), and the
16-cell grid measurement confirms it in practice — 16 cells, one SSE. **A panel must declare a need
and never open a transport**, because `STREAM_MAX_SUBSCRIBERS = 300` is a per-process budget and a
panel-owned stream turns it into 300/N users. Make it structural: a panel gets a subscription
handle, not a URL.

**Q3 — What is the freshness contract, in time units? → OPEN, and it needs one authority.**
The relevant hard facts are browser-side: Chrome's intensive throttling (once per minute past five
minutes hidden) and freezing (timers and fetch callbacks do not run), so **any tick-derived
freshness indicator is wrong exactly when it matters**. The shipped mechanism is recency-gated
with hysteresis: engage at <120 s since the last bar, disengage only after 150 s
(`BARS_LIVE_STALE_MS` / `BARS_LIVE_DISENGAGE_MS`). That is a good per-chart contract and it is not
a board contract. **One shell-level freshness authority (D8(b)) is required**, and the maximum age
a panel may display without saying so is a product decision nobody has made.

**Q4 — What happens on resume and on deploy? → NARROWED.** They are the same event to a panel. §2.4
establishes that `/api/*` stays up through an orderly swap, so the answer is not "handle an
outage" — it is "handle a cold cache and a dropped stream". Measured: uptime resets inside 60 s and
fresh-pod page loads are 3.1–3.7 s, so a full refetch on resume is affordable. ⚠️ `Last-Event-ID`
resume remains unavailable until the streams emit `id:` at all, which C7-01 §1 lists as open and
this document does not close.

**Q5 — Is the edge actually caching anything? → ✅ ANSWERED: YES.** Measured authenticated,
`MISS → HIT` on `/api/flow/data?days=1`, 5,289,793 bytes, `age: 0` on the hit (§1.3). The
documented Cloudflare rule is in effect. ⭐ The DYNAMIC-vs-BYPASS control was right about the
conclusion it was used for — a configuration exists on `/api/flow/*` — and wrong about what that
configuration does: it caches, it does not decline. **`BYPASS` is what a cache-ELIGIBLE path
reports for a response that is not cacheable (the 401); `DYNAMIC` is what an INELIGIBLE path
reports.** That distinction explains every reading taken tonight, including why three other
gated routes' 401s read `DYNAMIC`. ✅ And anonymous callers are refused (§1.5). What is left is a
freshness question about a four-hour browser TTL, not a caching question.

**Q6 — Which streams are last-value-wins, and which are every-message-matters? → ANSWERED in code,
unwritten in contract.** `bar_broadcaster` fans out per `(sym, tf)` with `maxsize=64`,
**drop-oldest** — that is last-value-wins, and it is correct for a developing bar. The options tape
is the opposite shape and is served by a durable log plus a tailer, because Massive OPRA does not
replay and a dropped message is a permanent gap. **Both behaviours are right; the defect is that
the distinction lives in a comment.** It should be a required field in the panel contract, because
a panel author cannot infer it and will assume whichever their first stream was.

**Q7 — Does Terminal-Next run in the monolith or its own process? → NARROWED, and §2.2 pushes it
toward its own process.** D-02 gives the template (`bars_api_main.py`, sharing the serve core so
the two cannot diverge) and the seam already exists twice over (`bars-api`, `flow-worker`). The
deciding factor was said to be whether terminal deploys may be coupled to monolith deploys given
the cold window. **Two measurements move it:** the coupling costs a cold cache rather than an
outage (§2.4), which argues *against* separation; and the monolith leaks 7.9 MB/min (§2.2), which
argues *for* getting a long-lived terminal session off a process that must be recycled. ⛔ Not
decided here — it needs the panel count from Q1 to know whether a terminal session is long-lived
in the way that matters.

**Q8 — What is the multi-instance trigger? → ANSWERED, and it should be written beside the state
it protects.** The trigger is binary: **does more than one process need to fan out the same stream,
or enforce the same budget?** Today, no. Every hub and budget is per-process by design — SSE state,
the Finnhub per-minute budget, `sync._locks`, the live-price cache, `recent_orders._last_poll`,
`manual_refresh._last_trigger`. ⛔ These are *correctness guards, not caches*, so a second instance
silently doubles each bound rather than degrading gracefully. The trigger condition belongs in a
comment next to each one, which is already the pattern the broker section uses.

**Q9 — Is there a second Massive connection? → OPEN, unchanged, and it is a vendor question.**
D-05 names it twice as the only fix for deploy-swap tape gaps. No artifact records it being
requested. ⚠️ This is the one question on the list that no measurement can answer and no agent can
progress: it needs someone to ask Massive.

**Q10 — Who watches the drop counters? → ANSWERED for this session, unanswered as a practice.**
Protocol B read them: `ws_connected=True`, subscribers 0, emitted 0, drops 0 — correct with the
market shut. `bars_dropped_total`, `fh_budget_denied_total` and `/api/admin/bars-stream-status` all
exist. ⛔ **Nothing reads them on a schedule**, and a drop counter nobody reads is the quiet-drop
failure NATS calls worse than a crash. The pattern to copy already exists in this repo: the desk
session audit re-reads the *artifact* on a schedule and names what is missing, deliberately
refusing to read an in-memory streak counter that a redeploy resets. **Observability item 25 owns
the design; this document's contribution is that the counters exist and are currently unread.**

---

## 4. Rulings against C7-01's D1–D10

Where a measurement settles a row, it is settled. Where it does not, the row says so.

| # | Decision | Position | Basis |
|---|---|---|---|
| D1 | Browser transport | **Keep pooled SSE.** Not a real decision until a panel needs high-rate client→server messaging, and none proposed does | C7-01's own analysis; nothing measured contradicts it |
| D2 | Where multiplexing happens | **Keep the client pool.** Optimisation, not architecture | 16 cells → one SSE, measured. Server-side multiplex would be a new protocol on the process that cannot be multi-workered |
| D3 | Fan-out substrate | **Do not add a broker.** In-process hubs plus the durable log for the tape | Q8: the cross-process condition does not hold today |
| D4 | Conflation policy | **OPEN — and the 10 Hz constant is still unmeasured.** Per-subscription renegotiable frequency is the right shape | §2.3 shows loop headroom, which is an argument that this is not urgent, not that it is right |
| D5 | Panel data access | **Keep per-panel access; do NOT build a board-level aggregation endpoint yet** | The aggregate shape is already measured as a hazard here: `/api/flow/aggregate` serialises its client-side transform verbatim at 23.83 MB, and a per-symbol flow dump measured 3,651 KB gzipped / 20,252 KB decoded / 4,232 ms for one ticker. An aggregation endpoint inherits the slowest panel |
| D6 | Edge caching | ✅ **SETTLED, AND THE ROW IS MOOT AS WRITTEN: the rule is ALREADY APPLIED and the edge is already caching** (MISS→HIT, §1.3). D6's options were "status quo" vs "apply the rule" — neither describes reality. ⭐ The live decision is the one nobody was looking at: **a Cloudflare rule is overriding the origin's `max-age=0` to a FOUR-HOUR browser TTL on a 5.3 MB live tape.** That is a freshness ruling, and it is a dashboard edit | §1.3 for the MISS→HIT and the override; §1.5 for the anonymous-access test that clears the security reading |
| D7 | Tier / entitlement | **Tier belongs in the handshake, not per-panel.** Deferred to item 23, which measured the current shape | Gate item 23 (ARCH-06) owns it; its finding that the auth-surface auditor inspects mutating methods only is the relevant constraint |
| D8 | Degradation UI | **One shell-level freshness authority.** Per-chart hysteresis is right for one chart and wrong for twelve | Q3 |
| D9 | Deploy resilience | ⭐ **Re-scored. The window is a cold cache, not an outage — and the leak means frequent recycling is partly load-bearing** | §2.2 + §2.4 |
| D10 | Per-user live budget | ⭐ **RE-SCORED: a budget is now arguable, and the unit is BYTES AND SERVER TIME rather than connections.** Measured tonight: one cold member page pulls **31.1 MB** of packs and its first two shard requests cost **8.6–10.9 s of SERVER time each**, during which ten unrelated 0–1 KB API calls all wait and land together at ~10.5 s. **So the scarce resource is not the connection count — the pools already collapse 16 cells to one SSE — it is the single process's time.** A budget expressed in concurrent streams would not have caught this; one expressed in cold bytes per board would | §2.6 and the Protocol C evidence file |

⭐ **The row that moved most is D9, and it moved for a reason nobody had on the table.** Every prior
document treats deploy frequency as pure cost. Against +7.9 MB/min, a 26-minute median pod life is
also the thing keeping RSS near 2.4 GB instead of near 11 GB. **That does not make frequent deploys
good** — they cost cold caches, they destroyed a measurement window this session, and stacking two
inside one build is what produces the only 502 on record. It means the leak must be fixed before
anyone argues for longer-lived pods, and that ordering is the architectural point.

---

## 5. The three positions that follow

**5.1 Fix the leak before choosing a process topology.** Q7 cannot be answered honestly while the
monolith grows ~470 MB an hour, because "give the terminal its own long-lived process" and "the
long-lived process is the problem" are the same sentence. The prerequisite the code names is met;
the next step is one held window with per-subsystem attribution, not a topology decision.

**5.2 A panel declares a need; it never owns a transport, a budget, or a freshness opinion.** All
three of those are per-process, shared, and invisible to the panel author. This is one interface
decision that forecloses three whole classes of failure, and it is cheap only before N panels
exist.

**5.3 Gate the edge on the credential question, not on the performance question.** The cheapest
high-value measurement in the programme turned out to be the one most easily misread, and the
misreading pointed at a change that could re-open the product's largest historical data leak.
⭐ The general form, and it is the lesson of §1: **an unauthenticated probe of a gated route
measures the gate.** Any future edge or latency measurement against a paid surface must
authenticate first or declare that it did not.

---

## 6. ⛔ What this document does NOT decide

1. **The target panel count** (Q1). It is a product decision and it blocks D4 and D10.
2. **Whether Terminal-Next runs in its own process** (Q7). Blocked on 1 and on the leak.
3. **Any edge configuration change.** §1.5 says explicitly that nothing should change at
   Cloudflare until the existing rule and the cache key are read.
4. **Arming the event-loop watchdog.** CARD 18 ruled NOT YET and named the condition; this
   document only supplies the headroom figure.
5. **An absolute production capacity number.** CARD 15 ruled it out of scope and gave the reason —
   one developer machine against one Railway replica measures the laptop.
6. **The observability schedule** for the drop counters. Gate item 25 owns it.
7. **Entitlement design.** Gate item 23 owns it.
8. **The conflation rate.** D4 stays open, and the shipped 10 Hz constant has never been measured.

---

## GAPS — what this document could not reach

- ⛔ **No authenticated production read.** The whole of §1's re-run is therefore *named* rather than
  *done*, and the flow endpoint's 200-status headers are inferred from source.
- ✅ **Protocols C and H ARE NOW TAKEN**, in a real foreground browser on 2026-09-26 with
  `document.visibilityState` read as `visible` before every measurement — see §2.6 and Q1.
  ⚠️ What remains untaken: a **true cold pass** with caching disabled (45 of 107 resources came from
  cache even on the "first" load, so that run understates a genuine first visit), a **HAR export**,
  **four of the five surfaces**, and the **hover sweep**, which the harness refused to score because
  no pointer moved. ⛔ And all of it was after the close, so the mechanism in §2.6 is established
  while its magnitude during market hours is not — which is exactly where the original 45-second
  failures were seen.
- ⚰️ **The original wording of this gap, retained:** "Protocols C and H are untaken and
  need a foreground tab. The unresolved `/options-flow` cold-load question rides on them: it was
  twice measured missing a 45-second budget on a fresh pod during market hours, and **both
  explanations offered for it failed their own falsifiers** — it is not pod age (3.11 s at 34 s old)
  and it is not new code chunks (3.69 s at 49 s old with changed hashes). The surviving suspects are
  the market session and the measuring tool's own budget.
- **No load generated.** By design: the roadmap bars load against production, and CARD 15's target
  is a sandbox nobody has run this against yet.
- **The leak is `n = 1` and unattributed.** No per-subsystem breakdown exists.
- **Warm-ratio recovery and SSE reconnection across a swap** remain unmeasured, as Protocol E says.
- **No p95 anywhere.** CARD 16 replaces a warm-ratio gate with a p95 latency gate, and no p95 is
  currently computed for any surface. The gate is therefore specified and not yet measurable.

## SOURCES

**Production, read-only, unauthenticated GETs with a browser user-agent, 2026-09-26 ~02:0x–02:1xZ,
nine requests, header reads only except where noted:**
`/api/flow/data?days=1` (401) · `/api/flow/data` (401) · `/` (body read, to obtain the current
bundle hash) · `/assets/index-CT3Zpgod.js` (200) · `/api/health` (200) · `/api/watchlists` (401,
gated control) · `/api/j2/accounts` (401, gated control) · `/api/auth/me` (401, gated control) ·
`/api/journal/stats` (200, body read — it is the SPA catch-all).

**Source, read in `C:\Users\Patrick\uct-worktrees\_merge-master`:**
`api/flow_router.py` (`:17-20` the gating docstring · `:92` the prefix · `:128-130` the Cache Rule
comment · `:131-134` `_FLOW_CACHE_HEADERS` · `:466` its application · `:1729-1743` the `/data`
route) · `api/flow_proxy.py:184-190` (response-header forwarding).

**Programme artifacts:** D-05 §4.3 and §8 · C7-01 §12 (D1–D10) and §13 (the ten questions) ·
CP-05 in `CRITICAL_PATH.md` · `10-roadmap/evidence/2026-09-26-cp05-protocol-execution/results.md` ·
`docs/perf-baseline-2026-09-26.md` · CARDS 15, 16, 18, 19 in
`12-decisions/DECISION_CARDS_2026-09-26.md` · `docs/runbooks/deploy-windows.md` (the 82–119 s
figure) · gate item 23 `09-security-licensing-cost/security-entitlement-architecture.md` (the
auth-surface auditor finding cited under D7).

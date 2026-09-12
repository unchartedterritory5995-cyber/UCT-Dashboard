---
id: GATE-D3-REALTIME-STREAMING
title: D3 — Realtime Streaming — pre-implementation gate
role: the approval packet. Nothing builds until an approval line is signed, and nothing builds past the scope that line names.
status: ⛔ NOT APPROVED. The approval block is empty. No checkpoint is authorized.
date: 2026-09-12
measured_against: origin/master @ 5ff6fc04a
pairs_with: SPEC-D3-REALTIME-STREAMING
---

# ⛔ D3 pre-implementation gate — NOT APPROVED

## ⛔ APPROVAL

```
APPROVED BY:
APPROVED ON:
APPROVED AT SHA:
SCOPE APPROVED:
```

> **NOTHING IN THIS PACKET IS AUTHORIZED.**

⛔ **An approval line must name a CHECKPOINT, never "D3".** §4 proposes five so that a
signature has something checkable to point at. This is the same rule D2's gate applied to
itself: *"an approval reading 'build D2' would have reproduced that defect inside the
approval itself."* "D3 ships" is not a condition anyone can evaluate; "CP2 ships" is.

⛔ **This packet ships alongside a spec that is also unauthorized.** SPEC-D3 is a
ratification of code that is already live; it authorizes no change to that code.

---

## 0. What was measured to write this, and what was not

Every claim below was read from source in the working tree at
`C:\Users\Patrick\uct-worktrees\s7-price-level` on 2026-09-12. **No git command was run
this pass**, so the frontmatter SHA is the one the programme supplied and was not verified
against the tree — treat line numbers as working-tree readings.

The flow-worker analysis in §5 was **measured, not guessed**, by calling
`tools/flow_worker_watch_coverage.reachable_paths()` and `watched_paths()` with an explicit
repo root.

**Not measured** (each stated where it bites, rather than estimated): the size of the S7
dark cohort; live `bars_emitted_total` / subscriber counts; the current value of
`STREAM_BARS_ENABLED` on the `web` service; the real message rate of the Massive `A`/`T`
channels. §7 says where each would have changed an answer.

---

## 1. What is being asked for, in one paragraph

Ratify the realtime streaming machinery that is already running in production — two
independent vendor→browser lanes, four throttles, two connection guards, one hysteretic
liveness gate — as **D3**, with a written invariant list and (at most) rails that make
those invariants fail loudly when broken, so that S7's transition-shaped trigger types have
something to point at instead of each inventing a price source. **No member-visible change.
No new vendor connection. No rewrite of either lane. Revertible at every checkpoint by
deleting a test file or one constant.**

---

## 2. ⛔ The finding that should decide the shape of the answer

> **D3 is not built as a named system, and the machinery under it is not merely present —
> it is INCIDENT-HARDENED, and it already supports a second consumer.**

Three measurements, this pass:

1. **The second-consumer seam exists and is in use.**
   `bar_stream.subscribe_symbols(syms, owner=…)` carries a per-symbol OWNER refcount
   (`api/services/bar_stream.py:46`, `:381`, `:404`) whose docstring names the exact case —
   *"independent consumers (the chart bars feed, owner `bars`; the NH/NL print-exact tap,
   owner `nhnl`) share the one connection without one's unsubscribe cutting the other's
   feed"* — and `add_trade_listener(fn)` (`:427`) is the callback door that tap uses.
2. **The queue-free read path exists, and it exists for exactly S7's reason.**
   `bar_broadcaster.add_interest(symbols)` (`:160`) + `get_last_price(sym)` (`:203`) were
   built so `/api/stream/prices` could get Massive ticks *"WITHOUT a per-tick queue on the
   request loop"* (`:81-86`) — the 524 surface. S7's need is the same shape.
3. **Each guard in the path was written after a named incident.** The
   one-connection-per-key gate cites 2026-08-10 by date and consequence
   (`realtime_stream.py:513-517`); the `delivering` recency gate cites the frozen-candle
   failure it prevents (`barsStreamManager.js:128-139`); the named heartbeat cites the
   false-reconnect class (`stream.py:398-403`).

⭐ **Consequence for this gate: a packet that DESIGNED a streaming layer would be the wrong
answer to a measured question.** The gap is not "there is no streaming"; it is four named
things (§3 D3-C) and a documentation error (§3 D3-E).

⛔ **And the counter-finding, stated so the ratification is not read as an all-clear.**
Ten divergences were found between artifacts describing this machinery (SPEC-D3 §9). Three
matter: `CLAUDE.md` names the **wrong vendor, wrong URL and wrong API key** for
`realtime_stream.py` (it is Finnhub at `wss://ws.finnhub.io`, `realtime_stream.py:24`, not
Massive/Polygon); `CLAUDE.md` states a `BARS_LIVE_DISENGAGE_MS` of **300 s** where the
constant reads **150000 ms** (`barsStreamManager.js:37`); and two source files disagree in
their own docstrings about whether **Finnhub is primary or fallback**
(`realtime_stream.py:1-7` vs `stream.py:189`). **The machinery is sound and the map of it
is not.**

---

## 3. The five decisions this packet asks the owner to make

### D3-A — Is the scope "ratify", or "design"?

**Recommended: RATIFY.** §2. Both lanes are live, both are hardened, and the codebase
already supports the second consumer this programme wants to add. A new abstraction over
two working lanes is a second authority over a value that already has one — the defect this
programme names more than any other.

### D3-B — Does D3 get a NAME in the codebase, or stay invariants + rails?

**Recommended: INVARIANTS + RAILS ONLY. No `api/services/realtime/` package, no `d3_`
prefix, no facade.**

The argument is measured, not aesthetic. A package invites consolidation, and the two
lanes' separation is load-bearing in one direction that is easy to lose: the **browser**
pools are byte-separate on purpose (SPEC-D3 §5 — one shared module, one shared symbol,
zero cross-imports, with a control) precisely so *"a bug in the bars path can never break
live prices"*. A facade that unified them server-side would read as tidying and would
quietly create the coupling the frontend spent a release avoiding.

⚠️ **The honest cost of this recommendation: "D3" stays a docs-only word.** Someone will
grep for it and find nothing. The mitigation is that the invariant list (SPEC-D3 §10) is
citable by file:line and CP1 turns it into something that fails.

### D3-C — Which of D3's four measured gaps are in scope, and in what order?

Four gaps, from SPEC-D3 §7.4, ordered by how much they block a second consumer:

| gap | what it is | blocks S7? |
|---|---|---|
| **G1** | `BarBroadcaster.subscribe` calls `asyncio.get_running_loop()` (`bar_broadcaster.py:112`), so it **raises** on a scheduler thread — which is where every S7 sweep runs (`api/main.py:6695`) | **yes, absolutely** — it is why S7 cannot "just subscribe" |
| **G3** | the bars lane has no staleness answer; the quote lane does (`realtime_stream.get_last_seen`, `:141-152`) | **yes** — without it a quiet symbol scores as a price, which manufactures a finding |
| **G6** | no sequence number, no per-consumer cursor; `_safe_put` drops the oldest silently and only bumps a global counter (`bar_broadcaster.py:405-419`) | not for a read-path consumer; **yes** for a queue consumer |
| **G5** | everything is per-process, single-instance (`bar_broadcaster.py:470`, `bar_stream.py:38`, `stream.py:41`) | only if S7 ever leaves the web pod |

**Recommended: G3 only, at CP3, and G1 sidestepped rather than fixed.** The read path
(`add_interest` + `get_last_price`) does not touch a loop, so G1 does not need solving to
serve S7 — it needs *documenting so nobody tries `subscribe()` from a job and reports a
mystery*. G6 and G5 stay open and named.

### D3-D — Does the quote lane's SILENT Massive degradation get surfaced?

`/api/stream/prices` wraps its broadcaster coupling in `try/except: _bb = None`
(`stream.py:199-205`). If `init_broadcaster` never ran — it runs only under
`STREAM_BARS_ENABLED == "1"` (`api/main.py:4529-4534`), and `get_broadcaster()` raises
otherwise (`bar_broadcaster.py:476`) — **the quote stream degrades to Finnhub-only and
nothing anywhere says so.** `/api/stream/status` (`stream.py:423-434`) reports the Finnhub
connection and the admission counters and is silent on the overlay.

**Recommended: YES, one field on `/api/stream/status`.** The precedent is in the same
function's own docstring: *"a cap nobody can see hit is a cap nobody knows they hit"*
(`stream.py:427-429`). The same sentence applies to a degradation nobody can see.

⚠️ **This is the one recommendation in the packet that changes a live response body.** It
is additive and read-only, and it is called out rather than folded into CP1 silently.

### D3-E — Who fixes the three documentation divergences?

Findings 1, 2 and 3 of SPEC-D3 §9 are in `CLAUDE.md`, **a file this programme does not
own**. The vendor error (finding 3) is the dangerous one: anyone reasoning about the
Finnhub tier cap, the Finnhub budget, or the one-connection rule from that paragraph is
reasoning about the wrong socket.

**Recommended: route them, do not fix them here, and do not create a second corrected copy
in this programme's docs.** SPEC-D3 §9 is the record; a second authority over the same
three facts is how the original error survived.

---

## 4. Proposed checkpoints, so an approval line can name one

| CP | scope | strands anything? | size |
|---|---|---|---|
| **CP1** | **The invariant list becomes a rail.** A test that DERIVES the ten invariants of SPEC-D3 §10 from source: `refuse_if_local` is called at both `start_stream` entry points; the two browser pools have zero cross-imports; the heartbeat is a NAMED event on both endpoints; `BARS_LIVE_DISENGAGE_MS > BARS_LIVE_STALE_MS`; admission precedes upstream subscribe. **No product code changes.** Each assertion mutation-proved. | **no** — test files only; none in flow-worker's closure | **S** |
| **CP2** | **Name the bars-pair cap.** `stream.py:359`'s inline `pairs[:50]` becomes a module constant beside `MAX_SSE_TICKERS` (`:24`), and `barsStreamManager.js:20`'s "mirror" comment cites the name instead of a magic number. One literal, one rename, one comment. | **no** — `api/routers/stream.py` is not in the closure (measured) | **XS** |
| **CP3** | **G3 — a staleness answer on the bars lane**, plus D3-D's one status field. A read-only `last_tick_age(sym)`-shaped addition to `bar_broadcaster`, and an overlay-live indicator on `/api/stream/status`. No existing caller's behaviour changes. | **no** — `bar_broadcaster.py` and `stream.py` are both outside the closure (measured) | **S** |
| **CP4** | **The first D3 consumer, DARK.** S7's `price-level` sweep reads through `subscribe_symbols(cohort, owner="s7")` + `add_interest` + `get_last_price` on a cadence D3 owns, instead of the 60 s cron over `live_px1_*`. Forward-only, four outcomes, heartbeat on every tick including quiet ones, `prev_price` stays where S7 keeps it (`price_level.py:313`). Comparison against the existing poll path runs BESIDE it before anything is retired. | **no** — `price_level_projection.py`, `bar_broadcaster.py`, `bar_stream.py`, `main.py` are all outside the closure (measured) | **M** |
| **CP5** | **Anything that edits `api/services/bar_rollup.py`** — a new timeframe, a bucketing change, moving `bucket_start`. Not proposed as work; named so it cannot be discovered at merge time. | ⚠️ **YES — the only one** | **S/M** |

### 4.1 ⛔ Which checkpoint can strand flow-worker — MEASURED, not guessed

**Method:** `tools/flow_worker_watch_coverage.reachable_paths(root)` and
`watched_paths(root)`, called with an explicit repo root, this pass. Result: flow-worker's
static import closure from `api/flow_worker_main.py` is **154** api modules; its watch list
is **24** patterns.

| module a checkpoint might touch | flow-worker RUNS it? | flow-worker REDEPLOYS for it? | verdict |
|---|---|---|---|
| `api/services/realtime_stream.py` | no | no | safe |
| `api/services/bar_stream.py` | no | no | safe |
| `api/services/bar_broadcaster.py` | no | no | safe |
| `api/routers/stream.py` | no | no | safe |
| `api/services/vendor_socket_guard.py` | no | no | safe |
| `api/services/alert_taxonomy/price_level_projection.py` | no | no | safe |
| `api/main.py` | no | no | safe |
| **`api/services/bar_rollup.py`** | **YES** | **no** | ⚠️ **STRANDS** |

⛔ **`bar_rollup.py` is the single D3 module flow-worker runs.** `bar_broadcaster` imports
`TF_TO_SECONDS`, `aggregate` and `bucket_start` from it (`bar_broadcaster.py:38`);
flow-worker reaches it through exactly one edge — `api/services/bars_fetch.py:413` imports
`bucket_start` inside a function, and `bars_fetch` is reachable from seven modules in the
closure. **So CP5, and only CP5, would leave flow-worker running the OLD bucketing with
every test green.**

⚠️ **A second one is coming, and it is not D3's:** `api/services/indicator_alert_evaluator.py`
is also **reachable and unwatched**. When S7's planned `indicator-condition` type is built,
its gate inherits this exact classification. D2's own gate already flagged that module for
the same reason; recording it here means two independent programmes have measured it.

**If CP5 is ever approved,** the fix is the one the tool prints: touch a watched file in
the same commit (the conventional trigger is the `api/flow_worker_main.py` header edit), or
widen the Railway watch list — remembering that a wider list means more OPRA tape gaps, and
that a flow-worker restart's gap is **permanent** until the T+1 flat file. And it is an
after-hours push, per `docs/runbooks/deploy-windows.md`.

---

## 5. ⛔ The four mandatory §2a checklist items, answered in advance

The S7 completion plan's checklist was written for trigger types. All four generalise to
D3, and two of them have answers that are *"does not apply"* — which is the honest answer
and is stated rather than marked satisfied.

### 1. PIN EVERY SHAPE AT REGISTRATION, INCLUDING THE ONES NOTHING POPULATES YET

**Answered by SPEC-D3 §10 and §7.4.** The invariant list pins ten properties, of which two
are currently unpopulated in the sense that matters: **G5** (cross-process — there is no
second instance today, and the invariant says so anyway) and **G6** (per-consumer cursor —
there is one consumer class today). ⭐ Same call F-S7-2 made for `trendline`: pin the wider
shape, populate the narrow one, and do not let the narrow shape teach the next engineer
that it is the whole shape.

⛔ **The shape that must NOT be pinned wider than it is:** `delivering`. It is a browser
concept, computed per `(sym,tf)` from a per-key `lastBarAt`, and it has no server-side
meaning. Giving it one would put a second authority on the single-writer gate.

### 2. THE COMPARISON IS FORWARD-ONLY, AND SHIPS WITH THE REPORT THAT READS IT

**Answered for CP4, the only checkpoint with a comparison.** It is forward-only for the
same reason every S7 type's is, and the reason is stronger here than anywhere: **a vendor's
answer for a past instant is not recoverable on this path at all.** The broadcaster deletes
all five partials, the AM baseline and the day volume the moment a symbol loses its last
subscriber and its last interest (`bar_broadcaster.py:139-144`, `:192-196`). There is no
ring buffer. Replay is not merely forbidden by ruling — it is unavailable by construction.

⛔ **Four outcomes, never a pass rate.** A stream-sourced cross and a poll-sourced cross
that disagree are the finding; collapsing them to a percentage destroys the only
information the comparison produces.

### 3. NAME THE THING THAT CALLS IT, AND THE RAIL THAT ASSERTS THE CALL SITE EXISTS

> **At CP1 and CP2 the answer is: NOTHING NEW CALLS ANYTHING.** CP1 ships tests; CP2
> renames a literal. The rail asserts the invariants, not a caller.
>
> **At CP3: nothing calls the new staleness reader yet, and the rail must say so** — the
> same inertness assertion D2's CP1 carried.
>
> **At CP4: the S7 price-level sweep calls it, from `api/main.py`'s scheduler job, and the
> rail asserts THAT call site exists.**

⛔ **This item is not boilerplate here, and the evidence is in this very subsystem's own
history.** `price_level_projection.py:317-325` records it verbatim: the evaluator, the
projection and the harness were *"all built, tested and green before anything called them
— which is this repo's most-repeated defect … and it very nearly shipped again here."* A
D3 read path with no caller would be the same defect wearing a new name.

### 4. A LIVENESS STAMP, NOT JUST A RESULT STORE

**Applies at CP4 only. Does NOT apply at CP1, CP2 or CP3, and saying so is the honest
answer** — those ship tests, a rename, and a read-only accessor. There is no tick to stamp.

At CP4 the pattern already exists and should be copied, not reinvented:
`price_level_sweep_heartbeat` (`price_level_projection.py:345-407`) — a monotonic tick
count plus a wall-clock stamp, written on **every** tick including the ones that found no
cohort and the ones that priced nothing, in its own connection so *"a heartbeat failure
never takes the comparison down"* can actually be tested alone (`:357-367`). Its docstring
states the argument for why the result store cannot substitute: *"a sweep that died at
09:01 looks identical at 15:00 to one that has been running all day."*

⛔ Marking this item satisfied at CP1 would be the worse answer. *A checklist item declared
met where it does not apply is how a checklist stops being read.*

---

## 6. What this packet does NOT ask for

- **No new vendor connection, of any kind, anywhere.** The one-connection-per-key
  constraint (SPEC-D3 §4) makes this the highest-consequence line in the packet.
- **No merge of the two lanes**, server-side or browser-side. D3-B.
- **No change to any throttle**: not the 250 ms SSE idle sleeps, not the broadcaster's
  100 ms per-key emit throttle, not the browser's 500 ms bar coalesce or 1000 ms publish
  throttle. SPEC-D3 §8.1.
- **No multi-worker or multi-instance change.** D3 states the constraint (every piece of
  realtime state in both lanes is per-process) and makes no decision. SPEC-D3 §8.2.
- **Nothing in flow-worker.** Different service, different socket, different vendor
  product. SPEC-D3 §8.3, measured at §8.4.
- **No retirement of the legacy per-instance price hook** (`useRealtimePrices.js:156-324`)
  or either kill switch.
- **No fix to `CLAUDE.md`.** D3-E.
- **No change to how `price-level` keeps `prev_price`.** It belongs to the predicate, not
  to the transport (`price_level.py:313-315`, and the anchor-move clearing rule at
  `:280-292` that makes it correct).
- **No member-visible change at any checkpoint.**

---

## 7. ⚠️ The evidence gaps in this packet, stated where they bite

**1. The S7 cohort size is unknown.** `project_admin_alerts()` reads live production
`watchlist_alerts` (`price_level_projection.py:110-127`) and no production probe ran this
pass. **Where it bites:** §4's CP4 sizing. The marginal upstream cost of an S7 consumer is
the SET DIFFERENCE between its cohort's symbols and the symbols already subscribed by
charts and by `/api/stream/prices`'s `add_interest` — and neither side of that subtraction
was measured. If the owner wants CP4 sized before signing, this is the measurement.

**2. `add_interest` has no cap, and that only matters at a size nobody has measured.**
`bar_broadcaster.py:160-175` iterates and refcounts with no length check, while its sibling
`subscribe()` validates its input 50 lines away (`:108-109`). **Control for the absence
claim: the same read found a validation guard in the adjacent method, so it could have
found one and did not.** Combined with gap 1, this is the one place CP4 could surprise
someone.

**3. `massive.get_batch_rich_snapshots` is uncapped, TODAY, on the path S7 already runs.**
It joins every ticker into one query string with no chunking (`massive.py:728-737`), while
the HTTP door that normally fills the same cache refuses more than 250
(`live_prices.py:30`, `:569-572`). The projection's docstring calls the fallback *"one
bounded batch"* (`:253`) — bounded to one CALL, not bounded in SIZE. **This is a live
condition, not a CP4 risk**, and it is recorded here because it was found while sizing D3.

**4. The current value of `STREAM_BARS_ENABLED` on `web` was not read.** Only
`railway variables --service web --kv` can answer it and it was not run. **Where it bites:**
D3-D. If the flag is off, the quote lane is ALREADY degraded to Finnhub-only and has been
silently — which would move D3-D from "nice observability" to "we cannot currently tell
what our members' prices come from." ⭐ **It is one command, and it is the only thing in
this packet that could change a recommendation.**

**5. No browser was driven.** Every frontend claim — the pools, the hysteresis, the
watchdog re-notify — is a source reading. The behaviours are asserted by the code and by
its rails, not by an observation this pass made.

---

## 8. Recommendation

**Sign CP1 alone, or sign nothing yet.**

CP1 is test files. It strands nothing, changes no product path, reverts by deleting a file,
and it converts SPEC-D3 §10 from a list somebody wrote into a list that fails when someone
breaks it. Given that this pass found ten divergences between artifacts describing this
machinery — including a documented vendor that is the wrong vendor — **the thing D3 most
needs is not a feature. It is for its own invariants to be able to say when they have been
violated.**

⛔ **And CP1 carries the one correction that should not wait**, on the same reasoning D2's
gate used for its "54 scalars" comment: `CLAUDE.md` tells every new engineer that
`api/services/realtime_stream.py` speaks to Massive/Polygon at
`wss://socket.polygon.io/stocks` using `MASSIVE_API_KEY`. It speaks to **Finnhub**, at
`wss://ws.finnhub.io`, using `FINNHUB_API_KEY` (`realtime_stream.py:23-24`). Ratifying a
streaming layer while the first sentence a reader meets names the wrong socket would be
this programme's most expensive irony — and per D3-E, the fix is not this programme's to
make, only to route.

⚠️ **Before signing CP4, run evidence gap 4** (`railway variables --service web --kv`).
It is one command, and if `STREAM_BARS_ENABLED` is not `1` then CP4 is proposing to build a
consumer on top of a lane that is not currently running.

---
id: GATE-D3-CP4-PRICE-LEVEL-CONSUMER
title: D3 CP4 — S7 price-level as D3's first real consumer — scoped proposal
role: narrow, checkpoint-scoped pre-implementation proposal. Nothing builds until an
  approval line below is signed, and nothing builds past the scope that line names.
status: PROPOSED — not signed. This checkpoint is the only open item in
  GATE-D3-REALTIME-STREAMING (CP1/CP2/CP3 are approved and merged); see that packet's
  own status line and §4 for where CP4 sits.
date: 2026-09-20
sources: GATE-D3-REALTIME-STREAMING (d3-realtime-streaming-pre-implementation-gate.md,
  read in full this pass — §2, §3 D3-C/D3-D, §4, §5, §7 particularly), COMPLETION_AUDIT.md
  rows D3/S7-price-level/F-GATE-1, plus fresh verification this pass against
  `feat/s7-price-level` @ `8a946b699` (identical to `origin/master` @ `a7176a764` on the
  one file this checkpoint touches — `git diff --stat origin/master --
  api/services/alert_taxonomy/price_level_projection.py` returns empty): direct reads of
  `price_level_projection.py` (436 lines), `bar_broadcaster.py::subscribe/add_interest/
  get_last_price/last_tick_age`, `bar_stream.py::subscribe_symbols/unsubscribe_symbols`,
  `price_level.py::evaluate/clear_anchors` (`prev_price` handling), the scheduler
  registration in `api/main.py` (~6794-6816), a live `railway variables --service web
  --kv` read (below), and an independent re-run of
  `tools/flow_worker_watch_coverage.py` against this exact tree.
---

# D3 CP4 — S7 price-level as D3's first real consumer

## ⛔ APPROVAL — this block is filled in by the OWNER, not the author

```
APPROVED BY:      Patrick (owner)
APPROVED ON:      2026-09-21
APPROVED AT SHA:  657002015
SCOPE APPROVED:   D3 CP4 -- S7 price-level's dark sweep becomes D3's first real consumer, per docs/terminal-research/12-decisions/gates/d3-cp4-price-level-consumer-scoped-proposal.md section 2. MUST: run_dark_sweep() gains a second, D3-sourced price path (bar_stream.subscribe_symbols + bar_broadcaster.add_interest/get_last_price) run BESIDE the existing poll path (_prices_for()), never replacing it this checkpoint; forward-only comparison, four outcomes never collapsed to a pass rate, no backfill/replay; prev_price stays exactly where it lives today in price_level.py -- the D3 path supplies a price, not a new baseline home; a heartbeat on every tick (including quiet/unpriced ones) extending the existing price_level_sweep_heartbeat pattern, stamped with which source served each tick; the scheduler job (alert_taxonomy_price_level_dark) named and railed as the sole caller. SHOULD (included in this approval): a measured (not guessed) length cap on the cohort passed to add_interest, closing the parent D3 gate's own gap-2 asymmetry against subscribe()'s existing validation; exposing the D3-path counters on the existing /api/admin/* heartbeat surface alongside the poll counters. EXPLICITLY DEFERRED, NOT AUTHORIZED BY THIS LINE: retiring the poll path; any delivery of any kind (run_dark_sweep remains DARK, writes nothing to a member); the upstream-load set-difference against chart/stream subscribers beyond the cap measurement; massive.get_batch_rich_snapshots's missing chunking (unrelated pre-existing gap); G1 (asyncio.get_running_loop on a scheduler thread -- not reached by this checkpoint's read path). No member-visible change. No flag armed beyond the existing dark-comparison flag. Flow-worker exposure re-measured this pass: zero reachability, zero deploy risk.
```

Until every line above is filled in, nothing in §2 is authorized. This gate does not
infer approval from a prior conversation, a Slack message, or the fact that CP1–CP3 of
the same packet are signed — CP4 is its own decision (GATE-D3-REALTIME-STREAMING's own
rule: *"an approval line must name a CHECKPOINT, never 'D3'"*).

---

## 0. What this is, and what it is not

This is **not a new investigation**. GATE-D3-REALTIME-STREAMING already scoped CP4 in
full (its §4 table, §5 items 2–4, §7 gaps 1–2) — this proposal exists because that
packet's own approval block covers CP1 only, and CP4 has never had a line signed against
it (confirmed: COMPLETION_AUDIT.md rows for D3 and S7-price-level both read "CP4 …
not yet proposed" as of this pass; `d3-realtime-streaming-pre-implementation-gate.md`'s
own status line calls CP4 "the next open item and has not been proposed"). This document
narrows that packet's CP4 row into a signable unit, resolves the one evidence gap that
was cheap to resolve (§4), and adds nothing that packet did not already decide.

**Not built today, confirmed fresh this pass:** `price_level_projection.py` is
byte-identical between `feat/s7-price-level` and `origin/master` (`git diff --stat`
empty) and contains zero references to `subscribe_symbols`, `add_interest`,
`get_last_price`, `bar_stream`, `bar_broadcaster`, or `realtime_stream`. Its price
resolver (`_prices_for`, `price_level_projection.py:260-338`) reads the shared
`live_px1_*` cache populated by `/api/live-prices`'s 15s poll, then falls back to
`massive.get_batch_rich_snapshots()`. The sweep is registered in `api/main.py:6807-6813`
on `CronTrigger(day_of_week="mon-fri", hour="9-16", minute="*", timezone=_ET)` — a
per-minute cron, gated by `ALERT_TAXONOMY_PRICE_LEVEL_DARK_ENABLED`, not a D3
subscription.

---

## 1. Why this checkpoint, now

Because it is the only open item in an otherwise-closed gate, and because of what it
specifically is: **the first time any code outside D3's own build calls into it.**
CP1–CP3 added a rail, renamed a constant, and added a read-only accessor with a
documented zero-caller inertness rail (`bar_broadcaster.last_tick_age`,
`bar_broadcaster.py:228-239`, "no product code calls this yet"). CP4 is the checkpoint
where that stops being true — S7's price-level sweep becomes D3's first live caller.
GATE-D3-REALTIME-STREAMING's own framing is exact: *"the first D3 consumer, DARK"*
(its §4 CP4 row) and its §5 item 3 states plainly that a caller-less read path would be
*"the same defect wearing a new name"* as the one `price_level_projection.py:317-325`
already survived once (built/tested/green before anything called it).

The size is real for the reason the parent packet already gave and this proposal
does not repeat wholesale: it touches a live scheduler job, a cohort of production
alert rows (dark, admin-only, no delivery — see §2 DEFER), and two upstream call sites
(`bar_broadcaster.add_interest`, `massive.get_batch_rich_snapshots`) that are today
uncapped (§5). None of that changes here; it is inherited, cited, and one item of it
(§4 below) is resolved rather than carried forward as an open gap.

---

## 2. Exact scope

**MUST BUILD** (the smallest change that makes S7's price-level sweep D3's caller,
matching GATE-D3-REALTIME-STREAMING §4's CP4 row verbatim):

- `run_dark_sweep()`'s price resolution gains a **second, D3-sourced path**, run
  **beside** `_prices_for()` — never replacing it in this checkpoint (parent gate §5
  item 2: *"Comparison against the existing poll path runs BESIDE it before anything
  is retired"*). The D3 path: `bar_stream.subscribe_symbols(cohort, owner="s7")` to
  arm the upstream Massive subscription, `bar_broadcaster.add_interest(cohort)` to hold
  the developing-bar partial alive, `bar_broadcaster.get_last_price(sym)` per symbol on
  each tick.
- **Forward-only, four outcomes, never a pass rate** — the parent gate's §5 item 2 is
  binding here: a stream-sourced cross and a poll-sourced cross that disagree are the
  finding, and collapsing them to a percentage destroys the information. No backfill —
  `bar_broadcaster` deletes partials, the AM baseline and day volume the moment a
  symbol loses its last subscriber/interest (`bar_broadcaster.py:139-144`,
  `:192-196`); there is no ring buffer to replay from.
- `prev_price` **stays exactly where it is** — `price_level.py`'s
  `last_seen_state.prev_price`, cleared only on an anchor rewrite
  (`price_level.py:280-292`). The D3 path supplies a *price*, not a new home for the
  comparison state; nothing about how price-level keeps its baseline changes (parent
  gate §6: *"No change to how price-level keeps prev_price… it belongs to the
  predicate, not to the transport"*).
- **A heartbeat on every tick, including quiet and unpriced ones**, copying the
  existing `price_level_sweep_heartbeat` pattern (`price_level_projection.py:374-436`)
  rather than inventing a second liveness mechanism — this satisfies the parent gate's
  §5 item 4 (*"a liveness stamp… applies at CP4 only"*) with an idiom the codebase
  already trusts, extended to also stamp which price source (poll vs. D3) served each
  tick so a silent D3-path failure cannot look identical to five sessions of agreement.
- **The call site is named and railed**, per the parent gate's §5 item 3: the new test
  asserts `api/main.py`'s scheduler job (`alert_taxonomy_price_level_dark`) is the one
  and only caller of the D3-path function, mirroring the existing inertness-rail idiom
  now flipped to an existence assertion.

**SHOULD BUILD** (small, load-bearing for this checkpoint not being a silent surprise):

- **A length cap on the cohort passed to `add_interest`**, closing the parent gate's
  §7 gap 2 rather than carrying it forward unaddressed into the first real caller.
  `bar_broadcaster.add_interest()` (`bar_broadcaster.py:160-175`) iterates and refcounts
  with no cap, while its sibling `subscribe()` validates its `tf` argument seven lines
  into the same class (`bar_broadcaster.py:114-115`) — the asymmetry the parent gate's
  §7 gap 2 already found and did not fix, because CP1–CP3 never called `add_interest`
  from new code. CP4 is the first caller that can actually pass it an unbounded list
  (§4), so the cap belongs here, not to a future checkpoint that would inherit an
  already-exercised gap. **Cap value: measured from the cohort, not guessed** — see §4.
- **The `/api/admin/*` heartbeat surface exposes the D3-path counters** alongside the
  existing poll counters, so `GET` on the heartbeat table answers "is the comparison
  D3 arm actually ticking" without a manual SQLite read.

**DEFER** (explicitly, restated from the parent gate so this proposal does not silently
re-open what it already closed):

- **Retiring the poll path.** Not part of this checkpoint by construction — the
  comparison exists to decide that later, on evidence this checkpoint produces.
- **Delivery of any kind.** `run_dark_sweep()` today imports no delivery path
  (`price_level_projection.py:355-356`, asserted from source by existing rails); CP4
  adds a second price source to a comparison that already writes nothing to a member.
  This does not change.
- **Fixing gap 1's OTHER half** (the upstream-load set-difference against
  chart/`/api/stream/prices` subscribers) beyond what §4 below measures for the cap.
  A full continuous-monitoring answer is out of scope for a DARK, admin-cohort-sized
  checkpoint.
- **`massive.get_batch_rich_snapshots`'s missing chunking** (parent gate §7 gap 3).
  Confirmed still live and unrelated to this checkpoint — it is the existing poll
  path's fallback, not touched by adding a second, D3-sourced path beside it.
- **G1** (`bar_broadcaster.subscribe`'s `asyncio.get_running_loop()` call raising on a
  scheduler thread) — irrelevant here by construction, restated for completeness: the
  read path this checkpoint uses (`add_interest` + `get_last_price`) never touches
  `subscribe()` or a loop (parent gate §3 D3-C, confirmed again by reading
  `add_interest`'s body above — no `asyncio` call in it).

---

## 3. Current state → target state

**CURRENT STATE**, confirmed this pass:

| Component | State |
|---|---|
| `price_level_projection.py::_prices_for()` | Reads `live_px1_*` cache (15s REST poll) → falls back to `massive.get_batch_rich_snapshots()`. Zero D3 imports. |
| `bar_stream.subscribe_symbols`/`bar_broadcaster.add_interest`/`get_last_price` | Built, merged, exercised today by exactly two owners: `"bars"` (chart feed) and `"nhnl"` (the NH/NL tap) — confirmed at `bar_stream.py:46,381-395` (owner refcount) and `bar_broadcaster.py:160-175` (interest refcount). No S7 caller exists. |
| Scheduler | `api/main.py:6807-6813`, `CronTrigger(minute="*")` weekdays 09:00–16:59 ET, job id `alert_taxonomy_price_level_dark`, gated `ALERT_TAXONOMY_PRICE_LEVEL_DARK_ENABLED` (default off). |
| `STREAM_BARS_ENABLED` on `web` | **`1`** — read live this pass (`railway variables --service web --kv`, 2026-09-20; see §4). |
| Heartbeat | `price_level_sweep_heartbeat` table, one row (`id=1`), stamped every tick regardless of outcome (`price_level_projection.py:374-436`). No source-of-price column. |
| Flow-worker exposure | Independently re-measured this pass with `tools/flow_worker_watch_coverage.py` against `feat/s7-price-level` @ `8a946b699`: `price_level_projection.py`, `bar_broadcaster.py`, `bar_stream.py` and `api/main.py` are all **not-reachable** from flow-worker's static import closure. Confirms the parent gate's §4.1 table on the current tree rather than trusting it as of an earlier SHA. |

**TARGET STATE**: `run_dark_sweep()` calls both price sources every tick it runs;
`_beat()`'s row (or a sibling table — implementation's call, not this gate's) records
outcomes from each source separately; the D3 arm is capped, named as a caller in a
rail, and heartbeats its own liveness distinctly from the poll arm's. Nothing about
the member-facing product changes — this remains, in the parent gate's words, **DARK**.

**THE GAP**: exactly the MUST-BUILD list in §2 — a second read arm, wired to the
already-built D3 primitives, run beside (not instead of) the existing one, with the
comparison, heartbeat and call-site rail that make it a real consumer rather than a
second library nobody calls.

---

## 4. Evidence gap closed this pass: `STREAM_BARS_ENABLED`

The parent gate's §7 gap 4 flagged this as unread and named exactly the command:

```
$ railway variables --service web --kv 2>&1 | grep STREAM_BARS_ENABLED
STREAM_BARS_ENABLED=1
```

Run this pass, 2026-09-20. **The quote lane is NOT silently degraded to Finnhub-only.**
`init_broadcaster` runs (`api/main.py:4529-4534` gates on this exact value), so
`bar_broadcaster.get_broadcaster()` does not raise, and D3-D's premise (parent gate
§3) — the flag being unread was the only reason to worry about a silent degradation —
is resolved in the direction that lets CP4 proceed without first shipping D3-D's
status-field fix as a precondition. D3-D itself (a `/api/stream/status` field
surfacing this) remains a CP3-adjacent item, not gated on CP4, and is not re-opened
here.

**Gap 1 (cohort size) remains genuinely open** — `project_admin_alerts()`
(`price_level_projection.py:92-157`) reads live `watchlist_alerts` joined against
`rollout.cohort_user_ids(S7_DARK)`, and no production probe of that cohort's size ran
this pass either (it requires a live DB read this worktree does not have write-safe
access to run against production, per this repo's own `C:\data` tripwire discipline).
**This is the one number the owner may want before sizing the SHOULD-BUILD cap in
§2** — recorded as an owner-bound question in §6, not assumed.

---

## 5. Risks

| Risk | Real, because | Mitigation this checkpoint carries |
|---|---|---|
| **Uncapped `add_interest` meets its first real caller.** | §2 gap 2: `add_interest` has no length check today; CP4 is the first code path that can hand it a caller-controlled list (the S7 dark cohort). | SHOULD-BUILD cap in §2, sized against a cohort measurement (§4/§6) rather than a guess. |
| **The two price sources disagree, and that disagreement is the whole point — but it must not be lost to logging.** | `bar_broadcaster` deletes partials the instant a symbol loses its last subscriber/interest; a disagreement recorded only in a log line is gone by the next redeploy. | Comparison output persists in the heartbeat/comparison store, not console-only, per the "four outcomes, never a rate" rule already binding from the parent gate. |
| **A D3-path failure reads as agreement.** | Same shape as the defect the existing heartbeat was built to prevent (`price_level_projection.py:400-409`: "a sweep that died at 09:01 looks identical at 15:00 to one that has been running all day"). | Heartbeat extended to stamp per-source liveness, not just sweep liveness (§2 MUST-BUILD). |
| **Flow-worker strand.** | The only checkpoint in the parent packet's §4 table that strands flow-worker is CP5 (`bar_rollup.py`), not CP4. | Re-verified independently this pass (§3 table) rather than trusted from the parent gate's earlier measurement — same negative result. No mitigation needed; recorded as a non-risk with its own evidence. |
| **This checkpoint quietly becomes the retirement of the poll path.** | The "beside, not instead of" framing is easy to erode under normal development pressure once the D3 path looks like it's working. | Explicitly DEFERRED in §2; the acceptance plan (§7) tests for the poll path's continued, unmodified operation. |

No risk here is new — every one is a named item from GATE-D3-REALTIME-STREAMING §7,
carried forward with either a resolution (§4) or an explicit mitigation scoped to this
checkpoint (§2).

---

## 6. Owner-bound questions

**One, not zero — stated rather than assumed away:**

- **Does the owner want the S7 dark cohort's size (parent gate §7 gap 1, its "set
  difference" framing) measured against production before signing the `add_interest`
  cap's exact number?** The cap can ship at a conservative default (matching
  `subscribe()`'s validated shape, or a round number well above any plausible
  admin-cohort size) without that measurement, and be tightened later — but if the
  owner wants CP4 sized with the real number rather than a conservative one, that is a
  live-DB read this worktree should not perform unilaterally.

No other owner decision blocks this checkpoint. `STREAM_BARS_ENABLED` (§4) is answered.
Flow-worker exposure (§3, §5) is answered and favorable. Delivery, retirement of the
poll path, and G1 are all explicitly out of scope (§2 DEFER), not open questions.

---

## 7. Test & acceptance plan

Extending, not replacing, the existing `tests/test_alert_taxonomy_price_level_*.py`
suite (schema, projection, compare — confirmed present this pass) and
`tests/test_d3_cp3_staleness_reader.py`'s inertness-rail idiom, flipped to an
existence assertion for CP4's call site:

| Test | Proves |
|---|---|
| `test_d3_path_is_called_only_from_the_scheduler_job` | The named call-site rail from §2 MUST-BUILD / parent gate §5 item 3 — `run_dark_sweep`'s D3 arm has exactly one caller, the `alert_taxonomy_price_level_dark` job. |
| `test_poll_path_unchanged_when_d3_arm_added` | `_prices_for()` (the existing poll resolver) is byte-for-byte unmodified and still runs every tick — the "beside, not instead of" rule is enforced, not just documented. |
| `test_add_interest_cohort_is_capped` | The SHOULD-BUILD cap (§2) actually bounds the list handed to `bar_broadcaster.add_interest`, with a mutation proof (remove the cap → red). |
| `test_disagreement_between_sources_is_recorded_not_rated` | A synthetic case where the poll price and the D3 price cross differently produces a stored four-outcome record, never a collapsed percentage. |
| `test_heartbeat_distinguishes_d3_liveness_from_poll_liveness` | A D3-arm failure (e.g. `get_last_price` returning `None` for the whole cohort) stamps differently from a poll-arm failure — mutation-proved both directions. |
| `test_prev_price_unaffected_by_d3_path` | The `last_seen_state.prev_price` lifecycle (`price_level.py:280-292`) is untouched by which price source supplied the tick. |
| `test_flow_worker_does_not_reach_d3_price_level_wiring` | `tools/flow_worker_watch_coverage.py` still reports all four touched modules as not-reachable after this checkpoint's changes — a regression guard on §3's measurement, not just a one-time check. |

**Acceptance for the checkpoint as a whole:** all of the above green; the existing
price-level projection/compare/schema suites remain green unmodified; a manual
dry-run with `ALERT_TAXONOMY_PRICE_LEVEL_DARK_ENABLED=1` in a local/dev environment
shows both price sources ticking on the heartbeat for at least one full session before
this is considered done, per the parent gate's own §2 checklist item 2 (comparison
ships with the report that reads it).

---

## 8. What follows if this ships

Per the parent gate's own sequencing (§4, §6): the comparison this checkpoint produces
is what would eventually justify retiring the poll path — that decision is explicitly
not part of this authorization and is not proposed here. CP5 (`bar_rollup.py` changes)
remains named-but-not-proposed, per the parent gate, unaffected by whether CP4 ships.

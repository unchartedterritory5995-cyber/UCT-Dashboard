# TERM-049 slice 2: the flow lane, the setup-ledger lane, entity ids across renames

Branch `lane/term-049-slice2`, based on `integrate/terminal-fixes` at `52952fef1f` (includes slice 1, `0c74088f0`).
Date: 2026-10-01.

## What was built

`GET /api/research/history/{sym}` (`api/services/ticker_history.py`) gains two lanes and a rename join.
The slice-1 rules still hold: every row names its source and its own date, nothing is folded into a
score, a lane that cannot be read is `unavailable` (never empty), and every lane reports
`covers_from` and `partial`. The new lanes also report `covers_to`.

### ⛔ The two new lanes have their own gate

`TICKER_HISTORY_ENABLED` is **armed in production** (`docs/feature_flags.json`). Without a
separate gate, merging this branch would put the firm's per-ticker setup win/loss record, plus
a tape count, in front of paid members with no decision taken. So `flow` and `setups` sit
behind **`TICKER_HISTORY_LANES2_ENABLED`**, declared `pending`, read per request, unset = off.
While it is unset, neither lane is read: no tape request goes out and the engine DB is never
opened. Both lanes are listed in `not_rendered` with the reason, and the tab says
"Options flow is not included yet". This is railed.

### flow: the options tape, counts only

* **Store found:** `flow.db` table `flow` (`api/flow_db.py`). Since the P5 cutover
  (`FLOW_READS_PROXY_ENABLED` armed), flow-worker owns it and web cannot open it. Web reads it
  over `WORKER_INTERNAL_URL` with the `PUSH_SECRET` bearer that `require_flow_user` accepts. The
  live Discord `/flow` card uses the same door (`flow_card_from_page.fetch_product`). Without the
  proxy, web owns `flow.db` and the same route answers locally.
* **Read:** `/api/flow/ticker/{sym}?source=stocks&cols=CreatedDate`, then `indexes` only if
  `stocks` held nothing (the signature indicator's partition rule).
* **Row:** prints per session, `source: flow_tape`, `ref: /options-flow`. Rendered as
  "1,234 options prints on the tape · Open Options Flow".
* **Paid gating.** The flow page is served by `AuthGuard` to `isPaid` = admin, paid plan, or
  trial. This route's `require_paid` is `is_paid_or_trial`, the same predicate, so the gate is
  mirrored. The lane is also limited to counts plus a link. It requests **one column**, so
  premium, side, strike and expiry never reach this process. A tape that answers with more
  columns is refused (lane `unavailable`).
* **covers_from / covers_to:** the earliest and latest sessions `/api/flow/dates` holds, across
  both partitions. The value is measured, not assumed. Retention is `FLOW_RETAIN_TRADE_DAYS=90`,
  but `FLOW_PRUNE_ENABLED` is dark, so the tape can reach further back than 90 days.

### setups: the engine's setup ledger

* **Store found:** `setup_triggers` in the engine's `uct_intelligence.db` (580 rows,
  2026-07-30 → 2026-10-01 locally; source `leadership`). The Brain Pack installs it nightly on
  the pod at `<BRAIN_DIR>/data/uct_intelligence.db` (`brain_sync.py`). The whole DB is shipped,
  verified in `uct-intelligence/scripts/brain_pack_export.py`. The lane opens it read-only by URI,
  the same way `decision_record` and the Wisdom replay do.
* **Rows:** one on the day a setup was **published** (`trigger_date`), and one on the day its
  outcome was **recorded** (`resolved_at`): won, lost, never triggered, unresolved, voided (not
  graded), with the R multiple as stored. An open setup has no outcome row. ⛔ `quality_*` is
  never read, because it is a composite score.
* **covers_to** matters here. The pack is nightly, so the last `trigger_date` shows how far
  behind the pod's copy is. If the pack is not installed, the lane is `unavailable`.
* **Not used:** `api/services/screener/lift_ledger.py` (per-structure, not per-ticker over time)
  and `scan_hits` in `screener.db`. `scan_hits` is keyed by `def_hash` with no member column,
  and the hashes come from member formulas. A per-ticker read would show one member that another
  member's private screen fired, so it needs per-caller scoping and stays out.

### Entity ids across renames

A real rename source exists. The Entity Master holds dated `entity_aliases`, and the D5 producer
(`entity_master_d5_renames.py`) applies Massive `ticker_change` events as `renamed`. The history
resolves through the **member door** (`member_resolve.resolve_for_member`), and only while
`ENTITY_MASTER_MEMBER_ENABLED` is armed (it is `pending`). Each lane is read once per alias and
kept inside that alias's half-open `[valid_from, valid_to)` window, so FB's rows join META's and a
reused ticker never picks up the previous owner's history. Every row now carries `symbol`, the
name it was recorded under. When the master is dark, unresolved, ambiguous or unreadable, the key
stays the bare ticker and `entity.status` says why (`not_armed`, `not_found`, `ambiguous`,
`unavailable`).

## Response shape changes (with both new gates unset)

Additive only. The response gains `entity: {status: "not_armed", reason}`, a `symbol` on every
row, and lane entries gain `covers_to: null`. `not_rendered` changes from `{flow}` to
`{journal, flow, setups}`. The four slice-1 lanes are unchanged.

## Tests

* `python -m pytest tests/test_ticker_history.py -q` → **23 passed**. Real stores: the flow
  lane goes through the REAL `flow_router` (`/api/flow/ticker`, `/api/flow/dates`,
  `require_flow_user`, PUSH_SECRET bearer) over a seeded FlowDB. The setup lane reads a real
  SQLite file with the engine's verbatim `setup_triggers` DDL at the Brain Pack path. Renames go
  through the real Entity Master store, written by `apply_event`.
* `python -m pytest tests/test_ticker_history.py tests/test_feature_flag_ledger.py tests/test_async_routes_do_not_block.py -q`
  → **277 passed** (final run, after the dark gate, its ledger entry and the dark-lane test).
* `npx vitest run src/pages/research/tabs/HistoryTab.test.jsx src/pages/research/ResearchPage.test.jsx src/context/AuthContext.test.jsx --maxWorkers=4`
  → **59 passed**, with rendered-text assertions on the flow row (count, source, link, no `$` or
  "premium"), the setup rows, the "through" date, the unavailable flow lane, the rename line, and
  the dark-lanes intro.
* The route stays a plain `def` (async-blocking rail green).

## Mutations (each broken with the editor, seen red, restored with the editor)

1. Rename window ignored (`if True or _in_era(...)`): `test_renames_join_inside_each_alias_window_when_armed` red (1 failed).
2. Index-partition fallback dropped: `test_flow_lane_falls_back_to_the_index_partition` red (1 failed).
3. Frontend `flow_tape` source label removed: `renders a flow row as a print count…` red (1 failed).

A fourth mutation, disabling the one-column refusal, was **blocked by the session's permission
classifier** as a security weakening and was not run. That guard is covered by
`test_a_tape_that_ignores_the_projection_is_unavailable`, but its red has **not** been observed.

## Still open

* **Owner call:** whether members may see the firm's per-ticker setup win/loss record. This is
  the same question TERM-088's decision record is waiting on. Arming
  `TICKER_HISTORY_LANES2_ENABLED` is that decision.
* **First live read after arming.** The flow door is proven in production by the `/flow` card,
  but this route has not used it yet.
* ~~**The member's own journal lane:** deferred, named in `not_rendered`.~~ Built on
  `lane/terminal-tail` (2026-10-01). The deferral was time, not an owner or privacy ruling (no
  ruling names it; OI-15 is about the `#tsdr` room corpus, and the capability matrix rates a
  member's own data as allowed). Lane `journal`, behind `TICKER_HISTORY_LANES2_ENABLED`: the
  CALLER's own Journal 2.0 trades in the ticker (opened, closed with result and R as stored,
  and still-open positions), read only through `trades.list_trades_for_user` /
  `positions.list_open_positions` keyed on the requesting member's id. With no id the lane is
  `unavailable`. It never falls back to another member's journal. `covers_from` is the member's
  first journalled entry. Rails: `tests/test_ticker_history.py` (4 new, 27 total) and
  `HistoryTab.test.jsx` (13 total).
* **Room/wire/book/catalysts over renames:** joined as above. Two spellings of one era (e.g.
  `BRK.B` / `BRK-B`) are not deduplicated. Each row says which spelling it came from.

## Finding outside this ticket (not fixed)

`api/routers/signature.py::_read_flow_source` and `api/routers/ai_search.py` call
`/api/flow/ticker/{sym}` with **no credential**. The route has been `require_flow_user` since the
exposed-routes sweep (`api/flow_router.py` header), and signature's docstring still says the route
"declares no auth dependency". If so, both reads get 401 in production and report a FAILED read or
no flow context. This was found by reading the code, not verified live. Fix: send the PUSH_SECRET
bearer, as `flow_card_from_page` does.

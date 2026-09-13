---
id: GATE-S7-SCAN-MEMBERSHIP-CHANGE
title: S7 trigger type — `scan-membership-change` pre-implementation gate
role: the approval packet for an absorption the completion plan and SPEC-S7 both describe as NEW WORK. It is not. §1 is the measurement that says so, and it is the reason this packet exists before any code.
status: ⛔ NOT APPROVED — no line has been written. Docs only.
date: 2026-09-12
measured_against: origin/master @ 6576f044e
pairs_with: PRD-S7, SPEC-S7 §5.2 / §5.6, s7-alerts-completion-plan.md §1 row 6, GATE-D2-CANONICAL-DATA-MODEL, GATE-S12-ROLLOUT
confidence: high — every claim is quotable at file:line and was read from `api/**` on this tree; the one absence claim (nothing calls `scan_store.prune`) carries its own control
evidence_ceiling: SOURCE ONLY. `screener.db` was not opened, no Railway variable was read live, and no nightly run was observed. Every population and row-count number below is UNKNOWN.
---

# ⛔ NOT APPROVED — `scan-membership-change`

## ⛔ APPROVAL — this block is filled in by the OWNER, not the author

```
APPROVED BY:
APPROVED ON:
APPROVED AT SHA:
SCOPE APPROVED:
```

⛔⛔ **NOTHING IN THIS PACKET IS AUTHORIZED.** No checkpoint below may be built, merged or
scheduled until the owner writes an approval line naming ONE of them.

---

## 1. ⛔⛔ Does a legacy path exist? — **YES, AND IT IS COMPLETE, WIRED AND LIVE**

> **`api/services/screener/screen_alerts.py` already tells a member when a name enters or leaves
> their screen. Subscriptions, the set difference, delivery on three channels, and a per-session
> dedup table — all of it shipped.**

The completion plan (§1, row 6) says of this type: *"`scan_evaluator`'s nightly sweep already
computes result sets; **this is a diff between two cycles**. Cheap, but low member urgency."*
⛔ **The diff is not work to be done. It is a shipped module with its own tables, its own router
endpoints and its own scheduler entry**, and the plan's sizing (**S**) was written without it.

### 1a. The legacy path, measured

| | |
|---|---|
| module | `api/services/screener/screen_alerts.py` (261 lines) |
| the diff | `diff_for(def_hash, tf)` — `screen_alerts.py:141-154`; returns `(as_of, entered, exited)` |
| driver | `run_nightly(deliver=None, tf=None)` — `screen_alerts.py:171-261`; returns a receipt dict |
| schedule | `api/main.py:1637-1641` — `id="screener_screen_alerts"`, `CronTrigger(hour=scan_evaluator.SWEEP_HOUR_ET, minute=scan_evaluator.SWEEP_MINUTE_ET + 10)` = **05:10 ET** (`scan_evaluator.py:254-255`), `max_instances=1` |
| gate | `api/main.py:1635` — `scan_evaluator.enabled() and os.environ.get("SCREEN_ALERTS_ENABLED", "1") != "0"`. **Two flags, and the second DEFAULTS ON** |
| subscriptions | `screen_alert_subs(user_id, def_hash, def_id, name, mode, created_at)`, PK `(user_id, def_hash)` — `screen_alerts.py:60-70` |
| dedup | `screen_alerts_fired(user_id, def_hash, as_of, fired_at, entered, exited)`, PK `(user_id, def_hash, as_of)` — `screen_alerts.py:75-83` |
| both tables live in | `screener.db`, created through `snapshot_db.connect()` (`screen_alerts.py:90-97`) |
| modes | `MODES = ("entry", "exit", "both")` — `screen_alerts.py:86` |
| delivery | `watchlist_alert_service.deliver_alert_payload` (`screen_alerts.py:180-182`) = in-app + email + Discord |
| member doors | `GET /api/screener/alerts` (`api/routers/screener.py:190`), `POST /api/screener/alerts` (`:195`), `DELETE /api/screener/alerts/{def_hash}` (`:210`) — all `Depends(require_paid)` |
| caps | `MAX_NAMED = 12` symbols per message (`:50`); `MAX_PER_USER = 6` alerts per member per nightly run (`:57`) |

⚠️ **`SCAN_SWEEP_ENABLED` is a claim, not a measurement, in this packet.** `scan_evaluator.enabled()`
(`scan_evaluator.py:2518`) defaults to `"0"` in code, and `CLAUDE.md` records a live read of
2026-08-09 showing `SCAN_SWEEP_ENABLED=1` on Railway `web`. ⛔ **Re-read both that variable and
`SCREEN_ALERTS_ENABLED` live before any line is written.** A code default is not a configuration —
`catalyst-match` §8b is the standing example, twice in one day.

### 1b. ⛔ SO THIS IS AN ABSORPTION, AND THE PACKET SHAPE CHANGES WITH IT

An absorption and a new capability are different packets. Under the §4a absorption default the
legacy path **stays live and untouched**, the new type runs **dark**, and the flip plus the legacy
switch-off happen in the **same PR**. None of that applies to a type with no incumbent.

⭐ **And there is a second consequence nobody has recorded: the seventh alert path already exists.**
The completion plan's §0a table lists six alert-state tables and argues that *"adding a trigger type
that absorbs nothing makes it seven."* `screen_alerts_fired` is a **seventh** state table that the
table does not list — measured: the string `screen_alerts_fired` appears in exactly three places in
stripped `api/**` source, all three inside `screen_alerts.py` (`:59` schema, `:63` read, `:113`
write). The consolidation premise is stronger than the plan states, not weaker.

### 1c. ⚠️ SPEC-S7 §5.2 SOURCES THIS TYPE TO THE WRONG ARTIFACT

The spec's §5.2 table row reads:

| Type | `params` shape | Source of the shape |
|---|---|---|
| `scan-membership-change` | `{definition_id: str, direction: "entered"|"left"|"either"}` | *new — thin wrapper over `scan_evaluator`'s `definition_evaluations` (§3)* |

⛔ **Measured: `definition_evaluations` is a real table and it is not this one.**
`api/services/definition_record.py:110` declares `TABLE_NAME = "definition_evaluations"`, and
`definition_record.db_path()` resolves to **`ledger._DB_PATH`** — the Signature ledger
(`signal_ledger.db`), holding per-definition coverage receipts with a 540-day retention
(`RETENTION_DAYS`, `:106`). The screener's hit sets are `scan_hits` and `scan_coverage` in
`screener.db`, and the shipped diff reads those (`screen_alerts.py:148-153`).

⭐ **Two things follow.** The spec's `params` shape is nonetheless CORRECT — `{definition_id,
direction}` is what `screen_alert_subs` stores as `(def_hash, mode)`, with `mode`'s vocabulary
`("entry","exit","both")` mapping onto `direction`'s `("entered","left","either")`. What is wrong is
the SOURCE attribution, and it matters because an implementer following the citation would build
against a coverage-receipt ledger in a different database. **CP1 must correct §5.2's source column
by naming `screen_alerts.diff_for` and its two tables.**

---

## 2. ⛔⛔ THE RETENTION QUESTION — ARE TWO CONSECUTIVE CYCLES ACTUALLY RETAINED?

> **YES. Two consecutive swept sessions are retained, and the accessor that returns exactly those
> two already exists and is already the diff's input.**

### 2.1 The accessor

`api/services/screener/scan_store.py:582`:

```python
def recent_covered_as_ofs(def_hash: str, tf: Any, limit: int = 2) -> list:
```

Its docstring (`:583-594`) is written for this exact use, and its trap is the load-bearing half:

> *"⛔ `scan_coverage` ONLY, never `scan_hits` — the same rule `latest_coverage_for` states, and it
> matters more here than anywhere else in this module. A swept session that matched NOTHING writes a
> coverage row and zero hits rows, so a hits-derived 'previous session' would skip it and diff
> tonight against some older, busier night. Every name that has been in the screen the whole time
> would then be reported as newly ENTERED, and the member would be alerted to a move that never
> happened."*

`screen_alerts.py:25-32` states the same trap independently, and `diff_for` (`:148`) calls the
accessor with `limit=2`.

### 2.2 The horizon — measured

`scan_store.prune(before_as_of)` exists at `scan_store.py:631` and deletes strictly before a horizon
from **both** tables (`:658-661`). **It has ZERO callers.**

⛔ **THE ABSENCE CLAIM CARRIES ITS CONTROL.** A stripped-source search over 1,213 parsed files under
`api/` found:

- `scan_store.prune` — **0** occurrences;
- `.prune(` — **3** call sites, all elsewhere (`api/main.py:1032` news retention, `api/main.py:1344`,
  `api/main.py:3634`, stripped-source line numbers);
- `prune(` — **39** occurrences across 26 modules, including `scan_store.py:200` (stripped) which is
  the definition itself.

**The searcher can see a `prune` call. It sees none for this one.** So nothing in the product
enforces a horizon on `scan_hits` / `scan_coverage`, and retention is bounded only by the volume.

### 2.3 ⭐ What that means, and the part that is NOT reassuring

**The finding is not "retention is fine."** It is:

> **The diff's input is guaranteed by the ABSENCE of a caller, not by a policy.** Two sessions are
> retained today because nobody prunes; the module that owns the prune says in its own docstring
> (`scan_store.py:637-642`) that shipping the tables without it would repeat the
> `alert_shadow_fires` mistake — *"53 bytes a row, no prune, no TTL, no cap, 279 GB/yr at 10,000
> alerts"* — and that a `scan_hits` row is **3.4× heavier** than one of those. **So the prune is
> expected to be wired.**

⛔ **The day somebody wires it, the diff's previous session can vanish**, and the failure is
silent in the flattering direction: `diff_for` returns `(None, [], [])` (`:149-150`) and
`run_nightly` counts it as `no_previous` — a member simply stops being told, with no error. And
`prune`'s own docstring names the second trap (`:649-653`): *"A PRUNED WINDOW IS 'UNPROVEN', NEVER
'ZERO'."*

**Two CP1 deliverables follow from this, and neither is optional:**

1. **A rail that fails if `prune` acquires a caller whose horizon can reach the previous session** —
   or, more honestly, a rail asserting `recent_covered_as_ofs(..., limit=2)` returns two entries for
   a definition swept twice, driven against a temp DB, **plus** a control proving it returns one for
   a definition swept once (the `no_previous` path must stay distinguishable).
2. **The dependency recorded in SPEC-S7 §5.6.** This type's `replay_fn` question is decided by the
   prune: *"would this have fired N times"* over the trailing 7 days is answerable only for sessions
   still in `scan_coverage`, and the horizon that decides which those are has no owner today.

### 2.4 ⛔ The `replay_fn` ruling this packet recommends — NO REPLAY, and the reason is this type's own

The programme has refused replay three times for three reasons (a trendline has no past; a calendar
date moves; an LLM-graded row cannot be re-synthesised) and `position-risk` supplies a fourth (the
price cache keeps no history). **This type supplies a fifth:**

> **A past session's hit set is retained only until somebody wires a prune nobody has written yet,
> and `coverage(...) is None` means "the sweep never ran" — which after a prune is FALSE.** A replay
> over the surviving window would silently answer a different question from the one asked, and
> `scan_store.prune`'s docstring already forbids the arithmetic form of it: *"⛔ A CLAIM SURFACE MUST
> NOT RE-DERIVE A HIT RATE OVER THE SURVIVING WINDOW AND PRESENT IT AS THE WHOLE."*

**Forward-only, four outcomes, never a pass rate.**

---

## 3. ⭐ THE ADDRESS BOOK ALREADY COVERS THIS TYPE — the only one of the four that can say so

Measured directly from `api/data/canonical_address_book.json` (48,329 bytes, `schema_version: 1`,
`generated_by: tools/build_canonical_address_book.py`):

```
metrics                       142
  screener_rows               137   all cadence: nightly, grain: date
  bars_sqlite                   5   ohlcv.o/h/l/c/v, cadence: null
axis_report.cadences          {"nightly": 137, "(undeclared)": 5}
```

**D2 CP1's 137 addresses are ALL `store: screener_rows`, and every one is `cadence: nightly`** —
which is exactly the population a screen definition names. `scan_evaluator.cadence_ceiling`
(`scan_evaluator.py:678-706`) derives the same fact from the manifest and states the consequence:

> *"Every one of the table's 54 declared scalars is `cadence: nightly` out of `screener_rows` at
> `grain: date`… So a scan naming ANY scalar re-read five minutes later returns the SAME answer off
> the SAME nightly snapshot."*

⚠️ **State this precisely and do not overclaim it.** The address book addresses **metrics**; this
type's predicate names a **definition** (a tree of metrics) by hash. "The address book covers it"
means *every scalar a definition can name is addressable, at a declared cadence* — it does **not**
mean a definition has an address. ⭐ That is still the strongest position of the four types, and it
is why the honest-cadence problem that blocks `indicator-condition` does not arise here: there is no
undeclared cadence anywhere in this type's metric surface.

⛔ **And it is why the nightly wording is a CONTRACT, not a caveat.** `screen_alerts.py:16-21`:

> *"⚠️ SAY WHAT THIS IS, NOT WHAT IT RESEMBLES. The diff is NIGHTLY BY CONSTRUCTION… thinkorswim's
> every-change alert is a better product on this axis and the copy below says 'overnight' rather
> than implying a parity we do not have. ⛔ Do not soften that wording into something that reads
> live."*

Any S7 copy for this type inherits that sentence.

---

## 4. What CP1 would be — REGISTRATION + PARAMS SCHEMA ONLY

*(Not authorized.)*

**CP1 — `scan-membership-change` registration.**

1. `api/services/alert_taxonomy/scan_membership_change.py` — `TYPE_ID`, `PARAMS_SCHEMA`,
   `register()`. **No evaluator. No delivery. No read of `scan_hits`. No scheduler entry.**
2. `PARAMS_SCHEMA` pins **every shape the legacy path supports**, derived by AST from
   `screen_alerts.py`, never hand-typed:
   - `definition_id` ← the legacy `def_hash` (⚠️ and the schema must record that the legacy
     subscription's PK is `(user_id, def_hash)`, so **one member cannot hold two subscriptions to
     one definition with different modes** — a real narrowing, invisible in the type's name);
   - `direction ∈ {entered, left, either}`, with the legacy `MODES` mapping recorded beside it;
   - `timeframe` ← `scan_store.SCAN_JOIN_TF` (`scan_store.py:450`, `"D"`), pinned as a FIELD even
     though the legacy path takes exactly one value, because it is the shape a later type will want
     to change;
   - `max_named` and `max_per_user` recorded as legacy delivery-shaping constants (`:50`, `:57`) —
     ⚠️ pinned as *facts about the incumbent*, not as S7 parameters, because a per-run cap is a
     delivery policy and belongs to `delivery.py`'s own line.
3. The two-session retention rail and its control (§2.3 item 1).
4. **SPEC-S7 §5.2's source column corrected** (§1c) and F-S7-SMC-1/2/3 recorded at the point of use.
5. The parity control at `tests/test_alert_taxonomy_filing_watch_parity.py:621` updated **by
   naming** — see §5.

⛔ **Explicitly NOT in CP1:** no evaluator, no `delivery.py` call, no read of `screen_alert_subs`,
no change to `screen_alerts.py`, no scheduler entry.

**CP2 — dark evaluator + FORWARD-ONLY comparison harness, harness-armed predicates ONLY.**
Four outcomes — `agreed` / `new_only` / `legacy_only` / `not_comparable` — never collapsed into a
pass rate; `legacy_only` is an alert a member **LOSES** at the flip. ⛔ No replay (§2.4).
⚠️ **This type's comparison has an unusual clock: it ticks ONCE A NIGHT.** Five trading sessions of
forward data is five comparisons per subscribed definition, not five hundred, and the report must
say so rather than let a small `n` read as agreement. A heartbeat on **every** run including the
`no_previous` ones — *a heartbeat that only beats on success is a success detector.*

**CP3 — projection of real member rows, `rollout:s7-dark` cohort ONLY, still dark.**
⛔ The cohort is S12's tag, read through `api/services/rollout.py:100`
`cohort_user_ids(rollout.S7_DARK)` — **never a role check**; `rollout.py:29-38` rules that an empty
cohort means NO MEMBERS and never a fallback to admins. The projection reads `screen_alert_subs`
**read-only, at evaluation time** — the `price_level_projection` idiom, no second table, no sync job.

**CP4 — all members, still dark.** A tag assignment (`rollout.py:258`), not a code path.

**FLIP — its own line.** Delivery plus the legacy switch-off, same PR. For this type the switch-off
is removing the `screener_screen_alerts` job and the three router endpoints — **member-visible**,
so a member-impact paragraph is mandatory.

---

## 5. ⛔⛔ THE SERIALIZER — `_EXPECTED`, and it flips BY DESIGN

`tests/test_alert_taxonomy_filing_watch_parity.py:621`:

```python
_EXPECTED = {"document-arrival", "price-level", "event-proximity", "catalyst-match"}
```

`_declared_trigger_types()` (`:549-562`) reads every module-level `TYPE_ID = "..."` in
`api/services/alert_taxonomy/` **from the AST — never a grep, never a hand-typed roster** — and the
assertion at `:633` requires equality. **Registering `scan-membership-change` turns that test RED,
and the red is the rail working, not a regression.**

⛔ **The docstring's steps, reproduced from `:577-583`:**

> 1. Add the new type to `_EXPECTED` below.
> 2. Give `alerts._s7_durable_alerts` a reconstruction branch for it — without one its fires are
>    silently dropped from the member's feed (proved by the sibling test below).
> 3. Re-run the three observable classes above against the new type's own fixture event, and re-run
>    the mutation proof.

⚠️ The docstring numbers **three** steps; the failure message at `:636-637` says *"the four steps"*.
The list is the authority; the count drifted.

`api/services/alerts.py:142-165` confirms step 2 is real: `_s7_durable_alerts` has **one** branch
(`:160`, `document-arrival`), and `test_the_feed_bridge_silently_drops_a_trigger_type_it_has_no_
branch_for` (`:641`) demonstrates that any other type's fire produces **no feed row and no error**.
⛔ Step 2 is a **PRECONDITION at CP3**, when a projection first writes a real fire.

---

## 6. ⛔ WATCH-COVERAGE CLASSIFICATION — one INERT STRAND that decides the merge order

Measured by importing `reachable_paths(root)` / `watched_paths(root)` from
`tools/flow_worker_watch_coverage.py` with an EXPLICIT root (no git). **reachable = 154,
watched = 24.** Control: `api/flow_worker_main.py` is reachable; `api/services/awareness/engine.py`
is not.

| module | reachable | watched | classification |
|---|---|---|---|
| `api/services/screener/scan_store.py` | **yes** | no | ⛔ **INERT STRAND** |
| `api/services/screener/screen_alerts.py` | **no** | no | outside — no constraint |
| `api/services/screener/scan_evaluator.py` | **no** | no | outside — no constraint |
| `api/services/alert_taxonomy/{registry,receipts,delivery,db}.py` | **yes** | no | ⛔ **INERT STRAND** |
| `api/services/alerts.py` | **yes** | no | ⛔ **INERT STRAND** |
| `api/services/watchlist_alert_service.py` | **yes** | no | ⛔ **INERT STRAND** |
| a NEW `alert_taxonomy/scan_membership_change.py` | **no** (until `register()` is wired) | no | outside — until CP3 |

Path traced, not assumed: `flow_worker_main → auth_surface_check → flow_proxy → auth_service →
auth_db → journal_two.db → journal_two.notes → ticker_meta → groups → groups_gates →
screener.snapshot_db → screener.scan_store`.

⭐ **`scan_store.py` is the strand that matters here, and it is the reason §2.3's rail must be a
TEST rather than a code change.** Flow-worker RUNS `scan_store.py` and will NOT redeploy for a
change to it, so any edit there — including "make `recent_covered_as_ofs` safer" — leaves
flow-worker on the old copy with every test green. **CP1 must not edit `scan_store.py`**; the
retention guarantee is asserted from `tests/`, which flow-worker does not run.

⛔ **CP3 is the checkpoint that strands something**, because wiring `register()` puts the new module
in the closure through `alerts.py` / `registry.py`. Run `python tools/flow_worker_watch_coverage.py`
at review; a red there is a REVIEW GATE per `docs/runbooks/deploy-windows.md`, not a block.

---

## 7. Method

- **CODE, NEVER PROSE.** Every literal search ran over source with docstrings and comments removed —
  each file parsed with `ast`, every string-only `Expr` statement blanked, `ast.unparse` re-emitted.
  **1,213 files under `api/` parsed, 0 unparsable.** **CONTROL:** a docstring-only sentence
  (`"a trader would act on it"`, `scan_store.py`) is found in **1** raw file and **0** stripped
  files, while `def record_hits` is still found. The stripper removes prose and still sees code.
- **The absence claim in §2.2 carries its own control** — the same search finds 3 `.prune(` call
  sites and 39 `prune(` occurrences elsewhere, so it could have seen one here.
- **Reachability** — `reachable_paths(root)` / `watched_paths(root)` with an explicit root, no git.
- **The address-book counts in §3** were produced by loading the JSON and counting, not by reading a
  number out of a document.
- No git command was run; no SHA was verified.

---

## 8. ⚠️ WHAT COULD NOT BE MEASURED

1. **`SCAN_SWEEP_ENABLED` and `SCREEN_ALERTS_ENABLED` live on `web`.** Both gate whether the legacy
   path runs at all. §1a.
2. **How many `screen_alert_subs` rows exist** — i.e. whether this absorption has any members today.
   ⛔ **This is the number that decides whether CP2's comparison can observe anything**, and it is
   unknown. A dark run over zero subscriptions prints four zeroes and reads like agreement.
3. **How many sessions `scan_coverage` actually holds per definition** on the production volume, and
   whether any definition has fewer than two.
4. **Whether the nightly sweep is currently succeeding** — `run_nightly`'s receipt is logged
   (`screen_alerts.py:260`) and nothing persists it, so *"ran and found nothing"* and *"never ran"*
   are the same observation from outside.
5. **The `screen_alerts_fired` row count** — the only durable evidence that any member has ever
   received one of these alerts.

⛔ Each is one read-only query or one `railway variables --kv` away, and **none was performed.**

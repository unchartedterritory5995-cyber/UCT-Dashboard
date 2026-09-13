---
id: GATE-S7-REGIME-CHANGE
title: S7 trigger type — `regime-change` pre-implementation gate
role: the approval packet for the type the completion plan sequences LAST. It absorbs TWO legacy emitters, not one, and its in-app-only delivery is a STRUCTURAL ACCIDENT rather than a rule — §3 is the measurement that says so, and it is the reason this packet exists before any code.
status: ⛔ NOT APPROVED — no line has been written. Docs only.
date: 2026-09-12
measured_against: origin/master @ 6576f044e
pairs_with: PRD-S7, SPEC-S7 §5.2, s7-alerts-completion-plan.md §1 row 7, DEC-13 (regime authority), GATE-S12-ROLLOUT
confidence: high on the source readings (every claim is quotable at file:line and was read from `api/**` on this tree); medium on production flag state, which is INHERITED from `CLAUDE.md`'s 2026-08-09 live read and was NOT re-read this pass
evidence_ceiling: SOURCE ONLY. `auth.db` was not opened, no Railway variable was read live, and no scan cycle was observed. Every population number below is UNKNOWN.
---

# ⛔ NOT APPROVED — `regime-change`

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

## 1. Does a legacy path exist? — **YES, AND THERE ARE TWO OF THEM**

The completion plan (§1, row 7) describes one: *"the regime authority is settled (DEC-13:
`voice_regime_classifier`), and the Awareness Engine's R4 already keeps a durable snapshot ledger to
diff against."* ⛔ **Measured, a SECOND emitter ships beside it, with a different prior-label
authority, a different insight `kind`, and a different importance.**

| | **A — R4, the ledger path** | **B — the session-summary heuristic** |
|---|---|---|
| function | `rule_regime_flip` — `api/services/awareness/rules.py:108-143` | `maybe_emit_regime_shift(user_id)` — `api/services/voice_proactive_service.py:269-299` |
| prior label from | `awareness_regime_snapshots`, the durable per-cycle ledger — `regime_snapshots.get_last_label()` (`:45-53`) | **the TEXT of the member's last voice-session summary** — `list_summaries(user_id, limit=1)`, then `if r in last_text` |
| current label from | `voice_regime_classifier.get_current_regime()` (DEC-13's authority) | the same function |
| insight `kind` | `regime_flip` | `regime_shift` |
| importance | computed: `0.5 + 0.5·confidence`, ×1.3 if the member holds positions, ×1.4 urgency → clamped 1-10 (`rules.py:132-142`, `:39-45`) | **hard-coded 8** (`voice_proactive_service.py:290`) |
| who gets it | any member with an open position **or** a watchlist symbol (`rules.py:125-128`) | any member with at least one voice-session summary |
| driver | `run_awareness_scan()` → `engine.py:271` | `api/main.py:6584` and `:6587`; `api/routers/voice.py:344` |
| schedule / gate | `api/main.py:6630` `_add_compass_job`, 20-min; **double-gated** `COMPASS_AUTOMATION_ENABLED` + `AWARENESS_ENGINE_ENABLED` (`main.py:6614`, `engine.py:30`) | `_add_compass_job` window scans (`main.py:6596-6606`) — gated on `COMPASS_AUTOMATION_ENABLED` ONLY, **plus an on-demand door in the voice router** |
| durable row | ⛔ none S7 would recognise — a `voice_proactive_insights` row | the same |

⭐ **The ledger's own docstring already names B as the thing it replaced**
(`api/services/awareness/regime_snapshots.py:5-9`):

> *"nothing in the app can say 'the regime just flipped' durably (the existing
> `voice_proactive_service.maybe_emit_regime_shift()` only compares against text in the user's last
> voice-session summary -- a heuristic, not a ledger)."*

⛔ **It was not replaced. Both are wired.** So an absorption that reproduces only R4 will report
`legacy_only` for every fire B makes — an alert a member LOSES at the flip — and an absorption that
reproduces both must decide which prior-label authority wins. **Neither decision has been recorded
anywhere, and it is the first thing an approval line must name.**

⚠️ **THE FLAG STATE IS NOT MEASURED IN THIS PACKET.** `CLAUDE.md` records a live read of
2026-08-09 showing `COMPASS_AUTOMATION_ENABLED=1` and `AWARENESS_ENGINE_ENABLED=1` on `web`. That is
five weeks old and is a claim. ⛔ Re-read both live before any line is written.

---

## 2. The regime authority, and what it actually is

`api/services/voice_regime_classifier.py` — DEC-13's authority, and worth stating plainly because
the type's name suggests something crisper than what ships:

- **Five labels**, declared once at `:24`: `bull_trend`, `bull_correction`, `distribution`, `chop`,
  `bear_trend`.
- **A weighted vote, not a rule** (`_classify`, `:69-199`) over six inputs — % above 50MA, % above
  200MA, new highs vs lows, VIX, distribution days, the UCT exposure rating, the breadth score.
  `confidence` is *the winner's share of total votes* (`:196-198`), which is a share, **not a
  probability**.
- **A 15-minute TTL cache** (`_TTL_SECONDS = 900`, `:205`) over `get_current_regime()`.
- **Its inputs are the morning wire's push.** `_fetch_signals` (`:38-66`) reads
  `engine.get_breadth()`, plus a VIX snapshot. ⭐ **So the label can only move when breadth moves**,
  and `CLAUDE.md` records that the exposure rating *"is pushed by the morning wire and is not
  derivable intraday."*

⛔ **CONSEQUENCE FOR CP2's COMPARISON, and it is the same shape as `scan-membership-change`'s:**
this predicate's honest cadence is close to **once a day**, not once per 20-minute cycle. Five
trading sessions of forward data is a handful of comparable events, and the report must print the
count rather than let a small `n` read as agreement.

**The ledger** — `awareness_regime_snapshots(id, label, confidence, created_at)`,
`regime_snapshots.py:21-30`, in `auth.db`, append-only, one row appended per cycle
**unconditionally** (`record_snapshot`'s docstring, `:57-59`: *"Called once per scan cycle,
unconditionally -- this table is a ledger. Flip detection is a read-then-write done by the CALLER"*).
`engine.py:156-161` is that caller: read `get_last_label()`, then classify, then append.

---

## 3. ⛔⛔ THE IN-APP-ONLY DECISION — quoted, and it is NOT what it looks like

The completion plan's row 7 says: *"⚠️ Currently in-app delivery only, deliberately, to avoid
mass-emailing every holder on every flip."* The decision is real and is in the code.
`api/services/awareness/engine.py:236-241`, verbatim:

```python
    # Away-deliver (email/Discord) only for personal, ticker-specific insights
    # above the floor. Regime flips are market-wide/systemic (symbol=None) — they
    # surface in-app + spoken at session start, but must NOT blast every position
    # holder's inbox on every flip (calm/surgical). Operator can add a dedicated
    # regime-change email later if desired.
    if importance >= _DELIVER_IMPORTANCE_FLOOR and candidate.symbol:
```

`CLAUDE.md` carries the same sentence: *"Regime-flip delivery is in-app only (deliberate, to avoid
mass-emailing every position holder on every flip). If you want a 'regime changed' email, add it
back with a confidence gate."*

### 3.1 ⭐⭐ THE SHARPEST FINDING IN THIS PACKET: the mechanism is `and candidate.symbol`

**The in-app-only property is not a rule about regimes. It is a structural consequence of
`symbol=None`.** `rule_regime_flip` returns `symbol=None` (`rules.py:135`), so the second half of
`engine.py:241` is false and the away-delivery branch is unreachable — for this rule, **by
construction**.

⛔ **THAT IS WHY ABSORPTION IS DANGEROUS HERE IN A WAY THE PLAN'S SENTENCE DOES NOT CONVEY.**
S7 predicates carry an `entity_scope` with an optional `symbol` (SPEC-S7 §5.2, amended 2026-09-11)
and a per-predicate `channels` list. A `regime-change` predicate registered with a symbol — because
"which names does this flip affect" is an obvious future feature — or with the type's default
channel routing, **acquires email and Discord delivery to every position holder on every flip, and
nothing in the type's name, its schema or its evaluator would say so.** The guard that prevents it
today is one conjunct in a different module's `if`.

### 3.2 ⛔ Does absorption change the decision? — **NO, AND IT MUST BE PINNED, NOT INHERITED**

**The recommendation:**

1. ⛔ **`regime-change`'s registration pins its channel routing to IN-APP ONLY, as a declared field,
   with the reason in the module docstring citing `engine.py:236-241`.** A structural accident must
   not be carried forward as an assumption; it becomes a written contract or it is not preserved.
2. ⛔ **A rail asserting the type never reaches `delivery.py`'s email or Discord channels** — the
   import-absence idiom `price-level` CP1 used, extended to the CHANNEL, because at CP1–CP2 the type
   imports no delivery at all and the guard must survive the checkpoint where it does.
3. **The confidence gate the code invites (`"add it back with a confidence gate"`) is a PRODUCT
   decision and is out of scope for every checkpoint below.** Recording it here so nobody reads
   `confidence` being present in the schema as authorization to route on it.
4. ⚠️ **And path B's importance is a hard-coded 8** (`voice_proactive_service.py:290`), which is
   exactly `_DELIVER_IMPORTANCE_FLOOR`. It stays in-app only because it also passes `symbol=None`
   into `add_insight` directly rather than through `_fire_candidate` — **a second module relying on
   the same accident.** Two independent code paths whose email-silence rests on one convention is
   the state this ruling exists to end.

---

## 4. ⛔ F-S7-RC-1 — THE DEDUP THE DOCSTRING PROMISES DOES NOT EXIST

`rule_regime_flip`'s docstring (`rules.py:112-116`) says:

> *"dedup_key is label-scoped (not per-user), so add_insight's 6h per-symbol cooldown naturally
> suppresses repeat firing for the SAME flip across scan cycles while allowing a genuine
> flip-back-and-forth to re-fire (different label string)."*

**Measured, both halves are false against the shipped code.**

1. **The `dedup_key` never reaches `add_insight`.** `engine.py:225-232` passes
   `symbol=candidate.symbol`, and its own comment (`:220-224`) records the change: *"Persist the
   CLEAN ticker (candidate.symbol) as the displayed symbol, NOT the composite dedup_key… add_insight
   now namespaces the cooldown by (symbol, kind)."* For a regime flip `candidate.symbol` is `None`,
   so `REGIME:{label}` is computed at `rules.py:142` and discarded.
2. **There is no cooldown at all for a null symbol.** `voice_proactive_service.py:87` —
   `if symbol:` — so the per-(symbol, kind) query at `:88-95` is **skipped entirely**. The only
   remaining bound is `MAX_INSIGHTS_PER_USER_PER_DAY = 8` (`:28`), shared across every insight kind.

⭐ **What actually suppresses a repeat is the LEDGER, not the cooldown.** `record_snapshot` is
called every cycle (`engine.py:161`), so the next cycle's `prev_label` equals the label just
recorded and `rules.py:122` returns `[]`. The behaviour is right; **the stated mechanism is wrong**,
and the difference is load-bearing at the edge the docstring specifically claims to handle: a label
that oscillates A→B→A across two cycles fires **twice, with no cooldown between them**, bounded only
by the shared 8/day cap — and each of those firings can crowd out that member's `daily_focus`
(`CLAUDE.md`'s recorded M2 limitation).

⛔ **An absorption must reproduce the LEDGER's suppression, not the cooldown's** — reading the
docstring and building a 6h symbol cooldown would produce a rule that agrees with the legacy one
almost always and diverges exactly on the oscillation the docstring was written about.

---

## 5. What CP1 would be — REGISTRATION + PARAMS SCHEMA ONLY

*(Not authorized.)*

**CP1 — `regime-change` registration.**

1. `api/services/alert_taxonomy/regime_change.py` — `TYPE_ID`, `PARAMS_SCHEMA`, `register()`.
   **No evaluator. No delivery. No read of `awareness_regime_snapshots`. No scheduler entry.**
2. `PARAMS_SCHEMA`. SPEC-S7 §5.2 pins this type as `{}` — *"no params — the predicate is 'the label
   changed since last cycle,' global"*. ⭐ **This packet recommends AGAINST the empty schema**, on
   the F-S7-2 / F-S7-EP-1 precedent, and pins instead:
   - `labels: list[str] | null` — the five from `voice_regime_classifier.REGIMES` (`:24`),
     **derived by AST, never hand-typed**; `null` = any flip. Unpopulated today (both legacy rules
     fire on ANY change), pinned because "tell me only when it goes to `bear_trend`" is the obvious
     first widening and a live schema is expensive to widen.
   - `min_confidence: float | null` — unpopulated; `null` = no gate. Pinned because the code
     explicitly invites it (`CLAUDE.md`: *"add it back with a confidence gate"*), and pinning an
     unpopulated field is how that invitation stops being a code comment.
   - `stake: "positions" | "watchlist" | "either" | "any"` — the legacy R4 gate is `either`
     (`rules.py:125-128`); `any` (an inactive account) is pinned and **unreachable today**.
   - `prior_label_source: "ledger" | "session_summary"` — ⛔ **the field that makes §1's two-emitter
     problem declarable instead of assumed.** `ledger` is R4; `session_summary` is path B. A
     predicate cannot be built without choosing, and the choice becomes visible in the row.
   - `channels: ["in_app"]`, **fixed**, per §3.2.
3. A rail asserting the label vocabulary equals `voice_regime_classifier.REGIMES`, so a sixth regime
   added there goes red here.
4. F-S7-RC-1 (§4) recorded in SPEC-S7 §5.2 at the point of use, replacing the `{}` shape and the
   `awareness/rules.py:108-143` sole-source attribution with both emitters.
5. The parity control at `tests/test_alert_taxonomy_filing_watch_parity.py:621` updated **by
   naming** — see §6.

⛔ **Explicitly NOT in CP1:** no evaluator, no `delivery.py` call, no read of the ledger, no change
to `awareness/**` or `voice_proactive_service.py`, no scheduler entry.

**CP2 — dark evaluator + FORWARD-ONLY comparison harness, harness-armed predicates ONLY.**
Four outcomes — `agreed` / `new_only` / `legacy_only` / `not_comparable` — never a pass rate;
`legacy_only` is an alert a member LOSES at the flip. ⛔ **No replay, ever.** This type's own reason
is the sixth distinct one the programme has met: **the classifier is a 15-minute TTL cache over a
morning-wire push, and no prior `signals` dict is persisted anywhere** — the ledger stores only
`(label, confidence)` (`regime_snapshots.py:21-27`), so a past cycle's vote cannot be reconstructed
and "what would this predicate have said on Tuesday" has no input. ⭐ Additionally: because
`record_snapshot` writes on **every** cycle including the ones a dark evaluator does not drive, the
harness must not append to that ledger — a second writer would move the legacy rule's own
`prev_label` and the comparison would be measuring the harness.

**CP3 — projection of real member rows, `rollout:s7-dark` cohort ONLY, still dark.**
⛔ Cohort via `api/services/rollout.py:100` `cohort_user_ids(rollout.S7_DARK)` — **never a role
check**; `rollout.py:29-38` rules that an empty cohort means NO MEMBERS and never a fallback to
admins. ⚠️ **For THIS type a projection is unusual and must be stated:** the predicate is global, so
"projecting member rows" means projecting the *stake* test (does this member hold a position or
watch a symbol) over the cohort, from `j2_positions` and `watchlist_items` read-only — the same two
bulk queries `engine.py:44-63` already runs.

**CP4 — all members, still dark.** A tag assignment (`rollout.py:258`), not a code path.

**FLIP — its own line, and for this type it is TWO switch-offs, not one** (§1). Delivery plus the
legacy switch-off in the same PR, and the packet's §3.2 channel pin travels with it.

---

## 6. ⛔⛔ THE SERIALIZER — `_EXPECTED`, and it flips BY DESIGN

`tests/test_alert_taxonomy_filing_watch_parity.py:621`:

```python
_EXPECTED = {"document-arrival", "price-level", "event-proximity", "catalyst-match"}
```

`_declared_trigger_types()` (`:549-562`) reads every module-level `TYPE_ID = "..."` in
`api/services/alert_taxonomy/` **from the AST — never a grep, never a hand-typed roster** — with two
non-vacuity controls (`:627-631`), and the assertion at `:633` requires equality. **Registering
`regime-change` turns that test RED, and the red is the rail working.**

⛔ **The docstring's steps, reproduced from `:577-583`:**

> 1. Add the new type to `_EXPECTED` below.
> 2. Give `alerts._s7_durable_alerts` a reconstruction branch for it — without one its fires are
>    silently dropped from the member's feed (proved by the sibling test below).
> 3. Re-run the three observable classes above against the new type's own fixture event, and re-run
>    the mutation proof.

⚠️ The docstring numbers **three** steps; the failure message at `:636-637` says *"the four steps"*.
The list is the authority; the count drifted — the same shape as the COT router's "4 routes" beside
five.

`api/services/alerts.py:142-165` confirms step 2: `_s7_durable_alerts` dispatches on `trigger_type`
with **one** branch (`:160`), and `:157-159` says a second type should ADD one rather than
generalize. `test_the_feed_bridge_silently_drops_a_trigger_type_it_has_no_branch_for` (`:641`)
demonstrates that any other type's fire produces **no feed row and no error**.

⭐ **For `regime-change` step 2 has a wrinkle worth naming now:** `_s7_durable_alerts` reconstructs
an alert shape from a fire, and every existing shape is ticker-bearing. A market-wide fire with
`symbol=None` is the first that is not. ⛔ Step 2 is a **PRECONDITION at CP3** and its branch will
need a symbol-less shape — do not discover that when a real member's feed is silently short a row.

---

## 7. ⛔ WATCH-COVERAGE CLASSIFICATION

Measured by importing `reachable_paths(root)` / `watched_paths(root)` from
`tools/flow_worker_watch_coverage.py` with an EXPLICIT root (no git). **reachable = 154,
watched = 24.** Control: `api/flow_worker_main.py` is reachable; `api/services/awareness/engine.py`
is not.

| module | reachable | watched | classification |
|---|---|---|---|
| `api/services/awareness/rules.py` | **no** | no | outside — no constraint |
| `api/services/awareness/engine.py` | **no** | no | outside — no constraint |
| `api/services/awareness/regime_snapshots.py` | **no** | no | outside — no constraint |
| `api/services/voice_regime_classifier.py` | **no** | no | outside — no constraint |
| `api/services/alert_taxonomy/{registry,receipts,delivery,db}.py` | **yes** | no | ⛔ **INERT STRAND** |
| `api/services/alerts.py` | **yes** | no | ⛔ **INERT STRAND** |
| `api/services/watchlist_alert_service.py` | **yes** | no | ⛔ **INERT STRAND** |
| a NEW `alert_taxonomy/regime_change.py` | **no** (until `register()` is wired) | no | outside — until CP3 |

⭐ **This type is the cleanest of the four on this axis: every legacy module it touches is outside
flow-worker's closure.** CP1 and CP2 strand nothing.

⛔ **CP3 strands the substrate**, because wiring `register()` puts the new module in the closure
through `alerts.py` / `registry.py` (path traced: `flow_worker_main → auth_surface_check →
flow_proxy → auth_service → auth_db → journal_two.db → journal_two.notes → ticker_meta → groups →
groups_gates → screener.snapshot_db → screener.live_tier → screener.technicals → indicator_compute →
ast_interpret → scan_definition → user_definitions → alert_rev_migration → watchlist_alert_service →
alerts → alert_taxonomy.document_arrival → alert_taxonomy.registry`). Run
`python tools/flow_worker_watch_coverage.py` at review; a red is a REVIEW GATE per
`docs/runbooks/deploy-windows.md`, not a block.

---

## 8. Method

- **CODE, NEVER PROSE.** Every literal search ran over source with docstrings and comments removed —
  each file parsed with `ast`, every string-only `Expr` statement blanked, `ast.unparse` re-emitted.
  **1,213 files under `api/` parsed, 0 unparsable.** **CONTROL:** a docstring-only sentence
  (`"a trader would act on it"`) is found in **1** raw file and **0** stripped files, while
  `def record_hits` is still found — the stripper removes prose and still sees code.
- **§1's second emitter was found that way**, not by reading a document: `maybe_emit_regime_shift`
  has **6** occurrences in stripped source — its definition plus five call/import sites in
  `api/main.py` and `api/routers/voice.py`.
- **Reachability** — `reachable_paths(root)` / `watched_paths(root)` with an explicit root, no git.
- No git command was run; no SHA was verified.

---

## 9. ⚠️ WHAT COULD NOT BE MEASURED

1. **`COMPASS_AUTOMATION_ENABLED` and `AWARENESS_ENGINE_ENABLED` live on `web`.** Whether either
   legacy emitter runs today rests on a five-week-old reading in `CLAUDE.md`.
2. **How many rows `awareness_regime_snapshots` holds, and how often the label actually flips.**
   ⛔ **This is the number that decides whether CP2 can observe anything at all** — a type whose
   event happens twice a month cannot be verdicted in five sessions, and a dark run over zero flips
   prints four zeroes and reads like agreement.
3. **How many members have a voice-session summary** — i.e. path B's population.
4. **How often the shared 8/day insight cap is actually hit**, which is what decides whether §4's
   missing cooldown has ever mattered.
5. **Whether `get_current_regime`'s inputs are fresh in production** — the classifier degrades
   silently to `signals` full of `None` if `engine.get_breadth()` returns `{}` (`:41-45`), and a
   label computed from an empty vote is still a label.

⛔ Each is one read-only query or one `railway variables --kv` away, and **none was performed.**

"""Wave 1.5 item 3 — the publication floor. ONE authority for the predicate, four call sites.

**The rule (SESSION-STATE, owner):** *no PRINCIPLE or MARKET_SIGNAL publishes under a named author
unless stability = 1.0 (3/3) AND confirmed or provisional-with-evidence; 2/3 may surface only in
the admin review queue.*

**R89 (owner ruling, 2026-09-17) widened WHICH types the rule governs, and nothing else.** CALL —
and, on the evidence recorded beside `FLOORED_TYPES`, MENTION and NEGATIVE_CALL — are now floored
on the same predicate, the same MIN_RUNS, the same review-queue pairing. ⛔ The ruling is about
membership of one tuple: `passes()`, `sql_clause()`, `enqueue_blocked` and `retract_passed` are
untouched, because a second spelling of the predicate for a second set of types is exactly the
defect this module exists to prevent (`lesson_a_guard_repeated_is_a_guard_unproved`).

⛔⛔ **ONE PREDICATE, NOT FOUR COPIES.** Four different mechanisms reach these record types, so the
floor has four call sites — but a guard written out four times cannot be mutation-proved and
drifts silently (`lesson_a_guard_repeated_is_a_guard_unproved`: delete every copy but one). Every
site calls `passes()` or `sql_clause()` here.

**The four sites, and why one is not enough** (verified from source, session 3):

| lane | how it reaches the record | site |
|---|---|---|
| dossiers, Model Book drafts | `common.select_records` | `select_records` |
| Brain KB rows | a **direct `wisdom_principles` SELECT** — `select_records` never sees it | `brainkb.export_payload` |
| Ask-AI | the **FTS index**, not `select_records` | `retrieval.search` |
| clip export | untyped SQL over all six types, **no feature flag** | `clips.clip_candidates` |

⛔ **`voice.py` is NOT a site** — it has no PRINCIPLE path at all (`:33-39`, `:44-79`). The original
item-3 wording named it and omitted `modelbook.py`, which does have one.

⚠️ **TWO HOLES A RECORD-LEVEL FLOOR DOES NOT CLOSE, stated here so nobody reads this module as
more than it is.** `retrieval._segment_docs` (`retrieval.py:49-81`) indexes the full text of every
authored segment, so the SENTENCE an unstable PRINCIPLE came from stays retrievable through Ask-AI,
attributed and dated; and `voicefmt.corpus_documents` exports raw segment text regardless of record
type. Closing those is a claim-level change (`R13_ITEM3_SCOPE: CLAIM`), which the owner scoped OUT
of this build (`RECORD`). This module implements *no extracted RECORD publishes*, not *the claim
never reaches a member*.
"""
from __future__ import annotations

import sqlite3
from typing import Any, Optional, Sequence

#: ⛔ NEVER widen this without an owner ruling. Widening STOPS A LANE DEAD: every record in the
#: store today has `stability` NULL, `passes()` fails closed on NULL, so the day a type is added
#: here every consumer of that type returns nothing until item 2's N=3 voting has scored it. That
#: is the intended cost, and it is why each entry below names the ruling that bought it.
#:
#: ⭐ **R89 (owner ruling, 2026-09-17): the floor governs CALL as it already governs PRINCIPLE and
#: MARKET_SIGNAL**, and it has to be serving BEFORE `WISDOM_DESK_MARKERS_ENABLED` can open —
#: desk markers surface CALLs onto a member's chart (`adapters/desk_markers.py:33,46`).
#:
#: ⭐⭐ **MENTION and NEGATIVE_CALL come with it, decided by evidence, not by sympathy with CALL.**
#: The test is R50's map (`tests/test_wisdom_type_gating_audit.py::DECLARED_CONSUMERS`): does a
#: consumer R50 classifies MEMBER surface the type? Read off the AST of every `select_records`
#: call site in this package on 2026-09-17, not from memory:
#:
#:   | type          | MEMBER consumer that surfaces it                                   | verdict |
#:   |---------------|--------------------------------------------------------------------|---------|
#:   | CALL          | desk_markers:46 · dossier:36 · modelbook:86,129 · brainkb:117       | FLOOR   |
#:   | MENTION       | desk_markers:46 (`_KINDS` = {CALL, MENTION}) — a member's chart      | FLOOR   |
#:   | NEGATIVE_CALL | dossier:36 · modelbook:129 — both MEMBER in R50's map               | FLOOR   |
#:   | LEVEL         | **none** — no typed read of LEVEL exists anywhere                   | UNFLOORED |
#:
#: ⛔ **LEVEL stays out, and the reason is a measurement, not an opinion.** Fifteen
#: `select_records` call sites exist in `api/services/wisdom/**`; **not one** names LEVEL. Its
#: only two appearances are (a) `brainkb._ALL_TYPES` (`brainkb.py:44,93`), a support lookup that
#: passes `include_unstable=True` on purpose so it can DATE a principle it is not publishing — the
#: floor is bypassed there by design whatever this tuple says — and (b) `clips.clip_candidates`,
#: an untyped SQL export over all six types behind `require_push_secret`, which already applies
#: `sql_clause()` and therefore picks up every type added here for free. Adding LEVEL would block
#: nothing a member can see and would silently shrink an internal clip export. **Re-derive this,
#: never re-read it**: the AST sweep is two lines, and a MEMBER consumer that starts reading LEVEL
#: is exactly the change this note must not be allowed to outlive.
#:
#: ⚰️ This comment used to read *"the two types the rule names … quietly extending the publication
#: floor to CALL/MENTION/LEVEL would stop those lanes dead."* Under R89 the extension is no longer
#: quiet, and "stopping the lane dead" is the point until the scores exist — but the warning was
#: right about the mechanism and is kept, one paragraph up, as the first thing a widener reads.
FLOORED_TYPES: tuple = ("PRINCIPLE", "MARKET_SIGNAL", "CALL", "NEGATIVE_CALL", "MENTION")

#: The types the floor deliberately does NOT govern, named rather than implied. ⛔ A test asserts
#: this is exactly `writer.RECORD_TYPES - FLOORED_TYPES`, so the two can never quietly disagree
#: and "we forgot one" cannot be mistaken for "we ruled on it".
UNFLOORED_TYPES: tuple = ("LEVEL",)

#: Review-queue tab and reason code for a blocked record.
REVIEW_TAB = "contradictions"
REASON = "below_publication_floor"

#: ⭐ Owner ruling Q17 / R17_MIN_RUNS, 2026-09-14: **FLOOR, min runs 3.**
#:
#: A stability score is only a measurement if enough passes went into it. `stability` is
#: `runs_present / N` (item 2's wording), so a score computed over fewer than this many runs is
#: not a weak score — it is an UNMEASURED one, and it is treated exactly like NULL: it blocks.
#:
#: ⛔ Without this, `stability = 1.0` from a SINGLE run would sail through the floor. One run
#: agreeing with itself is not agreement, and 1/1 = 1.0 is the most confident-looking number the
#: pipeline can produce for the least evidence. That is the hole Q17 closes.
#:
#: ⚠️ This is the ONE place the rule lives. It is not derived from `STABILITY_FLOOR`, which
#: answers a different question (how much agreement), and it deliberately has no env override —
#: a publication floor that can be lowered from the environment is not a floor.
MIN_RUNS = 3


def floor_value() -> float:
    """⛔ Read from `golden.STABILITY_FLOOR`, its single definition — never a literal here.

    ⭐ **Why 0.8 and "3/3" are the same rule, and when they stop being.** With three passes the
    only attainable values are 0, 1/3, 2/3 and 1, so `>= 0.8` admits **exactly 1.0** — the owner's
    "stability = 1.0 (3/3)" and `STABILITY_FLOOR` agree precisely at N=3. They DIVERGE at other
    run counts: at N=5, 4/5 = 0.8 would pass this floor while not being 5/5. If voting ever runs
    at anything but 3 passes that is an owner question, not an implementation detail.
    """
    from api.services.wisdom.extract.golden import STABILITY_FLOOR

    return float(STABILITY_FLOOR)


def passes(record_type: Optional[str], stability: Any, runs: Any = None) -> bool:
    """Is this record allowed to publish under a named author?

    Two conditions, both required (owner ruling Q17: **FLOOR**, min runs `MIN_RUNS`):
      1. the score was measured over at least `MIN_RUNS` passes, and
      2. `stability >= golden.STABILITY_FLOOR`.

    ⛔ **FAIL-CLOSED ON NULL, AND ON TOO-FEW-RUNS.** Every record that exists today has no
    stability measurement, so NULL blocks. A score over fewer than `MIN_RUNS` passes is treated
    identically to NULL — it is unmeasured, not merely weak. The alternative, treating unmeasured
    as passing, is the one failure that cannot be walked back: it publishes before anyone notices
    the rail is inert.

    ⛔ **Never `== 1.0`.** The rule is a floor, so it is expressed as a floor. At N=3 the two
    spellings coincide — the attainable values are 0, ⅓, ⅔, 1 and only 1.0 clears 0.8 — which is
    exactly why "stability = 1.0 (3/3)" and this predicate agree at the intended run count. They
    diverge at N=5, where 4/5 = 0.8 passes, and Q17 ruled FLOOR for that case.
    """
    if record_type not in FLOORED_TYPES:
        return True
    if stability is None or runs is None:
        return False
    try:
        if int(runs) < MIN_RUNS:
            return False
        return float(stability) >= floor_value()
    except (TypeError, ValueError):
        # ⛔ an unparseable score, or an unparseable run count, is an unknown one — and unknown
        # blocks. Silently coercing either would turn a data defect into a publication.
        return False


def sql_clause(alias: str = "r", *, type_column: str = "record_type",
               stability_column: str = "stability", runs_column: str = "stability_runs") -> tuple:
    """The same predicate as SQL, for the lanes that filter in the query.

    ⛔ Must stay in lockstep with `passes()` — `test_the_sql_clause_agrees_with_the_python_predicate`
    cross-checks every combination rather than trusting that they were written together.

    Returns `(clause, params)`. ⛔ The parameters are bound, never interpolated; the column names
    are callers' identifiers and are validated so a caller cannot inject through them.
    """
    for name in (alias, type_column, stability_column, runs_column):
        if not name.replace("_", "").isalnum():
            raise ValueError(f"not an identifier: {name!r}")
    placeholders = ",".join("?" * len(FLOORED_TYPES))
    clause = (f"({alias}.{type_column} NOT IN ({placeholders})"
              f" OR ({alias}.{stability_column} IS NOT NULL"
              f" AND {alias}.{runs_column} IS NOT NULL AND {alias}.{runs_column} >= ?"
              f" AND {alias}.{stability_column} >= ?))")
    return clause, [*FLOORED_TYPES, MIN_RUNS, floor_value()]


#: R79 (owner ruling, 2026-09-18) — PENDING is not a verdict, and it is not queued like one.
STATUS_PUBLISH = "PUBLISH"
STATUS_PENDING = "PENDING"
STATUS_BLOCK = "BLOCK"


def status(record_type: Optional[str], stability: Any, runs: Any = None) -> str:
    """PUBLISH / PENDING / BLOCK — the three-way read `passes()` deliberately collapses to two.

    ⛔⛔ **`passes()` and `sql_clause()` are UNCHANGED and remain the only question the four
    publish-path sites ask.** R79 governs one thing only: whether `enqueue_blocked` treats an
    unmeasured record the same as a measured-and-failing one. It does not, and this function is
    where that distinction is made — nowhere else needs it, and nowhere else should ask it.

    * **PENDING** — `stability` or `runs` is NULL, unparseable, or `runs < MIN_RUNS`. Not yet a
      verdict: item 2's N=3 voting has not finished, so there is nothing to review.
    * **BLOCK** — measured (`runs >= MIN_RUNS`) and `stability` is below the floor. A verdict.
    * **PUBLISH** — not a floored type, or measured and at/above the floor.

    ⭐ Both PENDING and BLOCK fail `passes()` identically — `status(...) == STATUS_PUBLISH` is
    exactly `passes(...)`, cross-checked by `test_status_and_passes_agree_on_every_case`.
    """
    if record_type not in FLOORED_TYPES:
        return STATUS_PUBLISH
    if stability is None or runs is None:
        return STATUS_PENDING
    try:
        runs_i = int(runs)
    except (TypeError, ValueError):
        return STATUS_PENDING
    if runs_i < MIN_RUNS:
        return STATUS_PENDING
    try:
        stability_f = float(stability)
    except (TypeError, ValueError):
        return STATUS_PENDING
    return STATUS_PUBLISH if stability_f >= floor_value() else STATUS_BLOCK


def block_sql_clause(alias: str = "r", *, type_column: str = "record_type",
                     stability_column: str = "stability", runs_column: str = "stability_runs") -> tuple:
    """The BLOCK half of `NOT sql_clause()` — measured, and below the floor. What `enqueue_blocked`
    now enqueues. ⛔ Must stay in lockstep with `status()`; cross-checked the same way `sql_clause`
    is checked against `passes()`."""
    for name in (alias, type_column, stability_column, runs_column):
        if not name.replace("_", "").isalnum():
            raise ValueError(f"not an identifier: {name!r}")
    placeholders = ",".join("?" * len(FLOORED_TYPES))
    clause = (f"{alias}.{type_column} IN ({placeholders})"
              f" AND {alias}.{stability_column} IS NOT NULL AND {alias}.{runs_column} IS NOT NULL"
              f" AND {alias}.{runs_column} >= ? AND {alias}.{stability_column} < ?")
    return clause, [*FLOORED_TYPES, MIN_RUNS, floor_value()]


def pending_sql_clause(alias: str = "r", *, type_column: str = "record_type",
                       stability_column: str = "stability", runs_column: str = "stability_runs") -> tuple:
    """The PENDING half of `NOT sql_clause()` — unmeasured, or measured over too few runs. What
    `enqueue_blocked` now counts but does NOT enqueue. ⛔ Same lockstep requirement as
    `block_sql_clause`."""
    for name in (alias, type_column, stability_column, runs_column):
        if not name.replace("_", "").isalnum():
            raise ValueError(f"not an identifier: {name!r}")
    placeholders = ",".join("?" * len(FLOORED_TYPES))
    clause = (f"{alias}.{type_column} IN ({placeholders})"
              f" AND ({alias}.{stability_column} IS NULL OR {alias}.{runs_column} IS NULL"
              f" OR {alias}.{runs_column} < ?)")
    return clause, [*FLOORED_TYPES, MIN_RUNS]


def records_pending_count(conn: sqlite3.Connection) -> dict:
    """R79: how many floored records are UNMEASURED right now, per type. Never enqueued — this
    is the only place that number is visible, which is why the admin status route reads it."""
    clause, params = pending_sql_clause("r")
    rows = conn.execute(
        f"SELECT r.record_type, COUNT(*) FROM wisdom_records r WHERE {clause} GROUP BY r.record_type",
        params).fetchall()
    per_type = {row[0]: row[1] for row in rows}
    return {"records_pending": sum(per_type.values()), "records_pending_by_type": per_type}


def principles_clause(alias: str = "p") -> tuple:
    """`wisdom_principles` has no `record_type` column — every row in it IS a PRINCIPLE.

    ⛔ It carries its OWN `stability_runs` (migration `core_010`) rather than joining
    `wisdom_records` for it. The Brain KB lane reads this table directly and a principle is a
    cross-segment identity that can be supported by several records, so "which record's run count"
    has no single answer — the score and its denominator have to travel together on the row that
    carries the score.
    """
    if not alias.replace("_", "").isalnum():
        raise ValueError(f"not an identifier: {alias!r}")
    return (f"({alias}.stability IS NOT NULL AND {alias}.stability_runs IS NOT NULL"
            f" AND {alias}.stability_runs >= ? AND {alias}.stability >= ?)"), [MIN_RUNS, floor_value()]


def reason(record_type: Optional[str], stability: Any, *, runs: Any = None,
           run_id: Optional[str] = None) -> str:
    """The reason code an admin reads. ⛔ Names the floor, the value (or NULL) and the run.

    A reason that says only "blocked" makes the queue unactionable — the first question an admin
    asks is *how far below, and measured over what?*
    """
    seen = "NULL (never measured)" if stability is None else f"{float(stability):.3f}"
    where = "" if not run_id else f"; run {run_id}"
    # ⛔ Name WHICH condition failed. "below the floor" on a 1.0 score reads as a contradiction
    # and sends the admin looking for a scoring bug that is not there — the real answer is that
    # one run agreeing with itself is not agreement.
    if runs in (None, ""):
        why = f"stability {seen} was measured over an UNRECORDED number of runs (need >= {MIN_RUNS})"
    else:
        try:
            too_few = int(runs) < MIN_RUNS
        except (TypeError, ValueError):
            too_few = True
        why = (f"stability {seen} was measured over only {runs} run(s), below the minimum {MIN_RUNS}"
               if too_few else
               f"stability {seen} over {runs} run(s) is below the floor {floor_value():.3f}")
    return f"{REASON}: {record_type} {why}{where}"


def enqueue_blocked(conn: sqlite3.Connection, *, limit: int = 500, now=None) -> dict:
    """Surface every BLOCKED record in the admin review queue. Idempotent. PENDING records are
    counted but never enqueued (R79).

    ⛔⛔ **WHY THIS IS A SEPARATE STEP AND NOT A LINE INSIDE `select_records`.** The owner's rule
    says a 2/3 record *"may surface only in the admin review queue"*, and session 3 proved the
    queue is **NOT** upstream of the Brain KB, Ask-AI or dossier lanes — nothing enqueues a
    PRINCIPLE on the publish path at all — so blocking alone makes a blocked record VANISH rather
    than surface. The block and the enqueue therefore have to be paired.

    ⚠️ They are paired by the daily chain, not by the read path, and that is deliberate: the four
    filter sites are member-facing READS running on a read-only connection, and performing a write
    inside one would be both a correctness bug and a per-request cost. This runs once per daily
    run instead.

    ⭐ `review.enqueue` is idempotent through `item_id_for(tab, subject_ref, new)`, so the same
    blocked record re-enqueued every day produces ONE row, not a flood — proved by a test that
    runs it twice and counts.

    ⚰️⚰️ **R79 (owner ruling, 2026-09-18) NARROWS THIS FROM "everything that fails `sql_clause()`"
    TO "everything `block_sql_clause()` matches."** Before R79, a record with zero passes over it
    yet — `stability` and `runs` both NULL, or `runs < MIN_RUNS` — was enqueued on exactly the
    same reason code as a record measured and genuinely below the floor, on the reasoning
    (`test_r89_a_CALL_below_MIN_RUNS_is_pending_and_is_queued_exactly_like_a_PRINCIPLE`, now
    rewritten) that Q17's own motivating case — 1.0 over one run — is the most confident-looking
    number the pipeline can produce for the least evidence, and suppressing its queue row would
    undo what Q17 bought. **R79 is the owner overturning that call, not a bug in it**: an item in
    the queue that means "this hasn't finished voting yet" is not the same fact as "this voted and
    lost," and mixing them meant every fresh extraction — the ordinary, expected state of a record
    before its second and third pass land — showed up in the owner's inbox as if it needed a
    decision. `records_pending_count` is where that number now lives instead: a counter, not a
    queue entry, because nothing is wrong yet.
    """
    from api.services.wisdom.publish import review

    clause, params = block_sql_clause("r")
    rows = conn.execute(
        f"SELECT r.record_id, r.record_type, r.stability, r.stability_runs, r.segment_id, r.author_id "
        f"FROM wisdom_records r WHERE {clause} ORDER BY r.record_id LIMIT ?",
        [*params, int(limit)],
    ).fetchall()
    created = 0
    for row in rows:
        subject = f"record:{row['record_id']}"
        summary = reason(row["record_type"], row["stability"], runs=row["stability_runs"])
        out = review.enqueue(
            conn, tab=REVIEW_TAB, subject_ref=subject, summary=summary,
            new={"reason": REASON, "record_id": row["record_id"], "record_type": row["record_type"],
                 "stability": row["stability"], "stability_runs": row["stability_runs"],
                 "floor": floor_value()},
            evidence={"segment_id": row["segment_id"], "author_id": row["author_id"]},
            recommendation="Hold. Re-measure stability over N=3 before this publishes.",
            now=now,
        )
        created += int(bool(out.get("created")))
    pending_clause, pending_params = pending_sql_clause("r")
    pending_count = conn.execute(
        f"SELECT COUNT(*) FROM wisdom_records r WHERE {pending_clause}", pending_params).fetchone()[0]
    return {"blocked": len(rows), "enqueued": created, "records_pending": pending_count,
            "floor": floor_value()}


#: R47 (2026-09-15) — who the floor signs a retraction as. ⛔ Never a person: an automatic
#: resolution must be distinguishable from an owner's judgement in `wisdom_review_actions`.
RETRACTION_ACTOR = "publication_floor"


def retraction_note(record_type: str, stability, runs, *, identity: str, today: str) -> str:
    """The resolution note. ⛔ Counts and identifiers only — never a quote, name or statement."""
    return (f"{record_type} passed the publication floor at {stability}/{runs} "
            f"under identity {identity} on {today}; retracted by {RETRACTION_ACTOR}")


def retract_passed(conn, *, limit: int = 500, now=None) -> dict:
    """Resolve open floor-block items whose record now PASSES. ⛔ RESOLVED, never deleted.

    ⛔⛔ WHY THIS EXISTS. `enqueue_blocked` is idempotent but one-way: a record that later clears
    the floor keeps its open review row forever, so the owner's queue drifts away from what is
    actually blocked. Measured 2026-09-15 after R43 moved MARKET_SIGNAL's identity: 103 records
    blocked, **153** open `below_publication_floor` rows.

    ⛔ THREE TRAPS, each of which would resolve the wrong row:
      1. **Filter on the tab.** `extract/writer.py:667-670` enqueues an inferred-ticker item with
         the IDENTICAL `record:{record_id}` subject_ref on tab `extraction_audit`. Without the tab
         filter this would close somebody else's item.
      2. **Expect MORE THAN ONE open row per record.** `item_id_for` hashes the block-time
         stability, so every re-block at a new score created a NEW item. Resolve the set.
      3. **Match the reason.** `contradictions` is shared with `review.refresh_contradictions`,
         whose subject_ref has a different shape; `new_json.reason` is the exact discriminator for
         floor-origin rows.

    ⭐ An item a PERSON already decided is untouched for free: `review.act` refuses anything whose
    status is not `open` (409), so a hand-resolved item cannot be reopened or re-resolved here.
    A record that is blocked again later gets a NEW item — same subject_ref, new id — which is the
    link, rather than a reopen.
    """
    from api.services.wisdom.core import timeutil
    from api.services.wisdom.publish import review

    clause, params = sql_clause("r")
    rows = conn.execute(
        f"SELECT q.item_id, r.record_id, r.record_type, r.stability, r.stability_runs "
        f"FROM wisdom_review_queue q "
        f"JOIN wisdom_records r ON q.subject_ref = 'record:' || r.record_id "
        f"WHERE q.tab = ? AND q.status = 'open' "
        f"  AND json_extract(q.new_json, '$.reason') = ? "
        f"  AND r.record_type IN ({','.join('?' * len(FLOORED_TYPES))}) "
        f"  AND {clause} "
        f"ORDER BY q.item_id LIMIT ?",
        [REVIEW_TAB, REASON, *FLOORED_TYPES, *params, int(limit)]).fetchall()

    today = (now or timeutil.iso_et(timeutil.now_et()))[:10]
    identity = _identity_label()
    resolved, skipped = 0, 0
    for row in rows:
        note = retraction_note(row["record_type"], row["stability"], row["stability_runs"],
                               identity=identity, today=today)
        try:
            review.act(conn, row["item_id"], action="resolve", actor=RETRACTION_ACTOR, note=note)
            resolved += 1
        except review.ReviewError:
            # ⛔ Someone decided it between the SELECT and here, or it is no longer open. That is
            # their decision and it stands — counted, never overwritten.
            skipped += 1
    return {"retracted": resolved, "left_to_owner": skipped, "candidates": len(rows)}


def _identity_label() -> str:
    """Which identity the record passed under — recorded so a retraction can be read back."""
    try:
        from api.services.wisdom.extract import reconcile

        return str(getattr(reconcile, "MS_IDENTITY", "KEY"))
    except Exception:
        return "unknown"


def score_silently(ctx) -> dict:
    """Daily-chain entry point. Enqueues blocked records, retracts those that now pass.

    ⛔ Order is load-bearing: enqueue FIRST, then retract. The reverse would retract against the
    previous run's rows and then immediately re-enqueue the same records, churning the queue.
    """
    from api.services.wisdom.core import store

    with store.write() as conn:
        out = enqueue_blocked(conn)
        out.update(retract_passed(conn))
        return out

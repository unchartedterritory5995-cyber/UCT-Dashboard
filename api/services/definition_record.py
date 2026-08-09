"""The rule record: *"this definition evaluated this symbol over this window,
and here is what it said."*

⭐ THE TEMPLATE IS `signature_coverage` (`api/services/signature/ledger.py:115`),
AND IT IS GENERALISED RATHER THAN WIDENED. That table's key is
`(indicator, version, …)` where `indicator` is a Signature rule address
(`dpl`/`gxw`/`fcb`) or the alert lane's canonical address, and `version` is
`rules.VERSIONS[...]`. Putting a `def_hash` in that column would give it two
meanings and make `latest_coverage()` answer across two namespaces. So this is a
SIBLING TABLE in the SAME DATABASE, for the reason `ledger.py` already gives
about its own second table: *"a receipt in a second file could outlive a signal
write that failed, and would then certify a window whose signals were lost — a
confident empty answer, which is worse than a slow one."*

🔴 WHY IT CANNOT BE THE SIGNAL LEDGER, WHICH IS THE WHOLE REASON THIS FILE
EXISTS. The ledger is a NOTIFICATION record. Eleven conditions produce a right
rule and an empty ledger, and FIVE of them are member behaviour:

  * `active = 0` — `list_active()` is `WHERE active=1`, so the rule is never
    evaluated at all;
  * **snoozed** — `record_trigger` returns False before the fire log is touched,
    so the receipt gate (`if recorded:`) never fires;
  * a LEVEL condition inside one armed EPISODE — the fire key is
    `ep:<arm_epoch>`, so "RSI is still above 70" accrues ONE receipt for the
    episode, not one per bar it stays true;
  * a **user-authored `ast` fire**, refused FIRST in every mode — nothing a
    member writes can ever accrue ledger history;
  * the ENTIRE first cycle after a `compute.rev` migration, eaten by
    `consume_if_suppressed` — which is a consequence of an edit the member made.

⇒ Ledger row count is a **LOWER BOUND BIASED BY WHO ARMED AND WHO SNOOZED.**
Publishing it as accuracy is spec §1.6's *"unmeasured accuracy claims"* trap
reached by ARITHMETIC rather than by intent — the more dangerous route, because
every number in it is true.
`docs/decisions/2026-08-08-the-rule-record-is-not-the-ledger.md` carries all
eleven with their evidence, and
`test_claim_for_CANNOT_REACH_the_signal_ledger…` makes the separation structural
rather than intended.

⛔ AND IT IS NOT `alert_shadow_fires` EITHER. Keyed on `alert_id` — still a
record of a MEMBER'S ROW — default off, and measured at 53.0 bytes/row with no
prune at the time of measurement: **279 GB/yr at 10k alerts**. This store states
a RETENTION HORIZON up front, and beyond it a claim **REFUSES** rather than
shrinking. A hit rate recomputed over pruned survivors is a smaller, confident,
wrong number — the ledger's own defect with a different table underneath.

🔴 FORWARD-ONLY FROM CREATION, ENFORCED AND NOT PROMISED. Spec §1.6 forbids
backtest inflation, so the record begins when the definition begins and is EMPTY
ON DAY ONE — which the claim says plainly (`coverage: "unproven"`,
`hit_rate: None`) rather than hiding. `record_evaluation` REFUSES a window that
starts before this record's own origin, so no later pass can quietly reach
backwards and fill in *"what it would have done"*. An EDITED definition starts a
new record for free: `def_hash` is derived from the tree, so different maths is a
different key, and the old record belongs to the old maths.

⛔ A HYPOTHETICAL MAY NEVER SHARE A SURFACE WITH A REAL RECEIPT, AND MAY NEVER BE
SUMMED WITH ONE. There is no column here that could hold one — no `simulated`,
no `source`, no `backfilled`. The absence is the guarantee: a store that cannot
represent a hypothetical cannot accidentally publish one.

TWO COLUMNS THE DESIGN DID NOT SPECIFY, AND WHY THEY ARE HERE
-------------------------------------------------------------
`signature_coverage` certifies EVALUATION only. A record that can say *"we
looked"* and not *"here is what it said"* cannot answer the one question this
task exists for — *"how has this done since I made it"* — and the only remaining
answer would be the ledger's biased count. So each row carries:

  * `bars_evaluated` — the DENOMINATOR, stated rather than inferred. A rate whose
    basis is implicit is `lesson_a_renormalized_score_hides_its_own_basis`.
  * `bars_true`      — the NUMERATOR: on how many of those bars the rule said
    yes, under the scan semantics `<ast> != 0`.

Bars the tree could not compute (warm-up, a NaN pad, a hole) are counted in
NEITHER. They are not evaluations, and folding them into the denominator would
dilute every rate by the length of the longest lookback in the tree.

APPEND-ONLY, LIKE EVERYTHING BESIDE IT
--------------------------------------
One `INSERT`, no `UPDATE`, no rewrite path. `UNIQUE(...)` makes a re-run free.
Every refusal is a `ValueError`, and `False` means EXACTLY ONE thing: this window
is already recorded. Each refusal below says something no other refusal in this
module says — two gates sharing a phrase let a `pytest.raises(match=…)` keep
passing after the OTHER one is deleted, which this branch has already paid for
(Phase C Task 9's M1). `REFUSALS` holds those phrases in one place and a test
asserts they are pairwise distinct AND each one reachable.
"""
from __future__ import annotations

import contextlib
import math
import os
import re
import sqlite3
import threading
import time
from typing import Any, Optional, Sequence

from api.services import user_definitions as _defs
from api.services.signature import ledger

#: ⚠️ OWNER-SETTABLE, AND THE ONLY PLACE THIS NUMBER LIVES. A horizon with two
#: authorities is not a horizon: the prune would delete on one and the claim
#: would refuse on the other, and the gap between them is a window that reads as
#: proven while its rows are already gone. `docs/runbooks/definition-record.md`
#: says how to move it and what it costs.
RETENTION_DAYS = int(os.environ.get("DEFINITION_RECORD_RETENTION_DAYS", "540"))

#: The sibling table's name, exported so a probe can read the column set out of
#: `sqlite_master` instead of typing it (`lesson_probe_names_must_be_derived_not_typed`).
TABLE_NAME = "definition_evaluations"

_SECONDS_PER_DAY = 86_400.0

#: `astHash`'s wire shape, mirrored from `user_definitions.ast_hash`.
_HASH_RE = re.compile(r"^sha256:[0-9a-f]{64}$")

#: ⛔ ONE TIMEFRAME VOCABULARY, NOT TWO. Read off the ledger rather than
#: re-declared, because the failure this guards is a second spelling of one
#: timeframe and a second copy of the whitelist IS that second spelling waiting
#: to happen. The REFUSAL below is worded differently on purpose; the vocabulary
#: is shared, the sentence is not.
_PRODUCT_TIMEFRAMES = ledger._PRODUCT_TIMEFRAMES

#: Every refusal this module can make, by guard name. ⛔ PAIRWISE DISTINCT AND
#: ASSERTED SO: `test_every_refusal_says_something_NO_OTHER_refusal_says` checks
#: that no phrase is a substring of another, and a parametrised behavioural case
#: drives each one — a refusal nobody can reach is a comment.
REFUSALS: dict[str, str] = {
    # ⛔ DELIBERATELY NOT `ledger._coverage_key`'s WORDING. That gate says "a
    # coverage receipt needs a non-empty str for its {name} slot"; a phrase that
    # was a substring of it would let a `raises(match=…)` here keep passing after
    # THAT one was deleted, one table over in the same file.
    "key_slot": "cannot key itself on an empty or non-string",
    "def_hash_shape": "is not a canonical 'sha256:<64 hex>' definition hash",
    "rev_shape": "a definition revision is a whole number, zero or more",
    "timeframe": "would file this record under a timeframe no claim can name",
    "backwards": "its evaluated window runs backwards",
    "empty_window": "it certifies no bars at all",
    "count_shape": "a bar tally is a count, zero or more",
    "more_true": "claims more true bars than it evaluated",
    "stamp": "unusable moment of record",
    "before_origin": "reaches back before this record's origin",
    "negative_horizon": "a retention horizon cannot be negative",
}

#: The two sentences a CLAIM answers with when it cannot answer with a number.
#: They are not refusals of a write — they are what "not enough record" says out
#: loud, so a caller never has to infer it from a `None`.
NO_RECORD_YET = ("no evaluation has been recorded for this definition yet — the "
                 "record begins when the definition does")
NOT_ENOUGH_RECORD = ("not enough record: no proven evaluation contains this "
                     "window")
PARTIAL_RECORD = ("not enough record: some symbols in this claim have no proven "
                  "evaluation over this window")

_SCHEMA = f"""
CREATE TABLE IF NOT EXISTS {TABLE_NAME} (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  def_hash TEXT NOT NULL,
  rev INTEGER NOT NULL,
  tf TEXT NOT NULL,
  sym TEXT NOT NULL,
  first_bar_time INTEGER NOT NULL,
  through_bar_time INTEGER NOT NULL,
  bars_evaluated INTEGER NOT NULL,
  bars_true INTEGER NOT NULL,
  recorded_at REAL NOT NULL,
  UNIQUE(def_hash, rev, tf, sym, first_bar_time, through_bar_time)
);
-- ⚠️ ONE EXTRA INDEX, AND ONLY ONE. The UNIQUE constraint's own index already
-- leads with (def_hash, rev, tf, sym, first_bar_time), which is exactly the
-- prefix every containment and latest-row query below uses — a second index on
-- the same prefix would be pure duplication, and at universe scale an index on a
-- 71-character hash is the single largest line item in this table (measured: it
-- moved bytes/row by ~a third). `recorded_at` is not in that prefix and the
-- prune scans it, so it gets the one index that is not free.
CREATE INDEX IF NOT EXISTS idx_defrec_age ON {TABLE_NAME}(recorded_at);
"""

_WRITE_LOCK = threading.Lock()
_INIT_LOCK = threading.Lock()

#: ⚠️ A SET OF PATHS, NOT A BOOL. `ledger._INITED` is a bool because that module
#: also owns its path; this one does not, so a bool would remember "inited" for
#: whichever file was opened first and every later database would be read with no
#: tables in it. Keying on the resolved path is what makes a per-test store work
#: without a fixture having to know this module exists.
_INITED: set[str] = set()


def db_path() -> str:
    """The signal ledger's own file — resolved THROUGH that module's attribute.

    ⛔ NOT A SECOND READ OF `SIGNAL_LEDGER_DB_PATH`. `ledger._DB_PATH` is
    captured once at import, so an env-var read here would answer differently the
    moment anything repointed one and not the other — and "the same database"
    would become a coincidence of two settings agreeing rather than a fact. The
    shipped precedent is `alert_rev_migration.db_path()`, which resolves through
    `indicator_alert_service._DB_PATH` for exactly this reason.

    ⭐ It also means this module captures NOTHING at import. There is no
    `_DB_PATH` here to go stale, and no path for a test run to create a real
    `/data/signal_ledger.db` behind — the ledger's own isolation reaches this
    table for free.
    """
    return ledger._DB_PATH


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(db_path(), timeout=10.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def _ensure_init() -> None:
    """Create the sibling table on first use of a given database file.

    Lazy for the reason `ledger._ensure_init` is lazy: reads are not flag-gated
    even while the writer ships dark, and a schema created only by an
    enabled-only job 500s every reader in the meantime.
    """
    path = db_path()
    if path in _INITED:
        return
    with _INIT_LOCK:
        if path in _INITED:
            return
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        with contextlib.closing(_connect()) as c:
            c.executescript(_SCHEMA)
            c.commit()
        _INITED.add(path)


# ─── keys ────────────────────────────────────────────────────────────────────

def _definition_key(def_hash: Any, rev: Any, tf: Any) -> tuple[str, int, str]:
    """Validate + canonicalise the (definition, revision, timeframe) key.

    ⛔ `rev` IS IN THE KEY AND IT IS LOAD-BEARING, exactly as `version` is in
    `signature_coverage`: a rev bump means the maths moved, and a record that
    ignored it would go on certifying evaluations for arithmetic that never ran.
    """
    for name, val in (("def_hash", def_hash), ("tf", tf)):
        if not isinstance(val, str) or not val:
            raise ValueError(
                f"the rule record {REFUSALS['key_slot']} {name}, got {val!r}")
    if not _HASH_RE.match(def_hash):
        raise ValueError(f"{def_hash!r} {REFUSALS['def_hash_shape']}")
    # ⛔ THE BOOL CHECK COMES FIRST. `isinstance(True, int)` is True and
    # `True >= 0` is True, so a bool sails through every obvious numeric guard —
    # the trap Phase D Task 5 measured in `stable_stringify`.
    if isinstance(rev, bool) or not isinstance(rev, int) or rev < 0:
        raise ValueError(f"{REFUSALS['rev_shape']} — got {rev!r}")
    if tf not in _PRODUCT_TIMEFRAMES:
        hint = ledger._BARS_STORE_TF_KEYS.get(tf)
        raise ValueError(
            f"{tf!r} {REFUSALS['timeframe']}; expected one of "
            f"{sorted(_PRODUCT_TIMEFRAMES)}"
            + (f" — {tf!r} is the bars-store code for {hint!r}" if hint else ""))
    return def_hash, int(rev), tf


def _symbol(sym: Any) -> str:
    if not isinstance(sym, str) or not sym:
        raise ValueError(
            f"the rule record {REFUSALS['key_slot']} sym, got {sym!r}")
    return sym.upper()


def _count(name: str, value: Any) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError(f"{REFUSALS['count_shape']} — {name} was {value!r}")
    return int(value)


def _bar_key(bar_time: Any) -> int:
    """⛔ ONE COLLAPSE, NOT TWO.

    `ledger._normalize_bar_time` already folds the three upstream encodings of a
    session (YYYYMMDD int, ISO string, unix seconds) onto one key. A second
    normalizer here would be a second spelling of one session in a database where
    the two tables sit side by side — the exact defect that function exists to
    prevent, re-created one table over.
    """
    return ledger._normalize_bar_time(bar_time)


# ─── the write door ──────────────────────────────────────────────────────────

def record_evaluation(def_hash: str, rev: int, tf: str, sym: str,
                      first_bar_time: Any, through_bar_time: Any, *,
                      bars_evaluated: int, bars_true: int,
                      at: Optional[float] = None) -> bool:
    """Record that `(def_hash, rev)` EVALUATED `sym` on `tf` across the inclusive
    bar window `[first_bar_time, through_bar_time]`, saying yes on `bars_true` of
    the `bars_evaluated` bars it could compute.

    True if a NEW row landed; False if this exact window was already recorded, so
    a re-run is free. Every refusal raises `ValueError` — a reader treats this
    row as PROOF and will publish a number on the strength of it, so a row this
    store cannot key is worse than no row.

    ⛔ AN INVERTED WINDOW IS REFUSED. `through < first` certifies nothing, and a
    containment test is satisfied by an inverted row for ANY probe between the
    two ends — a receipt that covers everything by covering nothing.

    ⛔ A ZERO-BAR WINDOW IS REFUSED. "Evaluated no bars" is not evidence of
    evaluation; recorded, it would let a claim read `proven` with an empty basis
    and a `hit_rate` of `0/0`.

    🔴 AND A WINDOW THAT REACHES BACK BEFORE THIS RECORD'S ORIGIN IS REFUSED —
    the structural half of "forward-only from creation". The origin is the
    earliest window start this `(def_hash, rev)` has on file; once the record has
    begun, nothing may extend it backwards. That is what makes *"every number we
    show you accrued after you asked for it"* a property of the schema rather
    than a promise in a docstring.
    """
    def_hash, rev, tf = _definition_key(def_hash, rev, tf)
    sym = _symbol(sym)
    evaluated = _count("bars_evaluated", bars_evaluated)
    true = _count("bars_true", bars_true)
    if evaluated == 0:
        raise ValueError(f"the rule record refuses this row: {REFUSALS['empty_window']}")
    if true > evaluated:
        raise ValueError(
            f"the rule record {REFUSALS['more_true']} ({true} > {evaluated})")

    first_key = _bar_key(first_bar_time)
    through_key = _bar_key(through_bar_time)
    if through_key < first_key:
        raise ValueError(
            f"the rule record refuses this row: {REFUSALS['backwards']} "
            f"({first_bar_time!r} .. {through_bar_time!r})")

    stamped = time.time() if at is None else float(at)
    if not math.isfinite(stamped):
        raise ValueError(f"the rule record refuses this row: {REFUSALS['stamp']} {at!r}")

    _ensure_init()
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        # ⭐ THE ORIGIN IS READ ON THE CONNECTION THAT WRITES, not through
        # `origin()`. Two connections would be two transactions, and the gap
        # between them is where a concurrent first row could set an origin this
        # write never saw — plus it doubled the per-row cost of a universe sweep.
        started = c.execute(
            f"SELECT MIN(first_bar_time) FROM {TABLE_NAME}"
            " WHERE def_hash=? AND rev=?", (def_hash, rev)).fetchone()[0]
        if started is not None and first_key < int(started):
            raise ValueError(
                f"the rule record refuses this row: it {REFUSALS['before_origin']} "
                f"({first_key} < {int(started)}). A record that can be extended "
                f"backwards is a backtest wearing a receipt's clothes.")
        try:
            c.execute(
                f"INSERT INTO {TABLE_NAME}"
                " (def_hash, rev, tf, sym, first_bar_time, through_bar_time,"
                "  bars_evaluated, bars_true, recorded_at)"
                " VALUES (?,?,?,?,?,?,?,?,?)",
                (def_hash, rev, tf, sym, first_key, through_key,
                 evaluated, true, stamped),
            )
            c.commit()
            return True
        except sqlite3.IntegrityError as exc:
            # Same rule as `record_signal` and `record_coverage`: ONLY the dedup
            # collision may become False. Anything else is a DROPPED row, and a
            # dropped row reported as "already recorded" is a claim of coverage
            # that was never written.
            if "UNIQUE constraint failed" not in str(exc):
                raise
            return False


def record_pass(rev: int, tf: str, sym: str, *, ast: Any, bars: Sequence[dict],
                inputs: Optional[dict] = None, budget: Optional[dict] = None,
                at: Optional[float] = None) -> dict:
    """Evaluate `ast` over `bars` for `sym` and record what it said.

    ⭐ THIS IS THE MEMBER-INDEPENDENT HALF, AND ITS INPUT LIST IS THE PROOF. A
    tree, some bars, a symbol, a timeframe. No `user_id`, no `alert_id`, no
    alerts store, no notion of armed, snoozed or active — so the row it writes is
    the same row whether nobody holds this definition, somebody holds it and
    snoozed it, or somebody holds it and is being paged about it right now.
    `test_the_record_is_IDENTICAL_across_armed_snoozed_and_nobody` drives all
    three states for real and compares the resulting stores.

    ⛔ `def_hash` IS DERIVED, NOT ACCEPTED. There is deliberately no `def_hash`
    parameter: the hash comes from the tree via `user_definitions.ast_hash`, so a
    caller cannot file one tree's verdicts under another tree's name, and an
    EDITED definition starts a fresh record for free — different maths, different
    key, and the old record stays with the maths that earned it.

    ⚠️ A BAR THE TREE COULD NOT COMPUTE IS NOT AN EVALUATION, AND THE WARM-UP PAD
    IS MEASURED FROM THE TREE RATHER THAN SPOTTED IN THE OUTPUT. `interpret`
    returns `None` where a column is not computable — but a COMPARISON over an
    incomputable operand returns `0.0`, because `x > NaN` is `False` in both
    lanes by IEEE. So `close > sma(close,50)` answers "no" for its first 49 bars
    and every one of those noes would land in the denominator as a real
    evaluation, diluting every rate on the surface by the length of the longest
    lookback in the tree. `ast_interpret.max_lookback` is the tree's OWN
    declaration of how many bars it needs before its answer means anything, and
    it is the same number the repaint linter and the budget already read — so the
    pad is derived, single-authority, and moves with the tree.

    A `None` or a non-finite value inside the meaningful region is skipped too:
    an infinite verdict is not a measurement.

    Returns `{'def_hash', 'evaluated', 'true', 'first_bar_time',
    'through_bar_time', 'recorded', 'skipped'}`. When nothing was computable the
    row is NOT written and `skipped` says so — a sweep counts that symbol into
    its own `dropped` rather than into a silent nothing (§6.3).

    A `TableRefusal` from the interpreter is NOT caught here. A tree the table
    refuses is refused for every symbol, and swallowing it per symbol would turn
    one loud authoring error into a universe of quietly dropped rows.
    """
    from api.services import ast_interpret

    def_hash = _defs.ast_hash(ast)
    rev, tf_label = _definition_key(def_hash, rev, tf)[1:]
    sym = _symbol(sym)

    bars = list(bars)
    column = ast_interpret.interpret(ast, bars, inputs, budget)
    # `max_lookback` counts BARS NEEDED, so the last warm-up index is one less.
    pad = max(0, ast_interpret.max_lookback(ast) - 1)
    evaluated = 0
    true = 0
    first_t: Any = None
    last_t: Any = None
    for i, value in enumerate(column):
        if i < pad:
            continue
        if value is None or not isinstance(value, (int, float)):
            continue
        if not math.isfinite(float(value)):
            continue
        evaluated += 1
        # ⭐ THE SCAN SEMANTICS, VERBATIM (E-A1): a scan is `<ast> != 0`. The
        # same tree, the same rule, whether it is drawn on a chart or run over
        # the universe.
        if float(value) != 0.0:
            true += 1
        t = bars[i].get("t") if isinstance(bars[i], dict) else None
        if first_t is None:
            first_t = t
        last_t = t

    out = {"def_hash": def_hash, "evaluated": evaluated, "true": true,
           "first_bar_time": first_t, "through_bar_time": last_t,
           "recorded": False, "skipped": None}
    if evaluated == 0:
        out["skipped"] = "no bar in this window was computable"
        return out
    out["recorded"] = record_evaluation(
        def_hash, rev, tf_label, sym, first_t, last_t,
        bars_evaluated=evaluated, bars_true=true, at=at)
    return out


# ─── reads ───────────────────────────────────────────────────────────────────

def covers(def_hash: str, rev: int, tf: str, sym: str, *,
           first_bar_time: Any, through_bar_time: Any) -> bool:
    """Does a single recorded evaluation PROVE this window was evaluated?

    Containment, not overlap, and the distinction is the whole retention story.
    A row qualifies only when it starts no later than the probe's first bar AND
    runs no earlier than the probe's last. Two shorter rows that between them
    touch both ends prove nothing about the gap in the middle, and summing them
    would be the shrink this store exists to refuse.

    A read ANSWERS rather than raises: an inverted probe is `False`, not an
    exception. The write door raises on the same shape because a bad row has no
    rewrite path, while a bad question costs nothing.
    """
    def_hash, rev, tf = _definition_key(def_hash, rev, tf)
    sym = _symbol(sym)
    first_key = _bar_key(first_bar_time)
    through_key = _bar_key(through_bar_time)
    if through_key < first_key:
        return False
    _ensure_init()
    with contextlib.closing(_connect()) as c:
        row = c.execute(
            f"SELECT 1 FROM {TABLE_NAME}"
            " WHERE def_hash=? AND rev=? AND tf=? AND sym=?"
            "   AND first_bar_time <= ? AND through_bar_time >= ? LIMIT 1",
            (def_hash, rev, tf, sym, first_key, through_key),
        ).fetchone()
    return row is not None


def latest_evaluation(def_hash: str, rev: int, tf: str, sym: str) -> Optional[dict]:
    """The newest recorded evaluation for this key, or **None meaning NEVER
    EVALUATED**.

    ⛔ `None`, NEVER `{}`. A falsy-but-present dict is how "never looked" becomes
    "looked and found nothing" at the first `if not result:` a caller writes.
    """
    def_hash, rev, tf = _definition_key(def_hash, rev, tf)
    sym = _symbol(sym)
    _ensure_init()
    with contextlib.closing(_connect()) as c:
        row = c.execute(
            f"SELECT * FROM {TABLE_NAME}"
            " WHERE def_hash=? AND rev=? AND tf=? AND sym=?"
            " ORDER BY through_bar_time DESC, id DESC LIMIT 1",
            (def_hash, rev, tf, sym),
        ).fetchone()
    return dict(row) if row is not None else None


def origin(def_hash: str, rev: int) -> Optional[int]:
    """The earliest window start on file for this definition revision, or None.

    This is where the record BEGAN, and `record_evaluation` will not accept a
    window that starts before it. It is read rather than stored because it is a
    fact about the rows: an append-only table with no rewrite path cannot have
    one and then lose it, except by a prune — and a prune only ever moves this
    number FORWARD, which makes the store strictly stricter, never looser.
    """
    if not isinstance(def_hash, str) or not _HASH_RE.match(def_hash or ""):
        raise ValueError(f"{def_hash!r} {REFUSALS['def_hash_shape']}")
    if isinstance(rev, bool) or not isinstance(rev, int) or rev < 0:
        raise ValueError(f"{REFUSALS['rev_shape']} — got {rev!r}")
    _ensure_init()
    with contextlib.closing(_connect()) as c:
        row = c.execute(
            f"SELECT MIN(first_bar_time) AS m FROM {TABLE_NAME}"
            " WHERE def_hash=? AND rev=?", (def_hash, int(rev)),
        ).fetchone()
    return None if row is None or row["m"] is None else int(row["m"])


def horizon() -> dict:
    """The retention horizon, and the extent of what currently survives.

    `retention_days` is the DECLARED horizon — the one number `prune` uses. The
    other three are measurements of the table as it stands, so a caller reading a
    refusal can see how far back the record actually reaches instead of guessing.
    """
    _ensure_init()
    with contextlib.closing(_connect()) as c:
        row = c.execute(
            f"SELECT MIN(recorded_at) AS oldest_at, MIN(first_bar_time) AS oldest,"
            f" MAX(through_bar_time) AS newest FROM {TABLE_NAME}").fetchone()
    return {
        "retention_days": RETENTION_DAYS,
        "oldest_recorded_at": None if row is None or row["oldest_at"] is None
        else float(row["oldest_at"]),
        "oldest_proven": None if row is None or row["oldest"] is None
        else int(row["oldest"]),
        "newest_proven": None if row is None or row["newest"] is None
        else int(row["newest"]),
    }


def prune(older_than_days: Optional[int] = None, *,
          now: Optional[float] = None) -> dict:
    """Delete rows recorded longer ago than the horizon. Returns what it removed.

    🔴 AND THE CLAIM MUST REFUSE AFTERWARDS, NOT SHRINK. There is no logic here
    that touches a claim — that is deliberate. `claim_for` proves a window by
    CONTAINMENT in a single surviving row, so when the row that contained it is
    gone the answer becomes `unproven` with `hit_rate: None`. A design that
    summed whatever survived would report a smaller, confident, wrong number over
    a window nobody proved — §1.6's trap reached by arithmetic, which is the
    exact defect the signal ledger already has.
    """
    days = RETENTION_DAYS if older_than_days is None else int(older_than_days)
    if days < 0:
        raise ValueError(f"{REFUSALS['negative_horizon']} — got {older_than_days!r}")
    cutoff = (time.time() if now is None else float(now)) - days * _SECONDS_PER_DAY
    _ensure_init()
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        cur = c.execute(f"DELETE FROM {TABLE_NAME} WHERE recorded_at < ?", (cutoff,))
        c.commit()
        deleted = cur.rowcount if cur.rowcount is not None else 0
    return {"deleted": int(deleted), "cutoff_at": cutoff, "retention_days": days}


def known_symbols(def_hash: str, rev: int, tf: str) -> list[str]:
    """Every symbol this definition revision has ever been recorded against."""
    def_hash, rev, tf = _definition_key(def_hash, rev, tf)
    _ensure_init()
    with contextlib.closing(_connect()) as c:
        return [r[0] for r in c.execute(
            f"SELECT DISTINCT sym FROM {TABLE_NAME}"
            " WHERE def_hash=? AND rev=? AND tf=? ORDER BY sym",
            (def_hash, rev, tf))]


def claim_for(def_hash: str, rev: int, tf: str, *,
              first_bar_time: Any, through_bar_time: Any,
              syms: Optional[Sequence[str]] = None) -> dict:
    """What may honestly be said about this definition over this window.

    🔴 THE ONE FUNCTION A PUBLIC CLAIM IS ALLOWED TO READ, and the reason it
    exists is that every OTHER way of answering *"how has this scan done"* is
    biased. It reaches nothing member-keyed: not `signature_signals`, not
    `indicator_alert_fires`, not `alert_shadow_fires`. The import-graph rail in
    `tests/test_definition_record.py` makes that structural.

    ⛔ `hits` AND `hit_rate` ARE `None` UNLESS COVERAGE IS `proven`, AND NEVER
    `0`. A `hit_rate` of `0.0` over an unproven window is a NUMBER, and a number
    gets formatted into a sentence. `None` cannot be, by accident
    (`lesson_a_derived_reference_needs_a_sanity_bound`: return None, not 0).

    `evaluated` reports how much of the window IS proven even when the claim
    refuses, because that is a coverage fact and not a performance one — and with
    `hits` withheld there is no arithmetic a caller can do with it.

    Coverage:
      * `proven`   — every symbol in the claim has a single recorded evaluation
                     containing the whole window;
      * `partial`  — some do and some do not, and `symbols.unproven` names them;
      * `unproven` — none do, which is also what day one looks like.
    """
    def_hash, rev, tf = _definition_key(def_hash, rev, tf)
    first_key = _bar_key(first_bar_time)
    through_key = _bar_key(through_bar_time)

    out: dict[str, Any] = {
        "coverage": "unproven",
        "window": (first_key, through_key),
        "symbols": {"requested": 0, "proven": 0, "unproven": []},
        "evaluated": 0,
        "hits": None,
        "hit_rate": None,
        "refusal": None,
        "horizon": horizon(),
    }
    if through_key < first_key:
        out["refusal"] = REFUSALS["backwards"]
        return out

    if syms is None:
        wanted = known_symbols(def_hash, rev, tf)
    else:
        wanted = sorted({_symbol(s) for s in syms})
    out["symbols"]["requested"] = len(wanted)
    if not wanted:
        out["refusal"] = NO_RECORD_YET
        return out

    _ensure_init()
    proven: list[sqlite3.Row] = []
    unproven: list[str] = []
    with contextlib.closing(_connect()) as c:
        for sym in wanted:
            row = c.execute(
                f"SELECT * FROM {TABLE_NAME}"
                " WHERE def_hash=? AND rev=? AND tf=? AND sym=?"
                "   AND first_bar_time <= ? AND through_bar_time >= ?"
                # ⚠️ THE NARROWEST CONTAINING ROW, THEN THE NEWEST. Deterministic
                # on purpose: two rows may both contain the window, and a claim
                # that depended on SQLite's row order would answer differently on
                # two machines holding the same bytes.
                " ORDER BY (through_bar_time - first_bar_time) ASC, id DESC LIMIT 1",
                (def_hash, rev, tf, sym, first_key, through_key),
            ).fetchone()
            if row is None:
                unproven.append(sym)
            else:
                proven.append(row)

    out["symbols"]["proven"] = len(proven)
    out["symbols"]["unproven"] = unproven
    out["evaluated"] = sum(int(r["bars_evaluated"]) for r in proven)

    if not proven:
        out["coverage"] = "unproven"
        out["refusal"] = NOT_ENOUGH_RECORD
        return out
    if unproven:
        out["coverage"] = "partial"
        out["refusal"] = PARTIAL_RECORD
        return out

    out["coverage"] = "proven"
    hits = sum(int(r["bars_true"]) for r in proven)
    out["hits"] = hits
    out["hit_rate"] = hits / out["evaluated"] if out["evaluated"] else None
    return out

"""`compute.rev` force-migration — notify, reset, and EAT THE FIRST CYCLE.

⭐ WHY THIS EXISTS, IN ONE SENTENCE: when a definition's MATHS changes, every
alert bound to it is holding a number computed by the old maths, and comparing
that number to the new one invents a crossing no bar ever produced.

The worked example is real and it is already shipped. `VWAP_SESSION_ANCHOR`
(accepted 2026-08-03, `docs/decisions/2026-08-02-vwap-utc-day-bucketing.md`)
re-anchored the session accumulator from the UTC calendar day onto the ET
session. On the parity fixture's third session the old lane opens at **93.9178**
where the new one reads **108.3633** — a $14.45 gap, and 207 of 579 bars move by
more than a cent. An armed alert whose stored `last_value` is 93.9178 and whose
next computed value is 108.3633 fires "crossed above 100" on the deploy, and the
user is told price crossed a level it never went near: **the ANCHOR moved, not
the price.**

⛔ THERE IS NO ETERNAL PINNING OF `compute.rev` (spec §3.1). A `version` pin is
free — presentation only. A `rev` pin is a promise to keep running maths we have
decided is wrong. So the answer is not "keep the old numbers forever", it is
"migrate, and never switch anyone silently".

THREE EFFECTS, IN THIS ORDER, IN ONE TRANSACTION (`migrate_bindings_to_rev`):

  1. `def_rev`         := new_rev
  2. `last_value`      := NULL          — an old-rev number may never be a new-rev `prev`
  3. `rev_migrated_at` := now           — read by `suppress_first_cycle`

⚠️ (2) ALONE IS NOT ENOUGH, AND THAT IS THE WHOLE REASON (3) EXISTS. With
`last_value` NULL the `cross_*` branches of `check_condition` return False — they
require a `prev`. But `above` / `below` are LEVEL conditions that do not read
`prev` at all, so an `above` alert fires immediately on the new number.
**Suppression covers the cycle; the reset covers the crossings.** Removing either
one leaves a hole the other cannot see, which is why both are pinned separately
in `tests/test_alert_rev_migration.py`.

⛔ WHERE THE SCHEMA LIVES, AND WHY IT IS BESIDE `indicator_alerts` RATHER THAN
INSIDE IT. The two migration fields are a side table (`indicator_alert_rev`) in
the SAME database file, joined by `alert_id`, written inside the SAME
transaction as the `last_value` reset. `indicator_alerts`' own schema is owned by
the fired-log / re-arm work and is being changed concurrently; adding columns to
it from here would be two authors editing one CREATE TABLE. A side table is
purely additive, survives that work untouched, and costs one indexed join.
`db_path()` resolves through `indicator_alert_service`'s own `_DB_PATH` so the
two tables can never end up in two files — which is what makes "one transaction"
a property rather than a sentence.
"""

from __future__ import annotations

import logging
import sqlite3
import time
from typing import Any, Callable, Optional

_logger = logging.getLogger(__name__)

# ─── THE MATHS REVISION OF EACH DEFINITION ───────────────────────────────────
#
# ⭐ THE PYTHON HALF OF A NUMBER THAT IS AUTHORED IN JAVASCRIPT. The definitions
# live in `app/src/components/chart/engine/nativeRegistry.js` and each carries
# `compute.rev`; the alert lane needs the same number to know which bindings a
# bump has to migrate. Two lanes, ONE vocabulary — and the way that is kept true
# is a rail, not a habit: `test_the_python_rev_table_matches_the_js_registry`
# parses the registry source and fails if the two disagree. So a future
# `compute.rev` bump in the registry goes RED here until somebody comes to this
# file, which is exactly the moment the migration is supposed to be run.
#
# Only the exceptions are listed. Everything else is `DEFAULT_REV`, which is the
# registry's own default in `nativeDef`.
DEFAULT_REV = 1

ADDRESS_REVS: dict[str, int] = {
    # VWAP_SESSION_ANCHOR, applied 2026-08-03. The ET-session accumulator.
    "vwap": 2,
}


def compute_rev(address: Optional[str]) -> int:
    """The maths revision a binding on ``address`` is computed by.

    Keyed on the address's BASE, because `compute.rev` is a property of the
    DEFINITION and an address names a plot of one: every `ichimoku.*` plot comes
    out of one compute call and therefore shares one revision.
    """
    from api.services.indicator_alert_evaluator import plot_base, resolve_address
    base = plot_base(resolve_address(address))
    return ADDRESS_REVS.get(base, DEFAULT_REV)


# ─── the side table ──────────────────────────────────────────────────────────

_SCHEMA = """
CREATE TABLE IF NOT EXISTS indicator_alert_rev (
  alert_id INTEGER PRIMARY KEY,
  address TEXT NOT NULL,
  def_rev INTEGER NOT NULL,
  from_rev INTEGER,
  rev_migrated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_indicator_alert_rev_addr ON indicator_alert_rev(address);
"""


def db_path() -> str:
    """The alert database — THE SAME FILE `indicator_alert_service` writes.

    ⛔ Resolved through that module's attribute rather than re-reading the env
    var, so a test (or a future relocation) that repoints one repoints both. Two
    independent resolutions here would make the single-transaction guarantee
    depend on two settings agreeing.
    """
    from api.services import indicator_alert_service as ias
    return ias._DB_PATH


def _conn():
    c = sqlite3.connect(db_path(), timeout=10.0)
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA busy_timeout=2000")
    return c


def init_schema() -> None:
    with _conn() as db:
        db.executescript(_SCHEMA)


def _ensure_schema(db) -> None:
    db.executescript(_SCHEMA)


def rev_row(alert_id: int) -> Optional[dict]:
    """The migration bookkeeping for one alert, or ``None`` if never migrated."""
    with _conn() as db:
        _ensure_schema(db)
        row = db.execute(
            "SELECT alert_id, address, def_rev, from_rev, rev_migrated_at "
            "FROM indicator_alert_rev WHERE alert_id=?",
            (int(alert_id),),
        ).fetchone()
    if not row:
        return None
    return {
        "alert_id": row[0],
        "address": row[1],
        "def_rev": row[2],
        "from_rev": row[3],
        "rev_migrated_at": row[4],
    }


# ─── the migration ───────────────────────────────────────────────────────────

def deliver_migration_notice(payload: dict) -> None:
    """The production ``notify`` — the SAME bell + email + Discord pipeline.

    Spec §6 state 10 says a version-migrated notice is *"toast/inbox, never chip
    state"*, and AlertBell **is** the inbox — so this rides
    `watchlist_alert_service.deliver_alert_payload` with
    ``source="indicator_alert_migration"`` rather than inventing a transport. The
    distinct `source` is what lets a reader tell "your alert fired" from "the
    maths under your alert changed" without reading the copy.
    """
    from api.services import watchlist_alert_service as wls
    sym = payload.get("sym", "")
    address = payload.get("address") or ""
    wls.deliver_alert_payload(
        user_id=payload["user_id"],
        sym=sym,
        title=f"{sym} {address} alert updated",
        message=(
            f"The maths behind {address} changed (revision {payload.get('from_rev')} "
            f"→ {payload.get('def_rev')}). Your {sym} alert now runs the new "
            f"calculation, its stored previous value was cleared, and it will skip "
            f"one evaluation so the change itself cannot look like a signal."
        ),
        source="indicator_alert_migration",
        extra_data={
            "alert_id": payload.get("alert_id"),
            "indicator": address,
            "address": address,
            "from_rev": payload.get("from_rev"),
            "def_rev": payload.get("def_rev"),
            "tf": payload.get("tf"),
        },
    )


def migrate_bindings_to_rev(address: str, new_rev: int, *,
                            notify: Callable[[dict], Any],
                            now: Optional[int] = None) -> dict:
    """Force-migrate every alert bound to ``address``, and tell its owner.

    ``address`` is a DEFINITION (``vwap``, ``ichimoku``); every stored binding
    whose address has that base is migrated, and nothing else is. That scoping is
    the blast radius: a migration that resets every row is easy and wrong.

    ``notify`` is REQUIRED and must be callable. Spec §3.1's contract is *"you
    will never be silently switched"*, not *"old math runs forever"* — a
    migration with no notification honours neither, so ``notify=None`` raises
    here rather than being accepted as "no notification wanted".

    Idempotent: a binding already recorded at ``new_rev`` is left completely
    alone — not reset, not re-stamped, not re-notified. Re-running a migration
    must not re-suppress a lane that has already been migrated.

    Returns ``{address, new_rev, alert_ids, migrated, skipped, notified,
    notify_errors, rev_migrated_at}``.
    """
    if not callable(notify):
        raise ValueError(
            "migrate_bindings_to_rev() requires a callable `notify` — spec §3.1's "
            "contract is that a user is never silently switched onto new maths, "
            "and a migration that notifies nobody breaks it silently by design"
        )
    if not isinstance(new_rev, int) or isinstance(new_rev, bool) or new_rev < 1:
        raise ValueError(f"new_rev must be an integer >= 1, got {new_rev!r}")

    from api.services import indicator_alert_service as ias
    from api.services.indicator_alert_evaluator import plot_base, resolve_address

    target = plot_base(resolve_address(address))
    stamp = int(now if now is not None else time.time())

    with _conn() as db:
        _ensure_schema(db)
        rows = db.execute(
            "SELECT a.id, a.user_id, a.sym, a.indicator, a.tf, r.def_rev "
            "FROM indicator_alerts a "
            "LEFT JOIN indicator_alert_rev r ON r.alert_id = a.id "
            "ORDER BY a.id"
        ).fetchall()

        payloads: list[dict] = []
        skipped = 0
        for alert_id, user_id, sym, indicator, tf, stored_rev in rows:
            if plot_base(resolve_address(indicator)) != target:
                continue
            if stored_rev is not None and int(stored_rev) == int(new_rev):
                skipped += 1
                continue
            from_rev = DEFAULT_REV if stored_rev is None else int(stored_rev)
            # ⛔ THE THREE EFFECTS, TOGETHER OR NOT AT ALL. A reset that lands
            # without its stamp is the worst of both: the crossings are gone and
            # the first cycle is NOT suppressed, so every `above` binding fires
            # on the new number with nothing recording why.
            db.execute(
                "UPDATE indicator_alerts SET last_value=NULL WHERE id=?",
                (int(alert_id),),
            )
            db.execute(
                "INSERT OR REPLACE INTO indicator_alert_rev "
                "(alert_id, address, def_rev, from_rev, rev_migrated_at) "
                "VALUES (?, ?, ?, ?, ?)",
                (int(alert_id), resolve_address(indicator), int(new_rev),
                 from_rev, stamp),
            )
            payloads.append({
                "alert_id": int(alert_id), "user_id": user_id, "sym": sym,
                "address": resolve_address(indicator), "tf": tf,
                "from_rev": from_rev, "def_rev": int(new_rev),
                "rev_migrated_at": stamp,
            })

    # ⚠️ NOTIFICATION HAPPENS AFTER THE COMMIT, DELIBERATELY. Delivery is bell +
    # email + Discord — network I/O — and holding a SQLite write lock across it
    # would block the evaluator's own writes for as long as the slowest channel
    # takes. A failed notice is COUNTED and logged, never swallowed: the reset
    # has already happened and a user who was not told is the thing spec §3.1
    # forbids, so it has to be visible in the return value.
    notified = 0
    notify_errors = 0
    for payload in payloads:
        try:
            notify(payload)
            notified += 1
        except Exception:
            notify_errors += 1
            _logger.exception(
                "[alert-rev] migration notice failed for alert %s",
                payload.get("alert_id"),
            )

    return {
        "address": target,
        "new_rev": int(new_rev),
        "alert_ids": [p["alert_id"] for p in payloads],
        "migrated": len(payloads),
        "skipped": skipped,
        "notified": notified,
        "notify_errors": notify_errors,
        "rev_migrated_at": stamp,
    }


# ─── the suppression ─────────────────────────────────────────────────────────

def migration_stamp(alert: dict) -> Optional[int]:
    """``rev_migrated_at`` for this alert, or ``None`` if it never migrated.

    Read from the alert dict when it carries the field (a future
    ``_row_to_dict`` may expose it and then this costs nothing), otherwise one
    indexed lookup on the side table.
    """
    if "rev_migrated_at" in alert:
        v = alert.get("rev_migrated_at")
        return None if v is None else int(v)
    alert_id = alert.get("id")
    if alert_id is None:
        return None
    row = rev_row(int(alert_id))
    return None if row is None else int(row["rev_migrated_at"])


def suppress_first_cycle(alert: dict) -> bool:
    """True while this alert's first post-migration cycle has not yet elapsed.

    ⚠️ ONE CYCLE, NOT ONE MINUTE. Keyed on ``last_evaluated_at`` vs
    ``rev_migrated_at`` — the alert's OWN evaluation clock — and NOT on
    ``time.time()``. There is deliberately no wall-clock read anywhere in this
    function: a symbol whose bars arrive late, or a ticker thin enough that its
    group produced nothing for an hour, would sleep straight through a wall-clock
    window and then fire the fabricated crossing the window existed to eat.

    A never-migrated alert is never suppressed, which is what makes this
    function inert on a tree where no migration has ever run.
    """
    migrated_at = migration_stamp(alert)
    if migrated_at is None:
        return False
    last_evaluated_at = alert.get("last_evaluated_at")
    if last_evaluated_at is None:
        return True
    return int(last_evaluated_at) <= int(migrated_at)


def consume_if_suppressed(alert: dict, *, bars: Optional[list] = None,
                          now: Optional[int] = None) -> bool:
    """Skip-and-consume: True when the caller must SKIP this alert this cycle.

    ⭐ THIS IS THE CALL SITE'S WHOLE INTERFACE, and it does both halves on
    purpose. A predicate that only answered "suppress?" would leave the caller to
    remember to mark the cycle consumed, and a suppression nobody lifts is an
    alert that is permanently deaf — the failure mode on the other side of the
    one this task exists to prevent.

    ⚠️ A CYCLE WITH NO BARS DOES NOT COUNT AS THE ALERT'S CYCLE. `_run_one_cycle`
    reaches every active alert even when its (sym, tf) group fetched nothing, and
    consuming there would spend the suppression on a cycle that could not have
    delivered anything — handing the *next* cycle, the first one with real bars,
    exactly the un-suppressed evaluation this exists to prevent.
    """
    if not suppress_first_cycle(alert):
        return False
    if bars:
        _consume_cycle(alert, now=now)
    return True


def _consume_cycle(alert: dict, *, now: Optional[int] = None) -> None:
    """Mark this alert's post-migration cycle as spent."""
    migrated_at = migration_stamp(alert)
    stamp = int(now if now is not None else time.time())
    if migrated_at is not None and stamp <= int(migrated_at):
        # ⛔ SECONDS ARE INTEGERS AND A MIGRATION CAN LAND IN THE SAME SECOND AS
        # THE CYCLE THAT EATS IT. Without this the stamp would satisfy
        # `last_evaluated_at <= rev_migrated_at` and the alert would stay
        # suppressed until the wall clock happened to tick — a suppression that
        # lifts on a clock is the thing `suppress_first_cycle` refuses to be.
        stamp = int(migrated_at) + 1
    with _conn() as db:
        db.execute(
            "UPDATE indicator_alerts SET last_evaluated_at=? WHERE id=?",
            (stamp, int(alert["id"])),
        )
    # Keep the in-memory row honest: the cycle holds this dict for the rest of
    # the pass and a second consult must not see a stale, still-suppressed row.
    alert["last_evaluated_at"] = stamp

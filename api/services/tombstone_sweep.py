"""The LIVE tombstone sweep: every tombstoned account, re-purged from the stores outside the
main purge's reach, on a schedule.

⛔⛔ WHY A DELETION THAT ALREADY RAN NEEDS A SWEEP. The account purge is immediate and runs
once. Four things can leave a deleted member's data behind it, and none of them is a bug in the
purge itself:
  1. its `user_definitions.db` half FAILED (a busy store, a full disk) -- the report says so,
     but the account row is gone and nobody re-runs it;
  2. an alert evaluator cycle that loaded the member's alert just BEFORE the purge writes one
     `indicator_alert_fires` row just AFTER it;
  3. another member's editor tab, open across the deletion, re-saves a copy whose
     `origin.author_id` is the deleted member -- a fresh version row carrying the id the purge
     scrubbed (fixed here, not at the save door);
  4. a `user_definitions.db` restore that could not read the off-site tombstones
     (`tools/store_restore.py --allow-unreplayed`, or a local-file source) left a PENDING
     marker beside the store.

So every `SWEEP_EVERY_HOURS` (and once shortly after boot) this replays, for every id in
auth.db's `account_tombstones`:
  * `account_tombstones.STORE_REPLAYS` on each LIVE store (today `user_definitions`), under
    that store's own write lock -- the same code a restore runs;
  * the saved-indicator alert tables in auth.db (`indicator_alert_rev`, `indicator_alert_fires`,
    `indicator_alerts`);
  * and, while a pending marker exists, the OFF-SITE tombstone list too, retiring the marker
    once that list has been read and replayed.

⭐ CHEAP BY CONSTRUCTION, and never a heavy job: tombstones are one row per deleted account,
every delete is on an indexed `user_id`, and the author scrub is ONE pass over the rows that
carry an `author_id` at all (installed copies), not one per tombstone. Idempotent: a second
run deletes nothing and rewrites nothing.

⛔ AN ID THAT STILL HAS A `users` ROW IS SKIPPED AND REPORTED. A tombstone is written before
the deletion's first DELETE; an account still present is either mid-deletion (the purge will
finish it) or a deletion that was refused after its tombstone -- in which case the sweep must
not erase a live member's work on its own authority.

ON BY DEFAULT (the trash purge's exception, for the same reason: a privacy guarantee that only
runs when someone remembers to arm it is not one). Kill switch: `TOMBSTONE_SWEEP_ENABLED=0`.
"""
from __future__ import annotations

import datetime as _dt
import json
import logging
import os
import sqlite3
from pathlib import Path
from typing import Any

log = logging.getLogger("tombstone_sweep")

ENABLED_ENV = "TOMBSTONE_SWEEP_ENABLED"
SWEEP_EVERY_HOURS = 6
#: The first run after boot waits this long, so the sweep never competes with startup.
BOOT_DELAY_MINUTES = 10

#: auth.db tables keyed to the member that a late writer can recreate after the purge.
#: (table, the DELETE) -- the side table first, while its parent rows still exist.
AUTH_SWEEP = (
    ("indicator_alert_rev",
     "DELETE FROM indicator_alert_rev WHERE alert_id IN (SELECT id FROM indicator_alerts WHERE user_id = ?)"),
    ("indicator_alert_fires", "DELETE FROM indicator_alert_fires WHERE user_id = ?"),
    ("indicator_alerts", "DELETE FROM indicator_alerts WHERE user_id = ?"),
)


def is_enabled() -> bool:
    return os.environ.get(ENABLED_ENV, "1").strip().lower() not in ("0", "false", "no", "off")


def _live_stores() -> dict:
    """{store name: (a context manager yielding the live connection, the live path)}."""
    from api.services import user_definitions_erasure as ude
    return {"user_definitions": (ude.live_connection, ude.live_path)}


def _sweep_auth(conn: sqlite3.Connection, ids: list[str]) -> tuple[dict, list[str]]:
    deleted = {t: 0 for t, _ in AUTH_SWEEP}
    errors: list[str] = []
    for table, sql in AUTH_SWEEP:
        for uid in ids:
            try:
                cur = conn.execute(sql, (uid,))
                deleted[table] += cur.rowcount if cur.rowcount and cur.rowcount > 0 else 0
            except sqlite3.OperationalError as e:
                if "no such table" in str(e).lower():
                    break
                errors.append(f"auth.db {table}: {e}")
                break
    conn.commit()
    return deleted, errors


def _retire_marker(marker: Path, now: _dt.datetime, report: dict) -> Path:
    body = json.loads(marker.read_text(encoding="utf-8"))
    body["retired_at"] = now.isoformat(timespec="seconds")
    body["retired_by"] = "tombstone_sweep"
    body["offsite_replay"] = report
    done = marker.with_name(marker.name.replace(".json", f".retired-{now.strftime('%Y%m%dT%H%M%SZ')}.json"))
    tmp = done.with_name(done.name + ".part")
    tmp.write_text(json.dumps(body, indent=1, sort_keys=True), encoding="utf-8")
    os.replace(tmp, done)
    marker.unlink()
    return done


def sweep(*, auth_conn: sqlite3.Connection | None = None, store=None,
          now: _dt.datetime | None = None) -> dict[str, Any]:
    """One pass. Never raises; every failure is in `errors`. `store` is the off-site tombstone
    store for a pending marker (default: `account_tombstones.default_store()`)."""
    now = now or _dt.datetime.now(_dt.timezone.utc)
    report: dict[str, Any] = {"ok": False, "tombstoned": 0, "skipped_still_members": [],
                              "auth_db": {}, "stores": {}, "markers": {}, "errors": []}
    own = auth_conn is None
    if own:
        from api.services.auth_db import get_connection
        auth_conn = get_connection()
    try:
        return _sweep(auth_conn, store, now, report)
    finally:
        if own:
            auth_conn.close()


def _sweep(auth_conn, store, now, report) -> dict[str, Any]:
    from api.services import account_tombstones as at
    from api.services import user_definitions_erasure as ude
    try:
        tombs = at.tombstones_in(auth_conn)
        still = set(at.present_in(auth_conn, tombs))
        ids = sorted(u for u in tombs if u not in still)
        report["tombstoned"], report["skipped_still_members"] = len(tombs), sorted(still)
        if ids:
            report["auth_db"], errs = _sweep_auth(auth_conn, ids)
            report["errors"].extend(errs)
    except Exception as e:  # noqa: BLE001 -- the sweep never breaks the scheduler
        report["errors"].append(f"auth.db: {type(e).__name__}: {e}")
        ids, still = [], set()

    for name, (opener, path_of) in _live_stores().items():
        replay = at.STORE_REPLAYS.get(name)
        if replay is None:
            continue
        marker = Path(f"{path_of()}{ude.PENDING_MARKER_SUFFIX}")
        offsite_ids: list[str] = []
        if marker.exists():
            try:
                st = store if store is not None else at.default_store()
                if st is None:
                    raise RuntimeError("no off-site tombstone store configured")
                off = at.offsite_tombstones(st)
                live = set(at.present_in(auth_conn, off))
                report["skipped_still_members"] = sorted(set(report["skipped_still_members"]) | live)
                offsite_ids = sorted(u for u in off if u not in live)
                report["markers"][name] = {"marker": str(marker), "offsite_ids": len(offsite_ids)}
            except Exception as e:  # noqa: BLE001 -- the marker stays; said, not skipped
                report["markers"][name] = {"marker": str(marker), "pending": True,
                                           "why": f"{type(e).__name__}: {e}"}
                offsite_ids = []
                marker_ready = False
            else:
                marker_ready = True
        else:
            marker_ready = False
        targets = sorted(set(ids) | set(offsite_ids))
        try:
            with opener() as conn:
                # The scrub inside the replay is the author check; the restore gate's second
                # pass is skipped so the write lock is held only for the selected rows.
                rep = replay(conn, targets, verify_authors=False)
        except Exception as e:  # noqa: BLE001
            report["errors"].append(f"{name}: {type(e).__name__}: {e}")
            continue
        report["stores"][name] = {k: rep.get(k) for k in
                                  ("rows_deleted", "authors_scrubbed", "still_present", "authors_remaining")}
        problems = rep.get("errors") or rep.get("still_present") or rep.get("authors_remaining")
        if problems:
            report["errors"].append(f"{name}: errors={rep.get('errors')} still_present={rep.get('still_present')} "
                                    f"authors_remaining={rep.get('authors_remaining')}")
        elif marker_ready:
            report["markers"][name]["retired_to"] = str(_retire_marker(
                marker, now, {k: report["stores"][name][k] for k in ("rows_deleted", "authors_scrubbed")}))

    if ids:
        try:
            from api.services import alert_user_series
            for uid in ids:
                alert_user_series.forget(uid)
        except Exception as e:  # noqa: BLE001
            report["errors"].append(f"alert series cache: {e}")
    report["ok"] = not report["errors"]
    return report


def register_jobs(scheduler) -> bool:
    """Every `SWEEP_EVERY_HOURS` hours, first run `BOOT_DELAY_MINUTES` after boot. ON unless
    `TOMBSTONE_SWEEP_ENABLED=0`."""
    if not is_enabled():
        log.info("[tombstone_sweep] disabled (%s=0)", ENABLED_ENV)
        return False
    from apscheduler.triggers.interval import IntervalTrigger

    def _job() -> None:
        try:
            rep = sweep()
            touched = sum((rep.get("auth_db") or {}).values()) + sum(
                (s.get("rows_deleted") or 0) + (s.get("authors_scrubbed") or 0)
                for s in rep.get("stores", {}).values())
            print(f"[tombstone-sweep] tombstoned={rep['tombstoned']} touched={touched} "
                  f"skipped_still_members={len(rep['skipped_still_members'])} "
                  f"markers={list(rep['markers'])} errors={rep['errors']}")
        except Exception as e:  # noqa: BLE001 -- a failed sweep must never break the scheduler
            print(f"[tombstone-sweep] failed: {e}")

    scheduler.add_job(
        _job, IntervalTrigger(hours=SWEEP_EVERY_HOURS),
        next_run_time=_dt.datetime.now(_dt.timezone.utc) + _dt.timedelta(minutes=BOOT_DELAY_MINUTES),
        id="account_tombstone_sweep", max_instances=1, replace_existing=True, coalesce=True,
        misfire_grace_time=3600)
    return True

"""The daily integrity check of the PERMANENT archive: SQLite ledger vs the R2 journal
vs the nightly snapshot -- measured, recovered where it safely can be, and alerted.

Owner, 2026-10-31: *"an automated daily integrity check that detects missing
headlines, missing delivery records, mismatched counts, and failed backups. Account
correctly for deduplicated repeat deliveries."*

⭐ THE UNIT IS THE DELIVERY, NEVER THE HEADLINE. Trade Exchange may send the same
text twice; the dedupe policy (store.py) COLLAPSES the second delivery onto the first
headline (``repeat_count`` +1) but still ledgers it and still journals it. So:
  * the R2 journal holds one object per DELIVERY (event id);
  * ``deliveries`` holds one row per delivery -- ``kind='headline'`` (it created a
    headline) or ``kind='repeat'`` (collapsed);
  * ``headlines`` holds one row per ``kind='headline'`` delivery, and each headline's
    ``repeat_count`` equals ITS ``kind='repeat'`` deliveries.
Comparing the journal with the HEADLINE count would report every collapsed repeat as
"missing"; this compares the journal with the DELIVERY ledger, id by id, and checks
the headline<->delivery accounting separately.

What it checks (counts and ids only -- never content):
  1. ledger accounting -- every headline has its creating delivery, every delivery
     points at an existing headline, each headline's repeat count equals its repeat
     deliveries, and the totals agree (``headlines == kind='headline'``,
     ``SUM(repeat_count) == kind='repeat'``);
  2. journal vs ledger -- a sorted MERGE of the R2 listing and the ledger (memory
     O(1) in the archive's size), skipping the last ``GRACE_MS`` (writes in flight):
       * in R2, not in SQLite  -> MISSING DELIVERY: re-ingested through the normal
         recovery path (``via='reconcile'``, flagged delayed) -- an addition, never
         a rewrite;
       * in SQLite as journaled, not in R2 -> LOST FROM THE ARCHIVE: marked
         unconfirmed, so the existing repair pass PUTs the exact original bytes back
         (``record_json``); one with no stored bytes is reported unrepairable;
       * unconfirmed for longer than ``BACKLOG_ALERT_MS`` -> reported;
  3. ``PRAGMA quick_check`` on a read-only connection;
  4. the newest nightly snapshot (store_backup, ``trade_exchange_news``) is younger
     than ``BACKUP_MAX_AGE_H`` -- the artefact in the bucket, not a job's exit code.

Any problem posts an OPS alert (ops_alerts.py). The last result is kept in the
database (``state.integrity_last``) and shown in the admin status. Nothing here
deletes anything.
"""
from __future__ import annotations

import asyncio
import datetime as _dt
import json
import logging
import sqlite3
import time
from typing import Any, Callable, Iterator
from zoneinfo import ZoneInfo

from api.services.trade_exchange_news import ops_alerts

logger = logging.getLogger(__name__)

ET = ZoneInfo("America/New_York")
#: Deliveries this recent are skipped: a push and its R2 PUT may still be in flight.
GRACE_MS = 15 * 60_000
#: An unconfirmed delivery older than this is a problem (the repair pass runs every 30 s).
BACKLOG_ALERT_MS = 60 * 60_000
#: Missing deliveries re-ingested per run (the rest on the next run, and reported).
MAX_RECOVER = 5_000
#: Ids named in the result, per category -- a sample for an operator, not the list.
SAMPLE = 20
#: The nightly snapshot runs 03:05 ET; this allows one missed night.
BACKUP_MAX_AGE_H = 30
BACKUP_STORE = "trade_exchange_news"
RUN_AT_ET = (4, 30)
FIRST_RUN_DELAY_S = 15 * 60
_CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


def id_ms(event_id: str) -> int | None:
    """The receipt millisecond a ULID event id encodes (its first 10 chars)."""
    n = 0
    try:
        for ch in event_id[:10]:
            n = (n << 5) | _CROCKFORD.index(ch)
    except ValueError:
        return None
    return n if len(event_id) == 26 else None


# ── 1. ledger accounting ─────────────────────────────────────────────────────

def ledger_checks(store) -> dict[str, int]:
    c = store._conn()
    one = lambda q: int(c.execute(q).fetchone()[0] or 0)  # noqa: E731
    return {
        "headlines": one("SELECT COUNT(*) FROM headlines"),
        "deliveries": one("SELECT COUNT(*) FROM deliveries"),
        "deliveries_headline": one("SELECT COUNT(*) FROM deliveries WHERE kind='headline'"),
        "deliveries_repeat": one("SELECT COUNT(*) FROM deliveries WHERE kind='repeat'"),
        "repeat_total": one("SELECT COALESCE(SUM(repeat_count), 0) FROM headlines"),
        "headlines_without_delivery": one(
            "SELECT COUNT(*) FROM headlines h WHERE NOT EXISTS (SELECT 1 FROM deliveries d "
            "WHERE d.event_id = h.event_id AND d.kind = 'headline')"),
        "deliveries_without_headline": one(
            "SELECT COUNT(*) FROM deliveries d WHERE NOT EXISTS "
            "(SELECT 1 FROM headlines h WHERE h.seq = d.headline_seq)"),
        "repeat_count_mismatch": one(
            "SELECT COUNT(*) FROM headlines h LEFT JOIN (SELECT headline_seq, COUNT(*) AS n FROM deliveries "
            "WHERE kind = 'repeat' GROUP BY headline_seq) r ON r.headline_seq = h.seq "
            "WHERE h.repeat_count != COALESCE(r.n, 0)"),
        "deliveries_without_record": one("SELECT COUNT(*) FROM deliveries WHERE record_json IS NULL"),
    }


# ── 2. journal vs ledger ─────────────────────────────────────────────────────

def _ledger_ids(store) -> Iterator[tuple[str, int, bool]]:
    """(event_id, journaled, has stored bytes) in event-id order (the primary key's)."""
    cur = store._conn().execute(
        "SELECT event_id, journaled, record_json IS NOT NULL FROM deliveries ORDER BY event_id")
    while True:
        rows = cur.fetchmany(5000)
        if not rows:
            return
        for r in rows:
            yield r[0], int(r[1]), bool(r[2])


def journal_compare(store, reader, now_ms: int) -> dict[str, Any]:
    """Merge the R2 listing (lexicographic = event-id order) with the ledger."""
    horizon = now_ms - GRACE_MS

    def settled(eid: str) -> bool:
        ms = id_ms(eid)
        return ms is None or ms <= horizon

    out: dict[str, Any] = {"journal_objects": 0, "missing_in_sqlite": 0, "lost_from_r2": 0,
                           "lost_unrepairable": 0, "unconfirmed_old": 0,
                           "recover_ids": [], "relink_ids": [], "samples": {}}
    sample = out["samples"]

    def note(kind: str, eid: str) -> None:
        lst = sample.setdefault(kind, [])
        if len(lst) < SAMPLE:
            lst.append(eid)

    r2 = iter(reader.ids_after(""))
    db = _ledger_ids(store)
    a = next(r2, None)
    b = next(db, None)
    while a is not None or b is not None:
        if b is None or (a is not None and a < b[0]):
            out["journal_objects"] += 1
            if settled(a):
                out["missing_in_sqlite"] += 1
                note("missing_in_sqlite", a)
                if len(out["recover_ids"]) < MAX_RECOVER:
                    out["recover_ids"].append(a)
            a = next(r2, None)
        elif a is None or b[0] < a:
            eid, journaled, has_bytes = b
            if settled(eid):
                if journaled:
                    out["lost_from_r2"] += 1
                    note("lost_from_r2", eid)
                    if has_bytes:
                        out["relink_ids"].append(eid)
                    else:
                        out["lost_unrepairable"] += 1
                else:
                    ms = id_ms(eid)
                    if ms is None or ms <= now_ms - BACKLOG_ALERT_MS:
                        out["unconfirmed_old"] += 1
                        note("unconfirmed_old", eid)
            b = next(db, None)
        else:
            out["journal_objects"] += 1
            a, b = next(r2, None), next(db, None)
    return out


# ── 3 + 4. the file itself, and its snapshot ─────────────────────────────────

def quick_check(path: str) -> str:
    try:
        c = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=30)
        try:
            rows = c.execute("PRAGMA quick_check").fetchall()
        finally:
            c.close()
        return "ok" if rows == [("ok",)] else f"{len(rows)} issue(s)"
    except sqlite3.DatabaseError as e:
        return f"error: {type(e).__name__}"


def newest_backup(now: _dt.datetime) -> dict[str, Any]:
    """The newest nightly snapshot of the News database, from the bucket listing."""
    from api.services import store_backup
    if not store_backup.is_enabled():
        return {"status": "disabled"}
    client, bucket = store_backup._r2()
    if not (client and bucket):
        return {"status": "unconfigured"}
    found = []
    for key in store_backup.list_keys(client, bucket, f"{store_backup.KEY_PREFIX}{BACKUP_STORE}/"):
        parsed = store_backup.parse_key(key)
        if parsed and parsed[0] == BACKUP_STORE:
            found.append(parsed[1])
    if not found:
        return {"status": "none"}
    newest = max(found)
    return {"status": "ok", "newest": newest.isoformat(timespec="seconds"), "count": len(found),
            "age_h": round((now - newest).total_seconds() / 3600, 1)}


# ── the whole check ──────────────────────────────────────────────────────────

def check(store, reader, *, now_ms: int | None = None,
          backup_probe: Callable[[_dt.datetime], dict[str, Any]] | None = newest_backup) -> dict[str, Any]:
    """Measure everything. Returns the report (no side effects but ``relink``)."""
    t0 = time.perf_counter()
    now = int(time.time() * 1000) if now_ms is None else now_ms
    problems: list[str] = []
    led = ledger_checks(store)
    if led["headlines"] != led["deliveries_headline"]:
        problems.append(f"headline count {led['headlines']} != headline deliveries {led['deliveries_headline']}")
    if led["repeat_total"] != led["deliveries_repeat"]:
        problems.append(f"repeat total {led['repeat_total']} != repeat deliveries {led['deliveries_repeat']}")
    for k in ("headlines_without_delivery", "deliveries_without_headline", "repeat_count_mismatch"):
        if led[k]:
            problems.append(f"{k}: {led[k]}")
    rep: dict[str, Any] = {"checked_at_ms": now, "ledger": led}
    if reader is None:
        problems.append("no R2 journal configured: the permanent archive cannot be compared")
        rep["journal"] = None
    else:
        try:
            j = journal_compare(store, reader, now)
            rep["journal"] = {k: v for k, v in j.items() if k not in ("recover_ids", "relink_ids")}
            rep["_recover_ids"], rep["_relink_ids"] = j["recover_ids"], j["relink_ids"]
            if j["missing_in_sqlite"]:
                problems.append(f"missing_in_sqlite: {j['missing_in_sqlite']} R2 deliveries not in the database")
            if j["lost_from_r2"]:
                problems.append(f"lost_from_r2: {j['lost_from_r2']} confirmed deliveries no longer in R2 "
                                f"({j['lost_unrepairable']} without stored bytes)")
            if j["unconfirmed_old"]:
                problems.append(f"unconfirmed_old: {j['unconfirmed_old']} deliveries not confirmed in R2 for over "
                                f"{BACKLOG_ALERT_MS // 60_000} min")
        except Exception as e:  # noqa: BLE001 -- reported, never raised
            rep["journal"] = {"error": type(e).__name__}
            problems.append(f"journal listing failed: {type(e).__name__}")
    rep["quick_check"] = quick_check(store.path)
    if rep["quick_check"] != "ok":
        problems.append(f"sqlite quick_check: {rep['quick_check']}")
    if backup_probe is not None:
        try:
            b = backup_probe(_dt.datetime.fromtimestamp(now / 1000, _dt.timezone.utc))
        except Exception as e:  # noqa: BLE001
            b = {"status": "error", "error": type(e).__name__}
        rep["backup"] = b
        if b.get("status") != "ok":
            problems.append(f"nightly snapshot: {b.get('status')}{' ' + b['error'] if b.get('error') else ''}")
        elif b["age_h"] > BACKUP_MAX_AGE_H:
            problems.append(f"nightly snapshot is {b['age_h']} h old (limit {BACKUP_MAX_AGE_H} h)")
    rep["problems"] = problems
    rep["ok"] = not problems
    rep["duration_ms"] = round((time.perf_counter() - t0) * 1000)
    return rep


def relink(store, event_ids: list[str]) -> int:
    """Mark deliveries R2 no longer holds as unconfirmed, so the repair pass PUTs
    their exact original bytes back. A flag, never a row removal."""
    n = 0
    c = store._conn()
    for i in range(0, len(event_ids), 500):
        chunk = event_ids[i:i + 500]
        n += c.execute(f"UPDATE deliveries SET journaled=0 WHERE journaled=1 AND record_json IS NOT NULL "
                       f"AND event_id IN ({','.join('?' * len(chunk))})", chunk).rowcount
    return n


async def run(pipeline, reconciler, *, now_ms: int | None = None, backup_probe=newest_backup) -> dict[str, Any]:
    """Check, then repair what is safe (re-ingest missing deliveries; re-arm lost
    ones for the repair pass), alert on any problem, and persist the report."""
    store = pipeline.store
    reader = getattr(reconciler, "reader", None)
    rep = await asyncio.to_thread(check, store, reader, now_ms=now_ms, backup_probe=backup_probe)
    recover, relinks = rep.pop("_recover_ids", []), rep.pop("_relink_ids", [])
    recovered = failed = 0
    if recover and reconciler is not None:
        from api.services.trade_exchange_news import records
        from api.services.trade_exchange_news.reconcile import FETCH_CHUNK
        for i in range(0, len(recover), FETCH_CHUNK):
            ids = recover[i:i + FETCH_CHUNK]
            try:
                raws = await asyncio.to_thread(reconciler._fetch_chunk, ids)
            except Exception as e:  # noqa: BLE001
                failed += len(recover) - i
                rep["problems"].append(f"recovery fetch failed: {type(e).__name__}")
                break
            for raw in raws:
                try:
                    out = await pipeline.submit(raw, "reconcile")
                    recovered += out["kind"] != "known"
                except records.RecordError:
                    failed += 1
    rep["recovered"] = recovered
    rep["recover_failed"] = failed
    rep["relinked"] = await asyncio.to_thread(relink, store, relinks) if relinks else 0
    rep["ok"] = not rep["problems"]
    await asyncio.to_thread(store.set_state, "integrity_last", json.dumps(rep, default=str))
    if rep["problems"]:
        ops_alerts.alert("integrity", "daily integrity check FAILED: " + "; ".join(rep["problems"])
                         + f". Re-ingested {recovered} missing deliveries ({failed} failed); "
                           f"re-armed {rep['relinked']} for R2 repair. Admin status: /api/admin/trade-exchange-news")
    else:
        logger.info("[txn] integrity ok: %d deliveries, %d headlines, %d R2 objects in %d ms",
                    rep["ledger"]["deliveries"], rep["ledger"]["headlines"],
                    (rep.get("journal") or {}).get("journal_objects", 0), rep["duration_ms"])
    return rep


def last(store) -> dict[str, Any] | None:
    try:
        raw = store.get_state("integrity_last")
        return json.loads(raw) if raw else None
    except (ValueError, sqlite3.Error):
        return None


def seconds_until_next(now: _dt.datetime | None = None) -> float:
    now = now or _dt.datetime.now(ET)
    target = now.astimezone(ET).replace(hour=RUN_AT_ET[0], minute=RUN_AT_ET[1], second=0, microsecond=0)
    if target <= now:
        target += _dt.timedelta(days=1)
    return (target - now).total_seconds()


async def run_forever(pipeline, reconciler) -> None:
    """Once shortly after boot (so a deploy is checked), then daily at RUN_AT_ET."""
    delay = FIRST_RUN_DELAY_S
    while True:
        await asyncio.sleep(delay)
        try:
            await run(pipeline, reconciler)
        except Exception as e:  # noqa: BLE001 -- the check itself failing is an alert
            logger.exception("[txn] integrity check crashed")
            ops_alerts.alert("integrity", f"daily integrity check could not run: {type(e).__name__}")
        delay = seconds_until_next()


_TASK: asyncio.Task | None = None


def start(pipeline, reconciler) -> None:
    global _TASK
    _TASK = asyncio.get_running_loop().create_task(run_forever(pipeline, reconciler))


def stop() -> None:
    global _TASK
    if _TASK is not None and not _TASK.get_loop().is_closed():
        _TASK.cancel()
    _TASK = None

"""Trade Exchange News -- PERMANENT RETENTION (owner, 2026-10-31).

Every headline and every original delivery record is kept forever. These rails pin:
  * nothing in the News code can delete a headline, a delivery or a journal object;
  * the R2 lifecycle config never expires the events archive;
  * the nightly snapshot is consistent (online backup API, same-snapshot manifest)
    and restores through the real restore procedure, encrypted end to end;
  * a COMPLETELY EMPTY volume comes back whole from the R2 journal (the rebuild
    tool, and the live boot + integrity path), repeats and graphic-only included;
  * the daily integrity check counts DELIVERIES, so collapsed repeats are never
    "missing", and it recovers / re-arms / alerts;
  * administrators are alerted (the OPS webhook), not only logged;
  * the archive's caches stay bounded and day browsing stays fast at scale.

Synthetic headlines only.
"""
from __future__ import annotations

import ast
import asyncio
import datetime as dt
import json
import os
import pathlib
import re
import sqlite3
import time
from datetime import date

import pytest

from api.services import backup_crypto
from api.services import store_backup as sb
from api.services.trade_exchange_news import archive as arc
from api.services.trade_exchange_news import config, integrity, ops_alerts, pipeline as pl, records
from api.services.trade_exchange_news import reconcile as rc
from api.services.trade_exchange_news.journal_reader import FileJournalReader
from api.services.trade_exchange_news.store import Store
from tests import _backup_keys
from tests.support.txn_fakes import load_receiver
from tools import store_restore
from tools import txn_rebuild_from_r2 as rebuild_tool

M = load_receiver()
rx, jr = M["txn_receiver"], M["txn_journal"]
REPO = pathlib.Path(__file__).resolve().parents[1]
NOW_MS = int(time.time() * 1000)
DAY_MS = 86_400_000


@pytest.fixture(autouse=True)
def env(monkeypatch, tmp_path):
    monkeypatch.setenv("TXN_ENABLED", "1")
    monkeypatch.setenv("TXN_DB_PATH", str(tmp_path / "vol" / "trade_exchange_news.db"))
    (tmp_path / "vol").mkdir()
    monkeypatch.setenv("TXN_SOURCE_ALLOWLIST", "TXNews1,TX-PressRelease")
    monkeypatch.delenv("TXN_DEDUPE_WINDOW_S", raising=False)        # the real 60 s policy
    for k in config.RETIRED_ENV:
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setattr(arc, "WARM_ENABLED", False)
    sent: list[str] = []
    monkeypatch.setattr(ops_alerts, "_post", lambda text: sent.append(text) or True)
    ops_alerts._reset_for_tests()
    # The receiver's ULIDs are monotonic per process: a test that issued ids at a later
    # synthetic time would push every later test's ids past it. Each test starts clean.
    monkeypatch.setattr(jr, "_last_ms", 0)
    arc.clear_index()
    arc.clear_cache()
    yield sent
    rc.stop()
    pl.stop()
    arc.clear_index()


def rec(content, ms, source="TXNews1"):
    cfg = rx.Config({"TXN_SOURCE_ALLOWLIST": "TXNews1,TX-PressRelease"})
    return rx.build_record(source, content, {}, rx.delivery_meta({}, 10, None), cfg, now_ms=ms)


def _wait_alerts():
    time.sleep(0.05)                                   # the post runs on a daemon thread


async def _archive(p, journal, n=60, start_ms=None, repeats=True):
    """Deliver ``n`` headlines through the receiver's own journal AND web's ingest,
    as production does -- with collapsed repeats and graphic-only posts."""
    t = start_ms or NOW_MS - 40 * DAY_MS
    sent = []
    for i in range(n):
        ms = t + i * 9 * 3_600_000                     # spread over many days
        content = "CRYPTO" if i % 15 == 7 else f"SYNTHETIC wire {i}: Example Corp item {i}"
        r = rec(content, ms)
        journal.put(r)
        await p.submit(r, "push")
        sent.append(r)
        if repeats and i % 10 == 3:                    # the same text again 20 s later: a repeat
            r2 = rec(content, ms + 20_000)
            journal.put(r2)
            await p.submit(r2, "push")
            sent.append(r2)
    p.store.mark_journaled([r["id"] for r in sent])     # the repair pass's LIST confirmation
    return sent


def _ledger(path):
    c = sqlite3.connect(path)
    try:
        return {
            "deliveries": sorted(r[0] for r in c.execute("SELECT event_id FROM deliveries")),
            "headline_texts": sorted(r[0] for r in c.execute("SELECT content FROM headlines")),
            "repeats": c.execute("SELECT SUM(repeat_count) FROM headlines").fetchone()[0],
            "records": sorted(r[0] for r in c.execute("SELECT record_json FROM deliveries")),
        }
    finally:
        c.close()


# ── 1. nothing can delete ────────────────────────────────────────────────────

NEWS_CODE = sorted([*(REPO / "api/services/trade_exchange_news").glob("*.py"),
                    REPO / "api/routers/trade_exchange_news.py",
                    *(REPO / "services/trade_exchange_news_receiver").glob("*.py"),
                    REPO / "tools/txn_rebuild_from_r2.py"])


def _strings(path):
    for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            yield node.value
        elif isinstance(node, ast.JoinedStr):
            yield "".join(v.value for v in node.values if isinstance(v, ast.Constant))


def test_no_news_code_can_delete_a_headline_a_delivery_or_a_journal_object():
    assert len(NEWS_CODE) > 15                         # the sweep really walks the code
    sql_delete = re.compile(r"\bDELETE\s+FROM\s+(headlines|deliveries)\b|\bDROP\s+TABLE\b|\bTRUNCATE\b", re.I)
    offenders = {}
    for path in NEWS_CODE:
        hits = [s for s in _strings(path) if sql_delete.search(s)]
        calls = [n.func.attr for n in ast.walk(ast.parse(path.read_text(encoding="utf-8")))
                 if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
                 and n.func.attr in ("delete_object", "delete_objects", "prune", "remove", "unlink", "rmtree")]
        if hits or calls:
            offenders[path.relative_to(REPO).as_posix()] = hits + calls
    # The receiver's FileJournal / FileJournalReader clean up THEIR OWN temp file on a
    # failed atomic write (os.replace never happened); no journal object is touched.
    offenders = {k: v for k, v in offenders.items() if set(v) - {"unlink", "remove"}}
    assert offenders == {}


def test_the_detector_sees_a_delete_when_there_is_one(tmp_path):
    p = tmp_path / "x.py"
    p.write_text('q = "DELETE FROM headlines WHERE seq < ?"\nclient.delete_object(Bucket=b, Key=k)\n')
    assert any(re.search(r"DELETE\s+FROM\s+headlines", s) for s in _strings(p))


def test_the_store_and_pipeline_have_no_prune():
    assert not hasattr(Store, "prune") and not hasattr(pl.Pipeline, "prune")
    assert not hasattr(config, "history_max_age_ms") and not hasattr(config, "journal_retention_ms")


def test_the_r2_lifecycle_config_never_expires_the_events_archive():
    cfg = json.loads((REPO / "services/trade_exchange_news_receiver/r2-lifecycle.json").read_text())
    for rule in cfg["Rules"]:
        prefix = (rule.get("Filter") or {}).get("Prefix", "")
        expires = "Expiration" in rule or "Transitions" in rule
        assert not (expires and ("trade-exchange-news/v1/events/".startswith(prefix))), rule
    assert any((r.get("Filter") or {}).get("Prefix") == "trade-exchange-news/v1/preflight/" for r in cfg["Rules"])


async def test_retired_env_bounds_delete_nothing_even_set_hostile(monkeypatch, tmp_path):
    monkeypatch.setenv("TXN_HISTORY_MAX_AGE_HOURS", "-5")
    monkeypatch.setenv("TXN_HISTORY_MAX_ITEMS", "1")
    monkeypatch.setenv("TXN_JOURNAL_RETENTION_HOURS", "1")
    p = pl.start(asyncio.get_running_loop())
    sent = await _archive(p, jr.FileJournal(str(tmp_path / "j")), n=30)
    rcn = rc.Reconciler(p, FileJournalReader(str(tmp_path / "j")))
    await rcn.run_once()
    await rcn.repair_once()
    assert p.store.stats()["deliveries"] == len(sent)
    assert config.retired_env_set() == list(config.RETIRED_ENV)


# ── 2. snapshots: consistent, checksummed, restorable ────────────────────────

def test_the_news_database_is_registered_for_the_nightly_snapshot():
    spec = next(s for s in sb.STORES if s.name == "trade_exchange_news")
    assert spec.klass == sb.CLASS_RETAINED
    assert sb.resolve_path("trade_exchange_news") == config.db_path()


async def test_a_snapshot_taken_under_live_ingest_restores_exactly(tmp_path, monkeypatch):
    p = pl.start(asyncio.get_running_loop())
    await _archive(p, jr.FileJournal(str(tmp_path / "j")), n=40)
    stop = False

    async def keep_writing():
        i = 0
        while not stop:
            await p.submit(rec(f"SYNTHETIC during backup {i}", NOW_MS - DAY_MS + i), "push")
            i += 1
            await asyncio.sleep(0)
    writer = asyncio.create_task(keep_writing())
    await asyncio.sleep(0.05)
    now = dt.datetime.now(dt.timezone.utc)
    work = tmp_path / "bk"
    work.mkdir()
    art = await asyncio.to_thread(sb.build_artifacts, "trade_exchange_news", config.db_path(), str(work), now)
    stop = True
    await writer
    man = art["manifest"]
    assert man["tables"]["headlines"] > 40 and man["journal_mode"] == "wal"
    # Encrypted exactly as the nightly job ships it, then the REAL restore procedure.
    public, private = _backup_keys.keypair()[1], _backup_keys.keypair()[0]
    backup_crypto.encrypt_file(art["gz"], art["gz"] + ".enc", public)
    backup_crypto.encrypt_file(art["manifest_path"], art["manifest_path"] + ".enc", public)
    out = store_restore.rehearse_file("trade_exchange_news", pathlib.Path(art["gz"] + ".enc"),
                                      pathlib.Path(art["manifest_path"] + ".enc"), tmp_path / "rehearse",
                                      now=now, taken=now, private_key=private)
    assert out["verdict"] == "PASS", out["reasons"]
    restored = tmp_path / "rehearse" / "trade_exchange_news.db"
    # The restored copy is a working News database: same epoch, accounting intact.
    s = Store(str(restored))
    assert s.epoch == p.store.epoch
    rep = integrity.check(s, None, backup_probe=None)
    assert {k: v for k, v in rep["ledger"].items() if k.endswith(("_without_delivery", "_without_headline", "_mismatch"))} \
        == {"headlines_without_delivery": 0, "deliveries_without_headline": 0, "repeat_count_mismatch": 0}
    assert rep["ledger"]["deliveries"] == man["tables"]["deliveries"]


def test_a_corrupt_snapshot_is_never_restored(tmp_path):
    import gzip
    bad = tmp_path / "x.db.gz"
    with gzip.open(bad, "wb") as f:
        f.write(b"SQLite format 3\x00" + b"\x00" * 4000)
    with pytest.raises(store_restore.RestoreRefused):
        store_restore.restore_file(bad, tmp_path / "out.db", now=dt.datetime.now(dt.timezone.utc))
    assert not (tmp_path / "out.db").exists()


# ── 3. a completely empty volume, rebuilt from the permanent journal ─────────

def _lose_the_volume(monkeypatch, tmp_path):
    """The volume is gone: web comes back on a new, EMPTY one. (A new directory
    rather than deleting the file: Windows keeps the old connections' locks.)"""
    fresh = tmp_path / "vol-new"
    fresh.mkdir()
    monkeypatch.setenv("TXN_DB_PATH", str(fresh / "trade_exchange_news.db"))
    assert not any(fresh.iterdir())


async def test_an_empty_volume_is_rebuilt_whole_from_the_r2_journal(tmp_path, monkeypatch):
    p = pl.start(asyncio.get_running_loop())
    sent = await _archive(p, jr.FileJournal(str(tmp_path / "j")), n=90)
    before = _ledger(config.db_path())
    assert before["repeats"] and "CRYPTO" in before["headline_texts"]
    pl.stop()
    _lose_the_volume(monkeypatch, tmp_path)

    out = tmp_path / "rebuilt.db"
    code = await asyncio.to_thread(rebuild_tool.main, ["--to", str(out), "--journal-dir", str(tmp_path / "j")])
    assert code == 0
    after = _ledger(str(out))
    assert after == before                              # every delivery, byte-identical records, same repeats
    assert len(after["deliveries"]) == len(sent)
    s = Store(str(out))
    assert s.journal_backlog()["count"] == 0            # nothing to re-PUT: it all came from R2
    assert not any(h["ingested_at_ms"] - h["received_at_ms"] > pl.DELAYED_AFTER_MS for h in s.recent(1000))


def test_the_rebuild_never_overwrites_a_database(tmp_path):
    (tmp_path / "j").mkdir()
    existing = tmp_path / "x.db"
    Store(str(existing))
    with pytest.raises(SystemExit):
        rebuild_tool.rebuild(FileJournalReader(str(tmp_path / "j")), str(existing))


async def test_a_boot_on_an_empty_volume_then_the_integrity_check_restores_everything(tmp_path, env, monkeypatch):
    journal = jr.FileJournal(str(tmp_path / "j"))
    p = pl.start(asyncio.get_running_loop())
    sent = await _archive(p, journal, n=90, start_ms=NOW_MS - 34 * DAY_MS)   # 34 days back to ~15 h ago
    before = _ledger(config.db_path())
    pl.stop()
    _lose_the_volume(monkeypatch, tmp_path)

    p = pl.start(asyncio.get_running_loop())           # fresh, EMPTY database
    rcn = rc.Reconciler(p, FileJournalReader(str(tmp_path / "j")))
    await rcn.run_once()                               # boot recovery: the recent window only
    got = p.store.stats()["deliveries"]
    assert 0 < got < len(sent)
    rep = await integrity.run(p, rcn, backup_probe=None)
    assert rep["recovered"] + 0 > 0 and any("missing_in_sqlite" in x for x in rep["problems"])
    _wait_alerts()
    assert any("integrity check FAILED" in m for m in env)                 # the admin was told
    after = _ledger(config.db_path())
    assert after["deliveries"] == before["deliveries"] and after["records"] == before["records"]
    assert after["repeats"] == before["repeats"]
    again = await integrity.run(p, rcn, backup_probe=None)
    assert again["ok"], again["problems"]


# ── 4. the daily integrity check ─────────────────────────────────────────────

async def test_collapsed_repeats_are_never_reported_missing(tmp_path):
    p = pl.start(asyncio.get_running_loop())
    sent = await _archive(p, jr.FileJournal(str(tmp_path / "j")), n=50)
    rep = integrity.check(p.store, FileJournalReader(str(tmp_path / "j")), backup_probe=None)
    led, j = rep["ledger"], rep["journal"]
    assert led["deliveries_repeat"] > 0
    assert j["journal_objects"] == len(sent) == led["deliveries"] > led["headlines"]
    assert j["missing_in_sqlite"] == j["lost_from_r2"] == 0
    assert rep["ok"], rep["problems"]


async def test_an_object_lost_from_r2_is_put_back_byte_identical(tmp_path, env):
    p = pl.start(asyncio.get_running_loop())
    sent = await _archive(p, jr.FileJournal(str(tmp_path / "j")), n=20)
    reader = FileJournalReader(str(tmp_path / "j"))
    victim = sent[5]["id"]
    path = pathlib.Path(reader.dir) / f"{victim}.json"
    original = path.read_bytes()
    path.unlink()                                      # someone deleted an archive object
    rcn = rc.Reconciler(p, reader)
    rep = await integrity.run(p, rcn, backup_probe=None)
    assert rep["journal"]["lost_from_r2"] == 1 and rep["relinked"] == 1
    _wait_alerts()
    assert any("lost_from_r2" in m for m in env)
    p.store._conn().execute("UPDATE deliveries SET ingested_at_ms = ? WHERE event_id = ?",
                            (NOW_MS - 3_600_000, victim))  # it was ingested long ago, as in production
    await rcn.repair_once()                            # the existing repair pass PUTs it back
    assert path.read_bytes() == original
    assert (await integrity.run(p, rcn, backup_probe=None))["ok"]


async def test_ledger_mismatches_and_a_stale_or_missing_snapshot_are_problems(tmp_path):
    p = pl.start(asyncio.get_running_loop())
    await _archive(p, jr.FileJournal(str(tmp_path / "j")), n=20)
    reader = FileJournalReader(str(tmp_path / "j"))
    p.store._conn().execute("UPDATE headlines SET repeat_count = repeat_count + 1 WHERE seq = 1")
    old = lambda now: {"status": "ok", "newest": "x", "count": 3, "age_h": 49.0}  # noqa: E731
    rep = integrity.check(p.store, reader, backup_probe=old)
    assert any("repeat total" in x for x in rep["problems"])
    assert any("repeat_count_mismatch: 1" in x for x in rep["problems"])
    assert any("49.0 h old" in x for x in rep["problems"])
    rep = integrity.check(p.store, reader, backup_probe=lambda now: {"status": "none"})
    assert any("nightly snapshot: none" in x for x in rep["problems"])


def test_the_backup_probe_reads_the_bucket_by_name(monkeypatch):
    class R2:
        def list_objects_v2(self, Bucket=None, Prefix="", ContinuationToken=None):
            keys = ["store_backups/trade_exchange_news/20261031T070500Z.db.gz.enc",
                    "store_backups/trade_exchange_news/20261030T070500Z.db.gz.enc"]
            return {"Contents": [{"Key": k} for k in keys if k.startswith(Prefix)], "IsTruncated": False}
    monkeypatch.setenv(sb.ENABLED_ENV, "1")
    monkeypatch.setattr(sb, "_r2", lambda: (R2(), "bucket"))
    b = integrity.newest_backup(dt.datetime(2026, 10, 31, 9, 5, tzinfo=dt.timezone.utc))
    assert b == {"status": "ok", "newest": "2026-10-31T07:05:00+00:00", "count": 2, "age_h": 2.0}
    monkeypatch.setenv(sb.ENABLED_ENV, "0")
    assert integrity.newest_backup(dt.datetime.now(dt.timezone.utc)) == {"status": "disabled"}


def test_the_merge_handles_ids_on_either_side_only():
    class S:
        path = ":memory:"

    class R:
        def ids_after(self, _c):
            return iter(["A", "C", "E"])
    rows = [("B", 1, True), ("C", 1, True), ("D", 0, True)]
    import types
    store = types.SimpleNamespace()
    old = integrity._ledger_ids
    integrity._ledger_ids = lambda _s: iter(rows)
    try:
        j = integrity.journal_compare(store, R(), NOW_MS)
    finally:
        integrity._ledger_ids = old
    assert j["missing_in_sqlite"] == 2 and j["recover_ids"] == ["A", "E"]
    assert j["lost_from_r2"] == 1 and j["relink_ids"] == ["B"]
    assert j["unconfirmed_old"] == 1 and j["journal_objects"] == 3


# ── 5. administrators are alerted, not only logged ───────────────────────────

def test_a_condition_alerts_once_after_its_delay_reminds_and_resolves(env):
    t = 1_000.0
    ops_alerts.condition("journal_unreachable", True, "down", after_s=600, now=t)
    ops_alerts.condition("journal_unreachable", True, "down", after_s=600, now=t + 599)
    _wait_alerts()
    assert env == []                                   # a blip is not an alert
    ops_alerts.condition("journal_unreachable", True, "down", after_s=600, now=t + 600)
    ops_alerts.condition("journal_unreachable", True, "down", after_s=600, now=t + 900)
    _wait_alerts()
    assert len(env) == 1 and "down" in env[0]
    ops_alerts.condition("journal_unreachable", True, "down", after_s=600, now=t + 600 + ops_alerts.REMIND_S)
    ops_alerts.condition("journal_unreachable", False, now=t + 600 + ops_alerts.REMIND_S + 1)
    _wait_alerts()
    assert len(env) == 3 and "resolved" in env[2]


async def test_failing_recovery_raises_an_admin_alert(tmp_path, env, monkeypatch):
    p = pl.start(asyncio.get_running_loop())

    class Down:
        kind = "s3"

        def ids_after(self, _c):
            raise ConnectionError("r2 down")
    rcn = rc.Reconciler(p, Down())
    clock = [1_000.0]
    real = ops_alerts.condition
    monkeypatch.setattr(ops_alerts, "condition", lambda k, f, t="", **kw: real(k, f, t, now=clock[0], **kw))
    await rcn.run_once()
    clock[0] += 601
    await rcn.run_once()
    _wait_alerts()
    assert len(env) == 1 and "recovery from the R2 journal" in env[0] and "ConnectionError" in env[0]
    assert "SYNTHETIC" not in env[0]                  # counts and error names only


async def test_alerts_carry_no_headline_content(tmp_path, env):
    p = pl.start(asyncio.get_running_loop())
    await _archive(p, jr.FileJournal(str(tmp_path / "j")), n=10)
    p.store._conn().execute("UPDATE headlines SET repeat_count = 9 WHERE seq = 2")
    await integrity.run(p, rc.Reconciler(p, FileJournalReader(str(tmp_path / "j"))), backup_probe=None)
    _wait_alerts()
    assert env and not any("SYNTHETIC" in m or "Example Corp" in m for m in env)


# ── 6. scale: bounded caches, fast days, unchanged ingest ────────────────────

SCALE_ROWS = int(os.environ.get("TXN_SCALE_ROWS", "150000"))
SCALE_DAYS = 900


def _bulk(path: str, n: int, days: int) -> None:
    """``n`` synthetic headlines (+ their deliveries) over ``days`` ET days, written
    straight into a News database -- the shape of years of archive."""
    s = Store(path)
    c = s._conn()
    t0 = NOW_MS - days * DAY_MS
    step = days * DAY_MS // n
    c.execute("BEGIN")
    for k in range(0, n, 20_000):
        hs, ds = [], []
        for i in range(k, min(n, k + 20_000)):
            ms = t0 + i * step
            eid = jr.new_event_id(ms)
            hs.append((eid, "TXNews1", f"SYNTHETIC wire {i}: Example Corp {i % 977} reports item {i}", ms,
                       f"d{i}", "[]", ms, "push"))
            ds.append((eid, i + 1, ms, "headline", "push", ms, "[]", "[]", "{}", 1))
        c.executemany("INSERT INTO headlines(event_id, source, content, received_at_ms, dedupe_key, tickers, "
                      "ingested_at_ms, via) VALUES (?,?,?,?,?,?,?,?)", hs)
        c.executemany("INSERT INTO deliveries(event_id, headline_seq, received_at_ms, kind, via, ingested_at_ms, "
                      "header_names, extra_keys, record_json, journaled) VALUES (?,?,?,?,?,?,?,?,?,?)", ds)
    c.execute("COMMIT")


@pytest.fixture(scope="module")
def big_db(tmp_path_factory):
    path = str(tmp_path_factory.mktemp("big") / "big.db")
    _bulk(path, SCALE_ROWS, SCALE_DAYS)
    return path


def test_day_browsing_stays_fast_and_caches_stay_bounded_at_scale(big_db):
    s = Store(big_db)
    arc.clear_index()
    arc.clear_cache()
    t = time.perf_counter()
    meta = arc.days(s)
    t_days = time.perf_counter() - t
    assert sum(d["count"] for d in meta["days"]) == SCALE_ROWS and meta["first_day_partial"]
    t = time.perf_counter()
    meta2 = arc.days(s)
    t_days_warm = time.perf_counter() - t
    assert meta2["days"] == meta["days"]
    picks = [date.fromisoformat(d["date"]) for d in meta["days"][:: max(1, len(meta["days"]) // 120)]]
    cold, warm = [], []
    for d in picks:                                    # ~120 different days: the LRU must evict
        t = time.perf_counter()
        r = arc.day_slice(s, day=d, limit=60, hide_placeholders=False)
        cold.append(time.perf_counter() - t)
        assert r["total"] > 0
        t = time.perf_counter()
        arc.day_slice(s, day=d, limit=60, query="example", hide_placeholders=False)
        warm.append(time.perf_counter() - t)
    st = arc.cache_stats()
    assert st["days_cached"] <= arc.DAY_CACHE_DAYS and st["day_rows"] <= arc.DAY_CACHE_ROWS
    assert st["tail_rows"] <= arc.TAIL_MAX
    assert st["derived_light"] <= arc.DERIVED_MAX and st["derived_full"] <= arc.DERIVED_MAX
    rows, first, top = arc.recent_rows(s, 200)
    assert len(rows) == 200 and top == SCALE_ROWS and first == 1
    older, _, _ = arc.recent_rows(s, 50, before=1000)  # far below the tail: one keyset read
    assert [r["seq"] for r in older] == list(range(950, 1000))
    cold.sort()
    warm.sort()
    report = {"rows": SCALE_ROWS, "days_first_s": round(t_days, 3), "days_warm_s": round(t_days_warm, 4),
              "day_cold_p50_ms": round(cold[len(cold) // 2] * 1000, 1), "day_cold_max_ms": round(cold[-1] * 1000, 1),
              "day_warm_p50_ms": round(warm[len(warm) // 2] * 1000, 1), **st}
    print("\nSCALE", report)
    assert cold[len(cold) // 2] < 0.5 and warm[len(warm) // 2] < 0.25
    assert t_days_warm < 0.25


def test_ingest_replay_and_integrity_cost_do_not_grow_with_the_archive(big_db, tmp_path):
    def ingest_ms(path):
        s = Store(path)
        base = NOW_MS + DAY_MS
        times = []
        for i in range(60):
            r = records.validate(rec(f"SYNTHETIC timing {i} {path[-12:]}", base + i * 1000))
            t = time.perf_counter()
            s.ingest(r, via="push", dedupe_key=records.dedupe_key(r["source"], r["content"]),
                     window_ms=60_000, tickers=[])
            times.append(time.perf_counter() - t)
        times.sort()
        return times[len(times) // 2] * 1000
    small = ingest_ms(str(tmp_path / "small.db"))
    large = ingest_ms(big_db)
    s = Store(big_db)
    t = time.perf_counter()
    s.after(s.last_seq() - 5, 500)                      # an SSE resume
    replay_ms = (time.perf_counter() - t) * 1000

    class Listing:                                      # the journal holds exactly the ledger
        def ids_after(self, _c):
            return (r[0] for r in sqlite3.connect(big_db).execute("SELECT event_id FROM deliveries ORDER BY event_id"))
    t = time.perf_counter()
    rep = integrity.check(s, Listing(), backup_probe=None)
    check_s = time.perf_counter() - t
    print("\nSCALE ingest_p50_ms small=%.2f large=%.2f replay_ms=%.2f integrity_s=%.2f problems=%s"
          % (small, large, replay_ms, check_s, rep["problems"]))
    assert large < small * 3 + 3
    assert replay_ms < 50
    assert rep["journal"]["missing_in_sqlite"] == 0 and rep["journal"]["lost_from_r2"] == 0

"""Speed pass, round 2 (2026-11-24): IVH, the IV floor everywhere, EEHSC, RSL, OWN, and the first open of STAT,
FCTX and VFP.

Live (2026-11-23 23:05 ET, a signed-in member): IVH 10.0 s, EEHSC 4.2 s then `computing`, STAT 2.5 s, FCTX 2.1 s,
OWN 2.0 s, VFP 1.6 s, RSL 1.5 s. Each fix is proved here on INVENTED inputs: the request answers within a bound
with the slow dependency stood in for by one that blocks; the figures are the same as before (before/after
equality); nothing is held for another symbol, another day or past its validity, and a failed build is never held
as current; two requests start one build. The sizes each new hold or index takes are measured here too.

No test reads a real store, the network, a vendor, R2, an agency or production. Routes are mounted on a bare app
(the router alone), so this file never imports `api.main`.
"""
from __future__ import annotations

import csv
import datetime as dt
import gzip
import json
import os
import random
import shutil
import sys
import threading
import time
from zoneinfo import ZoneInfo

import pytest
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user_with_plan
from api.services import options_universe_log as oplog
from api.services import session_calendar
from api.services.research import iv_history as IVH
from api.services.research import iv_history_index as IX

ET = ZoneInfo("America/New_York")
PAID = {"id": "sp2-paid", "email": "paid@example.test", "role": "member", "plan": "pro"}
FAST_S = 0.5            # "at once": far under the stub's block and every wait these routes used to make
NOW = dt.datetime(2031, 3, 21, 18, 0, tzinfo=ET)      # a Friday evening, after the day's log is due


def _client(router):
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_current_user_with_plan] = lambda: dict(PAID)
    return TestClient(app, raise_server_exceptions=False)


def _timed(fn):
    t0 = time.monotonic()
    out = fn()
    return out, time.monotonic() - t0


def _join(prefix: str, timeout: float = 10.0) -> None:
    """Wait for every thread whose name starts with `prefix` (builds a test started)."""
    end = time.time() + timeout
    while time.time() < end and any(t.name.startswith(prefix) and t.is_alive() for t in threading.enumerate()):
        time.sleep(0.02)


def _deep_size(obj, seen=None) -> int:
    """Bytes an object graph takes in this process (containers and their contents, each object once)."""
    seen = set() if seen is None else seen
    if id(obj) in seen:
        return 0
    seen.add(id(obj))
    size = sys.getsizeof(obj)
    if isinstance(obj, dict):
        size += sum(_deep_size(k, seen) + _deep_size(v, seen) for k, v in obj.items())
    elif isinstance(obj, (list, tuple, set, frozenset)):
        size += sum(_deep_size(v, seen) for v in obj)
    return size


# ══ 1. IVH: the background listing and the local index ═════════════════════════════════════════

def _sessions(n: int, last: str = "2031-03-21") -> list:
    d, out = dt.date.fromisoformat(last), []
    while len(out) < n:
        if session_calendar.is_trading_day(d):
            out.append(d.isoformat())
        d -= dt.timedelta(days=1)
    return out[::-1]


def _age(*paths, s: float = 3600.0) -> None:
    old = time.time() - s
    for p in paths:
        os.utime(p, (old, old))


def _write_day(root, session, rows, *, fields=oplog.UNDERLYING_FIELDS, complete=True, order="sorted", age=True):
    """One day of the log in the logger's layout. `order`: 'sorted' (the logger's), or 'as_given'."""
    ydir = os.path.join(str(root), "options_log", session[:4])
    os.makedirs(ydir, exist_ok=True)
    path = os.path.join(ydir, f"{session}.underlyings.csv.gz")
    with gzip.open(path, "wt", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        for r in (sorted(rows, key=lambda r: r["underlying"]) if order == "sorted" else rows):
            w.writerow(r)
    mp = os.path.join(ydir, f"{session}.manifest.json")
    with open(mp, "w", encoding="utf-8") as fh:
        json.dump({"session": session, "complete": complete, "reason": None if complete else "invented"}, fh)
    if age:
        _age(path, mp)
    return path


def _row(sym, iv, *, px=100.0, dte=30, exp="2031-04-17", straddle=None, fexp=None):
    return {"underlying": sym, "contracts": 10, "call_oi": 1, "put_oi": 1, "underlying_price": px, "atm_iv": iv,
            "atm_expiration": exp, "atm_strike": px, "atm_dte": dte, "front_expiration": fexp, "front_dte": None,
            "front_strike": None, "front_straddle": straddle}


SYMS = [f"ZQ{a}{b}" for a in "ABCDEFGH" for b in "JKLMN"]          # 40 invented tickers


def _invented_log(root, *, n=30, seed=7):
    """An invented log on every edge the index must reproduce: blank and placeholder IVs, a value with spaces, a
    legacy (20-45 rule) day, an incomplete day, a day whose rows are NOT sorted (the file scan stops early), a
    duplicated underlying (the first row counts), a row with no underlying, and symbols that skip days."""
    rng = random.Random(seed)
    days = _sessions(n)
    for i, d in enumerate(days):
        rows = []
        for s in SYMS:
            if rng.random() < 0.12:
                continue                                     # not in the log that day
            pick = rng.random()
            iv = ("" if pick < 0.06 else round(IVH.IV_FLOOR / 5, 6) if pick < 0.10
                  else f" {rng.uniform(0.15, 0.9):.6f} " if pick < 0.13 else round(rng.uniform(0.15, 0.9), 6))
            rows.append(_row(s, iv, px=round(rng.uniform(10, 400), 2), dte=rng.randint(20, 40)))
        if i == 3:
            _write_day(root, d, [{k: v for k, v in r.items() if k not in ("atm_dte", "front_expiration", "front_dte",
                                                                          "front_strike", "front_straddle")}
                                 for r in rows],
                       fields=("underlying", "contracts", "call_oi", "put_oi", "underlying_price", "atm_iv",
                               "atm_expiration", "atm_strike"))
        elif i == 7:
            rng.shuffle(rows)                                 # unsorted: the file scan stops at the first larger name
            _write_day(root, d, rows, order="as_given")
        elif i == 9:
            dup = [dict(r, atm_iv=0.99) for r in rows[:5]]
            _write_day(root, d, sorted(rows + dup, key=lambda r: r["underlying"]) + [_row("", 0.5)], order="as_given")
        else:
            _write_day(root, d, rows, complete=(i != 12))
    return days


@pytest.fixture
def ivlog(tmp_path, monkeypatch):
    root = tmp_path / "mirror"
    root.mkdir()
    monkeypatch.setattr(IVH, "_store_override", None)
    monkeypatch.setattr(IVH, "_default_store", None)
    IVH._ROW_CACHE.clear()
    IVH._MANIFESTS.clear()
    yield root
    IX.for_root(str(root)).drain(10)
    IVH._ROW_CACHE.clear()
    IVH._MANIFESTS.clear()


def _local(root):
    return IVH.LocalStore(str(root))


def test_the_index_gives_exactly_the_file_scans_answer_for_every_symbol_on_every_edge(ivlog, monkeypatch):
    _invented_log(ivlog)
    before = {s: IVH.iv_history(s, now=NOW, store=_local(ivlog)) for s in SYMS + ["ZQZZ"]}
    assert not os.path.exists(os.path.join(str(ivlog), IX.FILE))     # a reader never creates the index
    added, racy = IX.for_root(str(ivlog)).build_once()
    assert added == 30 and racy == 0
    monkeypatch.setattr(IVH, "_day_row", lambda *a: pytest.fail("a file was scanned with the index in place"))
    after = {s: IVH.iv_history(s, now=NOW, store=_local(ivlog)) for s in SYMS + ["ZQZZ"]}
    assert after == before
    assert any(p["implausible_iv"] for a in after.values() for p in a.get("points", []))      # the edges were reached
    assert any(p["rule"] == IVH.LEGACY_RULE for a in after.values() for p in a.get("points", []))
    assert before["ZQZZ"]["status"] == "not_in_log"


def test_a_days_rows_are_the_rows_the_file_scan_finds(ivlog):
    days = _invented_log(ivlog)
    store = _local(ivlog)
    for d in (days[7], days[9], days[3], days[0]):                    # unsorted, duplicated, legacy, plain
        rule, rows = IX.rows_of(store.summary_path(d))
        for s in SYMS + ["", "ZQZZ", "AAAA"]:
            want = IVH._day_row(store, d, s) if s else None
            got = rows.get(s)
            if want is None:
                assert got is None, (d, s)
            else:
                assert dict(zip(IX.CELLS, got)) == {c: want.get(c) for c in IX.CELLS} and rule == want["_rule"], (d, s)


def test_a_replaced_or_unindexed_day_is_read_from_its_file_and_the_index_catches_up(ivlog):
    days = _invented_log(ivlog, n=6)
    IX.for_root(str(ivlog)).build_once()
    sym = "ZQAJ"
    path = _write_day(ivlog, days[-1], [_row(sym, 0.777777), _row("ZQAK", 0.5)])     # the newest day replaced
    os.utime(path, (time.time() - 1800, time.time() - 1800))
    IVH._ROW_CACHE.clear()
    got = IVH.iv_history(sym, now=NOW, store=_local(ivlog))
    assert got["points"][-1]["atm_iv"] == 0.777777                    # the stale indexed row is never served
    IX.for_root(str(ivlog)).build_once()
    rows = IX.for_root(str(ivlog)).lookup(sym)[1]
    assert rows[days[-1]][0] == "0.777777"


def test_a_file_written_this_instant_is_not_indexed_yet_and_a_damaged_one_never(ivlog):
    days = _sessions(3)
    _write_day(ivlog, days[0], [_row("ZQAJ", 0.3)])
    _write_day(ivlog, days[1], [_row("ZQAJ", 0.31)], age=False)        # just written: same-tick rewrites are possible
    bad = _write_day(ivlog, days[2], [_row("ZQAJ", 0.32)])
    with open(bad, "r+b") as fh:                                       # a truncated deflate stream
        fh.truncate(os.path.getsize(bad) - 12)
    _age(bad)
    added, racy = IX.for_root(str(ivlog)).build_once()
    assert (added, racy) == (1, 1)
    held = IX.for_root(str(ivlog)).lookup("ZQAJ")[0]
    assert set(held) == {days[0]}


def test_a_damaged_index_is_built_again_and_meanwhile_the_files_answer(ivlog):
    _invented_log(ivlog, n=5)
    before = IVH.iv_history("ZQBK", now=NOW, store=_local(ivlog))
    path = os.path.join(str(ivlog), IX.FILE)
    with open(path, "wb") as fh:
        fh.write(b"not a database at all, invented bytes" * 100)
    idx = IX.for_root(str(ivlog))
    assert idx.lookup("ZQBK") is None                                   # unreadable: the files answer
    assert IVH.iv_history("ZQBK", now=NOW, store=_local(ivlog)) == before
    assert idx.build_once()[0] == 5
    assert IVH.iv_history("ZQBK", now=NOW, store=_local(ivlog)) == before


def test_the_routes_own_store_starts_one_index_build_and_a_reader_with_its_own_store_starts_none(ivlog, monkeypatch):
    _invented_log(ivlog, n=4)
    idx = IX.for_root(str(ivlog))
    IVH.iv_history("ZQAJ", now=NOW, store=_local(ivlog))
    assert idx.builds == 0 and not os.path.exists(os.path.join(str(ivlog), IX.FILE))     # the Agent's way
    gate = threading.Event()
    real = idx.build_once
    monkeypatch.setattr(idx, "build_once", lambda: (gate.wait(10), real())[1])
    monkeypatch.setattr(IVH, "_store_override", _local(ivlog))
    IVH.iv_history("ZQAJ", now=NOW)
    IVH.iv_history("ZQAK", now=NOW)
    assert idx.builds == 1                                              # two answers, one build
    gate.set()
    idx.drain(10)
    assert idx.lookup("ZQAJ") is not None


class FakeR2:
    """The bucket's listing and downloads, from an invented local copy; `gate` holds the listing."""

    def __init__(self, remote, gate=None, fail=None):
        self.remote, self.gate, self.fail, self.lists, self.downloads = str(remote), gate, fail, 0, []

    def get_paginator(self, name):
        fake = self

        class Pages:
            def paginate(self, Bucket, Prefix):
                fake.lists += 1
                if fake.gate is not None:
                    fake.gate.wait(10)
                if fake.fail:
                    raise fake.fail
                items = []
                for dirpath, _dirs, files in os.walk(os.path.join(fake.remote, "options_log")):
                    for f in files:
                        full = os.path.join(dirpath, f)
                        items.append({"Key": os.path.relpath(full, fake.remote).replace(os.sep, "/"),
                                      "ETag": str(os.path.getsize(full))})
                yield {"Contents": sorted(items, key=lambda o: o["Key"])}
        return Pages()

    def download_file(self, bucket, key, dest):
        self.downloads.append(key)
        shutil.copyfile(os.path.join(self.remote, *key.split("/")), dest)


@pytest.fixture
def r2(tmp_path, monkeypatch, ivlog):
    remote = tmp_path / "bucket"
    remote.mkdir()
    store = IVH.R2Store(str(ivlog))
    monkeypatch.setattr(IVH, "_default_store", store)
    monkeypatch.setenv(IVH.FLAG, "1")
    yield store, remote
    store.drain(10)


def _use(store, fake, monkeypatch):
    monkeypatch.setattr(store, "_client", lambda: (fake, "invented-bucket"))


def test_a_cold_store_with_nothing_mirrored_says_unavailable_at_once_and_never_no_sessions(r2, monkeypatch):
    store, remote = r2
    _invented_log(remote, n=5)
    gate = threading.Event()
    fake = FakeR2(remote, gate)
    _use(store, fake, monkeypatch)
    from api.routers import iv_history as route
    resp, took = _timed(lambda: _client(route.router).get("/api/research/iv-history/ZQAJ"))
    assert resp.status_code == 503 and "LogNotReady" in resp.json()["detail"] and took < FAST_S + 0.5, took
    with pytest.raises(IVH.LogNotReady):
        IVH.iv_history("ZQAJ", now=NOW)
    assert fake.lists == 1                                              # two asks, one listing
    gate.set()
    store.drain(10)
    out = IVH.iv_history("ZQAJ", now=NOW)
    assert out["status"] == "ok" and IVH.R2Store.COLD_NOTE not in out["partial_reasons"]
    assert out == IVH.iv_history("ZQAJ", now=NOW, store=_local(store.root))   # the mirror's own answer
    assert fake.lists == 1                                              # inside the TTL: no new listing


def test_a_cold_store_with_a_copy_on_disk_answers_from_it_at_once_and_says_it_is_partial(r2, monkeypatch):
    store, remote = r2
    _invented_log(remote, n=5)
    _invented_log(store.root, n=4)                                      # what an earlier process mirrored
    gate = threading.Event()
    _use(store, FakeR2(remote, gate), monkeypatch)
    out, took = _timed(lambda: IVH.iv_history("ZQAJ", now=NOW))
    assert took < FAST_S, took
    assert out["partial"] is True and out["partial_reasons"][-1] == IVH.R2Store.COLD_NOTE
    with pytest.raises(IVH.LogNotReady):                                # the print table never answers from it
        IVH.implied_vs_realized("ZQAJ", now=NOW, prints=lambda s: [], realized=lambda s, q: [])
    gate.set()
    store.drain(10)
    assert IVH.R2Store.COLD_NOTE not in IVH.iv_history("ZQAJ", now=NOW)["partial_reasons"]


def test_a_listing_older_than_the_ttl_is_refreshed_in_the_background_while_the_request_reads_the_mirror(r2, monkeypatch):
    store, remote = r2
    _invented_log(remote, n=5)
    fake = FakeR2(remote)
    _use(store, fake, monkeypatch)
    store.sessions()                                                    # a background build listed it once
    assert fake.lists == 1
    store._listed_at -= store.LIST_TTL_S + 1
    fake.gate = threading.Event()
    before = IVH.iv_history("ZQAJ", now=NOW)
    out, took = _timed(lambda: IVH.iv_history("ZQAJ", now=NOW))
    assert took < FAST_S and out == before and fake.lists == 2          # one refresh for both requests
    fake.gate.set()


def test_a_failed_listing_is_said_as_before_and_not_tried_again_on_every_request(r2, monkeypatch):
    store, remote = r2
    fake = FakeR2(remote, fail=RuntimeError("DATA_SYNC_* R2 credentials are not set on this service"))
    _use(store, fake, monkeypatch)
    with pytest.raises(IVH.LogNotReady):
        IVH.iv_history("ZQAJ", now=NOW)
    store.drain(10)
    from api.routers import iv_history as route
    for _ in range(3):
        resp = _client(route.router).get("/api/research/iv-history/ZQAJ")
        assert resp.status_code == 503 and resp.json()["detail"] == "The options log is unavailable: RuntimeError"
    assert fake.lists == 1                                              # RETRY_S: no new listing per request
    # a store that listed before and fails later keeps answering from its mirror, up to twice the TTL
    fake.fail = None
    store._failed = None
    _invented_log(remote, n=3)
    store.sessions()
    fake.fail = RuntimeError("invented outage")
    store._listed_at -= store.LIST_TTL_S + 1
    assert IVH.iv_history("ZQAJ", now=NOW)["status"] == "ok"
    store.drain(10)
    assert IVH.iv_history("ZQAJ", now=NOW)["status"] == "ok"            # 1x the TTL old: served
    store._listed_at -= store.LIST_TTL_S
    with pytest.raises(RuntimeError, match="invented outage"):          # 2x the TTL old: the old 503
        IVH.iv_history("ZQAJ", now=NOW)


def test_a_manifest_is_opened_once_while_its_file_is_unchanged(ivlog, monkeypatch):
    _invented_log(ivlog, n=4)
    store = _local(ivlog)
    first = store.sessions()
    opened = []
    real_open = open
    monkeypatch.setattr("builtins.open", lambda p, *a, **k: opened.append(str(p)) or real_open(p, *a, **k))
    assert store.sessions() == first and not [p for p in opened if p.endswith(".manifest.json")]


def test_the_index_size_on_invented_data_at_the_logs_real_width(tmp_path):
    rng = random.Random(3)
    syms = sorted({"".join(rng.choice("ABCDEFGHIJKLMNOPQRSTUVWXYZ") for _ in range(rng.randint(1, 5)))
                   for _ in range(9000)})[:6000]
    for d in _sessions(3):
        _write_day(tmp_path, d, [_row(s, round(rng.uniform(0.1, 1.5), 6), px=round(rng.uniform(1, 900), 2),
                                      dte=rng.randint(7, 90)) for s in syms])
    idx = IX.Index(str(tmp_path))
    assert idx.build_once()[0] == 3
    per_session = sum(os.path.getsize(os.path.join(str(tmp_path), IX.FILE) + s)
                      for s in ("", "-wal") if os.path.exists(os.path.join(str(tmp_path), IX.FILE) + s)) / 3
    print(f"\n[measure] IVH index: {per_session / 1e6:.3f} MB of disk per session at 6,000 underlyings; "
          f"{per_session * IX.MAX_SESSIONS / 1e6:.0f} MB at the {IX.MAX_SESSIONS}-session bound")
    assert per_session < 0.4e6


# ══ 2. The IV floor everywhere ═════════════════════════════════════════════════════════════════

PLACEHOLDER = round(IVH.IV_FLOOR / 5, 6)      # an invented vendor placeholder (~0.002)


def test_oscr_iv_percentile_never_ranks_a_placeholder(tmp_path, monkeypatch):
    from api.services.research import options_screener as osc
    days = _sessions(22)
    for i, d in enumerate(days):
        _write_day(tmp_path, d, [_row("ZQAJ", PLACEHOLDER if i == 5 else 0.30 + (i % 4) / 100),
                                 _row("ZQAK", 0.40 + (i % 3) / 100 if i < 21 else PLACEHOLDER),
                                 _row("ZQAL", PLACEHOLDER)])
    osc._FILE_CACHE.clear()
    out = osc.iv_percentile(store=osc.LocalStore(str(tmp_path)), now=NOW)
    ranked = {r["underlying"]: r for r in out["ranked"]}
    assert set(ranked) == {"ZQAJ"}                     # ZQAK's newest reading is a placeholder; ZQAL has none at all
    assert ranked["ZQAJ"]["n_sessions"] == 21 and ranked["ZQAJ"]["low"] == 0.30
    assert out["coverage"]["evaluated"] == 1


def test_log_history_daily_move_and_iv_crush_never_use_a_placeholder(tmp_path, monkeypatch):
    from api.services.options_analytics import log_history as LH
    days = _sessions(8)
    for i, d in enumerate(days):
        _write_day(tmp_path, d, [_row("ZQAJ", PLACEHOLDER if i == 2 else 0.32, px=100.0 + i)])
    store = _local(tmp_path)
    moves = LH.daily_move("ZQAJ", now=NOW, store=store)
    assert days[2] not in [p["date"] for p in moves["pairs"]]
    assert {"date": days[2], "next": days[3], "reason": "no ATM IV or price on one side"} in moves["broken_pairs"]
    assert all(p["atm_iv"] >= IVH.IV_FLOOR for p in moves["pairs"])
    monkeypatch.setattr(LH, "_prints", lambda sym: [{"reportedDate": days[3], "reportTime": "post-market"}])
    crush = LH.iv_crush("ZQAJ", now=NOW, store=store)
    cells = crush["prints"][0]["iv"]
    assert cells["-1"] is None and cells["0"] == 0.32       # session 0 is the report day; -1 held the placeholder


# ══ 3. EEHSC: no wait, and a copy on disk ══════════════════════════════════════════════════════

@pytest.fixture
def eehsc(monkeypatch, tmp_path):
    from api.services import estimate_history as EH
    from api.services import estimate_revisions as ER
    from api.services import group_stats as GS
    from tests import test_estimate_revisions as T
    monkeypatch.delenv(EH.ENABLED_ENV, raising=False)
    monkeypatch.setenv("ESTIMATE_HISTORY_DB_PATH", str(tmp_path / "eh.db"))
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setattr(GS, "_group_map", lambda: dict(T.GROUPS))
    ER.reset_for_tests()
    yield ER, T, tmp_path
    ER.drain_for_tests()
    ER.reset_for_tests()


def test_eehsc_with_nothing_held_answers_computing_at_once(eehsc, monkeypatch):
    ER, T, _ = eehsc
    gate = threading.Event()
    monkeypatch.setattr(ER, "build", lambda previous=None, **k: (gate.wait(10), ({"status": "ok"}, "x"))[1])
    from api.routers import research_cov as route
    from api.services import estimate_history as EH
    monkeypatch.setenv(EH.ENABLED_ENV, "1")
    resp, took = _timed(lambda: _client(route.router).get("/api/research/estimate-history?metric=eps&window=30"))
    assert resp.status_code == 200 and resp.json() == {"status": "computing", "metric": "eps", "window": 30}
    assert took < FAST_S + 0.5, took
    gate.set()


def test_eehsc_two_requests_start_one_read_and_a_restart_answers_from_disk_with_the_same_figures(eehsc, monkeypatch):
    ER, T, tmp = eehsc
    T._fill()
    reads = []
    real = ER.build
    monkeypatch.setattr(ER, "build", lambda previous=None, **k: reads.append(1) or real(previous, **k))
    assert ER.get_breadth("eps", 30)["status"] == "computing"
    assert ER.get_breadth("revenue", 7)["status"] == "computing"
    ER.drain_for_tests()
    assert len(reads) == 1
    before = {(m, w): ER.get_breadth(m, w) for m in ER.METRICS for w in ER.WINDOWS}
    assert os.path.exists(os.path.join(str(tmp), *ER.DISK))
    ER.reset_for_tests()                                                # a restart
    from api.services import estimate_history as EH
    monkeypatch.setattr(EH, "_conn", lambda: pytest.fail("the store was read on a request"))
    after, took = _timed(lambda: {(m, w): ER.get_breadth(m, w) for m in ER.METRICS for w in ER.WINDOWS})
    assert after == before and took < FAST_S and len(reads) == 1


def test_eehsc_a_copy_from_another_day_version_or_shape_is_never_served_and_a_failed_read_never_written(eehsc, monkeypatch):
    ER, T, tmp = eehsc
    T._fill()
    ER.get_breadth()
    ER.drain_for_tests()
    path = os.path.join(str(tmp), *ER.DISK)
    good = json.load(open(path, encoding="utf-8"))
    gate = threading.Event()
    monkeypatch.setattr(ER, "build", lambda previous=None, **k: (gate.wait(10), (None, "x"))[1])
    real_today = ER.today_et
    tomorrow = real_today() + dt.timedelta(days=1)
    for doc, when in ((good, tomorrow), ({**good, "v": ER.ANSWER_VERSION + 1}, None),
                      ({**good, "held": {**good["held"], "slices": None}}, None)):
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(doc, fh)
        monkeypatch.setattr(ER, "today_et", (lambda when=when: when) if when else real_today)
        ER.reset_for_tests()
        assert ER.get_breadth()["status"] == "computing", doc.get("v")
    gate.set()
    _join("estimate-revisions-build")
    os.remove(path)
    monkeypatch.setattr(ER, "build", lambda previous=None, **k: (_ for _ in ()).throw(RuntimeError("invented")))
    ER.reset_for_tests()
    ER.get_breadth()
    ER.drain_for_tests()
    assert ER.get_breadth()["status"] == "failed" and not os.path.exists(path)


# ══ 4. RSL: the finished bytes, made once per input ════════════════════════════════════════════

def _rankings(n=300, seed=5):
    rng = random.Random(seed)
    rows = [{"ticker": f"ZR{i:03d}", "rs_score": round(rng.uniform(-40, 120), 2), "rs_rank": rng.randint(1, 99),
             "returns": {"3m": round(rng.uniform(-30, 60), 2), "6m": round(rng.uniform(-40, 90), 2)}} for i in range(n)]
    return sorted(rows, key=lambda r: -r["rs_rank"])


def _old_body(data, pending):
    """The route's answer as it was made before the speed pass, on every request."""
    from api.services import deal_status
    from api.services.rs_ranking import unified_rankings
    shown = unified_rankings(data)
    if pending:
        shown = [r for r in shown if not deal_status.is_pending(r.get("ticker"), pending)]
    return JSONResponse(content=shown).body


@pytest.fixture
def rsl(monkeypatch):
    from api.routers import rs_ranking as route
    from api.services import deal_status
    from api.services import rs_ranking as rs
    rows = _rankings()
    rs._rs_cache.set(rs._CACHE_KEY, rows, ttl=600)
    route.reset_bodies()
    rs.invalidate_ibd_cache()                  # no rating table from another test (speed pass 3 keeps the last one)
    monkeypatch.delenv("RS_RANK_IBD_ENABLED", raising=False)
    state = {"pending": frozenset()}
    monkeypatch.setattr(deal_status, "consumer_pending", lambda: state["pending"])
    yield route, rs, rows, state
    rs._rs_cache.invalidate(rs._CACHE_KEY)
    rs.invalidate_ibd_cache()
    route.reset_bodies()


def test_rsl_bytes_equal_the_old_answer_with_the_rating_off_and_on_and_pending_deals(rsl, monkeypatch):
    route, rs, rows, state = rsl
    client = _client(route.router)
    table = ("2031-03-20", {r["ticker"]: 100 - i % 99 for i, r in enumerate(rows[::3])} | {"ZRETF": 77})
    for on in (False, True):
        for pending in (frozenset(), frozenset({"ZR001", "ZR150"})):
            if on:
                monkeypatch.setenv("RS_RANK_IBD_ENABLED", "1")
                monkeypatch.setattr(rs, "_ibd_latest", lambda: table)
            state["pending"] = pending
            resp = client.get("/api/rs-rankings")
            assert resp.status_code == 200 and resp.headers["content-type"] == "application/json"
            assert resp.content == _old_body(rows, pending), (on, pending)
            assert len(resp.json()) == len(rows) - len(pending)                 # whole: nothing else cut


def test_rsl_a_repeat_makes_nothing_and_any_new_input_makes_new_bytes(rsl, monkeypatch):
    route, rs, rows, state = rsl
    client = _client(route.router)
    made = route.body_builds
    slow = {"n": 0}
    real = route.unified_rankings

    def counted(data, table=None):            # speed pass 3: the bytes are made from the very table their key names
        slow["n"] += 1
        time.sleep(0.6)
        return real(data, table=table)

    monkeypatch.setattr(route, "unified_rankings", counted)
    first = client.get("/api/rs-rankings").content
    again, took = _timed(lambda: client.get("/api/rs-rankings").content)
    assert again == first and took < FAST_S and route.body_builds == made + 1 and slow["n"] == 1
    rows2 = [dict(r, rs_rank=r["rs_rank"] % 50) for r in rows]                 # a new ranking: a new list object
    rs._rs_cache.set(rs._CACHE_KEY, rows2, ttl=600)
    assert client.get("/api/rs-rankings").content == _old_body(rows2, frozenset()) and slow["n"] == 2
    state["pending"] = frozenset({"ZR002"})                                    # a new pending deal
    assert client.get("/api/rs-rankings").content == _old_body(rows2, state["pending"]) and slow["n"] == 3
    monkeypatch.setenv("RS_RANK_IBD_ENABLED", "1")                            # the rating switched on
    tables = iter([("2031-03-20", {"ZR005": 99}), ("2031-03-21", {"ZR005": 12})])
    current = {"t": next(tables)}
    monkeypatch.setattr(rs, "_ibd_latest", lambda: current["t"])
    one = client.get("/api/rs-rankings").content
    assert slow["n"] == 4 and one == _old_body(rows2, state["pending"])
    current["t"] = next(tables)                                                # a new rating table
    two = client.get("/api/rs-rankings").content
    assert slow["n"] == 5 and two != one and two == _old_body(rows2, state["pending"])
    assert len(route._bodies) <= route._BODY_MAX


def test_rsl_two_requests_at_once_make_the_bytes_once(rsl, monkeypatch):
    route, rs, rows, state = rsl
    real = route.unified_rankings
    calls = []
    monkeypatch.setattr(route, "unified_rankings",
                        lambda data, table=None: (calls.append(1), time.sleep(0.4), real(data, table=table))[2])
    out = []
    threads = [threading.Thread(target=lambda: out.append(route._body(rows, frozenset()))) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(10)
    assert len(calls) == 1 and out[0] == out[1] == _old_body(rows, frozenset())
    big = _rankings(5000, seed=9)
    body = route._body(big, frozenset())
    print(f"\n[measure] RSL: {len(body) / 1e6:.2f} MB of bytes per answer for 5,000 invented rows "
          f"(the list they hold alive: {_deep_size(big) / 1e6:.1f} MB); the bound is {route._BODY_MAX} answers")


# ══ 5. OWN: the record held in the module ══════════════════════════════════════════════════════

@pytest.fixture
def own(monkeypatch):
    from api.services import short_data
    from api.services.research import ownership as O
    O.forget_for_tests()
    calls = []
    complete = {"ok": True}

    def tf(sym):
        calls.append(("13f", sym))
        if not complete["ok"]:
            O._note_failed_read()
        return {"quarter": "2031Q1", "summary": {"ownership_pct": 61.0, "investors_holding": 12},
                "holders": [{"name": f"Invented Fund {i}", "shares": 1000.0 * i, "ownership": 0.1} for i in range(50)],
                "_meta": None}

    monkeypatch.setattr(O, "resolve_entity", lambda sym, vendor=None: ({"status": "resolved"}, sym))
    monkeypatch.setattr(O, "_thirteen_f", tf)
    monkeypatch.setattr(O, "_fmp_share_counts", lambda sym: calls.append(("counts", sym)) or
                        ({"float_shares": 9.0e6, "shares_outstanding": 1.0e7}, None))
    monkeypatch.setattr(O, "get_insider_activity", lambda sym: calls.append(("insider", sym)) or [])
    monkeypatch.setattr(short_data, "held_stock", lambda sym: (None, "not_held"))
    yield O, calls, complete
    O.forget_for_tests()


def test_own_a_held_record_survives_the_shared_cache_turning_over(own):
    O, calls, _ = own
    from api.services.cache import cache
    first = O.get_ownership("ZQOA")
    assert len(calls) == 3
    cache.clear()                                                               # a busy pod's churn
    second, took = _timed(lambda: O.get_ownership("ZQOA"))
    assert second == first and len(calls) == 3 and took < FAST_S


def test_own_keeps_the_same_validity_per_symbol_and_a_partial_record_only_briefly(own):
    O, calls, complete = own
    O.get_ownership("ZQOA")
    assert abs(O._HELD["ZQOA"][0] - time.time() - O._CACHE_TTL) < 5
    other = O.get_ownership("ZQOB")
    assert other["sym"] == "ZQOB" and len(calls) == 6                          # another symbol is its own read
    O._HELD["ZQOA"] = (time.time() - 1, O._HELD["ZQOA"][1])                    # past its 12 hours
    O.get_ownership("ZQOA")
    assert len(calls) == 9
    complete["ok"] = False
    O.forget_for_tests("ZQOC")
    out = O.get_ownership("ZQOC")
    assert out["legs_failed"] == [O.LEG_13F] and abs(O._HELD["ZQOC"][0] - time.time() - O._FAIL_TTL) < 5


def test_own_the_hold_is_bounded_and_its_size_measured(own, monkeypatch):
    O, calls, _ = own
    bound = O.HELD_MAX
    monkeypatch.setattr(O, "HELD_MAX", 3)
    for s in ("ZQOA", "ZQOB", "ZQOC", "ZQOD"):
        O.get_ownership(s)
    assert list(O._HELD) == ["ZQOB", "ZQOC", "ZQOD"]
    rec = O._HELD["ZQOD"][1]
    meta = {"vendor": "fmp", "source_activity": "invented", "fetched_at": "2031-03-21T21:00:00Z",
            "source_observed_at": "2031-03-21T20:00:00Z", "freshness": "fresh", "tie_break": None}
    holder = lambda i: {"name": f"Invented Capital Management {i}", "cik": f"000{i:07d}", "shares": 1.0e6 + i,  # noqa: E731
                        "ownership": 0.5 + i / 100, "value": 2.5e8 + i, "change_shares": 1000.0 * i,
                        "change_pct": 1.5 + i / 10, "is_new": i % 7 == 0, "is_sold_out": False,
                        "date": "2031-03-31", "filing_date": "2031-05-14", "avg_price": 101.25 + i,
                        "performance": 3.2 + i / 10, "weight": 0.01 * i, "rank": i + 1, "industry": "Invented Industry"}
    rec = {**rec, "insider": [{"name": f"Invented Officer {i}", "title": "Director", "type": "buy", "shares": 100 * i,
                               "amount": 2500.0 * i, "date": "2031-03-01", "price": 25.0, "filing": f"inv-{i}"}
                              for i in range(10)],
           "thirteen_f": {**rec["thirteen_f"], "holders": [holder(i) for i in range(O._TF_MAX_HOLDERS)],
                          "summary": {k: 1.5 for k in ("investors_holding", "investors_holding_change", "ownership_pct",
                                                       "ownership_pct_change", "total_invested", "total_invested_change",
                                                       "new_positions", "increased_positions", "reduced_positions",
                                                       "closed_positions", "put_call_ratio")},
                          "_meta": meta},
           "share_counts": {**rec["share_counts"], "_meta": meta}}
    size = _deep_size(rec)
    print(f"\n[measure] OWN: {size / 1e3:.0f} KB in memory for one invented full record "
          f"({len(json.dumps(rec, default=str)) / 1e3:.0f} KB as JSON); {size * bound / 1e6:.1f} MB at the "
          f"bound of {bound}")
    assert size * bound < 20e6


# ══ 6. STAT, FCTX, VFP: the first ask never builds on the request ══════════════════════════════

@pytest.fixture
def studies(monkeypatch):
    from api.services import factor_exposure as FX
    from api.services import stock_stats as SS
    from api.services import volume_footprint as VF
    for svc in (SS, FX, VF):
        svc.reset_for_tests()
    monkeypatch.setattr(SS, "_is_trading_day", lambda d: d.weekday() < 5)
    yield SS, FX, VF
    for svc in (SS, FX, VF):
        svc.drain_for_tests()
        svc.reset_for_tests()


def _study_worlds(monkeypatch, SS, FX, VF):
    from tests.test_factor_exposure import _fex_world
    from tests.test_stock_stats import _world as stat_world
    from tests.test_volume_footprint import _vfp_world
    return {"stat": (SS, SS.get_stock_stats, stat_world(monkeypatch)),
            "fctx": (FX, FX.get_factor_exposure, _fex_world(monkeypatch)),
            "vfp": (VF, VF.get_volume_footprint, _vfp_world(monkeypatch))}


def _gate_reads(monkeypatch, svc):
    gate = threading.Event()
    real = svc._read_bars

    def slow(sym, *a, **k):
        gate.wait(10)
        return real(sym, *a, **k)

    monkeypatch.setattr(svc, "_read_bars", slow)
    return gate


@pytest.mark.parametrize("name,path", [("stat", "/api/research/stock-stats/ZZQA"),
                                       ("fctx", "/api/research/factor-exposure/ZZQA"),
                                       ("vfp", "/api/research/volume-footprint/ZZQA")])
def test_the_first_ask_answers_computing_at_once_through_the_route(studies, monkeypatch, name, path):
    from api.routers import factor_exposure, stock_stats, volume_footprint
    worlds = _study_worlds(monkeypatch, *studies)
    svc, _get, _w = worlds[name]
    gate = _gate_reads(monkeypatch, svc)
    router = {"stat": stock_stats, "fctx": factor_exposure, "vfp": volume_footprint}[name].router
    resp, took = _timed(lambda: _client(router).get(path))
    assert resp.status_code == 200 and resp.json() == {"status": "computing", "symbol": "ZZQA"}, resp.text
    assert took < FAST_S + 0.5, took
    gate.set()


@pytest.mark.parametrize("name", ["stat", "fctx", "vfp"])
def test_once_built_the_held_answer_is_the_builds_own_figures_and_two_asks_start_one_build(studies, monkeypatch, name):
    worlds = _study_worlds(monkeypatch, *studies)
    svc, get, w = worlds[name]
    gate = _gate_reads(monkeypatch, svc)
    a, took = _timed(lambda: get("ZZQA"))
    b = get("ZZQA")
    assert a == b == {"status": "computing", "symbol": "ZZQA"} and took < FAST_S
    gate.set()
    svc.drain_for_tests()
    _join(svc.BUILD_THREAD)                                                     # every build this test started
    held = get("ZZQA")
    assert held["status"] == "ok" and held["symbol"] == "ZZQA"
    assert w["reads"].count("ZZQA") == 1                                       # two asks, one read of the stock
    key = svc.session_key(None)
    if name == "stat":
        direct = svc.build("ZZQA", key, svc.market_corrections()[0])
    elif name == "fctx":
        direct = svc.build("ZZQA", key, svc.fund_set(key))
    else:
        direct = svc.build("ZZQA", key)[0]
    strip = lambda a: {k: v for k, v in a.items() if k not in ("built_at",)}  # noqa: E731
    assert strip(held) == strip(direct)                                         # the same figures as a build on the request


@pytest.mark.parametrize("name", ["stat", "fctx", "vfp"])
def test_another_symbol_is_never_served_and_a_failed_build_is_said_once_never_held(studies, monkeypatch, name):
    worlds = _study_worlds(monkeypatch, *studies)
    svc, get, _w = worlds[name]
    get("ZZQA")
    svc.drain_for_tests()
    assert get("ZZQA")["symbol"] == "ZZQA"
    assert get("ZZQB") == {"status": "computing", "symbol": "ZZQB"}              # never ZZQA's answer
    svc.drain_for_tests()
    reads = []
    monkeypatch.setattr(svc, "_read_bars", lambda sym, *a, **k: reads.append(sym) or (_ for _ in ()).throw(OSError("x")))
    if name == "fctx":
        monkeypatch.setattr(svc, "fund_set", lambda key: (_ for _ in ()).throw(OSError("invented")))
    assert get("ZZQC")["status"] == "computing"
    svc.drain_for_tests()
    said = get("ZZQC")
    assert said["status"] == "unavailable" and said["symbol"] == "ZZQC" and said["reason"] == "failed"
    assert "ZZQC" not in svc._cache
    assert get("ZZQC")["status"] == "computing"                                 # said once: the next ask builds again
    svc.drain_for_tests()


@pytest.mark.parametrize("name", ["stat", "fctx", "vfp"])
def test_a_failed_builds_word_is_for_the_panel_waiting_on_it_never_for_a_member_hours_later(studies, monkeypatch,
                                                                                          name):
    # Review 2026-11-24: the word of a build that held nothing (a failed read, `busy`) was kept with no time bound, so
    # when nobody took it (the member closed the panel), the next member to open the stock HOURS later was told that
    # old failure (and a `busy` panel asks again only after half an hour) instead of getting a new build. It is said
    # only as long as held_build says a failed build (`held_build.FAILED_S`), then a new build starts.
    import types

    from api.services import held_build
    worlds = _study_worlds(monkeypatch, *studies)
    svc, get, _w = worlds[name]
    monkeypatch.setattr(svc, "_read_bars", lambda sym, *a, **k: (_ for _ in ()).throw(OSError("invented")))
    if name == "fctx":
        monkeypatch.setattr(svc, "fund_set", lambda key: (_ for _ in ()).throw(OSError("invented")))
    two_hours_ago = time.time() - 2 * 3600
    with monkeypatch.context() as m:                                            # the failed build ran two hours ago
        m.setattr(svc, "time", types.SimpleNamespace(time=lambda: two_hours_ago, monotonic=time.monotonic,
                                                     thread_time=time.thread_time, sleep=time.sleep))
        assert get("ZZQD")["status"] == "computing"
        svc.drain_for_tests()
    _join(svc.BUILD_THREAD)
    assert time.time() - two_hours_ago > held_build.FAILED_S
    assert get("ZZQD") == {"status": "computing", "symbol": "ZZQD"}             # a new build, never the old failure
    svc.drain_for_tests()
    said = get("ZZQD")                                                         # the new build's own word, fresh
    assert said["status"] == "unavailable" and said["symbol"] == "ZZQD"
    svc.drain_for_tests()


@pytest.mark.parametrize("name", ["stat", "fctx", "vfp"])
def test_past_the_pending_bound_a_request_says_busy_at_once(studies, monkeypatch, name):
    worlds = _study_worlds(monkeypatch, *studies)
    svc, get, _w = worlds[name]
    gate = _gate_reads(monkeypatch, svc)
    monkeypatch.setattr(svc, "MAX_PENDING", 2)
    assert get("ZZQA")["status"] == "computing" and get("ZZQB")["status"] == "computing"
    out, took = _timed(lambda: get("ZZQC"))
    assert out["status"] == "busy" and took < FAST_S
    gate.set()

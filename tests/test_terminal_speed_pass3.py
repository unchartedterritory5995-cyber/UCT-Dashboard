"""Speed pass, round 3 (2026-11-24): FED, the first answers after a deploy, and the panels still slow once ready.

Live (2026-11-24 ~05:55 ET, server 31b031c564, a signed-in member, each route asked twice ~25 s apart): FED 7.1 s then
1.5 s, IVH 503 then 145 ms, RSL 2.8 s then 90 ms, and READY answers of 0.8-1.5 s (STAT, ERNS, OIC, SETH one, VFP).
Each fix is proved here on INVENTED inputs: the request answers within a bound with the slow dependency stood in for
by one that blocks; the figures are the same as before (before/after equality); nothing is served for another
symbol, another day, another registry, version or shape, and a failed refresh is never held as current; two requests
start one build; each boot warm is a DATE job on its own offset and a no-op when warm.

No test reads a real store, the network, a vendor, R2, an agency or production. Routes are mounted on a bare app
(the router alone), so this file never imports `api.main` (the boot jobs are read from its source by AST).
"""
from __future__ import annotations

import ast
import datetime as dt
import json
import os
import random
import threading
import time
from zoneinfo import ZoneInfo

import pytest
from fastapi import FastAPI
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

from api.services import fed_watch as fw
from api.services import held_bytes as hb
from api.services.econ import serving
from api.services.research import iv_history as IVH
from api.services.research import iv_history_index as IX
from tests.test_fed_watch import ANSWERS, ROSTER, _Store
from tests.test_terminal_speed_pass2 import (FAST_S, NOW, FakeR2, _client, _invented_log, _join, _local, _old_body,  # noqa: F401
                                             _study_worlds, _timed, _use, ivlog, r2, studies)

NY = ZoneInfo("America/New_York")
FED_NOW = dt.datetime(2031, 3, 20, 11, 0, tzinfo=NY)         # the Fed samples' own invented year (a Thursday)
BODIES = {
    "USEFFR": {"symbol": "USEFFR", "points": [[1, 9.11, "2031-03-17", "2031-03-17", "U"], [2, 9.12, "2031-03-18", "2031-03-18", "U"]]},
    "USFEDFUNDSU": {"symbol": "USFEDFUNDSU", "points": [[1, 9.25, "2031-03-18", "2031-03-18", "U"]]},
    "USFEDFUNDSL": {"symbol": "USFEDFUNDSL", "points": [[1, 9.0, "2031-03-18", "2031-03-18", "U"]]},
}


def _strip(answer: dict) -> dict:
    """An answer as the wire carries it, without the time it was put together."""
    return {k: v for k, v in json.loads(json.dumps(answer)).items() if k != "built_at"}


# ══ 1. FED: the rates and the headlines are served from what is held, refreshed off the request ═════════════

class _Gate:
    """A stand-in that blocks while `closed`, counting its calls and the threads they ran on."""

    def __init__(self):
        self.open = threading.Event()
        self.open.set()
        self.calls = []

    def close(self):
        self.open.clear()

    def pass_(self, tag):
        self.calls.append((tag, threading.current_thread().name))
        self.open.wait(10)


@pytest.fixture
def fed(tmp_path, monkeypatch):
    """A fresh Fed watch with its own data folder, a fixed clock, the Board's pages served by a fake, the economics
    store's series stood in for (gated), and a news store of invented headlines (gated)."""
    from api.services.trade_exchange_news import archive, config, pipeline
    fw.reset_for_tests()
    serving.clear_cache()
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("ECON_ENABLED", "1")
    monkeypatch.setattr(fw, "now_et", lambda: FED_NOW)
    monkeypatch.setattr(fw, "_pause", lambda s: None)
    monkeypatch.setattr(fw, "_calendar_payloads", lambda today: [])
    monkeypatch.setattr(fw, "HEADLINE_MIN_S", 0.05)
    monkeypatch.setattr(fw, "HEADLINE_WATCH_S", 0.6)
    asked: list = []
    monkeypatch.setattr(fw, "_http_get", lambda url, accept, max_bytes: asked.append(url) or (
        (404, "text/html", b"x") if url not in ANSWERS else (ANSWERS[url][0], "text/xml", ANSWERS[url][1])))
    series_gate, store_gate = _Gate(), _Gate()
    bodies = {k: v for k, v in BODIES.items()}

    def from_artifacts(sym, asof, start, end):
        series_gate.pass_(sym)
        return bodies.get(sym)
    monkeypatch.setattr(serving, "_from_artifacts", from_artifacts)
    monkeypatch.setattr(serving, "_read_key", lambda key: None)        # the status heartbeat: not held
    rows = [(i, "TX-News", (f"Fed's Quillfeather invented remark {i}" if i % 2 else f"FedEx invented parcel item {i}"),
             1_900_000_000_000 + i * 1000, f"e{i}", "push", 0) for i in range(1, 41)]
    store = _Store(rows)
    real_index = store.index_before

    def index_before(seq, limit):
        store_gate.pass_("index")
        return real_index(seq, limit)
    store.index_before = index_before
    monkeypatch.setattr(config, "enabled", lambda: True)
    monkeypatch.setattr(pipeline, "get", lambda: type("Pipe", (), {"store": store})())
    monkeypatch.setattr(archive, "event_fields", lambda source, content: {"tickers": []})
    monkeypatch.setattr(fw, "_surnames", lambda: ROSTER)
    fw.build()                                                          # the Board's pages held (no request made)
    yield {"asked": asked, "series": series_gate, "store": store_gate, "bodies": bodies, "rows": rows, "path": tmp_path}
    series_gate.open.set()
    store_gate.open.set()
    fw.reset_for_tests()                                                # a pass still running writes nothing more
    _join("fed-watch")
    serving.clear_cache()


def _fed_idle():
    with fw._lock:
        done = fw._state["rates_inflight"]
    if done is not None:
        done.wait(10)
    end = time.time() + 5
    while time.time() < end and fw._state.get("headlines_last") is None:
        time.sleep(0.02)


def _fed_client():
    from api.routers import fed_watch as route
    return _client(route.router)


def test_fed_answers_at_once_with_the_series_reads_and_the_headline_store_both_stubbed_slow(fed):
    fed["series"].close()
    fed["store"].close()
    resp, took = _timed(lambda: _fed_client().get("/api/research/fed-watch"))
    assert resp.status_code == 200 and took < FAST_S, took
    got = resp.json()
    assert got["rates"]["state"] == "computing" and got["headlines"]["state"] == "computing"
    assert all(got["rates"][k] == {"value": None, "date": None, "reason": "computing"} for k in ("effective", "upper", "lower"))
    assert got["statement"]["state"] == "ok"                           # the held blocks answer as before
    fed["series"].open.set()
    fed["store"].open.set()
    _fed_idle()
    again, took = _timed(lambda: _fed_client().get("/api/research/fed-watch"))
    assert took < FAST_S, took
    assert _strip(again.json()) == _strip(fw._assemble(False))           # the answer the request used to read itself
    assert again.json()["rates"]["effective"] == {"value": 9.12, "date": "2031-03-18", "reason": None}
    assert again.json()["headlines"]["state"] == "ok" and again.json()["headlines"]["matched"] == 20
    reads = [t for tag, t in fed["series"].calls + fed["store"].calls]
    assert reads and all(t in (fw.RATES_THREAD, fw.HEADLINES_THREAD) for t in reads)       # never the caller's thread


def test_fed_two_requests_start_one_rates_refresh_and_one_headline_pass(fed, monkeypatch):
    fed["series"].close()
    fed["store"].close()
    refreshes = []
    real = fw.rates_block
    monkeypatch.setattr(fw, "rates_block", lambda: refreshes.append(1) or real())
    threads = [threading.Thread(target=fw.get_fed_watch) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(5)
    assert not any(t.is_alive() for t in threads)                      # both answered while the reads were blocked
    fed["series"].open.set()
    fed["store"].open.set()
    _fed_idle()
    assert len(refreshes) == 1 and sorted(tag for tag, _t in fed["series"].calls) == sorted(BODIES)
    assert [tag for tag, _t in fed["store"].calls] == ["index"]
    alive = [t for t in threading.enumerate() if t.name == fw.HEADLINES_THREAD and t.is_alive()]
    assert len(alive) <= 1


def test_fed_held_rates_are_refreshed_off_the_request_only_after_the_serving_caches_lifetime(fed, monkeypatch):
    fw.get_fed_watch()
    _fed_idle()
    first = fw.get_fed_watch()["rates"]
    refreshes = []
    real = fw.rates_block
    monkeypatch.setattr(fw, "rates_block", lambda: refreshes.append(1) or real())
    fw.get_fed_watch()
    assert refreshes == []                                             # inside the lifetime: no refresh
    with fw._lock:
        fw._state["rates"]["checked"] -= serving.TTL + 1
    fed["bodies"]["USEFFR"] = {"symbol": "USEFFR", "points": [[3, 9.13, "2031-03-19", "2031-03-19", "U"]]}
    serving.clear_cache()
    fed["series"].close()
    out, took = _timed(fw.get_fed_watch)
    assert took < FAST_S and out["rates"] == first                     # the held block at once ...
    fed["series"].open.set()
    _fed_idle()
    assert refreshes == [1]                                            # ... and one refresh behind it
    assert fw.get_fed_watch()["rates"]["effective"] == {"value": 9.13, "date": "2031-03-19", "reason": None}


def test_fed_a_refresh_with_fewer_figures_never_replaces_the_held_block_and_is_never_written(fed, monkeypatch):
    fw.get_fed_watch()
    _fed_idle()
    held = fw.get_fed_watch()["rates"]
    path = fw._rates_path()
    on_disk = open(path, "rb").read()
    fed["bodies"].pop("USFEDFUNDSU")
    fed["bodies"].pop("USFEDFUNDSL")                                   # an outage read as "no data"
    serving.clear_cache()
    with fw._lock:
        fw._state["rates"]["checked"] -= serving.TTL + 1
    fw.get_fed_watch()
    _fed_idle()
    assert fw.get_fed_watch()["rates"] == held                          # the failed refresh is not current
    assert abs(fw._state["rates_retry_at"] - time.time() - fw.RATES_RETRY_S) < 5
    assert open(path, "rb").read() == on_disk                           # and never written
    refreshes = []
    real = fw.rates_block
    monkeypatch.setattr(fw, "rates_block", lambda: refreshes.append(1) or real())
    fw.get_fed_watch()
    assert refreshes == []                                             # not asked again inside the retry wait
    fed["bodies"].update({k: BODIES[k] for k in ("USFEDFUNDSU", "USFEDFUNDSL")})
    fed["bodies"]["USEFFR"] = {"symbol": "USEFFR", "points": [[4, 9.14, "2031-03-19", "2031-03-19", "U"]]}
    serving.clear_cache()
    with fw._lock:
        fw._state["rates_retry_at"] = 0.0
    fw.get_fed_watch()
    _fed_idle()
    assert fw.get_fed_watch()["rates"]["effective"]["value"] == 9.14   # a whole read replaces it again
    # a block with no figure at all is never written
    os.remove(path)
    fw._save_rates({"block": {**held, "state": "no_data", "effective": {"value": None, "date": None, "reason": "no_data"},
                              "upper": {"value": None, "date": None, "reason": "no_data"},
                              "lower": {"value": None, "date": None, "reason": "no_data"}},
                    "day": "2031-03-20", "servable": fw._rates_servable(), "checked": time.time()})
    assert not os.path.exists(path)


def test_fed_the_rates_disk_copy_answers_a_restart_for_its_day_registry_version_and_shape_only(fed, monkeypatch):
    fw.get_fed_watch()
    _fed_idle()
    held = fw.get_fed_watch()["rates"]
    path = fw._rates_path()
    saved = json.load(open(path, encoding="utf-8"))
    assert saved["day"] == "2031-03-20" and saved["block"] == held

    def restart():
        fw.reset_for_tests()
        serving.clear_cache()
        fed["series"].close()
        out, took = _timed(fw.get_fed_watch)
        assert took < FAST_S, took
        fed["series"].open.set()
        _join(fw.RATES_THREAD)
        return out["rates"]

    assert restart() == held                                           # the same day: at once, the same figures
    for change in ({"day": "2031-03-19"}, {"v": 2}, {"servable": [True, True, False]},
                   {"block": {**held, "notice": "an older notice"}},
                   {"block": {**held, "effective": {"value": "9.12", "date": None, "reason": None}}}):
        json.dump({**saved, **change}, open(path, "w", encoding="utf-8"))
        assert restart()["state"] == "computing", change               # never served
    json.dump(saved, open(path, "w", encoding="utf-8"))
    monkeypatch.setattr(fw, "now_et", lambda: FED_NOW + dt.timedelta(days=1))
    assert restart()["state"] == "computing"                           # another New York day


def test_fed_the_headline_pass_keeps_the_list_fresh_while_asked_and_stops_when_nobody_asks(fed):
    fw.get_fed_watch()
    _fed_idle()
    assert fw.get_fed_watch()["headlines"]["items"][0]["seq"] == 39
    fed["rows"].append((41, "TX-News", "Fed's Quillfeather invented remark 41", 1_900_000_041_000, "e41", "push", 0))
    time.sleep(0.3)                                                     # inside HEADLINE_WATCH_S of the last ask
    assert fw.get_fed_watch()["headlines"]["items"][0]["seq"] == 41     # the pass already re-read it: no request did
    assert {t for _tag, t in fed["store"].calls} == {fw.HEADLINES_THREAD}
    time.sleep(fw.HEADLINE_WATCH_S + 0.3)
    assert fw._state["headlines_worker"] is None
    assert not [t for t in threading.enumerate() if t.name == fw.HEADLINES_THREAD and t.is_alive()]


def test_fed_a_failing_store_is_said_failed_never_computing_for_ever(fed):
    def boom(seq, limit):
        raise RuntimeError("invented disk fault")
    from api.services.trade_exchange_news import pipeline
    pipeline.get().store.index_before = boom
    assert fw.get_fed_watch()["headlines"]["state"] == "computing"
    _fed_idle()
    assert fw.get_fed_watch()["headlines"]["state"] == "failed"


def test_fed_the_boot_warm_starts_both_once_never_asks_the_board_and_is_a_no_op_when_warm(fed, monkeypatch):
    n = len(fed["asked"])
    assert fw.warm() == "rates headlines"
    _fed_idle()
    _join(fw.HEADLINES_THREAD)
    assert fw.warm() == "warm" and len(fed["asked"]) == n               # no Board page read by the warm
    out, took = _timed(fw.get_fed_watch)
    assert took < FAST_S and out["rates"]["state"] == "ok" and out["headlines"]["state"] == "ok"
    monkeypatch.delenv("ECON_ENABLED")
    fw.reset_for_tests()
    from api.services.trade_exchange_news import config
    monkeypatch.setattr(config, "enabled", lambda: False)
    assert fw.warm() == "warm"                                          # nothing armed: nothing started


def test_fed_held_reader_and_held_answer_are_unchanged_and_start_no_work(fed):
    """The Agent reads through `fed_watch_held` and the service's own `held_answer`: neither starts the new threads."""
    from api.services import fed_watch_held
    fw.get_fed_watch()
    _fed_idle()
    _join(fw.HEADLINES_THREAD)
    with fw._lock:
        before = (fw._state["rates_inflight"], fw._state["headlines_worker"])
    fed_watch_held.held_answer()
    fw.held_answer()
    with fw._lock:
        assert (fw._state["rates_inflight"], fw._state["headlines_worker"]) == before == (None, None)


def test_fed_the_rates_block_held_and_its_disk_copy_are_small(fed):
    fw.get_fed_watch()
    _fed_idle()
    size = len(json.dumps(fw._state["rates"]["block"]))
    disk = os.path.getsize(fw._rates_path())
    print(f"\n[measure] FED: the held rates block is {size} bytes as JSON ({disk} on disk); the headline list was "
          "already held (one answer, at most 30 headlines)")
    assert size < 4000 and disk < 4000


# ══ 2. IVH: the mirror is warmed at boot; FT-006 and OHIS read the same mirror ═══════════════════════════════

def test_ivh_the_boot_warm_fills_the_mirror_so_the_first_request_after_a_deploy_is_an_answer_not_a_503(r2, monkeypatch):
    store, remote = r2
    _invented_log(remote, n=5)
    fake = FakeR2(remote)
    _use(store, fake, monkeypatch)
    assert IVH.warm_mirror() == "started"
    store.drain(10)
    IX.for_root(store.root).drain(10)
    from api.routers import iv_history as route
    resp, took = _timed(lambda: _client(route.router).get("/api/research/iv-history/ZQAJ"))
    assert resp.status_code == 200 and took < FAST_S, (resp.status_code, took)
    body = resp.json()
    assert body["status"] == "ok" and IVH.R2Store.COLD_NOTE not in body["partial_reasons"]
    assert body == json.loads(json.dumps(IVH.iv_history("ZQAJ", store=_local(store.root))))   # the mirror's own answer
    assert fake.lists == 1                                              # the warm's listing, nothing more
    assert IX.for_root(store.root).lookup("ZQAJ") is not None           # and the index check ran after it


def test_ivh_the_warm_is_a_no_op_when_unarmed_warm_running_failed_or_on_a_test_store(r2, monkeypatch):
    store, remote = r2
    _invented_log(remote, n=3)
    fake = FakeR2(remote, gate=threading.Event())
    _use(store, fake, monkeypatch)
    from api.services.options_analytics import flags
    monkeypatch.delenv(IVH.FLAG)
    monkeypatch.setattr(flags, "is_on", lambda name: False)
    assert IVH.warm_mirror() == "off" and fake.lists == 0
    monkeypatch.setattr(flags, "is_on", lambda name: name == "OPTIONS_IV_RANK_ENABLED")   # FT-006 alone reads it too
    assert IVH.warm_mirror() == "started"
    assert IVH.warm_mirror() == "warm"                                  # one refresh is running
    fake.gate.set()
    store.drain(10)
    assert IVH.warm_mirror() == "warm" and fake.lists == 1              # the listing is fresh
    store._listed_at -= store.LIST_TTL_S + 1
    fake.fail = RuntimeError("invented outage")
    assert IVH.warm_mirror() == "started"
    store.drain(10)
    store._listed_at -= store.LIST_TTL_S + 1
    assert IVH.warm_mirror() == "warm" and fake.lists == 2              # inside RETRY_S of the failure
    monkeypatch.setattr(IVH, "_store_override", _local(store.root))
    assert IVH.warm_mirror() == "local store"


def _ohis(sym, now, store=None):
    from api.services.options_analytics import log_history as LH
    return {"straddle": LH.straddle_history(sym, now=now, store=store), "daily": LH.daily_move(sym, now=now, store=store),
            "crush": LH.iv_crush(sym, now=now, store=store)}


def test_ivh_iv_rank_and_the_log_history_read_the_ready_mirror_with_no_listing_on_the_request(r2, monkeypatch):
    store, remote = r2
    _invented_log(remote, n=8)
    fake = FakeR2(remote)
    _use(store, fake, monkeypatch)
    from api.services.options_analytics import log_history as LH
    from api.services.options_analytics import vol
    monkeypatch.setattr(LH, "_prints", lambda sym: [{"reportedDate": "2031-03-18", "reportTime": "post-market"}])
    store.sessions()                                                    # the mirror is ready (one listing)
    local = _local(store.root)
    want_rank = vol.iv_rank("ZQAJ", now=NOW)
    want_ohis = _ohis("ZQAJ", NOW)
    assert fake.lists == 1
    store._listed_at -= store.LIST_TTL_S + 1                           # the listing is due again ...
    fake.gate = threading.Event()                                      # ... and the bucket is slow
    threading.Timer(2.0, fake.gate.set).start()
    rank, took = _timed(lambda: vol.iv_rank("ZQAJ", now=NOW))
    assert took < FAST_S, took                                          # no listing on the request
    ohis, took2 = _timed(lambda: _ohis("ZQAJ", NOW))
    assert took2 < FAST_S, took2
    assert rank == want_rank and ohis == want_ohis                      # the same answers
    with IVH._ROW_CACHE.lock:
        IVH._ROW_CACHE.clear()
    assert ohis == _ohis("ZQAJ", NOW, store=local)                      # and the mirror's own
    store.drain(10)
    assert fake.lists == 2                                              # the one background refresh


def test_ivh_a_cold_iv_rank_reads_the_store_as_before(r2, monkeypatch):
    store, remote = r2
    _invented_log(remote, n=5)
    fake = FakeR2(remote)
    _use(store, fake, monkeypatch)
    from api.services.options_analytics import vol
    got = vol.iv_rank("ZQAJ", now=NOW)                                  # nothing listed yet in this process
    store.drain(10)
    assert got == vol.iv_rank("ZQAJ", now=NOW) and got["logging_began"] is not None
    assert fake.lists == 1                                              # the request's listing and the refresh: one


# ══ 3. RSL: the bytes are made when a source refreshes and at boot ════════════════════════════════════════════

@pytest.fixture
def rsl3(monkeypatch, tmp_path):
    from api.routers import rs_ranking as route
    from api.services import deal_status
    from api.services import rs_ranking as rs
    _join(route.BODY_THREAD)
    route.reset_bodies()
    rs.invalidate_ibd_cache()
    rs._rs_cache.invalidate(rs._CACHE_KEY)
    monkeypatch.setattr(rs, "_SNAPSHOT_PATH", str(tmp_path / "rs_rankings_snapshot.json"))
    monkeypatch.delenv("RS_RANK_IBD_ENABLED", raising=False)
    state = {"pending": frozenset()}
    monkeypatch.setattr(deal_status, "consumer_pending", lambda: state["pending"])
    monkeypatch.setattr(rs, "_get_universe", lambda: [f"ZR{i:03d}" for i in range(300)])
    monkeypatch.setattr(rs, "_compute_returns", lambda t: {"ticker": t, "raw_score": (int(t[2:]) * 37) % 101 - 20.5,
                                                           "returns": {"3m": (int(t[2:]) % 13) - 4.0, "6m": None}})
    yield route, rs, state
    _join(route.BODY_THREAD)
    _join(rs.IBD_REREAD_THREAD)
    rs._rs_cache.invalidate(rs._CACHE_KEY)
    rs.invalidate_ibd_cache()
    route.reset_bodies()


def _slow_unify(monkeypatch, route, seconds=0.6):
    calls = []
    real = route.unified_rankings

    def slow(data, table=None):
        calls.append(threading.current_thread().name)
        time.sleep(seconds)
        return real(data, table=table)
    monkeypatch.setattr(route, "unified_rankings", slow)
    return calls


def test_rsl_a_new_ranking_makes_its_bytes_off_the_request_so_the_first_request_makes_nothing(rsl3, monkeypatch):
    route, rs, state = rsl3
    calls = _slow_unify(monkeypatch, route)
    rows = rs.compute_rs_scores(force=True)                             # the source refreshes (the warmer's own call)
    _join(route.BODY_THREAD)
    made = route.body_builds
    resp, took = _timed(lambda: _client(route.router).get("/api/rs-rankings"))
    assert resp.status_code == 200 and took < FAST_S, took
    assert resp.content == _old_body(rows, state["pending"]) and route.body_builds == made
    assert calls == [route.BODY_THREAD]                                 # made once, on the body thread
    # a boot seeded from the snapshot is a source refresh too
    route.reset_bodies()
    rs._rs_cache.invalidate(rs._CACHE_KEY)
    seeded = [dict(r, rs_rank=100 - r["rs_rank"]) for r in rows]
    json.dump({"computed_at": time.time() - 120, "rankings": seeded}, open(rs._SNAPSHOT_PATH, "w", encoding="utf-8"))
    assert rs.compute_rs_scores(force=False) == seeded
    _join(route.BODY_THREAD)
    made = route.body_builds
    resp, took = _timed(lambda: _client(route.router).get("/api/rs-rankings"))
    assert took < FAST_S and resp.content == _old_body(seeded, state["pending"]) and route.body_builds == made


def test_rsl_an_equal_rating_table_keeps_its_object_and_a_changed_one_makes_new_bytes_off_the_request(rsl3, monkeypatch):
    route, rs, state = rsl3
    from api.services.screener import rs_history
    monkeypatch.setenv("RS_RANK_IBD_ENABLED", "1")
    tables = {"t": ("2031-03-20", {f"ZR{i:03d}": 99 - i % 99 for i in range(0, 300, 3)})}
    gate = _Gate()
    monkeypatch.setattr(rs_history, "newest_ibd_ratings", lambda: (gate.pass_("ratings"), tables["t"])[1])
    rows = rs.compute_rs_scores(force=True)
    _join(route.BODY_THREAD)
    first = rs._ibd_latest()
    rs._ibd_cache.invalidate(rs._IBD_KEY)                              # its five minutes pass
    assert rs._ibd_latest() is first                                   # an equal re-read: the same object
    made = route.body_builds
    old_bytes = _client(route.router).get("/api/rs-rankings").content
    assert route.body_builds == made and old_bytes == _old_body(rows, frozenset())
    # past the memo, a request never waits on the re-read; a changed table makes new bytes off the request
    calls = _slow_unify(monkeypatch, route, 0.3)
    rs._ibd_cache.invalidate(rs._IBD_KEY)
    tables["t"] = ("2031-03-21", {f"ZR{i:03d}": 1 + i % 98 for i in range(0, 300, 2)})
    gate.close()
    resp, took = _timed(lambda: _client(route.router).get("/api/rs-rankings"))
    assert took < FAST_S and resp.content == old_bytes                  # the table read last, while one re-read runs
    gate.open.set()
    _join(rs.IBD_REREAD_THREAD)
    _join(route.BODY_THREAD)
    made = route.body_builds
    new = _client(route.router).get("/api/rs-rankings").content
    assert new != old_bytes and new == _old_body(rows, frozenset()) and route.body_builds == made
    assert calls and set(calls) == {route.BODY_THREAD}                  # never made on a request
    assert sum(1 for tag, t in gate.calls if t == rs.IBD_REREAD_THREAD) == 1


def test_rsl_bytes_a_request_must_make_use_the_table_their_key_names_and_never_wait_on_its_re_read(rsl3, monkeypatch):
    route, rs, state = rsl3
    from api.services.screener import rs_history
    monkeypatch.setenv("RS_RANK_IBD_ENABLED", "1")
    table = ("2031-03-20", {f"ZR{i:03d}": 99 - i % 99 for i in range(0, 300, 3)})
    gate = _Gate()
    monkeypatch.setattr(rs_history, "newest_ibd_ratings", lambda: (gate.pass_("ratings"), table)[1])
    rs.compute_rs_scores(force=True)
    _join(route.BODY_THREAD)
    known = rs._ibd_latest()
    rs._ibd_cache.invalidate(rs._IBD_KEY)                              # the table's five minutes pass ...
    gate.close()                                                        # ... and its re-read is slow
    rows2 = [dict(r, rs_rank=1 + r["rs_rank"] // 2) for r in rs.cached_rankings()]
    rs._rs_cache.set(rs._CACHE_KEY, rows2, ttl=600)                     # a new list: this request must make bytes
    resp, took = _timed(lambda: _client(route.router).get("/api/rs-rankings"))
    assert took < FAST_S, took
    assert resp.content == JSONResponse(content=rs.unified_rankings(rows2, table=known)).body
    gate.open.set()


def test_rsl_a_request_never_gets_bytes_made_from_an_older_input_and_one_build_serves_both(rsl3, monkeypatch):
    route, rs, state = rsl3
    rows = rs.compute_rs_scores(force=True)
    _join(route.BODY_THREAD)
    old = _client(route.router).get("/api/rs-rankings").content
    calls = _slow_unify(monkeypatch, route, 0.5)
    monkeypatch.setattr(rs, "_compute_returns", lambda t: {"ticker": t, "raw_score": (int(t[2:]) * 53) % 89 - 10.0,
                                                           "returns": {"3m": 1.0, "6m": 2.0}})
    rows2 = rs.compute_rs_scores(force=True)                            # a new ranking; its bytes are being made
    got = _client(route.router).get("/api/rs-rankings").content
    assert got != old and got == _old_body(rows2, frozenset())         # it waited for the one build, never the old bytes
    _join(route.BODY_THREAD)
    assert len(calls) == 1


def test_rsl_warm_body_is_a_no_op_when_cold_or_already_made(rsl3):
    route, rs, state = rsl3
    assert route.warm_body() == "cold"
    rs._rs_cache.set(rs._CACHE_KEY, [{"ticker": "ZR001", "rs_score": 1.0, "rs_rank": 50, "returns": {}}], ttl=600)
    assert route.warm_body() == "made"
    assert route.warm_body() == "warm"


# ══ 4. The ready answers: their bytes made once, off the request ══════════════════════════════════════════════

def test_held_bytes_are_fastapis_own_bytes_per_object_and_bounded(monkeypatch):
    hb.reset_for_tests()
    answers = [
        {"status": "ok", "v": 1.5, "tiny": 1e-07, "n": None, "s": "Invented café, ±3 % ✓", "l": [1, (2, 3)], 7: "an int key",
         "nested": {"a": [{"b": True, "c": -0.0}]}},
        {"status": "computing", "symbol": "ZZQA"},
        {"rows": [{"k": i, "x": round(i / 7, 4)} for i in range(200)]},
    ]
    app = FastAPI()
    app.get("/plain/{i}")(lambda i: answers[int(i)])
    app.get("/held/{i}")(lambda i: hb.response(answers[int(i)]))
    client = TestClient(app)
    hb.remember(answers[0])
    for i in range(len(answers)):
        plain, held = client.get(f"/plain/{i}"), client.get(f"/held/{i}")
        assert held.content == plain.content and held.headers["content-type"] == plain.headers["content-type"]
        assert held.headers["content-length"] == plain.headers["content-length"]
    assert hb.held(answers[0]) is not None and hb.held(dict(answers[0])) is None   # this very object only
    hb.forget(answers[0])
    assert hb.held(answers[0]) is None
    monkeypatch.setattr(hb, "MAX_ANSWERS", 2)
    for a in answers:
        hb.remember(a)
    assert hb.held(answers[0]) is None and hb.size()[0] == 2           # the oldest dropped
    monkeypatch.setattr(hb, "MAX_BYTES", len(hb.render(answers[2])) + 10)
    hb.remember(answers[1])
    assert hb.size()[1] <= hb.MAX_BYTES and hb.held(answers[1]) is not None
    hb.reset_for_tests()


def _slow_render(monkeypatch, seconds=0.6):
    """Making an answer's bytes made slow, both ways it can happen on a request: `held_bytes.render`, and FastAPI's own
    turning of a returned dict into JSON (`fastapi.routing.jsonable_encoder`, the path every route took before)."""
    import fastapi.routing
    real, real_encoder = hb.render, fastapi.routing.jsonable_encoder
    calls = []

    def slow(answer):
        calls.append(threading.current_thread().name)
        time.sleep(seconds)
        return real(answer)

    def slow_encoder(*a, **k):
        calls.append(threading.current_thread().name)
        time.sleep(seconds)
        return real_encoder(*a, **k)
    monkeypatch.setattr(hb, "render", slow)
    monkeypatch.setattr(fastapi.routing, "jsonable_encoder", slow_encoder)
    return calls


@pytest.mark.parametrize("name,path", [("stat", "/api/research/stock-stats/ZZQA"),
                                       ("vfp", "/api/research/volume-footprint/ZZQA")])
def test_a_ready_stat_or_vfp_answer_is_sent_as_the_bytes_made_on_its_build_thread(studies, monkeypatch, name, path):
    from api.routers import stock_stats as stat_route
    from api.routers import volume_footprint as vfp_route
    hb.reset_for_tests()
    worlds = _study_worlds(monkeypatch, *studies)
    svc, get, _w = worlds[name]
    get("ZZQA")
    svc.drain_for_tests()
    _join(svc.BUILD_THREAD)
    held = get("ZZQA")
    assert held["status"] == "ok"
    before = JSONResponse(content=jsonable_encoder(held)).body          # what the route sent before
    calls = _slow_render(monkeypatch)
    client = _client({"stat": stat_route, "vfp": vfp_route}[name].router)
    for _ in range(3):
        resp, took = _timed(lambda: client.get(path))
        assert resp.content == before and took < FAST_S, took
    assert calls == []                                                 # never made on a request
    other = client.get(path.replace("ZZQA", "ZZQB")).json()
    assert other == {"status": "computing", "symbol": "ZZQB"}          # another symbol never gets these bytes
    svc.drain_for_tests()
    _join(svc.BUILD_THREAD)
    monkeypatch.setattr(svc, "CACHE_MAX", 1)
    get("ZZQC")
    svc.drain_for_tests()
    _join(svc.BUILD_THREAD)
    assert hb.held(held) is None                                       # dropped with its answer
    hb.reset_for_tests()


def test_a_ready_erns_day_is_sent_as_the_bytes_made_when_it_was_held(monkeypatch):
    from api.routers import calendar as route
    from api.services import earnings_season as E
    hb.reset_for_tests()
    rng = random.Random(4)
    day = {"bmo": [], "amc": [], "tbd": []}
    for i in range(150):
        day[("bmo", "amc", "tbd")[i % 3]].append({"sym": f"ZQ{i:03d}", "name": f"Invented Holdings {i}",
                                                  "mc_b": round(rng.uniform(0.3, 900), 2), "ew": rng.randint(0, 50),
                                                  "eps_est": round(rng.uniform(-1, 5), 2),
                                                  "eps_act": round(rng.uniform(-1, 5), 2) if i % 2 else None})
    monkeypatch.setattr(E, "priced_key", lambda sym: sym)
    monkeypatch.setattr(E, "capture_time", lambda: {"hour_et": 15, "minute_et": 40})
    monkeypatch.setattr(E, "verdict_of", lambda e: None)
    out = E.assemble_day("2031-06-03", "2031-06-03", day, priced={}, held_events=lambda s: (None, "not_held"),
                         moves=None, moves_state=None)
    out = {**out, "default": True, "range": {"from": "2031-05-26", "to": "2031-06-13"}}
    with E._lock:
        E._done.clear()
        E._old.clear()
    E._remember(E.NEXT_KEY, out, 300)                                    # what the day's build does
    before = JSONResponse(content=jsonable_encoder(out)).body
    calls = _slow_render(monkeypatch)
    resp, took = _timed(lambda: _client(route.router).get("/api/calendar/earnings-season"))
    assert resp.status_code == 200 and resp.content == before and took < FAST_S, took
    assert calls == []
    print(f"\n[measure] ERNS: {len(before) / 1e3:.0f} KB for 150 invented reporters, made once when the day is held")
    E._remember(E.NEXT_KEY, {**out, "built_at": "2031-06-03T15:01:00+00:00"}, 300)   # replaced: the old bytes go
    assert hb.held(out) is None
    with E._lock:
        E._done.clear()
        E._old.clear()
    hb.reset_for_tests()


@pytest.fixture
def seth(monkeypatch, tmp_path):
    from api.services import setup_history as S
    from tests.test_setup_history import KEY, SATURDAY, SYMS, _market
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    S.reset_for_tests()
    hb.reset_for_tests()
    monkeypatch.setattr(S, "_universe", lambda: list(SYMS))
    monkeypatch.setattr(S, "_market", lambda wait_s: _market())
    monkeypatch.setattr(S, "evening_key", lambda now: KEY)
    monkeypatch.setattr(S, "now_et", lambda: SATURDAY)
    monkeypatch.setattr(S, "HISTORY_YEARS", 2)
    yield S
    S._STUDY.drain(10)
    S._STOCK.drain(10)
    S.reset_for_tests()
    hb.reset_for_tests()


def test_a_ready_seth_stock_is_put_together_once_on_its_build_thread_and_sent_as_its_bytes(seth, monkeypatch):
    S = seth
    from api.routers import setup_history as route
    from tests.test_setup_history import _reader
    monkeypatch.setattr(S, "_read_bars", _reader())
    S.get_study()
    S._STUDY.drain(30)
    assert S.get_stock("QZSA")["status"] == "computing"
    S._STOCK.drain(10)
    lines = []
    real_lines = S.universe_lines
    monkeypatch.setattr(S, "universe_lines", lambda stock, study: lines.append(1) or real_lines(stock, study))
    key = ("QZSA", S.evening_key(None), (S._market(0)["status"], S._market(0)["built_at"]))
    ans = S._STOCK.get(key, wait_s=0)
    old = {**ans, "universe": real_lines(ans, S.get_study())}           # what the route put together on each request
    before = JSONResponse(content=jsonable_encoder(old)).body
    calls = _slow_render(monkeypatch)
    client = _client(route.router)
    for _ in range(2):
        resp, took = _timed(lambda: client.get("/api/research/setup-history/QZSA"))
        assert resp.content == before and took < FAST_S, took
    assert lines == [] and calls == []                                 # neither the lines nor the bytes on a request
    # another study build: put together again, never the answer of the build before
    with S._STUDY._lock:
        S._STUDY._state["held"] = {**S._STUDY._state["held"], "built_at": "2031-06-07T23:59:00+00:00"}
    monkeypatch.setattr(hb, "render", lambda a: JSONResponse(content=jsonable_encoder(a)).body)
    got = client.get("/api/research/setup-history/QZSA").json()
    assert lines == [1] and got["universe"]["built_at"] == "2031-06-07T23:59:00+00:00"


def _old_compute(sym, pair):
    """`oi_change.compute` as it was before speed pass 3 (a dict for every ranked contract, every side filtered)."""
    from api.services.options_analytics import oi_change as oic
    cur, meta = oic._read(pair["path"], sym)
    prev, prev_meta = oic._read(pair["prior_path"], sym)
    newer_day = int(pair["session"].replace("-", ""))
    volume_present = prev_meta.get("volume_present") == "1"
    totals = {"C": oic._side(), "P": oic._side()}
    new = {"contracts": 0, "oi": 0}
    not_reported = unchanged = 0
    ranked = []
    for contract, (_, exp, cp, strike_m, oi, _vol) in cur.items():
        before = prev.get(contract)
        base = {"contract": contract, "expiration": oic._iso(exp), "strike": strike_m / 1000,
                "type": "call" if cp == "C" else "put", "oi": oi}
        if before is None:
            if oi is None:
                not_reported += 1
            elif oi > 0:
                new["contracts"] += 1
                new["oi"] += oi
                ranked.append((oi, contract, {**base, "kind": "new", "prior_oi": None, "change": None,
                                              "change_pct": None, "volume": None}))
            continue
        prior_oi, vol = before[4], before[5]
        if oi is None or prior_oi is None:
            not_reported += 1
            continue
        t = totals[cp]
        t["contracts"] += 1
        t["oi"] += oi
        t["prior_oi"] += prior_oi
        t["change"] += oi - prior_oi
        change = oi - prior_oi
        if change == 0:
            unchanged += 1
            continue
        ranked.append((abs(change), contract, {**base, "kind": "change", "prior_oi": prior_oi, "change": change,
                                               "change_pct": round(change / prior_oi * 100, 1) if prior_oi > 0 else None,
                                               "volume": vol if volume_present else None}))
    gone = {"contracts": 0, "prior_oi": 0, "expired": 0}
    for contract, before in prev.items():
        if contract in cur:
            continue
        gone["contracts"] += 1
        gone["prior_oi"] += before[4] or 0
        gone["expired"] += before[1] < newer_day
    ranked.sort(key=lambda t: (-t[0], t[1]))
    every = [r for _, _, r in ranked]
    by_side = {"any": every, "call": [r for r in every if r["type"] == "call"],
               "put": [r for r in every if r["type"] == "put"]}
    return {"known": bool(cur or prev), "prior_has_symbol": bool(prev), "has_symbol": bool(cur),
            "rows": {k: v[:oic.MAX_ROWS] for k, v in by_side.items()}, "matched": {k: len(v) for k, v in by_side.items()},
            "summary": {"call": totals["C"], "put": totals["P"],
                        "contracts": totals["C"]["contracts"] + totals["P"]["contracts"], "unchanged": unchanged},
            "new": new, "gone": gone, "not_reported": not_reported, "volume_present": volume_present,
            "built_at": meta.get("built_at")}


def _invented_pair(rng, n, volume="1"):
    """Two invented screen files' rows for one stock, as `oi_change._read` returns them: changed, unchanged, new,
    gone, unreported and zero-prior contracts, ties in the size of the change."""
    cur, prev = {}, {}
    for i in range(n):
        cp = rng.choice("CP")
        contract = f"O:ZZQN31{rng.randint(1, 12):02d}{rng.randint(1, 28):02d}{cp}{i:08d}"
        exp = 20310000 + rng.randint(1, 12) * 100 + rng.randint(1, 28)
        strike_m = rng.randint(10, 900) * 500
        roll = rng.random()
        oi = None if roll < 0.04 else rng.choice([0, 100, 250, rng.randint(0, 60000)])
        prior = None if roll > 0.96 else rng.choice([0, 100, 250, rng.randint(0, 60000)])
        vol = rng.randint(0, 9000)
        if roll < 0.85:
            cur[contract] = (contract, exp, cp, strike_m, oi, vol)
        if roll > 0.10:
            prev[contract] = (contract, exp - (1 if roll > 0.9 else 0), cp, strike_m, prior, vol)
    return (cur, {"built_at": "2031-06-03T21:00:00Z"}), (prev, {"volume_present": volume})


def test_oic_compute_gives_exactly_the_answer_it_gave_before_on_invented_files(monkeypatch):
    from api.services.options_analytics import oi_change as oic
    pair = {"path": "newer", "prior_path": "earlier", "session": "2031-06-03"}
    for seed in range(40):
        rng = random.Random(seed)
        files = dict(zip(("newer", "earlier"), _invented_pair(rng, rng.choice([0, 3, 60, 400]), rng.choice("10"))))
        monkeypatch.setattr(oic, "_read", lambda path, sym, _f=files: _f[path])
        assert oic.compute("ZZQN", pair) == _old_compute("ZZQN", pair), seed
    files = dict(zip(("newer", "earlier"), _invented_pair(random.Random(99), 6000)))
    monkeypatch.setattr(oic, "_read", lambda path, sym: files[path])
    new_s = min(_timed(lambda: oic.compute("ZZQN", pair))[1] for _ in range(3))
    old_s = min(_timed(lambda: _old_compute("ZZQN", pair))[1] for _ in range(3))
    print(f"\n[measure] OIC: one stock of 6,000 invented contracts a side: {old_s * 1000:.0f} ms before, "
          f"{new_s * 1000:.0f} ms now (the same answer)")


def test_oic_a_repeat_is_neither_computed_nor_rendered_again_and_a_new_pair_drops_it(tmp_path, monkeypatch):
    from api.routers import options_screener as route
    from api.services.options_analytics import oi_change as oic
    from api.services.research import options_screener as osc
    from tests.test_options_oi_change import FLAG, Seed, two_days
    hb.reset_for_tests()
    seed = Seed(tmp_path)
    monkeypatch.setattr(osc, "_store_override", seed.store)
    monkeypatch.setenv(FLAG, "1")
    oic.reset()
    two_days(seed)
    client = _client(route.router)
    first = client.get("/api/options-screener/oi-change/AAA")
    assert first.status_code == 200 and first.json()["status"] == "computing" or first.json()["status"] == "ok"
    end = time.time() + 10
    while time.time() < end and client.get("/api/options-screener/oi-change/AAA").json()["status"] != "ok":
        time.sleep(0.05)
    computes = []
    real = oic.compute
    monkeypatch.setattr(oic, "compute", lambda sym, pair: computes.append(sym) or real(sym, pair))
    want = client.get("/api/options-screener/oi-change/AAA").content
    calls = _slow_render(monkeypatch)
    for _ in range(3):
        resp, took = _timed(lambda: client.get("/api/options-screener/oi-change/AAA"))
        assert resp.content == want and took < FAST_S, took
    assert computes == [] and calls == []
    assert json.loads(want) == oic._answer({"symbol": "AAA", "side": "any", "source": oic.SOURCE, "coverage": oic.COVERAGE,
                                            "max_rows": oic.MAX_ROWS}, oic._held, real("AAA", oic._held), "any")
    kept = next(iter(oic._served.values()))[2]
    oic._drop_held()
    assert not oic._served and hb.held(kept) is None                    # a dropped pair takes its answers and bytes
    oic.reset()
    hb.reset_for_tests()


# ══ 5. The boot warms: DATE jobs on offsets of their own, never inline ════════════════════════════════════════

def _offset_seconds(node, life, src_tree) -> "int | None":
    """The seconds a `run_date=now + timedelta(...)` names, when it can be read without importing `api.main`."""
    import importlib
    for kw in (n for n in ast.walk(node) if isinstance(n, ast.keyword) and n.arg in ("seconds", "minutes")):
        mult = 60 if kw.arg == "minutes" else 1
        v = kw.value
        if isinstance(v, ast.Constant):
            return v.value * mult
        if isinstance(v, ast.Attribute) and isinstance(v.value, ast.Name):
            for imp in (n for n in ast.walk(life) if isinstance(n, ast.ImportFrom)):
                for a in imp.names:
                    if a.asname == v.value.id or (a.asname is None and a.name == v.value.id):
                        mod = importlib.import_module(f"{imp.module}.{a.name}")
                        return getattr(mod, v.attr) * mult
        if isinstance(v, ast.Name):
            for st in src_tree.body:
                if isinstance(st, ast.Assign) and any(getattr(t, "id", None) == v.id for t in st.targets) \
                        and isinstance(st.value, ast.Constant):
                    return st.value.value * mult
    return None


def test_the_three_warms_are_date_jobs_on_offsets_of_their_own_under_their_own_boot_mark():
    from api.routers import rs_ranking as rsl_route
    from tests.test_fund_holders_nport import _boot_level_calls
    from tests.test_insider_clusters_sec import _add_jobs, _kw, _lifespan, _lit
    src, life = _lifespan()
    tree = ast.parse(src)
    jobs = _add_jobs(life)
    defs = {n.name: n for n in ast.walk(life) if isinstance(n, ast.FunctionDef)}
    want = {"iv_history_warm_boot": ("_tw_ivh", IVH.WARM_BOOT_DELAY_S, "_ivh_w.warm_mirror()"),
            "fed_watch_warm_boot": ("_tw_fed", fw.WARM_BOOT_DELAY_S, "_fed_w.warm()"),
            "rs_rankings_body_warm_boot": ("_tw_rsl", rsl_route.WARM_BOOT_DELAY_S, "_rsl_w.warm_body()")}
    for jid, (alias, delay, call) in want.items():
        job = jobs[jid]
        assert _lit(job, "trigger") == "date" and (_lit(job, "max_instances"), _lit(job, "misfire_grace_time")) == (1, 3600)
        assert ast.unparse(_kw(job, "run_date")) == f"_tw_dt.now(_ET) + _tw_td(seconds={alias}.WARM_BOOT_DELAY_S)"
        assert call in ast.get_source_segment(src, defs[job.args[0].id])
    assert not {"warm_mirror", "warm", "warm_body"} & set(_boot_level_calls(life))       # never run inline at boot
    marks = sorted((c.lineno, c.args[0].value) for c in ast.walk(life)
                   if isinstance(c, ast.Call) and getattr(c.func, "id", "") == "_boot_mark")
    names = [n for _, n in marks]
    i = names.index("terminal-warms")
    assert names.count("terminal-warms") == 1
    for jid in want:
        assert marks[i][0] < jobs[jid].lineno < marks[i + 1][0]
    mine = sorted(d for _a, d, _c in want.values())
    every_date_job = [c for c in ast.walk(tree) if isinstance(c, ast.Call) and getattr(c.func, "attr", "") == "add_job"
                      and isinstance(_kw(c, "trigger"), ast.Constant) and _lit(c, "trigger") == "date"
                      and not (isinstance(_kw(c, "id"), ast.Constant) and _lit(c, "id") in want)]
    others = {_offset_seconds(_kw(c, "run_date"), tree, tree) for c in every_date_job}
    others.discard(None)
    assert {120, 180, 300, 420, 600, 720, 900, 1200, 1500, 1800, 2100, 2400} <= others, sorted(others)   # all found
    assert mine[0] >= 360                                                # past the boot's busy first minutes
    assert all(b - a >= 60 for a, b in zip(mine, mine[1:]))
    assert all(abs(m - o) >= 60 for m in mine for o in others), (mine, sorted(others))

"""OIC: one stock's open interest per contract against the logged session before.

`api/services/options_analytics/oi_change.py` + `GET /api/options-screener/oi-change/{sym}`, over
a SEEDED local copy of the options log's layout: contracts files written with the logger's own
column list and turned into screen files by the SAME `build_session` the monitor job runs.
Every number here is invented. No network; the one R2 read is a stand-in client.

The route is mounted on a bare app (the router alone), so this file never imports `api.main`.
"""
from __future__ import annotations

import csv
import datetime as dt
import gzip
import os
import shutil
import sys
import threading

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from api.middleware.auth_middleware import get_current_user_with_plan  # noqa: E402
from api.routers import options_screener as router_mod  # noqa: E402
from api.services import options_universe_log as log  # noqa: E402
from api.services.options_analytics import oi_change as oic  # noqa: E402
from api.services.research import options_screener as osc  # noqa: E402

FLAG = "OPTIONS_SCREENER_ENABLED"
FASTAPI_404 = b'{"detail":"Not Found"}'
PAID = {"id": "paid-test", "email": "paid@example.test", "role": "member", "plan": "pro"}
FREE = {"id": "free-test", "email": "free@example.test", "role": "member", "plan": "free"}
FRI, MON, TUE, WED = "2026-11-13", "2026-11-16", "2026-11-17", "2026-11-18"
NEAR, FAR = "2026-11-20", "2026-12-18"
URL = "/api/options-screener/oi-change/"


def c(und, typ, strike, exp, *, oi=1000, vol=100, ask=1.1):
    occ = f"O:{und}{exp.replace('-', '')[2:]}{typ[0].upper()}{int(strike * 1000):08d}"
    return {"contract": occ, "underlying": und, "expiration": exp, "strike": strike, "type": typ,
            "open_interest": oi, "iv": 0.5, "delta": 0.3, "gamma": 0.01, "theta": -0.02, "vega": 0.1,
            "bid": 1.0, "ask": ask, "last": 1.05, "volume": vol, "vwap": 1.05, "underlying_price": 100.0}


class Seed:
    def __init__(self, root):
        self.root = str(root)
        self.store = osc.LocalStore(self.root)

    def day(self, session, rows):
        ydir = os.path.join(self.root, "options_log", session[:4])
        os.makedirs(ydir, exist_ok=True)
        src = os.path.join(ydir, f"{session}.contracts.csv.gz")
        with gzip.open(src, "wt", newline="", encoding="utf-8") as fh:
            w = csv.DictWriter(fh, fieldnames=log.CONTRACT_FIELDS)
            w.writeheader()
            for r in rows:
                w.writerow(r)
        tmp = os.path.join(self.root, f"_build_{session}")
        os.makedirs(tmp, exist_ok=True)
        rec = osc.build_session(src, dt.date.fromisoformat(session), tmp)
        shutil.move(rec["screen_path"], os.path.join(ydir, f"{session}.screen.sqlite.gz"))
        shutil.rmtree(tmp)
        return os.path.join(ydir, f"{session}.screen.sqlite.gz")


@pytest.fixture
def seed(tmp_path, monkeypatch):
    s = Seed(tmp_path)
    monkeypatch.setattr(osc, "_store_override", s.store)
    oic.reset()
    yield s
    oic.reset()


def read(sym, side=None):
    return oic.oi_change(sym, side, wait_s=10)


def two_days(seed):
    """TUE is the earlier file, WED the newer. AAA: one call up, one put down, one unchanged."""
    seed.day(TUE, [c("AAA", "call", 100, NEAR, oi=1000, vol=700),
                   c("AAA", "put", 90, NEAR, oi=2000, vol=450),
                   c("AAA", "call", 110, FAR, oi=300, vol=5),
                   c("BBB", "call", 50, NEAR, oi=10, vol=1)])
    seed.day(WED, [c("AAA", "call", 100, NEAR, oi=1600, vol=11),
                   c("AAA", "put", 90, NEAR, oi=1500, vol=22),
                   c("AAA", "call", 110, FAR, oi=300, vol=33),
                   c("BBB", "call", 50, NEAR, oi=10, vol=44)])


# ── the two-day pick and the arithmetic ─────────────────────────────────────────

def test_it_compares_the_two_newest_logged_sessions_and_ranks_by_size_of_change(seed):
    seed.day(MON, [c("AAA", "call", 100, NEAR, oi=1)])          # an older file: never read
    two_days(seed)
    out = read("aaa")
    assert out["status"] == "ok" and out["symbol"] == "AAA"
    assert (out["session"], out["prior_session"], out["skipped_sessions"]) == (WED, TUE, [])
    assert [(r["type"], r["strike"], r["oi"], r["prior_oi"], r["change"], r["change_pct"]) for r in out["rows"]] == [
        ("call", 100.0, 1600, 1000, 600, 60.0),
        ("put", 90.0, 1500, 2000, -500, -25.0),
    ]
    assert out["rows"][0]["expiration"] == NEAR and out["rows"][0]["kind"] == "change"
    assert out["matched"] == out["shown"] == 2


def test_biggest_means_the_size_of_the_change_whatever_its_sign_ties_by_contract(seed):
    seed.day(TUE, [c("AAA", "call", 100, NEAR, oi=1000), c("AAA", "put", 90, NEAR, oi=2000),
                   c("AAA", "put", 95, NEAR, oi=500), c("AAA", "call", 105, NEAR, oi=500)])
    seed.day(WED, [c("AAA", "call", 100, NEAR, oi=1300), c("AAA", "put", 90, NEAR, oi=1200),
                   c("AAA", "put", 95, NEAR, oi=200), c("AAA", "call", 105, NEAR, oi=800)])
    out = read("AAA")
    assert [(r["type"], r["strike"], r["change"]) for r in out["rows"]] == [
        ("put", 90.0, -800),                                      # a fall outranks a smaller rise
        ("call", 100.0, 300), ("call", 105.0, 300), ("put", 95.0, -300),   # ties: by contract id
    ]


def test_the_volume_beside_a_change_is_the_earlier_sessions_own(seed):
    two_days(seed)
    out = read("AAA")
    assert out["volume_present"] is True and out["volume_session"] == TUE
    assert [r["volume"] for r in out["rows"]] == [700, 450]     # TUE's, never WED's 11 and 22


def test_totals_cover_every_contract_in_both_files_unchanged_ones_included(seed):
    two_days(seed)
    s = read("AAA")["summary"]
    assert s["call"] == {"contracts": 2, "oi": 1900, "prior_oi": 1300, "change": 600}
    assert s["put"] == {"contracts": 1, "oi": 1500, "prior_oi": 2000, "change": -500}
    assert s["contracts"] == 3 and s["unchanged"] == 1


def test_a_side_narrows_the_rows_and_never_the_totals(seed):
    two_days(seed)
    out = read("AAA", "put")
    assert out["side"] == "put" and [r["type"] for r in out["rows"]] == ["put"] and out["matched"] == 1
    assert out["summary"]["call"]["change"] == 600
    assert [r["type"] for r in read("AAA", "CALL")["rows"]] == ["call"]


def test_a_bad_ticker_or_side_is_refused_in_words(seed):
    two_days(seed)
    with pytest.raises(oic.BadQuery):
        read("not a ticker")
    with pytest.raises(oic.BadQuery):
        read("AAA", "both")


# ── the honest limits ───────────────────────────────────────────────────────────

def test_a_contract_new_in_the_newer_file_is_new_never_a_change_from_zero(seed):
    seed.day(TUE, [c("AAA", "call", 100, NEAR, oi=1000)])
    seed.day(WED, [c("AAA", "call", 100, NEAR, oi=1100),
                   c("AAA", "call", 105, NEAR, oi=900),          # not in TUE's file
                   c("AAA", "put", 80, NEAR, oi=0, vol=0)])      # listed, nobody holds it: not a row
    out = read("AAA")
    new = out["rows"][0]
    assert (new["kind"], new["strike"], new["oi"]) == ("new", 105.0, 900)       # ranks by what it holds
    assert new["prior_oi"] is None and new["change"] is None and new["change_pct"] is None and new["volume"] is None
    assert out["rows"][1]["change"] == 100 and out["matched"] == 2
    assert out["new"] == {"contracts": 1, "oi": 900}
    assert out["summary"]["call"] == {"contracts": 1, "oi": 1100, "prior_oi": 1000, "change": 100}


def test_open_interest_the_log_did_not_report_is_counted_never_read_as_zero(seed):
    seed.day(TUE, [c("AAA", "call", 100, NEAR, oi=None), c("AAA", "put", 90, NEAR, oi=400),
                   c("AAA", "call", 120, NEAR, oi=0)])
    seed.day(WED, [c("AAA", "call", 100, NEAR, oi=500), c("AAA", "put", 90, NEAR, oi=None),
                   c("AAA", "call", 120, NEAR, oi=250)])
    out = read("AAA")
    assert out["not_reported"] == 2
    assert [(r["strike"], r["prior_oi"], r["change"], r["change_pct"]) for r in out["rows"]] == [(120.0, 0, 250, None)]
    assert out["summary"]["contracts"] == 1 and out["summary"]["put"]["contracts"] == 0


def test_a_missing_session_is_named_and_a_weekend_is_not(seed):
    seed.day(FRI, [c("AAA", "call", 100, NEAR, oi=1000)])
    seed.day(TUE, [c("AAA", "call", 100, NEAR, oi=1200)])        # MON was never logged
    out = read("AAA")
    assert (out["session"], out["prior_session"]) == (TUE, FRI)
    assert out["skipped_sessions"] == [MON]
    assert out["rows"][0]["change"] == 200


def test_a_contract_that_left_the_log_is_counted_with_what_it_held(seed):
    seed.day(TUE, [c("AAA", "call", 100, NEAR, oi=1000),
                   c("AAA", "call", 95, TUE, oi=700),            # expires on TUE: gone from WED's file
                   c("AAA", "put", 60, FAR, oi=40)])             # still alive, just not in WED's file
    seed.day(WED, [c("AAA", "call", 100, NEAR, oi=1000)])
    out = read("AAA")
    assert out["gone"] == {"contracts": 2, "prior_oi": 740, "expired": 1}
    assert out["rows"] == [] and out["summary"]["unchanged"] == 1


def test_an_unknown_stock_is_said_so_not_drawn_as_no_change(seed):
    two_days(seed)
    out = read("ZZZZ")
    assert out["status"] == "ok" and out["known"] is False and out["rows"] == [] and out["matched"] == 0


def test_a_stock_only_in_the_newer_file_says_the_earlier_one_has_none(seed):
    seed.day(TUE, [c("BBB", "call", 50, NEAR, oi=10)])
    seed.day(WED, [c("AAA", "call", 100, NEAR, oi=800), c("BBB", "call", 50, NEAR, oi=10)])
    out = read("AAA")
    assert out["known"] is True and out["prior_has_symbol"] is False
    assert [r["kind"] for r in out["rows"]] == ["new"]


def test_no_logged_session_and_one_logged_session_each_say_which(seed):
    assert read("AAA")["status"] == "no_sessions"
    oic.reset()
    seed.day(WED, [c("AAA", "call", 100, NEAR, oi=1)])
    out = read("AAA")
    assert out["status"] == "one_session" and out["session"] == WED and "rows" not in out


def test_the_answer_is_capped_and_counts_the_rest(seed):
    n = oic.MAX_ROWS + 10
    seed.day(TUE, [c("AAA", "call", 100 + i, NEAR, oi=1000) for i in range(n)])
    seed.day(WED, [c("AAA", "call", 100 + i, NEAR, oi=1000 + (i + 1) * 3) for i in range(n)])
    out = read("AAA")
    assert out["shown"] == len(out["rows"]) == oic.MAX_ROWS == out["max_rows"] and out["matched"] == n
    assert out["rows"][0]["change"] == n * 3                      # the biggest change leads
    assert out["rows"][-1]["change"] == 11 * 3                    # the ten smallest are the ones cut
    # what is held for the stock is the cut rows and the counts, never every contract
    held = oic.compute("AAA", oic.prepare(seed.store))
    assert {k: len(v) for k, v in held["rows"].items()} == {"any": oic.MAX_ROWS, "call": oic.MAX_ROWS, "put": 0}
    assert held["matched"] == {"any": n, "call": n, "put": 0}


def test_a_log_without_volume_says_so_and_carries_none(seed):
    seed.day(TUE, [c("AAA", "call", 100, NEAR, oi=1000, vol=None)])
    seed.day(WED, [c("AAA", "call", 100, NEAR, oi=1300, vol=None)])
    out = read("AAA")
    assert out["volume_present"] is False and out["rows"][0]["volume"] is None


# ── builder rule 5: the request never fetches a file ────────────────────────────

class Slow(osc.LocalStore):
    def __init__(self, root):
        super().__init__(root)
        self.gate = threading.Event()
        self.listed = 0

    def screen_sessions(self):
        self.listed += 1
        self.gate.wait(10)
        return super().screen_sessions()


def test_a_cold_read_answers_computing_and_starts_one_build_however_many_ask(seed):
    two_days(seed)
    slow = Slow(seed.root)
    for _ in range(4):
        assert oic.oi_change("AAA", store=slow, wait_s=0.05)["status"] == "computing"
    assert oic.builds_started == 1 and slow.listed == 1
    slow.gate.set()
    out = oic.oi_change("AAA", store=slow, wait_s=10)
    assert out["status"] == "ok" and out["rows"][0]["change"] == 600
    assert oic.builds_started == 1


def test_the_held_pair_keeps_answering_and_a_stock_is_read_once(seed, monkeypatch):
    two_days(seed)
    assert read("AAA")["status"] == "ok"
    calls = []
    real = oic.compute
    monkeypatch.setattr(oic, "compute", lambda s, p: calls.append(s) or real(s, p))
    assert read("AAA")["matched"] == 2 and read("AAA", "put")["matched"] == 1
    assert calls == [] and oic.builds_started == 1


def test_a_failed_build_is_said_and_not_retried_on_every_request(seed, monkeypatch):
    class Broken(osc.LocalStore):
        def screen_sessions(self):
            raise RuntimeError("DATA_SYNC_* R2 credentials are not set on this service")
    broken = Broken("x")
    for _ in range(3):
        out = oic.oi_change("AAA", store=broken, wait_s=10)
        assert out["status"] == "unavailable" and out["error"] == "RuntimeError"
    assert oic.builds_started == 1
    monkeypatch.setattr(oic, "ERROR_HOLD_S", 0.0)                # the hold is over: try again
    two_days(seed)
    assert oic.oi_change("AAA", store=seed.store, wait_s=10)["status"] == "ok"
    assert oic.builds_started == 2


def test_a_held_file_that_was_replaced_starts_a_fresh_build_never_an_error(seed):
    two_days(seed)
    assert read("AAA")["status"] == "ok"
    with oic._lock:
        oic._held = {**oic._held, "path": os.path.join(seed.root, "gone.screen.sqlite")}
        oic._answers.clear()
    assert read("AAA")["status"] == "computing"
    assert read("AAA")["status"] == "ok" and oic.builds_started == 2


def test_the_earlier_file_is_mirrored_once_into_its_own_directory(seed, tmp_path, monkeypatch):
    gz = seed.day(TUE, [c("AAA", "call", 100, NEAR, oi=1000)])
    fetched = []

    class Client:
        def download_file(self, bucket, key, path):
            fetched.append((bucket, key))
            shutil.copyfile(gz, path)

    from api import flow_backup
    monkeypatch.setattr(flow_backup, "_r2_client", lambda: Client())
    monkeypatch.setattr(flow_backup, "_bucket", lambda: "bucket")
    root = str(tmp_path / "mirror")
    os.makedirs(root)
    stale = os.path.join(root, f"{MON}.screen.sqlite")
    open(stale, "w").close()
    db = oic._mirror_earlier(TUE, root)
    assert fetched == [("bucket", f"options_log/2026/{TUE}.screen.sqlite.gz")]
    assert os.listdir(root) == [f"{TUE}.screen.sqlite"]          # opened, the .gz and MON's file gone
    assert oic._read(db, "AAA")[0]
    assert oic._mirror_earlier(TUE, root) == db and len(fetched) == 1


def test_the_mirror_refuses_to_run_without_the_storage_credentials(tmp_path, monkeypatch):
    from api import flow_backup
    monkeypatch.setattr(flow_backup, "_r2_client", lambda: None)
    monkeypatch.setattr(flow_backup, "_bucket", lambda: "")
    with pytest.raises(RuntimeError):
        oic._mirror_earlier(TUE, str(tmp_path / "m"))


# ── the doors ───────────────────────────────────────────────────────────────────

@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(router_mod.router)
    who = {"user": PAID}
    app.dependency_overrides[get_current_user_with_plan] = lambda: dict(who["user"])
    c_ = TestClient(app, raise_server_exceptions=False)
    c_.who = who
    return c_


def test_switched_off_the_route_is_a_plain_404_before_identity(client, monkeypatch, seed):
    two_days(seed)
    monkeypatch.delenv(FLAG, raising=False)
    client.app.dependency_overrides[get_current_user_with_plan] = lambda: (_ for _ in ()).throw(AssertionError("identity read"))
    r = client.get(URL + "AAA")
    assert r.status_code == 404 and r.content == FASTAPI_404


def test_switched_on_it_is_paid_only(client, monkeypatch, seed):
    two_days(seed)
    monkeypatch.setenv(FLAG, "1")
    client.who["user"] = FREE
    assert client.get(URL + "AAA").status_code == 402
    client.who["user"] = PAID
    r = client.get(URL + "AAA?side=put")
    assert r.status_code == 200 and r.json()["rows"][0]["change"] == -500
    assert client.get(URL + "AAA?side=both").status_code == 422
    assert client.get(URL + "A B").status_code == 422


def test_an_unreadable_log_is_a_503_in_words_never_an_empty_list(client, monkeypatch):
    class Broken(osc.LocalStore):
        def screen_sessions(self):
            raise RuntimeError("no storage")
    monkeypatch.setattr(osc, "_store_override", Broken("x"))
    monkeypatch.setattr(oic, "WAIT_S", 10)
    monkeypatch.setenv(FLAG, "1")
    oic.reset()
    r = client.get(URL + "AAA")
    oic.reset()
    assert r.status_code == 503 and r.json()["detail"] == "The options log is unavailable: RuntimeError"

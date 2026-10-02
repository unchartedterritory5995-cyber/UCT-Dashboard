"""COV-02 (option screener) and COV-03 (unusual option volume, IV percentile).

`api/services/research/options_screener.py` + `api/routers/options_screener.py`, over a
SEEDED local copy of the options log's layout, written with the logger's own column
lists (`options_universe_log.CONTRACT_FIELDS` / `UNDERLYING_FIELDS`) and turned into the
derived files by the SAME `build_session` the monitor job runs. No network.
"""
from __future__ import annotations

import csv
import datetime as dt
import gzip
import json
import os
import shutil
import sys
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from api.middleware.auth_middleware import (  # noqa: E402
    get_current_user as _get_current_user,
    get_current_user_with_plan as _get_current_user_with_plan,
)
from api.services import options_universe_log as log  # noqa: E402
from api.services import session_calendar  # noqa: E402
from api.services.research import options_screener as svc  # noqa: E402
from tests.authclients import FREE_MEMBER, PAID_MEMBER, signed_in_as  # noqa: E402

ET = ZoneInfo("America/New_York")
FLAG = "OPTIONS_SCREENER_ENABLED"
FASTAPI_404 = b'{"detail":"Not Found"}'
NOW = dt.datetime(2026, 10, 2, 18, 0, tzinfo=ET)


def trading_days(start: str, n: int) -> list:
    d, out = dt.date.fromisoformat(start), []
    while len(out) < n:
        if session_calendar.is_trading_day(d):
            out.append(d.isoformat())
        d += dt.timedelta(days=1)
    return out


def c(und, typ, strike, exp, *, px=100.0, iv=0.5, delta=0.3, bid=1.0, ask=1.1, oi=1000,
      vol=100, last=1.05):
    occ = f"O:{und}{exp.replace('-', '')[2:]}{typ[0].upper()}{int(strike * 1000):08d}"
    return {"contract": occ, "underlying": und, "expiration": exp, "strike": strike,
            "type": typ, "open_interest": oi, "iv": iv, "delta": delta, "gamma": 0.01,
            "theta": -0.02, "vega": 0.1, "bid": bid, "ask": ask, "last": last,
            "volume": vol, "vwap": last, "underlying_price": px}


class Seed:
    def __init__(self, root):
        self.root = str(root)
        self.store = svc.LocalStore(self.root)

    def _ydir(self, session):
        d = os.path.join(self.root, "options_log", session[:4])
        os.makedirs(d, exist_ok=True)
        return d

    def contracts_file(self, session, rows) -> str:
        p = os.path.join(self._ydir(session), f"{session}.contracts.csv.gz")
        with gzip.open(p, "wt", newline="", encoding="utf-8") as fh:
            w = csv.DictWriter(fh, fieldnames=log.CONTRACT_FIELDS)
            w.writeheader()
            for r in rows:
                w.writerow(r)
        return p

    def summary(self, session, rows, *, legacy=False, complete=True):
        fields = log.UNDERLYING_FIELDS if not legacy else (
            "underlying", "contracts", "call_oi", "put_oi", "underlying_price", "atm_iv",
            "atm_expiration", "atm_strike")
        with gzip.open(os.path.join(self._ydir(session), f"{session}.underlyings.csv.gz"), "wt",
                       newline="", encoding="utf-8") as fh:
            w = csv.DictWriter(fh, fieldnames=fields, extrasaction="ignore")
            w.writeheader()
            for r in sorted(rows, key=lambda r: r["underlying"]):
                w.writerow(r)
        with open(os.path.join(self._ydir(session), f"{session}.manifest.json"), "w") as fh:
            json.dump({"session": session, "complete": complete}, fh)

    def day(self, session, rows):
        """A logged session: contracts file, then the batched build, placed under its keys."""
        src = self.contracts_file(session, rows)
        tmp = os.path.join(self.root, f"_build_{session}")
        os.makedirs(tmp, exist_ok=True)
        rec = svc.build_session(src, dt.date.fromisoformat(session), tmp)
        ydir = self._ydir(session)
        shutil.move(rec["volume_path"], os.path.join(ydir, f"{session}.volume.csv.gz"))
        shutil.move(rec["screen_path"], os.path.join(ydir, f"{session}.screen.sqlite.gz"))
        shutil.rmtree(tmp)
        return rec


def srow(sym, iv):
    return {"underlying": sym, "contracts": 10, "call_oi": 1, "put_oi": 1,
            "underlying_price": 100.0, "atm_iv": iv, "atm_expiration": "2026-11-20",
            "atm_strike": 100.0, "atm_dte": 30}


@pytest.fixture
def seed(tmp_path, monkeypatch):
    s = Seed(tmp_path)
    monkeypatch.setattr(svc, "_store_override", s.store)
    svc._SCREEN_CACHE.clear()
    svc._RANK_CACHE.clear()
    svc._FILE_CACHE.clear()
    return s


S = "2026-10-02"
EXP_NEAR, EXP_MID, EXP_FAR = "2026-10-16", "2026-11-20", "2027-01-15"   # 14, 49, 105 DTE


def universe():
    return [
        # AAA @100: rich IV, short-premium shaped
        c("AAA", "put", 90, EXP_MID, iv=0.85, delta=-0.25, bid=1.50, ask=1.60, oi=2000, vol=300),
        c("AAA", "call", 110, EXP_MID, iv=0.80, delta=0.28, bid=1.40, ask=1.50, oi=1500, vol=250),
        # AAA: cheap far-OTM call, 20% OTM
        c("AAA", "call", 120, EXP_MID, iv=0.95, delta=0.08, bid=0.20, ask=0.30, oi=400, vol=900),
        # BBB @50: tight & liquid, lower IV
        c("BBB", "call", 50, EXP_NEAR, px=50.0, iv=0.30, delta=0.52, bid=2.00, ask=2.02, oi=9000, vol=5000),
        # BBB: no vendor delta, no quote -> not computable for delta/spread screens
        c("BBB", "put", 40, EXP_FAR, px=50.0, iv=None, delta=None, bid=None, ask=None, oi=50, vol=0),
        # CCC: no market at all -> left out of the screen file at build time
        c("CCC", "call", 10, EXP_MID, px=5.0, iv=None, delta=None, bid=0, ask=0, oi=0, vol=0),
    ]


# ── the batched step ────────────────────────────────────────────────────────────

def test_the_build_keeps_screenable_contracts_and_sums_volume_per_underlying(seed):
    rec = seed.day(S, universe())
    assert rec["rows_in"] == 6 and rec["rows_kept"] == 5          # CCC's dead line left out
    with gzip.open(seed.store.volume_path(S), "rt") as fh:
        vol = {r["underlying"]: r for r in csv.DictReader(fh)}
    assert vol["AAA"]["volume"] == "1450" and vol["AAA"]["call_volume"] == "1150"
    assert vol["AAA"]["put_volume"] == "300" and vol["BBB"]["volume"] == "5000"
    assert vol["CCC"]["volume"] == "0"                            # still counted for volume


def test_catch_up_builds_only_sessions_without_derived_files_and_names_a_failure(tmp_path):
    seed = Seed(tmp_path / "src")
    good = seed.contracts_file("2026-09-30", universe())
    store = {"options_log/2026/2026-09-30.contracts.csv.gz": good,
             "options_log/2026/2026-10-02.contracts.csv.gz": None,      # unreadable
             "options_log/2026/2026-10-05.contracts.csv.gz": good,
             "options_log/2026/2026-10-05.volume.csv.gz": "x",
             "options_log/2026/2026-10-05.screen.sqlite.gz": "x"}
    uploaded = {}

    def download(key, path):
        if store[key] is None:
            raise OSError("object missing")
        shutil.copy(store[key], path)

    rec = svc.catch_up(list_keys=lambda: list(store), download=download,
                       upload=lambda path, key, ct: uploaded.setdefault(key, os.path.getsize(path)))
    assert [b["session"] for b in rec["built"]] == ["2026-09-30"]
    assert rec["failed"][0]["session"] == "2026-10-02" and "object missing" in rec["failed"][0]["error"]
    assert set(uploaded) == {"options_log/2026/2026-09-30.volume.csv.gz",
                             "options_log/2026/2026-09-30.screen.sqlite.gz"}
    title, body, alert = svc.receipt_text(rec)
    assert alert is True and "2026-10-02" in body


# ── COV-02: the screener ────────────────────────────────────────────────────────

def test_every_row_names_its_session_and_says_end_of_day(seed):
    seed.day(S, universe())
    out = svc.screen({})
    assert out["status"] == "ok" and out["session"] == S
    assert out["rows"] and all(r["session"] == S and r["data_basis"] == "end-of-day snapshot"
                               for r in out["rows"])
    assert "End-of-day snapshot of 2026-10-02" in out["note"]


def test_filters_are_applied_and_delta_is_absolute(seed):
    seed.day(S, universe())
    out = svc.screen({"delta_min": "0.2", "delta_max": "0.3", "dte_min": "30", "dte_max": "60"})
    assert sorted(r["contract"][2:5] + r["type"] for r in out["rows"]) == ["AAAcall", "AAAput"]
    assert out["matched"] == 2
    puts = svc.screen({"type": "put", "otm_min": "5"})
    assert [r["strike"] for r in puts["rows"]] == [90.0, 40.0]      # default sort: volume desc
    assert [r["otm_pct"] for r in puts["rows"]] == [10.0, 20.0]     # a put's OTM is spot minus strike
    assert svc.screen({"otm_max": "0"})["matched"] == 1              # only BBB's at-the-money 50 call
    assert svc.screen({"underlyings": "bbb"})["matched"] == 2
    assert svc.screen({"iv_min": "90"})["matched"] == 1           # percent in the API


def test_a_contract_missing_the_field_a_filter_reads_is_not_computable_never_a_non_match(seed):
    seed.day(S, universe())
    out = svc.screen({"delta_min": "0.1"})
    cov = out["coverage"]
    assert cov["evaluated"] == 5 and cov["not_computable"] == 1
    assert cov["answered"] + cov["dropped"] + cov["not_computable"] == cov["evaluated"]
    assert cov["dropped_symbols"][0]["detail"] == "no vendor delta"
    # with no filter that reads delta, the same contract is answered
    assert svc.screen({"oi_min": "1"})["coverage"]["not_computable"] == 0


def test_presets_resolve_and_the_members_values_override_them(seed):
    seed.day(S, universe())
    hi = svc.screen({"preset": "high_iv_short_premium"})
    assert hi["query"]["preset"] == "high_iv_short_premium"
    assert {r["strike"] for r in hi["rows"]} == {90.0, 110.0}
    assert [r["iv"] for r in hi["rows"]] == sorted([r["iv"] for r in hi["rows"]], reverse=True)
    cheap = svc.screen({"preset": "cheap_far_otm_calls"})
    assert [r["strike"] for r in cheap["rows"]] == [120.0]
    tight = svc.screen({"preset": "tight_spread_liquid"})
    assert [r["underlying"] for r in tight["rows"]] == ["BBB"]
    assert svc.screen({"preset": "cheap_far_otm_calls", "ask_max": "0.10"})["matched"] == 0


def test_a_bad_parameter_is_refused_in_words(seed):
    seed.day(S, universe())
    for bad in ({"delta_min": "x"}, {"sort": "contract; DROP TABLE"}, {"nope": "1"},
                {"underlyings": "$$$"}, {"preset": "nope"}):
        with pytest.raises(svc.BadQuery):
            svc.screen(bad)


def test_no_screen_file_yet_says_so(seed):
    out = svc.screen({})
    assert out["status"] == "no_screen" and out["rows"] == [] and out["coverage"] is None


# ── COV-03a: unusual option volume ─────────────────────────────────────────────

def _vol_day(seed, session, aaa_vol):
    seed.day(session, [c("AAA", "call", 100, "2027-06-18", vol=aaa_vol),
                       c("BBB", "call", 50, "2027-06-18", px=50.0, vol=100)])


def test_below_10_prior_sessions_there_is_no_ratio_only_the_count(seed):
    for d in trading_days("2026-09-14", 10):            # 9 prior + today
        _vol_day(seed, d, 100)
    out = svc.unusual_volume(now=NOW)
    assert out["ranked"] == [] and out["prior_sessions"] == 9
    row = next(r for r in out["not_ranked"] if r["underlying"] == "AAA")
    assert row["note"] == "9 sessions, needs 10" and "ratio" not in row
    assert out["available_on"] == svc.ranking_available_on(out["session"], 1)
    assert out["coverage"]["answered"] == 0 and out["coverage"]["not_computable"] == 2


def test_at_10_prior_sessions_the_ratio_ranks_against_the_own_average(seed):
    days = trading_days("2026-09-14", 11)
    for d in days[:-1]:
        _vol_day(seed, d, 100)
    _vol_day(seed, days[-1], 500)
    out = svc.unusual_volume(now=NOW)
    assert out["session"] == days[-1] and out["prior_sessions"] == 10
    top = out["ranked"][0]
    assert top["underlying"] == "AAA" and top["ratio"] == 5.0 and top["n_sessions"] == 10
    assert top["session"] == days[-1] and top["data_basis"] == "end-of-day snapshot"
    assert out["ranked"][1]["ratio"] == 1.0


def test_a_missed_session_is_a_gap_never_filled(seed):
    _vol_day(seed, "2026-09-30", 100)
    _vol_day(seed, "2026-10-02", 100)                    # 10-01 not logged
    out = svc.unusual_volume(now=NOW)
    assert out["missing_sessions"] == ["2026-10-01"] and out["prior_sessions"] == 1


# ── COV-03b: IV percentile ──────────────────────────────────────────────────────

def test_below_20_sessions_the_view_states_the_count_and_the_date(seed):
    days = trading_days("2026-09-01", 19)
    for i, d in enumerate(days):
        seed.summary(d, [srow("AAA", 0.2 + i / 100)])
    out = svc.iv_percentile(now=NOW)
    assert out["ranked"] == [] and out["rankable_sessions"] == 19
    assert "19 sessions logged" in out["note"] and "needs 20" in out["note"]
    assert out["available_on"] == svc.ranking_available_on(days[-1], 1)
    assert out["coverage"]["dropped_symbols"][0]["detail"] == "19 sessions, needs 20"


def test_at_20_sessions_the_percentile_and_bucket_are_served(seed):
    days = trading_days("2026-09-01", 20)
    ivs = [0.30, 0.20] + [0.25] * 17 + [0.28]
    for d, iv in zip(days, ivs):
        seed.summary(d, [srow("AAA", iv)])
    out = svc.iv_percentile(now=NOW)
    r = out["ranked"][0]
    assert r["iv_percentile"] == pytest.approx(18 / 19 * 100, abs=0.1)
    assert r["bucket"] == "very high" and r["n_sessions"] == 20 and r["session"] == days[-1]


def test_a_legacy_rule_session_is_not_counted(seed):
    seed.summary("2026-09-30", [srow("AAA", 0.3)], legacy=True)
    seed.summary("2026-10-02", [srow("AAA", 0.3)])
    out = svc.iv_percentile(now=NOW)
    assert out["rankable_sessions"] == 1 and out["legacy_sessions"] == ["2026-09-30"]
    assert "2026-09-30 was read under the first run's 20-45 day rule" in out["note"]


def test_rankings_are_computed_once_per_set_of_sessions(seed, monkeypatch):
    _vol_day(seed, "2026-10-02", 100)
    calls = []

    def fn(store=None):
        calls.append(1)
        return {"n": len(calls)}
    assert svc.cached("t", fn) == svc.cached("t", fn) == {"n": 1}
    _vol_day(seed, "2026-10-05", 100)                    # a new session lands
    assert svc.cached("t", fn) == {"n": 2}


# ── the doors ───────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def app():
    from api.main import app as real_app
    return real_app


@pytest.fixture
def client(app):
    yield TestClient(app, raise_server_exceptions=False)
    for dep in (_get_current_user, _get_current_user_with_plan):
        app.dependency_overrides.pop(dep, None)


URLS = ("/api/options-screener/screen", "/api/options-screener/unusual-volume",
        "/api/options-screener/iv-percentile")


def test_dark_by_default_every_route_answers_404(client, monkeypatch, seed):
    monkeypatch.delenv(FLAG, raising=False)
    with signed_in_as(PAID_MEMBER):
        for url in URLS:
            r = client.get(url)
            assert r.status_code == 404 and r.content == FASTAPI_404


def test_armed_it_is_paid_only_and_read_per_request(client, monkeypatch, seed):
    seed.day(S, universe())
    monkeypatch.setenv(FLAG, "1")
    with signed_in_as(FREE_MEMBER):
        assert client.get(URLS[0]).status_code == 402
    with signed_in_as(PAID_MEMBER):
        for url in URLS:
            assert client.get(url).status_code == 200, url
        r = client.get(URLS[0] + "?preset=tight_spread_liquid")
        assert r.json()["rows"][0]["underlying"] == "BBB"
        assert client.get(URLS[0] + "?delta_min=abc").status_code == 422
        monkeypatch.setenv(FLAG, "0")
        assert client.get(URLS[0]).status_code == 404


def test_an_unreadable_store_is_a_503_never_an_empty_screen(client, monkeypatch):
    class Broken(svc.LocalStore):
        def screen_sessions(self):
            raise RuntimeError("DATA_SYNC_* R2 credentials are not set on this service")
    monkeypatch.setattr(svc, "_store_override", Broken("x"))
    monkeypatch.setenv(FLAG, "1")
    with signed_in_as(PAID_MEMBER):
        r = client.get(URLS[0])
    assert r.status_code == 503 and "options log is unavailable" in r.json()["detail"]


def test_the_auth_payload_carries_the_key_only_when_on(monkeypatch):
    from api.routers import auth
    monkeypatch.delenv(FLAG, raising=False)
    assert auth._options_screener_flag() == {}
    monkeypatch.setenv(FLAG, "1")
    assert auth._options_screener_flag() == {"options_screener_enabled": True}


def test_the_monitor_job_is_gated_and_queued_after_the_log():
    from api import terminal_next_monitor_main as m
    names = [n for n, *_ in m.SCHEDULE]
    assert names.index("options-screen") > names.index("options-log")
    assert m.JOB_GATES["options-screen"] is m._options_screen_enabled

"""TERMINAL-NEXT finishing lane L3: BRK-08 base rate, FT-049 projection + refresh, FT-073 multi-leg
trades, FT-053 level files. Minimal FastAPI app over the options analytics router; every vendor,
store and tape read is stubbed (no network, nothing under the shared data root)."""
from __future__ import annotations

import asyncio
import csv
import datetime as dt
import gzip
import json
import pathlib

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import options_analytics as oa
from api.services.options_analytics import level_base_rate as lbr
from api.services.options_analytics import level_files as lf
from api.services.options_analytics import market_tide as mt
from api.services.options_analytics import more_screens as ms
from api.services.options_analytics import positioning as pos
from api.services.options_analytics import pressure as pr
from api.services.options_analytics import tide_extras as tx
from api.services.options_analytics import trace_projection as tp

FIX = pathlib.Path(__file__).parent / "fixtures" / "options_analytics"
CHAIN = json.loads((FIX / "chain_tst_schwab_shape.json").read_text(encoding="utf-8"))
PAID = {"id": "u1", "role": "member", "plan": "pro"}
FREE = {"id": "u2", "role": "member", "plan": "free"}
NEW_FLAGS = ("OPTIONS_LEVEL_BASE_RATE_ENABLED", "OPTIONS_TRACE_PROJECTION_ENABLED",
             "OPTIONS_TRACE_REFRESH_ENABLED", "OPTIONS_MULTI_LEG_SCREEN_ENABLED",
             "OPTIONS_LEVEL_FILES_ENABLED")
ROUTES = {
    "OPTIONS_LEVEL_BASE_RATE_ENABLED": "/api/options/positioning/TST/base-rate",
    "OPTIONS_TRACE_PROJECTION_ENABLED": "/api/options/positioning/TST/projection",
    "OPTIONS_TRACE_REFRESH_ENABLED": "/api/options/positioning/refresh-policy",
    "OPTIONS_MULTI_LEG_SCREEN_ENABLED": "/api/options-screener/multi-leg",
    "OPTIONS_LEVEL_FILES_ENABLED": "/api/options/positioning/TST/level-files",
}
GEX = {"callWall": {"strike": 105.0}, "putWall": {"strike": 95.0}, "zeroGamma": 97.5,
       "zeroGammaMethod": "cumulative_flip", "zeroGammaIsFlip": True,
       "levels": {"call_wall": {"label": "Ceiling"}}}


def _tape_rows():
    base = {"CreatedDate": "10/2/2026", "CallPut": "CALL", "Side": "A", "ExpirationDate": "10/16/2026"}
    return [
        {**base, "CreatedTime": "10:00:01 AM", "Symbol": "AAPL", "Type": "ML/", "Strike": "200",
         "Premium": "60000", "Volume": "100", "OI": "900"},
        {**base, "CreatedTime": "10:00:01 AM", "Symbol": "AAPL", "Type": "ML/", "Strike": "210",
         "CallPut": "PUT", "Premium": "40000", "Volume": "100", "OI": "500"},
        {**base, "CreatedTime": "11:00:00 AM", "Symbol": "TSLA", "Type": "ML/", "Strike": "300",
         "Premium": "20000", "Volume": "50", "OI": "0"},
        {**base, "CreatedTime": "11:00:00 AM", "Symbol": "TSLA", "Type": "SWEEP", "Strike": "300",
         "Premium": "90000", "Volume": "50"},
    ]


@pytest.fixture(autouse=True)
def _stubs(monkeypatch, tmp_path):
    pos.clear_cache()
    lbr.clear_cache()
    for f in NEW_FLAGS:
        monkeypatch.delenv(f, raising=False)

    async def fetch(sym, f, t):
        return json.loads(json.dumps(CHAIN)), None, "massive"

    async def gex(sym, dte="all", adjusted=False, source=None):
        return dict(GEX)

    from api import gex_service
    monkeypatch.setattr(pos, "_fetch", fetch)
    monkeypatch.setattr(pos, "_atm", lambda s: {"iv": 0.25, "strike": 100.0, "expiration": None, "spot": 100.0})
    monkeypatch.setattr(gex_service, "get_gex_data", gex)
    monkeypatch.setattr(lbr, "_store_override", lbr.LocalStore(str(tmp_path / "levels")))
    monkeypatch.setattr(mt, "extras", lambda scope="all": _extras())
    yield
    pos.clear_cache()
    lbr.clear_cache()


def _extras():
    ext = tx.TideExtras()
    for r in _tape_rows():
        ext.add(r)
    return {**ext.result("2026-10-02"), "partial": False, "partial_reasons": []}


def _client(user, monkeypatch):
    from api.middleware.auth_middleware import get_current_user_with_plan
    monkeypatch.setattr(oa, "is_paid_user", lambda u: u.get("plan") == "pro")
    app = FastAPI()
    app.include_router(oa.router)
    app.dependency_overrides[get_current_user_with_plan] = lambda: user
    return TestClient(app)


# ── every surface is dark alone, arms alone, and is paid ───────────────────────────────────────

@pytest.mark.parametrize("flag", NEW_FLAGS)
def test_each_new_surface_is_dark_alone_and_arms_alone(flag, monkeypatch):
    c = _client(PAID, monkeypatch)
    assert all(c.get(r).status_code == 404 for r in ROUTES.values())
    monkeypatch.setenv(flag, "1")
    for f, r in ROUTES.items():
        assert c.get(r).status_code == (200 if f == flag else 404), (flag, r)
    assert _client(FREE, monkeypatch).get(ROUTES[flag]).status_code == 402


def test_the_new_flags_are_in_the_table_and_default_off():
    from api.services.options_analytics import flags
    for f in NEW_FLAGS:
        assert flags.OPTIONS_ANALYTICS_FLAGS[f] == ""


def test_the_new_flags_are_declared_dark_in_the_ledger():
    ledger = json.loads((pathlib.Path(__file__).parents[1] / "docs" / "feature_flags.json").read_text(encoding="utf-8"))
    for f in NEW_FLAGS:
        e = ledger["flags"][f]
        assert e["status"] == "dark" and "web" in e["where"] and "L3" in e["note"]


# ── BRK-08 base rate ────────────────────────────────────────────────────────────────────────────

def test_levels_of_follows_gex_service_rules():
    # strike: [call gamma*oi, put gamma*oi]; puts below spot, calls above
    lv = lbr.levels_of({95.0: [0, 30.0], 100.0: [5.0, 5.0], 105.0: [40.0, 0]}, 100.0)
    assert lv["call_wall"] == 105.0 and lv["put_wall"] == 95.0
    assert lv["zero_gamma_method"] == "cumulative_flip" and 100.0 < lv["zero_gamma"] < 105.0
    # never flips (all calls): no stand-in level is recorded
    assert lbr.levels_of({100.0: [5.0, 0]}, 100.0)["zero_gamma"] is None


def test_levels_of_keeps_walls_inside_the_band():
    lv = lbr.levels_of({150.0: [999.0, 0], 104.0: [1.0, 0]}, 100.0, band_pct=15.0)
    assert lv["call_wall"] == 104.0


@pytest.mark.parametrize("kind,level,spot,closes,want", [
    ("call_wall", 105, 100, [101, 102, 103, 104.5, 103], "held"),
    ("call_wall", 105, 100, [101, 106, 103, 104, 103], "broke"),
    ("call_wall", 105, 100, [100, 100, 100, 100, 100], "untested"),
    ("call_wall", 95, 100, [100] * 5, "not_applicable"),
    ("put_wall", 95, 100, [99, 96, 95.5, 97, 98], "held"),
    ("put_wall", 95, 100, [99, 94, 95.5, 97, 98], "broke"),
    ("zero_gamma", 98, 100, [99, 98.5, 99, 100, 101], "held"),
    ("zero_gamma", 98, 100, [99, 97, 99, 100, 101], "broke"),
])
def test_score_held_broke_untested(kind, level, spot, closes, want):
    assert lbr.score(kind, level, spot, closes) == want


def _write_contracts(path, spot, rows):
    with gzip.open(path, "wt", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=("contract", "underlying", "expiration", "strike", "type",
                                           "open_interest", "iv", "delta", "gamma", "underlying_price"))
        w.writeheader()
        for und, exp, k, typ, oi, g in rows:
            w.writerow({"contract": f"O:{und}{k}{typ}", "underlying": und, "expiration": exp, "strike": k,
                        "type": typ, "open_interest": oi, "iv": "", "delta": "", "gamma": g,
                        "underlying_price": spot})


def test_build_session_reads_the_contracts_file_once_and_writes_levels(tmp_path):
    src = tmp_path / "c.csv.gz"
    _write_contracts(src, 100.0, [
        ("TST", "2026-10-16", 105, "call", 1000, 0.05), ("TST", "2026-10-16", 95, "put", 1000, 0.05),
        ("TST", "2027-06-18", 120, "call", 99999, 0.05),     # outside the 30-day window: ignored
        ("ZZZ", "2026-10-16", 100, "call", 0, 0.05),          # no open interest: no level, still a row
    ])
    out = tmp_path / "l.csv.gz"
    rec = lbr.build_session(str(src), dt.date(2026, 10, 2), str(out))
    assert rec["underlyings"] == 2 and rec["with_level"] == 1 and rec["contracts_used"] == 2
    with gzip.open(out, "rt", encoding="utf-8") as fh:
        rows = {r["underlying"]: r for r in csv.DictReader(fh)}
    assert float(rows["TST"]["call_wall"]) == 105.0 and float(rows["TST"]["put_wall"]) == 95.0
    assert rows["ZZZ"]["call_wall"] == "" and float(rows["ZZZ"]["spot"]) == 100.0


def test_catch_up_builds_only_sessions_without_a_levels_file(tmp_path):
    src = tmp_path / "src.csv.gz"
    _write_contracts(src, 100.0, [("TST", "2026-10-16", 105, "call", 10, 0.05)])
    keys = ["options_log/2026/2026-10-01.contracts.csv.gz", "options_log/2026/2026-10-02.contracts.csv.gz",
            lbr.key_for("2026-10-01")]
    uploaded = []
    rec = lbr.catch_up(list_keys=lambda: keys,
                       download=lambda key, path: pathlib.Path(path).write_bytes(src.read_bytes()),
                       upload=lambda path, key, ct: uploaded.append(key), workdir=str(tmp_path))
    assert uploaded == [lbr.key_for("2026-10-02")] and rec["failed"] == [] and rec["pending"] == 0
    title, body, alert = lbr.receipt_text(rec)
    assert not alert and "2026-10-02" in body


def _seed(store_root, sessions):
    for d, row in sessions.items():
        p = pathlib.Path(store_root, *lbr.key_for(d).split("/"))
        p.parent.mkdir(parents=True, exist_ok=True)
        with gzip.open(p, "wt", newline="", encoding="utf-8") as fh:
            w = csv.writer(fh)
            w.writerow(lbr.FIELDS)
            w.writerow(["TST", row[0], row[1], row[2], row[3], "cumulative_flip" if row[3] else ""])


def _trading_days(start, n):
    from api.services import session_calendar
    out, d = [], start
    while len(out) < n:
        if session_calendar.is_trading_day(d):
            out.append(d.isoformat())
        d += dt.timedelta(days=1)
    return out


def test_short_history_says_so_with_the_sample_size_never_a_rate(tmp_path):
    days = _trading_days(dt.date(2026, 9, 30), 8)
    _seed(tmp_path / "levels", {d: (100.0, 101.0, 95.0, 98.0) for d in days})
    out = lbr.base_rate("TST")
    cw = next(r for r in out["levels"] if r["id"] == "call_wall")
    assert cw["held_pct"] is None and "a rate needs 20" in cw["note"]
    assert cw["tested"] == 3 and cw["held"] == 3 and cw["incomplete"] == 5   # last 5 have no 5 closes after
    assert out["sessions_with_levels"] == 8 and out["first_session"] == days[0]
    assert cw["label"] == "Call Wall"


def test_a_long_history_gives_a_rate(tmp_path):
    days = _trading_days(dt.date(2025, 1, 2), 40)
    seeded = {}
    for i, d in enumerate(days):
        spot = 100.0 + (3.0 if i % 4 == 0 else 0.0)        # every 4th close pokes above 101
        seeded[d] = (spot, 101.0, 90.0, None)
    _seed(tmp_path / "levels", seeded)
    out = lbr.base_rate("TST")
    cw = next(r for r in out["levels"] if r["id"] == "call_wall")
    assert cw["tested"] >= lbr.MIN_TESTED and cw["held_pct"] is not None and cw["note"] is None
    assert cw["broke"] > 0 and 0 <= cw["held_pct"] < 100


def test_a_gap_in_the_log_makes_an_instance_incomplete_not_held(tmp_path):
    days = _trading_days(dt.date(2026, 9, 30), 12)
    del_day = days[3]
    _seed(tmp_path / "levels", {d: (100.0, 101.0, 95.0, None) for d in days if d != del_day})
    cw = next(r for r in lbr.base_rate("TST")["levels"] if r["id"] == "call_wall")
    assert cw["incomplete"] > 5        # every instance whose next 5 closes span the missing day


def test_no_levels_yet_is_a_sentence(tmp_path):
    out = lbr.base_rate("TST")
    assert out["sessions_with_levels"] == 0 and "No session's levels have been recorded yet" in out["note"]


def test_the_base_rate_route_serves_it(monkeypatch, tmp_path):
    monkeypatch.setenv("OPTIONS_LEVEL_BASE_RATE_ENABLED", "1")
    body = _client(PAID, monkeypatch).get("/api/options/positioning/TST/base-rate").json()
    assert body["label"] == "computed" and [r["id"] for r in body["levels"]] == list(lbr.KINDS)


def test_the_monitor_runs_the_levels_job_after_the_screen_job_and_gates_it(monkeypatch):
    from api import terminal_next_monitor_main as m
    names = [s[0] for s in m.SCHEDULE]
    assert names.index("options-levels") > names.index("options-screen") > names.index("options-log")
    assert m.JOBS["options-levels"] is m.job_options_levels
    assert m.JOB_GATES["options-levels"]() is False
    monkeypatch.setenv("OPTIONS_LEVEL_BASE_RATE_ENABLED", "1")
    assert m.JOB_GATES["options-levels"]() is True


# ── FT-049 projection + refresh ─────────────────────────────────────────────────────────────────

def _ch():
    return {"spot": 100.0, "rows": pos.contracts(CHAIN), "source": "massive", "truncated": False,
            "window": {"from": "2026-10-02", "to": "2026-11-01"}}


def test_sigma_recovery_round_trips_black_scholes():
    import math
    from statistics import NormalDist
    n = NormalDist()
    s, k, sig, days = 100.0, 104.0, 0.35, 20
    t = days / 365
    d1 = (math.log(s / k) + 0.5 * sig * sig * t) / (sig * math.sqrt(t))
    delta, gamma = n.cdf(d1), n.pdf(d1) / (s * sig * math.sqrt(t))
    assert tp.sigma_of("C", delta, gamma, s, days) == pytest.approx(sig, rel=1e-6)
    assert tp.bs_gamma(s, k, sig, t) == pytest.approx(gamma, rel=1e-9)
    assert tp.sigma_of("C", 1.0, gamma, s, days) is None and tp.sigma_of("C", 0.5, gamma, s, 0) is None


def test_projection_grid_shape_and_expiry_drop_out():
    out = tp.projection_from("TST", "month", _ch(), today=dt.date(2026, 10, 5))
    assert len(out["prices"]) == tp.PRICE_STEPS and len(out["cells"]) == tp.PRICE_STEPS
    assert len(out["sessions"]) == tp.SESSIONS and out["sessions"][0] == "2026-10-05"
    assert out["prices"][tp.PRICE_STEPS // 2] == 100.0
    # the 10-09 expiry is gone by the 10-09 session; the 10-16 contracts remain
    i9 = out["sessions"].index("2026-10-09")
    assert out["contracts_expired_by_session"][i9] > out["contracts_expired_by_session"][0] == 0
    assert out["contracts_missing_inputs"] == 1 and out["label"] == "computed"
    assert len(out["zero_gamma_by_session"]) == tp.SESSIONS


def test_flip_interpolates_the_crossing_nearest_spot():
    assert tp._flip([90, 100, 110], [-10, 10, 30]) == 95.0
    assert tp._flip([90, 100, 110], [5, 10, 30]) is None


def test_refresh_policy_is_60s_in_rth_and_none_when_closed():
    open_ = tp.refresh_policy(dt.datetime(2026, 10, 7, 11, 0, tzinfo=pos._ET))
    shut = tp.refresh_policy(dt.datetime(2026, 10, 7, 20, 0, tzinfo=pos._ET))
    assert open_["interval_s"] == 60 and open_["market_open"] is True
    assert shut["interval_s"] is None and shut["market_open"] is False


def test_concurrent_misses_share_one_build():
    calls = {"n": 0}

    async def build():
        calls["n"] += 1
        await asyncio.sleep(0.05)
        return {"ok": calls["n"]}

    async def go():
        return await asyncio.gather(*[pos._cached("t", "TST", "month", build) for _ in range(8)])

    outs = asyncio.run(go())
    assert calls["n"] == 1 and all(o == {"ok": 1} for o in outs)


def test_a_failed_build_reaches_every_waiter_and_is_not_cached():
    calls = {"n": 0}

    async def bad():
        calls["n"] += 1
        await asyncio.sleep(0.02)
        raise RuntimeError("boom")

    async def go():
        return await asyncio.gather(*[pos._cached("f", "TST", "month", bad) for _ in range(3)],
                                    return_exceptions=True)

    outs = asyncio.run(go())
    assert calls["n"] == 1 and all(isinstance(o, RuntimeError) for o in outs)
    assert pos._RESULTS.get("posn::f::TST::month") is None and not pos._INFLIGHT


def test_pressure_not_built_names_only_what_is_still_off(monkeypatch):
    assert "forward projection" in pr.not_built()
    monkeypatch.setenv("OPTIONS_TRACE_PROJECTION_ENABLED", "1")
    assert pr.not_built().startswith("A 1-minute refresh")
    monkeypatch.setenv("OPTIONS_TRACE_REFRESH_ENABLED", "1")
    assert pr.not_built() is None


def test_projection_route(monkeypatch):
    monkeypatch.setenv("OPTIONS_TRACE_PROJECTION_ENABLED", "1")
    body = _client(PAID, monkeypatch).get("/api/options/positioning/TST/projection").json()
    assert body["measure"] == "projected_gex" and len(body["cells"]) == tp.PRICE_STEPS


# ── FT-073 multi-leg trades ─────────────────────────────────────────────────────────────────────

def test_multi_leg_prints_group_per_symbol_and_second():
    ex = _extras()
    assert ex["multileg_prints"] == 3 and ex["multileg_structures"] == 2
    top = ex["multileg"][0]
    assert top["symbol"] == "AAPL" and top["premium"] == 100000 and top["legs_seen"] == 2
    assert [l["strike"] for l in top["legs"]] == [200.0, 210.0] and top["legs"][0]["open_interest"] == 900.0


def test_merge_keeps_multi_leg_structures_whole():
    a, b = tx.TideExtras(), tx.TideExtras()
    rows = _tape_rows()
    a.add(rows[0])
    b.add(rows[1])
    a.merge(b)
    s = a.result("2026-10-02")
    assert s["multileg_structures"] == 1 and s["multileg"][0]["legs_seen"] == 2


def test_multi_leg_route_and_catalog(monkeypatch):
    assert "multi-leg" in ms.catalog()["not_built"]["multi_leg_trades"]
    monkeypatch.setenv("OPTIONS_MULTI_LEG_SCREEN_ENABLED", "1")
    assert ms.catalog()["not_built"] == {}
    c = _client(PAID, monkeypatch)
    body = c.get("/api/options-screener/multi-leg").json()
    assert body["prints_read"] == 3 and body["matches"] == 2 and "50+ contracts" in body["filters"]
    only = c.get("/api/options-screener/multi-leg?underlyings=TSLA").json()
    assert [r["symbol"] for r in only["rows"]] == ["TSLA"]


# ── FT-053 level files ──────────────────────────────────────────────────────────────────────────

LEVELS = {"spot": 100.0, "dte": "month", "computed_at": "2026-10-10T14:00:00+00:00",
          "levels": [{"id": "call_wall", "label": "Call Wall", "value": 105.0, "unit": "strike"},
                     {"id": "put_wall", "label": "Put Wall", "value": None, "unit": "strike"},
                     {"id": "implied_move_1d", "label": "Implied 1-Day Move", "value": 1.6, "unit": "$ move"}]}


def test_csv_is_price_label_and_moves_become_two_prices():
    body = lf.render("csv", "TST", LEVELS)
    rows = list(csv.DictReader(body.splitlines()))
    assert [(r["price"], r["label"]) for r in rows] == [
        ("105.00", "Call Wall"), ("101.60", "Implied 1-Day Move up"), ("98.40", "Implied 1-Day Move down")]


def test_pine_has_one_hline_per_level_and_names_what_it_left_out():
    body = lf.render("pine", "TST", LEVELS)
    assert body.startswith("//@version=5") and 'indicator("UCT levels TST", overlay=true)' in body
    assert body.count("hline(") == 3 and 'hline(105.00, "Call Wall"' in body
    assert "left out: Put Wall" in body


def test_thinkscript_has_one_plot_per_level():
    body = lf.render("thinkscript", "TST", LEVELS)
    assert body.count("plot L") == 3 and "plot L1_CallWall = 105.00;" in body


def test_labels_are_sanitised_inside_script_strings():
    bad = {**LEVELS, "levels": [{"id": "call_wall", "label": 'Wall"); alert("x', "value": 1.0, "unit": "strike"}]}
    assert '"' not in lf.render("pine", "TST", bad).split("hline(")[1].split(",")[1].strip('" ')


def test_level_files_route_downloads_and_probes(monkeypatch):
    monkeypatch.setenv("OPTIONS_LEVEL_FILES_ENABLED", "1")
    c = _client(PAID, monkeypatch)
    probe = c.get("/api/options/positioning/TST/level-files").json()
    assert [f["id"] for f in probe["formats"]] == ["pine", "thinkscript", "csv"]
    r = c.get("/api/options/positioning/TST/level-files?format=pine")
    assert r.status_code == 200 and "attachment" in r.headers["content-disposition"]
    assert ".pine" in r.headers["content-disposition"] and "hline(105.00" in r.text
    r = c.get("/api/options/positioning/TST/level-files?format=csv")
    assert r.headers["content-type"].startswith("text/csv") and "price,label" in r.text
    assert c.get("/api/options/positioning/TST/level-files?format=exe").status_code == 422

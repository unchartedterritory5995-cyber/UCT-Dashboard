"""Real-user speed beacon (desktop speed plan 10.1): api/services/perf_beacon.py + its router."""
from __future__ import annotations

import json
import re
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw
from api.services import perf_beacon as pb


@pytest.fixture
def store(tmp_path, monkeypatch):
    path = tmp_path / "perf.db"
    monkeypatch.setenv("PERF_BEACON_DB_PATH", str(path))
    monkeypatch.delenv(pb.KILL_SWITCH, raising=False)
    monkeypatch.setattr(pb, "_last_prune", 0.0)
    return path


def _report(**over):
    r = {"page": "/charts", "client": "browser", "ttfb": 120, "fcp": 600, "lcp": 900, "dom_ready": 700,
         "load": 1500, "long_task_ms": 80, "long_tasks": 2, "candles": 640,
         "api": [{"route": "/api/bars", "ms": 140, "ok": True}, {"route": "/api/breadth-monitor/session", "ms": 60, "ok": False}]}
    r.update(over)
    return r


def _rows(path, table="perf_loads"):
    if not path.exists():
        return []  # a refused report never opens the store
    conn = sqlite3.connect(path)
    try:
        conn.row_factory = sqlite3.Row
        return [dict(r) for r in conn.execute(f"SELECT * FROM {table}")]
    finally:
        conn.close()


def test_a_valid_report_is_stored_with_country_and_no_ip(store):
    assert pb.record(_report(), ip="203.0.113.9", country_header="us") == {"stored": 1, "dropped": 0, "invalid": 0}
    (row,) = _rows(store)
    assert row["page"] == "/charts" and row["client"] == "browser" and row["country"] == "US" and row["lcp"] == 900
    assert "203.0.113.9" not in str(row) and len(row["rate_key"]) == 24
    assert [(a["route"], a["ms"], a["ok"]) for a in _rows(store, "perf_api")] == [("/api/bars", 140, 1), ("/api/breadth-monitor/session", 60, 0)]


@pytest.mark.parametrize("bad", [
    {"page": "/charts/NVDA"},              # more than the first segment
    {"page": "/charts?sym=NVDA"},
    {"page": "charts"},
    {"client": "safari"},
    {"lcp": -1}, {"lcp": 10 ** 9}, {"lcp": "900"}, {"lcp": True}, {"lcp": float("nan")},
    {"api": [{"route": "/api/bars/NVDA", "ms": 1, "ok": True}]},              # a ticker in the path
    {"api": [{"route": "/api/j2/notes/123", "ms": 1, "ok": True}]},           # an id / third segment
    {"api": [{"route": "/api/j2/a1b2c3", "ms": 1, "ok": True}]},              # digits in the second segment
    {"api": [{"route": "https://evil.example/api/x", "ms": 1, "ok": True}]},
    {"api": [{"route": "/api/bars", "ms": 1, "ok": "yes"}]},
    {"api": [{"route": "/api/bars", "ms": 1, "ok": True}] * (pb.MAX_API + 1)},
])
def test_anything_but_numbers_and_enums_is_refused_not_cleaned(store, bad):
    assert pb.record(_report(**bad), ip="1.1.1.1", country_header="US")["invalid"] == 1
    assert _rows(store) == []


def test_country_comes_only_from_the_header_and_only_as_two_letters(store):
    pb.record(_report(country="FR"), ip="1.1.1.1", country_header="not-a-country")
    assert _rows(store)[0]["country"] == ""


def test_rate_limit_per_ip_is_counted_from_the_store(store):
    now = time.time()
    for _ in range(pb.RATE_LIMIT):
        assert pb.record(_report(), ip="9.9.9.9", country_header="US", now=now)["stored"] == 1
    assert pb.record(_report(), ip="9.9.9.9", country_header="US", now=now)["dropped"] == 1
    assert pb.record(_report(), ip="8.8.8.8", country_header="US", now=now)["stored"] == 1
    assert pb.record(_report(), ip="9.9.9.9", country_header="US", now=now + 3601)["stored"] == 1


def test_row_ceiling_deletes_the_oldest_with_their_api_rows(store, monkeypatch):
    monkeypatch.setattr(pb, "MAX_LOADS", 3)
    for i in range(5):
        pb.record(_report(ttfb=i), ip=f"10.0.0.{i}", country_header="US")
    rows = _rows(store)
    assert [r["ttfb"] for r in rows] == [2, 3, 4]
    assert len(_rows(store, "perf_api")) == 3 * 2


def test_retention_prunes_old_loads(store):
    old = time.time() - (pb.RETENTION_DAYS + 1) * 86400
    pb.record(_report(), ip="1.1.1.1", country_header="US", now=old)
    pb._last_prune = 0.0
    pb.record(_report(), ip="2.2.2.2", country_header="US")
    assert len(_rows(store)) == 1


def test_summary_percentiles_by_page_route_and_country(store):
    now = time.time()
    for i, lcp in enumerate([100, 200, 300, 400]):
        pb.record(_report(lcp=lcp), ip=f"10.0.1.{i}", country_header="US", now=now)
    pb.record(_report(page="/dashboard", client="desktop", lcp=5000), ip="10.0.2.1", country_header="CA", now=now)
    s = pb.summary(24, now=now + 1)
    assert s["loads"] == 5
    charts = next(p for p in s["pages"] if p["page"] == "/charts")
    assert charts["client"] == "browser" and charts["loads"] == 4
    assert charts["lcp"] == {"p50": 200, "p75": 300, "p95": 400}
    bars = next(a for a in s["api"] if a["route"] == "/api/bars")
    assert bars["calls"] == 5 and bars["failed_pct"] == 0.0
    breadth = next(a for a in s["api"] if a["route"] == "/api/breadth-monitor/session")
    assert breadth["failed_pct"] == 100.0
    assert s["countries"][0] == {"country": "US", "loads": 4, "lcp_p75": 300}


@pytest.fixture
def client(store):
    from api.routers import perf_beacon as router_mod
    app = FastAPI()
    app.include_router(router_mod.router)
    return app, TestClient(app)


def test_the_door_takes_anonymous_reports_and_reads_the_cloudflare_country(client, store):
    _, c = client
    r = c.post("/api/perf/beacon", json=_report(), headers={"CF-IPCountry": "US"})
    assert r.status_code == 200 and r.json() == {"ok": True, "enabled": True, "stored": 1, "dropped": 0, "invalid": 0}
    assert _rows(store)[0]["country"] == "US"


def test_the_kill_switch_stores_nothing_and_tells_the_page_to_stop(client, store, monkeypatch):
    _, c = client
    monkeypatch.setenv(pb.KILL_SWITCH, "0")
    assert c.post("/api/perf/beacon", json=_report()).json() == {"ok": True, "enabled": False}
    assert not store.exists() or _rows(store) == []


def test_oversized_and_unreadable_bodies_are_refused(client):
    _, c = client
    assert c.post("/api/perf/beacon", content=b"x" * (pb.MAX_BODY_BYTES + 1)).status_code == 413
    assert c.post("/api/perf/beacon", content=b"{not json").status_code == 400


def test_the_admin_read_needs_an_admin(client, store):
    app, c = client
    assert c.get("/api/admin/perf").status_code in (401, 403)
    app.dependency_overrides[authmw.require_admin] = lambda: {"id": "admin", "role": "admin"}
    pb.record(_report(), ip="1.1.1.1", country_header="US")
    assert c.get("/api/admin/perf").json()["loads"] == 1


def test_time_to_first_candles_is_stored_summarised_and_optional(store):
    now = time.time()
    for i, c in enumerate([500, 600, 700]):
        pb.record(_report(candles=c), ip=f"10.0.3.{i}", country_header="US", now=now)
    no_chart = _report(page="/journal")
    del no_chart["candles"]
    assert pb.record(no_chart, ip="10.0.3.9", country_header="US", now=now)["stored"] == 1
    s = pb.summary(now=now + 1)
    charts = next(p for p in s["pages"] if p["page"] == "/charts")
    assert charts["candles"] == {"p50": 600, "p75": 700, "p95": 700}
    journal = next(p for p in s["pages"] if p["page"] == "/journal")
    assert journal["candles"] == {"p50": None, "p75": None, "p95": None}


def test_a_store_from_before_candles_gains_the_column_and_keeps_its_rows(store, monkeypatch):
    conn = sqlite3.connect(store)
    conn.executescript(pb._SCHEMA.replace(" candles INTEGER,", ""))
    conn.execute("INSERT INTO perf_loads (created_at,page,client,lcp,rate_key) VALUES (?,?,?,?,?)", (time.time(), "/charts", "browser", 900, "k"))
    conn.commit()
    conn.close()
    assert "candles" not in {r[1] for r in sqlite3.connect(store).execute("PRAGMA table_info(perf_loads)")}
    monkeypatch.setattr(pb, "_migrated", set())
    assert pb.record(_report(candles=432), ip="10.0.4.1", country_header="US")["stored"] == 1
    rows = _rows(store)
    assert [r["candles"] for r in rows] == [None, 432] and rows[0]["lcp"] == 900


# ── chart-switch speed: the `kind: "switches"` report (the field instrument, 2026-11-23) ─────────────────────
# The page counts key-press-to-frame times into fixed buckets (app/src/lib/switchSpeed.js) and sends the COUNTS.
# Integers only; anything else refuses the whole report; what is kept is a per-day merge, never a report.

# 2026-11-19 03:30 UTC is 22:30 on the 18th in New York: the day a report is merged under is the ET one.
_T = datetime(2026, 11, 19, 3, 30, tzinfo=timezone.utc).timestamp()
_ALL_UNDER = [2, 14, 9, 3, 0, 0, 0, 0, 0, 0, 0]        # 28 switches, every one under 40 ms
_SOME_OVER = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2]         # 3 switches, two of them 500 ms or more


def _cell(tf=0, store=1, trig=0, route=1, rth=1, counts=None):
    return [tf, store, trig, route, rth, *(_ALL_UNDER if counts is None else counts)]


def _switch_report(cells=None, counters=None, **over):
    r = {"page": "/charts", "client": "desktop", "kind": "switches",
         "switches": {"v": 1, "cells": [_cell()] if cells is None else cells,
                      "counters": [4, 0, 2, 0, 0, 0] if counters is None else counters}}
    r.update(over)
    return r


def _distinct_cells(n):
    """n different combinations (n <= 144), one switch each."""
    return [_cell(tf=i % 3, store=(i // 3) % 2, trig=(i // 6) % 4, route=(i // 24) % 6, rth=0, counts=[1] + [0] * 10)
            for i in range(n)]


def test_switch_reports_merge_into_one_row_per_day_and_combination_and_write_no_page_load(store):
    assert pb.record(_switch_report(), ip="203.0.113.9", country_header="US", now=_T) == {"stored": 1, "dropped": 0, "invalid": 0}
    second = _switch_report(cells=[_cell(counts=_SOME_OVER)], counters=[1, 0, 0, 0, 0, 0])
    assert pb.record(second, ip="203.0.113.10", country_header="US", now=_T + 60)["stored"] == 1
    assert _rows(store) == [] and _rows(store, "perf_api") == []          # no page-load row
    assert pb.summary(24, now=_T + 120)["loads"] == 0
    (row,) = _rows(store, "perf_switch_days")
    assert (row["day"], row["client"]) == ("2026-11-18", "desktop")       # the ET day, not the UTC one
    assert [row[f"b{i}"] for i in range(11)] == [3, 14, 9, 3, 0, 0, 0, 0, 0, 0, 2]
    assert (row["reports"], row["reports_all_under"]) == (2, 1)
    assert {(r["name"], r["n"]) for r in _rows(store, "perf_switch_counters")} == {("superseded", 5), ("unpressed", 2)}


def test_the_switch_read_gives_each_combination_its_histogram_and_share_under_40_per_day(store):
    pb.record(_switch_report(), ip="10.1.0.1", country_header="US", now=_T)
    pb.record(_switch_report(cells=[_cell(counts=_SOME_OVER)], counters=[1, 0, 0, 0, 0, 0]), ip="10.1.0.2", country_header="US", now=_T + 60)
    # the next ET day, another combination, from a browser
    pb.record(_switch_report(cells=[_cell(tf=2, store=0, trig=2, route=5, rth=0, counts=[0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0])],
                             counters=[0, 0, 0, 0, 0, 0], client="browser"), ip="10.1.0.3", country_header="US", now=_T + 86400)
    s = pb.switch_summary(7, now=_T + 86400 + 60)
    assert s["bucket_edges_ms"] == [16, 25, 33, 40, 50, 66, 100, 150, 250, 500] and s["under_ms"] == 40
    assert s["cells"] == [
        {"day": "2026-11-19", "client": "browser", "tf": "daily-plus", "store": False, "trigger": "typed", "route": "prepare",
         "rth": False, "n": [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0], "switches": 1, "under_40": 0, "under_40_pct": 0.0,
         "reports": 1, "reports_all_under_40": 0},
        {"day": "2026-11-18", "client": "desktop", "tf": "intraday-1m", "store": True, "trigger": "list-key", "route": "decision",
         "rth": True, "n": [3, 14, 9, 3, 0, 0, 0, 0, 0, 0, 2], "switches": 31, "under_40": 29, "under_40_pct": 93.5,
         "reports": 2, "reports_all_under_40": 1},
    ]
    assert s["by_day"] == [
        {"day": "2026-11-19", "switches": 1, "under_40": 0, "under_40_pct": 0.0,
         "superseded": 0, "abandoned": 0, "unpressed": 0, "untracked": 0, "unclocked": 0, "overflow": 0},
        {"day": "2026-11-18", "switches": 31, "under_40": 29, "under_40_pct": 93.5,
         "superseded": 5, "abandoned": 0, "unpressed": 2, "untracked": 0, "unclocked": 0, "overflow": 0},
    ]
    # the window is counted in ET days, today included
    assert [c["day"] for c in pb.switch_summary(1, now=_T + 86400 + 60)["cells"]] == ["2026-11-19"]


def test_a_sample_of_exactly_40_ms_is_not_under_40(store):
    # the bucket edges are lower bounds: 33-40 is the last bucket under, 40-50 the first one not
    pb.record(_switch_report(cells=[_cell(counts=[0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0])], counters=[0] * 6), ip="10.2.0.1", country_header="US", now=_T)
    (cell,) = pb.switch_summary(1, now=_T)["cells"]
    assert (cell["switches"], cell["under_40"], cell["under_40_pct"], cell["reports_all_under_40"]) == (2, 1, 50.0, 0)


def test_the_switch_store_holds_whole_numbers_a_day_and_fixed_names_only(store):
    pb.record(_switch_report(), ip="203.0.113.9", country_header="US", now=_T)
    conn = sqlite3.connect(store)
    try:
        cols = {t: {r[1]: r[2].upper() for r in conn.execute(f"PRAGMA table_info({t})")}
                for t in ("perf_switch_days", "perf_switch_counters", "perf_switch_sends")}
        dump = "\n".join(str(r) for t in cols for r in conn.execute(f"SELECT * FROM {t}"))
    finally:
        conn.close()
    assert sorted(c for c, t in cols["perf_switch_days"].items() if t != "INTEGER") == ["client", "day"]
    assert sorted(c for c, t in cols["perf_switch_counters"].items() if t != "INTEGER") == ["client", "day", "name"]
    assert set(cols["perf_switch_sends"]) == {"created_at", "rate_key"}       # a time and the salted hash, for the quota
    assert "203.0.113.9" not in dump and "/charts" not in dump
    assert {r["name"] for r in _rows(store, "perf_switch_counters")} <= set(pb.SWITCH_COUNTERS)


_BAD_SWITCHES = [
    ("an unknown key inside switches", lambda r: r["switches"].update(sym="NVDA")),
    ("an unknown key beside it", lambda r: r.update(ticker="NVDA")),
    ("a string where a count belongs", lambda r: r["switches"]["cells"][0].__setitem__(7, "3")),
    ("a name where an index belongs", lambda r: r["switches"]["cells"][0].__setitem__(0, "intraday-1m")),
    ("a fraction", lambda r: r["switches"]["cells"][0].__setitem__(7, 2.5)),
    ("a whole number written as a float", lambda r: r["switches"]["cells"][0].__setitem__(7, 3.0)),
    ("a bool", lambda r: r["switches"]["cells"][0].__setitem__(7, True)),
    ("a negative count", lambda r: r["switches"]["cells"][0].__setitem__(7, -1)),
    ("a too-large count", lambda r: r["switches"]["cells"][0].__setitem__(7, pb.MAX_SWITCH_COUNT + 1)),
    ("too many cells", lambda r: r["switches"].__setitem__("cells", _distinct_cells(pb.MAX_SWITCH_CELLS + 1))),
    ("a short cell", lambda r: r["switches"]["cells"][0].pop()),
    ("a long cell", lambda r: r["switches"]["cells"][0].append(0)),
    ("a timeframe class outside the list", lambda r: r["switches"]["cells"][0].__setitem__(0, len(pb.SWITCH_TF))),
    ("a store flag that is not 0 or 1", lambda r: r["switches"]["cells"][0].__setitem__(1, 2)),
    ("a trigger outside the list", lambda r: r["switches"]["cells"][0].__setitem__(2, len(pb.SWITCH_TRIGGER))),
    ("a route outside the list", lambda r: r["switches"]["cells"][0].__setitem__(3, len(pb.SWITCH_ROUTE))),
    ("a session flag that is not 0 or 1", lambda r: r["switches"]["cells"][0].__setitem__(4, 2)),
    ("one combination twice", lambda r: r["switches"]["cells"].append(_cell())),
    ("a cell of zeros", lambda r: r["switches"].__setitem__("cells", [_cell(counts=[0] * 11)])),
    ("a cell that is an object", lambda r: r["switches"].__setitem__("cells", [{"tf": 0}])),
    ("cells that are not a list", lambda r: r["switches"].__setitem__("cells", {"0": _cell()})),
    ("another version", lambda r: r["switches"].__setitem__("v", 2)),
    ("the version as a string", lambda r: r["switches"].__setitem__("v", "1")),
    ("no version", lambda r: r["switches"].pop("v")),
    ("too few counters", lambda r: r["switches"]["counters"].pop()),
    ("too many counters", lambda r: r["switches"]["counters"].append(0)),
    ("a string counter", lambda r: r["switches"]["counters"].__setitem__(0, "many")),
    ("a too-large counter", lambda r: r["switches"]["counters"].__setitem__(0, pb.MAX_SWITCH_COUNT + 1)),
    ("nothing counted at all", lambda r: r["switches"].update(cells=[], counters=[0] * 6)),
    ("switches that are a list", lambda r: r.__setitem__("switches", [1])),
    ("no switches", lambda r: r.pop("switches")),
    ("an unknown kind", lambda r: r.__setitem__("kind", "switch")),
    ("a kind that is not a string", lambda r: r.__setitem__("kind", 1)),
    ("a page with a ticker in it", lambda r: r.__setitem__("page", "/charts/NVDA")),
    ("an unknown client", lambda r: r.__setitem__("client", "safari")),
]


@pytest.mark.parametrize("why,mutate", _BAD_SWITCHES, ids=[w.replace(" ", "-") for w, _ in _BAD_SWITCHES])
def test_a_malformed_switches_report_is_refused_whole(store, why, mutate):
    r = _switch_report()
    mutate(r)
    assert pb.record(r, ip="1.1.1.1", country_header="US", now=_T) == {"stored": 0, "dropped": 0, "invalid": 1}, why
    assert not store.exists() or (_rows(store, "perf_switch_days") == [] and _rows(store) == []), why


def test_the_most_a_page_may_send_is_accepted_and_fits_the_body_limit(store):
    # control for "too many cells" and "a too-large count": one fewer / the largest itself is stored
    cells = [c[:5] + [pb.MAX_SWITCH_COUNT] * 11 for c in _distinct_cells(pb.MAX_SWITCH_CELLS)]
    biggest = _switch_report(cells=cells, counters=[pb.MAX_SWITCH_COUNT] * len(pb.SWITCH_COUNTERS))
    assert len(json.dumps(biggest, separators=(",", ":")).encode()) <= pb.MAX_BODY_BYTES
    assert pb.record(biggest, ip="1.1.1.1", country_header="US", now=_T)["stored"] == 1
    assert len(_rows(store, "perf_switch_days")) == pb.MAX_SWITCH_CELLS


def test_a_report_of_counters_alone_is_stored(store):
    # a page whose switches were all superseded (a held arrow that never landed in time) still says so
    assert pb.record(_switch_report(cells=[], counters=[7, 0, 0, 0, 0, 0]), ip="1.1.1.1", country_header="US", now=_T)["stored"] == 1
    assert pb.switch_summary(1, now=_T)["by_day"][0]["superseded"] == 7


def test_a_page_load_report_is_stored_as_before_and_an_unknown_kind_refuses_it(store):
    assert pb.record(_report(kind="load"), ip="1.1.1.1", country_header="US")["stored"] == 1
    assert pb.record(_report(kind="pageload"), ip="1.1.1.2", country_header="US")["invalid"] == 1
    assert len(_rows(store)) == 1 and _rows(store, "perf_switch_days") == []


def test_switch_reports_have_their_own_hourly_quota_per_ip_hash(store):
    for _ in range(pb.SWITCH_RATE_LIMIT):
        assert pb.record(_switch_report(), ip="9.9.9.9", country_header="US", now=_T)["stored"] == 1
    assert pb.record(_switch_report(), ip="9.9.9.9", country_header="US", now=_T) == {"stored": 0, "dropped": 1, "invalid": 0}
    assert pb.record(_switch_report(), ip="8.8.8.8", country_header="US", now=_T)["stored"] == 1
    assert pb.record(_report(), ip="9.9.9.9", country_header="US", now=_T)["stored"] == 1      # the page-load quota is its own
    assert pb.record(_switch_report(), ip="9.9.9.9", country_header="US", now=_T + 3601)["stored"] == 1
    (row,) = _rows(store, "perf_switch_days")
    assert row["reports"] == pb.SWITCH_RATE_LIMIT + 2                       # the dropped one added nothing
    assert len(_rows(store, "perf_switch_sends")) == 1                      # the hour-old quota rows are gone


def test_switch_days_older_than_their_retention_are_pruned(store):
    old = _T - (pb.SWITCH_RETENTION_DAYS + 2) * 86400
    pb.record(_switch_report(), ip="1.1.1.1", country_header="US", now=old)
    pb._last_prune = 0.0
    pb.record(_switch_report(), ip="2.2.2.2", country_header="US", now=_T)
    assert [r["day"] for r in _rows(store, "perf_switch_days")] == ["2026-11-18"]
    assert {r["day"] for r in _rows(store, "perf_switch_counters")} == {"2026-11-18"}


def test_the_door_takes_a_switches_report_and_the_kill_switch_stores_none(client, store, monkeypatch):
    _, c = client
    r = c.post("/api/perf/beacon", json=_switch_report(), headers={"CF-IPCountry": "US"})
    assert r.status_code == 200 and r.json() == {"ok": True, "enabled": True, "stored": 1, "dropped": 0, "invalid": 0}
    assert c.post("/api/perf/beacon", json=_switch_report(kind="switch")).json()["invalid"] == 1
    monkeypatch.setenv(pb.KILL_SWITCH, "0")
    assert c.post("/api/perf/beacon", json=_switch_report()).json() == {"ok": True, "enabled": False}
    assert [r["reports"] for r in _rows(store, "perf_switch_days")] == [1]


def test_the_admin_read_carries_the_switch_histograms(client, store):
    app, c = client
    app.dependency_overrides[authmw.require_admin] = lambda: {"id": "admin", "role": "admin"}
    c.post("/api/perf/beacon", json=_switch_report())
    c.post("/api/perf/beacon", json=_report())
    body = c.get("/api/admin/perf?switch_days=2").json()
    assert body["loads"] == 1                                              # the page-load read is what it was
    sw = body["switches"]
    (cell,) = sw["cells"]
    (day,) = sw["by_day"]
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", cell["day"]) and day["day"] == cell["day"]
    assert (cell["tf"], cell["trigger"], cell["route"], cell["store"], cell["rth"]) == ("intraday-1m", "list-key", "decision", True, True)
    assert (cell["switches"], cell["under_40_pct"], day["superseded"]) == (28, 100.0, 4)
    assert c.get("/api/admin/perf?switch_days=0").status_code == 422
    assert c.get(f"/api/admin/perf?switch_days={pb.SWITCH_RETENTION_DAYS + 1}").status_code == 422


def test_the_servers_switch_lists_are_the_pages_own():
    # app/src/lib/switchSpeed.js counts by INDEX into these lists, and the server names the indexes: one moved or
    # reordered on either side alone would file every switch under another name, silently.
    src = (Path(__file__).resolve().parents[1] / "app" / "src" / "lib" / "switchSpeed.js").read_text(encoding="utf-8")

    def js(name):
        m = re.search(rf"^export const {name} = (.+?)\s*$", src, re.M)
        assert m, f"{name} is not declared on one line in switchSpeed.js"
        return json.loads(m.group(1).replace("'", '"'))

    assert tuple(js("SWITCH_TF")) == pb.SWITCH_TF
    assert tuple(js("SWITCH_TRIGGER")) == pb.SWITCH_TRIGGER
    assert tuple(js("SWITCH_ROUTE")) == pb.SWITCH_ROUTE
    assert tuple(js("SWITCH_COUNTERS")) == pb.SWITCH_COUNTERS
    assert tuple(js("SWITCH_BUCKET_EDGES_MS")) == pb.SWITCH_BUCKET_EDGES_MS
    assert js("SWITCH_UNDER_MS") == pb.SWITCH_UNDER_MS and pb.SWITCH_UNDER_MS in pb.SWITCH_BUCKET_EDGES_MS
    assert js("SWITCH_VERSION") == pb.SWITCH_VERSION
    assert js("MAX_SWITCH_CELLS") == pb.MAX_SWITCH_CELLS
    assert js("MAX_SWITCH_COUNT") == pb.MAX_SWITCH_COUNT

"""Real-user speed beacon (desktop speed plan 10.1): api/services/perf_beacon.py + its router."""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import sqlite3
import tempfile
import threading
import time
from contextlib import contextmanager
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
    monkeypatch.setattr(pb, "_keys", {}, raising=False)       # a fresh process: no key in memory yet
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
    assert "203.0.113.9" not in str(row) and row["rate_key"] == ""      # a page-load row holds nothing derived from the IP
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
                      "counters": [4, 0, 2, 0, 0, 0, 0] if counters is None else counters}}
    r.update(over)
    return r


def _distinct_cells(n):
    """n different combinations (n <= 144), one switch each."""
    return [_cell(tf=i % 3, store=(i // 3) % 2, trig=(i // 6) % 4, route=(i // 24) % 6, rth=0, counts=[1] + [0] * 10)
            for i in range(n)]


def test_switch_reports_merge_into_one_row_per_day_and_combination_and_write_no_page_load(store):
    assert pb.record(_switch_report(), ip="203.0.113.9", country_header="US", now=_T) == {"stored": 1, "dropped": 0, "invalid": 0}
    second = _switch_report(cells=[_cell(counts=_SOME_OVER)], counters=[1, 0, 0, 0, 0, 0, 0])
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
    pb.record(_switch_report(cells=[_cell(counts=_SOME_OVER)], counters=[1, 0, 0, 0, 0, 0, 0]), ip="10.1.0.2", country_header="US", now=_T + 60)
    # the next ET day, another combination, from a browser
    pb.record(_switch_report(cells=[_cell(tf=2, store=0, trig=2, route=5, rth=0, counts=[0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0])],
                             counters=[0, 0, 0, 0, 0, 0, 0], client="browser"), ip="10.1.0.3", country_header="US", now=_T + 86400)
    s = pb.switch_summary(7, now=_T + 86400 + 60)
    assert s["bucket_edges_ms"] == [16, 25, 33, 40, 50, 66, 100, 150, 250, 500] and s["under_ms"] == 40
    assert s["cells"] == [
        {"day": "2026-11-19", "client": "browser", "tf": "daily-plus", "store": False, "trigger": "typed", "route": "prepare",
         "rth": False, "n": [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0], "switches": 1, "under_40": 0, "under_40_pct": 0.0,
         "reports": 1, "reports_all_under_40": 0, "senders": 1},
        {"day": "2026-11-18", "client": "desktop", "tf": "intraday-1m", "store": True, "trigger": "list-key", "route": "decision",
         "rth": True, "n": [3, 14, 9, 3, 0, 0, 0, 0, 0, 0, 2], "switches": 31, "under_40": 29, "under_40_pct": 93.5,
         "reports": 2, "reports_all_under_40": 1, "senders": 2},
    ]
    assert s["by_day"] == [
        {"day": "2026-11-19", "switches": 1, "under_40": 0, "under_40_pct": 0.0,
         "superseded": 0, "abandoned": 0, "unpressed": 0, "untracked": 0, "unclocked": 0, "overflow": 0, "released": 0},
        {"day": "2026-11-18", "switches": 31, "under_40": 29, "under_40_pct": 93.5,
         "superseded": 5, "abandoned": 0, "unpressed": 2, "untracked": 0, "unclocked": 0, "overflow": 0, "released": 0},
    ]
    # the window is counted in ET days, today included
    assert [c["day"] for c in pb.switch_summary(1, now=_T + 86400 + 60)["cells"]] == ["2026-11-19"]


def test_a_sample_of_exactly_40_ms_is_not_under_40(store):
    # the bucket edges are lower bounds: 33-40 is the last bucket under, 40-50 the first one not
    pb.record(_switch_report(cells=[_cell(counts=[0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0])], counters=[0] * 7), ip="10.2.0.1", country_header="US", now=_T)
    (cell,) = pb.switch_summary(1, now=_T)["cells"]
    assert (cell["switches"], cell["under_40"], cell["under_40_pct"], cell["reports_all_under_40"]) == (2, 1, 50.0, 0)


def test_the_switch_store_holds_whole_numbers_a_day_and_fixed_names_only(store):
    pb.record(_switch_report(), ip="203.0.113.9", country_header="US", now=_T)
    conn = sqlite3.connect(store)
    try:
        cols = {t: {r[1]: r[2].upper() for r in conn.execute(f"PRAGMA table_info({t})")}
                for t in ("perf_switch_days", "perf_switch_counters", "perf_switch_sends", "perf_switch_senders", "perf_load_sends")}
        dump = "\n".join(str(r) for t in cols for r in conn.execute(f"SELECT * FROM {t}"))
    finally:
        conn.close()
    assert sorted(c for c, t in cols["perf_switch_days"].items() if t != "INTEGER") == ["client", "day"]
    assert sorted(c for c, t in cols["perf_switch_counters"].items() if t != "INTEGER") == ["client", "day", "name"]
    # for the quota: a time, the salted hash and how many switches the report held (kept one hour)
    assert set(cols["perf_switch_sends"]) == {"created_at", "rate_key", "switches"}
    assert set(cols["perf_load_sends"]) == {"created_at", "rate_key"}         # the page-load quota: the same, kept one hour
    # to count a day's DISTINCT senders per cell: a hash salted with the day (kept until the day is over)
    assert sorted(c for c, t in cols["perf_switch_senders"].items() if t != "INTEGER") == ["client", "day", "sender"]
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
    # every count is within its own bound; together they are one more switch than a page can make between two sends
    ("more switches in all than a page can make", lambda r: r["switches"].__setitem__("cells", [
        _cell(counts=[pb.MAX_SWITCH_TOTAL] + [0] * 10), _cell(tf=1, counts=[1] + [0] * 10)])),
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
    ("nothing counted at all", lambda r: r["switches"].update(cells=[], counters=[0] * 7)),
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
    # control for "too many cells", "a too-large counter" and "more switches in all": the largest itself is stored
    each = pb.MAX_SWITCH_TOTAL // (pb.MAX_SWITCH_CELLS * 11)
    cells = [c[:5] + [each] * 11 for c in _distinct_cells(pb.MAX_SWITCH_CELLS)]
    cells[0][5] += pb.MAX_SWITCH_TOTAL - each * 11 * pb.MAX_SWITCH_CELLS          # exactly the total, not one under
    assert sum(sum(c[5:]) for c in cells) == pb.MAX_SWITCH_TOTAL
    biggest = _switch_report(cells=cells, counters=[pb.MAX_SWITCH_COUNT] * len(pb.SWITCH_COUNTERS))
    assert pb.record(biggest, ip="1.1.1.1", country_header="US", now=_T)["stored"] == 1
    assert len(_rows(store, "perf_switch_days")) == pb.MAX_SWITCH_CELLS
    # ...and the longest body a legal report can be (every count at the total's digits) is inside the door's limit
    widest = _switch_report(cells=[c[:5] + [pb.MAX_SWITCH_TOTAL] * 11 for c in cells], counters=[pb.MAX_SWITCH_COUNT] * len(pb.SWITCH_COUNTERS))
    assert len(json.dumps(widest, separators=(",", ":")).encode()) <= pb.MAX_BODY_BYTES


def test_a_report_of_counters_alone_is_stored(store):
    # a page whose switches were all superseded (a held arrow that never landed in time) still says so
    assert pb.record(_switch_report(cells=[], counters=[7, 0, 0, 0, 0, 0, 0]), ip="1.1.1.1", country_header="US", now=_T)["stored"] == 1
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
    assert cell["senders"] == 1 and "pop-out" in " ".join(sw["legend"]["not_sampled"])
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
    assert tuple(js("SWITCH_TRIGGER")) == pb.SWITCH_TRIGGER == ("list-key", "click", "typed", "other")
    assert tuple(js("SWITCH_ROUTE")) == pb.SWITCH_ROUTE
    assert tuple(js("SWITCH_COUNTERS")) == pb.SWITCH_COUNTERS
    assert pb.SWITCH_COUNTERS[-1] == "released"       # appended: the six before it keep their places
    assert tuple(js("SWITCH_BUCKET_EDGES_MS")) == pb.SWITCH_BUCKET_EDGES_MS
    assert js("SWITCH_UNDER_MS") == pb.SWITCH_UNDER_MS and pb.SWITCH_UNDER_MS in pb.SWITCH_BUCKET_EDGES_MS
    assert js("SWITCH_VERSION") == pb.SWITCH_VERSION
    assert js("MAX_SWITCH_CELLS") == pb.MAX_SWITCH_CELLS
    assert js("MAX_SWITCH_COUNT") == pb.MAX_SWITCH_COUNT
    assert js("MAX_SWITCH_TOTAL") == pb.MAX_SWITCH_TOTAL <= pb.MAX_SWITCH_COUNT


# ── review of #2641: one sender cannot be the pool, and the read says what a name means ─────────────────────

def _one(n, **cell):
    """A report of n switches in one cell, nothing else."""
    return _switch_report(cells=[_cell(counts=[n] + [0] * 10, **cell)], counters=[0] * 7)


def test_one_sender_cannot_add_more_switches_in_an_hour_than_a_real_page_makes(store):
    cap = pb.SWITCH_TOTAL_PER_HOUR
    assert pb.MAX_SWITCH_TOTAL <= cap <= 2 * 3000 + 1, "about twice what a page can make in an hour (one every 1.2 s), and never under one legal report"
    assert pb.record(_one(cap // 2), ip="9.9.9.9", country_header="US", now=_T)["stored"] == 1
    assert pb.record(_one(cap - cap // 2), ip="9.9.9.9", country_header="US", now=_T + 60)["stored"] == 1      # exactly the cap
    assert pb.record(_one(1), ip="9.9.9.9", country_header="US", now=_T + 120) == {"stored": 0, "dropped": 1, "invalid": 0}
    assert pb.record(_one(1), ip="8.8.8.8", country_header="US", now=_T + 120)["stored"] == 1                 # another sender is not held back
    assert pb.record(_one(1), ip="9.9.9.9", country_header="US", now=_T + 3661)["stored"] == 1                # an hour later: both big ones have aged out
    (row,) = _rows(store, "perf_switch_days")
    assert row["b0"] == cap + 2 and row["reports"] == 4                                                       # the dropped report added nothing


def test_distinct_senders_per_day_and_cell_show_when_one_page_is_the_pool(store):
    for i in range(3):                                                    # one sender, three reports
        pb.record(_switch_report(), ip="10.9.0.1", country_header="US", now=_T + i)
    pb.record(_switch_report(), ip="10.9.0.2", country_header="US", now=_T + 10)
    pb.record(_one(1, tf=2), ip="10.9.0.1", country_header="US", now=_T + 20)                                 # the same sender, another cell
    cells = {c["tf"]: c for c in pb.switch_summary(1, now=_T + 30)["cells"]}
    assert (cells["intraday-1m"]["reports"], cells["intraday-1m"]["senders"]) == (4, 2)
    assert (cells["daily-plus"]["reports"], cells["daily-plus"]["senders"]) == (1, 1)
    # the next ET day the same sender counts again for THAT day; yesterday's count stays, yesterday's hashes do not
    pb._last_prune = 0.0
    pb.record(_switch_report(), ip="10.9.0.1", country_header="US", now=_T + 86400)
    s = pb.switch_summary(2, now=_T + 86400 + 1)
    assert [(c["day"], c["tf"], c["senders"]) for c in s["cells"]] == [
        ("2026-11-19", "intraday-1m", 1), ("2026-11-18", "intraday-1m", 2), ("2026-11-18", "daily-plus", 1)]
    kept = _rows(store, "perf_switch_senders")
    assert {r["day"] for r in kept} == {"2026-11-19"} and "10.9.0.1" not in str(kept)
    # a day's hash is its own: the same sender on two days cannot be joined through it
    pb.record(_switch_report(), ip="10.9.0.1", country_header="US", now=_T + 86400 + 5)
    assert len(_rows(store, "perf_switch_senders")) == 1
    assert pb._sender_key("10.9.0.1", "2026-11-18") != pb._sender_key("10.9.0.1", "2026-11-19")


def test_the_read_says_what_each_name_means_and_what_is_not_sampled(store):
    legend = pb.switch_summary(1, now=_T)["legend"]
    assert set(legend["tf"]) == set(pb.SWITCH_TF) and set(legend["trigger"]) == set(pb.SWITCH_TRIGGER)
    assert set(legend["route"]) == set(pb.SWITCH_ROUTE) and set(legend["counters"]) == set(pb.SWITCH_COUNTERS)
    assert all(isinstance(v, str) and len(v) > 15 for part in ("tf", "trigger", "route", "counters") for v in legend[part].values())
    assert "any" in legend["trigger"]["click"] and "list" in legend["trigger"]["click"]          # it is not only lists, and says so
    assert "release" in legend["counters"]["released"] and "never timed" in legend["counters"]["released"]
    gaps = " | ".join(legend["not_sampled"])
    assert "pop-out" in gaps and "unpressed" in gaps
    assert isinstance(legend["sample"], str) and isinstance(legend["senders"], str)


# ── review of #2641, round 2: NOTHING DERIVED FROM AN IP UNDER A KEY THE REPO HOLDS, OR PAST ITS USE ─────────
# The quota and the distinct-sender count need "the same sender again", which is a function of the IP. It was a
# SHA-256 under a constant in this public repo: anyone holding a copy of the file could recompute every row over all
# of IPv4 in minutes, and page-load rows kept theirs for 30 days. Now: an HMAC under a random key that exists only in
# the process's memory (an hour's for the quota, an ET day's for the senders), rows deleted when their use is over
# (on a write, on the admin read, and on a timer), and the keys older builds stored blanked at startup.

_IP = "203.0.113.77"
_OLD_SCHEMA = """
CREATE TABLE perf_loads (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at   REAL NOT NULL,
    page         TEXT NOT NULL,
    client       TEXT NOT NULL,
    country      TEXT NOT NULL DEFAULT '',
    ttfb         INTEGER, fcp INTEGER, lcp INTEGER, dom_ready INTEGER, load INTEGER,
    long_task_ms INTEGER, long_tasks INTEGER, candles INTEGER,
    rate_key     TEXT NOT NULL
);
CREATE INDEX ix_perf_loads_created ON perf_loads(created_at);
CREATE INDEX ix_perf_loads_rate ON perf_loads(rate_key, created_at);
CREATE TABLE perf_api (load_id INTEGER NOT NULL REFERENCES perf_loads(id) ON DELETE CASCADE, route TEXT NOT NULL, ms INTEGER NOT NULL, ok INTEGER NOT NULL);
"""


def _old_load_key(ip):
    """What every build before this one stored in perf_loads.rate_key, for 30 days."""
    return hashlib.sha256(f"perf_beacon:{ip}".encode()).hexdigest()[:24]


def _an_older_builds_store(path, n, ip=_IP):
    conn = sqlite3.connect(path)
    try:
        conn.executescript(_OLD_SCHEMA)
        conn.executemany("INSERT INTO perf_loads (created_at,page,client,lcp,rate_key) VALUES (?,?,?,?,?)",
                         [(_T + i, "/charts", "browser", 900 + i, _old_load_key(ip)) for i in range(n)])
        conn.commit()
    finally:
        conn.close()


def _from_the_repo(ip, days):
    """Every value someone holding the REPO could compute from an IP: the address, what older builds stored, and the
    same shapes (a hash, an HMAC) under every string the module spells as a salt, with and without the day."""
    out = {ip}
    for salt in ("perf_beacon", "", "senders", "perf_beacon:senders"):
        out.add(hashlib.sha256(f"{salt}:{ip}".encode()).hexdigest())
        out.add(hmac.new(salt.encode(), ip.encode(), hashlib.sha256).hexdigest())
        for day in days:
            out.add(hashlib.sha256(f"{salt}:senders:{day}:{ip}".encode()).hexdigest())
            out.add(hashlib.sha256(f"{salt}:{day}:{ip}".encode()).hexdigest())
            out.add(hmac.new(salt.encode(), f"{day}:{ip}".encode(), hashlib.sha256).hexdigest())
            out.add(hmac.new(f"{salt}:{day}".encode(), ip.encode(), hashlib.sha256).hexdigest())
    return out


def _stored_text(path):
    """Every text value of every table: what a copy of the file hands over, row by row."""
    conn = sqlite3.connect(path)
    try:
        tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
        return [v for t in tables for row in conn.execute(f"SELECT * FROM {t}") for v in row if isinstance(v, str) and v]
    finally:
        conn.close()


def _file_bytes(path):
    """The store as it lies on disk: the file, its write-ahead log and anything else beside it under its name."""
    return b"".join(p.read_bytes() for p in sorted(path.parent.glob(path.name + "*")))


def test_nothing_stored_can_be_recomputed_from_an_ip_with_what_the_repo_holds(store):
    guesses = _from_the_repo(_IP, ["2026-11-18", "2026-11-19"])
    # control: this very search FINDS what older builds stored, so a clean result below is not a blind one
    old_sender = hashlib.sha256(f"perf_beacon:senders:2026-11-18:{_IP}".encode()).hexdigest()[:16]
    assert any(g.startswith(_old_load_key(_IP)) for g in guesses) and any(g.startswith(old_sender) for g in guesses)

    def nothing_matches(at_least):
        keys = [v for v in _stored_text(store) if re.fullmatch(r"[0-9a-f]{16,}", v)]
        assert len(keys) >= at_least, "the quota rows and the sender row do hold keys: there is something to try"
        assert [k for k in keys if any(g.startswith(k) for g in guesses)] == []
        raw = _file_bytes(store)
        assert _IP.encode() not in raw
        assert [g for g in guesses if g != _IP and g[:16].encode() in raw] == []

    pb.record(_report(), ip=_IP, country_header="US", now=_T)
    pb.record(_switch_report(), ip=_IP, country_header="US", now=_T + 5)
    nothing_matches(3)                                                     # a page-load quota row, a switch quota row, a sender row
    pb.record(_switch_report(), ip=_IP, country_header="US", now=_T + 86400)
    nothing_matches(2)                                                     # the next day's


def test_the_keys_live_in_memory_only_and_a_restart_makes_new_ones(store):
    assert not hasattr(pb, "_SALT")                                        # no constant keys anything any more
    read = lambda: (pb._rate_keys(_IP, _T)[0], pb._sender_key(_IP, "2026-11-18"))
    first = read()
    assert first == read()                                                 # the same sender again, within the period
    assert (len(first[0]), len(first[1])) == (24, 16)
    assert all(isinstance(k, bytes) and len(k) == 32 for k in pb._keys.values()) and len(set(pb._keys.values())) == len(pb._keys)
    pb._keys.clear()                                                       # what a restart does
    second = read()
    assert first[0] != second[0] and first[1] != second[1]
    # an hour's key is its own, and the quota can still see the hour before; a day's key is its own
    now_key, _ = pb._rate_keys(_IP, _T)
    next_key, before = pb._rate_keys(_IP, _T + 3600)
    assert next_key != now_key and before == now_key
    assert pb._sender_key(_IP, "2026-11-18") != pb._sender_key(_IP, "2026-11-19")
    # ...and each is forgotten when its use is over: an hour's once the NEXT hour is over too, a day's at the day change
    hour = int(_T // 3600)
    pb._forget_keys(_T + 3600)
    assert ("hour", hour) in pb._keys and ("day", "2026-11-18") in pb._keys
    pb._forget_keys(_T + 2 * 3600)
    assert ("hour", hour) not in pb._keys and ("hour", hour + 1) in pb._keys
    pb._forget_keys(_T + 86400)
    assert ("day", "2026-11-18") not in pb._keys


def test_keys_an_older_build_stored_are_blanked_and_leave_the_file(store, monkeypatch):
    assert pb.migrate() == 0 and not store.exists()                        # no store: nothing to do, and none is made
    _an_older_builds_store(store, 40)
    old = _old_load_key(_IP).encode()
    assert old in _file_bytes(store)                                       # control: it IS on disk before
    monkeypatch.setattr(pb, "_migrated", set())
    assert pb.migrate() == 40
    assert pb.migrate() == 0                                               # idempotent
    rows = _rows(store)
    assert len(rows) == 40 and {r["rate_key"] for r in rows} == {""} and [r["lcp"] for r in rows[:2]] == [900, 901]
    assert old not in _file_bytes(store)                                   # gone from the pages and the log, not only the rows
    assert "ix_perf_loads_rate" not in {r["name"] for r in _rows(store, "sqlite_master")}
    assert pb.record(_report(), ip=_IP, country_header="US", now=_T)["stored"] == 1       # and the store still takes reports
    assert pb.summary(24, now=_T + 100)["loads"] == 41


def test_keys_of_rows_an_older_build_had_already_deleted_leave_the_file_too(store, monkeypatch):
    # An older build pruned rows (30-day retention, the row ceiling) and did not zero them: their keys sit in the file's
    # FREE space, where no row holds them and a copy of the file still hands them over.
    _an_older_builds_store(store, 40)
    conn = sqlite3.connect(store)
    conn.execute("PRAGMA secure_delete=OFF")                               # (whatever this runner's SQLite defaults to)
    conn.execute("DELETE FROM perf_loads")
    conn.commit()
    conn.close()
    old = _old_load_key(_IP).encode()
    assert _rows(store) == [] and old in _file_bytes(store)                # control: every row is gone, the key is still on disk
    monkeypatch.setattr(pb, "_migrated", set())
    assert pb.migrate() == 0                                               # no row left to blank...
    assert old not in _file_bytes(store)                                   # ...and the file is rebuilt all the same
    assert pb.migrate() == 0 and "ix_perf_loads_rate" not in {r["name"] for r in _rows(store, "sqlite_master")}


def test_the_page_load_quota_holds_across_a_clock_hour_and_its_keys_are_gone_after_one(store):
    edge = (int(_T // 3600) + 1) * 3600                                    # the next clock hour: the quota's key rotates there
    for _ in range(pb.RATE_LIMIT):
        assert pb.record(_report(), ip="9.9.9.9", country_header="US", now=edge - 10)["stored"] == 1
    # another clock hour (another key), the same hour of reports: the quota still sees them
    assert pb.record(_report(), ip="9.9.9.9", country_header="US", now=edge + 10) == {"stored": 0, "dropped": 1, "invalid": 0}
    assert pb.record(_report(), ip="8.8.8.8", country_header="US", now=edge + 10)["stored"] == 1
    assert {r["rate_key"] for r in _rows(store)} == {""}                   # the page-load rows themselves hold no key at all
    assert len(_rows(store, "perf_load_sends")) == pb.RATE_LIMIT + 1
    assert pb.record(_report(), ip="9.9.9.9", country_header="US", now=edge - 10 + 3601)["stored"] == 1
    assert len(_rows(store, "perf_load_sends")) == 2                       # that write deleted every quota row over an hour old


def test_the_switch_quota_holds_across_a_clock_hour(store):
    edge = (int(_T // 3600) + 1) * 3600
    for _ in range(pb.SWITCH_RATE_LIMIT):
        assert pb.record(_switch_report(), ip="9.9.9.9", country_header="US", now=edge - 10)["stored"] == 1
    assert pb.record(_switch_report(), ip="9.9.9.9", country_header="US", now=edge + 10)["dropped"] == 1
    assert pb.record(_switch_report(), ip="9.9.9.9", country_header="US", now=edge - 10 + 3601)["stored"] == 1


def test_the_admin_read_deletes_what_has_outlived_its_use_without_waiting_for_a_report(store):
    pb.record(_report(), ip="10.8.0.1", country_header="US", now=_T)
    pb.record(_switch_report(), ip="10.8.0.1", country_header="US", now=_T)
    assert [len(_rows(store, t)) for t in ("perf_load_sends", "perf_switch_sends", "perf_switch_senders")] == [1, 1, 1]
    s = pb.switch_summary(2, now=_T + 86400)                               # the next ET day; no report has arrived since
    assert [len(_rows(store, t)) for t in ("perf_load_sends", "perf_switch_sends", "perf_switch_senders")] == [0, 0, 0]
    assert [(c["day"], c["senders"], c["switches"]) for c in s["cells"]] == [("2026-11-18", 1, 28)]     # the counts stay
    assert pb.housekeep(now=_T + 86400) == {"load_sends": 0, "switch_sends": 0, "senders": 0}


def _perf_beacon_threads():
    return [t.name for t in threading.enumerate() if t.name.startswith("perf-beacon") and t.is_alive()]


def test_at_boot_blanks_old_keys_inside_the_background_lane_and_logs_a_count(store, monkeypatch, capsys):
    """The start-of-process work, called directly (no thread): the one-time rebuild takes a turn of the repo's background
    lane, which is what makes it wait for the boot to settle (BG_LANE_SETTLE_S) and run one sweep at a time."""
    _an_older_builds_store(store, 3)
    monkeypatch.setattr(pb, "_migrated", set())
    blank = lambda: {r["rate_key"] for r in _rows(store)} == {""}
    turns = []

    @contextmanager
    def turn(name):
        turns.append(("in", name, blank()))
        yield
        turns.append(("out", name, blank()))

    monkeypatch.setattr(pb.bg_lane, "turn", turn)
    pb._at_boot()
    assert turns == [("in", "perf-beacon-migrate", False), ("out", "perf-beacon-migrate", True)]
    assert not pb.rebuild_pending()
    out = capsys.readouterr().out
    assert "blanked 3 " in out and _old_load_key(_IP) not in out and _IP not in out          # the log says a count, nothing else


def test_the_housekeeping_thread_is_off_under_pytest_and_when_opted_in_stops_when_told(store, monkeypatch):
    # OFF under pytest (the root conftest's switch): a lifespan test starts nothing that works on a store
    assert os.environ.get(pb.HOUSEKEEPING_SWITCH) == "1" and pb.HOUSEKEEPING_SWITCH == "PERF_BEACON_HOUSEKEEPING_DISABLED"
    assert pb.startup(every_s=0.05) is False
    assert _perf_beacon_threads() == [] and pb._housekeeper is None
    # opted in, on this test's own tmp store
    monkeypatch.delenv(pb.HOUSEKEEPING_SWITCH)
    monkeypatch.setattr(pb.bg_lane, "turn", contextmanager(lambda name: (yield)))      # (the lane's pacing is its own tests')
    _an_older_builds_store(store, 3)
    monkeypatch.setattr(pb, "_migrated", set())
    try:
        assert pb.startup(every_s=0.05) is True
        assert pb.startup(every_s=0.05) is False                           # one housekeeper per process
        thread = pb._housekeeper
        assert thread.daemon and _perf_beacon_threads() == ["perf-beacon-housekeeping"]
        assert pb._boot_done.wait(15)
        assert {r["rate_key"] for r in _rows(store)} == {""}
        # a quota row over an hour old, and no report arriving: the timer deletes it
        conn = sqlite3.connect(store)
        conn.execute("INSERT INTO perf_load_sends (created_at, rate_key) VALUES (?,?)", (time.time() - 7200, "k" * 24))
        conn.commit()
        conn.close()
        deadline = time.time() + 15
        while _rows(store, "perf_load_sends") and time.time() < deadline:
            time.sleep(0.05)
        assert _rows(store, "perf_load_sends") == []
    finally:
        pb.shutdown()
    assert not thread.is_alive() and _perf_beacon_threads() == [] and pb._housekeeper is None


def test_a_thread_waiting_for_the_boot_to_settle_stops_at_once_when_told(store, monkeypatch):
    # the pod restarts inside its first ten minutes: shutdown must not wait out the settle window
    monkeypatch.delenv(pb.HOUSEKEEPING_SWITCH)
    monkeypatch.setattr(pb.bg_lane, "enabled", lambda *a, **k: True)
    monkeypatch.setattr(pb.bg_lane, "settle_remaining", lambda *a, **k: 600.0)
    _an_older_builds_store(store, 3)
    monkeypatch.setattr(pb, "_migrated", set())
    assert pb.startup(every_s=0.05) is True
    thread = pb._housekeeper
    time.sleep(0.2)
    assert thread.is_alive() and not pb._boot_done.is_set()                # waiting: nothing was migrated in the boot
    assert {r["rate_key"] for r in _rows(store)} == {_old_load_key(_IP)}
    t = time.time()
    pb.shutdown()
    assert time.time() - t < 3 and not thread.is_alive()


def test_the_rebuild_is_skipped_when_the_disk_has_no_room_and_tried_again_at_the_next_start(store, monkeypatch, capsys):
    _an_older_builds_store(store, 6000)       # (many pages of pruned rows: more than the new tables' first pages can reuse)
    conn = sqlite3.connect(store)
    conn.execute("PRAGMA secure_delete=OFF")
    # keys in free space too (whole pages of pruned rows, which the blanking below never touches): only a rebuild removes those
    conn.execute("DELETE FROM perf_loads WHERE id > 1000")
    conn.commit()
    conn.close()
    old = _old_load_key(_IP).encode()
    monkeypatch.setattr(pb, "_migrated", set())
    # SQLite picks the directory of the rebuild's temporary copy in ITS order (SQLITE_TMPDIR, TMPDIR, /var/tmp, /tmp ...),
    # Python in another. Two of them are set here to directories of their own, one to a directory that does not exist.
    norm = lambda p: os.path.normcase(os.path.abspath(str(p)))
    sq, td = store.parent / "sqlite-tmp", store.parent / "env-tmp"
    sq.mkdir()
    td.mkdir()
    monkeypatch.setenv("SQLITE_TMPDIR", str(sq))
    monkeypatch.setenv("TMPDIR", str(td))
    asked = []
    room = {"free": 10}
    monkeypatch.setattr(pb, "_free_bytes", lambda d: (asked.append(norm(d)), room["free"])[1])
    assert pb.migrate() == 1000                                            # the blanking happens AT ONCE, room or not
    assert {r["rate_key"] for r in _rows(store)} == {""}
    assert pb.rebuild_pending() and old in _file_bytes(store)              # ...the rebuild did not, and the store remembers
    assert "SKIPPED" in capsys.readouterr().out
    # every place a rebuild may write is asked: the store's own volume, and EVERY candidate temp directory that exists
    candidates = [str(sq), str(td), "/var/tmp", "/tmp", tempfile.gettempdir()]
    assert set(asked) == {norm(store.parent)} | {norm(d) for d in candidates if os.path.isdir(d)}
    assert {norm(sq), norm(td), norm(tempfile.gettempdir())} <= set(asked)
    assert pb.migrate() == 0 and pb.rebuild_pending()                      # still no room: still pending, nothing lost
    # room everywhere but in ONE candidate is still no room, whichever one it is (the least free decides)
    for tight in (sq, td, tempfile.gettempdir()):
        monkeypatch.setattr(pb, "_free_bytes", lambda d, tight=norm(tight): 10 if norm(d) == tight else 10 ** 12)
        assert pb.migrate() == 0 and pb.rebuild_pending(), tight
    # a candidate that does not exist is not asked, and does not stop a rebuild
    monkeypatch.setenv("SQLITE_TMPDIR", str(store.parent / "no-such-dir"))
    asked.clear()
    monkeypatch.setattr(pb, "_free_bytes", lambda d: (asked.append(norm(d)), 10)[1])
    assert pb.migrate() == 0 and norm(store.parent / "no-such-dir") not in asked and norm(sq) not in asked
    # the next start, with room: rebuilt, and the marker goes
    monkeypatch.setattr(pb, "_free_bytes", lambda d: 10 ** 12)
    assert pb.migrate() == 0
    assert not pb.rebuild_pending() and old not in _file_bytes(store)
    assert pb.REBUILD_FREE_FACTOR >= 3


def test_a_rebuild_that_fails_is_tried_again_and_the_blanking_is_kept(store, monkeypatch, capsys):
    _an_older_builds_store(store, 5)
    monkeypatch.setattr(pb, "_migrated", set())
    real = pb._rebuild

    def full(conn):
        raise sqlite3.OperationalError("database or disk is full")

    monkeypatch.setattr(pb, "_rebuild", full)
    assert pb.migrate() == 5                                               # no exception reaches the caller
    assert {r["rate_key"] for r in _rows(store)} == {""} and pb.rebuild_pending()
    out = capsys.readouterr().out
    assert "FAILED" in out and "OperationalError" in out and "disk is full" not in out       # the type, never the message
    monkeypatch.setattr(pb, "_rebuild", real)
    assert pb.migrate() == 0 and not pb.rebuild_pending()
    assert pb.record(_report(), ip=_IP, country_header="US", now=_T)["stored"] == 1


def test_the_rebuild_keeps_its_temporary_copy_on_disk_never_in_memory(store):
    # A build of SQLite (or a connection) may keep temporary files in MEMORY: the rebuild's copy of the whole store would
    # then be RAM on the pod, which the space check cannot see. The rebuild says FILE itself.
    pb.record(_report(), ip=_IP, country_header="US", now=_T)
    conn = sqlite3.connect(store)
    try:
        conn.execute("PRAGMA temp_store=MEMORY")
        assert conn.execute("PRAGMA temp_store").fetchone()[0] == 2          # control: this connection said MEMORY
        pb._rebuild(conn)
        assert conn.execute("PRAGMA temp_store").fetchone()[0] == 1          # FILE, whatever it said
    finally:
        conn.close()
    assert pb.summary(24, now=_T + 10)["loads"] == 1                         # and the store is whole


def test_a_report_arriving_during_the_rebuild_is_dropped_at_once_never_parked_behind_it(store, monkeypatch):
    """Every beacon POST runs in the app's shared threadpool. A report that WAITED for the rebuild would hold a worker
    for as long as it runs; a reload spike after a deploy would park the pool every sync route shares."""
    _an_older_builds_store(store, 5)
    monkeypatch.setattr(pb, "_migrated", set())
    inside, go = threading.Event(), threading.Event()
    real = pb._rebuild

    def slow(conn):
        inside.set()
        assert go.wait(20)
        real(conn)

    monkeypatch.setattr(pb, "_rebuild", slow)
    worker = threading.Thread(target=pb.migrate, daemon=True)
    worker.start()
    try:
        assert inside.wait(15)                                             # the rebuild is running and holds the store
        t = time.time()
        assert pb.record(_report(), ip=_IP, country_header="US") == {"stored": 0, "dropped": 1, "invalid": 0}
        assert pb.record(_switch_report(), ip=_IP, country_header="US") == {"stored": 0, "dropped": 1, "invalid": 0}
        assert pb.housekeep() == {"load_sends": 0, "switch_sends": 0, "senders": 0}           # the timer does not wait either
        assert time.time() - t < 2, "they were answered at once, not after the rebuild"
        assert worker.is_alive()                                           # control: the rebuild really was still running
        assert pb.record(_report(lcp="x"), ip=_IP, country_header="US")["invalid"] == 1       # a bad report is still called bad
    finally:
        go.set()
        worker.join(20)
    assert not worker.is_alive() and not pb.rebuild_pending()
    assert pb.record(_report(), ip=_IP, country_header="US")["stored"] == 1                  # afterwards reports are stored again
    assert len(_rows(store)) == 6


def test_the_lifespan_starts_the_housekeeping_after_the_background_lane_and_stops_it_on_the_way_down():
    # Before `bg_lane.activate` the lane is a plain pass-through: a thread started above it could run the rebuild
    # inside the boot. And a thread the startup half starts is stopped by the shutdown half.
    src = (Path(__file__).resolve().parents[1] / "api" / "main.py").read_text(encoding="utf-8")
    body = src[src.index("async def lifespan(app"):]
    up, down = body.split("\n    yield\n", 1)[0], body.split("\n    yield\n", 1)[1]
    assert "bg_lane.activate(" in up and ".startup()" in up.split("bg_lane.activate(", 1)[1].split("perf_beacon", 1)[1][:400]
    assert "perf_beacon" not in up.split("bg_lane.activate(", 1)[0]       # nothing of it above the activation
    assert re.search(r"perf_beacon as (\w+)\n\s+\1\.shutdown\(\)", down)


def test_a_restart_mid_day_counts_a_returning_sender_again_and_the_legend_says_so(store):
    pb.record(_switch_report(), ip="10.7.0.1", country_header="US", now=_T)
    pb.record(_switch_report(), ip="10.7.0.1", country_header="US", now=_T + 1)
    assert pb.switch_summary(1, now=_T + 2)["cells"][0]["senders"] == 1    # exact within a process and a day
    pb._keys.clear()                                                       # the server restarts
    pb.record(_switch_report(), ip="10.7.0.1", country_header="US", now=_T + 3)
    s = pb.switch_summary(1, now=_T + 4)
    assert s["cells"][0]["senders"] == 2                                   # an over-count, never an under-count
    assert "restart" in s["legend"]["senders"] and "memory" in s["legend"]["senders"]
    # ...and said as what it is: an upper bound across restarts and processes; the quota is each process's own
    assert "upper bound" in s["legend"]["senders"] and "process" in s["legend"]["senders"]
    assert "per process" in s["legend"]["quota"] and "restart" in s["legend"]["quota"]


def test_the_real_lifespan_leaves_no_perf_beacon_thread_and_touches_no_store(store, monkeypatch, capsys):
    """LAST in this file: it runs the whole app's boot and shutdown, as every lifespan test does (the root conftest's
    switch on). No housekeeping thread during or after it, and the beacon's store path is never even asked for, so no
    lifespan test can prune or rebuild a store, on this PC's data volume or anywhere else.

    ⛔ IN THE APP'S LIGHT MODE (LOCAL_LIGHT_MODE, read on every call): the boot's warms, seeds and sweeps are not started,
    so THIS test leaves no boot work behind either. (Without it the boot's weekly purge outlived the lifespan and took a
    turn of the background lane inside a later test that counts turns: tests/test_bg_lane.py read 4 where 3.) The
    beacon's own step is not one of the guarded starts, so it runs exactly as in production."""
    from api.main import app
    monkeypatch.setenv("LOCAL_LIGHT_MODE", "1")
    assert os.environ.get(pb.HOUSEKEEPING_SWITCH) == "1"
    asked = []
    real_path = pb._db_path
    monkeypatch.setattr(pb, "_db_path", lambda: (asked.append(real_path()), asked[-1])[1])
    assert _perf_beacon_threads() == []
    capsys.readouterr()
    with TestClient(app):
        assert _perf_beacon_threads() == []
    assert _perf_beacon_threads() == [] and pb._housekeeper is None
    assert asked == []
    # control: the lifespan DID reach the beacon's step (the light mode did not skip it), and the step said no
    assert "perf beacon housekeeping: not started" in capsys.readouterr().out

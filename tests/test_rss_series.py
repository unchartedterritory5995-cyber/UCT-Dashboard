"""TERM-014: the retained RSS series, its slope reader and the subsystem attribution.

The classifier is proved at its boundaries (item 25 §4.6 method 2): OBS-3's 40-sample
floor WITHIN ONE DEPLOYMENT, OBS-4's two ceilings, and the measured leak shape read
back as a monotonic slope with the grown subsystem named.
"""
from __future__ import annotations

import os
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

from api.services import rss_series as rs
from api.services import store_retention

REPO = Path(__file__).resolve().parents[1]


@pytest.fixture
def armed(tmp_path, monkeypatch):
    db = tmp_path / "rss_series.db"
    monkeypatch.setenv("RSS_SERIES_DB_PATH", str(db))
    monkeypatch.setenv(rs.FLAG, "1")
    rs._INIT_DONE.discard(str(db))
    return db


def _leak(n, *, dep="d1", start=2429.0, per_min=7.9, t0=1_000_000.0, threads=80,
          grow_key="cache:bars_cache"):
    return [{"ts": t0 + 60 * i, "deployment": dep, "rss_mb": start + per_min * i,
             "threads": threads,
             "subsys": {grow_key: 100 + 50 * i, "cache:flat": 7, "threads:web-memwatch": 1}}
            for i in range(n)]


def test_dark_means_no_io(tmp_path, monkeypatch):
    db = tmp_path / "rss_series.db"
    monkeypatch.setenv("RSS_SERIES_DB_PATH", str(db))
    monkeypatch.delenv(rs.FLAG, raising=False)
    assert rs.record(2500.0, 90) is False
    assert not db.exists(), "a dark recorder created its store"


def test_record_and_read_back(armed):
    for i in range(3):
        assert rs.record(2400.0 + i, 90, subsys={"cache:x": i}, now=1_000_000 + 60 * i,
                         deployment="dep-a") is True
    got = rs.read_samples()
    assert [s["rss_mb"] for s in got] == [2400.0, 2401.0, 2402.0]
    assert got[-1]["subsys"] == {"cache:x": 2}


def test_an_unreadable_store_is_never_an_empty_series(tmp_path):
    with pytest.raises(FileNotFoundError):
        rs.read_samples(str(tmp_path / "absent.db"))
    assert not (tmp_path / "absent.db").exists(), "the reader created the file"


def test_the_measured_leak_reads_as_a_monotonic_slope_with_the_grower_named():
    r = rs.slope(_leak(76))
    assert r["status"] == "ok"
    assert r["monotonic"] is True
    assert r["slope_mb_per_min"] == pytest.approx(7.9, abs=0.01)
    assert r["deployments_sampled"] == 1
    assert r["attribution"][0]["subsystem"] == "cache:bars_cache"
    assert all(g["subsystem"] != "cache:flat" for g in r["attribution"]), "a flat counter is not a grower"


def test_obs3_floor_is_forty_samples_in_one_deployment():
    assert rs.slope(_leak(39))["status"] == "insufficient"
    assert rs.slope(_leak(40))["status"] == "ok"
    # 60 samples split across two deployments: the newest deployment holds 30 => no slope,
    # however many samples the store holds in total.
    mixed = _leak(30, dep="old") + _leak(30, dep="new", t0=2_000_000.0)
    r = rs.slope(mixed)
    assert r["status"] == "insufficient" and r["deployments_sampled"] == 2 and r["n"] == 30


def test_obs4_ceilings_page_at_their_boundaries():
    def one(rss, threads):
        return rs.slope([{"ts": 1.0, "deployment": "d", "rss_mb": rss, "threads": threads,
                          "subsys": {}}])["page"]
    assert one(3500.0, 200) == []
    assert one(3500.1, 200) and "rss" in one(3500.1, 200)[0]
    assert one(3000.0, 201) and "threads" in one(3000.0, 201)[0]


def test_a_flat_series_is_not_monotonic():
    flat = _leak(60, per_min=0.0)
    r = rs.slope(flat)
    assert r["monotonic"] is False and r["slope_mb_per_min"] == 0.0


def test_prune_keeps_newest_400_and_nothing_past_90_days(armed):
    now = 10_000_000.0
    old = now - (rs.MAX_AGE_DAYS + 1) * 86400
    rs.record(1.0, 1, subsys={}, now=old, deployment="d")
    for i in range(rs.MAX_ROWS + 5):
        rs.record(2.0, 1, subsys={}, now=now + i, deployment="d")
    got = rs.read_samples()
    assert len(got) == rs.MAX_ROWS
    assert min(s["ts"] for s in got) > old


def test_an_undeclared_prune_deletes_nothing(armed, monkeypatch):
    monkeypatch.setattr(store_retention, "may_prune", lambda store, table: False)
    for i in range(rs.MAX_ROWS + 3):
        rs.record(2.0, 1, subsys={}, now=1_000.0 + i, deployment="d")
    assert len(rs.read_samples()) == rs.MAX_ROWS + 3


def test_thread_prefix_groups_pool_threads():
    assert rs.thread_prefix("cal-em_3") == "cal-em"
    assert rs.thread_prefix("ThreadPoolExecutor-4_0") == "ThreadPoolExecutor"
    assert rs.thread_prefix("web-memwatch") == "web-memwatch"


def test_census_names_threads_and_never_raises():
    c = rs.census()
    assert any(k.startswith("threads:") for k in c)


def _tool(*args):
    return subprocess.run([sys.executable, str(REPO / "tools" / "rss_slope_report.py"), *args],
                          capture_output=True, text=True, cwd=str(REPO))


def test_the_report_tool_exit_codes(tmp_path, armed):
    r = _tool("--db", str(tmp_path / "nope.db"))
    assert r.returncode == 125 and "UNREADABLE" in r.stdout
    for s in _leak(45, start=3000.0, per_min=20.0):   # ends at 3880 MB: over the ceiling
        rs.record(s["rss_mb"], s["threads"], subsys=s["subsys"], now=s["ts"], deployment="d")
    r = _tool("--db", str(armed))
    assert r.returncode == 3, r.stdout
    assert "PAGE" in r.stdout and "slope" in r.stdout


def test_the_monitor_job_is_dark_until_its_flag_and_alerts_on_a_page(monkeypatch):
    from api import terminal_next_monitor_main as mon
    monkeypatch.delenv("RSS_SERIES_ENABLED", raising=False)
    assert mon.JOB_GATES["memory"]() is False
    monkeypatch.setattr(mon, "_fetch", lambda path: {"exit": 3, "stdout": "PAGE: rss"})
    title, body, alert = mon.job_memory_slope()
    assert alert is True and "PAGE" in title
    monkeypatch.setattr(mon, "_fetch", lambda path: {"exit": 0, "stdout": "status: insufficient"})
    assert mon.job_memory_slope()[2] is False, "insufficient samples is not an alert"


def test_the_report_is_on_the_declared_allow_list():
    from api.routers import terminal_next_reports as rep
    assert rep._REPORTS["memory-slope"] == ["tools/rss_slope_report.py"]

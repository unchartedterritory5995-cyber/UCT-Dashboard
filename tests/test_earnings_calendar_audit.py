"""Rails for the earnings calendar's accuracy audit, quality summary and source health."""
from __future__ import annotations

import ast
import json
import pathlib
from datetime import date

import pytest

from api.services import earnings_calendar_audit as a
from api.services import earnings_session_resolver as r


@pytest.fixture(autouse=True)
def _iso(monkeypatch, tmp_path):
    monkeypatch.setattr(a, "_SNAP_DIR", str(tmp_path / "snaps"))
    monkeypatch.setattr(r, "_HEALTH_PATH", str(tmp_path / "health.json"))
    monkeypatch.delenv("CALENDAR_ACCURACY_AUDIT_ENABLED", raising=False)
    r._health.clear()
    r._cache.clear()
    posted = []
    monkeypatch.setattr(a, "_post", lambda text: posted.append(text) or True)
    yield posted
    r._health.clear()
    r._cache.clear()


def _row(sym, **kw):
    return {"sym": sym, "eps_est": 1.0, **kw}


def _payload(days, source="range_finnhub+fmp"):
    return {"days": days, "source": source, "as_of": "x"}


# ── grading (pure) ──────────────────────────────────────────────────────────

SNAP = {"JPM": {"day": "2026-10-13", "bucket": "bmo"},
        "AA": {"day": "2026-10-15", "bucket": "amc"},
        "CBSH": {"day": "2026-10-14", "bucket": "bmo"},
        "WABC": {"day": "2026-10-15", "bucket": "tbd", "session_note": "during market hours"},
        "ZZ": {"day": "2026-10-16", "bucket": "tbd"},
        "GONE": {"day": "2026-10-16", "bucket": "bmo"},
        "NOSES": {"day": "2026-10-16", "bucket": "amc"}}
TRUTH = {"JPM": {"day": "2026-10-13", "bucket": "bmo", "reported": True},
         "AA": {"day": "2026-10-15", "bucket": "bmo", "reported": True},
         "CBSH": {"day": "2026-10-20", "bucket": "bmo", "reported": False},
         "WABC": {"day": "2026-10-15", "bucket": "tbd", "reported": True},
         "ZZ": {"day": "2026-10-16", "bucket": "amc", "reported": True},
         "NOSES": {"day": "2026-10-16", "bucket": "amc", "reported": True, "src": "edgar_history"},
         "NEW": {"day": "2026-10-14", "bucket": "amc", "reported": True}}


def test_grade_names_every_kind_of_miss():
    g = a.grade(SNAP, TRUTH)
    assert g["right"] == ["JPM", "WABC"]
    assert g["wrong_session"] == ["AA (shown AMC, was BMO)"]
    assert g["wrong_day"] == ["CBSH (shown 10-14, reported 10-20)"]
    assert g["unknown_time"] == ["ZZ"]
    assert "GONE (shown 10-16)" in g["not_reported"]
    assert g["unverified"] == ["NOSES"]          # an INFERRED session is not truth
    assert g["missed"] == ["NEW (10-14)"]
    assert g["accuracy"] == round(2 / 5, 4)


def test_filing_breaks_a_tie_and_catches_a_wrong_day():
    g = a.grade({"X": {"day": "2026-10-14", "bucket": "amc"}}, {},
                filing=lambda s: ("2026-10-15", "amc"))
    assert g["wrong_day"] == ["X (shown 10-14, reported 10-15)"]


def test_report_lists_names_not_just_counts():
    text = a.format_report(dict(a.grade(SNAP, TRUTH), monday="2026-10-12"))
    assert "40.0% right" in text and "AA (shown AMC, was BMO)" in text and "NEW (10-14)" in text


# ── snapshot -> audit round trip ────────────────────────────────────────────

def test_snapshot_then_audit(monkeypatch, _iso):
    before = _payload({"2026-10-13": {"bmo": [_row("JPM")], "amc": [], "tbd": []},
                       "2026-10-14": {"bmo": [], "amc": [_row("HOMB", date_est=True)], "tbd": []}})
    after = _payload({"2026-10-13": {"bmo": [_row("JPM", eps_act=5.1)], "amc": [], "tbd": []},
                      "2026-10-14": {"bmo": [_row("HOMB", eps_act=0.5)], "amc": [], "tbd": []}})
    monkeypatch.setattr(a, "_get_week", lambda m: before)
    snap = a.snapshot_upcoming_week(today=date(2026, 10, 11))
    assert snap["monday"] == "2026-10-12" and snap["rows"]["HOMB"]["date_est"]
    monkeypatch.setattr(a, "_get_week", lambda m: after)
    monkeypatch.setattr(a, "_filing_truth", lambda s, m: None)
    res = a.audit_week(date(2026, 10, 12))
    assert res["right"] == ["JPM"] and res["wrong_session"] == ["HOMB (shown AMC, was BMO)"]
    assert pathlib.Path(a._path(date(2026, 10, 12), ".audit")).exists()
    assert "HOMB" in _iso[-1]


def test_audit_without_a_snapshot_says_so(_iso):
    assert a.audit_week(date(2026, 10, 12)) is None
    assert "NO SNAPSHOT" in _iso[-1]


def test_kill_switch(monkeypatch, _iso):
    monkeypatch.setenv("CALENDAR_ACCURACY_AUDIT_ENABLED", "0")
    assert a.snapshot_upcoming_week() is None and a.audit_week() is None and not a.post_health()
    assert _iso == []


def test_snapshot_failure_never_raises(monkeypatch):
    def boom(m):
        raise RuntimeError("down")
    monkeypatch.setattr(a, "_get_week", boom)
    assert a.snapshot_upcoming_week() is None


# ── quality summary ─────────────────────────────────────────────────────────

def test_quality_counts_and_degraded_reasons():
    days = {"d1": {"bmo": [_row("A", date_est=True)], "amc": [],
                   "tbd": [_row("W", session_note="during market hours"), _row("U")]}}
    r._LAST_RUN.update(sources_failed=[])
    q = r.quality(days, "range_finnhub+fmp")
    assert q == {"degraded": False, "reasons": [], "tbd": 1, "during_market": 1,
                 "unconfirmed": 1, "sources_failed": []}
    assert r.quality(days, "range_fmp")["degraded"]
    many = {"d1": {"bmo": [], "amc": [], "tbd": [_row(str(i)) for i in range(4)]}}
    assert r.quality(many, "live")["reasons"] == ["4 unknown times"]


# ── source health ───────────────────────────────────────────────────────────

def test_a_failed_source_is_recorded_persisted_and_reported(monkeypatch):
    monkeypatch.setenv("CALENDAR_TBD_RESOLVER", "1")
    def boom(*x):
        raise RuntimeError("blocked")
    monkeypatch.setattr(r, "_nasdaq_fetch", boom)
    monkeypatch.setattr(r, "_ew_fetch", lambda ds: [])
    monkeypatch.setattr(r, "_yahoo_fetch", lambda s: None)
    monkeypatch.setattr(r, "_sec_fetch", lambda c: {})
    monkeypatch.setattr(r, "_press_fetch", lambda s: [])
    monkeypatch.setattr(r, "_cik_for", lambda s: None)
    days = {"2026-10-14": {"bmo": [], "amc": [], "tbd": [_row("X")]}}
    r.resolve_tbd_sessions(days, today_str="2026-10-10")
    assert "nasdaq" in r.last_run_failures() and "ew" not in r.last_run_failures()
    disk = json.loads(pathlib.Path(r._HEALTH_PATH).read_text(encoding="utf-8"))
    day = next(iter(disk.values()))
    assert day["nasdaq"]["fail"] > 0 and "blocked" in day["nasdaq"]["last_error"]
    text = a.health_report(next(iter(disk)))
    assert "DOWN: nasdaq" in text


# ── wiring ──────────────────────────────────────────────────────────────────

def test_the_three_jobs_are_scheduled_and_the_builders_attach_quality():
    main = pathlib.Path("api/main.py").read_text(encoding="utf-8")
    ids = {kw.value.value for n in ast.walk(ast.parse(main)) if isinstance(n, ast.Call)
           for kw in n.keywords if kw.arg == "id" and isinstance(kw.value, ast.Constant)}
    assert "calendar_week_post" in ids                                    # control
    assert {"earnings_calendar_snapshot", "earnings_calendar_audit", "earnings_source_health"} <= ids
    cal = pathlib.Path("api/routers/calendar.py").read_text(encoding="utf-8")
    assert cal.count("_earnings_quality(days, source)") == 2
    assert "_RANGE_WEEK_TTL_DEGRADED" in cal and "_CACHE_DEGRADED_TTL" in cal

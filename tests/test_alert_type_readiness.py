"""tools/alert_type_readiness.py: the TERM-025 owner action is running this tool.

Every clause of the bar is driven both ways, with a READY case beside each NOT READY
case so a tool that answered "not ready" to everything would fail here too.
"""
from __future__ import annotations

import importlib.util
import json
import sqlite3
from datetime import date
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location("alert_type_readiness", ROOT / "tools" / "alert_type_readiness.py")
atr = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(atr)

# Ten consecutive NYSE sessions with no holiday inside: Mon 2026-09-21 .. Fri 2026-10-02.
TEN = ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25",
       "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"]
TODAY = date(2026, 10, 2)


def rep(pid="p1", *, sessions=TEN, agreed=3, new_only=0, legacy_only=0, not_comparable=0):
    return {"predicate_id": pid, "agreed": agreed, "new_only": new_only,
            "legacy_only": legacy_only, "not_comparable": not_comparable,
            "sessions_covered": list(sessions)}


def test_a_clean_ten_session_log_is_READY():
    out = atr.assess_type("price-level", [rep()], today=TODAY)
    assert out["ready"] is True, out["reasons"]
    assert out["consecutive_sessions"] == 10


def test_nine_sessions_is_not_enough():
    out = atr.assess_type("price-level", [rep(sessions=TEN[1:])], today=TODAY)
    assert not out["ready"]
    assert any("9 consecutive" in r for r in out["reasons"])


def test_a_gap_breaks_the_run():
    gapped = TEN[:4] + TEN[5:]                    # 2026-09-25 missing
    out = atr.assess_type("price-level", [rep(sessions=gapped)], today=TODAY)
    assert out["consecutive_sessions"] == 5 and not out["ready"]


def test_clause1_any_new_only_blocks():
    out = atr.assess_type("price-level", [rep(new_only=1)], today=TODAY)
    assert not out["ready"] and any("clause 1" in r for r in out["reasons"])


def test_clause2_legacy_only_on_an_active_predicate_blocks():
    out = atr.assess_type("price-level", [rep(legacy_only=2)], today=TODAY)
    assert not out["ready"] and any("clause 2" in r for r in out["reasons"])


def test_clause3_a_stalled_predicate_is_excluded_and_needs_a_disposition():
    stalled = rep("old", sessions=TEN[:3], agreed=0, legacy_only=7)
    out = atr.assess_type("price-level", [rep(), stalled], today=TODAY)
    assert [e["predicate_id"] for e in out["excluded"]] == ["old"]
    assert not out["ready"] and any("clause 3" in r and "not dispositioned" in r for r in out["reasons"])
    ok = atr.assess_type("price-level", [rep(), stalled], today=TODAY,
                         dispositions={"old": "confirmed_correct_suppression"})
    assert ok["ready"], ok["reasons"]
    bad = atr.assess_type("price-level", [rep(), stalled], today=TODAY,
                          dispositions={"old": "unexplained"})
    assert not bad["ready"]


def test_new_only_on_an_EXCLUDED_predicate_still_blocks():
    stalled = rep("old", sessions=TEN[:3], agreed=0, new_only=1)
    out = atr.assess_type("price-level", [rep(), stalled], today=TODAY,
                          dispositions={"old": "confirmed_inactive"})
    assert not out["ready"] and any("clause 1" in r for r in out["reasons"])


def test_nothing_observed_is_not_ready_and_no_data_is_not_ready():
    quiet = atr.assess_type("price-level", [rep(agreed=0)], today=TODAY)
    assert not quiet["ready"] and any("NOTHING OBSERVED" in r for r in quiet["reasons"])
    empty = atr.assess_type("price-level", [], today=TODAY)
    assert not empty["ready"] and any("NO DATA" in r for r in empty["reasons"])


def test_a_log_that_stopped_is_not_ready():
    out = atr.assess_type("price-level", [rep()], today=date(2026, 10, 9))
    assert not out["ready"] and any("stale log" in r for r in out["reasons"])


def test_the_render_names_every_ready_type():
    a = atr.assess_type("price-level", [rep()], today=TODAY)
    b = atr.assess_type("regime-change", [rep(new_only=1)], today=TODAY)
    text = atr.render([a, b])
    assert "READY TO FLIP: price-level" in text
    assert "regime-change            NOT READY" in text


def test_main_refuses_without_a_db_off_a_pod(monkeypatch, capsys):
    monkeypatch.delenv("RAILWAY_ENVIRONMENT", raising=False)
    assert atr.main([]) == 2


def test_main_refuses_a_store_that_does_not_exist(tmp_path):
    assert atr.main(["--db", str(tmp_path / "nope.db")]) == 2
    assert not (tmp_path / "nope.db").exists(), "the tool created a store"


def test_main_reads_a_real_store_and_flips_nothing(tmp_path, capsys):
    db = tmp_path / "alert_taxonomy.db"
    sqlite3.connect(db).close()
    assert atr.main(["--db", str(db), "--json", "--today", "2026-10-02"]) == 0
    results = json.loads(capsys.readouterr().out)
    assert results and all(r["ready"] is False for r in results)
    assert {r["alert_type"] for r in results} >= {"price-level", "regime-change"}


def test_main_rejects_an_unknown_disposition(tmp_path):
    db = tmp_path / "alert_taxonomy.db"
    sqlite3.connect(db).close()
    d = tmp_path / "d.json"
    d.write_text(json.dumps({"price-level": {"p1": "probably fine"}}))
    assert atr.main(["--db", str(db), "--dispositions", str(d)]) == 2

"""Study -- index history charts (2026-11-16): a history question that quotes an index level is drawn on that index.

courses_lib marks the chart (`source: "index"`, adjustment_basis "index level"); the server never reads bars.db for it,
never tops its replay up from there, and the replay's intraday fill skips it; check_course_charts checks it from a
local copy of the index's history and refuses a chart whose days are closes only; fill_course_charts stores only a
chart that passes. The data in these tests is synthetic (no vendor data in the repo).
"""
from __future__ import annotations

import datetime as dt
import json

import pytest

import api.routers.study as study_router
from api.services import study_store as ss
from scripts.study import check_course_charts as ccc
from scripts.study import courses_lib as cl
from scripts.study import fill_course_charts as fcc


def _days(start: str, n: int, *, flat_until: str = "") -> list[list]:
    """n weekday rows [YYYYMMDD, o, h, l, c, v] from `start`, a gentle rise; days before `flat_until` are closes only."""
    d, out, px = dt.date.fromisoformat(start), [], 1000.0
    while len(out) < n:
        if d.weekday() < 5:
            k = int(d.strftime("%Y%m%d"))
            if flat_until and d.isoformat() < flat_until:
                out.append([k, px, px, px, px, 0])
            else:
                out.append([k, round(px - 2, 2), round(px + 5, 2), round(px - 6, 2), round(px + 1, 2), 1_000_000])
            px += 1.5
        d += dt.timedelta(days=1)
    return out


def _question(asof: str, **chart) -> dict:  # noqa: D401
    return {"key": "q01", "chart": {"sym": "SPX", "asof": asof, "window": 120, "forward": 30, **chart}}


def test_one_basis_value_everywhere():
    assert cl.INDEX_BASIS == ss.INDEX_BASIS == study_router.INDEX_BASIS == "index level"
    assert set(cl.INDEX_SERIES) == {"SPX", "IXIC", "NDX", "DJI", "RUT"}
    # COMP is a listed stock (Compass Inc.): the Nasdaq Composite must never take its name
    assert "COMP" not in cl.INDEX_SERIES


def _q(key, chart):
    return {"key": key, "format": "mcq", "skill": "history.crash", "rung": 1, "q": "What happened next?",
            "choices": ["It fell", "It rose", "It held", "It gapped"], "answer": "It fell", "why": "x", "lesson_line": "y",
            "chart": chart}


def _problems(q):
    return cl.question_problems(q, unit={}, facts={}, sources={}, skills={"history.crash"})


def test_the_bank_marks_an_index_chart_and_leaves_a_stock_chart_alone():
    doc = {"unit": "F7.99", "track": "F7", "questions": [
        _q("q01", {"sym": "SPX", "asof": "2008-09-12", "window": 100, "forward": 40}),
        _q("q02", {"sym": "SPY", "asof": "2008-09-12", "window": 100, "forward": 40})],
        "verify": {"q01": {"status": "pass"}, "q02": {"status": "pass"}}}
    items = {it["_key"]: it for it in cl.build_items(doc)}
    spx, spy = items["q01"], items["q02"]
    assert spx["adjustment_basis"] == cl.INDEX_BASIS and spx["bars"]["source"] == "index"
    assert spx["bars"]["window"] == 100 + cl.WARMUP_BARS and spx["sym"] == "SPX"
    assert spy["adjustment_basis"] == "split-adjusted" and "source" not in spy["bars"]


def test_an_index_chart_is_daily():
    assert not [p for p in _problems(_q("q01", {"sym": "SPX", "asof": "2008-09-12"})) if "chart" in p]
    bad = _q("q01", {"sym": "SPX", "asof": "2020-03-20 10:00", "tf": "30"})
    assert any("an index chart is daily" in p for p in _problems(bad))


def test_the_server_never_reads_bars_db_for_an_index_chart(monkeypatch):
    from api.services import bars_sqlite

    def boom(*a, **k):
        raise AssertionError("an index chart must not read bars.db")
    monkeypatch.setattr(bars_sqlite, "get_bars_before", boom)
    got = study_router.resolve_bars({"sym": "SPX", "tf": "D", "asof": "2008-09-12", "window": 300, "forward": 40,
                                     "source": "index"})
    assert got == {"ok": False, "reason": "index_fill", "sym": "SPX", "tf": "D"}


@pytest.fixture()
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(ss, "_DB_PATH", str(tmp_path / "study.db"))
    monkeypatch.delenv("STUDY_ENABLED", raising=False)
    ss.init_db()
    return ss


def _bars(rows):
    return [{"t": r[0], "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5]} for r in rows]


def test_the_replay_is_never_topped_up_from_bars_db_and_the_intraday_fill_skips_it(store, monkeypatch):
    rows = _days("2008-01-02", 200)
    for iid, sym, basis in (("si_ix", "SPX", cl.INDEX_BASIS), ("si_st", "SPY", "split-adjusted")):
        store.upsert_items([{"id": iid, "type": "recall", "skill_id": "s", "difficulty": 2, "bars_ref": f"sb_{iid}",
                             "sym": sym, "asof": "2008-07-01", "adjustment_basis": basis, "prompt_json": {"q": "?"},
                             "answer_json": {"answer": "a"}, "source_kind": "course", "source_ref": f"course:x#{iid}"}])
        store.upsert_bars(f"sb_{iid}", "D", _bars(rows[:120]), _bars(rows[120:130]))
        store.approve(iid, "owner")
    from api.services import bars_sqlite
    calls = []
    monkeypatch.setattr(bars_sqlite, "get_bars_before", lambda *a, **k: calls.append(a[0]) or [])
    ix = study_router._forward_bars(store.get_item_full("si_ix"))   # noqa: SLF001
    assert len(ix) == 10 and calls == []
    study_router._forward_bars(store.get_item_full("si_st"))        # noqa: SLF001  (a stock chart still tops up)
    assert calls == ["SPY"]
    assert [r["id"] for r in store.intraday_candidates()] == ["si_st"]


def test_the_checker_reads_the_index_history_and_refuses_closes_only(tmp_path):
    rows = _days("2007-06-01", 500)
    (tmp_path / "SPX.json").write_text(json.dumps(rows), encoding="utf-8")
    asof = dt.date(rows[400][0] // 10000, rows[400][0] // 100 % 100, rows[400][0] % 100).isoformat()
    ok = ccc.check_question(None, "F7.99", _question(asof), str(tmp_path))
    assert ok["problems"] == []
    # not a trading day
    assert any("is not a bar" in p for p in ccc.check_question(None, "F7.99", _question("2009-01-03"), str(tmp_path))["problems"])
    # no local history: left to the pod, never passed as checked
    left = ccc.check_question(None, "F7.99", _question(asof), None)
    assert left.get("pod_unchecked") and left["problems"] == []
    # an early history of closes only draws flat dashes: refused while any day shown is one
    early = _days("2007-06-01", 500, flat_until=asof)
    (tmp_path / "SPX.json").write_text(json.dumps(early), encoding="utf-8")
    bad = ccc.check_question(None, "F7.99", _question(asof), str(tmp_path))
    assert any("closes only" in p for p in bad["problems"])


def test_the_fill_finds_the_index_charts_and_stores_only_a_passing_one(store, tmp_path, monkeypatch, capsys):
    rows = _days("2007-06-01", 500)
    idx = tmp_path / "idx"
    idx.mkdir()
    (idx / "SPX.json").write_text(json.dumps(rows), encoding="utf-8")
    good = dt.date(rows[400][0] // 10000, rows[400][0] // 100 % 100, rows[400][0] % 100).isoformat()
    bank = tmp_path / "bank"
    bank.mkdir()
    items = [{"id": "si_good", "bars": {"sym": "SPX", "tf": "D", "asof": good, "window": 120 + cl.WARMUP_BARS,
                                        "forward": 30, "source": "index"}},
             {"id": "si_bad", "bars": {"sym": "SPX", "tf": "D", "asof": "2009-01-03", "window": 120 + cl.WARMUP_BARS,
                                       "forward": 30, "source": "index"}},
             {"id": "si_stock", "bars": {"sym": "SPY", "tf": "D", "asof": good, "window": 320, "forward": 30}}]
    (bank / "course.f7.json").write_text(json.dumps(items), encoding="utf-8")
    got = fcc.index_charts(bank)
    assert [c["id"] for c in got] == ["si_good", "si_bad"] and got[0]["window"] == 120 and got[0]["kind"] == "index"
    frm, to = fcc.fetch_span(got[0])
    assert frm < good < to
    for it in items[:2]:
        store.upsert_items([{"id": it["id"], "type": "recall", "skill_id": "s", "difficulty": 2, "bars_ref": f"sb_{it['id']}",
                             "sym": "SPX", "asof": it["bars"]["asof"], "adjustment_basis": cl.INDEX_BASIS,
                             "prompt_json": {"q": "?"}, "answer_json": {"answer": "a"}, "source_kind": "course",
                             "source_ref": f"course:x#{it['id']}"}])
    monkeypatch.setattr(fcc, "BANK_DIR", bank)
    monkeypatch.setenv("STUDY_DB_PATH", ss._DB_PATH)
    assert fcc.main(["--kind", "index", "--index-dir", str(idx)]) == 0
    out = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert out["checked_index"] == 2 and out["passed"] == 1 and out["stored"] == 1
    assert [f["id"] for f in out["failed"]] == ["si_bad"]
    vis = store.get_visible_bars("si_good", approved_only=False)["bars"]
    assert len(vis) == 120 + cl.WARMUP_BARS and vis[-1]["t"] == int(good.replace("-", ""))
    assert len(store.get_forward_bars("si_good")) == 30
    assert not (store.get_visible_bars("si_bad", approved_only=False) or {}).get("bars")


def test_an_index_whose_volume_is_borrowed_is_stored_without_volume(monkeypatch):
    # Yahoo's Russell 2000 volume is the S&P 500's on most days (and its Nasdaq 100 the Composite's): those charts carry
    # no volume rather than another index's; the S&P 500, the Composite and the Dow keep their own
    import sys
    import types
    import pandas as pd
    df = pd.DataFrame({"Open": [100.0, 101.0], "High": [102.0, 103.0], "Low": [99.0, 100.5], "Close": [101.5, 102.25],
                       "Volume": [5_000_000, 6_000_000]}, index=pd.to_datetime(["2024-07-10", "2024-07-11"]))
    monkeypatch.setitem(sys.modules, "yfinance", types.SimpleNamespace(download=lambda *a, **k: df))
    assert cl.INDEX_OWN_VOLUME == {"SPX", "IXIC", "DJI"}
    rut = fcc.fetch_index_daily("RUT", "2024-07-01", "2024-07-12")
    assert rut == [[20240710, 100.0, 102.0, 99.0, 101.5, 0], [20240711, 101.0, 103.0, 100.5, 102.25, 0]]
    assert [r[5] for r in fcc.fetch_index_daily("NDX", "2024-07-01", "2024-07-12")] == [0, 0]
    assert [r[5] for r in fcc.fetch_index_daily("SPX", "2024-07-01", "2024-07-12")] == [5_000_000, 6_000_000]


def test_the_checker_refuses_an_era_whose_opens_are_only_the_prior_close(tmp_path):
    # Yahoo's S&P 500 opens before 2008 are mostly the prior close: every candle starts where the last one closed, so no
    # gap shows (1987's open drew none). A chart showing more than one such day in ten is refused.
    rows = _days("2007-06-01", 500)
    asof_k = rows[400][0]
    asof = dt.date(asof_k // 10000, asof_k // 100 % 100, asof_k % 100).isoformat()
    stale = [list(r) for r in rows]
    for a, b in zip(stale, stale[1:]):
        b[1] = a[4]                                     # each open is the prior close
    (tmp_path / "SPX.json").write_text(json.dumps(stale), encoding="utf-8")
    bad = ccc.check_question(None, "F7.99", _question(asof), str(tmp_path))
    assert any("open exactly at the prior close" in p for p in bad["problems"])
    # a few such days (one in twenty) are not an era of fake opens
    few = [list(r) for r in rows]
    for i in range(1, len(few), 20):
        few[i][1] = few[i - 1][4]
    (tmp_path / "SPX.json").write_text(json.dumps(few), encoding="utf-8")
    assert ccc.check_question(None, "F7.99", _question(asof), str(tmp_path))["problems"] == []


def test_the_checker_refuses_a_copied_row_in_the_index_history(tmp_path):
    # Yahoo's Russell 2000 row for 2024-07-19 repeats 07-18's open and high: a fake gap and wick. Never shown.
    rows = [list(r) for r in _days("2007-06-01", 500)]
    asof_k = rows[400][0]
    asof = dt.date(asof_k // 10000, asof_k // 100 % 100, asof_k % 100).isoformat()
    rows[405][1], rows[405][2] = rows[404][1], rows[404][2]     # inside the 30-day replay
    (tmp_path / "SPX.json").write_text(json.dumps(rows), encoding="utf-8")
    bad = ccc.check_question(None, "F7.99", _question(asof), str(tmp_path))
    assert any("copies the prior day's open and high" in p for p in bad["problems"])
    # outside what the member sees (the replay ends before it), it does not matter
    assert ccc.check_question(None, "F7.99", _question(asof, forward=3), str(tmp_path))["problems"] == []


def test_the_fill_refuses_the_live_data_root_but_not_the_sandbox_beside_it():
    import os
    if os.name != "nt":
        pytest.skip("the guard is the Windows box's")
    assert fcc._refuse_c_data("C:/data") and fcc._refuse_c_data("C:/data/study.db") and fcc._refuse_c_data(r"c:\DATA\x\study.db")
    assert not fcc._refuse_c_data("C:/data-studytest/study.db") and not fcc._refuse_c_data("C:/Users/x/study.db")


def test_back_to_review_moves_only_approved_items_and_changes_nothing_else(store, tmp_path, capsys):
    from scripts.study import back_to_review as btr
    for iid in ("si_ok", "si_draft"):
        store.upsert_items([{"id": iid, "type": "recall", "skill_id": "s", "difficulty": 2, "prompt_json": {"q": "?"},
                             "answer_json": {"answer": "a"}, "source_kind": "course", "source_ref": f"course:x#{iid}",
                             "lesson_text": "the lesson"}])
    store.approve("si_ok", "owner")
    assert btr.main(["--reason", "chart added", "--ids", "si_ok,si_draft,si_gone", "--dry-run"]) == 0
    dry = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert dry["moved"] == ["si_ok"] and store.get_item_full("si_ok")["review_status"] == ss.STATUS_APPROVED
    assert btr.main(["--reason", "chart added", "--ids", "si_ok,si_draft,si_gone"]) == 0
    out = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert out == {"dry_run": False, "asked": 3, "moved": ["si_ok"], "not_approved": 1, "missing": ["si_gone"]}
    after = store.get_item_full("si_ok")
    assert after["review_status"] == "draft" and after["lesson_text"] == "the lesson"
    # the bank lookup finds every index-charted course item
    bank = tmp_path / "bank"
    bank.mkdir()
    (bank / "course.f7.json").write_text(json.dumps([{"id": "si_i", "bars": {"source": "index"}}, {"id": "si_s", "bars": {}}]), encoding="utf-8")
    assert btr.bank_ids_with_chart_source("index", bank) == ["si_i"]


def test_the_fill_skips_a_full_snapshot_but_fetches_a_short_one_again(store, tmp_path, monkeypatch, capsys):
    rows = _days("2007-06-01", 500)
    idx = tmp_path / "idx"
    idx.mkdir()
    (idx / "SPX.json").write_text(json.dumps(rows), encoding="utf-8")
    good = dt.date(rows[400][0] // 10000, rows[400][0] // 100 % 100, rows[400][0] % 100).isoformat()
    bank = tmp_path / "bank"
    bank.mkdir()
    (bank / "course.f7.json").write_text(json.dumps([{"id": "si_g", "bars": {"sym": "SPX", "tf": "D", "asof": good,
                                                      "window": 120 + cl.WARMUP_BARS, "forward": 30, "source": "index"}}]), encoding="utf-8")
    store.upsert_items([{"id": "si_g", "type": "recall", "skill_id": "s", "difficulty": 2, "bars_ref": "sb_si_g", "sym": "SPX",
                         "asof": good, "adjustment_basis": cl.INDEX_BASIS, "prompt_json": {"q": "?"}, "answer_json": {"answer": "a"},
                         "source_kind": "course", "source_ref": "course:x#si_g"}])
    monkeypatch.setattr(fcc, "BANK_DIR", bank)
    monkeypatch.setenv("STUDY_DB_PATH", ss._DB_PATH)
    run = lambda: (fcc.main(["--kind", "index", "--index-dir", str(idx)]), json.loads(capsys.readouterr().out.strip().splitlines()[-1]))[1]  # noqa: E731
    assert run()["stored"] == 1
    assert run().get("already_filled") == 1                       # a full snapshot is left alone
    store.upsert_bars("sb_si_g", "D", _bars(rows[386:401]), _bars(rows[401:431]))    # a short one: 15 bars
    again = run()
    assert again.get("short_refetched") == 1 and again["stored"] == 1
    assert len(store.get_visible_bars("si_g", approved_only=False)["bars"]) == 120 + cl.WARMUP_BARS

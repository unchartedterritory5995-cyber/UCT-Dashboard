"""PIT ledger carry-forward (owner, 2026-10-08): a rejected UCT session is never a blank day."""
import json
import os
import sys

TOOLS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "tools", "breadth_v2")
sys.path.insert(0, TOOLS)
import pit_ledger_refresh as plr  # noqa: E402


def _row(created, tickers, healed=False, pct=None):
    return {"created_at": created, "tickers": tickers, "sha256": "|".join(tickers), "n": len(tickers),
            "healed": healed, "items": len(tickers), "pct_populated": len(tickers) if pct is None else pct}


def _run(tmp_path, exp, prev_dates=None):
    paths = {k: str(tmp_path / f"{k}.json") for k in ("exp", "frz", "rev", "led", "rep")}
    json.dump(exp, open(paths["exp"], "w"))
    json.dump({"dates": prev_dates or {}, "live_from": "2026-08-27", "source": "x; y",
               "why_live_from": "", "excluded_backfilled_dates": []}, open(paths["frz"], "w"))
    json.dump({"reviewed": []}, open(paths["rev"], "w"))
    rc = plr.main(["x", paths["exp"], paths["frz"], paths["rev"], paths["led"], paths["rep"]])
    led = json.load(open(paths["led"])) if os.path.exists(paths["led"]) else None
    return rc, led, json.load(open(paths["rep"]))


def test_a_rejected_session_carries_the_previous_accepted_list(tmp_path):
    exp = {"2026-08-28": _row("2026-08-28 20:20:38", ["A", "B", "C"]),
           "2026-08-31": _row("2026-09-01 15:50:54", ["A", "B", "C"], healed=True),   # late + healed copy
           "2026-09-01": _row("2026-09-01 20:25:00", ["A", "B", "D"])}
    rc, led, rep = _run(tmp_path, exp)
    assert rc == 0 and rep["gate"] == "PASS"
    e = led["dates"]["2026-08-31"]
    assert e["carried_from"] == "2026-08-28" and e["tickers"] == ["A", "B", "C"]
    assert set(e["carried_reasons"]) >= {"LATE_AFTER_NEXT_OPEN"}
    assert led["carried"] == {"2026-08-31": "2026-08-28"}
    assert "carried_from" not in led["dates"]["2026-09-01"]


def test_an_unreviewed_rejection_no_longer_stops_the_producer(tmp_path):
    exp = {"2026-08-28": _row("2026-08-28 20:20:38", ["A", "B"]),
           "2026-08-31": _row("2026-09-02 09:00:00", ["A", "B"]),
           "2026-09-01": _row("2026-09-01 20:25:00", ["A", "B"])}
    rc, led, rep = _run(tmp_path, exp)
    assert rc == 0 and rep["unreviewed_historical_rejections"] == ["2026-08-31"]
    assert "2026-08-31" in led["dates"]


def test_a_carried_entry_is_not_mistaken_for_a_mutated_source_row(tmp_path):
    exp = {"2026-08-28": _row("2026-08-28 20:20:38", ["A", "B"]),
           "2026-08-31": _row("2026-09-02 09:00:00", ["Z"]),
           "2026-09-01": _row("2026-09-01 20:25:00", ["A", "B"])}
    _, led, _ = _run(tmp_path, exp)
    rc, _, rep = _run(tmp_path, exp, prev_dates=led["dates"])        # the next refresh
    assert rc == 0 and rep["source_row_mutations"] == []


def test_a_mutated_accepted_row_still_stops(tmp_path):
    exp = {"2026-08-28": _row("2026-08-28 20:20:38", ["A", "B"]),
           "2026-09-01": _row("2026-09-01 20:25:00", ["A", "B"])}
    _, led, _ = _run(tmp_path, exp)
    exp["2026-08-28"] = _row("2026-08-28 20:20:38", ["A", "B", "EDITED"])
    rc, _, rep = _run(tmp_path, exp, prev_dates=led["dates"])
    assert rc == 2 and rep["gate"] == "STOP" and rep["source_row_mutations"] == ["2026-08-28"]

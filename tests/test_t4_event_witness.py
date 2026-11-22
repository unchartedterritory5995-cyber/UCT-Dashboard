"""Track 4, unit E0: the event-placement witnesses (`tools/vendor_harness/event_witness.py`) and the committed
placements they derived (`docs/pine/evidence/2026-11-22-t4-e0-event-placement/placements.json`).

Two halves. The SYNTHETIC captures prove the derivation and the check can each fail on the shape they exist to
catch (an off-read on the event's own weekday bar, a carried row that drifts, a VWAP that restarts off an event).
The COMMITTED document is re-proved with no capture at all, and carries no plotted value (dates, placements, counts
and split ratios only: TradingView's EPS figures and prices stay in the local capture store).
"""
from __future__ import annotations

import copy
import datetime as dt
import json
import os
import sys

import pytest

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, "tools", "vendor_harness"))
import event_witness as ew  # noqa: E402

DOC = os.path.join(REPO, "docs", "pine", "evidence", "2026-11-22-t4-e0-event-placement", "placements.json")


def _t(day: str) -> int:
    return int((dt.datetime.fromisoformat(day + "T14:30:00+00:00")).timestamp())


# one week and a bit of daily bars, the weekend 2026-01-10/11 missing (as on a real chart)
DAYS = ["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09",
        "2026-01-12", "2026-01-13", "2026-01-14", "2026-01-15", "2026-01-16"]


def _capture(tmp_path, rows_by_title: dict, title="UCTPROBE_VW_DATA_DIVIDENDS", tf="1D", name="cap"):
    titles = list(rows_by_title)
    plots = [{"id": f"plot_{i}", "type": "line", "title": f"{t} x"} for i, t in enumerate(titles)]
    rows = [[_t(d)] + [rows_by_title[t][k] for t in titles] for k, d in enumerate(DAYS)]
    doc = {"schema": "uct.vendor-capture/v1", "id": name, "capturedAtUTC": "2026-01-17T00:00:00Z",
           "symbol": {"full_name": "NYSE:TEST"}, "timeframe": tf, "newestBarIsForming": False,
           "study": {"title": title, "plots": plots},
           "plotValues": {"fields": ["time"] + [p["id"] for p in plots], "rows": rows},
           "bars": {"fields": ["time", "open", "high", "low", "close", "volume"],
                    "rows": [[_t(d), 1, 1, 1, 1, 1] for d in DAYS]}}
    p = tmp_path / f"{name}.json"
    p.write_text(json.dumps(doc), encoding="utf-8")
    return str(p)


def _col(**at):
    """A row over DAYS: `at` maps a day index to a value, every other bar na."""
    return [at.get(f"i{k}") for k in range(len(DAYS))]


def _ffill(col):
    out, cur = [], None
    for v in col:
        cur = v if v is not None else cur
        out.append(cur)
    return out


def _dividends(on, off):
    return {"D01": on, "D02": off, "D03": _ffill(on), "D04": _ffill(off), "D05": _col(), "D06": _col(),
            "D07": [_t(d) * 1000 for d in DAYS]}


def _doc_for(path):
    p = ew.derive_probe(ew.load(path))
    return {"schema": ew.SCHEMA, "probes": [p], "vwap": []}, p


def test_a_weekday_event_reads_off_on_the_next_bar(tmp_path):
    on = _col(i2=0.5)            # Wed 2026-01-07
    off = _col(i3=0.5)           # Thu: the next bar
    doc, p = _doc_for(_capture(tmp_path, _dividends(on, off)))
    assert p["events"] == [{"on": "2026-01-07", "prev": "2026-01-06", "next": "2026-01-08", "off": "2026-01-08"}]
    assert p["rules"]["R1"]["held"] == 1 and ew.check(doc) == []


def test_an_event_dated_on_a_weekend_lands_both_reads_on_monday(tmp_path):
    on = _col(i5=0.5)            # Mon 2026-01-12, the bar before it Fri 01-09 (three days earlier)
    off = _col(i5=0.5)           # the same Monday bar
    doc, p = _doc_for(_capture(tmp_path, _dividends(on, off)))
    assert p["rules"]["R1"]["exceptions"] == p["events"] and ew.check(doc) == []


def test_BREAK_a_weekday_event_read_off_on_its_own_bar_is_refused(tmp_path):
    """The shape R1 exists to catch: no session gap before the bar, yet lookahead_off did not move."""
    on = _col(i2=0.5)            # Wed
    off = _col(i2=0.5)           # Wed again: wrong
    doc, _p = _doc_for(_capture(tmp_path, _dividends(on, off)))
    bad = ew.check(doc)
    assert bad and "2026-01-07" in bad[0] and "(R1)" in bad[0]


def test_two_records_one_on_the_weekend_one_on_monday(tmp_path):
    """The JPM 1984-09-10 shape: on-read Monday only, off-reads Monday AND Tuesday."""
    on = _col(i5=0.59)
    off = _col(i5=0.59, i6=0.59)
    doc, p = _doc_for(_capture(tmp_path, _dividends(on, off)))
    assert p["rules"]["R1"]["twoRecordsOffBars"] == ["2026-01-12"] and ew.check(doc) == []


def test_BREAK_a_free_floating_off_read_is_refused(tmp_path):
    on = _col(i2=0.5)
    off = _col(i3=0.5, i8=0.5)   # Thu 01-15 explained by nothing
    doc, _p = _doc_for(_capture(tmp_path, _dividends(on, off)))
    assert any("no event explains" in b for b in ew.check(doc))


def test_BREAK_a_carried_row_that_drifts_is_refused(tmp_path):
    on, off = _col(i2=0.5), _col(i3=0.5)
    rows = _dividends(on, off)
    rows["D04"] = list(rows["D04"])
    rows["D04"][3] = None        # the defaults row starts a bar late
    doc, _p = _doc_for(_capture(tmp_path, rows))
    assert any("R2 carryOff" in b for b in ew.check(doc))


def test_BREAK_a_vwap_restart_off_an_event_is_refused():
    doc = {"schema": ew.SCHEMA, "probes": [], "vwap": [
        {"captureId": "v", "V1": {"eventsInWindow": 2, "both": 2, "resetOnly": ["2026-01-08"], "eventOnly": []}}]}
    assert any("restarts with no event" in b for b in ew.check(doc))


# ── the committed document ─────────────────────────────────────────────────────────────────────────────────────
@pytest.fixture(scope="module")
def committed():
    with open(DOC, encoding="utf-8") as fh:
        return json.load(fh)


def test_the_committed_placements_re_prove_every_rule(committed):
    assert ew.check(committed) == []


def test_the_committed_placements_are_not_vacuous(committed):
    fams = {(p["family"], p["timeframe"]) for p in committed["probes"]}
    assert {("earnings", "1D"), ("earnings", "1W"), ("earnings", "60"), ("dividends", "1D"), ("dividends", "1W"),
            ("splits", "1D"), ("splits", "1W")} <= fams
    assert len(committed["probes"]) == 20 and len(committed["vwap"]) == 7
    events = sum(len(p["events"]) for p in committed["probes"])
    assert events > 1500, events
    # the non-session shape is witnessed, not assumed: the two dividend captures that hold it
    named = [e["on"] for p in committed["probes"] for e in p["rules"]["R1"]["exceptions"]]
    assert sorted(named) == ["1984-12-03", "1985-06-10", "1996-12-23"]
    assert [b for p in committed["probes"] for b in p["rules"]["R1"]["twoRecordsOffBars"]] == ["1984-09-10"]


def _floats(node, path=""):
    if isinstance(node, float):
        yield path
    elif isinstance(node, dict):
        for k, v in node.items():
            yield from _floats(v, f"{path}.{k}")
    elif isinstance(node, list):
        for i, v in enumerate(node):
            yield from _floats(v, f"{path}[{i}]")


def test_the_committed_placements_carry_no_plotted_value(committed):
    """Dates, placements and counts only. The one number a row may carry is a split's ratio (the corporate action
    itself), and a ratio is a small whole number."""
    assert list(_floats(committed)) == []
    for p in committed["probes"]:
        for r in p["fields"].get("ratios", []):
            assert all(isinstance(r[k], int) and 1 <= r[k] <= 100 for k in ("numerator", "denominator")), r


def test_BREAK_a_value_slipped_into_the_document_is_caught(committed):
    doc = copy.deepcopy(committed)
    doc["probes"][0]["events"][0]["eps"] = 2.84
    assert list(_floats(doc)) != []


def test_BREAK_an_edited_committed_placement_is_caught(committed):
    doc = copy.deepcopy(committed)
    p = next(p for p in doc["probes"] if p["family"] == "earnings" and p["timeframe"] == "1D" and p["events"])
    p["events"][3]["off"] = p["events"][3]["on"]
    assert ew.check(doc)

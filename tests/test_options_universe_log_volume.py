"""2026-10-02: the 2026-09-30 options log carried an EMPTY `volume` (and `vwap`) on all
2,018,713 contracts. Cause: `contract_row` read `day.volume` -- the shape of the
per-underlying CHAIN snapshot -- while the logger walks the UNIVERSAL snapshot
(`/v3/snapshot?type=options`), which carries the day under `session.volume` and has
no `day` object at all.

These tests run against Massive's own documented sample response for that endpoint,
copied verbatim (see the fixture's `_provenance`). No field is invented.
"""
from __future__ import annotations

import copy
import csv
import datetime as dt
import gzip
import io
import json
import pathlib
from zoneinfo import ZoneInfo

from api.services import options_universe_log as log

FIXTURE = (pathlib.Path(__file__).parent / "fixtures" / "massive_options_log"
           / "unified_snapshot_docs_sample.json")
WED = dt.datetime(2026, 9, 30, 16, 30, tzinfo=ZoneInfo("America/New_York"))


def _page():
    return json.loads(FIXTURE.read_text(encoding="utf-8"))["page"]


def _option(page=None):
    (rec,) = [r for r in (page or _page())["results"] if r.get("type") == "options"]
    return rec


def test_the_fixture_is_the_universal_shape_session_not_day():
    """Guards the fixture itself: if it ever grew a `day` object, the tests below
    could pass while reading the wrong path."""
    rec = _option()
    assert "session" in rec and "day" not in rec
    assert rec["session"]["volume"] == 67


def test_volume_and_open_interest_come_from_the_universal_snapshots_own_paths():
    row = log.contract_row(_option())
    assert row["contract"] == "O:NCLH221014C00005000"
    assert row["volume"] == 67                    # session.volume
    assert row["open_interest"] == 8921           # top-level open_interest
    assert row["iv"] == 0.3048997097864957 and row["bid"] == 20.9 and row["last"] == 0.05
    assert row["vwap"] is None                    # the endpoint has no day vwap


def test_an_ABSENT_volume_is_blank_never_zero():
    rec = _option()
    del rec["session"]["volume"]
    del rec["session"]["decimal_volume"]
    assert log.contract_row(rec)["volume"] is None
    rec2 = _option()
    del rec2["session"]
    del rec2["open_interest"]
    row = log.contract_row(rec2)
    assert row["volume"] is None and row["open_interest"] is None


def test_decimal_volume_is_read_only_when_the_integer_is_missing():
    rec = _option()
    del rec["session"]["volume"]                  # "67.0" remains
    assert log.contract_row(rec)["volume"] == 67


def test_a_TRUE_zero_volume_stays_zero():
    rec = _option()
    rec["session"]["volume"] = 0
    assert log.contract_row(rec)["volume"] == 0


def test_stock_and_error_records_in_the_same_page_are_not_contracts():
    rows = [log.contract_row(r) for r in _page()["results"]]
    assert [r["contract"] for r in rows if r] == ["O:NCLH221014C00005000"]


def _run(tmp_path, results):
    stored = {}

    def upload(path, key, ctype):
        with open(path, "rb") as fh:
            stored[key] = fh.read()
    m = log.run(now=WED, api_key="K", workdir=str(tmp_path), upload=upload,
                get=lambda u: {"results": results})
    return m, stored


def test_a_run_writes_volume_and_COUNTS_the_contracts_that_lack_it(tmp_path):
    page = _page()
    has = _option(page)
    lacks = copy.deepcopy(has)
    lacks["ticker"] = "O:NCLH221014P00005000"
    del lacks["session"]
    m, stored = _run(tmp_path, page["results"] + [lacks])
    keys = log.keys_for(WED.date())
    rows = list(csv.DictReader(io.StringIO(gzip.decompress(stored[keys["contracts"]]).decode())))
    assert [(r["contract"], r["volume"]) for r in rows] == [
        ("O:NCLH221014C00005000", "67"), ("O:NCLH221014P00005000", "")]   # blank, not 0
    assert m["contracts"] == 2 and m["with_volume"] == 1
    assert m["with_open_interest"] == 2 and m["filled"]["volume"] == 1
    assert json.loads(stored[keys["manifest"]])["with_volume"] == 1


def test_a_complete_run_with_NO_volume_anywhere_is_an_alert_not_recorded():
    """The 2026-09-30 day would have posted green. It must post an alert."""
    m = {"session": "2026-09-30", "contracts": 2018713, "underlyings": 6034, "with_iv": 1,
         "with_volume": 0, "with_open_interest": 2018713, "pages": 8075, "seconds": 780,
         "bytes": {"contracts": 108030090}, "keys": log.keys_for(WED.date()),
         "complete": True, "reason": None}
    title, body, alert = log.receipt_text(m)
    assert alert is True and "EMPTY" in title and "volume" in body
    ok = log.receipt_text({**m, "with_volume": 1500000})
    assert ok[2] is False and "1,500,000 with volume" in ok[1]

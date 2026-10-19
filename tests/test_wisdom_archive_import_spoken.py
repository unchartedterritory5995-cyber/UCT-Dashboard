"""The archive importer sends spoken (Zoom) records and their calls beside the written ones.

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
1. a spoken call dropped as an orphan because its record was never read (the importer once read
   records/records/t*.json only);
2. a spoken record sent with the record file's machine candidate tickers instead of the
   reviewed calls' tickers;
3. a spoken record that no call cites being sent;
4. a spoken record or call the server's own validators would refuse.
Synthetic ledger only: the repo is public.
"""
from __future__ import annotations

import importlib.util
import json
import pathlib

REPO = pathlib.Path(__file__).resolve().parents[1]


def _importer():
    spec = importlib.util.spec_from_file_location(
        "archive_import_under_test", REPO / "tools" / "wisdom" / "archive_import.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _write(path: pathlib.Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj), encoding="utf-8")


def _ledger(tmp_path: pathlib.Path) -> pathlib.Path:
    src = tmp_path / "ledger"
    _write(src / "records" / "records" / "t9001.json",
           {"author": "tsdr", "date": "2025-01-02", "type": "CALL", "tickers": ["ZZTA"],
            "note": "synthetic written note", "quote": "synthetic written quote"})
    _write(src / "records" / "zoom" / "z00010001.json",
           {"author": "tsdr", "date": "2025-01-03", "type": "CALL", "tickers": ["S"],
            "note": "", "quote": "[8:00am] synthetic spoken words", "source": "zoom"})
    _write(src / "records" / "zoom" / "z00010002.json",          # no call cites it
           {"author": "tsdr", "date": "2025-01-03", "type": "CALL", "tickers": ["ZZTC"],
            "note": "", "quote": "[8:05am] synthetic chatter", "source": "zoom"})
    _write(src / "records" / "retired.json", {})
    calls = [
        {"call_id": "t9001#0", "record": "t9001", "author": "tsdr", "ticker": "ZZTA", "direction": "long",
         "setup": "pullback_ma", "action": "idea", "posted": "2025-01-02", "status": "scored", "r20": 0.1,
         "source": "discord"},
        {"call_id": "z00010001#0", "record": "z00010001", "author": "tsdr", "ticker": "ZZTB",
         "direction": "long", "setup": "pullback_ma", "action": "idea", "posted": "2025-01-03 08:00",
         "status": "scored", "r20": -0.02, "source": "zoom"},
        {"call_id": "z00010001#1", "record": "z00010001", "author": "tsdr", "ticker": "zztd",
         "direction": "long", "setup": "watchlist", "action": "watch", "posted": "2025-01-03 08:00",
         "status": "immature", "source": "zoom"},
    ]
    (src / "scored").mkdir(parents=True, exist_ok=True)
    (src / "scored" / "calls.jsonl").write_text("".join(json.dumps(c) + "\n" for c in calls), encoding="utf-8")
    return src


def _counts(mod):
    return {k: 0 for k in ("records_read", "records_spoken_read", "records_retired", "records_unknown_author",
                           "records_bad_type", "records_invalid", "calls_read", "calls_unknown_author",
                           "calls_orphan_record", "calls_invalid")}


def test_a_cited_spoken_record_is_sent_with_the_calls_tickers(tmp_path):
    mod = _importer()
    src, counts = _ledger(tmp_path), None
    counts = _counts(mod)
    records = mod.validate_locally("records", mod.build_records(src, counts), counts)
    by_id = {r["record_id"]: r for r in records}
    assert set(by_id) == {"t9001", "z00010001"}                       # z00010002 is cited by no call
    assert by_id["z00010001"]["tickers"] == ["ZZTB", "ZZTD"]          # the calls', not the file's ["S"]
    assert by_id["z00010001"]["quote"].endswith("synthetic spoken words")
    assert by_id["t9001"]["tickers"] == ["ZZTA"]                      # control: written records unchanged
    assert counts["records_spoken_read"] == 1 and counts["records_invalid"] == 0


def test_spoken_calls_reach_the_send_list_instead_of_being_orphaned(tmp_path):
    mod = _importer()
    src = _ledger(tmp_path)
    counts = _counts(mod)
    records = mod.validate_locally("records", mod.build_records(src, counts), counts)
    calls = mod.validate_locally("calls", mod.build_calls(src, counts, {r["record_id"] for r in records}), counts)
    assert sorted(c["call_id"] for c in calls) == ["t9001#0", "z00010001#0", "z00010001#1"]
    assert counts["calls_orphan_record"] == 0 and counts["calls_invalid"] == 0


def test_a_retired_spoken_record_is_not_sent_and_its_calls_are_orphaned(tmp_path):
    mod = _importer()
    src = _ledger(tmp_path)
    _write(src / "records" / "retired.json", {"z00010001": "synthetic reason"})
    counts = _counts(mod)
    records = mod.build_records(src, counts)
    calls = mod.build_calls(src, counts, {r["record_id"] for r in records})
    assert "z00010001" not in {r["record_id"] for r in records}
    assert [c["call_id"] for c in calls] == ["t9001#0"] and counts["calls_orphan_record"] == 2

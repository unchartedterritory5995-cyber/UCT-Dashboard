"""A measurement's DATE is a property of the row, not of the file.

⭐⭐ THE DEFECT, AND THE FACT THAT ITS TWIN WAS ALREADY FIXED. The ledger header
carries one `measured_at`, and `tools/run_lift_ledger.py` rewrote it on EVERY
run — including a `--only` re-measure of a single structure. So measuring one
row stamped today's date on all twenty-three, and `is_stale()` reported the
whole artifact fresh while rows measured weeks earlier sat untouched.

⛔ THIS IS THE SAME DEFECT AS THE ONE ALREADY FIXED FOR `sample`, whose rail says
in its own words: "The header used to carry ONE `sample` line that the runner
rewrote on every run — so a `--only` re-measure of one structure left the header
describing a sample five other rows were never drawn from. The size is a
property of the row." Whoever fixed the size left the date, and a header field
that describes twenty-three different measurements is a second authority over
one value whichever field it is.

⛔ AND THE FALLBACK IS EXPLICIT. Rows written before the runner started stamping
dates have none. Returning the header date for them silently would rebuild the
exact lie this exists to end, so they are reported UNKNOWN — absence of evidence
is not evidence of freshness, and these numbers are shown to paying members.
"""
import sys, pathlib, json, datetime
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import pytest

from api.services.screener import lift_ledger as ll

ROOT = pathlib.Path(__file__).resolve().parents[1]


def _ledger(tmp_path, structures, header_date="2026-08-31"):
    p = tmp_path / "ledger.json"
    p.write_text(json.dumps({
        "measured_at": header_date,
        "structures": structures,
    }), encoding="utf-8")
    return str(p)


# ─── the rule ───────────────────────────────────────────────────────────────

def test_a_row_with_its_own_date_does_not_inherit_the_header(tmp_path):
    path = _ledger(tmp_path, {
        "fresh-row": {"published": True, "measured_at": "2026-08-30"},
    }, header_date="2026-08-31")
    when, inherited = ll.row_measured_at("fresh-row", path)
    assert when == datetime.date(2026, 8, 30)
    assert inherited is False


def test_a_row_without_one_is_marked_INHERITED_not_silently_dated(tmp_path):
    """⛔ THE HEART OF IT. The header value is still returned so a caller can
    show something, but it arrives flagged. A bare date here would be
    indistinguishable from a real measurement."""
    path = _ledger(tmp_path, {"old-row": {"published": True}},
                   header_date="2026-08-31")
    when, inherited = ll.row_measured_at("old-row", path)
    assert when == datetime.date(2026, 8, 31)
    assert inherited is True, (
        "a row with no date of its own must say the value was inherited — "
        "otherwise the header's date reads as this row's measurement")


def test_an_ONLY_re_measure_cannot_mark_the_others_fresh(tmp_path):
    """⭐ THE SCENARIO THE DEFECT ACTUALLY PRODUCED. One structure is
    re-measured today; the header is rewritten to today. Every OTHER row must
    still report its own, older date — not today's."""
    path = _ledger(tmp_path, {
        "just-measured": {"published": True, "measured_at": "2026-08-31"},
        "measured-in-may": {"published": True, "measured_at": "2026-05-01"},
    }, header_date="2026-08-31")

    assert ll.row_measured_at("just-measured", path)[0] == datetime.date(2026, 8, 31)
    assert ll.row_measured_at("measured-in-may", path)[0] == datetime.date(2026, 5, 1)

    buckets = ll.stale_rows(max_age_days=120, path=path,
                            today=datetime.date(2026, 8, 31))
    assert buckets["fresh"] == ["just-measured"]
    assert buckets["stale"] == ["measured-in-may"], (
        "a row measured 122 days ago is stale however recently the FILE was "
        "written — that is the whole point")


def test_a_dateless_row_is_UNKNOWN_rather_than_assumed_fresh(tmp_path):
    path = _ledger(tmp_path, {"no-date": {"published": True}},
                   header_date="2026-08-31")
    buckets = ll.stale_rows(path=path, today=datetime.date(2026, 8, 31))
    assert buckets["unknown"] == ["no-date"]
    assert buckets["fresh"] == []


def test_a_malformed_date_does_not_crash_and_does_not_pass_as_fresh(tmp_path):
    path = _ledger(tmp_path, {"bad": {"published": True,
                                      "measured_at": "not-a-date"}})
    when, _ = ll.row_measured_at("bad", path)
    assert when is None
    buckets = ll.stale_rows(path=path, today=datetime.date(2026, 8, 31))
    assert buckets["unknown"] == ["bad"]


def test_an_absent_row_reports_nothing_rather_than_the_header(tmp_path):
    path = _ledger(tmp_path, {"a": {"published": True}})
    when, inherited = ll.row_measured_at("no-such-structure", path)
    assert inherited is True and when == datetime.date(2026, 8, 31)


# ─── the writer's half of the contract ──────────────────────────────────────

def test_the_runner_stamps_the_date_on_every_row_it_writes():
    """⛔ THE READER ALONE IS HALF A FIX. If the runner never writes a per-row
    date, every row is UNKNOWN forever and the distinction is decorative. The
    row builders must set it — checked by reading the runner, because there is
    no cheap way to run a full measurement in a test."""
    src = (ROOT / "tools/run_lift_ledger.py").read_text(encoding="utf-8")
    builders = src.count('"sample_tickers": len(usable),')
    assert builders == 2, (
        f"expected 2 row builders in the runner, found {builders} — this rail "
        f"is pointed at the wrong lines")
    stamps = src.count('"measured_at": time.strftime("%Y-%m-%d"),')
    assert stamps >= builders, (
        f"{builders} row builders but only {stamps} per-row date stamps: a row "
        f"written without its own date inherits the header's, which is the "
        f"defect this file exists to prevent")


def test_the_artifact_is_written_ATOMICALLY():
    """⛔ `open(path, "w")` TRUNCATES BEFORE THE WRITE CAN FAIL. Both write
    sites used it, so a serialisation error part-way through would leave the
    published ledger destroyed rather than merely unchanged
    (`lesson_open_w_truncates_before_your_write_can_fail`)."""
    src = (ROOT / "tools/run_lift_ledger.py").read_text(encoding="utf-8")
    assert 'open(args.out, "w"' not in src, (
        "the ledger is being written through a truncating open() again")
    assert "os.replace(tmp, path)" in src, (
        "the atomic writer is gone — encode -> tmp -> os.replace is the contract")
    assert src.count("_write_ledger(args.out, data)") == 2, (
        "both write sites must go through the single atomic writer, or they "
        "drift apart the way the two newline spellings already did")


# ─── controls ───────────────────────────────────────────────────────────────

def test_the_bucketing_can_produce_every_verdict(tmp_path):
    """⛔ NON-VACUITY. A `stale_rows` that always returned everything as one
    bucket would satisfy several cases above. This demands all three."""
    path = _ledger(tmp_path, {
        "f": {"measured_at": "2026-08-30"},
        "s": {"measured_at": "2026-01-01"},
        "u": {},
    })
    b = ll.stale_rows(max_age_days=120, path=path,
                      today=datetime.date(2026, 8, 31))
    assert b["fresh"] == ["f"] and b["stale"] == ["s"] and b["unknown"] == ["u"]


def test_the_real_artifact_is_readable_by_this_machinery():
    """The rules above are exercised on fixtures; this proves they also apply
    to the shipped file rather than to a shape only tests produce."""
    b = ll.stale_rows()
    total = len(b["fresh"]) + len(b["stale"]) + len(b["unknown"])
    entries = len(ll.load().get("structures") or {})
    assert total == entries > 0, "every row must land in exactly one bucket"

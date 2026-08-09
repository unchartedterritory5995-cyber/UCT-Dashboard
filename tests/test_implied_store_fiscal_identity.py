"""P2 Task 4 — the MOAT regression: FMP (the primary reporter-list source,
2916eb4e) hardcodes fiscal_year/fiscal_quarter = None on every row it
supplies (see api/services/implied_store.py's `_fmp_reporters_for_day`). The
normal T-1 capture window is `[today, today+WINDOW]` (default WINDOW=1), so
the rows that actually matter every night are dated TODAY+1 — and the old
`_finnhub_today_enrichment`/`_merge_today_enrichment` backfill ONLY ever ran
for rows dated TODAY. The result: the majority of permanent
`implied_snapshots` rows were written with a NULL fiscal key, so Task 8b's
`(fiscal_year, fiscal_quarter)` pairing — introduced specifically because
`report_date` pairing is unreliable — silently had nothing to join on.

This file tests the fix: `run_nightly_capture`'s three-leg fiscal resolution
(day-scoped Finnhub enrichment widened to every day in the window, a bounded
per-symbol FMP repair leg, and a hard refusal to write a row that still has
no fiscal key after both) plus the one-shot `repair_null_fiscal_keys`
backfill for rows already written wrong.

All `now` values are explicit (weekday-clock law) and no test depends on the
day it runs."""
import datetime as dt
import logging
from unittest.mock import patch

import pytest


@pytest.fixture()
def store(tmp_path, monkeypatch):
    monkeypatch.setenv("IMPLIED_STORE_DB", str(tmp_path / "implied.db"))
    import importlib
    from api.services import implied_store
    importlib.reload(implied_store)
    return implied_store


def _payload(pct=6.8):
    return {"pct": pct, "dollar": 12.5, "expiry": "2026-08-07", "strike": 185.0,
            "spot": 184.0, "call_mid": 6.3, "put_mid": 6.2, "iv_atm": 0.6,
            "horizon": "through 2026-08-07", "asof": "2026-08-03T21:00:00+00:00",
            "source": "massive-chain"}


# ── The core regression: an FMP-sourced T-1 (today+1) row ──────────────────

def test_fmp_sourced_tomorrow_row_gets_fiscal_key_via_day_enrichment(store):
    """THE regression test. `today+1` is the row shape the normal nightly
    capture actually writes (FMP primary, no session, no fiscal key). FAILS
    against the pre-fix code: the old `_finnhub_today_enrichment` trigger
    only ever fired for a row dated `today_iso`, so this tomorrow-dated
    row's fiscal_year/fiscal_quarter would still be None even after the old
    'backfill' ran (it would never even be attempted) -- the row would
    still capture (old code had no refusal gate), just with a NULL pairing
    key, reproducing the exact bug the plan describes. PASSES after: Leg 2
    widens the enrichment to every day in the window, so tomorrow's row
    gets a real fiscal identity and is captured under it."""
    now = dt.datetime(2026, 8, 5, 16, 40, tzinfo=store._ET)  # today=08-05; window default 1 -> 08-06 in-window
    reporters = [{"sym": "AAOI", "report_date": "2026-08-06", "hour": "",
                  "fiscal_year": None, "fiscal_quarter": None}]
    hints = {"AAOI": {"hour": "amc", "fiscal_year": 2026, "fiscal_quarter": 2}}
    with patch.object(store, "upcoming_reporters", return_value=reporters), \
         patch.object(store, "_finnhub_day_enrichment", return_value=hints) as enrich, \
         patch.object(store.implied_move, "get_expected_move", return_value=_payload()):
        summary = store.run_nightly_capture(now=now)

    enrich.assert_called_once_with("2026-08-06")
    assert summary["captured"] == 1
    assert summary["skipped_no_fiscal"] == 0
    rows = store.get_implied_history("AAOI")
    assert rows, "the T-1 row must still capture"
    assert rows[0]["fiscal_year"] == 2026, "a T-1 (today+1) row must get its fiscal key from day-scoped enrichment"
    assert rows[0]["fiscal_quarter"] == 2


# ── Leg 2 — widened to every distinct day in the window ────────────────────

def test_enrichment_runs_once_per_distinct_day_in_window_not_just_today(store):
    """window_days=1 -> two distinct days in-window (today, today+1). Both
    have a row missing its fiscal key -> exactly two enrichment calls, one
    per day, each hint scoped to its own day."""
    now = dt.datetime(2026, 8, 5, 16, 40, tzinfo=store._ET)
    reporters = [
        {"sym": "TODAYSYM", "report_date": "2026-08-05", "hour": "amc",
         "fiscal_year": None, "fiscal_quarter": None},
        {"sym": "TMRSYM", "report_date": "2026-08-06", "hour": "",
         "fiscal_year": None, "fiscal_quarter": None},
    ]

    def fake_enrichment(day_iso):
        if day_iso == "2026-08-05":
            return {"TODAYSYM": {"hour": "amc", "fiscal_year": 2026, "fiscal_quarter": 2}}
        if day_iso == "2026-08-06":
            return {"TMRSYM": {"hour": "bmo", "fiscal_year": 2026, "fiscal_quarter": 3}}
        return {}

    with patch.object(store, "upcoming_reporters", return_value=reporters), \
         patch.object(store, "_finnhub_day_enrichment", side_effect=fake_enrichment) as enrich, \
         patch.object(store.implied_move, "get_expected_move", return_value=_payload()):
        summary = store.run_nightly_capture(now=now)

    assert enrich.call_count == 2, "one call per distinct in-window day, capped at window_days + 1"
    assert {c.args[0] for c in enrich.call_args_list} == {"2026-08-05", "2026-08-06"}
    assert summary["captured"] == 2
    today_row = store.get_implied_history("TODAYSYM")[0]
    tmr_row = store.get_implied_history("TMRSYM")[0]
    assert today_row["fiscal_quarter"] == 2
    assert tmr_row["fiscal_quarter"] == 3, "tomorrow's row must capture regardless of hour -- window is [today,today+1]"


def test_enrichment_call_count_is_capped_at_window_days_plus_one(store):
    """IMPLIED_CAPTURE_WINDOW_DAYS=3 -> up to 4 distinct in-window days ->
    at most 4 enrichment calls, never one per reporter row."""
    import os
    now = dt.datetime(2026, 8, 5, 16, 40, tzinfo=store._ET)
    with patch.dict(os.environ, {"IMPLIED_CAPTURE_WINDOW_DAYS": "3"}):
        reporters = [
            {"sym": f"SYM{i}", "report_date": d, "hour": "amc", "fiscal_year": None, "fiscal_quarter": None}
            for i, d in enumerate(["2026-08-05", "2026-08-06", "2026-08-06",
                                    "2026-08-07", "2026-08-08"])
        ]
        with patch.object(store, "upcoming_reporters", return_value=reporters), \
             patch.object(store, "_finnhub_day_enrichment", return_value={}) as enrich, \
             patch.object(store, "_fmp_fiscal_repair", return_value=None), \
             patch.object(store.implied_move, "get_expected_move", return_value=_payload()):
            store.run_nightly_capture(now=now)
    assert enrich.call_count == 4, "5 reporter rows but only 4 distinct days -- must not call once per row"


# ── Leg 3 — bounded per-symbol FMP repair ───────────────────────────────────

def test_leg3_repairs_a_row_leg2_could_not(store):
    now = dt.datetime(2026, 8, 5, 16, 40, tzinfo=store._ET)
    reporters = [{"sym": "AAOI", "report_date": "2026-08-06", "hour": "amc",
                  "fiscal_year": None, "fiscal_quarter": None}]
    transcript_entries = [{"quarter": 2, "fiscalYear": 2026, "date": "2026-08-06"}]
    with patch.object(store, "upcoming_reporters", return_value=reporters), \
         patch.object(store, "_finnhub_day_enrichment", return_value={}), \
         patch.object(store, "_fmp_fiscal_repair", return_value=transcript_entries) as repair, \
         patch.object(store.implied_move, "get_expected_move", return_value=_payload()):
        summary = store.run_nightly_capture(now=now)
    repair.assert_called_once_with("AAOI")
    assert summary["captured"] == 1
    rows = store.get_implied_history("AAOI")
    assert rows[0]["fiscal_year"] == 2026 and rows[0]["fiscal_quarter"] == 2


def test_leg3_skipped_entirely_when_leg2_already_resolved_everything(store):
    now = dt.datetime(2026, 8, 5, 16, 40, tzinfo=store._ET)
    reporters = [{"sym": "AAOI", "report_date": "2026-08-06", "hour": "",
                  "fiscal_year": None, "fiscal_quarter": None}]
    hints = {"AAOI": {"hour": "amc", "fiscal_year": 2026, "fiscal_quarter": 2}}
    with patch.object(store, "upcoming_reporters", return_value=reporters), \
         patch.object(store, "_finnhub_day_enrichment", return_value=hints), \
         patch.object(store, "_fmp_fiscal_repair") as repair, \
         patch.object(store.implied_move, "get_expected_move", return_value=_payload()):
        summary = store.run_nightly_capture(now=now)
    repair.assert_not_called()
    assert summary["captured"] == 1


def test_leg3_skips_a_row_that_will_be_session_skipped_regardless(store):
    """A today-dated row whose session is STILL unconfirmed after Leg 2 will
    be skipped by the today-non-amc rule no matter what its fiscal key
    turns out to be -- Leg 3 must not spend one of its scarce per-symbol
    calls resolving a fiscal identity for a row that can never capture
    tonight."""
    now = dt.datetime(2026, 8, 5, 16, 40, tzinfo=store._ET)
    reporters = [{"sym": "MAYBEBMO", "report_date": "2026-08-05", "hour": "",
                  "fiscal_year": None, "fiscal_quarter": None}]
    with patch.object(store, "upcoming_reporters", return_value=reporters), \
         patch.object(store, "_finnhub_day_enrichment", return_value={}), \
         patch.object(store, "_fmp_fiscal_repair") as repair, \
         patch.object(store.implied_move, "get_expected_move", return_value=_payload()):
        summary = store.run_nightly_capture(now=now)
    repair.assert_not_called()
    assert summary["skipped"] == 1
    assert summary["skipped_no_fiscal"] == 0, "the row was skipped for SESSION reasons, not fiscal reasons"


def test_leg3_capped_at_20_distinct_symbols_per_night(store):
    now = dt.datetime(2026, 8, 5, 16, 40, tzinfo=store._ET)
    reporters = [{"sym": f"SYM{i:02d}", "report_date": "2026-08-06", "hour": "amc",
                  "fiscal_year": None, "fiscal_quarter": None} for i in range(25)]
    with patch.object(store, "upcoming_reporters", return_value=reporters), \
         patch.object(store, "_finnhub_day_enrichment", return_value={}), \
         patch.object(store, "_fmp_fiscal_repair", return_value=None) as repair, \
         patch.object(store.implied_move, "get_expected_move", return_value=_payload()):
        summary = store.run_nightly_capture(now=now)
    assert repair.call_count == 20, "Leg 3 must be hard-capped at 20 symbols per night"
    assert summary["skipped_no_fiscal"] == 25, "every row (capped or not) stays unresolved -- repair returned None"


def test_leg3_result_never_overwrites_a_value_leg2_already_supplied(store):
    """A row missing ONLY fiscal_quarter after Leg 2 must keep Leg 2's
    fiscal_year even if Leg 3's per-symbol lookup disagrees."""
    now = dt.datetime(2026, 8, 5, 16, 40, tzinfo=store._ET)
    reporters = [{"sym": "AAOI", "report_date": "2026-08-06", "hour": "amc",
                  "fiscal_year": 2026, "fiscal_quarter": None}]
    transcript_entries = [{"quarter": 4, "fiscalYear": 2099, "date": "2026-08-06"}]
    with patch.object(store, "upcoming_reporters", return_value=reporters), \
         patch.object(store, "_finnhub_day_enrichment", return_value={}), \
         patch.object(store, "_fmp_fiscal_repair", return_value=transcript_entries), \
         patch.object(store.implied_move, "get_expected_move", return_value=_payload()):
        summary = store.run_nightly_capture(now=now)
    assert summary["captured"] == 1
    rows = store.get_implied_history("AAOI")
    assert rows[0]["fiscal_year"] == 2026, "Leg 2/primary-supplied fiscal_year must never be overwritten by Leg 3"
    assert rows[0]["fiscal_quarter"] == 4, "the genuinely-missing field is still filled by Leg 3"


# ── Refuse to write an unpaired permanent row ───────────────────────────────

def test_row_unresolved_after_all_three_legs_is_never_captured(store, caplog):
    now = dt.datetime(2026, 8, 5, 16, 40, tzinfo=store._ET)
    reporters = [{"sym": "GHOST", "report_date": "2026-08-06", "hour": "amc",
                  "fiscal_year": None, "fiscal_quarter": None}]
    with patch.object(store, "upcoming_reporters", return_value=reporters), \
         patch.object(store, "_finnhub_day_enrichment", return_value={}), \
         patch.object(store, "_fmp_fiscal_repair", return_value=None), \
         patch.object(store.implied_move, "get_expected_move", return_value=_payload()) as get_move, \
         caplog.at_level(logging.WARNING, logger="api.services.implied_store"):
        summary = store.run_nightly_capture(now=now)
    assert summary["captured"] == 0
    assert summary["skipped_no_fiscal"] == 1
    assert not store.get_implied_history("GHOST"), \
        "a row with no fiscal identity must NEVER be written -- it can never pair with a history row"
    get_move.assert_not_called()  # the fiscal gate must short-circuit BEFORE the (costly) implied-move fetch
    assert "GHOST" in caplog.text and "fiscal" in caplog.text.lower()


def test_row_missing_only_fiscal_quarter_after_all_legs_is_still_refused(store):
    """BOTH fields are required -- a row with fiscal_year resolved but
    fiscal_quarter still None must not be treated as 'good enough'."""
    now = dt.datetime(2026, 8, 5, 16, 40, tzinfo=store._ET)
    reporters = [{"sym": "HALF", "report_date": "2026-08-06", "hour": "amc",
                  "fiscal_year": 2026, "fiscal_quarter": None}]
    with patch.object(store, "upcoming_reporters", return_value=reporters), \
         patch.object(store, "_finnhub_day_enrichment", return_value={}), \
         patch.object(store, "_fmp_fiscal_repair", return_value=None), \
         patch.object(store.implied_move, "get_expected_move", return_value=_payload()):
        summary = store.run_nightly_capture(now=now)
    assert summary["captured"] == 0
    assert summary["skipped_no_fiscal"] == 1
    assert not store.get_implied_history("HALF")


def test_row_with_full_fiscal_key_captures_normally_positive_control(store):
    """Positive control alongside the refusal tests above -- a row that DOES
    resolve both fields must still capture exactly as before."""
    now = dt.datetime(2026, 8, 5, 16, 40, tzinfo=store._ET)
    reporters = [{"sym": "GOODCO", "report_date": "2026-08-06", "hour": "amc",
                  "fiscal_year": 2026, "fiscal_quarter": 2}]
    with patch.object(store, "upcoming_reporters", return_value=reporters), \
         patch.object(store.implied_move, "get_expected_move", return_value=_payload()):
        summary = store.run_nightly_capture(now=now)
    assert summary == {"captured": 1, "skipped": 0, "failed": 0, "collisions": 0,
                       "skipped_no_fiscal": 0, "refused": 0, "refused_by_reason": {}}
    rows = store.get_implied_history("GOODCO")
    assert rows[0]["fiscal_year"] == 2026 and rows[0]["fiscal_quarter"] == 2


def test_skipped_no_fiscal_never_defaults_to_zero_it_is_absent(store):
    """Number(null)===0 guard: a genuinely-unresolved row must never end up
    stored with fiscal_year/fiscal_quarter coerced to 0 -- it must not be
    stored at all."""
    now = dt.datetime(2026, 8, 5, 16, 40, tzinfo=store._ET)
    reporters = [{"sym": "ZEROTRAP", "report_date": "2026-08-06", "hour": "amc",
                  "fiscal_year": None, "fiscal_quarter": None}]
    with patch.object(store, "upcoming_reporters", return_value=reporters), \
         patch.object(store, "_finnhub_day_enrichment", return_value={}), \
         patch.object(store, "_fmp_fiscal_repair", return_value=None), \
         patch.object(store.implied_move, "get_expected_move", return_value=_payload()):
        store.run_nightly_capture(now=now)
    assert store.get_implied_history("ZEROTRAP") == [], \
        "must be absent, never a row with fiscal_year/fiscal_quarter == 0"


# ── _nearest_fiscal_identity — pure helper ──────────────────────────────────

def test_nearest_fiscal_identity_picks_the_closest_dated_entry(store):
    entries = [
        {"quarter": 1, "fiscalYear": 2026, "date": "2026-02-01"},
        {"quarter": 2, "fiscalYear": 2026, "date": "2026-08-04"},  # closest to 08-06
        {"quarter": 3, "fiscalYear": 2026, "date": "2026-11-01"},
    ]
    fy, fq = store._nearest_fiscal_identity(entries, "2026-08-06")
    assert (fy, fq) == (2026, 2)


def test_nearest_fiscal_identity_skips_malformed_dates(store):
    entries = [{"quarter": 9, "fiscalYear": 9999, "date": "not-a-date"},
               {"quarter": 2, "fiscalYear": 2026, "date": "2026-08-05"}]
    fy, fq = store._nearest_fiscal_identity(entries, "2026-08-06")
    assert (fy, fq) == (2026, 2)


def test_nearest_fiscal_identity_empty_entries_returns_none_none(store):
    assert store._nearest_fiscal_identity([], "2026-08-06") == (None, None)


def test_nearest_fiscal_identity_unparseable_report_date_returns_none_none(store):
    entries = [{"quarter": 2, "fiscalYear": 2026, "date": "2026-08-05"}]
    assert store._nearest_fiscal_identity(entries, "not-a-date") == (None, None)


def test_nearest_fiscal_identity_never_derives_from_report_date_calendar_month(store):
    """AAPL's fiscal Q1 ends in December -- proving this function reads the
    PROVIDER's own quarter/fiscalYear fields and never derives a fiscal
    quarter from the report_date's own calendar month."""
    entries = [{"quarter": 1, "fiscalYear": 2027, "date": "2026-01-29"}]  # AAPL-shaped: fiscal Q1 reported in Jan
    fy, fq = store._nearest_fiscal_identity(entries, "2026-01-29")
    assert (fy, fq) == (2027, 1), "must trust the provider's own fiscalYear/quarter, not derive Q4-2026 from January"


# ── _fmp_fiscal_repair — bounded single-call unit ───────────────────────────

def test_fmp_fiscal_repair_returns_none_without_api_key(store, monkeypatch):
    monkeypatch.delenv("FMP_API_KEY", raising=False)
    assert store._fmp_fiscal_repair("AAOI") is None


def test_fmp_fiscal_repair_returns_none_on_http_error(store, monkeypatch):
    monkeypatch.setenv("FMP_API_KEY", "test-fmp-key")

    class _Resp:
        ok = False
        status_code = 500

    with patch("requests.get", return_value=_Resp()):
        assert store._fmp_fiscal_repair("AAOI") is None


def test_fmp_fiscal_repair_returns_none_on_network_error(store, monkeypatch):
    monkeypatch.setenv("FMP_API_KEY", "test-fmp-key")
    with patch("requests.get", side_effect=RuntimeError("connection reset")):
        assert store._fmp_fiscal_repair("AAOI") is None


def test_fmp_fiscal_repair_returns_the_raw_list_on_success(store, monkeypatch):
    monkeypatch.setenv("FMP_API_KEY", "test-fmp-key")

    class _Resp:
        ok = True
        status_code = 200

        def json(self):
            return [{"quarter": 2, "fiscalYear": 2026, "date": "2026-08-06"}]

    with patch("requests.get", return_value=_Resp()) as mocked_get:
        entries = store._fmp_fiscal_repair("AAOI")
    assert entries == [{"quarter": 2, "fiscalYear": 2026, "date": "2026-08-06"}]
    assert mocked_get.call_args.kwargs["params"]["symbol"] == "AAOI"


# ── _apply_fiscal_repair — pure merge, mutation safety ──────────────────────

def test_apply_fiscal_repair_fills_missing_fields_only(store):
    in_window = [{"sym": "AAOI", "report_date": "2026-08-06", "fiscal_year": None, "fiscal_quarter": None}]
    out = store._apply_fiscal_repair(in_window, {"AAOI": (2026, 2)})
    assert out[0]["fiscal_year"] == 2026 and out[0]["fiscal_quarter"] == 2


def test_apply_fiscal_repair_never_overwrites_a_known_value(store):
    in_window = [{"sym": "AAOI", "report_date": "2026-08-06", "fiscal_year": 2026, "fiscal_quarter": 1}]
    out = store._apply_fiscal_repair(in_window, {"AAOI": (2099, 4)})
    assert out[0]["fiscal_year"] == 2026 and out[0]["fiscal_quarter"] == 1


def test_apply_fiscal_repair_none_none_result_is_a_harmless_noop(store):
    in_window = [{"sym": "AAOI", "report_date": "2026-08-06", "fiscal_year": None, "fiscal_quarter": None}]
    out = store._apply_fiscal_repair(in_window, {"AAOI": (None, None)})
    assert out[0]["fiscal_year"] is None and out[0]["fiscal_quarter"] is None


def test_apply_fiscal_repair_never_mutates_input_dicts(store):
    original = {"sym": "AAOI", "report_date": "2026-08-06", "fiscal_year": None, "fiscal_quarter": None}
    in_window = [original]
    store._apply_fiscal_repair(in_window, {"AAOI": (2026, 2)})
    assert original["fiscal_year"] is None, "the ORIGINAL dict must be untouched"


def test_apply_fiscal_repair_noop_when_repaired_by_sym_empty(store):
    in_window = [{"sym": "AAOI", "report_date": "2026-08-06", "fiscal_year": None, "fiscal_quarter": None}]
    out = store._apply_fiscal_repair(in_window, {})
    assert out is in_window


# ── repair_null_fiscal_keys — one-shot backfill for the 739 already-null rows ─

def _write_raw_null_row(store, sym, report_date):
    """Write a row exactly the way the FMP-primary path did before this fix
    -- fiscal_year/fiscal_quarter NULL -- bypassing record_implied's default
    args (which already exist and are correct; this simulates the ALREADY
    WRITTEN-WRONG rows tonight's 739 represent)."""
    store.record_implied(sym, report_date, {"pct": 5.0, "dollar": 10.0}, "2026-08-04T21:00:00")


def test_repair_null_fiscal_keys_noop_when_nothing_is_null(store):
    store.record_implied("TST", "2026-08-06", {"pct": 5.0, "dollar": 10.0}, "2026-08-04T21:00:00",
                          fiscal_year=2026, fiscal_quarter=2)
    result = store.repair_null_fiscal_keys()
    assert result == {"total_null": 0, "resolved": 0, "written": 0}


def test_repair_null_fiscal_keys_fills_from_day_enrichment(store):
    _write_raw_null_row(store, "AAOI", "2026-08-06")
    hints = {"AAOI": {"hour": "amc", "fiscal_year": 2026, "fiscal_quarter": 2}}
    with patch.object(store, "_finnhub_day_enrichment", return_value=hints) as enrich:
        result = store.repair_null_fiscal_keys()
    enrich.assert_called_once_with("2026-08-06")
    assert result == {"total_null": 1, "resolved": 1, "written": 1}
    rows = store.get_implied_history("AAOI")
    assert rows[0]["fiscal_year"] == 2026 and rows[0]["fiscal_quarter"] == 2


def test_repair_null_fiscal_keys_falls_back_to_leg3_per_symbol(store):
    _write_raw_null_row(store, "AAOI", "2026-08-06")
    entries = [{"quarter": 3, "fiscalYear": 2026, "date": "2026-08-06"}]
    with patch.object(store, "_finnhub_day_enrichment", return_value={}), \
         patch.object(store, "_fmp_fiscal_repair", return_value=entries) as repair:
        result = store.repair_null_fiscal_keys()
    repair.assert_called_once_with("AAOI")
    assert result == {"total_null": 1, "resolved": 1, "written": 1}
    rows = store.get_implied_history("AAOI")
    assert rows[0]["fiscal_year"] == 2026 and rows[0]["fiscal_quarter"] == 3


def test_repair_null_fiscal_keys_leaves_genuinely_unresolvable_rows_null(store):
    _write_raw_null_row(store, "GHOST", "2026-08-06")
    with patch.object(store, "_finnhub_day_enrichment", return_value={}), \
         patch.object(store, "_fmp_fiscal_repair", return_value=None):
        result = store.repair_null_fiscal_keys()
    assert result == {"total_null": 1, "resolved": 0, "written": 0}
    rows = store.get_implied_history("GHOST")
    assert rows[0]["fiscal_year"] is None and rows[0]["fiscal_quarter"] is None


def test_repair_null_fiscal_keys_dry_run_writes_nothing(store):
    _write_raw_null_row(store, "AAOI", "2026-08-06")
    hints = {"AAOI": {"hour": "amc", "fiscal_year": 2026, "fiscal_quarter": 2}}
    with patch.object(store, "_finnhub_day_enrichment", return_value=hints):
        result = store.repair_null_fiscal_keys(dry_run=True)
    assert result == {"total_null": 1, "resolved": 1, "written": 0}
    rows = store.get_implied_history("AAOI")
    assert rows[0]["fiscal_year"] is None, "dry_run must never touch the DB"


def test_repair_null_fiscal_keys_never_overwrites_an_existing_value(store):
    """Idempotency / safety: a row that already carries fiscal_year but is
    missing fiscal_quarter must keep its fiscal_year untouched even if the
    repair legs disagree."""
    store.record_implied("PARTIAL", "2026-08-06", {"pct": 5.0, "dollar": 10.0}, "2026-08-04T21:00:00",
                          fiscal_year=2026, fiscal_quarter=None)
    hints = {"PARTIAL": {"hour": "amc", "fiscal_year": 2099, "fiscal_quarter": 4}}
    with patch.object(store, "_finnhub_day_enrichment", return_value=hints):
        result = store.repair_null_fiscal_keys()
    assert result["written"] == 1
    rows = store.get_implied_history("PARTIAL")
    assert rows[0]["fiscal_year"] == 2026, "an already-set field must NEVER be overwritten by the repair"
    assert rows[0]["fiscal_quarter"] == 4, "the genuinely-null field is still filled"


def test_repair_null_fiscal_keys_idempotent_across_two_runs(store):
    """Re-running the repair after it already succeeded must be a total
    no-op the second time -- 0 rows null, 0 written."""
    _write_raw_null_row(store, "AAOI", "2026-08-06")
    hints = {"AAOI": {"hour": "amc", "fiscal_year": 2026, "fiscal_quarter": 2}}
    with patch.object(store, "_finnhub_day_enrichment", return_value=hints):
        first = store.repair_null_fiscal_keys()
        second = store.repair_null_fiscal_keys()
    assert first["written"] == 1
    assert second == {"total_null": 0, "resolved": 0, "written": 0}
    rows = store.get_implied_history("AAOI")
    assert len(rows) == 1 and rows[0]["fiscal_year"] == 2026


def test_repair_null_fiscal_keys_limit_caps_leg3_symbol_spend(store):
    for i in range(5):
        _write_raw_null_row(store, f"SYM{i}", "2026-08-06")
    with patch.object(store, "_finnhub_day_enrichment", return_value={}), \
         patch.object(store, "_fmp_fiscal_repair", return_value=None) as repair:
        result = store.repair_null_fiscal_keys(limit=2)
    assert repair.call_count == 2, "limit must bound how many symbols spend the Leg 3 call"
    assert result["total_null"] == 5
    assert result["written"] == 0

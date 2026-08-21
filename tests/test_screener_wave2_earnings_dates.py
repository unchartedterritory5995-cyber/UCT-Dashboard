"""Wave 2 earnings dates — chunked FMP calendar pull + session parse.

NO real FMP calls anywhere here: every test that exercises `run_pull`
monkeypatches `api.services.earnings_estimates._fmp_get` directly.
"""
import datetime
import json

from zoneinfo import ZoneInfo

from api.services.screener import earnings_dates as ed


# ── chunk-window math ───────────────────────────────────────────────────────

def test_chunk_windows_are_84_contiguous_nonoverlapping_1day_spans():
    start = datetime.date(2026, 8, 22)
    windows = ed._chunk_windows(start)
    assert len(windows) == 84
    for d0, d1 in windows:
        assert d0 == d1  # 1 calendar day per chunk (the fix: was 7)
    for i in range(len(windows) - 1):
        # no gap, no overlap: the next window starts exactly one day after
        # the previous one ends
        assert windows[i][1] + datetime.timedelta(days=1) == windows[i + 1][0]
    assert windows[0][0] == start
    assert windows[-1][1] == start + datetime.timedelta(days=83)  # 84-day span total


def test_chunk_windows_ceiling_division_keeps_every_remainder_day():
    # total_days=10 isn't a multiple of chunk_days=3: floor division
    # (10 // 3 == 3) would silently drop day index 9 off the end of the
    # range. Ceiling division (this fix) must still cover all 10 days.
    start = datetime.date(2026, 8, 22)
    windows = ed._chunk_windows(start, total_days=10, chunk_days=3)
    assert len(windows) == 4  # ceil(10 / 3)
    # the final window is clamped to the range's real last day, not
    # overrun past it
    assert windows[-1] == (start + datetime.timedelta(days=9),
                            start + datetime.timedelta(days=9))
    covered = set()
    for d0, d1 in windows:
        d = d0
        while d <= d1:
            covered.add(d)
            d += datetime.timedelta(days=1)
    assert covered == {start + datetime.timedelta(days=i) for i in range(10)}


# ── threshold session parse ─────────────────────────────────────────────────

def test_session_threshold_parse_boundaries():
    assert ed._parse_session("09:29") == "bmo"
    assert ed._parse_session("09:30") == "tbd"   # boundary lands on the tbd side, never bmo by equality
    assert ed._parse_session("15:59") == "tbd"
    assert ed._parse_session("16:00") == "amc"
    assert ed._parse_session("16:01") == "amc"


def test_session_parse_degrades_to_tbd_on_junk_or_blank():
    assert ed._parse_session(None) == "tbd"
    assert ed._parse_session("") == "tbd"
    assert ed._parse_session("garbage") == "tbd"
    assert ed._parse_session("25:99") == "tbd"


def test_row_session_defaults_tbd_when_fmp_carries_no_session_field():
    # stable/earnings-calendar's documented gap (see implied_store's module
    # docstring) — no time/hour field on any row.
    assert ed._row_session({"symbol": "AAPL", "date": "2026-09-01"}) == "tbd"


def test_row_session_reads_a_defensive_time_field_if_ever_present():
    assert ed._row_session({"symbol": "AAPL", "date": "2026-09-01", "time": "09:00"}) == "bmo"
    assert ed._row_session({"symbol": "AAPL", "date": "2026-09-01", "hour": "16:30"}) == "amc"


# ── run_pull: dedup + receipt shape ─────────────────────────────────────────

def test_run_pull_earliest_future_date_wins_and_receipt_rows_is_deduped_union(monkeypatch, tmp_path):
    artifact_path = tmp_path / "edates.json"
    monkeypatch.setenv("SCREENER_EDATES_ARTIFACT", str(artifact_path))
    today = datetime.date(2026, 8, 22)

    def fake_fmp_get(path, params):
        assert path == "/stable/earnings-calendar"
        d0 = params["from"]
        if d0 == today.isoformat():
            # AAA's first sighting: 2026-08-25. BBB only ever appears here.
            return [
                {"symbol": "AAA", "date": "2026-08-25"},
                {"symbol": "BBB", "date": "2026-08-23"},
            ]
        if d0 == (today + datetime.timedelta(days=7)).isoformat():
            # AAA reappears with a LATER date — earliest must still win.
            return [{"symbol": "AAA", "date": "2026-08-30"}]
        return []

    monkeypatch.setattr(
        "api.services.earnings_estimates._fmp_get", fake_fmp_get)

    receipt = ed.run_pull(now=datetime.datetime(2026, 8, 22, 20, 0))

    assert receipt["requests"] == 84
    assert receipt["chunks_failed"] == 0
    assert receipt["chunks_at_cap"] == []
    assert receipt["wrote"] is True
    assert receipt["sessions_resolved"] == 0  # this endpoint carries no session field
    assert receipt["rows"] == {
        "AAA": {"date": "2026-08-25", "session": "tbd"},
        "BBB": {"date": "2026-08-23", "session": "tbd"},
    }

    with open(artifact_path) as fh:
        artifact = json.load(fh)
    assert artifact["as_of"] == today.isoformat()
    assert artifact["rows"] == receipt["rows"]  # artifact and receipt agree — one source of truth


def test_run_pull_skips_a_past_date_seen_in_the_window(monkeypatch, tmp_path):
    monkeypatch.setenv("SCREENER_EDATES_ARTIFACT", str(tmp_path / "edates.json"))
    today = datetime.date(2026, 8, 22)

    def fake_fmp_get(path, params):
        if params["from"] == today.isoformat():
            return [{"symbol": "OLD", "date": "2026-08-01"}]  # already reported — not "next"
        return []

    monkeypatch.setattr(
        "api.services.earnings_estimates._fmp_get", fake_fmp_get)
    receipt = ed.run_pull(now=datetime.datetime(2026, 8, 22, 20, 0))
    assert "OLD" not in receipt["rows"]
    assert receipt["wrote"] is False  # nothing survived -> nothing written


def test_run_pull_all_chunks_failing_preserves_a_prior_artifact(monkeypatch, tmp_path):
    artifact_path = tmp_path / "edates.json"
    monkeypatch.setenv("SCREENER_EDATES_ARTIFACT", str(artifact_path))
    prior = {"as_of": "2026-08-01",
             "rows": {"ZZZ": {"date": "2026-08-05", "session": "tbd"}}}
    artifact_path.write_text(json.dumps(prior))

    monkeypatch.setattr(
        "api.services.earnings_estimates._fmp_get", lambda path, params: None)

    receipt = ed.run_pull(now=datetime.datetime(2026, 8, 22, 20, 0))
    assert receipt["chunks_failed"] == 84
    assert receipt["wrote"] is False
    with open(artifact_path) as fh:
        assert json.load(fh) == prior  # untouched by the failed run


def test_run_pull_malformed_rows_are_skipped_not_fatal(monkeypatch, tmp_path):
    monkeypatch.setenv("SCREENER_EDATES_ARTIFACT", str(tmp_path / "edates.json"))
    today = datetime.date(2026, 8, 22)

    def fake_fmp_get(path, params):
        if params["from"] == today.isoformat():
            return [
                {"symbol": "", "date": "2026-08-25"},       # blank symbol
                {"symbol": "NODATE"},                        # no date at all
                {"symbol": "BADDATE", "date": "not-a-date"},  # unparsable
                {"symbol": "GOOD", "date": "2026-08-26"},
                "not-a-dict",
            ]
        return []

    monkeypatch.setattr(
        "api.services.earnings_estimates._fmp_get", fake_fmp_get)
    receipt = ed.run_pull(now=datetime.datetime(2026, 8, 22, 20, 0))
    assert receipt["rows"] == {"GOOD": {"date": "2026-08-26", "session": "tbd"}}


# ── at-cap detection ─────────────────────────────────────────────────────────

def test_run_pull_flags_a_chunk_at_the_fmp_row_cap_but_keeps_its_rows(monkeypatch, tmp_path):
    monkeypatch.setenv("SCREENER_EDATES_ARTIFACT", str(tmp_path / "edates.json"))
    today = datetime.date(2026, 8, 22)
    cap_day = (today + datetime.timedelta(days=5)).isoformat()

    def fake_fmp_get(path, params):
        if params["from"] == cap_day:
            # exactly 4,000 rows — the measured FMP response cap
            return [{"symbol": f"SYM{i}", "date": cap_day} for i in range(4000)]
        if params["from"] == today.isoformat():
            return [{"symbol": "NORMAL", "date": today.isoformat()}]
        return []

    monkeypatch.setattr(
        "api.services.earnings_estimates._fmp_get", fake_fmp_get)
    receipt = ed.run_pull(now=datetime.datetime(2026, 8, 22, 20, 0))

    # the suspect day is NAMED, not merely counted
    assert receipt["chunks_at_cap"] == [cap_day]
    # its rows are KEPT, never folded away just because the chunk looked truncated
    assert receipt["rows_seen"] == 4001
    assert "SYM0" in receipt["rows"]
    assert "SYM3999" in receipt["rows"]
    assert "NORMAL" in receipt["rows"]


def test_run_pull_no_chunks_at_cap_when_every_day_is_ordinary(monkeypatch, tmp_path):
    monkeypatch.setenv("SCREENER_EDATES_ARTIFACT", str(tmp_path / "edates.json"))
    today = datetime.date(2026, 8, 22)

    def fake_fmp_get(path, params):
        if params["from"] == today.isoformat():
            return [{"symbol": "NORMAL", "date": today.isoformat()}]
        return []

    monkeypatch.setattr(
        "api.services.earnings_estimates._fmp_get", fake_fmp_get)
    receipt = ed.run_pull(now=datetime.datetime(2026, 8, 22, 20, 0))
    assert receipt["chunks_at_cap"] == []


# ── ET clock ─────────────────────────────────────────────────────────────────

def test_run_pull_default_now_routes_through__now_et_not_the_naive_local_clock(monkeypatch):
    # Freeze the ONLY clock seam `run_pull` reads when `now` is omitted (the
    # half-faked-clock lesson: every source must be frozen, not just the ones
    # a test happens to touch). If `run_pull` ever regresses to a bare
    # `datetime.datetime.now()`, this test stops pinning `as_of` to the frozen
    # date and goes red.
    fixed = datetime.datetime(2026, 8, 21, 23, 30, tzinfo=ZoneInfo("America/New_York"))
    monkeypatch.setattr(ed, "_now_et", lambda: fixed)
    monkeypatch.setattr(
        "api.services.earnings_estimates._fmp_get", lambda path, params: [])

    receipt = ed.run_pull()  # now=None -> must route through _now_et()
    assert receipt["as_of"] == "2026-08-21"


def test_run_pull_et_evening_does_not_discard_a_report_dated_todays_et_date(monkeypatch, tmp_path):
    # Shape of the UTC-pod bug: a naive local `datetime.now()` between ~8pm
    # and midnight ET reads a calendar date one day AHEAD of ET's actual
    # today, so a report dated ET's real today was discarded as `rd <
    # today`. An aware ET evening `now` must not lose this row.
    monkeypatch.setenv("SCREENER_EDATES_ARTIFACT", str(tmp_path / "edates.json"))
    et_today = datetime.date(2026, 8, 21)
    aware_now = datetime.datetime(2026, 8, 21, 23, 15, tzinfo=ZoneInfo("America/New_York"))

    def fake_fmp_get(path, params):
        if params["from"] == et_today.isoformat():
            return [{"symbol": "TODAYREP", "date": et_today.isoformat()}]
        return []

    monkeypatch.setattr(
        "api.services.earnings_estimates._fmp_get", fake_fmp_get)
    receipt = ed.run_pull(now=aware_now)
    assert "TODAYREP" in receipt["rows"]
    assert receipt["as_of"] == et_today.isoformat()


# ── reader: healthy / missing / stale ───────────────────────────────────────

def test_read_earnings_dates_healthy(monkeypatch, tmp_path):
    path = tmp_path / "edates.json"
    monkeypatch.setenv("SCREENER_EDATES_ARTIFACT", str(path))
    today = datetime.date.today()
    artifact = {"as_of": today.isoformat(),
                "rows": {"AAA": {"date": "2026-09-01", "session": "bmo"},
                         "BBB": {"date": "2026-09-02", "session": "tbd"}}}
    path.write_text(json.dumps(artifact))

    failures = {}
    out = ed.read_earnings_dates(["AAA", "ccc"], failures=failures)
    assert out == {"AAA": {"next_earnings_date": "2026-09-01", "earnings_session": "bmo"}}
    assert "CCC" not in out  # absent from the pull -> absent from the output, not fabricated
    assert failures == {}  # a fresh, healthy artifact notes nothing


def test_read_earnings_dates_missing_artifact_is_noted_and_empty(tmp_path, monkeypatch):
    monkeypatch.setenv("SCREENER_EDATES_ARTIFACT", str(tmp_path / "nope.json"))
    failures = {}
    out = ed.read_earnings_dates(["AAA"], failures=failures)
    assert out == {}
    assert failures["earnings_dates"]["missing"] == 1


def test_read_earnings_dates_empty_rows_is_treated_as_missing(tmp_path, monkeypatch):
    path = tmp_path / "edates.json"
    monkeypatch.setenv("SCREENER_EDATES_ARTIFACT", str(path))
    path.write_text(json.dumps({"as_of": datetime.date.today().isoformat(), "rows": {}}))
    failures = {}
    out = ed.read_earnings_dates(["AAA"], failures=failures)
    assert out == {}
    assert failures["earnings_dates"]["missing"] == 1


def test_read_earnings_dates_stale_is_served_but_counted(tmp_path, monkeypatch):
    path = tmp_path / "edates.json"
    monkeypatch.setenv("SCREENER_EDATES_ARTIFACT", str(path))
    old = (datetime.date.today() - datetime.timedelta(days=10)).isoformat()
    artifact = {"as_of": old, "rows": {"AAA": {"date": "2026-09-01", "session": "bmo"}}}
    path.write_text(json.dumps(artifact))

    failures = {}
    out = ed.read_earnings_dates(["AAA"], failures=failures)
    assert out == {"AAA": {"next_earnings_date": "2026-09-01", "earnings_session": "bmo"}}
    assert failures["earnings_dates"]["stale:10d"] == 1


def test_read_earnings_dates_at_the_stale_boundary_is_not_yet_stale(tmp_path, monkeypatch):
    path = tmp_path / "edates.json"
    monkeypatch.setenv("SCREENER_EDATES_ARTIFACT", str(path))
    boundary = (datetime.date.today() - datetime.timedelta(days=ed._STALE_DAYS)).isoformat()
    artifact = {"as_of": boundary, "rows": {"AAA": {"date": "2026-09-01", "session": "bmo"}}}
    path.write_text(json.dumps(artifact))

    failures = {}
    ed.read_earnings_dates(["AAA"], failures=failures)
    assert failures == {}  # exactly _STALE_DAYS old is still fresh, not yet stale


# ── build_row derivation (days_to_earnings) ─────────────────────────────────

def test_days_to_earnings_derivation():
    from api.services.screener import snapshot_builder
    bars = [{"o": 100, "h": 101, "l": 99, "c": 100, "v": 1000}] * 40
    future = (datetime.date.today() + datetime.timedelta(days=5)).isoformat()
    row = snapshot_builder.build_row(
        "T", bars, None, {"next_earnings_date": future})
    assert row["days_to_earnings"] == 5


def test_days_to_earnings_derivation_handles_junk_date():
    from api.services.screener import snapshot_builder
    bars = [{"o": 100, "h": 101, "l": 99, "c": 100, "v": 1000}] * 40
    row = snapshot_builder.build_row(
        "T", bars, None, {"next_earnings_date": "junk"})
    assert row["days_to_earnings"] is None


def test_days_to_earnings_absent_when_no_next_earnings_date():
    from api.services.screener import snapshot_builder
    bars = [{"o": 100, "h": 101, "l": 99, "c": 100, "v": 1000}] * 40
    row = snapshot_builder.build_row("T", bars, None, {})
    assert row["days_to_earnings"] is None

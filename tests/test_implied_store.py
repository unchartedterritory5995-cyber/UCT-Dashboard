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


def test_record_implied_first_write_wins(store):
    store.record_implied("TST", "2026-08-06", _payload(6.8), "2026-08-03T21:00:00")
    store.record_implied("TST", "2026-08-06", _payload(9.9), "2026-08-05T21:00:00")
    rows = store.get_implied_history("TST")
    assert len(rows) == 1 and abs(rows[0]["pct"] - 6.8) < 1e-9, \
        "the earliest (furthest-from-print) snapshot is the honest 'implied at the time'"


def test_get_implied_history_newest_report_first(store):
    store.record_implied("TST", "2026-05-06", _payload(4.0), "2026-05-05T21:00:00")
    store.record_implied("TST", "2026-08-06", _payload(6.8), "2026-08-03T21:00:00")
    rows = store.get_implied_history("TST", limit=8)
    assert [r["report_date"] for r in rows] == ["2026-08-06", "2026-05-06"]


def test_grade_snapshots_roundtrip(store):
    store.record_grade("TST", "2026-08-03", "setup", "A-",
                       {"streak": "7/8", "revisions": "21/3", "rs": 94, "iv": "rich"})
    rows = store.get_grade_history("TST", "setup")
    assert rows[0]["grade"] == "A-" and rows[0]["inputs"]["rs"] == 94


def test_run_nightly_capture_stores_only_successes(store):
    # now = 2026-08-03T16:40 -> today = 2026-08-03; window default = 1 day, so
    # 2026-08-04 (tomorrow) is in-window.
    reporters = [{"sym": "GOOD", "report_date": "2026-08-04", "hour": "amc",
                  "fiscal_year": 2026, "fiscal_quarter": 3},
                 {"sym": "BAD", "report_date": "2026-08-04", "hour": "amc",
                  "fiscal_year": 2026, "fiscal_quarter": 3}]
    def fake_move(sym, report_date=None, **_kw):
        return _payload() if sym == "GOOD" else None
    with patch.object(store, "upcoming_reporters", return_value=reporters), \
         patch.object(store.implied_move, "get_expected_move", side_effect=fake_move):
        summary = store.run_nightly_capture(now=dt.datetime(2026, 8, 3, 16, 40))
    assert summary["captured"] == 1 and summary["failed"] == 1
    assert store.get_implied_history("GOOD") and not store.get_implied_history("BAD"), \
        "a failed fetch must never be stored as a value"


def test_run_nightly_capture_noop_when_no_reporters(store):
    with patch.object(store, "upcoming_reporters", return_value=[]):
        summary = store.run_nightly_capture(now=dt.datetime(2026, 8, 3, 16, 40))
    assert summary == {"captured": 0, "skipped": 0, "failed": 0, "collisions": 0,
                        "skipped_no_fiscal": 0, "refused": 0, "refused_by_reason": {}}


def test_run_nightly_capture_isolates_a_raising_reporter(store):
    reporters = [{"sym": "OK1", "report_date": "2026-08-04", "hour": "amc",
                  "fiscal_year": 2026, "fiscal_quarter": 3},
                 {"sym": "BOOM", "report_date": "2026-08-04", "hour": "amc",
                  "fiscal_year": 2026, "fiscal_quarter": 3},
                 {"sym": "OK2", "report_date": "2026-08-04", "hour": "amc",
                  "fiscal_year": 2026, "fiscal_quarter": 3}]
    def fake_move(sym, report_date=None, **_kw):
        if sym == "BOOM":
            raise RuntimeError("chain exploded")
        return _payload()
    with patch.object(store, "upcoming_reporters", return_value=reporters), \
         patch.object(store.implied_move, "get_expected_move", side_effect=fake_move):
        summary = store.run_nightly_capture(now=dt.datetime(2026, 8, 3, 16, 40))
    assert summary == {"captured": 2, "skipped": 0, "failed": 1, "collisions": 0,
                        "skipped_no_fiscal": 0, "refused": 0, "refused_by_reason": {}}
    assert store.get_implied_history("OK2"), "reporters after the raiser must still capture"


def test_run_nightly_capture_window_and_bmo_today_skip(store):
    """C1: the capture window narrows to [today, today+WINDOW]; a report_date
    before today is silently filtered (never counted), a report_date == today
    with hour == 'bmo' is skipped (counted — already reported this morning),
    and an amc-today or tomorrow reporter still captures (the T-1/T-0-pre-
    report write)."""
    now = dt.datetime(2026, 8, 3, 21, 0)  # today = 2026-08-03
    reporters = [
        {"sym": "PAST", "report_date": "2026-08-02", "hour": "amc"},
        {"sym": "BMOTODAY", "report_date": "2026-08-03", "hour": "bmo"},
        {"sym": "AMCTODAY", "report_date": "2026-08-03", "hour": "amc",
         "fiscal_year": 2026, "fiscal_quarter": 2},
        {"sym": "TOMORROW", "report_date": "2026-08-04", "hour": "bmo",
         "fiscal_year": 2026, "fiscal_quarter": 2},
    ]
    with patch.object(store, "upcoming_reporters", return_value=reporters), \
         patch.object(store.implied_move, "get_expected_move", side_effect=lambda sym, report_date=None, **_kw: _payload()):
        summary = store.run_nightly_capture(now=now)
    assert summary["captured"] == 2, "amc-today and tomorrow reporters must capture"
    assert summary["skipped"] == 1, "only the bmo-today reporter counts as skipped"
    assert summary["failed"] == 0
    assert store.get_implied_history("AMCTODAY")
    assert store.get_implied_history("TOMORROW")
    assert not store.get_implied_history("BMOTODAY"), \
        "bmo-today must never be captured — it would store an IV-crushed value"
    assert not store.get_implied_history("PAST"), \
        "a report_date before today must be filtered out, not captured"


def test_run_nightly_capture_defaults_now_to_et_with_tz_aware_captured_at(store, monkeypatch):
    """I6: the production default path (no `now` arg) must use ET, and the
    stored captured_at must be tz-aware — not silently untested because every
    other test injects a naive `now`."""
    report_date = dt.datetime.now(store._ET).date().isoformat()  # today, amc -> in-window, not the bmo-today skip
    reporters = [{"sym": "DEFNOW", "report_date": report_date, "hour": "amc",
                  "fiscal_year": 2026, "fiscal_quarter": 3}]
    with patch.object(store, "upcoming_reporters", return_value=reporters), \
         patch.object(store.implied_move, "get_expected_move", return_value=_payload()):
        summary = store.run_nightly_capture()
    assert summary["captured"] == 1
    rows = store.get_implied_history("DEFNOW")
    assert rows, "the in-window reporter must have captured"
    parsed = dt.datetime.fromisoformat(rows[0]["captured_at"])
    assert parsed.tzinfo is not None, "captured_at must be tz-aware when now is defaulted"


def test_get_earliest_report_date(store):
    store.record_implied("TST", "2026-05-06", _payload(4.0), "2026-05-05T21:00:00")
    store.record_implied("TST", "2026-08-06", _payload(6.8), "2026-08-03T21:00:00")
    assert store.get_earliest_report_date("TST") == "2026-05-06"
    assert store.get_earliest_report_date("NOPE") is None


def test_record_implied_and_history_canonicalize_class_share_symbol(store):
    """C2: the canonical store form is upper+hyphen (BRK-B), matching the
    repo-wide groups.py/theme_index.py convention — a dot-form write must be
    readable via the hyphen form."""
    store.record_implied("BRK.B", "2026-08-06", _payload(), "2026-08-03T21:00:00")
    rows = store.get_implied_history("BRK-B")
    assert len(rows) == 1 and rows[0]["sym"] == "BRK-B"


# ── P2 T8b — fiscal_year/fiscal_quarter pairing key ─────────────────────────

def test_record_implied_and_history_carry_fiscal_key(store):
    """The provider's own fiscal identity round-trips through the store —
    this is what a client pairs a past history row against, since that row's
    true announcement date is usually unknown."""
    store.record_implied("TST", "2026-07-30", _payload(6.8), "2026-07-29T21:00:00",
                          fiscal_year=2026, fiscal_quarter=2)
    rows = store.get_implied_history("TST")
    assert rows[0]["fiscal_year"] == 2026
    assert rows[0]["fiscal_quarter"] == 2


def test_fiscal_key_is_optional_and_additive(store):
    """A caller that omits fiscal_year/fiscal_quarter (every existing call
    site before this task) must keep writing exactly as before — absent, not
    a phantom 0."""
    store.record_implied("TST", "2026-05-06", _payload(4.0), "2026-05-05T21:00:00")
    rows = store.get_implied_history("TST")
    assert rows[0]["fiscal_year"] is None
    assert rows[0]["fiscal_quarter"] is None


def test_fiscal_key_zero_survives_instead_of_flattening_to_none(store):
    """Neither field is ever genuinely 0 in practice, but the storage layer
    must not special-case 0 into NULL — the same phantom-zero trap in reverse."""
    store.record_implied("TST", "2026-07-30", _payload(), "2026-07-29T21:00:00",
                          fiscal_year=0, fiscal_quarter=0)
    rows = store.get_implied_history("TST")
    assert rows[0]["fiscal_year"] == 0
    assert rows[0]["fiscal_quarter"] == 0


def test_record_implied_first_write_wins_covers_the_fiscal_key_too(store):
    """First-write-wins (I5) must hold for the WHOLE row, including the new
    columns — a re-run must not quietly patch the fiscal key onto an already-
    captured snapshot."""
    store.record_implied("TST", "2026-08-06", _payload(6.8), "2026-08-03T21:00:00",
                          fiscal_year=2026, fiscal_quarter=2)
    store.record_implied("TST", "2026-08-06", _payload(9.9), "2026-08-05T21:00:00",
                          fiscal_year=2026, fiscal_quarter=3)
    rows = store.get_implied_history("TST")
    assert len(rows) == 1
    assert rows[0]["pct"] == pytest.approx(6.8)
    assert rows[0]["fiscal_quarter"] == 2, "the FIRST write's fiscal key must win, not the second"


def test_upcoming_reporters_carries_fiscal_year_and_quarter(store, monkeypatch):
    """upcoming_reporters is the source of the fiscal key that flows into
    record_implied via run_nightly_capture — Finnhub's own quarter/year on
    /calendar/earnings, distinguished from a missing value.

    upcoming_reporters now routes through the shared finnhub_client.fh_get
    (2026-08-05, requests-based) instead of a raw httpx.get — patch the real
    HTTP call site (requests.get) rather than the now-removed store.httpx.
    """
    class _Resp:
        status_code = 200

        def raise_for_status(self):
            pass

        def json(self):
            return {"earningsCalendar": [
                {"symbol": "TST", "date": "2026-07-30", "hour": "amc", "quarter": 2, "year": 2026},
                {"symbol": "NOQ", "date": "2026-07-31", "hour": "bmo"},  # no quarter/year at all
            ]}

    monkeypatch.setenv("FINNHUB_API_KEY", "test-key")
    with patch("requests.get", return_value=_Resp()):
        reporters = store.upcoming_reporters(days=14, now=dt.datetime(2026, 7, 20))
    by_sym = {r["sym"]: r for r in reporters}
    assert by_sym["TST"]["fiscal_year"] == 2026
    assert by_sym["TST"]["fiscal_quarter"] == 2
    assert by_sym["NOQ"]["fiscal_year"] is None
    assert by_sym["NOQ"]["fiscal_quarter"] is None


def test_run_nightly_capture_carries_fiscal_key_through_to_the_stored_row(store):
    """The end-to-end path: a reporter row from upcoming_reporters carrying a
    fiscal key must land on the STORED snapshot, not just be read and dropped."""
    reporters = [{"sym": "TST", "report_date": "2026-08-04", "hour": "amc",
                  "fiscal_year": 2026, "fiscal_quarter": 3}]
    with patch.object(store, "upcoming_reporters", return_value=reporters), \
         patch.object(store.implied_move, "get_expected_move", return_value=_payload()):
        summary = store.run_nightly_capture(now=dt.datetime(2026, 8, 3, 16, 40))
    assert summary["captured"] == 1
    rows = store.get_implied_history("TST")
    assert rows[0]["fiscal_year"] == 2026
    assert rows[0]["fiscal_quarter"] == 3


# ── Review round 1 CRITICAL — duplicate-announcement-date reporter ─────────
# Live observation: Finnhub's /calendar/earnings listed GLOO's 2026-08-17
# report TWICE under two DIFFERENT fiscal quarters — one with a real
# epsEstimate (the genuine row) and one with epsEstimate=null (an apparent
# placeholder). Left undeduped, `_has_snapshot`/`INSERT OR IGNORE` files the
# PERMANENT snapshot under whichever row happened to be first in Finnhub's
# array — provider array order, not anything meaningful — and that identity
# can never be corrected after the fact.
_GLOO_REAL = {"sym": "GLOO", "report_date": "2026-08-17", "hour": "amc",
              "fiscal_year": 2027, "fiscal_quarter": 2, "eps_estimate": -0.187}
_GLOO_PLACEHOLDER = {"sym": "GLOO", "report_date": "2026-08-17", "hour": "amc",
                     "fiscal_year": 2026, "fiscal_quarter": 2, "eps_estimate": None}


def test_dedupe_reporters_prefers_the_row_with_a_real_eps_estimate(store):
    deduped, collisions = store._dedupe_reporters([_GLOO_REAL, _GLOO_PLACEHOLDER])
    assert len(collisions) == 1
    assert collisions[0]["distinct"] is True
    assert len(deduped) == 1
    assert deduped[0]["fiscal_year"] == 2027 and deduped[0]["fiscal_quarter"] == 2


def test_dedupe_reporters_is_order_independent(store):
    """The exact GLOO pair, in BOTH array orders — must resolve to the SAME
    fiscal identity either way. This is the whole point of the fix: order
    must never decide identity."""
    order_a, collisions_a = store._dedupe_reporters([_GLOO_REAL, _GLOO_PLACEHOLDER])
    order_b, collisions_b = store._dedupe_reporters([_GLOO_PLACEHOLDER, _GLOO_REAL])
    assert len(collisions_a) == len(collisions_b) == 1
    assert order_a[0]["fiscal_year"] == order_b[0]["fiscal_year"] == 2027
    assert order_a[0]["fiscal_quarter"] == order_b[0]["fiscal_quarter"] == 2


def test_dedupe_reporters_no_collision_when_dates_differ(store):
    """Two DIFFERENT (sym, report_date) reporters are never merged — dedup
    keys on the pair, not the symbol alone."""
    a = {"sym": "GLOO", "report_date": "2026-08-17", "hour": "amc",
         "fiscal_year": 2027, "fiscal_quarter": 2, "eps_estimate": -0.187}
    b = {"sym": "GLOO", "report_date": "2026-11-16", "hour": "amc",
         "fiscal_year": 2027, "fiscal_quarter": 3, "eps_estimate": -0.1}
    deduped, collisions = store._dedupe_reporters([a, b])
    assert collisions == []
    assert len(deduped) == 2


def test_reporter_preferred_tie_break_on_fiscal_key_when_both_have_no_estimate(store):
    """When NEITHER row has an eps_estimate, the tie-break falls to the
    higher (year, quarter) — deterministic either way, not first-wins."""
    older = {"eps_estimate": None, "fiscal_year": 2026, "fiscal_quarter": 2}
    newer = {"eps_estimate": None, "fiscal_year": 2027, "fiscal_quarter": 2}
    assert store._reporter_preferred(newer, older) is True
    assert store._reporter_preferred(older, newer) is False


def test_reporter_preferred_negative_eps_estimate_counts_as_present(store):
    """A genuinely negative eps_estimate (GLOO's -0.187) must never be
    treated as absent — this is the `is not None` guard, not a truthy check."""
    has_negative = {"eps_estimate": -0.187, "fiscal_year": 2026, "fiscal_quarter": 1}
    has_none = {"eps_estimate": None, "fiscal_year": 2030, "fiscal_quarter": 4}
    assert store._reporter_preferred(has_negative, has_none) is True


def test_reporter_preferred_eps_estimate_zero_counts_as_present(store):
    """The same phantom-zero trap this whole task exists to guard against, on
    the tie-break's OWN input: a genuine 0.0 eps_estimate is falsy in Python,
    so a bare truthy check (`if new.get("eps_estimate")`) would wrongly treat
    it as absent. Must be `is not None`."""
    has_zero = {"eps_estimate": 0.0, "fiscal_year": 2026, "fiscal_quarter": 1}
    has_none = {"eps_estimate": None, "fiscal_year": 2030, "fiscal_quarter": 4}
    assert store._reporter_preferred(has_zero, has_none) is True


def test_run_nightly_capture_stores_the_same_identity_regardless_of_reporter_array_order(store):
    """End-to-end: the real GLOO pair, fed through the actual capture loop,
    in both array orders — must store the SAME (fiscal_year, fiscal_quarter)
    either way, and must count exactly one collision."""
    now = dt.datetime(2026, 8, 16, 21, 0)  # today = 2026-08-16; window default 1d -> 08-17 in-window

    for order_name, order in (("A_then_B", [_GLOO_REAL, _GLOO_PLACEHOLDER]),
                               ("B_then_A", [_GLOO_PLACEHOLDER, _GLOO_REAL])):
        # Fresh DB per order so first-write-wins from a prior iteration can't
        # mask a real order-dependence bug.
        with patch.object(store, "upcoming_reporters", return_value=list(order)), \
             patch.object(store.implied_move, "get_expected_move", return_value=_payload()):
            summary = store.run_nightly_capture(now=now)
        assert summary["captured"] == 1, order_name
        assert summary["collisions"] == 1, order_name
        rows = store.get_implied_history("GLOO")
        assert len(rows) == 1, order_name
        assert rows[0]["fiscal_year"] == 2027, order_name
        assert rows[0]["fiscal_quarter"] == 2, order_name
        # Reset for the next order in this loop.
        import sqlite3
        with sqlite3.connect(store.DB_PATH) as c:
            c.execute("DELETE FROM implied_snapshots WHERE sym = 'GLOO'")


# ── Review round 2 CRITICAL — the tie-break itself fell through to array
# order on a full tie (eps-presence + fiscal key equal, `hour` differing).
# Live observation: Finnhub listed a duplicate (sym, report_date) where BOTH
# rows had epsEstimate=null and the SAME fiscal year/quarter, but one carried
# hour='bmo' and the other hour='amc' — and `hour` is the ONE field
# run_nightly_capture reads immediately after dedup resolves (the bmo-today
# skip). Order decided whether tonight's capture fired at all, or ran under
# the wrong session and risked storing an IV-crushed value forever.
_DUPH_BMO = {"sym": "DUPH", "report_date": "2026-08-17", "hour": "bmo",
             "fiscal_year": 2026, "fiscal_quarter": 2, "eps_estimate": None}
_DUPH_AMC = {"sym": "DUPH", "report_date": "2026-08-17", "hour": "amc",
             "fiscal_year": 2026, "fiscal_quarter": 2, "eps_estimate": None}


def test_reporter_preferred_strict_greater_not_greater_equal_on_a_full_tie(store):
    """Direct contract test on `_reporter_preferred` ITSELF, not the pipeline
    output — a `>` mutated to `>=` (reviewer's M16) would flip this to True.
    A genuine full tie (content-identical rows, verified via the canonical-
    serialization tie-break) has NO observable effect on stored data — the
    two candidates are indistinguishable by construction — so no pipeline-
    level assertion can catch a `>`/`>=` swap here; this locks the function's
    own strict-greater-than contract directly."""
    a = {"sym": "X", "report_date": "2026-01-01", "hour": "amc",
         "fiscal_year": 2026, "fiscal_quarter": 1, "eps_estimate": 1.5}
    b = dict(a)  # content-identical, different object
    assert store._reporter_preferred(b, a) is False


def test_dedupe_reporters_hour_tie_break_is_order_independent(store):
    """The exact DUPH pair (ties on eps-presence + fiscal key, differs only
    on hour), in BOTH array orders — must resolve to the SAME hour either
    way. Biased toward 'bmo' (the safe/skip direction, see `_hour_rank`)."""
    order_a, collisions_a = store._dedupe_reporters([_DUPH_BMO, _DUPH_AMC])
    order_b, collisions_b = store._dedupe_reporters([_DUPH_AMC, _DUPH_BMO])
    assert len(collisions_a) == len(collisions_b) == 1
    assert collisions_a[0]["distinct"] is True and collisions_b[0]["distinct"] is True
    assert order_a[0]["hour"] == order_b[0]["hour"] == "bmo"


def test_run_nightly_capture_hour_collision_resolves_identically_both_orders(store):
    """End-to-end reproduction of the review's exact DUPH finding: report_date
    == today, one candidate row 'bmo', one 'amc', otherwise tied. Before the
    fix: [bmo, amc] captured NOTHING (permanently — the window never revisits
    today on a later run), while [amc, bmo] STORED a value that would be
    IV-crushed if 'bmo' was actually true. Now both orders resolve to the
    SAME (safe) outcome: bmo wins deterministically -> skip, never stored."""
    now = dt.datetime(2026, 8, 17, 21, 0)  # today == the report_date itself

    for order_name, order in (("bmo_then_amc", [_DUPH_BMO, _DUPH_AMC]),
                               ("amc_then_bmo", [_DUPH_AMC, _DUPH_BMO])):
        with patch.object(store, "upcoming_reporters", return_value=list(order)), \
             patch.object(store.implied_move, "get_expected_move", return_value=_payload()):
            summary = store.run_nightly_capture(now=now)
        assert summary == {"captured": 0, "skipped": 1, "failed": 0, "collisions": 1,
                            "skipped_no_fiscal": 0, "refused": 0,
                            "refused_by_reason": {}}, order_name
        assert not store.get_implied_history("DUPH"), \
            f"{order_name}: bmo must win deterministically -> skipped, never stored"


# ── Review round 3 CRITICAL — `_hour_rank` must normalize the SAME way
# `run_nightly_capture` does (`.lower()`), and the bias must be proven
# load-bearing rather than an accident of ASCII string ordering.
_DUPH_BMO_UPPER = {"sym": "DUPH", "report_date": "2026-08-17", "hour": "BMO",
                   "fiscal_year": 2026, "fiscal_quarter": 2, "eps_estimate": None}
# 'dmh' sorts ABOVE 'bmo' in plain ASCII/canonical-string order ('d'=100 >
# 'b'=98) — unlike 'amc' (which happens to sort below 'bmo' by accident), so
# a bmo/dmh collision is what actually PROVES _hour_rank's bias is
# load-bearing: without it, canonical-string comparison alone would pick
# 'dmh' (wrong/unsafe direction), not 'bmo'.
_DUPH_DMH = {"sym": "DUPH", "report_date": "2026-08-17", "hour": "dmh",
             "fiscal_year": 2026, "fiscal_quarter": 2, "eps_estimate": None}


def test_hour_rank_is_case_and_whitespace_insensitive(store):
    assert store._hour_rank("BMO") == 1
    assert store._hour_rank("Bmo") == 1
    assert store._hour_rank(" bmo ") == 1
    assert store._hour_rank("amc") == 0
    assert store._hour_rank("AMC") == 0
    assert store._hour_rank(None) == 0
    assert store._hour_rank("") == 0


def test_hour_rank_bias_is_load_bearing_against_an_hour_that_sorts_above_bmo(store):
    """'dmh' > 'bmo' in canonical-string order, so a mutation hardcoding
    _hour_rank to always return 0 would survive a bmo/amc test (ASCII
    already favours bmo there by accident) but must die here: without the
    explicit bias, the bmo/dmh tie falls through to canonical comparison and
    'dmh' wins -- the WRONG (unsafe) direction."""
    order_a, _ = store._dedupe_reporters([_DUPH_BMO, _DUPH_DMH])
    order_b, _ = store._dedupe_reporters([_DUPH_DMH, _DUPH_BMO])
    assert order_a[0]["hour"] == order_b[0]["hour"] == "bmo"


def test_dedupe_reporters_hour_tie_break_is_case_insensitive(store):
    """Review round 3 CRITICAL — run_nightly_capture normalizes hour with
    .lower() before the bmo-today check; _hour_rank must match that
    normalization or an uppercase 'BMO' row silently loses its safety bias."""
    order_a, _ = store._dedupe_reporters([_DUPH_BMO_UPPER, _DUPH_AMC])
    order_b, _ = store._dedupe_reporters([_DUPH_AMC, _DUPH_BMO_UPPER])
    assert order_a[0]["hour"] == order_b[0]["hour"] == "BMO"


def test_run_nightly_capture_hour_collision_case_insensitive_both_orders(store):
    """End-to-end: an uppercase 'BMO' row must resolve identically to the
    lowercase case — skipped, never stored, regardless of array order.
    Verified broken before the fix: [BMO, amc] captured=1/stored=1 (an
    IV-crushed value written permanently), while a lone 'BMO' row (no
    collision) correctly skips -- proving the bug was specific to the
    tie-break, not the bmo-today check itself."""
    now = dt.datetime(2026, 8, 17, 21, 0)  # today == the report_date itself

    for order_name, order in (("BMO_then_amc", [_DUPH_BMO_UPPER, _DUPH_AMC]),
                               ("amc_then_BMO", [_DUPH_AMC, _DUPH_BMO_UPPER])):
        with patch.object(store, "upcoming_reporters", return_value=list(order)), \
             patch.object(store.implied_move, "get_expected_move", return_value=_payload()):
            summary = store.run_nightly_capture(now=now)
        assert summary == {"captured": 0, "skipped": 1, "failed": 0, "collisions": 1,
                            "skipped_no_fiscal": 0, "refused": 0,
                            "refused_by_reason": {}}, order_name
        assert not store.get_implied_history("DUPH"), order_name


# ── Review round 2 IMPORTANT #2 — the collision warning must not read as
# noise: scoped to collisions that are BOTH inside tonight's capture window
# AND genuinely content-differing (not a harmless byte-identical repeat).

def test_run_nightly_capture_does_not_warn_on_a_harmless_identical_duplicate(store, caplog):
    now = dt.datetime(2026, 8, 17, 21, 0)  # today == DUPH's report_date -> in-window
    reporters = [_DUPH_BMO, dict(_DUPH_BMO)]  # byte-identical repeat
    with patch.object(store, "upcoming_reporters", return_value=reporters), \
         patch.object(store.implied_move, "get_expected_move", return_value=_payload()), \
         caplog.at_level(logging.WARNING, logger="api.services.implied_store"):
        summary = store.run_nightly_capture(now=now)
    assert summary["collisions"] == 1
    assert "duplicate" not in caplog.text, "a harmless byte-identical tie must not warn"


def test_run_nightly_capture_warns_on_a_genuine_in_window_collision(store, caplog):
    now = dt.datetime(2026, 8, 17, 21, 0)  # today == DUPH's report_date -> in-window
    reporters = [_DUPH_BMO, _DUPH_AMC]  # genuinely differs (hour)
    with patch.object(store, "upcoming_reporters", return_value=reporters), \
         patch.object(store.implied_move, "get_expected_move", return_value=_payload()), \
         caplog.at_level(logging.WARNING, logger="api.services.implied_store"):
        summary = store.run_nightly_capture(now=now)
    assert summary["collisions"] == 1
    assert "duplicate" in caplog.text, "a genuine in-window collision must be surfaced"


def test_run_nightly_capture_does_not_warn_on_an_out_of_window_collision(store, caplog):
    """A collision counted in the 14-day total but landing OUTSIDE tonight's
    [today, today+WINDOW] range must not fire the scoped warning — it isn't
    tonight's problem yet (and by the time it IS, upcoming_reporters will
    have re-fetched a fresh 14-day list anyway)."""
    now = dt.datetime(2026, 8, 1, 21, 0)  # today = 2026-08-01; DUPH's 08-17 is well outside
    reporters = [_DUPH_BMO, _DUPH_AMC]
    with patch.object(store, "upcoming_reporters", return_value=reporters), \
         caplog.at_level(logging.WARNING, logger="api.services.implied_store"):
        summary = store.run_nightly_capture(now=now)
    assert summary["collisions"] == 1
    assert "duplicate" not in caplog.text


def test_schema_migration_adds_fiscal_columns_to_a_pre_existing_db(tmp_path, monkeypatch):
    """I6/Requirement 6: an existing DB file created BEFORE this task (no
    fiscal_year/fiscal_quarter columns) must not break — _ensure_init's ALTER
    guard has to add them the next time the module initializes against it."""
    import sqlite3
    import importlib

    db_path = tmp_path / "pre_existing_implied.db"
    # Build the OLD schema by hand — no fiscal_year/fiscal_quarter columns —
    # to simulate a DB file that predates this task, with one row already in it.
    conn = sqlite3.connect(str(db_path))
    conn.execute(
        "CREATE TABLE implied_snapshots ("
        "sym TEXT NOT NULL, report_date TEXT NOT NULL, captured_at TEXT NOT NULL, "
        "pct REAL NOT NULL, dollar REAL NOT NULL, expiry TEXT, strike REAL, spot REAL, "
        "iv_atm REAL, source TEXT, PRIMARY KEY (sym, report_date))"
    )
    conn.execute(
        "INSERT INTO implied_snapshots (sym, report_date, captured_at, pct, dollar) "
        "VALUES ('OLD', '2026-05-06', '2026-05-05T21:00:00', 4.0, 4.4)"
    )
    conn.commit()
    conn.close()

    monkeypatch.setenv("IMPLIED_STORE_DB", str(db_path))
    from api.services import implied_store
    importlib.reload(implied_store)

    # A pre-existing row reads back with the new columns as NULL, not an error.
    rows = implied_store.get_implied_history("OLD")
    assert rows[0]["pct"] == pytest.approx(4.0)
    assert rows[0]["fiscal_year"] is None
    assert rows[0]["fiscal_quarter"] is None

    # And the migrated table accepts a NEW row carrying the fiscal key.
    implied_store.record_implied("NEW", "2026-08-06", _payload(6.8), "2026-08-03T21:00:00",
                                  fiscal_year=2026, fiscal_quarter=2)
    new_rows = implied_store.get_implied_history("NEW")
    assert new_rows[0]["fiscal_year"] == 2026


# ── Startup catch-up (2026-08-05 incident) ──────────────────────────────────
# A Railway redeploy landing at/after the 16:35 ET trigger causes a freshly
# re-created APScheduler MemoryJobStore to schedule the job's next run for
# tomorrow, silently losing the whole night — see implied_store.py's
# "startup catch-up" section + api/main.py's IMPLIED_STORE_ENABLED startup
# block. These tests: (1) confirm the APScheduler root cause directly against
# the installed library (not from memory), (2) prove misfire_grace_time
# cannot help across a restart, (3) exercise the new decision/query helpers,
# and (4) reproduce the exact incident end-to-end.

def test_cron_trigger_on_fresh_jobstore_skips_todays_run_once_the_trigger_time_has_passed():
    """Confirms the root cause against the INSTALLED apscheduler (3.11.2),
    per the task's instruction to verify rather than assume: with no
    persisted jobstore state (a fresh process, e.g. right after a redeploy),
    `CronTrigger.get_next_fire_time(previous_fire_time=None, now)` — exactly
    what `BaseScheduler.add_job` calls when a job is (re)added on boot
    (schedulers/base.py) — returns the trigger's NEXT occurrence strictly
    after `now`. Once `now` is past today's 16:35 ET fire time, that next
    occurrence is TOMORROW: the newly re-created scheduler has no memory that
    today's slot was ever due, so it just waits for tomorrow. This is the
    exact 2026-08-05 defect (process restarted at 16:36 ET; the log showed
    "Added job" with no "Running job" ever following it that night)."""
    from zoneinfo import ZoneInfo
    from apscheduler.triggers.cron import CronTrigger
    et = ZoneInfo("America/New_York")
    trigger = CronTrigger(hour=16, minute=35, day_of_week="mon-fri", timezone=et)
    just_after = dt.datetime(2026, 8, 5, 16, 36, tzinfo=et)  # Wed, 1 min after the trigger
    next_fire = trigger.get_next_fire_time(None, just_after)
    assert next_fire.date() > just_after.date(), (
        "a fresh (unpersisted) scheduler re-added after the trigger time must compute "
        "the NEXT run as a LATER day, silently skipping tonight -- reproduces the "
        "2026-08-05 incident directly against the real trigger"
    )


def test_misfire_grace_time_cannot_rescue_a_restart_because_next_run_time_is_never_past_due():
    """Confirms the design guidance's claim that misfire_grace_time alone is
    NOT sufficient, directly: misfire handling (apscheduler/executors/base.py
    `run_job`) only ever fires for a run_time that is already IN
    `job._get_run_times(now)` -- i.e. a next_run_time that is already <= now.
    But `add_job` on a fresh jobstore sets next_run_time via
    `trigger.get_next_fire_time(None, now)`, which (per the previous test) is
    NEVER in the past. So a restarted process's job has no overdue run_time
    for misfire_grace_time to grace in the first place -- there is nothing to
    widen the window on. This is a structural argument, not a probabilistic
    one: no value of misfire_grace_time changes this outcome."""
    from zoneinfo import ZoneInfo
    from apscheduler.triggers.cron import CronTrigger
    et = ZoneInfo("America/New_York")
    trigger = CronTrigger(hour=16, minute=35, day_of_week="mon-fri", timezone=et)
    just_after = dt.datetime(2026, 8, 5, 16, 36, tzinfo=et)
    fresh_next_run_time = trigger.get_next_fire_time(None, just_after)
    # A job newly added post-restart never has a next_run_time <= "now" --
    # the exact precondition misfire handling requires to ever engage.
    assert fresh_next_run_time > just_after


def test_capture_due_by_weekday_and_time_boundaries(store):
    et = store._ET
    # Before the trigger time on a weekday -> not due yet (the normal cron
    # slot for TODAY is still ahead of it).
    assert store.capture_due_by(dt.datetime(2026, 8, 5, 16, 34, tzinfo=et)) is False
    # Exactly at the trigger minute -> due.
    assert store.capture_due_by(dt.datetime(2026, 8, 5, 16, 35, tzinfo=et)) is True
    # Well after, same weekday -> due.
    assert store.capture_due_by(dt.datetime(2026, 8, 5, 23, 0, tzinfo=et)) is True
    # Saturday, even late -> never due (requirement 6: no weekend firing).
    assert store.capture_due_by(dt.datetime(2026, 8, 8, 20, 0, tzinfo=et)) is False
    # Sunday -> never due.
    assert store.capture_due_by(dt.datetime(2026, 8, 9, 20, 0, tzinfo=et)) is False


def test_latest_capture_date_empty_table_returns_none(store):
    assert store.latest_capture_date() is None


def test_latest_capture_date_reflects_the_most_recent_captured_at(store):
    store.record_implied("AAA", "2026-08-04", _payload(), "2026-08-03T16:35:00-04:00")
    store.record_implied("BBB", "2026-08-06", _payload(), "2026-08-05T16:35:00-04:00")
    assert store.latest_capture_date() == "2026-08-05"


def test_latest_grade_date_scoped_to_surface(store):
    assert store.latest_grade_date("setup") is None
    store.record_grade("AAA", "2026-08-04", "setup", "B+", {})
    store.record_grade("AAA", "2026-08-05", "other-surface", "A", {})
    assert store.latest_grade_date("setup") == "2026-08-04"
    assert store.latest_grade_date("other-surface") == "2026-08-05"


def test_restart_after_trigger_time_no_longer_loses_the_night(store):
    """The end-to-end regression: reproduces the exact incident state (an
    empty store -- nothing captured tonight -- and `now` one minute past the
    16:35 ET trigger on a weekday, exactly like the 2026-08-05 log) and
    proves the new catch-up primitives correctly (a) detect the gap and
    (b) close it. Before this task's fix, `capture_due_by` does not exist on
    `implied_store` at all, so this test fails with an AttributeError; after
    the fix, running exactly what api/main.py's startup catch-up now runs
    recovers the snapshot that would otherwise have been permanently lost
    (implied_store.py's module docstring: unreconstructable once the report
    happens)."""
    now = dt.datetime(2026, 8, 5, 16, 36, tzinfo=store._ET)  # Wed, 1 min after the missed trigger
    reporters = [{"sym": "NVDA", "report_date": "2026-08-06", "hour": "amc",
                  "fiscal_year": 2027, "fiscal_quarter": 2}]

    # Exactly the pair api/main.py's IMPLIED_STORE_ENABLED startup block checks.
    assert store.capture_due_by(now) is True
    assert store.latest_capture_date() != now.date().isoformat(), \
        "nothing captured yet tonight -- this IS the 'lost the night' state"

    with patch.object(store, "upcoming_reporters", return_value=reporters), \
         patch.object(store.implied_move, "get_expected_move", return_value=_payload(6.8)):
        # Exactly what _implied_capture_catchup_background (api/main.py) runs.
        summary = store.run_nightly_capture(now=now)

    assert summary["captured"] == 1
    assert store.get_implied_history("NVDA"), \
        "the pre-report snapshot that would have been permanently lost is now captured"
    assert store.latest_capture_date() == now.date().isoformat()


def test_catchup_capture_is_idempotent_against_a_second_run_same_night(store):
    """Requirement 2: the catch-up racing (or simply preceding/following) the
    regular scheduled run must never double-write or clobber a good
    snapshot. record_implied's (sym, report_date) first-write-wins already
    guarantees this at the storage layer; this proves it holds across two
    FULL run_nightly_capture passes for the same night, not just two raw
    record_implied calls."""
    now = dt.datetime(2026, 8, 5, 16, 36, tzinfo=store._ET)
    reporters = [{"sym": "NVDA", "report_date": "2026-08-06", "hour": "amc",
                  "fiscal_year": 2027, "fiscal_quarter": 2}]
    with patch.object(store, "upcoming_reporters", return_value=reporters), \
         patch.object(store.implied_move, "get_expected_move", return_value=_payload(6.8)):
        first = store.run_nightly_capture(now=now)
        second = store.run_nightly_capture(now=now)  # e.g. catch-up then the scheduled job also fires
    assert first["captured"] == 1
    assert second["captured"] == 0 and second["skipped"] == 1, \
        "the second pass must skip an already-captured (sym, report_date), never re-write it"
    rows = store.get_implied_history("NVDA")
    assert len(rows) == 1 and rows[0]["pct"] == pytest.approx(6.8)


def test_capture_due_by_true_on_a_holiday_is_a_harmless_noop_via_empty_reporters(store):
    """Requirement 6: capture_due_by cannot distinguish a holiday from a
    normal trading weekday (no holiday calendar exists in this codebase,
    matching cot_service's own posture) -- proves the SAME safety net
    already covers it: an empty reporter list makes run_nightly_capture a
    true no-op, never a fabricated/zero record."""
    now = dt.datetime(2026, 8, 5, 20, 0, tzinfo=store._ET)
    assert store.capture_due_by(now) is True
    with patch.object(store, "upcoming_reporters", return_value=[]):
        summary = store.run_nightly_capture(now=now)
    assert summary == {"captured": 0, "skipped": 0, "failed": 0, "collisions": 0,
                        "skipped_no_fiscal": 0, "refused": 0,
                        "refused_by_reason": {}}


# ── Reporter-list resilience (2026-08-05 incident #2) ───────────────────────
# Verified in production: run_nightly_capture fired correctly but Finnhub's
# /calendar/earnings (upcoming_reporters' ONLY source at the time) returned
# HTTP 429 minutes later -> {'captured': 0, 'skipped': 0, 'failed': 0,
# 'collisions': 4}. upcoming_reporters is now FMP primary / Finnhub fallback.

def test_fmp_reporters_normalizes_rows_and_filters_international_symbols(store, monkeypatch):
    """FMP's stable/earnings-calendar (probe-verified live 2026-08-05) mixes
    heavy international/OTC noise into a single day's volume and carries
    NEITHER a session NOR a fiscal identity -- both must come back as an
    honest absence, never fabricated. days=0 -> exactly one day-chunk, one
    HTTP call, so this test is deterministic (see the chunking tests below
    for the multi-day case)."""
    monkeypatch.setenv("FMP_API_KEY", "test-fmp-key")

    class _Resp:
        ok = True
        status_code = 200

        def json(self):
            return [
                {"symbol": "NVDA", "date": "2026-08-06", "epsActual": None,
                 "epsEstimated": 0.85, "revenueActual": None,
                 "revenueEstimated": 5_000_000_000, "lastUpdated": "2026-08-05"},
                {"symbol": "002532.SZ", "date": "2026-08-06", "epsActual": None,
                 "epsEstimated": 0.4, "revenueActual": None,
                 "revenueEstimated": 100_000_000, "lastUpdated": "2026-08-05"},
                {"symbol": "BRK.B", "date": "2026-08-06", "epsActual": None,
                 "epsEstimated": None, "revenueActual": None,
                 "revenueEstimated": None, "lastUpdated": "2026-08-05"},
                {"date": "2026-08-06"},  # missing symbol -> dropped, never crashes
            ]

    with patch("requests.get", return_value=_Resp()) as mocked_get:
        rows = store._fmp_reporters(0, dt.date(2026, 8, 6))

    mocked_get.assert_called_once()
    assert mocked_get.call_args.kwargs["params"]["from"] == "2026-08-06"
    assert mocked_get.call_args.kwargs["params"]["to"] == "2026-08-06"

    by_sym = {r["sym"]: r for r in rows}
    assert set(by_sym) == {"NVDA", "BRK-B"}, \
        "numeric-prefixed/exchange-suffixed international symbols must be filtered out"
    assert by_sym["NVDA"]["report_date"] == "2026-08-06"
    assert by_sym["NVDA"]["hour"] == "", "FMP carries no session field -- must be an honest absence"
    assert by_sym["NVDA"]["fiscal_year"] is None
    assert by_sym["NVDA"]["fiscal_quarter"] is None
    assert by_sym["NVDA"]["eps_estimate"] == pytest.approx(0.85)


def test_fmp_reporters_returns_none_without_api_key(store, monkeypatch):
    monkeypatch.delenv("FMP_API_KEY", raising=False)
    assert store._fmp_reporters(14, dt.date(2026, 8, 5)) is None


def test_fmp_reporters_returns_none_on_http_error(store, monkeypatch):
    """None (not []) when EVERY day-chunk fails -- an empty list would
    suppress the Finnhub fallback exactly on the kind of night this whole
    task exists to fix."""
    monkeypatch.setenv("FMP_API_KEY", "test-fmp-key")

    class _Resp:
        ok = False
        status_code = 500

    with patch("requests.get", return_value=_Resp()):
        assert store._fmp_reporters(14, dt.date(2026, 8, 5)) is None


def test_fmp_reporters_returns_none_on_network_error(store, monkeypatch):
    monkeypatch.setenv("FMP_API_KEY", "test-fmp-key")
    with patch("requests.get", side_effect=RuntimeError("connection reset")):
        assert store._fmp_reporters(14, dt.date(2026, 8, 5)) is None


# ── Per-day chunking (2026-08-05 truncation finding) ────────────────────────
# Live-probe-verified: a SINGLE stable/earnings-calendar call spanning
# multiple days silently truncates at a ~4000-row response cap, and NOT
# fairly across dates -- a 2-day [today, today+1] call returned exactly 4000
# rows with ZERO dated `today`; a 14-day call returned 2,192 rows with BOTH
# of the two nearest days (the only ones run_nightly_capture's window
# reads) completely absent. Single-day volume alone (1,400-2,200 rows,
# live-measured) stays safely under the cap. _fmp_reporters now issues one
# call PER calendar day and merges the results.

def test_fmp_reporters_chunks_one_call_per_day_so_no_day_is_dropped(store, monkeypatch):
    monkeypatch.setenv("FMP_API_KEY", "test-fmp-key")
    today = dt.date(2026, 8, 5)
    sym_by_day = {"2026-08-05": "AAA", "2026-08-06": "BBB", "2026-08-07": "CCC"}

    def _fake_get(url, params=None, timeout=None, **kw):
        day = params["from"]
        assert params["from"] == params["to"], "each chunk call must ask for exactly ONE day"

        class _Resp:
            ok = True
            status_code = 200

            def json(self_inner):
                return [{"symbol": sym_by_day[day], "date": day, "epsActual": None,
                         "epsEstimated": 1.0, "revenueActual": None,
                         "revenueEstimated": None, "lastUpdated": day}]
        return _Resp()

    with patch("requests.get", side_effect=_fake_get) as mocked_get:
        rows = store._fmp_reporters(2, today)  # today, +1, +2 -> 3 day-chunks

    assert mocked_get.call_count == 3, "one HTTP call per calendar day, not one wide call"
    dates = sorted(r["report_date"] for r in rows)
    assert dates == ["2026-08-05", "2026-08-06", "2026-08-07"], \
        "every day-chunk must be represented -- none dropped by a wide single call"


def test_fmp_reporters_returns_partial_results_when_one_day_chunk_fails(store, monkeypatch):
    """A failing day-chunk must not blank out the whole result -- partial
    real data beats nothing, and only a TOTAL failure (every chunk down)
    triggers the None -> Finnhub-fallback path."""
    monkeypatch.setenv("FMP_API_KEY", "test-fmp-key")
    today = dt.date(2026, 8, 5)

    def _fake_get(url, params=None, timeout=None, **kw):
        if params["from"] == "2026-08-06":
            raise RuntimeError("transient network error")

        class _Resp:
            ok = True
            status_code = 200

            def json(self_inner):
                return [{"symbol": "AAA", "date": params["from"], "epsActual": None,
                         "epsEstimated": 1.0, "revenueActual": None,
                         "revenueEstimated": None, "lastUpdated": params["from"]}]
        return _Resp()

    with patch("requests.get", side_effect=_fake_get):
        rows = store._fmp_reporters(1, today)  # today, +1 -> 2 day-chunks, one fails

    assert [r["report_date"] for r in rows] == ["2026-08-05"]


def test_is_us_symbol_filters_international_keeps_class_shares(store):
    assert store._is_us_symbol("NVDA") is True
    assert store._is_us_symbol("BRK-B") is True
    assert store._is_us_symbol("BF-A") is True
    assert store._is_us_symbol("002532-SZ") is False
    assert store._is_us_symbol("600738-SS") is False
    assert store._is_us_symbol("") is False
    assert store._is_us_symbol(None) is False


def test_is_us_symbol_rejects_two_letter_exchange_suffixes(store):
    """Live-verified 2026-08-05: FMP appends a two-letter EXCHANGE code to
    non-US tickers (SHOP.TO Toronto, TITR.MI Milan, INDIANHUME.NS India,
    IP.BK Bangkok) which _canon's dot->hyphen rule makes format-identical to
    a genuine one-letter US class share under a naive {1,2} suffix cap --
    several of these were observed live slipping through and inflating
    `failed` with guaranteed Massive-chain misses. Real US class shares are,
    without exception, exactly ONE trailing letter."""
    assert store._is_us_symbol("SHOP-TO") is False
    assert store._is_us_symbol("TITR-MI") is False
    assert store._is_us_symbol("IP-BK") is False
    assert store._is_us_symbol("BTOU-SI") is False


def test_upcoming_reporters_prefers_fmp_and_never_calls_finnhub_when_fmp_succeeds(store, monkeypatch):
    monkeypatch.setenv("FMP_API_KEY", "test-fmp-key")
    fmp_rows = [{"sym": "NVDA", "report_date": "2026-08-06", "hour": "",
                 "fiscal_year": None, "fiscal_quarter": None, "eps_estimate": 0.85}]
    with patch.object(store, "_fmp_reporters", return_value=fmp_rows), \
         patch.object(store, "_finnhub_reporters") as fh:
        reporters = store.upcoming_reporters(days=14, now=dt.datetime(2026, 8, 5))
    fh.assert_not_called()
    assert reporters == fmp_rows


def test_upcoming_reporters_falls_back_to_finnhub_when_fmp_is_unavailable(store, monkeypatch):
    monkeypatch.delenv("FMP_API_KEY", raising=False)
    monkeypatch.setenv("FINNHUB_API_KEY", "test-fh-key")

    class _Resp:
        status_code = 200

        def raise_for_status(self):
            pass

        def json(self):
            return {"earningsCalendar": [
                {"symbol": "AAPL", "date": "2026-08-06", "hour": "amc", "quarter": 3, "year": 2026},
            ]}

    with patch("requests.get", return_value=_Resp()):
        reporters = store.upcoming_reporters(days=14, now=dt.datetime(2026, 8, 5))
    assert reporters and reporters[0]["sym"] == "AAPL"
    assert reporters[0]["fiscal_year"] == 2026, "the Finnhub fallback still carries the fiscal key"


def test_upcoming_reporters_uses_fmp_when_finnhub_returns_nothing_reproduces_2026_08_05_incident(store, monkeypatch):
    """Direct reproduction, at the upcoming_reporters layer, of the verified
    production failure: Finnhub's calendar call yields nothing (429/shed --
    modeled as fh_get returning None, exactly what every Finnhub failure mode
    collapses to for a caller) while FMP -- a paid Premium plan, not
    rate-limited -- has the data. FAILS against the pre-fix Finnhub-only
    upcoming_reporters (which never touches FMP at all, so this would return
    []); PASSES once FMP is the primary source."""
    monkeypatch.setenv("FMP_API_KEY", "test-fmp-key")

    class _FmpResp:
        ok = True
        status_code = 200

        def json(self):
            return [{"symbol": "NVDA", "date": "2026-08-06", "epsActual": None,
                      "epsEstimated": 0.85, "revenueActual": None,
                      "revenueEstimated": 5_000_000_000, "lastUpdated": "2026-08-05"}]

    with patch("requests.get", return_value=_FmpResp()), \
         patch("api.services.finnhub_client.fh_get", return_value=None):
        reporters = store.upcoming_reporters(days=14, now=dt.datetime(2026, 8, 5))

    assert reporters, "FMP must still supply a reporter list when Finnhub returns nothing"
    assert reporters[0]["sym"] == "NVDA"


def test_run_nightly_capture_recovers_from_finnhub_unavailability_via_fmp(store, monkeypatch):
    """End-to-end reproduction of the verified 2026-08-05 production
    incident, one layer up from the test above: run_nightly_capture itself
    must recover a non-zero `captured` when Finnhub's calendar call yields
    nothing and FMP has the data. FAILS against the pre-fix code (summary ==
    {'captured': 0, 'skipped': 0, 'failed': 0, 'collisions': 0}, matching the
    verified incident log exactly); PASSES after.

    Also doubles as end-to-end coverage of Task 4's Leg 3: since Finnhub
    (Leg 2) is entirely unavailable here too, the ONLY way this row's
    fiscal key resolves is the per-symbol FMP transcript-dates fallback --
    the mock discriminates by URL so the earnings-calendar endpoint (no
    fiscal fields, per FMP's real shape) and the transcript-dates endpoint
    (has them) return their own realistic shapes."""
    monkeypatch.setenv("FMP_API_KEY", "test-fmp-key")
    # today = 2026-08-05; tomorrow (08-06) is in-window regardless of session,
    # so this isolates the RESILIENCE fix from the separate session-backfill
    # behavior exercised by the tests below.
    now = dt.datetime(2026, 8, 5, 16, 40, tzinfo=store._ET)

    def _fake_get(url, params=None, timeout=None, **kw):
        class _Resp:
            ok = True
            status_code = 200

            def json(self_inner):
                if "earning-call-transcript-dates" in url:
                    return [{"quarter": 3, "fiscalYear": 2026, "date": "2026-08-06"}]
                return [{"symbol": "NVDA", "date": "2026-08-06", "epsActual": None,
                          "epsEstimated": 0.85, "revenueActual": None,
                          "revenueEstimated": 5_000_000_000, "lastUpdated": "2026-08-05"}]
        return _Resp()

    with patch("requests.get", side_effect=_fake_get), \
         patch("api.services.finnhub_client.fh_get", return_value=None), \
         patch.object(store.implied_move, "get_expected_move", return_value=_payload()):
        summary = store.run_nightly_capture(now=now)

    assert summary["captured"] == 1, (
        "FMP must supply the reporter list -- and the capture must succeed -- "
        "even though Finnhub returned nothing, exactly like the verified "
        "2026-08-05 production incident"
    )
    rows = store.get_implied_history("NVDA")
    assert rows
    assert rows[0]["fiscal_year"] == 2026 and rows[0]["fiscal_quarter"] == 3, (
        "the per-symbol FMP repair leg must resolve the fiscal key even when "
        "Finnhub (Leg 2) is entirely unavailable"
    )


# ── Day-scoped session/fiscal backfill (FMP carries neither field at all) ──
# Renamed from "Same-day session backfill" (Task 4, 2026-08-05): the old
# `_finnhub_today_enrichment`/`_merge_today_enrichment` only ever backfilled
# rows dated TODAY, but the normal T-1 capture's rows are dated today+1 --
# exactly the ones that never got this backfill. `_finnhub_day_enrichment`/
# `_merge_day_enrichment` generalize it to any day in the capture window.

def test_finnhub_day_enrichment_normalizes_rows(store, monkeypatch):
    monkeypatch.setenv("FINNHUB_API_KEY", "test-fh-key")

    class _Resp:
        status_code = 200

        def raise_for_status(self):
            pass

        def json(self):
            return {"earningsCalendar": [
                {"symbol": "todayx", "date": "2026-08-05", "hour": "amc", "quarter": 3, "year": 2026},
            ]}

    with patch("requests.get", return_value=_Resp()):
        hints = store._finnhub_day_enrichment("2026-08-05")
    assert hints == {"TODAYX": {"hour": "amc", "fiscal_year": 2026, "fiscal_quarter": 3}}


def test_finnhub_day_enrichment_empty_on_failure(store):
    with patch("api.services.finnhub_client.fh_get", return_value=None):
        assert store._finnhub_day_enrichment("2026-08-05") == {}


def test_merge_day_enrichment_fills_blank_hour_and_fiscal_key(store):
    in_window = [{"sym": "TODAYX", "report_date": "2026-08-05", "hour": "",
                  "fiscal_year": None, "fiscal_quarter": None}]
    hints_by_day = {"2026-08-05": {"TODAYX": {"hour": "amc", "fiscal_year": 2026, "fiscal_quarter": 3}}}
    out = store._merge_day_enrichment(in_window, hints_by_day)
    assert out[0]["hour"] == "amc"
    assert out[0]["fiscal_year"] == 2026
    assert out[0]["fiscal_quarter"] == 3


def test_merge_day_enrichment_never_overwrites_a_known_hour(store):
    in_window = [{"sym": "TODAYX", "report_date": "2026-08-05", "hour": "bmo",
                  "fiscal_year": None, "fiscal_quarter": None}]
    hints_by_day = {"2026-08-05": {"TODAYX": {"hour": "amc", "fiscal_year": 2026, "fiscal_quarter": 3}}}
    out = store._merge_day_enrichment(in_window, hints_by_day)
    assert out[0]["hour"] == "bmo", "the primary source's known session must win, never be overridden"


def test_merge_day_enrichment_ignores_rows_for_a_different_day_than_the_hints_cover(store):
    """A hint computed for 2026-08-05 must never apply to a same-symbol row
    dated a DIFFERENT day, even if that day isn't in hints_by_day at all."""
    in_window = [{"sym": "TOMORROW", "report_date": "2026-08-06", "hour": "",
                  "fiscal_year": None, "fiscal_quarter": None}]
    hints_by_day = {"2026-08-05": {"TOMORROW": {"hour": "amc", "fiscal_year": 2026, "fiscal_quarter": 3}}}
    out = store._merge_day_enrichment(in_window, hints_by_day)
    assert out[0]["hour"] == ""


def test_merge_day_enrichment_scopes_a_hint_to_its_own_day_even_for_the_same_symbol(store):
    """The SAME symbol reporting on two different days in the window must
    only pick up the hint keyed to ITS OWN report_date."""
    in_window = [{"sym": "DUALQ", "report_date": "2026-08-05", "hour": "",
                  "fiscal_year": None, "fiscal_quarter": None},
                 {"sym": "DUALQ", "report_date": "2026-08-06", "hour": "",
                  "fiscal_year": None, "fiscal_quarter": None}]
    hints_by_day = {
        "2026-08-05": {"DUALQ": {"hour": "amc", "fiscal_year": 2026, "fiscal_quarter": 2}},
        "2026-08-06": {"DUALQ": {"hour": "bmo", "fiscal_year": 2026, "fiscal_quarter": 3}},
    }
    out = store._merge_day_enrichment(in_window, hints_by_day)
    by_date = {r["report_date"]: r for r in out}
    assert by_date["2026-08-05"]["fiscal_quarter"] == 2
    assert by_date["2026-08-06"]["fiscal_quarter"] == 3


def test_merge_day_enrichment_never_mutates_input_dicts(store):
    """in_window entries can be objects shared with the _REPORTERS_CACHE TTL
    cache (via upcoming_reporters) -- mutating them in place would corrupt
    what a later call inside the same 6h TTL window sees."""
    original = {"sym": "TODAYX", "report_date": "2026-08-05", "hour": "",
                "fiscal_year": None, "fiscal_quarter": None}
    in_window = [original]
    hints_by_day = {"2026-08-05": {"TODAYX": {"hour": "amc", "fiscal_year": 2026, "fiscal_quarter": 3}}}
    store._merge_day_enrichment(in_window, hints_by_day)
    assert original["hour"] == "", "the ORIGINAL dict must be untouched"
    assert original["fiscal_year"] is None


def test_merge_day_enrichment_noop_when_hints_empty(store):
    in_window = [{"sym": "TODAYX", "report_date": "2026-08-05", "hour": ""}]
    out = store._merge_day_enrichment(in_window, {})
    assert out is in_window


def test_run_nightly_capture_skips_today_row_when_session_unknown_and_backfill_fails(store):
    """FMP-primary rows carry hour="" (no session field at all). If the
    opportunistic day-scoped Finnhub backfill ALSO fails, a today-dated row
    must SKIP rather than guess -- capturing on an unconfirmed session risks
    silently storing an IV-crushed value forever."""
    now = dt.datetime(2026, 8, 5, 16, 40, tzinfo=store._ET)
    reporters = [{"sym": "TODAYX", "report_date": "2026-08-05", "hour": "",
                  "fiscal_year": None, "fiscal_quarter": None}]
    with patch.object(store, "upcoming_reporters", return_value=reporters), \
         patch.object(store, "_finnhub_day_enrichment", return_value={}), \
         patch.object(store, "_fmp_fiscal_repair", return_value=None), \
         patch.object(store.implied_move, "get_expected_move", return_value=_payload()):
        summary = store.run_nightly_capture(now=now)
    assert summary == {"captured": 0, "skipped": 1, "failed": 0, "collisions": 0,
                        "skipped_no_fiscal": 0, "refused": 0,
                        "refused_by_reason": {}}
    assert not store.get_implied_history("TODAYX")


def test_run_nightly_capture_backfills_session_from_finnhub_and_captures(store):
    now = dt.datetime(2026, 8, 5, 16, 40, tzinfo=store._ET)
    reporters = [{"sym": "TODAYX", "report_date": "2026-08-05", "hour": "",
                  "fiscal_year": None, "fiscal_quarter": None}]
    hints = {"TODAYX": {"hour": "amc", "fiscal_year": 2026, "fiscal_quarter": 3}}
    with patch.object(store, "upcoming_reporters", return_value=reporters), \
         patch.object(store, "_finnhub_day_enrichment", return_value=hints) as enrich, \
         patch.object(store.implied_move, "get_expected_move", return_value=_payload()):
        summary = store.run_nightly_capture(now=now)
    enrich.assert_called_once_with("2026-08-05")
    assert summary["captured"] == 1
    rows = store.get_implied_history("TODAYX")
    assert rows and rows[0]["fiscal_year"] == 2026 and rows[0]["fiscal_quarter"] == 3


def test_run_nightly_capture_backfill_revealing_bmo_still_skips(store):
    now = dt.datetime(2026, 8, 5, 16, 40, tzinfo=store._ET)
    reporters = [{"sym": "TODAYX", "report_date": "2026-08-05", "hour": "",
                  "fiscal_year": None, "fiscal_quarter": None}]
    hints = {"TODAYX": {"hour": "bmo", "fiscal_year": 2026, "fiscal_quarter": 3}}
    with patch.object(store, "upcoming_reporters", return_value=reporters), \
         patch.object(store, "_finnhub_day_enrichment", return_value=hints), \
         patch.object(store.implied_move, "get_expected_move", return_value=_payload()):
        summary = store.run_nightly_capture(now=now)
    assert summary == {"captured": 0, "skipped": 1, "failed": 0, "collisions": 0,
                        "skipped_no_fiscal": 0, "refused": 0,
                        "refused_by_reason": {}}
    assert not store.get_implied_history("TODAYX")


def test_run_nightly_capture_skips_the_backfill_call_when_no_row_needs_it(store):
    """A healthy night (session AND fiscal identity already known for every
    in-window row) must never spend the extra Finnhub enrichment call."""
    now = dt.datetime(2026, 8, 5, 16, 40, tzinfo=store._ET)
    reporters = [{"sym": "AMCTODAY", "report_date": "2026-08-05", "hour": "amc",
                  "fiscal_year": 2026, "fiscal_quarter": 2},
                 {"sym": "TOMORROW", "report_date": "2026-08-06", "hour": "amc",
                  "fiscal_year": 2026, "fiscal_quarter": 3}]
    with patch.object(store, "upcoming_reporters", return_value=reporters), \
         patch.object(store, "_finnhub_day_enrichment") as enrich, \
         patch.object(store, "_fmp_fiscal_repair") as repair, \
         patch.object(store.implied_move, "get_expected_move", return_value=_payload()):
        summary = store.run_nightly_capture(now=now)
    enrich.assert_not_called()
    repair.assert_not_called()
    assert summary["captured"] == 2
    assert store.get_implied_history("AMCTODAY")
    assert store.get_implied_history("TOMORROW")

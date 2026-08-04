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
    reporters = [{"sym": "GOOD", "report_date": "2026-08-04", "hour": "amc"},
                 {"sym": "BAD", "report_date": "2026-08-04", "hour": "amc"}]
    def fake_move(sym, report_date=None):
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
    assert summary == {"captured": 0, "skipped": 0, "failed": 0, "collisions": 0}


def test_run_nightly_capture_isolates_a_raising_reporter(store):
    reporters = [{"sym": "OK1", "report_date": "2026-08-04", "hour": "amc"},
                 {"sym": "BOOM", "report_date": "2026-08-04", "hour": "amc"},
                 {"sym": "OK2", "report_date": "2026-08-04", "hour": "amc"}]
    def fake_move(sym, report_date=None):
        if sym == "BOOM":
            raise RuntimeError("chain exploded")
        return _payload()
    with patch.object(store, "upcoming_reporters", return_value=reporters), \
         patch.object(store.implied_move, "get_expected_move", side_effect=fake_move):
        summary = store.run_nightly_capture(now=dt.datetime(2026, 8, 3, 16, 40))
    assert summary == {"captured": 2, "skipped": 0, "failed": 1, "collisions": 0}
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
        {"sym": "AMCTODAY", "report_date": "2026-08-03", "hour": "amc"},
        {"sym": "TOMORROW", "report_date": "2026-08-04", "hour": "bmo"},
    ]
    with patch.object(store, "upcoming_reporters", return_value=reporters), \
         patch.object(store.implied_move, "get_expected_move", side_effect=lambda sym, report_date=None: _payload()):
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
    reporters = [{"sym": "DEFNOW", "report_date": report_date, "hour": "amc"}]
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
    /calendar/earnings, distinguished from a missing value."""
    class _Resp:
        def raise_for_status(self):
            pass

        def json(self):
            return {"earningsCalendar": [
                {"symbol": "TST", "date": "2026-07-30", "hour": "amc", "quarter": 2, "year": 2026},
                {"symbol": "NOQ", "date": "2026-07-31", "hour": "bmo"},  # no quarter/year at all
            ]}

    monkeypatch.setenv("FINNHUB_API_KEY", "test-key")
    with patch.object(store.httpx, "get", return_value=_Resp()):
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
        assert summary == {"captured": 0, "skipped": 1, "failed": 0, "collisions": 1}, order_name
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
        assert summary == {"captured": 0, "skipped": 1, "failed": 0, "collisions": 1}, order_name
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

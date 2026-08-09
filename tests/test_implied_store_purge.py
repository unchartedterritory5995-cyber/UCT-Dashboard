"""Cleaning what is already stored, and recording WHY nothing was stored.

Two halves of the same fix:
  * `run_nightly_capture` must count a REFUSAL separately from a provider that
    never answered — otherwise a correctly-working bound reads as an outage
    and an outage reads as a bound.
  * `purge_unsupported_snapshots` must delete exactly the rows the live bound
    would refuse today, using the live rule rather than a second copy of it.

Fixtures are production rows read from /data/implied_moves.db on 2026-08-08.
"""
import datetime as dt
from unittest.mock import patch

import pytest

from api.services import implied_move as im


@pytest.fixture()
def store(tmp_path, monkeypatch):
    monkeypatch.setenv("IMPLIED_STORE_DB", str(tmp_path / "implied.db"))
    import importlib
    from api.services import implied_store
    importlib.reload(implied_store)
    im._MOVE_CACHE.clear()
    return implied_store


def _snapshot(pct, strike, spot):
    """A stored row's shape, as `record_implied` consumes it."""
    return {"pct": pct, "dollar": pct * spot / 100, "expiry": "2026-08-07",
            "strike": strike, "spot": spot, "iv_atm": 1.1, "source": "massive-chain"}


def _chain(spot, strike, leg_mid, exp="2026-08-07"):
    return {"ticker": "TST", "expiration": exp, "spot": spot,
            "calls": [{"strike": strike, "bid": leg_mid, "ask": leg_mid, "iv": 1.2}],
            "puts": [{"strike": strike, "bid": leg_mid, "ask": leg_mid, "iv": 1.2}]}


# ── the record: a refusal is not a failure ────────────────────────────────────

def test_a_refused_symbol_is_recorded_as_refused_by_name_not_as_failed(store):
    """MAPS (spot $0.35, only listed strike $0.50) has no at-the-money strike.
    The night's record must say that, in those words, rather than folding it
    into `failed` next to genuine provider outages. Drives the REAL
    implied_move path — the store's counters are only trustworthy if the
    reason reaching them came from the actual evaluation."""
    reporters = [{"sym": "MAPS", "report_date": "2026-08-04", "hour": "amc",
                  "fiscal_year": 2026, "fiscal_quarter": 3}]
    im._MOVE_CACHE.clear()
    im._MOVE_STALE.forget("expmove::MAPS::2026-08-04")
    with patch.object(store, "upcoming_reporters", return_value=reporters), \
         patch.object(im.polygon_options, "list_expirations",
                      return_value={"expirations": ["2026-08-07"]}), \
         patch.object(im.polygon_options, "get_chain",
                      return_value=_chain(0.35, 0.50, 3.7625)):
        summary = store.run_nightly_capture(now=dt.datetime(2026, 8, 3, 16, 40))

    assert summary["captured"] == 0
    assert summary["refused"] == 1
    assert summary["refused_by_reason"] == {im.REFUSED_NO_ATM_STRIKE: 1}
    assert summary["failed"] == 0, \
        "a bound that fired is not a provider that failed — the record must differ"
    assert not store.get_implied_history("MAPS"), \
        "a refused symbol must never reach the permanent store"


def test_a_provider_outage_is_still_recorded_as_failed_not_refused(store):
    """The control in the other direction. If every empty result counted as a
    refusal, the counters would be decoration."""
    reporters = [{"sym": "OUTAGE", "report_date": "2026-08-04", "hour": "amc",
                  "fiscal_year": 2026, "fiscal_quarter": 3}]
    im._MOVE_CACHE.clear()
    im._MOVE_STALE.forget("expmove::OUTAGE::2026-08-04")
    with patch.object(store, "upcoming_reporters", return_value=reporters), \
         patch.object(im.polygon_options, "list_expirations",
                      return_value={"expirations": ["2026-08-07"]}), \
         patch.object(im.polygon_options, "get_chain",
                      return_value={"error": "no chain data"}):
        summary = store.run_nightly_capture(now=dt.datetime(2026, 8, 3, 16, 40))

    assert summary["failed"] == 1
    assert summary["refused"] == 0 and summary["refused_by_reason"] == {}


def test_a_genuine_reporter_still_captures_through_the_real_path(store):
    """Non-vacuity for the capture loop itself: TTWO's real chain shape still
    writes a row, and writes the production percentage."""
    reporters = [{"sym": "TTWO", "report_date": "2026-08-04", "hour": "amc",
                  "fiscal_year": 2026, "fiscal_quarter": 1}]
    im._MOVE_CACHE.clear()
    im._MOVE_STALE.forget("expmove::TTWO::2026-08-04")
    chain = {"ticker": "TTWO", "expiration": "2026-08-07", "spot": 232.94,
             "calls": [{"strike": 232.5, "bid": 8.95, "ask": 9.05, "iv": 0.7}],
             "puts": [{"strike": 232.5, "bid": 8.20, "ask": 8.30, "iv": 0.7}]}
    with patch.object(store, "upcoming_reporters", return_value=reporters), \
         patch.object(im.polygon_options, "list_expirations",
                      return_value={"expirations": ["2026-08-07"]}), \
         patch.object(im.polygon_options, "get_chain", return_value=chain):
        summary = store.run_nightly_capture(now=dt.datetime(2026, 8, 3, 16, 40))

    assert summary == {"captured": 1, "skipped": 0, "failed": 0, "collisions": 0,
                       "skipped_no_fiscal": 0, "refused": 0, "refused_by_reason": {}}
    rows = store.get_implied_history("TTWO")
    assert rows and rows[0]["pct"] == 7.405340431012278


# ── the clean-up: what is already stored ──────────────────────────────────────

# Four fabrications and three genuine rows, all captured 2026-08-06.
_FABRICATED = [("MAPS", 2150.0, 0.50, 0.35), ("SGMOQ", 1675.0, 0.50, 0.10),
               ("NRDY", 1373.5294117647059, 2.50, 0.85), ("CTSO", 615.3846153846154, 2.50, 0.39),
               ("PEPG", 409.0909090909091, 2.00, 1.98)]
_GENUINE = [("TTWO", 7.405340431012278, 232.5, 232.94),
            ("PPL", 3.682842287694974, 35.0, 34.62),
            ("HE", 6.5947242206235, 12.5, 12.51)]


def _seed(store):
    for sym, pct, strike, spot in _FABRICATED + _GENUINE:
        store.record_implied(sym, "2026-08-06", _snapshot(pct, strike, spot),
                             "2026-08-06T16:35:00-04:00",
                             fiscal_year=2026, fiscal_quarter=3)


def test_purge_removes_exactly_the_rows_the_live_bound_refuses(store):
    _seed(store)
    assert len(store.get_implied_for_date("2026-08-06")) == 8

    dry = store.purge_unsupported_snapshots(dry_run=True)
    assert dry["scanned"] == 8
    assert dry["unsupported"] == 5
    assert dry["deleted"] == 0, "a dry run must not write"
    assert dry["by_reason"] == {im.REFUSED_NO_ATM_STRIKE: 4,
                                im.REFUSED_IMPLAUSIBLE_MOVE: 1}
    assert dry["symbols"] == ["CTSO", "MAPS", "NRDY", "PEPG", "SGMOQ"]
    assert len(store.get_implied_for_date("2026-08-06")) == 8, "still a dry run"

    live = store.purge_unsupported_snapshots(dry_run=False)
    assert live["deleted"] == 5
    remaining = store.get_implied_for_date("2026-08-06")
    assert sorted(remaining) == ["HE", "PPL", "TTWO"], \
        "the genuine rows must survive the clean-up untouched"
    assert remaining["TTWO"] == 7.405340431012278


def test_purge_is_idempotent(store):
    _seed(store)
    store.purge_unsupported_snapshots(dry_run=False)
    again = store.purge_unsupported_snapshots(dry_run=False)
    assert again["unsupported"] == 0 and again["deleted"] == 0
    assert again["scanned"] == 3


def test_purge_defaults_to_a_dry_run(store):
    """This deletes member-visible history. The call you get by accident has
    to be the safe one."""
    _seed(store)
    result = store.purge_unsupported_snapshots()
    assert result["deleted"] == 0
    assert len(store.get_implied_for_date("2026-08-06")) == 8


def test_purge_reads_the_live_bound_rather_than_its_own_copy(store, monkeypatch):
    """Wiring proof: move the live constant and the purge's verdict must move
    with it. A purge carrying a private copy of the rule would keep deleting
    (or keep sparing) exactly the same rows, and would silently diverge the
    first time either bound is retuned."""
    _seed(store)
    monkeypatch.setattr(im, "MAX_ATM_MONEYNESS", 99.0)
    monkeypatch.setattr(im, "MAX_MOVE_PCT", 1e9)
    assert store.purge_unsupported_snapshots(dry_run=True)["unsupported"] == 0

    monkeypatch.setattr(im, "MAX_ATM_MONEYNESS", 0.0)
    monkeypatch.setattr(im, "MAX_MOVE_PCT", 1e9)
    loosened = store.purge_unsupported_snapshots(dry_run=True)
    assert loosened["unsupported"] == 8, \
        "at a 0% bound no seeded row has a strike exactly on spot, so all 8 refuse"


def test_purge_reports_which_source_the_rows_came_from(store):
    """`massive-chain` (the nightly capture) and `massive-backfill` (the
    historical reconstruction) share `straddle_from_rows`, so both carry the
    defect — production held 776 and 545 rows respectively. The report has to
    say which, or the operator cannot tell whether the backfill also needs
    re-running."""
    store.record_implied("MAPS", "2026-08-06", _snapshot(2150.0, 0.50, 0.35),
                         "2026-08-06T16:35:00-04:00", fiscal_year=2026, fiscal_quarter=3)
    backfilled = _snapshot(1373.5294117647059, 2.50, 0.85)
    backfilled["source"] = "massive-backfill"
    store.record_implied("NRDY", "2026-05-06", backfilled,
                         "2026-05-05T16:35:00-04:00", fiscal_year=2026, fiscal_quarter=2)
    report = store.purge_unsupported_snapshots(dry_run=True)
    assert report["by_source"] == {"massive-chain": 1, "massive-backfill": 1}

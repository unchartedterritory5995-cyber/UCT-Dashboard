"""D5 CHECKPOINT 7 — the adjustment-basis label.

Deterministic + offline: metadata seeded straight into `bars_sanitize`'s own
cache (same idiom as `test_bars_sanitize.py`); bars written to a private
`bars.db` (same idiom as `test_bars_split_repair.py`'s `fresh_db` fixture).
"""
from __future__ import annotations

import datetime

import pytest

from api.services import adjustment_basis as ab
from api.services import bars_sanitize as bs
from api.services import bars_split_repair as rep
from api.services import bars_sqlite
from api.services.cache import cache


@pytest.fixture(autouse=True)
def _no_network(monkeypatch):
    monkeypatch.setattr(bs, "_warm_meta", lambda ticker: None)


@pytest.fixture
def fresh_db(tmp_path, monkeypatch):
    monkeypatch.setattr(bars_sqlite, "_DB_PATH", str(tmp_path / "bars.db"))
    bars_sqlite.bump_db_epoch()
    bars_sqlite.init_db()
    yield
    bars_sqlite.bump_db_epoch()


def _seed_meta(ticker, splits=None):
    cache.set(bs._META_KEY.format(ticker), {"ipo": None, "splits": splits or []}, ttl=3600)


def _sessions(start, n):
    out, d = [], start
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d)
        d += datetime.timedelta(days=1)
    return out


def _write_flat_series(ticker, tf, n=250, price=100.0):
    days = _sessions(datetime.date(2024, 1, 2), n)
    bars = [{"t": int(d.strftime("%Y%m%d")), "o": price, "h": price * 1.01,
             "l": price * 0.99, "c": price, "v": 1_000_000} for d in days]
    bars_sqlite.put_bars(ticker, tf, bars, date_tf=False)


def _write_unadjusted_split(ticker, tf, n_pre=200, n_post=100, pre_price=48.0,
                             post_price=150.0, step_offset=3):
    """Pre-step bars stay on the OLD scale -- an un-back-adjusted 1-for-3.
    Returns the DECLARED date (within `_SPLIT_BOUNDARY_WINDOW`=7 sessions of
    the real boundary, same idiom as test_bars_split_repair.py's own
    _STEP_OFFSET) -- the declared date is what a caller must seed into meta."""
    days = _sessions(datetime.date(2024, 1, 2), n_pre + n_post)
    boundary = days[n_pre]
    declared = days[n_pre + step_offset]
    bars = []
    for i, d in enumerate(days):
        p = pre_price if i < n_pre else post_price
        bars.append({"t": int(d.strftime("%Y%m%d")), "o": p, "h": p * 1.02,
                     "l": p * 0.98, "c": p, "v": 1_000_000})
    bars_sqlite.put_bars(ticker, tf, bars, date_tf=False)
    return declared.isoformat()


# ── the dataclass itself ──────────────────────────────────────────────────────

def test_to_dict_carries_all_four_fields():
    basis = ab.AdjustmentBasis(splits=True, dividends=None, as_of="2026-06-24",
                                applied_by="vendor")
    assert basis.to_dict() == {"splits": True, "dividends": None,
                                "as_of": "2026-06-24", "applied_by": "vendor"}


def test_undetermined_is_all_none():
    assert ab.UNDETERMINED.to_dict() == {"splits": None, "dividends": None,
                                          "as_of": None, "applied_by": None}


def test_dividends_is_always_none_never_computed(fresh_db):
    """The packet's own exclusion: CP7 does not touch the dividend basis at
    all, for ANY outcome this function can reach."""
    _seed_meta("NODIV")
    _write_flat_series("NODIV", "D")
    assert ab.compute_adjustment_basis("NODIV", "D").dividends is None

    declared = _write_unadjusted_split("HASSPLIT", "D")
    _seed_meta("HASSPLIT", splits=[(declared, 1.0 / 3.0)])
    assert ab.compute_adjustment_basis("HASSPLIT", "D").dividends is None


# ── the five real outcomes ─────────────────────────────────────────────────────

def test_intraday_timeframe_is_always_undetermined():
    assert ab.compute_adjustment_basis("AAPL", "60") == ab.UNDETERMINED


def test_cold_meta_cache_miss_is_undetermined(fresh_db):
    _write_flat_series("COLDMETA", "D")
    # no _seed_meta call -- the cache is genuinely cold
    assert ab.compute_adjustment_basis("COLDMETA", "D") == ab.UNDETERMINED


def test_no_declared_splits_reads_as_vendor_adjusted(fresh_db):
    _seed_meta("CLEAN")
    _write_flat_series("CLEAN", "D")
    basis = ab.compute_adjustment_basis("CLEAN", "D")
    assert basis.splits is False
    assert basis.applied_by == "vendor"
    assert basis.as_of is None


def test_no_stored_bars_is_undetermined(fresh_db):
    _seed_meta("NOBARS", splits=[("2026-06-24", 0.5)])
    # never written to the store
    assert ab.compute_adjustment_basis("NOBARS", "D") == ab.UNDETERMINED


def test_a_declared_split_already_reflected_in_the_store_reads_as_vendor(fresh_db):
    """The store already shows the post-split scale throughout -- the vendor's
    own feed did the adjusting; nothing local intervened."""
    _seed_meta("ALREADYADJ", splits=[("2026-06-24", 1.0 / 3.0)])
    _write_flat_series("ALREADYADJ", "D", price=150.0)  # one flat scale throughout
    basis = ab.compute_adjustment_basis("ALREADYADJ", "D")
    assert basis.splits is True
    assert basis.applied_by == "vendor"
    assert basis.as_of == "2026-06-24"


def test_an_unadjusted_boundary_names_bars_split_repair_when_enabled(fresh_db, monkeypatch):
    monkeypatch.setattr(rep, "enabled", lambda: True)
    declared = _write_unadjusted_split("REPAIRABLE", "D")
    _seed_meta("REPAIRABLE", splits=[(declared, 1.0 / 3.0)])
    basis = ab.compute_adjustment_basis("REPAIRABLE", "D")
    assert basis.splits is True
    assert basis.applied_by == "bars_split_repair"
    assert basis.as_of == declared


def test_an_unadjusted_boundary_names_bars_sanitize_when_repair_is_disabled(
        fresh_db, monkeypatch):
    monkeypatch.setattr(rep, "enabled", lambda: False)
    declared = _write_unadjusted_split("SERVEHEALED", "D")
    _seed_meta("SERVEHEALED", splits=[(declared, 1.0 / 3.0)])
    basis = ab.compute_adjustment_basis("SERVEHEALED", "D")
    assert basis.splits is True
    assert basis.applied_by == "bars_sanitize"


def test_never_raises_on_a_broken_meta_shape(fresh_db):
    cache.set(bs._META_KEY.format("BROKEN"), {"splits": "not-a-list"}, ttl=3600)
    _write_flat_series("BROKEN", "D")
    assert ab.compute_adjustment_basis("BROKEN", "D") == ab.UNDETERMINED


# ── MUTATION — applied_by must reflect the REPAIR FLAG, not a guess ──────────

def test_MUTATION_applied_by_switches_on_the_repair_flag_not_a_constant(
        fresh_db, monkeypatch):
    """Prove the branch is load-bearing: flipping ONLY the flag between two
    otherwise-identical calls must flip the answer."""
    declared = _write_unadjusted_split("FLIPTEST", "D")
    _seed_meta("FLIPTEST", splits=[(declared, 1.0 / 3.0)])

    monkeypatch.setattr(rep, "enabled", lambda: True)
    enabled_answer = ab.compute_adjustment_basis("FLIPTEST", "D").applied_by

    monkeypatch.setattr(rep, "enabled", lambda: False)
    disabled_answer = ab.compute_adjustment_basis("FLIPTEST", "D").applied_by

    assert enabled_answer == "bars_split_repair"
    assert disabled_answer == "bars_sanitize"
    assert enabled_answer != disabled_answer

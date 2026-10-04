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

def test_to_dict_carries_all_fields():
    # TERM-055 added `unadjusted_split_at` (additive: the four original keys are unchanged)
    basis = ab.AdjustmentBasis(splits=True, dividends=None, as_of="2026-06-24",
                                applied_by="vendor")
    assert basis.to_dict() == {"splits": True, "dividends": None,
                                "as_of": "2026-06-24", "applied_by": "vendor",
                                "unadjusted_split_at": None}


def test_undetermined_is_all_none():
    assert ab.UNDETERMINED.to_dict() == {"splits": None, "dividends": None,
                                          "as_of": None, "applied_by": None,
                                          "unadjusted_split_at": None}


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

def test_an_unsupported_timeframe_is_undetermined():
    # ⚰️ was "intraday is always undetermined"; TERM-055 gave intraday its own basis
    # (see the intraday section below). Anything outside D/W/M + the intraday set still is.
    assert ab.compute_adjustment_basis("AAPL", "240") == ab.UNDETERMINED
    assert ab.compute_adjustment_basis("AAPL", "Q") == ab.UNDETERMINED


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


def test_an_unadjusted_boundary_reads_NOT_adjusted_when_repair_is_disabled(
        fresh_db, monkeypatch):
    """With the switch off nothing heals the series, so the member sees the
    cliff. The basis must say so, never name a heal that is not running."""
    monkeypatch.setattr(rep, "enabled", lambda: False)
    declared = _write_unadjusted_split("SERVEHEALED", "D")
    _seed_meta("SERVEHEALED", splits=[(declared, 1.0 / 3.0)])
    basis = ab.compute_adjustment_basis("SERVEHEALED", "D")
    assert basis.splits is False
    assert basis.applied_by is None
    assert basis.as_of == declared
    # TERM-055: the cliff the member sees is named, at the REAL boundary (3 sessions
    # before the declared date in this fixture), never at the declared date
    days = _sessions(datetime.date(2024, 1, 2), 300)
    assert basis.unadjusted_split_at == days[200].isoformat()


def test_the_label_agrees_with_what_the_serve_path_actually_did(fresh_db, monkeypatch):
    """The label and the served bars must answer from ONE predicate. For each
    switch position: splits=True exactly when the served copy has no cliff."""
    declared = _write_unadjusted_split("AGREE", "D")
    _seed_meta("AGREE", splits=[(declared, 1.0 / 3.0)])
    from api.services import bars_sqlite
    rows = bars_sqlite.get_bars("AGREE", "D", 400)
    for on in (True, False):
        monkeypatch.setattr(rep, "enabled", lambda on=on: on)
        served = bs.sanitize_daily_bars(
            "AGREE", [{"t": ab._ymd_to_iso(r[0]), "o": r[1], "h": r[2], "l": r[3],
                       "c": r[4], "v": r[5]} for r in rows], "D")
        cliff = bool(bs.unadjusted_splits(served, [(declared, 1.0 / 3.0)]))
        assert ab.compute_adjustment_basis("AGREE", "D").splits is (not cliff), on


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
    assert disabled_answer is None
    assert enabled_answer != disabled_answer


def test_the_basis_is_served_where_production_can_reach_it(monkeypatch):
    """TERM-055. On production a Cloudflare Worker sends /api/bars/* to the bars-api tier, which
    does not serve this route: /api/bars/NVDA/adjustment-basis answered 404 for every ticker
    (measured 2026-09-29). The label therefore reads /api/adjustment-basis/{ticker}, which the
    web pod receives. Both spellings must answer the same thing."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from api.routers import bars as bars_mod
    from api.services import adjustment_basis as ab
    monkeypatch.setattr(ab, "compute_adjustment_basis",
                        lambda t, tf: ab.AdjustmentBasis(splits=True, dividends=None,
                                                         as_of="2024-06-10", applied_by="vendor"))
    app = FastAPI()
    app.include_router(bars_mod.router)
    app.dependency_overrides[bars_mod.require_bars_access] = lambda: {"id": "u"}
    c = TestClient(app)
    a = c.get("/api/adjustment-basis/nvda?tf=D")
    b = c.get("/api/bars/nvda/adjustment-basis?tf=D")
    assert a.status_code == b.status_code == 200
    assert a.json() == b.json()
    assert a.json()["adjustment_basis"] == {"splits": True, "dividends": None,
                                            "as_of": "2024-06-10", "applied_by": "vendor",
                                            "unadjusted_split_at": None}


def test_the_basis_payload_carries_raw_view_only_when_the_gate_is_on(monkeypatch):
    """TERM-055 raw view (dark): the label's toggle reads `raw_view` off this payload, so the
    key must be ABSENT while RAW_PRICE_VIEW_ENABLED is off (the route behind it is 404)."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from api.routers import bars as bars_mod
    monkeypatch.setattr(ab, "compute_adjustment_basis", lambda t, tf: ab.UNDETERMINED)
    app = FastAPI()
    app.include_router(bars_mod.router)
    app.dependency_overrides[bars_mod.require_bars_access] = lambda: {"id": "u"}
    c = TestClient(app)
    monkeypatch.delenv("RAW_PRICE_VIEW_ENABLED", raising=False)
    assert "raw_view" not in c.get("/api/adjustment-basis/NVDA?tf=D").json()
    monkeypatch.setenv("RAW_PRICE_VIEW_ENABLED", "1")
    assert c.get("/api/adjustment-basis/NVDA?tf=D").json()["raw_view"] is True


# ── TERM-055 remainder: the INTRADAY split detector ───────────────────────────

def _intraday_series(sessions, split_idx=None, factor=3.0, price=50.0, per_session=13):
    """30-minute bars (unix seconds), 13 per ET session from 09:30. With `split_idx`, every
    session BEFORE it stays on the pre-split scale (`price * factor`): an un-back-adjusted
    `factor`-for-1 split whose first post-split session is sessions[split_idx]."""
    from zoneinfo import ZoneInfo
    et = ZoneInfo("America/New_York")
    out = []
    for si, d in enumerate(sessions):
        p = price * factor if (split_idx is not None and si < split_idx) else price
        open_ = datetime.datetime(d.year, d.month, d.day, 9, 30, tzinfo=et)
        for k in range(per_session):
            # a little intraday drift so the series is not trivially flat
            px = round(p * (1 + 0.002 * ((k % 3) - 1)), 4)
            out.append({"t": int((open_ + datetime.timedelta(minutes=30 * k)).timestamp()),
                        "o": px, "h": px * 1.001, "l": px * 0.999, "c": px, "v": 1000})
    return out


_ID_SESSIONS = _sessions(datetime.date(2026, 6, 1), 20)


def test_session_closes_takes_each_sessions_LAST_close():
    bars = _intraday_series(_ID_SESSIONS[:3])
    got = bs.session_closes(bars)
    assert [g["t"] for g in got] == [d.isoformat() for d in _ID_SESSIONS[:3]]
    assert [g["c"] for g in got] == [bars[12]["c"], bars[25]["c"], bars[38]["c"]]


def test_the_intraday_detector_finds_an_unapplied_split_at_its_real_boundary():
    """Declared 2 sessions late (inside the ± window, like real vendor dates): the cliff is
    reported at the first session ACTUALLY on the new scale."""
    bars = _intraday_series(_ID_SESSIONS, split_idx=10)
    declared = _ID_SESSIONS[12].isoformat()
    got = bs.intraday_unadjusted_splits(bars, [(declared, 3.0)])
    assert got == [(_ID_SESSIONS[10], 3.0)]


def test_the_intraday_detector_is_silent_on_an_adjusted_series_and_on_small_actions():
    adjusted = _intraday_series(_ID_SESSIONS)                       # vendor applied it
    assert bs.intraday_unadjusted_splits(adjusted, [(_ID_SESSIONS[10].isoformat(), 3.0)]) == []
    # a 3% stock dividend can never be told from an ordinary session (`adjudicable`)
    tiny = _intraday_series(_ID_SESSIONS, split_idx=10, factor=1.03)
    assert bs.intraday_unadjusted_splits(tiny, [(_ID_SESSIONS[10].isoformat(), 1.03)]) == []
    # no declared split ⇒ nothing, even across a real price step
    assert bs.intraday_unadjusted_splits(_intraday_series(_ID_SESSIONS, split_idx=10), []) == []


def test_an_ordinary_overnight_gap_is_not_a_split():
    """A 12% earnings gap with a declared 3-for-1 elsewhere in the window is not mistaken
    for the split: only a step matching the DECLARED factor counts."""
    bars = _intraday_series(_ID_SESSIONS, split_idx=10, factor=1.12)
    assert bs.intraday_unadjusted_splits(bars, [(_ID_SESSIONS[10].isoformat(), 3.0)]) == []


def _write_intraday(ticker, tf, bars):
    bars_sqlite.put_bars(ticker, tf, bars, date_tf=False)


def test_intraday_basis_names_the_cliff(fresh_db):
    _write_intraday("IDCLIFF", "30", _intraday_series(_ID_SESSIONS, split_idx=10))
    declared = _ID_SESSIONS[11].isoformat()
    _seed_meta("IDCLIFF", splits=[(declared, 3.0)])
    basis = ab.compute_adjustment_basis("IDCLIFF", "30")
    assert basis.splits is False
    assert basis.applied_by is None
    assert basis.as_of == declared
    assert basis.unadjusted_split_at == _ID_SESSIONS[10].isoformat()
    assert basis.dividends is None


def test_intraday_basis_an_applied_split_reads_as_vendor(fresh_db):
    _write_intraday("IDADJ", "30", _intraday_series(_ID_SESSIONS))
    declared = _ID_SESSIONS[10].isoformat()
    _seed_meta("IDADJ", splits=[(declared, 3.0)])
    basis = ab.compute_adjustment_basis("IDADJ", "30")
    assert (basis.splits, basis.applied_by, basis.as_of, basis.unadjusted_split_at) == (
        True, "vendor", declared, None)


def test_intraday_basis_a_split_outside_the_series_is_not_claimed(fresh_db):
    """A split a year before the intraday window: the series does not contain it, so it
    neither shows a cliff nor 'was adjusted' — there is nothing to adjust in what is shown."""
    _write_intraday("IDOLD", "30", _intraday_series(_ID_SESSIONS))
    _seed_meta("IDOLD", splits=[("2025-01-02", 0.5)])
    basis = ab.compute_adjustment_basis("IDOLD", "30")
    assert (basis.splits, basis.as_of, basis.unadjusted_split_at) == (False, None, None)


def test_intraday_basis_cold_meta_and_empty_store_are_undetermined(fresh_db):
    assert ab.compute_adjustment_basis("IDCOLD", "5") == ab.UNDETERMINED     # no meta
    _seed_meta("IDEMPTY", splits=[(_ID_SESSIONS[10].isoformat(), 0.5)])
    assert ab.compute_adjustment_basis("IDEMPTY", "5") == ab.UNDETERMINED    # no rows


def test_the_label_reads_the_reachable_path():
    import pathlib
    src = (pathlib.Path(__file__).resolve().parents[1] / "app" / "src" / "components" / "chart"
           / "AdjustmentLabel.jsx").read_text(encoding="utf-8")
    code = "\n".join(l for l in src.splitlines() if not l.lstrip().startswith("//"))
    assert "/api/adjustment-basis/" in code
    assert "/api/bars/" not in code

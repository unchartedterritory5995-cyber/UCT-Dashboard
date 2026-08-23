"""Screener LIVE TIER — the rails that make a live overlay safer than no overlay.

Spec: ``.superpowers/sdd/live-tier-2026-08-23/00-spec.md``.

Every gate here has a CONTROL proving it can fail, because a gate nobody has
seen fail is not a gate. The cases that matter, in the order they matter:

  * a non-finite / non-positive / wildly-deviant tick is REFUSED and the symbol
    keeps its nightly value (constraint 1);
  * a symbol the feed does not answer for is SKIPPED, never zeroed;
  * a build in flight makes the cycle REFUSE and SAY SO — on the shared
    ``snapshot_builder._BUILD_LOCK``, never a private second one (constraint 3);
  * the market-hours gate;
  * and the control that proves the whole thing is alive: a moved price MOVES
    the recomputed columns.
"""
import ast
import datetime

import pytest

from api.services.screener import live_tier, snapshot_builder, snapshot_db

ET = datetime.timezone(datetime.timedelta(hours=-4))
YMD = 20260824                     # a Monday, the "today" every test runs on
ANCHOR_ASOF = "20260821"           # the Friday before — a 1-session-old anchor


# --------------------------------------------------------------------------- #
# fixtures
# --------------------------------------------------------------------------- #

def _nightly_row(ticker="AAA", price=100.0, **over):
    """A synthetic 03:00 row whose distances are EXACT for round, known levels
    so the recovery algebra can be checked against arithmetic, not a fixture."""
    row = {c: None for c in snapshot_db.COLUMNS}
    row.update({
        "ticker": ticker,
        "price": price,
        "bars_asof": ANCHOR_ASOF,
        "snapshot_date": "2026-08-22",
        "built_at": 1,
        # levels: s20=95, s50=90, s200=80, e20=98  (price 100)
        "pct_vs_sma20": 5.26,      # 100/95  - 1
        "pct_vs_sma50": 11.11,     # 100/90  - 1
        "pct_vs_sma200": 25.0,     # 100/80  - 1
        "pct_vs_ema20": 2.04,      # 100/98  - 1
        "above_50sma": 1,
        "ma_stack": "full-bull",
        "atr_pct": 2.0,            # ATR = 2.00 at price 100
        "atr_ext_sma50": 5.0,      # (100-90)/2
        "chg_pct_1d": 1.0,
        "chg_pct_ytd": 25.0,       # YTD base 80
        "dist_52w_high_pct": -20.0,   # H = 125
        "dist_52w_low_pct": 100.0,    # L = 50
        "new_52w_high": 0,
        "dist_20d_high_pct": -5.0,    # H20 ~ 105.263
        "dist_20d_low_pct": 10.0,     # L20 ~ 90.909
        "dist_ath_pct": -50.0,        # ATH = 200
        "new_ath": 0,
        "pattern_entry_dist_pct": 10.0,   # entry = 110  (INVERTED form)
        "pattern_stop_dist_pct": -5.0,    # stop  = 95
        "pt_target": 150.0,
        "pt_upside_pct": 50.0,
        "gap_pct": 0.5,
        "chg_from_open_pct": 0.25,
    })
    row.update(over)
    return row


def _quote(last=110.0, prev=100.0, vol=1_000_000, **over):
    q = {"last_price": last, "prev_close": prev,
         "today_vol": vol, "prev_vol": 2_000_000}
    q.update(over)
    return q


@pytest.fixture
def live_env(monkeypatch, tmp_path):
    """A throwaway screener.db, the flag ON, the clock pinned to a regular
    session on YMD, and the market feed under the test's control."""
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "screener.db"))
    monkeypatch.setenv("SCREENER_LIVE_TIER_ENABLED", "1")
    monkeypatch.setattr(live_tier, "_session", lambda: "regular")
    monkeypatch.setattr(
        live_tier, "_now_et",
        lambda: datetime.datetime(2026, 8, 24, 10, 42, tzinfo=ET))
    snapshot_db.init_db()
    return monkeypatch


def _feed(monkeypatch, mapping):
    from api.services import scan_volume
    monkeypatch.setattr(scan_volume, "full_market_snapshot", lambda: dict(mapping))


def _overlay(ticker="AAA"):
    with snapshot_db.connect() as conn:
        r = conn.execute(f"SELECT * FROM {live_tier.LIVE_TABLE} WHERE ticker=?",
                         (ticker,)).fetchone()
        return dict(r) if r else None


def _served(ticker="AAA"):
    """What the read path WOULD serve — the spec §10 `col_expr` shape, built
    here (query.py is Lane B's) so "the served row is the nightly row" is an
    assertion about SQL, not about a promise."""
    cols = ", ".join(f'COALESCE(l."{c}", r."{c}") AS "{c}"'
                     for c in live_tier.LIVE_COLUMNS)
    pred = live_tier.serve_predicate_sql("l", "r")
    with snapshot_db.connect() as conn:
        r = conn.execute(
            f'SELECT r.ticker, {cols}, '
            f'CASE WHEN l.ticker IS NOT NULL THEN 1 ELSE 0 END AS live_row '
            f'FROM screener_rows r LEFT JOIN {live_tier.LIVE_TABLE} l '
            f'  ON l.ticker = r.ticker AND {pred} '
            f'WHERE r.ticker = ?', (ticker,)).fetchone()
        return dict(r) if r else None


# --------------------------------------------------------------------------- #
# R1 — the anchor round-trip, BOTH algebra forms, directional
# --------------------------------------------------------------------------- #

def test_recovering_an_anchor_and_re_deriving_at_the_same_price_is_exact():
    """`A = P₀/(1+d/100)` then `_pct(P₀, A)` must reproduce the stored `d`.
    Exact by algebra, so it is asserted as equality rather than as a tolerance
    — the 0.005 pp budget is what the ROUNDING already costs, not what this
    step adds."""
    from api.services.screener import technicals
    for d in (-50.0, -0.01, 0.0, 0.01, 5.26, 11.11, 25.0, 250.0):
        a = live_tier._recover_level(100.0, d)
        assert a is not None and a > 0
        assert technicals._pct(100.0, a) == d


def test_the_round_trip_control_a_moved_price_must_change_the_distance():
    """The control for the rail above: if it passed at P₁ ≠ P₀ too, it would be
    measuring nothing."""
    from api.services.screener import technicals
    a = live_tier._recover_level(100.0, 11.11)
    assert technicals._pct(110.0, a) != 11.11


def test_the_pattern_pair_uses_the_INVERTED_form_and_the_fixture_is_directional():
    """⛔ `pattern_entry_dist_pct` is `(entry/price − 1)·100`, the operands the
    other way round from every other distance. A POSITIVE stored distance means
    the entry is ABOVE the price, so the recovered level must be ABOVE it —
    copying the `P₀/(1+d/100)` form onto this pair puts it BELOW, and that is
    what this asserts."""
    assert live_tier._recover_pattern_level(100.0, 10.0) == pytest.approx(110.0)
    assert live_tier._recover_pattern_level(100.0, -5.0) == pytest.approx(95.0)
    # the OTHER form, on the same inputs, moves the level the WRONG way
    assert live_tier._recover_level(100.0, 10.0) < 100.0
    # and it round-trips at P₁ = P₀
    e = live_tier._recover_pattern_level(100.0, 10.0)
    assert round((e / 100.0 - 1) * 100, 2) == 10.0


def test_recovery_refuses_the_three_degenerate_anchors():
    assert live_tier._recover_level(0.0, 5.0) is None        # stored price 0
    assert live_tier._recover_level(100.0, None) is None     # no distance
    assert live_tier._recover_level(100.0, -100.0) is None   # 1 + d/100 == 0
    assert live_tier._recover_level(100.0, -150.0) is None   # negative level
    assert live_tier._recover_level(100.0, float("nan")) is None


# --------------------------------------------------------------------------- #
# THE CASE THAT MATTERS — an insane / unusable tick keeps the nightly value
# --------------------------------------------------------------------------- #

@pytest.mark.parametrize("bad, reason", [
    ({"last_price": float("nan")}, "no_price"),
    ({"last_price": float("inf")}, "no_price"),
    ({"last_price": 0.0}, "no_price"),
    ({"last_price": -5.0}, "no_price"),
    ({"last_price": 10000.0}, "insane_deviation"),   # 100× — the DDOG class
    ({"last_price": 1.0}, "insane_deviation"),       # −99%
    ({"prev_close": 0.0}, "no_prev_close"),
    ({"today_vol": 0}, "not_traded"),
])
def test_an_unusable_tick_is_refused_and_named(bad, reason):
    row = _nightly_row()
    q = _quote(**bad)
    assert live_tier.sanity_reason(row, q, YMD) == reason
    # and the derivation refuses outright — never a partial row
    assert live_tier.derive_row(row, q, YMD, 1.0) is None


def test_an_insane_tick_leaves_the_served_row_byte_identical_to_the_nightly_row(
        live_env, monkeypatch):
    """⭐ THE WHOLE FEATURE'S HONESTY IN ONE ASSERTION. The symbol is ABSENT
    from the overlay, so the LEFT JOIN serves it the nightly row — not a zero,
    not a guess, not a half-updated row."""
    snapshot_db.upsert_rows([_nightly_row()])
    before = snapshot_db.get_row("AAA")
    _feed(monkeypatch, {"AAA": _quote(last=10_000.0)})

    receipt = live_tier.run_sweep()

    assert receipt["rows_written"] == 0
    assert receipt["skipped"]["insane_deviation"] == 1
    assert _overlay("AAA") is None
    served = _served("AAA")
    assert served["live_row"] == 0
    for c in live_tier.LIVE_COLUMNS:
        assert served[c] == before[c], c
    # and `screener_rows` itself was not touched
    assert snapshot_db.get_row("AAA") == before


def test_the_deviation_gate_can_fail_the_control_a_sane_tick_is_written(
        live_env, monkeypatch):
    """The mutation control for the rail above: widen the threshold past the
    same 100× move and the sweep WRITES it. Without this, a gate that refused
    everything would look identical to a gate that works."""
    monkeypatch.setenv("SCREENER_LIVE_MAX_DEVIATION_PCT", "100000")
    snapshot_db.upsert_rows([_nightly_row()])
    _feed(monkeypatch, {"AAA": _quote(last=10_000.0)})

    receipt = live_tier.run_sweep()

    assert receipt["rows_written"] == 1
    assert receipt["skipped"]["insane_deviation"] == 0
    assert _served("AAA")["live_row"] == 1


def test_a_real_three_for_one_split_trips_the_gate_and_that_is_correct():
    """⚠️ P₁/P₀ ≈ 0.33 on a split day. We refuse to publish −67% as a day move;
    the symbol keeps its nightly values, the count appears in the receipt, and
    tonight's build re-anchors. ⛔ Do NOT 'fix' this by raising the threshold."""
    row = _nightly_row(price=300.0)
    assert live_tier.sanity_reason(row, _quote(last=100.0, prev=300.0),
                                   YMD) == "insane_deviation"


# --------------------------------------------------------------------------- #
# a MISSING symbol is skipped, never zeroed
# --------------------------------------------------------------------------- #

def test_a_symbol_the_feed_does_not_answer_for_is_skipped_never_zeroed(
        live_env, monkeypatch):
    snapshot_db.upsert_rows([_nightly_row("AAA"), _nightly_row("BBB")])
    before = snapshot_db.get_row("BBB")
    _feed(monkeypatch, {"AAA": _quote()})          # BBB absent from the feed

    receipt = live_tier.run_sweep()

    assert receipt["skipped"]["no_feed"] == 1
    assert receipt["rows_written"] == 1
    assert _overlay("BBB") is None
    served = _served("BBB")
    assert served["live_row"] == 0
    for c in live_tier.LIVE_COLUMNS:
        assert served[c] == before[c], c
    # ⛔ and NOT a zero anywhere: `chg_pct_1d` in particular stays nightly
    assert served["chg_pct_1d"] == 1.0
    assert served["price"] == 100.0


def test_a_row_with_a_null_anchor_price_is_refused():
    """`usable_bars` admits `c == 0`, and one such row exists in the daily
    store today — so a 0 or NULL stored price is reachable, not theoretical."""
    assert live_tier.sanity_reason(_nightly_row(price=None), _quote(),
                                   YMD) == "bad_anchor"
    assert live_tier.sanity_reason(_nightly_row(price=0.0), _quote(),
                                   YMD) == "bad_anchor"


def test_an_anchor_older_than_the_window_is_refused_and_an_unparseable_one_too():
    assert live_tier.sanity_reason(
        _nightly_row(bars_asof="20260601"), _quote(), YMD) == "stale_anchor"
    assert live_tier.sanity_reason(
        _nightly_row(bars_asof=None), _quote(), YMD) == "stale_anchor"
    assert live_tier.sanity_reason(
        _nightly_row(bars_asof="not-a-date"), _quote(), YMD) == "stale_anchor"
    # control: the ordinary previous-session anchor passes
    assert live_tier.sanity_reason(_nightly_row(), _quote(), YMD) is None


# --------------------------------------------------------------------------- #
# THE CONTROL — the recompute actually moves a value when the price moves
# --------------------------------------------------------------------------- #

def test_a_moved_price_moves_every_anchored_column(live_env, monkeypatch):
    """Without this the whole suite could pass on a tier that writes the
    nightly values back unchanged."""
    snapshot_db.upsert_rows([_nightly_row()])
    _feed(monkeypatch, {"AAA": _quote(last=110.0, prev=100.0)})

    receipt = live_tier.run_sweep()
    assert receipt["rows_written"] == 1
    s = _served("AAA")

    assert s["live_row"] == 1
    assert s["price"] == pytest.approx(110.0)
    assert s["chg_pct_1d"] == 10.0                     # 110 vs prev_close 100
    assert s["pct_vs_sma20"] == 15.79                  # 110/95
    assert s["pct_vs_sma50"] == 22.22                  # 110/90
    assert s["pct_vs_sma200"] == 37.5                  # 110/80
    assert s["pct_vs_ema20"] == 12.24                  # 110/98
    assert s["above_50sma"] == 1
    assert s["atr_ext_sma50"] == 10.0                  # (110-90)/2.0
    assert s["dist_52w_high_pct"] == -12.0             # 110 vs 125
    assert s["dist_52w_low_pct"] == 120.0              # 110 vs 50
    assert s["dist_ath_pct"] == -45.0                  # 110 vs 200
    assert s["chg_pct_ytd"] == 37.5                    # 110 vs 80
    assert s["pattern_entry_dist_pct"] == 0.0          # entry 110 == price
    assert s["pattern_stop_dist_pct"] == -13.64        # stop 95 vs 110
    assert s["pt_upside_pct"] == 36.36                 # 150 vs 110
    # ⭐ and the row SAYS how many of the 22 were genuinely recomputed
    assert _overlay("AAA")["live_cols"] >= 16


def test_above_50sma_is_derived_from_the_live_distance_never_recomputed(live_env,
                                                                       monkeypatch):
    """A row reading `pct_vs_sma50 = -1.05` beside `above_50sma = 1` is worse
    than either number alone. Price drops through the 50-day: BOTH flip."""
    snapshot_db.upsert_rows([_nightly_row()])
    _feed(monkeypatch, {"AAA": _quote(last=89.0, prev=100.0)})
    live_tier.run_sweep()
    s = _served("AAA")
    assert s["pct_vs_sma50"] < 0
    assert s["above_50sma"] == 0


def test_price_crossing_the_20day_flips_full_bull_to_partial(live_env, monkeypatch):
    snapshot_db.upsert_rows([_nightly_row()])
    _feed(monkeypatch, {"AAA": _quote(last=94.0, prev=100.0)})   # under s20=95
    live_tier.run_sweep()
    assert _served("AAA")["ma_stack"] == "partial"


def test_ma_stack_keeps_the_nightly_label_on_a_two_decimal_tie(live_env,
                                                              monkeypatch):
    """⛔ A tie means the two MAs are within ~0.01% of each other — the case
    where the member cannot see a contradiction either, because the two live
    percentages they are shown are also equal. Guessing it is not honest."""
    tied = _nightly_row(pct_vs_sma20=11.11, ma_stack="bear")   # d20 == d50
    snapshot_db.upsert_rows([tied])
    _feed(monkeypatch, {"AAA": _quote(last=110.0)})
    live_tier.run_sweep()
    # 110 > every recovered level, so a GUESS would have said "full-bull";
    # the tie means we cannot know the s20/s50 order, so the nightly label holds
    assert _served("AAA")["ma_stack"] == "bear"

    # CONTROL — untie the same pair at the same price and it DOES recompute
    snapshot_db.upsert_rows([_nightly_row(ma_stack="bear")])
    live_tier.run_sweep()
    assert _served("AAA")["ma_stack"] == "full-bull"


def test_a_column_with_no_recoverable_anchor_keeps_its_nightly_value(live_env,
                                                                    monkeypatch):
    """The copy-the-nightly-value-forward rule, per COLUMN. `pt_target` is
    absent, so `pt_upside_pct` holds; everything beside it still goes live."""
    snapshot_db.upsert_rows([_nightly_row(pt_target=None, pt_upside_pct=50.0)])
    _feed(monkeypatch, {"AAA": _quote(last=110.0)})
    live_tier.run_sweep()
    s = _served("AAA")
    assert s["pt_upside_pct"] == 50.0        # nightly, verbatim
    assert s["pct_vs_sma50"] == 22.22        # live


def test_the_feed_fields_the_parse_does_not_yet_emit_keep_their_nightly_value(
        live_env, monkeypatch):
    """⚠️ `day_open`/`day_high` need the §3.2 snapshot-parse widening, which is
    `massive.py`'s and not this lane's. Until it lands these four keep their
    nightly value — honest, disclosed by `live_cols`, and they light up with no
    change here the moment the parse widens."""
    snapshot_db.upsert_rows([_nightly_row()])
    _feed(monkeypatch, {"AAA": _quote(last=110.0)})       # no day_open/day_high
    live_tier.run_sweep()
    s = _served("AAA")
    assert s["gap_pct"] == 0.5                 # nightly
    assert s["chg_from_open_pct"] == 0.25      # nightly
    assert s["new_52w_high"] == 0              # nightly

    # control: hand it the widened quote and all four go live
    _feed(monkeypatch, {"AAA": _quote(last=130.0, day_open=105.0, day_high=131.0)})
    live_tier.run_sweep()
    s = _served("AAA")
    assert s["gap_pct"] == 5.0                 # (105-100)/100
    assert s["chg_from_open_pct"] == 23.81     # 130 vs 105
    assert s["new_52w_high"] == 1              # day_high 131 >= H 125


# --------------------------------------------------------------------------- #
# THE SHARED LOCK (constraint 3)
# --------------------------------------------------------------------------- #

def test_a_build_in_flight_makes_the_cycle_refuse_and_say_so(live_env, monkeypatch):
    snapshot_db.upsert_rows([_nightly_row()])
    _feed(monkeypatch, {"AAA": _quote(last=110.0)})

    assert snapshot_builder._BUILD_LOCK.acquire(blocking=False)
    try:
        receipt = live_tier.run_sweep()
    finally:
        snapshot_builder._BUILD_LOCK.release()

    assert receipt["skipped_reason"] == "build_in_flight"
    assert receipt["rows_written"] == 0
    assert _overlay("AAA") is None
    # ⭐ and it did not queue: the lock is free again the instant we let go
    assert snapshot_builder.build_in_flight() is False


def test_the_lock_control_with_the_lock_free_the_same_cycle_writes(live_env,
                                                                  monkeypatch):
    snapshot_db.upsert_rows([_nightly_row()])
    _feed(monkeypatch, {"AAA": _quote(last=110.0)})
    assert live_tier.run_sweep()["rows_written"] == 1


def _own_locks(source: str) -> list:
    """Every lock this source CONSTRUCTS. A private one would pass every
    behavioural test above and still let a sweep read anchors a build is
    rewriting, because the two would never contend."""
    return [getattr(n.func, "attr", None) for n in ast.walk(ast.parse(source))
            if isinstance(n, ast.Call)
            and getattr(n.func, "attr", None) in ("Lock", "RLock", "Semaphore")]


def test_the_lock_is_snapshot_builders_own_not_a_private_second_one():
    src = open(live_tier.__file__, encoding="utf-8").read()
    assert _own_locks(src) == [], "live_tier must SHARE snapshot_builder._BUILD_LOCK"
    assert "snapshot_builder._BUILD_LOCK" in src


def test_the_private_lock_probes_control():
    assert _own_locks("import threading\n_L = threading.Lock()\n") == ["Lock"]


def test_the_sweep_releases_the_lock_even_when_the_body_raises(live_env,
                                                              monkeypatch):
    snapshot_db.upsert_rows([_nightly_row()])
    from api.services import scan_volume

    def _boom():
        raise RuntimeError("provider down")
    monkeypatch.setattr(scan_volume, "full_market_snapshot", _boom)

    with pytest.raises(RuntimeError):
        live_tier.run_sweep()
    assert snapshot_builder.build_in_flight() is False


# --------------------------------------------------------------------------- #
# THE MARKET-HOURS GATE + THE FLAG
# --------------------------------------------------------------------------- #

@pytest.mark.parametrize("session", ["pre_market", "post_market"])
def test_the_tier_runs_in_the_regular_session_only(live_env, monkeypatch, session):
    snapshot_db.upsert_rows([_nightly_row()])
    _feed(monkeypatch, {"AAA": _quote(last=110.0)})
    monkeypatch.setattr(live_tier, "_session", lambda: session)

    receipt = live_tier.run_sweep()

    assert receipt["skipped_reason"] == "not_regular_session"
    assert receipt["session"] == session
    assert receipt["rows_written"] == 0
    assert _overlay("AAA") is None


def test_the_flag_is_off_by_default_and_the_cycle_says_disabled(live_env,
                                                               monkeypatch):
    monkeypatch.delenv("SCREENER_LIVE_TIER_ENABLED", raising=False)
    assert live_tier.enabled() is False
    snapshot_db.upsert_rows([_nightly_row()])
    _feed(monkeypatch, {"AAA": _quote(last=110.0)})

    receipt = live_tier.run_sweep()

    assert receipt["skipped_reason"] == "disabled"
    assert receipt["enabled"] is False
    assert _overlay("AAA") is None


def test_the_flag_is_read_per_call_so_rollback_needs_no_deploy(live_env,
                                                              monkeypatch):
    snapshot_db.upsert_rows([_nightly_row()])
    _feed(monkeypatch, {"AAA": _quote(last=110.0)})
    assert live_tier.run_sweep()["rows_written"] == 1
    monkeypatch.setenv("SCREENER_LIVE_TIER_ENABLED", "0")
    assert live_tier.run_sweep()["skipped_reason"] == "disabled"


# --------------------------------------------------------------------------- #
# THE HOLIDAY ABORT (R4)
# --------------------------------------------------------------------------- #

def test_a_session_nobody_traded_aborts_the_whole_sweep(live_env, monkeypatch):
    """`_detect_session()` is a CLOCK, not a calendar: on a market holiday it
    says 'regular' while the feed answers `last_price = prevDay.c` for
    everybody. Without the abort the universe gets `chg_pct_1d = 0.00` and
    every 'up 3% today' screen returns nothing, confidently."""
    rows = [_nightly_row(f"T{i}") for i in range(10)]
    snapshot_db.upsert_rows(rows)
    feed = {f"T{i}": _quote(last=100.0, vol=0) for i in range(9)}
    feed["T9"] = _quote(last=103.0, vol=500)
    _feed(monkeypatch, feed)

    receipt = live_tier.run_sweep()

    assert receipt["aborted"] == "not_a_trading_session"
    assert receipt["rows_written"] == 0
    with snapshot_db.connect() as conn:
        n = conn.execute(
            f"SELECT COUNT(*) FROM {live_tier.LIVE_TABLE}").fetchone()[0]
    assert n == 0


def test_the_abort_control_a_normal_session_writes(live_env, monkeypatch):
    """Delete the abort and the test above would still pass unless a normal
    session provably writes — this is that half."""
    rows = [_nightly_row(f"T{i}") for i in range(10)]
    snapshot_db.upsert_rows(rows)
    _feed(monkeypatch, {f"T{i}": _quote(last=101.0) for i in range(10)})

    receipt = live_tier.run_sweep()

    assert receipt["aborted"] is None
    assert receipt["rows_written"] == 10


# --------------------------------------------------------------------------- #
# THE RECEIPT — the thing the controller reads before arming
# --------------------------------------------------------------------------- #

def test_the_receipt_arithmetic_closes(live_env, monkeypatch):
    """⛔ `rows_written` alone is not a receipt. Considered must equal written
    plus the per-reason skips — one reason per symbol — or the map is
    describing a different population from the one that was swept."""
    snapshot_db.upsert_rows([
        _nightly_row("AAA"),                       # writes
        _nightly_row("BBB"),                       # no_feed
        _nightly_row("CCC"),                       # insane_deviation
        _nightly_row("DDD", price=None),           # bad_anchor
        _nightly_row("EEE", bars_asof="20260101"), # stale_anchor
    ])
    _feed(monkeypatch, {
        "AAA": _quote(last=110.0),
        "CCC": _quote(last=9999.0),
        "DDD": _quote(last=110.0),
        "EEE": _quote(last=110.0),
    })

    r = live_tier.run_sweep()

    assert r["rows_considered"] == 5
    assert r["rows_written"] == 1
    assert r["rows_kept_nightly"] == 4
    assert r["rows_considered"] == r["rows_written"] + sum(r["skipped"].values())
    assert r["skipped"] == {"no_feed": 1, "not_traded": 0, "no_price": 0,
                            "no_prev_close": 0, "bad_anchor": 1,
                            "stale_anchor": 1, "insane_deviation": 1}
    assert r["cols_recomputed_total"] > 0
    assert r["as_of"] is not None and r["as_of"] > 0
    assert r["session_ymd"] == YMD
    assert r["dead_cycle"] is False


def test_a_cycle_that_answered_for_nobody_is_reported_as_a_dead_cycle(
        live_env, monkeypatch, caplog):
    """⭐ 0 updated AND 0 skipped is a DEAD JOB, and it must not read like a
    quiet market. An empty universe is the honest way to reach it."""
    _feed(monkeypatch, {})
    with caplog.at_level("WARNING"):
        receipt = live_tier.sweep_job()
    assert receipt["dead_cycle"] is True
    assert "DEAD CYCLE" in caplog.text


def test_a_live_cycle_is_not_a_dead_cycle(live_env, monkeypatch, caplog):
    snapshot_db.upsert_rows([_nightly_row()])
    _feed(monkeypatch, {"AAA": _quote(last=110.0)})
    with caplog.at_level("INFO"):
        receipt = live_tier.sweep_job()
    assert receipt["dead_cycle"] is False
    assert "DEAD CYCLE" not in caplog.text
    assert "updated=1" in caplog.text
    assert "kept_nightly=0" in caplog.text
    assert f"as_of={receipt['as_of']}" in caplog.text


def test_every_cycle_returns_the_same_key_set(live_env, monkeypatch):
    """A receipt whose shape depends on which branch it took cannot be diffed
    across cycles, which is the only way anybody notices a drift."""
    _feed(monkeypatch, {})
    disabled = live_tier._blank_receipt(skipped_reason="disabled")
    snapshot_db.upsert_rows([_nightly_row()])
    _feed(monkeypatch, {"AAA": _quote(last=110.0)})
    live = live_tier.run_sweep()
    assert set(disabled) == set(live)
    live_tier.sweep_job()
    assert set(live_tier.last_receipt()) == set(live)


def test_held_lock_ms_is_measured_every_cycle_that_takes_the_lock(live_env,
                                                                 monkeypatch):
    """"Sharing the build lock is safe" stays a MEASUREMENT, not a claim."""
    snapshot_db.upsert_rows([_nightly_row()])
    _feed(monkeypatch, {"AAA": _quote(last=110.0)})
    r = live_tier.run_sweep()
    assert r["held_lock_ms"] >= 0.0
    assert r["duration_ms"] >= r["held_lock_ms"]


# --------------------------------------------------------------------------- #
# THE STORE — one writer, the right shape, and supersession for free
# --------------------------------------------------------------------------- #

def test_live_columns_are_real_snapshot_columns_with_matching_declared_types():
    """R15. A typo here is a silently-NULL overlay column on a member's screen,
    and a mismatched declared type is the same defect one step subtler."""
    missing = [c for c in live_tier.LIVE_COLUMNS if c not in snapshot_db.COLUMNS]
    assert not missing, missing
    assert len(set(live_tier.LIVE_COLUMNS)) == len(live_tier.LIVE_COLUMNS)
    assert len(live_tier.LIVE_COLUMNS) == 22


def test_the_overlay_table_types_are_derived_from_snapshot_dbs_own_coldef(live_env):
    with snapshot_db.connect() as conn:
        rows_t = {r[1]: r[2] for r in
                  conn.execute("PRAGMA table_info(screener_rows)")}
        live_t = {r[1]: r[2] for r in
                  conn.execute(f"PRAGMA table_info({live_tier.LIVE_TABLE})")}
    for c in live_tier.LIVE_COLUMNS:
        assert live_t[c] == rows_t[c], c
    for c in live_tier.LIVE_META_COLUMNS:
        assert c in live_t, c


def test_init_db_leaves_screener_rows_and_its_indexes_untouched(live_env):
    """The overlay is a THIRD executescript, not a widening."""
    with snapshot_db.connect() as conn:
        before = sorted(r[1] for r in
                        conn.execute("PRAGMA table_info(screener_rows)"))
        idx_before = sorted(
            r[0] for r in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='index' "
                "AND tbl_name='screener_rows'") if r[0])
    snapshot_db.init_db()
    with snapshot_db.connect() as conn:
        after = sorted(r[1] for r in
                       conn.execute("PRAGMA table_info(screener_rows)"))
        idx_after = sorted(
            r[0] for r in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='index' "
                "AND tbl_name='screener_rows'") if r[0])
    assert before == after == sorted(snapshot_db.COLUMNS)
    assert idx_before == idx_after


def test_the_tier_never_writes_a_row_into_screener_rows(live_env, monkeypatch):
    snapshot_db.upsert_rows([_nightly_row()])
    before = snapshot_db.get_row("AAA")
    _feed(monkeypatch, {"AAA": _quote(last=110.0), "ZZZ": _quote(last=5.0)})
    live_tier.run_sweep()
    assert snapshot_db.get_row("AAA") == before
    assert snapshot_db.count_rows() == 1          # ZZZ did not appear
    assert snapshot_db.get_row("ZZZ") is None


def test_tonights_build_supersedes_the_overlay_with_no_truncate(live_env,
                                                               monkeypatch):
    """R10. The serve predicate is `live_session_ymd > bars_asof`, so a row
    whose anchor advances to the overlay's own session stops being served —
    no callback into `snapshot_builder`, no ordering requirement, no delete."""
    snapshot_db.upsert_rows([_nightly_row()])
    _feed(monkeypatch, {"AAA": _quote(last=110.0)})
    live_tier.run_sweep()
    assert _served("AAA")["live_row"] == 1

    # the nightly build runs and advances the anchor to today's session
    snapshot_db.upsert_rows([_nightly_row(bars_asof=str(YMD))])
    assert _overlay("AAA") is not None            # the overlay row still exists
    assert _served("AAA")["live_row"] == 0        # and is no longer served


@pytest.mark.parametrize("broken", [None, "", "not-a-date", "n/a"])
def test_an_unparseable_bars_asof_never_satisfies_the_serve_predicate(
        live_env, monkeypatch, broken):
    """⚠️ NULL is free — NULL comparisons are not true. A non-numeric STRING is
    not: `CAST('not-a-date' AS INTEGER)` is 0 in SQLite, so without the `> 0`
    half the overlay would be served against a row whose anchor session is
    unreadable."""
    snapshot_db.upsert_rows([_nightly_row()])
    _feed(monkeypatch, {"AAA": _quote(last=110.0)})
    live_tier.run_sweep()
    assert _served("AAA")["live_row"] == 1          # control: it WAS serving
    snapshot_db.upsert_rows([_nightly_row(bars_asof=broken)])
    assert _served("AAA")["live_row"] == 0
    assert _served("AAA")["price"] == 100.0         # the nightly value, not 110


def test_yesterdays_overlay_rows_are_pruned(live_env, monkeypatch):
    snapshot_db.upsert_rows([_nightly_row()])
    with snapshot_db.connect() as conn:
        conn.execute(
            f"INSERT INTO {live_tier.LIVE_TABLE} "
            f"(ticker, live_session_ymd, live_asof, src_price, anchor_price, "
            f" live_cols) VALUES ('OLD', 20260101, 1.0, 1.0, 1.0, 0)")
        conn.commit()
    _feed(monkeypatch, {"AAA": _quote(last=110.0)})
    live_tier.run_sweep()
    with snapshot_db.connect() as conn:
        left = [r[0] for r in conn.execute(
            f"SELECT ticker FROM {live_tier.LIVE_TABLE}")]
    assert left == ["AAA"]


def test_the_in_session_freshness_cutoff_is_the_dead_sweeper_contract(live_env,
                                                                     monkeypatch):
    """R11. In-session, an overlay older than `SCREENER_LIVE_MAX_AGE_S` is not
    served — so if the sweeper dies the screener reverts to nightly in three
    minutes instead of showing a frozen 10:42 forever. Outside the session the
    age check does not apply: those are the day's CLOSING prints."""
    monkeypatch.setenv("SCREENER_LIVE_MAX_AGE_S", "180")
    cutoff = live_tier.min_serve_asof(now=1_000_000.0)
    assert cutoff == 1_000_000.0 - 180
    monkeypatch.setattr(live_tier, "_session", lambda: "post_market")
    assert live_tier.min_serve_asof(now=1_000_000.0) is None


# --------------------------------------------------------------------------- #
# R7 — NO NEW FETCHER, by AST, with a control that proves the probe can see one
# --------------------------------------------------------------------------- #

FORBIDDEN_CALLS = {"get_full_market_snapshot", "_fetch_snapshots", "_get_client",
                   "get_batch_rich_snapshots", "get_snapshot", "urlopen"}
FORBIDDEN_IMPORTS = {"httpx", "requests", "urllib", "aiohttp", "socket"}


def _fetcher_probe(source: str) -> list:
    """Every market-fetching name this source reaches. Derived from the AST —
    ⛔ never a grep (`lesson_probe_names_must_be_derived_not_typed`; a grep here
    once 'found 5 call sites, all five of them prose')."""
    tree = ast.parse(source)
    found = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            fn = node.func
            name = getattr(fn, "attr", None) or getattr(fn, "id", None)
            if name in FORBIDDEN_CALLS:
                found.append(name)
        elif isinstance(node, ast.Import):
            for a in node.names:
                if a.name.split(".")[0] in FORBIDDEN_IMPORTS:
                    found.append(a.name)
        elif isinstance(node, ast.ImportFrom):
            if (node.module or "").split(".")[0] in FORBIDDEN_IMPORTS:
                found.append(node.module)
    return found


def test_live_tier_reaches_no_market_fetcher_of_its_own():
    src = open(live_tier.__file__, encoding="utf-8").read()
    assert _fetcher_probe(src) == []


def test_the_probes_control_it_sees_a_deliberately_planted_sibling_call():
    """Without this the assertion above could be passing because the probe
    looks at nothing."""
    planted = ("from api.services import massive\n"
               "def f():\n"
               "    return massive._get_client().get_full_market_snapshot()\n")
    assert set(_fetcher_probe(planted)) == {"_get_client",
                                            "get_full_market_snapshot"}
    assert _fetcher_probe("import httpx\n") == ["httpx"]


def test_the_only_market_read_is_the_shared_scan_volume_accessor():
    src = open(live_tier.__file__, encoding="utf-8").read()
    tree = ast.parse(src)
    reads = {n.func.attr for n in ast.walk(tree)
             if isinstance(n, ast.Call)
             and isinstance(n.func, ast.Attribute)
             and getattr(n.func.value, "id", None) == "scan_volume"}
    assert reads == {"full_market_snapshot", "_snap_lookup"}


def test_the_symbol_lookup_is_scan_volumes_own_not_a_third_one():
    """Snapshot keys are provider-form (`BRK.B`), our columns are hyphen-form
    (`BRK-B`). ⛔ Do not write a third lookup."""
    from api.services import scan_volume
    snap = {"BRK.B": _quote(last=110.0)}
    assert scan_volume._snap_lookup(snap, "BRK-B") is snap["BRK.B"]


def test_a_dual_class_ticker_resolves_through_the_shared_lookup(live_env,
                                                               monkeypatch):
    snapshot_db.upsert_rows([_nightly_row("BRK-B")])
    _feed(monkeypatch, {"BRK.B": _quote(last=110.0)})
    r = live_tier.run_sweep()
    assert r["rows_written"] == 1
    assert r["skipped"]["no_feed"] == 0


# --------------------------------------------------------------------------- #
# THE SCHEDULER WIRING
# --------------------------------------------------------------------------- #

class _FakeSched:
    def __init__(self):
        self.jobs = {}

    def add_job(self, fn, **k):
        self.jobs[k.get("id")] = (fn, k)


def test_the_sweep_job_is_registered_and_its_cadence_is_the_declared_one(
        monkeypatch, tmp_path):
    import api.main as m
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "screener.db"))
    monkeypatch.setenv("SCREENER_SNAPSHOT_ENABLED", "1")
    monkeypatch.setenv("SCREENER_SNAPSHOT_WARM_ENABLED", "0")
    monkeypatch.setenv("SCREENER_LIVE_INTERVAL_S", "45")
    sched = _FakeSched()

    assert m.register_screener_jobs(sched) is True

    assert "screener_live_tier" in sched.jobs
    _, kw = sched.jobs["screener_live_tier"]
    assert kw["max_instances"] == 1
    assert kw["trigger"].interval.total_seconds() == 45


def test_the_job_is_registered_even_with_the_flag_off_so_arming_needs_no_restart(
        monkeypatch, tmp_path):
    """⭐ Constraint 4 as written: `rollback = unset the env var, NO DEPLOY`.
    A job registered only under the flag cannot be turned off without one."""
    import api.main as m
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "screener.db"))
    monkeypatch.setenv("SCREENER_SNAPSHOT_ENABLED", "1")
    monkeypatch.setenv("SCREENER_SNAPSHOT_WARM_ENABLED", "0")
    monkeypatch.delenv("SCREENER_LIVE_TIER_ENABLED", raising=False)
    sched = _FakeSched()
    m.register_screener_jobs(sched)

    assert "screener_live_tier" in sched.jobs
    fn, _ = sched.jobs["screener_live_tier"]
    fn()                                    # and firing it does NOTHING
    assert live_tier.last_receipt()["skipped_reason"] == "disabled"


def test_the_registered_job_never_raises_into_the_scheduler(monkeypatch, tmp_path):
    import api.main as m
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "screener.db"))
    monkeypatch.setenv("SCREENER_SNAPSHOT_ENABLED", "1")
    monkeypatch.setenv("SCREENER_SNAPSHOT_WARM_ENABLED", "0")
    monkeypatch.setenv("SCREENER_LIVE_TIER_ENABLED", "1")
    sched = _FakeSched()
    m.register_screener_jobs(sched)
    fn, _ = sched.jobs["screener_live_tier"]
    monkeypatch.setattr(live_tier, "sweep_job",
                        lambda: (_ for _ in ()).throw(RuntimeError("x")))
    fn()          # must not propagate


def test_pausing_the_nightly_snapshot_pauses_the_overlay_too(monkeypatch,
                                                             tmp_path):
    import api.main as m
    monkeypatch.setenv("SCREENER_SNAPSHOT_ENABLED", "0")
    sched = _FakeSched()
    assert m.register_screener_jobs(sched) is False
    assert sched.jobs == {}


# --------------------------------------------------------------------------- #
# the anchor-age helper
# --------------------------------------------------------------------------- #

@pytest.mark.parametrize("asof, expect", [
    ("20260824", 0),     # same session
    ("20260821", 1),     # the Friday before a Monday
    ("20260820", 2),
    ("20260817", 5),
    ("20260814", 6),
])
def test_anchor_age_counts_weekday_sessions(asof, expect):
    assert live_tier.anchor_age_sessions(asof, YMD) == expect


def test_a_future_anchor_is_zero_sessions_old_not_negative():
    assert live_tier.anchor_age_sessions("20260901", YMD) == 0

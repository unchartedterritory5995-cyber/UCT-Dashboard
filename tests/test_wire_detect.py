"""The wire's decision logic — pure, so the whole state machine is tested
without a single provider call.

A row enters when EITHER its price moves (liquid) OR its actuals land. Whichever
fires first sets `first_seen_at`, which is then immutable.
"""
from api.services.wire.detect import detect_rows, is_liquid_move, move_pct

DAY = "2026-07-31"


def _snap(last, prev, today_vol):
    return {"last_price": last, "prev_close": prev,
            "today_vol": today_vol, "prev_vol": 5_000_000}


def _rep(sym="NVDA", **kw):
    base = dict(sym=sym, timing="amc", eps_est=1.11, rev_est=49.8e9,
                eps_act=None, rev_act=None)
    base.update(kw)
    return base


# ── the liquidity gate ────────────────────────────────────────────────────────

def test_a_thin_tape_move_is_not_a_move():
    """+12% on 200 shares is noise. It must not create a row or rank."""
    assert is_liquid_move(_snap(last=112.0, prev=100.0, today_vol=200)) is False


def test_a_real_move_on_real_volume_counts():
    assert is_liquid_move(_snap(last=112.0, prev=100.0, today_vol=500_000)) is True


def test_the_gate_is_on_traded_VALUE_not_share_count():
    """A $4 stock and a $400 stock need different share counts to be liquid."""
    assert is_liquid_move(_snap(last=400.0, prev=380.0, today_vol=1_000)) is True
    assert is_liquid_move(_snap(last=4.0, prev=3.8, today_vol=1_000)) is False


def test_move_pct_is_measured_against_the_regular_session_close():
    assert round(move_pct(_snap(last=106.4, prev=100.0, today_vol=10**6)), 2) == 6.40


def test_a_down_move_is_negative():
    assert round(move_pct(_snap(last=93.6, prev=100.0, today_vol=10**6)), 2) == -6.40


def test_missing_prev_close_yields_no_move_rather_than_infinity():
    assert move_pct({"last_price": 5.0, "prev_close": 0.0, "today_vol": 10**6}) is None
    assert move_pct({}) is None


# ── the state machine ─────────────────────────────────────────────────────────

def test_a_liquid_move_creates_a_row_before_any_numbers_exist():
    rows = detect_rows([_rep()], {"NVDA": _snap(106.4, 100.0, 10**6)},
                       existing={}, now_ts=1000.0, market_date=DAY)
    assert len(rows) == 1
    assert rows[0]["trigger"] == "price"
    assert rows[0]["first_seen_at"] == 1000.0
    assert rows[0]["eps_act"] is None
    assert rows[0]["confirmed"] == 0


def test_actuals_alone_create_a_row_even_with_no_move():
    """A name that prints in line still belongs on the wire."""
    rows = detect_rows([_rep(eps_act=1.24, rev_act=51.2e9)],
                       {"NVDA": _snap(100.1, 100.0, 10**6)},
                       existing={}, now_ts=1000.0, market_date=DAY)
    assert len(rows) == 1
    assert rows[0]["trigger"] == "actuals"
    assert rows[0]["confirmed"] == 1


def test_a_quiet_name_with_no_numbers_never_enters_the_wire():
    rows = detect_rows([_rep()], {"NVDA": _snap(100.1, 100.0, 10**6)},
                       existing={}, now_ts=1000.0, market_date=DAY)
    assert rows == []


def test_a_thin_tape_spike_cannot_create_a_row():
    """The gate applies to row CREATION, not just to ranking."""
    rows = detect_rows([_rep()], {"NVDA": _snap(112.0, 100.0, 200)},
                       existing={}, now_ts=1000.0, market_date=DAY)
    assert rows == []


def test_an_existing_row_upgrades_and_keeps_its_arrival_time():
    existing = {"NVDA": {"sym": "NVDA", "first_seen_at": 500.0,
                         "trigger": "price", "eps_act": None,
                         "confirmed": 0, "peak_move_pct": 6.4}}
    rows = detect_rows([_rep(eps_act=1.24, rev_act=51.2e9)],
                       {"NVDA": _snap(106.4, 100.0, 10**6)},
                       existing=existing, now_ts=9999.0, market_date=DAY)
    assert rows[0]["first_seen_at"] == 500.0, "the upgrade rewrote arrival order"
    assert rows[0]["eps_act"] == 1.24
    assert rows[0]["confirmed"] == 1
    assert rows[0]["trigger"] == "price", "the ORIGINAL trigger must be preserved"


def test_an_unchanged_row_produces_no_write():
    """The detector runs every ~20s; it must not rewrite unchanged rows."""
    existing = {"NVDA": {"sym": "NVDA", "first_seen_at": 500.0, "trigger": "price",
                         "eps_act": 1.24, "rev_act": 51.2e9,
                         "confirmed": 1, "peak_move_pct": 6.4}}
    rows = detect_rows([_rep(eps_act=1.24, rev_act=51.2e9)],
                       {"NVDA": _snap(106.4, 100.0, 10**6)},
                       existing=existing, now_ts=9999.0, market_date=DAY)
    assert rows == []


def test_a_bigger_move_updates_the_peak():
    existing = {"NVDA": {"sym": "NVDA", "first_seen_at": 500.0, "trigger": "price",
                         "eps_act": None, "confirmed": 0, "peak_move_pct": 4.0}}
    rows = detect_rows([_rep()], {"NVDA": _snap(112.0, 100.0, 10**6)},
                       existing=existing, now_ts=9999.0, market_date=DAY)
    assert len(rows) == 1
    assert round(rows[0]["peak_move_pct"], 1) == 12.0


def test_a_reporter_missing_from_the_snapshot_is_skipped_not_crashed():
    """A provider gap must degrade, never raise."""
    rows = detect_rows([_rep()], {}, existing={}, now_ts=1000.0, market_date=DAY)
    assert rows == []


def test_actuals_still_land_when_the_snapshot_is_entirely_missing():
    """Price gone, numbers present -> the row must still appear."""
    rows = detect_rows([_rep(eps_act=1.24)], {},
                       existing={}, now_ts=1000.0, market_date=DAY)
    assert len(rows) == 1
    assert rows[0]["trigger"] == "actuals"


def test_a_reporter_without_a_symbol_is_ignored():
    rows = detect_rows([{"sym": None, "timing": "amc"}], {},
                       existing={}, now_ts=1000.0, market_date=DAY)
    assert rows == []


def test_many_reporters_only_the_qualifying_ones_come_through():
    reporters = [_rep("NVDA"), _rep("AMD"), _rep("SBUX", eps_act=0.71)]
    snapshot = {
        "NVDA": _snap(106.4, 100.0, 10**6),   # liquid mover  -> in
        "AMD":  _snap(100.2, 100.0, 10**6),   # flat          -> out
        "SBUX": _snap(100.0, 100.0, 10**6),   # flat but printed -> in
    }
    rows = detect_rows(reporters, snapshot, existing={}, now_ts=1000.0, market_date=DAY)
    assert sorted(r["sym"] for r in rows) == ["NVDA", "SBUX"]


def test_a_row_with_eps_still_gains_its_revenue_leg():
    """LITE, 2026-08-11: eps_act 3.23 landed, rev_act froze at None all
    evening — the old gate only upgraded when EPS was null, so a row could
    never gain the revenue leg once its EPS arrived. Fields land separately;
    the upgrade must be field-by-field."""
    existing = {"LITE": {"sym": "LITE", "first_seen_at": 500.0, "trigger": "price",
                         "eps_act": 3.23, "eps_est": 3.1, "rev_act": None,
                         "rev_est": 480.0, "confirmed": 1, "peak_move_pct": 6.4}}
    rep = {"sym": "LITE", "timing": "amc", "eps_act": 3.23, "eps_est": 3.1,
           "rev_act": 495.2, "rev_est": 480.0}
    rows = detect_rows([rep], {"LITE": _snap(106.4, 100.0, 10**6)},
                       existing=existing, now_ts=9999.0, market_date=DAY)
    assert rows and rows[0]["rev_act"] == 495.2
    assert rows[0]["eps_act"] == 3.23
    assert rows[0]["first_seen_at"] == 500.0


def test_an_upgrade_never_regresses_a_stored_figure():
    """A reporter row that momentarily loses a field (degraded rebuild) must
    not null out a number the reader has already seen."""
    existing = {"NVDA": {"sym": "NVDA", "first_seen_at": 500.0, "trigger": "actuals",
                         "eps_act": 1.24, "eps_est": 1.11, "rev_act": None,
                         "rev_est": 49.0, "confirmed": 1, "peak_move_pct": 2.0}}
    rep = {"sym": "NVDA", "timing": "amc", "eps_act": None, "eps_est": 1.11,
           "rev_act": 51.2, "rev_est": 49.0}
    rows = detect_rows([rep], {"NVDA": _snap(102.0, 100.0, 10**6)},
                       existing=existing, now_ts=9999.0, market_date=DAY)
    assert rows and rows[0]["rev_act"] == 51.2      # gained the revenue leg
    assert rows[0]["eps_act"] == 1.24               # kept the eps it already had

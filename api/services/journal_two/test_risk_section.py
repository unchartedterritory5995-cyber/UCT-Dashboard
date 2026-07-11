"""Risk Block (Task B1) — R distribution, drawdown, streaks, loss-streak odds.

Two layers of coverage:
  - The pure helpers (`_r_histogram`, `_drawdown_from_series`, `_streaks_from_
    results`, `_loss_streak_odds`) tested directly with known sequences — the
    drawdown/odds math is verified independent of the 10-decisive coverage gate.
  - `_risk_section` through `get_analytics(...)["risk"]` for the gate, the
    null-R exclusion/noRCount, and the honest None-with-counts shape.
"""

import os
import sqlite3
import tempfile
import uuid
from datetime import datetime, timezone

import pytest


# ── DB fixture + row builders (mirror test_analytics.py) ──────────────────────


@pytest.fixture
def db_conn(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    import importlib
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    conn = sqlite3.connect(tmp.name)
    conn.row_factory = sqlite3.Row
    yield conn
    conn.close()
    os.unlink(tmp.name)


def _add_user(conn, user_id, email):
    conn.execute(
        "INSERT INTO users (id, email, password_hash) VALUES (?, ?, 'pw')",
        (user_id, email),
    )
    conn.commit()


def _add_account(conn, user_id, *, name="Default", starting_balance=100_000):
    aid = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    conn.execute(
        """
        INSERT INTO j2_accounts (
            id, user_id, name, color, broker, starting_balance,
            account_size, default_stop, position_closing,
            breakeven_range, setups, share_journal_data,
            created_at, updated_at
        ) VALUES (?, ?, ?, 'blue', NULL, ?, ?,
                  '{"mode":"custom"}', 'FIFO',
                  '{"enabled":false,"unit":"$","value":0}',
                  '[]', 0, ?, ?)
        """,
        (aid, user_id, name, starting_balance, starting_balance, now, now),
    )
    conn.commit()
    return aid


def _add_trade(
    conn, user_id, *, account_id=None,
    exit_date_iso="2026-04-19T18:00:00Z", pnl=100, r=1.5, result="Win",
    side="Long", setup="VCP", symbol="NVDA",
):
    tid = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    conn.execute(
        """
        INSERT INTO j2_trades (
            id, user_id, position_id, symbol, side, shares,
            entry_price, entry_date, exit_price, exit_date,
            original_stop, setup, notes, pnl_dollar, pnl_percent,
            r_multiple, hold_days, result, context_at_entry,
            account_id, created_at, trading_day_et, hour_et
        ) VALUES (?, ?, 'manual', ?, ?, 100, 500, ?, 510, ?,
                  490, ?, NULL, ?, 0.02, ?, 1, ?, '{}', ?, ?, ?, NULL)
        """,
        (
            tid, user_id, symbol, side, exit_date_iso, exit_date_iso,
            setup, pnl, r, result, account_id, now,
            exit_date_iso[:10],  # trading_day_et spine
        ),
    )
    conn.commit()
    return tid


# ── Pure-helper unit tests (no gate, exact math) ──────────────────────────────


def test_drawdown_known_sequence():
    """+100, -50, -100, +30 → maxDD 150 (peak 100 → trough -50), currentDD 120."""
    from api.services.journal_two.analytics import _drawdown_from_series
    pts = [
        ("2026-04-01", 100),
        ("2026-04-02", -50),
        ("2026-04-03", -100),
        ("2026-04-04", 30),
    ]
    dd = _drawdown_from_series(pts)
    assert dd["maxDrawdownDollar"] == 150.0
    assert dd["currentDrawdownDollar"] == 120.0
    # peak of the max drawdown was the +100 day; trough the -100 day
    assert dd["peakDate"] == "2026-04-01"
    assert dd["troughDate"] == "2026-04-03"


def test_drawdown_recovers_to_new_high_currentdd_zero():
    """A curve that makes a new high at the end has zero current drawdown."""
    from api.services.journal_two.analytics import _drawdown_from_series
    dd = _drawdown_from_series([("d1", 100), ("d2", -40), ("d3", 200)])
    # cum 100, 60, 260; peak 260 at the end → currentDD 0, maxDD 40 (100→60)
    assert dd["maxDrawdownDollar"] == 40.0
    assert dd["currentDrawdownDollar"] == 0.0


def test_drawdown_empty():
    from api.services.journal_two.analytics import _drawdown_from_series
    dd = _drawdown_from_series([])
    assert dd == {
        "maxDrawdownDollar": 0.0, "currentDrawdownDollar": 0.0,
        "peakDate": None, "troughDate": None,
    }


def test_r_histogram_bins_and_expectancy():
    """Every bin boundary is half-open [lo, hi); expectancy = mean R."""
    from api.services.journal_two.analytics import _r_histogram
    rs = [-4.0, -2.5, -1.5, -0.5, 0.5, 1.5, 2.5, 3.5,
          -3.0, 3.0, 0.0, -1.0]  # boundary values land in the upper bin
    bins, exp = _r_histogram(rs)
    counts = {b["bin"]: b["count"] for b in bins}
    assert counts["< -3"] == 1        # -4.0
    assert counts["-3..-2"] == 2      # -3.0 (lower boundary), -2.5
    assert counts["-2..-1"] == 1      # -1.5 only (-1.0 lands in the next bin up)
    assert counts["-1..0"] == 2       # -0.5, -1.0 (lower boundary)
    assert counts["0..1"] == 2        # 0.5, 0.0 (boundary)
    assert counts["1..2"] == 1        # 1.5
    assert counts["2..3"] == 1        # 2.5
    assert counts["> 3"] == 2         # 3.5, 3.0 (boundary)
    assert exp == round(sum(rs) / len(rs), 3)


def test_r_histogram_empty_expectancy_none():
    from api.services.journal_two.analytics import _r_histogram
    bins, exp = _r_histogram([])
    assert exp is None
    assert all(b["count"] == 0 for b in bins)
    assert [b["bin"] for b in bins] == [
        "< -3", "-3..-2", "-2..-1", "-1..0", "0..1", "1..2", "2..3", "> 3",
    ]


def test_streaks_be_removed_documented_behavior():
    """BEs are REMOVED from the sequence — they neither break nor count. So
    W W BE W → one win streak of 3 (not 2, and not broken by the breakeven)."""
    from api.services.journal_two.analytics import _streaks_from_results
    # caller passes only decisive results (BEs already filtered out)
    s = _streaks_from_results(["Win", "Win", "Win"])
    assert s["longestWin"] == 3
    assert s["longestLoss"] == 0
    assert s["current"] == {"type": "win", "length": 3}


def test_streaks_mixed_sequence_and_current():
    from api.services.journal_two.analytics import _streaks_from_results
    # W W L L L W  → longest win 2, longest loss 3, current win 1
    s = _streaks_from_results(["Win", "Win", "Loss", "Loss", "Loss", "Win"])
    assert s["longestWin"] == 2
    assert s["longestLoss"] == 3
    assert s["current"] == {"type": "win", "length": 1}


def test_streaks_empty():
    from api.services.journal_two.analytics import _streaks_from_results
    s = _streaks_from_results([])
    assert s == {"longestWin": 0, "longestLoss": 0, "current": {"type": None, "length": 0}}


def test_loss_streak_odds_deterministic_formula():
    """perYear = N * p * (1-p)^k, deterministic (no random)."""
    from api.services.journal_two.analytics import _loss_streak_odds
    out = _loss_streak_odds(0.5, 250, 5)
    # 250 * 0.5 * 0.5^5 = 250 * 0.5 * 0.03125 = 3.90625 → 3.9
    assert out == {"winRate": 0.5, "k": 5, "perYear": 3.9}
    out2 = _loss_streak_odds(0.6, 500, 5)
    # 500 * 0.6 * 0.4^5 = 500 * 0.6 * 0.01024 = 3.072 → 3.1
    assert out2["perYear"] == 3.1


# ── _risk_section through get_analytics (gate + integration) ──────────────────


def test_risk_gated_below_10_decisive(db_conn):
    """<10 decisive trades → aggregates None, counts populated (honest shape)."""
    from api.services.journal_two.analytics import get_analytics
    _add_user(db_conn, "u1", "u1@x.com")
    aid = _add_account(db_conn, "u1")
    # 5 decisive trades + 1 breakeven → decisiveCount 5 < 10 → gated
    for i in range(5):
        _add_trade(db_conn, "u1", account_id=aid,
                   exit_date_iso=f"2026-04-{i+1:02d}T18:00:00Z",
                   pnl=10, r=1.0, result="Win")
    _add_trade(db_conn, "u1", account_id=aid,
               exit_date_iso="2026-04-06T18:00:00Z", pnl=0, r=None, result="BE")

    risk = get_analytics("u1", account_id=aid, conn=db_conn)["risk"]
    assert risk["coverageReady"] is False
    assert risk["tradeCount"] == 6
    assert risk["decisiveCount"] == 5
    assert risk["noRCount"] == 1          # the breakeven has null R
    assert risk["rHistogram"] is None
    assert risk["expectancyR"] is None
    assert risk["drawdown"] is None
    assert risk["streaks"] is None
    assert risk["lossStreakOdds"] is None


def test_risk_ready_full_shape_null_r_excluded(db_conn):
    """>=10 decisive → full aggregates; null-R trades excluded from the histogram
    but counted in noRCount; the odds strip is deterministic."""
    from api.services.journal_two.analytics import get_analytics
    _add_user(db_conn, "u1", "u1@x.com")
    aid = _add_account(db_conn, "u1")

    # 10 wins (R=2) + 10 losses (R=-1) = 20 decisive, all within <30 days so the
    # pace falls back to the default N=250 → deterministic odds. p = 0.5.
    for i in range(10):
        _add_trade(db_conn, "u1", account_id=aid,
                   exit_date_iso=f"2026-05-{i+1:02d}T18:00:00Z",
                   pnl=200, r=2.0, result="Win")
    for i in range(10):
        _add_trade(db_conn, "u1", account_id=aid,
                   exit_date_iso=f"2026-05-{i+11:02d}T18:00:00Z",
                   pnl=-100, r=-1.0, result="Loss")
    # one extra trade with NO stop logged → null R (excluded from histogram)
    _add_trade(db_conn, "u1", account_id=aid,
               exit_date_iso="2026-05-25T18:00:00Z", pnl=50, r=None, result="Win")

    risk = get_analytics("u1", account_id=aid, conn=db_conn)["risk"]
    assert risk["coverageReady"] is True
    assert risk["tradeCount"] == 21
    assert risk["decisiveCount"] == 21     # 11 wins + 10 losses
    assert risk["noRCount"] == 1

    # histogram counts only the 20 R-bearing trades (null-R excluded)
    counts = {b["bin"]: b["count"] for b in risk["rHistogram"]}
    assert sum(counts.values()) == 20
    assert counts["1..2"] == 10 or counts["2..3"] == 10  # the R=2 wins land in 2..3
    assert counts["2..3"] == 10            # 2.0 → [2,3)
    assert counts["-1..0"] == 10           # -1.0 → [-1,0)
    # expectancy = mean of twenty (10*2 + 10*-1)/20 = 0.5
    assert risk["expectancyR"] == 0.5

    # odds: p = 11/21 decisive wins; N default 250 (span < 30 days), k = 5
    odds = risk["lossStreakOdds"]
    assert odds["k"] == 5
    p = 11 / 21
    expected = round(250 * p * ((1 - p) ** 5), 1)
    assert odds["perYear"] == expected
    assert odds["winRate"] == round(p, 4)

    # drawdown: 11 wins then 10 losses ordered by date → deepest late drawdown
    dd = risk["drawdown"]
    assert dd["maxDrawdownDollar"] > 0
    assert dd["currentDrawdownDollar"] >= 0


def test_risk_streaks_over_decisive_sequence(db_conn):
    """Streaks computed over the decisive (BE-removed) win/loss sequence in
    exit-date order: W×6, L×5, W×... shapes come out right."""
    from api.services.journal_two.analytics import get_analytics
    _add_user(db_conn, "u1", "u1@x.com")
    aid = _add_account(db_conn, "u1")

    seq = (["Win"] * 6) + (["Loss"] * 4) + (["Win"] * 2)  # 12 decisive
    for i, res in enumerate(seq):
        _add_trade(db_conn, "u1", account_id=aid,
                   exit_date_iso=f"2026-06-{i+1:02d}T18:00:00Z",
                   pnl=(10 if res == "Win" else -10),
                   r=(1.0 if res == "Win" else -1.0), result=res)

    risk = get_analytics("u1", account_id=aid, conn=db_conn)["risk"]
    assert risk["coverageReady"] is True
    st = risk["streaks"]
    assert st["longestWin"] == 6
    assert st["longestLoss"] == 4
    assert st["current"] == {"type": "win", "length": 2}


def test_risk_empty_user_gated(db_conn):
    """No trades → gated shape with zero counts (never crashes)."""
    from api.services.journal_two.analytics import get_analytics
    _add_user(db_conn, "u1", "u1@x.com")
    _add_account(db_conn, "u1")
    risk = get_analytics("u1", conn=db_conn)["risk"]
    assert risk["coverageReady"] is False
    assert risk["tradeCount"] == 0
    assert risk["decisiveCount"] == 0
    assert risk["noRCount"] == 0
    assert risk["drawdown"] is None

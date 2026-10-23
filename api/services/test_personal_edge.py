from api.services import personal_edge as pe


def test_normalize_setup_resolves_via_engine(monkeypatch):
    # engine alias resolver maps a journal display name to a canonical key
    monkeypatch.setattr(pe, "_resolve", lambda n: "HTF" if "high tight" in n.lower() else None)
    assert pe.normalize_setup("High Tight Flag (Powerplay)") == "HTF"


def test_normalize_setup_none_for_unjoinable(monkeypatch):
    monkeypatch.setattr(pe, "_resolve", lambda n: None)
    assert pe.normalize_setup("random freetext tag") is None


def test_normalize_setup_never_raises(monkeypatch):
    def boom(n):
        raise RuntimeError("x")
    monkeypatch.setattr(pe, "_resolve", boom)
    assert pe.normalize_setup("anything") is None


# ── Task 2: edge_for_setups ───────────────────────────────────────────────────

def test_edge_soft_mutes_only_on_size_and_negative(monkeypatch):
    monkeypatch.setattr(pe, "normalize_setup", lambda s: s)  # identity for the test
    perf = [
        {"setup": "HTF", "trade_count": 30, "win_rate": 0.7, "avg_r": 0.9, "total_r": 27},
        {"setup": "Bull Flag", "trade_count": 30, "win_rate": 0.2, "avg_r": -0.4, "total_r": -12},
        {"setup": "VCP", "trade_count": 8, "win_rate": 0.25, "avg_r": -0.3, "total_r": -2.4},
    ]
    out = pe.edge_for_setups("u", setup_perf_fn=lambda uid, aid: perf)
    assert out["HTF"]["verdict"] == "edge" and out["HTF"]["muted"] is False
    assert out["Bull Flag"]["muted"] is True and out["Bull Flag"]["verdict"] == "weak"
    assert out["VCP"]["muted"] is False and out["VCP"]["verdict"] == "thin"
    assert "small sample" in out["VCP"]["note"].lower()


def test_edge_never_raises(monkeypatch):
    out = pe.edge_for_setups("u", setup_perf_fn=lambda uid, aid: (_ for _ in ()).throw(RuntimeError()))
    assert out == {}


def test_edge_reads_breakdown_key_shape(monkeypatch):
    # real _exec_get_aggregates breakdown rows are keyed 'key', not 'setup'
    monkeypatch.setattr(pe, "normalize_setup", lambda s: s)
    rows = [{"key": "HTF", "trade_count": 30, "avg_r": 0.8, "total_r": 24, "win_rate": 0.7}]
    out = pe.edge_for_setups("u", setup_perf_fn=lambda uid, aid: rows)
    assert out["HTF"]["verdict"] == "edge"


# -- the DEFAULT seam reads real trades (2026-10-23) ---------------------------------------
# Before: account None became `account_id IN (NULL)` (a direct call answered {}), and the
# connection the seam opened was never closed. The 7-day lookback every production caller
# (Compass grading, AI Search) saw is KEPT: fix round 1 ruling I-1.

def _temp_db(monkeypatch, tmp_path):
    from api.services import auth_db
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "edge.db"))
    auth_db.init_db()
    return auth_db


def _member_with_flag_trade(monkeypatch, tmp_path, user_id="u9", days_ago=3):
    from datetime import datetime, timedelta, timezone
    auth_db = _temp_db(monkeypatch, tmp_path)
    from api.services.journal_two import accounts
    acc = accounts.get_or_migrate_default_account(user_id)      # setup only: this helper writes
    acc_id = acc["id"] if isinstance(acc, dict) else acc
    when = (datetime.now(timezone.utc) - timedelta(days=days_ago)).isoformat()
    c = auth_db.get_connection()
    try:
        c.execute(
            "INSERT INTO j2_trades (id, user_id, position_id, symbol, side, shares, entry_price, entry_date,"
            " exit_price, exit_date, original_stop, setup, notes, pnl_dollar, pnl_percent, r_multiple,"
            " hold_days, result, context_at_entry, created_at, account_id, mistake_tags, emotion_tags, fees)"
            " VALUES ('t1', ?, 'p', 'AMD', 'Long', 10, 50, ?, 55, ?, 48, 'Flag', '', 50, 0.1, 2.0, 4, 'Win',"
            " '{}', ?, ?, '[]', '[]', 0)",
            (user_id, when, when, when, acc_id))
        c.commit()
    finally:
        c.close()
    monkeypatch.setattr(pe, "_resolve", lambda n: None)          # keep the journal name as the key
    return auth_db, acc_id


def test_default_seam_with_no_account_reads_the_members_recent_trades(monkeypatch, tmp_path):
    _member_with_flag_trade(monkeypatch, tmp_path)
    out = pe.edge_for_setups("u9")
    assert set(out) == {"Flag"}
    assert out["Flag"]["n"] == 1 and out["Flag"]["avg_r"] == 2.0
    assert pe.edge_for_setups("someone-else") == {}              # control: scoped to the member


def test_default_seam_with_a_real_account_reads_that_account(monkeypatch, tmp_path):
    _, acc_id = _member_with_flag_trade(monkeypatch, tmp_path)
    assert set(pe.edge_for_setups("u9", acc_id)) == {"Flag"}
    assert pe.edge_for_setups("u9", "not-my-account") == {}


def test_default_seam_closes_its_connection(monkeypatch, tmp_path):
    auth_db, _ = _member_with_flag_trade(monkeypatch, tmp_path)
    real = auth_db.get_connection
    opened = []

    class _Tracked:
        def __init__(self, conn):
            self._c, self.closed = conn, False

        def __getattr__(self, name):
            return getattr(self._c, name)

        def close(self):
            self.closed = True
            self._c.close()

    def tracked():
        t = _Tracked(real())
        opened.append(t)
        return t

    monkeypatch.setattr(auth_db, "get_connection", tracked)
    assert set(pe.edge_for_setups("u9")) == {"Flag"}
    assert opened and all(t.closed for t in opened)


def test_compass_grading_seam_gets_real_edge(monkeypatch, tmp_path):
    _member_with_flag_trade(monkeypatch, tmp_path)
    from api.services import grade_watchlist as gw
    assert set(gw._default_edge("u9", None)) == {"Flag"}


def test_ai_search_seam_gets_real_edge(monkeypatch, tmp_path):
    _, acc_id = _member_with_flag_trade(monkeypatch, tmp_path)
    from api.services import ai_search_personal as asp
    assert set(asp._edge_for("u9", acc_id)) == {"Flag"}
    assert "Flag +2.00R" in asp._fmt_edge("u9", acc_id)


def test_default_seam_keeps_the_seven_day_lookback(monkeypatch, tmp_path):
    """Ruling I-1: the defect was the scope and the leaked connection, not the window. A trade
    eight days old is outside every default-seam caller's lookback, as it always was."""
    _, acc_id = _member_with_flag_trade(monkeypatch, tmp_path, days_ago=8)
    assert pe.edge_for_setups("u9") == {}
    assert pe.edge_for_setups("u9", acc_id) == {}
    from api.services import grade_watchlist as gw, ai_search_personal as asp
    assert gw._default_edge("u9", acc_id) == {} and asp._edge_for("u9", acc_id) == {}

